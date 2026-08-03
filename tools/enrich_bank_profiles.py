#!/usr/bin/env python3
"""
Build / refresh bank_profiles for every institution with equity in LatamBanks.

Priority (highest wins field-by-field when non-empty):
  1) data/bank_profiles_seed.json curated rows (deep research)
  2) Per-code LATAM_CATALOG overrides in this file
  3) FDIC BankFind (US)
  4) Multinational / cooperative / state name heuristics
  5) Country defaults (origin = analysis country, capital as HQ)

Live metrics (assets/equity/ROE) are NOT stored — API computes them.
"""
from __future__ import annotations

import json
import os
import re
import sys
import urllib.parse
import urllib.request
from pathlib import Path
from typing import Any

import psycopg2
from psycopg2.extras import Json

ROOT = Path(__file__).resolve().parents[1]
SEED_PATH = ROOT / "data" / "bank_profiles_seed.json"
UA = "LatamBanksProfileBot/1.0 (+https://latambanks.co; research)"

COUNTRY_META = {
    "CL": {"name": "Chile", "capital": "Santiago", "currency": "CLP"},
    "CO": {"name": "Colombia", "capital": "Bogotá", "currency": "COP"},
    "BR": {"name": "Brazil", "capital": "São Paulo", "currency": "BRL"},
    "PE": {"name": "Peru", "capital": "Lima", "currency": "PEN"},
    "UY": {"name": "Uruguay", "capital": "Montevideo", "currency": "UYU"},
    "AR": {"name": "Argentina", "capital": "Buenos Aires", "currency": "ARS"},
    "MX": {"name": "Mexico", "capital": "Mexico City", "currency": "MXN"},
    "PA": {"name": "Panama", "capital": "Panama City", "currency": "USD"},
    "US": {"name": "United States", "capital": None, "currency": "USD"},
}

ORIGIN_NAMES = {
    "CL": "Chile", "CO": "Colombia", "BR": "Brazil", "PE": "Peru", "UY": "Uruguay",
    "AR": "Argentina", "MX": "Mexico", "PA": "Panama", "US": "United States",
    "ES": "Spain", "CA": "Canada", "GB": "United Kingdom", "CN": "China",
    "FR": "France", "DE": "Germany", "CH": "Switzerland", "JP": "Japan",
    "KR": "South Korea", "NL": "Netherlands", "IT": "Italy", "EC": "Ecuador",
    "VE": "Venezuela", "HN": "Honduras", "CR": "Costa Rica", "TW": "Taiwan",
    "BE": "Belgium", "PT": "Portugal", "PY": "Paraguay", "BO": "Bolivia",
}

# Equity account map (same as API AMERICAS_SPECS)
EQUITY_SPEC = {
    "CL": ("b1", ["300000000"]),
    "CO": ("b1", ["300000"]),
    "BR": ("p", ["78186", "140246"]),
    "PE": ("b1", ["PATRIMONIO"]),
    "UY": ("b1", ["3"]),
    "US": ("b1", ["EQTOT"]),
    "AR": ("b1", ["PATRIMONIO_NETO"]),
    "MX": ("b1", ["CAPITAL_CONTABLE"]),
    "PA": ("b1", ["PATRIMONIO"]),
}

FDIC_SPECGRP = {
    1: "International specialty bank",
    2: "Agricultural specialty bank",
    3: "Credit-card specialty bank",
    4: "Commercial lending specialty",
    5: "Mortgage lending specialty",
    6: "Consumer lending specialty",
    7: "Other specialty / diversified commercial bank",
    8: "Mortgage specialty",
    9: "Commercial lenders",
}

