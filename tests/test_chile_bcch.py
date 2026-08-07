#!/usr/bin/env python3
"""Tests for Chile BCCh Series bancarias CSV parser."""

from __future__ import annotations

from pathlib import Path

from chile_basilea_loader import NAME_ALIASES
from chile_bcch_loader import fecha_to_periodo, parse_bcch_zip, publication_url_for_lagged_month

FIXTURE = Path(__file__).parent / "fixtures" / "bcch_csv_sep2025_sample.zip"


def test_fecha_to_periodo():
    assert fecha_to_periodo("2025m9") == "202509"
    assert fecha_to_periodo("2025M09") == "202509"
    assert fecha_to_periodo("bad") is None


def test_parse_sample_zip_loans():
    rows, unmatched = parse_bcch_zip(FIXTURE.read_bytes(), NAME_ALIASES)
    assert "202509" in {r[0] for r in rows}
    by = {(r[2], r[3], r[0]): r[4] for r in rows}
    # Banco de Chile colocaciones totales ~43.022.577 millones → pesos
    assert by[(1, "CL_BCCH_LOANS", "202509")] == 43_022_577_000_000
    assert by[(16, "CL_BCCH_LOANS", "202509")] == 38_353_075_000_000
    assert by[(39, "CL_BCCH_LOANS", "202509")] == 24_383_932_000_000
    assert (999, "CL_BCCH_LOANS", "202509") in by
    # Closed banks without CMF map may appear; Deutsche is OK unmatched
    assert "Banco de Chile (2)" not in unmatched


def test_dep_me_requires_usd():
    rows, _ = parse_bcch_zip(FIXTURE.read_bytes(), NAME_ALIASES, usd_clp=None)
    assert not any(r[3] == "CL_BCCH_DEP_ME" for r in rows)
    rows2, _ = parse_bcch_zip(FIXTURE.read_bytes(), NAME_ALIASES, usd_clp=900.0)
    bch = [r for r in rows2 if r[2] == 1 and r[3] == "CL_BCCH_DEP_ME" and r[0] == "202509"]
    assert len(bch) == 1
    assert bch[0][4] == 5_908_569_840_000


def test_publication_url_pattern():
    per, url = publication_url_for_lagged_month()
    assert len(per) == 6
    assert "serie-de-datos-bancarios-" in url
    assert url.endswith(per[:4]) or per[:4] in url
