// ============================================================
// UI — shell controls: sidebar, bank list, period selectors,
//      tab routing, theme, currency, font, chart-type toggles
// ============================================================
import { ST, datasetIsoCountry, reportingLocalCurrencyISO } from './state.js?v=bmon14';
import { API_BASE, BTG_LOGO_DARK_SRC, bankColor } from './config.js?v=bmon14';
import { bankName, fmtKPI, periodLabel } from './format.js?v=bmon14';
import { setStatus, showErr } from './utils.js?v=bmon14';
import { sumRows } from './api.js?v=bmon14';
import { syncFinStatementPanelLabels } from './views/balance.js?v=bmon14';

// ---- Run & period ----
export function onPeriodChange() {
  if (ST.selected.size > 0 && ST.periodos.length > 0) {
    clearTimeout(ST._autoRunTimer);
    ST._autoRunTimer = setTimeout(() => window.run(), 300);
  }
}

export function fillPeriodSelectors() {
  const desde = document.getElementById('selDesde');
  const hasta  = document.getElementById('selHasta');
  desde.innerHTML = '';
  hasta.innerHTML  = '';
  ST.periodos.forEach(p => {
    desde.innerHTML += `<option value="${p}">${periodLabel(p)}</option>`;
    hasta.innerHTML  += `<option value="${p}">${periodLabel(p)}</option>`;
  });
  const n = ST.periodos.length;
  desde.selectedIndex = Math.max(0, n - 18);
  hasta.selectedIndex  = n - 1;
  ST.desde = ST.periodos[desde.selectedIndex];
  ST.hasta  = ST.periodos[hasta.selectedIndex];
  desde.onchange = () => { ST.desde = desde.value; onPeriodChange(); };
  hasta.onchange  = () => { ST.hasta  = hasta.value;  onPeriodChange(); };
}

// ---- Bank list ----
export function fillBankList() {
  const list  = document.getElementById('bankList');
  list.innerHTML = '';
  const header = document.createElement('div');
  header.className = 'bank-list-header';
  header.innerHTML =
    '<span class="bank-hdr-spacer" aria-hidden="true"></span><span class="bank-hdr-name">Bank</span><span class="bank-hdr-equity">Equity</span>';
  list.appendChild(header);
  const codes = Object.keys(ST.bancos).map(Number).filter(c => c !== 999);

  if (ST._patrimonioRanking && ST._patrimonioRanking.length > 0) {
    const rankMap = {};
    ST._patrimonioRanking.forEach((r, i) => rankMap[r] = i);
    codes.sort((a, b) => (rankMap[a] ?? 999) - (rankMap[b] ?? 999));
  } else {
    codes.sort((a, b) => a - b);
  }
  const allCodes = [...codes, 999].filter(c => ST.bancos[c] !== undefined);

  allCodes.forEach(c => {
    const name       = bankName(c);
    const patrimonio = ST._patrimonioMap?.[c];
    const patLabel   = patrimonio
      ? `<span class="bank-code" style="font-size:9px;">${fmtKPI(patrimonio)}</span>`
      : `<span class="bank-code" style="font-size:9px;opacity:0.3;">—</span>`;
    const item = document.createElement('div');
    item.className      = 'bank-item' + (ST.selected.has(c) ? ' on' : '');
    item.dataset.bankCode = c;
    item.innerHTML = `
      <input type="checkbox" ${ST.selected.has(c) ? 'checked' : ''} onclick="event.stopPropagation();toggleBank(${c},this.checked)">
      <span class="bank-name">${name}</span>
      ${patLabel}
    `;
    item.onclick = () => { const cb = item.querySelector('input'); cb.checked = !cb.checked; toggleBank(c, cb.checked); };
    list.appendChild(item);
  });

  if (ST.selected.size === 0) {
    const prefer = datasetIsoCountry() === 'CO' ? 66 : 59;
    const def = codes.includes(prefer) ? prefer : codes[0];
    toggleBank(def, true); fillBankList();
  }
}

