#!/usr/bin/env python3
"""
Chile macros — UF / USD / IPC / TPM / UTM / TMC → CockroachDB.

Fuentes (cascada):
  1. API CMF Bancos v3 (si CMF_API_KEY) — uf, dolar, ipc, tmc
  2. mindicador.cl (sin key) — uf, dolar, ipc, tpm, utm

Almacenamiento (ins_cod=999, tipo='q1'):
  CL_MACRO_UF   → pesos ×100 (2 decimales)
  CL_MACRO_USD  → pesos ×100
  CL_MACRO_UTM  → pesos enteros
  CL_MACRO_IPC  → variación mensual % ×100
  CL_MACRO_TPM  → % ×100
  CL_MACRO_TMC  → % ×100 (primer tipo publicado del mes, si hay API CMF)

Uso:
  python chile_macros_loader.py
  python chile_macros_loader.py --from 202401 --to 202608
  python chile_macros_loader.py --dry-run
"""

from __future__ import annotations

import argparse
import json
import logging
import os
import urllib.error
import urllib.request
from calendar import monthrange
from datetime import date, datetime
from pathlib import Path

import psycopg2.extras
from dotenv import load_dotenv

from chile_basilea_loader import SISTEMA_COD
from cmf_loader import get_connection

load_dotenv(Path(__file__).parent / ".env")

log = logging.getLogger("chile_macros")
logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")

COUNTRY = "CL"
BATCH = 200
MINDICADOR = "https://mindicador.cl/api"
CMF_API = "https://api.cmfchile.cl/api-sbifv3/recursos_api"

PLAN_LABELS = {
    "CL_MACRO_UF": "UF (pesos ×100)",
    "CL_MACRO_USD": "Dólar observado (pesos ×100)",
    "CL_MACRO_UTM": "UTM (pesos)",
    "CL_MACRO_IPC": "IPC variación mensual (% ×100)",
    "CL_MACRO_TPM": "TPM (% ×100)",
    "CL_MACRO_TMC": "TMC (% ×100)",
}


def _http_json(url: str, timeout: int = 30) -> dict:
    req = urllib.request.Request(url, headers={"User-Agent": "LatamBanks/1.0"})
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return json.loads(resp.read().decode("utf-8"))


def _ym_range(from_p: str, to_p: str) -> list[str]:
    y, m = int(from_p[:4]), int(from_p[4:6])
    ey, em = int(to_p[:4]), int(to_p[4:6])
    out = []
    while (y, m) <= (ey, em):
        out.append(f"{y}{m:02d}")
        m += 1
        if m > 12:
            m = 1
            y += 1
    return out


def _parse_mindicador_date(s: str) -> date | None:
    try:
        return datetime.fromisoformat(s.replace("Z", "+00:00")).date()
    except Exception:
        try:
            return datetime.strptime(s[:10], "%Y-%m-%d").date()
        except Exception:
            return None


def fetch_mindicador_series(code: str, year: int | None = None) -> list[tuple[date, float]]:
    """Return [(date, value), ...] newest-first from mindicador."""
    url = f"{MINDICADOR}/{code}" + (f"/{year}" if year else "")
    data = _http_json(url)
    serie = data.get("serie") or []
    out = []
    for row in serie:
        d = _parse_mindicador_date(str(row.get("fecha") or ""))
        try:
            v = float(row["valor"])
        except (KeyError, TypeError, ValueError):
            continue
        if d is not None:
            out.append((d, v))
    return out


def fetch_cmf_resource(resource: str, year: int, month: int | None = None) -> list[dict]:
    key = os.environ.get("CMF_API_KEY", "").strip()
    if not key:
        return []
    path = f"{CMF_API}/{resource}/{year}"
    if month:
        path += f"/{month:02d}"
    url = f"{path}?apikey={key}&formato=json"
    try:
        data = _http_json(url)
    except urllib.error.HTTPError as e:
        log.warning("CMF API %s %s-%s HTTP %s", resource, year, month, e.code)
        return []
    except Exception as e:
        log.warning("CMF API %s failed: %s", resource, e)
        return []
    # Responses vary: {UFs: [...]}, {Dolares: [...]}, {IPCs: [...]}, {TMCs: [...]}
    for k, v in data.items():
        if isinstance(v, list):
            return v
    return []


