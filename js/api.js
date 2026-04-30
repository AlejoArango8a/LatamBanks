// ============================================================
// API — network layer and data-access helpers
// ============================================================
import { API_BASE } from './config.js';
import { ST } from './state.js';

export function fetchWithTimeout(url, options, ms) {
  const ctrl = new AbortController();
  const id = setTimeout(() => ctrl.abort(), ms);
  return fetch(url, { ...options, signal: ctrl.signal })
    .finally(() => clearTimeout(id));
}

export async function apiDatos(params) {
  const r = await fetchWithTimeout(`${API_BASE}/api/datos`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  }, 15000);
  const j = await r.json();
  if (r.ok && j.ok && Array.isArray(j.rows)) return j.rows;
  throw new Error(j.error || `API /datos error ${r.status}`);
}

export async function fetchData(tipo, cuentas, periodos, bancos) {
  const key = `${tipo}_${periodos.join(',')}_${[...bancos].sort().join(',')}_${cuentas.join(',')}`;
  if (ST.data[key]) return ST.data[key];
  const rows = await apiDatos({ tipo, periodos, bancos: [...bancos], cuentas });
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
