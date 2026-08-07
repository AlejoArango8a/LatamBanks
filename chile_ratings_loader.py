#!/usr/bin/env python3
"""
Chile bank ratings — Humphreys scrape + curated Feller/ICR seed → JSON.

Feller Rate requires free registration (not scrapable). We keep a curated
seed for Feller/ICR/Fitch and overlay Humphreys long-term deposits when public.

Output: data/cl_bank_ratings.json
  {
    "updated": "ISO-8601",
    "source": "...",
    "ratings": { "1": "AAA", ... },
    "meta": { "1": { "outlook", "agency", "analysis", "humphreys"? } }
  }

Uso:
  python chile_ratings_loader.py
  python chile_ratings_loader.py --html-path tests/fixtures/humphreys_if.html
  python chile_ratings_loader.py --dry-run
"""

from __future__ import annotations

import argparse
import json
import logging
import re
import urllib.request
from datetime import datetime, timezone
from html.parser import HTMLParser
from pathlib import Path

log = logging.getLogger("chile_ratings")
logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")

HUMPHREYS_URL = "https://www.humphreys.cl/clasificaciones/instituciones-financieras/"
OUT_PATH = Path(__file__).parent / "data" / "cl_bank_ratings.json"

# Curated seed (Feller-first; ICR/Fitch/Humphreys where Feller missing)
# Keys = instituciones.codigo CMF
CURATED_RATINGS = {
    1: "AAA",
    9: "AA",
    12: "AAA",
    14: "AAA",
    16: "AAA",
    28: "AA+",
    31: "AAA",
    37: "AAA",
    39: "AAA",
    41: "AAA",
    49: "AA+",
    51: "AA",
    53: "AA-",
    55: "AA",
    59: "AA",
    60: "AAA",
    61: "AAA",
    62: "AA-",
}

CURATED_META = {
    1: {
        "outlook": "Estable",
        "agency": "Feller Rate",
        "analysis": "Máxima categoría de solvencia local (AAA) con perspectivas estables.",
    },
    12: {
        "outlook": "Estable",
        "agency": "Feller Rate",
        "analysis": "Banco público soberano; solvencia AAA con perspectivas estables.",
    },
    14: {
        "outlook": "Estable",
        "agency": "Fitch Chile / ICR",
        "analysis": "Solvencia local AAA(cl) / AAA. Fitch Chile e ICR; respaldo de The Bank of Nova Scotia.",
    },
    16: {
        "outlook": "Estable",
        "agency": "Feller Rate",
        "analysis": "Solvencia AAA (Feller); una de las franquicias privadas de mayor escala en Chile.",
    },
    28: {
        "outlook": "Estable",
        "agency": "Feller Rate",
        "analysis": "Solvencia AA+ (Feller); en proceso de integración con Banco Security.",
    },
    37: {
        "outlook": "Estable",
        "agency": "Feller Rate",
        "analysis": "Solvencia AAA; filial chilena de Banco Santander S.A.",
    },
    39: {
        "outlook": "Estable",
        "agency": "Feller Rate",
        "analysis": "Solvencia AAA; franquicia Itaú en Chile.",
    },
    49: {
        "outlook": "Estable",
        "agency": "ICR",
        "analysis": "ICR subió la solvencia a AA+ tras el acuerdo de fusión BICECORP / Grupo Security.",
    },
    53: {
        "outlook": "Estable",
        "agency": "Humphreys / Fitch / ICR",
        "analysis": "Banco Ripley Chile en AA- (distinto de Ripley Corp / Ripley Chile retail).",
    },
    59: {
        "outlook": "Estable",
        "agency": "Feller Rate",
        "analysis": "Solvencia AA; banco chileno del grupo BTG Pactual.",
    },
    62: {
        "outlook": "Estable",
        "agency": "Humphreys / ICR",
        "analysis": "Tanner Banco Digital clasificado en AA- tras el inicio de operaciones bancarias.",
    },
}

# Humphreys bank name → CMF codigo (active names only)
HUMPHREYS_NAME_MAP = {
    "banco de chile": 1,
    "banco ripley": 53,
    "tanner banco digital": 62,
    "banco btg pactual chile": 59,
}


def _norm(s: str) -> str:
    import unicodedata

    s = unicodedata.normalize("NFKD", str(s or ""))
    s = "".join(ch for ch in s if not unicodedata.combining(ch))
    s = s.lower()
    s = re.sub(r"\(.*?\)", " ", s)
    s = re.sub(r"[^a-z0-9]+", " ", s)
    return re.sub(r"\s+", " ", s).strip()


