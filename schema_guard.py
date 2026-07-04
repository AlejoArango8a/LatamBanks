#!/usr/bin/env python3
"""
schema_guard.py — Detección de cambios de estructura en las fuentes de datos.

Objetivo (Tarea A): que cada loader avise cuando la fuente cambia su estructura,
en vez de fallar en silencio o romper la continuidad de la serie que alimenta la
página "Summary" del dashboard.

Cómo se usa (lo cablearemos en cada loader):
    from schema_guard import get_known_accounts, detect_schema_changes, record_schema_result

    known = get_known_accounts(conn, "CO")          # ANTES de insertar el nuevo período
    ...
    report = detect_schema_changes("CO", periodo, incoming_accounts, known)
    record_schema_result(conn, "CO", periodo, report)   # DESPUÉS de bump_carga_log

Diseño de la alerta (acordado con el usuario):
  - Se CARGA igual (no se frena el período).
  - Se marca ALERTA cuando desaparecen cuentas CRÍTICAS (las que alimentan el
    Summary: activos, colocaciones, depósitos, patrimonio, utilidad, etc.),
    o cuando el volumen de cambios es tan grande que sugiere un cambio de plan
    de cuentas (umbral secundario).
  - El reporte se guarda como JSON en carga_log.detalle y estado='alerta_esquema'.
  - El reporte queda listo para mostrarse en la pestaña Config, mes por mes.

Nota de escalabilidad: por ahora las cuentas críticas viven aquí, por país.
Cuando creemos paises.json (fuente única de configuración), se moverán allí y
este módulo las leerá desde ese archivo.
"""

from __future__ import annotations

import logging
import re
from datetime import datetime, timezone

import psycopg2.extras

log = logging.getLogger(__name__)

# ============================================================
# CONFIGURACIÓN POR PAÍS (temporal — migrará a paises.json)
# ============================================================

# Cuentas que alimentan la página Summary. Si alguna DESAPARECE en un período,
# se dispara alerta crítica porque rompe la continuidad de lo que se consulta.
CRITICAL_ACCOUNTS: dict[str, list[str]] = {
    "CL": [
        "100000000",  # Total activos
        "200000000",  # Total pasivos
        "300000000",  # Patrimonio
        "500000000",  # Colocaciones
        "241000000",  # Depósitos a la vista
        "242000000",  # Depósitos a plazo
        "245000000",  # Bonos
        "590000000",  # Utilidad del ejercicio
    ],
    "CO": [
        "100000",  # Activos
        "200000",  # Pasivos
        "300000",  # Patrimonio
        "140000",  # Colocaciones (cartera)
        "210500",  # Depósitos en cuenta corriente
        "210700",  # Certificados de depósito a término
        "250000",  # Bonos / títulos de deuda
        "590000",  # Utilidad neta
    ],
}

# Cómo normalizar un número de cuenta antes de comparar (por país).
# CO usa códigos CUIF de 6 dígitos; CL usa 9 dígitos exactos.
_NORMALIZERS = {
    "CO": lambda c: re.sub(r"\D", "", str(c or ""))[:6],
    "CL": lambda c: str(c or "").strip(),
}

# Umbral secundario: si aparecen/desaparecen más de esta cantidad de cuentas,
# se considera cambio estructural aunque no falte ninguna crítica.
STRUCTURAL_CHANGE_THRESHOLD = 25

# Máximo de cuentas a listar dentro del JSON (para no inflar carga_log.detalle).
_MAX_LIST = 50


def _normalizer(country: str):
    return _NORMALIZERS.get(country, lambda c: str(c or "").strip())


def _norm_set(country: str, accounts) -> set[str]:
    fn = _normalizer(country)
    out = set()
    for a in accounts or []:
        n = fn(a)
        if n:
            out.add(n)
    return out


# ============================================================
# LECTURA DE CUENTAS CONOCIDAS
# ============================================================
def get_known_accounts(conn, country: str) -> set[str]:
    """Cuentas que tuvieron datos en el ÚLTIMO período ya cargado del país.

    Es la línea base para comparar el período entrante (comparación
    período-contra-período, de bajo ruido). Se compara contra lo que realmente
    tuvo datos el mes anterior, no contra el catálogo completo de plan_cuentas
    (que siempre es mucho más grande que un mes puntual).

    Llamar ANTES de insertar el nuevo período en datos_financieros.
    """
    cur = conn.cursor()
    cur.execute("SELECT max(periodo) FROM datos_financieros WHERE country = %s", (country,))
    row = cur.fetchone()
    last_p = row[0] if row else None
    if not last_p:
        return set()
    cur.execute(
        "SELECT DISTINCT cuenta FROM datos_financieros WHERE country = %s AND periodo = %s",
        (country, last_p),
    )
    return _norm_set(country, (r[0] for r in cur.fetchall()))


