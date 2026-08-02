// ============================================================
// Panamá — SBP reportes individuales (balance + PyG)
// Cuentas canónicas del loader panama_loader.py (USD enteros).
// RESULTADO_NETO = utilidad YTD.
// ============================================================

export const PA_KPI = {
  activos: 'TOTAL_ACTIVO',
  colocaciones: 'CARTERA_CREDITICIA',
  pasivos: 'TOTAL_PASIVO',
  patrimonio: 'PATRIMONIO',
  captaciones: 'DEPOSITOS',
  depVista: 'DEPOSITOS',
  utilidad: 'RESULTADO_NETO',
};

export function paSum(rowsSameBank, codes, periodo) {
  const list = Array.isArray(codes) ? codes : [codes];
  const set = new Set(list);
  return rowsSameBank
    .filter(r => set.has(r.cuenta) && (!periodo || r.periodo === periodo))
    .reduce((s, r) => s + (Number(r.monto_total) || 0), 0);
}

export function paSeries(rowsSameBank, codes, periodos) {
  const list = Array.isArray(codes) ? codes : [codes];
  const set = new Set(list);
  return periodos.map(p =>
    rowsSameBank
      .filter(r => set.has(r.cuenta) && r.periodo === p)
      .reduce((s, r) => s + (Number(r.monto_total) || 0), 0),
  );
}

export const BAL_PA_SECTIONS = {
  assets: [
    { c: 'TOTAL_ACTIVO', l: 'TOTAL ASSETS', cls: 'hl' },
    { c: 'CARTERA_CREDITICIA', l: 'Loan portfolio', cls: 'i1' },
  ],
  liabilities: [
    { c: 'TOTAL_PASIVO', l: 'TOTAL LIABILITIES', cls: 'hl' },
    { c: 'DEPOSITOS', l: 'Deposits', cls: 'i1' },
    { c: 'OBLIGACIONES', l: 'Borrowings / obligations', cls: 'i1' },
    { c: 'OTROS_PASIVOS', l: 'Other liabilities', cls: 'i1' },
  ],
  equity: [
    { c: 'PATRIMONIO', l: 'TOTAL EQUITY', cls: 'hl' },
  ],
};
BAL_PA_SECTIONS.activos = BAL_PA_SECTIONS.assets;
BAL_PA_SECTIONS.pasivos = BAL_PA_SECTIONS.liabilities;
BAL_PA_SECTIONS.patrimonio = BAL_PA_SECTIONS.equity;

export const R1_PA_ROWS = [
  { c: 'UTILIDAD_ANTES_PROVISIONES', l: 'Profit before provisions', cls: 'i1' },
  { c: 'RESULTADO_NETO', l: 'NET INCOME (YTD)', cls: 'hl' },
];

export function paB1AccountsForRun() {
  return [
    'TOTAL_ACTIVO', 'CARTERA_CREDITICIA', 'DEPOSITOS',
    'OBLIGACIONES', 'OTROS_PASIVOS', 'TOTAL_PASIVO', 'PATRIMONIO',
  ];
}

export function paR1AccountsForRun() {
  return ['RESULTADO_NETO', 'UTILIDAD_ANTES_PROVISIONES'];
}
