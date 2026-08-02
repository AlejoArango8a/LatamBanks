// ============================================================
// Perú — SBS Boletín B-2201 (Balance + PyG)
// Cuentas = slugs canónicos del loader (peru_loader.py).
// monto_total en soles enteros (miles × 1000).
// ============================================================

export const PE_KPI = {
  activos: 'TOTAL_ACTIVO',
  colocaciones: 'CREDITOS_NETOS',
  pasivos: 'TOTAL_PASIVO',
  patrimonio: 'PATRIMONIO',
  captaciones: 'OBLIGACIONES_PUBLICO',
  depVista: 'DEPOSITOS_VISTA',
  depAhorro: 'DEPOSITOS_AHORRO',
  depPlazo: 'DEPOSITOS_PLAZO',
  utilidad: 'RESULTADO_NETO',
};

export function peSum(rowsSameBank, codes, periodo) {
  const list = Array.isArray(codes) ? codes : [codes];
  const set = new Set(list);
  return rowsSameBank
    .filter(r => set.has(r.cuenta) && (!periodo || r.periodo === periodo))
    .reduce((s, r) => s + (Number(r.monto_total) || 0), 0);
}

export function peSeries(rowsSameBank, codes, periodos) {
  const list = Array.isArray(codes) ? codes : [codes];
  const set = new Set(list);
  return periodos.map(p =>
    rowsSameBank
      .filter(r => set.has(r.cuenta) && r.periodo === p)
      .reduce((s, r) => s + (Number(r.monto_total) || 0), 0),
  );
}

export const BAL_PE_SECTIONS = {
  assets: [
    { c: 'TOTAL_ACTIVO', l: 'TOTAL ASSETS', cls: 'hl' },
    { c: 'DISPONIBLE', l: 'Cash and due from banks', cls: 'i1' },
    { c: 'FONDOS_INTERBANCARIOS', l: 'Interbank funds', cls: 'i1' },
    { c: 'INVERSIONES_NETAS', l: 'Investments (net)', cls: 'i1' },
    { c: 'CREDITOS_NETOS', l: 'Loans (net of provisions)', cls: 'hl' },
    { c: 'VIGENTES', l: 'Current loans', cls: 'i2' },
    { c: 'REFINANCIADOS_Y_REESTRUCTURADOS', l: 'Refinanced / restructured', cls: 'i2' },
    { c: 'ATRASADOS', l: 'Past due', cls: 'i2' },
    { c: 'CUENTAS_POR_COBRAR_NETAS_DE_PROVISIONES', l: 'Accounts receivable (net)', cls: 'i1' },
    { c: 'INMUEBLES_MOBILIARIO_Y_EQUIPO_NETO', l: 'Property and equipment (net)', cls: 'i1' },
    { c: 'OTROS_ACTIVOS', l: 'Other assets', cls: 'i1' },
  ],
  liabilities: [
    { c: 'TOTAL_PASIVO', l: 'TOTAL LIABILITIES', cls: 'hl' },
    { c: 'OBLIGACIONES_PUBLICO', l: 'Deposits from the public', cls: 'hl' },
    { c: 'DEPOSITOS_VISTA', l: 'Demand deposits', cls: 'i2' },
    { c: 'DEPOSITOS_AHORRO', l: 'Savings deposits', cls: 'i2' },
    { c: 'DEPOSITOS_PLAZO', l: 'Time deposits', cls: 'i2' },
    { c: 'DEPOSITOS_DEL_SISTEMA_FINANCIERO_Y_ORGANISMOS_INTERNACIONALES', l: 'Deposits — financial system / IFIs', cls: 'i1' },
    { c: 'FONDOS_INTERBANCARIOS_2', l: 'Interbank funds (liability)', cls: 'i1' },
    { c: 'ADEUDOS_Y_OBLIGACIONES_FINANCIERAS', l: 'Borrowings', cls: 'i1' },
    { c: 'OBLIGACIONES_EN_CIRCULACION_NO_SUBORDINADAS', l: 'Debt securities (non-subordinated)', cls: 'i1' },
    { c: 'OBLIGACIONES_EN_CIRCULACION_SUBORDINADAS', l: 'Subordinated debt', cls: 'i1' },
  ],
  equity: [
    { c: 'PATRIMONIO', l: 'TOTAL EQUITY', cls: 'hl' },
    { c: 'CAPITAL_SOCIAL', l: 'Share capital', cls: 'i1' },
    { c: 'CAPITAL_ADICIONAL', l: 'Additional capital', cls: 'i1' },
    { c: 'RESERVAS', l: 'Reserves', cls: 'i1' },
    { c: 'AJUSTES_AL_PATRIMONIO', l: 'Equity adjustments (OCI)', cls: 'i1' },
    { c: 'RESULTADOS_ACUMULADOS', l: 'Retained earnings', cls: 'i1' },
    { c: 'RESULTADO_NETO_PATRIMONIO', l: 'Current year result', cls: 'i1' },
  ],
};
BAL_PE_SECTIONS.activos = BAL_PE_SECTIONS.assets;
BAL_PE_SECTIONS.pasivos = BAL_PE_SECTIONS.liabilities;
BAL_PE_SECTIONS.patrimonio = BAL_PE_SECTIONS.equity;

