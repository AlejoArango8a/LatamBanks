#!/usr/bin/env python3
"""Tests for Chile Institutional Funding (FM DAP / bank bonds) loader."""

from __future__ import annotations

import json
from pathlib import Path

from chile_institutional_funding_loader import (
    INSTRUMENT_BUCKET,
    load_bank_rut_map,
    mv_to_clp,
    parse_bpr_menu,
    parse_naci_text,
    plan_labels_for_rows,
)

FIXTURE = Path(__file__).parent / "fixtures" / "ffm_inv_naci_sample.txt"
RUN_MAP = Path(__file__).parent / "fixtures" / "cl_fm_run_to_agf_sample.json"
BPR_CACHE = Path("/tmp/fm/bpr.html")


def test_instrument_buckets():
    assert INSTRUMENT_BUCKET["DPC"] == "DAP"
    assert INSTRUMENT_BUCKET["DPL"] == "DAP"
    assert INSTRUMENT_BUCKET["BB"] == "BB"


def test_mv_to_clp_miles_pesos():
    assert mv_to_clp(986858.0, "$$", uf=None, usd=None) == 986_858_000
    assert mv_to_clp(100.0, "UF", uf=38_000.0, usd=None) == 100 * 1000 * 38_000
    assert mv_to_clp(10.0, "PROM", uf=None, usd=900.0) == 10 * 1000 * 900
    assert mv_to_clp(10.0, "PROM", uf=None, usd=None) is None


def test_bank_rut_map_core_banks():
    m = load_bank_rut_map()
    assert m["97004000"] == 1
    assert m["97036000"] == 37
    assert m["97006000"] == 16
    assert m["76362099"] == 59
    assert "82878900" not in m  # Tanner Servicios Financieros (non-bank)


def test_parse_fixture_aggregates():
    text = FIXTURE.read_text(encoding="utf-8")
    run_to_agf = {str(k): str(v) for k, v in json.loads(RUN_MAP.read_text()).items()}
    bank_map = load_bank_rut_map()
    rows, stats = parse_naci_text(
        text,
        "202505",
        run_to_agf=run_to_agf,
        bank_rut_map=bank_map,
    )
    assert stats["rows_used"] > 50
    assert stats["agfs"] >= 5
    assert stats["banks"] >= 5
    assert stats["rows_unmapped_fund"] == 0

    by = {(r[2], r[3]): r[4] for r in rows}
    # sistema totals present
    assert (999, "CL_IF_DAP") in by
    assert (999, "CL_IF_BB") in by
    assert by[(999, "CL_IF_DAP")] > 0
    assert by[(999, "CL_IF_BB")] > 0

    # at least one bank stock
    bank_daps = [k for k in by if k[0] != 999 and k[1] == "CL_IF_DAP"]
    assert bank_daps

    # matrix grain on sistema
    matrix = [k for k in by if k[0] == 999 and "_BANK_" in k[1]]
    assert matrix

    labels = plan_labels_for_rows(rows)
    assert "CL_IF_DAP" in labels
    assert any(c.startswith("CL_IF_AGF_") for c in labels)


def test_parse_bpr_menu_if_cached():
    if not BPR_CACHE.exists():
        return
    html = BPR_CACHE.read_text(encoding="latin-1", errors="replace")
    agfs, run_to_agf = parse_bpr_menu(html)
    assert len(agfs) >= 15
    assert "8011" in run_to_agf  # VISION MONEY MARKET → Principal
    assert run_to_agf["8011"] == "91999000"
    assert any(a["rut"] == "96767630" for a in agfs)
