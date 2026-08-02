// ============================================================
// Americas Monitor — cross-country bank comparison in USD
// ============================================================
// Keep API_BASE inline (do not import config.js) so this page never
// inherits a stale module graph that pointed at localhost during local tests.
const _h = window.location.hostname;
const API_BASE = (_h === 'localhost' || _h === '127.0.0.1') ? 'http://localhost:3000' : '';
const CHART_COLORS = ['#38bdf8', '#f59e0b', '#f87171', '#a78bfa', '#fb923c', '#34d399'];

const METRIC_LABELS = {
  equity: 'Equity',
  assets: 'Total assets',
  loans: 'Loans',
  deposits: 'Deposits / funding',
  net_income: 'Net income',
};

const MAX_SELECT = 6;
const state = {
  rows: [],
  rates: { USD: 1 },
  fxMeta: null,
  metric: 'equity',
  q: '',
  selected: new Set(), // `${iso}:${code}`
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

function bankKey(row) {
  return `${row.iso}:${row.code}`;
}

function toUsd(amountLocal, currency) {
  const ccy = String(currency || 'USD').toUpperCase();
  const rate = state.rates[ccy];
  if (!(rate > 0)) return null;
  return Number(amountLocal) / rate;
}

async function fetchFxRates(currencies) {
  const need = [...new Set(currencies.map((c) => String(c).toUpperCase()))].filter((c) => c && c !== 'USD');
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
    console.warn('FX primary failed', e);
    const r = await fetch('https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@latest/v1/currencies/usd.min.json', { cache: 'no-store' });
    const j = await r.json();
    for (const c of need) {
      const v = j?.usd?.[c.toLowerCase()];
      if (v > 0) rates[c] = v;
    }
    state.fxMeta = { source: 'currency-api', date: j?.date || new Date().toISOString().slice(0, 10) };
  }
  state.rates = rates;
}

async function loadSnapshot() {
  const status = document.getElementById('amStatus');
  status.textContent = 'Loading supervisory snapshots…';
  const r = await fetch(`${API_BASE}/api/americas/snapshot?top=20`, { cache: 'no-store' });
  const j = await r.json();
  if (!r.ok || !j.ok) throw new Error(j.error || `HTTP ${r.status}`);

  const currencies = j.countries.map((c) => c.currency);
  await fetchFxRates(currencies);

  const rows = [];
  for (const c of j.countries) {
    for (const b of c.banks || []) {
      const usd = {};
      for (const mk of Object.keys(METRIC_LABELS)) {
        usd[mk] = toUsd(b.metrics?.[mk], c.currency);
      }
      rows.push({
        iso: c.iso,
        countryKey: c.key,
        country: c.name,
        currency: c.currency,
        period: c.period,
        code: b.code,
        name: b.name,
        local: b.metrics || {},
        usd,
      });
    }
  }
  state.rows = rows;
  state.notes = j.notes || [];
  status.textContent = `${rows.length} banks · ${j.countries.length} countries · FX ${state.fxMeta?.date || '—'} (${state.fxMeta?.source || '—'})`;
  render();
}

function filteredSorted() {
  const q = state.q.trim().toLowerCase();
  let list = state.rows.slice();
  if (q) {
    list = list.filter((r) =>
      r.name.toLowerCase().includes(q)
      || r.country.toLowerCase().includes(q)
      || r.iso.toLowerCase().includes(q)
      || String(r.code).includes(q));
  }
  list.sort((a, b) => (b.usd[state.metric] ?? -Infinity) - (a.usd[state.metric] ?? -Infinity));
  return list;
}

function toggleSelect(key) {
  if (state.selected.has(key)) state.selected.delete(key);
  else {
    if (state.selected.size >= MAX_SELECT) return;
    state.selected.add(key);
  }
  render();
}

function renderTable(list) {
  const body = document.getElementById('amTableBody');
  body.innerHTML = list.map((r, i) => {
    const key = bankKey(r);
    const checked = state.selected.has(key);
    const disabled = !checked && state.selected.size >= MAX_SELECT;
    return `<tr class="${checked ? 'is-selected' : ''}">
      <td class="am-col-check">
        <input type="checkbox" ${checked ? 'checked' : ''} ${disabled ? 'disabled' : ''}
          data-key="${esc(key)}" aria-label="Compare ${esc(r.name)}" />
      </td>
      <td class="am-col-rank">${i + 1}</td>
      <td>
        <div class="am-bank">${esc(r.name)}</div>
        <div class="am-bank-meta">${esc(r.country)} · ${esc(r.period)} · ${esc(r.currency)}</div>
      </td>
      <td class="am-num">${fmtUsd(r.usd.equity)}</td>
      <td class="am-num">${fmtUsd(r.usd.assets)}</td>
      <td class="am-num">${fmtUsd(r.usd.loans)}</td>
      <td class="am-num">${fmtUsd(r.usd.deposits)}</td>
      <td class="am-num">${fmtUsd(r.usd.net_income)}</td>
      <td class="am-col-link"><a href="./dashboard.html?country=${esc(r.countryKey)}" target="_blank" rel="noopener">Country ↗</a></td>
    </tr>`;
  }).join('') || `<tr><td colspan="9" class="am-empty">No banks match this filter.</td></tr>`;

  body.querySelectorAll('input[type=checkbox][data-key]').forEach((el) => {
    el.addEventListener('change', () => toggleSelect(el.getAttribute('data-key')));
  });
}

