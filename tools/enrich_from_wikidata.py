#!/usr/bin/env python3
"""Fill founded / employees / HQ gaps via Wikidata (search + SPARQL) for bank_profiles."""
from __future__ import annotations

import json
import os
import re
import time
import urllib.parse
import urllib.request
from pathlib import Path

import psycopg2
from psycopg2.extras import Json

ROOT = Path(__file__).resolve().parents[1]
SEED = ROOT / "data" / "bank_profiles_seed.json"
UA = "LatamBanksProfileBot/1.0 (https://latambanks.co; research)"
BANKISH = re.compile(
    r"\b(bank|banco|banking|financial|finance|savings|credit|cooperative|"
    r"instituci[oó]n|banque|caisse|caixa)\b",
    re.I,
)

# High-confidence QIDs when search is noisy (verified labels)
KNOWN_QIDS = {
    ("BR", 1000080329): "Q610817",   # Banco do Brasil
    ("BR", 1000080099): "Q1424293",  # Itaú Unibanco
    ("BR", 1000080075): "Q806181",   # Bradesco
    ("BR", 1000080738): "Q835283",   # Caixa Econômica Federal
    ("BR", 1000080336): "Q2877503",  # BTG Pactual
    ("CO", 7): "Q806206",            # Bancolombia
    ("CL", 16): "Q2882083",          # BCI
    ("CL", 1): "Q2882085",           # Banco de Chile
    ("PE", 8): "Q2835558",           # Interbank
    ("PE", 3): "Q4854124",           # BCP
}


def load_env():
    p = ROOT / ".env"
    if not p.exists():
        return
    for line in p.read_text().splitlines():
        if not line.strip() or line.startswith("#") or "=" not in line:
            continue
        k, v = line.split("=", 1)
        os.environ.setdefault(k.strip(), v.strip().strip('"').strip("'"))


def http_json(url: str, retries: int = 5) -> dict:
    last = None
    for attempt in range(retries):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "application/json"})
            with urllib.request.urlopen(req, timeout=60) as r:
                return json.load(r)
        except Exception as e:
            last = e
            msg = str(e)
            if "429" in msg or "503" in msg or "timeout" in msg.lower():
                time.sleep(2 ** attempt + 1)
                continue
            raise
    raise last


def api(params: dict) -> dict:
    return http_json("https://www.wikidata.org/w/api.php?" + urllib.parse.urlencode(params))


def sparql(query: str) -> list[dict]:
    url = "https://query.wikidata.org/sparql?format=json&query=" + urllib.parse.quote(query)
    req = urllib.request.Request(
        url,
        headers={"User-Agent": UA, "Accept": "application/sparql-results+json"},
    )
    with urllib.request.urlopen(req, timeout=90) as r:
        return json.load(r)["results"]["bindings"]


def entity(qid: str) -> dict:
    j = api({
        "action": "wbgetentities",
        "ids": qid,
        "props": "claims|labels|descriptions",
        "languages": "en|es|pt",
        "format": "json",
    })
    return j["entities"][qid]


def claim_time_year(ent, prop="P571"):
    for c in ent.get("claims", {}).get(prop) or []:
        t = c.get("mainsnak", {}).get("datavalue", {}).get("value", {}).get("time")
        if t:
            return t[1:5]
    return None


def claim_qty(ent, prop="P1128"):
    for c in ent.get("claims", {}).get(prop) or []:
        amt = c.get("mainsnak", {}).get("datavalue", {}).get("value", {}).get("amount")
        if amt is None:
            continue
        try:
            return int(float(amt))
        except Exception:
            continue
    return None


def claim_item_ids(ent, prop):
    out = []
    for c in ent.get("claims", {}).get(prop) or []:
        qid = c.get("mainsnak", {}).get("datavalue", {}).get("value", {}).get("id")
        if qid:
            out.append(qid)
    return out


def label_of(qid: str) -> str | None:
    try:
        ent = entity(qid)
        labels = ent.get("labels") or {}
        for lang in ("en", "es", "pt"):
            if lang in labels:
                return labels[lang]["value"]
    except Exception:
        return None
    return None


def clean_query(name: str) -> str:
    q = re.sub(r"\s*-\s*PRUDENCIAL\s*$", "", name or "", flags=re.I)
    q = re.sub(r"^BCO\s+", "Banco ", q, flags=re.I)
    q = re.sub(r"\s+", " ", q).strip()
    return q


