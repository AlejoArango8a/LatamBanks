// ============================================================
// FORMAT — pure formatters and name/type resolvers
// ============================================================
import { BANK_NAMES, MESES, CUENTAS_PRINCIPALES } from './config.js?v=bmon60';
import { CO_CUENTAS_PRINCIPALES } from './coCuentas.js?v=bmon60';
import { ST, reportingLocalCurrencyISO } from './state.js?v=bmon60';

// ---- KPI monetary formatters ----
function _fmtKPIBase(clpRaw, decimals) {
  if (clpRaw == null || clpRaw === '' || !Number.isFinite(Number(clpRaw))) return '—';
  const localIso = reportingLocalCurrencyISO();
  const convertToUsd = ST.currency === 'USD' && Number(ST.usdRate) > 0 && localIso !== 'USD';
  // US (y cualquier país con moneda local USD): escala tipo billones = 1e9
  const usdScale = convertToUsd || localIso === 'USD';
  const val = convertToUsd ? Number(clpRaw) / ST.usdRate : Number(clpRaw);
  const sym = convertToUsd ? 'USD ' : '$';
  const abs = Math.abs(val);
  const sign = val < 0 ? '-' : '';
  const loc = localIso === 'USD' ? 'en-US' : 'es-CL';
  const fmt = (n, d) => n.toLocaleString(loc, { minimumFractionDigits: d, maximumFractionDigits: d });
  if (usdScale) {
    if (abs >= 1e9)  return `${sign}${sym}${fmt(abs / 1e9,  1)}B`;
    if (abs >= 1e6)  return `${sign}${sym}${fmt(abs / 1e6,  decimals)}M`;
    if (abs >= 1e3)  return `${sign}${sym}${fmt(abs / 1e3,  decimals)}K`;
  } else {
    if (abs >= 1e12) return `${sign}${sym}${fmt(abs / 1e12, 1)}B`;
    if (abs >= 1e9)  return `${sign}${sym}${fmt(abs / 1e9,  1)}M`;
    if (abs >= 1e6)  return `${sign}${sym}${fmt(abs / 1e6,  decimals)}K`;
    if (abs >= 1e3)  return `${sign}${sym}${fmt(abs / 1e3,  decimals)}`;
  }
  return `${sign}${sym}${Math.round(abs).toLocaleString(loc)}`;
}

export const fmtKPI        = clpRaw => _fmtKPIBase(clpRaw, 0);
export const fmtKPIDecimal = clpRaw => _fmtKPIBase(clpRaw, 1);

// Valor CRUDO para exportar a Excel (número completo, sin abreviar). Respeta la
// moneda activa: en USD devuelve la conversión exacta (sin redondear); en moneda
// local, el número tal cual. La columna "Currency" del export indica la unidad.
export const rawForExport = (raw) => {
  const v = (ST.currency === 'USD' && ST.usdRate) ? (Number(raw) || 0) / ST.usdRate : (Number(raw) || 0);
  return Math.round(v);   // solo enteros en el Excel (sin decimales)
};

// Axis label (values already divided by 1e9 = billions).
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

/** NPL / total loans (CMF amounts are same unit — ratio is scale-free). */
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

/** Quita sufijos legales y normaliza espacios (principalmente CUIF Colombia y BR). */
function stripSociedadAnonima(s) {
  return String(s || '')
    .replace(/\s*,\s*N\.?\s*A\.?\.?\s*$/gi, '')
    .replace(/\s*N\.?\s*A\.?\.?\s*$/gi, '')
    .replace(/\s*,\s*S\.?\s*A\.?\.?\s*$/gi, '')
    .replace(/\bS\.?\s*A\.?\.?\b/gi, ' ')
    .replace(/\s{2,}/g, ' ')
    .replace(/(?:\s*\.)+\s*$/g, '')
    .trim();
}

/** Siglas / marcas que no se title-casean (Colombia). */
const CO_ACRONYM_FORMS = new Map([
  ['btg', 'BTG'],
  ['bbva', 'BBVA'],
  ['hsbc', 'HSBC'],
  ['itau', 'ITAU'],
  ['citibank', 'Citibank'],
]);

/** Particulas en minuscula salvo primera palabra (Colombia). */
const CO_TITLE_PARTICLES = new Set(['de', 'del', 'la', 'las', 'los', 'y', 'e', 'en', 'al', 'a']);

// ---- Title Case compartido: Chile y Brasil ----------------------------------

/**
 * Siglas explicitas (>4 chars) que siempre van en mayusculas en CL/BR.
 * Las de <=4 chars se detectan por heuristica en titleCaseLatam.
 */
const KNOWN_ACRONYMS = new Set(['BNDES', 'HSBC', 'BBVA', 'GNB', 'BNP']);

