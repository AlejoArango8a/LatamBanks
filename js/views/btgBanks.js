// ============================================================
// BTG Banks — cross-country franchise comparison in USD
// Brasil / Chile / Colombia / Uruguay / USA / Luxembourg (Europe)
// ============================================================
import { API_BASE, BTG_LOGO_BLUE_SRC, btgBlue } from '../config.js?v=bmon65';

/**
 * Core KPIs for the franchise compare.
 * Time Deposits / Bonds intentionally omitted (CL/CO-only or misaligned).
 */
const METRICS = [
  { key: 'equity', label: 'Equity', kind: 'money' },
  { key: 'assets', label: 'Total Assets', kind: 'money' },
  { key: 'net_income', label: 'Net Income', kind: 'money' },
  { key: 'loans', label: 'Total Loans', kind: 'money' },
  { key: 'liabilities', label: 'Total Liabilities', kind: 'money' },
  { key: 'total_deposits', label: 'Total Deposits', kind: 'money' },
  { key: 'loans_equity', label: 'Loans / Equity', kind: 'ratio' },
  { key: 'roe', label: 'Annual ROE', kind: 'pct' },
];

/** Money KPIs subtracted when eliminating subsidiaries (ratios/ROE recomputed after). */
const MONEY_KEYS = METRICS.filter((m) => m.kind === 'money').map((m) => m.key);

/** Fallback ISO order when USD equity is missing (tie-break / nulls last). */
const BANK_ORDER = ['BR', 'CL', 'LU', 'US', 'CO', 'UY'];

function equitySortKey(b) {
  const eq = b?.usd?.equity;
  return eq != null && Number.isFinite(Number(eq)) ? Number(eq) : -Infinity;
}

/** KPIs, chart and table: largest equity (USD) first. */
function sortBanksByEquityDesc(banks) {
  const orderIdx = Object.fromEntries(BANK_ORDER.map((iso, i) => [iso, i]));
  return [...banks].sort((a, b) => {
    const d = equitySortKey(b) - equitySortKey(a);
    if (d !== 0) return d;
    return (orderIdx[a.iso] ?? 99) - (orderIdx[b.iso] ?? 99);
  });
}

const BANK_COLORS = {
  BR: '#2563eb',
  CL: '#0d3b66',
  CO: '#1d4ed8',
  UY: '#2563eb',
  US: '#062650',
  LU: '#0b3d91',
};

const state = {
  loaded: false,
  loading: false,
  refreshing: false,
  banks: [],
  rates: { USD: 1 },
  fxMeta: null,
  notes: [],
  metric: 'equity',
  error: null,
  cacheMeta: null,
  eliminateSubsidiaries: false,
};

const LOCAL_SNAPSHOT_KEY = 'btgBanksSnapshot_v1';
const LOCAL_FX_KEY = 'btgBanksFx_v1';
const LOCAL_ELIM_KEY = 'btgBanksElimSubs_v1';

function readElimPreference() {
  try {
    return localStorage.getItem(LOCAL_ELIM_KEY) === '1';
  } catch {
    return false;
  }
}

function writeElimPreference(on) {
  try {
    localStorage.setItem(LOCAL_ELIM_KEY, on ? '1' : '0');
  } catch { /* ignore */ }
}

state.eliminateSubsidiaries = readElimPreference();

/**
 * Societal tree (franchise reporting):
 * - All entities sit under BTG Brazil → BR − Σ(other banks) in USD
 * - Colombia sits under Chile → CL − CO in USD
 * Subsidiaries stay visible; only parent KPIs are de-consolidated.
 */