def sparql_by_label(label: str) -> str | None:
    """Return best QID for an exact rdfs:label match that looks like a bank."""
    if not label or len(label) < 3:
        return None
    lit = label.replace("\\", "\\\\").replace('"', '\\"')
    # Query each language tag separately (language tags cannot be variables).
    for lang_tag in ("en", "es", "pt", "fr"):
        q = f'''
        SELECT ?item ?inception ?employees WHERE {{
          ?item rdfs:label "{lit}"@{lang_tag}.
          OPTIONAL {{ ?item wdt:P571 ?inception }}
          OPTIONAL {{ ?item wdt:P1128 ?employees }}
          OPTIONAL {{ ?item wdt:P31 ?class.
            FILTER(?class IN (wd:Q22687, wd:Q806807, wd:Q1976844, wd:Q134161)) }}
        }} LIMIT 5
        '''
        try:
            rows = sparql(q)
        except Exception:
            time.sleep(1.5)
            continue
        if not rows:
            continue
        # Prefer rows with inception
        rows = sorted(rows, key=lambda b: (1 if "inception" in b else 0) + (1 if "employees" in b else 0), reverse=True)
        return rows[0]["item"]["value"].rsplit("/", 1)[-1]
    return None


def search_qid(name: str) -> str | None:
    q = clean_query(name)
    for lang in ("en", "es", "pt"):
        j = api({
            "action": "wbsearchentities",
            "search": q,
            "language": lang,
            "uselang": lang,
            "format": "json",
            "limit": 8,
            "type": "item",
        })
        for h in j.get("search") or []:
            desc = h.get("description") or ""
            lab = h.get("label") or ""
            if re.search(r"tournament|stadium|building|street|song|album|film|im[oó]vel", desc, re.I):
                continue
            if BANKISH.search(desc) or BANKISH.search(lab):
                return h["id"]
        time.sleep(0.05)
    # SPARQL exact label fallback
    for candidate in (q, q.title(), q.replace(" S.A.", "").replace(" S.A", "")):
        qid = sparql_by_label(candidate)
        if qid:
            return qid
        time.sleep(0.05)
    return None


def extract_from_qid(qid: str, expected_name: str | None = None) -> dict:
    ent = entity(qid)
    out: dict = {}
    labels = " ".join(v["value"] for v in (ent.get("labels") or {}).values())
    # Reject obvious mismatches when we have an expected name token
    if expected_name:
        token = re.sub(r"[^a-z0-9]", "", (expected_name.split()[:2] and expected_name or "").lower())
        # use a distinctive token >= 4 chars from expected short name
        tokens = [re.sub(r"[^a-z0-9]", "", t.lower()) for t in re.split(r"\s+", expected_name) if len(t) >= 4]
        tokens = [t for t in tokens if t not in {"banco", "bank", "sa", "the", "del", "de", "la", "do", "da"}]
        lab_norm = re.sub(r"[^a-z0-9]", "", labels.lower())
        if tokens and not any(t in lab_norm for t in tokens[:3]):
            # allow if description is bankish and inception exists — still risky; skip
            return {}
    year = claim_time_year(ent)
    if year:
        try:
            y = int(year)
            if 1400 <= y <= 2026:
                out["founded"] = year
        except Exception:
            pass
    emp = claim_qty(ent, "P1128")
    if emp and 10 < emp < 5_000_000:
        out["employees_in_country"] = emp
        out["employees_as_of"] = "Wikidata (verify date)"
    hq_ids = claim_item_ids(ent, "P159")
    if hq_ids:
        hq = label_of(hq_ids[0])
        if hq:
            out["hq_city"] = hq
    for lang in ("en", "es", "pt"):
        d = (ent.get("descriptions") or {}).get(lang, {}).get("value")
        if d and BANKISH.search(d):
            out.setdefault("context", d[0].upper() + d[1:])
            break
    bits = []
    if out.get("founded"):
        bits.append(f"Founded {out['founded']} per Wikidata")
    if emp:
        bits.append(f"employees {emp:,} on Wikidata")
    if bits:
        out["history_add"] = "; ".join(bits) + f" ({qid})."
    out["sources_add"] = [{
        "label": f"Wikidata {qid}",
        "url": f"https://www.wikidata.org/wiki/{qid}",
    }]
    return out


