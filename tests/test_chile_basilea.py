#!/usr/bin/env python3
"""Tests for Chile Basilea III xlsx parser / listing scrape."""

from __future__ import annotations

from pathlib import Path

import pytest

from chile_basilea_loader import (
    NAME_ALIASES,
    parse_basilea_listing,
    parse_basilea_xlsx,
    period_from_workbook,
)
from openpyxl import load_workbook

FIXTURE = Path(__file__).parent / "fixtures" / "cmf_basilea_mayo2026_sample.xlsx"
LISTING_SNIPPET = """
<div class="filtrar titulo visually-hidden articulo cid-528 aid-112239">
 Adecuación Consolidada de Capital Mayo 2026 </div>
<div class="filtrar titulo visually-hidden articulo cid-528 aid-111485">
 Adecuación Consolidada de Capital Abril 2026 </div>
<div class="filtrar titulo visually-hidden articulo cid-528 aid-99061">
 Adecuación Consolidada de Capital julio 2025 </div>
"""


def test_parse_basilea_listing_periods():
    found = parse_basilea_listing(LISTING_SNIPPET)
    assert found[112239] == "202605"
    assert found[111485] == "202604"
    assert found[99061] == "202507"


def test_fixture_period_and_ratios():
    data = FIXTURE.read_bytes()
    periodo, rows, unmatched = parse_basilea_xlsx(data, NAME_ALIASES)
    assert periodo == "202605"
    assert unmatched == []
    by = {(r[2], r[3]): r for r in rows}
    # BTG CET1/APR ≈ 14.814% → 1481 (percent×100)
    assert by[(59, "CL_B3_CET1_APR")][1] == "q1"
    assert by[(59, "CL_B3_CET1_APR")][4] == 1481
    assert by[(59, "CL_B3_PE_APR")][4] == 1968
    # Stocks in pesos
    assert by[(59, "CL_B3_CET1")][1] == "x1"
    assert by[(59, "CL_B3_CET1")][4] == 830990223164
    apr = by[(59, "CL_B3_APR")][4]
    assert abs(by[(59, "CL_B3_CET1")][4] / apr * 100 - 14.814) < 0.01
    # Sistema
    assert (999, "CL_B3_CET1_APR") in by


def test_period_from_workbook_title():
    wb = load_workbook(FIXTURE, data_only=True)
    assert period_from_workbook(wb) == "202605"


def test_banco_de_chile_codes():
    data = FIXTURE.read_bytes()
    _, rows, _ = parse_basilea_xlsx(data, NAME_ALIASES)
    bch = {r[3]: r[4] for r in rows if r[2] == 1}
    assert bch["CL_B3_CET1_APR"] == 1378
    assert bch["CL_B3_PE_APR"] == 1755
