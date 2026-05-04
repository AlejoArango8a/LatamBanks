// ============================================================
// Colombia CUIF — 6 dígitos (clasificación financiera típica SFC)
// Derivado de datos reales datos_financieros CO (prioridad cobertura b1/r1).
// ============================================================
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

/** P&L — cuentas r1 (6 dígitos); paralelo al detalle Chile (520…590). */
export const R1_CO_ROWS = [
  { l: 'Net interest income', c: '520000', cls: '' },
  { l: 'Net monetary correction (UVR / similar)', c: '525000', cls: '' },
  { l: 'Net fee and commission income', c: '530000', cls: '' },
  { l: 'Net financial result', c: '540000', cls: '' },
  { l: 'Total operating income', c: '550000', cls: 'hl' },
  { l: 'Personnel expenses', c: '462000', cls: 'i1' },
  { l: 'Administrative expenses', c: '464000', cls: 'i1' },
  { l: 'Total operating expenses', c: '560000', cls: 'hl' },
  { l: 'Operating result before credit losses', c: '570000', cls: '' },
  { l: 'Credit loss expense', c: '470000', cls: 'i1' },
  { l: 'Operating result', c: '580000', cls: 'hl' },
  { l: 'Income tax', c: '480000', cls: 'i1' },
  { l: 'Net income (loss)', c: '590000', cls: 'hl' },
];

/** b1/r1 únicos a pedir en run() Colombia — mantener sync con las tablas anteriores. */
export function coB1AccountsForRun() {
  const all = [
    ...BAL_CO_SECTIONS.assets.map(r => r.c),
    ...BAL_CO_SECTIONS.liabilities.map(r => r.c),
    ...BAL_CO_SECTIONS.equity.map(r => r.c),
  ];
  return [...new Set(all)];
}

export function coR1AccountsForRun() {
  return [...new Set(R1_CO_ROWS.map(r => r.c))];
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
