#!/usr/bin/env python3
"""
uruguay_loader.py — ETL BCU / Superintendencia de Servicios Financieros → CockroachDB
LatamBanks — country='UY'

Fuente: Boletín informativo mensual
  https://www.bcu.gub.uy/Servicios-Financieros-SSF/Boletin SSF/{YYYY}/{Mes}/indice.htm
  → institucion{ID}.xls (Estado de Situación + Resultados + anexos)

Universo: bancos oficiales (grupo99) + bancos privados (grupo997).
Valores: miles de pesos → se guardan en pesos enteros (×1000).
  Situación / Resultados: M/N → monto_clp, M/E → monto_ext, Total → monto_total.
  Anexo 1 (plazos contractuales): cuentas sintéticas A1_{SECTION}_{TERM}.
  Anexo 2 (créditos/deterioro/residencia): A2_* en b1.
  Anexo 3 (estructura de depósitos por tramo): A3_* en b1; A3_CLI_* son
    cantidades de clientes, no pesos.
  Anexo 4 (indicadores): A4_* en tipo=q1 (percent×100). Se toma el anexo completo.
  Anexo 5 (responsabilidad patrimonial neta): A5_* en b1, solo monto_total.
  ERI (estado de resultados integral): ERI_* en r1, solo monto_total.

Modos:
  (sin flags)     Incremental: meses del catálogo aún no en carga_log
  --month AAAAMM  Carga/recarga un mes
  --all           Recarga todos los del rango
  --from / --to   Filtra AAAAMM
  --dry-run       Lista sin tocar BD
  --wipe          Borra solo country='UY'
"""
from __future__ import annotations

import argparse
import logging
import os
import re
import ssl
import time
import unicodedata
from pathlib import Path
from typing import Iterable
from urllib.error import HTTPError, URLError
from urllib.parse import quote, urljoin, urlsplit, urlunsplit
from urllib.request import HTTPSHandler, Request, build_opener

from dotenv import load_dotenv

load_dotenv(Path(__file__).parent / ".env")

try:
    import xlrd
except ImportError as e:  # pragma: no cover
    raise SystemExit("Falta xlrd. pip install xlrd") from e

COUNTRY = "UY"
BATCH = 500
BASE = "https://www.bcu.gub.uy/Servicios-Financieros-SSF/Boletin SSF"
# Meses con boletín en path moderno (validado ≥2020).
MIN_PERIOD = "202001"
SCALE = 1000  # miles de pesos → pesos

MONTH_NAMES = {
    1: "Enero",
    2: "Febrero",
    3: "Marzo",
    4: "Abril",
    5: "Mayo",
    6: "Junio",
    7: "Julio",
    8: "Agosto",
    9: "Setiembre",
    10: "Octubre",
    11: "Noviembre",
    12: "Diciembre",
}

GROUP_FILES = ("grupo99.xls", "grupo997.xls")  # oficiales + privados
# IDs de agregados del boletín (no son bancos individuales).
AGGREGATE_IDS = frozenset({99, 997})

# Display / DB names when BCU XLS still carries a legacy brand.
RAZON_SOCIAL_OVERRIDES = {
    157: "BTG Pactual Uruguay",
}

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
log = logging.getLogger("uruguay_loader")

_SSL_CTX = ssl.create_default_context()
_SSL_CTX.check_hostname = False
_SSL_CTX.verify_mode = ssl.CERT_NONE
_OPENER = build_opener(HTTPSHandler(context=_SSL_CTX))


def _encode_url(url: str) -> str:
    parts = urlsplit(url)
    return urlunsplit(
        (parts.scheme, parts.netloc, quote(parts.path, safe="/%:"), parts.query, parts.fragment)
    )


def http_bytes(url: str, retries: int = 3, backoff: float = 4.0) -> bytes:
    last = None
    for attempt in range(1, retries + 1):
        try:
            req = Request(
                _encode_url(url),
                headers={"User-Agent": "LatamBanksUY/1.0"},
            )
            with _OPENER.open(req, timeout=120) as r:
                return r.read()
        except (HTTPError, URLError, TimeoutError, ssl.SSLError) as e:
            last = e
            log.warning("intento %d/%d fallo %s: %s", attempt, retries, url, e)
            if attempt < retries:
                time.sleep(backoff * attempt)
    raise last


def http_text(url: str) -> str:
    return http_bytes(url).decode("latin-1", errors="ignore")


def month_url(yyyy: int, mm: int) -> str:
    return f"{BASE}/{yyyy}/{MONTH_NAMES[mm]}/"


def period_to_ym(periodo: str) -> tuple[int, int]:
    return int(periodo[:4]), int(periodo[4:6])


def ym_to_period(y: int, m: int) -> str:
    return f"{y}{m:02d}"


def iter_periods(start: str, end: str) -> list[str]:
    y, m = period_to_ym(start)
    ye, me = period_to_ym(end)
    out = []
    while (y, m) <= (ye, me):
        out.append(ym_to_period(y, m))
        m += 1
        if m > 12:
            m = 1
            y += 1
    return out