export function toggleBank(c, on) {
  if (on && ST.selected.size >= 5 && !ST.selected.has(c)) {
    document.getElementById('bankLimitMsg').style.display = 'block';
    setTimeout(() => document.getElementById('bankLimitMsg').style.display = 'none', 3000);
    document.querySelectorAll('.bank-item').forEach(el => {
      const cb = el.querySelector('input[type=checkbox]');
      if (cb && Number(el.dataset.bankCode) === c) cb.checked = false;
    });
    return;
  }
  if (on) {
    ST.selected.add(c);
    if (!ST.selectedOrder.includes(c)) ST.selectedOrder.push(c);
  } else {
    ST.selected.delete(c);
    ST.selectedOrder = ST.selectedOrder.filter(x => x !== c);
  }
  if (ST.selected.size < 5) document.getElementById('bankLimitMsg').style.display = 'none';
  document.querySelectorAll('.bank-item').forEach(el => {
    const cb = el.querySelector('input');
    if (cb) el.classList.toggle('on', cb.checked);
  });
  if (ST.selected.size > 0 && ST.periodos.length > 0) {
    clearTimeout(ST._autoRunTimer);
    ST._autoRunTimer = setTimeout(() => window.run(), 300);
  }
}

export function selAll(on) {
  ST.selected.clear();
  ST.selectedOrder = [];
  if (on) {
    const codes  = Object.keys(ST.bancos).map(Number).filter(c => c !== 999);
    const ranked = ST._patrimonioRanking?.length ? ST._patrimonioRanking : codes;
    ranked.slice(0, 5).forEach(c => { ST.selected.add(c); ST.selectedOrder.push(c); });
  }
  fillBankList();
}

// ---- Tab bar scroll hint + fade (narrow viewports) ----
let __topbarTabsOverflowWired = false;

/** Sync fade + › chevron when tab row overflows horizontally. */
export function syncTopbarTabsOverflow() {
  const tabsEl = document.getElementById('tabsEl');
  const chev = document.getElementById('tabsScrollChevron');
  const fade = document.getElementById('tabsFade');
  if (!tabsEl || !fade) return;
  const ov = tabsEl.scrollWidth > tabsEl.clientWidth + 6;
  fade.style.display = ov ? 'block' : 'none';

  if (!chev) return;
  if (!ov) {
    chev.classList.remove('visible');
    chev.setAttribute('disabled', 'disabled');
    return;
  }
  const atEnd = tabsEl.scrollLeft + tabsEl.clientWidth >= tabsEl.scrollWidth - 8;
  if (atEnd) {
    chev.classList.remove('visible');
    chev.setAttribute('disabled', 'disabled');
  } else {
    chev.classList.add('visible');
    chev.removeAttribute('disabled');
  }
}

export function initTopbarTabsOverflow() {
  if (__topbarTabsOverflowWired) return;
  __topbarTabsOverflowWired = true;

  const tabsEl = document.getElementById('tabsEl');
  const chev = document.getElementById('tabsScrollChevron');

  if (tabsEl && chev) {
    chev.addEventListener('click', () => {
      if (chev.hasAttribute('disabled')) return;
      tabsEl.scrollBy({ left: Math.min(180, Math.max(120, tabsEl.clientWidth * 0.45)), behavior: 'smooth' });
    });
    tabsEl.addEventListener('scroll', () => syncTopbarTabsOverflow(), { passive: true });
  }

  let resizeT;
  window.addEventListener('resize', () => {
    clearTimeout(resizeT);
    resizeT = setTimeout(() => syncTopbarTabsOverflow(), 80);
  });

  syncTopbarTabsOverflow();
}

