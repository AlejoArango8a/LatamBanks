# LatamBanks API (backend)

API Express que sirve los datos financieros desde CockroachDB al dashboard.

## Endpoints

| Endpoint | Método | Descripción |
|----------|--------|-------------|
| `/health` | GET | Estado del servicio y conexión a DB |
| `/api/bootstrap` | GET | Períodos, instituciones, plan de cuentas y ranking patrimonial |
| `/api/datos` | POST | Datos financieros filtrados por tipo, períodos, cuentas y bancos |
| `/api/visits` | GET | Total de visitas globales y desglose por país |
| `/api/visits` | POST | Registra una visita con código y nombre de país |

## Variables de entorno en Render

En el servicio Web → **Environment**:

| Variable | Valor |
|----------|--------|
| `COCKROACH_URL` | Connection string de CockroachDB Serverless (formato postgresql://...) |
| `FRONTEND_URLS` | Orígenes CORS permitidos. Ej: `https://alejoarango8a.github.io` (separados por coma) |

## Despliegue

El deploy es automático: cada `git push` a `main` dispara un nuevo deploy en Render.

- **Start Command:** `node server.js`
- **Build Command:** `npm install`
- **Root Directory:** `backend`

## Probar local

```bash
cp .env.example .env
# Edita .env con tu COCKROACH_URL real
npm install
npm start
```

Abre `http://localhost:3000/health` para verificar la conexión a CockroachDB.
