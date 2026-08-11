// ============================================================
// Chile Basilea III — CMF Adecuación de Capital maps
// Ratios live in tipo='q1' (percent ×100); stocks in tipo='x1' (pesos).
// ============================================================
import { aqRatioFromQ1, aqPct } from './aqCuentas.js?v=bmon98';

export const CL_B3 = {
  peApr: 'CL_B3_PE_APR',
  t1Apr: 'CL_B3_T1_APR',
  cet1Apr: 'CL_B3_CET1_APR',
  lev: 'CL_B3_LEV',
  bufDef: 'CL_B3_BUF_DEF',
  klass: 'CL_B3_CLASS',
  cet1: 'CL_B3_CET1',
  at1: 'CL_B3_AT1',
  t1: 'CL_B3_T1',
  t2: 'CL_B3_T2',
  pe: 'CL_B3_PE',
  atr: 'CL_B3_ATR',
  apr: 'CL_B3_APR',
  aprc: 'CL_B3_APRC',
  aprm: 'CL_B3_APRM',
  apro: 'CL_B3_APRO',
};

export const CL_B3_Q1_ACCOUNTS = [
  CL_B3.peApr, CL_B3.t1Apr, CL_B3.cet1Apr, CL_B3.lev, CL_B3.bufDef, CL_B3.klass,
];

export const CL_B3_X1_ACCOUNTS = [
  CL_B3.cet1, CL_B3.at1, CL_B3.t1, CL_B3.t2, CL_B3.pe,
  CL_B3.atr, CL_B3.apr, CL_B3.aprc, CL_B3.aprm, CL_B3.apro,
];

export const CL_B3_COLORS = {
  cet1: '#0d3b66',
  t1: '#0d9488',
  pe: '#16a34a',
  lev: '#ca8a04',
  aprc: '#0284c7',
  aprm: '#db2777',
  apro: '#a16207',
  system: '#64748b',
};

/** Single-bank q1 ratio (%). Never averages peers. */
export function clB3Ratio(rowsQ1, code, periodo) {
  const hits = (rowsQ1 || []).filter(
    (r) => String(r.cuenta) === String(code) && (!periodo || r.periodo === periodo),
  );
  if (hits.length !== 1) return null;
  if (code === CL_B3.klass) {
    const n = Number(hits[0].monto_total);
    return Number.isFinite(n) ? n : null;
  }
  return aqRatioFromQ1(hits[0].monto_total);
}

export function clB3Stock(rowsX1, code, periodo) {
  const hits = (rowsX1 || []).filter(
    (r) => String(r.cuenta) === String(code) && (!periodo || r.periodo === periodo),
  );
  if (!hits.length) return null;
  return hits.reduce((s, r) => s + (Number(r.monto_total) || 0), 0);
}

export function clB3RatioSeries(rowsQ1, code, periodos) {
  return (periodos || []).map((p) => clB3Ratio(rowsQ1, code, p));
}

export function clB3StockSeries(rowsX1, code, periodos) {
  return (periodos || []).map((p) => clB3Stock(rowsX1, code, p));
}

export function clB3ClassLabel(v) {
  if (v == null || !Number.isFinite(Number(v))) return '—';
  const n = Number(v);
  if (n === 1 || n === 'A' || String(v).toUpperCase() === 'A') return 'A';
  if (n === 2 || String(v).toUpperCase() === 'B') return 'B';
  if (n === 3 || String(v).toUpperCase() === 'C') return 'C';
  return String(v);
}

/**
 * Snapshot for one bank / one period.
 * Prefer published q1 ratios; fall back to stock-derived when needed.
 */
export function clB3Snapshot(rowsQ1, rowsX1, periodo) {
  const cet1Apr = clB3Ratio(rowsQ1, CL_B3.cet1Apr, periodo);
  const t1Apr = clB3Ratio(rowsQ1, CL_B3.t1Apr, periodo);
  const peApr = clB3Ratio(rowsQ1, CL_B3.peApr, periodo);
  const lev = clB3Ratio(rowsQ1, CL_B3.lev, periodo);
  const bufDef = clB3Ratio(rowsQ1, CL_B3.bufDef, periodo);
  const klass = clB3Ratio(rowsQ1, CL_B3.klass, periodo);

  const cet1 = clB3Stock(rowsX1, CL_B3.cet1, periodo);
  const at1 = clB3Stock(rowsX1, CL_B3.at1, periodo);
  const t1 = clB3Stock(rowsX1, CL_B3.t1, periodo);
  const t2 = clB3Stock(rowsX1, CL_B3.t2, periodo);
  const pe = clB3Stock(rowsX1, CL_B3.pe, periodo);
  const atr = clB3Stock(rowsX1, CL_B3.atr, periodo);
  const apr = clB3Stock(rowsX1, CL_B3.apr, periodo);
  const aprc = clB3Stock(rowsX1, CL_B3.aprc, periodo);
  const aprm = clB3Stock(rowsX1, CL_B3.aprm, periodo);
  const apro = clB3Stock(rowsX1, CL_B3.apro, periodo);

  return {
    periodo,
    cet1Apr,
    t1Apr,
    peApr,
    lev,
    bufDef,
    klass,
    classLabel: clB3ClassLabel(klass),
    cet1,
    at1,
    t1,
    t2,
    pe,
    atr,
    apr,
    aprc,
    aprm,
    apro,
    aprcPct: aqPct(aprc, apr),
    aprmPct: aqPct(aprm, apr),
    aproPct: aqPct(apro, apr),
    cet1FromStocks: aqPct(cet1, apr),
    peFromStocks: aqPct(pe, apr),
  };
}
