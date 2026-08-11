// ============================================================
// Solvency Analytics — Chile Basilea III (CMF Adequacy of Capital)
// Peer compare uses sidebar banks (max 5), same shell as Funding / AQ.
// ============================================================
import {
  CL_B3,
  CL_B3_Q1_ACCOUNTS,
  CL_B3_X1_ACCOUNTS,
  CL_B3_COLORS,
  clB3Snapshot,
  clB3RatioSeries,
  clB3StockSeries,
} from '../clBaselCuentas.js?v=bmon97';
import { ST, datasetIsoCountry } from '../state.js?v=bmon97';
import { fetchData } from '../api.js?v=bmon97';
import { bankName, fmtKPI, periodLabel } from '../format.js?v=bmon97';
import { bankColor } from '../config.js?v=bmon97';
import { drawLineChart, sparseData } from '../charts.js?v=bmon97';

const BASEL_COUNTRIES = new Set(['CL']);
const MAX_COMPARE_ENTITIES = 5;
const SISTEMA = 999;
const DEFAULT_BANK_CL = 59; // BTG Pactual Chile

const state = {
  loading: false,
  loaded: false,
  error: null,
  banks: [],
  periodos: [],
  q1: [],
  x1: [],
  lastBank: null,
  iso: null,
  selectionKey: '',
  compare: false,
  lastEntityId: null,
  metric: 'ratios', // ratios | rwa | capital
  chartStyle: 'lines',
  waitTimer: null,
};