function applySubsidiaryElimination(banks) {
  if (!state.eliminateSubsidiaries || !banks.length) {
    return banks.map((b) => ({ ...b, elimNote: null }));
  }
  const byIso = Object.fromEntries(banks.map((b) => [b.iso, b]));
  const othersThanBr = banks.filter((b) => b.iso !== 'BR');

  return banks.map((b) => {
    if (b.iso !== 'BR' && b.iso !== 'CL') return { ...b, elimNote: null };

    const usd = { ...b.usd };
    const deduct = (fromIsoList) => {
      for (const key of MONEY_KEYS) {
        const base = usd[key];
        if (base == null || !Number.isFinite(Number(base))) continue;
        let sub = 0;
        let hit = false;
        for (const iso of fromIsoList) {
          const v = byIso[iso]?.usd?.[key];
          if (v != null && Number.isFinite(Number(v))) {
            sub += Number(v);
            hit = true;
          }
        }
        if (hit) usd[key] = Number(base) - sub;
      }
    };

    let elimNote = null;
    if (b.iso === 'BR') {
      deduct(othersThanBr.map((o) => o.iso));
      elimNote = 'ex-subsidiaries';
    } else if (b.iso === 'CL') {
      deduct(['CO']);
      elimNote = 'ex-Colombia';
    }

    const equityU = usd.equity;
    const loansU = usd.loans;
    usd.loans_equity = (equityU > 0 && loansU != null && Number.isFinite(Number(loansU)))
      ? Number(loansU) / Number(equityU)
      : null;
    // Ratio is FX-invariant; USD amounts work the same as local for ROE.
    usd.roe = annualRoe(usd.net_income, usd.equity, b.period);

    return { ...b, usd, elimNote };
  });
}

function displayBanks() {
  return sortBanksByEquityDesc(applySubsidiaryElimination(state.banks));
}

function readLocalSnapshot() {
  try {
    const raw = localStorage.getItem(LOCAL_SNAPSHOT_KEY);
    if (!raw) return null;
    const j = JSON.parse(raw);
    if (!Array.isArray(j?.banks) || !j.banks.length) return null;
    return j;
  } catch {
    return null;
  }
}

function writeLocalSnapshot(payload) {
  try {
    localStorage.setItem(LOCAL_SNAPSHOT_KEY, JSON.stringify({
      banks: payload.banks,
      notes: payload.notes || [],
      cachedAt: payload.cachedAt || payload.builtAt || new Date().toISOString(),
      savedAt: new Date().toISOString(),
    }));
  } catch { /* quota / private mode */ }
}

function readLocalFx() {
  try {
    const raw = localStorage.getItem(LOCAL_FX_KEY);
    if (!raw) return null;
    const j = JSON.parse(raw);
    if (!j?.rates || typeof j.rates !== 'object') return null;
    return j;
  } catch {
    return null;
  }
}

function writeLocalFx(rates, meta) {
  try {
    localStorage.setItem(LOCAL_FX_KEY, JSON.stringify({
      rates,
      fxMeta: meta,
      savedAt: new Date().toISOString(),
    }));
  } catch { /* ignore */ }
}

function applySnapshotPayload(j, { fromLocal = false } = {}) {
  const rawBanks = Array.isArray(j.banks) ? j.banks : [];
  const enriched = rawBanks.map((b) => enrichBank(b));
  state.banks = sortBanksByEquityDesc(enriched);
  state.notes = Array.isArray(j.notes) ? j.notes : [];
  state.loaded = state.banks.length > 0;
  state.cacheMeta = {
    fromLocal,
    cached: !!j.cached || fromLocal,
    stale: !!j.stale,
    refreshing: !!j.refreshing || state.refreshing,
    cachedAt: j.cachedAt || j.builtAt || null,
  };
  if (!fromLocal && state.banks.length) writeLocalSnapshot(j);
}

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

/** Same asset as Bank Monitor banner (`bankHeaderLogo` → logo-btg.png). */
function btgHeroLogoSrc() {
  return BTG_LOGO_BLUE_SRC;
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
    writeLocalFx(rates, state.fxMeta);
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
  writeLocalFx(rates, state.fxMeta);
}

function fmtAumLine(b) {
  const aum = b?.extras?.aum;
  if (aum == null || !Number.isFinite(Number(aum))) return '';
  const usd = toUsd(aum, b.currency);
  return usd != null ? `AuM ${fmtUsd(usd)}` : 'AuM —';
}

