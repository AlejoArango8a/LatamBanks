#!/usr/bin/env python3
"""
chile_loader.py — ETL CMF Chile (ZIP TXT) → CockroachDB

CMF publica ZIPs en:
  https://www.cmfchile.cl/portal/estadisticas/617/articles-{ID}_recurso_1.zip

Los IDs no son YYYYMM-predictables. Estrategia:
  1) Semilla de IDs conocidos (carpeta zips/ + últimos publicados)
  2) Probe hacia adelante desde el max ID conocido buscando nuevos ZIPs
  3) Detectar período dentro del ZIP y cargar si falta en carga_log

USO
  python chile_loader.py                     # incremental (probe + load missing)
  python chile_loader.py --article-id 111486
  python chile_loader.py --zip-url 'https://.../articles-111486_recurso_1.zip'
  python chile_loader.py --zip-path ./zips/articles-111486_recurso_1.zip
  python chile_loader.py --force             # reescribe períodos ya cargados
  python chile_loader.py --dry-run
"""

from __future__ import annotations

import argparse
import io
import logging
import os
import re
import sys
import tempfile
import urllib.error
import urllib.request
import zipfile
from pathlib import Path

from dotenv import load_dotenv

load_dotenv(Path(__file__).parent / ".env")

from cmf_loader import (  # noqa: E402
    COCKROACH_URL,
    detect_periodo,
    get_connection,
    get_loaded_periods,
    process_zip,
)

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
log = logging.getLogger("chile_loader")

UA = {"User-Agent": "LatamBanksBot/1.0 (+https://github.com/AlejoArango8a/LatamBanks)"}
ZIP_URL = "https://www.cmfchile.cl/portal/estadisticas/617/articles-{aid}_recurso_1.zip"

# Seed of known article IDs → period (local zips + portal). Used to anchor probes.
KNOWN_ARTICLE_PERIODS: dict[int, str] = {
    83568: "202406",
    84526: "202407",
    85540: "202408",
    86588: "202409",
    87973: "202410",
    89046: "202411",
    90160: "202412",
    91534: "202501",
    92571: "202502",
    93999: "202503",
    94904: "202504",
    96036: "202505",
    97065: "202506",
    98081: "202507",
    99065: "202508",
    111486: "202605",
}

PROBE_AHEAD_DEFAULT = 120  # article IDs to scan past the max known/seed ID


def _http_get(url: str, timeout: int = 60) -> bytes:
    req = urllib.request.Request(url, headers=UA)
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.read()


def download_article_zip(article_id: int) -> bytes | None:
    url = ZIP_URL.format(aid=article_id)
    try:
        data = _http_get(url)
    except urllib.error.HTTPError as e:
        if e.code in (404, 403):
            return None
        log.warning("HTTP %s for article %s: %s", e.code, article_id, e)
        return None
    except Exception as e:
        log.warning("Download failed article %s: %s", article_id, e)
        return None
    if not data or data[:2] != b"PK":
        return None
    return data


def period_from_zip_bytes(zip_bytes: bytes) -> str | None:
    with zipfile.ZipFile(io.BytesIO(zip_bytes)) as zf:
        return detect_periodo(zf)


def seed_article_ids_from_zips_dir(zips_dir: Path) -> dict[int, str]:
    out = dict(KNOWN_ARTICLE_PERIODS)
    if not zips_dir.is_dir():
        return out
    for p in zips_dir.glob("articles-*_recurso_1.zip"):
        m = re.search(r"articles-(\d+)", p.name)
        if not m:
            continue
        aid = int(m.group(1))
        try:
            with zipfile.ZipFile(p) as zf:
                per = detect_periodo(zf)
            if per:
                out[aid] = per
        except Exception as e:
            log.debug("skip local zip %s: %s", p.name, e)
    return out


