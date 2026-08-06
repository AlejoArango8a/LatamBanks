# Chile CMF — Maximum Public Data Blueprint

**Fecha:** 2026-08-06  
**País de foco:** Chile (país de trabajo del producto)  
**Objetivo:** aprovechar al máximo lo que la CMF (y fuentes complementarias) publican de forma periódica a nivel banco, para que LatamBanks sea el panel más completo posible sobre la banca chilena — sin pedirle al usuario que intervenga.

**Verificación HTTP de este documento:** listing pages, cluster Junio 2026 (`112225–112240`), sample ZIP local `articles-99065` (Ago 2025), xlsx IF `112230` y Basilea `112239`.

---

## 0. Veredicto en una página

| Capa | Estado hoy | Qué falta para “máximo Chile” |
|------|------------|-------------------------------|
| **ZIP texto mensual** (`b1`/`r1`/`c1`) | ✅ Cargado completo (~2 400 cuentas / banco) | Discovery frágil (probe de article IDs); listing scrape |
| **ZIP `b2`/`c2`** | ❌ Skip en `cmf_loader.py` | Baja prioridad: son resúmenes delgados; casi todo está en `b1`/`c1` |
| **UI sobre datos ya cargados** | Parcial (Monitor / Balance / P&L / Funding / AQ) | **Mayor ROI:** contingent `831*`, OR `847*`, grades contingentes `856*`, IFRS-9 fases, provisiones prudenciales `279*` |
| **Pack xlsx mensual CMF** | ❌ No se ingesta | Basilea III = **dato nuevo** (RWA/CET1). Mora/provisiones/IF = QA + KPIs etiquetados |
| **API CMF Bancos v3** | ❌ | UF/USD/IPC/TMC + series delgadas; no reemplaza el CoA |
| **BCCh Series bancarias** | ❌ | Cortes producto (colocaciones/depósitos/inversiones) por banco, lag ~2m+23d |
| **Ratings** | Semi-estático (`FELLER_RATINGS` en `config.js`) | Scrape Humphrey/Feller opcional; baja frecuencia |

**Orden recomendado (Chile-first):**

1. **Endurecer discovery del ZIP** (listing `32901` + hub `28910` + cluster ±30) — **hecho** en `chile_loader.py` (P0).  
2. **Historia pre-2022 / continuidad Circular 2.243** — ver `HANDOFF_CL_Pre2022_Continuity.md`.
   Loader dual-era + DE/PARA + `--from/--to` **implementado**; backfill desde **201801**.  
3. **Surface Tier-B ya en DB** (contingentes, OR, IFRS-9, `505` vs `500`, `858/859`).  
4. **Ingestar Basilea III xlsx** (sheet de solvencia + RWA).  
5. **Ingestar ratios publicados del IF xlsx** como `tipo='q1'` (ROE/ROA/mora/cobertura oficiales CMF).  
6. **BCCh series + CMF API macros**.  
7. Cooperativas / Pilar 3 / PDFs — solo si se amplía el scope.

---

## 1. Qué tiene LatamBanks hoy (inventario)

### 1.1 Loaders

| Archivo | Rol |
|---------|-----|
| `chile_loader.py` | Discovery + incremental: seed de article IDs, probe `+1000`, Relacionados HTML, carga ZIP |
| `cmf_loader.py` | Parse ZIP → `instituciones` / `plan_cuentas` / `datos_financieros` / `carga_log` |
| Cron | `.github/workflows/chile-cmf-monthly.yml` — día 25, 14:00 UTC + `loader-failure` Issue |

**Tipos ingeridos:** `b1`, `r1`, `c1`.  
**Tipos en el ZIP pero skip:** `b2`, `c2` (`cmf_loader.py`).

**URLs actuales:**

```
https://www.cmfchile.cl/portal/estadisticas/{617|626}/articles-{AID}_recurso_1.zip
https://www.cmfchile.cl/portal/estadisticas/626/w4-article-{AID}.html
```

**Problema de discovery (confirmado):** los article IDs son contadores CMS globales. El salto May→Jun 2026 fue `111486 → 112240` (+754). El listing legacy `w4-propertyvalue-28917` **ya no lista** los ZIPs recientes; el listing vivo es:

