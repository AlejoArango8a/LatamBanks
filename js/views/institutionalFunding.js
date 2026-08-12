// ============================================================
// Institutional Funding — Chile mutual funds → bank DAP / bonds
// Secondary tab (Account View / BS / IS strip). Chile-only.
// ============================================================
import {
  CL_IF_DAP,
  CL_IF_BB,
  CL_IF_BS,
  CL_IF_OTHER_DAP,
  CL_IF_COLORS,
  CL_BANK_DAP_LIAB,
  CL_BANK_BB_LIAB,
  clIfAgfAccount,
  clIfMatrixAccount,
  clIfSummaryAccounts,
  clIfMatrixAccountsForAgf,
  clIfLiabilityAccounts,
} from '../clInstFundingCuentas.js?v=bmon100';
import { ST, datasetIsoCountry } from '../state.js?v=bmon100';
import { fetchData } from '../api.js?v=bmon100';
import { bankName, fmtKPI, periodLabel } from '../format.js?v=bmon100';
import { bankColor } from '../config.js?v=bmon100';
import { drawLineChart, sparseData, setupChartTooltip } from '../charts.js?v=bmon100';

const IF_COUNTRIES = new Set(['CL']);
const SISTEMA = 999;
const MAX_BANKS_FETCH = 20;
/** Cap IF history fetch — full 100+ CoA periods × matrix previously 504'd on Vercel. */
const IF_MAX_PERIODS = 48;
/** When sidebar From/To sits entirely past FM availability, widen the probe. */
const IF_FALLBACK_LOOKBACK = 60;

const INSTRUMENT_LABEL = {
  all: 'All instruments',
  DAP: 'Time deposits (DAP)',
  BB: 'Senior bank bonds',
  BS: 'Subordinated bonds',
};

const INSTRUMENT_RANK_LABEL = {
  all: 'total FM holdings',
  DAP: 'time deposits',
  BB: 'senior bonds',
  BS: 'subordinated bonds',
};

const state = {
  loading: false,
  loaded: false,
  error: null,
  mode: 'agf', // agf | bank
  instrument: 'all', // all | DAP | BB | BS
  chartStyle: 'area', // area | lines | bars
  /** Off by default: the stock chart overlays up to three series and point labels swamp it. */
  showLabels: false,
  selectedAgf: null,
  rows: [],
  liabRows: [],
  periodos: [],
  banks: [],
  agfs: [],
  iso: null,
  selectionKey: '',
  rangeNote: null, // shown when we auto-shift off CoA-only months
};

let agfRegistryPromise = null;

