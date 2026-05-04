// ============================================================
// Colombia CUIF — 6 dígitos (clasificación financiera típica SFC)
// Derivado de datos reales datos_financieros CO (prioridad cobertura b1/r1).
// ============================================================
import { ST } from './state.js?v=bmon14';

export const CO_CUIF = {
  activos: '100000',
  colocaciones: '140000',
  pasivos: '200000',
  /** Patrimonio total CUIF (cuenta 300000) — mismo criterio que sidebar y estados. */
  patrimonio: '300000',
  /** Depósitos en cuenta corriente (CUIF nombre estándar: “DEPOSITOS EN CUENTA CORRIENTE”, cuenta típica 210500). */
  depVista: '210500',
  /** Certificados de depósito a término (“CERTIFICADOS DE DEPOSITO A TERMINO”, típico 210700). */
  depPlazo: '210700',
  bonos: '250000',
  utilidadNet: '590000',
};

/** Normaliza cuenta CUIF CO a 6 dígitos (prefix clase; ceros a la derecha típico CUIF). */
export function coCuentaNorm6(cuenta) {
  const d = String(cuenta ?? '').replace(/\D/g, '');
  if (!d) return '';
  if (d.length >= 6) return d.slice(0, 6);
  return d.padEnd(6, '0');
}

/** Deterioro en el activo — todas las cuentas 148### y 149### (CUIF). */
export function coIsDeterioroActivoCuenta(cuenta) {
  const k = coCuentaNorm6(cuenta);
  return k.startsWith('148') || k.startsWith('149');
}

/**
 * Cuentas b1 a solicitar: del plan cargado, todas las de familias 148 y 149.
 */
export function coDeterioroActivoCuentasFromPlan(planKeys) {
  const out = new Set();
  for (const cu of planKeys || []) {
    const k = coCuentaNorm6(cu);
    if (k.startsWith('148') || k.startsWith('149')) out.add(k);
  }
  return [...out].sort();
}

/** Numerador Key Data / gráfico deterioro CO: suma |monto| en 148·149 para el periodo. */
export function coMoraNumerator(rowsOneBankOneTipo, period) {
  return rowsOneBankOneTipo
    .filter(r => (!period || r.periodo === period) && coIsDeterioroActivoCuenta(r.cuenta))
    .reduce((s, r) => s + Math.abs(Number(r.monto_total) || 0), 0);
}

/**
 * Balance Sheet — principales subcuentas CUIF b1 (6 dígitos), alineadas al desglose tipo Chile.
 * Códigos = primeros 6 dígitos del catálogo CMF homólogo donde aplica; depósitos CO = 210500/210700.
 */
export const BAL_CO_SECTIONS = {
  assets: [
    { c: '100000', l: 'Total assets', cls: 'hl' },
    { c: '105000', l: 'Cash and deposits in banks', cls: 'i1' },
    { c: '107000', l: 'Operations in liquidation (assets)', cls: 'i1' },
    { c: '110000', l: 'Financial assets at FVTPL', cls: 'i1' },
    { c: '120000', l: 'Financial assets at FVOCI', cls: 'i1' },
    { c: '130000', l: 'Hedging derivatives (assets)', cls: 'i1' },
    { c: '140000', l: 'Loans · gross portfolio', cls: 'i2' },
    { c: '148000', l: 'Deterioro en el activo (familia 148)', cls: 'i3' },
    { c: '149000', l: 'Deterioro en el activo (familia 149)', cls: 'i3' },
    { c: '150000', l: 'Investments in associates / subsidiaries', cls: 'i1' },
    { c: '160000', l: 'Intangible assets', cls: 'i1' },
    { c: '170000', l: 'Property, plant and equipment', cls: 'i1' },
    { c: '175000', l: 'Investment property', cls: 'i1' },
    { c: '185000', l: 'Deferred tax assets', cls: 'i1' },
    { c: '190000', l: 'Other assets', cls: 'i1' },
    { c: '195000', l: 'Servicios y otros contratos (neto)', cls: 'i1' },
  ],
  liabilities: [
    { c: '200000', l: 'Total liabilities', cls: 'hl' },
    { c: '207000', l: 'Operations in liquidation (liabilities)', cls: 'i1' },
    { c: '210000', l: 'Financial liabilities at FVTPL', cls: 'i1' },
    { c: '230000', l: 'Hedging derivatives (liabilities)', cls: 'i1' },
    { c: '240000', l: 'Financial liabilities at amortized cost', cls: 'i2' },
    { c: '210500', l: 'Demand deposits', cls: 'i2' },
    { c: '210700', l: 'Time deposits (CDTs)', cls: 'i2' },
    { c: '243000', l: 'Repurchase obligations', cls: 'i2' },
    { c: '244000', l: 'Due to banks', cls: 'i2' },
    { c: '250000', l: 'Issued bonds / debt instruments', cls: 'i2' },
    { c: '255000', l: 'Regulatory / hybrid capital issued', cls: 'i1' },
    { c: '260000', l: 'Provisions and contingencies', cls: 'i1' },
    { c: '270000', l: 'Credit loss provisions (liabilities)', cls: 'i1' },
    { c: '290000', l: 'Other liabilities', cls: 'i1' },
  ],
  equity: [
    { c: '300000', l: 'Total equity', cls: 'hl' },
    { c: '310000', l: 'Capital / aportes sociales', cls: 'i1' },
    { c: '311000', l: 'Paid-in capital', cls: 'i2' },
    { c: '320000', l: 'Reserves', cls: 'i1' },
    { c: '330000', l: 'OCI and equity adjustments', cls: 'i1' },
    { c: '340000', l: 'Retained earnings (prior periods)', cls: 'i1' },
    { c: '350000', l: 'Current year result', cls: 'i1' },
    { c: '380000', l: 'Equity attributable to owners (rollup)', cls: 'hl' },
  ],
};