def verify_known_qids():
    """Drop known QIDs that don't resolve to bank-like labels."""
    good = {}
    for key, qid in KNOWN_QIDS.items():
        try:
            ent = entity(qid)
        except Exception:
            continue
        labels = " ".join(v["value"] for v in (ent.get("labels") or {}).values())
        if BANKISH.search(labels) or claim_time_year(ent):
            good[key] = qid
        time.sleep(0.05)
    return good


def needs(row: dict) -> bool:
    return (not row.get("founded")) or (not row.get("employees_in_country")) or (not row.get("history"))


def upsert_all(rows):
    conn = psycopg2.connect(os.environ["COCKROACH_URL"])
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
    conn.close()


def main() -> int:
    load_env()
    rows = json.loads(SEED.read_text(encoding="utf-8"))
    known = verify_known_qids()
    print("Verified known QIDs:", len(known))

    targets = []
    for r in rows:
        if r["country"] == "US":
            continue
        if not needs(r):
            continue
        name = r.get("legal_name") or r.get("short_name") or ""
        u = name.upper()
        if r["country"] == "BR":
            if "COOPERATIVA" in u:
                continue
            if re.search(r"\bIP\b", u) and not any(x in u for x in ("NU PAG", "PAGSEGURO", "PICPAY")):
                continue
        targets.append(r)

    # Prioritize small countries + top BR by existing equity order in file
    def rank(r):
        pri = {"CL": 0, "CO": 1, "PE": 2, "UY": 3, "PA": 4, "MX": 5, "AR": 6, "BR": 7}.get(r["country"], 9)
        return (pri, 0 if (r["country"], int(r["codigo"])) in known else 1)

    targets.sort(key=rank)
    # Cap BR long-tail for runtime: keep first 120 BR targets after sort
    br_n = 0
    filtered = []
    for r in targets:
        if r["country"] == "BR":
            br_n += 1
            if br_n > 150:
                continue
        filtered.append(r)
    targets = filtered
    print(f"Targets: {len(targets)}")

    by_key = {(r["country"], int(r["codigo"])): r for r in rows}
    updated = 0

    for i, r in enumerate(targets):
        key = (r["country"], int(r["codigo"]))
        qid = known.get(key)
        if not qid:
            query = r.get("short_name") or r.get("legal_name")
            try:
                qid = search_qid(query)
            except Exception as e:
                print("  search fail", key, e)
                qid = None
        if not qid:
            if (i + 1) % 20 == 0:
                print(f"  … {i+1}/{len(targets)} updated={updated}")
            continue
        try:
            patch = extract_from_qid(qid, expected_name=r.get("short_name") or r.get("legal_name"))
        except Exception as e:
            print("  extract fail", key, qid, e)
            continue
        if not patch:
            continue
        row = by_key[key]
        changed = False
        for k, v in patch.items():
            if k == "sources_add":
                src = list(row.get("sources") or [])
                urls = {s.get("url") for s in src}
                for s in v:
                    if s.get("url") not in urls:
                        src.append(s)
                        changed = True
                row["sources"] = src
                continue
            if k == "history_add":
                if not row.get("history"):
                    row["history"] = v
                    changed = True
                elif "Wikidata" not in (row.get("history") or "") and v:
                    row["history"] = (row["history"] or "") + " " + v
                    changed = True
                continue
            # Never overwrite a curated non-numeric founded string with a bare year
            if k == "founded" and row.get("founded"):
                continue
            if not row.get(k) and v:
                row[k] = v
                changed = True
        if changed:
            updated += 1
            print(f"  + {key[0]}:{key[1]} {row.get('short_name')} → {qid} founded={row.get('founded')} emp={row.get('employees_in_country')}")
        time.sleep(0.35)
        if (i + 1) % 20 == 0:
            print(f"  … {i+1}/{len(targets)} updated={updated}")

    SEED.write_text(json.dumps(rows, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"Patched {updated}; upserting…")
    upsert_all(rows)
    n = len(rows)
    for field in ("founded", "employees_in_country", "history", "controlling", "hq_city", "business_focus"):
        c = sum(1 for r in rows if r.get(field) not in (None, "", []))
        print(f"  {field}: {c}/{n} ({100 * c / n:.0f}%)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
