#!/usr/bin/env python3
"""
colombia_loader.py — ETL CUIF Colombia (Portal datos.gov.co / Socrata) → CockroachDB.

Fuente JSON: mxk5-ce6w  · filtros establecimientos bancarios tipo_entidad=1, totales moneda=0.

Requiere:
  - Variables .env COCKROACH_URL
  - SQL migrations/001_country_multijurisdiction.sql aplicado

Uso típico:
  python colombia_loader.py --historical       # 2022..año calendario actual (bloque por año)
  python colombia_loader.py --incremental      # sólo períodos YYYYMM aún no en carga_log (CO)
  python colombia_loader.py --institutions-plan  # solo instituciones + plan de cuentas

Programación: .github/workflows/colombia-cuif-monthly.yml (día 5)

BTG Colombia: codigo_entidad 66 · BANCO BTG PACTUAL COLOMBIA S.A.
"""

from __future__ import annotations

import argparse
import json
import logging
import os
import sys
from collections import defaultdict
from datetime import date, datetime
from pathlib import Path
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode
from urllib.request import Request, urlopen

from dotenv import load_dotenv
import psycopg2
import psycopg2.extras

load_dotenv(Path(__file__).parent / ".env")

COCKROACH_URL = os.environ.get("COCKROACH_URL", "")
SOCRATA_BASE = "https://www.datos.gov.co/resource/mxk5-ce6w.json"

COUNTRY = "CO"
BATCH_ROWS = 500
BASE_SOQL_WHERE = "tipo_entidad='1' AND moneda='0'"

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
)
log = logging.getLogger(__name__)


def conn_get():
    return psycopg2.connect(COCKROACH_URL)


def socrata_get(params: dict[str, str]) -> list[dict[str, Any]]:
    """GET Socrata; params include $limit, $offset, $where, $select, etc."""
    q = urlencode(params)
    url = f"{SOCRATA_BASE}?{q}"
    req = Request(url, headers={"User-Agent": "LatamBanksColombiaLoader/1.0"})
    try:
        with urlopen(req, timeout=180) as r:
            raw = r.read().decode()
    except HTTPError as e:
        log.error("Socrata HTTP %s — %s", e.code, e.read()[:500])
        raise
    except URLError as e:
        log.error("Socrata URL error: %s", e.reason)
        raise
    data = json.loads(raw)
    if not isinstance(data, list):
        raise RuntimeError(f"Socrata esperaba lista JSON, halló {type(data)}")
    return data


def infer_tipo(cuenta_raw: str) -> str:
    c = cuenta_raw.strip()
    if not c:
        return "c1"
    first = c[0]
    if first in ("1", "2", "3"):
        return "b1"
    if first in ("4", "5"):
        return "r1"
    return "c1"


def fecha_iso_to_periodo(fc: str) -> str:
    """2026-02-28T00:00:00.000 -> 202602"""
    fc = fc.replace("Z", "").split(".")[0].replace(" ", "T")
    if "T" in fc:
        dpart = fc.split("T")[0]
    else:
        dpart = fc[:10]
    d = datetime.strptime(dpart, "%Y-%m-%d")
    return f"{d.year:04d}{d.month:02d}"


def row_to_tuple(row: dict[str, Any]) -> tuple:
    cuenta = str(row.get("cuenta") or "").strip()
    tipo = infer_tipo(cuenta)
    ins = int(str(row["codigo_entidad"]).strip())
    periodo = fecha_iso_to_periodo(str(row["fecha_corte"]))
    val = float(row.get("valor") or 0)
    # Ignoramos signo_valor: algunos valores vienen ya negativos en el campo valor.
    monto = int(round(val))
    return (
        COUNTRY,
        periodo,
        tipo,
        ins,
        cuenta,
        0,
        0,
        0,
        0,
        monto,
    )


def upsert_institutions(conn):
    rows = socrata_get(
        {
            "tipo_entidad": "1",
            "$select": "codigo_entidad,nombre_entidad",
            "$group": "codigo_entidad,nombre_entidad",
            "$limit": "100",
            "$order": "codigo_entidad ASC",
        }
    )
    if not rows:
        log.warning("Sin instituciones desde Socrata")
        return
    tuples = [(COUNTRY, int(r["codigo_entidad"]), str(r["nombre_entidad"])) for r in rows]
    cur = conn.cursor()
    psycopg2.extras.execute_values(
        cur,
        "INSERT INTO instituciones (country, codigo, razon_social) VALUES %s "
        "ON CONFLICT (country, codigo) DO UPDATE SET "
        "razon_social = EXCLUDED.razon_social",
        tuples,
    )
    conn.commit()
    log.info("Instituciones CO upsert — %s bancos", len(tuples))