# ---------------------------------------------------------------------------
# Multinational / ownership patterns (applied to display name)
# ---------------------------------------------------------------------------
NAME_RULES: list[tuple[re.Pattern, dict[str, Any]]] = [
    (re.compile(r"\bsantander\b", re.I), {
        "origin_country": "ES", "controlling": "Banco Santander S.A. (Spain)",
        "ownership": "Subsidiary / affiliate of Banco Santander (Spain)",
        "business_focus": "Universal commercial banking under the Santander brand",
    }),
    (re.compile(r"\bbbva\b|bilbao\s+vizcaya", re.I), {
        "origin_country": "ES", "controlling": "BBVA (Spain)",
        "ownership": "Subsidiary / affiliate of BBVA (Spain)",
        "business_focus": "Universal commercial banking under the BBVA brand",
    }),
    (re.compile(r"scotiabank|bank of nova scotia|colpatria", re.I), {
        "origin_country": "CA", "controlling": "The Bank of Nova Scotia",
        "ownership": "Subsidiary / affiliate of Scotiabank (Canada)",
        "business_focus": "Universal commercial banking under the Scotiabank brand",
    }),
    (re.compile(r"\bhsbc\b", re.I), {
        "origin_country": "GB", "controlling": "HSBC Holdings plc",
        "ownership": "Subsidiary / affiliate of HSBC",
        "business_focus": "Commercial and retail banking under the HSBC brand",
    }),
    (re.compile(r"citibank|\bciti\b|citigroup|banamex", re.I), {
        "origin_country": "US", "controlling": "Citigroup Inc.",
        "ownership": "Subsidiary / affiliate of Citigroup (United States)",
        "business_focus": "Corporate, commercial and/or consumer banking (Citi franchise)",
    }),
    (re.compile(r"jp\s*morgan|jpmorgan|chase\b", re.I), {
        "origin_country": "US", "controlling": "JPMorgan Chase & Co.",
        "ownership": "Subsidiary / branch of JPMorgan Chase",
        "business_focus": "Wholesale / corporate and investment banking",
    }),
    (re.compile(r"bank of america|\bbofa\b|merrill lynch", re.I), {
        "origin_country": "US", "controlling": "Bank of America Corporation",
        "ownership": "Subsidiary / affiliate of Bank of America",
        "business_focus": "Corporate and investment banking / capital markets",
    }),
    (re.compile(r"goldman\s*sachs", re.I), {
        "origin_country": "US", "controlling": "Goldman Sachs Group",
        "ownership": "Subsidiary of Goldman Sachs",
        "business_focus": "Investment banking, markets and private banking",
    }),
    (re.compile(r"morgan\s*stanley", re.I), {
        "origin_country": "US", "controlling": "Morgan Stanley",
        "ownership": "Subsidiary of Morgan Stanley",
        "business_focus": "Investment banking, wealth and capital markets",
    }),
    (re.compile(r"\bitau\b|itaú", re.I), {
        "origin_country": "BR", "controlling": "Itaú Unibanco",
        "ownership": "Subsidiary / affiliate of Itaú Unibanco (Brazil)",
        "business_focus": "Universal commercial banking under the Itaú brand",
    }),
    (re.compile(r"btg\s*pactual", re.I), {
        "origin_country": "BR", "controlling": "BTG Pactual",
        "ownership": "Subsidiary / affiliate of BTG Pactual (Brazil)",
        "business_focus": "Investment banking, wealth and corporate banking",
    }),
    (re.compile(r"bradesco", re.I), {
        "origin_country": "BR", "controlling": "Banco Bradesco S.A.",
        "ownership": "Subsidiary / affiliate of Bradesco (Brazil)",
        "business_focus": "Universal banking and insurance adjacency",
    }),
    (re.compile(r"\bicbc\b|industrial and commercial bank of china", re.I), {
        "origin_country": "CN", "controlling": "ICBC",
        "ownership": "Subsidiary / branch of Industrial and Commercial Bank of China",
        "business_focus": "Corporate and trade finance (Chinese state bank franchise)",
    }),
    (re.compile(r"bank of china", re.I), {
        "origin_country": "CN", "controlling": "Bank of China",
        "ownership": "Branch / subsidiary of Bank of China",
        "business_focus": "Corporate, trade and cross-border banking",
    }),
    (re.compile(r"china construction bank|\bccb\b", re.I), {
        "origin_country": "CN", "controlling": "China Construction Bank",
        "ownership": "Branch / subsidiary of China Construction Bank",
        "business_focus": "Corporate and trade finance",
    }),
    (re.compile(r"\bbnp\b|paribas", re.I), {
        "origin_country": "FR", "controlling": "BNP Paribas",
        "ownership": "Subsidiary / affiliate of BNP Paribas (France)",
        "business_focus": "Corporate and investment banking",
    }),
    (re.compile(r"deutsche\s*bank", re.I), {
        "origin_country": "DE", "controlling": "Deutsche Bank",
        "ownership": "Subsidiary / affiliate of Deutsche Bank (Germany)",
        "business_focus": "Corporate and investment banking",
    }),
    (re.compile(r"barclays", re.I), {
        "origin_country": "GB", "controlling": "Barclays",
        "ownership": "Subsidiary / affiliate of Barclays (UK)",
        "business_focus": "Corporate and investment banking",
    }),
    (re.compile(r"credit\s*suisse|\bubs\b", re.I), {
        "origin_country": "CH", "controlling": "UBS Group",
        "ownership": "Subsidiary / affiliate of UBS (Switzerland)",
        "business_focus": "Wealth, markets and investment banking",
    }),
    (re.compile(r"credit\s*agricole", re.I), {
        "origin_country": "FR", "controlling": "Crédit Agricole",
        "ownership": "Subsidiary / affiliate of Crédit Agricole (France)",
        "business_focus": "Corporate and investment banking",
    }),
    (re.compile(r"societe\s*generale|société\s*générale", re.I), {
        "origin_country": "FR", "controlling": "Société Générale",
        "ownership": "Subsidiary / affiliate of Société Générale (France)",
        "business_focus": "Corporate and investment banking",
    }),
    (re.compile(r"rabobank", re.I), {
        "origin_country": "NL", "controlling": "Rabobank",
        "ownership": "Subsidiary of Rabobank (Netherlands)",
        "business_focus": "Corporate, agribusiness and wholesale banking",
    }),
    (re.compile(r"mizuho", re.I), {
        "origin_country": "JP", "controlling": "Mizuho Financial Group",
        "ownership": "Subsidiary of Mizuho (Japan)",
        "business_focus": "Corporate and wholesale banking",
    }),
    (re.compile(r"\bmufg\b|mitsubishi", re.I), {
        "origin_country": "JP", "controlling": "MUFG Bank",
        "ownership": "Subsidiary of MUFG (Japan)",
        "business_focus": "Corporate and wholesale banking",
    }),
    (re.compile(r"sumitomo|smbc|mitsui", re.I), {
        "origin_country": "JP", "controlling": "Sumitomo Mitsui Banking Corporation",
        "ownership": "Subsidiary of SMBC (Japan)",
        "business_focus": "Corporate and wholesale banking",
    }),
    (re.compile(r"keb\s*hana|hana\s*bank", re.I), {
        "origin_country": "KR", "controlling": "KEB Hana Bank",
        "ownership": "Subsidiary / branch of KEB Hana (South Korea)",
        "business_focus": "Corporate and trade banking",
    }),
    (re.compile(r"shinhan", re.I), {
        "origin_country": "KR", "controlling": "Shinhan Bank",
        "ownership": "Subsidiary of Shinhan (South Korea)",
        "business_focus": "Corporate and retail banking",
    }),
    (re.compile(r"pichincha", re.I), {
        "origin_country": "EC", "controlling": "Banco Pichincha (Ecuador)",
        "ownership": "Affiliate of Banco Pichincha group (Ecuador)",
        "business_focus": "Retail and commercial banking",
    }),
    (re.compile(r"falabella", re.I), {
        "origin_country": "CL", "controlling": "Falabella / Banco Falabella group",
        "ownership": "Banking unit of the Falabella retail group (Chile)",
        "business_focus": "Consumer and retail banking linked to Falabella ecosystem",
    }),
    (re.compile(r"\bripley\b", re.I), {
        "origin_country": "CL", "controlling": "Ripley group",
        "ownership": "Banking unit of the Ripley retail group",
        "business_focus": "Consumer / retail banking",
    }),
    (re.compile(r"banesco", re.I), {
        "origin_country": "VE", "controlling": "Banesco group",
        "ownership": "Affiliate of Banesco (Venezuela-origin group)",
        "business_focus": "Retail and commercial banking",
    }),
    (re.compile(r"davivienda", re.I), {
        "origin_country": "CO", "controlling": "Grupo Empresarial Bolívar",
        "ownership": "Affiliate of Davivienda / Grupo Bolívar (Colombia)",
        "business_focus": "Universal retail and commercial banking",
    }),
    (re.compile(r"bancolombia|cibest", re.I), {
        "origin_country": "CO", "controlling": "Grupo Cibest / Bancolombia group",
        "ownership": "Affiliate of Bancolombia / Grupo Cibest (Colombia)",
        "business_focus": "Universal banking",
    }),
    (re.compile(r"banco de bogot[aá]|banco de bogota", re.I), {
        "origin_country": "CO", "controlling": "Grupo Aval",
        "ownership": "Affiliate of Banco de Bogotá / Grupo Aval (Colombia)",
        "business_focus": "Universal banking",
    }),
    (re.compile(r"\bbac\b|bac international|bac credomatic", re.I), {
        "origin_country": "CO", "controlling": "Grupo Aval / BAC Credomatic",
        "ownership": "BAC International / Credomatic franchise (Aval group)",
        "business_focus": "Regional retail and commercial banking (Central America)",
    }),
    (re.compile(r"gnb\s*sudameris|\bgnb\b", re.I), {
        "origin_country": "CO", "controlling": "Gilex Holding / Gilinski group",
        "ownership": "Controlled by the Gilinski group (GNB Sudameris)",
        "business_focus": "Universal commercial banking",
    }),
    (re.compile(r"sabadell", re.I), {
        "origin_country": "ES", "controlling": "Banco Sabadell",
        "ownership": "Affiliate of Banco Sabadell (Spain)",
        "business_focus": "Commercial and corporate banking",
    }),
    (re.compile(r"openbank", re.I), {
        "origin_country": "ES", "controlling": "Banco Santander / Openbank",
        "ownership": "Digital bank affiliate of Santander Group",
        "business_focus": "Digital retail banking",
    }),
    (re.compile(r"\bual[aá]\b", re.I), {
        "origin_country": "AR", "controlling": "Ualá",
        "ownership": "Digital finance group Ualá (Argentina-origin)",
        "business_focus": "Digital banking / fintech banking license",
    }),
    (re.compile(r"revolut", re.I), {
        "origin_country": "GB", "controlling": "Revolut",
        "ownership": "Affiliate of Revolut (UK-origin fintech)",
        "business_focus": "Digital banking",
    }),
    (re.compile(r"volkswagen|stellantis|honda|volvo|mercedes|gm\b|cnh|paccar", re.I), {
        "origin_country": None,  # keep analysis country unless set
        "controlling": "Captive auto / equipment finance affiliate",
        "ownership": "Captive finance bank of an industrial/auto group",
        "business_focus": "Vehicle / equipment captive financing",
    }),
    (re.compile(r"cooperativ|sicoob|sicredi|credicoop|coops?", re.I), {
        "ownership": "Cooperative / mutual financial institution",
        "controlling": "Member-owned cooperative structure",
        "business_focus": "Cooperative credit — retail, SME and associated members",
    }),
    (re.compile(r"hipotecario|hipotecaria|mortgage", re.I), {
        "business_focus": "Mortgage / housing finance specialty",
    }),
    (re.compile(r"\bip\b|pagamentos|pagseguro|mercado pago|stone ip|cielo|sumup|cloudwalk|fiserv|sem parar|pagueveloz", re.I), {
        "business_focus": "Payments institution / acquiring / digital payments (IF.data prudential perimeter)",
        "ownership": "Payments / fintech institution (may not be a full commercial bank)",
    }),
]


