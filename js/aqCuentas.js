// ============================================================
// Asset Quality — credit-quality account maps
// Chile (CMF b1 + c1) · Colombia (CUIF b1) · Peru (SBS b1) · Uruguay (BCU b1 A2_* + q1 A4_*)
// Brazil (IF.data Cosif + SCR dados_3)
// United States (FDIC Call Report financials)
//
// Sibling of the per-country *Cuentas.js funding maps, consumed by
// js/views/assetQuality.js. Every country declares only the metrics it really
// has; the view renders "—" plus a one-line reason for the rest, never a zero.
// Evidence for every code below: HANDOFF_AssetQuality_Blueprint.md §1–§2.
// ============================================================
import { PE_KPI } from './peCuentas.js?v=bmon93';
import { CO_CUIF, CO_DETERIORO_PARENT_CODES, coMoraNumerator } from './coCuentas.js?v=bmon93';

// ------------------------------------------------------------
// Shared helpers
// ------------------------------------------------------------

/** Σ field over the given accounts for one period (rows already filtered by bank). */
export function aqSum(rows, codes, periodo, field = 'monto_total') {
  const list = Array.isArray(codes) ? codes : [codes];
  const set = new Set(list.map(String));
  return (rows || [])
    .filter((r) => set.has(String(r.cuenta)) && (!periodo || r.periodo === periodo))
    .reduce((s, r) => s + (Number(r[field]) || 0), 0);
}

export function aqSeries(rows, codes, periodos, field = 'monto_total') {
  return (periodos || []).map((p) => aqSum(rows, codes, p, field));
}

/** Percentage helper: null (not zero) when the denominator is missing. */
export function aqPct(num, den) {
  const d = Number(den);
  if (!Number.isFinite(d) || d <= 0) return null;
  const n = Number(num);
  if (!Number.isFinite(n)) return null;
  return (n / d) * 100;
}

/**
 * Regulator-published ratios live in `tipo='q1'` and are stored as percent ×100
 * (2.25% → 225) so they stay integral and can never be mistaken for a stock.
 * Blueprint §4.5.
 */
export function aqRatioFromQ1(v) {
  const n = Number(v);
  if (v == null || !Number.isFinite(n)) return null;
  return n / 100;
}

/**
 * Read one published ratio for one bank / one period.
 * Returns null when the account is absent **and** when more than one institution
 * is in scope: published ratios must never be averaged across a peer basket
 * (blueprint §4.5). Group views fall back to the stock-derived ratio.
 */
export function aqPickQ1(rowsQ1, code, periodo) {
  const hits = (rowsQ1 || []).filter(
    (r) => String(r.cuenta) === String(code) && (!periodo || r.periodo === periodo),
  );
  if (hits.length !== 1) return null;
  return aqRatioFromQ1(hits[0].monto_total);
}

function segmentRows(rows, defs, periodo, loansTotal, extraFields) {
  return defs.map((def) => {
    const value = aqSum(rows, def.codes, periodo);
    const out = { ...def, value, pct: aqPct(value, loansTotal) };
    (extraFields || []).forEach(([key, field]) => {
      out[key] = aqSum(rows, def.codes, periodo, field);
    });
    return out;
  });
}

// ============================================================
// CHILE — CMF. Loan stock + provisions in b1, the whole quality tree in c1.
// Nothing to load: both tipos are already populated (blueprint §2.1).
// ============================================================

export const CL_AQ_INSTRUMENTS = [
  { key: 'comercial', label: 'Commercial loans', short: 'Comercial', codes: ['145000000'], group: 'segment' },
  { key: 'vivienda', label: 'Mortgage loans', short: 'Vivienda', codes: ['146000000'], group: 'segment' },
  { key: 'consumo', label: 'Consumer loans', short: 'Consumo', codes: ['148000000'], group: 'segment' },
  { key: 'bancos', label: 'Due from banks', short: 'Bancos', codes: ['143000000'], group: 'segment' },
];

export const CL_AQ_QUALITY = {
  /** TOTAL COLOCACIONES — gross, before `149000000` provisions. */
  loans: ['500000000'],
  npl90: ['857000000'],
  /** Offshore slice of the 90+ book: banks abroad + commercial loans abroad. */
  npl90Ext: ['857100200', '857200102'],
  impaired: ['811000000'],
  impairedExt: ['811100200', '811200102'],
  nonAccrual: ['812000000'],
  chargeOffs: ['813000000'],
  recoveries: ['814000000'],
  grossClient: ['821000000'],
  /** b1, reported negative. */
  allowance: ['149000000'],
  allowanceBySeg: {
    comercial: ['149500100'],
    vivienda: ['149600100'],
    consumo: ['149700100'],
    bancosPais: ['143150100'],
    bancosExt: ['143250100'],
  },
  grades: {
    normal: ['851000000', '854000000'],
    substandard: ['852000000'],
    default: ['853000000', '855000000'],
  },
};

export const CL_AQ_GRADES = [
  { key: 'normal', label: 'Normal (individual + grupal)', short: 'Normal', codes: CL_AQ_QUALITY.grades.normal },
  { key: 'substandard', label: 'Subestándar (individual)', short: 'Subestándar', codes: CL_AQ_QUALITY.grades.substandard },
  { key: 'default', label: 'Incumplimiento (individual + grupal)', short: 'Incumplimiento', codes: CL_AQ_QUALITY.grades.default },
];

export const CL_AQ_COLORS = {
  comercial: '#0d3b66',
  vivienda: '#0ea5e9',
  consumo: '#f59e0b',
  bancos: '#64748b',
  normal: '#16a34a',
  substandard: '#f59e0b',
  default: '#dc2626',
  npl: '#dc2626',
  impaired: '#b45309',
  nonAccrual: '#9a3412',
  offshore: '#7c3aed',
  allowance: '#0d9488',
};