def _cmf_parse_date(row: dict) -> date | None:
    for key in ("Fecha", "fecha", "FechaTMC"):
        if key in row and row[key]:
            s = str(row[key])
            for fmt in ("%Y-%m-%d", "%d-%m-%Y", "%Y/%m/%d"):
                try:
                    return datetime.strptime(s[:10], fmt).date()
                except ValueError:
                    continue
    return None


def _cmf_parse_value(row: dict) -> float | None:
    for key in ("Valor", "valor", "ValorTMC", "Tasa"):
        if key in row and row[key] is not None:
            s = str(row[key]).replace(".", "").replace(",", ".") if False else str(row[key])
            # CMF often uses Chilean thousands: "39.123,45" — try both
            try:
                return float(s.replace(",", "."))
            except ValueError:
                try:
                    return float(s.replace(".", "").replace(",", "."))
                except ValueError:
                    return None
    return None


def month_end_value(series: list[tuple[date, float]], year: int, month: int) -> float | None:
    """Last observation on or before month-end."""
    last_day = monthrange(year, month)[1]
    cutoff = date(year, month, last_day)
    start = date(year, month, 1)
    candidates = [(d, v) for d, v in series if start <= d <= cutoff]
    if not candidates:
        # allow prior days in month from daily series fetched as year
        candidates = [(d, v) for d, v in series if d.year == year and d.month == month and d <= cutoff]
    if not candidates:
        return None
    candidates.sort(key=lambda x: x[0])
    return candidates[-1][1]


def build_macro_rows(from_p: str, to_p: str) -> list[tuple]:
    """
    rows: (periodo, tipo, ins_cod, cuenta, monto_total)
    """
    periods = _ym_range(from_p, to_p)
    years = sorted({int(p[:4]) for p in periods})

    # mindicador year endpoints for daily series
    uf_by_year: dict[int, list] = {}
    usd_by_year: dict[int, list] = {}
    for y in years:
        try:
            uf_by_year[y] = fetch_mindicador_series("uf", y)
        except Exception as e:
            log.warning("mindicador uf/%s: %s", y, e)
            uf_by_year[y] = []
        try:
            usd_by_year[y] = fetch_mindicador_series("dolar", y)
        except Exception as e:
            log.warning("mindicador dolar/%s: %s", y, e)
            usd_by_year[y] = []

    # monthly indicators (full history endpoints are small)
    ipc_series: list[tuple[date, float]] = []
    tpm_series: list[tuple[date, float]] = []
    utm_series: list[tuple[date, float]] = []
    try:
        ipc_series = fetch_mindicador_series("ipc")
    except Exception as e:
        log.warning("mindicador ipc: %s", e)
    try:
        tpm_series = fetch_mindicador_series("tpm")
    except Exception as e:
        log.warning("mindicador tpm: %s", e)
    try:
        utm_series = fetch_mindicador_series("utm")
    except Exception as e:
        log.warning("mindicador utm: %s", e)

    use_cmf = bool(os.environ.get("CMF_API_KEY", "").strip())
    if use_cmf:
        log.info("CMF_API_KEY set — will overlay UF/USD/IPC/TMC from CMF API")

    rows: list[tuple] = []
    for per in periods:
        y, m = int(per[:4]), int(per[4:6])

        uf = month_end_value(uf_by_year.get(y) or [], y, m)
        usd = month_end_value(usd_by_year.get(y) or [], y, m)
        ipc = month_end_value(ipc_series, y, m)
        tpm = month_end_value(tpm_series, y, m)
        utm = month_end_value(utm_series, y, m)
        tmc = None

        if use_cmf:
            for resource, setter in (
                ("uf", "uf"),
                ("dolar", "usd"),
                ("ipc", "ipc"),
                ("tmc", "tmc"),
            ):
                items = fetch_cmf_resource(resource, y, m)
                vals = []
                for item in items:
                    d = _cmf_parse_date(item)
                    v = _cmf_parse_value(item)
                    if d and v is not None and d.year == y and d.month == m:
                        vals.append((d, v))
                if vals:
                    vals.sort(key=lambda x: x[0])
                    last = vals[-1][1]
                    if setter == "uf":
                        uf = last
                    elif setter == "usd":
                        usd = last
                    elif setter == "ipc":
                        ipc = last
                    elif setter == "tmc":
                        tmc = last

        def add(cuenta: str, raw: float | None, scale: float):
            if raw is None:
                return
            rows.append((per, "q1", SISTEMA_COD, cuenta, int(round(raw * scale))))

        add("CL_MACRO_UF", uf, 100)
        add("CL_MACRO_USD", usd, 100)
        add("CL_MACRO_UTM", utm, 1)
        add("CL_MACRO_IPC", ipc, 100)
        add("CL_MACRO_TPM", tpm, 100)
        add("CL_MACRO_TMC", tmc, 100)

    return rows