function enrichBank(raw) {
  const local = raw.metrics || {};
  const usd = {};
  const equityL = local.equity;
  const loansL = local.loans;
  for (const m of METRICS) {
    if (m.key === 'loans_equity') {
      usd.loans_equity = (equityL > 0 && loansL != null && Number.isFinite(Number(loansL)))
        ? Number(loansL) / Number(equityL)
        : null;
    } else if (m.key === 'roe') {
      const niL = local.net_income;
      usd.roe = annualRoe(niL, equityL, raw.period);
    } else {
      usd[m.key] = toUsd(local[m.key], raw.currency);
    }
  }
  return {
    ...raw,
    local,
    usd,
    extras: raw.extras || {},
    color: BANK_COLORS[raw.iso] || btgBlue(),
  };
}

async function loadSnapshot(force = false) {
  if (state.loading) return;
  if (state.loaded && !force && !state.refreshing) {
    render();
    return;
  }

  // Paint last-known snapshot immediately (local), then refresh from API/DB cache.
  const local = !force ? readLocalSnapshot() : null;
  const localFx = readLocalFx();
  if (localFx?.rates) {
    state.rates = { USD: 1, ...localFx.rates };
    state.fxMeta = localFx.fxMeta || state.fxMeta;
  }
  if (local?.banks?.length) {
    applySnapshotPayload(local, { fromLocal: true });
    state.refreshing = true;
    state.loading = false;
    state.error = null;
    render();
  } else {
    state.loading = true;
    state.error = null;
    renderShellLoading();
  }

  let keepRefreshing = false;
  try {
    const url = force
      ? `${API_BASE}/api/btg-banks/snapshot?rebuild=1`
      : `${API_BASE}/api/btg-banks/snapshot`;
    const r = await fetch(url, { cache: 'no-store' });
    const j = await r.json();
    if (!r.ok || !j.ok) throw new Error(j.error || `HTTP ${r.status}`);
    const currencies = (j.banks || []).map((b) => b.currency).filter(Boolean);
    await fetchFxRates(currencies);
    applySnapshotPayload(j, { fromLocal: false });
    state.error = null;

    // If server served a stale/old cache, kick a background rebuild once.
    if (!force && (j.stale || j.refreshing)) {
      keepRefreshing = true;
      state.refreshing = true;
      fetch(`${API_BASE}/api/btg-banks/snapshot?rebuild=1`, { cache: 'no-store' })
        .then((rr) => rr.json())
        .then(async (jj) => {
          if (!jj?.ok || !Array.isArray(jj.banks)) return;
          await fetchFxRates(jj.banks.map((b) => b.currency).filter(Boolean));
          applySnapshotPayload(jj, { fromLocal: false });
        })
        .catch((e) => console.warn('[btgBanks] background rebuild failed', e))
        .finally(() => {
          state.refreshing = false;
          render();
        });
    }
  } catch (e) {
    console.error('[btgBanks]', e);
    if (!state.banks.length) {
      state.error = String(e.message || e);
      state.banks = [];
    }
  } finally {
    state.loading = false;
    if (!keepRefreshing) state.refreshing = false;
    render();
  }
}

function renderShellLoading() {
  const root = document.getElementById('btgBanksRoot');
  if (!root) return;
  const msgs = [
    'Loading franchise snapshot…',
    'Fetching supervisory KPIs…',
    'Converting to USD…',
  ];
  root.innerHTML = `
    <div class="btg-banks-loading">
      <div class="ls-bars" aria-hidden="true"><div></div><div></div><div></div><div></div><div></div></div>
      <div class="ls-msg" id="btgBanksLoadMsg">${esc(msgs[0])}</div>
      <div class="btg-banks-load-sub">Comparing equity, assets, loans and funding across the franchise</div>
    </div>`;
  let i = 0;
  const t = setInterval(() => {
    const el = document.getElementById('btgBanksLoadMsg');
    if (!el) {
      clearInterval(t);
      return;
    }
    i = (i + 1) % msgs.length;
    el.textContent = msgs[i];
  }, 2800);
}

function setMetric(key) {
  if (!METRICS.some((m) => m.key === key)) return;
  state.metric = key;
  render();
}

