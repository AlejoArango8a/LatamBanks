#!/usr/bin/env python3
"""
Construye data/bank_ratings.json — el dataset del mantenedor de calificaciones.

Migra lo que ya vivía disperso en la plataforma hacia un único modelo
multi-país / multi-calificadora:

  * Chile  → data/cl_bank_ratings.json (una sola nota de solvencia local por
             banco + meta con la calificadora que la emitió) se reparte en las
             columnas feller / humphreys / fitch_cl según quién la publicó.
  * Colombia → BANK_RATINGS_CO + BANK_RATINGS_CO_META de js/config.js se
             cargan en la columna genérica "local".

Regla que no se rompe: este script NO inventa calificaciones. Solo traslada
notas con procedencia conocida. Todo lo que no tenga respaldo queda como celda
pendiente para que se revise a mano en el mantenedor.

Uso:
    python tools/build_bank_ratings_seed.py [--check]

--check no escribe: falla con código 1 si el archivo en disco quedó desalineado
respecto de las fuentes (útil en CI).
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from datetime import date
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
CL_SRC = ROOT / "data" / "cl_bank_ratings.json"
CONFIG_JS = ROOT / "js" / "config.js"
OUT = ROOT / "data" / "bank_ratings.json"

# Calificadora que publicó la nota de solvencia local de cada banco chileno.
# Fuente: comentarios curados de FELLER_RATINGS y el bloque `meta` del JSON CMF.
# ICR aparece en la fuente pero no es una de las seis columnas pedidas: cuando es
# la única emisora, la nota NO se carga (quedaría atribuida a quien no la emitió)
# y se deja constancia en la nota del banco.
CL_LOCAL_AGENCY = {
    1: "feller",
    9: "feller",
    12: "feller",
    14: "fitch_cl",
    16: "feller",
    28: "feller",
    31: "feller",
    37: "feller",
    39: "feller",
    41: "feller",
    49: None,  # solo ICR
    51: "feller",
    53: "fitch_cl",
    55: "feller",
    59: "feller",
    60: "feller",
    61: "feller",
    62: None,  # Humphreys (ya viaja en su propia columna) + ICR
}

# Bancos cuya nota heredada vino de una calificadora sin columna propia.
CL_BANK_NOTES = {
    14: "Fitch Chile e ICR publican la misma solvencia AAA. La columna Fitch "
        "recoge la de Fitch Chile; falta contrastar ICR.",
    49: "La solvencia local AA+ heredada la publicó ICR, que no tiene columna "
        "propia. No se atribuye a Fitch/Feller/Humphreys sin verificar.",
    53: "Humphreys, Fitch e ICR coinciden en AA-. Falta contrastar ICR.",
    62: "Humphreys e ICR coinciden en AA-. Falta contrastar ICR.",
}

# Grupo Aval (10001) es un agregado sintético del cliente, no una institución del
# bootstrap: no corresponde mantenerlo aquí.
CO_SKIP = {10001}


def read_cl() -> dict:
    raw = json.loads(CL_SRC.read_text(encoding="utf-8"))
    ratings = {int(k): v for k, v in (raw.get("ratings") or {}).items()}
    meta = {int(k): v for k, v in (raw.get("meta") or {}).items()}
    as_of = str(raw.get("updated") or "")[:7]  # el mantenedor trabaja a nivel de mes
    banks: dict[int, dict] = {}

    for code, rating in sorted(ratings.items()):
        cells: dict[str, dict] = {}
        m = meta.get(code) or {}

        # Humphreys viene de un scrape del sitio de la propia calificadora, con
        # URL y fecha: es la única parte del seed que nace verificada.
        hum = m.get("humphreys")
        if hum and hum.get("long_term"):
            cells["humphreys"] = _cell(
                rating=hum["long_term"],
                outlook=hum.get("outlook"),
                status="verified",
                as_of=as_of,
                source=raw.get("humphreys_url"),
                note=f"Corto plazo: {hum['short_term']}." if hum.get("short_term") else None,
            )

        agency_key = CL_LOCAL_AGENCY.get(code)
        if agency_key and agency_key not in cells:
            cells[agency_key] = _cell(
                rating=rating,
                outlook=m.get("outlook"),
                status="unverified",
                note=m.get("analysis"),
            )

        bank: dict = {}
        if cells:
            bank["cells"] = cells
        if code in CL_BANK_NOTES:
            bank["note"] = CL_BANK_NOTES[code]
        if bank:
            banks[code] = bank

    return banks


def read_co() -> dict:
    js = CONFIG_JS.read_text(encoding="utf-8")

    block = _js_block(js, "BANK_RATINGS_CO")
    ratings = {
        int(c.replace("_", "")): r
        for c, r in re.findall(r"(\d[\d_]*)\s*:\s*'([^']+)'", block)
    }

    meta_block = _js_block(js, "BANK_RATINGS_CO_META")
    meta = {}
    for code, body in re.findall(r"(\d+)\s*:\s*\{(.*?)\n  \}", meta_block, re.S):
        entry = {}
        for field in ("outlook", "agency", "analysis"):
            m = re.search(rf"{field}:\s*\n?\s*'((?:[^'\\]|\\.)*)'", body)
            if m:
                entry[field] = m.group(1).replace("\\'", "'")
        meta[int(code)] = entry

    banks: dict[int, dict] = {}
    for code, rating in sorted(ratings.items()):
        if code in CO_SKIP:
            continue
        m = meta.get(code) or {}
        banks[code] = {
            "cells": {
                "local": _cell(
                    rating=rating,
                    outlook=m.get("outlook"),
                    status="unverified",
                    agency=m.get("agency"),
                    note=m.get("analysis"),
                )
            }
        }
    return banks


def _js_block(js: str, name: str) -> str:
    m = re.search(rf"export const {name}\s*=\s*Object\.freeze\(\{{(.*?)\n\}}\);", js, re.S)
    if not m:
        raise SystemExit(f"No encontré {name} en js/config.js")
    return m.group(1)


# Las fuentes publican la perspectiva en español; la interfaz de la plataforma
# es en inglés, así que se traduce al construir el seed y no al pintarlo.
OUTLOOK_EN = {
    "estable": "Stable",
    "positiva": "Positive",
    "negativa": "Negative",
    "en observación": "Watch",
    "en observacion": "Watch",
    "en desarrollo": "Developing",
}


def _outlook(value):
    if not value:
        return None
    return OUTLOOK_EN.get(str(value).strip().lower(), str(value).strip())


def _cell(*, rating=None, outlook=None, status="unverified", as_of=None,
          source=None, agency=None, note=None) -> dict:
    cell = {"rating": rating, "status": status}
    outlook = _outlook(outlook)
    for key, val in (("agency", agency), ("outlook", outlook), ("as_of", as_of),
                     ("source", source), ("note", note)):
        if val:
            cell[key] = val
    return cell


def build() -> dict:
    return {
        "version": 1,
        "updated": date.today().isoformat(),
        "generator": "tools/build_bank_ratings_seed.py",
        "note": (
            "Calificaciones de riesgo por banco y calificadora. Las columnas de "
            "cada país las define RATING_AGENCIES en js/ratings.js. `status` "
            "distingue el dato confirmado contra la fuente primaria (verified) "
            "del heredado sin contrastar (unverified) y del banco que la "
            "calificadora no cubre (not_rated). Una celda ausente está pendiente "
            "de revisión."
        ),
        "countries": {
            "CL": {"banks": read_cl()},
            "CO": {"banks": read_co()},
        },
    }


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--check", action="store_true",
                    help="no escribe; falla si el archivo en disco está desalineado")
    args = ap.parse_args()

    data = build()
    text = json.dumps(data, ensure_ascii=False, indent=2, sort_keys=False) + "\n"

    if args.check:
        if not OUT.exists():
            print(f"falta {OUT.relative_to(ROOT)}", file=sys.stderr)
            return 1
        current = json.loads(OUT.read_text(encoding="utf-8"))
        current.pop("updated", None)
        expected = json.loads(text)
        expected.pop("updated", None)
        if current != expected:
            print(f"{OUT.relative_to(ROOT)} está desalineado con las fuentes", file=sys.stderr)
            return 1
        print("ok")
        return 0

    OUT.write_text(text, encoding="utf-8")
    cl = len(data["countries"]["CL"]["banks"])
    co = len(data["countries"]["CO"]["banks"])
    cells = sum(
        len(b.get("cells", {}))
        for c in data["countries"].values()
        for b in c["banks"].values()
    )
    print(f"{OUT.relative_to(ROOT)}: CL {cl} bancos · CO {co} bancos · {cells} celdas")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
