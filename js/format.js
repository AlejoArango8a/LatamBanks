// ============================================================
// FORMAT — pure formatters and name/type resolvers
// ============================================================
import { BANK_NAMES, MESES, CUENTAS_PRINCIPALES } from './config.js?v=bmon14';
import { CO_CUENTAS_PRINCIPALES } from './coCuentas.js?v=bmon14';
import { ST } from './state.js?v=bmon14';

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
// Sub‑0.001 B (e.g. USD view of small COP balances) must not round to 0.00 — use fractional millions (×1000).
export function fmtAxis(v, compact) {
  const abs = Math.abs(v);
  const sign = v < 0 ? '-' : '';
  const symRaw = ST.currency === 'USD' && ST.usdRate ? 'USD ' : '';
  const sym = compact ? (symRaw ? 'USD' : '') : symRaw;
  const fracM = mm =>
    mm.toLocaleString('es-CL', {
      maximumFractionDigits: mm < 0.01 ? 4 : mm < 1 ? 3 : 0,
    });
  if (compact) {
    if (abs >= 1000) return sign + sym + Math.round(abs / 1000).toLocaleString('es-CL') + ' bi';
    if (abs >= 1) return sign + sym + abs.toLocaleString('es-CL', { minimumFractionDigits: 1, maximumFractionDigits: 1 }) + 'B';
    if (abs >= 0.001) return sign + sym + (abs * 1000).toLocaleString('es-CL', { maximumFractionDigits: 0 }) + 'M';
    if (v === 0) return '0';
    const mm = abs * 1000;
    if (mm >= 1e-6) return sign + sym + fracM(mm) + 'M';
    return sign + sym + abs.toExponential(1) + 'B';
  }
  if (abs >= 1000) return sign + symRaw + Math.round(abs / 1000).toLocaleString('es-CL') + ' bi';
  if (abs >= 1)    return sign + sym + abs.toLocaleString('es-CL', { minimumFractionDigits: 1, maximumFractionDigits: 1 }) + ' B';
  if (abs >= 0.001) return sign + sym + (abs * 1000).toLocaleString('es-CL', { maximumFractionDigits: 0 }) + ' M';
  if (v === 0) return '0';
  const mm = abs * 1000;
  if (mm >= 1e-6) return sign + sym + fracM(mm) + ' M';
  return sign + sym + abs.toExponential(1) + ' B';
}

// ---- Period & date formatters ----
export const periodLabel = p =>
  (!p || typeof p !== 'string' || p.length < 6)
    ? '—'
    : (MESES[parseInt(p.slice(4, 6), 10)] || '?') + ' ' + p.slice(0, 4);

// ---- Simple ratio formatters ----
export const fmtM = n => Math.round(n / 1e6).toLocaleString('es-CL');
export const fmtB = n => (n / 1e9).toFixed(1).replace('.', ',');
export const fmtP = (n, d) => d ? (n / d * 100).toFixed(2) + '%' : '—';

/** NPL / total loans (CMF amounts are same unit → ratio is scale-free). */
export function nplPctFromRaw(moraAbs, loansAbs) {
  const l = Number(loansAbs) || 0;
  if (l <= 0) return null;
  return (Number(moraAbs) || 0) / l * 100;
}

/** Chart / table percentage (e.g. 2,35%). */
export function fmtChartPct(v, compact) {
  if (v === null || v === undefined || !isFinite(v)) return '—';
  const abs = Math.abs(v);
  const dec = compact
    ? (abs < 0.5 ? 2 : abs < 15 ? 1 : 0)
    : (abs < 0.1 ? 3 : abs < 25 ? 2 : 1);
  const d = Math.min(Math.max(dec, 0), 3);
  return v.toLocaleString('es-CL', { minimumFractionDigits: d, maximumFractionDigits: d }) + '%';
}

// ---- Bank name ----

/** Quita sufijos legales y normaliza espacios (principalmente CUIF Colombia). */
function stripSociedadAnonima(s) {
  return String(s || '')
    .replace(/\s*,\s*N\.?\s*A\.?\.?\s*$/gi, '')
    .replace(/\s*N\.?\s*A\.?\.?\s*$/gi, '')
    .replace(/\s*,\s*S\.?\s*A\.?\.?\s*$/gi, '')
    .replace(/\bS\.?\s*A\.?\.?\b/gi, ' ')
    .replace(/\s{2,}/g, ' ')
    // API / regex leave a dangling period after stripping legal suffixes (e.g. "Bancolombia .")
    .replace(/(?:\s*\.)+\s*$/g, '')
    .trim();
}

/** Siglas / marcas que no se fuerzan a “capitalize” típico. */
const CO_ACRONYM_FORMS = new Map([
  ['btg', 'BTG'],
  ['bbva', 'BBVA'],
  ['hsbc', 'HSBC'],
  ['itau', 'ITAU'],
  ['citibank', 'Citibank'],
]);

/** Partículas en minúscula salvo primera palabra. */
const CO_TITLE_PARTICLES = new Set(['de', 'del', 'la', 'las', 'los', 'y', 'e', 'en', 'al', 'a']);

function titleCaseCoToken(lower) {
  if (!lower) return '';
  if (lower.includes('-'))
    return lower.split('-').map(p => titleCaseCoToken(p)).join('-');
  const ac = CO_ACRONYM_FORMS.get(lower);
  if (ac) return ac;
  const c = lower.charAt(0).toLocaleUpperCase('es-CO') + lower.slice(1).toLocaleLowerCase('es-CO');
  return c;
}

/** Nombres curator (CUIF establecimientos tipo 1, codigo_entidad). */
const CO_BANK_DISPLAY = new Map([
  [66, 'BTG Pactual Colombia'],
  [12, 'GNB Sudameris'],
  [9, 'Citibank'],
  [64, 'J.P. Morgan'],
  [56, 'Falabella'],
  [60, 'Mundo Mujer'],
  [57, 'Pichincha'],
  [55, 'Finandina'],
  [58, 'Coopcentral'],
  [49, 'AV Villas'],
  [43, 'Banco Agrario'],
]);

export function polishColombianBankDisplay(raw) {
  let s = stripSociedadAnonima(raw);
  if (!s) return '';
  const lowerLine = s.toLowerCase().replace(/\s+/g, ' ').trim();
  const tokens = lowerLine.split(/\s+/).filter(Boolean);
  const cased = tokens.map((tok, i) => {
    const w = titleCaseCoToken(tok);
    if (i > 0 && CO_TITLE_PARTICLES.has(tok)) return tok;
    return w;
  });
  return cased.join(' ');
}

export function bankName(code) {
  const fromApi = ST.bancos[code];
  if (ST.country === 'colombia') {
    if (!fromApi) return `Bank ${code}`;
    const ins = Number(code);
    if (!Number.isNaN(ins) && CO_BANK_DISPLAY.has(ins)) return CO_BANK_DISPLAY.get(ins);
    return polishColombianBankDisplay(fromApi);
  }
  return BANK_NAMES[code] || (fromApi || `Bank ${code}`)
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
  const map = ST.country === 'colombia' ? CO_CUENTAS_PRINCIPALES : CUENTAS_PRINCIPALES;
  if (map[c]) return map[c];
  const raw = ST.planCuentas[c] || c;
  return toSentenceCase(raw);
}
