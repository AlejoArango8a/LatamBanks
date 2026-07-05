#!/usr/bin/env python3
"""
brasil_banks.py — Resuelve CodInst (IF.data / Olinda) -> nombre de la institución.

Fuente oficial de nombres: repositorio comunitario BancosBrasileiros, que publica
la lista de instituciones del SPB con su ISPB y razón social:
    https://raw.githubusercontent.com/guibranco/BancosBrasileiros/main/data/bancos.csv

Por qué ISPB: en IF.data el CodInst de una institución/conglomerado ES su ISPB
(Identificador do Sistema de Pagamentos Brasileiro), un código de 8 dígitos que
coincide con la base del CNPJ. Ej.: Banco do Brasil = 00000000, Itaú = 60701190.
Cruzando ISPB (CSV) contra CodInst (IF.data) obtenemos el nombre oficial (LongName).

Cobertura: bancos.csv trae ~500 instituciones del STR/PIX y cubre a TODOS los
grandes bancos. Las instituciones que no aparecen ahí (cooperativas pequeñas,
financeiras, algunos conglomerados) caen en:
  1) un diccionario de respaldo manual (BRASIL_BANKS_FALLBACK) para las grandes, y
  2) un nombre provisional estable "Instituição <ISPB>" para el resto.

Robustez: se intenta descargar el CSV en vivo; si no hay red, se usa una copia
local cacheada (assets/bancos_brasileiros.csv), que se refresca en cada descarga
exitosa.
"""

from __future__ import annotations

import csv
import io
import logging
import urllib.request
from pathlib import Path

from brasil_bancos_config import EXCLUIR, RENOMBRAR

import re

log = logging.getLogger(__name__)

CSV_URL = "https://raw.githubusercontent.com/guibranco/BancosBrasileiros/main/data/bancos.csv"
LOCAL_CSV = Path(__file__).parent / "assets" / "bancos_brasileiros.csv"

# Respaldo manual: ISPB (8 dígitos) -> nombre, SOLO para grandes instituciones que
# no están en bancos.csv (verificadas contra fuentes del BCB). El CSV tiene
# prioridad; esto solo completa lo que falta.
BRASIL_BANKS_FALLBACK: dict[str, str] = {
    "01425787": "Redecard (Itaú)",              # Redecard Instituição de Pagamento
    "07707650": "Aymoré CFI (Santander)",       # Santander Soc. de Crédito, Fin. e Inv.
}

# Tipos del CSV (columna 'Type') que corresponden a bancos operativos.
BANK_TYPES = {
    "Banco Múltiplo",
    "Banco Comercial",
    "Banco Comercial Estrangeiro - Filial no país",
    "Banco de Câmbio",
    "Banco Múltiplo Cooperativo",
    "Caixa Econômica Federal",
}

_cache: dict[str, tuple[dict[str, str], dict[str, str]]] | None = None


_SA_SUFFIX = re.compile(r"\s+S\.?/?A\.?$", re.IGNORECASE)


def _clean_name(name: str) -> str:
    """Quita el sufijo 'S.A.' / 'S/A' del final del nombre."""
    return _SA_SUFFIX.sub("", name).strip()


def _norm8(cod_inst: object) -> str:
    """Normaliza a ISPB de 8 dígitos con ceros a la izquierda (o el texto tal cual)."""
    v = "" if cod_inst is None else str(cod_inst).strip()
    return v.zfill(8) if v.isdigit() else v


def _load_csv_text() -> str:
    """Descarga bancos.csv; cachea copia local; si no hay red usa la copia local."""
    try:
        req = urllib.request.Request(CSV_URL, headers={"User-Agent": "LatamBanksBrasilLoader/1.0"})
        with urllib.request.urlopen(req, timeout=60) as r:
            text = r.read().decode("utf-8-sig", errors="replace")
        try:
            LOCAL_CSV.parent.mkdir(parents=True, exist_ok=True)
            LOCAL_CSV.write_text(text, encoding="utf-8")
        except OSError:
            pass
        return text
    except Exception as e:  # noqa: BLE001
        if LOCAL_CSV.exists():
            log.warning("No pude descargar bancos.csv (%s); uso copia local.", e)
            return LOCAL_CSV.read_text(encoding="utf-8")
        raise


