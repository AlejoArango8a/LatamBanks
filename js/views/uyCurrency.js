// ============================================================
// Currency Split — Uruguay (BCU / SSF)
//
// The boletín publishes every balance-sheet line twice, in "Actividad en M/N"
// and "Actividad en M/E". That is a full second balance sheet per bank that
// the platform stored but never showed. This sheet puts the two next to the
// total, lets you read each one on its own, and turns the pair into the FX
// mismatch analysis the split exists for.
// ============================================================
import {
  UY_CURRENCY_SUMMARY,
  UY_CURRENCY_COLORS,
  BAL_UY_SECTIONS,
  uyCurrencyAccountsForRun,
  uyCurrencySnapshot,
  uyCurrencySeries,
  uySum,
} from '../uyCuentas.js?v=bmon104';
import { ST, datasetIsoCountry } from '../state.js?v=bmon104';
import { fetchData } from '../api.js?v=bmon104';
import { bankName, fmtKPI, periodLabel } from '../format.js?v=bmon104';
import { bankColor } from '../config.js?v=bmon104';
import { drawLineChart, sparseData } from '../charts.js?v=bmon104';

const CURRENCY_COUNTRIES = new Set(['UY']);
const MAX_BANKS = 5;

const LENSES = [
  { key: 'summary', label: 'Side by side', sub: 'Pesos, dollars and total in one table' },
  { key: 'local', label: 'Pesos (M/N)', sub: 'The balance sheet in local currency only' },
  { key: 'ext', label: 'Dollars (M/E)', sub: 'The balance sheet in foreign currency only' },
  { key: 'detail', label: 'Full account tree', sub: 'Every published line, three columns' },
];

const METRICS = [
  { key: 'share', label: 'FX share' },
  { key: 'stocks', label: 'Stocks by currency' },
  { key: 'mismatch', label: 'FX mismatch' },
];

const state = {
  loading: false,
  loaded: false,
  error: null,
  lens: 'summary',
  metric: 'share',
  chartStyle: 'lines',
  banks: [],
  periodos: [],
  rowsByTipo: {},
  selectionKey: '',
  activeBank: null,
  compare: false,
};

