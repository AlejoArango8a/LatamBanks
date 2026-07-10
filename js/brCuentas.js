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

// ============================================================
// Estados financieros — cuentas Cosif (plan nuevo ≥2025)
//   Balance Sheet  = Relatorio 2 (Ativo) + 3 (Passivo)
//   Income Stmt.   = Relatorio 4 (Demonstração de Resultado)
// Formato de fila: {c: cuenta, l: etiqueta, cls: 'hl'|'i1'|'i2'|'i3'}
// ============================================================
export const BAL_BR_SECTIONS = {
  assets: [
    {c:'140220', l:'ATIVO TOTAL', cls:'hl'},
    {c:'140198', l:'Disponibilidades', cls:'i1'},
    {c:'140199', l:'Aplicações Interfinanceiras de Liquidez', cls:'i1'},
    {c:'140200', l:'Títulos e Valores Mobiliários', cls:'i1'},
    {c:'141612', l:'Instrumentos Derivativos', cls:'i1'},
    {c:'140205', l:'Operações de Crédito', cls:'i1'},
    {c:'140210', l:'Operações de Arrendamento Financeiro', cls:'i1'},
    {c:'140216', l:'Outras Op. c/ Caract. de Concessão de Crédito', cls:'i1'},
    {c:'145833', l:'Valores a Receber de Pagamentos', cls:'i1'},
    {c:'140218', l:'Outros Ativos Realizáveis', cls:'i1'},
    {c:'140219', l:'Ativo Permanente', cls:'i1'},
  ],
  liabilities: [
    {c:'140247', l:'PASSIVO TOTAL', cls:'hl'},
    {c:'140244', l:'Passivo Exigível', cls:'hl'},
    {c:'140239', l:'Captações', cls:'i1'},
    {c:'140228', l:'Depósitos', cls:'i2'},
    {c:'140222', l:'Depósitos à Vista', cls:'i3'},
    {c:'140223', l:'Depósitos de Poupança', cls:'i3'},
    {c:'140225', l:'Depósitos a Prazo', cls:'i3'},
    {c:'140224', l:'Depósitos Interfinanceiros', cls:'i3'},
    {c:'140230', l:'Obrigações por Op. Compromissadas', cls:'i2'},
    {c:'140236', l:'Outros Instrumentos de Dívida', cls:'i2'},
    {c:'140238', l:'Obrigações por Empréstimos e Repasses', cls:'i2'},
    {c:'140241', l:'Instrumentos Derivativos', cls:'i1'},
    {c:'140242', l:'Outras Obrigações', cls:'i1'},
    {c:'140243', l:'Instrumentos de Dívida Elegíveis a Capital', cls:'i1'},
  ],
  equity: [
    {c:'140246', l:'PATRIMÔNIO LÍQUIDO', cls:'hl'},
  ],
};
BAL_BR_SECTIONS.activos    = BAL_BR_SECTIONS.assets;
BAL_BR_SECTIONS.pasivos    = BAL_BR_SECTIONS.liabilities;
BAL_BR_SECTIONS.patrimonio = BAL_BR_SECTIONS.equity;

