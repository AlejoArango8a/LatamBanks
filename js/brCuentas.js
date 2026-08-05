// ============================================================
// Brasil — IF.data (BCB), Cosif viejo ≤202412 + nuevo ≥202503
// ============================================================
// Los códigos `Conta` cambiaron con el plan Cosif de marzo-2025
// (Resolução CMN 4.966/2021). Como viejos y nuevos NUNCA coexisten
// con saldo no-cero en el mismo trimestre, cada métrica es el conjunto
// {viejo, nuevo} y se suma: la serie queda continua a través de la frontera.
//
//  KPI / funding        | viejo (≤dic-2024) | nuevo (≥mar-2025)
//  ---------------------|-------------------|------------------
//  Ativo Total          | 78182             | 140220
//  Carteira de Crédito  | 78183 (⚠ def.)    | 141873 (⚠ def.)
//  Passivo              | 78184 (⚠ def.)    | 140244 (⚠ def.)
//  Captações            | 78185             | 140239
//  Patrimônio Líquido   | 78186             | 140246
//  Lucro Líquido        | 78187             | 141870
//  Depósitos à Vista    | 78282             | 140222
//  Poupança             | 78283             | 140223
//  Interfinanceiros     | 78284             | 140224
//  Depósitos a Prazo    | 78286             | 140225
//  Depósitos (total)    | 78287             | 140228
//  Compromissadas       | 78288             | 140230
//  LCI                  | 78289             | 140231
//  LCA                  | 78290             | 140232
//  Letras Financeiras   | 78291             | 140233
//  TVM Exterior         | 78292             | 140234
//  Demais dívida        | 78293             | 140235
//  Outros instr. dívida | 78294             | 140236
//  Emprést./Repasses    | 78295             | 140238
//  Despesas Captação    | 78209             | 141847
//
// Tax-advantaged bank liabilities (eligibles PF): LCA + LCI (+ LIG/LH/LCD
// when available in IF.data). CRA/CRI are NOT bank funding liabilities.
// ============================================================

export const BR_KPI = {
  activos:      ['78182', '140220'],
  colocaciones: ['78183', '141873'],
  captacoes:    ['78185', '140239'],
  pasivos:      ['78184', '140244'],
  patrimonio:   ['78186', '140246'],
  utilidad:     ['78187', '141870'],
  tvm:          ['140200'],
  depositos:    ['78287', '140228'],
  depVista:     ['78282', '140222'],
  depPlazo:     ['78286', '140225'],
  poupanca:     ['78283', '140223'],
  interfin:     ['78284', '140224'],
  compromissadas: ['78288', '140230'],
  lci:          ['78289', '140231'],
  lca:          ['78290', '140232'],
  lf:           ['78291', '140233'],
  tvmExterior:  ['78292', '140234'],
  demaisDivida: ['78293', '140235'],
  outrosDivida: ['78294', '140236'],
  emprestimosRepasses: ['78295', '140238'],
  capitalEligible: ['140243'],
  despesasCaptacao: ['78209', '141847'],
};

/** Instruments for Funding Analytics (order = chart stack bottom→top). */
export const BR_FUNDING_INSTRUMENTS = [
  { key: 'depVista',     label: 'Demand deposits',           short: 'Vista',        codes: BR_KPI.depVista,           group: 'deposits', taxEligible: false },
  { key: 'poupanca',     label: 'Savings (Poupança)',        short: 'Poupança',     codes: BR_KPI.poupanca,           group: 'deposits', taxEligible: 'partial' },
  { key: 'depPlazo',     label: 'Time deposits (CDB/RDB)',   short: 'Prazo',        codes: BR_KPI.depPlazo,           group: 'deposits', taxEligible: false },
  { key: 'interfin',     label: 'Interbank deposits',        short: 'Interfin.',    codes: BR_KPI.interfin,           group: 'deposits', taxEligible: false },
  { key: 'lci',          label: 'LCI (real estate letters)', short: 'LCI',          codes: BR_KPI.lci,                group: 'letters',  taxEligible: true },
  { key: 'lca',          label: 'LCA (agribusiness letters)', short: 'LCA',         codes: BR_KPI.lca,                group: 'letters',  taxEligible: true },
  { key: 'lf',           label: 'Letras Financeiras (LF)',   short: 'LF',           codes: BR_KPI.lf,                 group: 'letters',  taxEligible: false },
  { key: 'tvmExterior',  label: 'Securities issued abroad',  short: 'Exterior',     codes: BR_KPI.tvmExterior,        group: 'wholesale', taxEligible: false },
  { key: 'demaisDivida', label: 'Other debt instruments',    short: 'Other debt',   codes: BR_KPI.demaisDivida,       group: 'wholesale', taxEligible: false },
  { key: 'compromissadas', label: 'Repos / compromissadas',  short: 'Repos',         codes: BR_KPI.compromissadas,     group: 'wholesale', taxEligible: false },
  { key: 'emprestimosRepasses', label: 'Loans & on-lending', short: 'Repasses',     codes: BR_KPI.emprestimosRepasses, group: 'wholesale', taxEligible: false },
];

