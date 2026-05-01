const express = require('express');
const cors    = require('cors');
const { Pool } = require('pg');
require('dotenv').config();

const app = express();

// Body parser — handle both Vercel pre-parsed and raw stream bodies
app.use((req, res, next) => {
  if (req.body !== undefined) return next(); // already parsed by Vercel runtime
  express.json({ limit: '2mb' })(req, res, next);
});
app.use(express.urlencoded({ extended: false }));

// ============================================================
// CORS — cerrado por defecto; abre solo los orígenes en FRONTEND_URLS.
// Para debug puntual en Render: CORS_OPEN=1 (nunca dejar en producción).
// ============================================================
const useOpenCors = (process.env.CORS_OPEN || '0') !== '0';
if (useOpenCors) {
  app.use(cors({ origin: true, maxAge: 3600 }));
} else {
  const DEFAULT_FRONTEND = 'https://alejoarango8a.github.io,https://latambanks.vercel.app,https://latam-banks.vercel.app';
  const origins = (process.env.FRONTEND_URLS || DEFAULT_FRONTEND)
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

  app.use(cors({
    origin(origin, cb) {
      if (!origin) return cb(null, true);
      const allowed = origins.some(entry => {
        try { return origin === new URL(entry).origin; } catch { return origin === entry; }
      });
      allowed ? cb(null, origin) : cb(new Error('Not allowed by CORS'));
    },
  }));
}

// ============================================================
// BASE DE DATOS — CockroachDB vía driver pg
// ============================================================
if (!process.env.COCKROACH_URL) {
  console.error('ERROR: falta COCKROACH_URL en las variables de entorno');
  process.exit(1);
}

const pool = new Pool({
  connectionString: process.env.COCKROACH_URL,
  ssl: { rejectUnauthorized: false },
  max: 2,                   // bajo para serverless (múltiples instancias en paralelo)
  idleTimeoutMillis: 10000, // libera conexiones inactivas más rápido en serverless
  connectionTimeoutMillis: 10000,
});

pool.on('error', (err) => console.error('DB pool error:', err));

/** CL = CMF Chile, CO = CUIF Colombia (columna country en tablas maestras). */
function resolveDatasetCountry(input) {
  const s = String(input ?? 'CL').toUpperCase().trim();
  return s === 'CO' ? 'CO' : 'CL';
}

// Helper: ejecuta una query y devuelve las filas
async function query(sql, params = []) {
  const client = await pool.connect();
  try {
    const res = await client.query(sql, params);
    return res.rows;
  } finally {
    client.release();
  }
}

// ============================================================
// HEALTH
// ============================================================
app.get('/health', async (req, res) => {
  try {
    await query('SELECT 1');
    res.json({ ok: true, service: 'latambanks-api', db: 'cockroachdb' });
  } catch (e) {
    res.status(503).json({ ok: false, error: String(e.message) });
  }
});

// ============================================================
// GET /api/bootstrap — períodos + instituciones + plan_cuentas + patrimonio
// ============================================================
app.get('/api/bootstrap', async (req, res) => {
  try {
    const country = resolveDatasetCountry(req.query.country);
    const [periodosRows, institucionesRaw, planCuentas] = await Promise.all([
      query(
        "SELECT periodo FROM carga_log WHERE estado = 'ok' AND country = $1 ORDER BY periodo ASC",
        [country],
      ),
      query(
        'SELECT codigo::int, razon_social FROM instituciones WHERE country = $1 ORDER BY codigo ASC',
        [country],
      ),
      query(
        'SELECT cuenta, descripcion FROM plan_cuentas WHERE country = $1 ORDER BY cuenta ASC',
        [country],
      ),
    ]);
    const instituciones = institucionesRaw.map(r => ({ ...r, codigo: Number(r.codigo) }));

    const periodos = periodosRows.map(r => r.periodo);
    if (!periodos.length) {
      return res.status(502).json({
        ok: false,
        error:
          country === 'CO'
            ? 'Sin períodos cargados para Colombia (CO). Ejecuta colombia_loader.py después de aplicar migrations/001.'
            : 'No hay períodos en la base de datos',
      });
    }

    const lastPeriodo = periodos[periodos.length - 1];
    let patrimonioRows = [];
    try {
      if (country === 'CL') {
        patrimonioRows = await query(
          `SELECT ins_cod::int, monto_total::bigint FROM datos_financieros
           WHERE country = $1 AND tipo = 'b1' AND cuenta = '300000000' AND periodo = $2`,
          [country, lastPeriodo],
        ).then(rows => rows.map(r => ({ ins_cod: Number(r.ins_cod), monto_total: Number(r.monto_total) })));
      } else if (country === 'CO') {
        const eqCuenta = String(process.env.CO_EQUITY_CUENTA || '300000').trim();
        patrimonioRows = await query(
          `SELECT ins_cod::int, monto_total::bigint FROM datos_financieros
           WHERE country = $1 AND tipo = 'b1' AND cuenta = $2 AND periodo = $3`,
          [country, eqCuenta, lastPeriodo],
        ).then(rows => rows.map(r => ({ ins_cod: Number(r.ins_cod), monto_total: Number(r.monto_total) })));
      }
    } catch (e) {
      console.warn('patrimonio ranking fetch failed (non-fatal):', e.message);
    }

    res.json({
      ok: true,
      country,
      periodos,
      instituciones,
      planCuentas,
      patrimonioRows,
    });
  } catch (e) {
    console.error('/api/bootstrap error:', e);
    res.status(500).json({ ok: false, error: String(e.message) });
  }
});