- ✅ **ZIP texto:** https://www.cmfchile.cl/portal/estadisticas/626/w4-propertyvalue-32901.html  
- ✅ **Hub xlsx mensuales:** https://www.cmfchile.cl/portal/estadisticas/626/w4-propertyvalue-28910.html  
- ⚠️ **28917:** página vive pero el índice de artículos está **stale** (no usar como fuente primaria).

### 1.2 Frontend Chile (habilitado al 100% de tabs)

`CL_DISABLED_TABS = []`. Funding + Asset Quality ON.

| Tab | Fuente |
|-----|--------|
| Bank Monitor | `b1`+`r1`+`c1` (subset) |
| Balance / Income / Account View | Árbol CMF 9 dígitos |
| Funding Analytics | `CL_FUNDING_*` + UF/FX + gastos `412*` |
| Asset Quality | `CL_AQ_*` — mora `857`, deteriorada `811`, grades `851–855`, offshore impaired |
| Banking System | Ranking + Feller estático |
| Calidad (panel) | Solo CL |

### 1.3 Huecos honestos ya documentados

- BTG Chile: `857=0` → el UI debe liderar con deteriorada / subestándar, no “NPL 0%”.  
- Blueprint AQ Tier-B: `858*`/`859*` (mora FVOCI/FVTPL), `856*` (grades sobre contingentes), IFRS-9 `…901/902/903` — **en plan/c1, no en UI**.  
- Ratings Feller/ICR/Humphreys: tabla manual en `js/config.js`.

---

## 2. Inventario CMF — publicaciones periódicas útiles

### 2.1 Mecánica del portal

| Pieza | Template |
|-------|----------|
| Listing (propertyvalue) | `…/626/w4-propertyvalue-{PVID}.html` |
| Artículo | `…/626/w4-article-{AID}.html` |
| Archivo | `…/{617\|626}/articles-{AID}_recurso_1.{zip\|xlsx\|pdf}` |

Canal **617 → 626** (redirect). Los archivos responden en ambos.

**Cluster mensual (patrón verificado Junio 2026):**

| AID | Publicación | Archivo | Mes etiqueta |
|----:|-------------|---------|--------------|
| 112225 | Informe del Desempeño del Sistema Bancario y Cooperativas | PDF | 2026/06 |
| 112230 | Reporte Mensual de Información Financiera del Sistema Bancario | xlsx | Junio 2026 |
| 112231 | Reporte Financiero de Cooperativas de Ahorro y Crédito | xlsx | junio 2026 |
| 112232 | Instrumentos Financieros No Derivados y Derivados | xlsx | Junio 2026 |
| 112233 | Cartera Vencida del Sistema Bancario | xlsx | Junio 2026 |
| 112234 | Indicador de morosidad de 90 días o más individual | xlsx | Junio 2026 |
| 112235 | Importes en el exterior | xlsx | Junio 2026 |
| 112236 | Depósitos y Captaciones, letras, capital y reservas | xlsx | (mismo cluster) |
| 112237 | Indicadores de Provisiones por Riesgo de Crédito (bancos) | xlsx | **Mayo 2026** (lag) |
| 112238 | Índices de provisiones — Cooperativas | xlsx | Mayo 2026 |
| 112239 | Adecuación Consolidada de Capital (Basilea III) | xlsx | **Mayo 2026** (lag) |
| **112240** | **Balance y Estado de Situación Bancos (texto)** | **ZIP** | **Junio 2026** |

Regla práctica: el ZIP suele ser el **último AID del cluster**; provisiones/Basilea a menudo publican el **mes anterior** dentro del mismo batch.

### 2.2 ZIP texto — sistema de registro (ya en LatamBanks)

| Tipo CMF | Archivo | Contenido | LatamBanks |
|----------|---------|-----------|------------|
| MB1 | `b1YYYYMM###.txt` | Balance completo + columnas CLP/UF/TC/EXT | ✅ |
| MB2 | `b2…` | Resumen corto colocaciones × moneda (~9 líneas) | ❌ skip (redundante con `b1`) |
| MR1 | `r1…` | Estado de resultados (incl. intereses `412*`) | ✅ |
| MC1 | `c1…` | Árbol complementario crédito / contingentes / OR / grades | ✅ load, UI parcial |
| MC2 | `c2…` | Resumen mora top-level `857–859` (~8 líneas) | ❌ skip (casi subset de `c1`) |
| metadata | `plan_de_cuentas.txt`, listado instituciones | Catálogo | ✅ |

