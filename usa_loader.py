#!/usr/bin/env python3
"""
usa_loader.py — ETL FDIC BankFind financials → CockroachDB
LatamBanks — country='US'

Fuente (API pública, sin API key):
  https://banks.data.fdic.gov/api/financials

Universo: top N bancos FDIC-insured por EQTOT (default 300) en cada trimestre,
más CERT fijados en ALWAYS_INCLUDE_CERTS (franquicias LatAm bajo el piso top-N).
Valores FDIC en miles de USD → monto_total en dólares enteros (×1000).
Ratios de calidad (NCLNLSR/LNRESNCR/LNATRESR) → tipo='q1', percent×100.

Modos:
  (sin flags)     Incremental: trimestres recientes aún no en carga_log
  --quarter AAAAMM  Carga un trimestre (mes = 03/06/09/12)
  --all / --from / --to
  --top N         Ranking por equity (default 300)
  --dry-run
  --wipe
"""
from __future__ import annotations

import argparse
import json
import logging
import os
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path
from typing import Iterable

from dotenv import load_dotenv

load_dotenv(Path(__file__).parent / ".env")

COUNTRY = "US"
BATCH = 500
API = "https://banks.data.fdic.gov/api/financials"
SCALE = 1000  # miles USD → USD
DEFAULT_TOP = 300
MIN_PERIOD = "201503"  # trimestres razonables en API

# Siempre incluir aunque queden fuera del top-N por equity.
# 35154 = BTG Pactual Bank, N.A. (antes M.Y. Safra Bank, FSB; rename ~2025-12).
ALWAYS_INCLUDE_CERTS = (35154,)
DISPLAY_NAME_OVERRIDES = {
    35154: "BTG Pactual Bank, N.A.",
}

# Campos Call Report / BankFind usados como cuentas canónicas
FIELDS = [
    "CERT",
    "NAME",
    "REPDTE",
    "ASSET",
    "EQTOT",
    "LIAB",
    "DEP",
    "TS",
    "LNLS",
    "LNLSNET",
    "LNATRES",
    "NCLNLS",
    "NCLNLSR",
    "LNRESNCR",
    "LNATRESR",
    "P3ASSET",
    "P9ASSET",
    "LNRE",
    "LNCI",
    "LNCON",
    "LNCRCD",
    "LNAUTO",
    "LNAG",
    "LNDEP",
    "LNMUNI",
    "LNFG",
    "NTLNLSQ",
    "ELNATR",
    "CHBAL",
    "SC",
    "NETINC",
    "INTINC",
    "EINTEXP",
    "NONII",
    "NONIX",
    "ROA",
    "ROE",
]

# Cuentas que van a r1 (PyG / quarterly credit flows)
R1_FIELDS = frozenset({
    "NETINC", "INTINC", "EINTEXP", "NONII", "NONIX",
    "NTLNLSQ",  # net charge-offs, quarter
    "ELNATR",   # provision expense
})
# Profitability ratios (no ×1000; ×10000 for 4dp in bigint) — stay in b1
RATIO_FIELDS = frozenset({"ROA", "ROE"})
# Asset-quality published % → tipo='q1', stored as percent×100 (UY A4 convention)
Q1_RATIO_FIELDS = frozenset({"NCLNLSR", "LNRESNCR", "LNATRESR"})

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
log = logging.getLogger("usa_loader")


def period_to_repdte(periodo: str) -> str:
    """AAAAMM (mes de cierre) → REPDTE YYYYMMDD."""
    y, m = int(periodo[:4]), int(periodo[4:6])
    if m not in (3, 6, 9, 12):
        raise ValueError(f"US es trimestral: mes debe ser 03/06/09/12, got {periodo}")
    last = {3: 31, 6: 30, 9: 30, 12: 31}[m]
    return f"{y}{m:02d}{last:02d}"


def repdte_to_period(repdte: str) -> str:
    return str(repdte)[:6]


def iter_quarters(start: str, end: str) -> list[str]:
    y, m = int(start[:4]), int(start[4:6])
    # normalizar al trimestre
    m = {1: 3, 2: 3, 3: 3, 4: 6, 5: 6, 6: 6, 7: 9, 8: 9, 9: 9, 10: 12, 11: 12, 12: 12}[m]
    ye, me = int(end[:4]), int(end[4:6])
    me = {1: 3, 2: 3, 3: 3, 4: 6, 5: 6, 6: 6, 7: 9, 8: 9, 9: 9, 10: 12, 11: 12, 12: 12}[me]
    out = []
    while (y, m) <= (ye, me):
        out.append(f"{y}{m:02d}")
        m += 3
        if m > 12:
            m = 3
            y += 1
    return out