export const R1_PE_ROWS = [
  { c: 'INGRESOS_FINANCIEROS', l: 'Financial income', cls: 'i1' },
  { c: 'GASTOS_FINANCIEROS', l: 'Financial expense', cls: 'i1' },
  { c: 'MARGEN_FINANCIERO_BRUTO', l: 'Gross financial margin', cls: 'hl' },
  { c: 'PROVISIONES_CREDITOS', l: 'Loan loss provisions', cls: 'i1' },
  { c: 'MARGEN_FINANCIERO_NETO', l: 'Net financial margin', cls: 'hl' },
  { c: 'INGRESOS_SERVICIOS', l: 'Fee and service income', cls: 'i1' },
  { c: 'GASTOS_SERVICIOS', l: 'Fee and service expense', cls: 'i1' },
  { c: 'MARGEN_OPERACIONAL', l: 'Operating margin', cls: 'hl' },
  { c: 'GASTOS_ADMINISTRATIVOS', l: 'Administrative expenses', cls: 'i1' },
  { c: 'MARGEN_OPERACIONAL_NETO', l: 'Net operating margin', cls: 'hl' },
  { c: 'RESULTADO_ANTES_IMPUESTO', l: 'Result before tax', cls: 'i1' },
  { c: 'IMPUESTO_RENTA', l: 'Income tax', cls: 'i1' },
  { c: 'RESULTADO_NETO', l: 'NET INCOME', cls: 'hl' },
];

const PE_R1_SET = new Set(R1_PE_ROWS.map(r => r.c));

/** True if cuenta belongs to income statement (custom KPI picker). */
export function peIsR1Cuenta(cuenta) {
  return PE_R1_SET.has(cuenta) || cuenta === PE_KPI.utilidad;
}

export function peB1AccountsForRun() {
  return [...new Set([
    PE_KPI.activos,
    PE_KPI.colocaciones,
    PE_KPI.pasivos,
    PE_KPI.patrimonio,
    PE_KPI.captaciones,
    PE_KPI.depVista,
    PE_KPI.depAhorro,
    PE_KPI.depPlazo,
    ...BAL_PE_SECTIONS.assets.map(r => r.c),
    ...BAL_PE_SECTIONS.liabilities.map(r => r.c),
    ...BAL_PE_SECTIONS.equity.map(r => r.c),
  ])];
}

export function peR1AccountsForRun() {
  return [...new Set([PE_KPI.utilidad, ...R1_PE_ROWS.map(r => r.c)])];
}
