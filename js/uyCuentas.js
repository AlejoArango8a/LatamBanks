// ============================================================
// Uruguay — BCU / SSF Boletín mensual (Estado de Situación + Resultados)
// Códigos = jerarquía del plan BCU ("1 - ACTIVOS" → "1") o S_*/R_* para
// subtotales sin número. Loader: uruguay_loader.py (monto en pesos enteros).
// ============================================================

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
};

export function uySum(rowsSameBank, codes, periodo) {
  const list = Array.isArray(codes) ? codes : [codes];
  const set = new Set(list);
  return rowsSameBank
    .filter(r => set.has(r.cuenta) && (!periodo || r.periodo === periodo))
    .reduce((s, r) => s + (Number(r.monto_total) || 0), 0);
}

export function uySeries(rowsSameBank, codes, periodos) {
  const list = Array.isArray(codes) ? codes : [codes];
  const set = new Set(list);
  return periodos.map(p =>
    rowsSameBank
      .filter(r => set.has(r.cuenta) && r.periodo === p)
      .reduce((s, r) => s + (Number(r.monto_total) || 0), 0),
  );
}

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
    { c: '2.1.2', l: 'Deposits — financial sector', cls: 'i1' },
    { c: '2.1.3', l: 'Deposits — private non-financial', cls: 'i1' },
    { c: '2.1.4', l: 'Deposits — public non-financial', cls: 'i1' },
    { c: '2.1.5', l: 'Marketable debt instruments', cls: 'i1' },
    { c: '2.2', l: 'Liabilities at FVTPL', cls: 'i1' },
    { c: '2.7', l: 'Other provisions', cls: 'i1' },
    { c: '2.10', l: 'Non-negotiable issued obligations', cls: 'i1' },
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
    ...BAL_UY_SECTIONS.assets.map(r => r.c),
    ...BAL_UY_SECTIONS.liabilities.map(r => r.c),
    ...BAL_UY_SECTIONS.equity.map(r => r.c),
  ])];
}

export function uyR1AccountsForRun() {
  return [...new Set([UY_KPI.utilidad, ...R1_UY_ROWS.map(r => r.c)])];
}