export function clAqAccountsForRun() {
  return {
    b1: [...new Set([
      ...CL_AQ_QUALITY.loans,
      ...CL_AQ_INSTRUMENTS.flatMap((i) => i.codes),
      ...CL_AQ_QUALITY.allowance,
      ...Object.values(CL_AQ_QUALITY.allowanceBySeg).flat(),
    ])],
    c1: [...new Set([
      ...CL_AQ_QUALITY.npl90,
      ...CL_AQ_QUALITY.npl90Ext,
      ...CL_AQ_QUALITY.impaired,
      ...CL_AQ_QUALITY.impairedExt,
      ...CL_AQ_QUALITY.nonAccrual,
      ...CL_AQ_QUALITY.chargeOffs,
      ...CL_AQ_QUALITY.recoveries,
      ...CL_AQ_QUALITY.grossClient,
      ...CL_AQ_GRADES.flatMap((g) => g.codes),
    ])],
  };
}

export function clAqSnapshot(rowsB1, rowsC1, periodo) {
  const headline = aqSum(rowsB1, CL_AQ_QUALITY.loans, periodo);
  const segCodes = CL_AQ_INSTRUMENTS.flatMap((i) => i.codes);
  const segTotal = aqSum(rowsB1, segCodes, periodo);
  const useHeadline = headline > 0;
  const loans = useHeadline ? headline : segTotal;
  const ccy = (field) => aqSum(rowsB1, useHeadline ? CL_AQ_QUALITY.loans : segCodes, periodo, field);

  const segments = segmentRows(rowsB1, CL_AQ_INSTRUMENTS, periodo, loans, [
    ['clp', 'monto_clp'], ['uf', 'monto_uf'], ['tc', 'monto_tc'], ['ext', 'monto_ext'],
  ]);

  const npl = aqSum(rowsC1, CL_AQ_QUALITY.npl90, periodo);
  const nplExt = aqSum(rowsC1, CL_AQ_QUALITY.npl90Ext, periodo);
  const impaired = aqSum(rowsC1, CL_AQ_QUALITY.impaired, periodo);
  const impairedExt = aqSum(rowsC1, CL_AQ_QUALITY.impairedExt, periodo);
  const nonAccrual = aqSum(rowsC1, CL_AQ_QUALITY.nonAccrual, periodo);
  const chargeOffs = aqSum(rowsC1, CL_AQ_QUALITY.chargeOffs, periodo);
  const recoveries = aqSum(rowsC1, CL_AQ_QUALITY.recoveries, periodo);
  const allowance = Math.abs(aqSum(rowsB1, CL_AQ_QUALITY.allowance, periodo));

  const grades = CL_AQ_GRADES.map((g) => {
    const value = aqSum(rowsC1, g.codes, periodo);
    return { ...g, value };
  });
  const gradeTotal = grades.reduce((s, g) => s + g.value, 0);
  const gradeRows = grades.map((g) => ({ ...g, pct: aqPct(g.value, gradeTotal) }));
  const atRisk = gradeRows
    .filter((g) => g.key !== 'normal')
    .reduce((s, g) => s + g.value, 0);

  return {
    iso: 'CL',
    periodo,
    loans,
    net: loans - allowance,
    segments,
    fx: ccy('monto_ext'),
    fxPct: aqPct(ccy('monto_ext'), loans),
    uf: ccy('monto_uf'),
    ufPct: aqPct(ccy('monto_uf'), loans),
    npl,
    nplPct: aqPct(npl, loans),
    /** `857000000 = 0` is common for corporate/IB banks — never sell it as 0.00% NPL. */
    nplReported: npl > 0,
    nplExt,
    nplExtPct: aqPct(nplExt, npl),
    impaired,
    impairedPct: aqPct(impaired, loans),
    impairedExt,
    impairedExtPct: aqPct(impairedExt, impaired),
    nonAccrual,
    chargeOffs,
    recoveries,
    allowance,
    allowancePct: aqPct(allowance, loans),
    coverage: aqPct(allowance, npl),
    coverageImpaired: aqPct(allowance, impaired),
    grades: gradeRows,
    gradeTotal,
    atRisk,
    atRiskPct: aqPct(atRisk, gradeTotal),
    specialRows: gradeRows.map((g) => ({ key: g.key, label: g.label, value: g.value, pct: g.pct })),
    quality: [
      { key: 'npl', label: 'Mora 90+ días (857)', value: npl, pct: aqPct(npl, loans) },
      { key: 'impaired', label: 'Cartera deteriorada (811)', value: impaired, pct: aqPct(impaired, loans) },
      { key: 'nonAccrual', label: 'Devengo suspendido (812)', value: nonAccrual, pct: aqPct(nonAccrual, loans) },
      { key: 'offshore', label: '↳ deteriorada en el exterior (811…exterior)', value: impairedExt, pct: aqPct(impairedExt, loans) },
      { key: 'chargeOffs', label: 'Castigos (813)', value: chargeOffs, pct: aqPct(chargeOffs, loans) },
      { key: 'recoveries', label: 'Recuperaciones de castigados (814)', value: recoveries, pct: aqPct(recoveries, loans) },
      { key: 'allowance', label: 'Provisiones por riesgo de crédito (149)', value: allowance, pct: aqPct(allowance, loans) },
    ],
  };
}

// ============================================================
// COLOMBIA — SFC / CUIF. Full A–E risk grid already in b1 (blueprint §2.2).
// `140000` is NET of deterioro: Σ segments − Σ deterioro parents = 140000
// (Banco de Bogotá 2026-05: 95,551,223,086,367 − 4,375,346,174,720 = 91,175,876,911,647).
// Gross loans are therefore the sum of the segment accounts, not 140000.
// ============================================================

/**
 * Segment gross accounts and their A→E risk-category children.
 * CUIF publishes categories at `+05 / +10 / +15 / +20 / +25` under each segment;
 * they cross-foot to the segment total (verified on Banco de Bogotá 2026-05).
 */
