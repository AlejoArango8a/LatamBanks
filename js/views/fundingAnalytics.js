// ============================================================
// Funding Analytics — ALM / Treasury funding sheet
// Brazil (IF.data Cosif) + Chile (CMF MB1/MR1)
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
} from '../brCuentas.js?v=bmon67';
import {
  CL_FUNDING_INSTRUMENTS,
  CL_FUNDING_COLORS,
  CL_KPI,
  CL_FUNDING_EXPENSES,
  clFundingAccountsForRun,
  clFundingExpenseAccountsForRun,
  clFundingSnapshot,
  clSeries,
  clSum,
  clExpenseMonth,
} from '../clCuentas.js?v=bmon67';
import { ST, datasetIsoCountry } from '../state.js?v=bmon67';
import { fetchData } from '../api.js?v=bmon67';
import { bankName, fmtKPI, periodLabel } from '../format.js?v=bmon67';
import { btgBlue } from '../config.js?v=bmon67';

const FUNDING_COUNTRIES = new Set(['BR', 'CL']);

const state = {
  loading: false,
  loaded: false,
  error: null,
  metric: 'mix', // mix | tax|currency | cost
  banks: [],
  periodos: [],
  rows: [],
  lastBank: null,
  iso: null,
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

function cfg() {
  const iso = datasetIsoCountry();
  if (iso === 'BR') {
    return {
      iso: 'BR',
      title: 'Funding Analytics',
      eyebrow: 'Brazil · ALM / Treasury',
      sub: 'Instrument stocks from Bacen IF.data (Cosif). Tax-advantaged = LCA + LCI eligible for PF IR relief — not CRA/CRI.',
      instruments: BR_FUNDING_INSTRUMENTS,
      colors: BR_FUNDING_COLORS,
      fundingLabel: 'Captações',
      specialMetric: 'tax',
      specialLabel: 'Tax-advantaged eligible',
      notes: [
        '<strong>Eligible ≠ exempt:</strong> Cosif reports the instrument issued (LCA/LCI), not whether the holder is a tax-exempt individual.',
        '<strong>CRA / CRI</strong> are liabilities of securitizadoras, not of the bank — excluded from this funding stack.',
        '<strong>CDB/RDB</strong> sit inside Depósitos a Prazo; IF.data does not split them publicly.',
        '<strong>Cost proxy</strong> uses quarterly Despesas de Captação / average Captações, annualized — accounting cost, not contractual coupon.',
        'History uses Cosif legacy codes through Dec-2024 and new codes from Mar-2025.',
      ],
      b1Accounts: brFundingAccountsForRun,
      r1Accounts: () => BR_KPI.despesasCaptacao,
      snapshot: brFundingSnapshot,
      series: (rows, codes, periodos) => brSeries(rows, codes, periodos),
      sum: (rows, codes, periodo) => brSum(rows, codes, periodo),
      specialSeries: (rows, periodos) => ({
        primary: brSeries(rows, BR_TAX_ELIGIBLE_CODES, periodos),
        total: brSeries(rows, BR_KPI.captacoes, periodos),
        a: brSeries(rows, BR_KPI.lci, periodos),
        b: brSeries(rows, BR_KPI.lca, periodos),
        aLabel: 'LCI',
        bLabel: 'LCA',
        primaryLabel: 'LCA+LCI eligible',
        restLabel: 'other captações',
      }),
      costSeries: (rows, periodos) => {
        const despByP = {};
        periodos.forEach((p) => { despByP[p] = brSum(rows, BR_KPI.despesasCaptacao, p); });
        return periodos.map((p, i) => {
          const qExp = brResultReset(despByP, p, 'quarter');
          if (qExp == null || !Number.isFinite(qExp)) return null;
          const stock = brSum(rows, BR_KPI.captacoes, p);
          const prev = i > 0 ? brSum(rows, BR_KPI.captacoes, periodos[i - 1]) : stock;
          const avg = (stock + prev) / 2;
          if (!(avg > 0)) return null;
          return (qExp * 4 / avg) * 100;
        });
      },
      taxTreatment: (inst) => (inst.taxEligible === true ? 'Eligible PF'
        : inst.taxEligible === 'partial' ? 'Partial / holder-dependent' : '—'),
    };
  }
  if (iso === 'CL') {
    return {
      iso: 'CL',
      title: 'Funding Analytics',
      eyebrow: 'Chile · ALM / Treasury',
      sub: 'CMF monthly balance (MB1) + interest expense (MR1). No LCI/LCA-style tax-exempt bank letters — focus on instrument mix, UF/FX share and cost of funds.',
      instruments: CL_FUNDING_INSTRUMENTS,
      colors: CL_FUNDING_COLORS,
      fundingLabel: 'Ordinary funding',
      specialMetric: 'currency',
      specialLabel: 'UF / FX mix',
      notes: [
        '<strong>No LCI/LCA equivalent:</strong> Chile has no public bank-issued letter whose coupon is generally tax-exempt for individuals.',
        '<strong>UF vs FX:</strong> <code>monto_uf</code> is CLP indexed to UF; <code>monto_ext</code> is payable in foreign currency; <code>monto_tc</code> is CLP FX-indexed — not the same as EXT.',
        '<strong>Core vs wholesale</strong> is a proxy: time deposits mix retail and institutional (AFP) holders — CMF does not split them.',
        '<strong>Cost proxy</strong> uses monthly MR1 interest expense deltas (YTD reset in January) / average stock, annualized.',
        'Capital instruments (T2 / AT1) are listed but excluded from “ordinary funding” totals.',
        'Maturity ladder / fixed-vs-float are not in MB1 — would need C46/R13 or financial-statement notes.',
      ],
      b1Accounts: clFundingAccountsForRun,
      r1Accounts: clFundingExpenseAccountsForRun,
      snapshot: clFundingSnapshot,
      series: (rows, codes, periodos) => clSeries(rows, codes, periodos),
      sum: (rows, codes, periodo) => clSum(rows, codes, periodo),
      specialSeries: (rows, periodos) => {
        const codes = CL_FUNDING_INSTRUMENTS.filter((i) => i.group !== 'capital').flatMap((i) => i.codes);
        return {
          primary: clSeries(rows, codes, periodos, 'monto_uf'),
          secondary: clSeries(rows, codes, periodos, 'monto_ext'),
          total: clSeries(rows, codes, periodos, 'monto_total'),
          aLabel: 'UF-indexed',
          bLabel: 'FX (EXT)',
          primaryLabel: 'UF-indexed',
          restLabel: 'other (CLP+TC+EXT residual view uses EXT separately)',
        };
      },
      costSeries: (rows, periodos) => {
        const despByP = {};
        periodos.forEach((p) => { despByP[p] = clSum(rows, CL_FUNDING_EXPENSES.total, p); });
        return periodos.map((p, i) => {
          const monthExp = clExpenseMonth(despByP, p);
          if (monthExp == null || !Number.isFinite(monthExp)) return null;
          // Expense accounts are typically negative in CMF → use absolute cost
          const flow = Math.abs(monthExp);
          const stock = clSum(rows, CL_KPI.fundingOrdinary, p);
          const prev = i > 0 ? clSum(rows, CL_KPI.fundingOrdinary, periodos[i - 1]) : stock;
          const avg = (stock + prev) / 2;
          if (!(avg > 0)) return null;
          return (flow * 12 / avg) * 100;
        });
      },
      taxTreatment: (inst) => (inst.group === 'capital' ? 'Regulatory capital'
        : inst.group === 'debt' ? 'Market debt' : '—'),
    };
  }
  return null;
}

async function loadFundingData() {
  const c = cfg();
  if (!c) return;
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
  state.iso = c.iso;
  // Reset metric if switching country to an incompatible special view
  if (c.iso === 'CL' && state.metric === 'tax') state.metric = 'currency';
  if (c.iso === 'BR' && state.metric === 'currency') state.metric = 'tax';
  render();

  try {
    const [b1, r1] = await Promise.all([
      fetchData('b1', c.b1Accounts(), periodos, banks),
      fetchData('r1', c.r1Accounts(), periodos, banks),
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
  const c = cfg();
  if (!c) return null;
  const lastP = state.periodos[state.periodos.length - 1];
  return c.snapshot(rowsForBank(code), lastP);
}

function renderKpis(snap, c) {
  if (!snap) return '';
  const specialTitle = c.iso === 'CL' ? 'UF-indexed share' : 'Tax-advantaged eligible';
  const specialVal = c.iso === 'CL' ? fmtPct(snap.ufPct) : fmtKPI(snap.taxEligible);
  const specialSub = c.iso === 'CL'
    ? `FX share ${fmtPct(snap.fxPct)} · of ordinary funding`
    : `LCA + LCI · ${fmtPct(snap.taxEligiblePct)} of funding`;

  return `
    <div class="kpi-grid fa-kpi-grid">
      <div class="kpi-col">
        <div class="kpi-col-title">Total funding</div>
        <div class="kpi blue"><div class="kpi-val">${fmtKPI(snap.funding ?? snap.captacoes)}</div>
        <div class="kpi-sub">${esc(c.fundingLabel)} · ${esc(periodLabel(snap.periodo))}</div></div>
      </div>
      <div class="kpi-col">
        <div class="kpi-col-title">Deposits</div>
        <div class="kpi blue"><div class="kpi-val">${fmtKPI(snap.depositos)}</div>
        <div class="kpi-sub">${fmtPct((snap.funding || snap.captacoes) ? (snap.depositos / (snap.funding || snap.captacoes)) * 100 : null)} of funding</div></div>
      </div>
      <div class="kpi-col">
        <div class="kpi-col-title">${esc(specialTitle)}</div>
        <div class="kpi green"><div class="kpi-val">${specialVal}</div>
        <div class="kpi-sub">${esc(specialSub)}</div></div>
      </div>
      <div class="kpi-col">
        <div class="kpi-col-title">Loans / Deposits</div>
        <div class="kpi purple"><div class="kpi-val">${fmtRatio(snap.ltd)}</div>
        <div class="kpi-sub">Loans / funding ${fmtRatio(snap.ltf)}</div></div>
      </div>
    </div>`;
}

function renderInstrumentTable(snap, c) {
  if (!snap) return '';
  const funding = snap.funding ?? snap.captacoes ?? 0;
  const rows = snap.instruments
    .filter((i) => i.value !== 0)
    .sort((a, b) => Math.abs(b.value) - Math.abs(a.value));
  const body = rows.map((i) => {
    const pct = funding > 0 ? (i.value / funding) * 100 : null;
    const treat = c.taxTreatment(i);
    const ufFx = c.iso === 'CL'
      ? `<td class="r">${fmtKPI(i.uf || 0)}</td><td class="r">${fmtKPI(i.ext || 0)}</td>`
      : '';
    return `<tr>
      <td><span class="fa-swatch" style="background:${c.colors[i.key] || '#64748b'}"></span>${esc(i.label)}</td>
      <td class="r">${fmtKPI(i.value)}</td>
      <td class="r">${fmtPct(pct)}</td>
      ${ufFx}
      <td>${esc(treat)}</td>
    </tr>`;
  }).join('');
  const extraHead = c.iso === 'CL' ? '<th class="r">UF</th><th class="r">FX</th>' : '';
  return `<table class="data fa-table">
    <thead><tr><th>Instrument</th><th class="r">Stock</th><th class="r">% funding</th>${extraHead}<th>Notes</th></tr></thead>
    <tbody>${body || '<tr><td colspan="6">No funding stocks for this period</td></tr>'}</tbody>
  </table>`;
}

function drawMixChart(code, c) {
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
  const series = c.instruments
    .filter((inst) => !(c.iso === 'CL' && inst.group === 'capital'))
    .map((inst) => ({
      ...inst,
      values: c.series(bankRows, inst.codes, periodos),
    }));
  const totals = periodos.map((_, i) => series.reduce((s, g) => s + (g.values[i] || 0), 0));
  const maxV = Math.max(1, ...totals);
  const pad = { t: 28, r: 16, b: 48, l: 64 };
  const plotW = cssW - pad.l - pad.r;
  const plotH = cssH - pad.t - pad.b;
  const n = Math.max(1, periodos.length);
  const barW = Math.min(28, (plotW / n) * 0.62);

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
    ctx.fillText(fmtKPI(maxV * (1 - i / 4)), pad.l - 8, y + 4);
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
      ctx.fillStyle = c.colors[g.key] || '#64748b';
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

function drawSpecialChart(code, c) {
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
  const sp = c.specialSeries(bankRows, periodos);
  const primary = sp.primary;
  const secondary = sp.secondary || null;
  const totals = sp.total;
  const maxV = Math.max(
    1,
    ...primary,
    ...(secondary || []),
    ...totals.map((t, i) => Math.max(0, (t || 0) - (primary[i] || 0) - (secondary ? (secondary[i] || 0) : 0))),
  );
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
    const el = Math.max(0, primary[i] || 0);
    const fx = secondary ? Math.max(0, secondary[i] || 0) : 0;
    const rest = Math.max(0, (totals[i] || 0) - el - fx);
    const hEl = (el / maxV) * plotH;
    const hFx = (fx / maxV) * plotH;
    const hRest = (rest / maxV) * plotH;
    let y = pad.t + plotH;
    ctx.fillStyle = 'rgba(100,116,139,0.35)';
    y -= hRest;
    ctx.fillRect(x, y, barW, Math.max(0, hRest));
    if (secondary) {
      ctx.fillStyle = c.colors.fxShare || '#2563eb';
      y -= hFx;
      ctx.fillRect(x, y, barW, Math.max(0, hFx));
    }
    ctx.fillStyle = c.iso === 'CL' ? (c.colors.ufShare || '#0d9488') : (c.colors.taxEligible || '#16a34a');
    y -= hEl;
    ctx.fillRect(x, y, barW, Math.max(0, hEl));
    ctx.fillStyle = '#64748b';
    ctx.font = '10px Inter, "DM Sans", system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(`${String(p).slice(4, 6)}/${String(p).slice(2, 4)}`, cx, cssH - 28);
  });

  ctx.fillStyle = '#475569';
  ctx.font = '600 12px Inter, "DM Sans", system-ui, sans-serif';
  ctx.textAlign = 'left';
  const legend = c.iso === 'CL'
    ? 'Teal = UF-indexed · blue = FX (EXT) · grey = residual'
    : 'Green = LCA+LCI eligible stock · grey = other captações';
  ctx.fillText(legend, pad.l, 16);

  const sub = document.getElementById('faTaxSub');
  if (sub) {
    const i = periodos.length - 1;
    if (c.iso === 'CL') {
      sub.textContent = `Latest: UF ${fmtKPI(primary[i])} (${fmtPct(totals[i] ? (primary[i] / totals[i]) * 100 : null)}) · FX ${fmtKPI(secondary?.[i] || 0)} (${fmtPct(totals[i] ? ((secondary?.[i] || 0) / totals[i]) * 100 : null)})`;
    } else {
      sub.textContent = `Latest: ${sp.aLabel} ${fmtKPI(sp.a[i])} · ${sp.bLabel} ${fmtKPI(sp.b[i])} · eligible ${fmtKPI(primary[i])} (${fmtPct(totals[i] ? (primary[i] / totals[i]) * 100 : null)} of funding)`;
    }
  }
}

function drawCostChart(code, c) {
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
  const costs = c.costSeries(bankRows, periodos);
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
  const iso = datasetIsoCountry();
  const c = cfg();

  if (!FUNDING_COUNTRIES.has(iso) || !c) {
    root.innerHTML = `<div class="fa-empty">
      <div class="fa-empty-title">Funding Analytics</div>
      <div class="fa-empty-sub">Available for <strong>Chile</strong> and <strong>Brazil</strong>. Switch country to explore the ALM funding mix.</div>
    </div>`;
    return;
  }

  if (state.loading) {
    root.innerHTML = `<div class="fa-empty"><div class="ls-bars" aria-hidden="true"><div></div><div></div><div></div><div></div><div></div></div>
      <div class="fa-empty-sub" style="margin-top:16px;">Loading ${c.iso === 'CL' ? 'Chile CMF' : 'Brazil IF.data'} funding stocks…</div></div>`;
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

  // Country switched after a prior load — force refresh
  if (state.loaded && state.iso && state.iso !== c.iso) {
    state.loaded = false;
  }

  if (!state.loaded) {
    root.innerHTML = `<div class="fa-empty">
      <div class="fa-empty-title">${esc(c.title)}</div>
      <div class="fa-empty-sub">${esc(c.sub)}</div>
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
    { key: c.specialMetric, label: c.specialLabel },
    { key: 'cost', label: 'Cost proxy' },
  ].map((m) => `<button type="button" class="rcbtn ${state.metric === m.key ? 'active' : ''}" data-fa-metric="${m.key}">${m.label}</button>`).join('');

  const chartId = state.metric === 'mix' ? 'faMixChart'
    : state.metric === 'cost' ? 'faCostChart' : 'faTaxChart';
  const panelTitle = state.metric === 'mix' ? 'Funding mix over time'
    : state.metric === 'cost' ? 'Implied funding cost'
    : c.specialLabel;

  root.innerHTML = `
    <div class="fa-hero">
      <div>
        <div class="fa-eyebrow">${esc(c.eyebrow)}</div>
        <div class="fa-title">${esc(c.title)}</div>
        <div class="fa-sub">${esc(c.sub)}</div>
      </div>
      <button type="button" class="rcbtn" id="faReload">Refresh</button>
    </div>

    <div class="fa-toolbar">
      <div class="fa-bank-tabs">${bankTabs}</div>
      <div class="fa-metric-tabs">${metricBtns}</div>
    </div>

    ${renderKpis(snap, c)}

    <div class="panel fa-panel" style="margin-top:22px;">
      <div class="panel-head">
        <div>
          <div class="panel-title">${esc(panelTitle)}</div>
          <div class="panel-sub" id="faTaxSub">${esc(bankName(code))} · ${esc(periodLabel(state.periodos[0]))} — ${esc(periodLabel(state.periodos[state.periodos.length - 1]))}</div>
        </div>
      </div>
      <div class="panel-body">
        <div class="chart-wrap" style="position:relative;min-height:280px;">
          <canvas id="${chartId}" height="300" style="width:100%;height:300px;"></canvas>
        </div>
      </div>
    </div>

    <div class="panel fa-panel" style="margin-top:18px;">
      <div class="panel-head">
        <div>
          <div class="panel-title">Instrument breakdown · ${esc(periodLabel(snap.periodo))}</div>
          <div class="panel-sub">Share of ${esc(c.fundingLabel)} · local reporting units</div>
        </div>
      </div>
      <div class="panel-body" style="overflow-x:auto;padding:0;">${renderInstrumentTable(snap, c)}</div>
    </div>

    <ul class="fa-notes">${c.notes.map((n) => `<li>${n}</li>`).join('')}</ul>
  `;

  document.getElementById('faReload')?.addEventListener('click', () => loadFundingData());
  document.querySelectorAll('[data-fa-bank]').forEach((btn) => {
    btn.addEventListener('click', () => setBank(btn.getAttribute('data-fa-bank')));
  });
  document.querySelectorAll('[data-fa-metric]').forEach((btn) => {
    btn.addEventListener('click', () => setMetric(btn.getAttribute('data-fa-metric')));
  });

  requestAnimationFrame(() => {
    if (state.metric === 'mix') drawMixChart(code, c);
    else if (state.metric === 'cost') drawCostChart(code, c);
    else drawSpecialChart(code, c);
  });
}

export function renderFundingAnalytics() {
  const iso = datasetIsoCountry();
  if (!FUNDING_COUNTRIES.has(iso)) {
    state.loaded = false;
    state.iso = null;
    render();
    return;
  }
  if (state.loaded && state.iso && state.iso !== iso) {
    state.loaded = false;
  }
  if (!state.loaded && !state.loading && selectedBanks().length) {
    loadFundingData();
  } else {
    render();
  }
}
