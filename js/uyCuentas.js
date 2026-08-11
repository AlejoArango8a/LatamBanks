// ============================================================
// Uruguay — BCU / SSF Boletín mensual (Estado de Situación + Resultados)
// Códigos = jerarquía del plan BCU ("1 - ACTIVOS" → "1") o S_*/R_* para
// subtotales sin número. Loader: uruguay_loader.py (monto en pesos enteros).
//
// Funding Analytics (currency lens):
//   BCU splits every balance line into Actividad en M/N (moneda nacional / UYU)
//   and Actividad en M/E (moneda extranjera ≈ USD), both in pesos, plus Total.
//   After the loader re-ingest:  M/N → monto_clp, M/E → monto_ext, Total → monto_total.
//   Special metric = FX (M/E ≈ USD) share of ordinary funding = Σ monto_ext / Σ total.
//   Uruguay has NO UF/UI column (indexed instruments live inside M/N), so
//   monto_uf / monto_tc stay 0 — unlike Chile we only have local (UYU) vs FX.
// ============================================================
import { clExpenseMonth } from './clCuentas.js?v=bmon98';

export const UY_KPI = {
  activos: '1',
  /** Créditos por intermediación (costo amortizado) — se suman. */
  colocaciones: ['1.4.1', '1.4.2', '1.4.3'],
  pasivos: '2',
  patrimonio: '3',
  /** Depósitos sector financiero + privado + público */
  captaciones: ['2.1.2', '2.1.3', '2.1.4'],
  depVista: '2.1.3', // proxy: depósitos sector no financiero privado (mayor bolsa)
  utilidad: 'R_EJERCICIO',
  /** Ordinary funding (amortized-cost financial liabilities, ex-capital). */
  fundingOrdinary: ['2.1.1', '2.1.2', '2.1.3', '2.1.4', '2.1.5', '2.1.6'],
};

export function uySum(rowsSameBank, codes, periodo, field = 'monto_total') {
  const list = Array.isArray(codes) ? codes : [codes];
  const set = new Set(list.map(String));
  return rowsSameBank
    .filter((r) => set.has(String(r.cuenta)) && (!periodo || r.periodo === periodo))
    .reduce((s, r) => s + (Number(r[field]) || 0), 0);
}

export function uySeries(rowsSameBank, codes, periodos, field = 'monto_total') {
  return periodos.map((p) => uySum(rowsSameBank, codes, p, field));
}

/**
 * BCU Resultados is YTD within the calendar year (resets in January) — identical
 * accumulation model to Chile's MR1, so we reuse Chile's de-accumulation verbatim.
 */
export { clExpenseMonth as uyExpenseMonth };

// ------------------------------------------------------------
// Tier A — funding instruments from the Situación account tree.
// Mutually exclusive; do NOT also sum parents (2, 2.1).
// ------------------------------------------------------------
export const UY_FUNDING_INSTRUMENTS = [
  { key: 'depSNFPriv', label: 'Deposits — private non-financial', short: 'Dep. priv.', codes: ['2.1.3'], group: 'deposits', special: false },
  { key: 'depSNFPub', label: 'Deposits — public non-financial', short: 'Dep. púb.', codes: ['2.1.4'], group: 'deposits', special: false },
  { key: 'depSF', label: 'Deposits — financial sector', short: 'Dep. fin.', codes: ['2.1.2'], group: 'deposits', special: false },
  { key: 'bcu', label: 'Central Bank funding (BCU)', short: 'BCU', codes: ['2.1.1'], group: 'wholesale', special: false },
  { key: 'valores', label: 'Marketable debt securities', short: 'Valores', codes: ['2.1.5'], group: 'debt', special: false },
  { key: 'otrosCA', label: 'Other amortized-cost liabilities', short: 'Otros CA', codes: ['2.1.6'], group: 'wholesale', special: false },
  { key: 'fvDeposits', label: 'Deposits at fair value', short: 'Dep. FV', codes: ['2.2.2', '2.3.1'], group: 'deposits', special: false },
  { key: 'fvValores', label: 'Debt securities at fair value', short: 'Val. FV', codes: ['2.2.1', '2.3.2'], group: 'debt', special: false },
  { key: 'subord', label: 'Subordinated liabilities', short: 'Subord.', codes: ['2.10.1'], group: 'capital', special: true },
  { key: 'at1', label: 'AT1 / contingent convertibles', short: 'AT1', codes: ['2.10.4'], group: 'capital', special: true },
  { key: 'prefShares', label: 'Preferred shares', short: 'Pref.', codes: ['2.10.2'], group: 'capital', special: true },
];

