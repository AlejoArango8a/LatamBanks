// ============================================================
// APP — entry point: init(), boot, window.* global exposure
// ============================================================
import { API_BASE } from './config.js?v=bmon14';
import { ST, datasetIsoCountry } from './state.js?v=bmon14';
import { setStatus, showErr, setLsMsg } from './utils.js?v=bmon14';
import { fetchWithTimeout } from './api.js?v=bmon14';

// Views
import { run, refreshKPIs, showResChart, showROEChart } from './views/resumen.js?v=bmon14';
import {
  showBalTab, selectBalBank, renderResTable, selectResBank, renderCalidad, renderComparativo,
  syncFinStatementPanelLabels,
} from './views/balance.js?v=bmon14';
import { initExplorer, expSelect, expGoBack, expTreeToggle, toggleExpSubFilter, sortExpSubBy, renderExpGrid } from './views/explorer.js?v=bmon14';
import { initAccountView, avClearAccount, avSelectGroup, avSuggest, avTreeToggle, avSelectAccount, runAccountView } from './views/accountview.js?v=bmon14';
import { renderChileanBanks, sortCBBy, renderCBTable, renderRatingsEditor, updateRating } from './views/ranking.js?v=bmon14';
import { populateConfig, trackVisit, loadVisitStats } from './views/config_tab.js?v=bmon14';

// UI
import {
  fillPeriodSelectors, fillBankList, toggleBank, selAll,
  showTab, loadBankFromTable, goHome, toggleSidebar, toggleSection, selectCountry,
  syncCountryFlagsVisual,
  syncBrandLogoByTheme, toggleTheme, toggleBarLabels, refreshBarLabelsToggleButtons,
  fetchUSDRate, convertAmt, toggleCurrency, syncCurrencyToggleUI,
  setFont, changeFontSize, resetFontSize, applyFontSize,
  initTopbarTabsOverflow,
} from './ui.js?v=bmon14';

// Export helpers
import { exportTableById, exportChartTable } from './export.js?v=bmon14';
import { patchColombiaGrupoAvalBootstrap } from './coGrupoAval.js?v=bmon14';

function applyBootstrapPayload(j) {
  ST.periodos = j.periodos || [];
  ST.bancos = {};
  (j.instituciones || []).forEach(row => {
    ST.bancos[row.codigo] = row.razon_social;
  });
  ST.planCuentas = {};
  if (Array.isArray(j.planCuentas)) {
    j.planCuentas.forEach(row => {
      ST.planCuentas[row.cuenta] = row.descripcion;
    });
  }
  ST._patrimonioMap = {};
  ST._patrimonioRanking = [];
  if (Array.isArray(j.patrimonioRows) && j.patrimonioRows.length) {
    const patMap = {};
    j.patrimonioRows.forEach(row => {
      const cod = Number(row.ins_cod);
      patMap[cod] = (patMap[cod] || 0) + row.monto_total;
    });
    ST._patrimonioMap     = patMap;
    ST._patrimonioRanking = Object.keys(patMap).map(Number).filter(c => c !== 999)
      .sort((a, b) => (patMap[b] || 0) - (patMap[a] || 0));
  }
  if (datasetIsoCountry() === 'CO') patchColombiaGrupoAvalBootstrap();
}

function applyCountryFromUrl() {
  try {
    const raw = new URLSearchParams(location.search).get('country');
    const z = String(raw || '').trim().toLowerCase();
    if (!z) return;
    if (['colombia', 'co'].includes(z)) ST.country = 'colombia';
    else if (['chile', 'cl'].includes(z)) ST.country = 'chile';
    const overlay = document.getElementById('countryOverlay');
    if (overlay && (ST.country === 'chile' || ST.country === 'colombia'))
      overlay.style.display = 'none';
    syncCountryFlagsVisual(ST.country);
  } catch (_) { /* noop */ }
}