// ---- Tab routing ----
export function showTab(tab) {
  ['resumen','chileanbanks','accountview','balance','resultados','comparativo','config'].forEach(t => {
    const el = document.getElementById('tab-' + t);
    if (el) el.style.display = t === tab ? 'block' : 'none';
  });
  document.querySelectorAll('.tab').forEach(b => {
    const key = b.getAttribute('data-tab');
    if (key) {
      b.classList.toggle('active', key === tab);
      return;
    }
    const map = { resumen:'Bank Monitor', chileanbanks:'Banking System', accountview:'Account View', balance:'Balance Sheet', resultados:'Income Statement', config:'⚙ Config' };
    b.classList.toggle('active', b.textContent.trim() === map[tab]);
  });

  const sidebarEl   = document.getElementById('sidebarEl');
  const bankPick    = document.getElementById('sidebarBankPick');
  const periodPick  = document.getElementById('sidebarPeriodPick');
  if (sidebarEl) sidebarEl.style.display = '';
  const muteBankPeriod = ['chileanbanks', 'accountview'].includes(tab);
  [bankPick, periodPick].forEach(section => {
    if (!section) return;
    section.classList.toggle('sidebar-disabled', muteBankPeriod);
    if (muteBankPeriod) section.setAttribute('aria-disabled', 'true');
    else section.removeAttribute('aria-disabled');
  });

  requestAnimationFrame(() => {
    const activeTab = document.querySelector('.tab.active');
    if (activeTab) activeTab.scrollIntoView({ behavior:'smooth', block:'nearest', inline:'center' });
    syncTopbarTabsOverflow();
    requestAnimationFrame(() => syncTopbarTabsOverflow());
  });

  if (tab === 'resumen' && ST._series) {
    requestAnimationFrame(() => window.showResChart(ST._lastResChart || 'activos'));
  }
  if (tab === 'config')       { window.populateConfig(); window.loadVisitStats(); }
  if (tab === 'chileanbanks') window.renderChileanBanks();
  if (tab === 'accountview')  window.initAccountView();
  syncFinStatementPanelLabels();
}

export function loadBankFromTable(bankCode) {
  ST.selected.clear();
  ST.selectedOrder = [];
  toggleBank(bankCode, true);
  fillBankList();
  showTab('resumen');
  window.run();
}

// ---- Home shortcut: BTG Pactual Chile, last 12 months ----
export function goHome() {
  if (!ST.periodos.length) return; // data not loaded yet
  const BTG_CODE = datasetIsoCountry() === 'CO' ? 66 : 59;
  ST.selected.clear();
  ST.selectedOrder = [];
  ST.selected.add(BTG_CODE);
  ST.selectedOrder.push(BTG_CODE);
  fillBankList();

  const desde = document.getElementById('selDesde');
  const hasta  = document.getElementById('selHasta');
  if (desde && hasta) {
    const n = ST.periodos.length;
    desde.selectedIndex = Math.max(0, n - 12);
    hasta.selectedIndex  = n - 1;
    ST.desde = ST.periodos[desde.selectedIndex];
    ST.hasta  = ST.periodos[hasta.selectedIndex];
  }

  showTab('resumen');
  window.run();
}

// ---- Sidebar toggle (mobile) ----
export function toggleSidebar() {
  const content = document.getElementById('sidebarContent');
  const arrow   = document.getElementById('sidebarArrow');
  if (!content) return;
  const isOpen = content.classList.toggle('open');
  if (arrow) arrow.textContent = isOpen ? '▴' : '▾';
}

// ---- Mobile accordion section toggle ----
const MOB_SECTION_ARROW = { secCountry: 'arrSecCountry', secPeriod: 'arrSecPeriod', secBanks: 'arrSecBanks' };

export function toggleSection(id) {
  const body  = document.getElementById(id);
  if (!body) return;
  const isOpen = body.classList.toggle('open');
  const arrowId = MOB_SECTION_ARROW[id];
  const arrow = arrowId ? document.getElementById(arrowId) : null;
  if (arrow) arrow.textContent = isOpen ? '▾' : '▸';
}

/** Etiqueta del botón mora/deterioro en la barra del gráfico Resumen (CO vs CL). */
export function syncResumenMoraChartButton() {
  const moraBtn = document.getElementById('btnResChartMora');
  if (!moraBtn) return;
  moraBtn.textContent = ST.country === 'colombia' ? '⚠️ Deterioro %' : '⚠️ NPL %';
}

