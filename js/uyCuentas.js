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
import { clExpenseMonth } from './clCuentas.js?v=bmon105';

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

// ============================================================
// Currency lens — the pesos / dollars split of the whole balance sheet.
//
// Every line of Estado de Situación arrives from the BCU already open in
// "Actividad en M/N" and "Actividad en M/E"; the loader parks them in
// monto_clp and monto_ext. Unidades indexadas (UI) are NOT a third column:
// the SSF classifies UI-denominated instruments inside moneda nacional and
// publishes no per-bank UI breakdown anywhere in the boletín. So this lens is
// pesos (UI included) vs foreign currency (overwhelmingly USD), plus total.
//
// The BCU rounds each column on its own, so M/N + M/E can miss Total by up to
// one thousand pesos per line. Percentages always divide by the published
// total, never by the sum of the two columns.
// ============================================================

/** Condensed balance for the three-column summary. Siblings must not overlap. */
export const UY_CURRENCY_SUMMARY = [
  { key: 'assets', label: 'TOTAL ASSETS', codes: ['1'], side: 'asset', head: true },
  { key: 'cash', label: 'Cash and Central Bank', codes: ['1.1', '1.2'], side: 'asset' },
  { key: 'loans', label: 'Loans (amortized cost)', codes: ['1.4.1', '1.4.2', '1.4.3'], side: 'asset' },
  { key: 'securities', label: 'Securities portfolios', codes: ['1.3', '1.5', '1.6', '1.7'], side: 'asset' },
  { key: 'otherAssets', label: 'Other assets', codes: ['1.8', '1.9', '1.10', '1.11', '1.12', '1.13', '1.14', '1.15', '1.16', '1.4.4', '1.4.5'], side: 'asset' },

  { key: 'liabilities', label: 'TOTAL LIABILITIES', codes: ['2'], side: 'liab', head: true },
  { key: 'depPriv', label: 'Deposits — private non-financial', codes: ['2.1.3'], side: 'liab' },
  { key: 'depPub', label: 'Deposits — public non-financial', codes: ['2.1.4'], side: 'liab' },
  { key: 'depFin', label: 'Deposits — financial sector', codes: ['2.1.2'], side: 'liab' },
  { key: 'bcu', label: 'Central Bank funding', codes: ['2.1.1'], side: 'liab' },
  { key: 'valores', label: 'Marketable debt securities', codes: ['2.1.5'], side: 'liab' },
  { key: 'regCapital', label: 'Issued regulatory capital', codes: ['2.10'], side: 'liab' },
  { key: 'otherLiab', label: 'Other liabilities', codes: ['2.1.6', '2.2', '2.3', '2.4', '2.5', '2.6', '2.7', '2.8', '2.9'], side: 'liab' },

  { key: 'equity', label: 'TOTAL EQUITY', codes: ['3'], side: 'equity', head: true },
];

/** BCU's own currency-related indicators (Anexo 4, tipo q1, percent ×100). */
export const UY_CURRENCY_RATIOS = {
  fxPosition: 'A4_V_1', // Posición neta en moneda extranjera / Patrimonio
  fxLoans: 'A4_VII_1', // Dolarización de créditos brutos SNF
  fxDeposits: 'A4_VII_2', // Dolarización de depósitos SNF
  lcrLocal: 'A4_II_3', // LCR moneda nacional
  lcrUsd: 'A4_II_4', // LCR en dólares americanos
  lcrAll: 'A4_II_5', // LCR consolidado en moneda nacional
};

export const UY_CURRENCY_COLORS = {
  local: '#0d9488',
  ext: '#2563eb',
  total: '#0d3b66',
  net: '#7c3aed',
  gap: '#ea580c',
};

export function uyCurrencyAccountsForRun() {
  return {
    b1: [...new Set([
      ...UY_CURRENCY_SUMMARY.flatMap((r) => r.codes),
      ...BAL_UY_SECTIONS.assets.map((r) => r.c),
      ...BAL_UY_SECTIONS.liabilities.map((r) => r.c),
      ...BAL_UY_SECTIONS.equity.map((r) => r.c),
      ...UY_KPI.captaciones,
    ])],
    q1: [...new Set(Object.values(UY_CURRENCY_RATIOS))],
  };
}

