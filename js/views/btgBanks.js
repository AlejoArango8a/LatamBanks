// ============================================================
// BTG Banks — cross-country franchise comparison in USD
// Brasil / Chile / Colombia / Uruguay (HSBC) / USA
// ============================================================
import { API_BASE, BTG_LOGO_LIGHT_SRC, btgBlue } from '../config.js?v=bmon54';

const METRICS = [
  { key: 'equity', label: 'Equity', kind: 'money' },
  { key: 'assets', label: 'Total Assets', kind: 'money' },
  { key: 'net_income', label: 'Net Income', kind: 'money' },
  { key: 'loans', label: 'Total Loans', kind: 'money' },
  { key: 'liabilities', label: 'Total Liabilities', kind: 'money' },
  { key: 'demand_deposits', label: 'Demand Deposits', kind: 'money' },
  { key: 'time_deposits', label: 'Time Deposits', kind: 'money' },
  { key: 'bonds', label: 'Bonds', kind: 'money' },
  { key: 'loans_equity', label: 'Loans / Equity', kind: 'ratio' },
  { key: 'roe', label: 'Annual ROE', kind: 'pct' },
];

const BANK_COLORS = {
  BR: '#2563eb',
  CL: '#0d3b66',
  CO: '#1d4ed8',
  UY: '#db0011',
  US: '#062650',
};

const state = {
  loaded: false,
  loading: false,
  banks: [],
  rates: { USD: 1 },
  fxMeta: null,
  notes: [],
  metric: 'equity',
  error: null,
};