def index_exists(periodo: str) -> bool:
    y, m = period_to_ym(periodo)
    url = urljoin(month_url(y, m), "indice.htm")
    try:
        http_bytes(url, retries=1)
        return True
    except Exception:
        return False


def discover_available_periods(start: str = MIN_PERIOD, end: str | None = None) -> list[str]:
    if end is None:
        from datetime import date

        today = date.today()
        end = ym_to_period(today.year, today.month)
    found = []
    for p in iter_periods(max(start, MIN_PERIOD), end):
        if index_exists(p):
            found.append(p)
            log.info("catálogo: %s OK", p)
    log.info(
        "Catálogo UY: %d meses (%s .. %s)",
        len(found),
        found[0] if found else "—",
        found[-1] if found else "—",
    )
    return found


def recent_candidate_periods(n_months: int = 4) -> list[str]:
    """Últimos n meses calendario (para cron incremental sin sondear 5 años)."""
    from datetime import date

    today = date.today()
    y, m = today.year, today.month
    out = []
    for _ in range(n_months):
        out.append(ym_to_period(y, m))
        m -= 1
        if m == 0:
            m = 12
            y -= 1
    return list(reversed(out))


def _fold(s: str) -> str:
    """Minúsculas sin tildes ni puntuación suelta, para comparar etiquetas del boletín."""
    txt = unicodedata.normalize("NFKD", str(s or ""))
    txt = "".join(ch for ch in txt if not unicodedata.combining(ch))
    txt = txt.lower().replace("\xa0", " ")
    txt = re.sub(r"[^a-z0-9 ]+", " ", txt)
    return re.sub(r"\s+", " ", txt).strip()


def parse_cuenta(label: str) -> tuple[str, str] | None:
    """Devuelve (cuenta, descripcion) o None si la fila no es dato."""
    lab = re.sub(r"\s+", " ", str(label or "").strip())
    if not lab:
        return None
    skip = {
        "banco central del uruguay",
        "superintendencia de servicios financieros",
        "estado de situación",
        "estado de resultados",
        "volver al índice",
        "operaciones continuas",
        "operaciones discontinuadas",
        "cifras en miles de pesos",
    }
    low = lab.lower()
    if low in skip or low.startswith("datos al ") or low.startswith("(período"):
        return None
    if low.startswith("actividad en"):
        return None

    m = re.match(r"^(\d+(?:\.\d+)*)\s*[-–]\s*(.+)$", lab)
    if m:
        return m.group(1), m.group(2).strip()

    # Subtotales / totales sin código numérico
    slug = re.sub(r"[^a-z0-9]+", "_", low).strip("_")
    if not slug:
        return None
    return f"S_{slug}", lab


def _cell_num(sh, r: int, c: int) -> int:
    try:
        v = sh.cell_value(r, c)
        if v in ("", None):
            return 0
        return int(round(float(v) * SCALE))
    except (TypeError, ValueError):
        return 0


def _cell_raw(sh, r: int, c: int) -> float:
    """Valor sin escalar (el Anexo 3 también trae cantidades de clientes)."""
    try:
        v = sh.cell_value(r, c)
        if v in ("", None):
            return 0.0
        return float(v)
    except (TypeError, ValueError):
        return 0.0


def _mn_me_total(sh, r: int) -> tuple[int, int, int]:
    """Lee M/N, M/E y Total según layout de la hoja.

    Situación / Resultados: 4 cols → MN=1, ME=2, Total=3
    Anexo 1: 6 cols → MN=3, ME=4, Total=5
    """
    if sh.ncols >= 6:
        return _cell_num(sh, r, 3), _cell_num(sh, r, 4), _cell_num(sh, r, 5)
    if sh.ncols >= 4:
        return _cell_num(sh, r, 1), _cell_num(sh, r, 2), _cell_num(sh, r, 3)
    total_col = sh.ncols - 1 if sh.ncols else 0
    tot = _cell_num(sh, r, total_col)
    return 0, 0, tot


# Anexo 1 — plazos contractuales (pasivos). Cuentas sintéticas A1_*.
_A1_SECTION_KEYS = {
    "banco central del uruguay": "BCU",
    "depósitos sector financiero": "DEPSF",
    "depositos sector financiero": "DEPSF",
    "depósitos sector no financiero": "DEPSNF",
    "depositos sector no financiero": "DEPSNF",
    "débitos representados por valores negociables": "VALORES",
    "debitos representados por valores negociables": "VALORES",
    "otros": "OTROS",
}
_A1_TERM_KEYS = {
    "vista": "VISTA",
    "menor 30 días": "LT30",
    "menor 30 dias": "LT30",
    "menor 91 días": "LT91",
    "menor 91 dias": "LT91",
    "menor 181 días": "LT181",
    "menor 181 dias": "LT181",
    "menor 367 días": "LT367",
    "menor 367 dias": "LT367",
    "menor 3 años": "LT3Y",
    "menor 3 anos": "LT3Y",
    "igual o mayor 3 años": "GE3Y",
    "igual o mayor 3 anos": "GE3Y",
}


