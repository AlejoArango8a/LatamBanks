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
    # Brasil (IF.data, Relatorio 1): los códigos `Conta` NO son estables — el
    # cambio de plan Cosif de mar-2025 los renumeró por completo (ej. Ativo Total
    # 78182 -> 140220). Por eso NO listamos cuentas críticas por código fijo aquí:
    # cualquier código fijo daría falsas alarmas permanentes tras la frontera.
    # Para Brasil el detector correcto es el UMBRAL RELATIVO de abajo, que dispara
    # cuando desaparece la mayoría de las cuentas de un período al siguiente.
    "BR": [],
    "UY": [
        "1",            # Activos
        "2",            # Pasivos
        "3",            # Patrimonio (sidebar)
        "1.4.1",        # Créditos interm. sector financiero
        "1.4.2",        # Créditos interm. privado
        "1.4.3",        # Créditos interm. público
        "2.1.3",        # Depósitos sector no financiero privado
        "R_EJERCICIO",  # Resultado del ejercicio
    ],
    "PE": [
        "TOTAL_ACTIVO",
        "CREDITOS_NETOS",
        "OBLIGACIONES_PUBLICO",
        "TOTAL_PASIVO",
        "PATRIMONIO",
        "RESULTADO_NETO",
    ],
}

# Cómo normalizar un número de cuenta antes de comparar (por país).
# CO usa códigos CUIF de 6 dígitos; CL usa 9 dígitos exactos.
# BR usa el código `Conta` del reporte IF.data tal cual (numérico, longitud variable).
# UY usa códigos jerárquicos BCU ("1.4.2") o sentinels R_*/S_*.
_NORMALIZERS = {
    "CO": lambda c: re.sub(r"\D", "", str(c or ""))[:6],
    "CL": lambda c: str(c or "").strip(),
    "BR": lambda c: str(c or "").strip(),
    "UY": lambda c: str(c or "").strip(),
    "PE": lambda c: str(c or "").strip(),
}

# Umbral secundario: si aparecen/desaparecen más de esta cantidad de cuentas,
# se considera cambio estructural aunque no falte ninguna crítica.
STRUCTURAL_CHANGE_THRESHOLD = 25

# Umbral RELATIVO (universal): si desaparece esta fracción (o más) de las cuentas
# que existían el período anterior, se considera cambio estructural aunque el
# número absoluto sea pequeño. Pensado para fuentes con pocas cuentas por período
# (ej. Brasil IF.data Relatorio 1, ~7 cuentas): en mar-2025 desaparece casi todo
# el set anterior. Inofensivo para CL/CO, que nunca pierden la mitad en un mes.
STRUCTURAL_CHANGE_REL = 0.5

# Mínimo de cuentas conocidas para aplicar el umbral relativo (evita ruido cuando
# la línea base es diminuta).
_REL_MIN_KNOWN = 3

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
def get_known_accounts(
    conn,
    country: str,
    tipos: tuple[str, ...] | None = None,
    before_periodo: str | None = None,
) -> set[str]:
    """Cuentas que tuvieron datos en el período de referencia del país.

    Es la línea base para comparar el período entrante (comparación
    período-contra-período, de bajo ruido). Se compara contra lo que realmente
    tuvo datos el período anterior, no contra el catálogo completo de plan_cuentas
    (que siempre es mucho más grande que un mes puntual).

    `tipos`: si se pasa, restringe la línea base a esos `tipo` (ej. ('b1','r1')
    para vigilar SOLO el reporte Resumo de Brasil e ignorar los reportes de
    detalle Ativo/Passivo/DRE, que tienen muchas más cuentas y dispararían
    falsas alertas). CL/CO no pasan `tipos` y no se ven afectados.

    `before_periodo`: si se pasa, toma como referencia el último período
    ESTRICTAMENTE ANTERIOR a ese valor. Importante para el backfill histórico:
    la base del primer trimestre debe ser el trimestre cronológicamente previo
    (usualmente inexistente → 'baseline'), no el período más nuevo ya cargado
    (que provocaría una falsa alerta al comparar viejo Cosif contra el nuevo).

    Llamar ANTES de insertar el nuevo período en datos_financieros.
    """
    cur = conn.cursor()
    conds = ["country = %s"]
    params: list = [country]
    if tipos:
        conds.append("tipo = ANY(%s)")
        params.append(list(tipos))
    if before_periodo:
        conds.append("periodo < %s")
        params.append(before_periodo)
    where = " AND ".join(conds)
    cur.execute(f"SELECT max(periodo) FROM datos_financieros WHERE {where}", params)
    row = cur.fetchone()
    last_p = row[0] if row else None
    if not last_p:
        return set()
    conds2 = ["country = %s", "periodo = %s"]
    params2: list = [country, last_p]
    if tipos:
        conds2.append("tipo = ANY(%s)")
        params2.append(list(tipos))
    where2 = " AND ".join(conds2)
    cur.execute(f"SELECT DISTINCT cuenta FROM datos_financieros WHERE {where2}", params2)
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

    frac_desaparecidas = (len(desaparecidas) / len(known)) if known else 0.0
    salto_relativo = len(known) >= _REL_MIN_KNOWN and frac_desaparecidas >= STRUCTURAL_CHANGE_REL

    is_structural = (
        bool(criticas_faltantes)
        or len(nuevas) > STRUCTURAL_CHANGE_THRESHOLD
        or len(desaparecidas) > STRUCTURAL_CHANGE_THRESHOLD
        or salto_relativo
    )

    partes = []
    if criticas_faltantes:
        partes.append(
            f"Faltan {len(criticas_faltantes)} cuenta(s) crítica(s): "
            + ", ".join(criticas_faltantes)
        )
    if salto_relativo:
        partes.append(
            f"desapareció el {round(frac_desaparecidas * 100)}% de las cuentas del período previo "
            f"(posible cambio de plan de cuentas)"
        )
    if nuevas:
        partes.append(f"aparecieron {len(nuevas)} cuenta(s) nueva(s)")
    if desaparecidas and not salto_relativo:
        partes.append(f"desaparecieron {len(desaparecidas)} cuenta(s)")
    resumen = ("; ".join(partes) + ".") if partes else "Sin cambios estructurales."

    return {
        "periodo": periodo,
        "status": "structural_change" if is_structural else "ok",
        "detected_at": detected_at,
        "criticas_faltantes": criticas_faltantes,
        "n_nuevas": len(nuevas),
        "n_desaparecidas": len(desaparecidas),
        "pct_desaparecidas": round(frac_desaparecidas * 100, 1),
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
