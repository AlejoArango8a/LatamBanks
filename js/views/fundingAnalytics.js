// ============================================================
// Funding Analytics — ALM / Treasury funding sheet
// Brazil (IF.data Cosif) + Chile (CMF MB1/MR1) + Uruguay (BCU)
// Peers: up to 5 banks from the left sidebar Bank Comparison
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
} from '../brCuentas.js?v=bmon72';
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
} from '../clCuentas.js?v=bmon72';
import {
  UY_FUNDING_INSTRUMENTS,
  UY_FUNDING_COLORS,
  UY_KPI,
  UY_FUNDING_EXPENSES,
  UY_TERM_INSTRUMENTS,
  uyFundingAccountsForRun,
  uyFundingExpenseAccountsForRun,
  uyFundingSnapshot,
  uyTermBreakdown,
  uySeries,
  uySum,
  uyExpenseMonth,
} from '../uyCuentas.js?v=bmon72';
import { ST, datasetIsoCountry } from '../state.js?v=bmon72';
import { fetchData } from '../api.js?v=bmon72';
import { bankName, fmtKPI, periodLabel } from '../format.js?v=bmon72';
import { btgBlue, bankColor } from '../config.js?v=bmon72';
import { drawLineChart, sparseData, drawChartLegend } from '../charts.js?v=bmon77';

const FUNDING_COUNTRIES = new Set(['BR', 'CL', 'UY']);
const MAX_COMPARE_ENTITIES = 5;
const MAX_FETCH_BANKS = 5;
const FA_COMPARE_PALETTE = ['#0d3b66', '#16a34a', '#dc2626', '#0d9488', '#db2777', '#ca8a04', '#0284c7', '#a16207'];

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
  selectionKey: '',
  compare: false,
  lastEntityId: null,
  chartStyle: 'bars', // bars | lines | area
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

function bankDisplayName(code) {
  return bankName(Number(code)) || `Bank ${code}`;
}

/** Mirror Bank Monitor 123 toggle (ST.showBarLabels: true | false | null=auto). */
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

function selectionKey() {
  return selectedBanks().slice(0, MAX_COMPARE_ENTITIES).map(Number).join(',');
}

function syncCompareFromSelection({ preferCompareOnMulti = false } = {}) {
  const n = selectedBanks().length;
  if (n <= 1) state.compare = false;
  else if (preferCompareOnMulti) state.compare = true;
}

function entityColor(i) {
  return FA_COMPARE_PALETTE[i % FA_COMPARE_PALETTE.length];
}

/** Active peer entities: one per sidebar-selected bank (max 5). */
function resolveEntities() {
  return selectedBanks().slice(0, MAX_COMPARE_ENTITIES).map((code, i) => {
    const n = Number(code);
    const nm = bankDisplayName(n);
    return {
      id: `b:${n}`,
      label: nm,
      short: nm,
      codes: [n],
      color: bankColor(n, i, nm) || entityColor(i),
      kind: 'bank',
    };
  });
}

function banksNeededForEntities(entities) {
  const set = new Set();
  entities.forEach((e) => e.codes.forEach((c) => set.add(Number(c))));
  return [...set].slice(0, MAX_FETCH_BANKS);
}

