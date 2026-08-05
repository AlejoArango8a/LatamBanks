// ============================================================
// Funding Analytics — Brazil ALM / Treasury funding sheet
// Uses IF.data Cosif already loaded (LCI, LCA, LF, deposits…).
// CRA/CRI are NOT bank liabilities — shown only as a note.
// ============================================================
import {
  BR_FUNDING_INSTRUMENTS,
  BR_FUNDING_COLORS,
  BR_KPI,
  BR_TAX_ELIGIBLE_CODES,
  brFundingAccountsForRun,
  brFundingSnapshot,
  brSeries,
  brSum,
  brResultReset,
} from '../brCuentas.js?v=bmon65';
import { ST, datasetIsoCountry } from '../state.js?v=bmon65';
import { fetchData } from '../api.js?v=bmon65';
import { bankName, fmtKPI, periodLabel } from '../format.js?v=bmon65';
import { btgBlue } from '../config.js?v=bmon65';

const state = {
  loading: false,
  loaded: false,
  error: null,
  metric: 'mix', // mix | tax | cost
  banks: [],
  periodos: [],
  rows: [], // b1+r1 combined for selected banks
  lastBank: null,
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

function fmtRatio(n) {
  if (n == null || !Number.isFinite(Number(n))) return '—';
  return `${Number(n).toFixed(2)}x`;
}

function selectedBanks() {
  return ST.selectedOrder?.length ? [...ST.selectedOrder] : [...ST.selected];
}

function periodRange() {
  const desde = document.getElementById('selDesde')?.value || ST.desde || ST.periodos[0];
  const hasta = document.getElementById('selHasta')?.value || ST.hasta || ST.periodos[ST.periodos.length - 1];
  return ST.periodos.filter((p) => p >= desde && p <= hasta);
}

async function loadFundingData() {
  if (datasetIsoCountry() !== 'BR') return;
  const banks = selectedBanks();
  const periodos = periodRange();
  if (!banks.length) {
    state.error = 'Select at least one bank in the sidebar, then open Funding Analytics.';
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
    const cuentas = brFundingAccountsForRun();
    const [b1, r1] = await Promise.all([
      fetchData('b1', cuentas, periodos, banks),
      fetchData('r1', BR_KPI.despesasCaptacao, periodos, banks),
    ]);
    state.banks = banks;
    state.periodos = periodos;
    state.rows = [...(b1 || []), ...(r1 || [])];
    state.lastBank = banks[0];
    state.loaded = true;
  } catch (e) {
    console.error('[fundingAnalytics]', e);
    state.error = String(e.message || e);
    state.loaded = false;
  } finally {
    state.loading = false;
    render();
  }
}

function rowsForBank(code) {
  return state.rows.filter((r) => Number(r.ins_cod) === Number(code));
}

function latestSnapshot(code) {
  const lastP = state.periodos[state.periodos.length - 1];
  return brFundingSnapshot(rowsForBank(code), lastP);
}

function renderKpis(snap) {
  if (!snap) return '';
  return `
    <div class="kpi-grid fa-kpi-grid">
      <div class="kpi-col">
        <div class="kpi-col-title">Total funding</div>
        <div class="kpi blue"><div class="kpi-val">${fmtKPI(snap.captacoes)}</div>
        <div class="kpi-sub">Captações · ${esc(periodLabel(snap.periodo))}</div></div>
      </div>
      <div class="kpi-col">
        <div class="kpi-col-title">Deposits</div>
        <div class="kpi blue"><div class="kpi-val">${fmtKPI(snap.depositos)}</div>
        <div class="kpi-sub">${fmtPct(snap.captacoes ? (snap.depositos / snap.captacoes) * 100 : null)} of funding</div></div>
      </div>
      <div class="kpi-col">
        <div class="kpi-col-title">Tax-advantaged eligible</div>
        <div class="kpi green"><div class="kpi-val">${fmtKPI(snap.taxEligible)}</div>
        <div class="kpi-sub">LCA + LCI · ${fmtPct(snap.taxEligiblePct)} of funding</div></div>
      </div>
      <div class="kpi-col">
        <div class="kpi-col-title">Loans / Deposits</div>
        <div class="kpi purple"><div class="kpi-val">${fmtRatio(snap.ltd)}</div>
        <div class="kpi-sub">Loans / funding ${fmtRatio(snap.ltf)}</div></div>
      </div>
    </div>`;
}

function renderInstrumentTable(snap) {
  if (!snap) return '';
  const rows = snap.instruments
    .filter((i) => i.value !== 0)
    .sort((a, b) => Math.abs(b.value) - Math.abs(a.value));
  const body = rows.map((i) => {
    const pct = snap.captacoes > 0 ? (i.value / snap.captacoes) * 100 : null;
    const tax = i.taxEligible === true ? 'Eligible PF'
      : i.taxEligible === 'partial' ? 'Partial / holder-dependent'
      : '—';
    return `<tr>
      <td><span class="fa-swatch" style="background:${BR_FUNDING_COLORS[i.key] || '#64748b'}"></span>${esc(i.label)}</td>
      <td class="r">${fmtKPI(i.value)}</td>
      <td class="r">${fmtPct(pct)}</td>
      <td>${esc(tax)}</td>
    </tr>`;
  }).join('');
  return `<table class="data fa-table">
    <thead><tr><th>Instrument</th><th class="r">Stock</th><th class="r">% funding</th><th>Tax treatment</th></tr></thead>
    <tbody>${body || '<tr><td colspan="4">No funding stocks for this period</td></tr>'}</tbody>
  </table>`;
}

function drawMixChart(code) {
  const canvas = document.getElementById('faMixChart');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const dpr = window.devicePixelRatio || 1;
  const cssW = canvas.clientWidth || 720;
  const cssH = 320;
  canvas.width = Math.floor(cssW * dpr);
  canvas.height = Math.floor(cssH * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, cssW, cssH);

  const bankRows = rowsForBank(code);
  const periodos = state.periodos;
  const series = BR_FUNDING_INSTRUMENTS.map((inst) => ({
    ...inst,
    values: brSeries(bankRows, inst.codes, periodos),
  }));
  const totals = periodos.map((_, i) => series.reduce((s, g) => s + (g.values[i] || 0), 0));
  const maxV = Math.max(1, ...totals);
  const pad = { t: 28, r: 16, b: 48, l: 64 };
  const plotW = cssW - pad.l - pad.r;
  const plotH = cssH - pad.t - pad.b;
  const n = Math.max(1, periodos.length);
  const barW = Math.min(28, (plotW / n) * 0.62);

  // grid
  ctx.strokeStyle = 'rgba(148,163,184,0.25)';
  ctx.fillStyle = '#94a3b8';
  ctx.font = '11px ui-monospace, SFMono-Regular, Menlo, monospace';
  ctx.textAlign = 'right';
  for (let i = 0; i <= 4; i++) {
    const y = pad.t + (plotH * i) / 4;
    ctx.beginPath();
    ctx.moveTo(pad.l, y);
    ctx.lineTo(pad.l + plotW, y);
    ctx.stroke();
    const tick = maxV * (1 - i / 4);
    ctx.fillText(fmtKPI(tick), pad.l - 8, y + 4);
  }

  periodos.forEach((p, i) => {
    const cx = pad.l + (i + 0.5) * (plotW / n);
    const x = cx - barW / 2;
    let y = pad.t + plotH;
    series.forEach((g) => {
      const v = Math.max(0, g.values[i] || 0);
      if (!v) return;
      const h = (v / maxV) * plotH;
      y -= h;
      ctx.fillStyle = BR_FUNDING_COLORS[g.key] || '#64748b';
      ctx.fillRect(x, y, barW, Math.max(1, h));
    });
    ctx.fillStyle = '#64748b';
    ctx.font = '10px Inter, "DM Sans", system-ui, sans-serif';
    ctx.textAlign = 'center';
    const label = String(p).length >= 6
      ? `${String(p).slice(4, 6)}/${String(p).slice(2, 4)}`
      : p;
    ctx.fillText(label, cx, cssH - 28);
  });

  ctx.fillStyle = '#475569';
  ctx.font = '600 12px Inter, "DM Sans", system-ui, sans-serif';
  ctx.textAlign = 'left';
  ctx.fillText('Funding mix · stacked stock (local currency)', pad.l, 16);
}

function drawTaxChart(code) {
  const canvas = document.getElementById('faTaxChart');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const dpr = window.devicePixelRatio || 1;
  const cssW = canvas.clientWidth || 720;
  const cssH = 280;
  canvas.width = Math.floor(cssW * dpr);
  canvas.height = Math.floor(cssH * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, cssW, cssH);

  const bankRows = rowsForBank(code);
  const periodos = state.periodos;
  const eligible = brSeries(bankRows, BR_TAX_ELIGIBLE_CODES, periodos);
  const captacoes = brSeries(bankRows, BR_KPI.captacoes, periodos);
  const lci = brSeries(bankRows, BR_KPI.lci, periodos);
  const lca = brSeries(bankRows, BR_KPI.lca, periodos);
  const maxV = Math.max(1, ...eligible, ...captacoes.map((c, i) => c - eligible[i]));
  const pad = { t: 28, r: 16, b: 48, l: 64 };
  const plotW = cssW - pad.l - pad.r;
  const plotH = cssH - pad.t - pad.b;
  const n = Math.max(1, periodos.length);
  const barW = Math.min(26, (plotW / n) * 0.55);

  ctx.strokeStyle = 'rgba(148,163,184,0.25)';
  for (let i = 0; i <= 4; i++) {
    const y = pad.t + (plotH * i) / 4;
    ctx.beginPath();
    ctx.moveTo(pad.l, y);
    ctx.lineTo(pad.l + plotW, y);
    ctx.stroke();
  }

  periodos.forEach((p, i) => {
    const cx = pad.l + (i + 0.5) * (plotW / n);
    const x = cx - barW / 2;
    const el = Math.max(0, eligible[i] || 0);
    const rest = Math.max(0, (captacoes[i] || 0) - el);
    const hEl = (el / maxV) * plotH;
    const hRest = (rest / maxV) * plotH;
    const yRest = pad.t + plotH - hRest;
    const yEl = yRest - hEl;
    ctx.fillStyle = 'rgba(100,116,139,0.35)';
    ctx.fillRect(x, yRest, barW, Math.max(1, hRest));
    ctx.fillStyle = BR_FUNDING_COLORS.taxEligible;
    ctx.fillRect(x, yEl, barW, Math.max(1, hEl));
    ctx.fillStyle = '#64748b';
    ctx.font = '10px Inter, "DM Sans", system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(`${String(p).slice(4, 6)}/${String(p).slice(2, 4)}`, cx, cssH - 28);
  });

  // tiny legend line
  ctx.fillStyle = '#475569';
  ctx.font = '600 12px Inter, "DM Sans", system-ui, sans-serif';
  ctx.textAlign = 'left';
  ctx.fillText('Green = LCA+LCI eligible stock · grey = other captações', pad.l, 16);

  // expose latest split in subtitle via DOM
  const sub = document.getElementById('faTaxSub');
  if (sub) {
    const i = periodos.length - 1;
    sub.textContent = `Latest: LCI ${fmtKPI(lci[i])} · LCA ${fmtKPI(lca[i])} · eligible ${fmtKPI(eligible[i])} (${fmtPct(captacoes[i] ? (eligible[i] / captacoes[i]) * 100 : null)} of funding)`;
  }
}

function drawCostChart(code) {
  const canvas = document.getElementById('faCostChart');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const dpr = window.devicePixelRatio || 1;
  const cssW = canvas.clientWidth || 720;
  const cssH = 260;
  canvas.width = Math.floor(cssW * dpr);
  canvas.height = Math.floor(cssH * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, cssW, cssH);

  const bankRows = rowsForBank(code);
  const periodos = state.periodos;
  const despByP = {};
  periodos.forEach((p) => {
    despByP[p] = brSum(bankRows, BR_KPI.despesasCaptacao, p);
  });
  // Approximate quarterly expense / average funding stock → annualized proxy
  const costs = periodos.map((p, i) => {
    const qExp = brResultReset(despByP, p, 'quarter');
    if (qExp == null || !Number.isFinite(qExp)) return null;
    const stock = brSum(bankRows, BR_KPI.captacoes, p);
    const prev = i > 0 ? brSum(bankRows, BR_KPI.captacoes, periodos[i - 1]) : stock;
    const avg = (stock + prev) / 2;
    if (!(avg > 0)) return null;
    return (qExp * 4 / avg) * 100; // annualized %
  });
  const vals = costs.filter((v) => v != null && Number.isFinite(v));
  if (!vals.length) {
    ctx.fillStyle = '#94a3b8';
    ctx.font = '13px Inter, system-ui, sans-serif';
    ctx.fillText('Insufficient data to estimate funding cost for this range.', 24, 40);
    return;
  }
  const maxV = Math.max(1, ...vals.map((v) => Math.abs(v))) * 1.15;
  const pad = { t: 28, r: 16, b: 48, l: 48 };
  const plotW = cssW - pad.l - pad.r;
  const plotH = cssH - pad.t - pad.b;
  const n = Math.max(1, periodos.length);

  ctx.strokeStyle = 'rgba(148,163,184,0.25)';
  for (let i = 0; i <= 4; i++) {
    const y = pad.t + (plotH * i) / 4;
    ctx.beginPath();
    ctx.moveTo(pad.l, y);
    ctx.lineTo(pad.l + plotW, y);
    ctx.stroke();
  }

  ctx.beginPath();
  let started = false;
  costs.forEach((v, i) => {
    if (v == null || !Number.isFinite(v)) { started = false; return; }
    const x = pad.l + (i + 0.5) * (plotW / n);
    const y = pad.t + plotH - (Math.max(0, v) / maxV) * plotH;
    if (!started) { ctx.moveTo(x, y); started = true; }
    else ctx.lineTo(x, y);
  });
  ctx.strokeStyle = btgBlue();
  ctx.lineWidth = 2;
  ctx.stroke();

  costs.forEach((v, i) => {
    if (v == null || !Number.isFinite(v)) return;
    const x = pad.l + (i + 0.5) * (plotW / n);
    const y = pad.t + plotH - (Math.max(0, v) / maxV) * plotH;
    ctx.fillStyle = btgBlue();
    ctx.beginPath();
    ctx.arc(x, y, 3.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#64748b';
    ctx.font = '10px Inter, system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(`${String(periodos[i]).slice(4, 6)}/${String(periodos[i]).slice(2, 4)}`, x, cssH - 28);
  });

  ctx.fillStyle = '#475569';
  ctx.font = '600 12px Inter, system-ui, sans-serif';
  ctx.textAlign = 'left';
  ctx.fillText('Implied funding cost proxy (annualized % of avg stock)', pad.l, 16);
}

function setMetric(m) {
  state.metric = m;
  render();
}

function setBank(code) {
  state.lastBank = Number(code);
  render();
}

function render() {
  const root = document.getElementById('fundingAnalyticsRoot');
  if (!root) return;

  if (datasetIsoCountry() !== 'BR') {
    root.innerHTML = `<div class="fa-empty">
      <div class="fa-empty-title">Funding Analytics</div>
      <div class="fa-empty-sub">Available when Brazil is selected. Switch country to Brasil to explore LCA, LCI, LF and deposit funding mix.</div>
    </div>`;
    return;
  }

  if (state.loading) {
    root.innerHTML = `<div class="fa-empty"><div class="ls-bars" aria-hidden="true"><div></div><div></div><div></div><div></div><div></div></div>
      <div class="fa-empty-sub" style="margin-top:16px;">Loading Brazil funding stocks…</div></div>`;
    return;
  }

  if (state.error && !state.loaded) {
    root.innerHTML = `<div class="fa-empty">
      <div class="fa-empty-title" style="color:var(--red);">${esc(state.error)}</div>
      <button type="button" class="rcbtn" id="faRetry" style="margin-top:12px;">Retry</button>
    </div>`;
    document.getElementById('faRetry')?.addEventListener('click', () => loadFundingData());
    return;
  }

  if (!state.loaded) {
    root.innerHTML = `<div class="fa-empty">
      <div class="fa-empty-title">Funding Analytics</div>
      <div class="fa-empty-sub">ALM / Treasury view of Brazil bank liabilities: deposits, LCI, LCA, LF, repos and on-lending.</div>
      <button type="button" class="rcbtn active" id="faLoad" style="margin-top:14px;">Load funding data</button>
    </div>`;
    document.getElementById('faLoad')?.addEventListener('click', () => loadFundingData());
    return;
  }

  const code = state.lastBank || state.banks[0];
  const snap = latestSnapshot(code);
  const bankTabs = state.banks.map((b) => {
    const on = Number(b) === Number(code);
    return `<button type="button" class="rcbtn ${on ? 'active' : ''}" data-fa-bank="${b}">${esc(bankName(b))}</button>`;
  }).join('');

  const metricBtns = [
    { key: 'mix', label: 'Funding mix' },
    { key: 'tax', label: 'Tax-advantaged eligible' },
    { key: 'cost', label: 'Cost proxy' },
  ].map((m) => `<button type="button" class="rcbtn ${state.metric === m.key ? 'active' : ''}" data-fa-metric="${m.key}">${m.label}</button>`).join('');

  root.innerHTML = `
    <div class="fa-hero">
      <div>
        <div class="fa-eyebrow">Brazil · ALM / Treasury</div>
        <div class="fa-title">Funding Analytics</div>
        <div class="fa-sub">Instrument stocks from Bacen IF.data (Cosif). Tax-advantaged = LCA + LCI eligible for PF IR relief — not CRA/CRI (securitization vehicles).</div>
      </div>
      <button type="button" class="rcbtn" id="faReload">Refresh</button>
    </div>

    <div class="fa-toolbar">
      <div class="fa-bank-tabs">${bankTabs}</div>
      <div class="fa-metric-tabs">${metricBtns}</div>
    </div>

    ${renderKpis(snap)}

    <div class="panel fa-panel" style="margin-top:22px;">
      <div class="panel-head">
        <div>
          <div class="panel-title">${state.metric === 'mix' ? 'Funding mix over time' : state.metric === 'tax' ? 'Tax-advantaged eligible stock' : 'Implied funding cost'}</div>
          <div class="panel-sub" id="faTaxSub">${esc(bankName(code))} · ${esc(periodLabel(state.periodos[0]))} — ${esc(periodLabel(state.periodos[state.periodos.length - 1]))}</div>
        </div>
      </div>
      <div class="panel-body">
        <div class="chart-wrap" style="position:relative;min-height:280px;">
          <canvas id="${state.metric === 'mix' ? 'faMixChart' : state.metric === 'tax' ? 'faTaxChart' : 'faCostChart'}" height="300" style="width:100%;height:300px;"></canvas>
        </div>
      </div>
    </div>

    <div class="panel fa-panel" style="margin-top:18px;">
      <div class="panel-head">
        <div>
          <div class="panel-title">Instrument breakdown · ${esc(periodLabel(snap.periodo))}</div>
          <div class="panel-sub">Share of Captações · local reporting units</div>
        </div>
      </div>
      <div class="panel-body" style="overflow-x:auto;padding:0;">${renderInstrumentTable(snap)}</div>
    </div>

    <ul class="fa-notes">
      <li><strong>Eligible ≠ exempt:</strong> Cosif reports the instrument issued (LCA/LCI), not whether the holder is a tax-exempt individual.</li>
      <li><strong>CRA / CRI</strong> are liabilities of securitizadoras, not of the bank — excluded from this funding stack.</li>
      <li><strong>CDB/RDB</strong> sit inside Depósitos a Prazo; IF.data does not split them publicly.</li>
      <li><strong>Cost proxy</strong> uses quarterly Despesas de Captação / average Captações, annualized — accounting cost, not contractual coupon.</li>
      <li>History uses Cosif legacy codes through Dec-2024 and new codes from Mar-2025.</li>
    </ul>
  `;

  document.getElementById('faReload')?.addEventListener('click', () => loadFundingData());
  document.querySelectorAll('[data-fa-bank]').forEach((btn) => {
    btn.addEventListener('click', () => setBank(btn.getAttribute('data-fa-bank')));
  });
  document.querySelectorAll('[data-fa-metric]').forEach((btn) => {
    btn.addEventListener('click', () => setMetric(btn.getAttribute('data-fa-metric')));
  });

  requestAnimationFrame(() => {
    if (state.metric === 'mix') drawMixChart(code);
    else if (state.metric === 'tax') drawTaxChart(code);
    else drawCostChart(code);
  });
}

export function renderFundingAnalytics() {
  if (datasetIsoCountry() !== 'BR') {
    state.loaded = false;
    render();
    return;
  }
  // Auto-load when entering the tab if banks are selected.
  if (!state.loaded && !state.loading && selectedBanks().length) {
    loadFundingData();
  } else {
    render();
  }
}
