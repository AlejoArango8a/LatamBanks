#!/usr/bin/env python3
"""
argentina_loader.py — ETL BCRA Datos Abiertos (entidades) → CockroachDB
LatamBanks — country='AR'

Fuente (mensual, .7z con TXT):
  https://www.bcra.gob.ar/archivos/Pdfs/PublicacionesEstadisticas/Entidades/{YYYYMM}d.7z

  Entfin/Tec_Cont/baldet/COMPLETO.TXT → balance (débito/crédito)
  Entfin/Tec_Cont/entidad/COMPLETO.TXT → catálogo / tipo de entidad

Unidad: miles de ARS → monto_total en pesos enteros (×1000).
ins_cod: código BCRA numérico (ej. 7 = Galicia, 11 = Nación).

RESULTADO_NETO = ACTIVO − PASIVO − PATRIMONIO_NETO (equiv. Rdos. integrales acum. del PE).

Modos:
  (sin flags)     Incremental: meses recientes aún no en carga_log
  --month AAAAMM  Carga/recarga un mes
  --all / --from / --to
  --dry-run
  --wipe
"""
from __future__ import annotations

import argparse
import logging
import os
import re
import shutil
import tempfile
import time
from pathlib import Path
from typing import Iterable
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

from dotenv import load_dotenv

load_dotenv(Path(__file__).parent / ".env")

try:
    import py7zr
except ImportError as e:  # pragma: no cover
    raise SystemExit("Falta py7zr. pip install py7zr") from e

COUNTRY = "AR"
BATCH = 500
BASE = "https://www.bcra.gob.ar/archivos/Pdfs/PublicacionesEstadisticas/Entidades"
MIN_PERIOD = "202001"
SCALE = 1000  # miles de ARS → ARS

# Cuentas baldet de primer nivel + NI derivado
KEEP_ACCOUNTS = {
    "100000": ("b1", "TOTAL_ACTIVO", "Activo"),
    "110000": ("b1", "EFECTIVO_Y_DEPOSITOS", "Efectivo y depósitos en bancos"),
    "120000": ("b1", "TITULOS", "Títulos públicos y privados"),
    "130000": ("b1", "PRESTAMOS", "Préstamos"),
    "300000": ("b1", "TOTAL_PASIVO", "Pasivo"),
    "310000": ("b1", "DEPOSITOS", "Depósitos"),
    "400000": ("b1", "PATRIMONIO_NETO", "Patrimonio neto"),
    "410000": ("b1", "CAPITAL_SOCIAL", "Capital social"),
    "440000": ("b1", "RESERVA_UTILIDADES", "Reserva de utilidades"),
    "450000": ("b1", "RESULTADOS_NO_ASIGNADOS", "Resultados no asignados"),
    "510000": ("r1", "INGRESOS_FINANCIEROS", "Ingresos financieros"),
    "520000": ("r1", "EGRESOS_FINANCIEROS", "Egresos financieros"),
    "530000": ("r1", "CARGO_INCOBRABILIDAD", "Cargo por incobrabilidad"),
    "540000": ("r1", "INGRESOS_SERVICIOS", "Ingresos por servicios"),
    "550000": ("r1", "EGRESOS_SERVICIOS", "Egresos por servicios"),
    "560000": ("r1", "GASTOS_ADMINISTRACION", "Gastos de administración"),
    "610000": ("r1", "IMPUESTO_GANANCIAS", "Impuesto a las ganancias"),
    "620000": ("r1", "RESULTADO_MONETARIO", "Resultado monetario"),
}

BANK_TYPE_RE = re.compile(r"bancos?\b", re.I)

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
log = logging.getLogger("argentina_loader")


def file_url(periodo: str) -> str:
    return f"{BASE}/{periodo}d.7z"


def ym_to_period(y: int, m: int) -> str:
    return f"{y}{m:02d}"


def iter_periods(start: str, end: str | None = None) -> list[str]:
    from datetime import date

    if end is None:
        today = date.today()
        end = ym_to_period(today.year, today.month)
    y, m = int(start[:4]), int(start[4:6])
    ye, me = int(end[:4]), int(end[4:6])
    out = []
    while (y, m) <= (ye, me):
        out.append(ym_to_period(y, m))
        m += 1
        if m > 12:
            m = 1
            y += 1
    return out


def recent_candidate_periods(n_months: int = 4) -> list[str]:
    from datetime import date

    today = date.today()
    y, m = today.year, today.month
    out = []
    for _ in range(n_months):
        out.append(ym_to_period(y, m))
        m -= 1
        if m == 0:
            m = 12
            y -= 1
    return list(reversed(out))