function esc(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function fmtPct(n, digits = 2) {
  if (n == null || !Number.isFinite(Number(n))) return '—';
  return `${Number(n).toFixed(digits)}%`;
}

function selectedBanks() {
  const ordered = Array.isArray(ST.selectedOrder) ? ST.selectedOrder : [];
  if (ordered.length) return ordered.map(Number).filter((c) => Number.isFinite(c) && c > 0);
  if (ST.selected instanceof Set) {
    return [...ST.selected].map(Number).filter((c) => Number.isFinite(c) && c > 0);
  }
  if (Array.isArray(ST.selected)) {
    return ST.selected.map(Number).filter((c) => Number.isFinite(c) && c > 0);
  }
  return [];
}

/** Sidebar selection for Solvency (excludes Sistema 999). Falls back to BTG Chile. */
function banksForRun() {
  const fromSidebar = selectedBanks().filter((c) => c !== SISTEMA);
  if (fromSidebar.length) return fromSidebar.slice(0, MAX_COMPARE_ENTITIES);
  return [DEFAULT_BANK_CL];
}

function periodRange() {
  const desde = document.getElementById('selDesde')?.value || ST.desde || ST.periodos[0];
  const hasta = document.getElementById('selHasta')?.value || ST.hasta || ST.periodos[ST.periodos.length - 1];
  const all = Array.isArray(ST.periodos) ? ST.periodos : [];
  const inUi = all.filter((p) => p >= desde && p <= hasta);
  return inUi.length ? inUi : all;
}

function bankDisplayName(code) {
  return bankName(Number(code)) || `Bank ${code}`;
}

function selectionKey() {
  return `${datasetIsoCountry()}|${banksForRun().join(',')}|${periodRange().join(',')}|${state.compare ? 1 : 0}`;
}

function wantValueLabels(nSeries = 1) {
  if (ST.showBarLabels === true) return true;
  if (ST.showBarLabels === false) return false;
  return nSeries === 1;
}

function labelsToggleHtml(id) {
  let cls = 'state-auto';
  let text = '123';
  let title = 'Auto · values on bars when one series · click for ON';
  if (ST.showBarLabels === true) {
    cls = 'state-on'; text = '123 ✓'; title = 'Values on bars · forced ON · click for OFF';
  } else if (ST.showBarLabels === false) {
    cls = 'state-off'; text = '123 ✗'; title = 'Values hidden · forced OFF · click for Auto';
  }
  return `<button type="button" id="${id}" class="lbl123-btn ${cls}" onclick="toggleBarLabels()" title="${esc(title)}">${text}</button>`;
}

function resolveEntities() {
  const codes = banksForRun();
  if (!codes.length) return [];
  if (!state.compare) {
    const c = codes[0];
    return [{ id: String(c), label: bankDisplayName(c), codes: [c] }];
  }
  return codes.map((c) => ({
    id: String(c),
    label: bankDisplayName(c),
    codes: [c],
  }));
}

function rowsForBank(rows, code) {
  return (rows || []).filter((r) => Number(r.ins_cod) === Number(code));
}

function clearPeriodWait() {
  if (state.waitTimer) {
    clearTimeout(state.waitTimer);
    state.waitTimer = null;
  }
}

function schedulePeriodWait() {
  clearPeriodWait();
  state.waitTimer = setTimeout(() => {
    state.waitTimer = null;
    if (state.loaded || state.loading) return;
    if (!BASEL_COUNTRIES.has(datasetIsoCountry())) return;
    if (document.getElementById('tab-basel')?.style.display !== 'block') return;
    renderBaselAnalytics();
  }, 600);
}

function setCompare(on) {
  state.compare = !!on;
  state.loaded = false;
  state.error = null;
  renderBaselAnalytics();
}

function setMetric(m) {
  state.metric = m;
  paintCharts();
  document.querySelectorAll('[data-b3-metric]').forEach((btn) => {
    btn.classList.toggle('active', btn.getAttribute('data-b3-metric') === m);
  });
}

async function loadBaselData() {
  if (state.loading) return;
  const iso = datasetIsoCountry();
  if (!BASEL_COUNTRIES.has(iso)) {
    state.error = 'Solvency Analytics is available for Chile only.';
    state.loaded = false;
    paintShell();
    return;
  }

  const banks = banksForRun();
  const periodos = periodRange();
  if (!periodos.length) {
    // Soft-wait: do not hard-error. Bootstrap may still be applying ST.periodos.
    state.error = null;
    state.loaded = false;
    schedulePeriodWait();
    paintShell();
    return;
  }
  clearPeriodWait();

  state.loading = true;
  state.error = null;
  paintShell();

  try {
    const fetchBanks = [...new Set([...banks, SISTEMA])];
    const [q1, x1] = await Promise.all([
      fetchData('q1', CL_B3_Q1_ACCOUNTS, periodos, fetchBanks),
      fetchData('x1', CL_B3_X1_ACCOUNTS, periodos, fetchBanks),
    ]);
    const haveQ1 = (q1 || []).some((r) => String(r.cuenta) === CL_B3.cet1Apr);
    if (!haveQ1) {
      state.error = 'No Basilea III data in this range yet. CMF publishes with ~1 month lag vs the ZIP balance — try ending the range at the prior month.';
      state.loaded = false;
      state.q1 = [];
      state.x1 = [];
    } else {
      // Keep chart periods to months that actually have Basilea rows.
      const withData = [...new Set(
        (q1 || [])
          .filter((r) => String(r.cuenta) === CL_B3.cet1Apr)
          .map((r) => r.periodo),
      )].sort();
      state.q1 = q1 || [];
      state.x1 = x1 || [];
      state.banks = fetchBanks;
      state.periodos = withData.length ? withData : periodos;
      state.iso = iso;
      state.selectionKey = selectionKey();
      state.lastBank = banks[0];
      state.lastEntityId = String(banks[0]);
      state.loaded = true;
    }
  } catch (e) {
    console.error('[baselAnalytics]', e);
    state.error = e?.message || String(e);
    state.loaded = false;
  } finally {
    state.loading = false;
    paintShell();
  }
}

function renderPeerToolbar() {
  const compareBtns = `
    <button type="button" class="rcbtn ${!state.compare ? 'active' : ''}" data-b3-compare="0">Individual</button>
    <button type="button" class="rcbtn ${state.compare ? 'active' : ''}" data-b3-compare="1">Compare</button>`;
  const hint = state.compare
    ? `Comparing up to ${MAX_COMPARE_ENTITIES} sidebar banks`
    : 'Single bank from sidebar';
  return `
    <div class="fa-peer-bar">
      <div class="fa-peer-row">
        <div class="fa-peer-hint" style="margin:0;">Sidebar peers · max ${MAX_COMPARE_ENTITIES}</div>
        ${compareBtns}
      </div>
      <div class="fa-peer-detail">${hint}</div>
    </div>`;
}

function bindPeerToolbar() {
  document.querySelectorAll('[data-b3-compare]').forEach((btn) => {
    btn.addEventListener('click', () => setCompare(btn.getAttribute('data-b3-compare') === '1'));
  });
}

function kpiCard(label, value, sub) {
  return `<div class="kpi">
    <div class="kpi-label">${esc(label)}</div>
    <div class="kpi-val">${esc(value)}</div>
    ${sub ? `<div class="kpi-sub">${esc(sub)}</div>` : ''}
  </div>`;
}

function paintCharts() {
  const root = document.getElementById('baselAnalyticsRoot');
  if (!root || !state.loaded) return;
  const entities = resolveEntities().filter((e) => {
    const have = new Set(state.banks.map(Number));
    return e.codes.some((c) => have.has(Number(c)));
  });
  if (!entities.length) return;
  if (!document.getElementById('b3MainChart')) return;

  let series = [];
  let valueScale = 'percent';
  let title = '';

  if (state.metric === 'ratios') {
    title = 'CET1 / APR (%)';
    series = entities.map((e, i) => {
      const code = e.codes[0];
      const rows = rowsForBank(state.q1, code);
      return {
        label: e.label,
        color: bankColor(code, i, e.label) || Object.values(CL_B3_COLORS)[i % 4],
        data: sparseData(clB3RatioSeries(rows, CL_B3.cet1Apr, state.periodos)),
      };
    });
    if (!state.compare) {
      const sys = rowsForBank(state.q1, SISTEMA);
      if (sys.length) {
        series.push({
          label: 'Sistema',
          color: CL_B3_COLORS.system,
          data: sparseData(clB3RatioSeries(sys, CL_B3.cet1Apr, state.periodos)),
        });
      }
    }
  } else if (state.metric === 'rwa') {
    title = 'APR composition (CLP)';
    valueScale = 'billions';
    const e = entities[0];
    const rows = rowsForBank(state.x1, e.codes[0]);
    series = [
      { label: 'Credit', color: CL_B3_COLORS.aprc, data: sparseData(clB3StockSeries(rows, CL_B3.aprc, state.periodos)) },
      { label: 'Market', color: CL_B3_COLORS.aprm, data: sparseData(clB3StockSeries(rows, CL_B3.aprm, state.periodos)) },
      { label: 'Operational', color: CL_B3_COLORS.apro, data: sparseData(clB3StockSeries(rows, CL_B3.apro, state.periodos)) },
    ];
  } else {
    title = 'Regulatory capital stocks (CLP)';
    valueScale = 'billions';
    const e = entities[0];
    const rows = rowsForBank(state.x1, e.codes[0]);
    series = [
      { label: 'CET1', color: CL_B3_COLORS.cet1, data: sparseData(clB3StockSeries(rows, CL_B3.cet1, state.periodos)) },
      { label: 'AT1', color: CL_B3_COLORS.t1, data: sparseData(clB3StockSeries(rows, CL_B3.at1, state.periodos)) },
      { label: 'T2', color: CL_B3_COLORS.pe, data: sparseData(clB3StockSeries(rows, CL_B3.t2, state.periodos)) },
    ];
  }

  const titleEl = document.getElementById('b3ChartTitle');
  if (titleEl) titleEl.textContent = title;

  drawLineChart('b3MainChart', state.periodos, series, {
    valueScale,
    height: 300,
    style: state.chartStyle || 'lines',
    showLegend: true,
  });
}

function peerTableHtml(entities, periodo) {
  const rows = entities.map((e) => {
    const snap = clB3Snapshot(
      rowsForBank(state.q1, e.codes[0]),
      rowsForBank(state.x1, e.codes[0]),
      periodo,
    );
    return `<tr>
      <td>${esc(e.label)}</td>
      <td class="r">${fmtPct(snap.cet1Apr)}</td>
      <td class="r">${fmtPct(snap.t1Apr)}</td>
      <td class="r">${fmtPct(snap.peApr)}</td>
      <td class="r">${fmtPct(snap.lev)}</td>
      <td class="r">${esc(snap.classLabel)}</td>
      <td class="r">${snap.apr != null ? esc(fmtKPI(snap.apr)) : '—'}</td>
    </tr>`;
  });
  // Sistema row
  const sys = clB3Snapshot(
    rowsForBank(state.q1, SISTEMA),
    rowsForBank(state.x1, SISTEMA),
    periodo,
  );
  if (sys.cet1Apr != null) {
    rows.push(`<tr style="opacity:0.75">
      <td>Sistema Bancario</td>
      <td class="r">${fmtPct(sys.cet1Apr)}</td>
      <td class="r">${fmtPct(sys.t1Apr)}</td>
      <td class="r">${fmtPct(sys.peApr)}</td>
      <td class="r">${fmtPct(sys.lev)}</td>
      <td class="r">—</td>
      <td class="r">${sys.apr != null ? esc(fmtKPI(sys.apr)) : '—'}</td>
    </tr>`);
  }
  return `<table class="fa-table">
    <thead><tr>
      <th>Bank</th><th class="r">CET1/APR</th><th class="r">T1/APR</th><th class="r">PE/APR</th>
      <th class="r">Leverage</th><th class="r">Class</th><th class="r">APR</th>
    </tr></thead>
    <tbody>${rows.join('')}</tbody>
  </table>`;
}

function renderLoaded() {
  const entities = resolveEntities().filter((e) => {
    const have = new Set(state.banks.map(Number));
    return e.codes.some((c) => have.has(Number(c)));
  });
  if (!entities.length) {
    return `<div class="fa-empty"><div class="fa-empty-title">No Basilea rows for the selected banks</div></div>`;
  }
  const active = entities.find((e) => e.id === state.lastEntityId) || entities[0];
  state.lastEntityId = active.id;
  const periodo = state.periodos[state.periodos.length - 1];
  const snap = clB3Snapshot(
    rowsForBank(state.q1, active.codes[0]),
    rowsForBank(state.x1, active.codes[0]),
    periodo,
  );

  const bankTabs = entities.map((e) =>
    `<button type="button" class="rcbtn ${e.id === active.id ? 'active' : ''}" data-b3-bank="${esc(e.id)}">${esc(e.label)}</button>`
  ).join('');

  const metricTabs = [
    ['ratios', 'Ratios'],
    ['rwa', 'RWA mix'],
    ['capital', 'Capital stocks'],
  ].map(([k, lab]) =>
    `<button type="button" class="rcbtn ${state.metric === k ? 'active' : ''}" data-b3-metric="${k}">${lab}</button>`
  ).join('');

  return `
    ${renderPeerToolbar()}
    <div class="fa-hero">
      <div>
        <div class="fa-eyebrow">Chile · CMF Basilea III</div>
        <div class="fa-title">Solvency Analytics</div>
        <div class="fa-sub">Published consolidated capital adequacy — CET1, Tier 1, patrimonio efectivo / APR, leverage and RWA. Source: CMF Adecuación Consolidada de Capital (propertyvalue-43980). Ratios stored as <code>q1</code>; stocks as <code>x1</code>.</div>
      </div>
      <div style="text-align:right;font-size:12px;color:var(--text3);">
        As of <strong style="color:var(--white)">${esc(periodLabel(periodo))}</strong><br/>
        Class ${esc(snap.classLabel)} · Buffer deficit ${fmtPct(snap.bufDef, 2)}
      </div>
    </div>

    <div class="fa-toolbar">
      <div class="fa-bank-tabs">${bankTabs}</div>
      <div class="fa-metric-tabs">${metricTabs}</div>
    </div>

    <div class="kpi-grid fa-kpi-grid" style="grid-template-columns:repeat(auto-fit,minmax(140px,1fr));">
      ${kpiCard('CET1 / APR', fmtPct(snap.cet1Apr), 'Capital básico')}
      ${kpiCard('Tier 1 / APR', fmtPct(snap.t1Apr), 'CET1 + AT1')}
      ${kpiCard('PE / APR', fmtPct(snap.peApr), 'Patrimonio efectivo')}
      ${kpiCard('Leverage', fmtPct(snap.lev), 'CET1 / ATR')}
      ${kpiCard('APR (RWA)', snap.apr != null ? fmtKPI(snap.apr) : '—', 'Credit + market + op')}
      ${kpiCard('CET1 stock', snap.cet1 != null ? fmtKPI(snap.cet1) : '—', 'Capital básico')}
    </div>

    <div class="panel" style="margin-top:18px;">
      <div class="panel-head" style="display:flex;justify-content:space-between;align-items:center;gap:12px;">
        <div>
          <div class="panel-title" id="b3ChartTitle">CET1 / APR (%)</div>
          <div class="panel-sub">${esc(active.label)} · ${esc(periodLabel(state.periodos[0]))} → ${esc(periodLabel(periodo))}</div>
        </div>
        <div style="display:flex;gap:8px;align-items:center;">
          ${labelsToggleHtml('b3Lbl123')}
          <button type="button" class="rcbtn ${state.chartStyle === 'lines' ? 'active' : ''}" data-b3-style="lines">Lines</button>
          <button type="button" class="rcbtn ${state.chartStyle === 'bars' ? 'active' : ''}" data-b3-style="bars">Bars</button>
          <button type="button" class="rcbtn" id="b3Reload">Reload</button>
        </div>
      </div>
      <div id="b3MainChartWrap" class="chart-wrap" style="height:320px;">
        <canvas id="b3MainChart" class="chart-canvas"></canvas>
      </div>
    </div>

    <div class="panel" style="margin-top:18px;">
      <div class="panel-head">
        <div class="panel-title">Peer solvency · ${esc(periodLabel(periodo))}</div>
        <div class="panel-sub">CMF published ratios · Sistema Bancario as reference</div>
      </div>
      ${peerTableHtml(entities, periodo)}
    </div>

    <div class="panel" style="margin-top:18px;">
      <div class="panel-head">
        <div class="panel-title">RWA mix · ${esc(active.label)}</div>
      </div>
      <table class="fa-table">
        <thead><tr><th>Component</th><th class="r">Stock</th><th class="r">Share of APR</th></tr></thead>
        <tbody>
          <tr><td>Credit (APRC)</td><td class="r">${snap.aprc != null ? esc(fmtKPI(snap.aprc)) : '—'}</td><td class="r">${fmtPct(snap.aprcPct)}</td></tr>
          <tr><td>Market (APRM)</td><td class="r">${snap.aprm != null ? esc(fmtKPI(snap.aprm)) : '—'}</td><td class="r">${fmtPct(snap.aprmPct)}</td></tr>
          <tr><td>Operational (APRO)</td><td class="r">${snap.apro != null ? esc(fmtKPI(snap.apro)) : '—'}</td><td class="r">${fmtPct(snap.aproPct)}</td></tr>
          <tr><td><strong>Total APR</strong></td><td class="r"><strong>${snap.apr != null ? esc(fmtKPI(snap.apr)) : '—'}</strong></td><td class="r">100%</td></tr>
        </tbody>
      </table>
    </div>
  `;
}

function paintShell() {
  const root = document.getElementById('baselAnalyticsRoot');
  if (!root) return;
  const iso = datasetIsoCountry();

  if (!BASEL_COUNTRIES.has(iso)) {
    root.innerHTML = `<div class="fa-empty">
      <div class="fa-empty-title">Solvency Analytics</div>
      <div class="fa-empty-sub">Available for <strong>Chile</strong> (CMF Basilea III). Switch to Chile to explore CET1, RWA and leverage.</div>
    </div>`;
    return;
  }

  if (state.loading) {
    root.innerHTML = `<div class="fa-empty"><div class="ls-bars" aria-hidden="true"><div></div><div></div><div></div><div></div><div></div></div>
      <div class="fa-empty-sub" style="margin-top:16px;">Loading CMF Basilea III…</div></div>`;
    return;
  }

  if (state.error && !state.loaded) {
    root.innerHTML = `
      ${renderPeerToolbar()}
      <div class="fa-empty">
        <div class="fa-empty-title" style="color:var(--red);">${esc(state.error)}</div>
        <button type="button" class="rcbtn" id="b3Retry" style="margin-top:12px;">Retry</button>
      </div>`;
    bindPeerToolbar();
    document.getElementById('b3Retry')?.addEventListener('click', () => {
      state.error = null;
      loadBaselData();
    });
    return;
  }

  if (!state.loaded) {
    const waitingPeriods = !periodRange().length;
    root.innerHTML = `
      ${renderPeerToolbar()}
      <div class="fa-empty">
        <div class="fa-empty-title">Solvency Analytics</div>
        <div class="fa-empty-sub">${waitingPeriods
          ? 'Waiting for Chile periods to finish loading…'
          : 'CMF consolidated capital adequacy (Basilea III) — CET1, Tier 1, PE/APR, leverage and RWA by bank.'}</div>
        ${waitingPeriods
          ? '<div class="ls-bars" aria-hidden="true" style="margin-top:16px;"><div></div><div></div><div></div><div></div><div></div></div>'
          : '<button type="button" class="rcbtn active" id="b3Load" style="margin-top:14px;">Load solvency</button>'}
      </div>`;
    bindPeerToolbar();
    if (!waitingPeriods) {
      document.getElementById('b3Load')?.addEventListener('click', () => loadBaselData());
    } else {
      schedulePeriodWait();
    }
    return;
  }

  root.innerHTML = renderLoaded();
  bindPeerToolbar();
  document.querySelectorAll('[data-b3-bank]').forEach((btn) => {
    btn.addEventListener('click', () => {
      state.lastEntityId = btn.getAttribute('data-b3-bank');
      paintShell();
      requestAnimationFrame(() => paintCharts());
    });
  });
  document.querySelectorAll('[data-b3-metric]').forEach((btn) => {
    btn.addEventListener('click', () => setMetric(btn.getAttribute('data-b3-metric')));
  });
  document.querySelectorAll('[data-b3-style]').forEach((btn) => {
    btn.addEventListener('click', () => {
      state.chartStyle = btn.getAttribute('data-b3-style');
      paintShell();
      requestAnimationFrame(() => paintCharts());
    });
  });
  document.getElementById('b3Reload')?.addEventListener('click', () => {
    state.loaded = false;
    state.error = null;
    loadBaselData();
  });
  requestAnimationFrame(() => paintCharts());
}

/** Entry point — mirrors Funding/AQ: auto-load when Chile + periods are ready. */
export function renderBaselAnalytics() {
  const root = document.getElementById('baselAnalyticsRoot');
  if (!root) return;
  const iso = datasetIsoCountry();

  if (!BASEL_COUNTRIES.has(iso)) {
    state.loaded = false;
    state.iso = null;
    state.selectionKey = '';
    state.error = null;
    paintShell();
    return;
  }

  if (state.loaded && state.iso && state.iso !== iso) {
    state.loaded = false;
    state.selectionKey = '';
    state.error = null;
  }
  if (state.loaded && state.selectionKey !== selectionKey()) {
    state.loaded = false;
  }

  // Auto-load like Funding / Asset Quality (no manual "Load" gate once data is ready).
  if (!state.loaded && !state.loading && periodRange().length) {
    loadBaselData();
    return;
  }

  paintShell();
}

export function refreshBaselAnalytics() {
  if (!BASEL_COUNTRIES.has(datasetIsoCountry())) return;
  if (document.getElementById('tab-basel')?.style.display === 'block') {
    state.loaded = false;
    state.error = null;
    renderBaselAnalytics();
  }
}
