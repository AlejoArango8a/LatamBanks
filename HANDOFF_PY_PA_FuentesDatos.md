# LatamBanks — Handoff: Paraguay (PY) y Panamá (PA)

**Fecha:** agosto 2026  
**Estado:** investigación web + validación HTTP parcial.  
- **PA:** descargas Excel individuales **validadas** (HTTP 200, parseo openpyxl OK).  
- **PY:** **parcial** — muestra Excel histórica obtenida vía Wayback (formato anterior `1_BOLB`); **último boletín live no descargable** (Cloudflare + Liferay 403).  
**Objetivo:** evaluar viabilidad de loaders tipo BCU/SBS/BCRA/CNBV para llevar PY/PA a `live`.

---

## 0. Encaje con el modelo LatamBanks

| Pieza | Convención |
|-------|------------|
| Tablas | `datos_financieros`, `instituciones`, `plan_cuentas`, `carga_log` con `country` |
| Valor | `monto_total` (enteros); `monto_clp/uf/tc/ext = 0` |
| Período | `YYYYMM` |
| Sidebar | orden por **patrimonio / equity** del último período |
| Frontend | `paises.json` → `status: live`; mapas `pyCuentas.js` / `paCuentas.js`; logos |
| ETL | Python loader + cron GitHub Actions |
| `tipo` | `b1` = balance / estado de situación; `r1` = estado de resultados |

| | Código | Moneda sugerida | Notas FX |
|--|--------|-----------------|----------|
| Paraguay | **`PY`** | **`PYG`** (guaraníes) | Toggle USD vía tipo de cambio BCP |
| Panamá | **`PA`** | **`USD`** (o `PAB`; paridad 1:1) | Fuente publica en “miles de balboas”; tratar como USD |

---

## 1. PANAMÁ — fuente recomendada: SBP Reportes Estadísticos (Excel individual)

### 1.1 Autoridad y portal

| Campo | Valor |
|-------|-------|
| Autoridad | **Superintendencia de Bancos de Panamá (SBP)** |
| Portal | https://www.superbancos.gob.pa/ |
| Hub estadísticas | https://www.superbancos.gob.pa/estadisticas-financieras |
| Balance (filtro año / individual) | https://www.superbancos.gob.pa/estadisticas-financieras/balance-situacion |
| Estado de resultados | https://www.superbancos.gob.pa/estadisticas-financieras/estado-resultado |
| Índice anual (ej. 2026) | https://www.superbancos.gob.pa/node/1669 |
| Índice 2025 | https://www.superbancos.gob.pa/node/1429 |
| Índice 2024 | https://www.superbancos.gob.pa/node/1228 |

Sin login. Idioma principal: **español** (hay rutas `/en/` menores).

### 1.2 Dataset / publicación exacta

**Reportes Estadísticos → Individual por Banco:**

1. **Balance de Situación** — un archivo por banco  
2. **Estado de Resultados** — un archivo por banco  

Ámbito: información **individual** (sin consolidar subsidiarias), explícitamente pensada para comparar bancos de la plaza.  
Hay también agregados por tipo de banca (Sistema Bancario, Centro Bancario, Licencia Internacional, etc.) — **no** usar esos como fuente primaria LatamBanks.

Complemento útil (no reemplaza FS):

```
.../otros/Indicadores_Financieros.xlsx
```

(validado 2025/12, HTTP 200).

### 1.3 Formato, frecuencia, histórico

| Atributo | Detalle |
|----------|---------|
| Formato | **Excel `.xlsx`** (+ PDF gemelo; preferir Excel) |
| API | **No** hay API JSON pública usable; Drupal no expone `_format=json` para estos nodos. Mencionan XBRL como estándar de compilación, pero la descarga pública operativa es Excel/PDF. |
| Frecuencia | **Mensual** (últimos meses 2026: ene–may publicados; jun/jul aún no al momento de la investigación) |
| Histórico Excel bajo path actual | Validado desde **2019-08** (`…/2019/08/…/RE-BALANCE-BANCO-en-Nacional.xlsx` = 200). 2019-01/06 = 404. Portal lista años hasta 1999 (formatos/paths antiguos pueden diferir). |
| Unidad | **Miles de balboas** (= miles de USD) |
| Auth | Ninguna |

