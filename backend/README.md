# LatamBanks API (backend)

API Express que sirve los datos financieros desde CockroachDB al dashboard.

## Endpoints

| Endpoint | Método | Descripción |
|----------|--------|-------------|
| `/health` | GET | Estado del servicio y conexión a DB |
| `/api/bootstrap` | GET | `?country=CL` o `CO` — períodos, instituciones, plan de cuentas y ranking patrimonial |
| `/api/diagnostics/account-coverage` | GET | `?country=CL` o `CO` — conteos plan vs `datos_financieros`, huérfanas, muestras (uso interno / QA) |
| `/api/datos` | POST | Datos financieros; body con `country` (CL|CO), tipo(s), períodos, cuentas, bancos |
| `/api/visits` | GET | Total de visitas globales y desglose por país |
| `/api/visits` | POST | Registra una visita con código y nombre de país |

## Variables de entorno en Render

En el servicio Web → **Environment**:

| Variable | Valor |
|----------|--------|
| `COCKROACH_URL` | Connection string de CockroachDB Serverless (formato postgresql://...) |
| `FRONTEND_URLS` | Orígenes CORS permitidos. Ej: `https://alejoarango8a.github.io` (separados por coma) |
| `CO_EQUITY_CUENTA` | (Opcional) Cuenta b1 CUIF Colombia (6 dígitos) para patrimonio en bootstrap; por defecto `380000` |


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
