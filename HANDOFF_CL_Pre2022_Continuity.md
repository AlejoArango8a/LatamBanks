# Chile pre-2022 — Continuidad máxima a través del cambio CNCB / Circular 2.243

**Fecha:** 2026-08-06  
**Contexto:** LatamBanks Chile hoy arranca en **202201** (IFRS CNCB 9 dígitos). La CMF publica ZIPs mensuales en el listing vivo desde ~**2001**. El usuario quiere el máximo de historia usable pese al quiebre contable.

**Evidencia de este doc:** ZIP `articles-50166` (dic-2021), `articles-50291` (ene-2022), listing `propertyvalue-32901`, hoja IF `Indicadores Sistema` (aid 112230) con columnas *CNCB 2022* / *CNCB 2021*.

---

## 0. Veredicto

| Pregunta | Respuesta |
|----------|-----------|
| ¿Hay ZIPs pre-2022 en CMF? | **Sí** — el listing mapea ~229 meses pre-202201 (al menos desde 200112) |
| ¿Se pueden “pegar” árboles Account View 1:1? | **No** — CoA distinto (7 vs 9 dígitos; ~448 vs ~2388 cuentas) |
| ¿Se puede continuidad de **KPIs / series**? | **Sí, alta** — la propia CMF publica fórmulas 2021↔2022 en el IF xlsx |
| ¿Unidades? | Pre-2022: **millones de CLP**. Post-2022: **pesos**. Factor ×1 000 000 al proyectar |
| ¿Qué hacer primero? | Extender `cmf_loader` para era `cncb2021`, cargar puente 2018–2021, DE/PARA KPI, UI dual-path |

**No fingir continuidad total del plan.** Sí maximizar continuidad de lo que el producto ya grafica (activos, colocaciones, depósitos, patrimonio, mora, funding tops, ROE).

---

## 1. Estado actual LatamBanks

| Capa | Hoy |
|------|-----|
| DB `carga_log` CL | **54** meses, `202201` … `202606` — **0** pre-202201 |
| `zips/` local | Desde `202201` (51 archivos; ahora también se bajaron 202110–202112 para esta research) |
| UI / mapas | 100% CoA Circular **2.243** (9 dígitos) |
| Product copy | “IFRS since Jan 2022” |

El loader actual **no** parsea bien la era vieja:

- Códigos **7 dígitos** (`1000000`) vs filtro/mental model 9 dígitos  
- `PLAN-CTAS.TXT` = `YYYY\tMM\tcuenta\tdesc` (sí lo hay pre-202406; el parser actual a veces espera `plan_de_cuentas.txt`)  
- Montos con **coma decimal** y en **millones** (`0000026995865,00`)  
- Carpeta ZIP tipo `202112 - 250122/` (republicación)  
- Sin `b2` en dic-2021; `c1`/`c2` más delgados  

---

## 2. El quiebre contable (hecho normativo)

| | **CNCB 2021 (y antes)** | **CNCB 2022 (Circular 2.243)** |
|--|-------------------------|--------------------------------|
| Vigencia | Hasta **2021-12** | Desde **2022-01-01** |
| Código | **7 dígitos** | **9 dígitos** |
| Unidad B1 | Millones de pesos (LEAME) | Pesos (LEAME) |
| Plan size (dic-21 / ene-22) | **448** cuentas | **2388** cuentas |
| Tipos en ZIP dic-21 | `b1`,`r1`,`c1`,`c2` (sin `b2`) | `b1`,`b2`,`r1`,`c1`,`c2` |

LEAME ene-2022 cita explícitamente Circular N° 2.243 / 20.12.2019, Resolución 9127.

### 2.1 Prueba de escala (Banco de Chile)

| Concepto | Dic-2021 (viejo) | Ene-2022 (nuevo) | Check |
|----------|------------------|------------------|-------|
| Activos | `1000000` = 51 702 439 **millones** | `100000000` = 50 164 403 436 446 **pesos** | `new / (old×1e6) ≈ 0.97` (mes a mes OK) |
| Colocaciones clientes | `1300000` = 33 537 758 M | `144000000` / `500000000` ≈ 33.3 / 34.2 bn pesos | coherente |
| Vista / Plazo | `2100000` / `2200000` | `241000000` / `242000000` | coherente |

