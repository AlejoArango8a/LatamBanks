// ============================================================
// Chile Institutional Funding — account helpers (FM DAP / BB)
// ============================================================

export const CL_IF_DAP = 'CL_IF_DAP';
export const CL_IF_BB = 'CL_IF_BB';

export const CL_IF_COLORS = {
  dap: '#0d3b66',
  bb: '#0d9488',
  total: '#334155',
  muted: '#94a3b8',
};

/** @param {string|number} agfRut */
export function clIfAgfAccount(agfRut, bucket /* 'DAP'|'BB' */) {
  return `CL_IF_AGF_${agfRut}_${bucket}`;
}

/** @param {string|number} agfRut @param {string|number} bankCode */
export function clIfMatrixAccount(agfRut, bankCode, bucket) {
  return `CL_IF_AGF_${agfRut}_BANK_${bankCode}_${bucket}`;
}

export function clIfParseAgfFromAccount(cuenta) {
  const m = String(cuenta || '').match(/^CL_IF_AGF_(\d+)(?:_BANK_\d+)?_(DAP|BB)$/);
  return m ? { agfRut: m[1], bucket: m[2] } : null;
}

export function clIfParseMatrixAccount(cuenta) {
  const m = String(cuenta || '').match(/^CL_IF_AGF_(\d+)_BANK_(\d+)_(DAP|BB)$/);
  return m ? { agfRut: m[1], bankCode: Number(m[2]), bucket: m[3] } : null;
}

/**
 * Build the account list to fetch for Institutional Funding.
 * @param {Array<{rut:string}>} agfs
 * @param {number[]} bankCodes
 */
export function clIfAccountsForFetch(agfs, bankCodes) {
  const set = new Set([CL_IF_DAP, CL_IF_BB]);
  for (const a of agfs || []) {
    const rut = a.rut || a;
    set.add(clIfAgfAccount(rut, 'DAP'));
    set.add(clIfAgfAccount(rut, 'BB'));
    for (const b of bankCodes || []) {
      set.add(clIfMatrixAccount(rut, b, 'DAP'));
      set.add(clIfMatrixAccount(rut, b, 'BB'));
    }
  }
  return [...set];
}
