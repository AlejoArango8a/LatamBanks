#!/usr/bin/env python3
"""
Chile Institutional Funding — Fondos mutuos holdings of bank DAP / bank bonds.

Sources (CMF):
  1. Cartera de Inversiones Nacionales (mensual)
     POST https://www.cmfchile.cl/institucional/estadisticas/ffm_download.php
       mm, aa, cartera=NACI, btnConsulta=GENERAR+ARCHIVO
     Circular 1333 columns (semicolon TXT):
       Run Fondo, FFM_6010211 (issuer RUT), FFM_6010400 (instrument),
       FFM_6011200 (market value), FFM_6011300 (currency of MV)

  2. Registro fondos ↔ AGF
     https://www.cmfchile.cl/institucional/estadisticas/fm.bpr_menu.php
     JS arrays: codfondos_{AGF_RUT}=new Array("0","RUN",...)

Instrument filter (default):
  DPC, DPL → DAP (depósitos a plazo)
  BB       → Bonos bancarios
  (BS subordinated excluded from core KPIs)

Units:
  $$  → miles de pesos → ×1_000
  UF  → miles de UF   → ×1_000 × UF (pesos) when provided
  PROM/USD → miles USD → ×1_000 × USD when provided

Storage (tipo='x1', monto_total in pesos CLP):
  Bank ins_cod:
    CL_IF_DAP, CL_IF_BB
    CL_IF_AGF_{agfRut}_DAP, CL_IF_AGF_{agfRut}_BB
  Sistema 999:
    same totals + CL_IF_AGF_{agfRut}_BANK_{bankCode}_{DAP|BB}

Usage:
  python chile_institutional_funding_loader.py --file tests/fixtures/ffm_inv_naci_sample.txt --periodo 202505 --dry-run
  python chile_institutional_funding_loader.py --periodo 202505
  python chile_institutional_funding_loader.py --from 202401 --to 202505
"""

from __future__ import annotations

import argparse
import csv
import io
import json
import logging
import re
import urllib.error
import urllib.parse
import urllib.request
from collections import defaultdict
from datetime import date
from pathlib import Path

import psycopg2.extras
from dotenv import load_dotenv

from chile_basilea_loader import SISTEMA_COD
from cmf_loader import get_connection

load_dotenv(Path(__file__).parent / ".env")

log = logging.getLogger("chile_inst_funding")
logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")

COUNTRY = "CL"
BATCH = 400
ROOT = Path(__file__).parent
BANK_RUT_PATH = ROOT / "data" / "cl_bank_rut_map.json"
AGF_REG_PATH = ROOT / "data" / "cl_agf_registry.json"
RUN_MAP_PATH = ROOT / "data" / "cl_fm_run_to_agf.json"

DOWNLOAD_URL = "https://www.cmfchile.cl/institucional/estadisticas/ffm_download.php"
BPR_MENU_URL = "https://www.cmfchile.cl/institucional/estadisticas/fm.bpr_menu.php"

# instrument → bucket
INSTRUMENT_BUCKET = {
    "DPC": "DAP",
    "DPL": "DAP",
    "BB": "BB",
}

MILES_SCALE = 1_000

UA = "LatamBanks/1.0 (institutional-funding; research)"

AGF_SHORT_RULES = [
    ("BANCHILE", "Banchile"),
    ("BANCOESTADO", "BancoEstado"),
    ("BCI ", "BCI AM"),
    ("BICE", "Bice Inversiones"),
    ("BTG", "BTG Pactual AGF"),
    ("CREDICORP", "Credicorp Capital"),
    ("FINTUAL", "Fintual"),
    ("ITAU", "Itaú AGF"),
    ("ITAÚ", "Itaú AGF"),
    ("LARRAINVIAL", "LarrainVial"),
    ("PRINCIPAL", "Principal"),
    ("PRUDENTIAL", "Prudential"),
    ("SANTANDER", "Santander AM"),
    ("SCOTIA", "Scotia AGF"),
    ("ZURICH", "Zurich"),
    ("AMERIS", "Ameris"),
    ("SARTOR", "Sartor"),
    ("TOESCA", "Toesca"),
    ("VINCI", "Vinci Compass"),
    ("SOYFOCUS", "SoyFocus"),
    (" SECURITY", "Security AGF"),
    ("SECURITY S", "Security AGF"),
    ("SURA", "Sura AGF"),
    ("MBI", "MBI"),
    ("INTERNACIONAL", "Banco Internacional AGF"),
]