// ---- Country overlay / dataset switch ----
export function syncCountryFlagsVisual(activeCountryKey) {
  const flags = { chile: 'flagChile', colombia: 'flagColombia', peru: 'flagPeru', uruguay: 'flagUruguay' };
  Object.entries(flags).forEach(([c, id]) => {
    const btn = document.getElementById(id);
    if (!btn) return;
    btn.style.borderColor = c === activeCountryKey ? 'var(--accent)' : 'transparent';
    btn.style.opacity     = c === activeCountryKey ? '1' : '0.45';
  });
}

export function selectCountry(country) {
  const prev = ST.country;
  syncCountryFlagsVisual(country);
  const overlay = document.getElementById('countryOverlay');

  if (country === 'chile') {
    if (overlay) overlay.style.display = 'none';
    ST.country = 'chile';
    syncCurrencyToggleUI();
    syncResumenMoraChartButton();
    if (prev === 'colombia') queueMicrotask(() => window.switchCountryDataset?.()?.catch(console.error));
    return;
  }

  if (country === 'colombia') {
    ST.country = 'colombia';
    if (overlay) overlay.style.display = 'none';
    syncCurrencyToggleUI();
    syncResumenMoraChartButton();
    queueMicrotask(() => window.switchCountryDataset?.()?.catch(console.error));
    return;
  }

  const names    = { colombia:'Colombia', peru:'Perú', uruguay:'Uruguay' };
  const flagImgs = { colombia:'flagColombia', peru:'flagPeru', uruguay:'flagUruguay' };
  if (overlay) {
    const nameEl = document.getElementById('countryOverlayName');
    const imgBtn = document.getElementById(flagImgs[country]);
    const img    = imgBtn ? imgBtn.querySelector('img') : null;
    nameEl.innerHTML = (img ? `<img src="${img.src}" style="width:72px;height:72px;border-radius:50%;display:block;margin:0 auto 12px;box-shadow:0 4px 16px rgba(0,0,0,0.5);">` : '') +
      `<span style="font-size:36px;font-weight:700;color:#ffffff;text-shadow:0 2px 8px rgba(0,0,0,0.8);letter-spacing:2px;">${names[country] || country}</span>`;
    overlay.style.display = 'flex';
  }
}

// ---- Theme ----
export function syncBrandLogoByTheme() {
  const logo = document.querySelector('.brand img');
  if (!logo) return;
  if (!logo.dataset.lightSrc) {
    logo.dataset.lightSrc = logo.getAttribute('src') || '';
    const rect = logo.getBoundingClientRect();
    if (rect.width && rect.height) {
      logo.dataset.lockWidth  = String(Math.round(rect.width));
      logo.dataset.lockHeight = String(Math.round(rect.height));
    }
    logo.onerror = () => { if (logo.dataset.lightSrc) logo.src = logo.dataset.lightSrc; };
  }
  if (logo.dataset.lockWidth && logo.dataset.lockHeight) {
    logo.style.width        = `${logo.dataset.lockWidth}px`;
    logo.style.height       = `${logo.dataset.lockHeight}px`;
    logo.style.objectFit    = 'contain';
    logo.style.objectPosition = 'left center';
  }
  logo.src = ST.theme === 'dark' ? BTG_LOGO_DARK_SRC : logo.dataset.lightSrc;
}

export function toggleTheme() {
  ST.theme = ST.theme === 'dark' ? 'light' : 'dark';
  document.body.classList.toggle('light', ST.theme === 'light');
  const darkBtn  = document.getElementById('switchDark');
  const lightBtn = document.getElementById('switchLight');
  if (ST.theme === 'light') {
    darkBtn.style.background  = 'transparent';
    darkBtn.style.color       = 'var(--text3)';
    lightBtn.style.background = 'var(--accent)';
    lightBtn.style.color      = '#fff';
  } else {
    darkBtn.style.background  = 'var(--accent)';
    darkBtn.style.color       = '#000';
    lightBtn.style.background = 'transparent';
    lightBtn.style.color      = 'var(--text3)';
  }
  syncBrandLogoByTheme();
  if (ST._lastResChart) window.showResChart(ST._lastResChart);
}

