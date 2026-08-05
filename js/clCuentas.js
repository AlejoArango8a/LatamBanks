// ============================================================
// Chile — CMF Balance de Bancos (MB1 / MR1)
// Funding / ALM instrument maps for Funding Analytics.
// ============================================================
// Hierarchy: 9-digit CMF codes. Currency is a COLUMN (CLP / UF / TC / EXT),
// not a separate account — every liability already carries the four-way split.
//
// No Brazil-style tax-exempt bank letters (LCI/LCA). Chile-specific ALM lenses:
//   1) UF-indexation share of funding
//   2) FX (monto_ext) share
//   3) Per-instrument interest expense (412*) ÷ stock
// ============================================================

export const CL_KPI = {
  activos: ['100000000'],
  colocaciones: ['500000000'],
  pasivos: ['200000000'],
  patrimonio: ['300000000'],
  utilidad: ['590000000'],
  depVista: ['241000000'],
  depPlazo: ['242000000'],
  bonos: ['245000000'],
  repos: ['243000000'],
  bancos: ['244000000'],
  letras: ['245000100'],
  bonosCorrientes: ['245000201'],
  subordinados: ['255000100'],
  at1: ['255000200'],
  fundingOrdinary: ['241000000', '242000000', '243000000', '244000000', '245000000'],
};

/** Mutually exclusive funding stack (do not also sum parents). */
export const CL_FUNDING_INSTRUMENTS = [
  { key: 'cuentaCorriente', label: 'Current accounts', short: 'Cta cte', codes: ['241000100'], group: 'deposits', special: false },
  { key: 'ahorroVista', label: 'Sight savings', short: 'Ahorro vista', codes: ['241000201'], group: 'deposits', special: false },
  { key: 'otrasVista', label: 'Other sight liabilities', short: 'Otras vista', codes: ['241000202', '241000300', '241000400', '241000500'], group: 'deposits', special: false },
  { key: 'depPlazo', label: 'Time deposits', short: 'Plazo', codes: ['242000100'], group: 'deposits', special: false },
  { key: 'ahorroPlazo', label: 'Term savings', short: 'Ahorro plazo', codes: ['242000200'], group: 'deposits', special: false },
  { key: 'otrosPlazo', label: 'Other term balances', short: 'Otros plazo', codes: ['242000300'], group: 'deposits', special: false },
  { key: 'repos', label: 'Repos / securities lending', short: 'Repos', codes: ['243000000'], group: 'wholesale', special: false },
  { key: 'bancos', label: 'Due to banks', short: 'Bancos', codes: ['244000000'], group: 'wholesale', special: false },
  { key: 'letras', label: 'Mortgage letters (letras)', short: 'Letras', codes: ['245000100'], group: 'debt', special: false },
  { key: 'bonos', label: 'Senior bonds', short: 'Bonos', codes: ['245000200'], group: 'debt', special: false },
  { key: 'otrasFin', label: 'Other financial obligations', short: 'Otras fin.', codes: ['246000000'], group: 'wholesale', special: false },
  { key: 'subordinados', label: 'Subordinated bonds (T2)', short: 'T2', codes: ['255000100'], group: 'capital', special: true },
  { key: 'at1', label: 'AT1 / perpetual bonds', short: 'AT1', codes: ['255000200'], group: 'capital', special: true },
];

export const CL_FUNDING_COLORS = {
  cuentaCorriente: '#0ea5e9',
  ahorroVista: '#38bdf8',
  otrasVista: '#7dd3fc',
  depPlazo: '#0284c7',
  ahorroPlazo: '#0369a1',
  otrosPlazo: '#64748b',
  repos: '#78716c',
  bancos: '#57534e',
  letras: '#059669',
  bonos: '#ca8a04',
  otrasFin: '#a8a29e',
  subordinados: '#b45309',
  at1: '#9a3412',
  ufShare: '#0d9488',
  fxShare: '#2563eb',
  funding: '#0d3b66',
};

