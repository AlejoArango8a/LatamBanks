// ============================================================
// RESUMEN — main dashboard: run(), KPIs, chart, ROE
// ============================================================
import { ST, datasetIsoCountry } from '../state.js?v=bmon47';
import { CO_CUIF, coB1AccountsForRun, coR1AccountsForRun, coMoraNumerator, coDeterioroActivoCuentasFromPlan } from '../coCuentas.js?v=bmon47';
import { BR_KPI, brB1AccountsForRun, brR1AccountsForRun, brSum, brSeries, brResultReset } from '../brCuentas.js?v=bmon47';
import { UY_KPI, uyB1AccountsForRun, uyR1AccountsForRun, uySum, uySeries } from '../uyCuentas.js?v=bmon47';
import { PE_KPI, peB1AccountsForRun, peR1AccountsForRun, peSum, peSeries } from '../peCuentas.js?v=bmon47';
import { US_KPI, usB1AccountsForRun, usR1AccountsForRun, usSum, usSeries } from '../usCuentas.js?v=bmon47';
import { AR_KPI, arB1AccountsForRun, arR1AccountsForRun, arSum, arSeries } from '../arCuentas.js?v=bmon47';
import { MX_KPI, mxB1AccountsForRun, mxR1AccountsForRun, mxSum, mxSeries } from '../mxCuentas.js?v=bmon47';
import { PA_KPI, paB1AccountsForRun, paR1AccountsForRun, paSum, paSeries } from '../paCuentas.js?v=bmon47';
import { bankColor, btgBlue, bankLogoUrl, LOGO_SIZES, bankBrandTextColor } from '../config.js?v=bmon47';
import { bankName, fmtKPI, fmtKPIDecimal, fmtAxis, fmtChartPct, fmtP, fmtB, periodLabel, nplPctFromRaw, getTipo } from '../format.js?v=bmon47';
import { fetchData, apiDatos, sumRows, getSeriesForCuenta } from '../api.js?v=bmon47';
import { drawLineChart, setupChartTooltip, sparseData } from '../charts.js?v=bmon47';
import { showBalTab, renderResTable, renderCalidad, renderComparativo } from './balance.js?v=bmon47';
import { setStatus, showErr } from '../utils.js?v=bmon47';
import { resolveCustomKpiForRun } from './customKpiPicker.js?v=bmon47';

function _setBannerLogo(iso, code) {
  const el = document.getElementById('bankHeaderLogo');
  if (!el) return;
  const url     = bankLogoUrl(iso, code);
  const generic = 'assets/logos/logo-generico.png';
  const slug = url ? url.replace('assets/logos/logo-', '').replace('.png', '') : null;
  const h = (slug && LOGO_SIZES[slug]) || 42;
  const w = Math.max(160, h * 5);
  const imgStyle = `max-height:${h}px;max-width:${w}px;object-fit:contain;`;
  el.innerHTML = `<img src="${url || generic}" alt="" style="${imgStyle}"
    onerror="this.onerror=null;this.src='${generic}';">`;
}

const btgCodeForIso = () => (datasetIsoCountry() === 'CO' ? 66 : datasetIsoCountry() === 'BR' ? 1000080336 : 59);

function escHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/"/g, '&quot;');
}

function computeCustomKpiSnapshot(b1, r1, c1, firstBank, lastP) {
  const saved = resolveCustomKpiForRun();
  if (!saved) return null;
  const tipo = getTipo(saved.cuenta);
  const rows = tipo === 'b1' ? b1 : tipo === 'r1' ? r1 : c1;
  const monto = sumRows(rows.filter(r => r.ins_cod === firstBank), saved.cuenta, lastP);
  return {
    cuenta: saved.cuenta,
    descripcion: ST.planCuentas[saved.cuenta] || saved.descripcion || '',
    tipo,
    monto,
  };
}

function customKpiTileHtml(m) {
  const ck = m.customKpi;
  const hasSel = !!(ck && ck.cuenta);
  const val = hasSel && ck.monto != null && Number.isFinite(ck.monto) ? fmtKPI(ck.monto) : '';
  const sub = hasSel
    ? `<span style="font-family:var(--mono);font-size:9px;color:var(--text3);">${escHtml(ck.cuenta)}</span> · ${escHtml((ck.descripcion || '').trim() || '—')}`
    : 'Click to open the picker';
  return `<div class="kpi kpi-custom-tile kpi-btn" onclick="openCustomKpiPicker()" title="Custom account — choose &amp; chart any account">
    <div class="kpi-custom-heading">⭐ Custom Account</div>
    ${val ? `<div class="kpi-val">${val}</div>` : ''}
    <div class="kpi-sub">${sub}</div>
  </div>`;
}

function syncResChartCustomBtn() {
  const btn = document.getElementById('btnResChartCustom');
  if (!btn) return;
  btn.style.display = resolveCustomKpiForRun() ? '' : 'none';
}

let runAbortController = null;
let roeAbortController = null;

function abortROEFetch() {
  roeAbortController?.abort();
}