export const CO_AQ_INSTRUMENTS = [
  {
    key: 'comercial',
    label: 'Commercial portfolio',
    short: 'Comercial',
    codes: ['141000'],
    grades: { A: '141005', B: '141010', C: '141015', D: '141020', E: '141025' },
    deterioro: ['149500'],
  },
  {
    key: 'consumo',
    label: 'Consumer portfolio',
    short: 'Consumo',
    codes: ['140800'],
    grades: { A: '140805', B: '140810', C: '140815', D: '140820', E: '140825' },
    deterioro: ['149100'],
  },
  {
    key: 'vivienda',
    label: 'Housing portfolio',
    short: 'Vivienda',
    codes: ['140400'],
    grades: { A: '140405', B: '140410', C: '140415', D: '140420', E: '140425' },
    deterioro: ['148900'],
  },
  {
    key: 'empleados',
    label: 'Loans to employees',
    short: 'Empleados',
    codes: ['141400'],
    grades: { A: '141405', B: '141410', C: '141415', D: '141420', E: '141425' },
    deterioro: ['148800'],
  },
  {
    key: 'microcredito',
    label: 'Microcredit portfolio',
    short: 'Microcrédito',
    codes: ['141200'],
    grades: { A: '141205', B: '141210', C: '141215', D: '141220', E: '141225' },
    deterioro: ['149300'],
  },
];

/**
 * Deterioro (allowance) parent accounts — the AQ-safe allowlist, owned by
 * coCuentas.js so the Bank Monitor NPL chart and this sheet share one definition.
 *
 * CUIF publishes parents and their `…05/10/15/20/25` children, so summing the
 * whole 148/149 family double counts (`148700 = 148705 + 148710` exactly). These
 * seven parents sum to the published total deterioro (Banco de Bogotá 2026-05:
 * 4,375,346,174,720). Blueprint §3.2.
 */
export const CO_AQ_DETERIORO_PARENTS = CO_DETERIORO_PARENT_CODES;

export const CO_AQ_GRADE_ORDER = ['A', 'B', 'C', 'D', 'E'];

export const CO_AQ_QUALITY = {
  /** CUIF `140000` — net of deterioro, kept for the gross↔net reconciliation. */
  loansNet: [CO_CUIF.colocaciones],
  deterioro: CO_AQ_DETERIORO_PARENTS,
  /** SFC "cartera de mayor riesgo" — categories C, D and E. */
  higherRisk: ['C', 'D', 'E'],
};

export const CO_AQ_COLORS = {
  comercial: '#0d3b66',
  consumo: '#f59e0b',
  vivienda: '#0ea5e9',
  empleados: '#0d9488',
  microcredito: '#7c3aed',
  A: '#16a34a',
  B: '#84cc16',
  C: '#f59e0b',
  D: '#ea580c',
  E: '#dc2626',
  npl: '#dc2626',
  allowance: '#0d9488',
};

export function coAqAccountsForRun() {
  return {
    b1: [...new Set([
      ...CO_AQ_QUALITY.loansNet,
      ...CO_AQ_INSTRUMENTS.flatMap((i) => i.codes),
      ...CO_AQ_INSTRUMENTS.flatMap((i) => Object.values(i.grades)),
      ...CO_AQ_INSTRUMENTS.flatMap((i) => i.deterioro),
      ...CO_AQ_DETERIORO_PARENTS,
    ])],
  };
}

/**
 * Deterioro numerator for Colombia, parent accounts only.
 *
 * Replaces the "every 148 / 149 account" sum that double counted parents and
 * children and left Colombia's NPL roughly 2× too high (blueprint §3.2).
 */
export function coAqMoraNumerator(rowsSameBank, periodo) {
  return coMoraNumerator(rowsSameBank || [], periodo);
}

export function coAqSnapshot(rowsB1, periodo) {
  const segCodes = CO_AQ_INSTRUMENTS.flatMap((i) => i.codes);
  const gross = aqSum(rowsB1, segCodes, periodo);
  const net = aqSum(rowsB1, CO_AQ_QUALITY.loansNet, periodo);
  const loans = gross > 0 ? gross : net;
  const allowance = coAqMoraNumerator(rowsB1, periodo);

  const segments = CO_AQ_INSTRUMENTS.map((def) => {
    const value = aqSum(rowsB1, def.codes, periodo);
    const grades = CO_AQ_GRADE_ORDER.map((g) => ({
      grade: g,
      value: aqSum(rowsB1, [def.grades[g]], periodo),
    }));
    const gradeTotal = grades.reduce((s, g) => s + g.value, 0);
    const higherRisk = grades
      .filter((g) => CO_AQ_QUALITY.higherRisk.includes(g.grade))
      .reduce((s, g) => s + g.value, 0);
    return {
      ...def,
      value,
      pct: aqPct(value, loans),
      grades,
      gradeTotal,
      /** true when A–E cross-foots to the segment total (±1%) — else indicative. */
      gradeTie: value > 0 && Math.abs(gradeTotal - value) <= value * 0.01,
      higherRisk,
      higherRiskPct: aqPct(higherRisk, value),
      deterioroValue: aqSum(rowsB1, def.deterioro, periodo),
    };
  });

  const gradeTotals = CO_AQ_GRADE_ORDER.map((g) => {
    const value = segments.reduce(
      (s, seg) => s + (seg.grades.find((x) => x.grade === g)?.value || 0),
      0,
    );
    return { grade: g, value };
  });
  const gridTotal = gradeTotals.reduce((s, g) => s + g.value, 0);
  const npl = gradeTotals
    .filter((g) => CO_AQ_QUALITY.higherRisk.includes(g.grade))
    .reduce((s, g) => s + g.value, 0);
  const hasGrid = gridTotal > 0;

  return {
    iso: 'CO',
    periodo,
    loans,
    gross,
    net,
    segments,
    fx: null,
    fxPct: null, // CUIF carries no currency split on the loan book
    npl: hasGrid ? npl : null,
    nplPct: hasGrid ? aqPct(npl, loans) : null,
    nplReported: hasGrid,
    allowance,
    allowancePct: aqPct(allowance, loans),
    coverage: hasGrid ? aqPct(allowance, npl) : null,
    hasGrid,
    gradeTotals: gradeTotals.map((g) => ({ ...g, pct: aqPct(g.value, gridTotal) })),
    gridTotal,
    specialRows: gradeTotals.map((g) => ({
      key: g.grade,
      label: `Category ${g.grade}`,
      value: g.value,
      pct: aqPct(g.value, gridTotal),
    })),
    quality: [
      { key: 'higherRisk', label: 'Cartera de mayor riesgo (C+D+E)', value: hasGrid ? npl : null, pct: hasGrid ? aqPct(npl, loans) : null },
      { key: 'allowance', label: 'Deterioro total (parent accounts only)', value: allowance, pct: aqPct(allowance, loans) },
      { key: 'gross', label: 'Gross portfolio (Σ segments)', value: gross, pct: aqPct(gross, loans) },
      { key: 'net', label: 'Net portfolio (CUIF 140000)', value: net, pct: aqPct(net, loans) },
    ],
  };
}

