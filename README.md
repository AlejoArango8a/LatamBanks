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
migrations/                 Migraciones SQL (multi-país: leer `001_country_multijurisdiction.sql`; pasos `001_country_step1..5`)
.github/workflows/          GitHub Actions (carga CUIF Colombia programada)
.env                        Tus credenciales (no se sube a GitHub)
.env.example                Plantilla para crear el .env
requirements.txt            Dependencias Python
backend/                    API Express (Node.js) desplegada en Render
assets/                     Logos e imágenes del dashboard
```

El frontend modular cachea bundles con una query **`?v=bmon…`** en los `<script type="module">` y en imports entre módulos: al desplegar en Vercel/GitHub Pages, sube la versión si cambió el código para evitar rutas viejas guardadas por el navegador.

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

1. Descarga el ZIP del mes desde la CMF:
   https://www.cmfchile.cl/portal/estadisticas/617/w3-propertyvalue-28917.html

2. Haz **doble clic** en `Cargar nuevo mes CMF.bat`

3. Se abre el selector de archivos → elige el ZIP que descargaste

4. El script sube todo a CockroachDB automáticamente

---

## Colombia — CUIF (Superfinanciera · datos.gov.co)

1. Aplica en **CockroachDB** la migración multi-país **en orden** (CockroachDB 25.x no admite “añadir `country` y cambiar la clave primaria en la misma tabla en un solo pegado”): ejecuta **`001_country_step1_add_columns.sql`**, luego **`001_country_step2_…`** … hasta **`step5`** (la guía está en **`migrations/001_country_multijurisdiction.sql`**).
2. Carga inicial / incremental desde Socrata (API pública):

   ```
   python colombia_loader.py --institutions-plan
   python colombia_loader.py --historical
   python colombia_loader.py --incremental
   ```

3. Opcional — **GitHub Actions** mes a mes: archivo  
   `.github/workflows/colombia-cuif-monthly.yml`. Configura el secret **`COCKROACH_URL`** en el repositorio.
4. Opcional — en Render (backend), variable **`CO_EQUITY_CUENTA`**: cuenta de balance CUIF de 6 dígitos para ranking de patrimonio cuando `country=CO` en `/api/bootstrap`.

El dashboard permite elegir Colombia y llamar bootstrap/API con país `CO`; los KPI principales del resumen siguen usando códigos **CMF Chile** hasta definir el mapeo CUIF→vistas.

---

## Stack técnico

| Capa | Tecnología | Hosting |
|------|-----------|---------|
| Frontend | `dashboard.html` + ES modules (`js/`) | GitHub Pages / Vercel |
| Backend | Express / Node.js | Render |
| Base de datos | CockroachDB Serverless | AWS us-east-1 |
| ETL | Python (`cmf_loader.py`, `colombia_loader.py`) | Local / GitHub Actions |

---

## Países cubiertos

| País | Estado |
|------|--------|
| Chile | Activo (CMF, desde 2022) |
| Colombia | ETL CUIF disponible (`colombia_loader.py`); KPIs panel resumen aún en cuentas CMF |
| Perú | En desarrollo |
| Uruguay | En desarrollo |

`ST.country` en el cliente separa por jurisdicción la clave de caché local de datos; al sumar backends adicionales, conviene vaciar `ST.data` en el cambio de país.