// ============================================================
// POST /api/datos — datos financieros filtrados
// Body: { tipo|tipos[], periodos[], cuentas[], bancos[]?, select? }
// ============================================================
const ALLOWED_COLS = new Set([
  'periodo','ins_cod','cuenta','monto_total','monto_clp','monto_uf','monto_tc','monto_ext','tipo',
]);

app.post('/api/datos', async (req, res) => {
  try {
    const body = req.body || {};
    const { tipo, tipos: tiposArr, periodos, bancos, cuentas, select: selectCols } = body;
    const country = resolveDatasetCountry(body.country);

    const tiposList = Array.isArray(tiposArr) && tiposArr.length ? tiposArr
                    : tipo ? [tipo]
                    : null;
    if (!tiposList)                                return res.status(400).json({ ok: false, error: 'Requerido: tipo o tipos[]' });
    if (!Array.isArray(periodos) || !periodos.length) return res.status(400).json({ ok: false, error: 'Requerido: periodos[]' });
    if (!Array.isArray(cuentas)  || !cuentas.length)  return res.status(400).json({ ok: false, error: 'Requerido: cuentas[]' });

    const NUMERIC_COLS = new Set(['ins_cod','monto_total','monto_clp','monto_uf','monto_tc','monto_ext']);
    const cols = selectCols
      ? selectCols.split(',').map(c => c.trim()).filter(c => ALLOWED_COLS.has(c))
      : ['periodo','ins_cod','cuenta','monto_total','monto_clp','monto_uf','monto_tc','monto_ext'];

    // Castear columnas numéricas para que pg las devuelva como números, no strings
    const selectStr = cols.map(c => NUMERIC_COLS.has(c) ? `${c}::bigint AS ${c}` : c).join(', ');

    const tipoPromises = tiposList.map(t => {
      const params = [country, t, periodos, cuentas];
      let sql = `SELECT ${selectStr} FROM datos_financieros
                 WHERE country = $1
                   AND tipo = $2
                   AND periodo = ANY($3)
                   AND cuenta  = ANY($4)`;
      if (Array.isArray(bancos) && bancos.length) {
        params.push(bancos);
        sql += ` AND ins_cod = ANY($${params.length})`;
      }
      return query(sql, params);
    });

    const rawRows = (await Promise.all(tipoPromises)).flat();
    // Convertir bigint strings a números JS
    const allRows = rawRows.map(r => {
      const out = { ...r };
      for (const col of NUMERIC_COLS) {
        if (col in out) out[col] = Number(out[col]);
      }
      return out;
    });
    res.json({ ok: true, rows: allRows });
  } catch (e) {
    console.error('/api/datos error:', e);
    res.status(500).json({ ok: false, error: String(e.message) });
  }
});

// ============================================================
// VISITS — contador global por país
// ============================================================

// Crea la tabla si no existe (se llama una vez al arrancar)
async function ensureVisitTable() {
  await query(`
    CREATE TABLE IF NOT EXISTS visit_counter (
      country_code  TEXT PRIMARY KEY,
      country_name  TEXT NOT NULL,
      visit_count   INT  NOT NULL DEFAULT 1
    )
  `);
}
ensureVisitTable().catch(e => console.warn('ensureVisitTable:', e.message));

// POST /api/visits  — registra una visita con país
app.post('/api/visits', async (req, res) => {
  try {
    const { country_code = '??', country_name = 'Unknown' } = req.body || {};
    await query(
      `INSERT INTO visit_counter (country_code, country_name, visit_count)
       VALUES ($1, $2, 1)
       ON CONFLICT (country_code) DO UPDATE SET
         visit_count  = visit_counter.visit_count + 1,
         country_name = EXCLUDED.country_name`,
      [country_code.slice(0, 4), country_name.slice(0, 80)]
    );
    res.json({ ok: true });
  } catch (e) {
    console.error('/api/visits POST error:', e);
    res.status(500).json({ ok: false, error: String(e.message) });
  }
});

// GET /api/visits  — total global + desglose por país
app.get('/api/visits', async (req, res) => {
  try {
    const rows = await query(
      'SELECT country_code, country_name, visit_count::int FROM visit_counter ORDER BY visit_count DESC'
    );
    const total = rows.reduce((s, r) => s + Number(r.visit_count), 0);
    res.json({ ok: true, total, byCountry: rows });
  } catch (e) {
    console.error('/api/visits GET error:', e);
    res.status(500).json({ ok: false, error: String(e.message) });
  }
});

// ============================================================
// ERROR HANDLER — returns JSON instead of Express's default HTML
// ============================================================
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  console.error('[express error]', err.message, err.stack);
  res.status(err.status || 500).json({ ok: false, error: err.message || 'Internal server error' });
});

// ============================================================
// START — solo cuando se ejecuta directamente (local/Render)
// En Vercel, el módulo se importa desde api/index.js y no escucha
// ============================================================
if (require.main === module) {
  const PORT = process.env.PORT || 3000;
  app.listen(PORT, () => console.log(`API running on port ${PORT} — db: CockroachDB v2`));
}

module.exports = app;