function pct(part, whole) {
  if (!whole) return null;
  return (part / whole) * 100;
}

function uyPickQ1(rowsQ1, cuenta, periodo) {
  const hit = (rowsQ1 || []).find((r) => r.cuenta === cuenta && r.periodo === periodo);
  return hit ? Number(hit.monto_total) / 100 : null;
}

function currencyLine(rowsB1, def, periodo) {
  const local = uySum(rowsB1, def.codes, periodo, 'monto_clp');
  const ext = uySum(rowsB1, def.codes, periodo, 'monto_ext');
  const total = uySum(rowsB1, def.codes, periodo, 'monto_total');
  return { ...def, local, ext, total, extPct: pct(ext, total) };
}

/**
 * Currency snapshot for one bank and period: the condensed three-column
 * balance plus the FX mismatch (descalce) block.
 *
 * `netFxOverEquity` is an on-balance-sheet figure. BCU's V.1 follows article
 * 165 of the RNRCSF and takes in derivatives and other off-balance positions,
 * so the two differ on purpose and the UI shows both side by side.
 */
export function uyCurrencySnapshot(rowsB1, rowsQ1, periodo) {
  const lines = UY_CURRENCY_SUMMARY.map((def) => currencyLine(rowsB1, def, periodo));
  const byKey = Object.fromEntries(lines.map((l) => [l.key, l]));

  const assets = byKey.assets;
  const liabilities = byKey.liabilities;
  const equity = byKey.equity;
  const loans = byKey.loans;
  const deposits = currencyLine(rowsB1, { key: 'deposits', codes: UY_KPI.captaciones }, periodo);

  const netFx = assets.ext - liabilities.ext;
  const published = {
    fxPosition: uyPickQ1(rowsQ1, UY_CURRENCY_RATIOS.fxPosition, periodo),
    fxLoans: uyPickQ1(rowsQ1, UY_CURRENCY_RATIOS.fxLoans, periodo),
    fxDeposits: uyPickQ1(rowsQ1, UY_CURRENCY_RATIOS.fxDeposits, periodo),
    lcrLocal: uyPickQ1(rowsQ1, UY_CURRENCY_RATIOS.lcrLocal, periodo),
    lcrUsd: uyPickQ1(rowsQ1, UY_CURRENCY_RATIOS.lcrUsd, periodo),
    lcrAll: uyPickQ1(rowsQ1, UY_CURRENCY_RATIOS.lcrAll, periodo),
  };

  return {
    periodo,
    lines,
    byKey,
    deposits,
    hasData: assets.total > 0,
    assetsExtPct: assets.extPct,
    liabilitiesExtPct: liabilities.extPct,
    loansExtPct: loans.extPct,
    depositsExtPct: deposits.extPct,
    netFx,
    netFxOverEquity: pct(netFx, equity.total),
    /** Positive = the bank lends in dollars more than it funds in dollars. */
    dollarizationGap:
      loans.extPct != null && deposits.extPct != null ? loans.extPct - deposits.extPct : null,
    published,
    hasPublished: Object.values(published).some((v) => v != null),
  };
}

// ------------------------------------------------------------
// Anexo 3 — deposit structure by ticket size.
//
// The boletín crosses nine balance brackets with term, currency and residency,
// and adds the client count behind each one. Loader codes:
//   A3_{TERM}_{T|R|NR}_{TRANCHE}  amounts (M/N in monto_clp, M/E in monto_ext)
//   A3_CLI_{T|R|NR}_{TRANCHE}     client counts, stored raw in monto_total
// The sheet states "cada tramo excluye a los anteriores", so each bracket is a
// band, not a cumulative total — the labels below say so.
// ------------------------------------------------------------
export const UY_A3_TRANCHES = [
  { key: 'LE5K', label: 'Up to US$ 5k', short: '≤5k', band: 'retail' },
  { key: 'LE10K', label: 'US$ 5k – 10k', short: '5–10k', band: 'retail' },
  { key: 'LE15K', label: 'US$ 10k – 15k', short: '10–15k', band: 'retail' },
  { key: 'LE20K', label: 'US$ 15k – 20k', short: '15–20k', band: 'retail' },
  { key: 'LE25K', label: 'US$ 20k – 25k', short: '20–25k', band: 'retail' },
  { key: 'LE50K', label: 'US$ 25k – 50k', short: '25–50k', band: 'affluent' },
  { key: 'LE100K', label: 'US$ 50k – 100k', short: '50–100k', band: 'affluent' },
  { key: 'LE250K', label: 'US$ 100k – 250k', short: '100–250k', band: 'affluent' },
  { key: 'GT250K', label: 'Over US$ 250k', short: '>250k', band: 'wholesale' },
];

