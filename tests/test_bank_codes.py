#!/usr/bin/env python3
"""Un banco, un código: variantes de razón social no pueden partir la serie.

Perú y México publican el mismo banco con nombres distintos de un mes a otro
(la SBS pone y quita asteriscos de nota al pie, la CNBV alterna 'Banco X' con
'X'). Cuando la variante no encontraba código se le inventaba uno por hash, así
que el banco quedaba partido en dos instituciones con media serie cada una y
las dos aparecían en el selector.
"""

from __future__ import annotations

import mexico_loader as mx
import peru_loader as pe


# ---------------------------------------------------------------- Perú (SBS)

def test_pe_asteriscos_no_cambian_el_codigo():
    assert pe.bank_code("Santander Consumer Bank*") == pe.bank_code(
        "Santander Consumer Bank"
    )
    assert pe.bank_code("Citibank***") == pe.bank_code("Citibank")
    assert pe.bank_code("Bank of China*") == pe.bank_code("Bank of China")
    assert pe.bank_code("Banco Pichincha*") == pe.bank_code("Banco Pichincha")


def test_pe_santander_consumer_no_cae_en_el_alias_de_santander():
    """El bug original: 'santander' pegaba primero y el choque daba 12+100."""
    assert pe.bank_code("Santander Consumer Bank*") == 19
    assert pe.bank_code("Banco Santander Peru") == 12


def test_pe_llamadas_al_pie_numeradas():
    assert pe.clean_bank_name("Banco de Comercio 1/") == "Banco de Comercio"
    assert pe.clean_bank_name("Interbank\n *") == "Interbank"


def test_pe_renombres_apuntan_al_banco_vivo():
    assert pe.bank_code("Banco Continental") == pe.bank_code("Banco BBVA Peru")
    assert pe.bank_code("Banco Financiero") == pe.bank_code("Banco Pichincha")
    assert pe.bank_code("Banco de Comercio") == pe.bank_code("BANCOM")
    assert pe.bank_code("Banco de China Peru") == pe.bank_code("Bank of China")


def test_pe_bancos_vigentes_conservan_su_codigo():
    """Códigos que ya están en producción: moverlos cortaría la serie."""
    vigentes = {
        "Banco BBVA Peru": 1, "BANCOM": 2, "Banco de Credito del Peru": 3,
        "Banco Pichincha": 4, "Banco Interamericano de Finanzas": 5,
        "Scotiabank Peru": 6, "Citibank": 7, "Interbank": 8, "Mibanco": 9,
        "Banco GNB": 10, "Banco Falabella Peru": 11, "Banco Santander Peru": 12,
        "Banco Ripley": 13, "Alfin Banco": 14, "Banco ICBC": 15,
        "Bank of China": 16, "Banco BCI Peru": 17, "Compartamos Banco": 18,
    }
    assert {n: pe.bank_code(n) for n in vigentes} == vigentes


# -------------------------------------------------------------- México (CNBV)

def test_mx_prefijo_banco_no_cambia_el_codigo():
    assert mx.bank_code("Banco Covalto") == mx.bank_code("Covalto")
    assert mx.bank_code("Banco Ualá") == mx.bank_code("Ualá")
    assert mx.bank_code("Kapital Bank") == mx.bank_code("Kapital")
    assert mx.bank_code("Banco Forjadores") == mx.bank_code("Banfeliz")


def test_mx_variante_apunta_al_codigo_en_uso():
    """Se conserva el código del nombre vigente para no cortar la serie viva."""
    assert mx.bank_code("Banco Covalto") == 1527
    assert mx.bank_code("Banco Ualá") == 5400
    assert mx.bank_code("Kapital Bank") == 7402
    assert mx.bank_code("Forjadores") == 3570


def test_mx_biafirme_no_es_una_variante_de_afirme():
    assert mx.bank_code("BIAfirme") == 162
    assert mx.bank_code("Afirme") == 62


def test_mx_bancos_vigentes_conservan_su_codigo():
    vigentes = {
        "Banamex": 2, "Citi México": 9, "BBVA México": 12, "Santander": 14,
        "HSBC": 21, "Banco del Bajío": 30, "Inbursa": 36, "Banca Mifel": 42,
        "Scotiabank": 44, "Banregio": 58, "Invex": 59, "Afirme": 62,
        "Banorte": 72, "J.P. Morgan": 86, "Monex": 112, "Banco Azteca": 127,
        "Compartamos": 130, "Multiva": 132, "BanCoppel": 137, "Banco Base": 145,
        "BIAfirme": 162,
    }
    assert {n: mx.bank_code(n) for n in vigentes} == vigentes