def parse_anexo1(sh, ins_cod: int, periodo: str) -> tuple[list, dict]:
    """Parsea Anexo 1 (plazos contractuales) solo del bloque de PASIVOS.

    Emite cuentas sintéticas A1_{SECTION}_{TERM} con MN→monto_clp, ME→monto_ext.
    """
    rows = []
    plan: dict[str, str] = {}
    in_pasivos = False
    section = None

    for r in range(sh.nrows):
        c0 = str(sh.cell_value(r, 0) or "").strip()
        c1 = str(sh.cell_value(r, 1) or "").strip() if sh.ncols > 1 else ""
        c2 = str(sh.cell_value(r, 2) or "").strip() if sh.ncols > 2 else ""

        low0 = c0.lower()
        if "pasivos financieros" in low0 and "costo amortizado" in low0:
            in_pasivos = True
            section = None
            continue
        if low0.startswith("créditos") or low0.startswith("creditos"):
            in_pasivos = False
            section = None
            continue
        if not in_pasivos:
            continue

        # Nueva subsección de pasivo (col1 con nombre, col2 vacío)
        if c1 and not c2:
            key = _A1_SECTION_KEYS.get(c1.lower())
            section = key
            continue

        if not section or not c2:
            continue
        term = _A1_TERM_KEYS.get(c2.lower())
        if not term:
            continue

        mn, me, tot = _mn_me_total(sh, r)
        cuenta = f"A1_{section}_{term}"
        desc = f"Anexo1 {section} · {c2}"
        rows.append((COUNTRY, periodo, "b1", ins_cod, cuenta, mn, 0, 0, me, tot))
        plan[cuenta] = desc

    return rows, plan


# Anexo 2 — apertura de créditos y deterioro (activo). Cuentas sintéticas A2_*.
# Labels carry BCU numbering (e.g. "1.4. Créditos … no residente"); we emit A2_1_4.
_A2_SPECIAL = {
    "créditos": ("A2_GROSS", "Créditos brutos (Anexo 2)"),
    "creditos": ("A2_GROSS", "Créditos brutos (Anexo 2)"),
    "(deterioro)": ("A2_D_TOTAL", "Deterioro total (Anexo 2)"),
}


def _a2_cuenta_from_label(lab: str) -> tuple[str, str] | None:
    """Map Anexo 2 label → (cuenta sintética, descripción)."""
    raw = re.sub(r"\s+", " ", str(lab or "").strip())
    if not raw:
        return None
    low = raw.lower()
    if low in _A2_SPECIAL:
        return _A2_SPECIAL[low]

    # "1.3.d. (Deterioro)" / "2.2.3.d (Deterioro)" / "1.d. (Deterioro)"
    m_d = re.match(r"^(\d+(?:\.\d+)*)\.?\s*d\.?\s*(?:\(|$)", low)
    if m_d:
        code = "A2_" + m_d.group(1).replace(".", "_") + "_D"
        return code, raw

    # "1. Créditos vigentes" / "1.4. Créditos … no residente" / "2.2.3 Créditos morosos"
    m = re.match(r"^(\d+(?:\.\d+)*)\.?\s+(.+)$", raw)
    if m:
        code = "A2_" + m.group(1).replace(".", "_")
        return code, raw

    return None


def parse_anexo2(sh, ins_cod: int, periodo: str) -> tuple[list, dict]:
    """Parsea Anexo 2 (créditos + deterioro) con MN/ME/Total → b1 rows A2_*."""
    rows = []
    plan: dict[str, str] = {}
    for r in range(sh.nrows):
        parsed = _a2_cuenta_from_label(sh.cell_value(r, 0))
        if not parsed:
            continue
        cuenta, desc = parsed
        mn, me, tot = _mn_me_total(sh, r)
        rows.append((COUNTRY, periodo, "b1", ins_cod, cuenta, mn, 0, 0, me, tot))
        plan[cuenta] = desc
    return rows, plan


# Anexo 3 — estructura de depósitos por tramo de saldo. Cuentas sintéticas A3_*.
#
# La grilla del boletín cruza tramo (columnas) con plazo × moneda × residencia
# (filas). Como la tabla guarda M/N y M/E en columnas propias, la moneda se
# colapsa en monto_clp / monto_ext y solo quedan plazo y residencia en el código:
#   A3_{PLAZO}_{RESIDENCIA}_{TRAMO}   montos
#   A3_CLI_{RESIDENCIA}_{TRAMO}       cantidad de clientes (NO son pesos)
# La apertura por residencia solo se emite para el plazo agregado (ALL): el cruce
# plazo × residencia × tramo son 60 filas más por banco y mes sin uso analítico
# que lo justifique.
_A3_TERMS = {
    "total": "ALL",
    "vista y menores de 30 dias": "V30",
    "menores de 1 ano": "L1Y",
    "1 ano y mayores": "G1Y",
}
_A3_TERM_LABELS = {
    "ALL": "todos los plazos",
    "V30": "vista y <30 días",
    "L1Y": "<1 año",
    "G1Y": "≥1 año",
}
_A3_CURRENCIES = {"moneda nacional": "mn", "moneda extranjera": "me"}
_A3_RESIDENCE = {"residentes": "R", "no residentes": "NR"}
_A3_RES_LABELS = {"T": "total", "R": "residentes", "NR": "no residentes"}