def latest_cut_date_from_api() -> str | None:
    """ISO fecha tipo 2026-02-28T00:00:00.000 del máximo fecha_corte en la API."""
    out = socrata_get({"$where": BASE_SOQL_WHERE, "$select": "max(fecha_corte) AS mf"})
    if not out or not isinstance(out[0], dict):
        return None
    return out[0].get("mf") or out[0].get("MF")


def upsert_plan_cuentas(conn):
    mf = latest_cut_date_from_api()
    if not mf:
        log.error("No se pudo leer max(fecha_corte) para plan CUIF.")
        return
    where = BASE_SOQL_WHERE + " AND fecha_corte = '" + mf + "' AND codigo_entidad = '7'"
    rows = socrata_get(
        {
            "$where": where,
            "$select": "cuenta,nombre_cuenta",
            "$order": "cuenta ASC",
            "$limit": "50000",
        }
    )
    if not rows:
        log.warning("Plan CUIF sin filas (fecha %s codigo_entidad 7 BBVA Colombia). Prueba más tarde.", mf)
        return
    seen: dict[str, str] = {}
    for r in rows:
        c = str(r.get("cuenta") or "").strip()
        nm = str(r.get("nombre_cuenta") or "").strip()
        if c:
            seen[c] = nm
    tuples = [(COUNTRY, c, d or c) for c, d in seen.items()]
    cur = conn.cursor()
    for i in range(0, len(tuples), BATCH_ROWS):
        psycopg2.extras.execute_values(
            cur,
            "INSERT INTO plan_cuentas (country, cuenta, descripcion) VALUES %s "
            "ON CONFLICT (country, cuenta) DO UPDATE SET "
            "descripcion = EXCLUDED.descripcion",
            tuples[i : i + BATCH_ROWS],
        )
    conn.commit()
    log.info("Plan cuenta CO upsert — %s cuentas (corte=%s BBVA código 7)", len(tuples), mf)


INSERT_DATOS = (
    "INSERT INTO datos_financieros "
    "(country, periodo, tipo, ins_cod, cuenta, monto_clp, monto_uf, monto_tc, monto_ext, monto_total) "
    "VALUES %s "
    "ON CONFLICT (country, periodo, tipo, ins_cod, cuenta) DO UPDATE SET "
    "monto_clp = EXCLUDED.monto_clp, monto_uf = EXCLUDED.monto_uf, "
    "monto_tc = EXCLUDED.monto_tc, monto_ext = EXCLUDED.monto_ext, "
    "monto_total = EXCLUDED.monto_total"
)


def ingest_tuple_batch(conn, tuples: list[tuple]) -> set[str]:
    if not tuples:
        return set()
    cur = conn.cursor()
    for i in range(0, len(tuples), BATCH_ROWS):
        psycopg2.extras.execute_values(cur, INSERT_DATOS, tuples[i : i + BATCH_ROWS])
    conn.commit()
    return {t[1] for t in tuples}


def bump_carga_log(conn, counts_by_periodo: dict[str, int]):
    cur = conn.cursor()
    for p, nrows in sorted(counts_by_periodo.items()):
        cur.execute(
            "INSERT INTO carga_log (country, periodo, archivos_procesados, estado) VALUES (%s, %s, %s, %s) "
            "ON CONFLICT (country, periodo) DO UPDATE SET "
            "archivos_procesados = EXCLUDED.archivos_procesados, "
            "estado = 'ok'",
            (COUNTRY, p, nrows, "ok"),
        )
    conn.commit()


def fetch_window_rows(where_extra: str) -> list[dict]:
    where = BASE_SOQL_WHERE + " AND " + where_extra
    collected: list[dict] = []
    offset = 0
    limit = 50000
    while True:
        log.info("  Pedido a datos.gov.co (hasta %s filas por bloque, offset %s)...", limit, offset)
        rows = socrata_get(
            {
                "$where": where,
                "$limit": str(limit),
                "$offset": str(offset),
                "$order": "fecha_corte ASC,codigo_entidad ASC,cuenta ASC",
            }
        )
        if not rows:
            break
        collected.extend(rows)
        log.info("  → obtenidas %s filas (offset %s)", len(rows), offset)
        if len(rows) < limit:
            break
        offset += limit
    return collected