def _http_bytes(url: str, data: bytes | None = None, timeout: int = 120) -> bytes:
    req = urllib.request.Request(
        url,
        data=data,
        headers={
            "User-Agent": UA,
            "Content-Type": "application/x-www-form-urlencoded" if data else "text/html",
        },
        method="POST" if data is not None else "GET",
    )
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return resp.read()


def load_bank_rut_map(path: Path = BANK_RUT_PATH) -> dict[str, int]:
    raw = json.loads(path.read_text(encoding="utf-8"))
    out: dict[str, int] = {}
    for rut, meta in (raw.get("map") or {}).items():
        out[str(rut).strip()] = int(meta["codigo"])
    return out


def agf_short_name(legal: str) -> str:
    u = legal.upper()
    for needle, short in AGF_SHORT_RULES:
        if needle in u:
            return short
    head = re.split(r"\s+ADMINISTRADORA", legal, flags=re.I)[0].strip()
    return re.sub(r"\s+", " ", head)[:40] or legal[:40]


def parse_bpr_menu(html: str) -> tuple[list[dict], dict[str, str]]:
    """Return (agf_list, run_to_agf)."""
    opts = re.findall(
        r'<option value="(\d+)">([^<]*ADMINISTRADORA[^<]*)</option>',
        html,
        flags=re.I,
    )
    seen: set[str] = set()
    agfs: list[dict] = []
    for rut, name in opts:
        if rut in seen:
            continue
        seen.add(rut)
        legal = re.sub(r"\s+", " ", name).strip()
        agfs.append({"rut": rut, "legal_name": legal, "short_name": agf_short_name(legal)})

    run_to_agf: dict[str, str] = {}
    for m in re.finditer(r"codfondos_(\d+)=new Array\(([^)]+)\)", html):
        agf = m.group(1)
        for part in m.group(2).split(","):
            run = part.strip().strip('"')
            if run and run != "0":
                run_to_agf[run] = agf
    return agfs, run_to_agf


def fetch_bpr_maps() -> tuple[list[dict], dict[str, str]]:
    html = _http_bytes(BPR_MENU_URL).decode("latin-1", errors="replace")
    return parse_bpr_menu(html)


def load_cached_run_map() -> dict[str, str]:
    if not RUN_MAP_PATH.exists():
        return {}
    raw = json.loads(RUN_MAP_PATH.read_text(encoding="utf-8"))
    return {str(k): str(v) for k, v in (raw.get("run_to_agf") or {}).items()}


def save_registry(agfs: list[dict], run_to_agf: dict[str, str]) -> None:
    AGF_REG_PATH.parent.mkdir(parents=True, exist_ok=True)
    AGF_REG_PATH.write_text(
        json.dumps(
            {
                "updated": date.today().isoformat(),
                "source": "CMF fm.bpr_menu.php",
                "agfs": agfs,
            },
            ensure_ascii=False,
            indent=2,
        )
        + "\n",
        encoding="utf-8",
    )
    RUN_MAP_PATH.write_text(
        json.dumps(
            {
                "updated": date.today().isoformat(),
                "source": "CMF fm.bpr_menu.php codfondos_*",
                "run_to_agf": run_to_agf,
            },
            indent=2,
        )
        + "\n",
        encoding="utf-8",
    )


def download_naci(periodo: str) -> bytes:
    """Download FFM_INV_NACI_{periodo}.txt for YYYYMM."""
    y, m = int(periodo[:4]), int(periodo[4:6])
    body = urllib.parse.urlencode(
        {
            "mm": f"{m:02d}",
            "aa": str(y),
            "cartera": "NACI",
            "btnConsulta": "GENERAR ARCHIVO",
        }
    ).encode("utf-8")
    raw = _http_bytes(DOWNLOAD_URL, data=body, timeout=180)
    if len(raw) < 500 or b"Run Fondo" not in raw[:2000] and b"FFM_601" not in raw[:2000]:
        # sometimes UTF-16 / latin — still check size
        text_head = raw[:4000].decode("latin-1", errors="replace")
        if "Run Fondo" not in text_head and "FFM_601" not in text_head:
            raise RuntimeError(f"Unexpected NACI payload for {periodo} ({len(raw)} bytes)")
    return raw