def _a3_tranche_keys(sh) -> dict[int, tuple[str, str]]:
    """Columna → (clave de tramo, etiqueta), leídos del encabezado del Anexo 3."""
    header = next(
        (r for r in range(sh.nrows) if _fold(sh.cell_value(r, 0)) == "descripcion"),
        None,
    )
    if header is None:
        return {}
    out: dict[int, tuple[str, str]] = {}
    for c in range(1, sh.ncols):
        label = re.sub(r"\s+", " ", str(sh.cell_value(header, c) or "")).strip()
        low = _fold(label)
        if not low:
            continue
        if low == "total":
            out[c] = ("TOT", label)
            continue
        # El monto va sobre la etiqueta cruda: _fold borra los puntos de millar
        # y "U$S 250.000" quedaría en 250.
        m = re.search(r"u\$?s\s*([\d.,]+)", label, flags=re.I)
        if not m:
            continue
        miles = int(re.sub(r"\D", "", m.group(1))) // 1000
        out[c] = (f"{'GT' if low.startswith('superiores') else 'LE'}{miles}K", label)
    return out


def parse_anexo3(sh, ins_cod: int, periodo: str) -> tuple[list, dict]:
    """Parsea Anexo 3 (estructura de depósitos) → filas b1 con A3_*."""
    tramos = _a3_tranche_keys(sh)
    if not tramos:
        return [], {}

    clientes: dict[tuple[str, int], float] = {}
    montos: dict[tuple[str, str, int], float] = {}
    block = None
    term = None
    currency = None

    for r in range(sh.nrows):
        low = _fold(sh.cell_value(r, 0))
        if not low:
            continue
        if low == "cantidad de clientes":
            block, term, currency = "cli", None, None
            continue
        if low == "monto operativo":
            block, term, currency = "montos", "ALL", None
            continue
        if block == "cli":
            res = _A3_RESIDENCE.get(low.replace("total clientes", "").strip() or "total")
            key = res or "T"
            for c in tramos:
                clientes[(key, c)] = _cell_raw(sh, r, c)
            continue
        if block != "montos":
            continue

        if low in _A3_TERMS:
            term, currency = _A3_TERMS[low], None
            for c in tramos:
                montos[(term, "total", c)] = _cell_raw(sh, r, c)
            continue
        if low in _A3_CURRENCIES:
            currency = _A3_CURRENCIES[low]
            for c in tramos:
                montos[(term, currency, c)] = _cell_raw(sh, r, c)
            continue
        res = _A3_RESIDENCE.get(low)
        if res and term == "ALL" and currency:
            for c in tramos:
                montos[(term, f"{currency}_{res}", c)] = _cell_raw(sh, r, c)

    rows = []
    plan: dict[str, str] = {}

    for col, (tramo, label) in tramos.items():
        for term_key in _A3_TERMS.values():
            mn = montos.get((term_key, "mn", col), 0.0)
            me = montos.get((term_key, "me", col), 0.0)
            tot = montos.get((term_key, "total", col), 0.0)
            if (mn, me, tot) == (0.0, 0.0, 0.0):
                continue
            cuenta = f"A3_{term_key}_T_{tramo}"
            rows.append((
                COUNTRY, periodo, "b1", ins_cod, cuenta,
                int(round(mn * SCALE)), 0, 0, int(round(me * SCALE)), int(round(tot * SCALE)),
            ))
            plan[cuenta] = f"Anexo3 depósitos {_A3_TERM_LABELS[term_key]} · {label}"[:120]

        for res in ("R", "NR"):
            mn = montos.get(("ALL", f"mn_{res}", col), 0.0)
            me = montos.get(("ALL", f"me_{res}", col), 0.0)
            if (mn, me) == (0.0, 0.0):
                continue
            cuenta = f"A3_ALL_{res}_{tramo}"
            rows.append((
                COUNTRY, periodo, "b1", ins_cod, cuenta,
                int(round(mn * SCALE)), 0, 0,
                int(round(me * SCALE)), int(round((mn + me) * SCALE)),
            ))
            plan[cuenta] = f"Anexo3 depósitos {_A3_RES_LABELS[res]} · {label}"[:120]

        for res in ("T", "R", "NR"):
            n = clientes.get((res, col), 0.0)
            if not n:
                continue
            cuenta = f"A3_CLI_{res}_{tramo}"
            rows.append((COUNTRY, periodo, "b1", ins_cod, cuenta, 0, 0, 0, 0, int(round(n))))
            plan[cuenta] = f"Anexo3 clientes {_A3_RES_LABELS[res]} · {label} (cantidad)"[:120]

    return rows, plan


# Anexo 4 — indicadores (ratios). Stored as tipo='q1'; value in monto_total.
# Se ingiere el anexo completo: el código es A4_{ROMANO}_{N} tal como lo numera
# el BCU, así que los que ya existían (A4_IV_1, A4_VII_*, A4_I_2) no se mueven.
# Ojo: I.1, I.3 y I.6 son "número de veces", no porcentajes; el ×100 se aplica
# igual y el frontend decide cómo rotularlos.


