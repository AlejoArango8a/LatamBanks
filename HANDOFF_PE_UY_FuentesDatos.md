# LatamBanks — Handoff: Perú (PE) y Uruguay (UY)

**Fecha:** agosto 2026  
**Estado:** investigación validada contra fuentes reales (descargas HTTP OK).  
**Objetivo:** llevar PE/UY de `coming_soon` → `live` con la misma lógica que CL/CO/BR  
(estados financieros detallados, sidebar por equity, KPIs, ranking, series, automatización).

---

## 0. Recordatorio operativo (fuera de este handoff)

Backfill Brasil histórico (`201403`–`202412`): código ya en PR  
`cursor/brasil-historico-pre-2025-a614`. Correr mañana desde PC con `COCKROACH_URL`:

```bash
python brasil_loader.py --all --from 201403 --to 202412
# o GHA: Brasil - Auto Update → mode=range
```

---

## 1. Encaje con el modelo LatamBanks (igual que los 3 live)

| Pieza | Convención |
|-------|------------|
| Tablas | `datos_financieros`, `instituciones`, `plan_cuentas`, `carga_log` con `country` |
| Valor | `monto_total` (enteros); `monto_clp/uf/tc/ext = 0` |
| Período | `YYYYMM` |
| Sidebar | orden por **patrimonio / equity** del último período (como BR top-N / CO) |
| Frontend | `paises.json` → `status: live`; mapas `peCuentas.js` / `uyCuentas.js`; logos |
| ETL | Python loader + cron GitHub Actions |
| Marca | BTG se resalta si existe en el país; **en PE no hay banco BTG** en Banca Múltiple SBS (dic-2025) |

`tipo` sugerido (alineado a CL/CO):
- `b1` = balance / estado de situación  
- `r1` = estado de resultados  

---

## 2. PERÚ — fuente recomendada: SBS Boletín Estadístico Excel

### 2.1 Fuente primaria (validada)

**Balance + PyG en un solo archivo mensual:**

```
https://intranet2.sbs.gob.pe/estadistica/financiera/{YYYY}/{MesEspañol}/B-2201-{mm}{YYYY}.XLS
```

Ejemplo dic-2025:  
`.../2025/Diciembre/B-2201-di2025.XLS`

| Sheet | Contenido |
|-------|-----------|
| `1` | **Balance General por Empresa Bancaria** |
| `2` | **Estado de Ganancias y Pérdidas por Empresa Bancaria** |

- Unidad: **miles de soles**  
- Columnas por banco: `MN` / `ME` / **`TOTAL`** → usar **TOTAL** → `monto_total` (× 1000 si se quiere soles enteros, o guardar miles y documentar escala; recomendación: **multiplicar ×1000** a enteros en soles, como convención “valor completo”).  
- Bancos en columnas (dic-2025, ~19 entidades operativas + totales).  
- Histórico comprobado: al menos **2015–2025** con el mismo código `B-2201`.

### 2.2 Códigos de mes (validados 2025)

| Mes | Carpeta | Sufijo |
|-----|---------|--------|
| Enero | Enero | `en` |
| Febrero | Febrero | `fe` |
| Marzo | Marzo | `ma` |
| Abril | Abril | `ab` |
| Mayo | Mayo | `my` |
| Junio | Junio | `jn` |
| Julio | Julio | `jl` |
| Agosto | Agosto | `ag` |
| Setiembre | Setiembre | `se` |
| Octubre | Octubre | `oc` |
| Noviembre | Noviembre | `no` |
| Diciembre | Diciembre | `di` |

### 2.3 Cuentas clave (Balance sheet 1 — labels en col A)

| Label SBS | KPI LatamBanks |
|-----------|----------------|
| `TOTAL ACTIVO` | Activos |
| (créditos / colocaciones — ubicar rubro “Colocaciones” / créditos netos en el árbol) | Colocaciones |
| depósitos (pasivo) | Captações / depósitos |
| `TOTAL PASIVO` | Pasivos |
| `PATRIMONIO` / `TOTAL` patrimonio | **Equity (ranking sidebar)** |
| `Resultado Neto del Ejercicio` (en patrimonio) | Utilidad (también en sheet 2) |

Sheet 2 abre con `INGRESOS FINANCIEROS` y desglose completo de PyG → ideal para vista Balance/Income detallada.

### 2.4 Universo de bancos (dic-2025)

BBVA Perú, BANCOM, BCP, Pichincha, BanBif, Scotiabank, Citibank, Interbank, Mibanco, GNB, Falabella, Santander Perú, Ripley, Alfin, ICBC, Bank of China, BCI Perú, Compartamos, Santander Consumer Bank.  
Excluir del sidebar: filas “Total Banca Múltiple*” y agregados.

