#!/usr/bin/env python3
"""Offline unit tests for Chile CMF discovery parsers."""

from __future__ import annotations

import unittest
from pathlib import Path

from chile_loader import (
    cluster_candidate_ids,
    freshness_report,
    parse_listing_hub_aids,
    parse_listing_zip_articles,
    parse_period_from_cmf_title,
)

FIX = Path(__file__).parent / "fixtures"


class TestChileDiscovery(unittest.TestCase):
    def test_parse_period_from_title(self):
        self.assertEqual(
            parse_period_from_cmf_title("Balance y Estado de Situación Bancos Junio 2026"),
            "202606",
        )
        self.assertEqual(
            parse_period_from_cmf_title("Balance y Estado de Situación Bancos marzo 2026"),
            "202603",
        )
        self.assertIsNone(parse_period_from_cmf_title("sin mes"))

    def test_parse_listing_fixture(self):
        html = (FIX / "cmf_listing_32901_sample.html").read_text(encoding="utf-8")
        found = parse_listing_zip_articles(html)
        self.assertEqual(found.get(112240), "202606")
        self.assertEqual(found.get(111486), "202605")
        self.assertEqual(found.get(110154), "202603")  # hole previously missing from seed
        self.assertEqual(found.get(109125), "202602")
        self.assertIn(100161, found)

    def test_parse_hub_fixture(self):
        html = (FIX / "cmf_hub_28910_sample.html").read_text(encoding="utf-8")
        aids = parse_listing_hub_aids(html)
        self.assertIn(112230, aids)
        self.assertIn(112240, aids)
        self.assertEqual(max(aids), 112240)

    def test_cluster_radius(self):
        ids = cluster_candidate_ids([100], radius=2)
        self.assertEqual(ids, [98, 99, 100, 101, 102])

    def test_freshness_report(self):
        seeds = {1: "202605", 2: "202606"}
        self.assertIsNone(freshness_report(seeds, {"202606", "202605"}))
        msg = freshness_report(seeds, {"202605"})
        self.assertIsNotNone(msg)
        self.assertIn("202606", msg)


if __name__ == "__main__":
    unittest.main()
