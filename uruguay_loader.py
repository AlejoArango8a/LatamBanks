#!/usr/bin/env python3
"""
uruguay_loader.py — ETL BCU / Superintendencia de Servicios Financieros → CockroachDB
LatamBanks — country='UY'

Fuente: Boletín informativo mensual
  https://www.bcu.gub.uy/Servicios-Financieros-SSF/Boletin SSF/{YYYY}/{Mes}/indice.htm
  → institucion{ID}.xls (Estado de Situación + Resultados + anexos)

Universo: bancos oficiales (grupo99) + bancos privados (grupo997).
Valores: miles de pesos → se guardan en pesos enteros (×1000) en monto_total.

Modos:
  (sin flags)     Incremental: meses del catálogo aún no en carga_log
  --month AAAAMM  Carga/recarga un mes
  --all           Recarga todos los del rango
  --from / --to   Filtra AAAAMM
  --dry-run       Lista sin tocar BD
  --wipe          Borra solo country='UY'
"""
from __future__ import annotations

import argparse
import logging
import os
import re
import ssl
import time
from pathlib import Path
from typing import Iterable
from urllib.error import HTTPError, URLError
from urllib.parse import quote, urljoin, urlsplit, urlunsplit
from urllib.request import HTTPSHandler, Request, build_opener

from dotenv import load_dotenv

load_dotenv(Path(__file__).parent / ".env")

try:
    import xlrd
except ImportError as e:  # pragma: no cover
    raise SystemExit("Falta xlrd. pip install xlrd") from e

COUNTRY = "UY"
BATCH = 500
BASE = "https://www.bcu.gub.uy/Servicios-Financieros-SSF/Boletin SSF"
# Meses con boletín en path moderno (validado ≥2020).
MIN_PERIOD = "202001"
SCALE = 1000  # miles de pesos → pesos

MONTH_NAMES = {
    1: "Enero",
    2: "Febrero",
    3: "Marzo",
    4: "Abril",
    5: "Mayo",
    6: "Junio",
    7: "Julio",
    8: "Agosto",
    9: "Setiembre",
    10: "Octubre",
    11: "Noviembre",
    12: "Diciembre",
}

GROUP_FILES = ("grupo99.xls", "grupo997.xls")  # oficiales + privados
# IDs de agregados del boletín (no son bancos individuales).
AGGREGATE_IDS = frozenset({99, 997})

# Display / DB names when BCU XLS still carries a legacy brand.
RAZON_SOCIAL_OVERRIDES = {
    157: "BTG Pactual Uruguay",
}

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
log = logging.getLogger("uruguay_loader")

_SSL_CTX = ssl.create_default_context()
_SSL_CTX.check_hostname = False
_SSL_CTX.verify_mode = ssl.CERT_NONE
_OPENER = build_opener(HTTPSHandler(context=_SSL_CTX))


def _encode_url(url: str) -> str:
    parts = urlsplit(url)
    return urlunsplit(
        (parts.scheme, parts.netloc, quote(parts.path, safe="/%:"), parts.query, parts.fragment)
    )


def http_bytes(url: str, retries: int = 3, backoff: float = 4.0) -> bytes:
    last = None
    for attempt in range(1, retries + 1):
        try:
            req = Request(
                _encode_url(url),
                headers={"User-Agent": "LatamBanksUY/1.0"},
            )
            with _OPENER.open(req, timeout=120) as r:
                return r.read()
        except (HTTPError, URLError, TimeoutError, ssl.SSLError) as e:
            last = e
            log.warning("intento %d/%d fallo %s: %s", attempt, retries, url, e)
            if attempt < retries:
                time.sleep(backoff * attempt)
    raise last


def http_text(url: str) -> str:
    return http_bytes(url).decode("latin-1", errors="ignore")


def month_url(yyyy: int, mm: int) -> str:
    return f"{BASE}/{yyyy}/{MONTH_NAMES[mm]}/"


def period_to_ym(periodo: str) -> tuple[int, int]:
    return int(periodo[:4]), int(periodo[4:6])


def ym_to_period(y: int, m: int) -> str:
    return f"{y}{m:02d}"


def iter_periods(start: str, end: str) -> list[str]:
    y, m = period_to_ym(start)
    ye, me = period_to_ym(end)
    out = []
    while (y, m) <= (ye, me):
        out.append(ym_to_period(y, m))
        m += 1
        if m > 12:
            m = 1
            y += 1
    return out


def index_exists(periodo: str) -> bool:
    y, m = period_to_ym(periodo)
    url = urljoin(month_url(y, m), "indice.htm")
    try:
        http_bytes(url, retries=1)
        return True
    except Exception:
        return False


def discover_available_periods(start: str = MIN_PERIOD, end: str | None = None) -> list[str]:
    if end is None:
        from datetime import date

        today = date.today()
        end = ym_to_period(today.year, today.month)
    found = []
    for p in iter_periods(max(start, MIN_PERIOD), end):
        if index_exists(p):
            found.append(p)
            log.info("catálogo: %s OK", p)
    log.info(
        "Catálogo UY: %d meses (%s .. %s)",
        len(found),
        found[0] if found else "—",
        found[-1] if found else "—",
    )
    return found