/** Sentinels for CUIF P&L subtotal lines (not chart codes). */
export const CO_R1_SENT_CLASS4_TOTAL = '!C4';
export const CO_R1_SENT_CLASS5_OPS = '!C5';

const CO_R1_RESULT_PREFIXES = new Set(['570', '580', '590']);

function coPlGroupLabel(plan, pref3) {
  const p = plan || {};
  const key000 = `${pref3}000`;
  if (p[key000]) return p[key000];
  const any = Object.keys(p).find(k => coCuentaNorm6(k).startsWith(pref3));
  return any ? p[any] : `Account group ${pref3}xxx`;
}

function coCollectPlPrefixesFromPlan(planKeys) {
  const p4 = new Set();
  const p5 = new Set();
  for (const cu of planKeys || []) {
    const n = coCuentaNorm6(cu);
    if (n.length !== 6) continue;
    if (n[0] === '4') p4.add(n.slice(0, 3));
    if (n[0] === '5') p5.add(n.slice(0, 3));
  }
  return { p4, p5 };
}

function coAugmentPrefixesFromR1(p4, p5, r1, lastP, bankSet) {
  if (!r1 || !lastP || !bankSet?.size) return;
  for (const row of r1) {
    if (row.periodo !== lastP || !bankSet.has(Number(row.ins_cod))) continue;
    const n = coCuentaNorm6(row.cuenta);
    if (n.length !== 6) continue;
    if (n[0] === '4') p4.add(n.slice(0, 3));
    if (n[0] === '5') p5.add(n.slice(0, 3));
  }
}

/**
 * Income Statement rows for Colombia: CUIF clase 4 (ingresos) y clase 5 (gastos) por grupo (3 dígitos),
 * más subtotales publicados típicos 570/580/590. Alineado con infer_tipo en colombia_loader (4,5 → r1).
 */
export function coPlStatementRows() {
  const plan = ST.planCuentas || {};
  const { p4: p4a, p5: p5a } = coCollectPlPrefixesFromPlan(Object.keys(plan));
  const p4 = new Set(p4a);
  const p5 = new Set(p5a);
  const bankSet = new Set([...ST.selected].map(Number));
  coAugmentPrefixesFromR1(p4, p5, ST._series?.r1, ST._lastP, bankSet);

  const sorted4 = [...p4].sort((a, b) => Number(a) - Number(b));
  const p5detail = [...p5].filter(p => !CO_R1_RESULT_PREFIXES.has(p)).sort((a, b) => Number(a) - Number(b));

  const out = [];

  out.push({ section: true, l: 'Income (class 4 · CUIF)' });
  for (const pref of sorted4) {
    out.push({ l: coPlGroupLabel(plan, pref), c: `${pref}000`, cls: 'i1' });
  }
  out.push({ l: 'Total income (class 4)', c: CO_R1_SENT_CLASS4_TOTAL, cls: 'hl' });

  out.push({ section: true, l: 'Expenses (class 5 · CUIF)' });
  for (const pref of p5detail) {
    out.push({ l: coPlGroupLabel(plan, pref), c: `${pref}000`, cls: 'i1' });
  }
  out.push({
    l: 'Total expenses (class 5, excl. result lines 570–590)',
    c: CO_R1_SENT_CLASS5_OPS,
    cls: 'hl',
  });

  const fallbacks = {
    '570000': 'Operating result before credit losses',
    '580000': 'Operating result',
    '590000': 'Net income (loss)',
  };
  out.push({ section: true, l: 'Reported subtotals (CUIF)' });
  for (const c of ['570000', '580000', '590000']) {
    const pref = c.slice(0, 3);
    const lbl = plan[c] || fallbacks[c] || coPlGroupLabel(plan, pref);
    out.push({ l: lbl, c, cls: 'hl' });
  }

  return out;
}