def http_json(params: dict, retries: int = 3, backoff: float = 3.0) -> dict:
    q = urllib.parse.urlencode(params)
    url = f"{API}?{q}"
    last = None
    for attempt in range(1, retries + 1):
        try:
            req = urllib.request.Request(
                url,
                headers={"User-Agent": "LatamBanksUS/1.0", "Accept": "application/json"},
            )
            with urllib.request.urlopen(req, timeout=120) as r:
                return json.loads(r.read().decode())
        except (urllib.error.HTTPError, urllib.error.URLError, TimeoutError) as e:
            last = e
            log.warning("intento %d/%d fallo: %s", attempt, retries, e)
            if attempt < retries:
                time.sleep(backoff * attempt)
    raise last


def discover_quarters_from_anchor(cert: int = 628, n: int = 40) -> list[str]:
    """Lista de períodos AAAAMM disponibles vía un banco ancla (JPM)."""
    data = http_json(
        {
            "filters": f"CERT:{cert}",
            "fields": "REPDTE",
            "sort_by": "REPDTE",
            "sort_order": "DESC",
            "limit": str(n),
            "format": "json",
        }
    )
    periods = []
    for row in data.get("data") or []:
        d = row.get("data") or row
        if d.get("REPDTE"):
            periods.append(repdte_to_period(str(d["REPDTE"])))
    periods = sorted(set(periods))
    log.info("Catálogo US (vía CERT %s): %d trimestres (%s .. %s)", cert, len(periods), periods[0] if periods else "—", periods[-1] if periods else "—")
    return periods


def fetch_cert_for_quarter(periodo: str, cert: int) -> dict | None:
    """Trae un CERT puntual para el trimestre (pin fuera del top-N)."""
    rep = period_to_repdte(periodo)
    data = http_json(
        {
            "filters": f"CERT:{cert} AND REPDTE:{rep}",
            "fields": ",".join(FIELDS),
            "limit": "1",
            "format": "json",
        }
    )
    for item in data.get("data") or []:
        d = item.get("data") or item
        if d.get("CERT") is not None:
            return d
    return None


def fetch_top_for_quarter(periodo: str, top: int) -> list[dict]:
    rep = period_to_repdte(periodo)
    data = http_json(
        {
            "filters": f"REPDTE:{rep}",
            "fields": ",".join(FIELDS),
            "sort_by": "EQTOT",
            "sort_order": "DESC",
            "limit": str(top),
            "format": "json",
        }
    )
    rows = []
    for item in data.get("data") or []:
        d = item.get("data") or item
        if d.get("CERT") is None:
            continue
        rows.append(d)
    have = {int(d["CERT"]) for d in rows}
    pinned = 0
    for cert in ALWAYS_INCLUDE_CERTS:
        if cert in have:
            continue
        extra = fetch_cert_for_quarter(periodo, cert)
        if extra:
            rows.append(extra)
            have.add(cert)
            pinned += 1
        else:
            log.warning("dt=%s pin CERT %s sin datos FDIC", periodo, cert)
    log.info(
        "dt=%s FDIC: %d bancos (pedido top %d, +%d pinned)",
        periodo,
        len(rows),
        top,
        pinned,
    )
    return rows


def rows_to_db(periodo: str, banks: list[dict]):
    """Convierte filas FDIC → instituciones + datos_financieros + plan."""
    inst = []
    datos = []
    plan = {
        "ASSET": "Total assets",
        "EQTOT": "Total equity capital",
        "LIAB": "Total liabilities",
        "DEP": "Total deposits",
        "TS": "Time deposits",
        "LNLS": "Total loans and leases (gross)",
        "LNLSNET": "Net loans and leases",
        "LNATRES": "Allowance for credit losses",
        "NCLNLS": "Noncurrent loans and leases",
        "NCLNLSR": "Noncurrent loans / loans (%)",
        "LNRESNCR": "Allowance / noncurrent loans (%)",
        "LNATRESR": "Allowance / loans (%)",
        "P3ASSET": "Assets 30–89 days past due",
        "P9ASSET": "Assets 90+ days past due still accruing",
        "LNRE": "Real estate loans",
        "LNCI": "Commercial and industrial loans",
        "LNCON": "Consumer loans",
        "LNCRCD": "Credit card loans",
        "LNAUTO": "Auto loans",
        "LNAG": "Agricultural loans",
        "LNDEP": "Loans to depository institutions",
        "LNMUNI": "Municipal loans",
        "LNFG": "Loans to foreign governments",
        "NTLNLSQ": "Net charge-offs (quarter)",
        "ELNATR": "Provision expense",
        "CHBAL": "Cash and balances due",
        "SC": "Securities",
        "NETINC": "Net income (YTD)",
        "INTINC": "Total interest income (YTD)",
        "EINTEXP": "Total interest expense (YTD)",
        "NONII": "Total noninterest income (YTD)",
        "NONIX": "Total noninterest expense (YTD)",
        "ROA": "Return on assets (%)",
        "ROE": "Return on equity (%)",
    }
    for b in banks:
        cert = int(b["CERT"])
        name = DISPLAY_NAME_OVERRIDES.get(cert) or str(b.get("NAME") or f"CERT {cert}").strip()
        inst.append((COUNTRY, cert, name))
        for field, desc in plan.items():
            if field not in b or b[field] is None:
                continue
            raw = float(b[field])
            if field in RATIO_FIELDS:
                # ROA/ROE: 4 dp in bigint (16.64 → 166400)
                val = int(round(raw * 10000))
                tipo = "b1"
            elif field in Q1_RATIO_FIELDS:
                # percent×100 for aqRatioFromQ1 (0.8463% → 85; 200.09% → 20009)
                val = int(round(raw * 100))
                tipo = "q1"
            else:
                val = int(round(raw * SCALE))
                tipo = "r1" if field in R1_FIELDS else "b1"
            datos.append((COUNTRY, periodo, tipo, cert, field, 0, 0, 0, 0, val))
    return inst, datos, plan


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


