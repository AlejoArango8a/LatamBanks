# LatamBanks — Documentación técnica completa de la plataforma

> **Propósito de este documento:** ser el traspaso (handoff) autoexplicativo y
> definitivo de la plataforma LatamBanks, para que cualquier agente o
> desarrollador que llegue después pueda entender la arquitectura completa,
> las fuentes de datos, las validaciones, las estructuras y las lógicas, y
> continuar haciendo mejoras sin tener que re-investigar nada.
>
> Última actualización: julio 2026 (tras la reconstrucción de Brasil al nivel
> prudencial IF.data). Frontend en versión de caché `bmon37`.

---

## 1. Resumen ejecutivo

**LatamBanks** es un dashboard web de estados financieros de bancos de América
Latina. Toma datos oficiales de los reguladores bancarios de cada país, los
normaliza en un esquema común y los muestra en un panel interactivo con KPIs,
rankings, evolución histórica, comparativos entre bancos y estados contables.

- **Sitio:** www.latambanks.co · latambanks.vercel.app
- **Repositorio:** `AlejoArango8a/LatamBanks` (GitHub), rama `main`.
- **Países en producción (`live`):** Chile (CL), Colombia (CO), Brasil (BR).
- **Países preparados pero no activos (`coming_soon`):** Perú (PE), Uruguay (UY).
- **Banco destacado / marca:** BTG Pactual (se resalta en azul en cada país).

La filosofía de diseño es **"country-genérico"**: una sola base de datos, una
sola API y un solo frontend sirven a todos los países. Cada país se distingue
por una columna `country` (código ISO: `CL`, `CO`, `BR`). Agregar un país nuevo
es sobre todo escribir un loader y registrar el país en `paises.json`.

---

## 2. Stack tecnológico

| Capa | Tecnología |
|------|-----------|
| Base de datos | CockroachDB (compatible con PostgreSQL, driver `pg`/`psycopg2`) |
| Backend / API | Node.js + Express, desplegado como **función serverless** en Vercel |
| Frontend | HTML estático + JavaScript ES Modules (sin framework, sin bundler) + Chart.js |
| ETL / Loaders | Python 3.11+ (`psycopg2-binary`, `python-dotenv`, `urllib` de la stdlib) |
| Automatización | GitHub Actions (cron) |
| Hosting | Vercel (frontend estático + `api/index.js` como serverless function) |

No hay build step del frontend: los `.html` y `.js` se sirven tal cual. La
invalidación de caché se hace con un query-string de versión en los imports
(`?v=bmon37`) — **ver sección 9.4**.

---

## 3. Arquitectura general

```
   FUENTES OFICIALES                 ETL (Python)                 ALMACÉN
 ┌─────────────────────┐        ┌────────────────────┐       ┌──────────────┐
 │ CMF Chile (ZIP/TXT) │──────► │ cmf_loader.py      │       │              │
 │                     │        │  + cargar_zip.py   │──────►│              │
 ├─────────────────────┤        ├────────────────────┤       │  CockroachDB │
 │ Superfinanciera CO  │──────► │ colombia_loader.py │──────►│  (Postgres)  │
 │ (Socrata datos.gov) │        │                    │       │  4 tablas    │
 ├─────────────────────┤        ├────────────────────┤       │  country-    │
 │ BCB Brasil          │──────► │ brasil_loader.py   │──────►│  genéricas   │
 │ (IF.data + Olinda)  │        │                    │       │              │
 └─────────────────────┘        └────────────────────┘       └──────┬───────┘
                                  ▲  schema_guard.py                 │
                                  │  (validación estructura)         │
                       GitHub Actions (cron)                         │
                                                                     ▼
                         ┌──────────────────────────────────────────────────┐
                         │  Backend Express (backend/server.js)              │
                         │  desplegado en Vercel vía api/index.js            │
                         │  Endpoints REST: /api/bootstrap, /api/datos, ...  │
                         └───────────────────────┬──────────────────────────┘
                                                 │  HTTPS JSON
                                                 ▼
                         ┌──────────────────────────────────────────────────┐
                         │  Frontend estático (index.html + dashboard.html)  │
                         │  ES modules en /js, Chart.js, paises.json         │
                         └──────────────────────────────────────────────────┘
```

**Flujo de datos de punta a punta:**
1. Los **loaders** Python descargan del regulador, transforman al esquema común
   y hacen UPSERT en CockroachDB.
2. **GitHub Actions** corre los loaders periódicamente (CO mensual, BR mensual
   revisando si hay trimestre nuevo). Chile: GHA `chile-cmf-monthly.yml` + carga manual vía `cargar_zip.py` si hace falta.
3. El **backend** lee de CockroachDB y expone JSON por HTTP.
4. El **frontend** llama al backend, arma KPIs/gráficos y los muestra.