# ---------------------------------------------------------------------------
# Deep per-code catalog for LatAm equity banks (fills gaps beyond seed)
# Only fields that improve on heuristics; merge is sparse-friendly.
# ---------------------------------------------------------------------------
LATAM_CATALOG: dict[tuple[str, int], dict[str, Any]] = {
    # Chile extras
    ("CL", 28): {"short_name": "BICE", "legal_name": "Banco BICE", "founded": "1947",
                 "controlling": "Grupo Matte / related holdings", "hq_city": "Santiago",
                 "origin_country": "CL", "business_focus": "Corporate, private banking and commercial banking",
                 "history": "Chilean bank associated with the Matte group; oriented to corporate and high-net-worth clients."},
    ("CL", 51): {"short_name": "Banco Falabella", "founded": "1998 (banking franchise)",
                 "hq_city": "Santiago", "origin_country": "CL"},
    ("CL", 55): {"short_name": "Banco Consorcio", "legal_name": "Banco Consorcio",
                 "controlling": "Consorcio Financiero", "hq_city": "Santiago", "origin_country": "CL",
                 "business_focus": "Commercial and retail banking linked to Consorcio insurance group",
                 "founded": "2002 (banking license path)"},
    ("CL", 9): {"short_name": "Banco Internacional", "hq_city": "Santiago", "origin_country": "CL",
                "business_focus": "Corporate and commercial banking",
                "controlling": "Private Chilean shareholders"},
    ("CL", 53): {"short_name": "Banco Ripley", "hq_city": "Santiago", "origin_country": "CL"},
    ("CL", 62): {"short_name": "Tanner Banco Digital", "hq_city": "Santiago", "origin_country": "CL",
                 "controlling": "Tanner group", "business_focus": "Digital / specialty commercial bank",
                 "founded": "2020s (digital banking license)"},
    ("CL", 41): {"short_name": "J.P. Morgan Chile", "hq_city": "Santiago", "origin_country": "US"},
    ("CL", 31): {"short_name": "HSBC Chile", "hq_city": "Santiago", "origin_country": "GB"},
    ("CL", 60): {"short_name": "CCB Chile", "hq_city": "Santiago", "origin_country": "CN"},
    ("CL", 61): {"short_name": "Bank of China Chile", "hq_city": "Santiago", "origin_country": "CN"},

    # Colombia extras
    ("CO", 23): {"short_name": "Banco de Occidente", "founded": "1965", "hq_city": "Cali",
                 "origin_country": "CO", "controlling": "Grupo Aval",
                 "ownership": "Public; controlled by Grupo Aval",
                 "business_focus": "Universal bank (Aval group) — retail, commercial, corporate",
                 "history": "Aval-group bank headquartered in Cali; peer of Bogotá, Popular and AV Villas inside Aval."},
    ("CO", 2): {"short_name": "Banco Popular", "hq_city": "Bogotá", "origin_country": "CO",
                "controlling": "Grupo Aval", "ownership": "Grupo Aval",
                "business_focus": "Retail and payroll-oriented commercial banking (Aval)"},
    ("CO", 49): {"short_name": "AV Villas", "hq_city": "Bogotá", "origin_country": "CO",
                 "controlling": "Grupo Aval", "business_focus": "Retail commercial banking (Aval)"},
    ("CO", 43): {"short_name": "Banco Agrario", "founded": "1999 (from Caja Agraria heritage)",
                 "hq_city": "Bogotá", "origin_country": "CO",
                 "ownership": "State-owned", "controlling": "Republic of Colombia",
                 "business_focus": "Agricultural and rural development banking",
                 "history": "Public bank focused on agribusiness and rural credit; successor franchise to Caja Agraria."},
    ("CO", 12): {"short_name": "GNB Sudameris", "hq_city": "Bogotá", "origin_country": "CO",
                 "controlling": "Gilinski group / Gilex Holding",
                 "business_focus": "Universal commercial banking"},
    ("CO", 42): {"short_name": "Scotiabank Colpatria", "hq_city": "Bogotá", "origin_country": "CA"},
    ("CO", 6): {"short_name": "Itaú Colombia", "hq_city": "Bogotá", "origin_country": "BR"},
    ("CO", 30): {"short_name": "Banco Caja Social", "hq_city": "Bogotá", "origin_country": "CO",
                 "controlling": "Fundación Social", "ownership": "Controlled by Fundación Social",
                 "business_focus": "Retail banking with social / mass-market focus", "founded": "1911"},
    ("CO", 9): {"short_name": "Citibank Colombia", "hq_city": "Bogotá", "origin_country": "US"},
    ("CO", 64): {"short_name": "J.P. Morgan Colombia", "hq_city": "Bogotá", "origin_country": "US"},
    ("CO", 59): {"short_name": "Santander Colombia", "hq_city": "Bogotá", "origin_country": "ES"},
    ("CO", 56): {"short_name": "Banco Falabella Colombia", "hq_city": "Bogotá", "origin_country": "CL"},
    ("CO", 54): {"short_name": "Banco Coomeva", "hq_city": "Cali", "origin_country": "CO",
                 "ownership": "Cooperative-linked (Coomeva)", "controlling": "Coomeva cooperative ecosystem",
                 "business_focus": "Cooperative-linked commercial banking"},
    ("CO", 57): {"short_name": "Banco Pichincha Colombia", "hq_city": "Bogotá", "origin_country": "EC"},
    ("CO", 53): {"short_name": "Banco W", "hq_city": "Cali", "origin_country": "CO",
                 "business_focus": "Microfinance / SME-oriented bank", "controlling": "Private / Fundación WWB heritage"},
    ("CO", 62): {"short_name": "Mi Banco", "hq_city": "Bogotá", "origin_country": "CO",
                 "business_focus": "Microfinance and mass retail banking"},
    ("CO", 60): {"short_name": "Banco Mundo Mujer", "hq_city": "Popayán", "origin_country": "CO",
                 "business_focus": "Microfinance focused on women entrepreneurs",
                 "controlling": "Fundación Mundo Mujer"},
    ("CO", 52): {"short_name": "Bancamía", "hq_city": "Bogotá", "origin_country": "CO",
                 "business_focus": "Microfinance", "controlling": "Fundación BBVA Microfinanzas / related"},
    ("CO", 55): {"short_name": "Finandina", "hq_city": "Bogotá", "origin_country": "CO",
                 "business_focus": "Consumer and vehicle finance specialty bank"},
    ("CO", 65): {"short_name": "Lulo Bank", "hq_city": "Bogotá", "origin_country": "CO",
                 "business_focus": "Digital retail bank", "founded": "2021",
                 "controlling": "Grupo Bolívar", "ownership": "Digital bank of Grupo Bolívar"},
    ("CO", 63): {"short_name": "Serfinanza", "hq_city": "Barranquilla", "origin_country": "CO",
                 "business_focus": "Consumer finance / commercial bank"},
    ("CO", 58): {"short_name": "Coopcentral", "hq_city": "Bogotá", "origin_country": "CO",
                 "ownership": "Cooperative", "business_focus": "Cooperative central bank"},
    ("CO", 51): {"short_name": "Bancién", "hq_city": "Bogotá", "origin_country": "CO",
                 "business_focus": "Niche commercial bank"},
    ("CO", 67): {"short_name": "Banco Unión", "hq_city": "Bogotá", "origin_country": "CO"},
    ("CO", 68): {"short_name": "Banco Contactar", "hq_city": "Bogotá", "origin_country": "CO",
                 "business_focus": "Microfinance / specialty bank"},

    # Peru
    ("PE", 1): {"short_name": "BBVA Perú", "hq_city": "Lima", "origin_country": "ES",
                "founded": "BBVA Continental franchise", "business_focus": "Universal bank"},
    ("PE", 6): {"short_name": "Scotiabank Perú", "hq_city": "Lima", "origin_country": "CA"},
    ("PE", 8): {"short_name": "Interbank", "legal_name": "Banco Internacional del Perú (Interbank)",
                "hq_city": "Lima", "origin_country": "PE", "founded": "1897 / modern Interbank",
                "controlling": "Intercorp", "ownership": "Subsidiary of Intercorp Financial Services",
                "business_focus": "Universal retail and commercial bank",
                "history": "Major private Peruvian bank under Intercorp; strong retail and credit-card franchise."},
    ("PE", 9): {"short_name": "Mibanco", "hq_city": "Lima", "origin_country": "PE",
                "controlling": "Credicorp / BCP group", "business_focus": "Microfinance and SME banking",
                "history": "Leading Peruvian microfinance bank; part of the Credicorp ecosystem."},
    ("PE", 5): {"short_name": "BanBif", "legal_name": "Banco Interamericano de Finanzas",
                "hq_city": "Lima", "origin_country": "PE", "business_focus": "Commercial and corporate banking"},
    ("PE", 12): {"short_name": "Santander Perú", "hq_city": "Lima", "origin_country": "ES"},
    ("PE", 4): {"short_name": "Banco Pichincha Perú", "hq_city": "Lima", "origin_country": "EC"},
    ("PE", 18): {"short_name": "Compartamos Banco", "hq_city": "Lima", "origin_country": "MX",
                 "controlling": "Gentera / Compartamos", "business_focus": "Microfinance"},
    ("PE", 11): {"short_name": "Banco Falabella Perú", "hq_city": "Lima", "origin_country": "CL"},
    ("PE", 7): {"short_name": "Citibank Perú", "hq_city": "Lima", "origin_country": "US"},
    ("PE", 17): {"short_name": "BCI Perú", "hq_city": "Lima", "origin_country": "CL",
                 "controlling": "BCI (Chile)", "business_focus": "Commercial banking"},
    ("PE", 10): {"short_name": "Banco GNB Perú", "hq_city": "Lima", "origin_country": "CO"},
    ("PE", 19): {"short_name": "Santander Consumer Perú", "hq_city": "Lima", "origin_country": "ES",
                 "business_focus": "Consumer finance"},
    ("PE", 15): {"short_name": "ICBC Perú", "hq_city": "Lima", "origin_country": "CN"},
    ("PE", 13): {"short_name": "Banco Ripley Perú", "hq_city": "Lima", "origin_country": "CL"},
    ("PE", 2): {"short_name": "BANCOM", "hq_city": "Lima", "origin_country": "PE",
                "ownership": "State-linked development / specialty bank",
                "business_focus": "Development / specialty banking"},
    ("PE", 16): {"short_name": "Bank of China Perú", "hq_city": "Lima", "origin_country": "CN"},
    ("PE", 14): {"short_name": "Alfin Banco", "hq_city": "Lima", "origin_country": "PE",
                 "business_focus": "Specialty / consumer banking"},

    # Uruguay
    ("UY", 91): {"short_name": "BHU", "legal_name": "Banco Hipotecario del Uruguay",
                 "founded": "1892", "hq_city": "Montevideo", "origin_country": "UY",
                 "ownership": "State-owned", "controlling": "Oriental Republic of Uruguay",
                 "business_focus": "Mortgage and housing finance (public bank)"},
    ("UY", 113): {"short_name": "Itaú Uruguay", "hq_city": "Montevideo", "origin_country": "BR"},
    ("UY", 137): {"short_name": "Santander Uruguay", "hq_city": "Montevideo", "origin_country": "ES"},
    ("UY", 153): {"short_name": "BBVA Uruguay", "hq_city": "Montevideo", "origin_country": "ES"},
    ("UY", 128): {"short_name": "Scotiabank Uruguay", "hq_city": "Montevideo", "origin_country": "CA"},
    ("UY", 205): {"short_name": "Citibank Uruguay", "hq_city": "Montevideo", "origin_country": "US"},
    ("UY", 162): {"short_name": "Banque Heritage", "hq_city": "Montevideo", "origin_country": "CH",
                  "controlling": "Heritage group (Switzerland-origin private bank)",
                  "business_focus": "Private banking and wealth"},
    ("UY", 110): {"short_name": "Bandes Uruguay", "hq_city": "Montevideo", "origin_country": "VE",
                  "controlling": "BANDES (Venezuela)", "business_focus": "Commercial banking"},
    ("UY", 246): {"short_name": "Banco Nación (UY branch)", "hq_city": "Montevideo", "origin_country": "AR",
                  "controlling": "Banco de la Nación Argentina", "business_focus": "Branch of Argentine public bank"},

    # Argentina (top + notable)
    ("AR", 11): {"short_name": "Banco Nación", "founded": "1891", "hq_city": "Buenos Aires",
                 "origin_country": "AR", "ownership": "State-owned", "controlling": "Argentine Republic",
                 "business_focus": "Public universal bank with nationwide coverage"},
    ("AR", 7): {"short_name": "Banco Galicia", "founded": "1905", "hq_city": "Buenos Aires",
                "origin_country": "AR", "controlling": "Grupo Financiero Galicia"},
    ("AR", 285): {"short_name": "Banco Macro", "founded": "1985", "hq_city": "Buenos Aires",
                  "origin_country": "AR", "controlling": "Controlling shareholders around Brito / Stanley interests",
                  "business_focus": "Universal private bank with strong interior franchise",
                  "ownership": "Public (BYMA / NYSE ADR)"},
    ("AR", 72): {"short_name": "Santander Argentina", "hq_city": "Buenos Aires", "origin_country": "ES"},
    ("AR", 14): {"short_name": "Banco Provincia", "legal_name": "Banco de la Provincia de Buenos Aires",
                 "founded": "1822", "hq_city": "La Plata", "origin_country": "AR",
                 "ownership": "Province of Buenos Aires", "controlling": "Provincia de Buenos Aires",
                 "business_focus": "Public provincial universal bank"},
    ("AR", 17): {"short_name": "BBVA Argentina", "hq_city": "Buenos Aires", "origin_country": "ES"},
    ("AR", 191): {"short_name": "Credicoop", "hq_city": "Buenos Aires", "origin_country": "AR",
                  "ownership": "Cooperative", "controlling": "Member cooperative structure",
                  "business_focus": "Cooperative universal banking", "founded": "1979"},
    ("AR", 15): {"short_name": "ICBC Argentina", "hq_city": "Buenos Aires", "origin_country": "CN"},
    ("AR", 16): {"short_name": "Citibank Argentina", "hq_city": "Buenos Aires", "origin_country": "US"},
    ("AR", 29): {"short_name": "Banco Ciudad", "founded": "1878", "hq_city": "Buenos Aires",
                 "origin_country": "AR", "ownership": "City of Buenos Aires",
                 "controlling": "Ciudad Autónoma de Buenos Aires",
                 "business_focus": "Public municipal / city bank"},
    ("AR", 34): {"short_name": "Banco Patagonia", "hq_city": "Buenos Aires", "origin_country": "BR",
                 "controlling": "Banco do Brasil", "ownership": "Controlled by Banco do Brasil",
                 "business_focus": "Universal commercial bank"},
    ("AR", 20): {"short_name": "Bancor", "legal_name": "Banco de la Provincia de Córdoba",
                 "hq_city": "Córdoba", "origin_country": "AR", "ownership": "Province of Córdoba",
                 "controlling": "Provincia de Córdoba"},
    ("AR", 27): {"short_name": "Supervielle", "hq_city": "Buenos Aires", "origin_country": "AR",
                 "ownership": "Public", "business_focus": "Universal private bank"},
    ("AR", 300): {"short_name": "BICE", "legal_name": "Banco de Inversión y Comercio Exterior",
                  "hq_city": "Buenos Aires", "origin_country": "AR",
                  "ownership": "State-linked development bank",
                  "business_focus": "Investment / foreign-trade development banking"},
    ("AR", 44): {"short_name": "Banco Hipotecario", "hq_city": "Buenos Aires", "origin_country": "AR",
                 "business_focus": "Mortgage and commercial banking", "ownership": "Public / mixed"},
    ("AR", 143): {"short_name": "Brubank", "hq_city": "Buenos Aires", "origin_country": "AR",
                  "business_focus": "Digital bank", "controlling": "Banco de Valores / related"},
    ("AR", 384): {"short_name": "Ualá Bank", "hq_city": "Buenos Aires", "origin_country": "AR"},
    ("AR", 165): {"short_name": "J.P. Morgan Argentina", "hq_city": "Buenos Aires", "origin_country": "US"},
    ("AR", 266): {"short_name": "BNP Paribas Argentina", "hq_city": "Buenos Aires", "origin_country": "FR"},
    ("AR", 131): {"short_name": "Bank of China Argentina", "hq_city": "Buenos Aires", "origin_country": "CN"},
    ("AR", 269): {"short_name": "BROU (AR branch)", "hq_city": "Buenos Aires", "origin_country": "UY",
                  "controlling": "BROU", "business_focus": "Branch of Uruguay’s public bank"},
    ("AR", 331): {"short_name": "Cetelem Argentina", "hq_city": "Buenos Aires", "origin_country": "FR",
                  "controlling": "BNP Paribas Personal Finance", "business_focus": "Consumer finance"},
    ("AR", 339): {"short_name": "RCI Banque", "hq_city": "Buenos Aires", "origin_country": "FR",
                  "business_focus": "Captive auto finance (Renault/Nissan group)"},
    ("AR", 332): {"short_name": "Carrefour Bank AR", "hq_city": "Buenos Aires", "origin_country": "FR",
                  "business_focus": "Consumer finance linked to retailer"},

    # Mexico
    ("MX", 36): {"short_name": "Inbursa", "legal_name": "Banco Inbursa", "hq_city": "Mexico City",
                 "origin_country": "MX", "controlling": "Grupo Financiero Inbursa / Slim family interests",
                 "ownership": "Public (GFINBUR)", "business_focus": "Universal bank with strong corporate franchise",
                 "founded": "1992"},
    ("MX", 2): {"short_name": "Banamex", "hq_city": "Mexico City", "origin_country": "US",
                "controlling": "Citigroup (historical Banamex franchise; verify latest ownership path)",
                "business_focus": "Universal bank", "founded": "1884"},
    ("MX", 14): {"short_name": "Santander México", "hq_city": "Mexico City", "origin_country": "ES"},
    ("MX", 44): {"short_name": "Scotiabank México", "hq_city": "Mexico City", "origin_country": "CA"},
    ("MX", 21): {"short_name": "HSBC México", "hq_city": "Mexico City", "origin_country": "GB"},
    ("MX", 9): {"short_name": "Citi México", "hq_city": "Mexico City", "origin_country": "US"},
    ("MX", 127): {"short_name": "Banco Azteca", "hq_city": "Mexico City", "origin_country": "MX",
                  "controlling": "Grupo Salinas", "founded": "2002",
                  "business_focus": "Mass retail / consumer banking linked to Grupo Salinas"},
    ("MX", 30): {"short_name": "BanBajío", "hq_city": "León", "origin_country": "MX",
                 "business_focus": "Regional universal bank (Bajío)", "ownership": "Public"},
    ("MX", 86): {"short_name": "J.P. Morgan México", "hq_city": "Mexico City", "origin_country": "US"},
    ("MX", 58): {"short_name": "Banregio", "hq_city": "Monterrey", "origin_country": "MX",
                 "business_focus": "Regional commercial bank (north Mexico)", "ownership": "Public (GFREGIO)"},
    ("MX", 137): {"short_name": "BanCoppel", "hq_city": "Mexico City", "origin_country": "MX",
                  "controlling": "Grupo Coppel", "business_focus": "Consumer / retail banking"},
    ("MX", 130): {"short_name": "Compartamos", "hq_city": "Mexico City", "origin_country": "MX",
                  "controlling": "Gentera", "business_focus": "Microfinance"},
    ("MX", 5866): {"short_name": "Sabadell México", "hq_city": "Mexico City", "origin_country": "ES"},
    ("MX", 7888): {"short_name": "MUFG Bank México", "hq_city": "Mexico City", "origin_country": "JP"},
    ("MX", 4987): {"short_name": "Barclays México", "hq_city": "Mexico City", "origin_country": "GB"},
    ("MX", 8860): {"short_name": "BNP Paribas México", "hq_city": "Mexico City", "origin_country": "FR"},
    ("MX", 1106): {"short_name": "Mizuho México", "hq_city": "Mexico City", "origin_country": "JP"},
    ("MX", 4781): {"short_name": "Openbank México", "hq_city": "Mexico City", "origin_country": "ES"},
    ("MX", 1745): {"short_name": "Bank of China México", "hq_city": "Mexico City", "origin_country": "CN"},
    ("MX", 4510): {"short_name": "ICBC México", "hq_city": "Mexico City", "origin_country": "CN"},
    ("MX", 4126): {"short_name": "Revolut Bank México", "hq_city": "Mexico City", "origin_country": "GB"},
    ("MX", 5400): {"short_name": "Ualá México", "hq_city": "Mexico City", "origin_country": "AR"},
    ("MX", 1538): {"short_name": "Bineo", "hq_city": "Mexico City", "origin_country": "MX",
                   "controlling": "Banorte group", "business_focus": "Digital bank"},
    ("MX", 8690): {"short_name": "Hey Banco", "hq_city": "Monterrey", "origin_country": "MX",
                   "controlling": "Banregio group", "business_focus": "Digital bank"},
    ("MX", 1160): {"short_name": "Volkswagen Bank México", "hq_city": "Mexico City", "origin_country": "DE",
                   "business_focus": "Captive auto finance"},

    # Panama
    ("PA", 155): {"short_name": "BAC International", "hq_city": "Panama City", "origin_country": "CO",
                  "controlling": "Grupo Aval / BAC Credomatic",
                  "business_focus": "Regional retail and commercial banking"},
    ("PA", 27): {"short_name": "Bladex", "legal_name": "Banco Latinoamericano de Comercio Exterior",
                 "hq_city": "Panama City", "origin_country": "PA", "founded": "1979",
                 "ownership": "Public (NYSE: BLX); multinational LatAm trade-finance bank",
                 "business_focus": "Foreign-trade and corporate finance across Latin America",
                 "history": "Multilateral-origin trade-finance bank headquartered in Panama; listed in New York."},
    ("PA", 182): {"short_name": "Banistmo", "hq_city": "Panama City", "origin_country": "CO",
                  "controlling": "Bancolombia / Grupo Cibest", "business_focus": "Universal commercial bank"},
    ("PA", 148): {"short_name": "Global Bank", "hq_city": "Panama City", "origin_country": "PA",
                  "business_focus": "Universal private bank"},
    ("PA", 2): {"short_name": "Caja de Ahorros", "hq_city": "Panama City", "origin_country": "PA",
                "ownership": "State-owned", "controlling": "Republic of Panama",
                "business_focus": "Public savings bank"},
    ("PA", 7): {"short_name": "Davivienda Panamá", "hq_city": "Panama City", "origin_country": "CO"},
    ("PA", 243): {"short_name": "Bancolombia Panamá", "hq_city": "Panama City", "origin_country": "CO"},
    ("PA", 247): {"short_name": "Banco de Bogotá Panamá", "hq_city": "Panama City", "origin_country": "CO"},
    ("PA", 45): {"short_name": "Scotiabank Panamá", "hq_city": "Panama City", "origin_country": "CA"},
    ("PA", 37): {"short_name": "Citibank Panamá", "hq_city": "Panama City", "origin_country": "US"},
    ("PA", 201): {"short_name": "Banesco Panamá", "hq_city": "Panama City", "origin_country": "VE"},
    ("PA", 215): {"short_name": "Mercantil Banco", "hq_city": "Panama City", "origin_country": "VE",
                  "controlling": "Mercantil group", "business_focus": "Commercial banking"},
    ("PA", 246): {"short_name": "Ficohsa Panamá", "hq_city": "Panama City", "origin_country": "HN",
                  "controlling": "Grupo Ficohsa", "business_focus": "Commercial banking"},
    ("PA", 233): {"short_name": "LAFISE Panamá", "hq_city": "Panama City", "origin_country": "NI",
                  "controlling": "Grupo LAFISE", "business_focus": "Commercial banking"},
    ("PA", 186): {"short_name": "Banco Azteca Panamá", "hq_city": "Panama City", "origin_country": "MX"},
    ("PA", 195): {"short_name": "Pichincha Panamá", "hq_city": "Panama City", "origin_country": "EC"},
    ("PA", 117): {"short_name": "Bank of China Panamá", "hq_city": "Panama City", "origin_country": "CN"},
    ("PA", 260): {"short_name": "ICBC Panamá", "hq_city": "Panama City", "origin_country": "CN"},

    # Brazil — major + notable beyond original seed
    ("BR", 1000081847): {
        "short_name": "BNDES", "legal_name": "Banco Nacional de Desenvolvimento Econômico e Social",
        "founded": "1952", "hq_city": "Rio de Janeiro", "origin_country": "BR",
        "ownership": "100% Brazilian Federal Government", "controlling": "União Federal",
        "business_focus": "National development bank — long-term project, infrastructure and corporate finance",
        "history": "Brazil’s national development bank (1952). Not a retail commercial bank; dominates long-term development finance.",
        "website": "https://www.bndes.gov.br",
        "sources": [{"label": "BNDES", "url": "https://www.bndes.gov.br"}],
    },
    ("BR", 1000080109): {
        "short_name": "Safra", "legal_name": "Banco Safra S.A.", "founded": "1955",
        "hq_city": "São Paulo", "origin_country": "BR",
        "controlling": "Safra family", "ownership": "Private (Safra family)",
        "business_focus": "Private banking, corporate and investment banking",
        "website": "https://www.safra.com.br",
    },
    ("BR", 1000084693): {
        "short_name": "Nubank", "legal_name": "Nu Pagamentos / Nu Holdings banking perimeter",
        "founded": "2013", "hq_city": "São Paulo", "origin_country": "BR",
        "ownership": "Public (NYSE: NU)", "controlling": "Nu Holdings control / founder-led structure",
        "business_focus": "Digital retail banking and payments",
        "history": "Leading Brazilian digital bank/fintech; IF.data line is the prudential Nu Pagamentos perimeter.",
        "website": "https://nubank.com.br",
    },
    ("BR", 1000081593): {
        "short_name": "Banco do Nordeste", "founded": "1952", "hq_city": "Fortaleza",
        "origin_country": "BR", "ownership": "Federal government control",
        "controlling": "União Federal", "business_focus": "Regional development bank for the Northeast",
    },
    ("BR", 1000080484): {
        "short_name": "BV (Votorantim)", "legal_name": "Banco Votorantim",
        "hq_city": "São Paulo", "origin_country": "BR",
        "controlling": "Votorantim / Banco do Brasil (joint ownership historically 50/50)",
        "ownership": "Jointly controlled by Votorantim and Banco do Brasil",
        "business_focus": "Consumer finance, auto and corporate banking",
    },
    ("BR", 1000082475): {
        "short_name": "XP", "legal_name": "XP Investimentos / Banco XP perimeter",
        "founded": "2001", "hq_city": "São Paulo", "origin_country": "BR",
        "ownership": "Public (NASDAQ: XP)", "business_focus": "Investments, brokerage and banking adjacency",
        "website": "https://www.xp.com.br",
    },
    ("BR", 1000080154): {
        "short_name": "Banrisul", "legal_name": "Banco do Estado do Rio Grande do Sul",
        "founded": "1928", "hq_city": "Porto Alegre", "origin_country": "BR",
        "ownership": "Controlled by State of Rio Grande do Sul (listed)",
        "controlling": "Estado do Rio Grande do Sul",
        "business_focus": "Regional universal bank",
    },
    ("BR", 1000080996): {
        "short_name": "Inter", "legal_name": "Banco Inter", "founded": "1994 / digital pivot 2010s",
        "hq_city": "Belo Horizonte", "origin_country": "BR",
        "ownership": "Public", "business_focus": "Digital universal bank / marketplace banking",
        "website": "https://inter.co",
    },
    ("BR", 1000084844): {
        "short_name": "C6 Bank", "founded": "2018", "hq_city": "São Paulo",
        "origin_country": "US",
        "controlling": "JPMorgan (controlling stake acquired)", "ownership": "Controlled by JPMorgan",
        "business_focus": "Digital retail and commercial bank",
        "website": "https://www.c6bank.com.br",
    },
    ("BR", 1000081744): {
        "short_name": "Daycoval", "hq_city": "São Paulo", "origin_country": "BR",
        "business_focus": "Mid-market corporate and payroll/consigned lending",
        "ownership": "Private",
    },
    ("BR", 1000081249): {
        "short_name": "Banco da Amazônia", "founded": "1942", "hq_city": "Belém",
        "origin_country": "BR", "ownership": "Federal government control",
        "controlling": "União Federal", "business_focus": "Regional development bank (Amazon)",
    },
    ("BR", 1000080312): {
        "short_name": "ABC Brasil", "hq_city": "São Paulo", "origin_country": "BR",
        "controlling": "Arab Banking Corporation / related", "business_focus": "Corporate and middle-market banking",
    },
    ("BR", 1000080879): {
        "short_name": "Banco Sicoob", "hq_city": "Brasília", "origin_country": "BR",
        "ownership": "Cooperative system bank", "controlling": "Sicoob cooperative system",
        "business_focus": "Cooperative banking (Sicoob)",
    },
    ("BR", 1000080745): {
        "short_name": "Sicredi", "legal_name": "Banco Cooperativo Sicredi",
        "hq_city": "Porto Alegre", "origin_country": "BR",
        "ownership": "Cooperative", "controlling": "Sicredi cooperative system",
        "business_focus": "Cooperative banking (Sicredi)",
    },
    ("BR", 1000088022): {
        "short_name": "PicPay", "hq_city": "São Paulo", "origin_country": "BR",
        "business_focus": "Digital payments and banking", "ownership": "Fintech / J&F-related ownership path",
    },
    ("BR", 1000080178): {
        "short_name": "BMG", "hq_city": "Belo Horizonte", "origin_country": "BR",
        "business_focus": "Payroll-consigned and consumer banking",
    },
    ("BR", 1000080903): {
        "short_name": "Original", "hq_city": "São Paulo", "origin_country": "BR",
        "controlling": "JungleLab / related (ex-J&F path — verify latest)",
        "business_focus": "Digital / commercial bank",
    },
    ("BR", 1000080147): {
        "short_name": "Banestes", "hq_city": "Vitória", "origin_country": "BR",
        "ownership": "State of Espírito Santo control", "controlling": "Estado do Espírito Santo",
        "business_focus": "Regional universal bank",
    },
    ("BR", 1000080123): {
        "short_name": "Mercantil do Brasil", "hq_city": "Belo Horizonte", "origin_country": "BR",
        "business_focus": "Regional commercial bank",
    },
    ("BR", 1000081452): {
        "short_name": "Scotiabank Brasil", "hq_city": "São Paulo", "origin_country": "CA",
    },
    ("BR", 1000080192): {
        "short_name": "Citibank Brasil", "hq_city": "São Paulo", "origin_country": "US",
    },
    ("BR", 1000080116): {
        "short_name": "J.P. Morgan Brasil", "hq_city": "São Paulo", "origin_country": "US",
    },
    ("BR", 1000084813): {
        "short_name": "PagBank", "legal_name": "PagSeguro / PagBank prudential",
        "hq_city": "São Paulo", "origin_country": "BR", "founded": "2006 / banking expansion later",
        "ownership": "Public (NYSE: PAGS)", "business_focus": "Payments and digital banking",
        "website": "https://pagbank.com.br",
    },
    ("BR", 1000083694): {
        "short_name": "Agibank", "hq_city": "Porto Alegre", "origin_country": "BR",
        "business_focus": "Digital / payroll-consigned consumer banking",
    },
}


