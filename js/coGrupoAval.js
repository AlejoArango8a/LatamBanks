// ============================================================
// Colombia — Grupo Aval consolidado (cliente)
// Código sintético CUIF: suma lineal de los 4 bancos miembro.
// ============================================================
import { ST, datasetIsoCountry } from './state.js?v=bmon14';

/** codigo_entidad que no debe colisionar con bancos reales (CUIF usa enteros bajos). */
export const CO_GRUPO_AVAL_SYNTHETIC_CODE = 10_001;

export const CO_AVAL_MEMBER_CODES = Object.freeze([1, 2, 23, 49]);

const MEM = new Set(CO_AVAL_MEMBER_CODES);
const KEY_SEP = '\x1e';

function numList(arr) {
  if (!Array.isArray(arr)) return [];
  return [...new Set(arr.map(c => Number(c)).filter(c => !Number.isNaN(c)))];
}

/** Reemplazar el sintético por los miembros en la petición a /api/datos. */
export function expandGrupoAvalFetchBanks(bancos) {
  if (!Array.isArray(bancos) || !bancos.length) {
    return { fetchBanks: null, requestedBanks: null, synthRequested: false };
  }
  const original = numList(bancos);
  if (datasetIsoCountry() !== 'CO') {
    return { fetchBanks: original, requestedBanks: original, synthRequested: false };
  }
  const synthRequested = original.includes(CO_GRUPO_AVAL_SYNTHETIC_CODE);
  const fetch = new Set(original.filter(c => c !== CO_GRUPO_AVAL_SYNTHETIC_CODE));
  if (synthRequested) CO_AVAL_MEMBER_CODES.forEach(c => fetch.add(c));
  return {
    fetchBanks: [...fetch],
    requestedBanks: original,
    synthRequested,
  };
}

/**
 * Tras la respuesta: si pidieron el sintético, agregan filas ins_cod = sintético = suma de miembros.
 * Los miembros solo se devuelven si también se pidieron en requestedBanks.
 */
export function mergeGrupoAvalApiRows(rows, requestedBancos) {
  if (datasetIsoCountry() !== 'CO') return rows;
  const req = numList(requestedBancos);
  if (!req.length || !req.includes(CO_GRUPO_AVAL_SYNTHETIC_CODE)) return rows;

  const explicitMembers = new Set(req.filter(c => MEM.has(c)));
  const agg = new Map();
  const out = [];

  for (const r of rows) {
    const ins = Number(r.ins_cod);
    if (MEM.has(ins)) {
      const tipo = r.tipo != null ? String(r.tipo) : '';
      const k = [r.periodo, String(r.cuenta), tipo].join(KEY_SEP);
      agg.set(k, (agg.get(k) || 0) + Number(r.monto_total || 0));
      if (explicitMembers.has(ins)) out.push(r);
      continue;
    }
    out.push(r);
  }

  let template = rows.find(r => MEM.has(Number(r.ins_cod)));
  for (const [k, monto_total] of agg) {
    const [periodo, cuenta, tipo] = k.split(KEY_SEP);
    const row = {
      periodo,
      cuenta,
      ins_cod: CO_GRUPO_AVAL_SYNTHETIC_CODE,
      monto_total,
    };
    if (tipo) row.tipo = tipo;
    if (template) {
      for (const col of ['monto_clp', 'monto_uf', 'monto_tc', 'monto_ext']) {
        if (col in template) row[col] = 0;
      }
    }
    out.push(row);
  }
  return out;
}

/** Tras bootstrap CO: nombre en sidebar + patrimonio = suma miembros + re-ranking. */
export function patchColombiaGrupoAvalBootstrap() {
  if (datasetIsoCountry() !== 'CO') return;
  if (!ST._patrimonioMap) ST._patrimonioMap = {};

  ST.bancos[CO_GRUPO_AVAL_SYNTHETIC_CODE] = 'Grupo Aval';

  const sumPat = CO_AVAL_MEMBER_CODES.reduce((s, c) => s + (ST._patrimonioMap[c] || 0), 0);
  ST._patrimonioMap[CO_GRUPO_AVAL_SYNTHETIC_CODE] = sumPat;

  const codeSet = new Set([
    ...Object.keys(ST.bancos).map(Number).filter(c => c !== 999 && ST.bancos[c] != null),
    ...Object.keys(ST._patrimonioMap).map(Number),
  ]);
  ST._patrimonioRanking = [...codeSet]
    .filter(c => c !== 999)
    .sort((a, b) => (ST._patrimonioMap[b] || 0) - (ST._patrimonioMap[a] || 0));
}
