# ALM BTG — Banks Monitor

Dashboard de estados financieros de bancos chilenos. Fuente: CMF Chile · IFRS · Desde enero 2022.

---

## Estructura del proyecto

```
index.html                  Página de aterrizaje / marketing (opcional según deployment)
dashboard.html             Aplicación del monitor banking (SPA, entry principal del monitor)
js/app.js                   Bootstrap + cableado global (se carga desde dashboard.html con ?v=…)
Old info/                  Material histórico (ignorado en Git si está listado en .gitignore local)
Cargar nuevo mes CMF.bat    ← Lo que usas cada mes para subir datos
cargar_zip.py               Script de carga ZIP CMF Chile (usa cmf_loader)
colombia_loader.py           ETL Colombia · API Socrata CUIF → Cockroach (country CO)
cmf_loader.py               Librería CMF Chile: ZIP → tabla datos_financieros (country CL)
migrations/                 SQL multi-país: ver `001_country_multijurisdiction.sql` (1a–1d, wait jobs, pasos 2–5)
.github/workflows/          GitHub Actions (carga CUIF Colombia programada)
.env                        Tus credenciales (no se sube a GitHub)
.env.example                Plantilla para crear el .env
requirements.txt            Dependencias Python
backend/                    API Express (Node.js), desplegada en Vercel como serverless (api/index.js)
assets/                     Logos e imágenes del dashboard
```

El frontend modular cachea bundles con una query **`?v=bmon…`** en los `<script type="module">` y en imports entre módulos: al desplegar en Vercel, sube la versión si cambió el código para evitar rutas viejas guardadas por el navegador.

---

## Setup inicial (solo la primera vez)

### 1. Instalar dependencias Python

```
pip install -r requirements.txt
```

### 2. Crear el archivo de credenciales

- Copia `.env.example` → `.env`
- Abre `.env` con el Bloc de notas
- Pega tu `COCKROACH_URL`
  _(la encuentras en CockroachDB Cloud → Connect → psycopg2 connection string)_

---

## Cargar datos de un nuevo mes