def recent_candidate_periods(n_months: int = 4) -> list[str]:
    """Últimos n meses calendario (para cron incremental sin sondear 5 años)."""
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


def parse_cuenta(label: str) -> tuple[str, str] | None:
    """Devuelve (cuenta, descripcion) o None si la fila no es dato."""
    lab = re.sub(r"\s+", " ", str(label or "").strip())
    if not lab:
        return None
    skip = {
        "banco central del uruguay",
        "superintendencia de servicios financieros",
        "estado de situación",
        "estado de resultados",
        "volver al índice",
        "operaciones continuas",
        "operaciones discontinuadas",
        "cifras en miles de pesos",
    }
    low = lab.lower()
    if low in skip or low.startswith("datos al ") or low.startswith("(período"):
        return None
    if low.startswith("actividad en"):
        return None

    m = re.match(r"^(\d+(?:\.\d+)*)\s*[-–]\s*(.+)$", lab)
    if m:
        return m.group(1), m.group(2).strip()

    # Subtotales / totales sin código numérico
    slug = re.sub(r"[^a-z0-9]+", "_", low).strip("_")
    if not slug:
        return None
    return f"S_{slug}", lab


def _cell_num(sh, r: int, c: int) -> int:
    try:
        v = sh.cell_value(r, c)
        if v in ("", None):
            return 0
        return int(round(float(v) * SCALE))
    except (TypeError, ValueError):
        return 0


def parse_institution_xls(data: bytes, ins_cod: int, periodo: str):
    """Parsea Situación (b1) + Resultados (r1). Retorna (nombre, rows, plan_pairs)."""
    book = xlrd.open_workbook(file_contents=data)
    nombre = ""
    if "Indice" in book.sheet_names():
        nombre = str(book.sheet_by_name("Indice").cell_value(5, 1) or "").strip()

    rows = []
    plan = {}

    if "Situación" in book.sheet_names():
        sh = book.sheet_by_name("Situación")
        if not nombre:
            nombre = str(sh.cell_value(3, 0) or "").strip()
        for r in range(sh.nrows):
            parsed = parse_cuenta(sh.cell_value(r, 0))
            if not parsed:
                continue
            cuenta, desc = parsed
            # Columna Total = índice 3 (MN=1, ME=2, Total=3)
            total_col = 3 if sh.ncols > 3 else sh.ncols - 1
            val = _cell_num(sh, r, total_col)
            rows.append((COUNTRY, periodo, "b1", ins_cod, cuenta, 0, 0, 0, 0, val))
            plan[cuenta] = desc

    if "Resultados" in book.sheet_names():
        sh = book.sheet_by_name("Resultados")
        if not nombre:
            nombre = str(sh.cell_value(3, 0) or "").strip()
        for r in range(sh.nrows):
            parsed = parse_cuenta(sh.cell_value(r, 0))
            if not parsed:
                continue
            cuenta, desc = parsed
            # Preferir código estable para el KPI de utilidad
            if desc.lower() == "resultado del ejercicio" or cuenta == "S_resultado_del_ejercicio":
                cuenta = "R_EJERCICIO"
                desc = "Resultado del ejercicio"
            total_col = 3 if sh.ncols > 3 else sh.ncols - 1
            val = _cell_num(sh, r, total_col)
            rows.append((COUNTRY, periodo, "r1", ins_cod, cuenta, 0, 0, 0, 0, val))
            plan[cuenta] = desc

    if not nombre:
        nombre = f"Institución {ins_cod}"
    return nombre, rows, plan


def bank_ids_from_groups(periodo: str) -> dict[int, str]:
    """IDs de bancos desde grupo99 (oficiales) + grupo997 (privados)."""
    y, m = period_to_ym(periodo)
    base = month_url(y, m)
    found: dict[int, str] = {}
    for gf in GROUP_FILES:
        try:
            data = http_bytes(urljoin(base, gf))
        except Exception as e:
            log.warning("grupo %s no disponible: %s", gf, e)
            continue
        book = xlrd.open_workbook(file_contents=data)
        sh = book.sheet_by_name("Situación") if "Situación" in book.sheet_names() else book.sheet_by_index(0)
        # Buscar fila de encabezados con patrones "113 Itaú" / "1 BROU"
        # (evitar celdas de plan de cuentas tipo "1 - ACTIVOS").
        for r in range(min(15, sh.nrows)):
            for c in range(sh.ncols):
                cell = str(sh.cell_value(r, c) or "").strip()
                m_id = re.match(r"^(\d+)\s+(.+)$", cell)
                if not m_id:
                    continue
                iid = int(m_id.group(1))
                name = m_id.group(2).strip()
                if not name or name.startswith("-") or name.startswith("–"):
                    continue
                if re.match(r"^[-–]\s*", name):
                    continue
                # Preferir el primer match “limpio” por ID
                if iid not in found:
                    found[iid] = name
        # También listar institucion links no aplica aquí; IDs ya en headers
    if not found:
        # Fallback mínimo si fallan los grupos
        found = {1: "BROU", 91: "BHU", 113: "Itaú", 128: "Scotiabank", 137: "Santander", 153: "BBVA"}
        log.warning("usando allowlist fallback de bancos")
    log.info("Bancos en grupos: %d → %s", len(found), sorted(found))
    return found


