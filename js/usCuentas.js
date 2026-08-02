// ============================================================
// United States — FDIC BankFind / Call Report (top-N by equity)
// Cuentas = campos FDIC (ASSET, EQTOT, DEP, …). monto_total en USD.
// ============================================================

export const US_KPI = {
  activos: 'ASSET',
  colocaciones: 'LNLS',
  pasivos: 'LIAB',
  patrimonio: 'EQTOT',
  captaciones: 'DEP',
  depVista: 'DEP', // FDIC no desglosa vista/plazo en este corte
  utilidad: 'NETINC', // YTD
  cash: 'CHBAL',
  securities: 'SC',
};

export function usSum(rowsSameBank, codes, periodo) {
  const list = Array.isArray(codes) ? codes : [codes];
  const set = new Set(list);
  return rowsSameBank
    .filter(r => set.has(r.cuenta) && (!periodo || r.periodo === periodo))
    .reduce((s, r) => s + (Number(r.monto_total) || 0), 0);
}

export function usSeries(rowsSameBank, codes, periodos) {
  const list = Array.isArray(codes) ? codes : [codes];
  const set = new Set(list);
  return periodos.map(p =>
    rowsSameBank
      .filter(r => set.has(r.cuenta) && r.periodo === p)
      .reduce((s, r) => s + (Number(r.monto_total) || 0), 0),
  );
}

export const BAL_US_SECTIONS = {
  assets: [
    { c: 'ASSET', l: 'TOTAL ASSETS', cls: 'hl' },
    { c: 'CHBAL', l: 'Cash and balances due from depository institutions', cls: 'i1' },
    { c: 'SC', l: 'Securities', cls: 'i1' },
    { c: 'LNLS', l: 'Net loans and leases', cls: 'hl' },
  ],
  liabilities: [
    { c: 'LIAB', l: 'TOTAL LIABILITIES', cls: 'hl' },
    { c: 'DEP', l: 'Total deposits', cls: 'hl' },
  ],
  equity: [
    { c: 'EQTOT', l: 'TOTAL EQUITY CAPITAL', cls: 'hl' },
  ],
};
BAL_US_SECTIONS.activos = BAL_US_SECTIONS.assets;
BAL_US_SECTIONS.pasivos = BAL_US_SECTIONS.liabilities;
BAL_US_SECTIONS.patrimonio = BAL_US_SECTIONS.equity;

export const R1_US_ROWS = [
  { c: 'INTINC', l: 'Total interest income (YTD)', cls: 'i1' },
  { c: 'EINTEXP', l: 'Total interest expense (YTD)', cls: 'i1' },
  { c: 'NONII', l: 'Total noninterest income (YTD)', cls: 'i1' },
  { c: 'NONIX', l: 'Total noninterest expense (YTD)', cls: 'i1' },
  { c: 'NETINC', l: 'NET INCOME (YTD)', cls: 'hl' },
];

export function usB1AccountsForRun() {
  return [...new Set([
    US_KPI.activos,
    US_KPI.colocaciones,
    US_KPI.pasivos,
    US_KPI.patrimonio,
    US_KPI.captaciones,
    US_KPI.cash,
    US_KPI.securities,
    ...BAL_US_SECTIONS.assets.map(r => r.c),
    ...BAL_US_SECTIONS.liabilities.map(r => r.c),
    ...BAL_US_SECTIONS.equity.map(r => r.c),
  ])];
}

export function usR1AccountsForRun() {
  return [...new Set([US_KPI.utilidad, ...R1_US_ROWS.map(r => r.c)])];
}