---

## 4. Estructura del repositorio

```
LatamBanks/
├── index.html                 Landing page (marketing + selección de país)
├── dashboard.html             Aplicación principal (el dashboard en sí)
├── paises.json                FUENTE ÚNICA de configuración de países (backend + front + loaders)
├── vercel.json                Config de Vercel (rewrites /api/* → api/index, headers de caché)
├── package.json               Deps del backend Node (express, cors, pg, dotenv)
├── requirements.txt           Deps Python de los loaders (psycopg2-binary, python-dotenv)
├── .env.example               Plantilla de variables de entorno (COCKROACH_URL)
│
├── api/
│   └── index.js               Entry point serverless de Vercel; envuelve backend/server.js
├── backend/
│   └── server.js              TODA la API Express (endpoints, lógica por país)
│
├── js/                        Frontend (ES modules)
│   ├── app.js                 Entry point: boot, init, expone funciones a window.*
│   ├── state.js               ST = estado global mutable (país activo, selección, datos)
│   ├── paises.js              Carga /paises.json en el front; helpers paisIso/paisCurrency…
│   ├── config.js              API_BASE, colores de banco, LOGO_SLUGS, colores de marca
│   ├── api.js                 Capa de red: apiDatos(), fetchData() (con caché en ST.data)
│   ├── format.js              bankName() por país, formateo de números/porcentajes
│   ├── ui.js                  Interacciones: selección de bancos, tabs, tema, moneda, compareMode
│   ├── charts.js              Render de gráficos (Chart.js)
│   ├── export.js              Exportar tablas/gráficos
│   ├── utils.js               Helpers varios (status, errores)
│   ├── brCuentas.js           Mapa de cuentas de Brasil (BR_KPI: pares Cosif viejo/nuevo)
│   ├── coCuentas.js           Mapa de cuentas de Colombia (CO_CUIF) + niveles jerárquicos
│   ├── coGrupoAval.js         Lógica especial: consolidación Grupo Aval (Colombia)
│   └── views/
│       ├── resumen.js         Pestaña "Summary": KPIs, gráfico principal, ROE
│       ├── balance.js         Balance / Resultados / Calidad / Comparativo
│       ├── ranking.js         "Banking System": tabla ranking + ratings editables
│       ├── accountview.js     Vista de una cuenta comparada entre bancos
│       ├── config_tab.js      Pestaña Config: alertas de esquema, visitas, diagnósticos
│       └── customKpiPicker.js Modal para elegir una cuenta del plan como KPI custom
│
├── cmf_loader.py              Librería de parseo de los TXT de la CMF (Chile)
├── cargar_zip.py              Runner: carga un ZIP mensual de la CMF
├── Cargar nuevo mes CMF.bat   Atajo Windows para correr la carga de Chile
├── colombia_loader.py         ETL Colombia (Socrata)
├── brasil_loader.py           ETL Brasil (IF.data + Olinda) — nivel prudencial
├── schema_guard.py            Validador de cambios de estructura de las fuentes
├── migrate_to_cockroachdb.py  Script de migración inicial (histórico, one-off)
├── brasil_banks.py            (Legado BR) nombres/es_banco por CNPJ — ya no lo usa el nuevo loader
├── brasil_bancos_config.py    (Legado BR) reglas de renombrado/exclusión de bancos
│
├── migrations/                DDL SQL versionado (ver sección 8)
├── assets/                    Imágenes, banderas, fondos
│   └── logos/                 logo-<slug>.png de cada banco (+ logo-generico.png de fallback)
├── zips/                      ZIPs históricos de la CMF (Chile)
└── .github/workflows/
    ├── colombia-cuif-monthly.yml   Cron CO (día 5 de cada mes)
    └── brasil_auto_update.yml      Cron BR (día 1 de cada mes)
```

---

## 5. Base de datos (CockroachDB)

Cuatro tablas, todas con una columna `country` (ISO) que permite convivir a los
tres países en las mismas tablas. La **clave primaria siempre incluye `country`**.

### 5.1 `datos_financieros` — los valores numéricos (tabla grande)

| Columna | Tipo | Nulo | Default | Notas |
|---------|------|------|---------|-------|
| `country` | text | NO | `'CL'` | ISO del país (`CL`/`CO`/`BR`) |
| `periodo` | text | NO | — | `AAAAMM` (mes para CL/CO, trimestre para BR) |
| `tipo` | text | NO | — | Partición del reporte (ver 5.5) |
| `ins_cod` | bigint | NO | — | Código de institución (numérico) |
| `cuenta` | text | NO | — | Código de cuenta contable |
| `monto_clp` | bigint | sí | 0 | Solo Chile (desglose por moneda) |
| `monto_uf` | bigint | sí | 0 | Solo Chile |
| `monto_tc` | bigint | sí | 0 | Solo Chile |
| `monto_ext` | bigint | sí | 0 | Solo Chile |
| `monto_total` | bigint | sí | 0 | **El valor que usa el dashboard** |