/**
 * Particulas que van en minuscula en espanol y portugues, salvo posicion 0.
 * Tienen PRIORIDAD sobre la heuristica de siglas (e.g. "DO", "DE", "DEL").
 */
const LATAM_PARTICLES = new Set([
  // portugues
  'do', 'dos', 'da', 'das', 'de', 'e', 'em', 'no', 'na', 'nos', 'nas',
  // espanol
  'del', 'la', 'las', 'los', 'y', 'en', 'al', 'a',
]);

/**
 * Title Case para nombres de bancos latinoamericanos (CL y BR).
 *   1. Particulas (do, de, da, y, del…) -> minusculas, salvo posicion 0.
 *      (tienen prioridad; evita que "DO" active la heuristica de sigla)
 *   2. Siglas en KNOWN_ACRONYMS -> siempre mayusculas.
 *   3. Heuristica: palabra toda-mayusculas de <=4 letras puras -> sigla (BB, XP, BTG, ITAU…).
 *   4. Palabras con prefijo no-alfa (e.g. "(BRASIL)") -> capitalizar parte alfa.
 *   5. Resto -> primera letra mayuscula, resto minusculas.
 */
function titleCaseLatam(raw) {
  if (!raw) return raw;
  return raw.trim().split(/\s+/).map((orig, i) => {
    const lower = orig.toLowerCase();
    // 1. Particles take priority (except first word)
    if (i > 0 && LATAM_PARTICLES.has(lower)) return lower;
    // 2. Explicit known acronym
    if (KNOWN_ACRONYMS.has(orig.toUpperCase())) return orig.toUpperCase();
    // 3. Heuristic: pure alpha, all-caps, <=4 chars -> acronym
    if (/^[A-Z]+$/.test(orig) && orig.length <= 4) return orig;
    // 4. Words with non-alpha prefix like "(BRASIL)" -> capitalize alpha part
    const m = orig.match(/^(\W*)([A-Za-z].*)$/);
    if (m) return m[1] + m[2].charAt(0).toUpperCase() + m[2].slice(1).toLowerCase();
    // 5. Default
    return lower.charAt(0).toUpperCase() + lower.slice(1);
  }).join(' ');
}

// ---------------------------------------------------------------------------

function titleCaseCoToken(lower) {
  if (!lower) return '';
  if (lower.includes('-'))
    return lower.split('-').map(p => titleCaseCoToken(p)).join('-');
  const ac = CO_ACRONYM_FORMS.get(lower);
  if (ac) return ac;
  const c = lower.charAt(0).toLocaleUpperCase('es-CO') + lower.slice(1).toLocaleLowerCase('es-CO');
  return c;
}

/** Grupo Aval — codigo_entidad CUIF (establecimientos tipo 1). */
const CO_AVAL_CODES = new Set([1, 2, 23, 49]);