function esc(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function fmtPct(n, digits = 1) {
  if (n == null || !Number.isFinite(Number(n))) return '—';
  return `${Number(n).toFixed(digits)}%`;
}

function selectedBanks() {
  const list = ST.selectedOrder?.length ? [...ST.selectedOrder] : [...(ST.selected || [])];
  return list.map(Number).filter((c) => Number.isFinite(c)).slice(0, MAX_BANKS);
}

function selectionKey() {
  return selectedBanks().join(',');
}

function periodRange() {
  const desde = document.getElementById('selDesde')?.value || ST.desde || ST.periodos?.[0];
  const hasta = document.getElementById('selHasta')?.value
    || ST.hasta
    || ST.periodos?.[ST.periodos.length - 1];
  return (ST.periodos || []).filter((p) => p >= desde && p <= hasta);
}

function entities() {
  return selectedBanks().map((code, i) => ({
    code,
    label: bankName(code) || `Bank ${code}`,
    color: bankColor(code, i, bankName(code)) || UY_CURRENCY_COLORS.total,
  }));
}

/**
 * drawLineChart's money axis expects values already in billions, and in USD
 * when that toggle is on. Same convention as Bank Monitor.
 */
function chartMoney(v) {
  if (v == null || !Number.isFinite(Number(v))) return null;
  const usd = ST.currency === 'USD' && Number(ST.usdRate) > 0 ? 1 / ST.usdRate : 1;
  return (Number(v) / 1e9) * usd;
}

function rowsFor(code, tipo) {
  return (state.rowsByTipo[tipo] || []).filter((r) => Number(r.ins_cod) === Number(code));
}

function snapshotFor(code, periodo = state.periodos[state.periodos.length - 1]) {
  return uyCurrencySnapshot(rowsFor(code, 'b1'), rowsFor(code, 'q1'), periodo);
}

// ------------------------------------------------------------
// Data
// ------------------------------------------------------------

async function loadData() {
  const banks = selectedBanks();
  const periodos = periodRange();
  if (!banks.length) {
    state.error = 'Select at least one bank in the sidebar, then open Currency Split.';
    state.loaded = false;
    render();
    return;
  }
  if (!periodos.length) {
    state.error = 'No periods in the selected From/To range.';
    state.loaded = false;
    render();
    return;
  }

  state.loading = true;
  state.error = null;
  render();

  try {
    const accounts = uyCurrencyAccountsForRun();
    const [b1, q1] = await Promise.all([
      fetchData('b1', accounts.b1, periodos, banks),
      fetchData('q1', accounts.q1, periodos, banks),
    ]);
    state.rowsByTipo = { b1: b1 || [], q1: q1 || [] };
    state.banks = banks;
    state.periodos = periodos;
    state.activeBank = banks.includes(state.activeBank) ? state.activeBank : banks[0];
    state.selectionKey = selectionKey();
    state.loaded = true;
  } catch (e) {
    console.error('[uyCurrency]', e);
    state.error = String(e.message || e);
    state.loaded = false;
  } finally {
    state.loading = false;
    render();
  }
}

// ------------------------------------------------------------
// Rendering
// ------------------------------------------------------------

function renderKpis(snap) {
  if (!snap?.hasData) return '';
  const net = snap.netFx;
  const netTone = net >= 0 ? 'blue' : 'red';
  const gap = snap.dollarizationGap;
  const gapSub = gap == null
    ? 'needs both sides reported'
    : gap >= 0
      ? 'lends in dollars more than it funds'
      : 'funds in dollars more than it lends';

  return `
    <div class="kpi-grid fa-kpi-grid aq-kpi-grid">
      <div class="kpi-col">
        <div class="kpi-col-title">Assets in foreign currency</div>
        <div class="kpi blue"><div class="kpi-val">${fmtPct(snap.assetsExtPct)}</div>
        <div class="kpi-sub">${fmtKPI(snap.byKey.assets.ext)} of ${fmtKPI(snap.byKey.assets.total)}</div></div>
      </div>
      <div class="kpi-col">
        <div class="kpi-col-title">Liabilities in foreign currency</div>
        <div class="kpi blue"><div class="kpi-val">${fmtPct(snap.liabilitiesExtPct)}</div>
        <div class="kpi-sub">${fmtKPI(snap.byKey.liabilities.ext)} of ${fmtKPI(snap.byKey.liabilities.total)}</div></div>
      </div>
      <div class="kpi-col">
        <div class="kpi-col-title">Net FX position</div>
        <div class="kpi ${netTone}"><div class="kpi-val">${fmtKPI(net)}</div>
        <div class="kpi-sub">${fmtPct(snap.netFxOverEquity)} of equity · on balance sheet</div></div>
      </div>
      <div class="kpi-col">
        <div class="kpi-col-title">Dollarization — loans</div>
        <div class="kpi green"><div class="kpi-val">${fmtPct(snap.loansExtPct)}</div>
        <div class="kpi-sub">Deposits ${fmtPct(snap.depositsExtPct)}</div></div>
      </div>
      <div class="kpi-col">
        <div class="kpi-col-title">Dollarization gap</div>
        <div class="kpi purple"><div class="kpi-val">${gap == null ? '—' : `${gap >= 0 ? '+' : ''}${gap.toFixed(1)} pp`}</div>
        <div class="kpi-sub">${esc(gapSub)}</div></div>
      </div>
    </div>`;
}

function sideHeader(label) {
  return `<tr><td colspan="5" class="pl-section">${esc(label)}</td></tr>`;
}

/** Side-by-side: pesos, dollars and total on one row each. */
function renderSummaryTable(snap) {
  if (!snap?.hasData) return '<div class="fa-empty-sub" style="padding:18px;">No balance for this period.</div>';
  let last = null;
  const body = snap.lines.map((l) => {
    let prefix = '';
    if (l.side !== last) {
      prefix = sideHeader(l.side === 'asset' ? 'Assets' : l.side === 'liab' ? 'Liabilities' : 'Equity');
      last = l.side;
    }
    const cls = l.head ? 'hl' : 'i1';
    return `${prefix}<tr>
      <td class="${cls}">${esc(l.label)}</td>
      <td class="r ${cls}">${fmtKPI(l.local)}</td>
      <td class="r ${cls}">${fmtKPI(l.ext)}</td>
      <td class="r ${cls}">${fmtKPI(l.total)}</td>
      <td class="r">${fmtPct(l.extPct)}</td>
    </tr>`;
  }).join('');
  return `<table class="data fa-table">
    <thead><tr>
      <th>Line</th>
      <th class="r"><span class="fa-swatch" style="background:${UY_CURRENCY_COLORS.local}"></span>Pesos (M/N)</th>
      <th class="r"><span class="fa-swatch" style="background:${UY_CURRENCY_COLORS.ext}"></span>FX (M/E)</th>
      <th class="r">Total</th>
      <th class="r">% in FX</th>
    </tr></thead>
    <tbody>${body}</tbody>
  </table>`;
}

/** One currency on its own, read as a standalone balance sheet. */
function renderSingleCurrencyTable(snap, field) {
  if (!snap?.hasData) return '<div class="fa-empty-sub" style="padding:18px;">No balance for this period.</div>';
  const colLabel = field === 'local' ? 'Pesos (M/N)' : 'Foreign currency (M/E)';
  const color = field === 'local' ? UY_CURRENCY_COLORS.local : UY_CURRENCY_COLORS.ext;
  const heads = {
    asset: snap.byKey.assets[field],
    liab: snap.byKey.liabilities[field],
    equity: snap.byKey.equity[field],
  };
  let last = null;
  const body = snap.lines.map((l) => {
    let prefix = '';
    if (l.side !== last) {
      prefix = sideHeader(l.side === 'asset' ? 'Assets' : l.side === 'liab' ? 'Liabilities' : 'Equity');
      last = l.side;
    }
    const cls = l.head ? 'hl' : 'i1';
    const base = heads[l.side];
    const share = base ? (l[field] / base) * 100 : null;
    return `${prefix}<tr>
      <td class="${cls}">${esc(l.label)}</td>
      <td class="r ${cls}">${fmtKPI(l[field])}</td>
      <td class="r">${l.head ? '' : fmtPct(share)}</td>
      <td class="r">${fmtPct(l.extPct)}</td>
    </tr>`;
  }).join('');
  return `<table class="data fa-table">
    <thead><tr>
      <th>Line</th>
      <th class="r"><span class="fa-swatch" style="background:${color}"></span>${esc(colLabel)}</th>
      <th class="r">% of side</th>
      <th class="r">% of line in FX</th>
    </tr></thead>
    <tbody>${body}</tbody>
  </table>`;
}

/** Every published account, three columns — the BCU tree as it comes. */
function renderDetailTable(code, periodo) {
  const rows = rowsFor(code, 'b1');
  const sections = [
    ['Assets', BAL_UY_SECTIONS.assets],
    ['Liabilities', BAL_UY_SECTIONS.liabilities],
    ['Equity', BAL_UY_SECTIONS.equity],
  ];
  const body = sections.map(([title, defs]) => {
    const lines = defs.map((d) => {
      const local = uySum(rows, [d.c], periodo, 'monto_clp');
      const ext = uySum(rows, [d.c], periodo, 'monto_ext');
      const total = uySum(rows, [d.c], periodo, 'monto_total');
      const share = total ? (ext / total) * 100 : null;
      return `<tr>
        <td class="cod">${esc(d.c)}</td>
        <td class="${d.cls}">${esc(d.l)}</td>
        <td class="r ${d.cls === 'hl' ? 'hl' : ''}">${fmtKPI(local)}</td>
        <td class="r ${d.cls === 'hl' ? 'hl' : ''}">${fmtKPI(ext)}</td>
        <td class="r ${d.cls === 'hl' ? 'hl' : ''}">${fmtKPI(total)}</td>
        <td class="r">${fmtPct(share)}</td>
      </tr>`;
    }).join('');
    return `<tr><td colspan="6" class="pl-section">${esc(title)}</td></tr>${lines}`;
  }).join('');
  return `<table class="data fa-table">
    <thead><tr>
      <th class="cod">Code</th><th>Account</th>
      <th class="r">Pesos (M/N)</th><th class="r">FX (M/E)</th><th class="r">Total</th><th class="r">% in FX</th>
    </tr></thead>
    <tbody>${body}</tbody>
  </table>`;
}

/** Peer table: one column per bank, FX metrics only. */
function renderCompareTable(ents, periodo) {
  const snaps = ents.map((e) => ({ e, snap: snapshotFor(e.code, periodo) }));
  const head = snaps.map(({ e }, i) => `<th class="r fa-bank-start fa-bank-head ${i % 2 === 0 ? 'fa-bank-tone-a' : ''}" style="--fa-bank-line:${esc(e.color)}">
      <span class="fa-swatch" style="background:${esc(e.color)}"></span>${esc(e.label)}
    </th>`).join('');
  const row = (label, fmt) => `<tr><td>${esc(label)}</td>${snaps.map(({ e, snap }, i) => `<td class="r fa-bank-start ${i % 2 === 0 ? 'fa-bank-tone-a' : ''}" style="--fa-bank-line:${esc(e.color)}">${fmt(snap)}</td>`).join('')}</tr>`;
  return `<table class="data fa-table fa-table-peers">
    <thead><tr><th>Metric</th>${head}</tr></thead>
    <tbody>
      ${row('Total assets', (s) => fmtKPI(s.byKey.assets.total))}
      ${row('Assets in pesos', (s) => fmtKPI(s.byKey.assets.local))}
      ${row('Assets in FX', (s) => fmtKPI(s.byKey.assets.ext))}
      ${row('FX share of assets', (s) => fmtPct(s.assetsExtPct))}
      ${row('FX share of liabilities', (s) => fmtPct(s.liabilitiesExtPct))}
      ${row('FX share of loans', (s) => fmtPct(s.loansExtPct))}
      ${row('FX share of deposits', (s) => fmtPct(s.depositsExtPct))}
      ${row('Dollarization gap (loans − deposits)', (s) => (s.dollarizationGap == null ? '—' : `${s.dollarizationGap >= 0 ? '+' : ''}${s.dollarizationGap.toFixed(1)} pp`))}
      ${row('Net FX position', (s) => fmtKPI(s.netFx))}
      ${row('Net FX / equity', (s) => fmtPct(s.netFxOverEquity))}
      ${row('BCU V.1 — net FX / equity', (s) => fmtPct(s.published.fxPosition, 2))}
      ${row('BCU LCR — pesos', (s) => fmtPct(s.published.lcrLocal, 0))}
      ${row('BCU LCR — US dollars', (s) => fmtPct(s.published.lcrUsd, 0))}
    </tbody>
  </table>`;
}

function renderMismatchPanel(snap) {
  if (!snap?.hasData) return '';
  const p = snap.published || {};
  const rows = [
    ['FX assets', fmtKPI(snap.byKey.assets.ext), fmtPct(snap.assetsExtPct)],
    ['FX liabilities', fmtKPI(snap.byKey.liabilities.ext), fmtPct(snap.liabilitiesExtPct)],
    ['Net FX position (assets − liabilities)', fmtKPI(snap.netFx), fmtPct(snap.netFxOverEquity)],
  ].map(([l, a, b]) => `<tr><td>${esc(l)}</td><td class="r">${a}</td><td class="r">${b}</td></tr>`).join('');

  const pubRows = [
    ['V.1 — Net FX position / equity', p.fxPosition, fmtPct(snap.netFxOverEquity)],
    ['VII.1 — Dollarization of gross loans (SNF)', p.fxLoans, fmtPct(snap.loansExtPct)],
    ['VII.2 — Dollarization of deposits (SNF)', p.fxDeposits, fmtPct(snap.depositsExtPct)],
    ['II.3 — LCR in pesos', p.lcrLocal, '—'],
    ['II.4 — LCR in US dollars', p.lcrUsd, '—'],
    ['II.5 — LCR consolidated', p.lcrAll, '—'],
  ].filter(([, pub]) => pub != null)
    .map(([l, pub, own]) => `<tr><td>${esc(l)}</td><td class="r">${fmtPct(pub, 2)}</td><td class="r">${own}</td></tr>`)
    .join('');

  return `
    <div class="panel fa-panel" style="margin-top:18px;">
      <div class="panel-head"><div>
        <div class="panel-title">FX mismatch · ${esc(periodLabel(snap.periodo))}</div>
        <div class="panel-sub">What the bank holds in dollars against what it owes in dollars</div>
      </div></div>
      <div class="panel-body" style="overflow-x:auto;padding:0;">
        <table class="data fa-table">
          <thead><tr><th>Line</th><th class="r">Amount</th><th class="r">% of equity / side</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
    </div>
    ${pubRows ? `<div class="panel fa-panel" style="margin-top:18px;">
      <div class="panel-head"><div>
        <div class="panel-title">BCU Anexo 4 · currency indicators</div>
        <div class="panel-sub">V.1 includes off-balance positions. VII.1 and VII.2 use the BCU's non-financial book; the rebuilt column uses the balance-sheet lines above, so the two are close on purpose rather than identical.</div>
      </div></div>
      <div class="panel-body" style="overflow-x:auto;padding:0;">
        <table class="data fa-table">
          <thead><tr><th>Indicator</th><th class="r">BCU published</th><th class="r">Rebuilt on balance sheet</th></tr></thead>
          <tbody>${pubRows}</tbody>
        </table>
      </div>
    </div>` : ''}`;
}

// ------------------------------------------------------------
// Chart
// ------------------------------------------------------------

function drawChart(ents) {
  const periodos = state.periodos;
  let series = [];
  let valueScale = 'percent';

  if (state.metric === 'share') {
    const defs = [
      { key: 'assets', label: 'Assets', color: UY_CURRENCY_COLORS.total },
      { key: 'loans', label: 'Loans', color: UY_CURRENCY_COLORS.ext },
      { key: 'deposits', label: 'Deposits', color: UY_CURRENCY_COLORS.local },
    ];
    if (ents.length === 1) {
      const rows = rowsFor(ents[0].code, 'b1');
      series = defs.map((d) => ({
        label: `${d.label} · % in FX`,
        color: d.color,
        data: sparseData(uyCurrencySeries(rows, d.key, periodos).map((l) => l.extPct)),
      }));
    } else {
      series = ents.map((e) => ({
        label: e.label,
        color: e.color,
        data: sparseData(uyCurrencySeries(rowsFor(e.code, 'b1'), 'assets', periodos).map((l) => l.extPct)),
      }));
    }
  } else if (state.metric === 'stocks') {
    valueScale = 'billions';
    if (ents.length === 1) {
      const rows = rowsFor(ents[0].code, 'b1');
      const assets = uyCurrencySeries(rows, 'assets', periodos);
      series = [
        { label: 'Assets in pesos (M/N)', color: UY_CURRENCY_COLORS.local, data: sparseData(assets.map((l) => chartMoney(l.local))) },
        { label: 'Assets in FX (M/E)', color: UY_CURRENCY_COLORS.ext, data: sparseData(assets.map((l) => chartMoney(l.ext))) },
      ];
    } else {
      series = ents.map((e) => ({
        label: `${e.label} · FX assets`,
        color: e.color,
        data: sparseData(uyCurrencySeries(rowsFor(e.code, 'b1'), 'assets', periodos).map((l) => chartMoney(l.ext))),
      }));
    }
  } else {
    valueScale = 'billions';
    series = ents.map((e) => {
      const rows = rowsFor(e.code, 'b1');
      const a = uyCurrencySeries(rows, 'assets', periodos);
      const l = uyCurrencySeries(rows, 'liabilities', periodos);
      return {
        label: ents.length === 1 ? 'Net FX position' : e.label,
        color: ents.length === 1 ? UY_CURRENCY_COLORS.net : e.color,
        data: sparseData(a.map((x, i) => chartMoney(x.ext - l[i].ext))),
      };
    });
  }

  drawLineChart('uyCurrencyChart', periodos, series, {
    valueScale,
    height: 300,
    style: state.chartStyle,
    showLegend: true,
    emptyMessage: 'No currency series for this selection.',
  });
}

// ------------------------------------------------------------
// Interaction
// ------------------------------------------------------------

function bind(selector, handler) {
  document.querySelectorAll(selector).forEach((btn) => {
    btn.addEventListener('click', () => {
      if (btn.disabled) return;
      handler(btn);
    });
  });
}

function render() {
  const root = document.getElementById('uyCurrencyRoot');
  if (!root) return;

  if (!CURRENCY_COUNTRIES.has(datasetIsoCountry())) {
    root.innerHTML = `<div class="fa-empty">
      <div class="fa-empty-title">Currency Split</div>
      <div class="fa-empty-sub">Available for <strong>Uruguay</strong>, the only regulator in the set that publishes every balance-sheet line split into local and foreign currency.</div>
    </div>`;
    return;
  }

  if (state.loading) {
    root.innerHTML = `<div class="fa-empty"><div class="ls-bars" aria-hidden="true"><div></div><div></div><div></div><div></div><div></div></div>
      <div class="fa-empty-sub" style="margin-top:16px;">Loading the pesos and dollars balance sheets…</div></div>`;
    return;
  }

  if (state.error && !state.loaded) {
    root.innerHTML = `<div class="fa-empty">
      <div class="fa-empty-title" style="color:var(--red);">${esc(state.error)}</div>
      <button type="button" class="rcbtn" id="uyCurRetry" style="margin-top:12px;">Retry</button>
    </div>`;
    document.getElementById('uyCurRetry')?.addEventListener('click', loadData);
    return;
  }

  if (state.loaded && state.selectionKey !== selectionKey()) state.loaded = false;

  if (!state.loaded) {
    root.innerHTML = `<div class="fa-empty">
      <div class="fa-empty-title">Currency Split</div>
      <div class="fa-empty-sub">The BCU reports each bank twice — once in pesos, once in foreign currency. Read both, separately or side by side, and see the mismatch between them.</div>
      <button type="button" class="rcbtn active" id="uyCurLoad" style="margin-top:14px;">Load currency split</button>
    </div>`;
    document.getElementById('uyCurLoad')?.addEventListener('click', loadData);
    return;
  }

  const ents = entities().filter((e) => state.banks.includes(e.code));
  if (!ents.length) {
    state.loaded = false;
    state.error = 'Select at least one bank in the sidebar, then open Currency Split.';
    render();
    return;
  }

  const comparing = state.compare && ents.length >= 2;
  const active = ents.find((e) => e.code === state.activeBank) || ents[0];
  state.activeBank = active.code;
  const lastP = state.periodos[state.periodos.length - 1];
  const snap = snapshotFor(active.code, lastP);
  const lens = LENSES.find((l) => l.key === state.lens) || LENSES[0];

  const bankTabs = ents.map((e) => `<button type="button" class="rcbtn ${!comparing && e.code === active.code ? 'active' : ''}" data-uycur-bank="${e.code}" ${comparing ? 'disabled title="Switch to Single to focus one bank"' : ''}>
      <span class="fa-swatch" style="background:${esc(e.color)}"></span>${esc(e.label)}
    </button>`).join('');

  const lensTabs = LENSES.map((l) => `<button type="button" class="rcbtn ${state.lens === l.key ? 'active' : ''}" data-uycur-lens="${l.key}">${esc(l.label)}</button>`).join('');
  const metricTabs = METRICS.map((m) => `<button type="button" class="rcbtn ${state.metric === m.key ? 'active' : ''}" data-uycur-metric="${m.key}">${esc(m.label)}</button>`).join('');
  const styleTabs = ['lines', 'bars', 'area'].map((s) => `<button type="button" class="rcbtn ${state.chartStyle === s ? 'active' : ''}" data-uycur-style="${s}">${s[0].toUpperCase()}${s.slice(1)}</button>`).join('');

  const table = comparing
    ? renderCompareTable(ents, lastP)
    : state.lens === 'detail'
      ? renderDetailTable(active.code, lastP)
      : state.lens === 'local'
        ? renderSingleCurrencyTable(snap, 'local')
        : state.lens === 'ext'
          ? renderSingleCurrencyTable(snap, 'ext')
          : renderSummaryTable(snap);

  root.innerHTML = `
    <div class="fa-hero aq-hero">
      <div>
        <div class="fa-eyebrow">Uruguay · BCU / Superintendencia de Servicios Financieros</div>
        <div class="fa-title">Currency Split</div>
        <div class="fa-sub">Every line of the boletín comes open in pesos and in foreign currency. Two balance sheets per bank, and the gap between them.</div>
      </div>
      <button type="button" class="rcbtn" id="uyCurReload">Refresh</button>
    </div>

    <div class="fa-peer-bar">
      <div class="fa-peer-row">
        <div class="fa-peer-hint" style="margin:0;">Sidebar peers · max ${MAX_BANKS}</div>
        <div class="fa-compare-toggle" role="group" aria-label="View mode">
          <button type="button" class="rcbtn ${!state.compare ? 'active' : ''}" data-uycur-compare="0">Single</button>
          <button type="button" class="rcbtn ${state.compare ? 'active' : ''}" data-uycur-compare="1">Compare</button>
        </div>
      </div>
    </div>

    <div class="fa-toolbar">
      <div class="fa-bank-tabs">${bankTabs}</div>
      <div class="fa-metric-tabs">${metricTabs}</div>
    </div>

    ${comparing ? '' : renderKpis(snap)}

    <div class="panel fa-panel" style="margin-top:22px;">
      <div class="panel-head fa-chart-head">
        <div>
          <div class="panel-title">${esc(METRICS.find((m) => m.key === state.metric).label)} over time</div>
          <div class="panel-sub">${esc(comparing ? ents.map((e) => e.label).join(' · ') : active.label)} · ${esc(periodLabel(state.periodos[0]))} — ${esc(periodLabel(lastP))}</div>
        </div>
        <div class="fa-chart-styles" role="group" aria-label="Chart style">${styleTabs}</div>
      </div>
      <div class="panel-body">
        <div class="chart-wrap" style="position:relative;min-height:280px;">
          <canvas id="uyCurrencyChart" height="300" style="width:100%;height:300px;"></canvas>
        </div>
      </div>
    </div>

    <div class="panel fa-panel" style="margin-top:18px;">
      <div class="panel-head fa-chart-head">
        <div>
          <div class="panel-title">${esc(comparing ? 'Currency profile · peer compare' : 'Balance sheet by currency')} · ${esc(periodLabel(lastP))}</div>
          <div class="panel-sub">${esc(comparing ? 'One column per bank · local reporting units' : lens.sub)}</div>
        </div>
        ${comparing ? '' : `<div class="fa-chart-styles" role="group" aria-label="Currency lens">${lensTabs}</div>`}
      </div>
      <div class="panel-body" style="overflow-x:auto;padding:0;">${table}</div>
    </div>

    ${comparing ? '' : renderMismatchPanel(snap)}

    <ul class="fa-notes">
      <li><strong>Unidades indexadas (UI).</strong> The boletín has no third column for them. The SSF files UI-denominated instruments inside <em>Actividad en M/N</em>, and publishes no per-bank UI breakdown in any annex, so the pesos column here includes inflation-indexed balances and cannot be split further from this source.</li>
      <li><strong>M/E is not only dollars.</strong> It is every foreign currency, in practice overwhelmingly US dollars, converted to pesos at the BCU closing rate. Movements therefore mix volume and exchange rate.</li>
      <li><strong>Rounding.</strong> The BCU rounds each column on its own, so pesos + FX can miss the published total by up to one thousand pesos per line. Shares always divide by the published total.</li>
      <li><strong>Net FX position.</strong> The figure here is on balance sheet only. BCU's V.1 follows article 165 of the RNRCSF and takes in derivatives and other off-balance positions, which is why the two are shown next to each other rather than as one number.</li>
    </ul>
  `;

  document.getElementById('uyCurReload')?.addEventListener('click', loadData);
  bind('[data-uycur-bank]', (b) => { state.activeBank = Number(b.getAttribute('data-uycur-bank')); render(); });
  bind('[data-uycur-lens]', (b) => { state.lens = b.getAttribute('data-uycur-lens'); render(); });
  bind('[data-uycur-metric]', (b) => { state.metric = b.getAttribute('data-uycur-metric'); render(); });
  bind('[data-uycur-style]', (b) => { state.chartStyle = b.getAttribute('data-uycur-style'); render(); });
  bind('[data-uycur-compare]', (b) => { state.compare = b.getAttribute('data-uycur-compare') === '1'; render(); });

  requestAnimationFrame(() => drawChart(comparing ? ents : [active]));
}

export function refreshUyCurrency() {
  state.loaded = false;
  state.error = null;
  renderUyCurrency();
}

export function renderUyCurrency() {
  if (!CURRENCY_COUNTRIES.has(datasetIsoCountry())) {
    state.loaded = false;
    state.selectionKey = '';
    render();
    return;
  }
  if (state.loaded && state.selectionKey !== selectionKey()) state.loaded = false;
  if (!state.loaded && !state.loading && selectedBanks().length) {
    loadData();
    return;
  }
  render();
}