function setEliminateSubsidiaries(on) {
  state.eliminateSubsidiaries = !!on;
  writeElimPreference(state.eliminateSubsidiaries);
  render();
}

function renderMetricButtons() {
  return METRICS.map((m) => {
    const on = state.metric === m.key;
    return `<button type="button" class="rcbtn ${on ? 'active' : ''}" data-btg-metric="${m.key}">${esc(m.label)}</button>`;
  }).join('');
}

function renderHighlightCards(banks) {
  const m = METRICS.find((x) => x.key === state.metric) || METRICS[0];
  return banks.map((b) => {
    const val = b.usd[m.key];
    const aum = fmtAumLine(b);
    const freq = b.frequency === 'annual' || b.source === 'manual_seed' ? ' · annual' : '';
    const elim = b.elimNote ? ` · ${b.elimNote}` : '';
    return `<div class="kpi-col">
      <div class="kpi-col-title">${esc(b.countryLabel)}</div>
      <div class="kpi blue" style="border-left:3px solid ${b.color};">
        <div class="kpi-label">${esc(m.label)}</div>
        <div class="kpi-val">${fmtMetric(m.kind, val)}</div>
        <div class="kpi-sub">${esc(b.shortName)} · ${esc(periodLabel(b.period))}${freq}${elim}${aum ? ` · ${esc(aum)}` : ''}</div>
      </div>
    </div>`;
  }).join('');
}

function renderTable(banks) {
  const head = METRICS.map((m) => `<th class="r">${esc(m.label)}</th>`).join('');
  const rows = banks.map((b) => {
    const cells = METRICS.map((m) => `<td class="r">${fmtMetric(m.kind, b.usd[m.key])}</td>`).join('');
    const aum = fmtAumLine(b);
    const freq = b.frequency === 'annual' || b.source === 'manual_seed' ? ' · annual seed' : '';
    const elim = b.elimNote ? ` · ${b.elimNote}` : '';
    return `<tr>
      <td>
        <div style="font-weight:600;color:var(--white);">${esc(b.shortName)}</div>
        <div style="font-size:10px;color:var(--text3);margin-top:2px;">${esc(b.countryLabel)} · ${esc(b.iso)} · ${esc(periodLabel(b.period))} · ${esc(b.currency || '—')}${freq}${elim}${aum ? ` · ${esc(aum)}` : ''}</div>
      </td>
      ${cells}
    </tr>`;
  }).join('');
  return `<table class="data">
    <thead><tr><th>Bank</th>${head}</tr></thead>
    <tbody>${rows || `<tr><td colspan="${METRICS.length + 1}">No data</td></tr>`}</tbody>
  </table>`;
}