def http_bytes(url: str, retries: int = 3, backoff: float = 3.0) -> bytes:
    last = None
    for attempt in range(1, retries + 1):
        try:
            req = Request(url, headers={"User-Agent": "LatamBanksAR/1.0"})
            with urlopen(req, timeout=180) as r:
                return r.read()
        except (HTTPError, URLError, TimeoutError) as e:
            last = e
            log.warning("intento %d/%d fallo %s: %s", attempt, retries, url, e)
            if attempt < retries:
                time.sleep(backoff * attempt)
    raise last


def index_exists(periodo: str) -> bool:
    url = file_url(periodo)
    try:
        req = Request(url, method="HEAD", headers={"User-Agent": "LatamBanksAR/1.0"})
        with urlopen(req, timeout=30) as r:
            return 200 <= r.status < 400
    except Exception:
        # algunos hosts no soportan HEAD: probar GET corto
        try:
            req = Request(url, headers={"User-Agent": "LatamBanksAR/1.0", "Range": "bytes=0-16"})
            with urlopen(req, timeout=45) as r:
                return True
        except Exception:
            return False


def discover_available_periods(start: str = MIN_PERIOD, end: str | None = None) -> list[str]:
    found = []
    for p in iter_periods(max(start, MIN_PERIOD), end):
        if index_exists(p):
            found.append(p)
            log.info("catálogo: %s OK", p)
        else:
            log.info("catálogo: %s —", p)
    log.info(
        "Catálogo AR: %d meses (%s .. %s)",
        len(found),
        found[0] if found else "—",
        found[-1] if found else "—",
    )
    return found


def _unquote(s: str) -> str:
    s = s.strip()
    if len(s) >= 2 and s[0] == '"' and s[-1] == '"':
        return s[1:-1]
    return s


def _num(s: str) -> float:
    try:
        return float(str(s).strip().replace(",", ""))
    except (TypeError, ValueError):
        return 0.0


def natural_amount(c1: float, c2: float) -> int:
    """Saldo en la columna natural (activo/gasto→débito, pasivo/PN/ingreso→crédito)."""
    mag = c1 if abs(c1) >= abs(c2) else c2
    return int(round(mag * SCALE))


def parse_entidad(path: Path) -> dict[int, tuple[str, str]]:
    """codigo → (razon_social, tipo)."""
    out: dict[int, tuple[str, str]] = {}
    if not path.exists():
        return out
    text = path.read_text("latin-1", errors="replace")
    for line in text.splitlines():
        parts = line.split("\t")
        if len(parts) < 40:
            continue
        try:
            code = int(_unquote(parts[0]))
        except ValueError:
            continue
        name = _unquote(parts[1])
        tipo = _unquote(parts[39]) if len(parts) > 39 else ""
        out[code] = (name, tipo)
    return out


def is_bank(code: int, tipo: str, name: str) -> bool:
    if tipo and BANK_TYPE_RE.search(tipo):
        return True
    # fallback: códigos bancarios típicos BCRA (< 10000) con "banco" en nombre
    if code < 10000 and re.search(r"banco", name, re.I):
        return True
    return False


def parse_baldet(path: Path, periodo: str, banks: dict[int, str]):
    """Parse COMPLETO baldet → filas DB + plan."""
    # code → {raw_cta: (c1,c2,desc)}
    by: dict[int, dict[str, tuple[float, float, str]]] = {}
    names: dict[int, str] = {}
    text = path.read_text("latin-1", errors="replace")
    for line in text.splitlines():
        parts = line.split("\t")
        if len(parts) < 7:
            continue
        try:
            code = int(_unquote(parts[0]))
        except ValueError:
            continue
        if code not in banks:
            continue
        name = _unquote(parts[1])
        per = _unquote(parts[2])
        if per and per != periodo:
            continue
        cta = _unquote(parts[3])
        desc = _unquote(parts[4])
        c1 = _num(parts[5])
        c2 = _num(parts[6])
        names[code] = name or banks[code]
        by.setdefault(code, {})[cta] = (c1, c2, desc)

    rows = []
    plan: dict[str, str] = {}
    inst = []
    for code, accounts in by.items():
        name = names.get(code) or banks[code]
        inst.append((COUNTRY, code, name))
        vals: dict[str, int] = {}
        for raw, (tipo, cuenta, default_desc) in KEEP_ACCOUNTS.items():
            if raw not in accounts:
                continue
            c1, c2, desc = accounts[raw]
            amt = natural_amount(c1, c2)
            # Impuesto / resultado monetario: conservar signo contable (débito−crédito)
            if raw in ("610000", "620000"):
                amt = int(round((c1 - c2) * SCALE))
            vals[cuenta] = amt
            plan[cuenta] = desc or default_desc
            rows.append((COUNTRY, periodo, tipo, code, cuenta, 0, 0, 0, 0, amt))

        activo = vals.get("TOTAL_ACTIVO", 0)
        pasivo = vals.get("TOTAL_PASIVO", 0)
        pn = vals.get("PATRIMONIO_NETO", 0)
        if activo or pasivo or pn:
            ni = activo - pasivo - pn
            plan["RESULTADO_NETO"] = "Resultado integral acumulado del período (A−P−PN)"
            rows.append((COUNTRY, periodo, "r1", code, "RESULTADO_NETO", 0, 0, 0, 0, ni))

    return inst, rows, plan