def discover_new_article_ids(anchor_id: int, ahead: int = PROBE_AHEAD_DEFAULT) -> list[tuple[int, bytes]]:
    """Probe article IDs after anchor; return (id, zip_bytes) for real ZIPs found."""
    found: list[tuple[int, bytes]] = []
    start = max(1, anchor_id - 2)
    end = anchor_id + ahead
    log.info("Probing CMF article IDs %s … %s", start, end)
    for aid in range(start, end + 1):
        data = download_article_zip(aid)
        if data:
            found.append((aid, data))
            log.info("Found ZIP articles-%s (%d KB)", aid, len(data) // 1024)
    return found


def load_zip_bytes(zip_bytes: bytes, periodo: str | None, conn, force: bool) -> tuple[str, int]:
    per = periodo or period_from_zip_bytes(zip_bytes)
    if not per or not (len(per) == 6 and per.isdigit()):
        raise RuntimeError(f"Could not detect period from ZIP (got {per!r})")
    loaded = get_loaded_periods(conn)
    if per in loaded and not force:
        log.info("Skip %s — already in carga_log (use --force to overwrite)", per)
        return per, 0
    if per in loaded and force:
        log.warning("Overwriting period %s (--force)", per)
    n = process_zip(zip_bytes, per, conn)
    return per, n


def run_incremental(conn, zips_dir: Path, force: bool, dry_run: bool, probe_ahead: int = PROBE_AHEAD_DEFAULT) -> int:
    seeds = seed_article_ids_from_zips_dir(zips_dir)
    loaded = get_loaded_periods(conn)
    max_aid = max(seeds) if seeds else 111486
    log.info("Seed article IDs: %d · max_aid=%s · loaded periods=%d · max_loaded=%s",
             len(seeds), max_aid, len(loaded), max(loaded) if loaded else None)

    # Prefer loading any seed period still missing (historical holes).
    missing_seeds = [(aid, per) for aid, per in sorted(seeds.items()) if per not in loaded]
    if missing_seeds:
        log.info("Missing seed periods to load: %s",
                 ", ".join(f"{aid}→{per}" for aid, per in missing_seeds[-12:]))

    loaded_count = 0
    for aid, per in missing_seeds:
        data = download_article_zip(aid)
        if not data:
            local = zips_dir / f"articles-{aid}_recurso_1.zip"
            if local.exists():
                data = local.read_bytes()
            else:
                log.warning("Cannot fetch missing seed articles-%s (%s)", aid, per)
                continue
        if dry_run:
            log.info("[dry-run] would load articles-%s → %s", aid, per)
            continue
        got_per, n = load_zip_bytes(data, per, conn, force=force)
        if n:
            loaded_count += 1
            log.info("Loaded %s from articles-%s (%d files)", got_per, aid, n)

    # Probe for newer publications beyond max seed id.
    found = discover_new_article_ids(max_aid, ahead=probe_ahead)
    for aid, data in found:
        try:
            per = period_from_zip_bytes(data)
        except Exception as e:
            log.warning("Bad ZIP articles-%s: %s", aid, e)
            continue
        if not per:
            continue
        if per in loaded and not force:
            log.info("Probe hit articles-%s = %s (already loaded)", aid, per)
            continue
        if dry_run:
            log.info("[dry-run] would load articles-%s → %s", aid, per)
            continue
        got_per, n = load_zip_bytes(data, per, conn, force=force)
        if n:
            loaded_count += 1
            loaded.add(got_per)
            log.info("Loaded %s from articles-%s (%d files)", got_per, aid, n)
    return loaded_count


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description="ETL CMF Chile → CockroachDB")
    ap.add_argument("--article-id", type=int, default=None, help="Load one articles-{ID} ZIP")
    ap.add_argument("--zip-url", default="", help="Direct ZIP URL")
    ap.add_argument("--zip-path", default="", help="Local ZIP path")
    ap.add_argument("--period", default="", help="Optional YYYYMM override")
    ap.add_argument("--force", action="store_true", help="Overwrite periods already in carga_log")
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--zips-dir", default=str(Path(__file__).parent / "zips"))
    ap.add_argument("--probe-ahead", type=int, default=PROBE_AHEAD_DEFAULT)
    args = ap.parse_args(argv)

    if not COCKROACH_URL and not args.dry_run:
        log.error("Missing COCKROACH_URL")
        return 2

    conn = None
    try:
        conn = get_connection()
    except Exception as e:
        if args.dry_run:
            log.warning("dry-run without DB (%s)", e)
            seeds = seed_article_ids_from_zips_dir(Path(args.zips_dir))
            log.info("Seeds only: %s", sorted(seeds.items())[-8:])
            return 0
        log.error("DB connection failed: %s", e)
        return 2

    try:
        if args.zip_path or args.zip_url or args.article_id:
            if args.zip_path:
                zip_bytes = Path(args.zip_path).read_bytes()
                src = args.zip_path
            elif args.zip_url:
                zip_bytes = _http_get(args.zip_url)
                src = args.zip_url
            else:
                zip_bytes = download_article_zip(args.article_id)
                if not zip_bytes:
                    log.error("No ZIP for article-id %s", args.article_id)
                    return 1
                src = f"articles-{args.article_id}"
            if zip_bytes[:2] != b"PK":
                log.error("Not a ZIP: %s", src)
                return 1
            per = args.period or period_from_zip_bytes(zip_bytes)
            log.info("Source %s → period %s", src, per)
            if args.dry_run:
                return 0
            got, n = load_zip_bytes(zip_bytes, args.period or None, conn, force=args.force)
            log.info("Done %s (%d files)", got, n)
            return 0 if n or got else 1

        n = run_incremental(
            conn,
            Path(args.zips_dir),
            force=args.force,
            dry_run=args.dry_run,
            probe_ahead=args.probe_ahead,
        )
        log.info("Incremental finished · periods loaded this run: %d", n)
        return 0
    finally:
        if conn is not None:
            conn.close()


if __name__ == "__main__":
    sys.exit(main())