def load_env():
    env_path = ROOT / ".env"
    if not env_path.exists():
        return
    for line in env_path.read_text().splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        k, v = line.split("=", 1)
        os.environ.setdefault(k.strip(), v.strip().strip('"').strip("'"))


def clean_short_name(name: str, country: str) -> str:
    n = (name or "").strip()
    if country == "BR":
        n = re.sub(r"\s*-\s*PRUDENCIAL\s*$", "", n, flags=re.I)
        n = re.sub(r"^BCO\s+", "Banco ", n, flags=re.I)
    n = re.sub(r"\s+", " ", n).strip()
    # Title-ish but keep acronyms
    if n.isupper() and len(n) > 4:
        n = n.title()
    return n


def merge(a: dict, b: dict) -> dict:
    """Merge b onto a; non-empty b values win."""
    out = dict(a)
    for k, v in b.items():
        if v is None or v == "" or v == []:
            continue
        out[k] = v
    return out


def apply_name_rules(name: str, country: str) -> dict:
    out: dict[str, Any] = {}
    for cre, payload in NAME_RULES:
        if cre.search(name or ""):
            out = merge(out, {k: v for k, v in payload.items() if v is not None})
    if "origin_country" in out:
        out["origin_country_name"] = ORIGIN_NAMES.get(out["origin_country"], out["origin_country"])
    return out