/** b1: totales publicados solo por código exacto; el resto se agrega por familia CUIF. */
const CO_B1_HEADLINE_EXACT = new Set(['100000', '200000', '300000']);

/**
 * ¿La cuenta normalizada (6 dígitos) aporta a la fila del balance CO `sectionCode`?
 * Evita solapes (210 vs 2105/2107, 240 vs 243/244, 310 vs 311).
 */
export function coB1NormMatchesBalanceRow(norm, sectionCode) {
  const c = coCuentaNorm6(sectionCode);
  const n = coCuentaNorm6(norm);
  if (!c || !n || n.length !== 6) return false;
  if (CO_B1_HEADLINE_EXACT.has(c)) return n === c;
  if (n === c) return true;
  const special = {
    '210000': x => x.startsWith('210') && !x.startsWith('2105') && !x.startsWith('2107'),
    '240000': x => x.startsWith('240') && !x.startsWith('243') && !x.startsWith('244'),
    '310000': x => x === '310000' || (x.startsWith('310') && !x.startsWith('311')),
    '210500': x => x.startsWith('2105'),
    '210700': x => x.startsWith('2107'),
  };
  if (special[c]) return special[c](n);
  if (c.length === 6 && c.endsWith('000')) return n.startsWith(c.slice(0, 3));
  return n.startsWith(c);
}

/** Suma monto_total b1 CO para una fila del layout (un banco · un periodo). */
export function coSumB1BalanceRow(b1RowsSameBankPeriod, sectionCode) {
  const c = coCuentaNorm6(sectionCode);
  const rows = b1RowsSameBankPeriod.map(r => ({ r, n: coCuentaNorm6(r.cuenta) }));
  if (CO_B1_HEADLINE_EXACT.has(c)) {
    return rows.filter(({ n }) => n === c).reduce((s, { r }) => s + (Number(r.monto_total) || 0), 0);
  }
  const exact = rows.filter(({ n }) => n === c).reduce((s, { r }) => s + (Number(r.monto_total) || 0), 0);
  if (Math.abs(exact) > 1e-9) return exact;
  return rows
    .filter(({ n }) => coB1NormMatchesBalanceRow(n, c))
    .reduce((s, { r }) => s + (Number(r.monto_total) || 0), 0);
}

/** r1: subtotales CUIF — si no hay fila agregada, sumar por prefijo de 3 dígitos. */
const CO_R1_HEADLINE = new Set(['550000', '560000', '580000', '590000']);

export function coR1NormMatchesRow(norm, sectionCode) {
  const c = coCuentaNorm6(sectionCode);
  const n = coCuentaNorm6(norm);
  if (!c || !n || n.length !== 6) return false;
  if (n === c) return true;
  if (c.length === 6 && c.endsWith('000')) return n.startsWith(c.slice(0, 3));
  return n.startsWith(c);
}

export function coSumR1PlRow(r1RowsSameBankPeriod, sectionCode) {
  if (sectionCode === CO_R1_SENT_CLASS4_TOTAL) {
    return r1RowsSameBankPeriod.reduce((s, r) => {
      const n = coCuentaNorm6(r.cuenta);
      if (n.length === 6 && n[0] === '4') return s + (Number(r.monto_total) || 0);
      return s;
    }, 0);
  }
  if (sectionCode === CO_R1_SENT_CLASS5_OPS) {
    const skip = n =>
      n.startsWith('570') || n.startsWith('580') || n.startsWith('590');
    return r1RowsSameBankPeriod.reduce((s, r) => {
      const n = coCuentaNorm6(r.cuenta);
      if (n.length !== 6 || n[0] !== '5' || skip(n)) return s;
      return s + (Number(r.monto_total) || 0);
    }, 0);
  }

  const c = coCuentaNorm6(sectionCode);
  const rows = r1RowsSameBankPeriod.map(r => ({ r, n: coCuentaNorm6(r.cuenta) }));
  if (CO_R1_HEADLINE.has(c)) {
    const exact = rows.filter(({ n }) => n === c).reduce((s, { r }) => s + (Number(r.monto_total) || 0), 0);
    if (Math.abs(exact) > 1e-9) return exact;
    return rows.filter(({ n }) => n.startsWith(c.slice(0, 3))).reduce((s, { r }) => s + (Number(r.monto_total) || 0), 0);
  }
  const exact = rows.filter(({ n }) => n === c).reduce((s, { r }) => s + (Number(r.monto_total) || 0), 0);
  if (Math.abs(exact) > 1e-9) return exact;
  return rows
    .filter(({ n }) => coR1NormMatchesRow(n, c))
    .reduce((s, { r }) => s + (Number(r.monto_total) || 0), 0);
}

