// ============================================================
// APP — entry point: init(), boot, window.* global exposure
// ============================================================
import { API_BASE } from './config.js?v=bmon4';
import { ST } from './state.js?v=bmon4';
import { setStatus, showErr, setLsMsg } from './utils.js?v=bmon4';
import { fetchWithTimeout } from './api.js?v=bmon4';

// Views
import { run, refreshKPIs, showResChart, showROEChart } from './views/resumen.js?v=bmon4';
import { showBalTab, selectBalBank, renderResTable, selectResBank, renderCalidad, renderComparativo } from './views/balance.js?v=bmon4';
import { initExplorer, expSelect, expGoBack, expTreeToggle, toggleExpSubFilter, sortExpSubBy, renderExpGrid } from './views/explorer.js?v=bmon4';
import { initAccountView, avClearAccount, avSelectGroup, avSuggest, avTreeToggle, avSelectAccount, runAccountView } from './views/accountview.js?v=bmon4';
import { renderChileanBanks, sortCBBy, renderCBTable, renderRatingsEditor, updateRating } from './views/ranking.js?v=bmon4';
import { populateConfig, trackVisit, loadVisitStats } from './views/config_tab.js?v=bmon4';

// UI
import {
  fillPeriodSelectors, fillBankList, toggleBank, selAll,
  showTab, loadBankFromTable, goHome, toggleSidebar, toggleSection, selectCountry,
  syncBrandLogoByTheme, toggleTheme, toggleBarLabels, refreshBarLabelsToggleButtons,
  fetchUSDRate, convertAmt, toggleCurrency,
  setFont, changeFontSize, resetFontSize, applyFontSize,
} from './ui.js?v=bmon4';

// Export helpers
import { exportTableById, exportChartTable } from './export.js?v=bmon4';

// ---- init() ----
async function init() {
  // Declared outside try/catch so both blocks can access it.
  let wakeTimer;
  try {
    setStatus('loading', 'Connecting...');
    setLsMsg('Connecting to server...');

    // The server may be cold-starting (Render free tier sleeps after inactivity).
    // Show a friendly message after 6 seconds so the user knows it's still working.
    wakeTimer = setTimeout(() => {
      setLsMsg('Server is waking up — this can take up to 60 s on first load...');
    }, 6000);

    const r = await fetchWithTimeout(`${API_BASE}/api/bootstrap`, {}, 60000);
    clearTimeout(wakeTimer);
    const j = await r.json();
    if (!r.ok || !j.ok) throw new Error(j.error || `Bootstrap error ${r.status}`);
    if (!Array.isArray(j.periodos) || !j.periodos.length) throw new Error('No data found in database');

    ST.periodos = j.periodos;
    j.instituciones.forEach(row => { ST.bancos[row.codigo] = row.razon_social; });

    if (Array.isArray(j.planCuentas) && j.planCuentas.length) {
      j.planCuentas.forEach(row => { ST.planCuentas[row.cuenta] = row.descripcion; });
    }

    if (Array.isArray(j.patrimonioRows) && j.patrimonioRows.length) {
      const patMap = {};
      j.patrimonioRows.forEach(row => { patMap[row.ins_cod] = (patMap[row.ins_cod] || 0) + row.monto_total; });
      ST._patrimonioMap     = patMap;
      ST._patrimonioRanking = Object.keys(patMap)
        .map(Number)
        .filter(c => c !== 999)
        .sort((a, b) => (patMap[b] || 0) - (patMap[a] || 0));
    }

    fillPeriodSelectors();
    fillBankList();

    ST.lastPeriodo = ST.periodos[ST.periodos.length - 1];
    setLsMsg('Listo');
    document.getElementById('loadingScreen').style.display = 'none';
    setStatus('ok', `${ST.periodos.length} periods available`);

    const n = ST.periodos.length;
    const desdeIdx = Math.max(0, n - 13);
    document.getElementById('selDesde').selectedIndex = desdeIdx;
    document.getElementById('selHasta').selectedIndex = n - 1;
    toggleBank(59, true);
    fillBankList();
    await run();
    showTab('resumen');
    refreshBarLabelsToggleButtons();
    trackVisit();

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

const _clpBtn = document.getElementById('switchCLP');
const _usdBtn = document.getElementById('switchUSD');
if (_clpBtn && _usdBtn) {
  _clpBtn.style.background = 'transparent';
  _clpBtn.style.color      = 'var(--text3)';
  _usdBtn.style.background = 'var(--yellow)';
  _usdBtn.style.color      = '#000';
}

init();
fetchUSDRate();