// ---- Bar labels toggle (per-chart: Auto = show when single bank only) ----
// ---- Compact "123" bar-labels toggle · Auto ⇄ forced ON ⇄ forced OFF ----
export function refreshBarLabelsToggleButtons() {
  ['btnLabels', 'btnExpLabels'].forEach(id => {
    const btn = document.getElementById(id);
    if (!btn) return;
    btn.classList.remove('bar-values-toggle', 'state-on', 'state-off', 'state-auto');
    btn.classList.add('lbl123-btn');
    if (ST.showBarLabels === true) {
      btn.classList.add('state-on');
      btn.textContent = '123 ✓';
      btn.title = 'Values on bars · forced ON · click for OFF';
    } else if (ST.showBarLabels === false) {
      btn.classList.add('state-off');
      btn.textContent = '123 ✗';
      btn.title = 'Values hidden · forced OFF · click for Auto';
    } else {
      btn.classList.add('state-auto');
      btn.textContent = '123';
      btn.title =
        'Auto · wide charts: values on bars when one bank · narrow: labels off for readable axes · click for ON';
    }
  });
}

export function toggleBarLabels() {
  if (ST.showBarLabels === null) ST.showBarLabels = true;
  else if (ST.showBarLabels === true) ST.showBarLabels = false;
  else ST.showBarLabels = null;

  refreshBarLabelsToggleButtons();

  if (ST._lastResChart) window.showResChart(ST._lastResChart);
}

// ---- Currency ----
export async function fetchUSDRate() {
  const sbl = document.getElementById('usdSidebarLabel');
  try {
    if (ST.country === 'colombia') {
      const resp = await fetch('https://open.er-api.com/v6/latest/USD');
      const data = await resp.json();
      if (data.result === 'success' && data.rates && data.rates.COP) {
        ST.usdRate = Number(data.rates.COP);
        const d = data.time_last_update_unix ? new Date(data.time_last_update_unix * 1000) : new Date();
        ST.usdDate = d.toISOString().slice(0, 10);
        const txt = `1 USD ≈ $${Math.round(ST.usdRate).toLocaleString('es-CO')} COP · ${ST.usdDate}`;
        if (sbl) sbl.textContent = txt;
      }
      return;
    }
    const resp = await fetch('https://mindicador.cl/api/dolar');
    const data = await resp.json();
    if (data.serie && data.serie.length > 0) {
      ST.usdRate = data.serie[0].valor;
      ST.usdDate = data.serie[0].fecha.slice(0, 10);
      const txt  = `1 USD = $${Math.round(ST.usdRate).toLocaleString('es-CL')} · ${ST.usdDate}`;
      if (sbl) sbl.textContent = txt;
    }
  } catch (e) { console.warn('No se pudo obtener tasa USD:', e); }
}

export function convertAmt(clpMillions) {
  if (ST.currency === 'USD' && ST.usdRate) return clpMillions / ST.usdRate;
  return clpMillions;
}

/** Visual state for the topbar segmented control (`#switchCLP` = Local Ccy, `#switchUSD` = USD). */
export function syncCurrencyToggleUI() {
  const localEl = document.getElementById('switchCLP');
  const usdEl = document.getElementById('switchUSD');
  if (!localEl || !usdEl) return;
  const isUsd = ST.currency === 'USD';
  localEl.textContent = reportingLocalCurrencyISO();
  localEl.classList.toggle('ccy-on', !isUsd);
  usdEl.classList.toggle('ccy-on', isUsd);
}

/**
 * Repinta KPIs, patrimonio en sidebar, gráficos y tablas que dependen de fmtKPI / TRM.
 * Tras cargar ST.usdRate debe llamarse si la vista está en USD; también al cambiar moneda.
 */