/** b1/r1 únicos a pedir en run() Colombia — mantener sync con las tablas anteriores. */
export function coB1AccountsForRun() {
  const base = [
    ...BAL_CO_SECTIONS.assets.map(r => r.c),
    ...BAL_CO_SECTIONS.liabilities.map(r => r.c),
    ...BAL_CO_SECTIONS.equity.map(r => r.c),
  ];
  const out = new Set(base);
  for (const cu of Object.keys(ST.planCuentas || {})) {
    const n = coCuentaNorm6(cu);
    if (n.length !== 6) continue;
    const d = n[0];
    if (d === '1' || d === '2' || d === '3') out.add(n);
  }
  return [...out];
}

export function coR1AccountsForRun() {
  const out = new Set();
  for (const cu of Object.keys(ST.planCuentas || {})) {
    const n = coCuentaNorm6(cu);
    if (n.length !== 6) continue;
    if (n[0] === '4' || n[0] === '5') out.add(n);
  }
  for (const x of ['570000', '580000', '590000']) out.add(x);
  return [...out];
}

/** Account Explorer sidebar — CUIF 6 dígitos (familias alineadas con el plan cargado CO). */
export const CO_CUENTAS_PRINCIPALES = {
  '100000': 'Assets',
  '200000': 'Liabilities',
  '300000': 'Equity accounts',
  '400000': 'Income statement',
  '500000': 'Income statement summary',
  '600000': 'Off-balance',
  '800000': 'Supplementary information',
};

/** Codigo país API: CO | CL */
export function isExplorerTopAggregate(cuenta, iso) {
  if (iso === 'CO') return /^[1-9]0{5}$/.test(cuenta);
  return /^[1-9]0{8}$/.test(cuenta);
}

export function explorerSubLevel(cuenta, iso) {
  if (iso === 'CO') {
    if (!/^\d{6}$/.test(cuenta)) return 9;
    if (/^[1-9]0{5}$/.test(cuenta)) return 0;
    const t = cuenta.match(/0+$/)?.[0].length || 0;
    if (t >= 4) return 1;
    if (t >= 2) return 2;
    return 3;
  }
  const trailing = cuenta.match(/0+$/)?.[0].length || 0;
  if (trailing >= 6) return 1;
  if (trailing >= 2) return 2;
  return 3;
}

export function explorerParentChildMatch(parentCode, cand, digit, iso) {
  if (cand === parentCode || cand[0] !== digit) return false;
  const pl = explorerSubLevel(parentCode, iso);
  const cl = explorerSubLevel(cand, iso);
  if (cl !== pl + 1) return false;
  if (iso === 'CO') {
    const pp = parentCode.replace(/0+$/, '');
    const cp = cand.replace(/0+$/, '');
    return cp.startsWith(pp) && cp.length > pp.length;
  }
  const trim = pl === 1 ? 6 : pl === 2 ? 2 : 0;
  return cand.startsWith(parentCode.slice(0, parentCode.length - trim));
}

/** Jerarquía Account View (mismo criterio de niveles que Explorer para CO). */
export function accountViewLevel(cuenta, iso) {
  if (iso === 'CO') {
    if (!/^\d{6}$/.test(cuenta)) return 3;
    if (/^[1-9]0{5}$/.test(cuenta)) return 0;
    const t = cuenta.match(/0+$/)?.[0].length || 0;
    if (t >= 4) return 1;
    if (t >= 2) return 2;
    return 3;
  }
  if (/^[1-9]0+$/.test(cuenta)) return 0;
  const trailing = cuenta.match(/0+$/)?.[0].length || 0;
  if (trailing >= 4) return 1;
  if (trailing >= 1) return 2;
  return 3;
}
