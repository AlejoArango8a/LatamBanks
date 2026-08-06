// ============================================================
// APP — entry point: init(), boot, window.* global exposure
// ============================================================
import { API_BASE } from './config.js?v=bmon72';
import { ST, datasetIsoCountry } from './state.js?v=bmon72';
import { setStatus, showErr, setLsMsg } from './utils.js?v=bmon72';
import { fetchWithTimeout } from './api.js?v=bmon72';
import { loadPaises, resolveCountryKey, pais } from './paises.js?v=bmon72';

// Views
import { run, refreshKPIs, showResChart, showROEChart, setNiMode, toggleDeltaMode } from './views/resumen.js?v=bmon72';
import {
  showBalTab, selectBalBank, renderResTable, selectResBank, renderCalidad, renderComparativo,
  syncFinStatementPanelLabels,
} from './views/balance.js?v=bmon72';
import { initAccountView, avClearAccount, avSelectGroup, avSuggest, avTreeToggle, avSelectAccount, runAccountView } from './views/accountview.js?v=bmon72';
import { renderChileanBanks, sortCBBy, renderCBTable, renderRatingsEditor, updateRating } from './views/ranking.js?v=bmon72';
import { renderBankDetail } from './views/bankDetail.js?v=bmon72';
import { renderBtgBanks } from './views/btgBanks.js?v=bmon72';
import { renderFundingAnalytics, refreshFundingAnalytics } from './views/fundingAnalytics.js?v=bmon77';
import { renderAssetQuality, refreshAssetQuality } from './views/assetQuality.js?v=bmon76';
import { renderBaselAnalytics, refreshBaselAnalytics } from './views/baselAnalytics.js?v=bmon78';
import { populateConfig, trackVisit, loadVisitStats } from './views/config_tab.js?v=bmon72';
import { openCustomKpiPicker } from './views/customKpiPicker.js?v=bmon72';

// UI
import {
  fillPeriodSelectors, fillBankList, toggleBank, selAll,
  setCompareMode, toggleCompareMode, syncCompareToggleUI,
  showTab, loadBankFromTable, goHome, toggleSidebar, toggleSection, selectCountry,
  syncCountryFlagsVisual,
  syncBrandLogoByTheme, toggleTheme, toggleBarLabels, refreshBarLabelsToggleButtons,
  fetchUSDRate, convertAmt, toggleCurrency, syncCurrencyToggleUI, refreshMoneyDenominatedUI,
  setFont, changeFontSize, resetFontSize, applyFontSize,
  initTopbarTabsOverflow,
  syncResumenMoraChartButton,
  syncCountryChartButtons, syncCountryDisabledTabs,
} from './ui.js?v=bmon76';

// Export helpers
import { exportTableById, exportChartTable } from './export.js?v=bmon72';
import { patchColombiaGrupoAvalBootstrap } from './coGrupoAval.js?v=bmon72';

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

/** Same full-screen loader as initial bootstrap (#loadingScreen · centered bars). */
function setDashboardLoadingOverlay(visible, message) {
  const el = document.getElementById('loadingScreen');
  if (!el) return;
  if (visible) {
    el.style.display = 'flex';
    if (message) setLsMsg(message);
    const retry = document.getElementById('lsRetryBtn');
    if (retry) retry.style.display = 'none';
  } else {
    el.style.display = 'none';
  }
}

function applyCountryFromUrl() {
  try {
    const raw = new URLSearchParams(location.search).get('country');
    const z = String(raw || '').trim().toLowerCase();
    if (!z) return;
    const key = resolveCountryKey(z);
    if (key && pais(key).status === 'live') ST.country = key;
    const overlay = document.getElementById('countryOverlay');
    if (overlay && pais(ST.country).status === 'live')
      overlay.style.display = 'none';
    syncCountryFlagsVisual(ST.country);
  } catch (_) { /* noop */ }
}