def base_profile(country: str, codigo: int, nombre: str) -> dict:
    meta = COUNTRY_META[country]
    short = clean_short_name(nombre, country)
    return {
        "country": country,
        "codigo": codigo,
        "short_name": short,
        "legal_name": nombre,
        "founded": None,
        "ownership": None,
        "controlling": None,
        "shareholders": [],
        "origin_country": country,
        "origin_country_name": meta["name"],
        "employees_in_country": None,
        "employees_as_of": None,
        "business_focus": "Commercial banking",
        "hq_city": meta["capital"],
        "history": None,
        "context": f"Supervised institution in {meta['name']}. Live assets, equity and ROE come from LatamBanks supervisory data.",
        "website": None,
        "ir_url": None,
        "ratings": [],
        "news": [{
            "title": f"{short} — news",
            "url": f"https://news.google.com/search?q={urllib.parse.quote(short + ' banco' if country != 'US' else short)}",
            "source": "Google News",
        }],
        "sources": [{"label": "LatamBanks supervisory dataset", "url": "https://latambanks.co"}],
    }


def enrich_state_hint(name: str, country: str) -> dict:
    u = (name or "").upper()
    out = {}
    if country == "AR":
        if "NACION ARGENTINA" in u or "NACIÓN ARGENTINA" in u:
            out.update(ownership="State-owned", controlling="Argentine Republic", business_focus="Public universal bank")
        elif "PROVINCIA" in u or "PROVINCIAL" in u or "MUNICIPAL" in u or "CIUDAD DE BUENOS AIRES" in u:
            out.update(ownership="Subnational public bank", business_focus="Public provincial/municipal banking")
    if country == "BR":
        if re.search(r"\bBB\b|BANCO DO BRASIL|CAIXA|BNDES|AMAZONIA|NORDESTE|BRB\b", u):
            if "CAIXA" in u or "BNDES" in u or "AMAZONIA" in u or "NORDESTE" in u:
                out.setdefault("ownership", "Government-controlled")
                out.setdefault("controlling", "União Federal / public sector")
        if "ESTADO" in u or "EST." in u or "BANESTES" in u or "BANRISUL" in u or "BRB" in u:
            out.setdefault("ownership", "State-controlled regional bank")
            out.setdefault("business_focus", "Regional universal / development banking")
    if country == "CO" and "AGRARIO" in u:
        out.update(ownership="State-owned", controlling="Republic of Colombia")
    if country == "CL" and "ESTADO DE CHILE" in u:
        out.update(ownership="State-owned", controlling="Republic of Chile")
    if country == "PA" and ("NACIONAL DE PANAM" in u or "CAJA DE AHORROS" in u):
        out.update(ownership="State-owned", controlling="Republic of Panama")
    if country == "UY" and ("REPÚBLICA" in u or "REPUBLICA" in u or "HIPOTECARIO DEL URUGUAY" in u):
        out.update(ownership="State-owned", controlling="Oriental Republic of Uruguay")
    return out