**PK:** `(country, periodo, tipo, ins_cod, cuenta)`.
Para CO/BR solo se usa `monto_total` (los `monto_clp/uf/tc/ext` quedan en 0).
Los valores se guardan como **enteros** (se redondea; en BR vienen en R$ con
centavos y se hace `int(round(valor))`).

### 5.2 `instituciones` — catálogo de bancos/entidades

| Columna | Tipo | Nulo | Default | Notas |
|---------|------|------|---------|-------|
| `country` | text | NO | `'CL'` | |
| `codigo` | bigint | NO | — | Código de institución (= `ins_cod`) |
| `razon_social` | text | NO | — | Nombre oficial |
| `es_banco` | boolean | sí | NULL | Solo se usaba en el modelo BR viejo (ver gotchas) |

**PK:** `(country, codigo)`.

### 5.3 `plan_cuentas` — diccionario de cuentas

| Columna | Tipo | Nulo | Default | Notas |
|---------|------|------|---------|-------|
| `country` | text | NO | `'CL'` | |
| `cuenta` | text | NO | — | Código de cuenta |
| `descripcion` | text | NO | — | Nombre legible de la cuenta |
| `formula` | text | sí | NULL | (CL/BR viejo) fórmula/auditoría Cosif; opcional |

**PK:** `(country, cuenta)`.

### 5.4 `carga_log` — bitácora de cargas + alertas de esquema

| Columna | Tipo | Nulo | Default | Notas |
|---------|------|------|---------|-------|
| `country` | text | NO | `'CL'` | |
| `periodo` | text | NO | — | Período cargado |
| `archivos_procesados` | bigint | sí | 0 | Nº de filas/entidades procesadas |
| `estado` | text | NO | `'ok'` | `'ok'` \| `'alerta_esquema'` |
| `detalle` | jsonb | sí | NULL | Reporte JSON del `schema_guard` cuando hay alerta |

**PK:** `(country, periodo)`.
El backend considera cargados los períodos con estado `'ok'` **o**
`'alerta_esquema'` (la alerta no oculta el período; solo marca que la estructura
de la fuente cambió).

### 5.5 Valores de `tipo` por país (¡importante!)

`tipo` particiona los datos de una misma institución/período en distintos
reportes contables:

- **Chile (CL):** `'b1'` = balance, `'r1'` = estado de resultados, `'c1'` = calidad de cartera.
- **Colombia (CO):** `'b1'` = balance, `'r1'` = resultados (y `'c1'` para KPI custom si aplica).
- **Brasil (BR):** `'p'` (constante, "prudencial"). **Todo BR es `tipo='p'`.** El
  frontend sigue pidiendo `'b1'`/`'r1'` por categoría lógica de cuenta, y el
  backend traduce esas peticiones a `'p'` (ver sección 7.3).

### 5.6 Migración inicial

`migrate_to_cockroachdb.py` fue el script one-off que llevó los datos históricos
al esquema actual. Ya no se corre en operación normal.

---

## 6. Fuentes de datos y loaders (ETL)

Todos los loaders comparten el mismo patrón:
- Leen `COCKROACH_URL` de un archivo `.env` en la raíz (`load_dotenv`).
- Escriben con **UPSERT idempotente** (`INSERT ... ON CONFLICT (...) DO UPDATE`),
  por lotes de **500 filas**. Re-correr un loader nunca duplica.
- Registran el resultado en `carga_log`.
- (CL y CO) integran `schema_guard` para detectar cambios de estructura.

### 6.1 Chile — CMF (mensual, manual)

- **Fuente:** archivos ZIP de la CMF con TXT tab-delimitados (plan de cuentas,
  instituciones y datos). Se guardan en `zips/`.
- **Loader:** `cmf_loader.py` (librería de parseo) + `cargar_zip.py` (runner).
- **Atajo:** `Cargar nuevo mes CMF.bat` (Windows).
- **Códigos de cuenta:** 9 dígitos (ej. `100000000` activos, `300000000`
  patrimonio, `144000000` colocaciones, `590000000` utilidad).
- **Desglose por moneda:** único país que usa `monto_clp/uf/tc/ext`.
- **Automatización:** `.github/workflows/chile-cmf-monthly.yml` + `chile_loader.py` (probe de `articles-{ID}_recurso_1.zip`, cron día 25). `cargar_zip.py` sigue disponible para carga manual local.

### 6.2 Colombia — Superfinanciera vía Socrata (mensual, automático)