**No aparece BTG Pactual** como banco SBS en este archivo.

### 2.5 Automatización propuesta → `peru_loader.py`

1. Dado `YYYYMM`, construir URL `B-2201`.  
2. Descargar Excel (openpyxl; a veces extensión `.XLS` pero contenido xlsx).  
3. Parsear sheet 1 → filas cuenta × banco → `tipo='b1'`.  
4. Parsear sheet 2 → `tipo='r1'`.  
5. Asignar `ins_cod` estable: hash numérico determinístico del nombre normalizado **o** tabla manual `nombre → codigo` (preferible códigos fijos 1..N documentados).  
6. `plan_cuentas`: label SBS como `cuenta` (slug) o código sintético `PE|BALANCE|{row}` + descripción = label.  
7. Upsert + `carga_log` + `schema_guard`.  
8. Cron GHA día ~15–20 (SBS publica con rezago de ~2–4 semanas).

### 2.6 Fuentes secundarias (no reemplazan B-2201)

| Fuente | Uso |
|--------|-----|
| Series Estadísticas SBS (app web) | Series largas de variables seleccionadas; UI ASP.NET + anti-bot; peor para FS completo |
| Carpeta SF-2102/2103 PDF | Resumen sistema; no granular por cuenta/banco para el monitor |
| BCRP API series | Macro / tipo de cambio; **no** EEFF por banco |
| Forma A / B-1 individuales en webs de bancos | Más detalle NIIF, pero no automatizable de forma uniforme |

### 2.7 Riesgos PE

- WAF/Incapsula en portales `www.sbs.gob.pe` (el path `intranet2` de Excel **sí respondió** sin browser).  
- Nombres de banco cambian (conversiones: Compartamos, Santander Consumer).  
- Frontera contable ene-2013 (NIIF SBS 7036-2012) si se backfillea muy atrás.  
- Escala miles vs unidades: fijar convención en loader y tooltips.

**Viabilidad PE: ALTA** — un archivo/mes, balance+PyG, histórico largo, ranking por patrimonio directo.

---

## 3. URUGUAY — fuente recomendada: Boletín SSF (BCU) Excel

### 3.1 Fuente primaria (validada)

Índice mensual HTML:

```
https://www.bcu.gub.uy/Servicios-Financieros-SSF/Boletin%20SSF/{YYYY}/{MesEspañol}/indice.htm
```

Ejemplo: `.../2026/Junio/indice.htm` → lista de `.xls` por institución/grupo.

Archivos clave:
- `institucion{ID}.xls` — un banco (ej. `institucion1.xls` = BROU, `institucion113.xls` = Itaú)
- `grupo99.xls` — bancos oficiales agregados  
- `grupo997.xls` — **bancos privados** (columnas por banco: Itaú, Scotiabank, Santander, BBVA, …)

Listado público del índice:  
https://www.bcu.gub.uy/Servicios-Financieros-SSF/Paginas/Boletin-SSF.aspx

### 3.2 Contenido de cada `institucion*.xls` (validado jun-2026)

Hojas:
1. **Situación** — Estado de Situación (activo/pasivo/patrimonio, MN/ME/Total)  
2. **Resultados** — Estado de Resultados (YTD del ejercicio)  
3. **ERI** — Resultado integral  
4. Anexos 1–5 — plazos, créditos, depósitos, indicadores, RPN  

Cifras en **miles de pesos uruguayos**.  
Patrimonio: fila `3 - PATRIMONIO` (Total).  
Activo: fila `1 - ACTIVOS`.  
Utilidad: `Resultado del ejercicio` en hoja Resultados.

IDs estables observados: `1` BROU, `91` BHU, `113` Itaú, `128` Scotiabank, `137` Santander, `153` BBVA, etc.

Histórico de índices: OK al menos **2020–2026**; 2015 path antiguo no encontrado en la misma URL (puede vivir en sección “2015–2011” del portal SharePoint).

### 3.3 Automatización propuesta → `uruguay_loader.py`

1. Descubrir meses nuevos: scrape `Boletin-SSF.aspx` **o** probar `indice.htm` del mes esperado.  
2. Parsear links `institucion*.xls` (bancos) — opcionalmente ignorar casas financieras / EACs si se quiere solo bancos.  
3. Por archivo: xlrd → filas de Situación (`b1`) y Resultados (`r1`).  
4. `ins_cod` = ID numérico del nombre de archivo (`institucion113` → `113`).  
5. Cuenta = código jerárquico del label (`1`, `1.1`, `3`, …) o slug del texto.  
6. Upsert + schema_guard + cron mensual (publicación ~día 12–20 del mes siguiente).

