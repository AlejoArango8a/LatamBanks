// ============================================================
// Chile Institutional Funding — account helpers (FM DAP / BB / BS)
// ============================================================

export const CL_IF_DAP = 'CL_IF_DAP';
export const CL_IF_BB = 'CL_IF_BB';
export const CL_IF_BS = 'CL_IF_BS';
export const CL_IF_OTHER_DAP = 'CL_IF_OTHER_DAP';

/** Bank CoA denominators for “% of bank liability” */
export const CL_BANK_DAP_LIAB = '242000100'; // Depósitos a plazo
export const CL_BANK_BB_LIAB = '245000200'; // Bonos senior

export const CL_IF_COLORS = {
  dap: '#0d3b66',
  bb: '#0d9488',
  bs: '#a16207',
  total: '#334155',
  muted: '#94a3b8',
  other: '#64748b',
};

/** @param {string|number} agfRut */
export function clIfAgfAccount(agfRut, bucket /* 'DAP'|'BB'|'BS' */) {
  return `CL_IF_AGF_${agfRut}_${bucket}`;
}

/** @param {string|number} agfRut @param {string|number} bankCode */
export function clIfMatrixAccount(agfRut, bankCode, bucket) {
  return `CL_IF_AGF_${agfRut}_BANK_${bankCode}_${bucket}`;
}

/**
 * @param {Array<{rut:string}>} agfs
 * @param {number[]} bankCodes
 */
export function clIfAccountsForFetch(agfs, bankCodes) {
  const buckets = ['DAP', 'BB', 'BS'];
  const set = new Set([CL_IF_DAP, CL_IF_BB, CL_IF_BS, CL_IF_OTHER_DAP, 'CL_IF_OTHER_BB', 'CL_IF_OTHER_BS', 'CL_IF_OTHER_TANNER_SF_DAP']);
  for (const a of agfs || []) {
    const rut = a.rut || a;
    for (const bkt of buckets) {
      set.add(clIfAgfAccount(rut, bkt));
      for (const bank of bankCodes || []) {
        set.add(clIfMatrixAccount(rut, bank, bkt));
      }
    }
  }
  return [...set];
}

export function clIfLiabilityAccounts() {
  return [CL_BANK_DAP_LIAB, CL_BANK_BB_LIAB];
}