// ============================================================
// PERU — SBS B-2201 slugs, already loaded (blueprint §2.3).
// Allowance is derived as gross − net: the published `PROVISIONES` balance line
// is a scrape artefact (−3,774,467 for BBVA against a ~3.8 bn allowance).
// ============================================================

export const PE_AQ_LADDER = [
  { key: 'vigentes', label: 'Current (vigentes)', short: 'Vigentes', codes: ['VIGENTES'], stage: 'performing' },
  { key: 'refinanciados', label: 'Refinanced / restructured', short: 'Refin.', codes: ['REFINANCIADOS_Y_REESTRUCTURADOS'], stage: 'watch' },
  { key: 'atrasados', label: 'Past due (atrasados)', short: 'Atrasados', codes: ['ATRASADOS'], stage: 'npl' },
];

export const PE_AQ_INSTRUMENTS = [
  { key: 'prestamos', label: 'Loans', short: 'Préstamos', codes: ['PRESTAMOS'] },
  { key: 'hipotecarios', label: 'Mortgages', short: 'Hipotecarios', codes: ['HIPOTECARIOS_PARA_VIVIENDA'] },
  { key: 'tarjetas', label: 'Credit cards', short: 'Tarjetas', codes: ['TARJETAS_DE_CREDITO'] },
  { key: 'leasing', label: 'Financial leasing', short: 'Leasing', codes: ['ARRENDAMIENTO_FINANCIERO'] },
  { key: 'comercioExterior', label: 'Trade finance', short: 'Comercio ext.', codes: ['COMERCIO_EXTERIOR'] },
  { key: 'descuentos', label: 'Discounts', short: 'Descuentos', codes: ['DESCUENTOS'] },
  { key: 'factoring', label: 'Factoring', short: 'Factoring', codes: ['FACTORING'] },
];

export const PE_AQ_QUALITY = {
  gross: ['VIGENTES', 'REFINANCIADOS_Y_REESTRUCTURADOS', 'ATRASADOS'],
  net: [PE_KPI.colocaciones],
  npl: ['ATRASADOS'],
  judicial: ['EN_COBRANZA_JUDICIAL'],
  highRisk: ['REFINANCIADOS_Y_REESTRUCTURADOS', 'ATRASADOS'],
};

export const PE_AQ_COLORS = {
  vigentes: '#16a34a',
  refinanciados: '#f59e0b',
  atrasados: '#dc2626',
  judicial: '#9a3412',
  prestamos: '#0d3b66',
  hipotecarios: '#0ea5e9',
  tarjetas: '#f59e0b',
  leasing: '#0d9488',
  comercioExterior: '#7c3aed',
  descuentos: '#64748b',
  factoring: '#a8a29e',
  other: '#cbd5e1',
  npl: '#dc2626',
  allowance: '#0d9488',
};

export function peAqAccountsForRun() {
  return {
    b1: [...new Set([
      ...PE_AQ_QUALITY.gross,
      ...PE_AQ_QUALITY.net,
      ...PE_AQ_QUALITY.judicial,
      ...PE_AQ_INSTRUMENTS.flatMap((i) => i.codes),
    ])],
  };
}

export function peAqSnapshot(rowsB1, periodo) {
  const gross = aqSum(rowsB1, PE_AQ_QUALITY.gross, periodo);
  const net = aqSum(rowsB1, PE_AQ_QUALITY.net, periodo);
  const npl = aqSum(rowsB1, PE_AQ_QUALITY.npl, periodo);
  const judicial = aqSum(rowsB1, PE_AQ_QUALITY.judicial, periodo);
  const highRisk = aqSum(rowsB1, PE_AQ_QUALITY.highRisk, periodo);
  const allowance = gross > 0 && net > 0 ? Math.max(0, gross - net) : 0;

  const named = segmentRows(rowsB1, PE_AQ_INSTRUMENTS, periodo, gross);
  const namedTotal = named.reduce((s, i) => s + i.value, 0);
  // `CREDITOS_POR_LIQUIDAR` and other unmapped slugs leave a real residual —
  // show it rather than forcing the mix to 100%.
  const other = Math.max(0, gross - namedTotal);
  const segments = other > 0
    ? [...named, { key: 'other', label: 'Other / unallocated', short: 'Other', codes: [], value: other, pct: aqPct(other, gross) }]
    : named;

  const ladder = PE_AQ_LADDER.map((def) => {
    const value = aqSum(rowsB1, def.codes, periodo);
    return { ...def, value, pct: aqPct(value, gross) };
  });

  return {
    iso: 'PE',
    periodo,
    loans: gross,
    gross,
    net,
    segments,
    fx: null,
    fxPct: null, // SBS B-2201 carries no currency split (monto_ext is 0 for PE)
    npl,
    nplPct: aqPct(npl, gross),
    nplReported: gross > 0,
    judicial,
    judicialPct: aqPct(judicial, npl),
    highRisk,
    highRiskPct: aqPct(highRisk, gross),
    allowance,
    allowancePct: aqPct(allowance, gross),
    coverage: aqPct(allowance, npl),
    ladder,
    specialRows: [
      ...ladder.map((l) => ({ key: l.key, label: l.label, value: l.value, pct: l.pct })),
      { key: 'judicial', label: '↳ in judicial collection', value: judicial, pct: aqPct(judicial, gross) },
    ],
    quality: [
      { key: 'atrasados', label: 'Past due (atrasados)', value: npl, pct: aqPct(npl, gross) },
      { key: 'judicial', label: '↳ in judicial collection', value: judicial, pct: aqPct(judicial, gross) },
      { key: 'highRisk', label: 'Cartera de alto riesgo (atrasados + refinanciados)', value: highRisk, pct: aqPct(highRisk, gross) },
      { key: 'allowance', label: 'Allowance (derived: gross − net)', value: allowance, pct: aqPct(allowance, gross) },
      { key: 'net', label: 'Loans net of provisions', value: net, pct: aqPct(net, gross) },
    ],
  };
}