class _TablePressBanks(HTMLParser):
    """Extract rows from tablepress Bancos table."""

    def __init__(self):
        super().__init__()
        self.in_target = False
        self.in_tbody = False
        self.in_tr = False
        self.in_td = False
        self.depth_table = 0
        self.cur_row: list[str] = []
        self.cur_cell: list[str] = []
        self.rows: list[list[str]] = []
        self._pending_target = False

    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        if tag == "h2" and attrs.get("id") == "tablepress-9-name":
            self._pending_target = True
        if tag == "table" and self._pending_target:
            self.in_target = True
            self._pending_target = False
            self.depth_table = 1
            return
        if not self.in_target:
            return
        if tag == "table":
            self.depth_table += 1
        elif tag == "tbody":
            self.in_tbody = True
        elif tag == "tr" and self.in_tbody:
            self.in_tr = True
            self.cur_row = []
        elif tag == "td" and self.in_tr:
            self.in_td = True
            self.cur_cell = []

    def handle_endtag(self, tag):
        if not self.in_target:
            return
        if tag == "td" and self.in_td:
            self.in_td = False
            self.cur_row.append(re.sub(r"\s+", " ", "".join(self.cur_cell)).strip())
        elif tag == "tr" and self.in_tr:
            self.in_tr = False
            if self.cur_row:
                self.rows.append(self.cur_row)
        elif tag == "tbody":
            self.in_tbody = False
        elif tag == "table":
            self.depth_table -= 1
            if self.depth_table <= 0:
                self.in_target = False

    def handle_data(self, data):
        if self.in_td:
            self.cur_cell.append(data)


def parse_humphreys_html(html: str) -> list[dict]:
    """
    Returns list of {name, short_term, long_term, outlook, active}.
    Skips rows marked no vigente / vigente hasta.
    """
    p = _TablePressBanks()
    p.feed(html)
    out = []
    for row in p.rows:
        if len(row) < 3:
            continue
        name = row[0]
        ln = name.lower()
        active = not (
            "no vigente" in ln
            or "vigente hasta" in ln
            or "clasificación no vigente" in ln
        )
        long_term = (row[2] if len(row) > 2 else "").strip()
        short_term = (row[1] if len(row) > 1 else "").strip()
        outlook = (row[7] if len(row) > 7 else row[-1] if row else "").strip()
        if not long_term or long_term == "-":
            continue
        # Normalize rating token
        m = re.match(r"^(AAA|AA|A|BBB|BB|B|C)([+-]?)$", long_term.replace(" ", ""), re.I)
        if not m:
            continue
        rating = m.group(1).upper() + (m.group(2) or "")
        out.append(
            {
                "name": name,
                "short_term": short_term,
                "long_term": rating,
                "outlook": outlook or "Estable",
                "active": active,
            }
        )
    return out


def fetch_humphreys_html() -> str:
    req = urllib.request.Request(
        HUMPHREYS_URL,
        headers={"User-Agent": "LatamBanks/1.0 (ratings refresh)"},
    )
    with urllib.request.urlopen(req, timeout=45) as resp:
        return resp.read().decode("utf-8", errors="replace")


def merge_ratings(humphreys_rows: list[dict]) -> dict:
    ratings = {str(k): v for k, v in CURATED_RATINGS.items()}
    meta = {str(k): dict(v) for k, v in CURATED_META.items()}

    overlays = 0
    for row in humphreys_rows:
        if not row["active"]:
            continue
        n = _norm(row["name"])
        cod = HUMPHREYS_NAME_MAP.get(n)
        if cod is None:
            # soft match
            for key, c in HUMPHREYS_NAME_MAP.items():
                if key in n or n in key:
                    cod = c
                    break
        if cod is None:
            continue
        sk = str(cod)
        # Prefer Humphreys when curated agency already cites Humphreys, or when
        # no Feller seed agency — otherwise keep Feller rating but attach Humphreys note.
        agency = (meta.get(sk) or {}).get("agency", "")
        if "Humphreys" in agency or sk not in meta:
            ratings[sk] = row["long_term"]
            overlays += 1
        entry = meta.setdefault(
            sk,
            {
                "outlook": row["outlook"],
                "agency": "Humphreys",
                "analysis": f"Humphreys depósitos LP {row['long_term']}.",
            },
        )
        entry["humphreys"] = {
            "long_term": row["long_term"],
            "short_term": row["short_term"],
            "outlook": row["outlook"],
        }
        if "Humphreys" in (entry.get("agency") or ""):
            entry["outlook"] = row["outlook"] or entry.get("outlook")
            entry["agency"] = "Humphreys" if entry.get("agency") == "Humphreys" else entry["agency"]

    return {
        "updated": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "source": "curated Feller/ICR/Fitch + Humphreys scrape",
        "humphreys_url": HUMPHREYS_URL,
        "humphreys_active_banks": overlays,
        "ratings": ratings,
        "meta": meta,
    }


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description="Chile bank ratings refresh")
    ap.add_argument("--html-path", type=Path, default=None)
    ap.add_argument("--out", type=Path, default=OUT_PATH)
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args(argv)

    if args.html_path:
        html = args.html_path.read_text(encoding="utf-8", errors="replace")
    else:
        html = fetch_humphreys_html()

    hum = parse_humphreys_html(html)
    active = [h for h in hum if h["active"]]
    log.info("Humphreys banks parsed=%d active=%d", len(hum), len(active))
    for h in active:
        log.info("  %s → %s (%s)", h["name"], h["long_term"], h["outlook"])

    payload = merge_ratings(hum)
    log.info(
        "Merged ratings=%d · Humphreys overlays=%d",
        len(payload["ratings"]),
        payload["humphreys_active_banks"],
    )

    if args.dry_run:
        print(json.dumps(payload, ensure_ascii=False, indent=2)[:2000])
        return 0

    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    log.info("Wrote %s", args.out)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