/** Nombres curados por codigo_entidad CUIF. */
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

  // ---- Brasil ----
  if (ST.country === 'brasil') {
    // Overrides de nombre de display (codigo prudencial -> nombre curado).
    // Orden: primero overrides puntuales, luego titleCase generico.
    const BR_DISPLAY = new Map([
      [1000080099, 'Ita\u00fa'],
      [1000080329, 'Banco do Brasil'],
      [1000080738, 'Caixa Econ\u00f4mica'],
      [1000084693, 'Nubank'],
      [1000081593, 'Banco do Nordeste'],
      [1000080996, 'Banco Inter'],
      [1000081744, 'Daycoval'],
      [1000080556, 'BofA'],
      [1000080312, 'Banco ABC'],
      [1000084820, 'Mercado Pago'],
      [1000081555, 'Rabobank'],
      [1000080745, 'Sicredi'],
      [82639451,   'Viacredi'],
      [54037916,   'Credicitrus'],
      [1000083632, 'Crefisa'],
      [1000080336, 'BTG Pactual'],
      [1000080154, 'Banrisul'],
    ]);
    const numCode = Number(code);
    if (BR_DISPLAY.has(numCode)) return BR_DISPLAY.get(numCode);
    // Nombre generico: quitar sufijo prudencial y S.A., luego Title Case
    const raw = fromApi || `Bank ${code}`;
    const stripped = stripSociedadAnonima(raw.replace(/\s*-\s*PRUDENCIAL\s*$/i, '').trim());
    return titleCaseLatam(stripped);
  }

  // ---- Colombia ----
  if (ST.country === 'colombia') {
    if (!fromApi) return `Bank ${code}`;
    const ins = Number(code);
    if (Number.isNaN(ins)) return polishColombianBankDisplay(fromApi);
    let name = !Number.isNaN(ins) && CO_BANK_DISPLAY.has(ins)
      ? CO_BANK_DISPLAY.get(ins)
      : polishColombianBankDisplay(fromApi);
    if (CO_AVAL_CODES.has(ins)) name = `${name} (Aval)`;
    return name;
  }

  // ---- Uruguay ----
  if (ST.country === 'uruguay') {
    const UY_DISPLAY = new Map([
      [1,   'BROU'],
      [91,  'BHU'],
      [110, 'BANDES'],
      [113, 'Itaú'],
      [128, 'Scotiabank'],
      [137, 'Santander'],
      [153, 'BBVA'],
      [157, 'BTG Pactual Uruguay'],
      [162, 'Heritage'],
      [205, 'Citibank'],
      [246, 'Banco Nación'],
    ]);
    const numCode = Number(code);
    if (UY_DISPLAY.has(numCode)) return UY_DISPLAY.get(numCode);
    const raw = fromApi || `Bank ${code}`;
    return titleCaseLatam(stripSociedadAnonima(raw));
  }

  // ---- Perú ----
  if (ST.country === 'peru') {
    const PE_DISPLAY = new Map([
      [1,  'BBVA'],
      [2,  'Bancom'],
      [3,  'BCP'],
      [4,  'Pichincha'],
      [5,  'BanBif'],
      [6,  'Scotiabank'],
      [7,  'Citibank'],
      [8,  'Interbank'],
      [9,  'Mibanco'],
      [10, 'GNB'],
      [11, 'Falabella'],
      [12, 'Santander'],
      [13, 'Ripley'],
      [14, 'Alfin'],
      [15, 'ICBC'],
      [16, 'Bank of China'],
      [17, 'BCI'],
      [18, 'Compartamos'],
      [19, 'Santander Consumer'],
    ]);
    const numCode = Number(code);
    if (PE_DISPLAY.has(numCode)) return PE_DISPLAY.get(numCode);
    const raw = fromApi || `Bank ${code}`;
    return titleCaseLatam(stripSociedadAnonima(raw));
  }

  // ---- United States (FDIC CERT) ----
  if (ST.country === 'usa') {
    const US_DISPLAY = new Map([
      [35154, 'BTG Pactual Bank'],
      [628,   'JPMorgan Chase'],
      [3510,  'Bank of America'],
      [3511,  'Wells Fargo'],
      [7213,  'Citibank'],
      [4297,  'Capital One'],
      [33124, 'Goldman Sachs Bank'],
      [6384,  'PNC Bank'],
      [6548,  'U.S. Bank'],
      [9846,  'Truist'],
      [27374, 'TD Bank'],
      [32992, 'Charles Schwab Bank'],
      [14,    'State Street'],
      [5416,  'HSBC Bank USA'],
    ]);
    const numCode = Number(code);
    if (US_DISPLAY.has(numCode)) return US_DISPLAY.get(numCode);
    const raw = fromApi || `Bank ${code}`;
    // Quitar sufijos NA / NATIONAL ASSOCIATION
    const cleaned = stripSociedadAnonima(raw)
      .replace(/\bNATIONAL\s+ASSOCIATION\b/gi, '')
      .replace(/\bN\.?\s*A\.?\b/gi, '')
      .replace(/\bNA\b/gi, '')
      .trim();
    return titleCaseLatam(cleaned || raw);
  }

  // ---- Argentina (BCRA) ----
  if (ST.country === 'argentina') {
    const AR_DISPLAY = new Map([
      [11, 'Nación'],
      [7,  'Galicia'],
      [14, 'Provincia'],
      [17, 'BBVA'],
      [72, 'Santander'],
      [285, 'Macro'],
      [34, 'Patagonia'],
      [27, 'Supervielle'],
      [29, 'Ciudad'],
      [15, 'ICBC'],
      [191, 'Credicoop'],
      [299, 'Comafi'],
      [16, 'Citibank'],
    ]);
    const numCode = Number(code);
    if (AR_DISPLAY.has(numCode)) return AR_DISPLAY.get(numCode);
    const raw = fromApi || `Bank ${code}`;
    return titleCaseLatam(stripSociedadAnonima(raw).replace(/^BANCO\s+/i, '').trim() || raw);
  }

  // ---- México (CNBV) ----
  if (ST.country === 'mexico') {
    const MX_DISPLAY = new Map([
      [12, 'BBVA'],
      [14, 'Santander'],
      [72, 'Banorte'],
      [2,  'Banamex'],
      [21, 'HSBC'],
      [44, 'Scotiabank'],
      [36, 'Inbursa'],
      [9,  'Citi'],
      [30, 'Bajío'],
      [127, 'Azteca'],
      [58, 'Banregio'],
      [130, 'Compartamos'],
    ]);
    const numCode = Number(code);
    if (MX_DISPLAY.has(numCode)) return MX_DISPLAY.get(numCode);
    const raw = fromApi || `Bank ${code}`;
    return titleCaseLatam(stripSociedadAnonima(raw).replace(/^BANCO\s+/i, '').trim() || raw);
  }

  // ---- Panamá (SBP) ----
  // Never fall through to Chile BANK_NAMES: PA codes collide (e.g. 1, 12, 59).
  if (ST.country === 'panama') {
    const PA_DISPLAY = new Map([
      [1,   'Banco Nacional'],
      [2,   'Caja de Ahorros'],
      [3,   'Banco General'],
      [7,   'Davivienda'],
      [27,  'Bladex'],
      [37,  'Citibank'],
      [45,  'Scotiabank'],
      [117, 'Bank of China'],
      [148, 'Global Bank'],
      [155, 'BAC'],
      [182, 'Banistmo'],
      [201, 'Banesco'],
      [243, 'Bancolombia'],
      [247, 'Banco de Bogotá'],
      [259, 'Multibank'],
      [260, 'ICBC'],
    ]);
    const numCode = Number(code);
    if (PA_DISPLAY.has(numCode)) return PA_DISPLAY.get(numCode);
    const raw = fromApi || `Bank ${code}`;
    return titleCaseLatam(
      stripSociedadAnonima(raw)
        .replace(/\s*\(PANAMÁ\)\s*/gi, ' ')
        .replace(/\s*\(PANAMA\)\s*/gi, ' ')
        .replace(/^BANCO\s+/i, '')
        .replace(/\s+/g, ' ')
        .trim() || raw,
    );
  }

  // ---- Chile ----
  // BANK_NAMES is Chile-only. Do not use these codes for other countries.
  if (ST.country === 'chile' && BANK_NAMES[code]) return BANK_NAMES[code];
  return titleCaseLatam(fromApi || `Bank ${code}`);
}

