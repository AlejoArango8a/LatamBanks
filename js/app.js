// ============================================================
// APP — entry point: init(), boot, window.* global exposure
// ============================================================
import { API_BASE } from './config.js?v=bmon97';
import { ST, datasetIsoCountry } from './state.js?v=bmon97';
import { setStatus, showErr, setLsMsg, showDataErrorDialog } from './utils.js?v=bmon97';
import { fetchWithTimeout } from './api.js?v=bmon97';
import { loadPaises, resolveCountryKey, pais } from './paises.js?v=bmon97';

// Views
import { run, refreshKPIs, showResChart, showROEChart, setNiMode, toggleDeltaMode } from './views/resumen.js?v=bmon97';
import {
  showBalTab, selectBalBank, renderResTable, selectResBank, renderCalidad, renderComparativo,
  syncFinStatementPanelLabels,
} from './views/balance.js?v=bmon97';
import { initAccountView, avClearAccount, avSelectGroup, avSuggest, avTreeToggle, avSelectAccount, runAccountView } from './views/accountview.js?v=bmon97';
import { renderChileanBanks, sortCBBy, renderCBTable, renderRatingsEditor, updateRating, ensureClRatingsLoaded } from './views/ranking.js?v=bmon97';
import { refreshChileMacrosStrip } from './chileMacros.js?v=bmon97';
import { renderBankDetail } from './views/bankDetail.js?v=bmon97';
import { renderBtgBanks } from './views/btgBanks.js?v=bmon97';
import { renderFundingAnalytics, refreshFundingAnalytics } from './views/fundingAnalytics.js?v=bmon97';
import { renderAssetQuality, refreshAssetQuality } from './views/assetQuality.js?v=bmon97';
import { renderBaselAnalytics, refreshBaselAnalytics } from './views/baselAnalytics.js?v=bmon97';
import { renderInstitutionalFunding, refreshInstitutionalFunding } from './views/institutionalFunding.js?v=bmon97';
import { populateConfig, trackVisit, loadVisitStats } from './views/config_tab.js?v=bmon97';
import { paintRatingsAdmin, ratingsAdmin } from './views/ratingsAdmin.js?v=bmon97';
import { openCustomKpiPicker } from './views/customKpiPicker.js?v=bmon97';

// UI
import {
  fillPeriodSelectors, fillBankList, toggleBank, selAll, defaultBankForCountry,
  setCompareMode, toggleCompareMode, syncCompareToggleUI,
  showTab, loadBankFromTable, goHome, toggleSidebar, toggleSection, selectCountry,
  syncCountryFlagsVisual,
  syncBrandLogoByTheme, toggleTheme, toggleBarLabels, refreshBarLabelsToggleButtons,
  fetchUSDRate, convertAmt, toggleCurrency, syncCurrencyToggleUI, refreshMoneyDenominatedUI,
  setFont, restoreFont, changeFontSize, resetFontSize, applyFontSize,
  initTopbarTabsOverflow,
  syncResumenMoraChartButton,
  syncCountryChartButtons, syncCountryDisabledTabs,
} from './ui.js?v=bmon97';

// Export helpers
import { exportTableById, exportChartTable } from './export.js?v=bmon97';
import { patchColombiaGrupoAvalBootstrap } from './coGrupoAval.js?v=bmon97';

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
      'accountview', 'balance', 'resultados', 'instfunding', 'config',
    ]);
    return allowed.has(tab) ? tab : null;
  } catch (_) {
    return null;
  }
}

