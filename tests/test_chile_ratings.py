#!/usr/bin/env python3
"""Tests for Chile Humphreys ratings scrape + merge."""

from __future__ import annotations

from pathlib import Path

from chile_ratings_loader import merge_ratings, parse_humphreys_html

FIXTURE = Path(__file__).parent / "fixtures" / "humphreys_if.html"


def test_parse_humphreys_active_banks():
    html = FIXTURE.read_text(encoding="utf-8", errors="replace")
    rows = parse_humphreys_html(html)
    active = [r for r in rows if r["active"]]
    names = {r["name"] for r in active}
    assert any("Banco de Chile" in n for n in names)
    assert any("Ripley" in n for n in names)
    assert any("Tanner" in n for n in names)
    # inactive BTG row should not be active
    assert not any(r["active"] and "BTG" in r["name"] for r in rows)


def test_merge_prefers_humphreys_outlook_for_tanner():
    html = FIXTURE.read_text(encoding="utf-8", errors="replace")
    payload = merge_ratings(parse_humphreys_html(html))
    assert payload["ratings"]["1"] == "AAA"
    assert payload["ratings"]["53"] == "AA-"
    assert payload["ratings"]["62"] == "AA-"
    assert payload["meta"]["62"]["outlook"] == "En Observación"
    assert payload["meta"]["1"]["humphreys"]["long_term"] == "AAA"
