// ============================================================
// Colombia CUIF — 6 dígitos (clasificación financiera típica SFC)
// Derivado de datos reales datos_financieros CO (prioridad cobertura b1/r1).
// ============================================================
export const CO_CUIF = {
  activos: '100000',
  colocaciones: '140000',
  pasivos: '200000',
  patrimonio: '300000',
  depVista: '241000',
  depPlazo: '242000',
  bonos: '250000',
  utilidadNet: '590000',
};

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