/** Interest expense accounts mirroring the liability tree (MR1, tipo r1). */
export const CL_FUNDING_EXPENSES = {
  vista: ['412150000'],
  plazo: ['412180000'],
  repos: ['412250000'],
  bancos: ['412280000'],
  deuda: ['412350000'],
  otrasFin: ['412380000'],
  subordinados: ['412500100'],
  total: ['412000000'],
};

export const CL_CURRENCY_DIMS = [
  { key: 'total', label: 'Total', field: 'monto_total' },
  { key: 'clp', label: 'CLP nominal', field: 'monto_clp' },
  { key: 'uf', label: 'UF-indexed', field: 'monto_uf' },
  { key: 'tc', label: 'FX-indexed (TC)', field: 'monto_tc' },
  { key: 'ext', label: 'Foreign currency', field: 'monto_ext' },
];

export function clFundingAccountsForRun() {
  return [...new Set([
    ...CL_KPI.fundingOrdinary,
    ...CL_KPI.depVista,
    ...CL_KPI.depPlazo,
    ...CL_KPI.bonos,
    ...CL_KPI.subordinados,
    ...CL_KPI.at1,
    ...CL_FUNDING_INSTRUMENTS.flatMap((i) => i.codes),
  ])];
}

export function clFundingExpenseAccountsForRun() {
  return [...new Set(Object.values(CL_FUNDING_EXPENSES).flat())];
}

export function clSum(rowsSameBank, codes, periodo, field = 'monto_total') {
  const set = new Set(codes.map(String));
  return rowsSameBank
    .filter((r) => set.has(String(r.cuenta)) && (!periodo || r.periodo === periodo))
    .reduce((s, r) => s + (Number(r[field]) || 0), 0);
}

export function clSeries(rowsSameBank, codes, periodos, field = 'monto_total') {
  return periodos.map((p) => clSum(rowsSameBank, codes, p, field));
}

/**
 * MR1 interest expense is YTD within the calendar year (resets in January).
 * Returns the month-only flow, or null if the prior month is missing.
 */
export function clExpenseMonth(valByPeriod, periodo) {
  const y = String(periodo).slice(0, 4);
  const m = parseInt(String(periodo).slice(4, 6), 10);
  const raw = Number(valByPeriod[periodo] || 0);
  if (m === 1) return raw;
  const prevM = String(m - 1).padStart(2, '0');
  const prev = `${y}${prevM}`;
  if (!(prev in valByPeriod)) return null;
  return raw - Number(valByPeriod[prev] || 0);
}

export function clFundingSnapshot(rowsSameBank, periodo) {
  const instruments = CL_FUNDING_INSTRUMENTS.map((inst) => ({
    ...inst,
    value: clSum(rowsSameBank, inst.codes, periodo),
    clp: clSum(rowsSameBank, inst.codes, periodo, 'monto_clp'),
    uf: clSum(rowsSameBank, inst.codes, periodo, 'monto_uf'),
    tc: clSum(rowsSameBank, inst.codes, periodo, 'monto_tc'),
    ext: clSum(rowsSameBank, inst.codes, periodo, 'monto_ext'),
  }));

  const ordinary = instruments.filter((i) => i.group !== 'capital');
  const funding = ordinary.reduce((s, i) => s + i.value, 0);
  const deposits = clSum(rowsSameBank, [...CL_KPI.depVista, ...CL_KPI.depPlazo], periodo);
  const loans = clSum(rowsSameBank, CL_KPI.colocaciones, periodo);
  const uf = ordinary.reduce((s, i) => s + i.uf, 0);
  const ext = ordinary.reduce((s, i) => s + i.ext, 0);
  const capital = instruments.filter((i) => i.group === 'capital').reduce((s, i) => s + i.value, 0);

  return {
    periodo,
    funding,
    captacoes: funding, // alias for shared UI
    depositos: deposits,
    loans,
    capital,
    uf,
    ext,
    ufPct: funding > 0 ? (uf / funding) * 100 : null,
    fxPct: funding > 0 ? (ext / funding) * 100 : null,
    taxEligible: null, // not applicable in Chile
    taxEligiblePct: null,
    instruments,
    ltd: deposits > 0 ? loans / deposits : null,
    ltf: funding > 0 ? loans / funding : null,
  };
}