# ============================================================
# DETECCIÓN
# ============================================================
def detect_schema_changes(
    country: str,
    periodo: str,
    incoming_accounts,
    known_accounts,
) -> dict:
    """Compara las cuentas entrantes de un período contra las conocidas.

    Devuelve un reporte (dict serializable a JSON) con:
      - status: 'baseline' | 'ok' | 'structural_change'
      - criticas_faltantes: cuentas críticas que no llegaron este período
      - nuevas / desaparecidas (+ conteos)
      - resumen: texto claro para mostrar en la UI
    """
    incoming = _norm_set(country, incoming_accounts)
    known = _norm_set(country, known_accounts)
    criticas = _norm_set(country, CRITICAL_ACCOUNTS.get(country, []))

    detected_at = datetime.now(timezone.utc).isoformat(timespec="seconds")

    # Cuentas críticas ausentes en la data entrante (rompe continuidad).
    criticas_faltantes = sorted(c for c in criticas if c not in incoming)

    if not known:
        return {
            "periodo": periodo,
            "status": "baseline",
            "detected_at": detected_at,
            "criticas_faltantes": criticas_faltantes,
            "n_nuevas": 0,
            "n_desaparecidas": 0,
            "nuevas": [],
            "desaparecidas": [],
            "truncado": False,
            "resumen": "Primera carga de referencia para este país; no hay período previo con el cual comparar.",
        }

    nuevas = sorted(incoming - known)
    desaparecidas = sorted(known - incoming)

    is_structural = (
        bool(criticas_faltantes)
        or len(nuevas) > STRUCTURAL_CHANGE_THRESHOLD
        or len(desaparecidas) > STRUCTURAL_CHANGE_THRESHOLD
    )

    partes = []
    if criticas_faltantes:
        partes.append(
            f"Faltan {len(criticas_faltantes)} cuenta(s) crítica(s): "
            + ", ".join(criticas_faltantes)
        )
    if nuevas:
        partes.append(f"aparecieron {len(nuevas)} cuenta(s) nueva(s)")
    if desaparecidas:
        partes.append(f"desaparecieron {len(desaparecidas)} cuenta(s)")
    resumen = ("; ".join(partes) + ".") if partes else "Sin cambios estructurales."

    return {
        "periodo": periodo,
        "status": "structural_change" if is_structural else "ok",
        "detected_at": detected_at,
        "criticas_faltantes": criticas_faltantes,
        "n_nuevas": len(nuevas),
        "n_desaparecidas": len(desaparecidas),
        "nuevas": nuevas[:_MAX_LIST],
        "desaparecidas": desaparecidas[:_MAX_LIST],
        "truncado": len(nuevas) > _MAX_LIST or len(desaparecidas) > _MAX_LIST,
        "resumen": resumen,
    }


# ============================================================
# REGISTRO EN carga_log
# ============================================================
def record_schema_result(conn, country: str, periodo: str, report: dict) -> bool:
    """Escribe el resultado en carga_log (la fila debe existir: llamar tras bump_carga_log).

    - Cambio estructural  -> estado='alerta_esquema', detalle=<JSON del reporte>.
    - Sin cambios / baseline -> estado='ok', detalle=NULL (limpia alertas viejas
      si el problema ya se resolvió en una recarga).

    Devuelve True si registró una alerta estructural.
    """
    structural = report.get("status") == "structural_change"
    estado = "alerta_esquema" if structural else "ok"
    detalle = psycopg2.extras.Json(report) if structural else None

    cur = conn.cursor()
    cur.execute(
        "UPDATE carga_log SET estado = %s, detalle = %s WHERE country = %s AND periodo = %s",
        (estado, detalle, country, periodo),
    )
    conn.commit()

    if structural:
        log.warning("[schema_guard] %s %s — ALERTA DE ESQUEMA: %s", country, periodo, report.get("resumen"))
    else:
        log.info("[schema_guard] %s %s — %s", country, periodo, report.get("resumen"))
    return structural


# ============================================================
# ATAJO
# ============================================================
def check_and_record(conn, country: str, periodo: str, incoming_accounts, known_accounts) -> dict:
    """Detecta y registra en un solo paso. Devuelve el reporte."""
    report = detect_schema_changes(country, periodo, incoming_accounts, known_accounts)
    record_schema_result(conn, country, periodo, report)
    return report