def _parse_float(v) -> float | None:
    if v is None or v == "":
        return None
    try:
        return float(str(v).strip().replace(",", "."))
    except ValueError:
        return None


def mv_to_clp(mv: float, currency: str, *, uf: float | None, usd: float | None) -> int | None:
    """Convert market value to pesos CLP. Returns None if FX missing for non-CLP."""
    cur = (currency or "").strip().upper()
    if cur in ("$$", "CLP", "PESOS", "$"):
        return int(round(mv * MILES_SCALE))
    if cur in ("UF",):
        if uf is None or uf <= 0:
            return None
        return int(round(mv * MILES_SCALE * uf))
    if cur in ("PROM", "USD", "US$", "DOL", "DOLAR", "DÓLAR"):
        if usd is None or usd <= 0:
            return None
        return int(round(mv * MILES_SCALE * usd))
    return None


def parse_naci_text(
    text: str,
    periodo: str,
    *,
    run_to_agf: dict[str, str],
    bank_rut_map: dict[str, int],
    uf: float | None = None,
    usd: float | None = None,
) -> tuple[list[tuple], dict]:
    """
    Aggregate portfolio rows → datos_financieros tuples.

    Returns (rows, stats) where rows are
      (periodo, tipo, ins_cod, cuenta, monto_total)
    """
    # grain: (agf, bank, bucket) → pesos
    grain: dict[tuple[str, int, str], int] = defaultdict(int)
    stats = {
        "rows_in": 0,
        "rows_used": 0,
        "rows_unmapped_fund": 0,
        "rows_unmapped_bank": 0,
        "rows_fx_skip": 0,
        "rows_other_instr": 0,
        "funds": set(),
        "agfs": set(),
        "banks": set(),
    }

    f = io.StringIO(text)
    reader = csv.DictReader(f, delimiter=";")
    if not reader.fieldnames or "FFM_6010400" not in reader.fieldnames:
        raise ValueError("NACI file missing expected columns (FFM_6010400)")

    for row in reader:
        stats["rows_in"] += 1
        instr = (row.get("FFM_6010400") or "").strip().upper()
        bucket = INSTRUMENT_BUCKET.get(instr)
        if not bucket:
            stats["rows_other_instr"] += 1
            continue

        run = (row.get("Run Fondo") or "").strip()
        agf = run_to_agf.get(run)
        if not agf:
            stats["rows_unmapped_fund"] += 1
            continue

        issuer_rut = (row.get("FFM_6010211") or "").strip()
        bank = bank_rut_map.get(issuer_rut)
        if bank is None:
            stats["rows_unmapped_bank"] += 1
            continue

        mv = _parse_float(row.get("FFM_6011200"))
        if mv is None:
            continue
        cur = (row.get("FFM_6011300") or "").strip()
        clp = mv_to_clp(mv, cur, uf=uf, usd=usd)
        if clp is None:
            stats["rows_fx_skip"] += 1
            continue

        grain[(agf, bank, bucket)] += clp
        stats["rows_used"] += 1
        stats["funds"].add(run)
        stats["agfs"].add(agf)
        stats["banks"].add(bank)

    # Build DB rows
    out: list[tuple] = []
    # bank totals / AGF on bank
    bank_tot: dict[tuple[int, str], int] = defaultdict(int)
    agf_tot: dict[tuple[str, str], int] = defaultdict(int)
    sys_tot: dict[str, int] = defaultdict(int)

    for (agf, bank, bucket), monto in grain.items():
        bank_tot[(bank, bucket)] += monto
        agf_tot[(agf, bucket)] += monto
        sys_tot[bucket] += monto
        # bank × AGF
        out.append((periodo, "x1", bank, f"CL_IF_AGF_{agf}_{bucket}", monto))
        # sistema matrix
        out.append(
            (periodo, "x1", SISTEMA_COD, f"CL_IF_AGF_{agf}_BANK_{bank}_{bucket}", monto)
        )

    for (bank, bucket), monto in bank_tot.items():
        out.append((periodo, "x1", bank, f"CL_IF_{bucket}", monto))

    for (agf, bucket), monto in agf_tot.items():
        out.append((periodo, "x1", SISTEMA_COD, f"CL_IF_AGF_{agf}_{bucket}", monto))

    for bucket, monto in sys_tot.items():
        out.append((periodo, "x1", SISTEMA_COD, f"CL_IF_{bucket}", monto))

    stats["funds"] = len(stats["funds"])
    stats["agfs"] = len(stats["agfs"])
    stats["banks"] = len(stats["banks"])
    stats["grain"] = len(grain)
    stats["db_rows"] = len(out)
    return out, stats


