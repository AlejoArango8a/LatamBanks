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
cargar_zip.py               Script de carga (llamado por el .bat)
cmf_loader.py               Librería: parsers y carga a CockroachDB
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

## Stack técnico

| Capa | Tecnología | Hosting |
|------|-----------|---------|
| Frontend | `dashboard.html` + ES modules (`js/`) | GitHub Pages / Vercel |
| Backend | Express / Node.js | Render |
| Base de datos | CockroachDB Serverless | AWS us-east-1 |
| ETL | Python (`cmf_loader.py`) | Local |

---

## Países cubiertos

| País | Estado |
|------|--------|
| Chile | Activo (CMF, desde 2022) |
| Colombia | En desarrollo |
| Perú | En desarrollo |
| Uruguay | En desarrollo |

`ST.country` en el cliente separa por jurisdicción la clave de caché local de datos; al sumar backends adicionales, conviene vaciar `ST.data` en el cambio de país.