def get_loaded(conn) -> set[str]:
    cur = conn.cursor()
    cur.execute(
        "SELECT periodo FROM carga_log WHERE country = %s AND estado = 'ok'",
        (COUNTRY,),
    )
    return {r[0] for r in cur.fetchall()}


def run_historical(conn, years: tuple[int, int] | None = None):
    start_year = years[0] if years else 2022
    end_year = years[1] if years else date.today().year
    upsert_institutions(conn)
    upsert_plan_cuentas(conn)
    for yr in range(start_year, end_year + 1):
        d0 = f"{yr}-01-01T00:00:00.000"
        d1 = f"{yr}-12-31T23:59:59.999"
        clause = f"fecha_corte >= '{d0}' AND fecha_corte <= '{d1}'"
        log.info("Año %s (%s)", yr, clause)
        rows = fetch_window_rows(clause)
        tuples = []
        skipped = []
        counts: defaultdict[str, int] = defaultdict(int)
        for row in rows:
            try:
                t = row_to_tuple(row)
            except Exception as e:
                skipped.append(str(e))
                continue
            tuples.append(t)
            counts[t[1]] += 1
        if skipped:
            log.warning("Filas omitidas (error parseo): %s", len(skipped))
        ingest_tuple_batch(conn, tuples)
        bump_carga_log(conn, dict(counts))
        log.info("Año %s — %s filas, %s períodos distintos", yr, len(tuples), len(counts))


def run_incremental(conn):
    mf = latest_cut_date_from_api()
    if not mf:
        log.error("No max fecha desde API.")
        return
    latest_api_p = fecha_iso_to_periodo(mf)
    loaded = get_loaded(conn)
    max_loaded = max(loaded, default="")

    upsert_institutions(conn)
    upsert_plan_cuentas(conn)

    def next_month(yyyymm: str) -> str:
        if len(yyyymm) != 6 or not yyyymm.isdigit():
            return ""
        y, m = int(yyyymm[:4]), int(yyyymm[4:])
        if m == 12:
            y, m = y + 1, 1
        else:
            m += 1
        return f"{y:04d}{m:02d}"

    if latest_api_p <= max_loaded:
        log.info(
            "Nada nuevo: último período cargado CO=%s, API equivalente último período inferido=%s",
            max_loaded,
            latest_api_p,
        )
        return

    start_month = next_month(max_loaded) if max_loaded else "202201"
    y0 = int(start_month[:4])
    m0 = int(start_month[4:])
    clause = (
        "fecha_corte >= '"
        + f"{y0:04d}-{m0:02d}-01T00:00:00.000"
        + "'"
    )

    rows = fetch_window_rows(clause)
    tuples = []
    counts: defaultdict[str, int] = defaultdict(int)
    for row in rows:
        t = row_to_tuple(row)
        tuples.append(t)
        counts[t[1]] += 1
    ingest_tuple_batch(conn, tuples)
    new_counts = {p: c for p, c in counts.items() if (not max_loaded or p > max_loaded)}
    bump_carga_log(conn, new_counts)
    log.info(
        "Incremental CO — filas %s, períodos tocados %s, nuevos en carga_log %s",
        len(tuples),
        sorted(counts.keys()),
        sorted(new_counts.keys()),
    )


def main():
    parser = argparse.ArgumentParser(description="Carga CUIF Colombia (Socrata) → datos_financieros country=CO")
    parser.add_argument("--historical", action="store_true", help="Bloques por año 2022..hoy")
    parser.add_argument("--incremental", action="store_true", help="Meses después del último carga_log CO")
    parser.add_argument(
        "--institutions-plan",
        action="store_true",
        help="Solo poblar instituciones + plan de cuentas",
    )
    parser.add_argument("--year", type=int, help="Con --historical: solo ese año civil")
    args = parser.parse_args()

    if args.year and not args.historical:
        parser.error("--historical es obligatorio para usar --year")

    modes = sum([bool(args.historical), bool(args.incremental), bool(args.institutions_plan)])
    if modes != 1:
        parser.error("Elige uno: --historical | --incremental | --institutions-plan")

    conn = conn_get()

    try:
        if args.institutions_plan:
            upsert_institutions(conn)
            upsert_plan_cuentas(conn)
        elif args.incremental:
            run_incremental(conn)
        elif args.historical:
            if args.year:
                run_historical(conn, years=(args.year, args.year))
            else:
                run_historical(conn)
    finally:
        conn.close()


if __name__ == "__main__":
    main()