### 1.4 Granularidad

| Dimensión | Detalle |
|-----------|---------|
| Tiempo | Mensual; cada Excel trae **serie intra-año** (dic año anterior → meses del año corriente) |
| Plan de cuentas | Árbol **intermedio** (~60 filas balance, ~25 PyG). Rubros: activos líquidos, cartera crediticia, inversiones, depósitos, obligaciones, patrimonio, utilidad del período. **No** es plan contable completo tipo BCU. |
| Cobertura | ~**66 bancos** con Excel balance en dic-2025: Oficiales + Licencia General + Licencia Internacional |
| Código banco | Celda estable numérica (ej. `001` Nacional, `002` Caja de Ahorros, `003` Banco General, `182` Banistmo) — usar como `ins_cod` |
| Slug archivo | Inestable/legible (`Banistmosa`, `Multibanksub`, `Pacificogral`) — **no** usar como ID; mantener catálogo `slug → código/nombre` |

**Cuentas clave validadas (labels col A):**

| Label SBP | KPI LatamBanks |
|-----------|----------------|
| `TOTAL DE ACTIVOS` | Activos |
| `CARTERA CREDITICIA` | Colocaciones / créditos |
| `DEPOSITOS` | Depósitos |
| `OBLIGACIONES` (+ `OTROS PASIVOS`) | Pasivos (componer o mapear) |
| `PATRIMONIO` | **Equity (ranking sidebar)** |
| `Utilidad del Periodo` (PyG) | Utilidad |

### 1.5 Patrones de URL directa (validados)

```
https://www.superbancos.gob.pa/documentos/financiera_y_estadistica/reportes_estadisticos/{YYYY}/{MM}/balance_individual_por_banco/RE-BALANCE-BANCO-en-{Slug}.xlsx

https://www.superbancos.gob.pa/documentos/financiera_y_estadistica/reportes_estadisticos/{YYYY}/{MM}/estado_de_resultado_individual_por_banco/RE-ESTADO-BANCO-en-{Slug}.xlsx
```

Ejemplos OK:

```
.../2025/12/balance_individual_por_banco/RE-BALANCE-BANCO-en-Nacional.xlsx
.../2025/12/estado_de_resultado_individual_por_banco/RE-ESTADO-BANCO-en-Nacional.xlsx
.../2026/05/balance_individual_por_banco/RE-BALANCE-BANCO-en-General.xlsx
```

`{MM}` = `01`…`12` con cero a la izquierda.

**Descubrimiento de slugs del mes:** scrape HTML del índice anual (`/node/…`) o de las páginas de filtro, regex:

```
RE-BALANCE-BANCO-en-([A-Za-z0-9_-]+)\.xlsx
```

No existe un único Excel multi-banco con todo el sistema en columnas (a diferencia de SBS PE `B-2201`).

### 1.6 Layout Excel (validado)

- Hoja única típica: `Page1_1`
- `A3` = nombre banco; `A8` = código SBP; `A4` = título + rango + unidad
- Filas de cuentas desde ~11; columnas = meses (dic N-1 … nov/dic N)
- **Balance:** stocks de fin de mes → tomar columna del mes target
- **PyG:** ojo metodológico — la columna de **diciembre del año previo** suele ser **acumulado anual**; las columnas de meses del año corriente parecen **flujo del mes** (no YTD). Para KPIs de utilidad YTD: **sumar meses ene→mes** del año; para diciembre, preferir la columna anual o la suma del año. Documentar convención en loader/tooltips.
- Escala: multiplicar ×1000 → enteros USD (o guardar miles y documentar; recomendación LatamBanks: **×1000 a enteros**).

