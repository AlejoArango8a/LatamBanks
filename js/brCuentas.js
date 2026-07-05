// ============================================================
// Brasil — IF.data (BCB / Olinda), Relatorio 1 (Resumo).
// Los códigos `Conta` cambiaron con el nuevo plan Cosif de marzo-2025
// (Resolución CMN 4.966/2021). Como los códigos viejos y nuevos NUNCA coexisten
// en un mismo trimestre, cada KPI se define como el CONJUNTO {viejo, nuevo} y se
// suma: en cada período solo existe uno, así la serie queda continua a través de
// la frontera. Este es el "DE/PARA" respaldado por los códigos Cosif oficiales
// (campo DescricaoColuna) que guardamos en plan_cuentas.formula.
//
//  KPI                 | viejo (≤dic-2024) | nuevo (≥mar-2025)
//  --------------------|-------------------|------------------
//  Ativo Total         | 78182             | 140220
//  Carteira de Crédito | 78183 (⚠ def.)    | 141873 (⚠ def.)
//  Passivo             | 78184 (⚠ def.)    | 140244 (⚠ def.)
//  Captações           | 78185             | 140239
//  Patrimônio Líquido  | 78186             | 140246
//  Lucro Líquido (r1)  | 78187             | 141870
//  Títulos e Val. Mob. | —                 | 140200 (solo nuevo)
//
// ⚠ Carteira y Passivo cambiaron de DEFINICIÓN (no solo de código) en 2025, así
// que puede haber un pequeño salto real en la serie en la frontera. Eso queda
// documentado por la alerta de la Tarea A en la pestaña Config.
// ============================================================

export const BR_KPI = {
  activos:      ['78182', '140220'],
  colocaciones: ['78183', '141873'],
  captacoes:    ['78185', '140239'],
  pasivos:      ['78184', '140244'],
  patrimonio:   ['78186', '140246'],
  utilidad:     ['78187', '141870'],   // tipo r1
  tvm:          ['140200'],            // solo plan nuevo
};

/** Todas las cuentas b1 (balance) a pedir en run() para Brasil. */
export function brB1AccountsForRun() {
  return [
    ...BR_KPI.activos, ...BR_KPI.colocaciones, ...BR_KPI.captacoes,
    ...BR_KPI.pasivos, ...BR_KPI.patrimonio, ...BR_KPI.tvm,
  ];
}

/** Todas las cuentas r1 (resultado) a pedir en run() para Brasil. */
export function brR1AccountsForRun() {
  return [...BR_KPI.utilidad];
}

/** Suma monto_total sobre un CONJUNTO de códigos equivalentes (un banco · un período). */
export function brSum(rowsSameBank, codes, periodo) {
  const set = new Set(codes);
  return rowsSameBank
    .filter(r => set.has(r.cuenta) && (!periodo || r.periodo === periodo))
    .reduce((s, r) => s + (Number(r.monto_total) || 0), 0);
}

/** Serie temporal (por período) de un conjunto de códigos equivalentes. */
export function brSeries(rowsSameBank, codes, periodos) {
  const set = new Set(codes);
  return periodos.map(p =>
    rowsSameBank
      .filter(r => set.has(r.cuenta) && r.periodo === p)
      .reduce((s, r) => s + (Number(r.monto_total) || 0), 0)
  );
}