function esc(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function fmtUsd(n) {
  if (n == null || !Number.isFinite(n)) return '—';
  const abs = Math.abs(n);
  const sign = n < 0 ? '-' : '';
  if (abs >= 1e12) return `${sign}$${(abs / 1e12).toFixed(2)}T`;
  if (abs >= 1e9) return `${sign}$${(abs / 1e9).toFixed(2)}B`;
  if (abs >= 1e6) return `${sign}$${(abs / 1e6).toFixed(1)}M`;
  if (abs >= 1e3) return `${sign}$${(abs / 1e3).toFixed(0)}K`;
  return `${sign}$${abs.toFixed(0)}`;
}

function fmtRatio(n) {
  if (n == null || !Number.isFinite(n)) return '—';
  return `${n.toFixed(1)}x`;
}

function fmtPct(n) {
  if (n == null || !Number.isFinite(n)) return '—';
  return `${n.toFixed(2)}%`;
}

function fmtMetric(kind, n) {
  if (kind === 'ratio') return fmtRatio(n);
  if (kind === 'pct') return fmtPct(n);
  return fmtUsd(n);
}

function periodLabel(p) {
  const s = String(p || '');
  if (s.length < 6) return s || '—';
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const m = Number(s.slice(4, 6));
  return `${months[m - 1] || s.slice(4, 6)} ${s.slice(0, 4)}`;
}

function toUsd(amountLocal, currency) {
  if (amountLocal == null || !Number.isFinite(Number(amountLocal))) return null;
  const ccy = String(currency || 'USD').toUpperCase();
  const rate = state.rates[ccy];
  if (!(rate > 0)) return null;
  return Number(amountLocal) / rate;
}

function annualRoe(netIncomeLocal, equityLocal, period) {
  if (!(equityLocal > 0) || netIncomeLocal == null || !Number.isFinite(Number(netIncomeLocal))) return null;
  const month = Number(String(period || '').slice(4, 6));
  if (!(month >= 1 && month <= 12)) return null;
  const annualized = Number(netIncomeLocal) * (12 / month);
  return (annualized / equityLocal) * 100;
}

async function fetchFxRates(currencies) {
  const need = [...new Set(currencies.map((c) => String(c).toUpperCase()))]
    .filter((c) => c && c !== 'USD');
  const rates = { USD: 1 };
  if (!need.length) {
    state.rates = rates;
    state.fxMeta = { source: 'native', date: new Date().toISOString().slice(0, 10) };
    return;
  }
  try {
    const r = await fetch('https://open.er-api.com/v6/latest/USD', { cache: 'no-store' });
    const j = await r.json();
    if (j?.result !== 'success' || !j.rates) throw new Error('er-api failed');
    for (const c of need) {
      if (j.rates[c] > 0) rates[c] = j.rates[c];
    }
    state.fxMeta = {
      source: 'open.er-api.com',
      date: j.time_last_update_unix
        ? new Date(j.time_last_update_unix * 1000).toISOString().slice(0, 10)
        : new Date().toISOString().slice(0, 10),
    };
  } catch (e) {
    console.warn('[btgBanks] FX primary failed', e);
    const r = await fetch(
      'https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@latest/v1/currencies/usd.min.json',
      { cache: 'no-store' },
    );
    const j = await r.json();
    for (const c of need) {
      const v = j?.usd?.[c.toLowerCase()];
      if (v > 0) rates[c] = v;
    }
    state.fxMeta = {
      source: 'currency-api',
      date: j?.date || new Date().toISOString().slice(0, 10),
    };
  }
  state.rates = rates;
}

function enrichBank(raw) {
  const local = raw.metrics || {};
  const equityL = local.equity;
  const loansL = local.loans;
  const niL = local.net_income;
  const usd = {};
  for (const m of METRICS) {
    if (m.key === 'loans_equity') {
      usd.loans_equity = (equityL > 0 && loansL != null && Number.isFinite(Number(loansL)))
        ? Number(loansL) / Number(equityL)
        : null;
      continue;
    }
    if (m.key === 'roe') {
      usd.roe = annualRoe(niL, equityL, raw.period);
      continue;
    }
    usd[m.key] = toUsd(local[m.key], raw.currency);
  }
  return {
    ...raw,
    local,
    usd,
    color: BANK_COLORS[raw.iso] || btgBlue(),
  };
}

async function loadSnapshot(force = false) {
  if (state.loading) return;
  if (state.loaded && !force) {
    render();
    return;
  }
  state.loading = true;
  state.error = null;
  renderShellLoading();
  try {
    const r = await fetch(`${API_BASE}/api/btg-banks/snapshot`, { cache: 'no-store' });
    const j = await r.json();
    if (!r.ok || !j.ok) throw new Error(j.error || `HTTP ${r.status}`);
    await fetchFxRates((j.banks || []).map((b) => b.currency).filter(Boolean));
    state.banks = (j.banks || []).map(enrichBank);
    state.notes = j.notes || [];
    state.loaded = true;
  } catch (e) {
    console.error('[btgBanks]', e);
    state.error = String(e.message || e);
  } finally {
    state.loading = false;
    render();
  }
}

function renderShellLoading() {
  const root = document.getElementById('btgBanksRoot');
  if (!root) return;
  root.innerHTML = `<div class="btg-banks-status">Loading BTG franchise metrics…</div>`;
}

function setMetric(key) {
  state.metric = key;
  render();
}

function renderMetricButtons() {
  return METRICS.map((m) => {
    const on = state.metric === m.key;
    return `<button type="button" class="rcbtn ${on ? 'active' : ''}" data-btg-metric="${m.key}">${esc(m.label)}</button>`;
  }).join('');
}

function renderHighlightCards() {
  const m = METRICS.find((x) => x.key === state.metric) || METRICS[0];
  return state.banks.map((b) => {
    const val = b.usd[m.key];
    return `<div class="kpi-col">
      <div class="kpi-col-title">${esc(b.countryLabel)}</div>
      <div class="kpi blue" style="border-left:3px solid ${b.color};">
        <div class="kpi-val">${fmtMetric(m.kind, val)}</div>
        <div class="kpi-sub">${esc(b.shortName)} · ${esc(periodLabel(b.period))}</div>
      </div>
    </div>`;
  }).join('');
}

function renderTable() {
  const head = METRICS.map((m) => `<th class="r">${esc(m.label)}</th>`).join('');
  const rows = state.banks.map((b) => {
    const cells = METRICS.map((m) => `<td class="r">${fmtMetric(m.kind, b.usd[m.key])}</td>`).join('');
    return `<tr>
      <td>
        <div style="font-weight:600;color:var(--white);">${esc(b.shortName)}</div>
        <div style="font-size:10px;color:var(--text3);margin-top:2px;">${esc(b.countryLabel)} · ${esc(b.iso)} · ${esc(periodLabel(b.period))} · ${esc(b.currency || '—')}</div>
      </td>
      ${cells}
    </tr>`;
  }).join('');
  return `<table class="data">
    <thead><tr><th>Bank</th>${head}</tr></thead>
    <tbody>${rows || `<tr><td colspan="${METRICS.length + 1}">No data</td></tr>`}</tbody>
  </table>`;
}

function drawChart() {
  const canvas = document.getElementById('btgBanksChart');
  const empty = document.getElementById('btgBanksChartEmpty');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const dpr = window.devicePixelRatio || 1;
  const cssW = canvas.clientWidth || 720;
  const cssH = 300;
  canvas.width = Math.floor(cssW * dpr);
  canvas.height = Math.floor(cssH * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, cssW, cssH);

  const m = METRICS.find((x) => x.key === state.metric) || METRICS[0];
  const banks = state.banks.filter((b) => b.usd[m.key] != null && Number.isFinite(b.usd[m.key]));
  if (!banks.length) {
    if (empty) empty.style.display = 'block';
    return;
  }
  if (empty) empty.style.display = 'none';

  const pad = { t: 28, r: 20, b: 64, l: 64 };
  const plotW = cssW - pad.l - pad.r;
  const plotH = cssH - pad.t - pad.b;
  const maxV = Math.max(1, ...banks.map((b) => Math.abs(b.usd[m.key] || 0)));
  const barW = Math.min(56, (plotW / banks.length) * 0.55);

  // grid
  ctx.strokeStyle = 'rgba(148,163,184,0.28)';
  ctx.lineWidth = 1;
  for (let i = 0; i <= 4; i++) {
    const y = pad.t + (plotH * i) / 4;
    ctx.beginPath();
    ctx.moveTo(pad.l, y);
    ctx.lineTo(pad.l + plotW, y);
    ctx.stroke();
    ctx.fillStyle = 'var(--text3)';
    // canvas can't use CSS vars reliably — hardcode soft gray
    ctx.fillStyle = '#94a3b8';
    ctx.font = '11px ui-monospace, SFMono-Regular, Menlo, monospace';
    ctx.textAlign = 'right';
    const tick = maxV * (1 - i / 4);
    ctx.fillText(m.kind === 'pct' ? fmtPct(tick) : m.kind === 'ratio' ? fmtRatio(tick) : fmtUsd(tick), pad.l - 8, y + 4);
  }

  banks.forEach((b, i) => {
    const v = b.usd[m.key] || 0;
    const h = (Math.abs(v) / maxV) * plotH;
    const cx = pad.l + (i + 0.5) * (plotW / banks.length);
    const x = cx - barW / 2;
    const y = pad.t + plotH - h;
    ctx.fillStyle = b.color;
    ctx.fillRect(x, y, barW, Math.max(2, h));
    ctx.fillStyle = '#64748b';
    ctx.font = '11px Inter, "DM Sans", system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(b.countryLabel, cx, cssH - 36);
    ctx.fillStyle = '#0f172a';
    ctx.font = '600 11px Inter, "DM Sans", system-ui, sans-serif';
    ctx.fillText(fmtMetric(m.kind, v), cx, y - 8);
  });

  ctx.fillStyle = '#475569';
  ctx.font = '600 12px Inter, "DM Sans", system-ui, sans-serif';
  ctx.textAlign = 'left';
  ctx.fillText(`${m.label} · USD`, pad.l, 18);
}

function render() {
  const root = document.getElementById('btgBanksRoot');
  if (!root) return;

  if (state.loading && !state.loaded) {
    renderShellLoading();
    return;
  }
  if (state.error && !state.banks.length) {
    root.innerHTML = `<div class="btg-banks-status" style="color:var(--red);">${esc(state.error)}
      <button type="button" class="rcbtn" style="margin-left:10px;" id="btgBanksRetry">Retry</button></div>`;
    document.getElementById('btgBanksRetry')?.addEventListener('click', () => loadSnapshot(true));
    return;
  }

  const fxLine = state.fxMeta
    ? `FX ${esc(state.fxMeta.date || '—')} · ${esc(state.fxMeta.source || '—')}`
    : '';
  const m = METRICS.find((x) => x.key === state.metric) || METRICS[0];

  root.innerHTML = `
    <div class="btg-banks-hero">
      <img class="btg-banks-logo" src="${BTG_LOGO_LIGHT_SRC}" alt="BTG Pactual" />
      <div>
        <div class="btg-banks-eyebrow">ALM · Franchise compare</div>
        <div class="btg-banks-title">BTG Banks</div>
        <div class="btg-banks-sub">Brasil · Chile · Colombia · Uruguay (HSBC) · USA — Financial Highlights in USD</div>
      </div>
      <button type="button" class="rcbtn" id="btgBanksRefresh" style="margin-left:auto;">↻ Refresh</button>
    </div>

    <div class="res-section-head" style="display:flex;align-items:center;gap:8px;margin:8px 0 16px;padding-left:4px;">
      <span class="res-section-icon" style="display:inline-flex;align-items:center;justify-content:center;width:22px;height:22px;border-radius:5px;background:#001E62;flex-shrink:0;">
        <svg width="12" height="12" viewBox="0 0 18 18" fill="none" xmlns="http://www.w3.org/2000/svg">
          <rect x="1" y="10" width="4" height="7" rx="1" fill="white"/>
          <rect x="7" y="5" width="4" height="12" rx="1" fill="white"/>
          <rect x="13" y="1" width="4" height="16" rx="1" fill="white"/>
        </svg>
      </span>
      <span style="font-size:15px;font-weight:500;color:var(--white);">Financial highlights</span>
      <span style="font-size:11px;color:var(--text3);margin-left:8px;">${fxLine}</span>
    </div>

    <div class="kpi-grid" id="btgBanksKpis" style="margin-bottom:22px;">${renderHighlightCards()}</div>

    <div class="res-section-head" style="display:flex;align-items:center;gap:8px;margin:4px 0 16px;padding-left:4px;">
      <span class="res-section-icon" style="display:inline-flex;align-items:center;justify-content:center;width:22px;height:22px;border-radius:5px;background:#001E62;flex-shrink:0;">
        <svg width="12" height="12" viewBox="0 0 18 18" fill="none" xmlns="http://www.w3.org/2000/svg">
          <polyline points="1,13 5,8 9,10 13,5 17,2" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" fill="none"/>
          <polyline points="13,2 17,2 17,6" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" fill="none"/>
        </svg>
      </span>
      <span style="font-size:15px;font-weight:500;color:var(--white);">Historical evolution · cross-country</span>
    </div>

    <div class="panel">
      <div class="panel-head">
        <div>
          <div class="panel-title">${esc(m.label)} comparison</div>
          <div class="panel-sub">Latest supervisory period per country · converted to USD</div>
        </div>
      </div>
      <div class="panel-body">
        <div style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:14px;" id="btgMetricBtns">${renderMetricButtons()}</div>
        <div class="chart-wrap" style="position:relative;min-height:300px;">
          <canvas id="btgBanksChart" height="300" style="width:100%;height:300px;"></canvas>
          <div id="btgBanksChartEmpty" style="display:none;position:absolute;inset:0;display:none;align-items:center;justify-content:center;color:var(--text3);font-size:13px;">No values for this KPI</div>
        </div>
      </div>
    </div>

    <div class="panel" style="margin-top:12px;">
      <div class="panel-head">
        <div>
          <div class="panel-title">Comparison table · USD</div>
          <div class="panel-sub">All Financial Highlights KPIs</div>
        </div>
      </div>
      <div class="panel-body" style="overflow-x:auto;padding:0;" id="btgBanksTable">${renderTable()}</div>
    </div>

    <ul class="btg-banks-notes">${(state.notes || []).map((n) => `<li>${esc(n)}</li>`).join('')}</ul>
  `;

  document.getElementById('btgBanksRefresh')?.addEventListener('click', () => loadSnapshot(true));
  document.querySelectorAll('#btgMetricBtns [data-btg-metric]').forEach((btn) => {
    btn.addEventListener('click', () => setMetric(btn.getAttribute('data-btg-metric')));
  });
  requestAnimationFrame(() => drawChart());
}

/** Called when the BTG Banks tab becomes active. */
export function renderBtgBanks(force = false) {
  loadSnapshot(force);
}
