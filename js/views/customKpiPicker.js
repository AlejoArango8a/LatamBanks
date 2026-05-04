// ============================================================
// CUSTOM KEY DATA — cuenta del plan por país (modal + localStorage)
// ============================================================
import { ST, datasetIsoCountry } from '../state.js?v=bmon14';
import { getTipo, toSentenceCase, getExpLabel } from '../format.js?v=bmon14';

const LS_KEYS = { CO: 'kpiCustomCuenta_CO', CL: 'kpiCustomCuenta_CL' };

function storageKey() {
  return LS_KEYS[datasetIsoCountry()] || LS_KEYS.CL;
}

export function getSavedCustomKpi() {
  try {
    const raw = localStorage.getItem(storageKey());
    if (!raw) return null;
    const o = JSON.parse(raw);
    if (!o || typeof o.cuenta !== 'string' || !String(o.cuenta).trim()) return null;
    return { cuenta: String(o.cuenta).trim(), descripcion: String(o.descripcion || '') };
  } catch {
    return null;
  }
}

export function saveCustomKpi(cuenta, descripcion) {
  localStorage.setItem(storageKey(), JSON.stringify({ cuenta, descripcion }));
}

export function clearCustomKpi() {
  localStorage.removeItem(storageKey());
}

const RUBRO_LABEL = {
  1: 'Activos · Assets',
  2: 'Pasivos · Liabilities',
  3: 'Patrimonio · Equity',
  4: 'Ingresos · Income',
  5: 'Gastos · Expenses',
  6: 'Memorándos · Off-balance',
  7: 'Rubro 7',
  8: 'Suplementaria · Supplementary',
  9: 'Otras',
};

function rubroTitle(d) {
  if (d == null || d === '' || d === '?') return 'Otras';
  const n = Number(d);
  if (!Number.isNaN(n) && RUBRO_LABEL[n]) return RUBRO_LABEL[n];
  return `Rubro ${d}`;
}

/** Primeros 3 dígitos como subfamilia (CL 9 dígitos / CO 6 dígitos). */
function subFamilyKey(cuenta) {
  const c = String(cuenta).replace(/\D/g, '');
  if (c.length >= 3) return c.slice(0, 3);
  return c || '?';
}

function escAttr(s) {
  return String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
}

let modalMounted = false;

function ensureModal() {
  if (modalMounted) return;
  const el = document.createElement('div');
  el.id = 'customKpiModal';
  el.className = 'custom-kpi-overlay';
  el.innerHTML = `
    <div class="custom-kpi-dialog" role="dialog" aria-modal="true" aria-labelledby="customKpiTitle">
      <div class="custom-kpi-head">
        <div>
          <div id="customKpiTitle" class="custom-kpi-title">Custom Key Data</div>
          <div class="custom-kpi-subtitle" id="customKpiSubtitle">Elegí una cuenta del plan</div>
        </div>
        <button type="button" class="custom-kpi-close" id="customKpiClose" aria-label="Cerrar">×</button>
      </div>
      <div class="custom-kpi-search-wrap">
        <input type="search" id="customKpiSearch" class="custom-kpi-search" placeholder="Buscar por código o descripción…" autocomplete="off" />
      </div>
      <div class="custom-kpi-actions">
        <button type="button" class="custom-kpi-clear" id="customKpiClear">Borrar selección</button>
      </div>
      <div id="customKpiList" class="custom-kpi-list"></div>
    </div>`;
  document.body.appendChild(el);
  modalMounted = true;

  el.addEventListener('click', e => {
    if (e.target === el) closeCustomKpiPicker();
  });
  document.getElementById('customKpiClose').addEventListener('click', closeCustomKpiPicker);
  document.getElementById('customKpiClear').addEventListener('click', () => {
    clearCustomKpi();
    if (ST._lastResChart === 'customkpi') ST._lastResChart = 'patrimonio';
    closeCustomKpiPicker();
    if (typeof window.run === 'function') window.run();
  });
  document.getElementById('customKpiSearch').addEventListener('input', () => renderPlanList());
  document.addEventListener('keydown', onCustomKpiKeydown);
}

function onCustomKpiKeydown(e) {
  if (e.key !== 'Escape') return;
  const modal = document.getElementById('customKpiModal');
  if (modal && modal.style.display === 'flex') closeCustomKpiPicker();
}