// ---- KPI refresh (called after run or currency toggle) ----
function refreshKPIsBase() {
  if (!ST._kpiRaw?.lastP) return;
  const m          = ST._kpiRaw;
  const lastMonth  = parseInt(String(m.lastP).slice(4, 6), 10);

  if (datasetIsoCountry() === 'BR') {
    if (!(lastMonth >= 1 && lastMonth <= 12)) return;
    // Brasil es trimestral: el mes de cierre es 3/6/9/12 y el Lucro Líquido es
    // acumulado del año (YTD), así que la anualización util × (12/mes) es válida.
    const utilAnualizada = m.utilidad ? m.utilidad * (12 / lastMonth) : 0;
    const roe        = m.patrimonio && m.utilidad ? (utilAnualizada / m.patrimonio * 100).toFixed(2) + '%' : '—';
    const trimestre  = Math.round(lastMonth / 3);
    const roeSubLabel = `Q${trimestre} YTD × ${(12 / lastMonth).toFixed(2).replace(/\.00$/, '')}`;
    const firstBank  = ST.selectedOrder[0];

    const header     = document.getElementById('bankHeader');
    const headerName = document.getElementById('bankHeaderName');
    const headerSub  = document.getElementById('bankHeaderSub');
    if (header && firstBank != null) {
      const color = bankColor(firstBank, 0, bankName(firstBank));
      header.style.display = 'flex';
      header.style.borderLeftColor = color;
      headerName.textContent = bankName(firstBank);
      headerName.style.color = bankBrandTextColor('BR', firstBank) ?? btgBlue();
      const others = ST.selectedOrder.slice(1).map(c => bankName(c));
      headerSub.textContent = others.length
        ? `Compared with: ${others.join(', ')} · ${periodLabel(m.lastP)}`
        : `Last period: ${periodLabel(m.lastP)}`;
      _setBannerLogo('BR', firstBank);
    } else if (header) header.style.display = 'none';

    document.getElementById('kpiResumen').innerHTML = `
    <div class="kpi-col"><div class="kpi-col-title">Equity</div><div class="kpi purple kpi-btn" onclick="showResChart('patrimonio')"><div class="kpi-val">${fmtKPI(m.patrimonio)}</div><div class="kpi-sub">${fmtP(m.patrimonio, m.totalAssets)} of assets</div></div></div>
    <div class="kpi-col"><div class="kpi-col-title">Total Assets</div><div class="kpi blue kpi-btn" onclick="showResChart('activos')"><div class="kpi-val">${fmtKPI(m.totalAssets)}</div><div class="kpi-sub">${fmtP(m.colocaciones, m.totalAssets)} of loans</div></div></div>
    <div class="kpi-col"><div class="kpi-col-title">Net Income (YTD)</div><div class="kpi blue kpi-btn" onclick="showResChart('utilidad')"><div class="kpi-val ${m.utilidad < 0 ? 'neg' : ''}">${fmtKPI(m.utilidad)}</div><div class="kpi-sub">ROA ${fmtP(m.utilidad, m.totalAssets)}</div></div></div>
    <div class="kpi-col"><div class="kpi-col-title">Annual ROE</div><div class="kpi green kpi-btn" onclick="showResChart('roe_hist')"><div class="kpi-val ${utilAnualizada < 0 ? 'neg' : ''}">${roe}</div><div class="kpi-sub">${roeSubLabel}</div></div></div>`;

    document.getElementById('kpiBalance').innerHTML = `
    <div class="kpi blue"><div class="kpi-label">Total Assets</div><div class="kpi-val">${fmtKPI(m.totalAssets)}</div></div>
    <div class="kpi green"><div class="kpi-label">Credit Portfolio</div><div class="kpi-val">${fmtKPI(m.colocaciones)}</div></div>
    <div class="kpi yellow"><div class="kpi-label">Funding</div><div class="kpi-val">${fmtKPI(m.captacoes)}</div></div>
    <div class="kpi red"><div class="kpi-label">Equity</div><div class="kpi-val">${fmtKPI(m.patrimonio)}</div><div class="kpi-sub">Leverage ${m.patrimonio ? (m.totalAssets / m.patrimonio).toFixed(1) + 'x' : '—'}</div></div>`;

    document.getElementById('kpiResultados').innerHTML = `
    <div class="kpi blue"><div class="kpi-label">Net Income (YTD)</div><div class="kpi-val ${m.utilidad < 0 ? 'neg' : ''}">${fmtKPI(m.utilidad)}</div><div class="kpi-sub">ROA ${fmtP(m.utilidad, m.totalAssets)}</div></div>`;

    document.getElementById('kpiCalidad').innerHTML = `
    <div class="kpi" style="grid-column:1/-1;max-width:720px;"><div class="kpi-label">Brazil · IF.data (BCB)</div><div class="kpi-val">Summary report only</div><div class="kpi-sub">Los datos de Brasil provienen del Relatorio 1 (Resumo) de IF.data. El desglose de balance, estado de resultados y calidad de cartera se agregará con los Relatorios 2–5. El cambio de plan de cuentas de marzo-2025 queda registrado en la pestaña Config.</div></div>`;
    syncResChartCustomBtn();
    syncKpiResumenActive(ST._lastResChart || 'patrimonio');
    return;
  }

  if (datasetIsoCountry() === 'CO') {
    if (!(lastMonth >= 1 && lastMonth <= 12)) return;
    const utilAnualizada = m.utilidad ? m.utilidad * (12 / lastMonth) : 0;
    const roe        = m.patrimonio && m.utilidad ? (utilAnualizada / m.patrimonio * 100).toFixed(2) + '%' : '—';
    const roeSubLabel = `Month ${lastMonth} × ${(12 / lastMonth).toFixed(2).replace(/\.00$/, '')}`;
    const firstBank  = ST.selectedOrder[0];
    const moraLbl = m.colocaciones && Number.isFinite(m.mora90)
      ? fmtChartPct(nplPctFromRaw(m.mora90, m.colocaciones), false)
      : null;
    const header     = document.getElementById('bankHeader');
    const headerName = document.getElementById('bankHeaderName');
    const headerSub  = document.getElementById('bankHeaderSub');
    if (header && firstBank != null) {
      const color = bankColor(firstBank, 0, bankName(firstBank));
      header.style.display = 'flex';
      header.style.borderLeftColor = color;
      headerName.textContent = bankName(firstBank);
      headerName.style.color = bankBrandTextColor('CO', firstBank) ?? btgBlue();
      const others = ST.selectedOrder.slice(1).map(c => bankName(c));
      headerSub.textContent = others.length
        ? `Compared with: ${others.join(', ')} · ${periodLabel(m.lastP)}`
        : `Last period: ${periodLabel(m.lastP)}`;
      _setBannerLogo('CO', firstBank);
    } else if (header) header.style.display = 'none';

    document.getElementById('kpiResumen').innerHTML = `
    <div class="kpi-col"><div class="kpi-col-title">Equity</div><div class="kpi purple kpi-btn" onclick="showResChart('patrimonio')"><div class="kpi-val">${fmtKPI(m.patrimonio)}</div><div class="kpi-sub">${fmtP(m.patrimonio, m.totalAssets)} of assets</div></div></div>
    <div class="kpi-col"><div class="kpi-col-title">Total Assets</div><div class="kpi blue kpi-btn" onclick="showResChart('activos')"><div class="kpi-val">${fmtKPI(m.totalAssets)}</div><div class="kpi-sub">${fmtP(m.colocaciones, m.totalAssets)} of loans</div></div></div>
    <div class="kpi-col"><div class="kpi-col-title">Net Income</div><div class="kpi blue kpi-btn" onclick="showResChart('utilidad')"><div class="kpi-val ${m.utilidad < 0 ? 'neg' : ''}">${fmtKPI(m.utilidad)}</div><div class="kpi-sub">ROA ${fmtP(m.utilidad, m.totalAssets)}</div></div></div>
    <div class="kpi-col"><div class="kpi-col-title">Annual ROE</div><div class="kpi green kpi-btn" onclick="showResChart('roe_hist')"><div class="kpi-val ${utilAnualizada < 0 ? 'neg' : ''}">${roe}</div><div class="kpi-sub">${roeSubLabel}</div></div></div>`;

    document.getElementById('kpiBalance').innerHTML = `
    <div class="kpi blue"><div class="kpi-label">Total Assets</div><div class="kpi-val">${fmtKPI(m.totalAssets)}</div></div>
    <div class="kpi green"><div class="kpi-label">Gross Loans</div><div class="kpi-val">${fmtKPI(m.colocaciones)}</div></div>
    <div class="kpi yellow"><div class="kpi-label">Total Deposits</div><div class="kpi-val">${fmtKPI(m.depositos)}</div></div>
    <div class="kpi red"><div class="kpi-label">Equity</div><div class="kpi-val">${fmtKPI(m.patrimonio)}</div><div class="kpi-sub">Leverage ${m.patrimonio ? (m.totalAssets / m.patrimonio).toFixed(1) + 'x' : '—'}</div></div>`;

    document.getElementById('kpiResultados').innerHTML = `
    <div class="kpi blue"><div class="kpi-label">Net Income · 590000</div><div class="kpi-val ${m.utilidad < 0 ? 'neg' : ''}">${fmtKPI(m.utilidad)}</div><div class="kpi-sub">ROA ${fmtP(m.utilidad, m.totalAssets)}</div></div>`;

    document.getElementById('kpiCalidad').innerHTML = `
    <div class="kpi" style="grid-column:1/-1;max-width:640px;"><div class="kpi-label">Credit quality · Colombia</div><div class="kpi-val">${moraLbl != null ? `NPL ${moraLbl}` : 'Deterioro (148·149)'}</div><div class="kpi-sub">Key Data: suma del activo en cuentas 148### y 149### (deterioro) sobre colocación bruta 140000.</div></div>
    <div class="kpi" style="grid-column:1/-1;max-width:720px;"><div class="kpi-label">Calificaciones (referencia)</div><div class="kpi-val">Davivienda, Scotiabank Colpatria y Banco Caja Social: AAA</div><div class="kpi-sub">Davivienda es AAA; Scotiabank Colpatria también es AAA; Banco Caja Social también lo es. Más bancos y perspectivas en la pestaña Banking System.</div></div>`;
    syncResChartCustomBtn();
    syncKpiResumenActive(ST._lastResChart || 'patrimonio');
    return;
  }

  if (datasetIsoCountry() === 'UY') {
    if (!(lastMonth >= 1 && lastMonth <= 12)) return;
    const utilAnualizada = m.utilidad ? m.utilidad * (12 / lastMonth) : 0;
    const roe = m.patrimonio && m.utilidad ? (utilAnualizada / m.patrimonio * 100).toFixed(2) + '%' : '—';
    const roeSubLabel = `Month ${lastMonth} × ${(12 / lastMonth).toFixed(2).replace(/\.00$/, '')}`;
    const firstBank = ST.selectedOrder[0];
    const header = document.getElementById('bankHeader');
    const headerName = document.getElementById('bankHeaderName');
    const headerSub = document.getElementById('bankHeaderSub');
    if (header && firstBank != null) {
      const color = bankColor(firstBank, 0, bankName(firstBank));
      header.style.display = 'flex';
      header.style.borderLeftColor = color;
      headerName.textContent = bankName(firstBank);
      headerName.style.color = bankBrandTextColor('UY', firstBank) ?? btgBlue();
      const others = ST.selectedOrder.slice(1).map(c => bankName(c));
      headerSub.textContent = others.length
        ? `Compared with: ${others.join(', ')} · ${periodLabel(m.lastP)}`
        : `Last period: ${periodLabel(m.lastP)}`;
      _setBannerLogo('UY', firstBank);
    } else if (header) header.style.display = 'none';

    document.getElementById('kpiResumen').innerHTML = `
    <div class="kpi-col"><div class="kpi-col-title">Equity</div><div class="kpi purple kpi-btn" onclick="showResChart('patrimonio')"><div class="kpi-val">${fmtKPI(m.patrimonio)}</div><div class="kpi-sub">${fmtP(m.patrimonio, m.totalAssets)} of assets</div></div></div>
    <div class="kpi-col"><div class="kpi-col-title">Total Assets</div><div class="kpi blue kpi-btn" onclick="showResChart('activos')"><div class="kpi-val">${fmtKPI(m.totalAssets)}</div><div class="kpi-sub">${fmtP(m.colocaciones, m.totalAssets)} of loans</div></div></div>
    <div class="kpi-col"><div class="kpi-col-title">Net Income (YTD)</div><div class="kpi blue kpi-btn" onclick="showResChart('utilidad')"><div class="kpi-val ${m.utilidad < 0 ? 'neg' : ''}">${fmtKPI(m.utilidad)}</div><div class="kpi-sub">ROA ${fmtP(m.utilidad, m.totalAssets)}</div></div></div>
    <div class="kpi-col"><div class="kpi-col-title">Annual ROE</div><div class="kpi green kpi-btn" onclick="showResChart('roe_hist')"><div class="kpi-val ${utilAnualizada < 0 ? 'neg' : ''}">${roe}</div><div class="kpi-sub">${roeSubLabel}</div></div></div>`;

    document.getElementById('kpiBalance').innerHTML = `
    <div class="kpi blue"><div class="kpi-label">Total Assets</div><div class="kpi-val">${fmtKPI(m.totalAssets)}</div></div>
    <div class="kpi green"><div class="kpi-label">Loans (amortized cost)</div><div class="kpi-val">${fmtKPI(m.colocaciones)}</div></div>
    <div class="kpi yellow"><div class="kpi-label">Total Deposits</div><div class="kpi-val">${fmtKPI(m.depositos)}</div></div>
    <div class="kpi red"><div class="kpi-label">Equity</div><div class="kpi-val">${fmtKPI(m.patrimonio)}</div><div class="kpi-sub">Leverage ${m.patrimonio ? (m.totalAssets / m.patrimonio).toFixed(1) + 'x' : '—'}</div></div>`;

    document.getElementById('kpiResultados').innerHTML = `
    <div class="kpi blue"><div class="kpi-label">Net Income (YTD)</div><div class="kpi-val ${m.utilidad < 0 ? 'neg' : ''}">${fmtKPI(m.utilidad)}</div><div class="kpi-sub">ROA ${fmtP(m.utilidad, m.totalAssets)}</div></div>`;

    document.getElementById('kpiCalidad').innerHTML = `
    <div class="kpi" style="grid-column:1/-1;max-width:720px;"><div class="kpi-label">Uruguay · BCU / SSF</div><div class="kpi-val">Boletín mensual</div><div class="kpi-sub">Estado de Situación y Resultados del Boletín SSF. NPL detallado no está mapeado aún; KPIs usan créditos a costo amortizado (1.4.1–1.4.3) y depósitos (2.1.2–2.1.4).</div></div>`;
    syncResChartCustomBtn();
    syncKpiResumenActive(ST._lastResChart || 'patrimonio');
    return;
  }

  if (datasetIsoCountry() === 'PE') {
    if (!(lastMonth >= 1 && lastMonth <= 12)) return;
    const utilAnualizada = m.utilidad ? m.utilidad * (12 / lastMonth) : 0;
    const roe = m.patrimonio && m.utilidad ? (utilAnualizada / m.patrimonio * 100).toFixed(2) + '%' : '—';
    const roeSubLabel = `Month ${lastMonth} × ${(12 / lastMonth).toFixed(2).replace(/\.00$/, '')}`;
    const firstBank = ST.selectedOrder[0];
    const header = document.getElementById('bankHeader');
    const headerName = document.getElementById('bankHeaderName');
    const headerSub = document.getElementById('bankHeaderSub');
    if (header && firstBank != null) {
      const color = bankColor(firstBank, 0, bankName(firstBank));
      header.style.display = 'flex';
      header.style.borderLeftColor = color;
      headerName.textContent = bankName(firstBank);
      headerName.style.color = bankBrandTextColor('PE', firstBank) ?? btgBlue();
      const others = ST.selectedOrder.slice(1).map(c => bankName(c));
      headerSub.textContent = others.length
        ? `Compared with: ${others.join(', ')} · ${periodLabel(m.lastP)}`
        : `Last period: ${periodLabel(m.lastP)}`;
      _setBannerLogo('PE', firstBank);
    } else if (header) header.style.display = 'none';

    document.getElementById('kpiResumen').innerHTML = `
    <div class="kpi-col"><div class="kpi-col-title">Equity</div><div class="kpi purple kpi-btn" onclick="showResChart('patrimonio')"><div class="kpi-val">${fmtKPI(m.patrimonio)}</div><div class="kpi-sub">${fmtP(m.patrimonio, m.totalAssets)} of assets</div></div></div>
    <div class="kpi-col"><div class="kpi-col-title">Total Assets</div><div class="kpi blue kpi-btn" onclick="showResChart('activos')"><div class="kpi-val">${fmtKPI(m.totalAssets)}</div><div class="kpi-sub">${fmtP(m.colocaciones, m.totalAssets)} of loans</div></div></div>
    <div class="kpi-col"><div class="kpi-col-title">Net Income (YTD)</div><div class="kpi blue kpi-btn" onclick="showResChart('utilidad')"><div class="kpi-val ${m.utilidad < 0 ? 'neg' : ''}">${fmtKPI(m.utilidad)}</div><div class="kpi-sub">ROA ${fmtP(m.utilidad, m.totalAssets)}</div></div></div>
    <div class="kpi-col"><div class="kpi-col-title">Annual ROE</div><div class="kpi green kpi-btn" onclick="showResChart('roe_hist')"><div class="kpi-val ${utilAnualizada < 0 ? 'neg' : ''}">${roe}</div><div class="kpi-sub">${roeSubLabel}</div></div></div>`;

    document.getElementById('kpiBalance').innerHTML = `
    <div class="kpi blue"><div class="kpi-label">Total Assets</div><div class="kpi-val">${fmtKPI(m.totalAssets)}</div></div>
    <div class="kpi green"><div class="kpi-label">Loans (net)</div><div class="kpi-val">${fmtKPI(m.colocaciones)}</div></div>
    <div class="kpi yellow"><div class="kpi-label">Deposits (public)</div><div class="kpi-val">${fmtKPI(m.depositos)}</div></div>
    <div class="kpi red"><div class="kpi-label">Equity</div><div class="kpi-val">${fmtKPI(m.patrimonio)}</div><div class="kpi-sub">Leverage ${m.patrimonio ? (m.totalAssets / m.patrimonio).toFixed(1) + 'x' : '—'}</div></div>`;

    document.getElementById('kpiResultados').innerHTML = `
    <div class="kpi blue"><div class="kpi-label">Net Income (YTD)</div><div class="kpi-val ${m.utilidad < 0 ? 'neg' : ''}">${fmtKPI(m.utilidad)}</div><div class="kpi-sub">ROA ${fmtP(m.utilidad, m.totalAssets)}</div></div>`;

    document.getElementById('kpiCalidad').innerHTML = `
    <div class="kpi" style="grid-column:1/-1;max-width:720px;"><div class="kpi-label">Perú · SBS B-2201</div><div class="kpi-val">Banca Múltiple</div><div class="kpi-sub">Balance y PyG del boletín estadístico SBS. Créditos = netos de provisiones; depósitos = obligaciones con el público. NPL % aún no mapeado.</div></div>`;
    syncResChartCustomBtn();
    syncKpiResumenActive(ST._lastResChart || 'patrimonio');
    return;
  }

  if (datasetIsoCountry() === 'US') {
    if (!(lastMonth >= 1 && lastMonth <= 12)) return;
    // Trimestral YTD: anualizar × (12/mes) como BR/CO
    const utilAnualizada = m.utilidad ? m.utilidad * (12 / lastMonth) : 0;
    const roe = m.patrimonio && m.utilidad ? (utilAnualizada / m.patrimonio * 100).toFixed(2) + '%' : '—';
    const q = Math.round(lastMonth / 3);
    const roeSubLabel = `Q${q} YTD × ${(12 / lastMonth).toFixed(2).replace(/\.00$/, '')}`;
    const firstBank = ST.selectedOrder[0];
    const header = document.getElementById('bankHeader');
    const headerName = document.getElementById('bankHeaderName');
    const headerSub = document.getElementById('bankHeaderSub');
    if (header && firstBank != null) {
      const color = bankColor(firstBank, 0, bankName(firstBank));
      header.style.display = 'flex';
      header.style.borderLeftColor = color;
      headerName.textContent = bankName(firstBank);
      headerName.style.color = bankBrandTextColor('US', firstBank) ?? btgBlue();
      const others = ST.selectedOrder.slice(1).map(c => bankName(c));
      headerSub.textContent = others.length
        ? `Compared with: ${others.join(', ')} · ${periodLabel(m.lastP)}`
        : `Last period: ${periodLabel(m.lastP)}`;
      _setBannerLogo('US', firstBank);
    } else if (header) header.style.display = 'none';

    document.getElementById('kpiResumen').innerHTML = `
    <div class="kpi-col"><div class="kpi-col-title">Equity</div><div class="kpi purple kpi-btn" onclick="showResChart('patrimonio')"><div class="kpi-val">${fmtKPI(m.patrimonio)}</div><div class="kpi-sub">${fmtP(m.patrimonio, m.totalAssets)} of assets</div></div></div>
    <div class="kpi-col"><div class="kpi-col-title">Total Assets</div><div class="kpi blue kpi-btn" onclick="showResChart('activos')"><div class="kpi-val">${fmtKPI(m.totalAssets)}</div><div class="kpi-sub">${fmtP(m.colocaciones, m.totalAssets)} of loans</div></div></div>
    <div class="kpi-col"><div class="kpi-col-title">Net Income (YTD)</div><div class="kpi blue kpi-btn" onclick="showResChart('utilidad')"><div class="kpi-val ${m.utilidad < 0 ? 'neg' : ''}">${fmtKPI(m.utilidad)}</div><div class="kpi-sub">ROA ${fmtP(m.utilidad, m.totalAssets)}</div></div></div>
    <div class="kpi-col"><div class="kpi-col-title">Annual ROE</div><div class="kpi green kpi-btn" onclick="showResChart('roe_hist')"><div class="kpi-val ${utilAnualizada < 0 ? 'neg' : ''}">${roe}</div><div class="kpi-sub">${roeSubLabel}</div></div></div>`;

    document.getElementById('kpiBalance').innerHTML = `
    <div class="kpi blue"><div class="kpi-label">Total Assets</div><div class="kpi-val">${fmtKPI(m.totalAssets)}</div></div>
    <div class="kpi green"><div class="kpi-label">Net loans & leases</div><div class="kpi-val">${fmtKPI(m.colocaciones)}</div></div>
    <div class="kpi yellow"><div class="kpi-label">Total deposits</div><div class="kpi-val">${fmtKPI(m.depositos)}</div></div>
    <div class="kpi red"><div class="kpi-label">Equity</div><div class="kpi-val">${fmtKPI(m.patrimonio)}</div><div class="kpi-sub">Leverage ${m.patrimonio ? (m.totalAssets / m.patrimonio).toFixed(1) + 'x' : '—'}</div></div>`;

    document.getElementById('kpiResultados').innerHTML = `
    <div class="kpi blue"><div class="kpi-label">Net Income (YTD)</div><div class="kpi-val ${m.utilidad < 0 ? 'neg' : ''}">${fmtKPI(m.utilidad)}</div><div class="kpi-sub">ROA ${fmtP(m.utilidad, m.totalAssets)}</div></div>`;

    document.getElementById('kpiCalidad').innerHTML = `
    <div class="kpi" style="grid-column:1/-1;max-width:720px;"><div class="kpi-label">United States · FDIC</div><div class="kpi-val">Top 300 by equity</div><div class="kpi-sub">Call Report fields vía BankFind API. Universo = 300 mayores EQTOT del trimestre (no los ~4.300 bancos FDIC). NPL detallado no incluido en este corte.</div></div>`;
    syncResChartCustomBtn();
    syncKpiResumenActive(ST._lastResChart || 'patrimonio');
    return;
  }

  if (datasetIsoCountry() === 'AR' || datasetIsoCountry() === 'MX' || datasetIsoCountry() === 'PA') {
    if (!(lastMonth >= 1 && lastMonth <= 12)) return;
    const isoAM = datasetIsoCountry();
    const utilAnualizada = m.utilidad ? m.utilidad * (12 / lastMonth) : 0;
    const roe = m.patrimonio && m.utilidad ? (utilAnualizada / m.patrimonio * 100).toFixed(2) + '%' : '—';
    const roeSubLabel = `Month ${lastMonth} × ${(12 / lastMonth).toFixed(2).replace(/\.00$/, '')}`;
    const firstBank = ST.selectedOrder[0];
    const header = document.getElementById('bankHeader');
    const headerName = document.getElementById('bankHeaderName');
    const headerSub = document.getElementById('bankHeaderSub');
    if (header && firstBank != null) {
      const color = bankColor(firstBank, 0, bankName(firstBank));
      header.style.display = 'flex';
      header.style.borderLeftColor = color;
      headerName.textContent = bankName(firstBank);
      headerName.style.color = bankBrandTextColor(isoAM, firstBank) ?? btgBlue();
      const others = ST.selectedOrder.slice(1).map(c => bankName(c));
      headerSub.textContent = others.length
        ? `Compared with: ${others.join(', ')} · ${periodLabel(m.lastP)}`
        : `Last period: ${periodLabel(m.lastP)}`;
      _setBannerLogo(isoAM, firstBank);
    } else if (header) header.style.display = 'none';

    document.getElementById('kpiResumen').innerHTML = `
    <div class="kpi-col"><div class="kpi-col-title">Equity</div><div class="kpi purple kpi-btn" onclick="showResChart('patrimonio')"><div class="kpi-val">${fmtKPI(m.patrimonio)}</div><div class="kpi-sub">${fmtP(m.patrimonio, m.totalAssets)} of assets</div></div></div>
    <div class="kpi-col"><div class="kpi-col-title">Total Assets</div><div class="kpi blue kpi-btn" onclick="showResChart('activos')"><div class="kpi-val">${fmtKPI(m.totalAssets)}</div><div class="kpi-sub">${fmtP(m.colocaciones, m.totalAssets)} of loans</div></div></div>
    <div class="kpi-col"><div class="kpi-col-title">Net Income (YTD)</div><div class="kpi blue kpi-btn" onclick="showResChart('utilidad')"><div class="kpi-val ${m.utilidad < 0 ? 'neg' : ''}">${fmtKPI(m.utilidad)}</div><div class="kpi-sub">ROA ${fmtP(m.utilidad, m.totalAssets)}</div></div></div>
    <div class="kpi-col"><div class="kpi-col-title">Annual ROE</div><div class="kpi green kpi-btn" onclick="showResChart('roe_hist')"><div class="kpi-val ${utilAnualizada < 0 ? 'neg' : ''}">${roe}</div><div class="kpi-sub">${roeSubLabel}</div></div></div>`;

    document.getElementById('kpiBalance').innerHTML = `
    <div class="kpi blue"><div class="kpi-label">Total Assets</div><div class="kpi-val">${fmtKPI(m.totalAssets)}</div></div>
    <div class="kpi green"><div class="kpi-label">${isoAM === 'MX' || isoAM === 'PA' ? 'Loan portfolio' : 'Loans'}</div><div class="kpi-val">${fmtKPI(m.colocaciones)}</div></div>
    <div class="kpi yellow"><div class="kpi-label">Deposits</div><div class="kpi-val">${fmtKPI(m.depositos)}</div></div>
    <div class="kpi red"><div class="kpi-label">Equity</div><div class="kpi-val">${fmtKPI(m.patrimonio)}</div><div class="kpi-sub">Leverage ${m.patrimonio ? (m.totalAssets / m.patrimonio).toFixed(1) + 'x' : '—'}</div></div>`;

    document.getElementById('kpiResultados').innerHTML = `
    <div class="kpi blue"><div class="kpi-label">Net Income (YTD)</div><div class="kpi-val ${m.utilidad < 0 ? 'neg' : ''}">${fmtKPI(m.utilidad)}</div><div class="kpi-sub">ROA ${fmtP(m.utilidad, m.totalAssets)}</div></div>`;

    document.getElementById('kpiCalidad').innerHTML = isoAM === 'AR'
      ? `<div class="kpi" style="grid-column:1/-1;max-width:720px;"><div class="kpi-label">Argentina · BCRA</div><div class="kpi-val">Datos abiertos entidades</div><div class="kpi-sub">Balance baldet (débito/crédito). Resultado neto = A−P−PN (rdos. integrales del período). NPL no mapeado en este corte.</div></div>`
      : isoAM === 'PA'
      ? `<div class="kpi" style="grid-column:1/-1;max-width:720px;"><div class="kpi-label">Panamá · SBP</div><div class="kpi-val">Reportes individuales</div><div class="kpi-sub">Balance y PyG del Superintendencia de Bancos. Equity = PATRIMONIO · NI = RESULTADO_NETO (YTD). NPL no mapeado en este corte.</div></div>`
      : `<div class="kpi" style="grid-column:1/-1;max-width:720px;"><div class="kpi-label">México · CNBV</div><div class="kpi-val">Banca Múltiple</div><div class="kpi-sub">Principales rubros del Boletín Estadístico (Pm2). Captación total como proxy de depósitos. NPL no mapeado en este corte.</div></div>`;
    syncResChartCustomBtn();
    syncKpiResumenActive(ST._lastResChart || 'patrimonio');
    return;
  }

  if (!(lastMonth >= 1 && lastMonth <= 12)) return;
  const utilAnualizada = m.utilidad ? m.utilidad * (12 / lastMonth) : 0;
  const roe        = m.patrimonio && m.utilidad ? (utilAnualizada / m.patrimonio * 100).toFixed(2) + '%' : '—';
  const roeSubLabel = `Month ${lastMonth} × ${Math.round(12 / lastMonth)}`;

  const firstBank  = ST.selectedOrder[0];

  const header     = document.getElementById('bankHeader');
  const headerName = document.getElementById('bankHeaderName');
  const headerSub  = document.getElementById('bankHeaderSub');
  if (header && firstBank != null) {
    const color = bankColor(firstBank, 0, bankName(firstBank));
    header.style.display = 'flex';
    header.style.borderLeftColor = color;
    headerName.textContent = bankName(firstBank);
    headerName.style.color = bankBrandTextColor('CL', firstBank) ?? btgBlue();
    const others = ST.selectedOrder.slice(1).map(c => bankName(c));
    headerSub.textContent = others.length
      ? `Compared with: ${others.join(', ')} · ${periodLabel(m.lastP)}`
      : `Last period: ${periodLabel(m.lastP)}`;
    _setBannerLogo('CL', firstBank);
  } else if (header) {
    header.style.display = 'none';
  }

  document.getElementById('kpiResumen').innerHTML = `
    <div class="kpi-col"><div class="kpi-col-title">Equity</div><div class="kpi purple kpi-btn" onclick="showResChart('patrimonio')"><div class="kpi-val">${fmtKPI(m.patrimonio)}</div><div class="kpi-sub">${fmtP(m.patrimonio, m.totalAssets)} of assets</div></div></div>
    <div class="kpi-col"><div class="kpi-col-title">Total Assets</div><div class="kpi blue kpi-btn" onclick="showResChart('activos')"><div class="kpi-val">${fmtKPI(m.totalAssets)}</div><div class="kpi-sub">${fmtP(m.colocaciones, m.totalAssets)} of loans</div></div></div>
    <div class="kpi-col"><div class="kpi-col-title">Net Income</div><div class="kpi blue kpi-btn" onclick="showResChart('utilidad')"><div class="kpi-val ${m.utilidad < 0 ? 'neg' : ''}">${fmtKPI(m.utilidad)}</div><div class="kpi-sub">ROA ${fmtP(m.utilidad, m.totalAssets)}</div></div></div>
    <div class="kpi-col"><div class="kpi-col-title">Annual ROE</div><div class="kpi green kpi-btn" onclick="showResChart('roe_hist')"><div class="kpi-val ${utilAnualizada < 0 ? 'neg' : ''}">${roe}</div><div class="kpi-sub">${roeSubLabel}</div></div></div>
  `;

  document.getElementById('kpiBalance').innerHTML = `
    <div class="kpi blue"><div class="kpi-label">Total Assets</div><div class="kpi-val">${fmtKPI(m.totalAssets)}</div><div class="kpi-sub">${fmtP(m.colocaciones, m.totalAssets)} of loans</div></div>
    <div class="kpi green"><div class="kpi-label">Net Loans</div><div class="kpi-val">${fmtKPI(m.colocaciones)}</div><div class="kpi-sub">${fmtP(m.colocaciones, m.totalAssets)} of assets</div></div>
    <div class="kpi yellow"><div class="kpi-label">Total Deposits</div><div class="kpi-val">${fmtKPI(m.depositos)}</div></div>
    <div class="kpi red"><div class="kpi-label">Equity</div><div class="kpi-val">${fmtKPI(m.patrimonio)}</div><div class="kpi-sub">Leverage ${m.patrimonio ? (m.totalAssets / m.patrimonio).toFixed(1) + 'x' : '—'}</div></div>
  `;

  document.getElementById('kpiResultados').innerHTML = `
    <div class="kpi blue"><div class="kpi-label">Net Income</div><div class="kpi-val ${m.utilidad < 0 ? 'neg' : ''}">${fmtKPI(m.utilidad)}</div><div class="kpi-sub">ROA ${fmtP(m.utilidad, m.totalAssets)}</div></div>
    <div class="kpi green"><div class="kpi-label">Net Interest Income</div><div class="kpi-val">${fmtKPI(m.ingresoNeto)}</div></div>
    <div class="kpi yellow"><div class="kpi-label">Total Operating Income</div><div class="kpi-val">${fmtKPI(m.totalIng)}</div><div class="kpi-sub">Fees ${fmtKPI(m.ingComis)}</div></div>
    <div class="kpi red"><div class="kpi-label">Credit Losses</div><div class="kpi-val">${fmtKPI(Math.abs(m.perdCred))}</div><div class="kpi-sub">${fmtP(Math.abs(m.perdCred), m.totalIng)} of income</div></div>
  `;
  syncResChartCustomBtn();
  syncKpiResumenActive(ST._lastResChart || 'patrimonio');
}