def parse_anexo4(sh, ins_cod: int, periodo: str) -> tuple[list, dict]:
    """Parsea Anexo 4 indicadores; emite tipo=q1 con monto_total = valor %.

    Ratios must NEVER be summed across banks — frontend recomputes from stocks for groups.
    """
    rows = []
    plan: dict[str, str] = {}
    for r in range(sh.nrows):
        lab = re.sub(r"\s+", " ", str(sh.cell_value(r, 0) or "")).strip()
        if not lab:
            continue
        # Abajo de los indicadores viene el bloque DEFINICIONES, que repite la
        # misma numeración ("I.1 - (Pasivo - Pasivos subordinados) / …").
        if _fold(lab) == "definiciones":
            break
        m = re.match(r"^([IVX]+)\.(\d+)\s*[-–]\s*(.+)$", lab, flags=re.I)
        if not m:
            continue
        cuenta = f"A4_{m.group(1).upper()}_{m.group(2)}"
        try:
            raw = sh.cell_value(r, 1 if sh.ncols > 1 else 0)
            val = float(raw)
        except (TypeError, ValueError):
            continue  # "N/C - No corresponde" y celdas vacías
        # Store as percent ×100 (2.19% → 219) — matches aqRatioFromQ1 in aqCuentas.js
        scaled = int(round(val * 100))
        rows.append((COUNTRY, periodo, "q1", ins_cod, cuenta, 0, 0, 0, 0, scaled))
        plan[cuenta] = m.group(3).strip()[:120]
    return rows, plan


# Anexo 5 — Responsabilidad Patrimonial Neta (capital regulatorio).
# Una sola columna de importe, sin apertura por moneda.
_A5_SECTIONS = {
    "responsabilidad patrimonial neta": ("A5_RPN", None),
    "patrimonio neto esencial": ("A5_PNE", None),
    "capital comun": ("A5_CC", "CC"),
    "capital adicional": ("A5_CA", "CA"),
    "patrimonio neto complementario": ("A5_PNC", "PNC"),
}
# "Primas de emisión" y "Deducciones 100%" aparecen bajo capital común y bajo
# capital adicional, así que el sufijo se cuelga de la sección vigente.
# Varias líneas cambiaron de redacción con los años (valoración→valorización,
# previsiones→provisiones, singular→plural); los alias apuntan al mismo código
# para no partir la serie en dos.
_A5_ITEMS = {
    "capital integrado": "CAPINT",
    "aportes a capitalizar": "APORTES",
    "primas de emision": "PRIMAS",
    "otros instrumentos de capital": "OTROSINST",
    "reservas": "RESERVAS",
    "resultados acumulados": "RESACUM",
    "resultados del ejercicio": "RESEJ",
    "resultado del ejercicio": "RESEJ",
    "ajustes por valorizacion": "AJVAL",
    "ajustes por valoracion": "AJVAL",
    "deducciones 100": "DED100",
    "deducciones 10": "DED10",
    "acciones preferidas": "PREF",
    "acciones cooperativas ley 17 613": "COOP",
    "acciones coop con interes ley no 17 613": "COOP",
    "participaciones subordinadas y participaciones con interes": "PARTSUB",
    "instrumentos subordinados convertibles en acciones": "CONV",
    "otros instrumentos financieros emitidos": "OTROSIF",
    "obligaciones subordinadas": "SUBORD",
    "provisiones generales": "PROVGEN",
    "previsiones generales": "PROVGEN",
}


def parse_anexo5(sh, ins_cod: int, periodo: str) -> tuple[list, dict]:
    """Parsea Anexo 5 (RPN y sus componentes) → filas b1 con A5_*, solo total."""
    rows = []
    plan: dict[str, str] = {}
    section = None
    for r in range(sh.nrows):
        raw = re.sub(r"\s+", " ", str(sh.cell_value(r, 0) or "")).strip()
        low = _fold(raw)
        if not low or low.startswith("resultados acumulados y resultado del ejercicio"):
            continue
        if low in _A5_SECTIONS:
            cuenta, section = _A5_SECTIONS[low]
        else:
            suffix = _A5_ITEMS.get(low)
            if not suffix or not section:
                continue
            cuenta = f"A5_{section}_{suffix}"
        tot = _cell_num(sh, r, 1 if sh.ncols > 1 else 0)
        rows.append((COUNTRY, periodo, "b1", ins_cod, cuenta, 0, 0, 0, 0, tot))
        plan[cuenta] = f"Anexo5 {raw}"[:120]
    return rows, plan