/** Cuenta válida para fetch: existe en el plan cargado. */
export function resolveCustomKpiForRun() {
  const s = getSavedCustomKpi();
  if (!s) return null;
  if (!ST.planCuentas || !Object.prototype.hasOwnProperty.call(ST.planCuentas, s.cuenta)) return null;
  return { ...s, descripcion: ST.planCuentas[s.cuenta] || s.descripcion };
}

function closeCustomKpiPicker() {
  const el = document.getElementById('customKpiModal');
  if (el) el.style.display = 'none';
}

export function openCustomKpiPicker() {
  if (!ST.planCuentas || !Object.keys(ST.planCuentas).length) {
    alert('Plan de cuentas no disponible. Esperá a que carguen los datos.');
    return;
  }
  ensureModal();
  const dlg = document.getElementById('customKpiModal');
  const sub = dlg.querySelector('.custom-kpi-subtitle');
  if (sub)
    sub.textContent = `Elegí una cuenta del plan · ${datasetIsoCountry() === 'CO' ? 'Colombia (CUIF)' : 'Chile (CMF)'}`;
  dlg.style.display = 'flex';
  document.getElementById('customKpiSearch').value = '';
  renderPlanList();
}

function renderPlanList() {
  const list = document.getElementById('customKpiList');
  if (!list) return;

  const q = (document.getElementById('customKpiSearch').value || '').trim().toLowerCase();
  const searching = q.length > 0;

  const entries = Object.entries(ST.planCuentas).sort((a, b) =>
    a[0].localeCompare(b[0], undefined, { numeric: true }),
  );

  const filtered = !searching
    ? entries
    : entries.filter(([c, d]) => {
        const dl = (d || '').toLowerCase();
        return c.toLowerCase().includes(q) || dl.includes(q);
      });

  /** rubro -> Map(prefix -> rows) */
  const byRubro = new Map();
  for (const [c, d] of filtered) {
    const digit = c[0] || '?';
    const pref = subFamilyKey(c);
    if (!byRubro.has(digit)) byRubro.set(digit, new Map());
    const pm = byRubro.get(digit);
    if (!pm.has(pref)) pm.set(pref, []);
    pm.get(pref).push([c, d]);
  }

  const rubroOrder = [...byRubro.keys()].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));

  let html = '';
  for (const digit of rubroOrder) {
    const prefixMap = byRubro.get(digit);
    let total = 0;
    prefixMap.forEach(rows => { total += rows.length; });

    const rubroOpen = searching ? ' open' : '';

    html += `<details class="custom-kpi-rubro-details"${rubroOpen}><summary class="custom-kpi-rubro-sum">${digit} — ${escAttr(rubroTitle(digit))} <span class="custom-kpi-count">${total}</span></summary><div class="custom-kpi-rubro-inner">`;

    const prefKeys = [...prefixMap.keys()].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
    for (const pref of prefKeys) {
      const rows = prefixMap.get(pref);
      const prefOpen = searching ? ' open' : '';

      html += `<details class="custom-kpi-pref-details"${prefOpen}><summary class="custom-kpi-pref-sum">${escAttr(pref)} · ${rows.length} cuenta(s)</summary><div class="custom-kpi-pref-rows">`;
      for (const [cuenta, desc] of rows) {
        const label = toSentenceCase(desc || getExpLabel(cuenta) || cuenta);
        const tipo = getTipo(cuenta);
        html += `<button type="button" class="custom-kpi-row" data-cuenta="${escAttr(cuenta)}">
        <span class="custom-kpi-code">${escAttr(cuenta)}</span>
        <span class="custom-kpi-desc">${escAttr(label)}</span>
        <span class="custom-kpi-tipo">${escAttr(tipo)}</span>
      </button>`;
      }
      html += '</div></details>';
    }

    html += '</div></details>';
  }

  if (!filtered.length) {
    html = '<div class="custom-kpi-empty">Sin resultados.</div>';
  }

  list.innerHTML = html;
  list.querySelectorAll('.custom-kpi-row').forEach(btn => {
    btn.addEventListener('click', () => {
      const cuenta = btn.getAttribute('data-cuenta');
      if (!cuenta) return;
      const descripcion = ST.planCuentas[cuenta] || '';
      saveCustomKpi(cuenta, descripcion);
      closeCustomKpiPicker();
      ST._lastResChart = 'customkpi';
      if (typeof window.run === 'function') window.run();
    });
  });
}