// Wrapper: KPIs base + cuadritos extra de "Financial Highlights".
export function refreshKPIs() {
  refreshKPIsBase();
  renderHighlightExtras();
}

/** Cuadritos extra de "Financial Highlights":
 *  - Total Loans (gráficable)
 *  - Total Loans / Total Equity (ratio)
 *  - Custom: selector para graficar CUALQUIER cuenta del país. */
function renderHighlightExtras() {
  const m = ST._kpiRaw;
  const cont = document.getElementById('kpiResumen');
  if (!m || !cont) return;
  const loans = m.colocaciones || 0;
  const eq    = m.patrimonio || 0;
  const ratio = eq ? (loans / eq).toFixed(1) + 'x' : '—';
  cont.insertAdjacentHTML('beforeend',
      `<div class="kpi-col"><div class="kpi-col-title">Total Loans</div><div class="kpi green kpi-btn" onclick="showResChart('coloc')"><div class="kpi-val">${fmtKPI(loans)}</div><div class="kpi-sub">${fmtP(loans, m.totalAssets)} of assets</div></div></div>`
    + `<div class="kpi-col"><div class="kpi-col-title">Loans / Equity</div><div class="kpi purple kpi-btn" onclick="showResChart('loans_equity')"><div class="kpi-val">${ratio}</div><div class="kpi-sub">times equity</div></div></div>`
    + `<div class="kpi-col"><div class="kpi-col-title">ROE Ranking</div><div class="kpi green kpi-btn" onclick="showROEChart()"><div class="kpi-val">All banks</div><div class="kpi-sub">Ranking by annual ROE</div></div></div>`
    + `<div class="kpi-col">${customKpiTileHtml(m)}</div>`
  );
  injectNiPills();
  syncKpiResumenActive(ST._lastResChart || 'patrimonio');
}