Conclusión: al unificar series hay que **escalar pre-2022 × 1 000 000** antes de comparar con post-2022.

---

## 3. Continuidad semántica — lo que sí cruza

### 3.1 Fuente oficial de DE/PARA (usar esta, no adivinar)

El workbook **Reporte Mensual IF** trae en `Indicadores Sistema` dos columnas:

- *Códigos según CNCB versión 2022*  
- *Códigos según CNCB versión 2021*  

Ejemplos verificados (notación CMF con puntos → nuestros códigos sin puntos):

| KPI producto | CNCB 2022 | CNCB 2021 (fórmula CMF) |
|--------------|-----------|-------------------------|
| Colocaciones (gross product) | `500000000` | `5100 + 1270.1 + 1270.2 − 1270.1.90 − 1270.2.90` → en plan 7d: **`5100000`? / ver §3.2** + adeudado bancos neto |
| Comerciales | `145000000` | `1302` → **`1302000`** |
| Vivienda | `146000000` | `1304` → **`1304000`** |
| Consumo | `148000000` | `1305` → **`1305000`** |
| Adeudado bancos (neto) | `143100100+143200100` | `1270.1−1270.1.90 + 1270.2−1270.2.90` |
| Mora 90+ / coloc. | `(857+858+859)/500` | `(8910) / (5100+1270…)` → **`8910000`** / colocaciones |
| Mora comerciales | `857200000/145` | `8913/1302` → **`8913000`/`1302000`** |
| Deteriorada | `811/505` | `(8110)/(5100+1270…)` → **`8110000`** |
| Prov. / cartera | `149*` ratios | `1309.x / 1302…` → **`1309000`** familia |
| ROE | `590/300` | misma lógica patrimonial |
| Efficiency | `560/550` | gastos/ingresos ops |

**Matching solo por descripción es insuficiente** (153 desc compartidas pero muchas ambigüedades many-to-many: “Adeudado por bancos” pega a 20+ códigos nuevos). El IF + LEAME/Modelo-MB1 son la autoridad.

### 3.2 Puente KPI propuesto (v1 — producto LatamBanks)

Mapa **curado** para lo que el dashboard ya usa. Códigos viejos = 7 dígitos del plan dic-2021; nuevos = post-IFRS.

| Alias LatamBanks | Post-2022 (canónico UI) | Pre-2022 (sumar / usar) | Notas |
|------------------|-------------------------|-------------------------|-------|
| `assets` | `100000000` | `1000000` | TOTAL ACTIVOS (viejo dice “ACTIVOS”) |
| `liabilities` | `200000000` | `2000000` | |
| `equity` | `300000000` | `3000000` | |
| `loans_clients` | `144000000` o segmentos | `1300000` | “Créditos y cuentas por cobrar a clientes” |
| `loans_gross_product` | `500000000` | CMF: colocaciones product = clientes + bancos (− castigos?) | Preferir fórmula IF; validar vs `5100…` en Modelo |
| `loans_commercial` | `145000000` | `1302000` | |
| `loans_mortgage` | `146000000` | `1304000` | |
| `loans_consumer` | `148000000` | `1305000` | |
| `loans_banks` | `143000000` | `1270000` (bruto; restar castigos si CMF lo pide) | |
| `allowance` | `149000000` | `1309000` | Provisiones constituidas |
| `dep_sight` | `241000000` | `2100000` | |
| `dep_term` | `242000000` | `2200000` | |
| `debt_issued` | `245000000` | `2400000` | Instrumentos de deuda emitidos |
| `banks_liab` | `244000000` | `2300000` | Obligaciones con bancos |
| `net_income` | `590000000` | buscar `4900000` / utilidad del ejercicio en plan r1 | Confirmar en Modelo-MR1 |
| `npl_90` | `857000000` (+858/859) | `8910000` | Mora 90+ (c1) |
| `impaired` | `811000000` | `8110000` | Cartera deteriorada |
| `or_loss` | `847100000` | `8720000` familia | Riesgo operacional |

