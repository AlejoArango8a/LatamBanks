const express = require('express');
const cors = require('cors');
require('dotenv').config();

const app = express();
app.use(express.json());

// CORS: GitHub Pages y otros frontends necesitan que el servidor devuelva
// Access-Control-Allow-Origin igual al header "Origin" del navegador.
// `origin: true` hace exactamente eso (refleja el origen). Es lo más fiable para evitar errores CORS en esta fase.
// Más adelante puedes restringir con lista fija si lo necesitas.
const useOpenCors = (process.env.CORS_OPEN || '1') !== '0';
if (useOpenCors) {
  app.use(cors({ origin: true }));
} else {
  const DEFAULT_FRONTEND = 'https://alejoarango8a.github.io';
  const origins = (process.env.FRONTEND_URLS || DEFAULT_FRONTEND)
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  function originAllowed(requestOrigin, allowedList) {
    if (!requestOrigin) return true;
    if (allowedList.includes('*')) return true;
    return allowedList.some((entry) => {
      if (entry === '*') return true;
      try {
        return requestOrigin === new URL(entry).origin;
      } catch {
        return requestOrigin === entry;
      }
    });
  }
  app.use(
    cors({
      origin(origin, cb) {
        if (!origin) return cb(null, true);
        if (originAllowed(origin, origins)) return cb(null, origin);
        cb(new Error('Not allowed by CORS'));
      },
    })
  );
}

async function supabaseRest(table, queryParts) {
  const base = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_ANON_KEY;
  if (!base || !key) {
    const err = new Error('Missing SUPABASE_URL or SUPABASE_ANON_KEY');
    err.status = 503;
    throw err;
  }
  const url = `${base.replace(/\/$/, '')}/rest/v1/${table}?${queryParts.join('&')}`;
  const resp = await fetch(url, {
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
      Range: '0-49999',
      Prefer: 'count=none',
    },
  });
  if (!resp.ok) {
    const err = new Error(`Supabase ${resp.status}: ${await resp.text()}`);
    err.status = 502;
    throw err;
  }
  return resp.json();
}

// Paginated version: loops with offset until Supabase returns an empty page
async function supabaseRestAll(table, queryParts, pageSize = 1000) {
  const base = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_ANON_KEY;
  if (!base || !key) {
    const err = new Error('Missing SUPABASE_URL or SUPABASE_ANON_KEY');
    err.status = 503;
    throw err;
  }
  let all = [];
  let offset = 0;
  while (true) {
    const parts = [...queryParts, `limit=${pageSize}`, `offset=${offset}`];
    const url = `${base.replace(/\/$/, '')}/rest/v1/${table}?${parts.join('&')}`;
    const resp = await fetch(url, {
      headers: {
        apikey: key,
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/json',
        Prefer: 'count=none',
      },
    });
    if (!resp.ok) {
      const err = new Error(`Supabase ${resp.status}: ${await resp.text()}`);
      err.status = 502;
      throw err;
    }
    const page = await resp.json();
    if (!page.length) break;
    all = all.concat(page);
    if (page.length < pageSize) break;
    offset += pageSize;
  }
  return all;
}

app.get('/health', (req, res) => {
  res.json({ ok: true, service: 'latambanks-api' });
});

/** Grupo 1: periodos + instituciones + plan_cuentas + patrimonio ranking */
app.get('/api/bootstrap', async (req, res) => {
  try {
    const logs = await supabaseRest('carga_log', [
      'select=periodo',
      'estado=eq.ok',
      'order=periodo.asc',
    ]);
    const periodos = logs.map((r) => r.periodo);
    if (!periodos.length) {
      return res.status(502).json({ ok: false, error: 'No data found in database (no periods)' });
    }

    const instituciones = await supabaseRest('instituciones', [
      'select=codigo,razon_social',
      'order=codigo.asc',
    ]);

    // plan_cuentas: puede tener muchas filas, usamos paginación
    const planCuentas = await supabaseRestAll('plan_cuentas', [
      'select=cuenta,descripcion',
      'order=cuenta.asc',
    ]);

    // Patrimonio (cuenta 300000000) del último periodo, para ranking de bancos
    const lastPeriodo = periodos[periodos.length - 1];
    let patrimonioRows = [];
    try {
      patrimonioRows = await supabaseRest('datos_financieros', [
        'select=ins_cod,monto_total',
        'tipo=eq.b1',
        'cuenta=eq.300000000',
        `periodo=eq.${lastPeriodo}`,
      ]);
    } catch (e) {
      console.warn('patrimonio ranking fetch failed (non-fatal):', e.message);
    }

    res.json({ ok: true, periodos, instituciones, planCuentas, patrimonioRows });
  } catch (e) {
    const status = e.status || 500;
    res.status(status).json({ ok: false, error: String(e.message || e) });
  }
});

/** Grupo 2: datos financieros principales — equivalente a fetchData() en index.html */
app.post('/api/datos', async (req, res) => {
  try {
    const { tipo, periodos, bancos, cuentas } = req.body || {};
    if (
      !tipo ||
      !Array.isArray(periodos) || !periodos.length ||
      !Array.isArray(bancos)   || !bancos.length   ||
      !Array.isArray(cuentas)  || !cuentas.length
    ) {
      return res.status(400).json({ ok: false, error: 'Params requeridos: tipo, periodos[], bancos[], cuentas[]' });
    }

    // Batching interno: Supabase tiene límite de ~50 000 filas por request.
    // Con 50 cuentas × 20 bancos × 6 periodos = 6 000 filas max por batch → seguro.
    const BATCH = 6;
    let allRows = [];
    for (let i = 0; i < periodos.length; i += BATCH) {
      const batch = periodos.slice(i, i + BATCH);
      const rows = await supabaseRest('datos_financieros', [
        'select=periodo,ins_cod,cuenta,monto_total,monto_clp,monto_uf,monto_tc,monto_ext',
        `tipo=eq.${tipo}`,
        `periodo=in.(${batch.join(',')})`,
        `ins_cod=in.(${bancos.join(',')})`,
        `cuenta=in.(${cuentas.join(',')})`,
      ]);
      allRows = allRows.concat(rows);
    }

    res.json({ ok: true, rows: allRows });
  } catch (e) {
    const status = e.status || 500;
    res.status(status).json({ ok: false, error: String(e.message || e) });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`API running on port ${PORT}`);
});
