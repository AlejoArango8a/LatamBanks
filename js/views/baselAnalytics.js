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
} from '../clBaselCuentas.js?v=bmon101';
import { ST, datasetIsoCountry } from '../state.js?v=bmon101';
import { apiDatos, fetchData } from '../api.js?v=bmon101';
import { bankName, fmtKPI, periodLabel } from '../format.js?v=bmon101';
import { bankColor, btgBlue, btgRgba, btgCodeForCountry } from '../config.js?v=bmon101';
import { drawLineChart, sparseData } from '../charts.js?v=bmon101';

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

// ---- Foto del sistema -----------------------------------------------------
//
// Los gráficos de arriba viven de la selección del sidebar y del rango de
// fechas. Esta tabla es otra cosa: el sistema entero en un solo mes, para poder
// ubicar a un banco entre sus pares sin tener que elegirlos de a cinco. Por eso
// tiene su propia carga, que pide un único período y sale barata aunque traiga
// todos los bancos.
const systemTable = {
  key: '',
  loading: false,
  error: null,
  rows: [],
  periodo: null,
  // Por tamaño del balance ponderado, no por ratio: ordenar por CET1 dejaría
  // arriba a las agencias de bancos extranjeros, que tienen ratios enormes
  // sobre carteras diminutas y no dicen nada del sistema.
  sort: { col: 'apr', dir: -1 },
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
      // El último mes con filas de Basilea, que es el que retrata el sistema.
      await loadSystemTable(state.periodos[state.periodos.length - 1]);
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

/** Al cambiar de país la foto ya no aplica; el orden elegido sí se conserva. */
function resetSystemTable() {
  systemTable.key = '';
  systemTable.rows = [];
  systemTable.periodo = null;
  systemTable.error = null;
}

/** Trae los ratios y los stocks de todos los bancos para un solo mes. */
async function loadSystemTable(periodo) {
  const key = `${datasetIsoCountry()}|${periodo}`;
  if (!periodo || systemTable.key === key || systemTable.loading) return;
  const codes = Object.keys(ST.bancos).map(Number).filter((c) => Number.isFinite(c));
  if (!codes.length) return;

  systemTable.loading = true;
  systemTable.error = null;
  try {
    systemTable.rows = await apiDatos({
      tipos: ['q1', 'x1'],
      cuentas: [...CL_B3_Q1_ACCOUNTS, ...CL_B3_X1_ACCOUNTS],
      periodos: [periodo],
      bancos: codes,
      select: 'ins_cod,periodo,cuenta,monto_total',
    });
    systemTable.periodo = periodo;
    systemTable.key = key;
  } catch (e) {
    // Que falle la foto no puede tumbar los gráficos: la tabla avisa por su
    // cuenta y el resto de la página queda en pie.
    console.error('[baselAnalytics] system snapshot', e);
    systemTable.error = e?.message || String(e);
    systemTable.rows = [];
    systemTable.periodo = null;
    systemTable.key = '';
  } finally {
    systemTable.loading = false;
  }
}

/** Una fila por entidad con datos de Basilea publicados ese mes. */
function systemRowModels() {
  const periodo = systemTable.periodo;
  if (!periodo) return [];
  const byBank = new Map();
  for (const r of systemTable.rows) {
    const code = Number(r.ins_cod);
    if (!Number.isFinite(code)) continue;
    if (!byBank.has(code)) byBank.set(code, []);
    byBank.get(code).push(r);
  }

  const out = [];
  for (const [code, rows] of byBank) {
    // Los ratios (q1) y los stocks (x1) no comparten nombres de cuenta, así que
    // el mismo arreglo sirve de fuente para los dos.
    const snap = clB3Snapshot(rows, rows, periodo);
    if (snap.cet1Apr == null && snap.apr == null) continue;
    out.push({
      code,
      name: code === SISTEMA ? 'System Total' : bankDisplayName(code),
      snap,
      // Cuánto pondera el regulador el balance. Sale de los dos stocks que ya
      // vinieron, así que compara consolidado contra consolidado.
      density: snap.apr != null && snap.atr ? (snap.apr / snap.atr) * 100 : null,
    });
  }
  return out;
}

const SYSTEM_COLUMNS = [
  {
    key: 'cet1Apr', label: 'CET1 / RWA', width: '11%',
    value: (r) => r.snap.cet1Apr,
    tip: 'Common Equity Tier 1 over risk-weighted assets. CMF: Capital Básico (CET1) / APR.',
  },
  {
    key: 't1Apr', label: 'Tier 1 / RWA', width: '11%',
    value: (r) => r.snap.t1Apr,
    tip: 'CET1 plus additional Tier 1 instruments, over risk-weighted assets. CMF: Capital Nivel 1 / APR.',
  },
  {
    key: 'peApr', label: 'Total Capital / RWA', width: '13%',
    value: (r) => r.snap.peApr,
    tip: 'Every layer of regulatory capital, Tier 2 included, over risk-weighted assets. CMF: Patrimonio Efectivo / APR.',
  },
  {
    key: 'lev', label: 'Leverage', width: '10%',
    value: (r) => r.snap.lev,
    tip: 'CET1 over total regulatory assets, with no risk weighting applied. CMF: Capital Básico / Activos Totales Regulatorios.',
  },
  {
    key: 'density', label: 'RWA Density', width: '10%',
    value: (r) => r.density,
    tip: 'Risk-weighted assets over total regulatory assets. A low density means a book the regulator weights lightly, which is not the same as a strong capital position.',
  },
  {
    key: 'apr', label: 'RWA', width: '14%',
    value: (r) => r.snap.apr,
    fmt: (v) => (v != null ? fmtKPI(v) : '—'),
    tip: 'Risk-weighted assets: credit, market and operational added together. CMF: APR.',
  },
];

const SYSTEM_COLUMN_BY_KEY = new Map(SYSTEM_COLUMNS.map((c) => [c.key, c]));

function sortedSystemRows() {
  const rows = systemRowModels();
  // El Sistema no compite en el ranking: es la suma de los demás y va al pie.
  const system = rows.find((r) => r.code === SISTEMA) || null;
  const banks = rows.filter((r) => r.code !== SISTEMA);

  const { col, dir } = systemTable.sort;
  if (col === 'name') {
    banks.sort((a, b) => dir * a.name.localeCompare(b.name));
    return { banks, system };
  }
  const value = (SYSTEM_COLUMN_BY_KEY.get(col) || SYSTEM_COLUMN_BY_KEY.get('apr')).value;
  banks.sort((a, b) => {
    const av = value(a);
    const bv = value(b);
    // Sin dato no hay dónde ubicarlo en la escala, así que queda al final en
    // los dos sentidos: intercalarlo entre cifras reales confundiría.
    if (av == null && bv == null) return 0;
    if (av == null) return 1;
    if (bv == null) return -1;
    return dir * (av - bv);
  });
  return { banks, system };
}

function sortSystemBy(col) {
  const s = systemTable.sort;
  if (s.col === col) s.dir *= -1;
  else { s.col = col; s.dir = col === 'name' ? 1 : -1; }
  paintShell();
  requestAnimationFrame(() => paintCharts());
}

/** Bancos que están dibujados en el gráfico, para poder reconocerlos en la tabla. */
function plottedColors() {
  const map = new Map();
  resolveEntities().forEach((e, i) => {
    map.set(Number(e.codes[0]), bankColor(e.codes[0], i, e.label) || CL_B3_COLORS.system);
  });
  return map;
}

function systemCellHtml(col, row) {
  const v = col.value(row);
  const text = col.fmt ? col.fmt(v) : fmtPct(v);
  // La clase por columna es lo que deja al CSS esconder celdas sueltas en móvil.
  return `<td class="r b3-sys-num b3-sys-col-${col.key}">${esc(text)}</td>`;
}

function systemTableHtml() {
  if (systemTable.error) {
    return `<div class="fa-empty"><div class="fa-empty-sub" style="color:var(--red);">
      Could not load the system snapshot: ${esc(systemTable.error)}
    </div></div>`;
  }
  const { banks, system } = sortedSystemRows();
  if (!banks.length && !system) {
    return `<div class="fa-empty"><div class="fa-empty-sub">No published solvency figures for this month.</div></div>`;
  }

  const { col, dir } = systemTable.sort;
  const arrow = (c) => (col === c ? (dir === 1 ? ' ↑' : ' ↓') : ' ↕');
  const head = SYSTEM_COLUMNS.map((c) => `<th class="r b3-sys-sort" style="width:${c.width};"
    data-b3-sort="${c.key}" title="${esc(c.tip)}">${esc(c.label)}${arrow(c.key)}</th>`).join('');

  const btgCode = btgCodeForCountry();
  const colors = plottedColors();

  const bodyRows = banks.map((r, i) => {
    const isBtg = btgCode != null && r.code === btgCode;
    const plotted = colors.get(r.code);
    const dot = plotted
      ? `<span class="b3-sys-dot" style="background:${esc(plotted)}" title="Plotted in the chart above"></span>`
      : '<span class="b3-sys-dot b3-sys-dot-off"></span>';
    return `<tr class="b3-sys-row${isBtg ? ' b3-sys-btg' : ''}"
      data-b3-focus="${r.code}"
      title="Click to plot ${esc(r.name)} in the chart above"
      ${isBtg ? `style="background:${btgRgba(0.08)};border-left:3px solid ${btgBlue()};"` : ''}>
      <td class="b3-sys-rank">${i + 1}</td>
      <td class="b3-sys-name"${isBtg ? ` style="color:${btgBlue()};font-weight:700;"` : ''}>${dot}${isBtg ? '★ ' : ''}${esc(r.name)}</td>
      ${SYSTEM_COLUMNS.map((c) => systemCellHtml(c, r)).join('')}
    </tr>`;
  }).join('');

  const systemRow = system ? `<tr class="b3-sys-total">
    <td class="b3-sys-rank"></td>
    <td class="b3-sys-name">${esc(system.name)}</td>
    ${SYSTEM_COLUMNS.map((c) => systemCellHtml(c, system)).join('')}
  </tr>` : '';

  return `<div style="overflow-x:auto;">
    <table class="data fa-table b3-sys-table" style="table-layout:fixed;width:100%;">
      <thead><tr>
        <th class="b3-sys-rank" style="width:5%;">#</th>
        <th class="b3-sys-sort" style="width:26%;" data-b3-sort="name">Bank${arrow('name')}</th>
        ${head}
      </tr></thead>
      <tbody>${bodyRows}${systemRow}</tbody>
    </table>
  </div>`;
}

function bindSystemTable() {
  document.querySelectorAll('[data-b3-sort]').forEach((th) => {
    th.addEventListener('click', () => sortSystemBy(th.getAttribute('data-b3-sort')));
  });
  document.querySelectorAll('[data-b3-focus]').forEach((tr) => {
    tr.addEventListener('click', () => {
      const code = Number(tr.getAttribute('data-b3-focus'));
      // El sidebar es el dueño de la selección; al cambiarla, él mismo dispara
      // el refresco de esta pestaña.
      if (Number.isFinite(code)) window.toggleBank?.(code, true);
    });
  });
  const btn = document.getElementById('b3SysExport');
  if (btn && typeof window.exportTableById === 'function') {
    btn.onclick = () => window.exportTableById('b3SystemTable', 'Chilean_Banking_Solvency');
  }
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

  const systemBanksCount = sortedSystemRows().banks.length;
  // La CMF publica el capital un mes después del balance. Si no se dice, la
  // fecha de esta tabla parece un error frente al resto de la plataforma.
  const lastBalance = ST.periodos?.[ST.periodos.length - 1];
  const shownPeriod = systemTable.periodo || periodo;
  const systemLagNote = lastBalance && shownPeriod && lastBalance > shownPeriod
    ? ` · the CMF publishes capital a month behind the balance sheet, already at ${esc(periodLabel(lastBalance))}`
    : '';

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
      <div class="panel-head" style="display:flex;justify-content:space-between;align-items:flex-start;gap:12px;">
        <div>
          <div class="panel-title">System solvency · ${esc(periodLabel(systemTable.periodo || periodo))}</div>
          <div class="panel-sub">${systemBanksCount} banks with published Basilea III figures${systemLagNote} · click a row to plot it above</div>
        </div>
        <button type="button" class="rcbtn" id="b3SysExport">Export</button>
      </div>
      <div class="panel-body" id="b3SystemTable" style="padding:0;">
        ${systemTable.loading
          ? '<div class="fa-empty"><div class="fa-empty-sub">Loading the system snapshot…</div></div>'
          : systemTableHtml()}
      </div>
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
  bindSystemTable();
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
    resetSystemTable();
    paintShell();
    return;
  }

  if (state.loaded && state.iso && state.iso !== iso) {
    state.loaded = false;
    state.selectionKey = '';
    state.error = null;
    resetSystemTable();
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