# ERI — Estado de Resultados Integral (resultado del ejercicio + ORI).
_ERI_BLOCKS = {
    "a resultado del ejercicio": ("ERI_A", None),
    "b otro resultado integral": ("ERI_B", None),
    "partidas que no se reclasificaran al resultado del periodo": ("ERI_B1", "B1"),
    "partidas que pueden reclasificarse posteriormente al resultado del periodo": ("ERI_B2", "B2"),
    "c resultado integral total del ano": ("ERI_C", None),
}
# "Impuesto a las ganancias relacionado con partidas que…" se repite en ambos
# bloques, por eso el sufijo se cuelga del bloque vigente igual que en Anexo 5.
_ERI_ITEMS = {
    "superavit por revaluacion": "REVAL",
    "nuevas mediciones del pasivo o activo por beneficios definidos": "BENEF",
    "entidades valoradas por el metodo de la participacion": "PARTIC",
    "instrumentos de patrimonio con cambios en otro resultado integral": "IPORI",
    "diferencia de cambio por negocios en el extranjero": "FXNEG",
    "diferencia de cotizacion de instrumentos financieros": "FXINST",
    "coberturas de inversiones netas en negocios en el extranjero": "HEDGENET",
    "coberturas de los flujos de efectivo": "HEDGECF",
}


def parse_eri(sh, ins_cod: int, periodo: str) -> tuple[list, dict]:
    """Parsea el Estado de Resultados Integral → filas r1 con ERI_*."""
    rows = []
    plan: dict[str, str] = {}
    block = None
    for r in range(sh.nrows):
        raw = re.sub(r"\s+", " ", str(sh.cell_value(r, 0) or "")).strip()
        low = _fold(raw)
        if not low:
            continue
        if low in _ERI_BLOCKS:
            cuenta, block = _ERI_BLOCKS[low]
        elif low.startswith("impuesto a las ganancias"):
            if not block:
                continue
            cuenta = f"ERI_{block}_TAX"
        else:
            suffix = _ERI_ITEMS.get(low)
            if not suffix or not block:
                continue
            cuenta = f"ERI_{block}_{suffix}"
        tot = _cell_num(sh, r, 1 if sh.ncols > 1 else 0)
        rows.append((COUNTRY, periodo, "r1", ins_cod, cuenta, 0, 0, 0, 0, tot))
        plan[cuenta] = f"ERI {raw}"[:120]
    return rows, plan


def parse_institution_xls(data: bytes, ins_cod: int, periodo: str):
    """Parsea Situación (b1) + Resultados (r1) + Anexo 1/2/4. Retorna (nombre, rows, plan_pairs)."""
    book = xlrd.open_workbook(file_contents=data)
    nombre = ""
    if "Indice" in book.sheet_names():
        nombre = str(book.sheet_by_name("Indice").cell_value(5, 1) or "").strip()

    rows = []
    plan = {}
    # La razón social encabeza cada hoja; sin esto se cuela al plan de cuentas
    # como un S_* distinto por banco.
    es_titulo = {_fold(nombre)} if nombre else set()

    if "Situación" in book.sheet_names():
        sh = book.sheet_by_name("Situación")
        if not nombre:
            nombre = str(sh.cell_value(3, 0) or "").strip()
            es_titulo = {_fold(nombre)}
        for r in range(sh.nrows):
            parsed = parse_cuenta(sh.cell_value(r, 0))
            if not parsed or _fold(parsed[1]) in es_titulo:
                continue
            cuenta, desc = parsed
            mn, me, tot = _mn_me_total(sh, r)
            rows.append((COUNTRY, periodo, "b1", ins_cod, cuenta, mn, 0, 0, me, tot))
            plan[cuenta] = desc

    if "Resultados" in book.sheet_names():
        sh = book.sheet_by_name("Resultados")
        if not nombre:
            nombre = str(sh.cell_value(3, 0) or "").strip()
            es_titulo = {_fold(nombre)}
        for r in range(sh.nrows):
            parsed = parse_cuenta(sh.cell_value(r, 0))
            if not parsed or _fold(parsed[1]) in es_titulo:
                continue
            cuenta, desc = parsed
            # Preferir código estable para el KPI de utilidad
            if desc.lower() == "resultado del ejercicio" or cuenta == "S_resultado_del_ejercicio":
                cuenta = "R_EJERCICIO"
                desc = "Resultado del ejercicio"
            mn, me, tot = _mn_me_total(sh, r)
            rows.append((COUNTRY, periodo, "r1", ins_cod, cuenta, mn, 0, 0, me, tot))
            plan[cuenta] = desc

    # Anexo 1 — apertura por plazos (vista / buckets) con MN/ME
    anexo1 = next((n for n in book.sheet_names() if n.strip().lower().startswith("anexo 1")), None)
    if anexo1:
        a_rows, a_plan = parse_anexo1(book.sheet_by_name(anexo1), ins_cod, periodo)
        rows.extend(a_rows)
        plan.update(a_plan)

    # Anexo 2 — créditos brutos / residencia / deterioro
    anexo2 = next((n for n in book.sheet_names() if n.strip().lower().startswith("anexo 2")), None)
    if anexo2:
        a2_rows, a2_plan = parse_anexo2(book.sheet_by_name(anexo2), ins_cod, periodo)
        rows.extend(a2_rows)
        plan.update(a2_plan)

    # Anexo 3 — estructura de depósitos por tramo de saldo
    anexo3 = next((n for n in book.sheet_names() if n.strip().lower().startswith("anexo 3")), None)
    if anexo3:
        a3_rows, a3_plan = parse_anexo3(book.sheet_by_name(anexo3), ins_cod, periodo)
        rows.extend(a3_rows)
        plan.update(a3_plan)

    # Anexo 4 — indicadores (tipo q1)
    anexo4 = next((n for n in book.sheet_names() if n.strip().lower().startswith("anexo 4")), None)
    if anexo4:
        a4_rows, a4_plan = parse_anexo4(book.sheet_by_name(anexo4), ins_cod, periodo)
        rows.extend(a4_rows)
        plan.update(a4_plan)

    # Anexo 5 — responsabilidad patrimonial neta (capital regulatorio)
    anexo5 = next((n for n in book.sheet_names() if n.strip().lower().startswith("anexo 5")), None)
    if anexo5:
        a5_rows, a5_plan = parse_anexo5(book.sheet_by_name(anexo5), ins_cod, periodo)
        rows.extend(a5_rows)
        plan.update(a5_plan)

    # ERI — estado de resultados integral
    eri = next((n for n in book.sheet_names() if n.strip().lower() == "eri"), None)
    if eri:
        eri_rows, eri_plan = parse_eri(book.sheet_by_name(eri), ins_cod, periodo)
        rows.extend(eri_rows)
        plan.update(eri_plan)

    if not nombre:
        nombre = f"Institución {ins_cod}"
    return nombre, rows, plan


