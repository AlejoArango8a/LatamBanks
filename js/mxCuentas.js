// ============================================================
// México — CNBV Boletín Estadístico Banca Múltiple (Pm2)
// Cuentas = slugs canónicos del loader (mexico_loader.py).
// monto_total en MXN enteros (millones × 1e6).
// ============================================================

export const MX_KPI = {
  activos: 'TOTAL_ACTIVO',
  colocaciones: 'CARTERA_TOTAL',
  pasivos: 'CAPTACION_TOTAL', // proxy: no hay pasivo total en Pm2
  patrimonio: 'CAPITAL_CONTABLE',
  captaciones: 'CAPTACION_TOTAL',
  depVista: 'CAPTACION_TOTAL',
  utilidad: 'RESULTADO_NETO', // YTD
};

export function mxSum(rowsSameBank, codes, periodo) {
  const list = Array.isArray(codes) ? codes : [codes];
  const set = new Set(list);
  return rowsSameBank
    .filter(r => set.has(r.cuenta) && (!periodo || r.periodo === periodo))
    .reduce((s, r) => s + (Number(r.monto_total) || 0), 0);
}

export function mxSeries(rowsSameBank, codes, periodos) {
  const list = Array.isArray(codes) ? codes : [codes];
  const set = new Set(list);
  return periodos.map(p =>
    rowsSameBank
      .filter(r => set.has(r.cuenta) && r.periodo === p)
      .reduce((s, r) => s + (Number(r.monto_total) || 0), 0),
  );
}

export const BAL_MX_SECTIONS = {
  assets: [
    { c: 'TOTAL_ACTIVO', l: 'TOTAL ASSETS', cls: 'hl' },
    { c: 'CARTERA_TOTAL', l: 'Total loan portfolio', cls: 'hl' },
  ],
  liabilities: [
    { c: 'CAPTACION_TOTAL', l: 'Total deposits / funding', cls: 'hl' },
  ],
  equity: [
    { c: 'CAPITAL_CONTABLE', l: 'TOTAL EQUITY', cls: 'hl' },
  ],
};
BAL_MX_SECTIONS.activos = BAL_MX_SECTIONS.assets;
BAL_MX_SECTIONS.pasivos = BAL_MX_SECTIONS.liabilities;
BAL_MX_SECTIONS.patrimonio = BAL_MX_SECTIONS.equity;

export const R1_MX_ROWS = [
  { c: 'RESULTADO_NETO', l: 'NET INCOME (YTD)', cls: 'hl' },
];

export function mxB1AccountsForRun() {
  return [...new Set([
    MX_KPI.activos,
    MX_KPI.colocaciones,
    MX_KPI.patrimonio,
    MX_KPI.captaciones,
    ...BAL_MX_SECTIONS.assets.map(r => r.c),
    ...BAL_MX_SECTIONS.liabilities.map(r => r.c),
    ...BAL_MX_SECTIONS.equity.map(r => r.c),
  ])];
}

export function mxR1AccountsForRun() {
  return [...new Set([MX_KPI.utilidad, ...R1_MX_ROWS.map(r => r.c)])];
}