async function fetchAndApplyBootstrap() {
  const cc = encodeURIComponent(datasetIsoCountry());
  const r = await fetchWithTimeout(`${API_BASE}/api/bootstrap?country=${cc}`, {}, 60000);
  const j = await r.json();
  if (!r.ok || !j.ok) throw new Error(j.error || `Bootstrap error ${r.status}`);
  if (!Array.isArray(j.periodos) || !j.periodos.length) {
    throw new Error(j.error || 'No data found in database');
  }
  applyBootstrapPayload(j);
}

async function switchCountryDataset() {
  ST.data = {};
  ST._series = null;
  ST._kpiRaw = null;
  ST._b1 = null;
  ST._c1 = null;
  ST._cbData = null;
  ST._resTableData = null;
  ST.exp.hierarchy = null;
  ST.exp.selected = null;
  ST.exp.history = [];
  ST._expRenderTree = null;
  ST._expTreeExpanded = {};
  ST._avAccount = null;
  ST._avTreeExpanded = {};
  ST._avGroup = '';
  showErr('');
  setStatus('loading', 'Actualizando datos…');
  try {
    await fetchAndApplyBootstrap();
    fillPeriodSelectors();
    fillBankList();

    ST.lastPeriodo = ST.periodos[ST.periodos.length - 1];

    const n = ST.periodos.length;
    const desdeIdx = Math.max(0, n - 13);
    const selDesde = document.getElementById('selDesde');
    const selHasta = document.getElementById('selHasta');
    if (selDesde) selDesde.selectedIndex = desdeIdx;
    if (selHasta) selHasta.selectedIndex = n - 1;
    ST.selected.clear();
    ST.selectedOrder = [];
    const defaultBank = datasetIsoCountry() === 'CO' ? 66 : 59;
    toggleBank(defaultBank, true);
    fillBankList();
    ST.desde = selDesde?.value ?? null;
    ST.hasta = selHasta?.value ?? null;

    await run();
    refreshBarLabelsToggleButtons();
    setStatus('ok', `${datasetIsoCountry()} · ${ST.periodos.length} períodos`);
    fetchUSDRate().catch(() => {});

    const activeTab = document.querySelector('.tab.active[data-tab]')?.getAttribute('data-tab');
    if (activeTab === 'chileanbanks') await renderChileanBanks();
    else if (activeTab === 'accountview') initAccountView();
    else if (activeTab === 'explorador' && Object.keys(ST.planCuentas).length > 0) initExplorer();
  } catch (e) {
    setStatus('error', 'Actualización país');
    showErr(e.message || String(e));
    console.error('[switchCountryDataset]', e);
  } finally {
    syncCurrencyToggleUI();
    syncFinStatementPanelLabels();
  }
}

// ---- init() ----
async function init() {
  // Declared outside try/catch so both blocks can access it.
  let wakeTimer;
  try {
    setStatus('loading', 'Connecting...');
    setLsMsg('Connecting to server...');
    applyCountryFromUrl();
    syncCurrencyToggleUI();

    // The server may be cold-starting (Render free tier sleeps after inactivity).
    // Show a friendly message after 6 seconds so the user knows it's still working.
    wakeTimer = setTimeout(() => {
      setLsMsg('Server is waking up — this can take up to 60 s on first load...');
    }, 6000);

    await fetchAndApplyBootstrap();
    clearTimeout(wakeTimer);

    fillPeriodSelectors();
    fillBankList();

    ST.lastPeriodo = ST.periodos[ST.periodos.length - 1];
    setLsMsg('Listo');
    document.getElementById('loadingScreen').style.display = 'none';
    setStatus('ok', `${datasetIsoCountry()} · ${ST.periodos.length} periods available`);

    const n = ST.periodos.length;
    const desdeIdx = Math.max(0, n - 13);
    document.getElementById('selDesde').selectedIndex = desdeIdx;
    document.getElementById('selHasta').selectedIndex = n - 1;
    toggleBank(datasetIsoCountry() === 'CO' ? 66 : 59, true);
    fillBankList();
    await run();
    syncFinStatementPanelLabels();
    showTab('resumen');
    refreshBarLabelsToggleButtons();
    trackVisit();

    await fetchUSDRate().catch(() => {});

    setInterval(() => fetch(`${API_BASE}/health`).catch(() => {}), 14 * 60 * 1000);

  } catch (e) {
    clearTimeout(wakeTimer);
    setStatus('error', 'Connection error');
    const msg = e.name === 'AbortError'
      ? 'Timeout: el servidor tardó demasiado. Reintenta en unos segundos.'
      : `Error: ${e.message}`;
    setLsMsg('No se pudo conectar al servidor.');
    showErr(msg);
    const retryBtn = document.getElementById('lsRetryBtn');
    if (retryBtn) retryBtn.style.display = 'block';
    console.error('[init] Error:', e.name, e.message, e);
  }
}