- **Fuente:** portal `datos.gov.co`, dataset Socrata `mxk5-ce6w`.
  Filtro base: `tipo_entidad='1' AND moneda='0'` (bancos, totales).
- **Loader:** `colombia_loader.py`. Modos:
  - `--historical` (2022..año actual, por bloques anuales)
  - `--incremental` (solo períodos `AAAAMM` que faltan en `carga_log`)
  - `--institutions-plan` (solo instituciones + plan)
- **Códigos de cuenta:** CUIF de 6 dígitos (ej. `100000`, `300000`, `140000`).
- **Cuenta de patrimonio (equity):** configurable con env `CO_EQUITY_CUENTA`
  (default `300000`).
- **Caso especial "Grupo Aval":** el frontend (`coGrupoAval.js`) consolida
  varias entidades del Grupo Aval; el backend expande/mergea esos códigos.
  BTG Colombia = `codigo_entidad 66`.
- **Automatización:** `.github/workflows/colombia-cuif-monthly.yml`, cron día 5.

### 6.3 Brasil — BCB IF.data + Olinda (trimestral, automático)

Reconstruido en julio 2026 al nivel de **"Conglomerados Prudenciais e
Instituições Independentes"** (cada grupo económico consolidado una vez +
independientes sueltos).

- **Fuente principal (portal IF.data, HTTPS GET sin auth):**
  - Catálogos unidos (dinámicos, sin hardcodear trimestres):
    - `GET .../ifdata/rest/relatorios` → histórico hasta `202412`
    - `GET .../ifdata/rest/relatorios2025a2030` → `202503+`
  - Cobertura prudencial continua desde **`201403`** (cadastro `1004` /
    `1009`; no se usa `1005` financiero con otros IDs).
  - Descarga: `GET .../ifdata/rest/arquivos?nomeArquivo=<f>`. El histórico
    requiere prefijo `ifdata/` sobre el path del catálogo; 2025+ ya trae
    bucket `ifdata_2025_2030//…`.
  - Por trimestre `{dt}` se usan:
    - `cadastro{dt}_1009.json` (desde 202309) o `cadastro{dt}_1004.json`
      (201403–202306) → universo prudencial. `c0` = código grupo `1000…`
      (ej. `1000080336`=BTG) o CNPJ base si independiente; `c2` nombre;
      `c3` TCB; `c4` `'C'`/`'I'`.
    - `dados{dt}_1.json` → valores: filtrar `e ∈ {c0 del cadastro prudencial}`.
- **Fuente secundaria (Olinda OData):** SOLO como diccionario `Conta → NomeColuna`
  (nombre legible). Se fusionan un trimestre Cosif nuevo y uno viejo (≤202412)
  para cubrir `14xxxx` y `78xxx`. **No** se usa Olinda para montos.
- **Loader:** `brasil_loader.py`. Modos:
  - (sin flags) → **modo automático**: carga trimestres del catálogo que no
    estén en `carga_log` (incluye backfill histórico faltante). Cron GHA.
  - `--quarter AAAAMM` → carga/recarga un trimestre.
  - `--all` → carga/recarga todos los del catálogo (o del rango).
  - `--from` / `--to` AAAAMM → limita el rango.
  - `--dry-run` → lista objetivo sin tocar la BD.
  - `--wipe` → **borra TODO Brasil** (solo `country='BR'`) antes de cargar.
- **`tipo` = `'p'`** para todas las filas. `monto_total` = valor en R$.
- **Cuentas clave (KPI — Cosif viejo ≤202412 + nuevo ≥202503):**
  `78182`/`140220` Ativo · `78186`/`140246` Patrimônio · `78187`/`141870`
  Lucro · `78183`/`141873` Carteira · `78185`/`140239` Captações ·
  `78184`/`140244` Passivo · `140200` TVM (solo plan nuevo).
  El frontend suma el par (`BR_KPI` / `brSum`); en cada trimestre solo un
  lado tiene valor (sin doble conteo en la frontera).
- **Automatización:** `.github/workflows/brasil_auto_update.yml`, cron día 1;
  `workflow_dispatch` con modes `auto` / `all` / `range`.
- **Nota:** el nuevo `brasil_loader.py` **no** usa `schema_guard` (es más simple
  y autónomo). `brasil_banks.py` / `brasil_bancos_config.py` quedaron como legado
  del modelo viejo y ya no los importa el loader nuevo.

---

## 7. Backend / API (`backend/server.js`)

Express. Se ejecuta local con `node backend/server.js` (puerto 3000; requiere
`COCKROACH_URL` en `.env`) y en producción como serverless vía `api/index.js`.