// ============================================================
// URUGUAY — BCU Anexo 2 stocks (`A2_*`, tipo b1) + Anexo 4 ratios (`A4_*`, tipo q1).
// Emitted by uruguay_loader.py. `A2_1_1` (BCU placements) is deliberately absent:
// Anexo 2 row 11 excludes it, and central-bank placements are liquidity, not credit.
// Blueprint §1.2 / §4.3.
// ============================================================

export const UY_AQ_INSTRUMENTS = [
  { key: 'snfPrivRes', label: 'Private non-financial — resident', short: 'SNF res.', codes: ['A2_1_3'], group: 'domestic', special: false },
  { key: 'snfPrivNoRes', label: 'Private non-financial — NON-RESIDENT', short: 'No res.', codes: ['A2_1_4'], group: 'foreign', special: true },
  { key: 'snfPub', label: 'Public non-financial', short: 'SNF púb.', codes: ['A2_1_5'], group: 'domestic', special: false },
  { key: 'sfLocal', label: 'Financial sector — domestic banks', short: 'SF país', codes: ['A2_1_2_3'], group: 'domestic', special: false },
  { key: 'sfExtVinc', label: 'Foreign FIs — related (vinculadas)', short: 'Ext. vinc.', codes: ['A2_1_2_4'], group: 'foreign', special: true },
  { key: 'sfExtNoVinc', label: 'Foreign FIs — unrelated (no vinculadas)', short: 'Ext. n/v', codes: ['A2_1_2_5'], group: 'foreign', special: true },
  { key: 'vencidos', label: 'Overdue (vencidos)', short: 'Vencidos', codes: ['A2_2_2'], group: 'npl', special: false },
];

export const UY_AQ_LADDER = [
  { key: 'colocacionVencida', label: 'Colocación vencida', short: 'Vencida', codes: ['A2_2_2_1'] },
  { key: 'enGestion', label: 'Créditos en gestión', short: 'En gestión', codes: ['A2_2_2_2'] },
  { key: 'morosos', label: 'Créditos morosos', short: 'Morosos', codes: ['A2_2_2_3'] },
];

export const UY_AQ_QUALITY = {
  /** Anexo 2 row 9 — gross credit including vencidos. */
  gross: ['A2_GROSS'],
  vencidos: ['A2_2_2'],
  ladder: UY_AQ_LADDER.flatMap((l) => l.codes),
  /** Anexo 2 row 10 `(Deterioro)`, reported negative. */
  allowance: ['A2_D_TOTAL'],
  /** SNF gross denominator behind BCU's own IV.1 / VII.1 / VII.5. */
  snf: ['A2_1_3', 'A2_1_4', 'A2_1_5', 'A2_2_2'],
  nonResident: ['A2_1_4'],
  foreignFis: ['A2_1_2_4', 'A2_1_2_5'],
};

/** Anexo 4 — BCU's own published ratios, tipo `q1`, percent ×100. */
export const UY_AQ_RATIOS = {
  nonResident: 'A4_VII_5', // Créditos a no residentes / Total créditos brutos SNF
  npl: 'A4_IV_1', // Morosidad
  fxLoans: 'A4_VII_1', // Dolarización de créditos brutos SNF
  coverage: 'A4_I_2', // Deterioro de créditos vencidos brutos totales
  impairment: 'A4_IV_3', // Grado de deterioro total
};

export const UY_AQ_COLORS = {
  snfPrivRes: '#0d3b66',
  snfPrivNoRes: '#7c3aed',
  snfPub: '#0ea5e9',
  sfLocal: '#0d9488',
  sfExtVinc: '#c026d3',
  sfExtNoVinc: '#a855f7',
  vencidos: '#dc2626',
  colocacionVencida: '#f59e0b',
  enGestion: '#ea580c',
  morosos: '#dc2626',
  npl: '#dc2626',
  allowance: '#0d9488',
  fxShare: '#2563eb',
  localShare: '#0d9488',
};

export function uyAqAccountsForRun() {
  return {
    b1: [...new Set([
      ...UY_AQ_INSTRUMENTS.flatMap((i) => i.codes),
      ...UY_AQ_QUALITY.gross,
      ...UY_AQ_QUALITY.ladder,
      ...UY_AQ_QUALITY.allowance,
      ...UY_AQ_QUALITY.snf,
    ])],
    q1: [...new Set(Object.values(UY_AQ_RATIOS))],
  };
}

/**
 * Uruguay snapshot: Anexo 2 stocks with the residency × currency cross-tab, plus
 * BCU's published Anexo 4 ratios shown alongside.
 *
 * The stock-based non-resident share uses `A2_1_4`, which is *performing*
 * non-resident credit only — Anexo 2 does not split vencidos by residency, so
 * BCU's VII.5 is marginally higher. Both numbers are returned; the UI labels the
 * stock one "performing (Anexo 2)". Blueprint §1.3.
 */