/** Colors for funding stack / bars (distinct, non-purple-default). */
export const BR_FUNDING_COLORS = {
  depVista: '#0ea5e9',
  poupanca: '#38bdf8',
  depPlazo: '#0284c7',
  interfin: '#64748b',
  lci: '#059669',
  lca: '#16a34a',
  lf: '#ca8a04',
  tvmExterior: '#b45309',
  demaisDivida: '#a8a29e',
  compromissadas: '#78716c',
  emprestimosRepasses: '#57534e',
  taxEligible: '#16a34a',
  captacoes: '#0d3b66',
};

export const BR_TAX_ELIGIBLE_CODES = [
  ...BR_KPI.lci,
  ...BR_KPI.lca,
];

/** Balance sheet rows — `c` = display/new code; `old` = pre-2025 Conta when available. */
export const BAL_BR_SECTIONS = {
  assets: [
    { c: '140220', old: '78182', l: 'ATIVO TOTAL', cls: 'hl' },
    { c: '140198', l: 'Disponibilidades', cls: 'i1' },
    { c: '140199', l: 'Aplicações Interfinanceiras de Liquidez', cls: 'i1' },
    { c: '140200', l: 'Títulos e Valores Mobiliários', cls: 'i1' },
    { c: '141612', l: 'Instrumentos Derivativos', cls: 'i1' },
    { c: '140205', l: 'Operações de Crédito', cls: 'i1' },
    { c: '140210', l: 'Operações de Arrendamento Financeiro', cls: 'i1' },
    { c: '140216', l: 'Outras Op. c/ Caract. de Concessão de Crédito', cls: 'i1' },
    { c: '145833', l: 'Valores a Receber de Pagamentos', cls: 'i1' },
    { c: '140218', l: 'Outros Ativos Realizáveis', cls: 'i1' },
    { c: '140219', l: 'Ativo Permanente', cls: 'i1' },
  ],
  liabilities: [
    { c: '140247', l: 'PASSIVO TOTAL', cls: 'hl' },
    { c: '140244', old: '78184', l: 'Passivo Exigível', cls: 'hl' },
    { c: '140239', old: '78185', l: 'Captações', cls: 'i1' },
    { c: '140228', old: '78287', l: 'Depósitos', cls: 'i2' },
    { c: '140222', old: '78282', l: 'Depósitos à Vista', cls: 'i3' },
    { c: '140223', old: '78283', l: 'Depósitos de Poupança', cls: 'i3' },
    { c: '140225', old: '78286', l: 'Depósitos a Prazo', cls: 'i3' },
    { c: '140224', old: '78284', l: 'Depósitos Interfinanceiros', cls: 'i3' },
    { c: '140227', old: '78285', l: 'Depósitos Outros', cls: 'i3' },
    { c: '140230', old: '78288', l: 'Obrigações por Op. Compromissadas', cls: 'i2' },
    { c: '140236', old: '78294', l: 'Outros Instrumentos de Dívida', cls: 'i2' },
    { c: '140231', old: '78289', l: 'LCI — Letras de Crédito Imobiliário', cls: 'i3' },
    { c: '140232', old: '78290', l: 'LCA — Letras de Crédito do Agronegócio', cls: 'i3' },
    { c: '140233', old: '78291', l: 'Letras Financeiras (LF)', cls: 'i3' },
    { c: '140234', old: '78292', l: 'TVM emitidos no Exterior', cls: 'i3' },
    { c: '140235', old: '78293', l: 'Demais instrumentos de dívida', cls: 'i3' },
    { c: '140238', old: '78295', l: 'Obrigações por Empréstimos e Repasses', cls: 'i2' },
    { c: '140241', l: 'Instrumentos Derivativos', cls: 'i1' },
    { c: '140242', l: 'Outras Obrigações', cls: 'i1' },
    { c: '140243', l: 'Instrumentos de Dívida Elegíveis a Capital', cls: 'i1' },
  ],
  equity: [
    { c: '140246', old: '78186', l: 'PATRIMÔNIO LÍQUIDO', cls: 'hl' },
  ],
};
BAL_BR_SECTIONS.activos = BAL_BR_SECTIONS.assets;
BAL_BR_SECTIONS.pasivos = BAL_BR_SECTIONS.liabilities;
BAL_BR_SECTIONS.patrimonio = BAL_BR_SECTIONS.equity;