function drawChart(banks) {
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
  const plotBanks = banks.filter((b) => b.usd[m.key] != null && Number.isFinite(b.usd[m.key]));
  if (!plotBanks.length) {
    if (empty) empty.style.display = 'block';
    return;
  }
  if (empty) empty.style.display = 'none';

  const pad = { t: 36, r: 20, b: 64, l: 68 };
  const plotW = cssW - pad.l - pad.r;
  const plotH = cssH - pad.t - pad.b;
  const rawMax = Math.max(1, ...plotBanks.map((b) => Math.abs(b.usd[m.key] || 0)));
  const niceCeil = (v) => {
    if (!(v > 0)) return 1;
    const padded = v * 1.22;
    const exp = Math.floor(Math.log10(padded));
    const base = 10 ** exp;
    const n = padded / base;
    const step = n <= 1.2 ? 1.2 : n <= 1.5 ? 1.5 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 3 ? 3 : n <= 4 ? 4 : n <= 5 ? 5 : n <= 6 ? 6 : n <= 8 ? 8 : 10;
    return step * base;
  };
  const maxV = niceCeil(rawMax);
  const barW = Math.min(56, (plotW / plotBanks.length) * 0.55);

  ctx.strokeStyle = 'rgba(148,163,184,0.28)';
  ctx.lineWidth = 1;
  for (let i = 0; i <= 4; i++) {
    const y = pad.t + (plotH * i) / 4;
    ctx.beginPath();
    ctx.moveTo(pad.l, y);
    ctx.lineTo(pad.l + plotW, y);
    ctx.stroke();
    ctx.fillStyle = '#94a3b8';
    ctx.font = '11px ui-monospace, SFMono-Regular, Menlo, monospace';
    ctx.textAlign = 'right';
    const tick = maxV * (1 - i / 4);
    ctx.fillText(m.kind === 'pct' ? fmtPct(tick) : m.kind === 'ratio' ? fmtRatio(tick) : fmtUsd(tick), pad.l - 8, y + 4);
  }

  plotBanks.forEach((b, i) => {
    const v = b.usd[m.key] || 0;
    const h = (Math.abs(v) / maxV) * plotH;
    const cx = pad.l + (i + 0.5) * (plotW / plotBanks.length);
    const x = cx - barW / 2;
    const y = pad.t + plotH - h;
    ctx.fillStyle = b.color;
    ctx.fillRect(x, y, barW, Math.max(2, h));
    ctx.fillStyle = '#64748b';
    ctx.font = '11px Inter, "DM Sans", system-ui, sans-serif';
    ctx.textAlign = 'center';
    const label = b.iso === 'US' ? 'USA' : b.countryLabel;
    ctx.fillText(label, cx, cssH - 36);
    ctx.fillStyle = '#0f172a';
    ctx.font = '600 11px Inter, "DM Sans", system-ui, sans-serif';
    ctx.fillText(fmtMetric(m.kind, v), cx, Math.max(14, y - 8));
  });

  ctx.fillStyle = '#475569';
  ctx.font = '600 12px Inter, "DM Sans", system-ui, sans-serif';
  ctx.textAlign = 'left';
  const elimTag = state.eliminateSubsidiaries ? ' · ex-subsidiaries' : '';
  ctx.fillText(`${m.label} · USD${elimTag}`, pad.l, 18);
}