// Inserta el sub-selector YTD / Period dentro del cuadrito de Net Income.
function injectNiPills() {
  const cont = document.getElementById('kpiResumen');
  if (!cont) return;
  const niTile = cont.querySelector('.kpi[onclick*="utilidad"]');
  if (!niTile) return;
  const nm = ST._niMode || 'period';
  const pill = (mv, lbl) => `<span onclick="event.stopPropagation();setNiMode('${mv}')" style="cursor:pointer;padding:1px 6px;border-radius:7px;font-size:8px;font-weight:700;text-align:center;line-height:1.35;${nm === mv ? 'background:#0284c7;color:#fff;' : 'border:1px solid var(--border2);color:var(--text2);background:var(--bg3);'}">${lbl}</span>`;

  // Envuelve el texto (valor + sub) a la izquierda y coloca los toggles a la derecha,
  // apilados verticalmente → el cuadrito no crece en altura.
  let left = niTile.querySelector('.ni-left');
  if (!left) {
    left = document.createElement('div');
    left.className = 'ni-left';
    left.style.minWidth = '0';
    while (niTile.firstChild) left.appendChild(niTile.firstChild);
    niTile.appendChild(left);
    niTile.style.display = 'flex';
    niTile.style.alignItems = 'center';
    niTile.style.justifyContent = 'space-between';
    niTile.style.gap = '6px';
  }
  let bar = niTile.querySelector('.ni-mode-bar');
  if (!bar) {
    bar = document.createElement('div');
    bar.className = 'ni-mode-bar';
    bar.style.cssText = 'display:flex;flex-direction:column;gap:3px;flex-shrink:0;';
    niTile.appendChild(bar);
  }
  bar.innerHTML = `${pill('ytd', 'YTD')}${pill('period', 'Period')}`;
}

/** Top loading strip · oculta si el overlay de arranque (#loadingScreen) sigue visible */
export function setRunLoadingBar(on) {
  if (on) {
    const ls = document.getElementById('loadingScreen');
    if (ls && getComputedStyle(ls).display !== 'none') return;
  }
  const bar = document.getElementById('loadingBar');
  const row = document.getElementById('loadingBarRow');
  if (bar) bar.style.display = on ? 'block' : 'none';
  if (row) row.classList.toggle('is-loading', !!on);
}

