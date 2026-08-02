// ============================================================
// Argentina — BCRA Datos Abiertos (baldet)
// Cuentas = slugs canónicos del loader (argentina_loader.py).
// monto_total en ARS enteros (miles × 1000).
// ============================================================

export const AR_KPI = {
  activos: 'TOTAL_ACTIVO',
  colocaciones: 'PRESTAMOS',
  pasivos: 'TOTAL_PASIVO',
  patrimonio: 'PATRIMONIO_NETO',
  captaciones: 'DEPOSITOS',
  depVista: 'DEPOSITOS',
  utilidad: 'RESULTADO_NETO', // YTD (A−P−PN / rdos. integrales del PE)
  cash: 'EFECTIVO_Y_DEPOSITOS',
  securities: 'TITULOS',
};

export function arSum(rowsSameBank, codes, periodo) {
  const list = Array.isArray(codes) ? codes : [codes];
  const set = new Set(list);
  return rowsSameBank
    .filter(r => set.has(r.cuenta) && (!periodo || r.periodo === periodo))
    .reduce((s, r) => s + (Number(r.monto_total) || 0), 0);
}

export function arSeries(rowsSameBank, codes, periodos) {
  const list = Array.isArray(codes) ? codes : [codes];
  const set = new Set(list);
  return periodos.map(p =>
    rowsSameBank
      .filter(r => set.has(r.cuenta) && r.periodo === p)
      .reduce((s, r) => s + (Number(r.monto_total) || 0), 0),
  );
}

export const BAL_AR_SECTIONS = {
  assets: [
    { c: 'TOTAL_ACTIVO', l: 'TOTAL ASSETS', cls: 'hl' },
    { c: 'EFECTIVO_Y_DEPOSITOS', l: 'Cash and due from banks', cls: 'i1' },
    { c: 'TITULOS', l: 'Public and private securities', cls: 'i1' },
    { c: 'PRESTAMOS', l: 'Loans', cls: 'hl' },
  ],
  liabilities: [
    { c: 'TOTAL_PASIVO', l: 'TOTAL LIABILITIES', cls: 'hl' },
    { c: 'DEPOSITOS', l: 'Deposits', cls: 'hl' },
  ],
  equity: [
    { c: 'PATRIMONIO_NETO', l: 'TOTAL EQUITY', cls: 'hl' },
    { c: 'CAPITAL_SOCIAL', l: 'Share capital', cls: 'i1' },
    { c: 'RESERVA_UTILIDADES', l: 'Retained earnings reserves', cls: 'i1' },
    { c: 'RESULTADOS_NO_ASIGNADOS', l: 'Unallocated results', cls: 'i1' },
  ],
};
BAL_AR_SECTIONS.activos = BAL_AR_SECTIONS.assets;
BAL_AR_SECTIONS.pasivos = BAL_AR_SECTIONS.liabilities;
BAL_AR_SECTIONS.patrimonio = BAL_AR_SECTIONS.equity;

export const R1_AR_ROWS = [
  { c: 'INGRESOS_FINANCIEROS', l: 'Financial income', cls: 'i1' },
  { c: 'EGRESOS_FINANCIEROS', l: 'Financial expense', cls: 'i1' },
  { c: 'CARGO_INCOBRABILIDAD', l: 'Loan loss charges', cls: 'i1' },
  { c: 'INGRESOS_SERVICIOS', l: 'Fee income', cls: 'i1' },
  { c: 'EGRESOS_SERVICIOS', l: 'Fee expense', cls: 'i1' },
  { c: 'GASTOS_ADMINISTRACION', l: 'Administrative expenses', cls: 'i1' },
  { c: 'RESULTADO_MONETARIO', l: 'Monetary result (inflation)', cls: 'i1' },
  { c: 'IMPUESTO_GANANCIAS', l: 'Income tax (signed)', cls: 'i1' },
  { c: 'RESULTADO_NETO', l: 'NET COMPREHENSIVE RESULT (YTD)', cls: 'hl' },
];

export function arB1AccountsForRun() {
  return [...new Set([
    AR_KPI.activos,
    AR_KPI.colocaciones,
    AR_KPI.pasivos,
    AR_KPI.patrimonio,
    AR_KPI.captaciones,
    AR_KPI.cash,
    AR_KPI.securities,
    ...BAL_AR_SECTIONS.assets.map(r => r.c),
    ...BAL_AR_SECTIONS.liabilities.map(r => r.c),
    ...BAL_AR_SECTIONS.equity.map(r => r.c),
  ])];
}

export function arR1AccountsForRun() {
  return [...new Set([AR_KPI.utilidad, ...R1_AR_ROWS.map(r => r.c)])];
}