### 7.1 Conexión y país
- Pool `pg` con `ssl.rejectUnauthorized=false`, `max: 2` (serverless).
- `resolveDatasetCountry(input)`: normaliza `?country=` contra los ISOs `live`
  de `paises.json`. Cualquier valor desconocido cae al default (`CL`). **Brasil
  ya está soportado** (`BR` está en `live`).
- CORS: cerrado por defecto (solo orígenes de producción). Para pruebas locales:
  `CORS_OPEN=1`.

### 7.2 `GET /api/bootstrap?country=XX`
Devuelve todo lo necesario para arrancar el dashboard de un país:
- `periodos`: de `carga_log` con estado `ok`/`alerta_esquema`, orden ascendente.
- `instituciones`: `{codigo, razon_social}` del país.
  - **BR:** se recorta al **TOP-50 por Patrimônio Líquido** (cuenta `140246`) del
    último período. La base tiene el universo completo (~1.400), pero el
    dashboard muestra top-50.
- `planCuentas`: `{cuenta, descripcion}` del país.
- `patrimonioRows`: equity por institución del último período, para rankear.
  - CL: `tipo='b1'`, cuenta `300000000`.
  - CO: `tipo='b1'`, cuenta `CO_EQUITY_CUENTA` (default `300000`).
  - BR: `tipo='p'`, cuenta `140246` (código nuevo; se mantiene `78186` por compat).

### 7.3 `POST /api/datos`
Cuerpo: `{ country, tipo | tipos[], periodos[], cuentas[], bancos[]?, select? }`.
Devuelve filas de `datos_financieros` filtradas. Columnas permitidas en `select`
están en un allowlist (`ALLOWED_COLS`) para evitar SQL injection.
- **BR:** cualquier `tipo`/`tipos` pedido se **colapsa a `['p']`** (porque todo BR
  es `tipo='p'`). Las `cuentas` del request ya distinguen balance vs resultado,
  así que no hay colisión. CL/CO conservan sus `tipo` tal cual.

### 7.4 Otros endpoints
- `GET /api/diagnostics/account-coverage?country=XX`: métricas de cobertura
  plan_cuentas vs datos_financieros (huérfanas, muertas, por tipo, por dígito).
- `GET /api/schema-alerts?country=XX`: lee `carga_log` (períodos con
  `estado`/`detalle`) para la pestaña Config.
- `GET /api/geo`: geolocaliza por IP (server-side, evita CORS a ipapi.co).
- `POST /api/visits` / `GET /api/visits`: contador de visitas por país
  (tabla `visit_counter`, autocreada al arrancar).
- `/health` (vía rewrite en `vercel.json`).

---

## 8. Migraciones (`migrations/*.sql`)

Aplicar en orden. Resumen del propósito de cada una:

| Archivo | Qué hace |
|---------|----------|
| `001_country_*` (varias) | Introduce el modelo multi-país: agrega columna `country`, espera jobs, y reconstruye las PKs compuestas de las 4 tablas (`datos_financieros`, `instituciones`, `plan_cuentas`, `carga_log`). Se dividió en pasos (step1a..1d, step2..5) por límites de CockroachDB con cambios de PK online. |
| `002_fix_instituciones_codigo_duplicate.sql` | Corrige duplicados de `codigo` en `instituciones`. |
| `003_fix_carga_log_periodo_duplicate.sql` | Corrige duplicados de `periodo` en `carga_log`. |
| `004_carga_log_add_detalle.sql` | Agrega `carga_log.detalle` (jsonb) para el reporte del `schema_guard`. |
| `005_plan_cuentas_add_formula.sql` | Agrega `plan_cuentas.formula` (auditoría Cosif de Chile/BR viejo). |
| `006_instituciones_add_es_banco.sql` | Agrega `instituciones.es_banco` (usado por el modelo BR viejo). |

---

## 9. Frontend (`/js`, `dashboard.html`, `index.html`)

### 9.1 Arranque (boot)
`dashboard.html` importa `js/app.js` como módulo. `app.js`:
1. `loadPaises()` carga `/paises.json` (con respaldo mínimo CL/CO si falla).
2. Resuelve el país activo (por `?country=` o default) y setea `ST.country`.
3. Llama `GET /api/bootstrap` y guarda en `ST` (`applyBootstrapPayload`):
   - `ST.periodos`, `ST.bancos` (`{codigo: razon_social}`), `ST.planCuentas`,
     `ST._patrimonioMap` y `ST._patrimonioRanking` (orden por equity desc).
4. Rellena selectores, lista de bancos y corre la vista `resumen`.
`app.js` también expone muchas funciones a `window.*` para los `onclick` del HTML.