// ------------------------------------------------------------
// Tier B — vista/plazo term structure from Anexo 1 (contractual maturities).
// Loader emits synthetic `A1_*` accounts (no native code in the boletín).
// Presented as three aggregate buckets; each carries its component A1 codes.
// ------------------------------------------------------------
export const UY_TERM_INSTRUMENTS = [
  { key: 'vista', label: 'Demand (vista)', short: 'Vista', codes: ['A1_DEPSNF_VISTA'], bucket: 'demand' },
  {
    key: 'termShort',
    label: 'Term ≤1y',
    short: '≤1y',
    codes: ['A1_DEPSNF_LT30', 'A1_DEPSNF_LT91', 'A1_DEPSNF_LT181', 'A1_DEPSNF_LT367'],
    bucket: 'short',
  },
  { key: 'termLong', label: 'Term >1y', short: '>1y', codes: ['A1_DEPSNF_LT3Y', 'A1_DEPSNF_GE3Y'], bucket: 'long' },
];

export const UY_FUNDING_COLORS = {
  depSNFPriv: '#0ea5e9',
  depSNFPub: '#38bdf8',
  depSF: '#0284c7',
  bcu: '#0369a1',
  valores: '#ca8a04',
  otrosCA: '#a8a29e',
  fvDeposits: '#7dd3fc',
  fvValores: '#eab308',
  subord: '#b45309',
  at1: '#9a3412',
  prefShares: '#78716c',
  // Term buckets
  vista: '#0ea5e9',
  termShort: '#0284c7',
  termLong: '#0369a1',
  // Currency-lens accents
  fxShare: '#2563eb',
  localShare: '#0d9488',
  funding: '#0d3b66',
};

/** Interest expense (r1) — account 5 "Gastos por intereses y reajustes" (YTD). */
export const UY_FUNDING_EXPENSES = {
  total: ['5'],
};

export const UY_CURRENCY_DIMS = [
  { key: 'total', label: 'Total', field: 'monto_total' },
  { key: 'local', label: 'Local (UYU)', field: 'monto_clp' },
  { key: 'ext', label: 'FX (≈USD)', field: 'monto_ext' },
];