SSL: el sitio BCU a veces falla verificación de cadena en clientes Python → `ssl` custom o `certifi` actualizado.

### 3.4 Universo sugerido (sidebar)

- Bancos oficiales: BROU, BHU  
- Bancos privados del `grupo997` / sus `institucion*`  
- Excluir por defecto: casas financieras, cooperativas menores, EACs (salvo decisión de producto)

**BTG:** no aparece en el índice jun-2026 de bancos privados del boletín muestreado.

### 3.5 Fuentes secundarias UY

| Fuente | Uso |
|--------|-----|
| Estados contables auditados por institución (`InformacionInstitucion.aspx?nroinst=`) | PDF/trimestral auditado; buen complemento, peor para series mensuales densas |
| Plan de cuentas BCU / normas SSF | Diccionario de cuentas |
| Catálogo datos abiertos gub.uy (org BCU) | **No** trae EEFF de bancos privados (solo datos administrativos del BCU) |
| Open Finance BCU (hoja de ruta) | Futuro; no usable hoy para este monitor |

**Viabilidad UY: ALTA** — Excel mensuales por banco, detalle contable profundo, IDs estables, automatizable.

---

## 4. Comparación con CL / CO / BR

| | Chile | Colombia | Brasil | **Perú** | **Uruguay** |
|--|-------|----------|--------|----------|-------------|
| Regulador | CMF | Superfinanciera | BCB | **SBS** | **BCU/SSF** |
| Formato | ZIP TXT | API Socrata JSON | JSON portal | **Excel B-2201** | **Excel boletín** |
| Frecuencia | Mensual | Mensual | Trimestral | **Mensual** | **Mensual** |
| Detalle FS | Alto | Medio-alto | Alto (prudencial) | **Alto (bal+PyG)** | **Muy alto (+anexos)** |
| Auth | No | No | No | No | No |
| Auto | Script local / GHA | GHA | GHA | **GHA viable** | **GHA viable** |
| Dificultad ETL | Media | Baja-media | Media | **Baja-media** | **Baja-media** |

---

## 5. Plan de implementación recomendado

### Fase A — Uruguay primero (más “limpio” para el patrón LatamBanks)

1. `uruguay_loader.py` + workflow `uruguay_auto_update.yml`  
2. `uyCuentas.js` (KPIs: activo `1`, patrimonio `3`, utilidad resultado ejercicio, créditos desde costo amortizado / anexos)  
3. Backend: `country=UY` ya casi genérico; ranking por cuenta patrimonio  
4. Logos + nombres bonitos + `paises.json` → `live`  
5. Carga histórica desde ~2020 (o desde que el path `Boletin SSF/{y}/{m}` exista)

### Fase B — Perú

1. `peru_loader.py` (parser B-2201 sheets 1+2) + workflow  
2. `peCuentas.js` + códigos de institución fijos  
3. Backfill mensual desde 2018–2019 (post-estabilización NIIF) o desde 2015 si se acepta nota metodológica  
4. `paises.json` → `live`

### Fase C — Pulido producto

- FX PEN/UYU en toggle USD (misma infra de tipos de cambio)  
- Ratings Fitch/locales en Config  
- Opcional: cajas municipales PE / no-bancarios UY como segundo tier  
- `schema_guard` en ambos loaders  

### Estimación de invasividad (técnica, no calendario)

- **UY:** 1 loader + 1 mapa cuentas + logos + flags `live` + cron. Sin migración SQL nueva si `country` ya es texto libre.  
- **PE:** igual; parser Excel un poco más engorroso (layout multi-banco en columnas).  
- Riesgo principal: fragilidad de HTML/paths del Boletín UY y naming de meses SBS; mitigar con dry-run + alerta si falta el archivo del mes.

---

## 6. Checklist de aceptación (igual espíritu que BR/CO)

- [ ] Sidebar ordenado por equity del último mes  
- [ ] KPIs: Activos, Colocaciones/Créditos, Depósitos, Pasivos, Patrimonio, Utilidad, ROE  
- [ ] Vista estados financieros con árbol de cuentas de la fuente  
- [ ] Series históricas multi-año  
- [ ] Comparación entre bancos del país  
- [ ] Carga incremental automática mensual  
- [ ] Sin romper CL/CO/BR  

---

## 7. Próximo paso concreto

1. Rodar backfill BR desde el PC (credenciales).  
2. Implementar **Fase A (Uruguay)** en una rama `cursor/uruguay-loader-…`.  
3. Luego **Fase B (Perú)**.

Este documento es la especificación de fuentes; no implementa loaders todavía.