async function fetchAndApplyBootstrap() {
  const cc = encodeURIComponent(datasetIsoCountry());
  const r = await fetchWithTimeout(`${API_BASE}/api/bootstrap?country=${cc}`, {}, 60000);
  let j = null;
  try { j = await r.json(); } catch (_) { j = null; }
  if (!r.ok || !j?.ok) {
    const err = new Error(j?.error || `Bootstrap error ${r.status}`);
    err.status = r.status;
    err.raw = `${err.message} [/api/bootstrap?country=${cc}]`;
    throw err;
  }
  if (!Array.isArray(j.periodos) || !j.periodos.length) {
    const err = new Error(j.error || 'No data found in database');
    err.raw = `${err.message} [/api/bootstrap?country=${cc}]`;
    throw err;
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
    await refreshChileMacrosStrip().catch(() => {});
    if (datasetIsoCountry() === 'CL') await ensureClRatingsLoaded().catch(() => {});
    if (gen !== _switchGen || ST.country !== targetCountry) return;
    syncCurrencyToggleUI();
    ST.lastPeriodo = ST.periodos[ST.periodos.length - 1];

    const n = ST.periodos.length;
    const desdeIdx = Math.max(0, n - 13);
    const selDesde = document.getElementById('selDesde');
    const selHasta = document.getElementById('selHasta');
    if (selDesde) selDesde.selectedIndex = desdeIdx;
    if (selHasta) selHasta.selectedIndex = n - 1;
    ST.desde = selDesde?.value ?? null;
    ST.hasta = selHasta?.value ?? null;
    ST.selected.clear();
    ST.selectedOrder = [];
    ST.compareMode = false;
    syncCompareToggleUI();
    // Select before fillBankList so the empty-list auto-select path never
    // schedules a competing run() during country switch.
    const defaultBank = defaultBankForCountry();
    if (defaultBank != null) toggleBank(defaultBank, true, { silent: true });
    fillBankList();
    clearTimeout(ST._autoRunTimer);

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
    showDataErrorDialog(e, { onRetry: () => { if (typeof window.switchCountryDataset === 'function') window.switchCountryDataset(); } });
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
    await refreshChileMacrosStrip().catch(() => {});
    if (datasetIsoCountry() === 'CL') await ensureClRatingsLoaded().catch(() => {});
    syncCurrencyToggleUI();

    ST.lastPeriodo = ST.periodos[ST.periodos.length - 1];
    setLsMsg('Ready');
    document.getElementById('loadingScreen').style.display = 'none';
    setStatus('ok', `${datasetIsoCountry()} · ${ST.periodos.length} periods available`);

    const n = ST.periodos.length;
    const desdeIdx = Math.max(0, n - 13);
    const selDesdeInit = document.getElementById('selDesde');
    const selHastaInit = document.getElementById('selHasta');
    if (selDesdeInit) selDesdeInit.selectedIndex = desdeIdx;
    if (selHastaInit) selHastaInit.selectedIndex = n - 1;
    ST.desde = selDesdeInit?.value ?? null;
    ST.hasta = selHastaInit?.value ?? null;
    // Select before first fillBankList — avoids the empty-list auto-select
    // scheduling a second run() that aborts this one.
    const def = defaultBankForCountry();
    if (def != null) toggleBank(def, true, { silent: true });
    fillBankList();
    clearTimeout(ST._autoRunTimer);
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
    setLsMsg('Could not connect to the server.');
    showDataErrorDialog(e.name === 'AbortError'
      ? { kind: 'timeout', message: 'Timeout: the server took too long. Try again in a few seconds.', name: 'AbortError' }
      : e, { onRetry: () => location.reload() });
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
window.renderInstitutionalFunding = renderInstitutionalFunding;
window.refreshInstitutionalFunding = refreshInstitutionalFunding;

// Config tab
window.populateConfig   = populateConfig;
window.loadVisitStats   = loadVisitStats;
window.openCustomKpiPicker = openCustomKpiPicker;

// Config sub-tabs: Country details / Credit ratings / Formats / Database alerts
window.ratingsAdmin = ratingsAdmin;
window.showConfigTab = function (name) {
  ['formats', 'countries', 'alerts', 'ratings'].forEach(k => {
    const pane = document.getElementById('cfg-' + k);
    if (pane) pane.style.display = (k === name) ? 'block' : 'none';
    const btn = document.getElementById('cfgtab-' + k);
    if (btn) btn.classList.toggle('active', k === name);
  });
  // El mantenedor ocupa la pantalla completa; las visitas sobran ahí.
  const usage = document.getElementById('cfgUsageStats');
  if (usage) usage.style.display = (name === 'ratings') ? 'none' : '';
  if (name === 'ratings') paintRatingsAdmin();
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
restoreFont();

if (document.getElementById('switchCLP') && document.getElementById('switchUSD')) syncCurrencyToggleUI();

initTopbarTabsOverflow();
init();
