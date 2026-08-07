#!/usr/bin/env python3
"""
Chile BCCh — Series de Datos Bancarios (colocaciones / depósitos / inversiones)

Fuente primaria (actual, mensuales):
  https://www.bcentral.cl/contenido/-/detalle/publicaciones/estadistica/
    serie-de-datos-bancarios-{mes}-de-{año}
  CSV zip en la sección «Recuadros y gráficos» (Imperva: requiere browser / Playwright).

Fuente legacy (si3, pack estático ~hasta 2020):
  https://si3.bcentral.cl/.../Series_datos_bancarios/xls/

Almacenamiento:
  tipo='x1'  → stocks en pesos (millones BCCh × 1e6)
  cuentas CL_BCCH_* (ver PLAN_LABELS)
  Sistema = ins_cod 999 («Total»)

Uso:
  python chile_bcch_loader.py --zip-path tests/fixtures/bcch_csv_sep2025_sample.zip
  python chile_bcch_loader.py --csv-dir /tmp/bcch_csv
  python chile_bcch_loader.py --download-latest   # Playwright → Imperva
  python chile_bcch_loader.py --from 202401 --to 202509 --zip-path …
"""

from __future__ import annotations

import argparse
import csv
import io
import logging
import os
import re
import zipfile
from datetime import date
from pathlib import Path

import psycopg2.extras
from dotenv import load_dotenv

from chile_basilea_loader import (
    NAME_ALIASES,
    SISTEMA_COD,
    _norm,
    build_name_index,
    resolve_ins_cod,
)
from cmf_loader import get_connection

load_dotenv(Path(__file__).parent / ".env")

log = logging.getLogger("chile_bcch")
logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")

COUNTRY = "CL"
MILLIONS_SCALE = 1_000_000
BATCH = 500

# cuadro → cuenta LatamBanks (millones de pesos CLP unless noted)
CUADRO_ACCOUNTS = {
    "1_01": "CL_BCCH_LOANS",
    "1_02": "CL_BCCH_LOANS_COMM",
    "1_03": "CL_BCCH_LOANS_CONS",
    "1_04": "CL_BCCH_LOANS_MTG",
    "2_01": "CL_BCCH_DEP_MN",
    "2_07": "CL_BCCH_DEP_ME",  # often millones USD — see unit handling
    "3_01": "CL_BCCH_INV_MN",
}

PLAN_LABELS = {
    "CL_BCCH_LOANS": "BCCh · Colocaciones totales",
    "CL_BCCH_LOANS_COMM": "BCCh · Colocaciones comerciales",
    "CL_BCCH_LOANS_CONS": "BCCh · Colocaciones de consumo",
    "CL_BCCH_LOANS_MTG": "BCCh · Colocaciones de vivienda",
    "CL_BCCH_DEP_MN": "BCCh · Depósitos y captaciones MN",
    "CL_BCCH_DEP_ME": "BCCh · Depósitos ME (millones USD → CLP vía macro)",
    "CL_BCCH_INV_MN": "BCCh · Inversiones MN",
}

MONTHS_ES = {
    1: "enero",
    2: "febrero",
    3: "marzo",
    4: "abril",
    5: "mayo",
    6: "junio",
    7: "julio",
    8: "agosto",
    9: "septiembre",
    10: "octubre",
    11: "noviembre",
    12: "diciembre",
}

PAGE_TMPL = (
    "https://www.bcentral.cl/contenido/-/detalle/publicaciones/estadistica/"
    "serie-de-datos-bancarios-{mes}-de-{anio}"
)


def fecha_to_periodo(fecha: str) -> str | None:
    """'2025m9' / '2025M09' → '202509'."""
    m = re.fullmatch(r"\s*(\d{4})\s*[mM]\s*(\d{1,2})\s*", str(fecha or ""))
    if not m:
        return None
    return f"{m.group(1)}{int(m.group(2)):02d}"


def _parse_num(v) -> float | None:
    if v is None or v == "":
        return None
    if isinstance(v, (int, float)):
        return float(v) if v == v else None  # NaN check
    s = str(v).strip().replace(",", "")
    if not s or s.upper() == "ND":
        return None
    try:
        return float(s)
    except ValueError:
        return None


def _unit_is_usd(unidad: str) -> bool:
    u = _norm(unidad)
    return "dolar" in u or "dollar" in u or "usd" in u