function esc(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function rootEl() {
  return document.getElementById('institutionalFundingRoot');
}

function periodRange() {
  const desde = document.getElementById('selDesde')?.value || ST.desde || ST.periodos?.[0];
  const hasta = document.getElementById('selHasta')?.value || ST.hasta || ST.periodos?.[ST.periodos.length - 1];
  const all = Array.isArray(ST.periodos) ? ST.periodos : [];
  const inUi = all.filter((p) => p >= desde && p <= hasta);
  const base = inUi.length ? inUi : all;
  // Prefer recent window — FM cartera lags CoA and huge ranges blow the API budget.
  return base.length > IF_MAX_PERIODS ? base.slice(-IF_MAX_PERIODS) : base;
}

function selectedBanks() {
  const ordered = Array.isArray(ST.selectedOrder) ? ST.selectedOrder : [];
  let codes = ordered.map(Number).filter((c) => Number.isFinite(c) && c > 0 && c !== SISTEMA);
  if (!codes.length && ST.selected instanceof Set) {
    codes = [...ST.selected].map(Number).filter((c) => Number.isFinite(c) && c > 0 && c !== SISTEMA);
  }
  if (!codes.length) {
    codes = Object.keys(ST.bancos || {})
      .map(Number)
      .filter((c) => c > 0 && c !== SISTEMA)
      .slice(0, MAX_BANKS_FETCH);
  }
  return codes.slice(0, MAX_BANKS_FETCH);
}

async function loadAgfRegistry() {
  if (agfRegistryPromise) return agfRegistryPromise;
  agfRegistryPromise = fetch(`data/cl_agf_registry.json?v=bmon100`)
    .then((r) => (r.ok ? r.json() : { agfs: [] }))
    .then((j) => (Array.isArray(j.agfs) ? j.agfs : []))
    .catch(() => []);
  return agfRegistryPromise;
}

function agfLabel(rut) {
  const hit = state.agfs.find((a) => String(a.rut) === String(rut));
  return hit?.short_name || hit?.legal_name || `AGF ${rut}`;
}

function sumAt(cuenta, periodo, insCod = SISTEMA, rowset = state.rows) {
  return rowset
    .filter((r) => r.cuenta === cuenta && r.periodo === periodo && Number(r.ins_cod) === Number(insCod))
    .reduce((s, r) => s + (Number(r.monto_total) || 0), 0);
}

function seriesFor(cuenta, insCod = SISTEMA) {
  return state.periodos.map((p) => sumAt(cuenta, p, insCod));
}

function latestPeriod() {
  // Prefer last period that actually has IF stocks (balance CoA may run ahead of FM file).
  for (let i = state.periodos.length - 1; i >= 0; i--) {
    const p = state.periodos[i];
    if (sumAt(CL_IF_DAP, p) + sumAt(CL_IF_BB, p) + sumAt(CL_IF_BS, p) > 0) return p;
  }
  return state.periodos[state.periodos.length - 1] || null;
}

function emptyState(title, detail) {
  const root = rootEl();
  if (!root) return;
  root.innerHTML = `
    ${heroHtml()}
    <div class="fa-empty">
      <div class="fa-empty-title">${esc(title)}</div>
      ${detail ? `<div class="fa-empty-sub">${detail}</div>` : ''}
    </div>`;
  bindShell();
}

function setMode(mode) {
  state.mode = mode;
  paint();
}

function setInstrument(inst) {
  state.instrument = inst;
  paint();
}

function setChartStyle(style) {
  state.chartStyle = style;
  paint();
}

function toggleLabels() {
  state.showLabels = !state.showLabels;
  paint();
}

function setSelectedAgf(rut) {
  state.selectedAgf = rut ? String(rut) : null;
  paint();
  if (state.selectedAgf) loadMatrixForAgf(state.selectedAgf);
}

window.ifSetMode = setMode;
window.ifSetInstrument = setInstrument;
window.ifSetChartStyle = setChartStyle;
window.ifToggleLabels = toggleLabels;
window.ifSelectAgf = setSelectedAgf;

/** Merge matrix rows for one AGF without re-fetching the full summary. */
async function loadMatrixForAgf(agfRut) {
  if (!agfRut || !state.periodos.length) return;
  const banks = state.banks.length ? state.banks : selectedBanks();
  const accounts = clIfMatrixAccountsForAgf(agfRut, banks);
  try {
    const extra = await fetchData('x1', accounts, state.periodos, [SISTEMA]);
    const keep = new Set(accounts);
    state.rows = [
      ...(state.rows || []).filter((r) => !keep.has(r.cuenta)),
      ...(extra || []),
    ];
    paint();
  } catch (e) {
    console.warn('[institutionalFunding] matrix fetch', e);
  }
}

function kpiCol(title, tone, value, sub) {
  return `<div class="kpi-col">
    <div class="kpi-col-title">${esc(title)}</div>
    <div class="kpi ${tone}">
      <div class="kpi-val">${esc(value)}</div>
      <div class="kpi-sub">${esc(sub || '')}</div>
    </div>
  </div>`;
}

function instrumentValue(dap, bb, bs = 0) {
  if (state.instrument === 'DAP') return dap;
  if (state.instrument === 'BB') return bb;
  if (state.instrument === 'BS') return bs;
  return dap + bb + bs;
}

function fmtShare(num, den) {
  if (!den || !Number.isFinite(den) || den <= 0) return '—';
  return `${((100 * num) / den).toFixed(1)}%`;
}

/** Marks the column the ranking is filtered on, so a Total equal to it is not read as an error. */
function colCls(kind) {
  return state.instrument === kind ? ' if-col-on' : '';
}

function pill(label, active, handler) {
  return `<button type="button" class="rcbtn ${active ? 'active' : ''}" onclick="${handler}">${esc(label)}</button>`;
}

function heroHtml() {
  return `
    <div class="fa-hero if-hero">
      <div>
        <div class="fa-eyebrow">Chile · CMF cartera nacional</div>
        <div class="fa-title">Institutional Funding</div>
        <div class="fa-sub">Mutual-fund (FM) holdings of bank paper — time deposits, senior bonds and
          subordinated bonds — aggregated by fund manager (AGF) and matched against each bank's own
          reported liabilities.</div>
      </div>
      <button type="button" class="rcbtn" id="ifReload">Refresh</button>
    </div>`;
}

function toolbarHtml() {
  return `
    <div class="fa-toolbar">
      <div class="fa-bank-tabs">
        ${pill('By AGF', state.mode === 'agf', "ifSetMode('agf')")}
        ${pill('By bank', state.mode === 'bank', "ifSetMode('bank')")}
      </div>
      <div class="fa-metric-tabs">
        ${pill('All', state.instrument === 'all', "ifSetInstrument('all')")}
        ${pill('DAP', state.instrument === 'DAP', "ifSetInstrument('DAP')")}
        ${pill('Bonds', state.instrument === 'BB', "ifSetInstrument('BB')")}
        ${pill('Subord.', state.instrument === 'BS', "ifSetInstrument('BS')")}
      </div>
    </div>`;
}

function labelsToggleHtml() {
  const cls = state.showLabels ? 'state-on' : 'state-off';
  const text = state.showLabels ? '123 ✓' : '123 ✗';
  const title = state.showLabels ? 'Values on chart · click to hide' : 'Values hidden · click to show';
  return `<button type="button" class="lbl123-btn ${cls}" onclick="ifToggleLabels()" title="${esc(title)}">${text}</button>`;
}

function chartPanelHtml(subtitle) {
  return `
    <div class="panel fa-panel" style="margin-top:22px;">
      <div class="panel-head fa-chart-head">
        <div>
          <div class="panel-title">${esc(INSTRUMENT_LABEL[state.instrument])} · stock over time</div>
          <div class="panel-sub">${esc(subtitle)}</div>
        </div>
        <div class="fa-chart-styles" role="group" aria-label="Chart style">
          ${labelsToggleHtml()}
          ${pill('Bars', state.chartStyle === 'bars', "ifSetChartStyle('bars')")}
          ${pill('Lines', state.chartStyle === 'lines', "ifSetChartStyle('lines')")}
          ${pill('Area', state.chartStyle === 'area', "ifSetChartStyle('area')")}
        </div>
      </div>
      <div class="panel-body">
        <div class="chart-wrap" style="min-height:320px;">
          <canvas id="ifChart" height="320" style="width:100%;height:320px;"></canvas>
        </div>
      </div>
    </div>`;
}

const NOTES = [
  'AGF = Administradora General de Fondos. Holdings are aggregated across every fund the manager runs.',
  'DAP = depósitos a plazo · Bonds = senior bank bonds · Subord. = subordinated bank bonds.',
  '“of bank DAP” and “of bank bonds” measure the FM position against the bank\'s own reported time-deposit and senior-bond liabilities in the CMF chart of accounts.',
  'CMF cartera nacional is published with a ~1–2 month lag versus the monthly bank balance file, so the latest FM month can trail the latest balance month.',
];

function buildShell(bodyHtml) {
  const per = latestPeriod();
  const dap = per ? sumAt(CL_IF_DAP, per) : 0;
  const bb = per ? sumAt(CL_IF_BB, per) : 0;
  const bs = per ? sumAt(CL_IF_BS, per) : 0;
  const other = per ? sumAt(CL_IF_OTHER_DAP, per) : 0;
  const tot = dap + bb + bs;
  const pctOf = (v) => (tot ? `${((100 * v) / tot).toFixed(1)}% of FM bank paper` : '—');
  const lagBanner = state.rangeNote
    ? `<div class="if-note">${esc(state.rangeNote)}</div>`
    : '';

  return `
    ${heroHtml()}
    ${lagBanner}
    ${toolbarHtml()}
    <div class="kpi-grid fa-kpi-grid if-kpi-grid">
      ${kpiCol('FM bank paper', 'if-tone-total', fmtKPI(tot), per ? periodLabel(per) : '—')}
      ${kpiCol('Time deposits', 'if-tone-dap', fmtKPI(dap), pctOf(dap))}
      ${kpiCol('Senior bonds', 'if-tone-bb', fmtKPI(bb), pctOf(bb))}
      ${kpiCol('Subordinated + other', 'if-tone-bs', fmtKPI(bs + other),
        other ? `incl. Tanner SF DAP ${fmtKPI(other)}` : pctOf(bs))}
    </div>
    ${bodyHtml}
    <ul class="fa-notes">${NOTES.map((n) => `<li>${n}</li>`).join('')}</ul>`;
}

function exportBtn() {
  return `<button type="button" class="rcbtn if-export"
    onclick="exportTableById('ifExportTable','Institutional_Funding')" title="Export to Excel">⬇ xlsx</button>`;
}

function paintAgfMode() {
  const per = latestPeriod();
  if (!per) return '<div class="fa-empty"><div class="fa-empty-title">No periods loaded</div></div>';

  const rows = state.agfs.map((a) => {
    const dap = sumAt(clIfAgfAccount(a.rut, 'DAP'), per);
    const bb = sumAt(clIfAgfAccount(a.rut, 'BB'), per);
    const bs = sumAt(clIfAgfAccount(a.rut, 'BS'), per);
    const tot = instrumentValue(dap, bb, bs);
    return { ...a, dap, bb, bs, tot };
  }).filter((r) => r.tot > 0)
    .sort((a, b) => b.tot - a.tot);

  if (!rows.length) {
    return `<div class="fa-empty">
      <div class="fa-empty-title">No mutual-fund holdings in the loaded range</div>
      <div class="fa-empty-sub">Last period tried: ${esc(periodLabel(per))}. CMF cartera nacional usually
        lags the bank balance file by ~1–2 months — move <strong>Hasta</strong> to an earlier month or wait
        for the next FM release.</div>
    </div>`;
  }

  if (!state.selectedAgf || !rows.some((r) => String(r.rut) === String(state.selectedAgf))) {
    state.selectedAgf = String(rows[0].rut);
  }

  const agf = state.selectedAgf;
  const bankCodes = state.banks.length ? state.banks : selectedBanks();
  const grandTotal = rows.reduce((s, r) => s + r.tot, 0);

  const bankRows = bankCodes.map((code) => {
    const dap = sumAt(clIfMatrixAccount(agf, code, 'DAP'), per);
    const bb = sumAt(clIfMatrixAccount(agf, code, 'BB'), per);
    const bs = sumAt(clIfMatrixAccount(agf, code, 'BS'), per);
    const bankDapLiab = sumAt(CL_BANK_DAP_LIAB, per, code, state.liabRows);
    const bankBbLiab = sumAt(CL_BANK_BB_LIAB, per, code, state.liabRows);
    return {
      code, dap, bb, bs,
      tot: instrumentValue(dap, bb, bs),
      dapShare: fmtShare(dap, bankDapLiab),
      bbShare: fmtShare(bb, bankBbLiab),
    };
  }).filter((r) => r.tot > 0)
    .sort((a, b) => b.tot - a.tot);

  const seriesDap = seriesFor(clIfAgfAccount(agf, 'DAP'));
  const seriesBb = seriesFor(clIfAgfAccount(agf, 'BB'));
  const seriesBs = seriesFor(clIfAgfAccount(agf, 'BS'));
  queueMicrotask(() => drawIfChart(seriesDap, seriesBb, seriesBs));

  const rankingPanel = `
    <div class="panel fa-panel" style="margin-top:22px;">
      <div class="panel-head fa-chart-head">
        <div>
          <div class="panel-title">Fund managers · ${esc(periodLabel(per))}</div>
          <div class="panel-sub">Ranked by ${esc(INSTRUMENT_RANK_LABEL[state.instrument])} · click a row to drill into its bank exposure</div>
        </div>
        ${exportBtn()}
      </div>
      <div class="panel-body" id="ifExportTable" style="overflow-x:auto;padding:0;">
        <table class="data fa-table if-table">
          <thead><tr>
            <th>AGF</th>
            <th class="r${colCls('DAP')}">DAP</th>
            <th class="r${colCls('BB')}">Bonds</th>
            <th class="r${colCls('BS')}">Subord.</th>
            <th class="r">Total</th>
            <th class="r">Share of FM</th>
          </tr></thead>
          <tbody>
            ${rows.map((r) => {
              const on = String(r.rut) === String(agf);
              return `<tr class="if-row-pick ${on ? 'if-row-active' : ''}" onclick="ifSelectAgf('${esc(r.rut)}')">
                <td>${esc(r.short_name || r.legal_name)}</td>
                <td class="r${colCls('DAP')}">${fmtKPI(r.dap)}</td>
                <td class="r${colCls('BB')}">${fmtKPI(r.bb)}</td>
                <td class="r${colCls('BS')}">${fmtKPI(r.bs)}</td>
                <td class="r if-strong">${fmtKPI(r.tot)}</td>
                <td class="r if-muted">${fmtShare(r.tot, grandTotal)}</td>
              </tr>`;
            }).join('')}
          </tbody>
        </table>
      </div>
    </div>`;

  const breakdownPanel = `
    <div class="panel fa-panel" style="margin-top:18px;">
      <div class="panel-head">
        <div>
          <div class="panel-title">${esc(agfLabel(agf))} · exposure by bank</div>
          <div class="panel-sub">${esc(periodLabel(per))} · share columns compare the FM position with the bank's reported plazo and senior-bond liabilities</div>
        </div>
      </div>
      <div class="panel-body" style="overflow-x:auto;padding:0;">
        <table class="data fa-table if-table">
          <thead><tr>
            <th>Bank</th>
            <th class="r${colCls('DAP')}">DAP</th>
            <th class="r${colCls('DAP')}">of bank DAP</th>
            <th class="r${colCls('BB')}">Bonds</th>
            <th class="r${colCls('BB')}">of bank bonds</th>
            <th class="r">Total</th>
          </tr></thead>
          <tbody>
            ${bankRows.length ? bankRows.map((r) => `
              <tr>
                <td><span class="fa-swatch" style="background:${bankColor(r.code)}"></span>${esc(bankName(r.code))}</td>
                <td class="r${colCls('DAP')}">${fmtKPI(r.dap)}</td>
                <td class="r if-muted${colCls('DAP')}">${r.dapShare}</td>
                <td class="r${colCls('BB')}">${fmtKPI(r.bb)}</td>
                <td class="r if-muted${colCls('BB')}">${r.bbShare}</td>
                <td class="r if-strong">${fmtKPI(r.tot)}</td>
              </tr>`).join('')
              : '<tr><td colspan="6" class="if-muted">No bank breakdown for the selected banks and period.</td></tr>'}
          </tbody>
        </table>
      </div>
    </div>`;

  return chartPanelHtml(`${agfLabel(agf)} · ${periodLabel(state.periodos[0])} — ${periodLabel(per)}`)
    + rankingPanel + breakdownPanel;
}

/** Axis labels expect billions of the currency on display (see fmtAxis), not raw local units. */
function chartUnits(values) {
  const usdFactor = ST.currency === 'USD' && ST.usdRate ? 1 / ST.usdRate : 1;
  return sparseData(values.map((v) => (v == null ? null : (v / 1e9) * usdFactor)));
}

function drawIfChart(rawDap, rawBb, rawBs) {
  const seriesDap = chartUnits(rawDap);
  const seriesBb = chartUnits(rawBb);
  const seriesBs = chartUnits(rawBs);
  let series;
  if (state.instrument === 'all') {
    series = [
      { label: 'DAP', color: CL_IF_COLORS.dap, data: seriesDap },
      { label: 'Bonds', color: CL_IF_COLORS.bb, data: seriesBb },
      { label: 'Subord.', color: CL_IF_COLORS.bs, data: seriesBs },
    ];
  } else if (state.instrument === 'BB') {
    series = [{ label: 'Bonds', color: CL_IF_COLORS.bb, data: seriesBb }];
  } else if (state.instrument === 'BS') {
    series = [{ label: 'Subord.', color: CL_IF_COLORS.bs, data: seriesBs }];
  } else {
    series = [{ label: 'DAP', color: CL_IF_COLORS.dap, data: seriesDap }];
  }
  drawLineChart('ifChart', state.periodos, series, {
    height: 320,
    style: state.chartStyle,
    showLegend: true,
    showLabels: state.showLabels,
  });
  setupChartTooltip('ifChart', 'chartTooltip');
}

function paintBankMode() {
  const per = latestPeriod();
  if (!per) return '<div class="fa-empty"><div class="fa-empty-title">No periods loaded</div></div>';

  const banks = selectedBanks();
  const focus = banks[0];
  if (!focus) {
    return `<div class="fa-empty">
      <div class="fa-empty-title">Select a bank</div>
      <div class="fa-empty-sub">Pick an institution in the sidebar to see which fund managers hold its paper.</div>
    </div>`;
  }

  const dap = sumAt(CL_IF_DAP, per, focus);
  const bb = sumAt(CL_IF_BB, per, focus);
  const bs = sumAt(CL_IF_BS, per, focus);
  const tot = instrumentValue(dap, bb, bs);
  const bankDapLiab = sumAt(CL_BANK_DAP_LIAB, per, focus, state.liabRows);
  const bankBbLiab = sumAt(CL_BANK_BB_LIAB, per, focus, state.liabRows);

  const agfRows = state.agfs.map((a) => {
    const aDap = sumAt(clIfAgfAccount(a.rut, 'DAP'), per, focus);
    const aBb = sumAt(clIfAgfAccount(a.rut, 'BB'), per, focus);
    const aBs = sumAt(clIfAgfAccount(a.rut, 'BS'), per, focus);
    return { ...a, dap: aDap, bb: aBb, bs: aBs, tot: instrumentValue(aDap, aBb, aBs) };
  }).filter((r) => r.tot > 0)
    .sort((a, b) => b.tot - a.tot);

  const seriesDap = seriesFor(CL_IF_DAP, focus);
  const seriesBb = seriesFor(CL_IF_BB, focus);
  const seriesBs = seriesFor(CL_IF_BS, focus);
  queueMicrotask(() => drawIfChart(seriesDap, seriesBb, seriesBs));

  const holdersPanel = `
    <div class="panel fa-panel" style="margin-top:22px;">
      <div class="panel-head fa-chart-head">
        <div>
          <div class="panel-title">${esc(bankName(focus))} · fund managers holding its paper</div>
          <div class="panel-sub">${esc(periodLabel(per))} · FM funding ${fmtKPI(tot)} ·
            DAP ${fmtKPI(dap)} (${fmtShare(dap, bankDapLiab)} of bank plazo) ·
            Bonds ${fmtKPI(bb)} (${fmtShare(bb, bankBbLiab)} of senior bonds)</div>
        </div>
        ${exportBtn()}
      </div>
      <div class="panel-body" id="ifExportTable" style="overflow-x:auto;padding:0;">
        <table class="data fa-table if-table">
          <thead><tr>
            <th>AGF</th>
            <th class="r${colCls('DAP')}">DAP</th>
            <th class="r${colCls('BB')}">Bonds</th>
            <th class="r${colCls('BS')}">Subord.</th>
            <th class="r">Total</th>
            <th class="r">Share of bank</th>
          </tr></thead>
          <tbody>
            ${agfRows.length ? agfRows.map((r) => `
              <tr>
                <td>${esc(r.short_name || r.legal_name)}</td>
                <td class="r${colCls('DAP')}">${fmtKPI(r.dap)}</td>
                <td class="r${colCls('BB')}">${fmtKPI(r.bb)}</td>
                <td class="r${colCls('BS')}">${fmtKPI(r.bs)}</td>
                <td class="r if-strong">${fmtKPI(r.tot)}</td>
                <td class="r if-muted">${fmtShare(r.tot, tot)}</td>
              </tr>`).join('')
              : '<tr><td colspan="6" class="if-muted">No AGF holdings for this bank and period.</td></tr>'}
          </tbody>
        </table>
      </div>
    </div>`;

  return chartPanelHtml(`${bankName(focus)} · ${periodLabel(state.periodos[0])} — ${periodLabel(per)}`)
    + holdersPanel;
}

function bindShell() {
  document.getElementById('ifReload')?.addEventListener('click', () => refreshInstitutionalFunding());
}

function paint() {
  const root = rootEl();
  if (!root) return;
  const isoNow = datasetIsoCountry();
  // Rows are keyed by CMF account codes, so anything cached for another country
  // would paint stale Chilean numbers under the new flag.
  if (state.iso && state.iso !== isoNow) {
    state.loaded = false;
    state.loading = false;
    state.error = null;
    state.rows = [];
    state.liabRows = [];
    state.selectedAgf = null;
    state.selectionKey = '';
    state.iso = isoNow;
  }
  if (!IF_COUNTRIES.has(isoNow)) {
    emptyState('Chile only',
      'Institutional Funding is built from the CMF mutual-fund portfolio file, which has no equivalent in the other markets yet.');
    return;
  }
  if (state.loading) {
    emptyState('Loading Institutional Funding…',
      'The CMF portfolio file is heavier than the balance sheet — this usually takes a few seconds.');
    return;
  }
  if (state.error) {
    root.innerHTML = `
      ${heroHtml()}
      <div class="fa-empty">
        <div class="fa-empty-title" style="color:var(--red);">Could not load Institutional Funding</div>
        <div class="fa-empty-sub">${esc(state.error)}</div>
        <div class="fa-empty-sub">Try again, or narrow the From/To range in the sidebar.</div>
        <button type="button" class="rcbtn active" id="ifRetry" style="margin-top:6px;">Retry</button>
      </div>`;
    bindShell();
    document.getElementById('ifRetry')?.addEventListener('click', () => refreshInstitutionalFunding());
    return;
  }
  const body = state.mode === 'bank' ? paintBankMode() : paintAgfMode();
  root.innerHTML = buildShell(body);
  bindShell();
}

async function loadData() {
  const iso = datasetIsoCountry();
  if (!IF_COUNTRIES.has(iso)) {
    state.loaded = true;
    state.rows = [];
    paint();
    return;
  }

  const periodosRaw = periodRange();
  const banks = selectedBanks();
  const key = `${iso}|${periodosRaw.join(',')}|${banks.join(',')}|${state.mode}`;
  if (state.loaded && state.selectionKey === key && state.rows.length) {
    paint();
    if (state.mode === 'agf' && state.selectedAgf) loadMatrixForAgf(state.selectedAgf);
    return;
  }

  state.loading = true;
  state.error = null;
  state.rangeNote = null;
  paint();

  try {
    const agfs = await loadAgfRegistry();
    state.agfs = agfs;

    // 1) Probe IF stocks in the sidebar window.
    let probe = await fetchData('x1', [CL_IF_DAP], periodosRaw, [SISTEMA]);
    let withData = new Set(
      (probe || [])
        .filter((r) => Number(r.ins_cod) === SISTEMA && Number(r.monto_total) > 0)
        .map((r) => r.periodo)
    );

    // Sidebar often ends on the latest CoA month (e.g. Jun 2026) while FM cartera
    // still lags (~May 2025). If the window has no IF months, widen the probe.
    let periodos = periodosRaw.filter((p) => withData.has(p));
    if (!periodos.length) {
      const all = Array.isArray(ST.periodos) ? ST.periodos : [];
      const wider = all.slice(-IF_FALLBACK_LOOKBACK);
      probe = await fetchData('x1', [CL_IF_DAP], wider, [SISTEMA]);
      withData = new Set(
        (probe || [])
          .filter((r) => Number(r.ins_cod) === SISTEMA && Number(r.monto_total) > 0)
          .map((r) => r.periodo)
      );
      periodos = wider.filter((p) => withData.has(p));
      if (periodos.length > IF_MAX_PERIODS) periodos = periodos.slice(-IF_MAX_PERIODS);
      if (periodos.length) {
        const last = periodos[periodos.length - 1];
        state.rangeNote =
          `Showing mutual-fund data through ${periodLabel(last)} — CMF cartera nacional lags the bank balance file. `
          + `Your From/To range had no FM months yet (e.g. Jun 2026).`;
      }
    }

    if (!periodos.length) {
      state.rows = [];
      state.liabRows = [];
      state.periodos = periodosRaw;
      state.banks = banks;
      state.iso = iso;
      state.selectionKey = key;
      state.loaded = true;
      state.rangeNote =
        'No Institutional Funding months in the database yet. The monthly CMF FM loader has not loaded a cartera nacional file.';
      return;
    }

    // 2) Summary only (~70 cuentas) — never the full AGF×bank matrix in one shot.
    const accounts = clIfSummaryAccounts(agfs);
    const fetchBanks = [...new Set([...banks, SISTEMA])];
    // Sequential on purpose: the API pool is max=2, and firing both at once
    // queues one behind the other while its client timeout is already running.
    const rows = await fetchData('x1', accounts, periodos, fetchBanks);
    const liabRows = await fetchData('b1', clIfLiabilityAccounts(), periodos, banks);
    state.rows = rows || [];
    state.liabRows = liabRows || [];
    state.periodos = periodos;
    state.banks = banks;
    state.iso = iso;
    state.selectionKey = key;
    state.loaded = true;
  } catch (e) {
    state.error = e?.message || String(e);
    state.loaded = false;
  } finally {
    state.loading = false;
    paint();
    if (state.loaded && state.mode === 'agf') {
      const per = latestPeriod();
      if (!state.selectedAgf && per) {
        const ranked = state.agfs
          .map((a) => ({
            rut: a.rut,
            tot: sumAt(clIfAgfAccount(a.rut, 'DAP'), per)
              + sumAt(clIfAgfAccount(a.rut, 'BB'), per)
              + sumAt(clIfAgfAccount(a.rut, 'BS'), per),
          }))
          .filter((r) => r.tot > 0)
          .sort((a, b) => b.tot - a.tot);
        if (ranked[0]) state.selectedAgf = String(ranked[0].rut);
      }
      if (state.selectedAgf) loadMatrixForAgf(state.selectedAgf);
    }
  }
}

export function renderInstitutionalFunding() {
  loadData();
}

export function refreshInstitutionalFunding() {
  state.loaded = false;
  state.selectionKey = '';
  loadData();
}