// ---- Main data-fetch and render loop ----
export async function run() {
  if (!ST.selected.size) { showErr('Please select at least one bank'); return; }
  showErr('');
  setStatus('loading', 'Loading...');
  setRunLoadingBar(true);

  console.log('[run] start — selected:', [...ST.selected], 'desde:', ST.desde, 'hasta:', ST.hasta);
  ST._activeBalBank = null;
  ST._activeResBank = null;

  const selDesde = document.getElementById('selDesde').value;
  const selHasta = document.getElementById('selHasta').value;

  if (selDesde !== ST.desde || selHasta !== ST.hasta) ST.data = {};
  ST.desde = selDesde;
  ST.hasta = selHasta;

  const todosLosPeriodos = ST.periodos.filter(p => p >= ST.desde && p <= ST.hasta);
  if (!todosLosPeriodos.length) {
    showErr('No hay períodos en el rango Desde/Hasta seleccionado. Elige otro intervalo.');
    setStatus('error', 'Empty date range');
    setRunLoadingBar(false);
    document.getElementById('dashContent').style.display = 'flex';
    return;
  }
  const lastP = todosLosPeriodos[todosLosPeriodos.length - 1];

  let periodos;
  const UMBRAL_TRIMESTRAL = 26;
  if (todosLosPeriodos.length > UMBRAL_TRIMESTRAL) {
    const trimSet = new Set();
    trimSet.add(lastP);
    for (let i = todosLosPeriodos.length - 1; i >= 0; i -= 3) trimSet.add(todosLosPeriodos[i]);
    periodos = todosLosPeriodos.filter(p => trimSet.has(p));
  } else {
    periodos = todosLosPeriodos;
  }

  const isTrimestral = periodos.length < todosLosPeriodos.length;
  ST.lastPeriodo = lastP;

  const rangeLabel = periodLabel(todosLosPeriodos[0]) + ' — ' + periodLabel(lastP);
  document.getElementById('rangePill').textContent = rangeLabel + (isTrimestral ? ' · trimestral' : '');

  const banks = [...ST.selected];

  try {
    if (datasetIsoCountry() === 'BR') {
      const R1_SET = new Set(brR1AccountsForRun());
      const customBR   = resolveCustomKpiForRun();
      const customIsR1 = customBR ? R1_SET.has(String(customBR.cuenta)) : false;
      const B1_BR = [...new Set([
        ...brB1AccountsForRun(),
        ...(customBR && !customIsR1 ? [String(customBR.cuenta)] : []),
      ])];
      const R1_BR = [...new Set([
        ...brR1AccountsForRun(),
        ...(customBR && customIsR1 ? [String(customBR.cuenta)] : []),
      ])];

      runAbortController?.abort();
      runAbortController = new AbortController();
      const signal = runAbortController.signal;

      console.log('[run BR] fetching — periodos:', periodos.length, 'banks:', banks);
      const [b1, r1] = await Promise.all([
        fetchData('b1', B1_BR, periodos, banks, signal),
        fetchData('r1', R1_BR, periodos, banks, signal),
      ]);
      if (signal.aborted) { setRunLoadingBar(false); return; }

      const firstBank = ST.selectedOrder[0] || banks[0];
      const b1First = b1.filter(r => r.ins_cod === firstBank);
      const r1First = r1.filter(r => r.ins_cod === firstBank);

      const totalAssets  = brSum(b1First, BR_KPI.activos, lastP);
      const colocaciones = brSum(b1First, BR_KPI.colocaciones, lastP);
      const captacoes    = brSum(b1First, BR_KPI.captacoes, lastP);
      const pasivos      = brSum(b1First, BR_KPI.pasivos, lastP);
      const patrimonio   = brSum(b1First, BR_KPI.patrimonio, lastP);
      const tvm          = brSum(b1First, BR_KPI.tvm, lastP);
      // Net Income YTD REAL: Brasil acumula por semestre, así que reconstruimos el
      // acumulado del año (en H2 se suma el cierre de junio).
      const utilByP = {};
      periodos.forEach(p => { utilByP[p] = brSum(r1First, BR_KPI.utilidad, p); });
      const utilidad     = brResultReset(utilByP, lastP, 'ytd');
      const customKpi    = computeCustomKpiSnapshot(b1, r1, [], firstBank, lastP);

      ST._kpiRaw = {
        totalAssets, colocaciones, captacoes, tvm,
        pasivos, patrimonio, utilidad,
        depositos: captacoes, depVista: null, depPlazo: null, bonos: null,
        mora90: null, customKpi, ingresoNeto: null, totalIng: null,
        lastP, perdCred: null, impuesto: null, resOp: null, totalGas: null,
        resOpA: null, ingComis: null, ingresoReaj: null, resFin: null,
      };
      refreshKPIs();

      ST._series = { periodos, b1, r1, c1: [] };
      showResChart(ST._lastResChart || 'patrimonio');

      ST._b1 = b1;
      ST._lastP = lastP;
      ST._resTableData = null;

      showBalTab(ST._lastBalTab || 'assets');
      renderResTable(null);

      const hi = document.getElementById('headerInfo');
      if (hi) hi.textContent = rangeLabel;

      document.getElementById('dashContent').style.display = 'flex';
      setRunLoadingBar(false);
      setStatus('ok', `Brazil IF.data · ${periodos.length} quarters · ${ST.selected.size} bank(s)`);
      return;
    }

    if (datasetIsoCountry() === 'CO') {
      const B1_BASE = coB1AccountsForRun();
      const deterioroC = coDeterioroActivoCuentasFromPlan(Object.keys(ST.planCuentas || {}));
      const customCO  = resolveCustomKpiForRun();
      const customTipo = customCO ? getTipo(customCO.cuenta) : null;
      const B1_CO = [...new Set([
        ...B1_BASE,
        ...deterioroC,
        ...(customTipo === 'b1' && customCO ? [customCO.cuenta] : []),
      ])];
      const R1_CO = [...new Set([
        ...coR1AccountsForRun(),
        ...(customTipo === 'r1' && customCO ? [customCO.cuenta] : []),
      ])];
      const C1_CUENTAS_CO = customTipo === 'c1' && customCO ? [customCO.cuenta] : [];

      runAbortController?.abort();
      runAbortController = new AbortController();
      const signal = runAbortController.signal;

      console.log('[run CO] fetching — periodos:', periodos.length, 'banks:', banks);
      const [b1, r1, c1] = await Promise.all([
        fetchData('b1', B1_CO, periodos, banks, signal),
        fetchData('r1', R1_CO, periodos, banks, signal),
        C1_CUENTAS_CO.length
          ? fetchData('c1', C1_CUENTAS_CO, periodos, banks, signal)
          : Promise.resolve([]),
      ]);
      if (signal.aborted) {
        setRunLoadingBar(false);
        return;
      }

      const firstBank = ST.selectedOrder[0] || banks[0];
      const b1v = c => sumRows(b1.filter(r => r.ins_cod === firstBank), c, lastP);
      const r1v = c => sumRows(r1.filter(r => r.ins_cod === firstBank), c, lastP);
      const b1s = c => getSeriesForCuenta(b1, c, periodos);
      const r1s = c => getSeriesForCuenta(r1, c, periodos);
      const c1s = c => getSeriesForCuenta(c1, c, periodos);

      const totalAssets  = b1v(CO_CUIF.activos);
      const colocaciones = b1v(CO_CUIF.colocaciones);
      const depVista     = b1v(CO_CUIF.depVista);
      const depPlazo     = b1v(CO_CUIF.depPlazo);
      const depositos    = depVista + depPlazo;
      const bonos        = b1v(CO_CUIF.bonos);
      const patrimonio   = b1v(CO_CUIF.patrimonio);
      const utilidad     = r1v(CO_CUIF.utilidadNet);
      const b1RowsFirst  = b1.filter(r => r.ins_cod === firstBank);
      const mora90       = coMoraNumerator(b1RowsFirst, lastP);
      const customKpi    = computeCustomKpiSnapshot(b1, r1, c1, firstBank, lastP);

      ST._kpiRaw = {
        totalAssets,
        colocaciones,
        depositos,
        depVista,
        depPlazo,
        bonos,
        patrimonio,
        utilidad,
        mora90,
        customKpi,
        pasivos: b1v(CO_CUIF.pasivos),
        ingresoNeto: null,
        totalIng: null,
        lastP,
        perdCred: null,
        impuesto: null,
        resOp: null,
        totalGas: null,
        resOpA: null,
        ingComis: null,
        ingresoReaj: null,
        resFin: null,
      };
      refreshKPIs();

      ST._series = { periodos, b1s, r1s, c1s, b1, r1, c1 };
      showResChart(ST._lastResChart || 'patrimonio');

      ST._b1    = b1;
      ST._c1    = c1.length ? c1 : null;
      ST._lastP = lastP;
      ST._resTableData = null;

      showBalTab(ST._lastBalTab || 'assets');
      renderResTable(null);

      const hi = document.getElementById('headerInfo');
      if (hi) hi.textContent = rangeLabel;

      document.getElementById('dashContent').style.display = 'flex';
      setRunLoadingBar(false);
      setStatus('ok', `Colombia CUIF · ${periodos.length} periods${isTrimestral ? ' (quarterly)' : ''} · ${ST.selected.size} bank(s)`);
      return;
    }

    if (datasetIsoCountry() === 'UY') {
      const customUY = resolveCustomKpiForRun();
      const customTipo = customUY ? getTipo(customUY.cuenta) : null;
      const B1_UY = [...new Set([
        ...uyB1AccountsForRun(),
        ...(customTipo === 'b1' && customUY ? [customUY.cuenta] : []),
      ])];
      const R1_UY = [...new Set([
        ...uyR1AccountsForRun(),
        ...(customTipo === 'r1' && customUY ? [customUY.cuenta] : []),
      ])];

      runAbortController?.abort();
      runAbortController = new AbortController();
      const signal = runAbortController.signal;

      console.log('[run UY] fetching — periodos:', periodos.length, 'banks:', banks);
      const [b1, r1] = await Promise.all([
        fetchData('b1', B1_UY, periodos, banks, signal),
        fetchData('r1', R1_UY, periodos, banks, signal),
      ]);
      if (signal.aborted) {
        setRunLoadingBar(false);
        return;
      }

      const firstBank = ST.selectedOrder[0] || banks[0];
      const b1First = b1.filter(r => r.ins_cod === firstBank);
      const r1First = r1.filter(r => r.ins_cod === firstBank);
      const customKpi = computeCustomKpiSnapshot(b1, r1, [], firstBank, lastP);

      const totalAssets  = uySum(b1First, UY_KPI.activos, lastP);
      const colocaciones = uySum(b1First, UY_KPI.colocaciones, lastP);
      const depositos    = uySum(b1First, UY_KPI.captaciones, lastP);
      const patrimonio   = uySum(b1First, UY_KPI.patrimonio, lastP);
      const pasivos      = uySum(b1First, UY_KPI.pasivos, lastP);
      const utilidad     = uySum(r1First, UY_KPI.utilidad, lastP);

      ST._kpiRaw = {
        totalAssets,
        colocaciones,
        depositos,
        depVista: uySum(b1First, UY_KPI.depVista, lastP),
        depPlazo: null,
        bonos: null,
        patrimonio,
        utilidad,
        mora90: null,
        customKpi,
        pasivos,
        ingresoNeto: null,
        totalIng: null,
        lastP,
        perdCred: null,
        impuesto: null,
        resOp: null,
        totalGas: null,
        resOpA: null,
        ingComis: null,
        ingresoReaj: null,
        resFin: null,
      };
      refreshKPIs();

      ST._series = {
        periodos,
        b1s: (c) => uySeries(b1.filter(r => r.ins_cod === (ST.selectedOrder[0] || banks[0])), c, periodos),
        r1s: (c) => uySeries(r1.filter(r => r.ins_cod === (ST.selectedOrder[0] || banks[0])), c, periodos),
        c1s: () => periodos.map(() => 0),
        b1,
        r1,
        c1: [],
      };
      showResChart(ST._lastResChart || 'patrimonio');

      ST._b1 = b1;
      ST._c1 = null;
      ST._lastP = lastP;
      ST._resTableData = null;

      showBalTab(ST._lastBalTab || 'assets');
      renderResTable(null);

      const hi = document.getElementById('headerInfo');
      if (hi) hi.textContent = rangeLabel;

      document.getElementById('dashContent').style.display = 'flex';
      setRunLoadingBar(false);
      setStatus('ok', `Uruguay BCU/SSF · ${periodos.length} periods · ${ST.selected.size} bank(s)`);
      return;
    }

    if (datasetIsoCountry() === 'PE') {
      const customPE = resolveCustomKpiForRun();
      const customTipo = customPE ? getTipo(customPE.cuenta) : null;
      const B1_PE = [...new Set([
        ...peB1AccountsForRun(),
        ...(customTipo === 'b1' && customPE ? [customPE.cuenta] : []),
      ])];
      const R1_PE = [...new Set([
        ...peR1AccountsForRun(),
        ...(customTipo === 'r1' && customPE ? [customPE.cuenta] : []),
      ])];

      runAbortController?.abort();
      runAbortController = new AbortController();
      const signal = runAbortController.signal;

      console.log('[run PE] fetching — periodos:', periodos.length, 'banks:', banks);
      const [b1, r1] = await Promise.all([
        fetchData('b1', B1_PE, periodos, banks, signal),
        fetchData('r1', R1_PE, periodos, banks, signal),
      ]);
      if (signal.aborted) {
        setRunLoadingBar(false);
        return;
      }

      const firstBank = ST.selectedOrder[0] || banks[0];
      const b1First = b1.filter(r => r.ins_cod === firstBank);
      const r1First = r1.filter(r => r.ins_cod === firstBank);
      const customKpi = computeCustomKpiSnapshot(b1, r1, [], firstBank, lastP);

      const totalAssets  = peSum(b1First, PE_KPI.activos, lastP);
      const colocaciones = peSum(b1First, PE_KPI.colocaciones, lastP);
      const depositos    = peSum(b1First, PE_KPI.captaciones, lastP);
      const patrimonio   = peSum(b1First, PE_KPI.patrimonio, lastP);
      const pasivos      = peSum(b1First, PE_KPI.pasivos, lastP);
      const utilidad     = peSum(r1First, PE_KPI.utilidad, lastP);

      ST._kpiRaw = {
        totalAssets,
        colocaciones,
        depositos,
        depVista: peSum(b1First, PE_KPI.depVista, lastP),
        depPlazo: peSum(b1First, PE_KPI.depPlazo, lastP),
        bonos: null,
        patrimonio,
        utilidad,
        mora90: null,
        customKpi,
        pasivos,
        ingresoNeto: null,
        totalIng: null,
        lastP,
        perdCred: null,
        impuesto: null,
        resOp: null,
        totalGas: null,
        resOpA: null,
        ingComis: null,
        ingresoReaj: null,
        resFin: null,
      };
      refreshKPIs();

      ST._series = {
        periodos,
        b1s: (c) => peSeries(b1.filter(r => r.ins_cod === (ST.selectedOrder[0] || banks[0])), c, periodos),
        r1s: (c) => peSeries(r1.filter(r => r.ins_cod === (ST.selectedOrder[0] || banks[0])), c, periodos),
        c1s: () => periodos.map(() => 0),
        b1,
        r1,
        c1: [],
      };
      showResChart(ST._lastResChart || 'patrimonio');

      ST._b1 = b1;
      ST._c1 = null;
      ST._lastP = lastP;
      ST._resTableData = null;

      showBalTab(ST._lastBalTab || 'assets');
      renderResTable(null);

      const hi = document.getElementById('headerInfo');
      if (hi) hi.textContent = rangeLabel;

      document.getElementById('dashContent').style.display = 'flex';
      setRunLoadingBar(false);
      setStatus('ok', `Perú SBS B-2201 · ${periodos.length} periods · ${ST.selected.size} bank(s)`);
      return;
    }

    if (datasetIsoCountry() === 'US') {
      const customUS = resolveCustomKpiForRun();
      const customTipo = customUS ? getTipo(customUS.cuenta) : null;
      const B1_US = [...new Set([
        ...usB1AccountsForRun(),
        ...(customTipo === 'b1' && customUS ? [customUS.cuenta] : []),
      ])];
      const R1_US = [...new Set([
        ...usR1AccountsForRun(),
        ...(customTipo === 'r1' && customUS ? [customUS.cuenta] : []),
      ])];

      runAbortController?.abort();
      runAbortController = new AbortController();
      const signal = runAbortController.signal;

      console.log('[run US] fetching — periodos:', periodos.length, 'banks:', banks);
      const [b1, r1] = await Promise.all([
        fetchData('b1', B1_US, periodos, banks, signal),
        fetchData('r1', R1_US, periodos, banks, signal),
      ]);
      if (signal.aborted) {
        setRunLoadingBar(false);
        return;
      }

      const firstBank = ST.selectedOrder[0] || banks[0];
      const b1First = b1.filter(r => r.ins_cod === firstBank);
      const r1First = r1.filter(r => r.ins_cod === firstBank);
      const customKpi = computeCustomKpiSnapshot(b1, r1, [], firstBank, lastP);

      const totalAssets  = usSum(b1First, US_KPI.activos, lastP);
      const colocaciones = usSum(b1First, US_KPI.colocaciones, lastP);
      const depositos    = usSum(b1First, US_KPI.captaciones, lastP);
      const patrimonio   = usSum(b1First, US_KPI.patrimonio, lastP);
      const pasivos      = usSum(b1First, US_KPI.pasivos, lastP);
      const utilidad     = usSum(r1First, US_KPI.utilidad, lastP);

      ST._kpiRaw = {
        totalAssets, colocaciones, depositos,
        depVista: depositos, depPlazo: null, bonos: null,
        patrimonio, utilidad, mora90: null, customKpi, pasivos,
        ingresoNeto: null, totalIng: null, lastP,
        perdCred: null, impuesto: null, resOp: null, totalGas: null,
        resOpA: null, ingComis: null, ingresoReaj: null, resFin: null,
      };
      refreshKPIs();

      ST._series = {
        periodos,
        b1s: (c) => usSeries(b1.filter(r => r.ins_cod === (ST.selectedOrder[0] || banks[0])), c, periodos),
        r1s: (c) => usSeries(r1.filter(r => r.ins_cod === (ST.selectedOrder[0] || banks[0])), c, periodos),
        c1s: () => periodos.map(() => 0),
        b1, r1, c1: [],
      };
      showResChart(ST._lastResChart || 'patrimonio');

      ST._b1 = b1;
      ST._c1 = null;
      ST._lastP = lastP;
      ST._resTableData = null;
      showBalTab(ST._lastBalTab || 'assets');
      renderResTable(null);

      const hi = document.getElementById('headerInfo');
      if (hi) hi.textContent = rangeLabel;
      document.getElementById('dashContent').style.display = 'flex';
      setRunLoadingBar(false);
      setStatus('ok', `US FDIC top-300 · ${periodos.length} quarters · ${ST.selected.size} bank(s)`);
      return;
    }

    if (datasetIsoCountry() === 'AR' || datasetIsoCountry() === 'MX' || datasetIsoCountry() === 'PA') {
      const isoAM = datasetIsoCountry();
      const KPI = isoAM === 'AR' ? AR_KPI : isoAM === 'MX' ? MX_KPI : PA_KPI;
      const b1Acc = isoAM === 'AR' ? arB1AccountsForRun() : isoAM === 'MX' ? mxB1AccountsForRun() : paB1AccountsForRun();
      const r1Acc = isoAM === 'AR' ? arR1AccountsForRun() : isoAM === 'MX' ? mxR1AccountsForRun() : paR1AccountsForRun();
      const sumFn = isoAM === 'AR' ? arSum : isoAM === 'MX' ? mxSum : paSum;
      const seriesFn = isoAM === 'AR' ? arSeries : isoAM === 'MX' ? mxSeries : paSeries;

      const customAM = resolveCustomKpiForRun();
      const customTipo = customAM ? getTipo(customAM.cuenta) : null;
      const B1_AM = [...new Set([
        ...b1Acc,
        ...(customTipo === 'b1' && customAM ? [customAM.cuenta] : []),
      ])];
      const R1_AM = [...new Set([
        ...r1Acc,
        ...(customTipo === 'r1' && customAM ? [customAM.cuenta] : []),
      ])];

      runAbortController?.abort();
      runAbortController = new AbortController();
      const signal = runAbortController.signal;

      const [b1, r1] = await Promise.all([
        fetchData('b1', B1_AM, periodos, banks, signal),
        fetchData('r1', R1_AM, periodos, banks, signal),
      ]);
      if (signal.aborted) {
        setRunLoadingBar(false);
        return;
      }

      const firstBank = ST.selectedOrder[0] || banks[0];
      const b1First = b1.filter(r => r.ins_cod === firstBank);
      const r1First = r1.filter(r => r.ins_cod === firstBank);
      const customKpi = computeCustomKpiSnapshot(b1, r1, [], firstBank, lastP);

      const totalAssets  = sumFn(b1First, KPI.activos, lastP);
      const colocaciones = sumFn(b1First, KPI.colocaciones, lastP);
      const depositos    = sumFn(b1First, KPI.captaciones, lastP);
      const patrimonio   = sumFn(b1First, KPI.patrimonio, lastP);
      const pasivos      = sumFn(b1First, KPI.pasivos, lastP);
      const utilidad     = sumFn(r1First, KPI.utilidad, lastP);

      ST._kpiRaw = {
        totalAssets, colocaciones, depositos,
        depVista: depositos, depPlazo: null, bonos: null,
        patrimonio, utilidad, mora90: null, customKpi, pasivos,
        ingresoNeto: null, totalIng: null, lastP,
        perdCred: null, impuesto: null, resOp: null, totalGas: null,
        resOpA: null, ingComis: null, ingresoReaj: null, resFin: null,
      };
      refreshKPIs();

      ST._series = {
        periodos,
        b1s: (c) => seriesFn(b1.filter(r => r.ins_cod === (ST.selectedOrder[0] || banks[0])), c, periodos),
        r1s: (c) => seriesFn(r1.filter(r => r.ins_cod === (ST.selectedOrder[0] || banks[0])), c, periodos),
        c1s: () => periodos.map(() => 0),
        b1, r1, c1: [],
      };
      showResChart(ST._lastResChart || 'patrimonio');

      ST._b1 = b1;
      ST._c1 = null;
      ST._lastP = lastP;
      ST._resTableData = null;
      showBalTab(ST._lastBalTab || 'assets');
      renderResTable(null);

      const hi = document.getElementById('headerInfo');
      if (hi) hi.textContent = rangeLabel;
      document.getElementById('dashContent').style.display = 'flex';
      setRunLoadingBar(false);
      setStatus('ok', isoAM === 'AR'
        ? `Argentina BCRA · ${periodos.length} periods · ${ST.selected.size} bank(s)`
        : isoAM === 'PA'
          ? `Panamá SBP · ${periodos.length} periods · ${ST.selected.size} bank(s)`
          : `México CNBV · ${periodos.length} periods · ${ST.selected.size} bank(s)`);
      return;
    }

    const customCL = resolveCustomKpiForRun();
    const ct = customCL ? getTipo(customCL.cuenta) : null;
    const B1_CUENTAS_LIST = [
      '100000000','105000000','107000000','110000000','120000000','130000000',
      '140000000','144000000','145000000','146000000','148000000','149000000',
      '150000000','160000000','170000000','175000000','185000000','190000000','195000000',
      '200000000','207000000','210000000','230000000','240000000','241000000','242000000',
      '243000000','244000000','245000000','246000000','250000000','255000000','260000000',
      '270000000','285000000','290000000','300000000','310000000','311000000','312000000',
      '320000000','330000000','340000000','350000000','380000000','390000000','500000000','505000000','510000000',
    ];
    const R1_CUENTAS_LIST = [
      '520000000','525000000','530000000','540000000','550000000',
      '560000000','570000000','580000000','590000000','462000000','464000000',
      '466000000','468000000','469000000','470000000','480000000',
    ];
    const C1_CUENTAS_LIST = [
      '851000000','852000000','853000000','854000000','855000000',
      '857000000','857100000','857200000','857300000','857400000',
      '813000000','814000000',
    ];
    const B1_CUENTAS = [...new Set([...B1_CUENTAS_LIST, ...(ct === 'b1' && customCL ? [customCL.cuenta] : [])])];
    const R1_CUENTAS = [...new Set([...R1_CUENTAS_LIST, ...(ct === 'r1' && customCL ? [customCL.cuenta] : [])])];
    const C1_CUENTAS = [...new Set([...C1_CUENTAS_LIST, ...(ct === 'c1' && customCL ? [customCL.cuenta] : [])])];

    console.log('[run] fetching data — periodos:', periodos.length, 'banks:', banks);
    runAbortController?.abort();
    runAbortController = new AbortController();
    const signal = runAbortController.signal;

    const [b1, r1, c1] = await Promise.all([
      fetchData('b1', B1_CUENTAS, periodos, banks, signal),
      fetchData('r1', R1_CUENTAS, periodos, banks, signal),
      fetchData('c1', C1_CUENTAS, periodos, banks, signal),
    ]);
    if (signal.aborted) {
      setRunLoadingBar(false);
      return;
    }
    console.log('[run] data received — b1:', b1.length, 'r1:', r1.length, 'c1:', c1.length);

    const firstBank = ST.selectedOrder[0] || banks[0];
    const b1v = c => sumRows(b1.filter(r => r.ins_cod === firstBank), c, lastP);
    const r1v = c => sumRows(r1.filter(r => r.ins_cod === firstBank), c, lastP);
    const c1v = c => sumRows(c1.filter(r => r.ins_cod === firstBank), c, lastP);
    const b1s = c => getSeriesForCuenta(b1, c, periodos);
    const r1s = c => getSeriesForCuenta(r1, c, periodos);
    const c1s = c => getSeriesForCuenta(c1, c, periodos);

    const totalAssets  = b1v('100000000');
    const colocaciones = b1v('500000000');
    const depVista     = b1v('241000000');
    const depPlazo     = b1v('242000000');
    const depositos    = depVista + depPlazo;
    const bonos        = b1v('245000000');
    const patrimonio   = b1v('300000000');
    const utilidad     = r1v('590000000');
    const mora90       = c1v('857000000');

    const ingresoNeto  = r1v('520000000');
    const ingresoReaj  = r1v('525000000');
    const ingComis     = r1v('530000000');
    const resFin       = r1v('540000000');
    const totalIng     = r1v('550000000');
    const totalGas     = r1v('560000000');
    const resOpA       = r1v('570000000');
    const perdCred     = r1v('470000000');
    const resOp        = r1v('580000000');
    const impuesto     = r1v('480000000');

    const customKpi = computeCustomKpiSnapshot(b1, r1, c1, firstBank, lastP);

    ST._kpiRaw = {
      totalAssets, colocaciones, depositos, depVista, depPlazo, bonos,
      patrimonio, utilidad, mora90,
      customKpi,
      pasivos: b1v('200000000'), ingresoNeto, totalIng, lastP,
      perdCred, impuesto, resOp, totalGas, resOpA, ingComis, ingresoReaj, resFin,
    };
    refreshKPIs();

    ST._series = { periodos, b1s, r1s, c1s, b1, r1, c1 };
    showResChart(ST._lastResChart || 'patrimonio');

    ST._b1    = b1;
    ST._lastP = lastP;
    showBalTab(ST._lastBalTab || 'assets');

    const resData = { ingresoNeto, ingresoReaj, ingComis, resFin, totalIng,
      gastosP: r1v('462000000'), gastosA: r1v('464000000'),
      totalGas, resOpA, perdCred, resOp, impuesto, utilidad };
    ST._resTableData = resData;
    renderResTable(resData);

    const carNorm  = c1v('854000000') + c1v('851000000');
    const carSub   = c1v('852000000');
    const carInc   = c1v('853000000') + c1v('855000000');
    const castigos = c1v('813000000');
    const recup    = c1v('814000000');

    document.getElementById('kpiCalidad').innerHTML = `
      <div class="kpi green"><div class="kpi-label">Cartera Normal</div><div class="kpi-val">$${fmtB(carNorm)}B</div><div class="kpi-sub">${fmtP(carNorm, carNorm + carSub + carInc)}</div></div>
      <div class="kpi yellow"><div class="kpi-label">Cartera Subestándar</div><div class="kpi-val">$${fmtB(carSub)}B</div><div class="kpi-sub">${fmtP(carSub, carNorm + carSub + carInc)}</div></div>
      <div class="kpi red"><div class="kpi-label">Cartera Incumplimiento</div><div class="kpi-val">$${fmtB(carInc)}B</div><div class="kpi-sub">${fmtP(carInc, carNorm + carSub + carInc)}</div></div>
      <div class="kpi blue"><div class="kpi-label">NPL +90 / total loans</div><div class="kpi-val">${colocaciones ? fmtChartPct(nplPctFromRaw(mora90, colocaciones), false) : '—'}</div><div class="kpi-sub">CMF NPL ${fmtKPI(mora90)} · loans ${fmtKPI(colocaciones)}</div></div>
    `;
    renderCalidad({ carNorm, carSub, carInc, mora90, colocaciones, castigos, recup });

    const loanTs  = b1s('500000000');
    const moraTs  = c1s('857000000');
    const moraPct = periodos.map((_, i) => nplPctFromRaw(moraTs[i], loanTs[i]));
    drawLineChart('chartMora', periodos, [{ label: 'NPL +90 / loans', data: moraPct, color: 'var(--red)' }], { valueScale: 'percent' });

    renderComparativo(b1, r1, c1, lastP);

    document.getElementById('dashContent').style.display = 'flex';
    setRunLoadingBar(false);
    setStatus('ok', `${periodos.length} periods${isTrimestral ? ' (quarterly)' : ''} · ${ST.selected.size} bank(s) · ${periodLabel(todosLosPeriodos[0])} → ${periodLabel(lastP)}`);

    const hi = document.getElementById('headerInfo');
    if (hi) hi.textContent = rangeLabel;

  } catch (e) {
    if (e?.name === 'AbortError') {
      setRunLoadingBar(false);
      return;
    }
    setRunLoadingBar(false);
    setStatus('error', 'Error al consultar datos');
    showErr('Error al cargar datos: ' + e.message + ' — Abre la consola del navegador (F12) para más detalles.');
    console.error('[run] Error:', e.name, e.message, e);
    document.getElementById('dashContent').style.display = 'flex';
  }
}