def _match_csv_member(names: list[str], *needles: str) -> str | None:
    for n in names:
        ln = n.lower()
        if any(nd in ln for nd in needles):
            return n
    return None


def parse_bcch_csv_text(
    text: str,
    name_index: dict[str, int],
    *,
    usd_clp: float | None = None,
) -> tuple[list[tuple], list[str]]:
    """
    Parse one BCCh long CSV.
    Returns (rows, unmatched) where rows are
    (periodo, tipo, ins_cod, cuenta, monto_total).
    """
    # utf-8-sig / latin-1 salvage
    if "\ufffd" in text[:2000]:
        try:
            text = text.encode("latin-1", errors="ignore").decode("utf-8")
        except Exception:
            pass

    reader = csv.DictReader(io.StringIO(text))
    if not reader.fieldnames:
        return [], []

    rows: list[tuple] = []
    unmatched: list[str] = []
    seen_unmatched: set[str] = set()

    for row in reader:
        cuadro = (row.get("cuadro") or "").strip()
        cuenta = CUADRO_ACCOUNTS.get(cuadro)
        if not cuenta:
            continue
        periodo = fecha_to_periodo(row.get("fecha") or "")
        if not periodo:
            continue
        val = _parse_num(row.get("valor"))
        if val is None:
            continue
        name = (row.get("bancos") or "").strip()
        if not name:
            continue

        n = _norm(name)
        if n == "total":
            cod = SISTEMA_COD
        else:
            cod = resolve_ins_cod(name, name_index)
            if cod is None:
                if name not in seen_unmatched:
                    unmatched.append(name)
                    seen_unmatched.add(name)
                continue

        unidad = row.get("unidad") or ""
        if cuenta == "CL_BCCH_DEP_ME" and _unit_is_usd(unidad):
            if not usd_clp or usd_clp <= 0:
                # Skip FX conversion rather than store misleading CLP millions
                continue
            monto = int(round(val * usd_clp * MILLIONS_SCALE))
        else:
            monto = int(round(val * MILLIONS_SCALE))

        rows.append((periodo, "x1", cod, cuenta, monto))

    return rows, unmatched


def parse_bcch_zip(
    zip_bytes: bytes,
    name_index: dict[str, int] | None = None,
    *,
    usd_clp: float | None = None,
) -> tuple[list[tuple], list[str]]:
    name_index = name_index or dict(NAME_ALIASES)
    zf = zipfile.ZipFile(io.BytesIO(zip_bytes))
    names = zf.namelist()
    parts = [
        ("coloc", ("coloc",)),
        ("dep", ("dep",)),
        ("inv", ("inv",)),
    ]
    all_rows: list[tuple] = []
    unmatched: list[str] = []
    for _label, needles in parts:
        member = _match_csv_member(names, *needles)
        if not member:
            log.warning("ZIP missing CSV for %s (members=%s)", needles, names)
            continue
        raw = zf.read(member)
        for enc in ("utf-8-sig", "utf-8", "latin-1", "cp1252"):
            try:
                text = raw.decode(enc)
                break
            except UnicodeDecodeError:
                text = None
        if text is None:
            text = raw.decode("latin-1", errors="replace")
        rows, unm = parse_bcch_csv_text(text, name_index, usd_clp=usd_clp)
        all_rows.extend(rows)
        for u in unm:
            if u not in unmatched:
                unmatched.append(u)
    return all_rows, unmatched


def parse_bcch_csv_dir(
    csv_dir: Path,
    name_index: dict[str, int] | None = None,
    *,
    usd_clp: float | None = None,
) -> tuple[list[tuple], list[str]]:
    name_index = name_index or dict(NAME_ALIASES)
    all_rows: list[tuple] = []
    unmatched: list[str] = []
    for path in sorted(csv_dir.glob("*.csv")):
        raw = path.read_bytes()
        for enc in ("utf-8-sig", "utf-8", "latin-1", "cp1252"):
            try:
                text = raw.decode(enc)
                break
            except UnicodeDecodeError:
                text = None
        if text is None:
            text = raw.decode("latin-1", errors="replace")
        rows, unm = parse_bcch_csv_text(text, name_index, usd_clp=usd_clp)
        all_rows.extend(rows)
        for u in unm:
            if u not in unmatched:
                unmatched.append(u)
    return all_rows, unmatched


