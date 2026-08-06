#!/usr/bin/env python3
"""
chile_loader.py — ETL CMF Chile (ZIP TXT) → CockroachDB

CMF publica ZIPs en:
  https://www.cmfchile.cl/portal/estadisticas/626/articles-{ID}_recurso_1.zip
  (canal 617 también sirve; 617→626 redirect)

Los article IDs son contadores CMS globales (no YYYYMM). Discovery stack:
  1) Semilla conocida + carpeta zips/
  2) Scrape del listing vivo propertyvalue-32901 (ZIP texto)
  3) Scrape del hub 28910 (pack xlsx) → cluster ±30 alrededor de hits
  4) Probe lineal desde max AID como red de seguridad
  5) Relacionados HTML (solo enlaza otros ZIPs)

USO
  python chile_loader.py                     # incremental
  python chile_loader.py --article-id 111486
  python chile_loader.py --zip-url 'https://.../articles-111486_recurso_1.zip'
  python chile_loader.py --zip-path ./zips/articles-111486_recurso_1.zip
  python chile_loader.py --force             # reescribe períodos ya cargados
  python chile_loader.py --dry-run
  python chile_loader.py --discover-only     # listing/cluster sin tocar DB
"""

from __future__ import annotations

import argparse
import io
import logging
import os
import re
import sys
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
ZIP_URLS = [
    "https://www.cmfchile.cl/portal/estadisticas/626/articles-{aid}_recurso_1.zip",
    "https://www.cmfchile.cl/portal/estadisticas/617/articles-{aid}_recurso_1.zip",
]
ARTICLE_URL = "https://www.cmfchile.cl/portal/estadisticas/626/w4-article-{aid}.html"

# Live listing for Balance texto ZIPs (28917 is stale — do not use as primary).
LISTING_ZIP_URL = (
    "https://www.cmfchile.cl/portal/estadisticas/626/w4-propertyvalue-32901.html"
)
# Hub of monthly xlsx reports — same CMS cluster as the ZIP for a given month.
LISTING_HUB_URL = (
    "https://www.cmfchile.cl/portal/estadisticas/626/w4-propertyvalue-28910.html"
)

MONTH_TO_MM = {
    "enero": "01",
    "febrero": "02",
    "marzo": "03",
    "abril": "04",
    "mayo": "05",
    "junio": "06",
    "julio": "07",
    "agosto": "08",
    "septiembre": "09",
    "octubre": "10",
    "noviembre": "11",
    "diciembre": "12",
}

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
    100161: "202509",
    101102: "202510",
    102413: "202511",
    103192: "202512",
    103964: "202601",
    109125: "202602",
    110154: "202603",
    110813: "202604",
    111486: "202605",
    112240: "202606",
}

# Gaps between consecutive months can exceed 700 IDs (May→Jun 2026: 111486→112240).
PROBE_AHEAD_DEFAULT = 1000
# When listing scrape succeeds, still probe a shorter window as safety net.
PROBE_AHEAD_AFTER_LISTING = 120
CLUSTER_RADIUS_DEFAULT = 30
# Only merge listing cards from this period forward (avoids re-fetching 20y of archive).
LISTING_MERGE_MIN_PERIOD = min(KNOWN_ARTICLE_PERIODS.values())


def _http_get(url: str, timeout: int = 60) -> bytes:
    req = urllib.request.Request(url, headers=UA)
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.read()


def download_article_zip(article_id: int) -> bytes | None:
    for tmpl in ZIP_URLS:
        url = tmpl.format(aid=article_id)
        try:
            data = _http_get(url)
        except urllib.error.HTTPError as e:
            if e.code in (404, 403):
                continue
            log.warning("HTTP %s for article %s: %s", e.code, article_id, e)
            continue
        except Exception as e:
            log.warning("Download failed article %s (%s): %s", article_id, url, e)
            continue
        if data and data[:2] == b"PK":
            return data
    return None


def related_article_ids(article_id: int) -> list[int]:
    """Scrape CMF article HTML for sibling publication IDs (Relacionados)."""
    try:
        html = _http_get(ARTICLE_URL.format(aid=article_id)).decode("utf-8", "ignore")
    except Exception as e:
        log.debug("No article page %s: %s", article_id, e)
        return []
    ids = sorted({int(x) for x in re.findall(r"(?:w4-article-|articles-)(\d+)", html)})
    return ids


def period_from_zip_bytes(zip_bytes: bytes) -> str | None:
    with zipfile.ZipFile(io.BytesIO(zip_bytes)) as zf:
        return detect_periodo(zf)