function render() {
  const root = document.getElementById('btgBanksRoot');
  if (!root) return;

  if (state.loading) {
    renderShellLoading();
    return;
  }
  if (state.error && !state.banks.length) {
    root.innerHTML = `<div class="btg-banks-status" style="color:var(--red);">${esc(state.error)}
      <button type="button" class="rcbtn" style="margin-left:10px;" id="btgBanksRetry">Retry</button></div>`;
    document.getElementById('btgBanksRetry')?.addEventListener('click', () => loadSnapshot(true));
    return;
  }

  const banks = displayBanks();
  const fxLine = state.fxMeta
    ? `FX ${esc(state.fxMeta.date || '—')} · ${esc(state.fxMeta.source || '—')}`
    : '';
  const cacheBits = [];
  if (state.refreshing) cacheBits.push('Updating…');
  else if (state.cacheMeta?.cached) cacheBits.push(state.cacheMeta.stale ? 'Cached · refreshing' : 'Cached');
  if (state.cacheMeta?.cachedAt) {
    const d = String(state.cacheMeta.cachedAt).slice(0, 10);
    if (d) cacheBits.push(d);
  }
  const cacheLine = cacheBits.length ? cacheBits.join(' · ') : '';
  const m = METRICS.find((x) => x.key === state.metric) || METRICS[0];
  const elimOn = state.eliminateSubsidiaries;
  const elimHint = elimOn
    ? 'Brazil − other franchise banks; Chile − Colombia (USD). Subsidiaries remain listed.'
    : 'Optional: strip consolidated subsidiary amounts from parent KPIs.';

  root.innerHTML = `
    <div class="btg-banks-hero">
      <div class="btg-banks-hero-text">
        <div class="btg-banks-eyebrow">ALM · Franchise compare</div>
        <div class="btg-banks-title">BTG Banks</div>
        <div class="btg-banks-sub">Franchise compare · ordered by equity (USD) · Financial Highlights</div>
      </div>
      <div class="btg-banks-hero-logo">
        <img class="btg-banks-logo" src="${btgHeroLogoSrc()}" alt="BTG Pactual"
          onerror="this.onerror=null;this.src='${BTG_LOGO_BLUE_SRC}'" />
      </div>
    </div>

    <div class="btg-banks-section-head">
      <span class="res-section-icon btg-banks-section-icon">
        <svg width="12" height="12" viewBox="0 0 18 18" fill="none" xmlns="http://www.w3.org/2000/svg">
          <rect x="1" y="10" width="4" height="7" rx="1" fill="white"/>
          <rect x="7" y="5" width="4" height="12" rx="1" fill="white"/>
          <rect x="13" y="1" width="4" height="16" rx="1" fill="white"/>
        </svg>
      </span>
      <div class="btg-banks-section-copy">
        <div class="btg-banks-section-title">Financial highlights · ${esc(m.label)}</div>
        <div class="btg-banks-section-meta">${fxLine}${cacheLine ? ` · ${esc(cacheLine)}` : ''}${elimOn ? ' · Eliminate subsidiaries on' : ''}</div>
      </div>
    </div>

    <div class="btg-banks-toolbar">
      <div class="btg-banks-metric-row" id="btgMetricBtns">${renderMetricButtons()}</div>
      <label class="btg-banks-elim" title="${esc(elimHint)}">
        <input type="checkbox" id="btgElimSubs" ${elimOn ? 'checked' : ''} />
        <span class="btg-banks-elim-text">Eliminate subsidiaries</span>
      </label>
    </div>
    <div class="btg-banks-hint">Select a KPI — cards, chart and table stay ranked by equity (USD). ${esc(elimHint)}</div>

    <div class="kpi-grid btg-banks-kpi-grid" id="btgBanksKpis">${renderHighlightCards(banks)}</div>

    <div class="btg-banks-section-head btg-banks-section-head--chart">
      <span class="res-section-icon btg-banks-section-icon">
        <svg width="12" height="12" viewBox="0 0 18 18" fill="none" xmlns="http://www.w3.org/2000/svg">
          <polyline points="1,13 5,8 9,10 13,5 17,2" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" fill="none"/>
          <polyline points="13,2 17,2 17,6" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" fill="none"/>
        </svg>
      </span>
      <div class="btg-banks-section-copy">
        <div class="btg-banks-section-title">${esc(m.label)} · cross-country</div>
      </div>
    </div>

    <div class="panel btg-banks-panel">
      <div class="panel-head">
        <div>
          <div class="panel-title">${esc(m.label)} comparison</div>
          <div class="panel-sub">Ranked by equity (USD) · latest period per country${elimOn ? ' · ex-subsidiaries' : ''}</div>
        </div>
      </div>
      <div class="panel-body">
        <div class="chart-wrap" style="position:relative;min-height:300px;">
          <canvas id="btgBanksChart" height="300" style="width:100%;height:300px;"></canvas>
          <div id="btgBanksChartEmpty" style="display:none;position:absolute;inset:0;align-items:center;justify-content:center;color:var(--text3);font-size:13px;">No values for this KPI</div>
        </div>
      </div>
    </div>

    <div class="panel btg-banks-panel">
      <div class="panel-head">
        <div>
          <div class="panel-title">Comparison table · USD</div>
          <div class="panel-sub">Ranked by equity (USD) · franchise KPIs${elimOn ? ' · ex-subsidiaries' : ''}</div>
        </div>
      </div>
      <div class="panel-body" style="overflow-x:auto;padding:0;" id="btgBanksTable">${renderTable(banks)}</div>
    </div>

    <ul class="btg-banks-notes">${(state.notes || []).map((n) => `<li>${esc(n)}</li>`).join('')}</ul>
  `;

  document.querySelectorAll('#btgMetricBtns [data-btg-metric]').forEach((btn) => {
    btn.addEventListener('click', () => setMetric(btn.getAttribute('data-btg-metric')));
  });
  document.getElementById('btgElimSubs')?.addEventListener('change', (e) => {
    setEliminateSubsidiaries(e.target.checked);
  });
  requestAnimationFrame(() => drawChart(banks));
}

export function renderBtgBanks() {
  if (!state.loaded && !state.loading) loadSnapshot();
  else render();
}