**Instituciones típicas:** ~17 bancos + sistema `999`.

### 2.3 Pack xlsx — Reportes Financieros Mensuales

Hub: https://www.cmfchile.cl/portal/estadisticas/626/w4-propertyvalue-28910.html

| PVID / pub | Nivel | ¿Duplica ZIP? | Valor para LatamBanks |
|------------|-------|---------------|------------------------|
| **28911** IF mensual (workbook grande) | Banco + sistema | Parcial — es el **mapa oficial** de indicadores con fórmulas a códigos CNCB | KPIs etiquetados + QA + sheets que ya están en `c1`/`b1`/`r1` |
| **28913** Cartera vencida | Banco | Parcial vs `c1` | QA / vista rápida |
| **28914** Mora 90+ individual | Banco | Parcial (`857+858+859`) | QA; muestra fórmula CMF exacta |
| **29554** Provisiones riesgo crédito | Banco | Parcial vs `149*`/`279*` | QA cobertura oficial |
| **43980** Basilea III consolidada | Banco | **No** — RWA / CET1 / colchones | **P1 ingest** |
| **28912** Derivados / no derivados | Banco | Parcial vs líneas `b1` | Treasury depth |
| **28915** Importes en el exterior | Banco | **Nuevo corte** filiales/sucursales | Foreign ops lens |
| Depósitos/captaciones xlsx | Banco | Parcial vs Funding | QA funding |
| **28918** Cooperativas | CAC | N/A | Solo si se amplía scope |
| Desempeño PDF | Sistema | Narrativa | Skip ETL |

#### Hojas clave del IF xlsx (aid 112230, verificado)

El workbook incluye, entre otras:

- Estados por banco (activos/pasivos/patrimonio/resultado)  
- **Ind. de Rentab. y Eficiencia** — ROE/ROA/ROAE con fórmulas a `585/587/590/300/100`  
- **Ind. R. Crédito Provisiones** — provisiones / cartera por segmento  
- **Ind. Mora y Deteriorada** — `(857+858+859)/500`, `811/505`, por segmento  
- **Calidad de Colocaciones 1–3** — normal / subestándar / incumplimiento  
- **Créditos contingentes** — `831*` desglose  
- **Calidad créditos contingentes** — usa árbol `856*`  
- **Eventos Riesgo Operacional** — `847*`  
- Créditos contingentes + eventos OR = **ya cargados en `c1`**, sin UI

Cada hoja documenta la fórmula CMF (`← Presione [+] para ver códigos`). Eso es un **diccionario de producto** gratis: LatamBanks puede alinear KPIs 1:1 con la CMF.

#### Basilea xlsx (aid 112239, verificado)

Hojas: `INDICADORES CONSOLIDADO`, `CAPITAL REGULATORIO Y ACTIVOS`, `REQUERIMIENTOS Y COLCHONES`, `LÍMITES…`, `CLASIFICACIÓN`.

Indicadores por banco (ej. BTG Chile May-2026): PE/APR ~19.7%, CET1/APR ~14.8%, leverage Capital Básico/Activos ~10.5%.  
**No se pueden reconstruir bien desde solo `b1`** sin APR/RWA → ingest obligatorio si queremos “solvencia CMF”.

### 2.4 Tasas / garantía / API

| Fuente | URL | Nivel | Uso |
|--------|-----|-------|-----|
| Certificado TMC / tasas | propertyvalue-30141 + https://tasas.cmfchile.cl/… | Sistema | Contexto funding, no P&L banco |
| **API CMF Bancos v3** | https://api.cmfchile.cl/ + `/documentacion/` | Banco/sistema | Key gratuita; balances/ER/adecuación/UF/USD/IPC/TMC/TIP/TAB — **más delgado que el ZIP** |
| BEST | https://www.best-cmf.cl/ | Mixed | UI interactiva; malo para ETL |
| Garantía estatal depósitos | propertyvalue-50162 | Legal | Sin serie banco |
| Pilar 3 | propertyvalue-46323 | Banco (links PDF) | Trimestral, fricción alta |
| datos.gob.cl | búsqueda CMF+banco | — | Sin dataset útil (ago 2026) |
| SBIF / cronologiabancaria servlets | legacy | Histórico | **HTTP 500** — no depender; usar `zips/` local |