### 1.7 Riesgos / blockers PA

| Riesgo | Severidad | Mitigación |
|--------|-----------|------------|
| Un archivo por banco (~130 descargas/mes bal+PyG) | Media | Parallel download + cache; scrape índice una vez |
| Slugs cambian con M&A / renombres | Media | Catálogo por código `A8`; alerta si falta banco esperado |
| PyG mensual vs acumulado | Alta (calidad KPI) | Tests de consistencia; convención YTD explícita |
| Licencia Internacional mezcla bancos “offshore” | Producto | Incluidos por defecto (negocios LatAm); `--domestic-only` para excluir |
| Histórico pre-2019 path distinto | Baja | MVP desde 2020; backfill antiguo después |
| Sin API | Baja | HTTP directo estable |

**Viabilidad PA: ALTA** — Excel mensual por banco, sin login, códigos estables, histórico ≥2019, automatizable en GHA.

### 1.8 Automatización propuesta → `panama_loader.py`

1. Dado `YYYYMM`, construir paths `{YYYY}/{MM}`.  
2. Obtener lista de slugs (scrape `node` del año **o** catálogo fijo + HEAD 404).  
3. Descargar balance + estado por slug (`openpyxl`).  
4. Leer `ins_cod` de `A8`, nombre de `A3`.  
5. Extraer columna del mes → filas cuenta → `tipo='b1'|'r1'`, `monto_total`.  
6. Upsert + `carga_log` + `schema_guard` (set de labels).  
7. Cron GHA ~día 20–28 (rezago típico ~3–6 semanas; may-2026 publicado ~jul).

### 1.9 MVP scope PA

| Ítem | Recomendación |
|------|----------------|
| Desde | **`202001`** (path Excel estable; opcional backfill `201908`) |
| Universo | Bancos **Oficiales + Licencia General + Licencia Internacional** (usar `--domestic-only` para excluir intl) |
| KPIs | Activos, Cartera, Depósitos, Patrimonio, Utilidad (YTD), ROE |
| Moneda | `USD` / `country=PA` |
| Prioridad vs PY | **Implementar PA primero** |

---

## 2. PARAGUAY — fuente recomendada: BCP Superintendencia de Bancos — Boletín Estadístico-Financiero

### 2.1 Autoridad y portal

| Campo | Valor |
|-------|-------|
| Autoridad | **Banco Central del Paraguay (BCP) — Superintendencia de Bancos (SB / SIB)** |
| Portal institucional | https://www.bcp.gov.py/ |
| **Boletines estadístico-financieros (primario)** | https://www.bcp.gov.py/boletines-estadisticos-i62 |
| FAQ estadísticas | https://www.bcp.gov.py/web/institucional/estadisticas1 |
| Indicadores financieros mensuales | https://www.bcp.gov.py/indicadores-financieros-mensual-i363 |
| Anexo estadístico indicadores | https://www.bcp.gov.py/anexo-estadistico-indicadores-financieros-i367 |
| Estados financieros mensuales (hub) | https://www.bcp.gov.py/web/institucional/estados-financieros-mensuales |
| Boletín Empresas (crédito a firmas, **no** EEFF banco) | https://www.bcp.gov.py/boletines-empresa |

Sin login público declarado. Idioma: **español**.

### 2.2 Dataset / publicación exacta

**Boletín Estadístico-Financiero** de la Superintendencia de Bancos (Gerencia / Intendencia de Análisis Financiero).

Según comunicación oficial del BCP (versión 2.0 del boletín):

- Modelo de datos con filtros por **entidad** y moneda (**MN / ME**), dolarización opcional al TC BCP.  
- Se eliminó el código agregado `1000` (total sistema) a favor de agrupación dinámica.  
- Pestaña de **resumen de indicadores** de sistema.  
- **Archivo independiente con todas las tablas** que nutren el boletín (pieza crítica para ETL — preferir este over el workbook interactivo).  
- Contenido usado por prensa/analistas: balances, resultados, patrimonio, liquidez, ROE/ROA **por banco y financiera**.

