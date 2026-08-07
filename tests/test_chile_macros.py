#!/usr/bin/env python3
"""Tests for Chile macro indicator helpers."""

from __future__ import annotations

import json
from datetime import date
from pathlib import Path
from chile_macros_loader import (
    PLAN_LABELS,
    _ym_range,
    build_macro_rows,
    month_end_value,
)

FIXTURE = Path(__file__).parent / "fixtures" / "mindicador_api.json"


def test_ym_range():
    assert _ym_range("202601", "202603") == ["202601", "202602", "202603"]


def test_month_end_value():
    series = [
        (date(2026, 7, 1), 10.0),
        (date(2026, 7, 15), 11.0),
        (date(2026, 7, 31), 12.0),
        (date(2026, 8, 1), 13.0),
    ]
    assert month_end_value(series, 2026, 7) == 12.0


def test_mindicador_fixture_shape():
    data = json.loads(FIXTURE.read_text(encoding="utf-8"))
    assert "uf" in data and "dolar" in data and "ipc" in data
    assert data["uf"]["valor"] > 0


def test_build_macro_rows_uses_mindicador(monkeypatch):
    def fake_series(code, year=None):
        if code == "uf":
            return [(date(2026, 6, 30), 39000.12), (date(2026, 7, 31), 39111.5)]
        if code == "dolar":
            return [(date(2026, 6, 30), 900.0), (date(2026, 7, 31), 910.25)]
        if code == "ipc":
            return [(date(2026, 6, 1), 0.1), (date(2026, 7, 1), -0.2)]
        if code == "tpm":
            return [(date(2026, 6, 15), 4.75), (date(2026, 7, 15), 4.5)]
        if code == "utm":
            return [(date(2026, 6, 1), 70000), (date(2026, 7, 1), 71000)]
        return []

    monkeypatch.setattr("chile_macros_loader.fetch_mindicador_series", fake_series)
    monkeypatch.delenv("CMF_API_KEY", raising=False)
    rows = build_macro_rows("202606", "202607")
    by = {(r[0], r[3]): r[4] for r in rows}
    assert by[("202607", "CL_MACRO_UF")] == 3_911_150
    assert by[("202607", "CL_MACRO_USD")] == 91_025
    assert by[("202607", "CL_MACRO_IPC")] == -20
    assert by[("202607", "CL_MACRO_TPM")] == 450
    assert by[("202607", "CL_MACRO_UTM")] == 71_000
    assert set(PLAN_LABELS) >= {"CL_MACRO_UF", "CL_MACRO_USD", "CL_MACRO_TMC"}