export function uyAqSnapshot(rowsB1, rowsQ1, periodo) {
  const gross = aqSum(rowsB1, UY_AQ_QUALITY.gross, periodo);
  const snf = aqSum(rowsB1, UY_AQ_QUALITY.snf, periodo);
  const instCodes = UY_AQ_INSTRUMENTS.flatMap((i) => i.codes);
  const instTotal = aqSum(rowsB1, instCodes, periodo);
  const loans = gross > 0 ? gross : instTotal;

  const segments = segmentRows(rowsB1, UY_AQ_INSTRUMENTS, periodo, loans, [
    ['local', 'monto_clp'], ['ext', 'monto_ext'],
  ]).map((s) => ({ ...s, fxPct: aqPct(s.ext, s.value) }));

  const ext = aqSum(rowsB1, instCodes, periodo, 'monto_ext');
  const local = aqSum(rowsB1, instCodes, periodo, 'monto_clp');
  const snfExt = aqSum(rowsB1, UY_AQ_QUALITY.snf, periodo, 'monto_ext');

  const nonResident = aqSum(rowsB1, UY_AQ_QUALITY.nonResident, periodo);
  const nonResidentExt = aqSum(rowsB1, UY_AQ_QUALITY.nonResident, periodo, 'monto_ext');
  const privateAndPublic = aqSum(rowsB1, ['A2_1_3', 'A2_1_4', 'A2_1_5'], periodo);
  const foreignFis = aqSum(rowsB1, UY_AQ_QUALITY.foreignFis, periodo);

  const vencidos = aqSum(rowsB1, UY_AQ_QUALITY.vencidos, periodo);
  const allowance = Math.abs(aqSum(rowsB1, UY_AQ_QUALITY.allowance, periodo));
  const ladder = UY_AQ_LADDER.map((def) => {
    const value = aqSum(rowsB1, def.codes, periodo);
    return {
      ...def,
      value,
      pct: aqPct(value, vencidos),
      local: aqSum(rowsB1, def.codes, periodo, 'monto_clp'),
      ext: aqSum(rowsB1, def.codes, periodo, 'monto_ext'),
    };
  });

  const denom = snf > 0 ? snf : privateAndPublic;
  const published = {
    nonResident: aqPickQ1(rowsQ1, UY_AQ_RATIOS.nonResident, periodo),
    npl: aqPickQ1(rowsQ1, UY_AQ_RATIOS.npl, periodo),
    fxLoans: aqPickQ1(rowsQ1, UY_AQ_RATIOS.fxLoans, periodo),
    coverage: aqPickQ1(rowsQ1, UY_AQ_RATIOS.coverage, periodo),
    impairment: aqPickQ1(rowsQ1, UY_AQ_RATIOS.impairment, periodo),
  };

  const nonResidentPct = aqPct(nonResident, privateAndPublic);
  const fxPct = aqPct(ext, loans);

  return {
    iso: 'UY',
    periodo,
    loans,
    gross,
    snf,
    net: loans - allowance,
    segments,
    local,
    ext,
    fx: ext,
    fxPct,
    /** BCU VII.1 is computed on SNF gross, not on total credit — keep both. */
    fxSnfPct: aqPct(snfExt, snf),
    npl: vencidos,
    nplPct: aqPct(vencidos, denom),
    nplReported: loans > 0,
    allowance,
    allowancePct: aqPct(allowance, loans),
    coverage: aqPct(allowance, vencidos),
    nonResident,
    nonResidentExt,
    nonResidentExtPct: aqPct(nonResidentExt, nonResident),
    /** Stock-based, performing non-resident credit only (Anexo 2 `1.4`). */
    nonResidentPct,
    /**
     * Like-for-like rebuild of BCU's VII.5: same numerator, but over SNF gross
     * *including* vencidos, which is the denominator the regulator uses.
     */
    nonResidentSnfPct: aqPct(nonResident, denom),
    foreignFis,
    foreignFisPct: aqPct(foreignFis, loans),
    published,
    hasPublished: Object.values(published).some((v) => v != null),
    ladder,
    specialRows: segments
      .filter((s) => s.key !== 'vencidos')
      .map((s) => ({
        key: s.key,
        label: s.label,
        value: s.value,
        pct: s.pct,
        local: s.local,
        ext: s.ext,
        fxPct: s.fxPct,
        foreign: s.group === 'foreign',
      })),
    quality: [
      { key: 'vencidos', label: 'Créditos vencidos (Anexo 2 · 2.2)', value: vencidos, pct: aqPct(vencidos, denom) },
      ...ladder.map((l) => ({ key: l.key, label: `↳ ${l.label}`, value: l.value, pct: aqPct(l.value, denom) })),
      { key: 'allowance', label: 'Deterioro total (Anexo 2 · row 10)', value: allowance, pct: aqPct(allowance, loans) },
      { key: 'nonResident', label: 'Non-resident credit — performing (1.4)', value: nonResident, pct: nonResidentPct },
      { key: 'foreignFis', label: 'Exposure to foreign FIs (1.2.4 + 1.2.5)', value: foreignFis, pct: aqPct(foreignFis, loans) },
    ],
  };
}

// ============================================================
// BRAZIL — Bacen IF.data. Cosif stocks in dados_1 + SCR credit in dados_3.
// Inadimplência / C1–C5 lids appear from 202412 (Res. 4557). Exterior +
// geography go back to 201403. Blueprint §2.4.
// ============================================================

/** SCR report-130 / 126 lids (stored as cuenta strings, tipo='p'). */
export const BR_AQ_SCR = {
  totalGeral: ['24454'],
  exterior: ['23383'],
  totalScr: ['23382'],
  inadimplencia: ['148834'],
  problematicos: ['148833'],
  c1: ['148835'],
  c2: ['148836'],
  c3: ['148837'],
  c4: ['148838'],
  c5: ['148839'],
  naoInformada: ['149385'],
};

/** Cosif accounting book (dados_1) — gross / provision / net. */
export const BR_AQ_COSIF = {
  loansClassified: ['78183', '141873'],
  opsCredito: ['78191'],
  provision: ['78192', '145832'],
  net: ['78193'],
  grossIfrs: ['145831'],
};

/** Regional mix (report 126) — available for the full prudential history. */
export const BR_AQ_INSTRUMENTS = [
  { key: 'sudeste', label: 'Southeast (Sudeste)', short: 'Sudeste', codes: ['23358'], group: 'domestic' },
  { key: 'sul', label: 'South (Sul)', short: 'Sul', codes: ['23362'], group: 'domestic' },
  { key: 'nordeste', label: 'Northeast (Nordeste)', short: 'Nordeste', codes: ['23360'], group: 'domestic' },
  { key: 'centroOeste', label: 'Central-West (Centro-oeste)', short: 'Centro-Oeste', codes: ['23359'], group: 'domestic' },
  { key: 'norte', label: 'North (Norte)', short: 'Norte', codes: ['23361'], group: 'domestic' },
  { key: 'naoInformada', label: 'Region not reported', short: 'N/D', codes: ['24449'], group: 'other' },
  { key: 'exterior', label: 'Overseas (Exterior)', short: 'Exterior', codes: ['23383'], group: 'foreign' },
];

