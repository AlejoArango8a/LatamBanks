"""
brasil_bancos_config.py — Lista curada de bancos de Brasil para el dashboard.

EDITAR AQUÍ para agregar/quitar bancos o cambiar nombres.
No es necesario tocar ningún otro archivo.

Criterio (ver brasil_bancos_final.md):
  - Una entidad por grupo (la de mayor Ativo Total).
  - Solo bancos que hacen intermediación real (captan y prestan).
  - Excluidos: holdings duplicadas, banca de fomento, procesadoras de pago,
    corretoras, financieras de grupo, entidades en liquidación.
"""

# CodInst (ISPB de 8 dígitos) que NO deben aparecer en el ranking,
# sin importar su nombre ni su clasificación en el CSV.
EXCLUIR: set[str] = {
    "60872504",  # Itaú Unibanco Holding (holding — duplica al banco operativo 60701190)
    "33657248",  # BNDES (banca de fomento, no comercial)
    "17157777",  # Banco Nacional (en liquidación desde 1995)
    "33042953",  # Citibank N.A. (sucursal — duplica grupo Citi, representado por 33479023)
    "10866788",  # Banco Bandepe (pieza del grupo Santander)
    "01027058",  # Cielo (procesadora de pagos)
    "08561701",  # PagSeguro (procesadora de pagos)
    "02332886",  # XP Investimentos CCTVM (corretora — duplica Banco XP 33264668)
    "30680829",  # Nu Financeira (duplica Nubank, representado por 18236120)
    "01701201",  # Kirton Bank (ex-HSBC, absorbido por Bradesco)
    "01425787",  # Redecard (procesadora de pagos, grupo Itaú)
    "47193149",  # Santander Leasing (leasing de grupo)
    "07707650",  # Aymoré CFI (financiera grupo Santander)
    "46743943",  # Redecard SCD (procesadora, grupo Itaú)
    "31597552",  # Banco Clássico (family office con licencia bancaria, no banco comercial)
    "50585090",  # Banco BMG Consignado (subsidiaria de consignado — duplica grupo BMG 61186680)
}

# Nombres "bonitos" para CodInst cuyo nombre oficial en el CSV es largo o poco claro.
# El CSV de ISPB sigue siendo la fuente para todo lo que no esté aquí.
RENOMBRAR: dict[str, str] = {
    "60701190": "Itaú",
    "90400888": "Santander Brasil",
    "18236120": "Nubank",
    "00655522": "APE Poupex",
    "60779196": "Crefisa",
    "33987793": "Banco UBS Brasil",
}

# ── Limpieza de nombres (usadas por brasil_banks.py) ─────────────────────────
# Siglas que deben mantenerse en MAYÚSCULAS aunque el resto del nombre vaya
# en Title Case. Editar aquí si aparecen siglas nuevas.
SIGLAS: set[str] = {
    "S.A.", "S/A", "BTG", "XP", "UBS", "BB", "BMG", "ABC", "BBVA", "KEB",
    "ABN", "AMRO", "BNP", "JP", "J.P.", "BNDES", "C6", "BV", "BS2", "PAN",
    "MUFG", "BOCOM", "BBM", "ING", "BOFA", "HS",
}

# Preposiciones portuguesas que van en minúscula salvo que sean la primera palabra.
MINUSCULAS: set[str] = {"do", "de", "da", "dos", "das", "e"}