def bank_ids_from_groups(periodo: str) -> dict[int, str]:
    """IDs de bancos desde grupo99 (oficiales) + grupo997 (privados)."""
    y, m = period_to_ym(periodo)
    base = month_url(y, m)
    found: dict[int, str] = {}
    for gf in GROUP_FILES:
        try:
            data = http_bytes(urljoin(base, gf))
        except Exception as e:
            log.warning("grupo %s no disponible: %s", gf, e)
            continue
        book = xlrd.open_workbook(file_contents=data)
        sh = book.sheet_by_name("Situación") if "Situación" in book.sheet_names() else book.sheet_by_index(0)
        # Buscar fila de encabezados con patrones "113 Itaú" / "1 BROU"
        # (evitar celdas de plan de cuentas tipo "1 - ACTIVOS").
        for r in range(min(15, sh.nrows)):
            for c in range(sh.ncols):
                cell = str(sh.cell_value(r, c) or "").strip()
                m_id = re.match(r"^(\d+)\s+(.+)$", cell)
                if not m_id:
                    continue
                iid = int(m_id.group(1))
                name = m_id.group(2).strip()
                if not name or name.startswith("-") or name.startswith("–"):
                    continue
                if re.match(r"^[-–]\s*", name):
                    continue
                # Preferir el primer match “limpio” por ID
                if iid not in found:
                    found[iid] = name
        # También listar institucion links no aplica aquí; IDs ya en headers
    if not found:
        # Fallback mínimo si fallan los grupos
        found = {1: "BROU", 91: "BHU", 113: "Itaú", 128: "Scotiabank", 137: "Santander", 153: "BBVA"}
        log.warning("usando allowlist fallback de bancos")
    log.info("Bancos en grupos: %d → %s", len(found), sorted(found))
    return found


def list_institution_ids_in_index(periodo: str) -> set[int]:
    y, m = period_to_ym(periodo)
    html = http_text(urljoin(month_url(y, m), "indice.htm"))
    return {int(x) for x in re.findall(r"institucion(\d+)\.xls", html, flags=re.I)}


# ---------------------------------------------------------------------------
# DB
# ---------------------------------------------------------------------------
def get_db_url() -> str:
    url = os.environ.get("COCKROACH_URL")
    if not url:
        raise SystemExit("Falta COCKROACH_URL (.env o entorno).")
    return url


def connect():
    import psycopg2

    return psycopg2.connect(get_db_url())


def upsert(conn, table, cols, updates, conflict, rows):
    import psycopg2.extras

    if not rows:
        return
    cur = conn.cursor()
    sql = (
        f"INSERT INTO {table} ({','.join(cols)}) VALUES %s "
        f"ON CONFLICT ({','.join(conflict)}) DO UPDATE SET "
        + ", ".join(f"{c}=EXCLUDED.{c}" for c in updates)
    )
    for i in range(0, len(rows), BATCH):
        psycopg2.extras.execute_values(cur, sql, rows[i : i + BATCH])
    conn.commit()


def wipe_uy(conn):
    cur = conn.cursor()
    for t in ("datos_financieros", "instituciones", "plan_cuentas", "carga_log"):
        cur.execute(f"DELETE FROM {t} WHERE country=%s", (COUNTRY,))
    conn.commit()
    log.info("Uruguay borrado (solo country='UY').")


def get_loaded_periods(conn) -> set[str]:
    cur = conn.cursor()
    cur.execute(
        "SELECT periodo FROM carga_log WHERE country=%s AND estado IN ('ok','alerta_esquema')",
        (COUNTRY,),
    )
    return {r[0] for r in cur.fetchall()}