// ---- Text helpers ----
export function toSentenceCase(str) {
  if (!str) return str;
  return str.charAt(0).toUpperCase() + str.slice(1).toLowerCase();
}

/** Escape for text / HTML body. */
export function escapeHtml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Escape for double-quoted HTML attributes. */
export function escapeAttr(s) {
  return escapeHtml(s).replace(/'/g, '&#39;');
}

/**
 * Colombia Income Statement — sentence-case label, ellipsis via CSS, full text on hover.
 */
export function coIncomeStatementConceptHtml(label, isSection) {
  if (isSection) return escapeHtml(String(label ?? ''));
  const raw = String(label ?? '').trim();
  if (!raw) return '—';
  const full = toSentenceCase(raw);
  return `<span class="res-pl-concept" title="${escapeAttr(full)}">${escapeHtml(full)}</span>`;
}

// ---- Account type resolver ----
export function getTipo(code) {
  const c = String(code || '');
  // Uruguay BCU: subtotales S_* y resultado R_* viven en el estado de resultados.
  if (c.startsWith('R_') || c.startsWith('S_')) return 'r1';
  // Perú SBS: slugs canónicos del PyG
  if (ST.country === 'peru') {
    const peR1 = /^(INGRESOS_|GASTOS_|MARGEN_|PROVISIONES_CREDITOS|RESULTADO_|IMPUESTO_RENTA|UTILIDAD_)/;
    if (c === 'RESULTADO_NETO' || peR1.test(c)) return 'r1';
    return 'b1';
  }
  // US FDIC
  if (ST.country === 'usa') {
    if (['NETINC', 'INTINC', 'EINTEXP', 'NONII', 'NONIX'].includes(c)) return 'r1';
    return 'b1';
  }
  // Argentina BCRA / México CNBV / Panamá SBP
  if (ST.country === 'argentina' || ST.country === 'mexico' || ST.country === 'panama') {
    if (c === 'RESULTADO_NETO' || c === 'UTILIDAD_ANTES_PROVISIONES'
        || /^(INGRESOS_|EGRESOS_|GASTOS_|CARGO_|IMPUESTO_|RESULTADO_|UTILIDAD_)/.test(c)) return 'r1';
    return 'b1';
  }
  const p = c[0];
  if (p === '1' || p === '2' || p === '3') return 'b1';
  if (p === '4' || p === '5') return 'r1';
  if (p === '6') return 'b1';
  if (p === '8') return 'c1';
  // UY PyG numérico sigue 4…23 (y sentinels arriba)
  if (ST.country === 'uruguay' && /^[4-9]/.test(c)) return 'r1';
  return 'b1';
}

// ---- Explorer account label ----
export function getExpLabel(c) {
  const map = ST.country === 'colombia' ? CO_CUENTAS_PRINCIPALES : CUENTAS_PRINCIPALES;
  if (map[c]) return map[c];
  const raw = ST.planCuentas[c] || c;
  return toSentenceCase(raw);
}