### 2.5 IFRS emisores / anuales

- https://www.cmfchile.cl/institucional/estadisticas/estadisticas_ifrs.php — TXT IFRS de **emisores listados** (taxonomía distinta al CNCB bancario).  
- EEFF anuales PDF por banco — notas, consolidación.  
Útil para IR de bancos listados, **no** para el panel mensual peer-to-peer de todos los bancos CMF.

---

## 3. Otras fuentes chilenas

### 3.1 Banco Central de Chile — Series de Datos Bancarios

https://si3.bcentral.cl/estadisticas/Principal1/Excel/EMF/CDC/Series_datos_bancarios/DatosBancarios.html

| Campo | Detalle |
|-------|---------|
| Contenido | Colocaciones / depósitos / inversiones **por institución** |
| Cadencia | Mensual; publica ~día **23**, desfase **2 meses + 23 días** |
| Formato | xlsx + `Series_bancarias.zip` + CSV |
| vs CMF ZIP | Overlap de stocks, pero **cortes de producto** con metodología BCCh |

Prioridad **P1 complementaria** (no reemplaza CMF).

### 3.2 Clasificadoras

| Agencia | Acceso | Rol |
|---------|--------|-----|
| Humphreys | HTML público instituciones financieras | Tabla scrapable |
| Feller Rate | Registro gratuito para informes | Ya parcialmente en `config.js` |
| ICR / Moody’s Local | Press + platform | Event-driven |
| S&P | Paywall | Solo si el banco lo publica en IR |

Frecuencia baja → mantener semilla + refresh trimestral, no cron diario.

### 3.3 Fuera de scope bancario estricto

SP (AFP), INE (IPC ya vía API CMF), SVS (fusionada en CMF).

---

## 4. Oro escondido: ya está en la DB, no en la UI

Inspección `c1` Banco de Chile (ZIP ago-2025) — prefijos con datos:

| Prefijo | Tema | Nonzero (ej.) | En UI hoy |
|---------|------|---------------|-----------|
| `811–814`, `821`, `851–855`, `857` | AQ core | Sí | ✅ AQ sheet |
| **`831*`** | Créditos contingentes (avales, LC, líneas TC, CAE…) | 14/25 | ❌ |
| **`832–833*`** | (árbol relacionado contingentes / calidad) | parcial | ❌ |
| **`847*`** | Pérdidas OR por tipo de evento (fraude, sistemas…) | 15/17 | ❌ |
| **`856*`** | Grades sobre créditos contingentes (88 líneas) | 27 nonzero | ❌ |
| `858`/`859` | Mora 90+ FVOCI/FVTPL | a menudo 0 | ❌ (Tier-B) |
| `b1` `…901/902/903` | IFRS-9 fases 1/2/3 | en plan | ❌ |
| `b1` `271*` / `279*` | Prov. contingentes / prudenciales | en plan | ❌ parcial |
| `b1` `505000000` | Total colocaciones a **costo amortizado** | en plan | UI usa `500` gross |

Esto es el camino más barato a “máximo análisis Chile”: **mapas + sheets**, sin nuevo ETL.

### 4.1 Producto sugerido — sheets Chile-only (o secciones)

1. **Asset Quality v2 (CL)**  
   - Toggle `500` vs `505` (gross vs amortized-cost).  
   - Incluir `858+859` en mora CMF-aligned (`857+858+859` como en IF).  
   - IFRS-9 stage ladder (`901/902/903`) donde exista.  
   - Contingent quality (`856*`) como panel hermano.

2. **Off-balance / Contingentes**  
   - Stack `831*` (avales, LC, líneas, CAE).  
   - Coverage con `271*` provisiones contingentes.

3. **Operational Risk**  
   - `847*` bruta / recuperaciones / neta por tipo de evento.  
   - Cruce con gasto `4690003*` en `r1`.

4. **Solvencia (nuevo dato)**  
   - Tras ingest Basilea: CET1, T1, PE/APR, leverage, colchones.