def fetch_fdic_map(certs: list[int]) -> dict[int, dict]:
    fields = "CERT,NAME,CITY,STNAME,STALP,ESTYMD,WEBADDR,OFFICES,SPECGRP,BKCLASS,NAMEHCR,ASSET,EQTOT"
    out: dict[int, dict] = {}
    for active_flag in (1, 0):
        offset = 0
        while True:
            url = (
                f"https://banks.data.fdic.gov/api/institutions?filters=ACTIVE%3A{active_flag}"
                f"&fields={fields}&limit=10000&offset={offset}&format=json"
            )
            req = urllib.request.Request(url, headers={"User-Agent": UA})
            with urllib.request.urlopen(req, timeout=120) as r:
                j = json.load(r)
            rows = j.get("data") or []
            if not rows:
                break
            for item in rows:
                d = item.get("data") or {}
                cert = d.get("CERT")
                if cert is None:
                    continue
                cert = int(cert)
                if cert in certs and cert not in out:
                    out[cert] = d
            total = int((j.get("meta") or {}).get("total") or 0)
            offset += len(rows)
            if offset >= total or len(rows) < 10000:
                break
            if active_flag == 0 and offset >= 30000:
                break  # enough inactive scan
        if len(out) >= len(set(certs)) * 0.95:
            break
    return out


