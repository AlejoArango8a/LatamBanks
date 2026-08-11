// ============================================================
// Chile macros strip — UF / USD / IPC / TPM / UTM / TMC
// ============================================================
import { API_BASE } from './config.js?v=bmon95';
import { ST } from './state.js?v=bmon95';

function fmtNum(n, digs = 2) {
  if (n == null || !Number.isFinite(Number(n))) return '—';
  return Number(n).toLocaleString('es-CL', {
    minimumFractionDigits: digs,
    maximumFractionDigits: digs,
  });
}

let macrosPromise = null;

/**
 * Shared read of /api/chile/macros. The sidebar strip and the FX cascade both
 * need it on the same page load, and it used to be fetched twice — each call
 * costing a full scan of the Chile partition. A failed attempt is not memoized
 * so a later country switch can retry.
 */
export function fetchChileMacros() {
  if (!macrosPromise) {
    macrosPromise = fetch(`${API_BASE}/api/chile/macros`)
      .then((r) => (r.ok ? r.json() : null))
      .catch(() => null)
      .then((j) => {
        if (!j?.ok) macrosPromise = null;
        return j;
      });
  }
  return macrosPromise;
}

/**
 * Populate #clMacrosStrip when country === chile.
 * Safe no-op if the element is missing.
 */
export async function refreshChileMacrosStrip() {
  const el = document.getElementById('clMacrosStrip');
  if (!el) return;
  if (ST.country !== 'chile') {
    el.style.display = 'none';
    el.innerHTML = '';
    return;
  }
  el.style.display = 'block';
  el.innerHTML = '<span style="color:var(--text3)">Macros…</span>';
  try {
    const j = await fetchChileMacros();
    if (!j?.ok || !j.macros || !Object.keys(j.macros).length) {
      el.innerHTML = '<span style="color:var(--text3)">Macros pending load</span>';
      return;
    }
    const m = j.macros;
    const per = j.period
      ? `${j.period.slice(0, 4)}-${j.period.slice(4, 6)}`
      : '';
    const parts = [
      m.uf != null ? `UF ${fmtNum(m.uf)}` : null,
      m.usd != null ? `USD ${fmtNum(m.usd)}` : null,
      m.ipc != null ? `IPC ${fmtNum(m.ipc)}%` : null,
      m.tpm != null ? `TPM ${fmtNum(m.tpm)}%` : null,
      m.utm != null ? `UTM ${fmtNum(m.utm, 0)}` : null,
      m.tmc != null ? `TMC ${fmtNum(m.tmc)}%` : null,
    ].filter(Boolean);
    el.innerHTML = `<div style="font-family:var(--mono);font-size:10px;color:var(--text2);line-height:1.55;">
      <div style="color:var(--text3);letter-spacing:0.5px;margin-bottom:2px;">Chile macros${per ? ` · ${per}` : ''}</div>
      <div>${parts.join(' · ')}</div>
    </div>`;
  } catch (_) {
    el.innerHTML = '<span style="color:var(--text3)">Macros unavailable</span>';
  }
}