5. **Funding v2**  
   - Ya fuerte (UF/FX). Sumar QA vs xlsx depósitos/captaciones; derivados `28912` si se quiere libro de trading.

---

## 5. Plan de discovery robusto (punto 3 del roadmap ops)

**No** tratar el article ID como fecha.

### Stack (orden)

1. **Scrape listing ZIP** `w4-propertyvalue-32901.html` → parse `aid-(\d+)` + título/mes.  
2. **Scrape hub** `w4-propertyvalue-28910.html` → mismos AIDs del cluster xlsx.  
3. Validar ZIP (`PK` magic) + `detect_periodo()` desde `b1YYYYMM###.txt`.  
4. **Cluster expand:** si aparece IF `112230`, probe `AID±30` buscando `.zip` / basilea / mora.  
5. Mantener probe lineal desde `max(known_aid)` con `PROBE_AHEAD≈1000` como red de seguridad.  
6. Persistir tabla seed `(article_id, periodo, kind, sha256, url)` en repo o DB (`carga_log` extendido).  
7. Actualizar README: reemplazar referencias a `28917` / `617/w3-…` por **`626/w4-propertyvalue-32901`**.  
8. Alerta específica: “cron OK pero **0 ZIPs nuevos** y el listing tiene un mes más nuevo que `carga_log`” (freshness).

### Pseudoflujo

```
scrape(32901) ∪ scrape(28910)
  → candidates[aid]
  → for aid in candidates:
        if zip exists and periodo not in carga_log: load
  → if no new zip: probe(max_aid … max_aid+1000)
  → cluster_expand(any hit)
  → refresh KNOWN_ARTICLE_PERIODS artifact
```

---

## 6. Roadmap de implementación (priorizado)

### P0 — Operaciones (no perder meses)

| # | Trabajo | Esfuerzo | Resultado |
|---|---------|----------|-----------|
| P0.1 | Listing scrape 32901 + hub 28910 en `chile_loader.py` | Medio | Cron Chile a prueba de saltos de ID |
| P0.2 | Persist seed map + log “no new period” | Bajo | Freshness alerts |
| P0.3 | Docs/README URLs correctas | Bajo | Onboarding |

### P1 — Máximo análisis con datos ya cargados

| # | Trabajo | Esfuerzo | Resultado |
|---|---------|----------|-----------|
| P1.1 | Mapas `CL_CONTINGENT_*`, `CL_OR_*`, IFRS-9 stages en `clCuentas`/`aqCuentas` | Medio | Nuevos paneles |
| P1.2 | AQ CL alineado a fórmulas IF (`857+858+859`, `505`) | Medio | Paridad CMF |
| P1.3 | Sheet Contingentes + OR en dashboard (CL-only OK) | Medio–alto | Diferenciación Chile |
| P1.4 | Bank Monitor KPIs: ROE/ROA CMF-aligned (ya hay cuentas) | Bajo | Paridad IF “Rentabilidad” |

### P1 — Dato nuevo imprescindible

| # | Trabajo | Esfuerzo | Resultado |
|---|---------|----------|-----------|
| P1.5 | Loader xlsx Basilea (`43980` / cluster) → `tipo='q1'` ratios + stocks RWA | Medio | Solvencia peer table |
| P1.6 | Cron: mismo workflow Chile descarga cluster xlsx tras el ZIP | Bajo | Automático |

### P2 — Enriquecimiento

| # | Trabajo | Resultado |
|---|---------|-----------|
| P2.1 | IF xlsx → `q1` publicados (ROE, mora, cobertura) para QA vs recomputo | “CMF published vs ours” |
| P2.2 | Importes exterior + derivados xlsx | Foreign ops / treasury |
| P2.3 | BCCh Series bancarias | Cortes producto oficiales BCCh |
| P2.4 | API CMF: UF/USD/IPC automáticos (FX tab Chile) | Macros sin hardcode |

### P3 — Scope expand / low ROI ETL

Cooperativas, Desempeño PDF NLP, Pilar 3 PDFs, IFRS TXT emisores, scrape ratings diario.

---

## 7. Modelo de datos sugerido (extensiones)

Mantener `country='CL'`.