def extract_and_parse(data: bytes, periodo: str):
    tmp = Path(tempfile.mkdtemp(prefix="ar_bcra_"))
    try:
        archive = tmp / f"{periodo}d.7z"
        archive.write_bytes(data)
        with py7zr.SevenZipFile(archive, mode="r") as z:
            # extraer solo lo necesario
            targets = [
                n
                for n in z.getnames()
                if n.replace("\\", "/").endswith(
                    (
                        "Entfin/Tec_Cont/baldet/COMPLETO.TXT",
                        "Entfin/Tec_Cont/entidad/COMPLETO.TXT",
                    )
                )
                or n.replace("\\", "/").lower().endswith("baldet/completo.txt")
                or n.replace("\\", "/").lower().endswith("entidad/completo.txt")
            ]
            if not targets:
                # fallback: extract all tec_cont
                targets = [
                    n
                    for n in z.getnames()
                    if "Tec_Cont" in n.replace("\\", "/")
                    and n.lower().endswith("completo.txt")
                ]
            z.extract(path=tmp, targets=targets or None)

        baldet = None
        entidad = None
        for p in tmp.rglob("*"):
            if not p.is_file():
                continue
            norm = str(p).replace("\\", "/").lower()
            if norm.endswith("baldet/completo.txt"):
                baldet = p
            elif norm.endswith("entidad/completo.txt"):
                entidad = p
        if not baldet:
            raise RuntimeError(f"baldet/COMPLETO.TXT ausente en {periodo}")

        cat = parse_entidad(entidad) if entidad else {}
        banks = {
            code: name
            for code, (name, tipo) in cat.items()
            if is_bank(code, tipo, name)
        }
        if not banks:
            # sin catálogo: tomar todos los códigos < 10000 del baldet
            text = baldet.read_text("latin-1", errors="replace")
            for line in text.splitlines()[:5000]:
                parts = line.split("\t")
                if len(parts) < 2:
                    continue
                try:
                    code = int(_unquote(parts[0]))
                except ValueError:
                    continue
                if code < 10000:
                    banks[code] = _unquote(parts[1])

        return parse_baldet(baldet, periodo, banks)
    finally:
        shutil.rmtree(tmp, ignore_errors=True)


# ---------------------------------------------------------------------------
# DB
# ---------------------------------------------------------------------------
def get_db_url() -> str:
    url = os.environ.get("COCKROACH_URL")
    if not url:
        raise SystemExit("Falta COCKROACH_URL (.env o entorno).")
    return url


def connect():
    import psycopg2

    return psycopg2.connect(get_db_url())


def upsert(conn, table, cols, updates, conflict, rows):
    import psycopg2.extras

    if not rows:
        return
    cur = conn.cursor()
    sql = (
        f"INSERT INTO {table} ({','.join(cols)}) VALUES %s "
        f"ON CONFLICT ({','.join(conflict)}) DO UPDATE SET "
        + ", ".join(f"{c}=EXCLUDED.{c}" for c in updates)
    )
    for i in range(0, len(rows), BATCH):
        psycopg2.extras.execute_values(cur, sql, rows[i : i + BATCH])
    conn.commit()


def wipe_ar(conn):
    cur = conn.cursor()
    for t in ("datos_financieros", "instituciones", "plan_cuentas", "carga_log"):
        cur.execute(f"DELETE FROM {t} WHERE country=%s", (COUNTRY,))
    conn.commit()
    log.info("Argentina borrada (solo country='AR').")


def get_loaded_periods(conn) -> set[str]:
    cur = conn.cursor()
    cur.execute(
        "SELECT periodo FROM carga_log WHERE country=%s AND estado IN ('ok','alerta_esquema')",
        (COUNTRY,),
    )
    return {r[0] for r in cur.fetchall()}


