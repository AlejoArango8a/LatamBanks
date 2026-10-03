#!/usr/bin/env python3
"""Tests del parser del Boletín SSF (Uruguay).

Fixture: Banco Itaú Uruguay, agosto 2026, descargado tal cual del BCU.
"""

from __future__ import annotations

import re
from pathlib import Path

import pytest
import xlrd

from uruguay_loader import parse_institution_xls

FIXTURE = Path(__file__).parent / "fixtures" / "bcu_institucion113_202608.xls"
PERIODO = "202608"
INS = 113
MILES = 1000  # el boletín publica en miles de pesos; el loader guarda pesos


@pytest.fixture(scope="module")
def parsed():
    nombre, rows, plan = parse_institution_xls(FIXTURE.read_bytes(), INS, PERIODO)
    return nombre, {(r[2], r[4]): r for r in rows}, rows, plan


def tot(parsed, cuenta, tipo="b1"):
    return parsed[1][(tipo, cuenta)][9]


def mn(parsed, cuenta, tipo="b1"):
    return parsed[1][(tipo, cuenta)][5]


def me(parsed, cuenta, tipo="b1"):
    return parsed[1][(tipo, cuenta)][8]


def test_nombre_y_cobertura_de_hojas(parsed):
    nombre, idx, rows, _plan = parsed
    assert nombre == "Banco Itaú Uruguay S.A."
    prefijos = {c.split("_")[0] for _t, c in idx if c[0] in "AE"}
    assert {"A1", "A2", "A3", "A4", "A5", "ERI"} <= prefijos


def test_balance_cuadra_en_moneda(parsed):
    """M/N + M/E = Total en toda la Situación: es la base de la vista de monedas.

    El BCU redondea cada columna por separado, así que el cierre es al millar.
    """
    _n, idx, _rows, _p = parsed
    for (tipo, cuenta), r in idx.items():
        if tipo != "b1" or not re.match(r"^\d", cuenta):
            continue
        assert abs(r[5] + r[8] - r[9]) <= MILES, f"{cuenta} no cuadra MN+ME=Total"


# ---------------------------------------------------------------- Anexo 5


def test_anexo5_responsabilidad_patrimonial_neta(parsed):
    assert tot(parsed, "A5_RPN") == 51_348_767 * MILES
    assert tot(parsed, "A5_PNE") == 51_348_767 * MILES
    assert tot(parsed, "A5_CC") == 36_056_047 * MILES
    assert tot(parsed, "A5_CA") == 15_292_720 * MILES
    assert tot(parsed, "A5_PNC") == 0


def test_anexo5_rpn_es_la_suma_de_sus_dos_tramos(parsed):
    assert tot(parsed, "A5_RPN") == tot(parsed, "A5_PNE") + tot(parsed, "A5_PNC")
    assert tot(parsed, "A5_PNE") == tot(parsed, "A5_CC") + tot(parsed, "A5_CA")


def test_anexo5_desambigua_lineas_repetidas_por_seccion(parsed):
    """'Primas de emisión' y 'Deducciones 100%' existen en más de una sección."""
    _n, idx, _rows, _p = parsed
    assert ("b1", "A5_CC_PRIMAS") in idx
    assert ("b1", "A5_CA_PRIMAS") in idx
    assert ("b1", "A5_CC_DED100") in idx
    assert ("b1", "A5_CA_DED100") in idx
    assert ("b1", "A5_PNC_DED100") in idx
    assert tot(parsed, "A5_CC_DED100") == 107_365 * MILES
    assert tot(parsed, "A5_CA_OTROSIF") == 15_292_720 * MILES


def test_anexo5_ignora_la_nota_al_pie(parsed):
    _n, idx, _rows, _p = parsed
    notas = [c for _t, c in idx if c.startswith("A5_") and "DISTRIBUIR" in c.upper()]
    assert notas == []


# ---------------------------------------------------------------- ERI


def test_eri_resultado_integral(parsed):
    assert tot(parsed, "ERI_A", "r1") == 8_034_344 * MILES
    assert tot(parsed, "ERI_B", "r1") == -176_139 * MILES
    assert tot(parsed, "ERI_C", "r1") == 7_858_205 * MILES
    assert tot(parsed, "ERI_A", "r1") + tot(parsed, "ERI_B", "r1") == tot(parsed, "ERI_C", "r1")