def _build() -> tuple[dict[str, str], dict[str, str]]:
    """Devuelve (names, types) por ISPB a partir del CSV oficial + respaldo."""
    names: dict[str, str] = {}
    types: dict[str, str] = {}
    for row in csv.DictReader(io.StringIO(_load_csv_text())):
        ispb = _norm8(row.get("ISPB"))
        if not ispb:
            continue
        long_name = (row.get("LongName") or row.get("ShortName") or "").strip()
        if long_name:
            names[ispb] = long_name
        types[ispb] = (row.get("Type") or "").strip()
    for k, v in BRASIL_BANKS_FALLBACK.items():
        names.setdefault(_norm8(k), v)
    log.info("Nombres BR cargados: %s (CSV + respaldo)", len(names))
    return names, types


def _data() -> tuple[dict[str, str], dict[str, str]]:
    global _cache
    if _cache is None:
        _cache = _build()  # type: ignore[assignment]
    return _cache  # type: ignore[return-value]


def name_for(cod_inst: object) -> str:
    """Nombre oficial (CSV/ISPB), respaldo manual, o provisional 'Instituição <ISPB>'.

    Los nombres del diccionario RENOMBRAR (brasil_bancos_config.py) tienen
    prioridad sobre el CSV para dar nombres más limpios a instituciones concretas.
    """
    key8 = _norm8(cod_inst)
    if not key8:
        return "Instituição desconhecida"
    # 1) Nombre curado del config (prioridad máxima, ya es bonito)
    if key8 in RENOMBRAR:
        return RENOMBRAR[key8]
    # 2) Nombre oficial del CSV de ISPB / respaldo manual, sin el "S.A." del final
    raw = _data()[0].get(key8) or f"Instituição {key8}"
    return _clean_name(raw)


def is_bank(cod_inst: object) -> bool:
    """¿Debe aparecer este banco en el ranking del sistema bancário brasileño?

    Aplica primero las reglas explícitas de brasil_bancos_config.py:
      - EXCLUIR → siempre False (holdings, fomento, procesadoras, duplicados).
      - RENOMBRAR → siempre True (lista curada de los 32 bancos a mostrar).
    Para el resto usa la heurística del CSV (Type + nombre) como antes.
    """
    key8 = _norm8(cod_inst)
    if key8 in EXCLUIR:
        return False
    if key8 in RENOMBRAR:
        return True
    names, types = _data()
    name = names.get(key8, "")
    if not name:
        return False
    upper = name.upper()
    if "HOLDING" in upper:
        return False
    if types.get(key8, "") in BANK_TYPES:
        return True
    return upper.startswith("BANCO ") or "CAIXA ECON" in upper


if __name__ == "__main__":  # prueba rápida
    logging.basicConfig(level=logging.INFO)
    # Bancos a mostrar (deben salir is_bank=True con nombre limpio)
    mostrar = [
        ("00000000", "Banco do Brasil"),
        ("60746948", "Bradesco"),
        ("60701190", "Itaú Unibanco"),
        ("18236120", "Nubank"),
        ("00655522", "APE Poupex"),
        ("60779196", "Crefisa"),
        ("33987793", "Banco UBS Brasil"),
    ]
    # Excluidos (deben salir is_bank=False)
    excluidos = [
        ("60872504", "Itaú Holding"),
        ("33657248", "BNDES"),
        ("30680829", "Nu Financeira"),
        ("01425787", "Redecard"),
    ]
    print("--- DEBEN SER banco=True ---")
    for c, etiqueta in mostrar:
        print(f"  {c} | banco={is_bank(c)!s:<5} | nombre={name_for(c)!r:40} | esperado={etiqueta!r}")
    print("--- DEBEN SER banco=False ---")
    for c, etiqueta in excluidos:
        print(f"  {c} | banco={is_bank(c)!s:<5} | nombre={name_for(c)!r:40} | esperado excluido={etiqueta!r}")