// Key Data tile order in #kpiResumen (refreshKPIs HTML)
// Key Data: 4 tiles en orden Equity, Total Assets, Net Income, Annual ROE.
// Los demás tipos de gráfico (loans, deposits, NPL, custom, etc.) siguen
// disponibles en la barra de botones del gráfico; simplemente no resaltan tile.
const KPI_RESUMEN_IDX = {
  patrimonio: 0, activos: 1, utilidad: 2, roe_hist: 3, coloc: 4, loans_equity: 5, roe: 6, customkpi: 7,
};

const KPI_RESUMEN_IDX_BR = {
  patrimonio: 0, activos: 1, utilidad: 2, roe_hist: 3, coloc: 4, loans_equity: 5, roe: 6, customkpi: 7,
};

function syncKpiResumenActive(tipo) {
  const idxMap = datasetIsoCountry() === 'BR' ? KPI_RESUMEN_IDX_BR : KPI_RESUMEN_IDX;
  const idx = idxMap[tipo];
  document.querySelectorAll('#kpiResumen .kpi-btn').forEach((el, i) => {
    el.classList.toggle('kpi-active', idx !== undefined && i === idx);
  });
}

// Cambia el modo de Net Income (Brasil): 'ytd' | 'quarter' y redibuja.
export function setNiMode(mode) {
  ST._niMode = mode === 'period' ? 'period' : 'ytd';
  injectNiPills();
  showResChart('utilidad');
}

// Herramienta Δ%: activa/desactiva la comparación entre 2 puntos del gráfico.
export function toggleDeltaMode() {
  ST._deltaMode = !ST._deltaMode;
  ST._deltaSel = [];
  const btn = document.getElementById('btnDelta');
  if (btn) {
    btn.style.background = ST._deltaMode ? 'var(--accent)' : 'var(--btg)';   // azul BTG; más claro al activar
    btn.style.color = '#fff';
    btn.style.borderColor = ST._deltaMode ? 'var(--accent)' : 'var(--btg)';
    btn.classList.toggle('attn', !ST._deltaMode);   // el pulso invita a activarla; se apaga al usarse
  }
  showResChart(ST._lastResChart || 'patrimonio');
}