function applyTabFromUrl() {
  try {
    const raw = new URLSearchParams(location.search).get('tab');
    const tab = String(raw || '').trim().toLowerCase();
    if (!tab) return null;
    const allowed = new Set([
      'resumen', 'bankdetail', 'chileanbanks', 'btgbanks',
      'accountview', 'balance', 'resultados', 'config',
    ]);
    return allowed.has(tab) ? tab : null;
  } catch (_) {
    return null;
  }
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

let _switchGen = 0;

async function switchCountryDataset() {
  const gen = ++_switchGen;
  const targetCountry = ST.country;

  // Limpiar estado de dataset anterior de inmediato (evitar bancos/KPIs cruzados)
  ST.data = {};
  ST._series = null;
  ST._kpiRaw = null;
  ST._b1 = null;
  ST._c1 = null;
  ST._cbData = null;
  ST._resTableData = null;
  ST._avAccount = null;
  ST._avTreeExpanded = {};
  ST._avGroup = '';
  ST.periodos = [];
  ST.bancos = {};
  ST._patrimonioMap = {};
  ST._patrimonioRanking = [];
  ST.selected.clear();
  ST.selectedOrder = [];
  showErr('');
  setStatus('loading', 'Updating data…');
  setDashboardLoadingOverlay(true, 'Switching country — loading data and charts…');
  try {
    await fetchAndApplyBootstrap();
    if (gen !== _switchGen || ST.country !== targetCountry) return;

    fillPeriodSelectors();
    await fetchUSDRate().catch(() => false);
    if (gen !== _switchGen || ST.country !== targetCountry) return;
    syncCurrencyToggleUI();
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
    ST.compareMode = false;
    syncCompareToggleUI();
    const isoSwitch = datasetIsoCountry();
    let defaultBank = 59;
    if (isoSwitch === 'CO') defaultBank = 66;
    else if (isoSwitch === 'BR') defaultBank = 1000080336;
    else if (isoSwitch === 'UY') defaultBank = 157;      // BTG Pactual Uruguay
    else if (isoSwitch === 'US') defaultBank = 35154;    // BTG Pactual Bank, N.A.
    else if (isoSwitch === 'PE' || isoSwitch === 'AR'
          || isoSwitch === 'MX' || isoSwitch === 'PA') {
      // PE BCP=3 · AR Nación=11 · MX BBVA=12 · PA top equity
      defaultBank = ST._patrimonioRanking?.[0]
        ?? (isoSwitch === 'PE' ? 3
          : isoSwitch === 'AR' ? 11
          : isoSwitch === 'MX' ? 12
          : 1);
    }
    toggleBank(defaultBank, true);
    fillBankList();
    ST.desde = selDesde?.value ?? null;
    ST.hasta = selHasta?.value ?? null;

    await run();
    if (gen !== _switchGen || ST.country !== targetCountry) return;

    refreshBarLabelsToggleButtons();
    syncCountryChartButtons();
    syncCountryDisabledTabs();
    setStatus('ok', `${datasetIsoCountry()} · ${ST.periodos.length} periods`);

    const activeTab = document.querySelector('.tab.active[data-tab]')?.getAttribute('data-tab');
    if (activeTab === 'chileanbanks') await renderChileanBanks();
    else if (activeTab === 'accountview') initAccountView();
  } catch (e) {
    if (gen !== _switchGen) return;
    // Fail closed: no dejar datos del país anterior bajo la bandera nueva
    ST.periodos = [];
    ST.bancos = {};
    ST._patrimonioMap = {};
    ST._patrimonioRanking = [];
    ST._series = null;
    ST._kpiRaw = null;
    ST._b1 = null;
    fillPeriodSelectors();
    fillBankList();
    setStatus('error', 'Country update');
    showErr(e.message || String(e));
    console.error('[switchCountryDataset]', e);
  } finally {
    if (gen === _switchGen) {
      setDashboardLoadingOverlay(false);
      syncCurrencyToggleUI();
      syncFinStatementPanelLabels();
      syncResumenMoraChartButton();
    }
  }
}

// ---- init() ----
async function init() {
  // Declared outside try/catch so both blocks can access it.
  let wakeTimer;
  try {
    setStatus('loading', 'Connecting...');
    setLsMsg('Connecting to server...');
    await loadPaises();          // registro único de países (respaldo interno si falla)
    applyCountryFromUrl();
    syncCurrencyToggleUI();
    syncResumenMoraChartButton();

    // The serverless API (Vercel) may be cold-starting on the first request.
    // Show a friendly message after 6 seconds so the user knows it's still working.
    wakeTimer = setTimeout(() => {
      setLsMsg('Server is waking up — this can take up to 60 s on first load...');
    }, 6000);

    await fetchAndApplyBootstrap();
    clearTimeout(wakeTimer);

    fillPeriodSelectors();
    await fetchUSDRate().catch(() => false);
    syncCurrencyToggleUI();
    fillBankList();

    ST.lastPeriodo = ST.periodos[ST.periodos.length - 1];
    setLsMsg('Ready');
    document.getElementById('loadingScreen').style.display = 'none';
    setStatus('ok', `${datasetIsoCountry()} · ${ST.periodos.length} periods available`);

    const n = ST.periodos.length;
    const desdeIdx = Math.max(0, n - 13);
    document.getElementById('selDesde').selectedIndex = desdeIdx;
    document.getElementById('selHasta').selectedIndex = n - 1;
    const isoInit = datasetIsoCountry();
    {
      let def = 59;
      if (isoInit === 'CO') def = 66;
      else if (isoInit === 'BR') def = 1000080336;
      else if (isoInit === 'UY') def = 157;       // BTG Pactual Uruguay
      else if (isoInit === 'US') def = 35154;     // BTG Pactual Bank, N.A.
      else if (isoInit === 'PE' || isoInit === 'AR'
            || isoInit === 'MX' || isoInit === 'PA') {
        def = ST._patrimonioRanking?.[0]
          ?? (isoInit === 'PE' ? 3
            : isoInit === 'AR' ? 11
            : isoInit === 'MX' ? 12
            : 1);
      }
      toggleBank(def, true);
    }
    fillBankList();
    syncResumenMoraChartButton();
    await run();
    syncFinStatementPanelLabels();
    const startTab = applyTabFromUrl() || 'resumen';
    showTab(startTab);
    refreshBarLabelsToggleButtons();
    syncCountryChartButtons();
    syncCountryDisabledTabs();
    trackVisit();

    setInterval(() => fetch(`${API_BASE}/health`).catch(() => {}), 14 * 60 * 1000);

  } catch (e) {
    clearTimeout(wakeTimer);
    setStatus('error', 'Connection error');
    const msg = e.name === 'AbortError'
      ? 'Timeout: the server took too long. Try again in a few seconds.'
      : `Error: ${e.message}`;
    setLsMsg('Could not connect to the server.');
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
window.setNiMode       = setNiMode;
window.toggleDeltaMode = toggleDeltaMode;

// Balance / P&L
window.showBalTab      = showBalTab;
window.selectBalBank   = selectBalBank;
window.renderResTable  = renderResTable;
window.selectResBank   = selectResBank;
window.renderCalidad   = renderCalidad;
window.renderComparativo = renderComparativo;

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
window.renderBtgBanks     = renderBtgBanks;
window.renderFundingAnalytics = renderFundingAnalytics;
window.refreshFundingAnalytics = refreshFundingAnalytics;
window.renderAssetQuality = renderAssetQuality;
window.refreshAssetQuality = refreshAssetQuality;
window.renderBaselAnalytics = renderBaselAnalytics;
window.refreshBaselAnalytics = refreshBaselAnalytics;

// Config tab
window.populateConfig   = populateConfig;
window.loadVisitStats   = loadVisitStats;
window.openCustomKpiPicker = openCustomKpiPicker;

// Config sub-tabs: Formats / Country details / Database alerts
window.showConfigTab = function (name) {
  ['formats', 'countries', 'alerts'].forEach(k => {
    const pane = document.getElementById('cfg-' + k);
    if (pane) pane.style.display = (k === name) ? 'block' : 'none';
    const btn = document.getElementById('cfgtab-' + k);
    if (btn) btn.classList.toggle('active', k === name);
  });
};

// UI
window.fillBankList     = fillBankList;
window.toggleBank       = toggleBank;
window.selAll           = selAll;
window.setCompareMode   = setCompareMode;
window.toggleCompareMode = toggleCompareMode;
window.showTab          = showTab;
window.renderBankDetail = renderBankDetail;
window.loadBankFromTable = loadBankFromTable;
window.goHome           = goHome;
window.toggleSidebar    = toggleSidebar;
window.toggleSection    = toggleSection;
window.selectCountry    = selectCountry;
window.toggleTheme      = toggleTheme;
window.toggleBarLabels  = toggleBarLabels;
window.refreshBarLabelsToggleButtons = refreshBarLabelsToggleButtons;
window.toggleCurrency   = toggleCurrency;
window.refreshMoneyDenominatedUI = refreshMoneyDenominatedUI;
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