### 9.2 Estado global (`state.js`)
`ST` es el único objeto mutable de estado: país, períodos, bancos, selección
(`selected`, `selectedOrder`, `compareMode`), rango de fechas, caché de datos
(`ST.data`), plan de cuentas, preferencias de UI (tema, moneda, fontSize).
Helpers: `datasetIsoCountry()` (→ `CL`/`CO`/`BR`), `reportingLocalCurrencyISO()`.

### 9.3 Capa de red (`api.js`)
- `apiDatos(params)`: POST a `/api/datos`, inyecta `country`, integra la
  expansión/merge de Grupo Aval (CO).
- `fetchData(tipo, cuentas, periodos, bancos)`: cachea en `ST.data` por clave
  `country|tipo|periodos|bancos|cuentas` (evita refetch).
- `API_BASE` (en `config.js`): `http://localhost:3000` en local, `''` (mismo
  origen) en producción.

### 9.4 Versionado de caché (¡CRÍTICO al editar el front!)
Todos los imports ES llevan `?v=bmonNN` (hoy **`bmon37`**). Como no hay bundler,
los navegadores cachean los módulos. **Cada vez que edites cualquier `.js` del
front, hay que subir el número en TODOS los archivos** (`bmon37` → `bmon38`,
etc.) para forzar la recarga en producción. Está en todos los `js/*.js` y en el
`<script>` de `dashboard.html`.

### 9.5 Mapas de cuentas por país
- **CL:** códigos de 9 dígitos hardcodeados en las vistas.
- **CO (`coCuentas.js`):** `CO_CUIF` (activos, colocaciones, patrimonio,
  utilidad…), helpers de nivel jerárquico (6 dígitos).
- **BR (`brCuentas.js`):** `BR_KPI` define cada KPI como un **conjunto {código
  viejo ≤2024, código nuevo ≥2025}** que se **suma** (ej. patrimonio =
  `['78186','140246']`). Como viejo y nuevo nunca coexisten con valor en un mismo
  trimestre, sumarlos mantiene la serie continua a través de la frontera Cosif de
  mar-2025. Funciones `brSum`/`brSeries`.

### 9.6 Config visual (`config.js`)
- `BANK_COLORS`: color por código de banco; `BRAND_COLORS`: color por nombre de
  marca (para que Santander CL y Santander BR compartan rojo).
- `LOGO_SLUGS`: mapa `"<ISO>-<codigo>" → slug`. Los logos se sirven de
  `assets/logos/logo-<slug>.png`; fallback `logo-generico.png`.
  **BR usa los códigos prudenciais `1000...`** (ej. `BR-1000080336` = btg).
- `BTG_CODES`: set de códigos de BTG por país (`59`=CL, `66`=CO, `1000080336`=BR)
  → resaltado azul (`btgBlue()`, tema-aware: navy `#062650` claro / `#2563eb`
  oscuro).

### 9.7 Vistas
- **`resumen.js`** — "Summary": banner del banco (logo + color de marca), KPI
  boxes, gráfico principal (por KPI seleccionado), ROE. Anualiza utilidad para
  ROE (BR/CO trimestral/mensual).
- **`balance.js`** — Balance, Resultados (P&L), Calidad de cartera, Comparativo.
- **`ranking.js`** — "Banking System": tabla ranking por equity + ratings
  editables (Feller CL / Fitch CO; BR sin rating → `—`).
- **`accountview.js`** — comparación de una cuenta entre todos los bancos.
- **`config_tab.js`** — alertas de esquema (`/api/schema-alerts`), visitas,
  diagnósticos de cobertura.
- **`customKpiPicker.js`** — elegir cualquier cuenta del plan como KPI custom.

### 9.8 Nombres de banco (`format.js` → `bankName`)
Los nombres salen de `razon_social` (BD). Reglas por país:
- **BR:** overrides puntuales (BTG `1000080336` → "BTG Pactual Brasil",
  Banrisul `1000080154`) y limpieza genérica del sufijo `" - PRUDENCIAL"`.
- **CO:** título/particulas + display especial, sufijo "(Aval)" para Grupo Aval.
- **CL:** limpieza de "BANCO "/" CHILE".

### 9.9 Selección de bancos y modo comparación (`ui.js`)
- **Modo individual** (`compareMode=false`): seleccionar un banco deselecciona
  los demás; no se permite quedar en cero.
- **Modo comparación** (`compareMode=true`): multi-selección hasta 5 bancos.
- Toggle "Bank Comparison"; al cambiar de país se resetea a individual.

### 9.10 Moneda
Toggle USD / moneda local. Trae el tipo de cambio (USD→CLP/COP/BRL) y reexpresa
los montos. La moneda local sale de `paises.json` (`reportingLocalCurrencyISO`).

---

## 10. Validaciones y calidad de datos (`schema_guard.py`)

Objetivo: avisar cuando una fuente cambia su estructura, sin romper la serie.