def list_institution_ids_in_index(periodo: str) -> set[int]:
    y, m = period_to_ym(periodo)
    html = http_text(urljoin(month_url(y, m), "indice.htm"))
    return {int(x) for x in re.findall(r"institucion(\d+)\.xls", html, flags=re.I)}


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


def wipe_uy(conn):
    cur = conn.cursor()
    for t in ("datos_financieros", "instituciones", "plan_cuentas", "carga_log"):
        cur.execute(f"DELETE FROM {t} WHERE country=%s", (COUNTRY,))
    conn.commit()
    log.info("Uruguay borrado (solo country='UY').")


def get_loaded_periods(conn) -> set[str]:
    cur = conn.cursor()
    cur.execute(
        "SELECT periodo FROM carga_log WHERE country=%s AND estado IN ('ok','alerta_esquema')",
        (COUNTRY,),
    )
    return {r[0] for r in cur.fetchall()}


def load_month(conn, periodo: str) -> None:
    from schema_guard import detect_schema_changes, get_known_accounts, record_schema_result

    y, m = period_to_ym(periodo)
    base = month_url(y, m)
    banks = {k: v for k, v in bank_ids_from_groups(periodo).items() if k not in AGGREGATE_IDS}
    in_index = list_institution_ids_in_index(periodo) - AGGREGATE_IDS
    targets = sorted(set(banks) & in_index) or sorted(banks)
    log.info("dt=%s cargando %d bancos: %s", periodo, len(targets), targets)

    known = get_known_accounts(conn, COUNTRY)
    all_rows = []
    inst_rows = []
    plan: dict[str, str] = {}

    for iid in targets:
        url = urljoin(base, f"institucion{iid}.xls")
        try:
            data = http_bytes(url)
        except Exception as e:
            log.warning("skip institucion%d: %s", iid, e)
            continue
        nombre, rows, plan_i = parse_institution_xls(data, iid, periodo)
        # Preferir nombre del Excel; fallback al del grupo
        if not nombre or nombre.startswith("Institución"):
            nombre = banks.get(iid, nombre)
        if iid in RAZON_SOCIAL_OVERRIDES:
            nombre = RAZON_SOCIAL_OVERRIDES[iid]
        inst_rows.append((COUNTRY, iid, nombre))
        all_rows.extend(rows)
        plan.update(plan_i)

    if not all_rows:
        raise RuntimeError(f"Sin filas de datos para {periodo}")

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
    ap = argparse.ArgumentParser(description="ETL Boletín SSF Uruguay → CockroachDB")
    ap.add_argument("--wipe", action="store_true")
    ap.add_argument("--month", help="AAAAMM puntual")
    ap.add_argument("--all", action="store_true", help="Recargar todo el rango (no solo faltantes)")
    ap.add_argument("--from", dest="from_dt", default=MIN_PERIOD)
    ap.add_argument("--to", dest="to_dt", default=None)
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument(
        "--skip-discover",
        action="store_true",
        help="No sondear índices: usa rango calendario (más rápido; fallará en meses sin boletín)",
    )
    args = ap.parse_args(list(argv) if argv is not None else None)

    if args.month:
        periods = [args.month]
    elif args.all or args.to_dt or (args.from_dt and args.from_dt != MIN_PERIOD):
        # Rango explícito / backfill: sondear índices en el intervalo
        periods = (
            iter_periods(args.from_dt, args.to_dt)
            if args.skip_discover and args.to_dt
            else discover_available_periods(args.from_dt, args.to_dt)
        )
    else:
        # Cron / default: solo meses recientes con índice
        periods = [p for p in recent_candidate_periods(10) if index_exists(p)]

    if args.from_dt:
        periods = [p for p in periods if p >= args.from_dt]
    if args.to_dt:
        periods = [p for p in periods if p <= args.to_dt]

    if args.dry_run:
        print(f"Meses objetivo: {len(periods)}")
        for i, p in enumerate(periods):
            y, m = period_to_ym(p)
            print(f"  {p}  {month_url(y, m)}indice.htm")
        if periods:
            banks = {
                k: v for k, v in bank_ids_from_groups(periods[-1]).items() if k not in AGGREGATE_IDS
            }
            print(f"Bancos ({periods[-1]}): {sorted(banks.items())}")
        return 0

    conn = connect()
    try:
        if args.wipe:
            wipe_uy(conn)

        if not args.month and not args.all:
            loaded = get_loaded_periods(conn)
            periods = [p for p in periods if p not in loaded]
            if not periods:
                log.info("Uruguay al día. Nada nuevo.")
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