function renderChart() {
  const canvas = document.getElementById('amChart');
  const empty = document.getElementById('amChartEmpty');
  const ctx = canvas.getContext('2d');
  const dpr = window.devicePixelRatio || 1;
  const cssW = canvas.clientWidth || 640;
  const cssH = canvas.clientHeight || 280;
  canvas.width = Math.floor(cssW * dpr);
  canvas.height = Math.floor(cssH * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, cssW, cssH);

  const selected = state.rows.filter((r) => state.selected.has(bankKey(r)));
  if (!selected.length) {
    empty.style.display = 'block';
    return;
  }
  empty.style.display = 'none';

  const metrics = ['equity', 'assets', 'loans', 'deposits', 'net_income'];
  const pad = { t: 24, r: 16, b: 56, l: 56 };
  const plotW = cssW - pad.l - pad.r;
  const plotH = cssH - pad.t - pad.b;
  const groupW = plotW / metrics.length;
  const barW = Math.min(18, (groupW * 0.7) / selected.length);
  const maxV = Math.max(
    1,
    ...selected.flatMap((r) => metrics.map((m) => Math.abs(r.usd[m] || 0))),
  );

  ctx.strokeStyle = 'rgba(148,163,184,0.25)';
  ctx.lineWidth = 1;
  for (let i = 0; i <= 4; i++) {
    const y = pad.t + (plotH * i) / 4;
    ctx.beginPath();
    ctx.moveTo(pad.l, y);
    ctx.lineTo(pad.l + plotW, y);
    ctx.stroke();
    ctx.fillStyle = 'rgba(148,163,184,0.85)';
    ctx.font = '11px ui-monospace, SFMono-Regular, Menlo, monospace';
    ctx.textAlign = 'right';
    ctx.fillText(fmtUsd(maxV * (1 - i / 4)), pad.l - 8, y + 4);
  }

  metrics.forEach((m, mi) => {
    const gx = pad.l + mi * groupW + groupW / 2;
    selected.forEach((r, bi) => {
      const v = r.usd[m] || 0;
      const h = (Math.abs(v) / maxV) * plotH;
      const x = gx - (selected.length * barW) / 2 + bi * barW;
      const y = pad.t + plotH - h;
      ctx.fillStyle = CHART_COLORS[bi % CHART_COLORS.length];
      ctx.fillRect(x, y, Math.max(2, barW - 2), h);
    });
    ctx.fillStyle = 'rgba(226,232,240,0.9)';
    ctx.font = '11px "Plus Jakarta Sans", system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(METRIC_LABELS[m], gx, cssH - 28);
  });

  // legend
  selected.forEach((r, bi) => {
    const x = pad.l + bi * 140;
    ctx.fillStyle = CHART_COLORS[bi % CHART_COLORS.length];
    ctx.fillRect(x, cssH - 14, 10, 10);
    ctx.fillStyle = 'rgba(226,232,240,0.9)';
    ctx.font = '10px "Plus Jakarta Sans", system-ui, sans-serif';
    ctx.textAlign = 'left';
    const label = `${r.iso} · ${r.name}`.slice(0, 22);
    ctx.fillText(label, x + 14, cssH - 5);
  });
}

function renderNotes() {
  const el = document.getElementById('amNotes');
  const notes = state.notes || [];
  el.innerHTML = notes.map((n) => `<li>${esc(n)}</li>`).join('');
}

function render() {
  const list = filteredSorted();
  document.getElementById('amCount').textContent = `${list.length} shown · ${state.selected.size}/${MAX_SELECT} selected`;
  renderTable(list);
  renderChart();
  renderNotes();
}

function bindUi() {
  document.getElementById('amMetric').addEventListener('change', (e) => {
    state.metric = e.target.value;
    render();
  });
  document.getElementById('amSearch').addEventListener('input', (e) => {
    state.q = e.target.value || '';
    render();
  });
  document.getElementById('amClear').addEventListener('click', () => {
    state.selected.clear();
    render();
  });
  window.addEventListener('resize', () => renderChart());
}

async function init() {
  bindUi();
  try {
    await loadSnapshot();
  } catch (e) {
    document.getElementById('amStatus').textContent = `Failed to load: ${e.message}`;
    console.error(e);
  }
}

init();