export const BAL_UY_SECTIONS = {
  assets: [
    { c: '1', l: 'TOTAL ASSETS', cls: 'hl' },
    { c: '1.1', l: 'Cash and due from banks', cls: 'i1' },
    { c: '1.2', l: 'Central Bank of Uruguay', cls: 'i1' },
    { c: '1.3', l: 'Securities at FVTPL', cls: 'i1' },
    { c: '1.4', l: 'Amortized cost', cls: 'i1' },
    { c: '1.4.1', l: 'Loans — financial sector', cls: 'i2' },
    { c: '1.4.2', l: 'Loans — private non-financial', cls: 'i2' },
    { c: '1.4.3', l: 'Loans — public non-financial', cls: 'i2' },
    { c: '1.5', l: 'Securities at FVOCI', cls: 'i1' },
    { c: '1.10', l: 'Equity investments', cls: 'i1' },
    { c: '1.12', l: 'Property and equipment', cls: 'i1' },
    { c: '1.13', l: 'Intangible assets', cls: 'i1' },
    { c: '1.14', l: 'Tax assets', cls: 'i1' },
    { c: '1.15', l: 'Other receivables', cls: 'i1' },
  ],
  liabilities: [
    { c: '2', l: 'TOTAL LIABILITIES', cls: 'hl' },
    { c: '2.1', l: 'Financial liabilities at amortized cost', cls: 'hl' },
    { c: '2.1.1', l: 'Central Bank of Uruguay (BCU)', cls: 'i1' },
    { c: '2.1.2', l: 'Deposits — financial sector', cls: 'i1' },
    { c: '2.1.3', l: 'Deposits — private non-financial', cls: 'i1' },
    { c: '2.1.4', l: 'Deposits — public non-financial', cls: 'i1' },
    { c: '2.1.5', l: 'Marketable debt instruments', cls: 'i1' },
    { c: '2.1.6', l: 'Other amortized-cost liabilities', cls: 'i1' },
    { c: '2.2', l: 'Liabilities at FVTPL', cls: 'i1' },
    { c: '2.7', l: 'Other provisions', cls: 'i1' },
    { c: '2.10', l: 'Non-negotiable issued obligations', cls: 'hl' },
    { c: '2.10.1', l: 'Subordinated liabilities', cls: 'i1' },
    { c: '2.10.2', l: 'Preferred shares', cls: 'i1' },
    { c: '2.10.4', l: 'AT1 / contingent convertibles', cls: 'i1' },
  ],
  equity: [
    { c: '3', l: 'TOTAL EQUITY', cls: 'hl' },
    { c: '3.1', l: 'Own funds', cls: 'i1' },
    { c: '3.1.1', l: 'Paid-in capital', cls: 'i2' },
    { c: '3.1.6', l: 'Reserves', cls: 'i2' },
    { c: '3.1.7', l: 'Retained earnings', cls: 'i2' },
    { c: '3.1.8', l: 'Current year result', cls: 'i2' },
    { c: '3.2', l: 'Valuation adjustments (OCI)', cls: 'i1' },
  ],
};
BAL_UY_SECTIONS.activos = BAL_UY_SECTIONS.assets;
BAL_UY_SECTIONS.pasivos = BAL_UY_SECTIONS.liabilities;
BAL_UY_SECTIONS.patrimonio = BAL_UY_SECTIONS.equity;

export const R1_UY_ROWS = [
  { c: '4', l: 'Interest income', cls: 'i1' },
  { c: '5', l: 'Interest expense', cls: 'i1' },
  { c: 'S_margen_financiero_bruto', l: 'Net interest income (gross)', cls: 'hl' },
  { c: '7', l: 'Credit impairment', cls: 'i1' },
  { c: '8', l: 'Recoveries of written-off loans', cls: 'i1' },
  { c: 'S_margen_financiero', l: 'Net interest margin', cls: 'hl' },
  { c: '9', l: 'Fee income', cls: 'i1' },
  { c: '10', l: 'Fee expense', cls: 'i1' },
  { c: 'S_margen_por_servicios', l: 'Net fee income', cls: 'hl' },
  { c: '13', l: 'Trading / financial ops result', cls: 'i1' },
  { c: '14', l: 'FX valuation differences', cls: 'i1' },
  { c: '15', l: 'FX transaction differences', cls: 'i1' },
  { c: 'S_resultado_bruto', l: 'Gross result', cls: 'hl' },
  { c: '16', l: 'Personnel expenses', cls: 'i1' },
  { c: '17', l: 'General expenses', cls: 'i1' },
  { c: 'S_resultado_operativo', l: 'Operating result', cls: 'hl' },
  { c: '23', l: 'Income tax', cls: 'i1' },
  { c: 'R_EJERCICIO', l: 'NET INCOME', cls: 'hl' },
];