def wipe_us(conn):
    cur = conn.cursor()
    for t in ("datos_financieros", "instituciones", "plan_cuentas", "carga_log"):
        cur.execute(f"DELETE FROM {t} WHERE country=%s", (COUNTRY,))
    conn.commit()
    log.info("US borrado (solo country='US').")


def get_loaded_periods(conn) -> set[str]:
    cur = conn.cursor()
    cur.execute(
        "SELECT periodo FROM carga_log WHERE country=%s AND estado IN ('ok','alerta_esquema')",
        (COUNTRY,),
    )
    return {r[0] for r in cur.fetchall()}


def load_quarter(conn, periodo: str, top: int) -> None:
    from schema_guard import detect_schema_changes, get_known_accounts, record_schema_result

    banks = fetch_top_for_quarter(periodo, top)
    if not banks:
        raise RuntimeError(f"Sin bancos FDIC para {periodo}")
    inst_rows, all_rows, plan = rows_to_db(periodo, banks)

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
        "dt=%s OK: %d bancos, %d filas (schema=%s)",
        periodo,
        len(inst_rows),
        len(all_rows),
        report.get("status"),
    )


def recent_candidate_quarters(n: int = 4) -> list[str]:
    from datetime import date

    today = date.today()
    # último trimestre cerrado (conservador: si estamos en abril, Q1 ya pudo reportar)
    y, m = today.year, today.month
    q_end_m = ((m - 1) // 3) * 3
    if q_end_m == 0:
        y -= 1
        q_end_m = 12
    out = []
    for _ in range(n):
        out.append(f"{y}{q_end_m:02d}")
        q_end_m -= 3
        if q_end_m <= 0:
            q_end_m = 12
            y -= 1
    return list(reversed(out))


def main(argv: Iterable[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description="ETL FDIC top-N → CockroachDB (US)")
    ap.add_argument("--wipe", action="store_true")
    ap.add_argument("--quarter", help="AAAAMM trimestral (03/06/09/12)")
    ap.add_argument("--all", action="store_true")
    ap.add_argument("--from", dest="from_dt", default=MIN_PERIOD)
    ap.add_argument("--to", dest="to_dt", default=None)
    ap.add_argument("--top", type=int, default=DEFAULT_TOP, help="Bancos por EQTOT (default 300)")
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args(list(argv) if argv is not None else None)

    top = max(1, min(args.top, 500))

    if args.quarter:
        periods = [args.quarter]
    elif args.all or args.to_dt or (args.from_dt and args.from_dt != MIN_PERIOD):
        catalog = discover_quarters_from_anchor()
        periods = [p for p in catalog if p >= args.from_dt and (not args.to_dt or p <= args.to_dt)]
        if not periods:
            periods = iter_quarters(args.from_dt, args.to_dt or catalog[-1] if catalog else args.from_dt)
    else:
        # incremental: últimos candidatos ∩ catálogo
        catalog = set(discover_quarters_from_anchor(n=8))
        periods = [p for p in recent_candidate_quarters(4) if p in catalog] or sorted(catalog)[-2:]

    if args.from_dt:
        periods = [p for p in periods if p >= args.from_dt]
    if args.to_dt:
        periods = [p for p in periods if p <= args.to_dt]

    if args.dry_run:
        print(f"Trimestres objetivo: {len(periods)} (top {top})")
        for p in periods:
            print(f"  {p}  REPDTE={period_to_repdte(p)}")
        if periods:
            banks = fetch_top_for_quarter(periods[-1], min(top, 5))
            print(f"Top sample ({periods[-1]}):")
            for b in banks:
                eq = int(round(float(b.get("EQTOT") or 0) * SCALE))
                print(f"  CERT={b['CERT']}  {b.get('NAME')}  equity=${eq:,}")
        return 0

    conn = connect()
    try:
        if args.wipe:
            wipe_us(conn)

        if not args.quarter and not args.all:
            loaded = get_loaded_periods(conn)
            periods = [p for p in periods if p not in loaded]
            if not periods:
                log.info("US al día. Nada nuevo.")
                return 0

        log.info("Cargando %d trimestre(s): %s", len(periods), periods[:8])
        for p in periods:
            load_quarter(conn, p, top)
        return 0
    finally:
        conn.close()


if __name__ == "__main__":
    raise SystemExit(main())