// ---- Resumen chart ----
export function showResChart(tipo) {
  abortROEFetch();
  // Brasil (Resumo) no tiene dato confiable para estos cortes: caer a Equity.
  if (datasetIsoCountry() === 'BR' && ['dep_vista', 'dep_plazo', 'bonos', 'mora'].includes(tipo)) {
    tipo = 'patrimonio';
  }
  // Uruguay: sin NPL / bonos / plazo desglosado; dep_vista = depósitos totales.
  if (datasetIsoCountry() === 'UY' && ['dep_plazo', 'bonos', 'mora'].includes(tipo)) {
    tipo = 'patrimonio';
  }
  // Perú: hay vista/plazo; sin bonos/NPL mapeados.
  if (datasetIsoCountry() === 'PE' && ['bonos', 'mora'].includes(tipo)) {
    tipo = 'patrimonio';
  }
  // US FDIC top-N: depósitos totales; sin plazo/bonos/NPL.
  if (datasetIsoCountry() === 'US' && ['dep_plazo', 'bonos', 'mora'].includes(tipo)) {
    tipo = 'patrimonio';
  }
  // AR BCRA / MX CNBV / PA SBP: depósitos totales; sin plazo/bonos/NPL.
  if ((datasetIsoCountry() === 'AR' || datasetIsoCountry() === 'MX' || datasetIsoCountry() === 'PA')
      && ['dep_plazo', 'bonos', 'mora'].includes(tipo)) {
    tipo = 'patrimonio';
  }
  if (tipo === 'customkpi' && !resolveCustomKpiForRun()) {
    showResChart('patrimonio');
    return;
  }
  if (ST._lastResChart !== tipo) ST._deltaSel = [];   // nueva métrica → limpia selección Δ
  ST._lastResChart = tipo;
  if (tipo === 'roe') {
    showROEChart();
    return;
  }

  const chartWrap = document.getElementById('chartResumenWrap');
  const roeWrap   = document.getElementById('roeSystemWrap');
  if (chartWrap) chartWrap.style.display = 'block';
  if (roeWrap)   roeWrap.style.display   = 'none';
  const dataTable = document.getElementById('resChartTablePanel');
  if (dataTable && ST._lastResChart) dataTable.style.display = 'block';
  const titleEl = document.getElementById('chartSectionTitle');
  const subEl   = document.getElementById('chartSectionSub');
  if (titleEl) titleEl.textContent = 'Historical evolution';
  if (subEl)   subEl.textContent   = 'Key indicators for selected period range';

  // (El sub-selector YTD/Period se muestra en el cuadrito de Net Income, no aquí.)

  const map = {
    activos:'📊 Assets', coloc:'💳 Loans', dep_vista:'👁 Demand Dep.', dep_plazo:'⏱ Time Dep.', bonos:'📄 Bonds',
    captacoes:'🏦 Funding', tvm:'📄 Securities',
    pasivos:'📉 Liabilities', patrimonio:'🏛 Equity', utilidad:'💰 Net Income', mora:'⚠️ NPL %', customkpi:'📌 Custom account',
    roe_hist:'📈 Annual ROE', loans_equity:'⚖️ Loans/Equity',
  };
  document.querySelectorAll('.rcbtn').forEach(b => {
    b.classList.toggle('active', b.textContent.trim() === (map[tipo] || ''));
  });

  syncKpiResumenActive(tipo);

  if (!ST._series) return;
  const { periodos, b1, r1, c1 } = ST._series;
  const banks = [...ST.selected];

  const cuentaMap = datasetIsoCountry() === 'BR'
    ? {
      activos:    { rows: b1, cuentas: BR_KPI.activos },
      coloc:      { rows: b1, cuentas: BR_KPI.colocaciones },
      captacoes:  { rows: b1, cuentas: BR_KPI.captacoes },
      tvm:        { rows: b1, cuentas: BR_KPI.tvm },
      pasivos:    { rows: b1, cuentas: BR_KPI.pasivos },
      patrimonio: { rows: b1, cuentas: BR_KPI.patrimonio },
      utilidad:   { rows: r1, cuentas: BR_KPI.utilidad },
    }
    : datasetIsoCountry() === 'CO'
    ? {
      activos:    { rows: b1, cuenta: CO_CUIF.activos },
      coloc:      { rows: b1, cuenta: CO_CUIF.colocaciones },
      pasivos:    { rows: b1, cuenta: CO_CUIF.pasivos },
      patrimonio: { rows: b1, cuenta: CO_CUIF.patrimonio },
      utilidad:   { rows: r1, cuenta: CO_CUIF.utilidadNet },
      dep_vista:  { rows: b1, cuenta: CO_CUIF.depVista },
      dep_plazo:  { rows: b1, cuenta: CO_CUIF.depPlazo },
      bonos:      { rows: b1, cuenta: CO_CUIF.bonos },
    }
    : datasetIsoCountry() === 'UY'
    ? {
      activos:    { rows: b1, cuenta: UY_KPI.activos },
      coloc:      { rows: b1, cuentas: UY_KPI.colocaciones },
      pasivos:    { rows: b1, cuenta: UY_KPI.pasivos },
      patrimonio: { rows: b1, cuenta: UY_KPI.patrimonio },
      utilidad:   { rows: r1, cuenta: UY_KPI.utilidad },
      dep_vista:  { rows: b1, cuentas: UY_KPI.captaciones },
      dep_plazo:  { rows: b1, cuenta: UY_KPI.depVista },
    }
    : datasetIsoCountry() === 'PE'
    ? {
      activos:    { rows: b1, cuenta: PE_KPI.activos },
      coloc:      { rows: b1, cuenta: PE_KPI.colocaciones },
      pasivos:    { rows: b1, cuenta: PE_KPI.pasivos },
      patrimonio: { rows: b1, cuenta: PE_KPI.patrimonio },
      utilidad:   { rows: r1, cuenta: PE_KPI.utilidad },
      dep_vista:  { rows: b1, cuenta: PE_KPI.depVista },
      dep_plazo:  { rows: b1, cuenta: PE_KPI.depPlazo },
    }
    : datasetIsoCountry() === 'US'
    ? {
      activos:    { rows: b1, cuenta: US_KPI.activos },
      coloc:      { rows: b1, cuenta: US_KPI.colocaciones },
      pasivos:    { rows: b1, cuenta: US_KPI.pasivos },
      patrimonio: { rows: b1, cuenta: US_KPI.patrimonio },
      utilidad:   { rows: r1, cuenta: US_KPI.utilidad },
      dep_vista:  { rows: b1, cuenta: US_KPI.depVista },
      tvm:        { rows: b1, cuenta: US_KPI.securities },
    }
    : datasetIsoCountry() === 'AR'
    ? {
      activos:    { rows: b1, cuenta: AR_KPI.activos },
      coloc:      { rows: b1, cuenta: AR_KPI.colocaciones },
      pasivos:    { rows: b1, cuenta: AR_KPI.pasivos },
      patrimonio: { rows: b1, cuenta: AR_KPI.patrimonio },
      utilidad:   { rows: r1, cuenta: AR_KPI.utilidad },
      dep_vista:  { rows: b1, cuenta: AR_KPI.depVista },
      tvm:        { rows: b1, cuenta: AR_KPI.securities },
    }
    : datasetIsoCountry() === 'MX'
    ? {
      activos:    { rows: b1, cuenta: MX_KPI.activos },
      coloc:      { rows: b1, cuenta: MX_KPI.colocaciones },
      pasivos:    { rows: b1, cuenta: MX_KPI.pasivos },
      patrimonio: { rows: b1, cuenta: MX_KPI.patrimonio },
      utilidad:   { rows: r1, cuenta: MX_KPI.utilidad },
      dep_vista:  { rows: b1, cuenta: MX_KPI.depVista },
    }
    : datasetIsoCountry() === 'PA'
    ? {
      activos:    { rows: b1, cuenta: PA_KPI.activos },
      coloc:      { rows: b1, cuenta: PA_KPI.colocaciones },
      pasivos:    { rows: b1, cuenta: PA_KPI.pasivos },
      patrimonio: { rows: b1, cuenta: PA_KPI.patrimonio },
      utilidad:   { rows: r1, cuenta: PA_KPI.utilidad },
      dep_vista:  { rows: b1, cuenta: PA_KPI.depVista },
    }
    : {
      activos:    { rows: b1, cuenta: '100000000' },
      coloc:      { rows: b1, cuenta: '500000000' },
      pasivos:    { rows: b1, cuenta: '200000000' },
      patrimonio: { rows: b1, cuenta: '300000000' },
      utilidad:   { rows: r1, cuenta: '590000000' },
      dep_vista:  { rows: b1, cuenta: '241000000' },
      dep_plazo:  { rows: b1, cuenta: '242000000' },
      bonos:      { rows: b1, cuenta: '245000000' },
    };

  let series;
  let chartOpts;

  const sameIns = (row, code) => Number(row.ins_cod) === Number(code);

  if (tipo === 'mora') {
    chartOpts = { valueScale: 'percent' };
    if (datasetIsoCountry() === 'CO') {
      series = banks.map((code, i) => {
        const color = bankColor(code, i, bankName(code));
        const data = periodos.map(p => {
          const rowsB = b1.filter(r => sameIns(r, code));
          const moraAbs = coMoraNumerator(rowsB, p);
          const loanAbs = sumRows(rowsB, CO_CUIF.colocaciones, p);
          return nplPctFromRaw(moraAbs, loanAbs);
        });
        return { label: bankName(code), data, color };
      });
    } else {
      series = banks.map((code, i) => {
        const color = bankColor(code, i, bankName(code));
        const data = periodos.map(p => {
          const moraAbs = c1.filter(r => sameIns(r, code) && r.cuenta === '857000000' && r.periodo === p)
            .reduce((s, r) => s + (r.monto_total || 0), 0);
          const loanAbs = b1.filter(r => sameIns(r, code) && r.cuenta === '500000000' && r.periodo === p)
            .reduce((s, r) => s + (r.monto_total || 0), 0);
          return nplPctFromRaw(moraAbs, loanAbs);
        });
        return { label: bankName(code), data, color };
      });
    }
  } else if (tipo === 'customkpi') {
    const saved = resolveCustomKpiForRun();
    const t = getTipo(saved.cuenta);
    const rows = t === 'b1' ? b1 : t === 'r1' ? r1 : c1;
    const cuenta = saved.cuenta;
    const usdFactor = (ST.currency === 'USD' && ST.usdRate) ? (1 / ST.usdRate) : 1;
    series = banks.map((code, i) => {
      const color = bankColor(code, i, bankName(code));
      const data = sparseData(periodos.map(p =>
        rows.filter(r => sameIns(r, code) && r.cuenta === cuenta && r.periodo === p)
          .reduce((s, r) => s + (r.monto_total || 0), 0) / 1e9 * usdFactor
      ));
      return { label: bankName(code), data, color };
    });
    chartOpts = undefined;
  } else if (tipo === 'loans_equity' || tipo === 'roe_hist') {
    const isBRc = datasetIsoCountry() === 'BR';
    const sumSet = (rows, set, code, p) =>
      rows.filter(r => sameIns(r, code) && set.has(r.cuenta) && r.periodo === p)
          .reduce((s, r) => s + (r.monto_total || 0), 0);
    const eqE   = cuentaMap.patrimonio;
    const eqSet = new Set(eqE.cuentas || [eqE.cuenta]);
    if (tipo === 'loans_equity') {
      chartOpts = { valueScale: 'ratio' };
      const loanE = cuentaMap.coloc;
      const loanSet = new Set(loanE.cuentas || [loanE.cuenta]);
      series = banks.map((code, i) => ({
        label: bankName(code), color: bankColor(code, i, bankName(code)),
        data: periodos.map(p => {
          const eq = sumSet(eqE.rows, eqSet, code, p);
          return eq ? sumSet(loanE.rows, loanSet, code, p) / eq : null;
        }),
      }));
    } else {
      chartOpts = { valueScale: 'percent' };
      const utE = cuentaMap.utilidad;
      const utSet = new Set(utE.cuentas || [utE.cuenta]);
      series = banks.map((code, i) => {
        const byP = {};
        if (isBRc) periodos.forEach(p => { byP[p] = sumSet(utE.rows, utSet, code, p); });
        return {
          label: bankName(code), color: bankColor(code, i, bankName(code)),
          data: periodos.map(p => {
            const eq = sumSet(eqE.rows, eqSet, code, p);
            const month = parseInt(String(p).slice(4, 6), 10);
            const util = isBRc ? brResultReset(byP, p, 'ytd') : sumSet(utE.rows, utSet, code, p);
            return eq && month ? (util / eq) * (12 / month) * 100 : null;
          }),
        };
      });
    }
  } else if (tipo === 'utilidad') {
    // Net Income con modo YTD (acumulado del año) o Period (resultado del período).
    //  · Brasil: el resultado se acumula por SEMESTRE → brResultReset lo corrige.
    //  · Chile/Colombia: mensual acumulado YTD → Period = desacumular vs el período
    //    anterior del MISMO año.
    chartOpts = undefined;
    const niMode = ST._niMode || 'period';
    const isBRni = datasetIsoCountry() === 'BR';
    const utE = cuentaMap.utilidad;
    const utSet = new Set(utE.cuentas || [utE.cuenta]);
    const usdFactor = (ST.currency === 'USD' && ST.usdRate) ? (1 / ST.usdRate) : 1;
    series = banks.map((code, i) => {
      const byP = {};
      periodos.forEach(p => {
        byP[p] = utE.rows.filter(r => sameIns(r, code) && utSet.has(r.cuenta) && r.periodo === p)
                         .reduce((s, r) => s + (r.monto_total || 0), 0);
      });
      const data = periodos.map((p, idx) => {
        let v;
        if (niMode === 'ytd') {
          v = isBRni ? brResultReset(byP, p, 'ytd') : byP[p];
        } else if (isBRni) {
          v = brResultReset(byP, p, 'quarter');
        } else {
          const prevP = idx > 0 ? periodos[idx - 1] : null;
          const mo = parseInt(String(p).slice(4, 6), 10);
          if (prevP && prevP.slice(0, 4) === p.slice(0, 4)) v = byP[p] - byP[prevP];   // mismo año: delta
          else if (prevP) v = byP[p];   // cruce de año: el YTD reinició en enero → el crudo YA es el resultado del período
          else v = mo <= 3 ? byP[p] : null;   // primer período sin referencia: solo válido si es inicio de año
        }
        return (v === null || v === undefined) ? null : v / 1e9 * usdFactor;
      });
      return { label: bankName(code), color: bankColor(code, i, bankName(code)), data: sparseData(data) };
    });
  } else {
    const entry = cuentaMap[tipo] || cuentaMap.activos;
    const rows = entry.rows;
    const codeSet = new Set(entry.cuentas || [entry.cuenta]);
    const usdFactor = (ST.currency === 'USD' && ST.usdRate) ? (1 / ST.usdRate) : 1;
    series = banks.map((code, i) => {
      const color = bankColor(code, i, bankName(code));
      const data  = sparseData(periodos.map(p =>
        rows.filter(r => sameIns(r, code) && codeSet.has(r.cuenta) && r.periodo === p)
            .reduce((s, r) => s + (r.monto_total || 0), 0) / 1e9 * usdFactor
      ));
      return { label: bankName(code), data, color };
    });
    chartOpts = undefined;
  }

  // Recorta columnas iniciales totalmente vacías (ej. el 1er período no
  // desacumulable en modo Period) para no dejar espacio en blanco.
  let periodosDraw = periodos, seriesDraw = series;
  {
    let f = 0;
    while (f < periodos.length && seriesDraw.every(s => {
      const v = s.data[f]; return v === null || v === undefined || !Number.isFinite(v);
    })) f++;
    if (f > 0 && f < periodos.length) {
      periodosDraw = periodos.slice(f);
      seriesDraw   = series.map(s => ({ ...s, data: s.data.slice(f) }));
    }
  }

  drawLineChart('chartResumen', periodosDraw, seriesDraw, chartOpts);
  setupChartTooltip('chartResumen', 'chartTooltip');

  document.getElementById('resumenLegend').innerHTML = seriesDraw.map(s =>
    `<div class="leg-item"><div class="leg-dot" style="background:${s.color}"></div>${s.label}</div>`
  ).join('');

  const panel      = document.getElementById('resChartTablePanel');
  const tableEl    = document.getElementById('resChartTable');
  const tableTitleEl = document.getElementById('resChartTableTitle');
  if (panel && tableEl) {
    const metricLabels = {
      activos:'Assets', coloc:'Loans', pasivos:'Liabilities', patrimonio:'Equity', utilidad:'Net Income',
      captacoes:'Funding (Captações)', tvm:'Securities (TVM)',
      loans_equity:'Loans / Equity (x)', roe_hist:'Annual ROE (%)',
      mora:'NPL / total loans (%)', dep_vista:'Demand Deposits', dep_plazo:'Time Deposits', bonos:'Bonds', customkpi:'Custom account',
    };
    if (tableTitleEl) {
      if (tipo === 'customkpi') {
        const saved = resolveCustomKpiForRun();
        const tt = getTipo(saved.cuenta);
        const short = (saved.descripcion || '').trim();
        tableTitleEl.textContent = short ? `${short} · ${saved.cuenta} (${tt})` : `Account ${saved.cuenta} (${tt})`;
      } else {
        tableTitleEl.textContent = metricLabels[tipo] || tipo;
      }
    }
    panel.style.display = 'block';

    let html = `<table class="tbl" style="white-space:nowrap;font-size:12px;"><thead><tr>
      <th style="white-space:nowrap;min-width:120px;" data-export="Bank">Bank</th>
      ${periodosDraw.map(p => {
        const mm   = p.slice(4, 6);
        const yyyy = p.slice(0, 4);
        return `<th class="r" style="white-space:nowrap;min-width:80px;font-size:10px;" data-export="01/${mm}/${yyyy}">${periodLabel(p)}</th>`;
      }).join('')}
    </tr></thead><tbody>`;

    seriesDraw.forEach(s => {
      html += `<tr>
        <td style="font-weight:600;color:${s.color};white-space:nowrap;">${s.label}</td>
        ${s.data.map(v => {
          if (v === null || v === undefined || !Number.isFinite(v)) return `<td class="r" style="color:var(--text3)">—</td>`;
          if (tipo === 'mora' || tipo === 'roe_hist') return `<td class="r ${v < 0 ? 'neg' : ''}" style="white-space:nowrap;" data-export="${v}">${fmtChartPct(v, false)}</td>`;
          if (tipo === 'loans_equity') return `<td class="r ${v < 0 ? 'neg' : ''}" style="white-space:nowrap;" data-export="${v}">${Number(v).toFixed(1)}x</td>`;
          return `<td class="r ${v < 0 ? 'neg' : ''}" style="white-space:nowrap;" data-export="${Math.round(v * 1e9)}">${fmtAxis(v)}</td>`;
        }).join('')}
      </tr>`;
    });
    html += '</tbody></table>';
    tableEl.innerHTML = html;
  }
}