def plan_labels_for_rows(rows: list[tuple]) -> dict[str, str]:
    labels = {
        "CL_IF_DAP": "Institutional Funding · FM DAP (depósitos a plazo)",
        "CL_IF_BB": "Institutional Funding · FM Bonos bancarios",
    }
    for _, _, _, cuenta, _ in rows:
        if cuenta in labels:
            continue
        m = re.fullmatch(r"CL_IF_AGF_(\d+)_(DAP|BB)", cuenta)
        if m:
            labels[cuenta] = f"IF · AGF {m.group(1)} · {m.group(2)}"
            continue
        m = re.fullmatch(r"CL_IF_AGF_(\d+)_BANK_(\d+)_(DAP|BB)", cuenta)
        if m:
            labels[cuenta] = f"IF · AGF {m.group(1)} · bank {m.group(2)} · {m.group(3)}"
    return labels


def upsert_plan(conn, labels: dict[str, str]):
    if not labels:
        return
    cur = conn.cursor()
    psycopg2.extras.execute_values(
        cur,
        "INSERT INTO plan_cuentas (country, cuenta, descripcion) VALUES %s "
        "ON CONFLICT (country, cuenta) DO UPDATE SET descripcion = EXCLUDED.descripcion",
        [(COUNTRY, c, lab) for c, lab in labels.items()],
    )
    conn.commit()