export const R1_BR_ROWS = [
  { l: 'Rendas de Aplic. Interfinanceiras', c: '141825', cls: 'i1' },
  { l: 'Rendas de TVM', c: '141830', cls: 'i1' },
  { l: 'Rendas de Operações de Crédito', c: '141835', cls: 'i1' },
  { l: 'Rendas de Arrendamento Financeiro', c: '141836', cls: 'i1' },
  { l: 'Rendas de Outras Op. de Crédito', c: '141837', cls: 'i1' },
  { l: 'Resultado com Perda Esperada', c: '141842', cls: 'i1' },
  { l: 'Despesas de Captações', c: '141847', old: '78209', cls: 'i1' },
  { l: 'Despesas Instr. Dívida (Capital)', c: '141848', cls: 'i1' },
  { l: 'Resultado com Derivativos', c: '141849', cls: 'i1' },
  { l: 'Outros Res. de Intermediação', c: '141850', cls: 'i1' },
  { l: 'RESULTADO DE INTERMEDIAÇÃO FINANCEIRA', c: '141851', cls: 'hl' },
  { l: 'Resultado com Transações de Pagamento', c: '141855', cls: '' },
  { l: 'Rendas de Tarifas Bancárias', c: '141856', cls: 'i1' },
  { l: 'Outras Rendas de Serviços', c: '141857', cls: 'i1' },
  { l: 'Despesas de Pessoal', c: '141858', cls: 'i1' },
  { l: 'Despesas Administrativas', c: '141859', cls: 'i1' },
  { l: 'Res. Perdas Esperadas Outras Op.', c: '141860', cls: 'i1' },
  { l: 'Despesas Tributárias', c: '141862', cls: 'i1' },
  { l: 'Resultado de Participações', c: '141863', cls: 'i1' },
  { l: 'Outras Receitas', c: '141864', cls: 'i1' },
  { l: 'Outras Despesas', c: '141865', cls: 'i1' },
  { l: 'OUTRAS RECEITAS / DESPESAS', c: '141866', cls: 'hl' },
  { l: 'RESULTADO ANTES DA TRIBUTAÇÃO', c: '141867', cls: 'hl' },
  { l: 'Imposto de Renda e CSLL', c: '141868', cls: 'i1' },
  { l: 'Participações no Lucro', c: '141869', cls: 'i1' },
  { l: 'LUCRO LÍQUIDO', c: '141870', old: '78187', cls: 'hl' },
];

/** Cosif codes to sum for a balance/P&L row (new + optional old). */
export function brRowCodes(row) {
  if (!row) return [];
  if (Array.isArray(row.codes)) return row.codes;
  const out = [];
  if (row.c) out.push(String(row.c));
  if (row.old) out.push(String(row.old));
  return [...new Set(out)];
}

