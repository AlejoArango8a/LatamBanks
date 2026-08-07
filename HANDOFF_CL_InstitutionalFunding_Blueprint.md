# Chile — Institutional Funding (Fondos Mutuos → pasivos bancarios)

Monitor Chile-only en la franja secundaria (gris) junto a Account View / Balance Sheet / Income Statement.

## Objetivo

Desde la **Cartera de Inversiones Nacionales** de fondos mutuos (CMF, mensual) construir la serie de cuánto DAP y Bonos Bancarios tienen las **AGF** en cada banco del sistema — visión cruzada AGF↔banco del funding institucional vía industria de FM.

## Fuentes CMF

| Fuente | URL / endpoint | Uso |
|--------|----------------|-----|
| Cartera nacional mensual | UI `ffm_cartera.php` → **POST** `ffm_download.php` (`mm`, `aa`, `cartera=NACI`) | Holdings por fondo |
| Registro FM ↔ AGF | `fm.bpr_menu.php` arrays `codfondos_{AGF_RUT}` | Mapear `Run Fondo` → AGF |
| Emisor | `FFM_6010211` (RUT) | Mapear a `instituciones.codigo` CMF vía `data/cl_bank_rut_map.json` |

### Columnas clave (Circular 1333)

- `Run Fondo` → fondo
- `FFM_6010211` / `FFM_6010212` → RUT emisor + DV
- `FFM_6010400` → tipo instrumento (`DPC`/`DPL` = DAP, `BB` = bono bancario)
- `FFM_6011200` → valor mercado
- `FFM_6011300` → moneda del VM (`$$` = miles de pesos → ×1000; `UF` / `PROM` con FX)

`FFM_6010800` **no** es el código CMF del banco.

## Modelo de datos

`tipo='x1'`, `monto_total` en pesos CLP.

**Por banco (`ins_cod` = código CMF):**

- `CL_IF_DAP` / `CL_IF_BB` — stock FM en ese banco
- `CL_IF_AGF_{agfRut}_DAP` / `…_BB` — desglose por AGF

**Sistema `999`:**

- Totales `CL_IF_DAP` / `CL_IF_BB`
- Totales por AGF `CL_IF_AGF_{rut}_{DAP|BB}`
- Matriz `CL_IF_AGF_{rut}_BANK_{bankCode}_{DAP|BB}`

## Archivos

| Path | Rol |
|------|-----|
| `chile_institutional_funding_loader.py` | Download / parse / upsert |
| `data/cl_bank_rut_map.json` | RUT emisor → código banco |
| `data/cl_agf_registry.json` | Lista AGF (nombres cortos) |
| `data/cl_fm_run_to_agf.json` | Cache RUN → AGF (refresco scrape) |
| `js/views/institutionalFunding.js` | UI del tab |
| `js/clInstFundingCuentas.js` | Constantes / helpers de cuentas |
| `.github/workflows/chile-institutional-funding-monthly.yml` | Cron ~día 28 |

## UI

Tab secundaria **Institutional Funding** (`data-tab="instfunding"`), habilitada solo en Chile (`INST_FUNDING_ENABLED_ISO = ['CL']`).

Modos: **By AGF** (todas las administradoras × bancos) y **By Bank** (pasivo FM del banco seleccionado: DAP vs BB y ranking de AGFs).

## Cobertura (muestra may-2025)

~98% de filas DPC/BB/DPL mapean a bancos del mapa. Queda fuera `82878900` (Tanner Servicios Financieros, no banco) y emisores extranjeros residuales.

## Loader

```bash
python chile_institutional_funding_loader.py --refresh-registry --periodo 202505
python chile_institutional_funding_loader.py --file tests/fixtures/ffm_inv_naci_sample.txt --periodo 202505 --dry-run
python chile_institutional_funding_loader.py --from 202401 --to 202505 --uf 38000 --usd 950
```