def load_month(conn, periodo: str) -> None:
    from schema_guard import detect_schema_changes, get_known_accounts, record_schema_result

    url = file_url(periodo)
    log.info("dt=%s descargando %s", periodo, url)
    data = http_bytes(url)
    inst_rows, all_rows, plan = extract_and_parse(data, periodo)
    if not all_rows:
        raise RuntimeError(f"Sin filas de datos para {periodo}")

    known = get_known_accounts(conn, COUNTRY)
    incoming = {r[4] for r in all_rows}
    report = detect_schema_changes(COUNTRY, periodo, incoming, known)

    upsert(
        conn,
        "instituciones",
        ["country", "codigo", "razon_social"],
        ["razon_social"],
        ["country", "codigo"],
        inst_rows,
    )
    upsert(
        conn,
        "plan_cuentas",
        ["country", "cuenta", "descripcion"],
        ["descripcion"],
        ["country", "cuenta"],
        [(COUNTRY, c, d) for c, d in sorted(plan.items())],
    )
    upsert(
        conn,
        "datos_financieros",
        [
            "country",
            "periodo",
            "tipo",
            "ins_cod",
            "cuenta",
            "monto_clp",
            "monto_uf",
            "monto_tc",
            "monto_ext",
            "monto_total",
        ],
        ["monto_total"],
        ["country", "periodo", "tipo", "ins_cod", "cuenta"],
        all_rows,
    )
    upsert(
        conn,
        "carga_log",
        ["country", "periodo", "archivos_procesados", "estado"],
        ["archivos_procesados", "estado"],
        ["country", "periodo"],
        [(COUNTRY, periodo, len(inst_rows), "ok")],
    )
    record_schema_result(conn, COUNTRY, periodo, report)
    log.info(
        "dt=%s OK: %d bancos, %d filas, %d cuentas (schema=%s)",
        periodo,
        len(inst_rows),
        len(all_rows),
        len(plan),
        report.get("status"),
    )


def main(argv: Iterable[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description="ETL BCRA entidades Argentina → CockroachDB")
    ap.add_argument("--wipe", action="store_true")
    ap.add_argument("--month", help="AAAAMM puntual")
    ap.add_argument("--all", action="store_true")
    ap.add_argument("--from", dest="from_dt", default=MIN_PERIOD)
    ap.add_argument("--to", dest="to_dt", default=None)
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args(list(argv) if argv is not None else None)

    if args.month:
        periods = [args.month]
    elif args.all or args.to_dt or (args.from_dt and args.from_dt != MIN_PERIOD):
        periods = discover_available_periods(args.from_dt, args.to_dt)
    else:
        periods = [p for p in recent_candidate_periods(4) if index_exists(p)]

    if args.from_dt:
        periods = [p for p in periods if p >= args.from_dt]
    if args.to_dt:
        periods = [p for p in periods if p <= args.to_dt]

    if args.dry_run:
        print(f"Meses objetivo: {len(periods)}")
        for p in periods[:12]:
            print(f"  {p}  {file_url(p)}")
        if len(periods) > 12:
            print(f"  … +{len(periods)-12}")
        if periods:
            data = http_bytes(file_url(periods[-1]))
            inst, rows, plan = extract_and_parse(data, periods[-1])
            print(f"Bancos ({periods[-1]}): {len(inst)}")
            top = sorted(inst, key=lambda r: r[1])[:8]
            print(" sample:", [(c, n[:40]) for _, c, n in top])
            # Galicia=7 KPIs
            by = {}
            for r in rows:
                if r[3] == 7 and r[4] in (
                    "TOTAL_ACTIVO",
                    "PRESTAMOS",
                    "DEPOSITOS",
                    "PATRIMONIO_NETO",
                    "RESULTADO_NETO",
                ):
                    by[r[4]] = r[9]
            print("Galicia KPIs (ARS):", by)
            print(f"filas={len(rows)} plan={len(plan)}")
        return 0

    conn = connect()
    try:
        if args.wipe:
            wipe_ar(conn)

        if not args.month and not args.all:
            loaded = get_loaded_periods(conn)
            periods = [p for p in periods if p not in loaded]
            if not periods:
                log.info("Argentina al día. Nada nuevo.")
                return 0

        log.info(
            "Cargando %d mes(es): %s%s",
            len(periods),
            periods[:6],
            "…" if len(periods) > 6 else "",
        )
        for p in periods:
            load_month(conn, p)
        return 0
    finally:
        conn.close()


if __name__ == "__main__":
    raise SystemExit(main())