export function refreshMoneyDenominatedUI() {
  if (typeof window.refreshKPIs === 'function') window.refreshKPIs();
  fillBankList();
  if (ST._series && typeof window.showResChart === 'function') {
    window.showResChart(ST._lastResChart || 'patrimonio');
  }
  if (ST._b1 && typeof window.showBalTab === 'function') {
    window.showBalTab(ST._lastBalTab || 'assets');
  }
  if (ST._resTableData && typeof window.renderResTable === 'function') {
    window.renderResTable(ST._resTableData);
  } else if (ST._series?.r1 && datasetIsoCountry() === 'CO' && typeof window.renderResTable === 'function') {
    window.renderResTable(null);
  }
  if (ST._kpiRaw && ST.country !== 'colombia' && typeof window.renderCalidad === 'function') {
    const m = ST._kpiRaw;
    const carNorm = sumRows(ST._c1 || [], '854000000', ST._lastP) + sumRows(ST._c1 || [], '851000000', ST._lastP);
    const carSub  = sumRows(ST._c1 || [], '852000000', ST._lastP);
    const carInc  = sumRows(ST._c1 || [], '853000000', ST._lastP) + sumRows(ST._c1 || [], '855000000', ST._lastP);
    window.renderCalidad({
      carNorm, carSub, carInc, mora90: m.mora90, colocaciones: m.colocaciones,
      castigos: sumRows(ST._c1 || [], '813000000', ST._lastP),
      recup:    sumRows(ST._c1 || [], '814000000', ST._lastP),
    });
  }
  if (ST._cbData && typeof window.renderCBTable === 'function') window.renderCBTable();
  if (ST._avAccount && document.getElementById('avResultTable') && typeof window.runAccountView === 'function') {
    window.runAccountView();
  }
  syncFinStatementPanelLabels();
}

export function toggleCurrency() {
  if (ST.currency === 'CLP') {
    if (!ST.usdRate) { alert('No se pudo obtener la tasa de cambio USD. Intenta nuevamente.'); return; }
    ST.currency = 'USD';
  } else {
    ST.currency = 'CLP';
  }
  syncCurrencyToggleUI();
  refreshMoneyDenominatedUI();
}

// ---- Font ----
export function setFont(fontValue, activeId) {
  document.documentElement.style.setProperty('--sans', fontValue);
  document.body.style.fontFamily = fontValue;
  const isCalibri = fontValue.includes('Calibri');
  const basePx    = isCalibri ? 17 : 14;
  document.documentElement.style.fontSize = basePx + 'px';
  document.body.style.fontSize            = basePx + 'px';
  document.querySelectorAll('.kpi-val').forEach(el => { el.style.fontSize  = isCalibri ? '22px' : ''; });
  document.querySelectorAll('.kpi-label').forEach(el => { el.style.fontSize = isCalibri ? '13px' : ''; });
  document.querySelectorAll('.tbl td, .tbl th').forEach(el => { el.style.fontSize = isCalibri ? '14px' : ''; });
  ['fontOpt1','fontOpt2','fontOpt3','fontOpt4'].forEach(id => {
    const el = document.getElementById(id);
    if (!el) return;
    if (id === activeId) {
      el.style.borderColor = 'var(--accent)';
      el.style.borderWidth = '2px';
      el.style.background  = 'rgba(56,189,248,0.05)';
      el.querySelector('span').style.color = 'var(--white)';
    } else {
      el.style.borderColor = 'var(--border)';
      el.style.borderWidth = '1px';
      el.style.background  = 'transparent';
      el.querySelector('span').style.color = 'var(--text)';
    }
  });
  if (ST._lastResChart) window.showResChart(ST._lastResChart);
}

export function changeFontSize(delta) {
  ST.fontSize = Math.min(18, Math.max(11, ST.fontSize + delta));
  applyFontSize();
}

export function resetFontSize() {
  ST.fontSize = 14;
  applyFontSize();
}

export function applyFontSize() {
  const sz = ST.fontSize;
  document.documentElement.style.fontSize = sz + 'px';
  document.body.style.fontSize            = sz + 'px';
  const label = document.getElementById('fontSizeLabel');
  const track  = document.getElementById('fontSizeTrack');
  if (label) label.textContent  = sz + 'px';
  if (track)  track.style.width = ((sz - 11) / (18 - 11) * 100) + '%';
  if (ST._lastResChart) window.showResChart(ST._lastResChart);
}