function cfg() {
  const iso = datasetIsoCountry();
  if (iso === 'BR') {
    return {
      iso: 'BR',
      title: 'Funding Analytics',
      eyebrow: 'Brazil · ALM / Treasury',
      sub: 'Instrument stocks from Bacen IF.data (Cosif). Compare up to 5 banks via the sidebar Bank Comparison. Tax-advantaged = LCA + LCI — not CRA/CRI.',
      instruments: BR_FUNDING_INSTRUMENTS,
      colors: BR_FUNDING_COLORS,
      fundingLabel: 'Captações',
      specialMetric: 'tax',
      specialLabel: 'Tax-advantaged eligible',
      notes: [
        '<strong>Compare:</strong> overlay up to 5 banks selected in the left sidebar (Bank Comparison).',
        '<strong>Chart style:</strong> switch Bars / Lines / Area on the chart panel to see which read is clearest for the active metric.',
        '<strong>Compare mode</strong> overlays each selected bank as its own series (up to 5) from the sidebar Bank Comparison.',
        '<strong>Eligible ≠ exempt:</strong> Cosif reports the instrument issued (LCA/LCI), not whether the holder is a tax-exempt individual.',
        '<strong>CRA / CRI</strong> are liabilities of securitizadoras, not of the bank — excluded from this funding stack.',
        '<strong>Cost proxy</strong> uses quarterly Despesas de Captação / average Captações, annualized — accounting cost, not contractual coupon.',
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
      specialPctSeries: (rows, periodos) => {
        const primary = brSeries(rows, BR_TAX_ELIGIBLE_CODES, periodos);
        const total = brSeries(rows, BR_KPI.captacoes, periodos);
        return primary.map((v, i) => (total[i] > 0 ? (v / total[i]) * 100 : null));
      },
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
      fundingSeries: (rows, periodos) => brSeries(rows, BR_KPI.captacoes, periodos),
      taxTreatment: (inst) => (inst.taxEligible === true ? 'Eligible PF'
        : inst.taxEligible === 'partial' ? 'Partial / holder-dependent' : '—'),
      currencyLens: false,
      loadingLabel: 'Brazil IF.data',
      specialCompareLabel: 'Eligible %',
      specialEmptyMessage: 'No tax-eligible series.',
      specialKpi: (snap) => ({
        title: 'Tax-advantaged eligible',
        val: fmtKPI(snap.taxEligible),
        sub: `LCA + LCI · ${fmtPct(snap.taxEligiblePct)} of funding`,
      }),
      specialCompareRows: [
        { label: 'LCA+LCI eligible %', fmt: (s) => fmtPct(s?.taxEligiblePct) },
        { label: 'LCA+LCI stock', fmt: (s) => fmtKPI(s?.taxEligible) },
      ],
      instrumentExtraHead: '',
      instrumentExtraCell: () => '',
    };
  }
  if (iso === 'CL') {
    return {
      iso: 'CL',
      title: 'Funding Analytics',
      eyebrow: 'Chile · ALM / Treasury',
      sub: 'CMF monthly balance (MB1) + interest expense (MR1). Compare up to 5 banks via the sidebar Bank Comparison.',
      instruments: CL_FUNDING_INSTRUMENTS,
      colors: CL_FUNDING_COLORS,
      fundingLabel: 'Ordinary funding',
      specialMetric: 'currency',
      specialLabel: 'UF / FX mix',
      notes: [
        '<strong>Compare:</strong> overlay up to 5 banks selected in the left sidebar (Bank Comparison).',
        '<strong>Chart style:</strong> switch Bars / Lines / Area on the chart panel to see which read is clearest for the active metric.',
        '<strong>Compare mode</strong> overlays each selected bank as its own series (up to 5) from the sidebar Bank Comparison.',
        '<strong>No LCI/LCA equivalent:</strong> Chile has no public bank-issued letter whose coupon is generally tax-exempt for individuals.',
        '<strong>UF vs FX:</strong> <code>monto_uf</code> is CLP indexed to UF; <code>monto_ext</code> is payable in foreign currency.',
        '<strong>Cost proxy</strong> uses monthly MR1 interest expense deltas / average stock, annualized.',
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
          restLabel: 'CLP + other',
        };
      },
      specialPctSeries: (rows, periodos) => {
        const codes = CL_FUNDING_INSTRUMENTS.filter((i) => i.group !== 'capital').flatMap((i) => i.codes);
        const uf = clSeries(rows, codes, periodos, 'monto_uf');
        const total = clSeries(rows, codes, periodos, 'monto_total');
        return uf.map((v, i) => (total[i] > 0 ? (v / total[i]) * 100 : null));
      },
      costSeries: (rows, periodos) => {
        const despByP = {};
        periodos.forEach((p) => { despByP[p] = clSum(rows, CL_FUNDING_EXPENSES.total, p); });
        return periodos.map((p, i) => {
          const monthExp = clExpenseMonth(despByP, p);
          if (monthExp == null || !Number.isFinite(monthExp)) return null;
          const flow = Math.abs(monthExp);
          const stock = clSum(rows, CL_KPI.fundingOrdinary, p);
          const prev = i > 0 ? clSum(rows, CL_KPI.fundingOrdinary, periodos[i - 1]) : stock;
          const avg = (stock + prev) / 2;
          if (!(avg > 0)) return null;
          return (flow * 12 / avg) * 100;
        });
      },
      fundingSeries: (rows, periodos) => {
        const codes = CL_FUNDING_INSTRUMENTS.filter((i) => i.group !== 'capital').flatMap((i) => i.codes);
        return clSeries(rows, codes, periodos);
      },
      taxTreatment: (inst) => (inst.group === 'capital' ? 'Regulatory capital'
        : inst.group === 'debt' ? 'Market debt' : '—'),
      currencyLens: true,
      loadingLabel: 'Chile CMF',
      specialCompareLabel: 'UF share %',
      specialEmptyMessage: 'No UF-share series.',
      specialKpi: (snap) => ({
        title: 'UF-indexed share',
        val: fmtPct(snap.ufPct),
        sub: `FX share ${fmtPct(snap.fxPct)} · of ordinary funding`,
      }),
      specialCompareRows: [
        { label: 'UF share', fmt: (s) => fmtPct(s?.ufPct) },
        { label: 'FX share', fmt: (s) => fmtPct(s?.fxPct) },
      ],
      instrumentExtraHead: '<th class="r">UF</th><th class="r">FX</th>',
      instrumentExtraCell: (i) => `<td class="r">${fmtKPI(i.uf || 0)}</td><td class="r">${fmtKPI(i.ext || 0)}</td>`,
    };
  }
  if (iso === 'UY') {
    const ordinaryCodes = UY_FUNDING_INSTRUMENTS.filter((i) => i.group !== 'capital').flatMap((i) => i.codes);
    return {
      iso: 'UY',
      title: 'Funding Analytics',
      eyebrow: 'Uruguay · ALM / Treasury',
      sub: 'BCU/SSF monthly boletín (Situación + Resultados). Local (UYU) vs FX (≈USD) funding mix. Compare up to 5 banks via the sidebar Bank Comparison.',
      instruments: UY_FUNDING_INSTRUMENTS,
      colors: UY_FUNDING_COLORS,
      fundingLabel: 'Captaciones',
      specialMetric: 'currency',
      specialLabel: 'FX (≈USD) mix',
      notes: [
        '<strong>Compare:</strong> overlay up to 5 banks selected in the left sidebar (Bank Comparison).',
        '<strong>Chart style:</strong> switch Bars / Lines / Area on the chart panel to see which read is clearest for the active metric.',
        '<strong>Compare mode</strong> overlays each selected bank as its own series (up to 5) from the sidebar Bank Comparison.',
        '<strong>FX ≈ USD, not exactly:</strong> BCU reports Actividad en M/E (all foreign currency, predominantly USD). We label it FX (≈USD).',
        '<strong>Local vs FX:</strong> <code>monto_clp</code> is Actividad en M/N (UYU); <code>monto_ext</code> is Actividad en M/E. There is no UF/UI column — indexed instruments sit inside M/N.',
        '<strong>Term structure</strong> (vista / plazo) comes from Anexo 1 contractual maturities — shown when the loader has ingested those synthetic accounts.',
        '<strong>Cost proxy</strong> uses monthly BCU interest-expense (account 5) deltas / average stock, annualized — accounting cost, not contractual coupon.',
      ],
      b1Accounts: uyFundingAccountsForRun,
      r1Accounts: uyFundingExpenseAccountsForRun,
      snapshot: uyFundingSnapshot,
      series: (rows, codes, periodos) => uySeries(rows, codes, periodos),
      sum: (rows, codes, periodo) => uySum(rows, codes, periodo),
      specialSeries: (rows, periodos) => ({
        primary: uySeries(rows, ordinaryCodes, periodos, 'monto_ext'),
        secondary: uySeries(rows, ordinaryCodes, periodos, 'monto_clp'),
        total: uySeries(rows, ordinaryCodes, periodos, 'monto_total'),
        primaryLabel: 'FX (≈USD)',
        bLabel: 'Local (UYU)',
        aLabel: 'FX (≈USD)',
        restLabel: 'residual',
        primaryColor: UY_FUNDING_COLORS.fxShare,
        secondaryColor: UY_FUNDING_COLORS.localShare,
        legend: 'Blue = FX (≈USD) · teal = local (UYU) · grey = residual',
      }),
      specialPctSeries: (rows, periodos) => {
        const ext = uySeries(rows, ordinaryCodes, periodos, 'monto_ext');
        const total = uySeries(rows, ordinaryCodes, periodos, 'monto_total');
        return ext.map((v, i) => (total[i] > 0 ? (v / total[i]) * 100 : null));
      },
      costSeries: (rows, periodos) => {
        const despByP = {};
        periodos.forEach((p) => { despByP[p] = uySum(rows, UY_FUNDING_EXPENSES.total, p); });
        return periodos.map((p, i) => {
          const monthExp = uyExpenseMonth(despByP, p);
          if (monthExp == null || !Number.isFinite(monthExp)) return null;
          const flow = Math.abs(monthExp);
          const stock = uySum(rows, UY_KPI.fundingOrdinary, p);
          const prev = i > 0 ? uySum(rows, UY_KPI.fundingOrdinary, periodos[i - 1]) : stock;
          const avg = (stock + prev) / 2;
          if (!(avg > 0)) return null;
          return (flow * 12 / avg) * 100;
        });
      },
      fundingSeries: (rows, periodos) => uySeries(rows, ordinaryCodes, periodos),
      taxTreatment: (inst) => (inst.group === 'capital' ? 'Regulatory capital'
        : inst.group === 'debt' ? 'Market debt' : '—'),
      currencyLens: true,
      loadingLabel: 'Uruguay BCU',
      specialCompareLabel: 'FX share %',
      specialEmptyMessage: 'No FX-share series.',
      specialKpi: (snap) => ({
        title: 'FX (≈USD) share',
        val: fmtPct(snap.fxPct),
        sub: `Local UYU ${fmtPct(snap.localPct)} · of ordinary funding`,
      }),
      specialCompareRows: [
        { label: 'FX share', fmt: (s) => fmtPct(s?.fxPct) },
        { label: 'Local share', fmt: (s) => fmtPct(s?.localPct) },
      ],
      instrumentExtraHead: '<th class="r">Local</th><th class="r">FX</th>',
      instrumentExtraCell: (i) => `<td class="r">${fmtKPI(i.local || 0)}</td><td class="r">${fmtKPI(i.ext || 0)}</td>`,
      termBreakdown: (rows, periodo) => uyTermBreakdown(rows, periodo),
      termInstruments: UY_TERM_INSTRUMENTS,
    };
  }
  return null;
}