| `tipo` | Uso nuevo |
|--------|-----------|
| `b1`/`r1`/`c1` | Sin cambio (ya densos) |
| `q1` | Ratios CMF publicados (Basilea %, mora IF %, ROE IF %) — percent×100 como UY/US |
| opcional `x1` | Stocks Basilea (APR, capital básico) si no caben cómodos en `b1` |

Cuentas sintéticas sugeridas (si se ingesta xlsx):

```
CL_B3_PE_APR      # Patrimonio efectivo / APR
CL_B3_CET1_APR    # Capital básico / APR
CL_B3_T1_APR
CL_B3_LEV         # Capital básico / activos regulatorios
CL_B3_APR         # stock APR (si sheet lo trae)
CL_IF_ROE / CL_IF_ROA / CL_IF_NPL / …
```

Naming final: alinear con convención existente al implementar.

---

## 8. Matriz de prioridad (resumen ejecutivo)

| Fuente | Banco? | Freq | Fricción | ¿Ya en ZIP? | Prioridad |
|--------|:------:|:----:|----------|-------------|-----------|
| ZIP MB1/MR1/MC1 | ✅ | M | Baja | — core | **P0 keep + harden** |
| Listing scrape 32901/28910 | — | M | Baja | discovery | **P0** |
| UI contingentes/OR/IFRS9/856 | ✅ | — | — | **Sí en c1/b1** | **P1** |
| Basilea III xlsx | ✅ | M (lag) | Baja | No | **P1** |
| IF / mora / prov xlsx | ✅ | M | Baja | Parcial | P2 QA |
| Exterior / derivados xlsx | ✅ | M | Baja | Parcial/nuevo | P2 |
| BCCh series bancarias | ✅ | M lag | Baja | Parcial | P2 |
| API CMF macros | mixed | D/M | API key | Delgado | P2 |
| Cooperativas | CAC | M | Baja | N/A | P3 |
| Ratings HTML | ✅ | Event | Media | No | P3 |
| Pilar 3 / PDF desempeño | mixed | Q/M | Media | No | P3 |
| SBIF legacy | hist | — | Roto | — | Solo `zips/` local |

---

## 9. Criterios de “Chile perfecto”

LatamBanks Chile está “completo” cuando:

1. El cron **nunca** depende de editar a mano un article ID (listing + cluster).  
2. Todo ratio que la CMF muestra en el IF xlsx **o** se recompute desde CoA **o** se guarda como `q1` publicado.  
3. Hay panel de **solvencia Basilea** peer-comparable.  
4. Contingentes + riesgo operacional + IFRS-9 stages son visibles (no solo el árbol Account View).  
5. Freshness check: si CMF publicó mes N y la DB quedó en N−1, Issue automático.  
6. Ratings locales actualizados al menos trimestralmente.

---

## 10. Próximo PR de implementación (sugerido)

Rama típica: `cursor/chile-cmf-discovery-harden-a614`

1. `chile_loader.py`: scrape `32901` + `28910`, cluster expand, seed refresh.  
2. Tests offline con HTML fixture del listing.  
3. Sin UI todavía — solo ops.  

PR siguiente: `cursor/chile-aq-tierb-contingent-or-a614` (mapas + sheets).  
PR siguiente: `cursor/chile-basel-xlsx-a614`.

---

## 11. Referencias rápidas

- ZIP listing vivo: https://www.cmfchile.cl/portal/estadisticas/626/w4-propertyvalue-32901.html  
- Hub reportes mensuales: https://www.cmfchile.cl/portal/estadisticas/626/w4-propertyvalue-28910.html  
- Basilea listing: https://www.cmfchile.cl/portal/estadisticas/626/w4-propertyvalue-43980.html  
- Ejemplo ZIP Jun-2026: https://www.cmfchile.cl/portal/estadisticas/626/w4-article-112240.html  
- API docs: https://api.cmfchile.cl/documentacion/  
- BCCh series: https://si3.bcentral.cl/estadisticas/Principal1/Excel/EMF/CDC/Series_datos_bancarios/DatosBancarios.html  
- AQ blueprint previo: `HANDOFF_AssetQuality_Blueprint.md` §2.1  
- Funding CL rollback: `HANDOFF_CL_FundingAnalytics_Rollback.md`

---

*Documento de investigación / diseño. No cambia código de producción por sí solo.*
