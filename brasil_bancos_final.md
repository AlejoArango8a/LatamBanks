# Brasil — Lista DEFINITIVA de bancos a mostrar

**Criterio:** bancos que son competencia / comparables (hacen intermediación financiera real: captan y prestan). Excluido el BNDES (fomento), holdings duplicadas, procesadoras de pago, corretoras, leasing/financieras de grupos, entidades en liquidación y duplicados de grupo.

**Regla de consolidación:** una entidad por grupo — la de mayor Ativo Total, con nombre limpio.

**Equity:** Patrimônio Líquido (Cosif nuevo IFRS 9), jun 2025, convertido a USD con R$ 5.18/USD. Los valores son orden de magnitud para validación, no cifras oficiales.

---

## BANCOS A MOSTRAR (32)

| # | Banco | CodInst | Equity USD M |
|---|---|---|---|
| 1 | Banco do Brasil | 00000000 | 33,732 |
| 2 | Bradesco | 60746948 | 32,300 |
| 3 | Itaú Unibanco | 60701190 | 31,332 |
| 4 | Caixa Econômica Federal | 00360305 | 21,074 |
| 5 | Santander Brasil | 90400888 | 17,730 |
| 6 | BTG Pactual | 30306294 | 12,298 |
| 7 | Safra | 58160789 | 3,697 |
| 8 | Nubank | 18236120 | 3,617 |
| 9 | Banco Clássico | 31597552 | 3,489 |
| 10 | Banco do Nordeste | 07237373 | 2,863 |
| 11 | Votorantim (BV) | 59588111 | 2,442 |
| 12 | J.P. Morgan | 33172537 | 2,329 |
| 13 | Banco XP | 33264668 | 2,290 |
| 14 | Banrisul | 92702067 | 2,055 |
| 15 | Banco Pan | 59285411 | 1,482 |
| 16 | Daycoval | 62232889 | 1,480 |
| 17 | APE Poupex | 00655522 | 1,454 |
| 18 | Banco Inter | 00416968 | 1,411 |
| 19 | Banco da Amazônia | 04902979 | 1,357 |
| 20 | Crefisa | 60779196 | 1,272 |
| 21 | Banco ABC Brasil | 28195667 | 1,271 |
| 22 | Banco UBS Brasil | 33987793 | 1,176 |
| 23 | Bank of America ML | 62073200 | 1,167 |
| 24 | Rabobank Brasil | 01023570 | 1,115 |
| 25 | Banco Citibank | 33479023 | 1,109 |
| 26 | Sicoob | 02038232 | 1,063 |
| 27 | Sicredi | 01181521 | 1,054 |
| 28 | C6 Bank | 31872495 | 696 |
| 29 | Banco Original | 92894922 | 262 |
| 30 | Banco Pine | 62144175 | 225 |
| 31 | Banco Industrial do Brasil | 31895683 | 131 |
| 32 | Banco Modal | 30723886 | 125 |

---

## DICCIONARIO DE RENOMBRADO (nombre bonito)

```python
RENOMBRAR = {
    "18236120": "Nubank",
    "00655522": "APE Poupex",
    "60779196": "Crefisa",
    "33987793": "Banco UBS Brasil",
}
```
El resto usa el nombre oficial del CSV de ISPB (guibranco/BancosBrasileiros).

---

## LISTA DE EXCLUSIÓN

```python
EXCLUIR = {
    "60872504",  # Itaú Holding (menor activo que banco operativo 60701190)
    "33657248",  # BNDES (banca de fomento, no comercial)
    "17157777",  # Banco Nacional (EN LIQUIDACIÓN desde 1995)
    "33042953",  # Citibank N.A. (sucursal, duplica grupo Citi)
    "10866788",  # Banco Bandepe (pieza del grupo Santander)
    "01027058",  # Cielo (procesadora de pagos)
    "08561701",  # PagSeguro (procesadora de pagos)
    "02332886",  # XP Investimentos CCTVM (corretora, duplica Banco XP)
    "30680829",  # Nu Financeira (duplica Nubank)
    "01701201",  # Kirton Bank (ex-HSBC, dentro de Bradesco)
    "01425787",  # Redecard (procesadora, grupo Itaú)
    "47193149",  # Santander Leasing (leasing de grupo)
    "07707650",  # Aymoré CFI (financiera grupo Santander)
    "46743943",  # Redecard SCD (procesadora, grupo Itaú)
}
```

---

## NOTAS

- **Nubank** se representa con Nu Pagamentos (`18236120`), la entidad de mayor activo del grupo. Nu Financeira y NuInvest se excluyen para no duplicar.
- **Itaú** se representa con el banco operativo (`60701190`), que tiene mayor Ativo Total que la holding (`60872504`).
- **Citi** se representa con Banco Citibank S.A. (`33479023`), mayor activo que Citibank N.A. (`33042953`).
- **C6 Bank** aparece con equity bajo (USD 696M) pese a ser un banco grande en clientes — es el dato real de IF.data tipo 3; su capital reportado es delgado.
- **Sicoob y Sicredi** son cooperativas de crédito (no bancos S.A.). Se incluyen por competir por clientes; si se prefiere solo bancos S.A., moverlos a exclusión.
- El pipeline carga TODOS los bancos de tipo 3; estas listas de exclusión/renombrado se aplican en la capa de presentación. Bancos comparables más pequeños que no están en este top se cargan igual y se muestran con su nombre de ISPB.
