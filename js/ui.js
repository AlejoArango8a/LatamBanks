// ============================================================
// UI — shell controls: sidebar, bank list, period selectors,
//      tab routing, theme, currency, font, chart-type toggles
// ============================================================
import { ST } from './state.js';
import { API_BASE, BTG_LOGO_DARK_SRC, bankColor } from './config.js';
import { bankName, fmtKPI, periodLabel } from './format.js';
import { setStatus, showErr } from './utils.js';
import { sumRows } from './api.js';

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
    const def = codes.includes(59) ? 59 : codes[0];
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

// ---- Tab routing ----
export function showTab(tab) {
  ['resumen','chileanbanks','accountview','balance','resultados','comparativo','explorador','config'].forEach(t => {
    const el = document.getElementById('tab-' + t);
    if (el) el.style.display = t === tab ? 'block' : 'none';
  });
  document.querySelectorAll('.tab').forEach(b => {
    const map = { resumen:'Bank Monitor', chileanbanks:'Banks System', accountview:'Account View', balance:'Balance Sheet', resultados:'Income Statement', explorador:'Account Explorer' };
    b.classList.toggle('active', b.textContent.trim() === map[tab]);
  });

  const sidebarEl      = document.getElementById('sidebarEl');
  const sidebarContent = document.getElementById('sidebarContent');
  if (sidebarEl) sidebarEl.style.display = '';
  if (sidebarContent) {
    const greyOut = ['chileanbanks', 'accountview'].includes(tab);
    sidebarContent.classList.toggle('sidebar-disabled', greyOut);
    if (greyOut) sidebarContent.setAttribute('aria-disabled', 'true');
    else sidebarContent.removeAttribute('aria-disabled');
  }

  requestAnimationFrame(() => {
    const activeTab = document.querySelector('.tab.active');
    if (activeTab) activeTab.scrollIntoView({ behavior:'smooth', block:'nearest', inline:'center' });
    const tabsEl = document.getElementById('tabsEl');
    const fade   = document.getElementById('tabsFade');
    if (tabsEl && fade) fade.style.display = tabsEl.scrollWidth <= tabsEl.clientWidth ? 'none' : 'block';
  });

  if (tab === 'resumen' && ST._series) {
    requestAnimationFrame(() => window.showResChart(ST._lastResChart || 'activos'));
  }
  if (tab === 'explorador' && Object.keys(ST.planCuentas).length > 0) window.initExplorer();
  if (tab === 'config')       { window.populateConfig(); window.loadVisitStats(); }
  if (tab === 'chileanbanks') window.renderChileanBanks();
  if (tab === 'accountview')  window.initAccountView();
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
  const BTG_CODE = 59;
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
export function toggleSection(id) {
  const body  = document.getElementById(id);
  if (!body) return;
  const isOpen = body.classList.toggle('open');
  // arrow ids: arrSecCountry, arrSecPeriod, arrSecBanks
  const arrowId = 'arr' + id.charAt(0).toUpperCase() + id.slice(1);
  const arrow = document.getElementById(arrowId);
  if (arrow) arrow.textContent = isOpen ? '▾' : '▸';
}

// ---- Country overlay ----
export function selectCountry(country) {
  const flags = { chile:'flagChile', colombia:'flagColombia', peru:'flagPeru', uruguay:'flagUruguay' };
  Object.entries(flags).forEach(([c, id]) => {
    const btn = document.getElementById(id);
    if (!btn) return;
    btn.style.borderColor = c === country ? 'var(--accent)' : 'transparent';
    btn.style.opacity     = c === country ? '1' : '0.45';
  });
  const overlay = document.getElementById('countryOverlay');
  if (country === 'chile') { if (overlay) overlay.style.display = 'none'; return; }
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
export function refreshBarLabelsToggleButtons() {
  const ids = ['btnLabels', 'btnExpLabels'];
  let stateCls;
  let title;
  let html;
  if (ST.showBarLabels === true) {
    stateCls = 'state-on';
    title = 'Bar values: forced ON · click for OFF';
    html = 'Bar values <span class="bvt-sub">ON</span>';
  } else if (ST.showBarLabels === false) {
    stateCls = 'state-off';
    title = 'Bar values: forced OFF · click for Auto';
    html = 'Bar values <span class="bvt-sub">OFF</span>';
  } else {
    stateCls = 'state-auto';
    title = 'Bar values: Auto · shows numbers when exactly one bank · click for forced ON';
    html = 'Bar values <span class="bvt-sub">Auto</span>';
  }
  ids.forEach(id => {
    const btn = document.getElementById(id);
    if (!btn) return;
    btn.classList.add('bar-values-toggle');
    btn.classList.remove('state-on', 'state-off', 'state-auto');
    btn.classList.add(stateCls);
    btn.title = title;
    btn.innerHTML = html;
  });
}

export function toggleBarLabels() {
  if (ST.showBarLabels === null) ST.showBarLabels = true;
  else if (ST.showBarLabels === true) ST.showBarLabels = false;
  else ST.showBarLabels = null;

  refreshBarLabelsToggleButtons();

  if (ST._lastResChart) window.showResChart(ST._lastResChart);
  if (ST.exp.selected) window.expSelect(ST.exp.selected);
}

// ---- Currency ----
export async function fetchUSDRate() {
  try {
    const resp = await fetch('https://mindicador.cl/api/dolar');
    const data = await resp.json();
    if (data.serie && data.serie.length > 0) {
      ST.usdRate = data.serie[0].valor;
      ST.usdDate = data.serie[0].fecha.slice(0, 10);
      const txt  = `1 USD = $${Math.round(ST.usdRate).toLocaleString('es-CL')} · ${ST.usdDate}`;
      const sbl  = document.getElementById('usdSidebarLabel');
      if (sbl) sbl.textContent = txt;
    }
  } catch (e) { console.warn('No se pudo obtener tasa USD:', e); }
}

export function convertAmt(clpMillions) {
  if (ST.currency === 'USD' && ST.usdRate) return clpMillions / ST.usdRate;
  return clpMillions;
}

export function toggleCurrency() {
  if (ST.currency === 'CLP') {
    if (!ST.usdRate) { alert('No se pudo obtener la tasa de cambio USD. Intenta nuevamente.'); return; }
    ST.currency = 'USD';
    document.getElementById('switchCLP').style.background = 'transparent';
    document.getElementById('switchCLP').style.color      = 'var(--text3)';
    document.getElementById('switchUSD').style.background = 'var(--yellow)';
    document.getElementById('switchUSD').style.color      = '#000';
  } else {
    ST.currency = 'CLP';
    document.getElementById('switchCLP').style.background = 'var(--accent)';
    document.getElementById('switchCLP').style.color      = '#000';
    document.getElementById('switchUSD').style.background = 'transparent';
    document.getElementById('switchUSD').style.color      = 'var(--text3)';
  }
  window.refreshKPIs();
  fillBankList();
  if (ST._series) window.showResChart(ST._lastResChart || 'patrimonio');
  if (ST._b1)     window.showBalTab(ST._lastBalTab || 'assets');
  if (ST._resTableData) window.renderResTable(ST._resTableData);
  if (ST._kpiRaw) {
    const m = ST._kpiRaw;
    const carNorm = sumRows(ST._c1 || [], '854000000', ST._lastP) + sumRows(ST._c1 || [], '851000000', ST._lastP);
    const carSub  = sumRows(ST._c1 || [], '852000000', ST._lastP);
    const carInc  = sumRows(ST._c1 || [], '853000000', ST._lastP) + sumRows(ST._c1 || [], '855000000', ST._lastP);
    window.renderCalidad({ carNorm, carSub, carInc, mora90: m.mora90,
      castigos: sumRows(ST._c1 || [], '813000000', ST._lastP),
      recup:    sumRows(ST._c1 || [], '814000000', ST._lastP) });
  }
  if (ST.exp.selected) window.expSelect(ST.exp.selected);
  if (ST._cbData) window.renderCBTable();
  if (ST._avAccount && document.getElementById('avResultTable')) window.runAccountView();
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
