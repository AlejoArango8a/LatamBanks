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

function sleep(ms, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException('Aborted', 'AbortError'));
      return;
    }
    const t = setTimeout(resolve, ms);
    const onAbort = () => {
      clearTimeout(t);
      reject(new DOMException('Aborted', 'AbortError'));
    };
    if (signal) {
      signal.addEventListener('abort', onAbort, { once: true });
    }
  });
}

function datosHttpError(status, apiError) {
  if (status === 401 || status === 403) {
    return new DatosApiError(
      'blocked',
      `Access blocked (${status}) — host rejected the request (VPN, proxy, bot filter, or protected preview).`,
      { status, raw: apiError || `HTTP ${status}` },
    );
  }
  if (status === 504 || status === 502) {
    return new DatosApiError(
      'gateway',
      `API gateway timeout (${status}) — narrow From/To or reduce banks.`,
      { status, raw: apiError || `HTTP ${status}` },
    );
  }
  if (apiError && /not allowed by cors/i.test(String(apiError))) {
    return new DatosApiError(
      'cors',
      'This page origin is not allowed to call the API. Use https://www.latambanks.co',
      { status, raw: apiError },
    );
  }
  return new DatosApiError(
    'http',
    apiError || `API /datos error ${status}`,
    { status, raw: apiError || `HTTP ${status}` },
  );
}

/** Structured API failure — UI maps `.kind` to a clear Spanish popup. */
export class DatosApiError extends Error {
  /**
   * @param {'blocked'|'timeout'|'gateway'|'cors'|'http'|'network'} kind
   * @param {string} message
   * @param {{ status?: number|null, raw?: string }} [meta]
   */
  constructor(kind, message, meta = {}) {
    super(message);
    this.name = 'DatosApiError';
    this.kind = kind;
    this.status = meta.status ?? null;
    this.raw = meta.raw ?? message;
  }
}

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

  const doFetch = () => fetchWithTimeout(
    `${API_BASE}/api/datos`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    },
    DATOS_TIMEOUT_MS,
    signal
  );

  let r;
  try {
    r = await doFetch();
    // Soft WAF / edge challenges sometimes 403 once; one quiet retry usually clears it.
    if (r.status === 403) {
      await sleep(700, signal);
      r = await doFetch();
    }
  } catch (e) {
    if (e?.name === 'AbortError') {
      throw new DatosApiError(
        'timeout',
        `Data request timed out after ${Math.round(DATOS_TIMEOUT_MS / 1000)}s — try a shorter period range or fewer banks.`,
        { status: null, raw: e.message },
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
  throw datosHttpError(r.status, j?.error);
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