Archivo sugerido: `js/clDepara.js` + `data/cl_cncb2021_depara.json` (misma tabla, usada por loader para emitir **cuentas puente**).

### 3.3 Qué NO intentar en v1

- Continuidad línea-a-línea del árbol Account View / Balance completo  
- IFRS-9 stages (`…901/902/903`) pre-2022 (no existen)  
- Basilea III mensual pre-dic-2020 (otro régimen)  
- `b2` currency summary pre-2022 (no viene en el ZIP)

Account View pre-2022 puede vivir como **modo “CNCB 2021”** (árbol nativo 7 dígitos), no forzado al árbol 2022.

---

## 4. Arquitectura de datos recomendada

### 4.1 Opción elegida: **native + bridge accounts**

1. Cargar filas pre-2022 **tal cual** (`cuenta` 7 dígitos, `tipo` b1/r1/c1).  
2. Guardar montos ya convertidos a **pesos** (`monto_total = millones × 1e6`) para que `fmtKPI` no cambie.  
3. Además (o en vez, para charts) emitir **cuentas puente 9 dígitos** solo para el DE/PARA KPI:

   ```
   cuenta='500000000', monto=…   # sintetizado desde fórmula 2021
   ```

   Tag en `plan_cuentas.descripcion` o columna `formula` / metadata: `bridge:cncb2021→2022`.

4. Marcar era en `carga_log.detalle` JSON: `{ "coa": "cncb2021", "unit": "millones→pesos" }`.

**Alternativa descartada para v1:** tabla sombra `datos_financieros_cl2021` — más limpia pero duplica API.

### 4.2 Cambios de loader

| Pieza | Cambio |
|-------|--------|
| `cmf_loader.detect_periodo` | OK (sigue leyendo `b1YYYYMM`) |
| `parse_plan_cuentas` | Aceptar `PLAN-CTAS.TXT` + 7 u 9 dígitos |
| `parse` B1/R1/C1 | Detectar era por longitud de código / LEAME; parsear `,` decimal; ×1e6 si millones |
| `listado` | `CODIFIS.TXT` cuando no hay `listado_instituciones.txt` |
| `chile_loader` seeds | Extender `KNOWN` / listing merge min period (hoy corta en `202406` para merge; para backfill histórico usar `--from 201801` y `LISTING_MERGE_MIN_PERIOD` override) |
| `schema_guard` | Criticals duales: `100000000` **o** `1000000`; no alertar “25 cuentas nuevas” en el salto 202112→202201 |

### 4.3 Frontend

| Vista | Comportamiento |
|-------|----------------|
| Bank Monitor KPIs / charts | Pedir códigos canónicos 9d; si el período es `<202201`, el API ya devolvió puente **o** el cliente suma DE/PARA |
| Funding / AQ | Mismos aliases (`dep_sight`, `npl_90`, …) |
| Balance / Account View | Si `periodo < 202201`: árbol `BAL_SECTIONS_CNCB2021` (nuevo) o mensaje “detalle pre-IFRS en árbol nativo” |
| Export footer | “Series bridged across Circular 2.243 (Jan 2022); pre-2022 amounts scaled from millions” |

Bandera visual en charts: línea vertical **2022-01** “CNCB / IFRS break”.

---

## 5. Alcance histórico sugerido

| Tramo | Valor | Prioridad |
|-------|-------|-----------|
| **201801 – 202112** | 4 años pre-IFRS + puente limpio | **P0 backfill** |
| **201501 – 201712** | Ciclo completo post-crisis; CoA 7d estable-ish | P1 |
| **201001 – 201412** | Útil para banca chilena larga | P2 |
| **2001 – 2009** | Disponible en listing; más riesgo de micro-cambios CoA | P3 / on-demand |