def test_eri_impuesto_se_separa_por_bloque(parsed):
    """La misma glosa de impuesto aparece bajo B1 y bajo B2."""
    _n, idx, _rows, _p = parsed
    assert ("r1", "ERI_B1_TAX") in idx
    assert ("r1", "ERI_B2_TAX") in idx
    assert tot(parsed, "ERI_B2_FXINST", "r1") == -176_139 * MILES


# ---------------------------------------------------------------- Anexo 4


def test_anexo4_trae_el_indicador_completo(parsed):
    """Antes solo se guardaban 10 de los 28 indicadores publicados."""
    _n, idx, _rows, _p = parsed
    a4 = {c for t, c in idx if t == "q1"}
    assert len(a4) == 28
    assert {f"A4_I_{i}" for i in range(1, 10)} <= a4
    assert {f"A4_II_{i}" for i in range(1, 7)} <= a4
    assert {"A4_III_1", "A4_III_2", "A4_V_1", "A4_VI_1"} <= a4


def test_anexo4_valores_en_centesimas(parsed):
    assert tot(parsed, "A4_I_4", "q1") == 1547  # RPN / APR = 15.47 %
    assert tot(parsed, "A4_II_3", "q1") == 46718  # LCR moneda nacional = 467.18 %
    assert tot(parsed, "A4_III_1", "q1") == 2641  # ROE = 26.41 %
    assert tot(parsed, "A4_I_1", "q1") == 840  # apalancamiento = 8.4 veces
    assert tot(parsed, "A4_IV_1", "q1") == 102  # morosidad = 1.02 %, igual que antes


def test_anexo4_no_lee_el_bloque_de_definiciones(parsed):
    """Las definiciones al pie repiten la numeración I.1, I.2, … con texto."""
    _n, idx, _rows, _p = parsed
    plan = parsed[3]
    assert "Apalancamiento" in plan["A4_I_1"]
    assert "Pasivos subordinados" not in plan["A4_I_1"]


# ---------------------------------------------------------------- Anexo 3

TRAMOS = ["LE5K", "LE10K", "LE15K", "LE20K", "LE25K", "LE50K", "LE100K", "LE250K", "GT250K"]


def test_anexo3_tramos_detectados_del_encabezado(parsed):
    _n, idx, _rows, _p = parsed
    presentes = {c.rsplit("_", 1)[1] for _t, c in idx if c.startswith("A3_ALL_T_")}
    assert presentes == {*TRAMOS, "TOT"}


def test_anexo3_los_tramos_suman_el_total(parsed):
    for campo in (mn, me, tot):
        assert sum(campo(parsed, f"A3_ALL_T_{t}") for t in TRAMOS) == campo(parsed, "A3_ALL_T_TOT")


def test_anexo3_moneda_y_residencia_cierran(parsed):
    assert mn(parsed, "A3_ALL_T_TOT") + me(parsed, "A3_ALL_T_TOT") == tot(parsed, "A3_ALL_T_TOT")
    assert (
        tot(parsed, "A3_ALL_R_TOT") + tot(parsed, "A3_ALL_NR_TOT")
        == tot(parsed, "A3_ALL_T_TOT")
    )


def test_anexo3_plazos_suman_el_agregado(parsed):
    plazos = ["A3_V30_T_TOT", "A3_L1Y_T_TOT", "A3_G1Y_T_TOT"]
    assert sum(tot(parsed, c) for c in plazos) == tot(parsed, "A3_ALL_T_TOT")


def test_anexo3_clientes_son_cantidades_sin_escalar(parsed):
    assert tot(parsed, "A3_CLI_T_TOT") == 578_036
    assert sum(tot(parsed, f"A3_CLI_T_{t}") for t in TRAMOS) == 578_036
    assert tot(parsed, "A3_CLI_R_TOT") + tot(parsed, "A3_CLI_NR_TOT") == 578_036


def test_anexo3_depositos_cuadran_contra_la_situacion(parsed):
    """Anexo 3 cubre depósitos del sector no financiero (2.1.3 + 2.1.4)."""
    situacion = tot(parsed, "2.1.3") + tot(parsed, "2.1.4")
    anexo3 = tot(parsed, "A3_ALL_T_TOT")
    assert abs(anexo3 - situacion) / situacion < 0.12


def test_plan_de_cuentas_describe_las_cuentas_nuevas(parsed):
    plan = parsed[3]
    assert "clientes" in plan["A3_CLI_T_TOT"].lower()
    assert plan["A5_RPN"].startswith("Anexo5")
    assert plan["ERI_C"].startswith("ERI")