def profile_from_fdic(codigo: int, nombre: str, fdic: dict) -> dict:
    est = fdic.get("ESTYMD")
    founded = None
    if est:
        # MM/DD/YYYY
        parts = str(est).split("/")
        if len(parts) == 3:
            founded = parts[-1]
        else:
            founded = str(est)[:4]
    city = fdic.get("CITY")
    st = fdic.get("STALP") or fdic.get("STNAME")
    hq = ", ".join([p for p in [city, st] if p])
    hc = fdic.get("NAMEHCR")
    web = fdic.get("WEBADDR")
    if web and not str(web).startswith("http"):
        web = "https://" + str(web)
    spec = FDIC_SPECGRP.get(fdic.get("SPECGRP"))
    offices = fdic.get("OFFICES")
    focus = spec or "FDIC-insured commercial bank / thrift"
    if offices:
        focus = f"{focus} ({offices} offices)"
    return {
        "short_name": clean_short_name(fdic.get("NAME") or nombre, "US"),
        "legal_name": fdic.get("NAME") or nombre,
        "founded": founded,
        "ownership": "FDIC-insured U.S. depository institution",
        "controlling": hc or None,
        "shareholders": [hc] if hc else [],
        "origin_country": "US",
        "origin_country_name": "United States",
        "hq_city": hq or city,
        "business_focus": focus,
        "website": web,
        "history": (
            f"FDIC certificate {codigo}. "
            + (f"Established {est}. " if est else "")
            + (f"Holding company: {hc}. " if hc else "")
            + "Profile fields from FDIC BankFind; financials from Call Reports in LatamBanks."
        ),
        "context": "U.S. bank in the LatamBanks FDIC equity universe.",
        "sources": [
            {"label": "FDIC BankFind", "url": f"https://banks.data.fdic.gov/bankfind-suite/bankfind?filters=CERT%3A{codigo}"},
        ],
        "news": [{
            "title": f"{fdic.get('NAME') or nombre} — news",
            "url": f"https://news.google.com/search?q={urllib.parse.quote(fdic.get('NAME') or nombre)}",
            "source": "Google News",
        }],
    }


