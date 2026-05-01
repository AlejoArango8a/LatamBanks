// ============================================================
// FORMAT — pure formatters and name/type resolvers
// ============================================================
import { BANK_NAMES, MESES, CUENTAS_PRINCIPALES } from './config.js';
import { ST } from './state.js';

// ---- KPI monetary formatters ----
function _fmtKPIBase(clpRaw, decimals) {
  const isUSD = ST.currency === 'USD' && ST.usdRate;
  const val = isUSD ? clpRaw / ST.usdRate : clpRaw;
  const sym = isUSD ? 'USD ' : '$';
  const abs = Math.abs(val);
  const sign = val < 0 ? '-' : '';
  const fmt = (n, d) => n.toLocaleString('es-CL', { minimumFractionDigits: d, maximumFractionDigits: d });
  if (isUSD) {
    if (abs >= 1e9)  return `${sign}${sym}${fmt(abs / 1e9,  1)}B`;
    if (abs >= 1e6)  return `${sign}${sym}${fmt(abs / 1e6,  decimals)}M`;
    if (abs >= 1e3)  return `${sign}${sym}${fmt(abs / 1e3,  decimals)}K`;
  } else {
    if (abs >= 1e12) return `${sign}${sym}${fmt(abs / 1e12, 1)}B`;
    if (abs >= 1e9)  return `${sign}${sym}${fmt(abs / 1e9,  1)}M`;
    if (abs >= 1e6)  return `${sign}${sym}${fmt(abs / 1e6,  decimals)}K`;
    if (abs >= 1e3)  return `${sign}${sym}${fmt(abs / 1e3,  decimals)}`;
  }
  return `${sign}${sym}${Math.round(abs).toLocaleString('es-CL')}`;
}

export const fmtKPI        = clpRaw => _fmtKPIBase(clpRaw, 0);
export const fmtKPIDecimal = clpRaw => _fmtKPIBase(clpRaw, 1);

// Axis label (values already divided by 1e9 = billions).
// compact: shorter labels when chart width is small (mobile).
export function fmtAxis(v, compact) {
  const abs = Math.abs(v);
  const sign = v < 0 ? '-' : '';
  const symRaw = ST.currency === 'USD' && ST.usdRate ? 'USD ' : '';
  const sym = compact ? (symRaw ? 'USD' : '') : symRaw;
  if (compact) {
    if (abs >= 1000) return sign + sym + Math.round(abs / 1000).toLocaleString('es-CL') + ' bi';
    if (abs >= 1) return sign + sym + abs.toLocaleString('es-CL', { minimumFractionDigits: 1, maximumFractionDigits: 1 }) + 'B';
    if (abs >= 0.001) return sign + sym + (abs * 1000).toLocaleString('es-CL', { maximumFractionDigits: 0 }) + 'M';
    return v === 0 ? '0' : sign + sym + abs.toFixed(2);
  }
  if (abs >= 1000) return sign + symRaw + Math.round(abs / 1000).toLocaleString('es-CL') + ' bi';
  if (abs >= 1)    return sign + sym + abs.toLocaleString('es-CL', { minimumFractionDigits: 1, maximumFractionDigits: 1 }) + ' B';
  if (abs >= 0.001) return sign + sym + (abs * 1000).toLocaleString('es-CL', { maximumFractionDigits: 0 }) + ' M';
  return v === 0 ? '0' : sign + sym + abs.toFixed(2);
}

// ---- Period & date formatters ----
export const periodLabel = p => MESES[parseInt(p.slice(4, 6))] + ' ' + p.slice(0, 4);

// ---- Simple ratio formatters ----
export const fmtM = n => Math.round(n / 1e6).toLocaleString('es-CL');
export const fmtB = n => (n / 1e9).toFixed(1).replace('.', ',');
export const fmtP = (n, d) => d ? (n / d * 100).toFixed(2) + '%' : '—';

// ---- Bank name ----
export function bankName(code) {
  return BANK_NAMES[code] || (ST.bancos[code] || `Bank ${code}`)
    .replace('BANCO ', '').replace(/ CHILE$/, '').replace(/-CHILE$/, '');
}

// ---- Text helpers ----
export function toSentenceCase(str) {
  if (!str) return str;
  return str.charAt(0).toUpperCase() + str.slice(1).toLowerCase();
}

// ---- Account type resolver ----
export function getTipo(code) {
  const p = code[0];
  if (p === '1' || p === '2' || p === '3') return 'b1';
  if (p === '4' || p === '5') return 'r1';
  if (p === '6') return 'b1';
  if (p === '8') return 'c1';
  return 'b1';
}

// ---- Explorer account label ----
export function getExpLabel(c) {
  if (CUENTAS_PRINCIPALES[c]) return CUENTAS_PRINCIPALES[c];
  const raw = ST.planCuentas[c] || c;
  return toSentenceCase(raw);
}