// ---- ROE ranking chart ----
export async function showROEChart() {
  const chartWrap = document.getElementById('chartResumenWrap');
  const roeWrap   = document.getElementById('roeSystemWrap');
  if (!chartWrap || !roeWrap) return;

  ST._lastResChart = 'roe';

  chartWrap.style.display = 'none';
  roeWrap.style.display   = 'block';
  roeWrap.innerHTML = '<div style="padding:20px;color:var(--text2);">Loading ROE data...</div>';
  const dataTable = document.getElementById('resChartTablePanel');
  if (dataTable) dataTable.style.display = 'none';

  document.querySelectorAll('.rcbtn').forEach(b => b.classList.remove('active'));
  syncKpiResumenActive('roe');
  const titleEl = document.getElementById('chartSectionTitle');
  const subEl   = document.getElementById('chartSectionSub');
  if (titleEl) titleEl.textContent = 'Annual ROE — All Banks';
  if (subEl)   subEl.textContent   = 'Annualized return on equity · all active banks';

  abortROEFetch();
  roeAbortController = new AbortController();
  const signal = roeAbortController.signal;

  if (!ST.periodos?.length) {
    roeWrap.innerHTML = `<div class="empty"><p>No period data loaded. Reload the dashboard or adjust the date range.</p></div>`;
    return;
  }
  const lastPPre = ST.periodos[ST.periodos.length - 1];
  if (!lastPPre || String(lastPPre).length < 6) {
    roeWrap.innerHTML = `<div class="empty"><p>No period data loaded. Reload the dashboard or adjust the date range.</p></div>`;
    return;
  }

  try {
    const lastP     = lastPPre;
    const lastMonth = parseInt(lastP.slice(4, 6), 10);
    if (!(lastMonth >= 1 && lastMonth <= 12)) {
      roeWrap.innerHTML = `<div class="empty"><p>Invalid period for ROE. Try reloading.</p></div>`;
      return;
    }
    const allBanks  = Object.keys(ST.bancos).map(Number).filter(c => c !== 999);

    const isoROE = datasetIsoCountry();
    const eqCuentas = isoROE === 'BR' ? BR_KPI.patrimonio
                    : isoROE === 'CO' ? [CO_CUIF.patrimonio]
                    : isoROE === 'UY' ? [UY_KPI.patrimonio]
                    : isoROE === 'PE' ? [PE_KPI.patrimonio]
                    : isoROE === 'AR' ? [AR_KPI.patrimonio]
                    : isoROE === 'MX' ? [MX_KPI.patrimonio]
                    : isoROE === 'PA' ? [PA_KPI.patrimonio]
                    : isoROE === 'US' ? [US_KPI.patrimonio]
                    : ['300000000'];
    const utCuentas = isoROE === 'BR' ? BR_KPI.utilidad
                    : isoROE === 'CO' ? [CO_CUIF.utilidadNet]
                    : isoROE === 'UY' ? [UY_KPI.utilidad]
                    : isoROE === 'PE' ? [PE_KPI.utilidad]
                    : isoROE === 'AR' ? [AR_KPI.utilidad]
                    : isoROE === 'MX' ? [MX_KPI.utilidad]
                    : isoROE === 'PA' ? [PA_KPI.utilidad]
                    : isoROE === 'US' ? [US_KPI.utilidad]
                    : ['590000000'];

    const [rows, equityRows] = await Promise.all([
      apiDatos({ tipo: 'r1', cuentas: utCuentas, periodos: [lastP], bancos: allBanks, select: 'ins_cod,monto_total' }, signal),
      apiDatos({ tipo: 'b1', cuentas: eqCuentas, periodos: [lastP], bancos: allBanks, select: 'ins_cod,monto_total' }, signal),
    ]);
    if (signal.aborted) return;

    const getUtil = c => rows.filter(r => r.ins_cod === c).reduce((s, r) => s + (r.monto_total || 0), 0);
    const getEq   = c => equityRows.filter(r => r.ins_cod === c).reduce((s, r) => s + (r.monto_total || 0), 0);

    const bankROEs = allBanks.map(c => {
      const util = getUtil(c), eq = getEq(c);
      return { code: c, name: bankName(c), roe: eq ? (util / eq) * (12 / lastMonth) * 100 : null };
    }).filter(b => b.roe !== null && Math.abs(b.roe) > 0.01)
      .sort((a, b) => b.roe - a.roe);

    if (!bankROEs.length) {
      roeWrap.innerHTML = `<div class="empty"><p>No comparable ROE data for banks in this period.</p></div>`;
      return;
    }

    const maxAbs = Math.max(...bankROEs.map(b => Math.abs(b.roe)));
    let html = `<div style="font-size:11px;color:var(--text3);margin-bottom:10px;font-family:var(--mono);">
      Annualized (Month ${lastMonth} × ${Math.round(12 / lastMonth)}) · ${periodLabel(lastP)}</div>`;
    html += '<div style="display:flex;flex-direction:column;gap:5px;">';
    bankROEs.forEach(b => {
      const isBTG  = b.code === (isoROE === 'CO' ? 66 : isoROE === 'BR' ? 1000080336 : 59);
      const pct    = Math.abs(b.roe) / maxAbs * 100;
      const color  = b.roe >= 0 ? (isBTG ? btgBlue() : 'var(--accent)') : 'var(--red)';
      html += `<div style="display:flex;align-items:center;gap:10px;cursor:pointer;"
        onclick="loadBankFromTable(${b.code})" title="Load ${b.name}">
        <div style="width:150px;font-size:12px;font-weight:${isBTG ? '700' : '400'};
          color:${isBTG ? btgBlue() : 'var(--text)'};text-align:right;flex-shrink:0;
          white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${b.name}</div>
        <div style="flex:1;background:var(--bg3);border-radius:3px;height:18px;">
          <div style="width:${pct}%;height:100%;background:${color};border-radius:3px;opacity:0.85;"></div>
        </div>
        <div style="width:55px;font-family:var(--mono);font-size:12px;font-weight:600;
          color:${b.roe >= 0 ? 'var(--green)' : 'var(--red)'};text-align:right;flex-shrink:0;">
          ${b.roe.toFixed(1)}%</div>
      </div>`;
    });
    html += '</div>';
    if (signal.aborted) return;
    roeWrap.innerHTML = html;
  } catch (e) {
    if (e?.name === 'AbortError') return;
    roeWrap.innerHTML = `<div style="color:var(--red);">Error: ${e.message}</div>`;
  }
}