- **Cuándo se dispara alerta:**
  1. Desaparece alguna **cuenta crítica** del país (`CRITICAL_ACCOUNTS`: activos,
     pasivos, patrimonio, colocaciones, depósitos, utilidad…).
  2. Aparecen/desaparecen más de `STRUCTURAL_CHANGE_THRESHOLD` (25) cuentas.
  3. **Umbral relativo:** desaparece ≥ 50% (`STRUCTURAL_CHANGE_REL`) de las
     cuentas del período previo (pensado para fuentes con pocas cuentas).
- **Comportamiento:** el período **se carga igual**; si hay cambio estructural se
  marca `carga_log.estado='alerta_esquema'` y se guarda el reporte JSON en
  `carga_log.detalle`. Si no, `estado='ok'`, `detalle=NULL`.
- **Línea base:** se compara período-contra-período (lo que tuvo datos el período
  anterior), no contra todo el catálogo. `get_known_accounts(conn, country,
  tipos=…, before_periodo=…)` permite restringir por `tipo` y por período previo
  (clave para el backfill histórico y para no comparar Cosif viejo vs nuevo).
- **Brasil:** `CRITICAL_ACCOUNTS['BR']` está vacío a propósito (los códigos `Conta`
  cambiaron con Cosif 2025); para BR el detector válido es el umbral relativo.
  Nota: el `brasil_loader.py` nuevo no invoca `schema_guard`; la vigilancia de
  esquema aplica hoy sobre todo a CL/CO.

---

## 11. Seguridad y operaciones

- **Secreto único:** `COCKROACH_URL` (cadena de conexión). Vive en `.env` local
  (no commiteado) y como *secret* de repo en GitHub Actions. Ver `.env.example`.
- **DELETE siempre por país:** cualquier borrado lleva `WHERE country='XX'`.
  Nunca un DELETE sin filtro de país. El `--wipe` de Brasil borra solo
  `country='BR'` en las 4 tablas.
- **Respaldos:** antes de operaciones destructivas se exporta a CSV
  (ej. `backups/BR_backup_<timestamp>/`, no versionado en git).
- **Idempotencia:** todos los loaders usan UPSERT; reintentar es seguro.
- **Despliegue:** push a `main` → Vercel despliega automáticamente el frontend
  estático y la función `api/index.js`.

---

## 12. Estado actual de los datos (julio 2026)

| País | Filas en `datos_financieros` | Períodos | Frecuencia | Notas |
|------|------------------------------|----------|-----------|-------|
| CL | ~2.28 M | ~53 meses | mensual | desglose por moneda |
| CO | ~1.13 M | ~52 meses | mensual | Grupo Aval consolidado |
| BR | ~1.31 M (solo 2025+; +~11.5 M tras backfill 2014–2024) | prudencial desde `201403` | trimestral | nivel prudencial, `tipo='p'`, ~1.300–1.400 entidades/trim |

Brasil: ~1.4k instituciones/trimestre; `plan_cuentas` con Cosif viejo (`78xxx`)
y nuevo (`14xxxx`). Backfill histórico = misma fuente portal IF.data; KPIs
continúan vía `BR_KPI` (suma del par viejo/nuevo sin doble conteo).

---

## 13. Cómo hacer cambios comunes (recetas)

### 13.1 Cargar un mes/trimestre nuevo
- **CL:** poner el ZIP nuevo y correr `Cargar nuevo mes CMF.bat` (o `cargar_zip.py`).
- **CO:** `python colombia_loader.py --incremental` (o esperar el cron del día 5).
- **BR:** `python brasil_loader.py` (modo automático; o esperar el cron del día 1).
  Detecta solo los trimestres que faltan. **No usar `--wipe`.**

### 13.2 Editar el frontend
Hacer el cambio y **subir la versión de caché** en todos los `js/*.js` +
`dashboard.html` (`bmon37` → `bmon38`). Si no, los usuarios ven la versión vieja.

### 13.3 Agregar/actualizar un logo de banco
1. Poner `assets/logos/logo-<slug>.png`.
2. Mapear en `config.js` → `LOGO_SLUGS`: `"<ISO>-<codigo>": '<slug>'`
   (para BR el `<codigo>` es el prudencial `1000...`).
3. (Opcional) color de marca en `BRAND_COLORS`/`BRAND_TEXT_COLORS`.
4. Subir versión de caché.

### 13.4 Agregar un país nuevo
1. Registrarlo en `paises.json` con `status:'live'` (iso, moneda, locale, etc.).
2. Escribir un loader `xx_loader.py` que llene las 4 tablas con `country='XX'`
   (patrón: UPSERT, batch 500, `carga_log`, opcional `schema_guard`).