def parse_period_from_cmf_title(text: str) -> str | None:
    """Extract YYYYMM from CMF Spanish titles like '… Bancos Junio 2026'."""
    if not text:
        return None
    m = re.search(
        r"Bancos\s+([A-Za-zÁÉÍÓÚáéíóúüÜ]+)\s+(\d{4})",
        text,
        flags=re.IGNORECASE,
    )
    if not m:
        m = re.search(
            r"\b([A-Za-zÁÉÍÓÚáéíóúüÜ]+)\s+(\d{4})\b",
            text,
            flags=re.IGNORECASE,
        )
    if not m:
        return None
    mm = MONTH_TO_MM.get(m.group(1).lower())
    if not mm:
        return None
    return f"{m.group(2)}{mm}"


def parse_listing_zip_articles(html: str) -> dict[int, str]:
    """
    Parse propertyvalue-32901 (Balance texto) cards → {article_id: YYYYMM}.

    Cards look like: class="… articulo … aid-112240" … "Bancos Junio 2026 … (Formato: zip)"
    """
    out: dict[int, str] = {}
    if not html:
        return out
    for m in re.finditer(r"\baid-(\d+)\b", html):
        aid = int(m.group(1))
        window = html[m.start() : m.start() + 2800]
        text = re.sub(r"<[^>]+>", " ", window)
        text = re.sub(r"\s+", " ", text)
        # Prefer ZIP cards; skip obvious non-zip if formato is present and not zip.
        fmt = re.search(r"\(Formato:\s*([a-z0-9]+)\)", text, flags=re.IGNORECASE)
        if fmt and fmt.group(1).lower() != "zip":
            continue
        per = parse_period_from_cmf_title(text)
        if not per:
            continue
        # Keep first hit; listing repeats aids in filters / sidebars.
        out.setdefault(aid, per)
    return out


def parse_listing_hub_aids(html: str) -> list[int]:
    """Parse propertyvalue-28910 hub for recent article IDs (cluster anchors)."""
    if not html:
        return []
    return sorted({int(x) for x in re.findall(r"\baid-(\d+)\b", html)})


def scrape_zip_listing(url: str = LISTING_ZIP_URL) -> dict[int, str]:
    try:
        html = _http_get(url).decode("utf-8", "ignore")
    except Exception as e:
        log.warning("ZIP listing scrape failed (%s): %s", url, e)
        return {}
    found = parse_listing_zip_articles(html)
    log.info("ZIP listing %s → %d article→period maps", url.split("/")[-1], len(found))
    if found:
        top = sorted(found.items(), key=lambda kv: kv[1], reverse=True)[:6]
        log.info("ZIP listing newest: %s", ", ".join(f"{a}→{p}" for a, p in top))
    return found


def scrape_hub_aids(url: str = LISTING_HUB_URL) -> list[int]:
    try:
        html = _http_get(url, timeout=120).decode("utf-8", "ignore")
    except Exception as e:
        log.warning("Hub listing scrape failed (%s): %s", url, e)
        return []
    aids = parse_listing_hub_aids(html)
    log.info(
        "Hub listing %s → %d article IDs (max=%s)",
        url.split("/")[-1],
        len(aids),
        max(aids) if aids else None,
    )
    return aids


def cluster_candidate_ids(anchors: list[int], radius: int = CLUSTER_RADIUS_DEFAULT) -> list[int]:
    """Expand ±radius around anchors (monthly CMF pubs form a tight ID cluster)."""
    out: set[int] = set()
    for a in anchors:
        if a <= 0:
            continue
        lo = max(1, a - radius)
        hi = a + radius
        out.update(range(lo, hi + 1))
    return sorted(out)


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