def filter_period_rows(
    rows: list[tuple],
    from_p: str | None,
    to_p: str | None,
) -> list[tuple]:
    out = []
    for r in rows:
        per = r[0]
        if from_p and per < from_p:
            continue
        if to_p and per > to_p:
            continue
        out.append(r)
    return out


def upsert_plan(conn):
    cur = conn.cursor()
    rows = [(COUNTRY, cuenta, label) for cuenta, label in PLAN_LABELS.items()]
    psycopg2.extras.execute_values(
        cur,
        "INSERT INTO plan_cuentas (country, cuenta, descripcion) VALUES %s "
        "ON CONFLICT (country, cuenta) DO UPDATE SET descripcion = EXCLUDED.descripcion",
        rows,
    )
    conn.commit()


def wipe_bcch_periods(conn, periods: set[str]):
    if not periods:
        return 0
    cur = conn.cursor()
    cur.execute(
        "DELETE FROM datos_financieros WHERE country = %s AND cuenta LIKE 'CL_BCCH_%%' "
        "AND periodo = ANY(%s)",
        (COUNTRY, list(periods)),
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


def bcch_periods_loaded(conn) -> set[str]:
    cur = conn.cursor()
    cur.execute(
        "SELECT DISTINCT periodo FROM datos_financieros "
        "WHERE country = %s AND cuenta = 'CL_BCCH_LOANS'",
        (COUNTRY,),
    )
    return {r[0] for r in cur.fetchall()}


def fetch_usd_clp_for_period(conn, periodo: str) -> float | None:
    """Prefer CL_MACRO_USD (×100) for period; else None."""
    cur = conn.cursor()
    cur.execute(
        "SELECT monto_total FROM datos_financieros "
        "WHERE country = %s AND periodo = %s AND cuenta = 'CL_MACRO_USD' AND ins_cod = %s",
        (COUNTRY, periodo, SISTEMA_COD),
    )
    row = cur.fetchone()
    if row and row[0]:
        return float(row[0]) / 100.0
    # nearest prior
    cur.execute(
        "SELECT monto_total FROM datos_financieros "
        "WHERE country = %s AND cuenta = 'CL_MACRO_USD' AND ins_cod = %s AND periodo <= %s "
        "ORDER BY periodo DESC LIMIT 1",
        (COUNTRY, SISTEMA_COD, periodo),
    )
    row = cur.fetchone()
    if row and row[0]:
        return float(row[0]) / 100.0
    return None


def publication_url_for_lagged_month(ref: date | None = None) -> tuple[str, str]:
    """
    BCCh publishes ~day 23 with lag of 2 months + 23 days.
    On day ≥23 of month M, latest pack is typically for month M-3;
    before day 23, M-4. Return (YYYYMM, page_url).
    """
    ref = ref or date.today()
    y, m = ref.year, ref.month
    lag = 3 if ref.day >= 23 else 4
    m -= lag
    while m <= 0:
        m += 12
        y -= 1
    periodo = f"{y}{m:02d}"
    url = PAGE_TMPL.format(mes=MONTHS_ES[m], anio=y)
    return periodo, url


def download_latest_csv_zip_playwright(out_path: Path, page_url: str | None = None) -> Path:
    """Download CSV zip via Playwright (Imperva). Raises on failure."""
    try:
        from playwright.sync_api import sync_playwright
    except ImportError as e:
        raise RuntimeError(
            "Playwright required for --download-latest. "
            "pip install playwright && playwright install chromium"
        ) from e

    if not page_url:
        _, page_url = publication_url_for_lagged_month()

    out_path.parent.mkdir(parents=True, exist_ok=True)
    log.info("Playwright download from %s", page_url)

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        context = browser.new_context(accept_downloads=True)
        page = context.new_page()
        page.goto(page_url, wait_until="domcontentloaded", timeout=120_000)
        page.wait_for_timeout(3000)
        # Expand section if collapsed
        for label in ("Recuadros y gráficos", "Recuadros", "gráficos"):
            loc = page.get_by_text(label, exact=False)
            if loc.count():
                try:
                    loc.first.click(timeout=3000)
                    page.wait_for_timeout(1000)
                except Exception:
                    pass
        # Click CSV download link/button
        csv_btn = page.locator("a, button, span").filter(has_text=re.compile(r"CSV", re.I))
        if csv_btn.count() == 0:
            browser.close()
            raise RuntimeError(f"No CSV control found on {page_url}")
        with page.expect_download(timeout=120_000) as dl_info:
            csv_btn.first.click()
        download = dl_info.value
        download.save_as(str(out_path))
        browser.close()

    if not out_path.exists() or out_path.stat().st_size < 1000:
        raise RuntimeError(f"Download failed or too small: {out_path}")
    log.info("Saved %s (%d bytes)", out_path, out_path.stat().st_size)
    return out_path


def load_rows(
    rows: list[tuple],
    *,
    force: bool = False,
    dry_run: bool = False,
) -> list[str]:
    if not rows:
        log.warning("No BCCh rows to load")
        return []
    periods = sorted({r[0] for r in rows})
    conn = get_connection()
    try:
        have = bcch_periods_loaded(conn)
        if not force:
            rows = [r for r in rows if r[0] not in have]
            periods = sorted({r[0] for r in rows})
        if not rows:
            log.info("All target BCCh periods already loaded")
            return []
        banks = len({r[2] for r in rows})
        log.info(
            "BCCh load periods=%s…%s (%d) · banks≈%d · rows=%d%s",
            periods[0],
            periods[-1],
            len(periods),
            banks,
            len(rows),
            " [dry-run]" if dry_run else "",
        )
        if dry_run:
            return periods
        upsert_plan(conn)
        if force:
            n = wipe_bcch_periods(conn, set(periods))
            log.info("Wiped %d prior CL_BCCH_* rows", n)
        insert_rows(conn, rows)
        return periods
    finally:
        conn.close()


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description="Chile BCCh Series bancarias loader")
    ap.add_argument("--zip-path", type=Path, help="Local CSV zip pack")
    ap.add_argument("--csv-dir", type=Path, help="Directory with Colocaciones/Depósitos/Inversiones CSV")
    ap.add_argument("--download-latest", action="store_true", help="Playwright download latest pack")
    ap.add_argument("--page-url", default="", help="Override publication page URL")
    ap.add_argument("--from", dest="from_p", default="", help="YYYYMM inclusive")
    ap.add_argument("--to", dest="to_p", default="", help="YYYYMM inclusive")
    ap.add_argument("--usd-clp", type=float, default=0.0, help="FX for DE_ME USD→CLP")
    ap.add_argument("--force", action="store_true")
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args(argv)

    zip_bytes = None
    csv_dir = args.csv_dir

    if args.download_latest:
        out = Path("/tmp/bcch_latest.csv.zip")
        download_latest_csv_zip_playwright(out, args.page_url or None)
        zip_bytes = out.read_bytes()
    elif args.zip_path:
        zip_bytes = args.zip_path.read_bytes()
    elif not csv_dir:
        ap.error("Provide --zip-path, --csv-dir, or --download-latest")

    conn = get_connection()
    try:
        name_index = build_name_index(conn)
        usd = args.usd_clp or None
        if zip_bytes:
            # Prefer macro USD for latest period if not provided
            if not usd:
                # peek periods later; use latest macro
                cur = conn.cursor()
                cur.execute(
                    "SELECT monto_total FROM datos_financieros "
                    "WHERE country=%s AND cuenta='CL_MACRO_USD' AND ins_cod=%s "
                    "ORDER BY periodo DESC LIMIT 1",
                    (COUNTRY, SISTEMA_COD),
                )
                row = cur.fetchone()
                if row and row[0]:
                    usd = float(row[0]) / 100.0
                    log.info("Using CL_MACRO_USD ≈ %.2f for DEP_ME", usd)
            rows, unmatched = parse_bcch_zip(zip_bytes, name_index, usd_clp=usd)
        else:
            rows, unmatched = parse_bcch_csv_dir(csv_dir, name_index, usd_clp=usd)
    finally:
        conn.close()

    if unmatched:
        log.warning("Unmatched banks (%d): %s", len(unmatched), unmatched[:12])

    rows = filter_period_rows(rows, args.from_p or None, args.to_p or None)
    loaded = load_rows(rows, force=args.force, dry_run=args.dry_run)
    log.info("Done · periods loaded: %s", loaded or "(none)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