// ---- Expose to window (required for inline HTML event handlers) ----
window.switchCountryDataset = switchCountryDataset;

// Core
window.run             = run;
window.refreshKPIs     = refreshKPIs;

// Resumen
window.showResChart    = showResChart;
window.showROEChart    = showROEChart;

// Balance / P&L
window.showBalTab      = showBalTab;
window.selectBalBank   = selectBalBank;
window.renderResTable  = renderResTable;
window.selectResBank   = selectResBank;
window.renderCalidad   = renderCalidad;
window.renderComparativo = renderComparativo;

// Explorer
window.initExplorer       = initExplorer;
window.expSelect          = expSelect;
window.expGoBack          = expGoBack;
window.expTreeToggle      = expTreeToggle;
window.toggleExpSubFilter = toggleExpSubFilter;
window.sortExpSubBy       = sortExpSubBy;

// Account View
window.initAccountView  = initAccountView;
window.avClearAccount   = avClearAccount;
window.avSelectGroup    = avSelectGroup;
window.avSuggest        = avSuggest;
window.avTreeToggle     = avTreeToggle;
window.avSelectAccount  = avSelectAccount;
window.runAccountView   = runAccountView;

// Banking System (ranking)
window.renderChileanBanks = renderChileanBanks;
window.sortCBBy           = sortCBBy;
window.renderCBTable      = renderCBTable;
window.renderRatingsEditor = renderRatingsEditor;
window.updateRating       = updateRating;

// Config tab
window.populateConfig   = populateConfig;
window.loadVisitStats   = loadVisitStats;

// UI
window.fillBankList     = fillBankList;
window.toggleBank       = toggleBank;
window.selAll           = selAll;
window.showTab          = showTab;
window.loadBankFromTable = loadBankFromTable;
window.goHome           = goHome;
window.toggleSidebar    = toggleSidebar;
window.toggleSection    = toggleSection;
window.selectCountry    = selectCountry;
window.toggleTheme      = toggleTheme;
window.toggleBarLabels  = toggleBarLabels;
window.toggleCurrency   = toggleCurrency;
window.convertAmt       = convertAmt;
window.setFont          = setFont;
window.changeFontSize   = changeFontSize;
window.resetFontSize    = resetFontSize;
window.applyFontSize    = applyFontSize;

// Export
window.exportTableById  = exportTableById;
window.exportChartTable = exportChartTable;

// ---- Boot ----
document.body.classList.add('light');
ST.theme = 'light';

const _darkBtn  = document.getElementById('switchDark');
const _lightBtn = document.getElementById('switchLight');
if (_darkBtn && _lightBtn) {
  _darkBtn.style.background  = 'transparent';
  _darkBtn.style.color       = 'var(--text3)';
  _lightBtn.style.background = 'var(--accent)';
  _lightBtn.style.color      = '#fff';
}
syncBrandLogoByTheme();

if (document.getElementById('switchCLP') && document.getElementById('switchUSD')) syncCurrencyToggleUI();

initTopbarTabsOverflow();
init();
