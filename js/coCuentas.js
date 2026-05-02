// ============================================================
// Colombia CUIF — 6 dígitos (clasificación financiera típica SFC)
// Derivado de datos reales datos_financieros CO (prioridad cobertura b1/r1).
// ============================================================
export const CO_CUIF = {
  activos: '100000',
  colocaciones: '140000',
  pasivos: '200000',
  patrimonio: '300000',
  /** Depósitos en cuenta corriente (CUIF nombre estándar: “DEPOSITOS EN CUENTA CORRIENTE”, cuenta típica 210500). */
  depVista: '210500',
  /** Certificados de depósito a término (“CERTIFICADOS DE DEPOSITO A TERMINO”, típico 210700). */
  depPlazo: '210700',
  bonos: '250000',
  utilidadNet: '590000',
};

/** Agregador “CATEGORIA E … RIESGO DE INCOBRABILIDAD” cuando el reporte viene consolidado. */
export const CO_CUIF_NPL_ROLLUP = '141225';

/**
 * Segmentación por producto (sin el agregador 141225) para sumar cuando 141225 no viene informado.
 * No equivale literalmente al NPL +90 d Chile (CMF c1).
 */
export const CO_CUIF_NPL_SEGMENTS = [
  '141025',
  '141480',
  '140445',
  '141425',
  '141450',
  '148825',
  '148850',
  '148880',
  '160548',
  '160838',
  '160848',
];

/** Balance Sheet tabs — cuentas 6d; alineado con B1_CO en resumen.run */
export const BAL_CO_SECTIONS = {
  assets: [
    { c: CO_CUIF.activos, l: 'Total assets', cls: 'hl' },
    { c: CO_CUIF.colocaciones, l: 'Loans · gross portfolio', cls: 'i2' },
    { c: CO_CUIF_NPL_ROLLUP, l: 'Category E · roll-up (CUIF)', cls: 'i3' },
    ...CO_CUIF_NPL_SEGMENTS.map(c => ({ c, l: `Category E · ${c}`, cls: 'i3' })),
  ],
  liabilities: [
    { c: CO_CUIF.pasivos, l: 'Total liabilities', cls: 'hl' },
    { c: CO_CUIF.depVista, l: 'Demand deposits', cls: 'i2' },
    { c: CO_CUIF.depPlazo, l: 'Time deposits', cls: 'i2' },
    { c: CO_CUIF.bonos, l: 'Issued bonds', cls: 'i2' },
  ],
  equity: [
    { c: CO_CUIF.patrimonio, l: 'Total equity', cls: 'hl' },
  ],
};

/** Income Statement — filas r1 cargadas hoy para CO (ampliar con R1_CO en run si hace falta). */
export const R1_CO_ROWS = [
  { l: 'Net income', c: CO_CUIF.utilidadNet, cls: 'hl' },
];

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