**No confundir con:**

| Publicación | Por qué no alcanza |
|-------------|-------------------|
| Boletín Empresas (trimestral) | Crédito a MiPymes/empresas, no FS de bancos |
| Anexo Estadístico Informe Económico | Macro/sistema, no EEFF por banco |
| datos.gov.py Anuario INE (ej. 7.1.11 participación bancaria) | **Anual**, pocas variables, rezago; solo complemento |
| MEF “Informe de Bancos” | Depósitos públicos por banco; no balance/PyG completo |

### 2.3 Formato, frecuencia, histórico

| Atributo | Detalle |
|----------|---------|
| Formato | Orientado a **Excel** (boletín interactivo + tablas independientes). INE/ODS describe el Boletín Estadístico Financiero en **`.xlsx`**. PDF puede existir como resumen. **Sin API** de EEFF por banco. |
| Frecuencia | **Mensual** |
| Lag publicación | ~**25 días** tras cierre de mes (metadato INE ODS 8.10.x) |
| Histórico | Series del boletín usadas en prensa ≥5 años; INE cita disponibilidad amplia desde ~2008/2015 según indicador. **Profundidad de path/archivo no validada aquí.** |
| Auth | No login, pero **Cloudflare Bot Management** bloquea clientes automatizados |

### 2.4 Granularidad (según fuente oficial + usos públicos)

| Dimensión | Detalle |
|-----------|---------|
| Tiempo | Mensual |
| Entidades | Bancos + financieras supervisadas; códigos de entidad en el modelo |
| Moneda | MN / ME (y vista dolarizada); moneda nativa **PYG** |
| Profundidad cuentas | Suficiente para KPIs (activo, cartera, depósitos, patrimonio, resultados, ratios). Profundidad exacta del plan **pendiente de abrir un archivo real** tras superar Cloudflare. |
| Cobertura bancos (universo 2025–2026, MEF) | ~16 bancos: Atlas, Bancop, Basa, BNF, Citibank, Continental, Do Brasil, Familiar, GNB, Interfisa, Itaú, Nación Argentina, Sudameris, Solar, Ueno, Zeta (+ fusiones/renombres; Río aparece en informes 2025) |
| Financieras | Presentes en el mismo boletín (ej. Tu Financiera en rankings ROE) — decidir si entran al sidebar |

### 2.5 Intento de descarga (ago-2026) — resultado: **parcial**

| Intento | Resultado |
|---------|-----------|
| `curl` / `wget` / `cloudscraper` / `curl_cffi` (Chrome UA) | **HTTP 403** — Cloudflare Managed Challenge (`cf-mitigated: challenge`, título `Just a moment…` / `Un momento…`, Turnstile) |
| Chrome/Playwright headed (Xvfb) | A veces obtiene `cf_clearance`, pero `/boletines-estadisticos-i62` responde **Liferay 403 “Acceso restringido”** (no el listado de archivos) |
| Paths live `userfiles/files/1_BOLB_*.xlsx` | **404** (migrados; ya no sirven) |
| Wayback Machine | **OK** — muestra formato anterior |

**Blocker exacto (live latest):**  
1) Cloudflare Bot Management / Turnstile (“Verifique que es un ser humano”).  
2) Tras pasar CF desde IP de datacenter: ACL Liferay **403 Acceso restringido** en el hub de boletines. No se llegó a listar ni descargar el Excel “tablas” / formato nuevo.

**Click path humano (browser residencial / no datacenter):**

1. Abrir https://www.bcp.gov.py/boletines-estadisticos-i62  
2. Completar checkbox Cloudflare *Verifique que es un ser humano*  
3. En **“Boletines Estadístico-Financieros formato nuevo”**: Descargar el mes más reciente **y** el **archivo independiente de tablas** (preferido para ETL)  
4. Alternativa: sección **formato anterior** → archivo bancos `1_BOLB_MMYYYY.xlsx`  
5. Guardar URL final del binario (DevTools → Network; típico Liferay `/documents/…`)

