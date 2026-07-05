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
    """Nombre oficial (CSV/ISPB), respaldo manual, o provisional 'Instituição <ISPB>'."""
    key8 = _norm8(cod_inst)
    if not key8:
        return "Instituição desconhecida"
    return _data()[0].get(key8) or f"Instituição {key8}"


def is_bank(cod_inst: object) -> bool:
    """¿Es un banco operativo? (para el ranking del 'sistema bancário').

    Criterio robusto (el cadastro oficial TCB del BCB está caído):
      - Incluye si el 'Type' del CSV es de banco, o si el nombre oficial empieza
        por "Banco"/"Banrisul"/etc. o es la Caixa (cubre Banco XP, J.P. Morgan,
        BNDES, que a veces no traen 'Type' en el CSV).
      - Excluye holdings (nombre con "Holding") para no duplicar al banco operativo.
      - Excluye instituciones sin identificar (nombre provisional) y no-bancos
        (instituições de pagamento, corretoras, financeiras, etc.).
    """
    names, types = _data()
    key8 = _norm8(cod_inst)
    name = names.get(key8, "")
    if not name:  # sin identificar en el CSV/respaldo → no lo contamos como banco
        return False
    upper = name.upper()
    if "HOLDING" in upper:
        return False
    if types.get(key8, "") in BANK_TYPES:
        return True
    return upper.startswith("BANCO ") or "CAIXA ECON" in upper


if __name__ == "__main__":  # prueba rápida
    logging.basicConfig(level=logging.INFO)
    for c in ("00000000", "60701190", "60872504", "58160789", "33657248",
              "01425787", "30680829", "02332886", "33264668", "18236120", "999999"):
        print(f"{c} -> banco={is_bank(c)!s:<5} | {name_for(c)}")
