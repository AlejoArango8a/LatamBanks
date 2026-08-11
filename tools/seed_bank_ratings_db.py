#!/usr/bin/env python3
"""
Carga data/bank_ratings.json en las tablas de la migración 010.

Se corre UNA vez, después de aplicar migrations/010_bank_ratings.sql, para que
la base arranque con las calificaciones que ya estaban en el repositorio. A
partir de ahí la fuente de verdad es la base, y el JSON queda como respaldo.

Es idempotente: usa UPSERT, así que volver a correrlo no duplica nada. Tampoco
borra: lo que esté en la base y no en el archivo se queda como está.

Uso:
    export COCKROACH_URL='postgresql://...'
    python tools/seed_bank_ratings_db.py            # carga todo
    python tools/seed_bank_ratings_db.py --dry-run  # solo muestra qué haría
    python tools/seed_bank_ratings_db.py --country CL
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path

SEED = Path(__file__).resolve().parent.parent / "data" / "bank_ratings.json"

VALID_STATUS = {"verified", "unverified", "not_rated"}

UPSERT_CELL = """
INSERT INTO bank_ratings
  (country, ins_cod, agency, agency_name, rating, outlook, as_of,
   status, source, note, updated_at)
VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, now())
ON CONFLICT (country, ins_cod, agency) DO UPDATE SET
  agency_name = excluded.agency_name, rating = excluded.rating,
  outlook = excluded.outlook, as_of = excluded.as_of,
  status = excluded.status, source = excluded.source, note = excluded.note,
  updated_at = now()
"""

UPSERT_NOTE = """
INSERT INTO bank_rating_notes (country, ins_cod, note, updated_at)
VALUES (%s, %s, %s, now())
ON CONFLICT (country, ins_cod) DO UPDATE SET
  note = excluded.note, updated_at = now()
"""


def rows_from_seed(seed: dict, only_country: str | None):
    cells, notes = [], []
    for iso, block in (seed.get("countries") or {}).items():
        if only_country and iso != only_country:
            continue
        for raw_code, bank in (block.get("banks") or {}).items():
            code = int(raw_code)
            for agency, cell in (bank.get("cells") or {}).items():
                if not cell:
                    continue
                status = cell.get("status") or "unverified"
                if status not in VALID_STATUS:
                    raise SystemExit(f"estado inválido '{status}' en {iso}/{code}/{agency}")
                rating = cell.get("rating")
                if not rating and status != "not_rated":
                    # Una celda sin nota y sin marca de "no calificado" no aporta:
                    # en el mantenedor equivale a no haberla revisado.
                    continue
                cells.append((
                    iso, code, agency, cell.get("agency"),
                    None if status == "not_rated" else str(rating),
                    cell.get("outlook"), cell.get("as_of"), status,
                    cell.get("source"), cell.get("note"),
                ))
            note = (bank.get("note") or "").strip()
            if note:
                notes.append((iso, code, note))
    return cells, notes


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true", help="no escribe, solo informa")
    ap.add_argument("--country", help="ISO de un solo país, p. ej. CL")
    args = ap.parse_args()

    seed = json.loads(SEED.read_text(encoding="utf-8"))
    only = args.country.upper().strip() if args.country else None
    cells, notes = rows_from_seed(seed, only)

    por_pais: dict[str, int] = {}
    for row in cells:
        por_pais[row[0]] = por_pais.get(row[0], 0) + 1
    detalle = ", ".join(f"{iso}: {n}" for iso, n in sorted(por_pais.items())) or "nada"
    print(f"{len(cells)} calificaciones y {len(notes)} notas para cargar ({detalle})")

    if args.dry_run:
        print("--dry-run: no se escribió nada")
        return

    url = os.environ.get("COCKROACH_URL")
    if not url:
        sys.exit("Falta COCKROACH_URL en el entorno")

    # Se importa acá y no arriba para que --dry-run funcione sin el driver.
    try:
        import psycopg2
    except ImportError:
        sys.exit("Falta psycopg2. Instalá las dependencias: pip install -r requirements.txt")

    with psycopg2.connect(url) as conn:
        with conn.cursor() as cur:
            cur.executemany(UPSERT_CELL, cells)
            if notes:
                cur.executemany(UPSERT_NOTE, notes)
        conn.commit()

    print(f"listo: {len(cells)} calificaciones y {len(notes)} notas en la base")


if __name__ == "__main__":
    main()
