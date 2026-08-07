// ============================================================
// API — network layer and data-access helpers
// ============================================================
import { API_BASE } from './config.js?v=bmon72';
import { ST, datasetIsoCountry } from './state.js?v=bmon72';
import { expandGrupoAvalFetchBanks, mergeGrupoAvalApiRows } from './coGrupoAval.js?v=bmon72';

/** Client budget must stay under Vercel `maxDuration` (30s in vercel.json). */
export const DATOS_TIMEOUT_MS = 28000;
/** Split wide period ranges so each SQL stays under the serverless budget. */
const DATOS_PERIOD_CHUNK = 36;
/** Very wide cuenta lists (e.g. unoptimized matrix) also get period chunking. */
const DATOS_CUENTA_CHUNK_TRIGGER = 250;

export function fetchWithTimeout(url, options = {}, ms, externalSignal) {
  const ctrl = new AbortController();
  const id = setTimeout(() => ctrl.abort(), ms);

  const cleanup = () => clearTimeout(id);

  if (externalSignal) {
    if (externalSignal.aborted) {
      cleanup();
      return Promise.reject(new DOMException('Aborted', 'AbortError'));
    }
    const onParentAbort = () => ctrl.abort();
    externalSignal.addEventListener('abort', onParentAbort);
    return fetch(url, { ...options, signal: ctrl.signal })
      .finally(() => {
        cleanup();
        externalSignal.removeEventListener('abort', onParentAbort);
      });
  }

  return fetch(url, { ...options, signal: ctrl.signal }).finally(cleanup);
}

export async function apiDatos(params, signal) {
  const { fetchBanks, requestedBanks } = expandGrupoAvalFetchBanks(params.bancos);
  const payload = { ...params, country: datasetIsoCountry() };
  if (fetchBanks != null) payload.bancos = fetchBanks;

  let r;
  try {
    r = await fetchWithTimeout(
      `${API_BASE}/api/datos`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      },
      DATOS_TIMEOUT_MS,
      signal
    );
  } catch (e) {
    if (e?.name === 'AbortError') {
      throw new Error(
        `Data request timed out after ${Math.round(DATOS_TIMEOUT_MS / 1000)}s — try a shorter period range or fewer banks.`
      );
    }
    throw e;
  }

  let j = null;
  try {
    j = await r.json();
  } catch (_) {
    j = null;
  }
  if (r.ok && j?.ok && Array.isArray(j.rows)) {
    return mergeGrupoAvalApiRows(j.rows, requestedBanks != null ? requestedBanks : params.bancos);
  }
  if (r.status === 504 || r.status === 502) {
    throw new Error(
      `API gateway timeout (${r.status}) — the query is too heavy for one request. Narrow From/To or reduce bank selection.`
    );
  }
  throw new Error(j?.error || `API /datos error ${r.status}`);
}

function dataCacheKey(tipo, periodos, bancos, cuentas) {
  const country = datasetIsoCountry();
  return `${country}|${tipo}|${periodos.join(',')}|${[...bancos].sort().join(',')}|${cuentas.join(',')}`;
}

function chunkArray(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

/**
 * Fetch financial rows. Wide period ranges are requested in sequential chunks
 * and merged, so a single serverless invocation stays under maxDuration.
 */
export async function fetchData(tipo, cuentas, periodos, bancos, signal) {
  const key = dataCacheKey(tipo, periodos, bancos, cuentas);
  if (ST.data[key]) {
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
    return ST.data[key];
  }

  const needsChunk =
    periodos.length > DATOS_PERIOD_CHUNK
    || (cuentas.length > DATOS_CUENTA_CHUNK_TRIGGER && periodos.length > 18);

  let rows;
  if (!needsChunk) {
    rows = await apiDatos({ tipo, periodos, bancos: [...bancos], cuentas }, signal);
  } else {
    const chunks = chunkArray(periodos, DATOS_PERIOD_CHUNK);
    const parts = [];
    for (const slice of chunks) {
      if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
      // Sequential on purpose: pool max=2 and Vercel duration budget.
      parts.push(await apiDatos({ tipo, periodos: slice, bancos: [...bancos], cuentas }, signal));
    }
    rows = parts.flat();
  }

  if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
  ST.data[key] = rows;
  return rows;
}

export function sumRows(rows, cuenta, periodo) {
  return rows
    .filter(r => r.cuenta === cuenta && (!periodo || r.periodo === periodo))
    .reduce((s, r) => s + (r.monto_total || 0), 0);
}

export function sumB1Cols(rows, cuenta, periodo) {
  const filtered = rows.filter(r => r.cuenta === cuenta && (!periodo || r.periodo === periodo));
  return [
    filtered.reduce((s, r) => s + (r.monto_clp || 0), 0),
    filtered.reduce((s, r) => s + (r.monto_uf  || 0), 0),
    filtered.reduce((s, r) => s + (r.monto_tc  || 0), 0),
    filtered.reduce((s, r) => s + (r.monto_ext || 0), 0),
  ];
}

export function getSeriesForCuenta(rows, cuenta, periodos) {
  return periodos.map(p => sumRows(rows, cuenta, p));
}