def wipe_if_periods(conn, periods: list[str]):
    cur = conn.cursor()
    cur.execute(
        "DELETE FROM datos_financieros WHERE country = %s AND cuenta LIKE 'CL_IF_%%' "
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


def default_periodo() -> str:
    """CMF typically publishes prior month with ~3–4 weeks lag → target month-2."""
    today = date.today()
    y, m = today.year, today.month - 2
    while m <= 0:
        m += 12
        y -= 1
    return f"{y}{m:02d}"


def read_text_bytes(raw: bytes) -> str:
    for enc in ("utf-8-sig", "latin-1", "cp1252"):
        try:
            return raw.decode(enc)
        except UnicodeDecodeError:
            continue
    return raw.decode("latin-1", errors="replace")


def fetch_macro_fx(conn, periodo: str) -> tuple[float | None, float | None]:
    """Read CL_MACRO_UF / CL_MACRO_USD (stored ×100) for periodo."""
    cur = conn.cursor()
    cur.execute(
        "SELECT cuenta, monto_total FROM datos_financieros "
        "WHERE country = %s AND periodo = %s AND tipo = 'q1' AND ins_cod = %s "
        "AND cuenta IN ('CL_MACRO_UF', 'CL_MACRO_USD')",
        (COUNTRY, periodo, SISTEMA_COD),
    )
    rows = {r[0]: r[1] for r in cur.fetchall()}
    uf = (rows.get("CL_MACRO_UF") or 0) / 100.0 or None
    usd = (rows.get("CL_MACRO_USD") or 0) / 100.0 or None
    return uf, usd


def process_periodo(
    periodo: str,
    *,
    file_path: Path | None,
    run_to_agf: dict[str, str],
    bank_rut_map: dict[str, int],
    uf: float | None,
    usd: float | None,
) -> tuple[list[tuple], dict]:
    if file_path:
        text = file_path.read_text(encoding="utf-8", errors="replace")
        if "FFM_6010400" not in text[:2000]:
            text = read_text_bytes(file_path.read_bytes())
    else:
        raw = download_naci(periodo)
        text = read_text_bytes(raw)
    return parse_naci_text(
        text,
        periodo,
        run_to_agf=run_to_agf,
        bank_rut_map=bank_rut_map,
        uf=uf,
        usd=usd,
    )


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description="Chile Institutional Funding (FM DAP/BB) loader")
    ap.add_argument("--periodo", default="", help="YYYYMM single month")
    ap.add_argument("--from", dest="from_p", default="")
    ap.add_argument("--to", dest="to_p", default="")
    ap.add_argument("--file", type=Path, default=None, help="Local NACI TXT (requires --periodo)")
    ap.add_argument("--run-map", type=Path, default=None, help="JSON run→AGF override")
    ap.add_argument("--refresh-registry", action="store_true", help="Scrape fm.bpr_menu.php")
    ap.add_argument("--uf", type=float, default=None, help="UF pesos for UF-denominated MV")
    ap.add_argument("--usd", type=float, default=None, help="USDCLP for PROM/USD MV")
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--force", action="store_true")
    args = ap.parse_args(argv)

    bank_rut_map = load_bank_rut_map()

    run_to_agf: dict[str, str] = {}
    agfs: list[dict] = []
    if args.refresh_registry or not RUN_MAP_PATH.exists():
        try:
            agfs, run_to_agf = fetch_bpr_maps()
            save_registry(agfs, run_to_agf)
            log.info("Registry refreshed: %s AGFs, %s fund RUNs", len(agfs), len(run_to_agf))
        except Exception as e:
            log.warning("Live BPR scrape failed (%s); using cache", e)
            run_to_agf = load_cached_run_map()
    else:
        run_to_agf = load_cached_run_map()
        if AGF_REG_PATH.exists():
            agfs = json.loads(AGF_REG_PATH.read_text(encoding="utf-8")).get("agfs") or []

    if args.run_map:
        extra = json.loads(args.run_map.read_text(encoding="utf-8"))
        if isinstance(extra, dict) and "run_to_agf" in extra:
            run_to_agf.update({str(k): str(v) for k, v in extra["run_to_agf"].items()})
        else:
            run_to_agf.update({str(k): str(v) for k, v in extra.items()})

    if not run_to_agf:
        log.error("No fund→AGF map available")
        return 1

    if args.file and not args.periodo:
        log.error("--file requires --periodo")
        return 1

    if args.periodo:
        periods = [args.periodo]
    elif args.from_p and args.to_p:
        periods = _ym_range(args.from_p, args.to_p)
    else:
        periods = [default_periodo()]

    all_rows: list[tuple] = []
    conn = None if args.dry_run else get_connection()
    try:
        for per in periods:
            uf = args.uf
            usd = args.usd
            if conn is not None and (uf is None or usd is None):
                try:
                    m_uf, m_usd = fetch_macro_fx(conn, per)
                    uf = uf if uf is not None else m_uf
                    usd = usd if usd is not None else m_usd
                    if m_uf or m_usd:
                        log.info("%s macros: UF=%s USD=%s", per, uf, usd)
                except Exception as e:
                    log.warning("Could not read macro FX for %s: %s", per, e)
            try:
                rows, stats = process_periodo(
                    per,
                    file_path=args.file if (args.file and per == args.periodo) else None,
                    run_to_agf=run_to_agf,
                    bank_rut_map=bank_rut_map,
                    uf=uf,
                    usd=usd,
                )
            except Exception as e:
                log.error("Period %s failed: %s", per, e)
                if args.file:
                    return 1
                continue
            log.info(
                "%s: used=%s/%s funds=%s agfs=%s banks=%s grain=%s db_rows=%s "
                "unmapped_fund=%s unmapped_bank=%s fx_skip=%s",
                per,
                stats["rows_used"],
                stats["rows_in"],
                stats["funds"],
                stats["agfs"],
                stats["banks"],
                stats["grain"],
                stats["db_rows"],
                stats["rows_unmapped_fund"],
                stats["rows_unmapped_bank"],
                stats["rows_fx_skip"],
            )
            all_rows.extend(rows)

        labels = plan_labels_for_rows(all_rows)
        if args.dry_run:
            log.info("Dry-run: %s rows, %s plan labels — no DB write", len(all_rows), len(labels))
            sample = [
                r
                for r in all_rows
                if r[2] == SISTEMA_COD and re.fullmatch(r"CL_IF_AGF_\d+_DAP", r[3])
            ]
            sample.sort(key=lambda r: -r[4])
            for r in sample[:8]:
                log.info("  %s %s = %s", r[0], r[3], r[4])
            return 0

        assert conn is not None
        upsert_plan(conn, labels)
        wiped = wipe_if_periods(conn, periods)
        log.info("Wiped %s prior CL_IF_ rows for %s", wiped, periods)
        n = insert_rows(conn, all_rows)
        log.info("Upserted %s rows", n)
    finally:
        if conn is not None:
            conn.close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