**Archivo obtenido (muestra, no latest):**

| Campo | Valor |
|-------|--------|
| Origen | Wayback `…/userfiles/files/1_BOLB 032023(2).xlsx` (captura ~2024-01) |
| Local | `/tmp/py-bcp/1_BOLB_032023(2).xlsx` (+ `022023`, `012023`) |
| Título | Boletín Estadístico y Financiero — Empresas Bancarias — **2023-03-31** |
| Hojas | 41: `Carátula*`, `Índice`, `1`…`38` |
| FS por banco | **Sí** — hoja `2` *Balance General por Empresa Bancaria*; hoja `3` *Estado de Ganancias y Pérdidas por Empresa Bancaria* |
| Layout | Fila bancos (nombres); subcols **MN / ME / TOTAL**; cuentas en col A; unidad **millones de Gs.** |
| KPIs | `TOTAL ACTIVO`, `COLOCACIONES NETAS` / cartera, `DEPÓSITOS`, `PATRIMONIO NETO` (resumen hoja `1`); PyG en hoja `3` |
| No usar | `/documents/d/institucional/estados-financieros` = EEFF del **BCP** (no multi-banco) |

Patrón histórico (roto en live): `https://www.bcp.gov.py/userfiles/files/1_BOLB_{MM}{YYYY}….xlsx` (`2_BOLF` financieras, etc.).

### 2.6 Riesgos / blockers PY

| Riesgo | Severidad | Mitigación |
|--------|-----------|------------|
| **Cloudflare Turnstile** + posible **ACL Liferay por IP** | **Alta** | Descarga humana / runner residencial; o artefacto drop S3 |
| URL “tablas” v2 aún no capturada | Alta | Una sesión humana: anotar URL `/documents/…` |
| Formato nuevo ≠ `1_BOLB` validado | Media | Re-inspeccionar hojas tras 1 descarga v2; parser MVP puede basarse en `1_BOLB` si v2 tablas es plano |
| MN/ME vs total | Media | Usar columna **TOTAL** → ×1e6 → `monto_total` PYG |
| Renombres (Ueno, Solar, fusiones) | Media | Catálogo nombre→`ins_cod` |
| Financieras vs bancos | Producto | MVP solo `1_BOLB` / bancos |
| datos.gov.py / ASOBAN | — | Solo links al hub BCP; no sustituyen |

**Viabilidad PY: MEDIA** — estructura multi-banco **clara** en muestra `1_BOLB`; **acceso al mes corriente bloqueado** en este entorno.

### 2.7 `paraguay_loader.py` — siguiente paso (no implementar full aún)

1. **Gate:** obtener 1 Excel live (tablas v2 o `1_BOLB` reciente) desde browser humano; dropear en repo/`/tmp/py-bcp/`.  
2. Si llega `1_BOLB`-like: parsear hoja `2` (b1) y `3` (r1); header bancos fila ~7; valor = col **TOTAL**; montos ×1_000_000.  
3. Si llega solo “tablas” v2: mapear hojas equivalentes; no asumir mismos nombres.  
4. Upsert + `schema_guard` + cron tras URL estable.  
5. FX PYG/USD vía cotización BCP (también detrás de CF).

### 2.8 MVP scope PY

| Ítem | Recomendación |
|------|----------------|
| Gate | Primero **probar descarga real** (browser) y fijar URL/patrón |
| Desde | **`202301`** o primer mes con boletín v2 estable (ajustar tras inspección) |
| Universo | Solo **bancos** (~16); financieras fase 2 |
| KPIs | Activos, Cartera/colocaciones, Depósitos, Patrimonio, Utilidad, ROE/ROA si vienen en tablas |
| Moneda | `PYG` / `country=PY` |
| Prioridad | **Después de PA** (o en paralelo solo si ya hay archivo local de muestra) |

### 2.9 Fuentes secundarias PY

