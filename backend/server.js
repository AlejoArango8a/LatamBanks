const express = require('express');
const cors    = require('cors');
const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');
require('dotenv').config();

// Registro único de países (fuente de verdad compartida con el frontend y los loaders).
const REGISTRY = require('../paises.json');
// ISO de países en producción (los únicos que la API sirve hoy).
const LIVE_ISOS = new Set(
  Object.values(REGISTRY.paises).filter((p) => p.status === 'live').map((p) => p.iso),
);
const DEFAULT_ISO = REGISTRY.paises[REGISTRY.default].iso;

/** Annual franchise seed for BTG Pactual Europe S.A. (no monthly CSSF dump). */
function loadBtgEuropeSeed() {
  const p = path.join(__dirname, '..', 'data', 'btg_europe_luxembourg.json');
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

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

        // Filter here (same branch as the fetch). A trailing `else if (US)` after
        // the BR block is unreachable once this US branch has already matched.
        // Drop ghost/acquired CERTs with no equity in the latest quarter.
        if (patrimonioRows.length) {
          const allowedCodes = new Set(patrimonioRows.map(r => r.ins_cod));
          instituciones.splice(
            0,
            instituciones.length,
            ...instituciones.filter(i => allowedCodes.has(i.codigo)),
          );
        }
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
// GET /api/americas/snapshot — top banks per live country, common KPIs
// Latest period per jurisdiction; amounts in local reporting units.
// Client converts to USD via FX. Common metrics: assets, loans, equity,
// deposits, net_income.
// ============================================================
const BR_AMERICAS_EXCLUDE = new Set([
  1000081847, 1000081665, 1000086581, 1000084686, 1000081184, 1000086158, 1000084710,
]);

/** Canonical balance metrics available for every live LatamBanks country. */
const AMERICAS_SPECS = {
  CL: {
    key: 'chile',
    equityTipo: 'b1',
    equityCuentas: ['300000000'],
    metrics: {
      assets: { tipo: 'b1', cuentas: ['100000000'] },
      loans: { tipo: 'b1', cuentas: ['500000000'] },
      equity: { tipo: 'b1', cuentas: ['300000000'] },
      deposits: { tipo: 'b1', cuentas: ['241000000', '242000000'] },
      net_income: { tipo: 'r1', cuentas: ['590000000'] },
    },
  },
  CO: {
    key: 'colombia',
    equityTipo: 'b1',
    equityCuentas: ['300000'],
    metrics: {
      assets: { tipo: 'b1', cuentas: ['100000'] },
      loans: { tipo: 'b1', cuentas: ['140000'] },
      equity: { tipo: 'b1', cuentas: ['300000'] },
      deposits: { tipo: 'b1', cuentas: ['210500', '210700'] },
      net_income: { tipo: 'r1', cuentas: ['590000'] },
    },
  },
  BR: {
    key: 'brasil',
    equityTipo: 'p',
    equityCuentas: ['78186', '140246'],
    metrics: {
      assets: { tipo: 'p', cuentas: ['78182', '140220'] },
      loans: { tipo: 'p', cuentas: ['78183', '141873'] },
      equity: { tipo: 'p', cuentas: ['78186', '140246'] },
      deposits: { tipo: 'p', cuentas: ['78185', '140239'] },
      net_income: { tipo: 'p', cuentas: ['78187', '141870'] },
    },
  },
  PE: {
    key: 'peru',
    equityTipo: 'b1',
    equityCuentas: ['PATRIMONIO'],
    metrics: {
      assets: { tipo: 'b1', cuentas: ['TOTAL_ACTIVO'] },
      loans: { tipo: 'b1', cuentas: ['CREDITOS_NETOS'] },
      equity: { tipo: 'b1', cuentas: ['PATRIMONIO'] },
      deposits: { tipo: 'b1', cuentas: ['OBLIGACIONES_PUBLICO'] },
      net_income: { tipo: 'r1', cuentas: ['RESULTADO_NETO'] },
    },
  },
  UY: {
    key: 'uruguay',
    equityTipo: 'b1',
    equityCuentas: ['3'],
    metrics: {
      assets: { tipo: 'b1', cuentas: ['1'] },
      loans: { tipo: 'b1', cuentas: ['1.4.1', '1.4.2', '1.4.3'] },
      equity: { tipo: 'b1', cuentas: ['3'] },
      deposits: { tipo: 'b1', cuentas: ['2.1.2', '2.1.3', '2.1.4'] },
      net_income: { tipo: 'r1', cuentas: ['R_EJERCICIO'] },
    },
  },
  US: {
    key: 'usa',
    equityTipo: 'b1',
    equityCuentas: ['EQTOT'],
    metrics: {
      assets: { tipo: 'b1', cuentas: ['ASSET'] },
      loans: { tipo: 'b1', cuentas: ['LNLS'] },
      equity: { tipo: 'b1', cuentas: ['EQTOT'] },
      deposits: { tipo: 'b1', cuentas: ['DEP'] },
      net_income: { tipo: 'r1', cuentas: ['NETINC'] },
    },
  },
  AR: {
    key: 'argentina',
    equityTipo: 'b1',
    equityCuentas: ['PATRIMONIO_NETO'],
    metrics: {
      assets: { tipo: 'b1', cuentas: ['TOTAL_ACTIVO'] },
      loans: { tipo: 'b1', cuentas: ['PRESTAMOS'] },
      equity: { tipo: 'b1', cuentas: ['PATRIMONIO_NETO'] },
      deposits: { tipo: 'b1', cuentas: ['DEPOSITOS'] },
      net_income: { tipo: 'r1', cuentas: ['RESULTADO_NETO'] },
    },
  },
  MX: {
    key: 'mexico',
    equityTipo: 'b1',
    equityCuentas: ['CAPITAL_CONTABLE'],
    metrics: {
      assets: { tipo: 'b1', cuentas: ['TOTAL_ACTIVO'] },
      loans: { tipo: 'b1', cuentas: ['CARTERA_TOTAL'] },
      equity: { tipo: 'b1', cuentas: ['CAPITAL_CONTABLE'] },
      deposits: { tipo: 'b1', cuentas: ['CAPTACION_TOTAL'] },
      net_income: { tipo: 'r1', cuentas: ['RESULTADO_NETO'] },
    },
  },
  PA: {
    key: 'panama',
    equityTipo: 'b1',
    equityCuentas: ['PATRIMONIO'],
    metrics: {
      assets: { tipo: 'b1', cuentas: ['TOTAL_ACTIVO'] },
      loans: { tipo: 'b1', cuentas: ['CARTERA_CREDITICIA'] },
      equity: { tipo: 'b1', cuentas: ['PATRIMONIO'] },
      deposits: { tipo: 'b1', cuentas: ['DEPOSITOS'] },
      net_income: { tipo: 'r1', cuentas: ['RESULTADO_NETO'] },
    },
  },
};

async function americasSnapshotForCountry(iso, topN) {
  const meta = REGISTRY.paises[AMERICAS_SPECS[iso]?.key];
  const spec = AMERICAS_SPECS[iso];
  if (!meta || !spec || meta.status !== 'live') return null;

  const periodRows = await query(
    `SELECT DISTINCT periodo FROM datos_financieros WHERE country = $1 ORDER BY periodo ASC`,
    [iso],
  );
  if (!periodRows.length) {
    return {
      iso,
      key: meta.key,
      name: meta.name,
      currency: meta.currency,
      period: null,
      banks: [],
      error: 'No periods loaded',
    };
  }
  const period = periodRows[periodRows.length - 1].periodo;

  let equityRows = await query(
    `SELECT ins_cod::int AS ins_cod, SUM(monto_total::bigint) AS equity
     FROM datos_financieros
     WHERE country = $1 AND tipo = $2 AND cuenta = ANY($3) AND periodo = $4
       AND ins_cod <> 999
     GROUP BY ins_cod
     ORDER BY equity DESC NULLS LAST
     LIMIT $5`,
    [iso, spec.equityTipo, spec.equityCuentas, period, topN * (iso === 'BR' ? 3 : 1)],
  );

  if (iso === 'BR') {
    equityRows = equityRows
      .filter((r) => !BR_AMERICAS_EXCLUDE.has(Number(r.ins_cod)))
      .slice(0, topN);
  } else {
    equityRows = equityRows.slice(0, topN);
  }

  const codes = equityRows.map((r) => Number(r.ins_cod)).filter((n) => Number.isFinite(n));
  if (!codes.length) {
    return {
      iso,
      key: meta.key,
      name: meta.name,
      currency: meta.currency,
      period,
      banks: [],
    };
  }

  const nameRows = await query(
    `SELECT codigo::int AS codigo, razon_social FROM instituciones
     WHERE country = $1 AND codigo = ANY($2::int[])`,
    [iso, codes],
  );
  const nameMap = Object.fromEntries(nameRows.map((r) => [Number(r.codigo), r.razon_social]));

  // Flatten all (tipo, cuenta) pairs for one query
  const metricKeys = Object.keys(spec.metrics);
  const tipoCuenta = [];
  for (const mk of metricKeys) {
    const m = spec.metrics[mk];
    for (const c of m.cuentas) tipoCuenta.push({ tipo: m.tipo, cuenta: c, metric: mk });
  }
  const tipos = [...new Set(tipoCuenta.map((x) => x.tipo))];
  const cuentas = [...new Set(tipoCuenta.map((x) => x.cuenta))];

  const dataRows = await query(
    `SELECT ins_cod::int AS ins_cod, tipo, cuenta, SUM(monto_total::bigint) AS monto_total
     FROM datos_financieros
     WHERE country = $1 AND periodo = $2 AND tipo = ANY($3) AND cuenta = ANY($4)
       AND ins_cod = ANY($5::int[])
     GROUP BY ins_cod, tipo, cuenta`,
    [iso, period, tipos, cuentas, codes],
  );

  const byBank = new Map();
  for (const code of codes) {
    byBank.set(code, {
      code,
      name: nameMap[code] || `Bank ${code}`,
      metrics: Object.fromEntries(metricKeys.map((k) => [k, 0])),
    });
  }
  for (const row of dataRows) {
    const bank = byBank.get(Number(row.ins_cod));
    if (!bank) continue;
    for (const tc of tipoCuenta) {
      if (tc.tipo === row.tipo && tc.cuenta === row.cuenta) {
        bank.metrics[tc.metric] += Number(row.monto_total) || 0;
      }
    }
  }

  const banks = codes
    .map((c) => byBank.get(c))
    .filter(Boolean)
    .sort((a, b) => (b.metrics.equity || 0) - (a.metrics.equity || 0));

  return {
    iso,
    key: meta.key,
    name: meta.name,
    currency: meta.currency,
    period,
    banks,
  };
}

app.get('/api/americas/snapshot', async (req, res) => {
  try {
    const topN = Math.max(5, Math.min(40, parseInt(String(req.query.top || '15'), 10) || 15));
    const isos = Object.keys(AMERICAS_SPECS).filter((iso) => {
      const key = AMERICAS_SPECS[iso].key;
      return REGISTRY.paises[key]?.status === 'live' && LIVE_ISOS.has(iso);
    });

    // Parallel per-country (pool max=2 → still OK; keep concurrency modest)
    const countries = [];
    for (const iso of isos) {
      try {
        // sequential batches of 2 to respect pool size
        countries.push(await americasSnapshotForCountry(iso, topN));
      } catch (e) {
        const meta = REGISTRY.paises[AMERICAS_SPECS[iso].key];
        countries.push({
          iso,
          key: meta?.key,
          name: meta?.name || iso,
          currency: meta?.currency || '',
          period: null,
          banks: [],
          error: String(e.message || e),
        });
      }
    }

    res.json({
      ok: true,
      top: topN,
      metrics: [
        { key: 'equity', label: 'Equity' },
        { key: 'assets', label: 'Total assets' },
        { key: 'loans', label: 'Loans' },
        { key: 'deposits', label: 'Deposits / funding' },
        { key: 'net_income', label: 'Net income' },
      ],
      notes: [
        'Each country uses its latest loaded supervisory period (may differ across jurisdictions).',
        'Amounts are returned in local reporting currency; convert to USD on the client.',
        'Deposit definitions vary (e.g. Brazil captações, Mexico captación total).',
        'Net income is typically YTD and is not annualized across countries.',
      ],
      countries: countries.filter(Boolean),
    });
  } catch (e) {
    console.error('/api/americas/snapshot error:', e);
    res.status(500).json({ ok: false, error: String(e.message) });
  }
});

// ============================================================
// GET /api/btg-banks/snapshot — fixed BTG franchise set across countries
// Brasil / Chile / Colombia / Uruguay / USA / Luxembourg (annual seed).
// Amounts in local reporting units; client converts to USD.
// ============================================================
const BTG_BANKS = [
  { iso: 'BR', code: 1000080336, shortName: 'BTG Pactual', countryLabel: 'Brazil' },
  { iso: 'CL', code: 59, shortName: 'BTG Pactual Chile', countryLabel: 'Chile' },
  { iso: 'US', code: 35154, shortName: 'BTG Pactual Bank', countryLabel: 'United States' },
  { iso: 'CO', code: 66, shortName: 'BTG Pactual Colombia', countryLabel: 'Colombia' },
  { iso: 'UY', code: 157, shortName: 'BTG Pactual Uruguay', countryLabel: 'Uruguay' },
  { iso: 'LU', code: 79983, shortName: 'BTG Pactual Europe', countryLabel: 'Luxembourg' },
];

/** Extended common KPIs — only metrics comparable across the full franchise set. */
const BTG_METRIC_SPECS = {
  CL: {
    key: 'chile',
    metrics: {
      assets: { tipo: 'b1', cuentas: ['100000000'] },
      loans: { tipo: 'b1', cuentas: ['500000000'] },
      equity: { tipo: 'b1', cuentas: ['300000000'] },
      liabilities: { tipo: 'b1', cuentas: ['200000000'] },
      // Vista + plazo = total customer deposits (comparable across franchise)
      total_deposits: { tipo: 'b1', cuentas: ['241000000', '242000000'] },
      net_income: { tipo: 'r1', cuentas: ['590000000'] },
    },
  },
  CO: {
    key: 'colombia',
    metrics: {
      assets: { tipo: 'b1', cuentas: ['100000'] },
      loans: { tipo: 'b1', cuentas: ['140000'] },
      equity: { tipo: 'b1', cuentas: ['300000'] },
      liabilities: { tipo: 'b1', cuentas: ['200000'] },
      // Cuenta corriente + CDTs
      total_deposits: { tipo: 'b1', cuentas: ['210500', '210700'] },
      net_income: { tipo: 'r1', cuentas: ['590000'] },
    },
  },
  BR: {
    key: 'brasil',
    metrics: {
      assets: { tipo: 'p', cuentas: ['78182', '140220'] },
      loans: { tipo: 'p', cuentas: ['78183', '141873'] },
      equity: { tipo: 'p', cuentas: ['78186', '140246'] },
      liabilities: { tipo: 'p', cuentas: ['78184', '140244'] },
      // Cosif Depósitos (140228); old Relatorio uses 78185 Captações as fallback era
      total_deposits: { tipo: 'p', cuentas: ['78185', '140228'] },
      net_income: { tipo: 'p', cuentas: ['78187', '141870'] },
    },
  },
  UY: {
    key: 'uruguay',
    metrics: {
      assets: { tipo: 'b1', cuentas: ['1'] },
      loans: { tipo: 'b1', cuentas: ['1.4.1', '1.4.2', '1.4.3'] },
      equity: { tipo: 'b1', cuentas: ['3'] },
      liabilities: { tipo: 'b1', cuentas: ['2'] },
      // Deposits by sector (BCU Situación Patrimonial has no vista/plazo split)
      total_deposits: { tipo: 'b1', cuentas: ['2.1.2', '2.1.3', '2.1.4'] },
      net_income: { tipo: 'r1', cuentas: ['R_EJERCICIO'] },
    },
  },
  US: {
    key: 'usa',
    metrics: {
      assets: { tipo: 'b1', cuentas: ['ASSET'] },
      loans: { tipo: 'b1', cuentas: ['LNLS'] },
      equity: { tipo: 'b1', cuentas: ['EQTOT'] },
      liabilities: { tipo: 'b1', cuentas: ['LIAB'] },
      total_deposits: { tipo: 'b1', cuentas: ['DEP'] },
      net_income: { tipo: 'r1', cuentas: ['NETINC'] },
    },
  },
};

function btgEuropeSnapshot(entry) {
  const seed = loadBtgEuropeSeed();
  const meta = REGISTRY.paises.luxembourg || {};
  return {
    iso: entry.iso,
    key: meta.key || 'luxembourg',
    countryLabel: entry.countryLabel,
    shortName: entry.shortName,
    code: entry.code,
    currency: seed.currency || meta.currency || 'EUR',
    period: seed.period,
    name: seed.legalName || entry.shortName,
    metrics: { ...(seed.metrics || {}) },
    extras: seed.extras || {},
    source: 'manual_seed',
    frequency: seed.frequency || 'annual',
    notes: seed.notes || [],
  };
}

async function btgBankSnapshot(entry) {
  if (entry.iso === 'LU') return btgEuropeSnapshot(entry);

  const spec = BTG_METRIC_SPECS[entry.iso];
  const meta = REGISTRY.paises[spec?.key];
  if (!spec || !meta) {
    return {
      ...entry,
      currency: null,
      period: null,
      name: entry.shortName,
      metrics: {},
      error: 'Unknown country spec',
    };
  }

  const periodRows = await query(
    `SELECT DISTINCT periodo FROM datos_financieros WHERE country = $1 ORDER BY periodo ASC`,
    [entry.iso],
  );
  if (!periodRows.length) {
    return {
      iso: entry.iso,
      key: meta.key,
      countryLabel: entry.countryLabel,
      shortName: entry.shortName,
      code: entry.code,
      currency: meta.currency,
      period: null,
      name: entry.shortName,
      metrics: {},
      error: 'No periods loaded',
    };
  }
  const period = periodRows[periodRows.length - 1].periodo;

  const nameRows = await query(
    `SELECT codigo::int AS codigo, razon_social FROM instituciones
     WHERE country = $1 AND codigo = $2`,
    [entry.iso, entry.code],
  );
  const name = nameRows[0]?.razon_social || entry.shortName;

  const metricKeys = Object.keys(spec.metrics);
  const tipoCuenta = [];
  for (const mk of metricKeys) {
    const m = spec.metrics[mk];
    for (const c of m.cuentas || []) tipoCuenta.push({ tipo: m.tipo, cuenta: c, metric: mk });
  }
  const tipos = [...new Set(tipoCuenta.map((x) => x.tipo))];
  const cuentas = [...new Set(tipoCuenta.map((x) => x.cuenta))];

  const metrics = Object.fromEntries(metricKeys.map((k) => [k, null]));
  if (tipos.length && cuentas.length) {
    const dataRows = await query(
      `SELECT tipo, cuenta, SUM(monto_total::bigint) AS monto_total
       FROM datos_financieros
       WHERE country = $1 AND periodo = $2 AND tipo = ANY($3) AND cuenta = ANY($4)
         AND ins_cod = $5
       GROUP BY tipo, cuenta`,
      [entry.iso, period, tipos, cuentas, entry.code],
    );
    for (const mk of metricKeys) {
      if (!(spec.metrics[mk].cuentas || []).length) {
        metrics[mk] = null;
        continue;
      }
      let sum = 0;
      let hit = false;
      for (const row of dataRows) {
        for (const tc of tipoCuenta) {
          if (tc.metric === mk && tc.tipo === row.tipo && tc.cuenta === row.cuenta) {
            sum += Number(row.monto_total) || 0;
            hit = true;
          }
        }
      }
      metrics[mk] = hit ? sum : null;
    }
  }

  return {
    iso: entry.iso,
    key: meta.key,
    countryLabel: entry.countryLabel,
    shortName: entry.shortName,
    code: entry.code,
    currency: meta.currency,
    period,
    name,
    metrics,
  };
}

app.get('/api/btg-banks/snapshot', async (req, res) => {
  try {
    const banks = [];
    for (const entry of BTG_BANKS) {
      try {
        banks.push(await btgBankSnapshot(entry));
      } catch (e) {
        banks.push({
          ...entry,
          key: BTG_METRIC_SPECS[entry.iso]?.key,
          currency: REGISTRY.paises[BTG_METRIC_SPECS[entry.iso]?.key]?.currency || null,
          period: null,
          name: entry.shortName,
          metrics: {},
          error: String(e.message || e),
        });
      }
    }
    res.json({
      ok: true,
      metrics: [
        { key: 'equity', label: 'Equity' },
        { key: 'assets', label: 'Total Assets' },
        { key: 'net_income', label: 'Net Income' },
        { key: 'loans', label: 'Total Loans' },
        { key: 'liabilities', label: 'Total Liabilities' },
        { key: 'total_deposits', label: 'Total Deposits' },
        { key: 'loans_equity', label: 'Loans / Equity' },
        { key: 'roe', label: 'Annual ROE' },
      ],
      notes: [
        'Franchise set: BTG Brazil, Chile, USA, Colombia, Uruguay, Luxembourg (Europe).',
        'LatAm / US rows use each country latest loaded supervisory period (may differ).',
        'Luxembourg is an annual seed (latest: YE2025 IFRS). Balance sheet + own funds from btgpactual.eu/downloads (annual accounts + Pillar 3). Public cadence is annual — not a monthly CSSF open feed.',
        'Amounts are local reporting units; the BTG Banks sheet converts to USD on the client.',
        'Only KPIs available across the franchise set are shown as columns (Time Deposits / Bonds removed — not published uniformly).',
        'Total Deposits: CL vista+plazo, CO corriente+CDTs, BR Cosif Depósitos, UY sector deposits, US DEP.',
        'Annual ROE approximates YTD net income x (12 / period month) / equity (Bank Monitor convention).',
      ],
      banks,
    });
  } catch (e) {
    console.error('/api/btg-banks/snapshot error:', e);
    res.status(500).json({ ok: false, error: String(e.message) });
  }
});

// ============================================================
// GET /api/bank-profile?country=BR&codigo=1000080329
// Curated profile from bank_profiles + live assets/equity + avg ROE 3y
// from datos_financieros (year-end Dec periods).
// ============================================================
function isYearEndPeriod(periodo) {
  const p = String(periodo || '');
  return p.length >= 6 && p.slice(-2) === '12';
}

function yearFromPeriod(periodo) {
  return String(periodo || '').slice(0, 4);
}

async function sumMetricForPeriod(iso, codigo, period, metricSpec) {
  if (!metricSpec?.cuentas?.length) return 0;
  const rows = await query(
    `SELECT COALESCE(SUM(monto_total::bigint), 0)::bigint AS monto
     FROM datos_financieros
     WHERE country = $1 AND ins_cod = $2 AND periodo = $3
       AND tipo = $4 AND cuenta = ANY($5)`,
    [iso, codigo, period, metricSpec.tipo, metricSpec.cuentas],
  );
  return Number(rows[0]?.monto) || 0;
}

async function liveBankMetrics(iso, codigo) {
  const spec = AMERICAS_SPECS[iso];
  if (!spec) return null;

  const periodRows = await query(
    `SELECT DISTINCT periodo FROM datos_financieros
     WHERE country = $1 AND ins_cod = $2
     ORDER BY periodo ASC`,
    [iso, codigo],
  );
  const periods = periodRows.map((r) => r.periodo);
  if (!periods.length) {
    return {
      period: null,
      assets: null,
      equity: null,
      net_income: null,
      roe_avg_3y: null,
      roe_years: [],
      currency: REGISTRY.paises[spec.key]?.currency || null,
    };
  }

  const latest = periods[periods.length - 1];
  const assets = await sumMetricForPeriod(iso, codigo, latest, spec.metrics.assets);
  const equity = await sumMetricForPeriod(iso, codigo, latest, spec.metrics.equity);
  const netIncome = await sumMetricForPeriod(iso, codigo, latest, spec.metrics.net_income);

  const yearEnds = periods.filter(isYearEndPeriod).reverse(); // newest first
  const roeYears = [];
  for (const ye of yearEnds) {
    if (roeYears.length >= 3) break;
    const eq = await sumMetricForPeriod(iso, codigo, ye, spec.metrics.equity);
    const ni = await sumMetricForPeriod(iso, codigo, ye, spec.metrics.net_income);
    if (!eq || !Number.isFinite(eq) || !Number.isFinite(ni)) continue;
    const roe = (ni / eq) * 100;
    if (!Number.isFinite(roe)) continue;
    roeYears.push({
      year: yearFromPeriod(ye),
      period: ye,
      equity: eq,
      net_income: ni,
      roe,
    });
  }

  let roeAvg = null;
  if (roeYears.length) {
    roeAvg = roeYears.reduce((s, y) => s + y.roe, 0) / roeYears.length;
  }

  return {
    period: latest,
    assets: assets || null,
    equity: equity || null,
    net_income: netIncome || null,
    roe_avg_3y: roeAvg,
    roe_years: roeYears,
    currency: REGISTRY.paises[spec.key]?.currency || null,
    note: 'ROE uses year-end (December) supervisory figures: net income / equity for each year, then simple average of up to the last 3 available years. Brazil uses IF.data prudential consolidado.',
  };
}

app.get('/api/bank-profile', async (req, res) => {
  try {
    const country = resolveDatasetCountry(req.query.country);
    const codigo = parseInt(String(req.query.codigo ?? ''), 10);
    if (!Number.isFinite(codigo)) {
      return res.status(400).json({ ok: false, error: 'codigo required' });
    }

    const profileRows = await query(
      `SELECT country, codigo, short_name, legal_name, founded, ownership, controlling,
              shareholders, origin_country, origin_country_name, employees_in_country,
              employees_as_of, business_focus, hq_city, history, context, website, ir_url,
              ratings, news, sources, updated_at
       FROM bank_profiles
       WHERE country = $1 AND codigo = $2`,
      [country, codigo],
    );
    const profile = profileRows[0] || null;

    let instName = null;
    try {
      const inst = await query(
        `SELECT razon_social FROM instituciones WHERE country = $1 AND codigo = $2`,
        [country, codigo],
      );
      instName = inst[0]?.razon_social || null;
    } catch (_) { /* non-fatal */ }

    const metrics = await liveBankMetrics(country, codigo);

    res.json({
      ok: true,
      country,
      codigo,
      institution_name: instName,
      curated: !!profile,
      profile,
      metrics,
    });
  } catch (e) {
    console.error('/api/bank-profile error:', e);
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