def load_month(conn, periodo: str) -> None:
    from schema_guard import detect_schema_changes, get_known_accounts, record_schema_result

    y, m = period_to_ym(periodo)
    base = month_url(y, m)
    banks = {k: v for k, v in bank_ids_from_groups(periodo).items() if k not in AGGREGATE_IDS}
    in_index = list_institution_ids_in_index(periodo) - AGGREGATE_IDS
    targets = sorted(set(banks) & in_index) or sorted(banks)
    log.info("dt=%s cargando %d bancos: %s", periodo, len(targets), targets)

    known = get_known_accounts(conn, COUNTRY)
    all_rows = []
    inst_rows = []
    plan: dict[str, str] = {}

    for iid in targets:
        url = urljoin(base, f"institucion{iid}.xls")
        try:
            data = http_bytes(url)
        except Exception as e:
            log.warning("skip institucion%d: %s", iid, e)
            continue
        nombre, rows, plan_i = parse_institution_xls(data, iid, periodo)
        # Preferir nombre del Excel; fallback al del grupo
        if not nombre or nombre.startswith("Institución"):
            nombre = banks.get(iid, nombre)
        if iid in RAZON_SOCIAL_OVERRIDES:
            nombre = RAZON_SOCIAL_OVERRIDES[iid]
        inst_rows.append((COUNTRY, iid, nombre))
        all_rows.extend(rows)
        plan.update(plan_i)

    if not all_rows:
        raise RuntimeError(f"Sin filas de datos para {periodo}")

    incoming = {r[4] for r in all_rows}
    report = detect_schema_changes(COUNTRY, periodo, incoming, known)

    upsert(
        conn,
        "instituciones",
        ["country", "codigo", "razon_social"],
        ["razon_social"],
        ["country", "codigo"],
        inst_rows,
    )
    upsert(
        conn,
        "plan_cuentas",
        ["country", "cuenta", "descripcion"],
        ["descripcion"],
        ["country", "cuenta"],
        [(COUNTRY, c, d) for c, d in sorted(plan.items())],
    )
    upsert(
        conn,
        "datos_financieros",
        [
            "country",
            "periodo",
            "tipo",
            "ins_cod",
            "cuenta",
            "monto_clp",
            "monto_uf",
            "monto_tc",
            "monto_ext",
            "monto_total",
        ],
        ["monto_clp", "monto_uf", "monto_tc", "monto_ext", "monto_total"],
        ["country", "periodo", "tipo", "ins_cod", "cuenta"],
        all_rows,
    )
    upsert(
        conn,
        "carga_log",
        ["country", "periodo", "archivos_procesados", "estado"],
        ["archivos_procesados", "estado"],
        ["country", "periodo"],
        [(COUNTRY, periodo, len(inst_rows), "ok")],
    )
    record_schema_result(conn, COUNTRY, periodo, report)
    log.info(
        "dt=%s OK: %d bancos, %d filas, %d cuentas (schema=%s)",
        periodo,
        len(inst_rows),
        len(all_rows),
        len(plan),
        report.get("status"),
    )


def main(argv: Iterable[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description="ETL Boletín SSF Uruguay → CockroachDB")
    ap.add_argument("--wipe", action="store_true")
    ap.add_argument("--month", help="AAAAMM puntual")
    ap.add_argument("--all", action="store_true", help="Recargar todo el rango (no solo faltantes)")
    ap.add_argument("--from", dest="from_dt", default=MIN_PERIOD)
    ap.add_argument("--to", dest="to_dt", default=None)
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument(
        "--skip-discover",
        action="store_true",
        help="No sondear índices: usa rango calendario (más rápido; fallará en meses sin boletín)",
    )
    args = ap.parse_args(list(argv) if argv is not None else None)

    if args.month:
        periods = [args.month]
    elif args.all or args.to_dt or (args.from_dt and args.from_dt != MIN_PERIOD):
        # Rango explícito / backfill: sondear índices en el intervalo
        periods = (
            iter_periods(args.from_dt, args.to_dt)
            if args.skip_discover and args.to_dt
            else discover_available_periods(args.from_dt, args.to_dt)
        )
    else:
        # Cron / default: solo meses recientes con índice
        periods = [p for p in recent_candidate_periods(10) if index_exists(p)]

    if args.from_dt:
        periods = [p for p in periods if p >= args.from_dt]
    if args.to_dt:
        periods = [p for p in periods if p <= args.to_dt]

    if args.dry_run:
        print(f"Meses objetivo: {len(periods)}")
        for i, p in enumerate(periods):
            y, m = period_to_ym(p)
            print(f"  {p}  {month_url(y, m)}indice.htm")
        if periods:
            banks = {
                k: v for k, v in bank_ids_from_groups(periods[-1]).items() if k not in AGGREGATE_IDS
            }
            print(f"Bancos ({periods[-1]}): {sorted(banks.items())}")
        return 0

    conn = connect()
    try:
        if args.wipe:
            wipe_uy(conn)

        if not args.month and not args.all:
            loaded = get_loaded_periods(conn)
            periods = [p for p in periods if p not in loaded]
            if not periods:
                log.info("Uruguay al día. Nada nuevo.")
                return 0

        log.info(
            "Cargando %d mes(es): %s%s",
            len(periods),
            periods[:6],
            "…" if len(periods) > 6 else "",
        )
        for p in periods:
            load_month(conn, p)
        return 0
    finally:
        conn.close()


if __name__ == "__main__":
    raise SystemExit(main())