def upsert_plan(conn):
    cur = conn.cursor()
    psycopg2.extras.execute_values(
        cur,
        "INSERT INTO plan_cuentas (country, cuenta, descripcion) VALUES %s "
        "ON CONFLICT (country, cuenta) DO UPDATE SET descripcion = EXCLUDED.descripcion",
        [(COUNTRY, c, lab) for c, lab in PLAN_LABELS.items()],
    )
    conn.commit()


def wipe_macro_periods(conn, periods: list[str]):
    cur = conn.cursor()
    cur.execute(
        "DELETE FROM datos_financieros WHERE country = %s AND cuenta LIKE 'CL_MACRO_%%' "
        "AND periodo = ANY(%s)",
        (COUNTRY, periods),
    )
    conn.commit()
    return cur.rowcount


def insert_rows(conn, rows: list[tuple]):
    if not rows:
        return 0
    sql = (
        "INSERT INTO datos_financieros "
        "(country, periodo, tipo, ins_cod, cuenta, monto_clp, monto_uf, monto_tc, monto_ext, monto_total) "
        "VALUES %s "
        "ON CONFLICT (country, periodo, tipo, ins_cod, cuenta) DO UPDATE SET "
        "monto_total = EXCLUDED.monto_total"
    )
    tuples = [
        (COUNTRY, per, tipo, ins, cuenta, 0, 0, 0, 0, monto)
        for per, tipo, ins, cuenta, monto in rows
    ]
    cur = conn.cursor()
    for i in range(0, len(tuples), BATCH):
        psycopg2.extras.execute_values(cur, sql, tuples[i : i + BATCH])
    conn.commit()
    return len(tuples)


def default_from_to() -> tuple[str, str]:
    today = date.today()
    to_p = f"{today.year}{today.month:02d}"
    # ~24 months history by default
    y, m = today.year, today.month - 23
    while m <= 0:
        m += 12
        y -= 1
    return f"{y}{m:02d}", to_p


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description="Chile macro indicators loader")
    ap.add_argument("--from", dest="from_p", default="")
    ap.add_argument("--to", dest="to_p", default="")
    ap.add_argument("--force", action="store_true")
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args(argv)

    from_p, to_p = args.from_p, args.to_p
    if not from_p or not to_p:
        dfrom, dto = default_from_to()
        from_p = from_p or dfrom
        to_p = to_p or dto

    rows = build_macro_rows(from_p, to_p)
    by_acct = {}
    for r in rows:
        by_acct[r[3]] = by_acct.get(r[3], 0) + 1
    log.info(
        "Macros %s→%s · rows=%d · accounts=%s%s",
        from_p,
        to_p,
        len(rows),
        by_acct,
        " [dry-run]" if args.dry_run else "",
    )
    if args.dry_run:
        # show latest period snapshot
        latest = max((r[0] for r in rows), default=None)
        snap = {r[3]: r[4] for r in rows if r[0] == latest}
        log.info("Latest %s: %s", latest, snap)
        return 0

    conn = get_connection()
    try:
        upsert_plan(conn)
        periods = sorted({r[0] for r in rows})
        if args.force:
            wipe_macro_periods(conn, periods)
        insert_rows(conn, rows)
    finally:
        conn.close()
    log.info("Done")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