/** C1–C5 active-portfolio characteristics (report 130 · from 202412). */
export const BR_AQ_C_LADDER = [
  { key: 'c1', label: 'C1', short: 'C1', codes: BR_AQ_SCR.c1 },
  { key: 'c2', label: 'C2', short: 'C2', codes: BR_AQ_SCR.c2 },
  { key: 'c3', label: 'C3', short: 'C3', codes: BR_AQ_SCR.c3 },
  { key: 'c4', label: 'C4', short: 'C4', codes: BR_AQ_SCR.c4 },
  { key: 'c5', label: 'C5', short: 'C5', codes: BR_AQ_SCR.c5 },
];

export const BR_AQ_COLORS = {
  sudeste: '#0d3b66',
  sul: '#0284c7',
  nordeste: '#0ea5e9',
  centroOeste: '#0d9488',
  norte: '#14b8a6',
  naoInformada: '#94a3b8',
  exterior: '#b45309',
  c1: '#16a34a',
  c2: '#84cc16',
  c3: '#f59e0b',
  c4: '#ea580c',
  c5: '#dc2626',
  npl: '#dc2626',
  problematicos: '#9a3412',
  allowance: '#0d9488',
};

export function brAqAccountsForRun() {
  return {
    // API remaps any tipo → 'p' for BR.
    b1: [...new Set([
      ...BR_AQ_SCR.totalGeral,
      ...BR_AQ_SCR.exterior,
      ...BR_AQ_SCR.totalScr,
      ...BR_AQ_SCR.inadimplencia,
      ...BR_AQ_SCR.problematicos,
      ...BR_AQ_SCR.naoInformada,
      ...BR_AQ_C_LADDER.flatMap((c) => c.codes),
      ...BR_AQ_INSTRUMENTS.flatMap((i) => i.codes),
      ...BR_AQ_COSIF.loansClassified,
      ...BR_AQ_COSIF.opsCredito,
      ...BR_AQ_COSIF.provision,
      ...BR_AQ_COSIF.net,
      ...BR_AQ_COSIF.grossIfrs,
    ])],
  };
}

export function brAqSnapshot(rowsB1, periodo) {
  const scrTotal = aqSum(rowsB1, BR_AQ_SCR.totalGeral, periodo);
  const cosifLoans = aqSum(rowsB1, BR_AQ_COSIF.loansClassified, periodo);
  const loans = scrTotal > 0 ? scrTotal : cosifLoans;
  const exterior = aqSum(rowsB1, BR_AQ_SCR.exterior, periodo);
  const inad = aqSum(rowsB1, BR_AQ_SCR.inadimplencia, periodo);
  const problematicos = aqSum(rowsB1, BR_AQ_SCR.problematicos, periodo);
  const allowance = Math.abs(aqSum(rowsB1, BR_AQ_COSIF.provision, periodo));
  const hasScrQuality = inad > 0 || problematicos > 0
    || BR_AQ_C_LADDER.some((c) => aqSum(rowsB1, c.codes, periodo) > 0);

  const segments = segmentRows(rowsB1, BR_AQ_INSTRUMENTS, periodo, loans);
  const cLadder = BR_AQ_C_LADDER.map((def) => {
    const value = aqSum(rowsB1, def.codes, periodo);
    return { ...def, value, pct: aqPct(value, loans) };
  });
  const cTotal = cLadder.reduce((s, g) => s + g.value, 0);

  return {
    iso: 'BR',
    periodo,
    loans,
    scrTotal,
    cosifLoans,
    net: loans - allowance,
    segments,
    fx: exterior,
    fxPct: aqPct(exterior, loans),
    npl: inad,
    nplPct: aqPct(inad, loans),
    /** True only when SCR Inadimplência is populated (typically ≥202412). */
    nplReported: inad > 0 || hasScrQuality,
    problematicos,
    problematicosPct: aqPct(problematicos, loans),
    /** False when big peers leave the column blank — never treat 0 as "clean". */
    problematicosReported: problematicos > 0,
    allowance,
    allowancePct: aqPct(allowance, cosifLoans > 0 ? cosifLoans : loans),
    coverage: aqPct(allowance, inad > 0 ? inad : null),
    hasScrQuality,
    cLadder,
    cTotal,
    specialRows: [
      { key: 'domestic', label: 'Domestic SCR book (Total Geral − Exterior)', value: Math.max(0, loans - exterior), pct: aqPct(Math.max(0, loans - exterior), loans) },
      { key: 'exterior', label: 'Overseas loans (Total Exterior)', value: exterior, pct: aqPct(exterior, loans), foreign: true },
    ],
    quality: [
      { key: 'inad', label: 'Inadimplência (SCR · Res. 4557)', value: inad, pct: aqPct(inad, loans) },
      { key: 'problematicos', label: 'Ativos problemáticos (SCR)', value: problematicos, pct: aqPct(problematicos, loans) },
      ...cLadder.map((c) => ({ key: c.key, label: c.label, value: c.value, pct: c.pct })),
      { key: 'allowance', label: 'Cosif provision / expected loss', value: allowance, pct: aqPct(allowance, cosifLoans > 0 ? cosifLoans : loans) },
      { key: 'cosifLoans', label: 'Cosif classified loan book', value: cosifLoans, pct: null },
    ],
  };
}

// ============================================================
// UNITED STATES — FDIC BankFind financials (Call Report aggregates).
// No non-resident / FX lens. Special lens = past-due ladder.
// Blueprint §2.7.
// ============================================================

export const US_AQ_QUALITY = {
  loans: ['LNLS'],
  loansNet: ['LNLSNET'],
  npl: ['NCLNLS'],
  allowance: ['LNATRES'],
  pastDue30: ['P3ASSET'],
  pastDue90Accruing: ['P9ASSET'],
  chargeOffsQ: ['NTLNLSQ'],
  provisionExp: ['ELNATR'],
};

export const US_AQ_RATIOS = {
  npl: 'NCLNLSR',
  coverage: 'LNRESNCR',
  allowancePct: 'LNATRESR',
};