def discover_new_article_ids(
    anchor_id: int,
    ahead: int = PROBE_AHEAD_DEFAULT,
    extra_ids: set[int] | None = None,
) -> list[tuple[int, bytes]]:
    """Probe article IDs after anchor; also try explicit extra IDs (cluster / hub)."""
    found: list[tuple[int, bytes]] = []
    seen: set[int] = set()

    # Prefer explicit candidates (cluster / listing) before the linear sweep.
    for aid in sorted(extra_ids or []):
        if aid in seen:
            continue
        data = download_article_zip(aid)
        if data:
            found.append((aid, data))
            seen.add(aid)
            log.info("Found ZIP articles-%s via cluster/listing (%d KB)", aid, len(data) // 1024)

    start = max(1, anchor_id + 1)
    end = anchor_id + ahead
    if ahead > 0:
        log.info("Probing CMF article IDs %s … %s", start, end)
        for aid in range(start, end + 1):
            if aid in seen:
                continue
            data = download_article_zip(aid)
            if data:
                found.append((aid, data))
                seen.add(aid)
                log.info("Found ZIP articles-%s (%d KB)", aid, len(data) // 1024)
    else:
        log.info("Linear probe skipped (ahead=0)")

    # Expand from the newest hits via Relacionados (catches sibling ZIPs).
    expand_from = sorted(seen | {anchor_id}, reverse=True)[:5]
    related: set[int] = set()
    for aid in expand_from:
        for rid in related_article_ids(aid):
            if rid not in seen and rid > anchor_id - 50:
                related.add(rid)
    if related:
        log.info("Relacionados candidates: %s", sorted(related)[-20:])
    for aid in sorted(related):
        if aid in seen:
            continue
        data = download_article_zip(aid)
        if data:
            found.append((aid, data))
            seen.add(aid)
            log.info("Found ZIP via Relacionados articles-%s (%d KB)", aid, len(data) // 1024)
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


def build_discovery_seeds(zips_dir: Path) -> tuple[dict[int, str], list[int], bool]:
    """
    Merge hard-coded seeds, local zips, and live listings.

    Returns (aid→period, hub_aids, listing_ok).
    Listing cards older than LISTING_MERGE_MIN_PERIOD are ignored so incremental
    runs do not attempt to re-download the full CMF archive.
    """
    seeds = seed_article_ids_from_zips_dir(zips_dir)
    listing = scrape_zip_listing()
    listing_ok = bool(listing)
    merged = 0
    for aid, per in listing.items():
        if per < LISTING_MERGE_MIN_PERIOD:
            continue
        prev = seeds.get(aid)
        if prev and prev != per:
            log.warning(
                "Listing period mismatch articles-%s: seed=%s listing=%s (keeping listing)",
                aid,
                prev,
                per,
            )
        seeds[aid] = per
        merged += 1
    log.info(
        "Listing merge: %d cards with period ≥ %s",
        merged,
        LISTING_MERGE_MIN_PERIOD,
    )

    hub_aids = scrape_hub_aids()
    # Keep only recent hub aids near the ZIP seed range (cluster anchors).
    min_hub = max(0, max(seeds) - 5000) if seeds else 0
    hub_aids = [a for a in hub_aids if a >= min_hub]
    return seeds, hub_aids, listing_ok


def freshness_report(seeds: dict[int, str], loaded: set[str]) -> str | None:
    """Return warning if listing/seeds know a newer period than carga_log."""
    if not seeds:
        return None
    newest_known = max(seeds.values())
    newest_loaded = max(loaded) if loaded else None
    if newest_loaded is None:
        return f"DB has no CL periods; listing/seeds newest={newest_known}"
    if newest_known > newest_loaded:
        missing = sorted({p for p in seeds.values() if p > newest_loaded})
        return (
            f"CMF listing/seeds ahead of DB: known_max={newest_known} "
            f"loaded_max={newest_loaded} missing={missing[-8:]}"
        )
    return None


def run_discover_only(zips_dir: Path, probe_ahead: int) -> int:
    seeds, hub_aids, listing_ok = build_discovery_seeds(zips_dir)
    max_aid = max(seeds) if seeds else (max(hub_aids) if hub_aids else 0)
    newest = sorted(seeds.items(), key=lambda kv: kv[1], reverse=True)[:12]
    print(f"listing_ok={listing_ok} seeds={len(seeds)} hub_aids={len(hub_aids)} max_aid={max_aid}")
    print("newest seeds:")
    for aid, per in newest:
        print(f"  {aid} → {per}")
    if hub_aids:
        print(f"hub max aids: {hub_aids[-12:]}")
    anchors = [max_aid] + hub_aids[-5:]
    cluster = cluster_candidate_ids(anchors, CLUSTER_RADIUS_DEFAULT)
    print(f"cluster candidates around anchors: {len(cluster)} (ahead probe={probe_ahead})")
    return 0 if seeds else 1


def run_incremental(
    conn,
    zips_dir: Path,
    force: bool,
    dry_run: bool,
    probe_ahead: int = PROBE_AHEAD_DEFAULT,
) -> int:
    seeds, hub_aids, listing_ok = build_discovery_seeds(zips_dir)
    loaded = get_loaded_periods(conn)
    max_aid = max(seeds) if seeds else (max(hub_aids) if hub_aids else 111486)
    log.info(
        "Seed article IDs: %d · max_aid=%s · listing_ok=%s · loaded periods=%d · max_loaded=%s",
        len(seeds),
        max_aid,
        listing_ok,
        len(loaded),
        max(loaded) if loaded else None,
    )

    warn = freshness_report(seeds, loaded)
    if warn:
        log.warning("FRESHNESS: %s", warn)

    missing_seeds = [(aid, per) for aid, per in sorted(seeds.items()) if per not in loaded]
    if missing_seeds:
        log.info(
            "Missing seed/listing periods to load: %s",
            ", ".join(f"{aid}→{per}" for aid, per in missing_seeds[-12:]),
        )

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
            loaded.add(got_per)
            log.info("Loaded %s from articles-%s (%d files)", got_per, aid, n)

    # Cluster around newest seed + recent hub aids (xlsx pack siblings).
    # Skip AIDs we already mapped in seeds unless --force (avoids re-downloading
    # the current month ZIP on every healthy cron run).
    anchors = [max_aid]
    if hub_aids:
        anchors.extend(hub_aids[-8:])
    anchors.extend(aid for aid, _ in missing_seeds[-5:])
    extra = set(cluster_candidate_ids(anchors, CLUSTER_RADIUS_DEFAULT))
    extra.update(aid for aid, _ in missing_seeds)
    if not force:
        extra -= set(seeds.keys())

    effective_ahead = probe_ahead
    if listing_ok and not missing_seeds and not force:
        # Listing is the source of truth for published ZIP months. If every
        # listing period ≥ LISTING_MERGE_MIN_PERIOD is already in carga_log,
        # do not burn minutes probing CMS IDs that 404.
        log.info("Up to date vs CMF listing (max=%s) — skipping probe/cluster", max(seeds.values()))
        return loaded_count

    if listing_ok and probe_ahead == PROBE_AHEAD_DEFAULT:
        effective_ahead = PROBE_AHEAD_AFTER_LISTING
        log.info(
            "Listing OK with gaps — linear probe +%d · cluster extras=%d · missing_seeds=%d",
            effective_ahead,
            len(extra),
            len(missing_seeds),
        )

    found = discover_new_article_ids(max_aid, ahead=effective_ahead, extra_ids=extra)
    for aid, data in found:
        try:
            per = period_from_zip_bytes(data)
        except Exception as e:
            log.warning("Bad ZIP articles-%s: %s", aid, e)
            continue
        if not per:
            continue
        if per in loaded and not force:
            log.info("Probe/cluster hit articles-%s = %s (already loaded)", aid, per)
            continue
        if dry_run:
            log.info("[dry-run] would load articles-%s → %s", aid, per)
            continue
        got_per, n = load_zip_bytes(data, per, conn, force=force)
        if n:
            loaded_count += 1
            loaded.add(got_per)
            log.info("Loaded %s from articles-%s (%d files)", got_per, aid, n)

    # Re-check freshness after the run — fail the job if CMF is still ahead of DB.
    warn2 = freshness_report(seeds, loaded)
    if warn2 and not dry_run:
        log.error("FRESHNESS UNRESOLVED after run: %s", warn2)
        return -1
    return loaded_count


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description="ETL CMF Chile → CockroachDB")
    ap.add_argument("--article-id", type=int, default=None, help="Load one articles-{ID} ZIP")
    ap.add_argument("--zip-url", default="", help="Direct ZIP URL")
    ap.add_argument("--zip-path", default="", help="Local ZIP path")
    ap.add_argument("--period", default="", help="Optional YYYYMM override")
    ap.add_argument("--force", action="store_true", help="Overwrite periods already in carga_log")
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--discover-only", action="store_true", help="Scrape listings only (no DB writes)")
    ap.add_argument("--zips-dir", default=str(Path(__file__).parent / "zips"))
    ap.add_argument("--probe-ahead", type=int, default=PROBE_AHEAD_DEFAULT)
    args = ap.parse_args(argv)

    if args.discover_only:
        return run_discover_only(Path(args.zips_dir), args.probe_ahead)

    if not COCKROACH_URL and not args.dry_run:
        log.error("Missing COCKROACH_URL")
        return 2

    conn = None
    try:
        conn = get_connection()
    except Exception as e:
        if args.dry_run:
            log.warning("dry-run without DB (%s) — falling back to discover-only", e)
            return run_discover_only(Path(args.zips_dir), args.probe_ahead)
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
        if n < 0:
            log.error("Incremental finished with unresolved freshness gap")
            return 3
        log.info("Incremental finished · periods loaded this run: %d", n)
        return 0
    finally:
        if conn is not None:
            conn.close()


if __name__ == "__main__":
    sys.exit(main())