Listing `32901` ya enumera aids; no depende de SBIF (servlets rotos).

**Puente crítico a validar a mano:** `202111`, `202112`, `202201`, `202202` para Banco de Chile / BCI / Santander / BTG — ratios de continuidad ≤ ~5–8% mes a mes en activos/colocaciones tras escala.

---

## 6. Plan de implementación (priorizado)

### P0 — Research → loader era 2021 (sin UI todavía)

1. Fixture tests: parse dic-2021 B1/C1/PLAN (este ZIP ya en `zips/articles-50166…`).  
2. `cmf_loader` dual-era + scale ×1e6.  
3. Tabla `data/cl_cncb2021_depara.json` (KPI v1 §3.2) + emisor de cuentas puente.  
4. `chile_loader.py --from 201801 --to 202112` (o workflow_dispatch `range`).  
5. `schema_guard` dual criticals + waive salto ene-2022.

### P1 — UI continuidad

1. `clDepara.js` + charts con marcador ene-2022.  
2. Copy: “Historia desde AAAA; KPIs empalmados Circular 2.243”.  
3. AQ / Funding usan aliases puente.  
4. Account View: árbol CNCB2021 o disabled con CTA.

### P2 — Profundizar DE/PARA

1. Extraer automáticamente columnas IF `Indicadores Sistema` → JSON.  
2. Más líneas funding (`412*` intereses: mapear familia `4150` vieja).  
3. Backfill 2015–2017.

### P3

1. Hasta 2001.  
2. BCCh series como QA cruzada pre-2022.  
3. Documentar excepciones por banco (fusiones, códigos IFI).

---

## 7. Riesgos y honestidad de producto

| Riesgo | Mitigación |
|--------|------------|
| Fórmulas IF usan notación `1270.1` ≠ exactamente `1270100` | Validar contra `Modelo-MB1.txt` de la era; tests con BCH |
| Algunos bancos cambian perímetro en ene-2022 | Marcar discontinuidad; no interpolar |
| Mora / deteriorada definiciones IFRS vs previo | Mostrar nota en AQ; series separables |
| Doble conteo si se suman puente + nativo en Account View | Puente solo en KPI fetch lists, no en árbol completo |
| `plan_cuentas` mezcla 7d y 9d | OK si `cuenta` es texto; UI filtra por era |

**Mensaje al usuario final (sugerido):**  
*“Chile history before Jan 2022 uses the previous CMF chart of accounts. Headline series (assets, loans, deposits, NPL) are bridged with CMF’s own 2021↔2022 mapping and scaled to pesos. Line-item statements keep the native chart for each era.”*

---

## 8. Artefactos ya en disco (research)

```
zips/articles-49865_recurso_1.zip  # 202110
zips/articles-49996_recurso_1.zip  # 202111
zips/articles-50166_recurso_1.zip  # 202112  ← CoA 7d + millones
zips/articles-50291_recurso_1.zip  # 202201  ← CoA 9d + pesos (Circular 2.243)
```

(No commitear ZIPs al repo — seguir `.gitignore` de `zips/`.)

---

## 9. Próximo PR de código (cuando se apruebe)

Rama sugerida: `cursor/chile-cncb2021-loader-a614`

1. Dual-era parse + tests con fixture recortado (no ZIP completo).  
2. DE/PARA JSON KPI v1.  
3. Backfill `201801–202112` vía Actions `workflow_dispatch`.  
4. Sin habilitar UI history hasta validar puente BCH/BCI.

---

## 10. Referencias

- Circular 2.243 / LEAME ene-2022 (dentro del ZIP)  
- Listing ZIP: https://www.cmfchile.cl/portal/estadisticas/626/w4-propertyvalue-32901.html  
- IF mapping sheet: Reportes Financieros Mensuales → *Indicadores Sistema*  
- Blueprint max-data: `HANDOFF_CL_CMF_MaxData_Blueprint.md`  
- Discovery harden: `chile_loader.py` (listing scrape, #58)

---

*Documento de diseño / investigación. No cambia el loader de producción por sí solo.*