| Fuente | Uso |
|--------|-----|
| https://www.datos.gov.py — Anuario banca (INE) | Series anuales gruesas por entidad; no FS mensual |
| MEF Informe de Bancos (PDF mensual) | Depósitos del sector público por banco; contexto |
| Webs de bancos / CNV | EEFF auditados PDF; malo para ETL uniforme |
| cotizaciones BCP | FX PYG/USD para toggle |

---

## 3. Comparación con países live / en pipeline

| | CL | CO | BR | PE | UY | **PA** | **PY** |
|--|----|----|----|----|----|--------|--------|
| Regulador | CMF | SFC | BCB | SBS | BCU/SSF | **SBP** | **BCP/SB** |
| Formato | ZIP TXT | API JSON | JSON | Excel | Excel | **Excel/banco** | **Excel boletín** |
| Frecuencia | Mensual | Mensual | Trim. | Mensual | Mensual | **Mensual** | **Mensual** |
| Detalle FS | Alto | Medio-alto | Alto | Alto | Muy alto | **Medio** | **Medio-alto*** |
| Auth | No | No | No | No | No | **No** | **No (pero CF)** |
| Auto GHA | Sí | Sí | Sí | Viable | Viable | **Viable** | **Bloqueada hoy** |
| Dificultad ETL | Media | Baja-media | Media | Baja-media | Baja-media | **Media** (N archivos) | **Alta** (acceso) |

\*Profundidad PY pendiente de archivo real.

---

## 4. Plan de implementación recomendado

### Fase A — Panamá (hacer primero)

1. Catálogo `slug ↔ código SBP ↔ nombre ↔ licencia` (dic-2025 / may-2026).  
2. `panama_loader.py`: balance + PyG, escala ×1000, YTD utilidad.  
3. `paCuentas.js` + logos + `paises.json` → `live`.  
4. Backfill `202001`–último mes; workflow mensual.  
5. Sidebar por `PATRIMONIO`.

### Fase B — Paraguay (tras muestra Excel)

1. Sesión browser: descargar boletín + tablas; anotar URL y hojas.  
2. Decidir estrategia anti-bot (Playwright en GHA vs artefacto manual).  
3. `paraguay_loader.py` + `pyCuentas.js`.  
4. MVP bancos desde ~2023; financieras después.

### Fase C — Producto

- FX PYG; PA ya en USD.  
- Ratings locales (FIX, Feller, etc.) opcionales en Config.  
- `schema_guard` en ambos.

---

## 5. Checklist de aceptación (mismo espíritu que PE/UY/BR)

- [ ] Sidebar por equity del último mes  
- [ ] KPIs: Activos, Cartera, Depósitos, Pasivos, Patrimonio, Utilidad, ROE  
- [ ] Vista FS con árbol de cuentas de la fuente  
- [ ] Series multi-año  
- [ ] Comparación entre bancos del país  
- [ ] Carga incremental automática (PA); PY según resolución CF  
- [ ] Sin romper CL/CO/BR/PE/UY  

---

## 6. Resumen ejecutivo para el implementador

| País | Código | Moneda | Fuente | ¿Listo para coder? |
|------|--------|--------|--------|---------------------|
| **Panamá** | `PA` | `USD` (PAB 1:1) | SBP Excel individual mensuales | **Sí** — URLs y layout validados |
| **Paraguay** | `PY` | `PYG` | BCP Boletín Estadístico-Financiero (+ tablas) | **Parcial** — muestra `1_BOLB` 2023-03 vía Wayback; live = CF + Liferay 403 |

**Estado PA:** `panama_loader.py` carga Oficiales + General + Internacional desde `202001` (p. ej. Occidente `108`). En paralelo, un humano descarga el Excel **tablas** (o `1_BOLB` latest) del hub PY y confirma si el layout sigue `/tmp/py-bcp/1_BOLB_032023(2).xlsx`.

Este documento es especificación de fuentes; no implementa loaders.
