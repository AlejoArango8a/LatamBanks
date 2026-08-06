#!/usr/bin/env python3
"""Tests for CNCB2021 dual-era CMF parsing + DE/PARA bridges."""

from __future__ import annotations

import unittest
import zipfile
from pathlib import Path

from cmf_loader import (
    is_cncb2021,
    load_depara,
    parse_cmf_amount,
    parse_codifis,
    parse_data_file,
    parse_plan_cuentas,
    process_zip,
)

ROOT = Path(__file__).resolve().parents[1]
ZIP_202112 = ROOT / "zips" / "articles-50166_recurso_1.zip"


class TestCncb2021Parse(unittest.TestCase):
    def test_era(self):
        self.assertTrue(is_cncb2021("202112"))
        self.assertFalse(is_cncb2021("202201"))

    def test_parse_amount_millions(self):
        self.assertEqual(parse_cmf_amount("0000026995865,00", scale=1_000_000), 26_995_865_000_000)
        self.assertEqual(parse_cmf_amount("-0000000237453,00", scale=1_000_000), -237_453_000_000)
        self.assertEqual(parse_cmf_amount("12345", scale=1), 12345)

    def test_plan_ctas(self):
        text = "2021\t12\t1000000\tACTIVOS\n2021\t12\t5100000\tTOTAL COLOCACIONES\n"
        plan = parse_plan_cuentas(text)
        self.assertEqual(plan["1000000"], "ACTIVOS")
        self.assertEqual(plan["5100000"], "TOTAL COLOCACIONES")

    def test_depara_loaded(self):
        bridges = load_depara()
        self.assertGreaterEqual(len(bridges), 10)
        targets = {b["target"] for b in bridges}
        self.assertIn("100000000", targets)
        self.assertIn("500000000", targets)
        self.assertIn("857000000", targets)

    @unittest.skipUnless(ZIP_202112.is_file(), "local dic-2021 ZIP not present")
    def test_parse_dic2021_zip_contents(self):
        with zipfile.ZipFile(ZIP_202112) as zf:
            plan_name = next(n for n in zf.namelist() if n.upper().endswith("PLAN-CTAS.TXT"))
            plan = parse_plan_cuentas(zf.read(plan_name).decode("latin-1"))
            self.assertIn("1000000", plan)
            self.assertIn("5100000", plan)
            self.assertTrue(plan["1000000"].strip())

            b1 = next(n for n in zf.namelist() if n.split("/")[-1].lower().startswith("b1202112001"))
            ins, data = parse_data_file(
                zf.read(b1).decode("latin-1"),
                "b1",
                scale=1_000_000,
                cncb2021=True,
            )
            self.assertEqual(ins, 1)
            self.assertIn("1000000", data)
            total = sum(data["1000000"])
            self.assertGreater(total, 10_000_000_000_000)  # ~51e12 pesos for BCH

            c1 = next(n for n in zf.namelist() if n.split("/")[-1].lower().startswith("c1202112001"))
            _, cdata = parse_data_file(
                zf.read(c1).decode("latin-1"),
                "c1",
                scale=1_000_000,
                cncb2021=True,
            )
            self.assertIn("8910000", cdata)
            self.assertGreater(cdata["8910000"], 0)

            cod = next(n for n in zf.namelist() if n.upper().endswith("CODIFIS.TXT"))
            inst = parse_codifis(zf.read(cod).decode("latin-1"))
            self.assertIn(1, inst)
            self.assertIn(59, inst)


if __name__ == "__main__":
    unittest.main()
