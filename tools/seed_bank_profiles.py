#!/usr/bin/env python3
"""Upsert curated bank profiles from data/bank_profiles_seed.json into CockroachDB."""
from __future__ import annotations

import json
import os
import sys
from pathlib import Path

import psycopg2
from psycopg2.extras import Json

ROOT = Path(__file__).resolve().parents[1]
SEED = ROOT / "data" / "bank_profiles_seed.json"


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


def main() -> int:
    load_env()
    url = os.environ.get("COCKROACH_URL")
    if not url:
        print("ERROR: COCKROACH_URL missing", file=sys.stderr)
        return 1
    rows = json.loads(SEED.read_text(encoding="utf-8"))
    conn = psycopg2.connect(url)
    conn.autocommit = True
    cur = conn.cursor()
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
        payload = {
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
        }
        cur.execute(sql, payload)
        print(f"upserted {r['country']}:{r['codigo']} {r.get('short_name')}")
    cur.execute("SELECT count(*) FROM bank_profiles")
    print("total rows:", cur.fetchone()[0])
    conn.close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