function rowsForCodes(codes) {
  const set = new Set(codes.map(Number));
  return state.rows.filter((r) => set.has(Number(r.ins_cod)));
}

function latestSnapshotFor(codes) {
  const c = cfg();
  if (!c || !codes?.length) return null;
  const lastP = state.periodos[state.periodos.length - 1];
  return c.snapshot(rowsForCodes(codes), lastP);
}

async function loadFundingData() {
  const c = cfg();
  if (!c) return;

  const entities = resolveEntities();
  if (!entities.length) {
    state.error = peerEmptyMessage();
    state.loaded = false;
    render();
    return;
  }

  const banks = banksNeededForEntities(entities);
  const periodos = periodRange();
  if (!banks.length) {
    state.error = 'No banks available for the selected peers.';
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
  if (c.specialMetric === 'currency' && state.metric === 'tax') state.metric = 'currency';
  if (c.specialMetric === 'tax' && state.metric === 'currency') state.metric = 'tax';
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
    const ents = resolveEntities();
    state.lastEntityId = ents[0]?.id || null;
    state.selectionKey = selectionKey();
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

function peerEmptyMessage() {
  return 'Select at least one bank in the sidebar (Bank Comparison), then open Funding Analytics.';
}

function renderKpis(snap, c) {
  if (!snap) return '';
  const kpi = c.specialKpi(snap);
  const specialTitle = kpi.title;
  const specialVal = kpi.val;
  const specialSub = kpi.sub;

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

function renderCompareKpis(entities, c) {
  const lastP = state.periodos[state.periodos.length - 1];
  const snaps = entities.map((e) => ({ e, snap: latestSnapshotFor(e.codes) }));
  const head = snaps.map(({ e }, i) => {
    const tone = i % 2 === 0 ? 'fa-bank-tone-a' : '';
    return `<th class="r fa-bank-start fa-bank-head ${tone}" style="--fa-bank-line:${esc(e.color)}">
      <span class="fa-swatch" style="background:${esc(e.color)}"></span>${esc(e.short)}
    </th>`;
  }).join('');
  const row = (label, fmt) => `<tr><td>${esc(label)}</td>${snaps.map(({ e, snap }, i) => {
    const tone = i % 2 === 0 ? 'fa-bank-tone-a' : '';
    return `<td class="r fa-bank-start ${tone}" style="--fa-bank-line:${esc(e.color)}">${fmt(snap)}</td>`;
  }).join('')}</tr>`;
  return `<div class="panel fa-panel" style="margin-bottom:18px;">
    <div class="panel-head"><div>
      <div class="panel-title">Peer snapshot · ${esc(periodLabel(lastP))}</div>
      <div class="panel-sub">One column per bank · local reporting units</div>
    </div></div>
    <div class="panel-body" style="overflow-x:auto;padding:0;">
      <table class="data fa-table fa-table-peers">
        <thead><tr><th>Metric</th>${head}</tr></thead>
        <tbody>
          ${row(c.fundingLabel, (s) => fmtKPI(s?.funding ?? s?.captacoes))}
          ${row('Deposits', (s) => fmtKPI(s?.depositos))}
          ${c.specialCompareRows.map((r) => row(r.label, r.fmt)).join('')}
          ${row('Loans / Deposits', (s) => fmtRatio(s?.ltd))}
          ${row('Loans / Funding', (s) => fmtRatio(s?.ltf))}
        </tbody>
      </table>
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
    const extraCells = c.instrumentExtraCell ? c.instrumentExtraCell(i) : '';
    return `<tr>
      <td><span class="fa-swatch" style="background:${c.colors[i.key] || '#64748b'}"></span>${esc(i.label)}</td>
      <td class="r">${fmtKPI(i.value)}</td>
      <td class="r">${fmtPct(pct)}</td>
      ${extraCells}
      <td>${esc(treat)}</td>
    </tr>`;
  }).join('');
  const extraHead = c.instrumentExtraHead || '';
  return `<table class="data fa-table">
    <thead><tr><th>Instrument</th><th class="r">Stock</th><th class="r">% funding</th>${extraHead}<th>Notes</th></tr></thead>
    <tbody>${body || '<tr><td colspan="6">No funding stocks for this period</td></tr>'}</tbody>
  </table>`;
}

function renderTermPanel(codes, c) {
  if (!c.termBreakdown) return '';
  const lastP = state.periodos[state.periodos.length - 1];
  const tb = c.termBreakdown(rowsForCodes(codes), lastP);
  if (!tb || !tb.hasData) return '';
  const total = tb.total || 0;
  const body = tb.buckets.map((b) => {
    const pct = total > 0 ? (b.value / total) * 100 : null;
    const fxPct = b.value > 0 ? (b.ext / b.value) * 100 : null;
    return `<tr>
      <td><span class="fa-swatch" style="background:${c.colors[b.key] || '#64748b'}"></span>${esc(b.label)}</td>
      <td class="r">${fmtKPI(b.value)}</td>
      <td class="r">${fmtPct(pct)}</td>
      <td class="r">${fmtPct(fxPct)}</td>
    </tr>`;
  }).join('');
  return `<div class="panel fa-panel" style="margin-top:18px;">
    <div class="panel-head">
      <div>
        <div class="panel-title">Deposit term structure · ${esc(periodLabel(lastP))}</div>
        <div class="panel-sub">Anexo 1 contractual maturities · FX = ≈USD share of each bucket</div>
      </div>
    </div>
    <div class="panel-body" style="overflow-x:auto;padding:0;">
      <table class="data fa-table">
        <thead><tr><th>Bucket</th><th class="r">Stock</th><th class="r">% deposits</th><th class="r">FX %</th></tr></thead>
        <tbody>${body}</tbody>
      </table>
    </div>
  </div>`;
}

function renderCompareInstrumentTable(entities, c) {
  const snaps = entities.map((e) => ({ e, snap: latestSnapshotFor(e.codes) }));
  const keys = [];
  const seen = new Set();
  snaps.forEach(({ snap }) => {
    (snap?.instruments || []).forEach((inst) => {
      if (!seen.has(inst.key) && inst.value !== 0) {
        seen.add(inst.key);
        keys.push(inst);
      }
    });
  });
  const firstSnap = snaps[0]?.snap;
  keys.sort((a, b) => {
    const va = Math.abs(firstSnap?.instruments?.find((i) => i.key === a.key)?.value || 0);
    const vb = Math.abs(firstSnap?.instruments?.find((i) => i.key === b.key)?.value || 0);
    return vb - va || a.label.localeCompare(b.label);
  });
  const head = snaps.map(({ e }, i) => {
    const tone = i % 2 === 0 ? 'fa-bank-tone-a' : '';
    return `<th class="r fa-bank-start fa-bank-head ${tone}" colspan="2" style="--fa-bank-line:${esc(e.color)}">
      <span class="fa-swatch" style="background:${esc(e.color)}"></span>${esc(e.short)}
    </th>`;
  }).join('');
  const sub = snaps.map(({ e }, i) => {
    const tone = i % 2 === 0 ? 'fa-bank-tone-a' : '';
    return `<th class="r fa-bank-start fa-bank-sub ${tone}" style="--fa-bank-line:${esc(e.color)}">Stock</th>
      <th class="r fa-bank-sub ${tone}">%</th>`;
  }).join('');
  const body = keys.map((inst) => {
    const cells = snaps.map(({ e, snap }, i) => {
      const row = snap?.instruments?.find((x) => x.key === inst.key);
      const funding = snap?.funding ?? snap?.captacoes ?? 0;
      const v = row?.value || 0;
      const pct = funding > 0 ? (v / funding) * 100 : null;
      const tone = i % 2 === 0 ? 'fa-bank-tone-a' : '';
      return `<td class="r fa-bank-start ${tone}" style="--fa-bank-line:${esc(e.color)}">${fmtKPI(v)}</td>
        <td class="r ${tone}">${fmtPct(pct)}</td>`;
    }).join('');
    return `<tr><td><span class="fa-swatch" style="background:${c.colors[inst.key] || '#64748b'}"></span>${esc(inst.label)}</td>${cells}</tr>`;
  }).join('');
  return `<table class="data fa-table fa-table-peers">
    <thead>
      <tr><th rowspan="2">Instrument</th>${head}</tr>
      <tr>${sub}</tr>
    </thead>
    <tbody>${body || '<tr><td>No instruments</td></tr>'}</tbody>
  </table>`;
}

function drawMixChart(codes, c) {
  const canvas = document.getElementById('faMixChart');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const dpr = window.devicePixelRatio || 1;
  const cssW = canvas.clientWidth || 720;
  const cssH = 360;
  canvas.width = Math.floor(cssW * dpr);
  canvas.height = Math.floor(cssH * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, cssW, cssH);

  const bankRows = rowsForCodes(codes);
  const periodos = state.periodos;
  const series = c.instruments
    .filter((inst) => !(c.currencyLens && inst.group === 'capital'))
    .map((inst) => ({
      ...inst,
      values: c.series(bankRows, inst.codes, periodos),
    }))
    .filter((g) => g.values.some((v) => v != null && Math.abs(v) > 0));
  const totals = periodos.map((_, i) => series.reduce((s, g) => s + (g.values[i] || 0), 0));
  const maxV = Math.max(1, ...totals);
  const pad = { t: 28, r: 16, b: 92, l: 64 };
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
    ctx.fillText(label, cx, pad.t + plotH + 18);
    if (wantValueLabels(1) && totals[i] > 0) {
      ctx.fillStyle = '#334155';
      ctx.font = '600 10px Inter, "DM Sans", system-ui, sans-serif';
      ctx.fillText(fmtKPI(totals[i]), cx, Math.max(12, y - 4));
    }
  });

  ctx.fillStyle = '#475569';
  ctx.font = '600 12px Inter, "DM Sans", system-ui, sans-serif';
  ctx.textAlign = 'left';
  ctx.fillText('Funding mix · stacked stock (local currency)', pad.l, 16);

  drawChartLegend(
    ctx,
    series.map((g) => ({
      label: g.short || g.label,
      color: c.colors[g.key] || '#64748b',
    })),
    {
      x: pad.l,
      y: pad.t + plotH + 40,
      maxW: plotW,
      textColor: '#64748b',
      font: '600 11px Inter, "DM Sans", system-ui, sans-serif',
      rowH: 15,
    },
  );
}

function drawSpecialChart(codes, c) {
  const canvas = document.getElementById('faTaxChart');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const dpr = window.devicePixelRatio || 1;
  const cssW = canvas.clientWidth || 720;
  const cssH = 320;
  canvas.width = Math.floor(cssW * dpr);
  canvas.height = Math.floor(cssH * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, cssW, cssH);

  const bankRows = rowsForCodes(codes);
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
  const pad = { t: 28, r: 16, b: 88, l: 64 };
  const plotW = cssW - pad.l - pad.r;
  const plotH = cssH - pad.t - pad.b;
  const n = Math.max(1, periodos.length);
  const barW = Math.min(26, (plotW / n) * 0.55);

  const primaryColor = sp.primaryColor
    || (c.iso === 'CL' ? (c.colors.ufShare || '#0d9488') : (c.colors.taxEligible || '#16a34a'));
  const secondaryColor = sp.secondaryColor || c.colors.fxShare || '#2563eb';
  const residualColor = 'rgba(100,116,139,0.55)';

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
    ctx.fillStyle = residualColor;
    y -= hRest;
    ctx.fillRect(x, y, barW, Math.max(0, hRest));
    if (secondary) {
      ctx.fillStyle = secondaryColor;
      y -= hFx;
      ctx.fillRect(x, y, barW, Math.max(0, hFx));
    }
    ctx.fillStyle = primaryColor;
    y -= hEl;
    ctx.fillRect(x, y, barW, Math.max(0, hEl));
    ctx.fillStyle = '#64748b';
    ctx.font = '10px Inter, "DM Sans", system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(`${String(p).slice(4, 6)}/${String(p).slice(2, 4)}`, cx, pad.t + plotH + 18);
    if (wantValueLabels(1) && totals[i] > 0) {
      const share = (el / totals[i]) * 100;
      ctx.fillStyle = '#334155';
      ctx.font = '600 10px Inter, "DM Sans", system-ui, sans-serif';
      ctx.fillText(fmtPct(share, 0), cx, Math.max(12, y - 4));
    }
  });

  ctx.fillStyle = '#475569';
  ctx.font = '600 12px Inter, "DM Sans", system-ui, sans-serif';
  ctx.textAlign = 'left';
  ctx.fillText(c.specialLabel || 'Composition', pad.l, 16);

  const legendItems = [
    { label: sp.primaryLabel || sp.aLabel || 'Primary', color: primaryColor },
  ];
  if (secondary) {
    legendItems.push({ label: sp.bLabel || 'Secondary', color: secondaryColor });
  }
  legendItems.push({ label: sp.restLabel || 'Residual', color: '#64748b' });
  drawChartLegend(ctx, legendItems, {
    x: pad.l,
    y: pad.t + plotH + 40,
    maxW: plotW,
    textColor: '#64748b',
    font: '600 11px Inter, "DM Sans", system-ui, sans-serif',
  });

  const sub = document.getElementById('faTaxSub');
  if (sub) {
    const i = periodos.length - 1;
    if (c.currencyLens) {
      const pPct = totals[i] ? (primary[i] / totals[i]) * 100 : null;
      const sPct = totals[i] ? ((secondary?.[i] || 0) / totals[i]) * 100 : null;
      sub.textContent = `Latest: ${sp.primaryLabel} ${fmtKPI(primary[i])} (${fmtPct(pPct)}) · ${sp.bLabel} ${fmtKPI(secondary?.[i] || 0)} (${fmtPct(sPct)})`;
    } else {
      sub.textContent = `Latest: ${sp.aLabel} ${fmtKPI(sp.a[i])} · ${sp.bLabel} ${fmtKPI(sp.b[i])} · eligible ${fmtKPI(primary[i])} (${fmtPct(totals[i] ? (primary[i] / totals[i]) * 100 : null)} of funding)`;
    }
  }
}

function drawCostChart(codes, c) {
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

  const bankRows = rowsForCodes(codes);
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

function drawCompareChart(entities, c) {
  const periodos = state.periodos;
  let series;
  let valueScale = 'percent';
  let emptyMessage = 'No comparable series for these peers.';

  if (state.metric === 'cost') {
    series = entities.map((e) => ({
      label: e.short,
      color: e.color,
      data: sparseData(c.costSeries(rowsForCodes(e.codes), periodos).map((v) => (v == null ? null : v))),
    }));
    emptyMessage = 'Insufficient cost data for the selected peers.';
  } else if (state.metric === 'mix') {
    valueScale = 'billions';
    series = entities.map((e) => ({
      label: e.short,
      color: e.color,
      data: sparseData(c.fundingSeries(rowsForCodes(e.codes), periodos)),
    }));
    emptyMessage = 'No funding stocks for the selected peers.';
  } else {
    series = entities.map((e) => ({
      label: e.short,
      color: e.color,
      data: sparseData(c.specialPctSeries(rowsForCodes(e.codes), periodos)),
    }));
    emptyMessage = c.specialEmptyMessage;
  }

  drawLineChart('faCompareChart', periodos, series, {
    valueScale,
    emptyMessage,
    height: 320,
    style: state.chartStyle || 'bars',
    showLegend: true,
  });
}

function setMetric(m) {
  state.metric = m;
  render();
}

function setEntity(id) {
  state.lastEntityId = id;
  render();
}

function setCompare(on) {
  state.compare = !!on;
  render();
}

function setChartStyle(style) {
  if (!['bars', 'lines', 'area'].includes(style)) return;
  state.chartStyle = style;
  render();
}

function renderPeerToolbar() {
  const compareBtns = `
    <div class="fa-compare-toggle" role="group" aria-label="View mode">
      <button type="button" class="rcbtn ${!state.compare ? 'active' : ''}" data-fa-compare="0">Single</button>
      <button type="button" class="rcbtn ${state.compare ? 'active' : ''}" data-fa-compare="1">Compare</button>
    </div>`;
  const n = Math.min(selectedBanks().length, MAX_COMPARE_ENTITIES);
  const hint = n
    ? `<div class="fa-peer-hint">${n} bank${n === 1 ? '' : 's'} from the sidebar${ST.compareMode || n === 1 ? '' : ' — turn on <strong>Bank Comparison</strong> to pick up to 5'}.</div>`
    : '<div class="fa-peer-hint">Select banks in the left sidebar. Turn on <strong>Bank Comparison</strong> to graph/table up to 5 at once.</div>';
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
  document.querySelectorAll('[data-fa-compare]').forEach((btn) => {
    btn.addEventListener('click', () => setCompare(btn.getAttribute('data-fa-compare') === '1'));
  });
}

function render() {
  const root = document.getElementById('fundingAnalyticsRoot');
  if (!root) return;
  const iso = datasetIsoCountry();
  const c = cfg();

  if (!FUNDING_COUNTRIES.has(iso) || !c) {
    root.innerHTML = `<div class="fa-empty">
      <div class="fa-empty-title">Funding Analytics</div>
      <div class="fa-empty-sub">Available for <strong>Brazil</strong>, <strong>Chile</strong> and <strong>Uruguay</strong>. Switch country to explore the ALM funding mix.</div>
    </div>`;
    return;
  }

  if (state.loading) {
    root.innerHTML = `<div class="fa-empty"><div class="ls-bars" aria-hidden="true"><div></div><div></div><div></div><div></div><div></div></div>
      <div class="fa-empty-sub" style="margin-top:16px;">Loading ${esc(c.loadingLabel)} funding stocks…</div></div>`;
    return;
  }

  if (state.error && !state.loaded) {
    root.innerHTML = `
      ${renderPeerToolbar()}
      <div class="fa-empty">
        <div class="fa-empty-title" style="color:var(--red);">${esc(state.error)}</div>
        <button type="button" class="rcbtn" id="faRetry" style="margin-top:12px;">Retry</button>
      </div>`;
    bindPeerToolbar();
    document.getElementById('faRetry')?.addEventListener('click', () => loadFundingData());
    return;
  }

  if (state.loaded && state.iso && state.iso !== c.iso) {
    state.loaded = false;
  }
  if (state.loaded && state.selectionKey !== selectionKey()) {
    state.loaded = false;
  }

  if (!state.loaded) {
    root.innerHTML = `
      ${renderPeerToolbar()}
      <div class="fa-empty">
        <div class="fa-empty-title">${esc(c.title)}</div>
        <div class="fa-empty-sub">${esc(c.sub)}</div>
        <button type="button" class="rcbtn active" id="faLoad" style="margin-top:14px;">Load funding data</button>
      </div>`;
    bindPeerToolbar();
    document.getElementById('faLoad')?.addEventListener('click', () => loadFundingData());
    return;
  }

  const entities = resolveEntities().filter((e) => {
    // Only show entities whose banks were fetched
    const have = new Set(state.banks.map(Number));
    return e.codes.some((code) => have.has(Number(code)));
  });

  if (!entities.length) {
    state.loaded = false;
    state.error = peerEmptyMessage();
    render();
    return;
  }

  let active = entities.find((e) => e.id === state.lastEntityId) || entities[0];
  state.lastEntityId = active.id;

  const comparing = state.compare && entities.length >= 2;
  const entityTabs = entities.map((e) => {
    const on = !comparing && e.id === active.id;
    return `<button type="button" class="rcbtn ${on ? 'active' : ''}" data-fa-entity="${esc(e.id)}" ${comparing ? 'disabled title="Switch to Single to focus one peer"' : ''}>
      <span class="fa-swatch" style="background:${e.color}"></span>${esc(e.short)}
    </button>`;
  }).join('');

  const metricBtns = [
    { key: 'mix', label: comparing ? 'Funding stock' : 'Funding mix' },
    { key: c.specialMetric, label: comparing ? c.specialCompareLabel : c.specialLabel },
    { key: 'cost', label: 'Cost proxy' },
  ].map((m) => `<button type="button" class="rcbtn ${state.metric === m.key ? 'active' : ''}" data-fa-metric="${m.key}">${m.label}</button>`).join('');

  // Stacked instrument charts only for Single + Bars on mix / special composition.
  const stackedNative = !comparing
    && state.chartStyle === 'bars'
    && (state.metric === 'mix' || state.metric === c.specialMetric);

  const chartId = stackedNative
    ? (state.metric === 'mix' ? 'faMixChart' : 'faTaxChart')
    : 'faCompareChart';

  const styleBtns = [
    { key: 'bars', label: 'Bars' },
    { key: 'lines', label: 'Lines' },
    { key: 'area', label: 'Area' },
  ].map((s) => `<button type="button" class="rcbtn ${state.chartStyle === s.key ? 'active' : ''}" data-fa-style="${s.key}">${s.label}</button>`).join('');

  const panelTitle = comparing
    ? (state.metric === 'mix' ? 'Total funding · peer compare'
      : state.metric === 'cost' ? 'Implied funding cost · peer compare'
        : `${c.specialLabel} · peer compare`)
    : (state.metric === 'mix' ? 'Funding mix over time'
      : state.metric === 'cost' ? 'Implied funding cost'
        : c.specialLabel);

  const focusLabel = comparing
    ? entities.map((e) => e.short).join(' · ')
    : active.label;

  root.innerHTML = `
    <div class="fa-hero">
      <div>
        <div class="fa-eyebrow">${esc(c.eyebrow)}</div>
        <div class="fa-title">${esc(c.title)}</div>
        <div class="fa-sub">${esc(c.sub)}</div>
      </div>
      <button type="button" class="rcbtn" id="faReload">Refresh</button>
    </div>

    ${renderPeerToolbar()}

    <div class="fa-toolbar">
      <div class="fa-bank-tabs">${entityTabs}</div>
      <div class="fa-metric-tabs">${metricBtns}</div>
    </div>

    ${comparing ? renderCompareKpis(entities, c) : renderKpis(latestSnapshotFor(active.codes), c)}

    <div class="panel fa-panel" style="margin-top:22px;">
      <div class="panel-head fa-chart-head">
        <div>
          <div class="panel-title">${esc(panelTitle)}</div>
          <div class="panel-sub" id="faTaxSub">${esc(focusLabel)} · ${esc(periodLabel(state.periodos[0]))} — ${esc(periodLabel(state.periodos[state.periodos.length - 1]))}</div>
        </div>
        <div class="fa-chart-styles" role="group" aria-label="Chart style">
          ${labelsToggleHtml('faBtnLabels')}
          ${styleBtns}
        </div>
      </div>
      <div class="panel-body">
        <div class="chart-wrap" style="position:relative;min-height:320px;">
          <canvas id="${chartId}" height="360" style="width:100%;height:360px;"></canvas>
        </div>
      </div>
    </div>

    <div class="panel fa-panel" style="margin-top:18px;">
      <div class="panel-head">
        <div>
          <div class="panel-title">Instrument breakdown · ${esc(periodLabel(state.periodos[state.periodos.length - 1]))}</div>
          <div class="panel-sub">${comparing ? 'Share of funding by peer · rows ranked by first selected bank' : `Share of ${esc(c.fundingLabel)} · local reporting units`}</div>
        </div>
      </div>
      <div class="panel-body" style="overflow-x:auto;padding:0;">
        ${comparing
          ? renderCompareInstrumentTable(entities, c)
          : renderInstrumentTable(latestSnapshotFor(active.codes), c)}
      </div>
    </div>

    ${!comparing ? renderTermPanel(active.codes, c) : ''}

    <ul class="fa-notes">${c.notes.map((n) => `<li>${n}</li>`).join('')}</ul>
  `;

  document.getElementById('faReload')?.addEventListener('click', () => loadFundingData());
  bindPeerToolbar();
  document.querySelectorAll('[data-fa-entity]').forEach((btn) => {
    btn.addEventListener('click', () => {
      if (btn.disabled) return;
      setEntity(btn.getAttribute('data-fa-entity'));
    });
  });
  document.querySelectorAll('[data-fa-metric]').forEach((btn) => {
    btn.addEventListener('click', () => setMetric(btn.getAttribute('data-fa-metric')));
  });
  document.querySelectorAll('[data-fa-style]').forEach((btn) => {
    btn.addEventListener('click', () => setChartStyle(btn.getAttribute('data-fa-style')));
  });

  requestAnimationFrame(() => {
    if (stackedNative) {
      if (state.metric === 'mix') drawMixChart(active.codes, c);
      else drawSpecialChart(active.codes, c);
    } else {
      drawCompareChart(comparing ? entities : [active], c);
    }
  });
}

/** Force reload after sidebar bank selection changes. */
export function refreshFundingAnalytics() {
  const prevKey = state.selectionKey;
  const nextKey = selectionKey();
  syncCompareFromSelection({ preferCompareOnMulti: prevKey !== nextKey && selectedBanks().length >= 2 });
  state.loaded = false;
  state.error = null;
  renderFundingAnalytics();
}

export function renderFundingAnalytics() {
  const iso = datasetIsoCountry();
  if (!FUNDING_COUNTRIES.has(iso)) {
    state.loaded = false;
    state.iso = null;
    state.selectionKey = '';
    render();
    return;
  }
  if (state.loaded && state.iso && state.iso !== iso) {
    state.loaded = false;
    state.selectionKey = '';
  }
  if (state.loaded && state.selectionKey !== selectionKey()) {
    state.loaded = false;
  }
  syncCompareFromSelection();
  const entities = resolveEntities();
  if (!state.loaded && !state.loading && entities.length) {
    if (entities.length >= 2) state.compare = true;
    loadFundingData();
  } else {
    render();
  }
}