export const R1_BR_ROWS = [
  {l:'Rendas de Aplic. Interfinanceiras', c:'141825', cls:'i1'},
  {l:'Rendas de TVM', c:'141830', cls:'i1'},
  {l:'Rendas de Operações de Crédito', c:'141835', cls:'i1'},
  {l:'Rendas de Arrendamento Financeiro', c:'141836', cls:'i1'},
  {l:'Rendas de Outras Op. de Crédito', c:'141837', cls:'i1'},
  {l:'Resultado com Perda Esperada', c:'141842', cls:'i1'},
  {l:'Despesas de Captações', c:'141847', cls:'i1'},
  {l:'Despesas Instr. Dívida (Capital)', c:'141848', cls:'i1'},
  {l:'Resultado com Derivativos', c:'141849', cls:'i1'},
  {l:'Outros Res. de Intermediação', c:'141850', cls:'i1'},
  {l:'RESULTADO DE INTERMEDIAÇÃO FINANCEIRA', c:'141851', cls:'hl'},
  {l:'Resultado com Transações de Pagamento', c:'141855', cls:''},
  {l:'Rendas de Tarifas Bancárias', c:'141856', cls:'i1'},
  {l:'Outras Rendas de Serviços', c:'141857', cls:'i1'},
  {l:'Despesas de Pessoal', c:'141858', cls:'i1'},
  {l:'Despesas Administrativas', c:'141859', cls:'i1'},
  {l:'Res. Perdas Esperadas Outras Op.', c:'141860', cls:'i1'},
  {l:'Despesas Tributárias', c:'141862', cls:'i1'},
  {l:'Resultado de Participações', c:'141863', cls:'i1'},
  {l:'Outras Receitas', c:'141864', cls:'i1'},
  {l:'Outras Despesas', c:'141865', cls:'i1'},
  {l:'OUTRAS RECEITAS / DESPESAS', c:'141866', cls:'hl'},
  {l:'RESULTADO ANTES DA TRIBUTAÇÃO', c:'141867', cls:'hl'},
  {l:'Imposto de Renda e CSLL', c:'141868', cls:'i1'},
  {l:'Participações no Lucro', c:'141869', cls:'i1'},
  {l:'LUCRO LÍQUIDO', c:'141870', cls:'hl'},
];

const _brSectionCodes = () => [...new Set(
  ['assets', 'liabilities', 'equity'].flatMap(k => BAL_BR_SECTIONS[k].map(r => r.c))
)];

/** Todas las cuentas b1 (balance) a pedir en run() para Brasil (KPIs + estado). */
export function brB1AccountsForRun() {
  return [...new Set([
    ...BR_KPI.activos, ...BR_KPI.colocaciones, ...BR_KPI.captacoes,
    ...BR_KPI.pasivos, ...BR_KPI.patrimonio, ...BR_KPI.tvm,
    ..._brSectionCodes(),
  ])];
}

/** Todas las cuentas r1 (resultado) a pedir en run() para Brasil (KPI + estado). */
export function brR1AccountsForRun() {
  return [...new Set([...BR_KPI.utilidad, ...R1_BR_ROWS.map(r => r.c)])];
}

/** Suma monto_total sobre un CONJUNTO de códigos equivalentes (un banco · un período). */
export function brSum(rowsSameBank, codes, periodo) {
  const set = new Set(codes);
  return rowsSameBank
    .filter(r => set.has(r.cuenta) && (!periodo || r.periodo === periodo))
    .reduce((s, r) => s + (Number(r.monto_total) || 0), 0);
}

/**
 * Brasil: la Demonstração de Resultado se acumula por SEMESTRE (reinicia en enero
 * y julio). El valor "publicado" en un trimestre H2 (sep/dic) NO es YTD del año.
 * Convierte un mapa { 'AAAAMM': valorPublicado } (mismo banco) al modo pedido:
 *   'ytd'     → acumulado del AÑO (en H2 suma el cierre de junio del mismo año).
 *   'quarter' → resultado SOLO del trimestre (desacumula dentro del semestre).
 *   'published' → tal cual lo publica IF.data (acumulado del semestre).
 */
export function brResultReset(valByPeriod, periodo, mode = 'ytd') {
  const y = String(periodo).slice(0, 4);
  const m = parseInt(String(periodo).slice(4, 6), 10);
  const raw = Number(valByPeriod[periodo] || 0);
  if (mode === 'published') return raw;
  if (mode === 'quarter') {
    if (m === 3 || m === 9) return raw;                 // inicio de semestre = trimestre solo
    const prev = m === 6 ? `${y}03` : m === 12 ? `${y}09` : null;
    if (!prev) return raw;
    if (!(prev in valByPeriod)) return null;            // falta el período anterior → no desacumulable
    return raw - Number(valByPeriod[prev] || 0);
  }
  // 'ytd' (default)
  if (m <= 6) return raw;                                // H1: el publicado ya es YTD
  return Number(valByPeriod[`${y}06`] || 0) + raw;       // H2: junio (H1) + acumulado del semestre
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
