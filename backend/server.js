const express = require('express');
const cors    = require('cors');
const { Pool } = require('pg');
require('dotenv').config();

// Registro único de países (fuente de verdad compartida con el frontend y los loaders).
const REGISTRY = require('../paises.json');
// ISO de países en producción (los únicos que la API sirve hoy).
const LIVE_ISOS = new Set(
  Object.values(REGISTRY.paises).filter((p) => p.status === 'live').map((p) => p.iso),
);
const DEFAULT_ISO = REGISTRY.paises[REGISTRY.default].iso;

const app = express();

// Body parser — handle both Vercel pre-parsed and raw stream bodies
app.use((req, res, next) => {
  if (req.body !== undefined) return next(); // already parsed by Vercel runtime
  express.json({ limit: '2mb' })(req, res, next);
});
app.use(express.urlencoded({ extended: false }));

// ============================================================
// CORS — cerrado por defecto; abre solo los orígenes en FRONTEND_URLS.
// Para pruebas locales: CORS_OPEN=1 (nunca dejar activo en producción).
// ============================================================
const useOpenCors = (process.env.CORS_OPEN || '0') !== '0';
if (useOpenCors) {
  app.use(cors({ origin: true, maxAge: 3600 }));
} else {
  const DEFAULT_FRONTEND = 'https://latambanks.vercel.app,https://latam-banks.vercel.app,https://latambanks.co,https://www.latambanks.co';
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

/**
 * Normaliza el país recibido al ISO de un país en producción (ver paises.json).
 * Cualquier valor desconocido cae al país por defecto (hoy CL), igual que antes.
 */
function resolveDatasetCountry(input) {
  const s = String(input ?? DEFAULT_ISO).toUpperCase().trim();
  return LIVE_ISOS.has(s) ? s : DEFAULT_ISO;
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
        // 'alerta_esquema' también trae datos cargados (Tarea A): solo marca un
        // cambio de estructura, no un fallo. Se incluye para no ocultar el período.
        "SELECT periodo FROM carga_log WHERE estado IN ('ok', 'alerta_esquema') AND country = $1 ORDER BY periodo ASC",
        [country],
      ),
      query(
        // BR (rebuild IF.data prudencial): se carga el universo completo
        // (~1.366 entidades). El recorte a un ranking manejable se hace por el
        // piso de Patrimônio Líquido de más abajo, no por es_banco (que el
        // nuevo loader ya no setea). CL/CO no se ven afectados.
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
            : country === 'UY'
              ? 'Sin períodos cargados para Uruguay (UY). Ejecuta uruguay_loader.py (Boletín SSF BCU).'
              : country === 'PE'
                ? 'Sin períodos cargados para Perú (PE). Ejecuta peru_loader.py (SBS B-2201).'
                : country === 'US'
                  ? 'Sin períodos cargados para Estados Unidos (US). Ejecuta usa_loader.py (FDIC top-300).'
                : country === 'AR'
                  ? 'Sin períodos cargados para Argentina (AR). Ejecuta argentina_loader.py (BCRA datos abiertos).'
                : country === 'MX'
                  ? 'Sin períodos cargados para México (MX). Ejecuta mexico_loader.py (CNBV Boletín BM).'
                : country === 'PA'
                  ? 'Sin períodos cargados para Panamá (PA). Ejecuta panama_loader.py (SBP reportes individuales).'
                : country === 'BR'
                  ? 'Sin períodos cargados para Brasil (BR). Ejecuta brasil_loader.py (BCB IF.data).'
                  : country === 'CL'
                    ? 'Sin períodos cargados para Chile (CL). Ejecuta cmf_loader.py.'
                    : 'No hay períodos en la base de datos',
      });
    }

    const lastPeriodo = periodos[periodos.length - 1];
    let patrimonioRows = [];
    try {
      if (country === 'CL') {
        patrimonioRows = await query(
          `SELECT ins_cod::int, SUM(monto_total::bigint) AS monto_total FROM datos_financieros
           WHERE country = $1 AND tipo = 'b1' AND cuenta = '300000000' AND periodo = $2
           GROUP BY ins_cod`,
          [country, lastPeriodo],
        ).then(rows => rows.map(r => ({ ins_cod: Number(r.ins_cod), monto_total: Number(r.monto_total) })));
      } else if (country === 'CO') {
        const eqCuenta = String(process.env.CO_EQUITY_CUENTA || '300000').trim();
        patrimonioRows = await query(
          `SELECT ins_cod::int, SUM(monto_total::bigint) AS monto_total FROM datos_financieros
           WHERE country = $1 AND tipo = 'b1' AND cuenta = $2 AND periodo = $3
           GROUP BY ins_cod`,
          [country, eqCuenta, lastPeriodo],
        ).then(rows => rows.map(r => ({ ins_cod: Number(r.ins_cod), monto_total: Number(r.monto_total) })));
      } else if (country === 'UY') {
        const eqCuenta = String(process.env.UY_EQUITY_CUENTA || '3').trim();
        patrimonioRows = await query(
          `SELECT ins_cod::int, SUM(monto_total::bigint) AS monto_total FROM datos_financieros
           WHERE country = $1 AND tipo = 'b1' AND cuenta = $2 AND periodo = $3
           GROUP BY ins_cod`,
          [country, eqCuenta, lastPeriodo],
        ).then(rows => rows.map(r => ({ ins_cod: Number(r.ins_cod), monto_total: Number(r.monto_total) })));
      } else if (country === 'PE') {
        const eqCuenta = String(process.env.PE_EQUITY_CUENTA || 'PATRIMONIO').trim();
        patrimonioRows = await query(
          `SELECT ins_cod::int, SUM(monto_total::bigint) AS monto_total FROM datos_financieros
           WHERE country = $1 AND tipo = 'b1' AND cuenta = $2 AND periodo = $3
           GROUP BY ins_cod`,
          [country, eqCuenta, lastPeriodo],
        ).then(rows => rows.map(r => ({ ins_cod: Number(r.ins_cod), monto_total: Number(r.monto_total) })));
      } else if (country === 'US') {
        const eqCuenta = String(process.env.US_EQUITY_CUENTA || 'EQTOT').trim();
        patrimonioRows = await query(
          `SELECT ins_cod::int, SUM(monto_total::bigint) AS monto_total FROM datos_financieros
           WHERE country = $1 AND tipo = 'b1' AND cuenta = $2 AND periodo = $3
           GROUP BY ins_cod`,
          [country, eqCuenta, lastPeriodo],
        ).then(rows => rows.map(r => ({ ins_cod: Number(r.ins_cod), monto_total: Number(r.monto_total) })));
      } else if (country === 'AR') {
        const eqCuenta = String(process.env.AR_EQUITY_CUENTA || 'PATRIMONIO_NETO').trim();
        patrimonioRows = await query(
          `SELECT ins_cod::int, SUM(monto_total::bigint) AS monto_total FROM datos_financieros
           WHERE country = $1 AND tipo = 'b1' AND cuenta = $2 AND periodo = $3
           GROUP BY ins_cod`,
          [country, eqCuenta, lastPeriodo],
        ).then(rows => rows.map(r => ({ ins_cod: Number(r.ins_cod), monto_total: Number(r.monto_total) })));
      } else if (country === 'MX') {
        const eqCuenta = String(process.env.MX_EQUITY_CUENTA || 'CAPITAL_CONTABLE').trim();
        patrimonioRows = await query(
          `SELECT ins_cod::int, SUM(monto_total::bigint) AS monto_total FROM datos_financieros
           WHERE country = $1 AND tipo = 'b1' AND cuenta = $2 AND periodo = $3
           GROUP BY ins_cod`,
          [country, eqCuenta, lastPeriodo],
        ).then(rows => rows.map(r => ({ ins_cod: Number(r.ins_cod), monto_total: Number(r.monto_total) })));
      } else if (country === 'PA') {
        const eqCuenta = String(process.env.PA_EQUITY_CUENTA || 'PATRIMONIO').trim();
        patrimonioRows = await query(
          `SELECT ins_cod::int, SUM(monto_total::bigint) AS monto_total FROM datos_financieros
           WHERE country = $1 AND tipo = 'b1' AND cuenta = $2 AND periodo = $3
           GROUP BY ins_cod`,
          [country, eqCuenta, lastPeriodo],
        ).then(rows => rows.map(r => ({ ins_cod: Number(r.ins_cod), monto_total: Number(r.monto_total) })));
      } else if (country === 'BR') {
        // Patrimônio Líquido. El rebuild IF.data guarda todo con tipo='p' y
        // usa el código nuevo Cosif 140246 (se mantiene 78186 por compat. con
        // datos viejos si los hubiera). Ya no se filtra por es_banco: el
        // universo completo se recorta por el piso de patrimônio de abajo.
        patrimonioRows = await query(
          `SELECT ins_cod::int, SUM(monto_total::bigint) AS monto_total FROM datos_financieros
           WHERE country = $1 AND tipo = 'p' AND cuenta = ANY($2) AND periodo = $3
           GROUP BY ins_cod`,
          [country, ['78186', '140246'], lastPeriodo],
        ).then(rows => rows.map(r => ({ ins_cod: Number(r.ins_cod), monto_total: Number(r.monto_total) })));

        // Instituciones que nunca se muestran en el dashboard BR aunque tengan
        // datos de PL: IPs (pagos), banco de desarrollo BNDES, y entidades
        // clasificadas como bancos pero sin relevancia para el ranking comercial.
        const BR_EXCLUDE = new Set([
          1000081847, // BNDES
          1000081665, // BCO CLASSICO
          1000086581, // CLOUDWALK IP
          1000084686, // STONE IP
          1000081184, // APE POUPEX
          1000086158, // SEM PARAR IP
          1000084710, // CIELO IP
        ]);

        // La base guarda el universo prudencial completo. El dashboard muestra
        // todos los bancos con patrimonio, excluyendo solo IPs / entidades
        // no relevantes para la comparativa bancaria comercial (sin tope TOP-N).
        const allowedCodes = new Set(
          [...patrimonioRows]
            .filter(r => !BR_EXCLUDE.has(r.ins_cod))
            .map(r => r.ins_cod),
        );
        instituciones.splice(
          0,
          instituciones.length,
          ...instituciones.filter(i => allowedCodes.has(i.codigo)),
        );
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

    // BR (rebuild IF.data): todos los datos se guardan con tipo='p'. El frontend
    // sigue pidiendo 'b1'/'r1' (categorías lógicas por cuenta), así que aquí se
    // colapsan a un único 'p'. Las cuentas del request ya distinguen balance vs
    // resultado, por lo que no hay colisión. CL/CO conservan sus tipos.
    const effectiveTipos = country === 'BR' ? ['p'] : tiposList;

    const NUMERIC_COLS = new Set(['ins_cod','monto_total','monto_clp','monto_uf','monto_tc','monto_ext']);
    const cols = selectCols
      ? selectCols.split(',').map(c => c.trim()).filter(c => ALLOWED_COLS.has(c))
      : ['periodo','ins_cod','cuenta','monto_total','monto_clp','monto_uf','monto_tc','monto_ext'];

    // Castear columnas numéricas para que pg las devuelva como números, no strings
    const selectStr = cols.map(c => NUMERIC_COLS.has(c) ? `${c}::bigint AS ${c}` : c).join(', ');

    const tipoPromises = effectiveTipos.map(t => {
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
// GET /api/diagnostics/account-coverage — plan_cuentas vs datos_financieros
// Query: ?country=CL|CO
// ============================================================
app.get('/api/diagnostics/account-coverage', async (req, res) => {
  try {
    const country = resolveDatasetCountry(req.query.country);

    const [
      planCnt,
      datosCnt,
      orphanCnt,
      deadPlanCnt,
      byTipo,
      planByDigit,
      orphanSample,
      deadSample,
    ] = await Promise.all([
      query(
        'SELECT COUNT(DISTINCT cuenta)::int AS n FROM plan_cuentas WHERE country = $1',
        [country],
      ),
      query(
        'SELECT COUNT(DISTINCT cuenta)::int AS n FROM datos_financieros WHERE country = $1',
        [country],
      ),
      query(
        `SELECT COUNT(DISTINCT d.cuenta)::int AS n
         FROM datos_financieros d
         WHERE d.country = $1
           AND NOT EXISTS (
             SELECT 1 FROM plan_cuentas p
             WHERE p.country = $1 AND p.cuenta = d.cuenta
           )`,
        [country],
      ),
      query(
        `SELECT COUNT(*)::int AS n
         FROM plan_cuentas p
         WHERE p.country = $1
           AND NOT EXISTS (
             SELECT 1 FROM datos_financieros d
             WHERE d.country = $1 AND d.cuenta = p.cuenta
           )`,
        [country],
      ),
      query(
        `SELECT tipo, COUNT(DISTINCT cuenta)::int AS n
         FROM datos_financieros
         WHERE country = $1
         GROUP BY tipo
         ORDER BY tipo`,
        [country],
      ),
      query(
        `SELECT SUBSTRING(cuenta, 1, 1) AS d, COUNT(DISTINCT cuenta)::int AS n
         FROM plan_cuentas
         WHERE country = $1
         GROUP BY 1
         ORDER BY 1`,
        [country],
      ),
      query(
        `SELECT DISTINCT d.cuenta
         FROM datos_financieros d
         WHERE d.country = $1
           AND NOT EXISTS (
             SELECT 1 FROM plan_cuentas p
             WHERE p.country = $1 AND p.cuenta = d.cuenta
           )
         ORDER BY d.cuenta
         LIMIT 40`,
        [country],
      ),
      query(
        `SELECT p.cuenta
         FROM plan_cuentas p
         WHERE p.country = $1
           AND NOT EXISTS (
             SELECT 1 FROM datos_financieros d
             WHERE d.country = $1 AND d.cuenta = p.cuenta
           )
         ORDER BY p.cuenta
         LIMIT 40`,
        [country],
      ),
    ]);

    const byTipoMap = {};
    for (const row of byTipo) byTipoMap[row.tipo] = row.n;

    const planByFirstDigit = {};
    for (const row of planByDigit) planByFirstDigit[row.d] = row.n;

    res.json({
      ok: true,
      country,
      summary: {
        distinctCuentasInPlan:    planCnt[0]?.n ?? 0,
        distinctCuentasInDatos:   datosCnt[0]?.n ?? 0,
        /** Cuentas que aparecen en movimientos pero no están en plan_cuentas */
        datosOrphansNotInPlan:    orphanCnt[0]?.n ?? 0,
        /** Filas de plan sin ningún movimiento en datos_financieros */
        planCuentasNeverInDatos:  deadPlanCnt[0]?.n ?? 0,
      },
      datosDistinctByTipo: byTipoMap,
      planDistinctByFirstDigit: planByFirstDigit,
      samples: {
        datosOrphansNotInPlan: orphanSample.map((r) => r.cuenta),
        planNeverInDatos:      deadSample.map((r) => r.cuenta),
      },
    });
  } catch (e) {
    console.error('/api/diagnostics/account-coverage error:', e);
    res.status(500).json({ ok: false, error: String(e.message) });
  }
});

// ============================================================
// GET /api/schema-alerts — alertas de cambio de esquema por país
// Query: ?country=CL|CO. Lee carga_log.detalle (JSON) donde el loader
// (schema_guard) registró una anomalía. Orden: más reciente primero.
// ============================================================
app.get('/api/schema-alerts', async (req, res) => {
  try {
    const country = resolveDatasetCountry(req.query.country);
    const rows = await query(
      `SELECT periodo, estado, detalle
       FROM carga_log
       WHERE country = $1 AND detalle IS NOT NULL
       ORDER BY periodo DESC`,
      [country],
    );
    res.json({ ok: true, country, alerts: rows });
  } catch (e) {
    console.error('/api/schema-alerts error:', e);
    res.status(500).json({ ok: false, error: String(e.message) });
  }
});

// ============================================================
// GEO (server-side) — evita CORS del navegador a ipapi.co
// ============================================================
app.get('/api/geo', async (req, res) => {
  try {
    const xf = req.headers['x-forwarded-for'];
    const raw = typeof xf === 'string' ? xf.split(',')[0].trim() : '';
    const ip = raw || req.socket?.remoteAddress || '';
    const local = !ip || ip === '::1' || ip === '127.0.0.1' || ip.startsWith('::ffff:127.');
    if (local) {
      return res.json({ ok: true, country_name: 'Unknown', country_code: '??' });
    }
    const geoRes = await fetch(`https://ipapi.co/${encodeURIComponent(ip)}/json/`);
    if (!geoRes.ok) {
      return res.json({ ok: true, country_name: 'Unknown', country_code: '??' });
    }
    const d = await geoRes.json();
    if (d.error) {
      return res.json({ ok: true, country_name: 'Unknown', country_code: '??' });
    }
    res.json({
      ok: true,
      country_name: d.country_name || 'Unknown',
      country_code: (d.country_code || '??').toString().slice(0, 4),
    });
  } catch (e) {
    console.warn('/api/geo:', e.message);
    res.json({ ok: true, country_name: 'Unknown', country_code: '??' });
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
// START — solo cuando se ejecuta directamente (local)
// En Vercel, el módulo se importa desde api/index.js y no escucha
// ============================================================
if (require.main === module) {
  const PORT = process.env.PORT || 3000;
  app.listen(PORT, () => console.log(`API running on port ${PORT} — db: CockroachDB v2`));
}

module.exports = app;