const _brSectionCodes = () => [...new Set(
  ['assets', 'liabilities', 'equity'].flatMap((k) =>
    BAL_BR_SECTIONS[k].flatMap((r) => brRowCodes(r))),
)];

/** Todas las cuentas b1 (balance) a pedir en run() para Brasil (KPIs + estado + funding). */
export function brB1AccountsForRun() {
  return [...new Set([
    ...BR_KPI.activos, ...BR_KPI.colocaciones, ...BR_KPI.captacoes,
    ...BR_KPI.pasivos, ...BR_KPI.patrimonio, ...BR_KPI.tvm,
    ...BR_KPI.depositos, ...BR_KPI.depVista, ...BR_KPI.depPlazo,
    ...BR_KPI.poupanca, ...BR_KPI.interfin, ...BR_KPI.compromissadas,
    ...BR_KPI.lci, ...BR_KPI.lca, ...BR_KPI.lf,
    ...BR_KPI.tvmExterior, ...BR_KPI.demaisDivida, ...BR_KPI.outrosDivida,
    ...BR_KPI.emprestimosRepasses, ...BR_KPI.capitalEligible,
    ..._brSectionCodes(),
  ])];
}

/** Todas las cuentas r1 (resultado) a pedir en run() para Brasil (KPI + estado). */
export function brR1AccountsForRun() {
  return [...new Set([
    ...BR_KPI.utilidad,
    ...BR_KPI.despesasCaptacao,
    ...R1_BR_ROWS.flatMap((r) => brRowCodes(r)),
  ])];
}

/** Cuentas de funding para la pestaña Funding Analytics. */
export function brFundingAccountsForRun() {
  return [...new Set([
    ...BR_KPI.captacoes,
    ...BR_KPI.depositos,
    ...BR_KPI.colocaciones,
    ...BR_KPI.despesasCaptacao,
    ...BR_FUNDING_INSTRUMENTS.flatMap((i) => i.codes),
  ])];
}

/** Suma monto_total sobre un CONJUNTO de códigos equivalentes (un banco · un período). */
export function brSum(rowsSameBank, codes, periodo) {
  const set = new Set(codes);
  return rowsSameBank
    .filter((r) => set.has(r.cuenta) && (!periodo || r.periodo === periodo))
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
    if (m === 3 || m === 9) return raw;
    const prev = m === 6 ? `${y}03` : m === 12 ? `${y}09` : null;
    if (!prev) return raw;
    if (!(prev in valByPeriod)) return null;
    return raw - Number(valByPeriod[prev] || 0);
  }
  if (m <= 6) return raw;
  return Number(valByPeriod[`${y}06`] || 0) + raw;
}

/** Serie temporal (por período) de un conjunto de códigos equivalentes. */
export function brSeries(rowsSameBank, codes, periodos) {
  const set = new Set(codes);
  return periodos.map((p) =>
    rowsSameBank
      .filter((r) => set.has(r.cuenta) && r.periodo === p)
      .reduce((s, r) => s + (Number(r.monto_total) || 0), 0),
  );
}

/** Snapshot de funding para un banco en un período. */
export function brFundingSnapshot(rowsSameBank, periodo) {
  const instruments = BR_FUNDING_INSTRUMENTS.map((inst) => {
    const value = brSum(rowsSameBank, inst.codes, periodo);
    return { ...inst, value };
  });
  const captacoes = brSum(rowsSameBank, BR_KPI.captacoes, periodo);
  const depositos = brSum(rowsSameBank, BR_KPI.depositos, periodo);
  const loans = brSum(rowsSameBank, BR_KPI.colocaciones, periodo);
  const taxEligible = brSum(rowsSameBank, BR_TAX_ELIGIBLE_CODES, periodo);
  const despesas = brSum(rowsSameBank, BR_KPI.despesasCaptacao, periodo);
  return {
    periodo,
    captacoes,
    depositos,
    loans,
    taxEligible,
    despesas,
    instruments,
    taxEligiblePct: captacoes > 0 ? (taxEligible / captacoes) * 100 : null,
    ltd: depositos > 0 ? loans / depositos : null,
    ltf: captacoes > 0 ? loans / captacoes : null,
  };
}