3. Crear su workflow en `.github/workflows/`.
4. Ajustar el backend solo si su nivel de datos difiere (ej. un `tipo` propio
   como hizo BR con `'p'`), y el frontend para sus mapas de cuentas/logos.

### 13.5 Reconstruir Brasil desde cero (excepcional)
Seguir el orden: respaldar → `python brasil_loader.py --wipe --quarter <el más
antiguo>` → validar ranking por `140246` → `python brasil_loader.py --all`.
Ver la especificación original en `ESPECIFICACION_BRASIL_LOADER.md` (externo).

---

## 14. Gotchas y deuda técnica conocida

- **Un mismo `codigo` numérico es OTRO banco en distinto país.** El código no es
  único global; la PK incluye `country`. El frontend tiene overrides por país
  (ej. `btgCodeForIso()`).
- **Frontera Cosif de Brasil (mar-2025):** códigos `78xxx` (≤202412) vs
  `14xxxx` (≥202503). El front suma el par {viejo,nuevo} en `BR_KPI`; en cada
  trimestre solo un lado tiene valor (sin doble conteo). Cartera/Pasivo también
  cambiaron de definición → posible salto real pequeño en la frontera.
  Balance/PyG detallados del UI aún usan solo el árbol Cosif nuevo.
- **BR usa códigos prudenciais `1000...` (10 dígitos)**, no los CNPJ individuales
  del modelo anterior. Todos los mapas del front (logos, BTG) están migrados a
  estos códigos. Si algún banco muestra logo genérico, falta su entrada en
  `LOGO_SLUGS` con el código prudencial correcto.
- **`es_banco`:** solo tenía sentido en el modelo BR viejo. El nuevo loader NO lo
  setea; el backend BR ya no filtra por `es_banco` (rankea por equity + top-50).
  En CL/CO la columna es NULL y no se usa.
- **`git` cuelga en PowerShell** en algunos entornos Windows; workaround usado:
  `python -c "import subprocess; subprocess.run(['git', ...])"`.
- **Números de referencia de la spec de BR** (PL por banco) eran aproximados; al
  validar, el PL prudencial puede diferir del PL que reporta el banco (consolidación
  más amplia). Ej.: BTG 202603 = R$78.17 bi (prudencial) vs ~R$74.5 bi reportado.
- **Fuera de alcance / mejoras futuras (Brasil):** metadata de grupo prudencial
  (drill-down grupo→filiales) y reportes de crédito detallado (Fase 2) — no
  implementados.
- **`brasil_banks.py` / `brasil_bancos_config.py`** son legado del loader viejo;
  ya no se usan en la carga nueva (se pueden depurar en el futuro).

- **RIESGO REAL — Brasil sin monitoreo de esquema:** `schema_guard.py` NO
  cubre Brasil en el nuevo modelo. Los endpoints del portal del Banco Central
  (`www3.bcb.gov.br/ifdata/rest/...`) son **no documentados y no oficiales**:
  pueden cambiar de nombre, de estructura o de URLs sin aviso previo. Si eso
  ocurre, el loader falla silenciosamente (o carga datos incorrectos) sin que
  haya ninguna alerta visible en el dashboard ni en `carga_log`. **Pendiente
  implementar:** una variante de `schema_guard` para BR que verifique al menos
  (a) que el catálogo `relatorios2025a2030` sigue respondiendo con trimestres,
  (b) que las cuentas clave (`140246`, `140220`, `141870`) siguen presentes en
  el último trimestre cargado, y (c) que el conteo de entidades no cae
  dramáticamente respecto al período anterior. Hasta entonces, revisar
  manualmente los logs del cron mensual de GitHub Actions.

---

## 15. Referencias rápidas de archivos

| Necesito… | Voy a… |
|-----------|--------|
| Cambiar la lógica de un endpoint | `backend/server.js` |
| Cambiar cómo se ven los KPIs / gráfico | `js/views/resumen.js` |
| Cambiar el ranking / ratings | `js/views/ranking.js` |
| Añadir/editar logos o colores | `js/config.js` + `assets/logos/` |
| Editar nombres mostrados de bancos | `js/format.js` |
| Cargar datos de un país | `cmf_loader.py`+`cargar_zip.py` (CL) · `colombia_loader.py` (CO) · `brasil_loader.py` (BR) |
| Cambiar validación de estructura | `schema_guard.py` |
| Registrar un país / cambiar moneda-locale | `paises.json` |
| Cambiar rutas/caché de Vercel | `vercel.json` |
| Cambiar el schema de la BD | nueva migración en `migrations/` |

---

**Fin del documento.** Mantener actualizado tras cambios estructurales
(especialmente: versión de caché del front, nuevos países, cambios de esquema
de la BD o de las fuentes oficiales).