export const UY_A3_BANDS = [
  { key: 'retail', label: 'Retail (up to US$ 25k)' },
  { key: 'affluent', label: 'Affluent (US$ 25k – 250k)' },
  { key: 'wholesale', label: 'Wholesale (over US$ 250k)' },
];

export function uyDepositStructureAccountsForRun() {
  const keys = [...UY_A3_TRANCHES.map((t) => t.key), 'TOT'];
  return keys.flatMap((k) => [
    `A3_ALL_T_${k}`, `A3_ALL_NR_${k}`, `A3_V30_T_${k}`, `A3_G1Y_T_${k}`, `A3_CLI_T_${k}`,
  ]);
}

/**
 * Deposit granularity: how much of the funding sits in a handful of large
 * tickets versus spread across many small ones. The wholesale band is the one
 * that runs first in a stress, so it gets its own headline.
 */
export function uyDepositStructure(rowsSameBank, periodo) {
  const read = (prefix, key, field = 'monto_total') =>
    uySum(rowsSameBank, [`${prefix}_${key}`], periodo, field);

  const total = read('A3_ALL_T', 'TOT');
  const totalClients = read('A3_CLI_T', 'TOT');

  const tranches = UY_A3_TRANCHES.map((t) => {
    const amount = read('A3_ALL_T', t.key);
    const clients = read('A3_CLI_T', t.key);
    const demand = read('A3_V30_T', t.key);
    return {
      ...t,
      amount,
      local: read('A3_ALL_T', t.key, 'monto_clp'),
      ext: read('A3_ALL_T', t.key, 'monto_ext'),
      clients,
      nonResident: read('A3_ALL_NR', t.key),
      demand,
      longTerm: read('A3_G1Y_T', t.key),
      pct: pct(amount, total),
      clientPct: pct(clients, totalClients),
      avgTicket: clients > 0 ? amount / clients : null,
      demandPct: pct(demand, amount),
      extPct: pct(read('A3_ALL_T', t.key, 'monto_ext'), amount),
      nonResidentPct: pct(read('A3_ALL_NR', t.key), amount),
    };
  });

  const bands = UY_A3_BANDS.map((b) => {
    const list = tranches.filter((t) => t.band === b.key);
    const amount = list.reduce((s, t) => s + t.amount, 0);
    const clients = list.reduce((s, t) => s + t.clients, 0);
    return {
      ...b,
      amount,
      clients,
      pct: pct(amount, total),
      clientPct: pct(clients, totalClients),
      avgTicket: clients > 0 ? amount / clients : null,
    };
  });

  const wholesale = bands.find((b) => b.key === 'wholesale');
  return {
    periodo,
    hasData: total > 0,
    total,
    totalClients,
    tranches,
    bands,
    avgTicket: totalClients > 0 ? total / totalClients : null,
    wholesalePct: wholesale?.pct ?? null,
    /** Share held by non-residents across all brackets. */
    nonResidentPct: pct(read('A3_ALL_NR', 'TOT'), total),
    demandPct: pct(read('A3_V30_T', 'TOT'), total),
  };
}

/** Per-period series for one aggregate of the condensed balance. */
export function uyCurrencySeries(rowsB1, key, periodos) {
  const def = UY_CURRENCY_SUMMARY.find((r) => r.key === key)
    || { key, codes: UY_KPI.captaciones };
  return periodos.map((p) => currencyLine(rowsB1, def, p));
}