export function uyB1AccountsForRun() {
  return [...new Set([
    UY_KPI.activos,
    ...UY_KPI.colocaciones,
    UY_KPI.pasivos,
    UY_KPI.patrimonio,
    ...UY_KPI.captaciones,
    UY_KPI.depVista,
    ...BAL_UY_SECTIONS.assets.map((r) => r.c),
    ...BAL_UY_SECTIONS.liabilities.map((r) => r.c),
    ...BAL_UY_SECTIONS.equity.map((r) => r.c),
  ])];
}

export function uyR1AccountsForRun() {
  return [...new Set([UY_KPI.utilidad, ...R1_UY_ROWS.map((r) => r.c)])];
}

// ------------------------------------------------------------
// Funding Analytics account runs
// ------------------------------------------------------------
export function uyFundingAccountsForRun() {
  return [...new Set([
    ...UY_KPI.fundingOrdinary,
    ...UY_KPI.captaciones,
    ...UY_KPI.colocaciones,
    ...UY_FUNDING_INSTRUMENTS.flatMap((i) => i.codes),
    ...UY_TERM_INSTRUMENTS.flatMap((i) => i.codes),
  ])];
}

export function uyFundingExpenseAccountsForRun() {
  return [...new Set(Object.values(UY_FUNDING_EXPENSES).flat())];
}

export function uyTermAccountsForRun() {
  return [...new Set(UY_TERM_INSTRUMENTS.flatMap((i) => i.codes))];
}

/**
 * Snapshot mirroring clFundingSnapshot but on the local(UYU)/FX(≈USD) split.
 * No UF/TC dimension exists for Uruguay, so ufPct is null.
 */
export function uyFundingSnapshot(rowsSameBank, periodo) {
  const instruments = UY_FUNDING_INSTRUMENTS.map((inst) => ({
    ...inst,
    value: uySum(rowsSameBank, inst.codes, periodo),
    local: uySum(rowsSameBank, inst.codes, periodo, 'monto_clp'),
    ext: uySum(rowsSameBank, inst.codes, periodo, 'monto_ext'),
  }));

  const ordinary = instruments.filter((i) => i.group !== 'capital');
  const funding = ordinary.reduce((s, i) => s + i.value, 0);
  const deposits = uySum(rowsSameBank, UY_KPI.captaciones, periodo);
  const loans = uySum(rowsSameBank, UY_KPI.colocaciones, periodo);
  const local = ordinary.reduce((s, i) => s + i.local, 0);
  const ext = ordinary.reduce((s, i) => s + i.ext, 0);
  const capital = instruments.filter((i) => i.group === 'capital').reduce((s, i) => s + i.value, 0);

  return {
    periodo,
    funding,
    captacoes: funding, // alias for shared UI
    depositos: deposits,
    loans,
    capital,
    local,
    ext,
    ufPct: null, // no UF/UI column in Uruguay
    localPct: funding > 0 ? (local / funding) * 100 : null,
    fxPct: funding > 0 ? (ext / funding) * 100 : null,
    taxEligible: null,
    taxEligiblePct: null,
    instruments,
    ltd: deposits > 0 ? loans / deposits : null,
    ltf: funding > 0 ? loans / funding : null,
  };
}

/**
 * Vista / plazo term breakdown from Anexo 1 synthetic accounts (Tier B).
 * hasData is false until uruguay_loader.py emits the A1_* accounts.
 */
export function uyTermBreakdown(rowsSameBank, periodo) {
  const buckets = UY_TERM_INSTRUMENTS.map((b) => ({
    ...b,
    value: uySum(rowsSameBank, b.codes, periodo),
    local: uySum(rowsSameBank, b.codes, periodo, 'monto_clp'),
    ext: uySum(rowsSameBank, b.codes, periodo, 'monto_ext'),
  }));
  const total = buckets.reduce((s, b) => s + b.value, 0);
  return { periodo, total, buckets, hasData: total > 0 };
}
