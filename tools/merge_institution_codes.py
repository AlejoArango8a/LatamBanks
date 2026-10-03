#!/usr/bin/env python3
"""Une bajo un solo código las instituciones que quedaron partidas en dos.

Perú y México publican el mismo banco con razones sociales distintas según el
mes (la SBS pone y quita asteriscos de nota al pie, la CNBV alterna 'Banco X'
con 'X'). Los loaders le inventaban un código por hash a la variante que no
reconocían, así que la serie de un banco quedaba repartida entre dos
instituciones y las dos salían en el selector, cada una con la mitad de los
meses. Los loaders ya no lo hacen (ver tests/test_bank_codes.py); esto arregla
lo que quedó escrito.

Es de una sola pasada: después de correrlo, los loaders escriben siempre el
código destino y el origen deja de aparecer.

    python tools/merge_institution_codes.py              # qué haría
    python tools/merge_institution_codes.py --apply      # lo hace
    python tools/merge_institution_codes.py --country PE --apply

Cada fusión se verifica antes de tocar nada: si origen y destino comparten
algún período la fusión se salta, porque significaría que no son el mismo banco
(o que ya se corrió) y mezclarlos pisaría cifras buenas.
"""

from __future__ import annotations

import argparse
import logging
import os
import re
from pathlib import Path

from dotenv import load_dotenv

load_dotenv(Path(__file__).resolve().parent.parent / ".env")

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
log = logging.getLogger("merge_institution_codes")

# (país, código origen, código destino, por qué).
# El destino es siempre el código que el banco está usando hoy, para no cortar
# la serie viva mientras esto no se haya corrido.
MERGES: list[tuple[str, int, int, str]] = [
    # --- Perú: variantes de nombre del mismo banco -------------------------
    ("PE", 112, 19, "Santander Consumer Bank* → Santander Consumer Bank"),
    ("PE", 2564, 4, "Banco Pichincha* → Banco Pichincha"),
    ("PE", 7894, 7, "Citibank*** → Citibank"),
    ("PE", 5244, 16, "Bank of China* → Bank of China"),
    ("PE", 8295, 16, "Banco de China Perú → Bank of China"),
    ("PE", 6557, 20, "Banco Efectiva* → Banco Efectiva"),
    # --- Perú: cambios de razón social de la misma entidad -----------------
    ("PE", 2350, 1, "Banco Continental → BBVA Perú (2019)"),
    ("PE", 2377, 4, "Banco Financiero → Banco Pichincha (2018)"),
    ("PE", 5942, 2, "Banco de Comercio → BANCOM (2023)"),
    # --- México: variantes de nombre del mismo banco -----------------------
    ("MX", 3681, 1527, "Banco Covalto → Covalto"),
    ("MX", 8980, 5400, "Banco Ualá → Ualá"),
    ("MX", 6661, 7402, "Kapital Bank → Kapital"),
    # --- México: cambios de razón social de la misma entidad ---------------
    ("MX", 7756, 3570, "Banco Forjadores → Banfeliz (2025)"),
    ("MX", 1321, 1527, "Banco Finterra → Covalto (2022)"),
]


def connect():
    import psycopg2

    url = os.environ.get("COCKROACH_URL")
    if not url:
        raise SystemExit("Falta COCKROACH_URL (.env o entorno).")
    return psycopg2.connect(url)


def periodos_de(cur, country: str, code: int) -> set[str]:
    cur.execute(
        "SELECT DISTINCT periodo FROM datos_financieros "
        "WHERE country=%s AND ins_cod=%s",
        (country, code),
    )
    return {r[0] for r in cur.fetchall()}


def razon_social(cur, country: str, code: int) -> str | None:
    cur.execute(
        "SELECT razon_social FROM instituciones WHERE country=%s AND codigo=%s",
        (country, code),
    )
    row = cur.fetchone()
    return row[0] if row else None


def sin_llamadas(nombre: str) -> str:
    """Mismo aseo que hacen los loaders: fuera asteriscos y notas '1/'."""
    s = re.sub(r"[*\u2217]+", "", str(nombre or ""))
    s = re.sub(r"\s+\d+/", "", s)
    return re.sub(r"\s+", " ", s).strip(" .,;:-")


def merge_one(cur, country: str, origen: int, destino: int, motivo: str, apply: bool) -> bool:
    nombre_o = razon_social(cur, country, origen)
    per_o = periodos_de(cur, country, origen)
    if not nombre_o and not per_o:
        log.info("  %s %s → %s: ya fusionado, nada que hacer", country, origen, destino)
        return False

    per_d = periodos_de(cur, country, destino)
    choque = sorted(per_o & per_d)
    if choque:
        log.warning(
            "  %s %s → %s: SE SALTA, comparten %s período(s) (%s…). "
            "Dos bancos distintos o fusión ya aplicada.",
            country, origen, destino, len(choque), choque[0],
        )
        return False

    log.info(
        "  %s %s → %s  (%s): %s períodos%s",
        country, origen, destino, motivo, len(per_o),
        f" {min(per_o)}–{max(per_o)}" if per_o else "",
    )
    # El código destino puede no existir todavía como institución: pasa cuando
    # el nombre bueno nunca se cargó porque el regulador siempre lo publicó con
    # llamada al pie. Sin esto, las cifras quedarían bajo un código sin nombre
    # hasta la próxima corrida del loader.
    nombre_d = razon_social(cur, country, destino)
    if not nombre_d:
        log.info("     %s no existe como institución; se crea como '%s'",
                 destino, sin_llamadas(nombre_o))

    if not apply:
        return False

    if not nombre_d:
        cur.execute(
            "INSERT INTO instituciones (country, codigo, razon_social) VALUES (%s,%s,%s)",
            (country, destino, sin_llamadas(nombre_o)),
        )

    # La PK es (country, periodo, tipo, ins_cod, cuenta): mover ins_cod es un
    # borrado + alta. Ya está verificado que no hay período compartido, así que
    # no puede chocar con una fila existente.
    cur.execute(
        "UPDATE datos_financieros SET ins_cod=%s "
        "WHERE country=%s AND ins_cod=%s",
        (destino, country, origen),
    )
    movidas = cur.rowcount
    cur.execute(
        "DELETE FROM instituciones WHERE country=%s AND codigo=%s",
        (country, origen),
    )
    log.info("     %s filas movidas, institución %s eliminada", movidas, origen)
    return True


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--apply", action="store_true", help="escribe (por defecto solo informa)")
    ap.add_argument("--country", help="limitar a un país (PE, MX, …)")
    args = ap.parse_args()

    pendientes = [m for m in MERGES if not args.country or m[0] == args.country.upper()]
    if not pendientes:
        raise SystemExit(f"No hay fusiones definidas para {args.country}")

    conn = connect()
    cur = conn.cursor()
    log.info("%s fusión(es) a evaluar%s", len(pendientes), "" if args.apply else " (simulación)")
    hechas = 0
    for country, origen, destino, motivo in pendientes:
        if merge_one(cur, country, origen, destino, motivo, args.apply):
            hechas += 1

    if args.apply:
        conn.commit()
        log.info("Listo: %s fusión(es) aplicada(s).", hechas)
    else:
        conn.rollback()
        log.info("Simulación: no se escribió nada. Repetir con --apply.")
    cur.close()
    conn.close()


if __name__ == "__main__":
    main()