/** Mutually exclusive-ish sector mix (residual = LNLS − Σ). LNCRCD/LNAUTO nest under consumer. */
export const US_AQ_INSTRUMENTS = [
  { key: 're', label: 'Real estate', short: 'RE', codes: ['LNRE'], group: 'sector' },
  { key: 'ci', label: 'Commercial & industrial', short: 'C&I', codes: ['LNCI'], group: 'sector' },
  { key: 'con', label: 'Consumer', short: 'Consumer', codes: ['LNCON'], group: 'sector' },
  { key: 'ag', label: 'Agricultural', short: 'Ag', codes: ['LNAG'], group: 'sector' },
  { key: 'dep', label: 'Depository institutions', short: 'Banks', codes: ['LNDEP'], group: 'sector' },
  { key: 'muni', label: 'Municipal', short: 'Muni', codes: ['LNMUNI'], group: 'sector' },
  { key: 'fg', label: 'Foreign governments', short: 'FG', codes: ['LNFG'], group: 'sector' },
];

export const US_AQ_PASTDUE = [
  { key: 'pd30', label: '30–89 days past due (assets)', short: '30–89d', codes: ['P3ASSET'] },
  { key: 'pd90', label: '90+ days past due still accruing', short: '90+ accruing', codes: ['P9ASSET'] },
  { key: 'ncl', label: 'Noncurrent loans & leases', short: 'Noncurrent', codes: ['NCLNLS'] },
];

export const US_AQ_COLORS = {
  re: '#0d3b66',
  ci: '#0284c7',
  con: '#f59e0b',
  ag: '#16a34a',
  dep: '#64748b',
  muni: '#0d9488',
  fg: '#b45309',
  residual: '#94a3b8',
  pd30: '#f59e0b',
  pd90: '#ea580c',
  ncl: '#dc2626',
  npl: '#dc2626',
  allowance: '#0d9488',
};

export function usAqAccountsForRun() {
  return {
    b1: [...new Set([
      ...US_AQ_QUALITY.loans,
      ...US_AQ_QUALITY.loansNet,
      ...US_AQ_QUALITY.npl,
      ...US_AQ_QUALITY.allowance,
      ...US_AQ_QUALITY.pastDue30,
      ...US_AQ_QUALITY.pastDue90Accruing,
      ...US_AQ_INSTRUMENTS.flatMap((i) => i.codes),
      'LNCRCD', 'LNAUTO',
    ])],
    r1: [...US_AQ_QUALITY.chargeOffsQ, ...US_AQ_QUALITY.provisionExp],
    q1: Object.values(US_AQ_RATIOS),
  };
}

export function usAqSnapshot(rowsB1, rowsR1, rowsQ1, periodo) {
  const loans = aqSum(rowsB1, US_AQ_QUALITY.loans, periodo);
  const loansNet = aqSum(rowsB1, US_AQ_QUALITY.loansNet, periodo);
  const npl = aqSum(rowsB1, US_AQ_QUALITY.npl, periodo);
  const allowance = Math.abs(aqSum(rowsB1, US_AQ_QUALITY.allowance, periodo));
  const pd30 = aqSum(rowsB1, US_AQ_QUALITY.pastDue30, periodo);
  const pd90 = aqSum(rowsB1, US_AQ_QUALITY.pastDue90Accruing, periodo);
  const nco = aqSum(rowsR1, US_AQ_QUALITY.chargeOffsQ, periodo);
  const provExp = aqSum(rowsR1, US_AQ_QUALITY.provisionExp, periodo);

  const segments = segmentRows(rowsB1, US_AQ_INSTRUMENTS, periodo, loans);
  const segSum = segments.reduce((s, g) => s + g.value, 0);
  const residual = Math.max(0, loans - segSum);
  if (residual > loans * 0.001) {
    segments.push({
      key: 'residual',
      label: 'Other / residual',
      short: 'Other',
      codes: [],
      group: 'other',
      value: residual,
      pct: aqPct(residual, loans),
    });
  }

  const published = {
    npl: aqPickQ1(rowsQ1, US_AQ_RATIOS.npl, periodo),
    coverage: aqPickQ1(rowsQ1, US_AQ_RATIOS.coverage, periodo),
    allowancePct: aqPickQ1(rowsQ1, US_AQ_RATIOS.allowancePct, periodo),
  };

  const pastDueRows = US_AQ_PASTDUE.map((d) => {
    const value = aqSum(rowsB1, d.codes, periodo);
    return { ...d, value, pct: aqPct(value, loans) };
  });

  return {
    iso: 'US',
    periodo,
    loans,
    loansNet,
    net: loansNet > 0 ? loansNet : loans - allowance,
    segments,
    fx: 0,
    fxPct: null,
    npl,
    nplPct: aqPct(npl, loans),
    // Call Report always carries NCLNLS when LNLS is present — including a true zero.
    nplReported: loans > 0,
    allowance,
    allowancePct: aqPct(allowance, loans),
    coverage: aqPct(allowance, npl > 0 ? npl : null),
    pd30,
    pd90,
    nco,
    provExp,
    costOfRisk: aqPct(provExp, loans),
    published,
    hasPublished: Object.values(published).some((v) => v != null),
    specialRows: pastDueRows,
    quality: [
      { key: 'npl', label: 'Noncurrent loans & leases', value: npl, pct: aqPct(npl, loans) },
      { key: 'pd30', label: '30–89 days past due (assets)', value: pd30, pct: aqPct(pd30, loans) },
      { key: 'pd90', label: '90+ days past due still accruing', value: pd90, pct: aqPct(pd90, loans) },
      { key: 'allowance', label: 'Allowance for credit losses', value: allowance, pct: aqPct(allowance, loans) },
      { key: 'nco', label: 'Net charge-offs (quarter)', value: nco, pct: aqPct(nco, loans) },
      { key: 'prov', label: 'Provision expense', value: provExp, pct: aqPct(provExp, loans) },
      { key: 'cards', label: 'Credit cards (detail)', value: aqSum(rowsB1, ['LNCRCD'], periodo), pct: aqPct(aqSum(rowsB1, ['LNCRCD'], periodo), loans) },
      { key: 'auto', label: 'Auto loans (detail)', value: aqSum(rowsB1, ['LNAUTO'], periodo), pct: aqPct(aqSum(rowsB1, ['LNAUTO'], periodo), loans) },
    ],
  };
}