def load_equity_universe(cur) -> list[dict]:
    universe = []
    for iso, (tipo, cuentas) in EQUITY_SPEC.items():
        cur.execute(
            "SELECT MAX(periodo) FROM datos_financieros WHERE country=%s AND tipo=%s",
            (iso, tipo),
        )
        per = cur.fetchone()[0]
        if not per:
            continue
        cur.execute(
            """
            SELECT d.ins_cod, i.razon_social, SUM(d.monto_total)::bigint AS eq
            FROM datos_financieros d
            LEFT JOIN instituciones i ON i.country=d.country AND i.codigo=d.ins_cod
            WHERE d.country=%s AND d.tipo=%s AND d.periodo=%s AND d.cuenta = ANY(%s)
              AND d.ins_cod <> 999
            GROUP BY 1,2
            HAVING SUM(d.monto_total) > 0
            ORDER BY eq DESC
            """,
            (iso, tipo, per, cuentas),
        )
        for code, name, eq in cur.fetchall():
            universe.append({
                "country": iso,
                "codigo": int(code),
                "nombre": name or f"Bank {code}",
                "equity": int(eq or 0),
            })
    return universe


def curated_map() -> dict[tuple[str, int], dict]:
    if not SEED_PATH.exists():
        return {}
    rows = json.loads(SEED_PATH.read_text(encoding="utf-8"))
    return {(r["country"], int(r["codigo"])): r for r in rows}


def build_profiles(universe: list[dict], fdic: dict[int, dict], curated: dict) -> list[dict]:
    # BR: keep prudential + coops with equity; still include all equity rows but mark IPs
    out = []
    for u in universe:
        country, codigo, nombre = u["country"], u["codigo"], u["nombre"]
        p = base_profile(country, codigo, nombre)
        p = merge(p, apply_name_rules(nombre, country))
        p = merge(p, enrich_state_hint(nombre, country))
        cat = LATAM_CATALOG.get((country, codigo))
        if cat:
            p = merge(p, cat)
            if cat.get("origin_country"):
                p["origin_country_name"] = ORIGIN_NAMES.get(cat["origin_country"], cat["origin_country"])
        if country == "US" and codigo in fdic:
            p = merge(p, profile_from_fdic(codigo, nombre, fdic[codigo]))
        # curated deep research wins
        if (country, codigo) in curated:
            p = merge(p, curated[(country, codigo)])
        # finalize origin name
        if p.get("origin_country"):
            p["origin_country_name"] = ORIGIN_NAMES.get(p["origin_country"], p.get("origin_country_name"))
        # ensure news/sources lists
        p.setdefault("shareholders", [])
        p.setdefault("ratings", [])
        p.setdefault("news", [])
        p.setdefault("sources", [])
        out.append(p)
    return out


def upsert_profiles(cur, rows: list[dict]) -> None:
    sql = """
    UPSERT INTO bank_profiles (
      country, codigo, short_name, legal_name, founded, ownership, controlling,
      shareholders, origin_country, origin_country_name, employees_in_country,
      employees_as_of, business_focus, hq_city, history, context, website, ir_url,
      ratings, news, sources, updated_at
    ) VALUES (
      %(country)s, %(codigo)s, %(short_name)s, %(legal_name)s, %(founded)s,
      %(ownership)s, %(controlling)s, %(shareholders)s, %(origin_country)s,
      %(origin_country_name)s, %(employees_in_country)s, %(employees_as_of)s,
      %(business_focus)s, %(hq_city)s, %(history)s, %(context)s, %(website)s,
      %(ir_url)s, %(ratings)s, %(news)s, %(sources)s, now()
    )
    """
    for r in rows:
        cur.execute(sql, {
            "country": r["country"],
            "codigo": int(r["codigo"]),
            "short_name": r.get("short_name"),
            "legal_name": r.get("legal_name"),
            "founded": r.get("founded"),
            "ownership": r.get("ownership"),
            "controlling": r.get("controlling"),
            "shareholders": Json(r.get("shareholders") or []),
            "origin_country": r.get("origin_country"),
            "origin_country_name": r.get("origin_country_name"),
            "employees_in_country": r.get("employees_in_country"),
            "employees_as_of": r.get("employees_as_of"),
            "business_focus": r.get("business_focus"),
            "hq_city": r.get("hq_city"),
            "history": r.get("history"),
            "context": r.get("context"),
            "website": r.get("website"),
            "ir_url": r.get("ir_url"),
            "ratings": Json(r.get("ratings") or []),
            "news": Json(r.get("news") or []),
            "sources": Json(r.get("sources") or []),
        })


def completeness(row: dict) -> dict:
    fields = ["founded", "controlling", "origin_country", "employees_in_country",
              "business_focus", "hq_city", "ownership", "history"]
    return {f: bool(row.get(f) not in (None, "", [])) for f in fields}


def main() -> int:
    load_env()
    url = os.environ.get("COCKROACH_URL")
    if not url:
        print("ERROR: COCKROACH_URL missing", file=sys.stderr)
        return 1

    conn = psycopg2.connect(url)
    conn.autocommit = True
    cur = conn.cursor()

    print("Loading equity universe…")
    universe = load_equity_universe(cur)
    print(f"  {len(universe)} institutions with equity")
    by_c = {}
    for u in universe:
        by_c[u["country"]] = by_c.get(u["country"], 0) + 1
    print(" ", by_c)

    us_certs = [u["codigo"] for u in universe if u["country"] == "US"]
    print(f"Fetching FDIC for {len(us_certs)} US certs…")
    fdic = fetch_fdic_map(us_certs)
    print(f"  FDIC matched {len(fdic)}")

    curated = curated_map()
    print(f"Curated seed rows: {len(curated)}")

    profiles = build_profiles(universe, fdic, curated)
    # Also keep curated-only rows not in equity universe (shouldn't happen often)
    have = {(p["country"], int(p["codigo"])) for p in profiles}
    for key, row in curated.items():
        if key not in have:
            profiles.append(row)

    print(f"Writing seed ({len(profiles)} rows) → {SEED_PATH}")
    # Sort for stable diffs
    profiles_sorted = sorted(profiles, key=lambda r: (r["country"], int(r["codigo"])))
    SEED_PATH.write_text(json.dumps(profiles_sorted, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    print("Upserting into bank_profiles…")
    upsert_profiles(cur, profiles_sorted)
    cur.execute("SELECT country, count(*) FROM bank_profiles GROUP BY 1 ORDER BY 1")
    print("DB counts:")
    for r in cur.fetchall():
        print(" ", r)

    # Completeness report
    filled = {k: 0 for k in ["founded", "controlling", "origin_country", "employees_in_country", "business_focus", "hq_city", "history"]}
    for p in profiles_sorted:
        c = completeness(p)
        for k, ok in c.items():
            if ok:
                filled[k] = filled.get(k, 0) + 1
    n = len(profiles_sorted)
    print("Field fill rates:")
    for k, v in filled.items():
        print(f"  {k}: {v}/{n} ({100*v/n:.0f}%)")

    conn.close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