**Automático (recomendado):** el workflow GitHub Actions `chile-cmf-monthly.yml` corre el día 25,
descubre el ZIP scrapeando el listing vivo de la CMF
([propertyvalue-32901](https://www.cmfchile.cl/portal/estadisticas/626/w4-propertyvalue-32901.html))
y el hub de reportes mensuales
([propertyvalue-28910](https://www.cmfchile.cl/portal/estadisticas/626/w4-propertyvalue-28910.html)),
y falla con Issue `loader-failure` si el listing está adelantado respecto de la DB.

**Manual (fallback):**

1. Descarga el ZIP del mes desde la CMF:
   https://www.cmfchile.cl/portal/estadisticas/626/w4-propertyvalue-32901.html
   _(el listing antiguo `…/28917` está desactualizado — no usarlo)_

2. Haz **doble clic** en `Cargar nuevo mes CMF.bat`

3. Se abre el selector de archivos → elige el ZIP que descargaste

4. El script sube todo a CockroachDB automáticamente

O bien:

```
python chile_loader.py --zip-path ./zips/articles-XXXXX_recurso_1.zip
python chile_loader.py --discover-only   # ver qué ve el scraper sin tocar la DB
```

**Chile complementary (automated):**

| Fuente | Loader / cron | Notas |
|--------|---------------|--------|
| Basilea III | `chile_basilea_loader.py` (con CMF monthly) | Solvency sheet |
| Macros UF/USD/IPC/TPM/UTM/(TMC) | `chile_macros_loader.py` · daily | mindicador; optional GitHub secret `CMF_API_KEY` for CMF API + TMC |
| BCCh Series bancarias | `chile_bcch_loader.py` · day 26 | CSV zip vía Playwright (Imperva); o `--zip-path` |
| Ratings | `chile_ratings_loader.py` · quarterly | Humphreys scrape + curated Feller → `data/cl_bank_ratings.json` |

**¿Doble clic y “no pasa nada”?** El diálogo para elegir el ZIP a veces abre **detrás** del navegador u otras apps (revisa la barra de tareas). Además, al ejecutar desde el Explorador a veces **`python`** no está en el PATH; el `.bat` prueba antes **`py -3`**. Como alternativa, en esta carpeta:

```
py -3 cargar_zip.py "C:\ruta\completa\al_archivo.zip"
```

---

## Colombia — CUIF (Superfinanciera · datos.gov.co)

1. Aplica la migración multi-país **en el orden** indicado en **`migrations/001_country_multijurisdiction.sql`**.  
   En Cockroach 25.x puede fallar el cambio de PK si aún hay un **cambio de esquema en segundo plano**: entre el paso 1 y el 2 ejecuta **`001_country_step1_wait_for_jobs.sql`**, revisa `SHOW JOBS` y espera a que no queden trabajos *running* antes de continuar.
2. Carga inicial / incremental desde Socrata (API pública):

   ```
   python colombia_loader.py --institutions-plan
   python colombia_loader.py --historical
   python colombia_loader.py --incremental
   ```

3. Opcional — **GitHub Actions** mes a mes: archivo  
   `.github/workflows/colombia-cuif-monthly.yml`. Configura el secret **`COCKROACH_URL`** en el repositorio.
4. Opcional — en Vercel (backend), variable **`CO_EQUITY_CUENTA`**: cuenta de balance CUIF de 6 dígitos para ranking de patrimonio cuando `country=CO` en `/api/bootstrap`.

El dashboard permite elegir Colombia y llamar bootstrap/API con país `CO`; los KPI principales del resumen siguen usando códigos **CMF Chile** hasta definir el mapeo CUIF→vistas.

---

## Stack técnico

| Capa | Tecnología | Hosting |
|------|-----------|---------|
| Frontend | `dashboard.html` + ES modules (`js/`) | Vercel |
| Backend | Express / Node.js (serverless `api/index.js`) | Vercel |
| Base de datos | CockroachDB Serverless | AWS us-east-1 |
| ETL | Python (`cmf_loader.py`, `colombia_loader.py`, `brasil_loader.py`, `uruguay_loader.py`, `peru_loader.py`, `usa_loader.py`, `argentina_loader.py`, `mexico_loader.py`, `panama_loader.py`) | Local / GitHub Actions |

---

## Países cubiertos

| País | Estado |
|------|--------|
| Chile | Activo (CMF, desde 2022) |
| Colombia | Activo (CUIF / Socrata) |
| Brasil | Activo (IF.data prudencial). Histórico continuo desde **201403**; Cosif viejo≤202412 + nuevo≥202503 |
| Uruguay | Activo (BCU Boletín SSF → `uruguay_loader.py`; desde ~2020) |
| Perú | Activo (SBS B-2201 → `peru_loader.py`; desde ~2015) |
| Estados Unidos | Activo (FDIC BankFind → `usa_loader.py`; **top 300 por equity**/trimestre + CERT fijados, p.ej. BTG Pactual Bank 35154) |
| Argentina | Activo (BCRA datos abiertos → `argentina_loader.py`; mensual) |
| México | Activo (CNBV Boletín **Banca Múltiple** → `mexico_loader.py`; mensual). Nu/Nubank aún no en BM (era SOFIPO; auth. banco ~jul 2026 — entra cuando CNBV lo publique en BM) |
| Panamá | Activo (SBP reportes individuales → `panama_loader.py`; mensual; USD) |
| Paraguay | En investigación (BCP; `status: soon` en selectors) |

**Americas Monitor** (`americas.html`, API `GET /api/americas/snapshot`): cross-country USD comparison (equity, assets, loans, deposits/funding, net income). Landing entry is **temporarily hidden**.

Carga inicial / backfills: ver `LOADERS_MANANA.md`.

### Brasil — backfill / carga

```bash
# Ver qué se cargaría (sin BD)
python brasil_loader.py --dry-run --all --from 201403 --to 202412

# Cargar histórico faltante (requiere COCKROACH_URL en .env)
python brasil_loader.py --all --from 201403 --to 202412

# Modo automático (cron): solo trimestres que falten en carga_log
python brasil_loader.py
```

También: GitHub Actions → **Brasil - Auto Update** → `workflow_dispatch` con mode `range` o `auto`.

`ST.country` en el cliente separa por jurisdicción la clave de caché local de datos; al sumar backends adicionales, conviene vaciar `ST.data` en el cambio de país.
