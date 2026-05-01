// ============================================================
// API — network layer and data-access helpers
// ============================================================
import { API_BASE } from './config.js?v=bmon9';
import { ST, datasetIsoCountry } from './state.js?v=bmon9';

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
  const r = await fetchWithTimeout(
    `${API_BASE}/api/datos`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...params, country: datasetIsoCountry() }),
    },
    15000,
    signal
  );
  const j = await r.json();
  if (r.ok && j.ok && Array.isArray(j.rows)) return j.rows;
  throw new Error(j.error || `API /datos error ${r.status}`);
}

function dataCacheKey(tipo, periodos, bancos, cuentas) {
  const country = datasetIsoCountry();
  return `${country}|${tipo}|${periodos.join(',')}|${[...bancos].sort().join(',')}|${cuentas.join(',')}`;
}

export async function fetchData(tipo, cuentas, periodos, bancos, signal) {
  const key = dataCacheKey(tipo, periodos, bancos, cuentas);
  if (ST.data[key]) {
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
    return ST.data[key];
  }
  const rows = await apiDatos({ tipo, periodos, bancos: [...bancos], cuentas }, signal);
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
