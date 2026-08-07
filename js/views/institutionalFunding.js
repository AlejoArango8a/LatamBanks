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
} from '../clInstFundingCuentas.js?v=bmon86';
import { ST, datasetIsoCountry } from '../state.js?v=bmon72';
import { fetchData } from '../api.js?v=bmon86';
import { bankName, fmtKPI, periodLabel } from '../format.js?v=bmon72';
import { bankColor } from '../config.js?v=bmon72';
import { drawLineChart, sparseData } from '../charts.js?v=bmon77';

const IF_COUNTRIES = new Set(['CL']);
const SISTEMA = 999;
const MAX_BANKS_FETCH = 20;
/** Cap IF history fetch — full 100+ CoA periods × matrix previously 504'd on Vercel. */
const IF_MAX_PERIODS = 48;
/** When sidebar From/To sits entirely past FM availability, widen the probe. */
const IF_FALLBACK_LOOKBACK = 60;

const state = {
  loading: false,
  loaded: false,
  /** User clicked Load — do not auto-fetch on tab open (avoids competing with Bank Monitor). */
  armed: false,
  error: null,
  mode: 'agf', // agf | bank
  instrument: 'all', // all | DAP | BB | BS
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
  agfRegistryPromise = fetch(`data/cl_agf_registry.json?v=bmon86`)
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

function emptyState(msg) {
  const root = rootEl();
  if (!root) return;
  root.innerHTML = `<div class="fa-empty"><div class="fa-empty-title">Institutional Funding</div>
    <div class="fa-empty-sub">${esc(msg)}</div></div>`;
}

function paintGate() {
  const root = rootEl();
  if (!root) return;
  root.innerHTML = `
    <div class="fa-empty">
      <div class="fa-empty-title">Institutional Funding</div>
      <div class="fa-empty-sub">
        Mutual-fund holdings of bank DAPs &amp; bank bonds from CMF
        <em>Cartera de Inversiones Nacionales</em>.
        This pull is heavier than Bank Monitor and can take up to ~30 seconds.
      </div>
      <button type="button" class="rcbtn active" id="ifLoadBtn" style="margin-top:14px;">Load Institutional Funding</button>
    </div>`;
  document.getElementById('ifLoadBtn')?.addEventListener('click', () => {
    state.armed = true;
    state.loaded = false;
    state.selectionKey = '';
    state.error = null;
    loadData();
  });
}

function paintLoading() {
  const root = rootEl();
  if (!root) return;
  root.innerHTML = `<div class="fa-empty">
    <div class="ls-bars" aria-hidden="true">
      <div class="ls-bar" style="--i:0"></div>
      <div class="ls-bar" style="--i:1"></div>
      <div class="ls-bar" style="--i:2"></div>
      <div class="ls-bar" style="--i:3"></div>
      <div class="ls-bar" style="--i:4"></div>
      <div class="ls-bar" style="--i:5"></div>
      <div class="ls-bar" style="--i:6"></div>
      <div class="ls-bar" style="--i:7"></div>
    </div>
    <div class="fa-empty-sub" style="margin-top:16px;">Loading Institutional Funding…</div>
    <div class="fa-empty-sub" style="margin-top:8px;font-size:12px;color:var(--text3);">
      CMF cartera nacional — this usually takes a few seconds and can take up to ~30s. Please wait.
    </div>
  </div>`;
}

function setMode(mode) {
  state.mode = mode;
  paint();
}

function setInstrument(inst) {
  state.instrument = inst;
  paint();
}

function setSelectedAgf(rut) {
  state.selectedAgf = rut ? String(rut) : null;
  paint();
  if (state.selectedAgf) loadMatrixForAgf(state.selectedAgf);
}

window.ifSetMode = setMode;
window.ifSetInstrument = setInstrument;
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

function kpiCard(label, value, sub) {
  return `<div class="kpi"><div class="kpi-label">${esc(label)}</div>
    <div class="kpi-val">${esc(value)}</div>
    ${sub ? `<div class="kpi-sub">${esc(sub)}</div>` : ''}</div>`;
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

function buildShell(bodyHtml) {
  const per = latestPeriod();
  const dap = per ? sumAt(CL_IF_DAP, per) : 0;
  const bb = per ? sumAt(CL_IF_BB, per) : 0;
  const bs = per ? sumAt(CL_IF_BS, per) : 0;
  const other = per ? sumAt(CL_IF_OTHER_DAP, per) : 0;
  const tot = dap + bb + bs;
  const dapPct = tot ? (100 * dap) / tot : null;
  const lagBanner = state.rangeNote
    ? `<div style="margin:0 0 12px;padding:8px 12px;border:1px solid var(--border);border-radius:6px;background:var(--bg3);font-size:12px;color:var(--text2);">${esc(state.rangeNote)}</div>`
    : '';

  return `
    ${lagBanner}
    <div class="kpi-grid" style="margin-bottom:14px;">
      ${kpiCard('FM bank paper', fmtKPI(tot), per ? periodLabel(per) : '—')}
      ${kpiCard('DAP', fmtKPI(dap), dapPct != null ? `${dapPct.toFixed(1)}% of total` : '—')}
      ${kpiCard('Bonos bancarios', fmtKPI(bb), tot ? `${(100 * bb / tot).toFixed(1)}%` : '—')}
      ${kpiCard('Subordinados + other', fmtKPI(bs + other), other ? `incl. Tanner SF DAP ${fmtKPI(other)}` : (bs ? `BS ${fmtKPI(bs)}` : '—'))}
    </div>
    <div class="panel" style="margin-bottom:12px;">
      <div class="panel-head">
        <div>
          <div class="panel-title">Institutional Funding</div>
          <div class="panel-sub">Mutual-fund holdings of bank DAPs &amp; bank bonds · CMF cartera nacional</div>
        </div>
        <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;">
          <div class="itabs" style="margin:0;">
            <button type="button" class="itab ${state.mode === 'agf' ? 'active' : ''}" onclick="ifSetMode('agf')">By AGF</button>
            <button type="button" class="itab ${state.mode === 'bank' ? 'active' : ''}" onclick="ifSetMode('bank')">By Bank</button>
          </div>
          <div class="itabs" style="margin:0;">
            <button type="button" class="itab ${state.instrument === 'all' ? 'active' : ''}" onclick="ifSetInstrument('all')">All</button>
            <button type="button" class="itab ${state.instrument === 'DAP' ? 'active' : ''}" onclick="ifSetInstrument('DAP')">DAP</button>
            <button type="button" class="itab ${state.instrument === 'BB' ? 'active' : ''}" onclick="ifSetInstrument('BB')">Bonds</button>
            <button type="button" class="itab ${state.instrument === 'BS' ? 'active' : ''}" onclick="ifSetInstrument('BS')">Subord.</button>
          </div>
          <button type="button" onclick="exportTableById('ifExportTable','Institutional_Funding')" title="Export to Excel"
            style="padding:4px 8px;border:1px solid var(--border);background:var(--bg3);color:var(--green);border-radius:4px;cursor:pointer;font-size:11px;">⬇ xlsx</button>
        </div>
      </div>
      <div class="panel-body">${bodyHtml}</div>
    </div>`;
}

function paintAgfMode() {
  const per = latestPeriod();
  if (!per) return '<p style="color:var(--text3);">No periods loaded.</p>';

  const rows = state.agfs.map((a) => {
    const dap = sumAt(clIfAgfAccount(a.rut, 'DAP'), per);
    const bb = sumAt(clIfAgfAccount(a.rut, 'BB'), per);
    const bs = sumAt(clIfAgfAccount(a.rut, 'BS'), per);
    const tot = instrumentValue(dap, bb, bs);
    return { ...a, dap, bb, bs, tot };
  }).filter((r) => r.tot > 0)
    .sort((a, b) => b.tot - a.tot);

  if (!rows.length) {
    return `<div class="empty"><p>No mutual-fund DAP/bond holdings in the loaded range
      (last period tried: ${esc(periodLabel(per))}).
      CMF cartera nacional usually lags the bank balance ZIP by ~1–2 months —
      set <strong>Hasta</strong> to an earlier month (e.g. May 2025) or wait for the next FM file.</p></div>`;
  }

  if (!state.selectedAgf || !rows.some((r) => String(r.rut) === String(state.selectedAgf))) {
    state.selectedAgf = String(rows[0].rut);
  }

  const agf = state.selectedAgf;
  const bankCodes = state.banks.length ? state.banks : selectedBanks();

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

  const tableAgf = `
    <div id="ifExportTable" style="overflow-x:auto;margin-bottom:16px;">
      <table class="data-table" style="width:100%;font-size:12px;">
        <thead><tr>
          <th style="text-align:left;">AGF</th>
          <th style="text-align:right;">DAP</th>
          <th style="text-align:right;">Bonos</th>
          <th style="text-align:right;">Subord.</th>
          <th style="text-align:right;">Total</th>
        </tr></thead>
        <tbody>
          ${rows.map((r) => `
            <tr style="cursor:pointer;${String(r.rut) === String(agf) ? 'background:var(--bg3);' : ''}"
                onclick="ifSelectAgf('${esc(r.rut)}')">
              <td style="text-align:left;font-weight:${String(r.rut) === String(agf) ? '600' : '400'};">${esc(r.short_name || r.legal_name)}</td>
              <td style="text-align:right;font-family:var(--mono);">${fmtKPI(r.dap)}</td>
              <td style="text-align:right;font-family:var(--mono);">${fmtKPI(r.bb)}</td>
              <td style="text-align:right;font-family:var(--mono);">${fmtKPI(r.bs)}</td>
              <td style="text-align:right;font-family:var(--mono);font-weight:600;">${fmtKPI(r.tot)}</td>
            </tr>`).join('')}
        </tbody>
      </table>
    </div>`;

  const bankTable = `
    <div style="margin-bottom:8px;font-size:12px;color:var(--text2);">
      Holdings of <strong>${esc(agfLabel(agf))}</strong> by bank · ${esc(periodLabel(per))}
      <span style="opacity:0.75;"> · DAP%/BB% = share of bank CoA plazo / senior bonds</span>
    </div>
    <div style="overflow-x:auto;margin-bottom:16px;">
      <table class="data-table" style="width:100%;font-size:12px;">
        <thead><tr>
          <th style="text-align:left;">Bank</th>
          <th style="text-align:right;">DAP</th>
          <th style="text-align:right;">of bank DAP</th>
          <th style="text-align:right;">Bonos</th>
          <th style="text-align:right;">of bank BB</th>
          <th style="text-align:right;">Total</th>
        </tr></thead>
        <tbody>
          ${bankRows.length ? bankRows.map((r) => `
            <tr>
              <td style="text-align:left;"><span style="display:inline-block;width:8px;height:8px;border-radius:2px;background:${bankColor(r.code)};margin-right:6px;"></span>${esc(bankName(r.code))}</td>
              <td style="text-align:right;font-family:var(--mono);">${fmtKPI(r.dap)}</td>
              <td style="text-align:right;font-family:var(--mono);color:var(--text2);">${r.dapShare}</td>
              <td style="text-align:right;font-family:var(--mono);">${fmtKPI(r.bb)}</td>
              <td style="text-align:right;font-family:var(--mono);color:var(--text2);">${r.bbShare}</td>
              <td style="text-align:right;font-family:var(--mono);font-weight:600;">${fmtKPI(r.tot)}</td>
            </tr>`).join('') : '<tr><td colspan="6" style="color:var(--text3);">No bank breakdown for selected banks / period.</td></tr>'}
        </tbody>
      </table>
    </div>`;

  const chartBlock = `
    <div style="margin-top:8px;">
      <div style="font-size:12px;color:var(--text2);margin-bottom:6px;">${esc(agfLabel(agf))} · stock over time</div>
      <canvas id="ifChart" class="chart-canvas" height="160"></canvas>
    </div>`;

  queueMicrotask(() => drawIfChart(seriesDap, seriesBb, seriesBs));

  return `<div class="g2">${tableAgf}${bankTable}</div>${chartBlock}`;
}

function drawIfChart(seriesDap, seriesBb, seriesBs) {
  let series;
  if (state.instrument === 'all') {
    series = [
      { label: 'DAP', color: CL_IF_COLORS.dap, data: sparseData(seriesDap) },
      { label: 'Bonos', color: CL_IF_COLORS.bb, data: sparseData(seriesBb) },
      { label: 'Subord.', color: CL_IF_COLORS.bs, data: sparseData(seriesBs) },
    ];
  } else if (state.instrument === 'BB') {
    series = [{ label: 'Bonos', color: CL_IF_COLORS.bb, data: sparseData(seriesBb) }];
  } else if (state.instrument === 'BS') {
    series = [{ label: 'Subord.', color: CL_IF_COLORS.bs, data: sparseData(seriesBs) }];
  } else {
    series = [{ label: 'DAP', color: CL_IF_COLORS.dap, data: sparseData(seriesDap) }];
  }
  drawLineChart('ifChart', state.periodos, series, {
    height: 200,
    style: 'area',
    showLegend: true,
  });
}

function paintBankMode() {
  const per = latestPeriod();
  if (!per) return '<p style="color:var(--text3);">No periods loaded.</p>';

  const banks = selectedBanks();
  const focus = banks[0];
  if (!focus) return '<p style="color:var(--text3);">Select a bank in the sidebar.</p>';

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

  return `
    <div style="margin-bottom:12px;font-size:13px;">
      <strong>${esc(bankName(focus))}</strong> — FM funding ${fmtKPI(tot)}
      <span style="color:var(--text3);"> · DAP ${fmtKPI(dap)} (${fmtShare(dap, bankDapLiab)} of bank plazo)
        · Bonds ${fmtKPI(bb)} (${fmtShare(bb, bankBbLiab)} of senior bonds)
        · ${esc(periodLabel(per))}</span>
    </div>
    <div id="ifExportTable" style="overflow-x:auto;margin-bottom:16px;">
      <table class="data-table" style="width:100%;font-size:12px;">
        <thead><tr>
          <th style="text-align:left;">AGF</th>
          <th style="text-align:right;">DAP</th>
          <th style="text-align:right;">Bonos</th>
          <th style="text-align:right;">Subord.</th>
          <th style="text-align:right;">Total</th>
          <th style="text-align:right;">Share</th>
        </tr></thead>
        <tbody>
          ${agfRows.length ? agfRows.map((r) => `
            <tr>
              <td style="text-align:left;">${esc(r.short_name || r.legal_name)}</td>
              <td style="text-align:right;font-family:var(--mono);">${fmtKPI(r.dap)}</td>
              <td style="text-align:right;font-family:var(--mono);">${fmtKPI(r.bb)}</td>
              <td style="text-align:right;font-family:var(--mono);">${fmtKPI(r.bs)}</td>
              <td style="text-align:right;font-family:var(--mono);font-weight:600;">${fmtKPI(r.tot)}</td>
              <td style="text-align:right;font-family:var(--mono);">${tot ? ((100 * r.tot) / tot).toFixed(1) + '%' : '—'}</td>
            </tr>`).join('') : '<tr><td colspan="6" style="color:var(--text3);">No AGF holdings for this bank / period.</td></tr>'}
        </tbody>
      </table>
    </div>
    <div>
      <div style="font-size:12px;color:var(--text2);margin-bottom:6px;">${esc(bankName(focus))} · FM stock over time</div>
      <canvas id="ifChart" class="chart-canvas" height="160"></canvas>
    </div>`;
}

function paint() {
  const root = rootEl();
  if (!root) return;
  const isoNow = datasetIsoCountry();
  if (state.iso && state.iso !== isoNow) {
    state.armed = false;
    state.loaded = false;
    state.loading = false;
    state.error = null;
    state.rows = [];
    state.liabRows = [];
    state.selectionKey = '';
    state.iso = isoNow;
  }
  if (!IF_COUNTRIES.has(isoNow)) {
    emptyState('Institutional Funding is available for Chile only (CMF mutual-fund portfolio).');
    return;
  }
  if (state.loading) {
    paintLoading();
    return;
  }
  if (state.error && !state.loaded) {
    root.innerHTML = `<div class="fa-empty">
      <div class="fa-empty-title" style="color:var(--red);">${esc(state.error)}</div>
      <div class="fa-empty-sub" style="margin-top:8px;">Try again, or narrow From/To in the sidebar.</div>
      <button type="button" class="rcbtn" id="ifRetryBtn" style="margin-top:12px;">Retry</button>
    </div>`;
    document.getElementById('ifRetryBtn')?.addEventListener('click', () => {
      state.armed = true;
      state.error = null;
      state.loaded = false;
      state.selectionKey = '';
      loadData();
    });
    return;
  }
  if (!state.armed || !state.loaded) {
    paintGate();
    return;
  }
  const body = state.mode === 'bank' ? paintBankMode() : paintAgfMode();
  root.innerHTML = buildShell(body);
}

async function loadData() {
  const iso = datasetIsoCountry();
  if (!IF_COUNTRIES.has(iso)) {
    state.loaded = true;
    state.armed = true;
    state.rows = [];
    paint();
    return;
  }
  if (!state.armed) {
    paintGate();
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

    // Sidebar often ends on the latest CoA month while FM cartera lags.
    // If the window has no IF months, widen the probe.
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
          + `Your From/To range had no FM months yet.`;
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
    // Sequential: shared API pool max=2; avoid starving Bank Monitor if user switches tabs.
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
  // Never auto-fetch — wait for Load (keeps Bank Monitor free of IF traffic).
  paint();
}

export function refreshInstitutionalFunding() {
  if (!state.armed) {
    state.loaded = false;
    state.selectionKey = '';
    paint();
    return;
  }
  state.loaded = false;
  state.selectionKey = '';
  loadData();
}
