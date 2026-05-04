// ============================================================
// RESUMEN — main dashboard: run(), KPIs, chart, ROE
// ============================================================
import { ST, datasetIsoCountry } from '../state.js?v=bmon14';
import { CO_CUIF, CO_CUIF_NPL_PLUS90, coB1AccountsForRun, coR1AccountsForRun } from '../coCuentas.js?v=bmon14';
import { bankColor } from '../config.js?v=bmon14';
import { bankName, fmtKPI, fmtKPIDecimal, fmtAxis, fmtChartPct, fmtP, fmtB, periodLabel, nplPctFromRaw } from '../format.js?v=bmon14';
import { fetchData, apiDatos, sumRows, getSeriesForCuenta } from '../api.js?v=bmon14';
import { drawLineChart, setupChartTooltip, sparseData } from '../charts.js?v=bmon14';
import { showBalTab, renderResTable, renderCalidad, renderComparativo } from './balance.js?v=bmon14';
import { expSelect, abortExplorerFetch, getExpAccounts } from './explorer.js?v=bmon14';
import { setStatus, showErr } from '../utils.js?v=bmon14';

let runAbortController = null;
let roeAbortController = null;

function coMoraNumerator(rowsOneBankOneTipo, period) {
  return CO_CUIF_NPL_PLUS90.reduce(
    (s, cuenta) => s + Math.abs(sumRows(rowsOneBankOneTipo, cuenta, period)),
    0
  );
}

function abortROEFetch() {
  roeAbortController?.abort();
}

// ---- KPI refresh (called after run or currency toggle) ----
export function refreshKPIs() {
  if (!ST._kpiRaw?.lastP) return;
  const m          = ST._kpiRaw;
  const lastMonth  = parseInt(String(m.lastP).slice(4, 6), 10);

  if (datasetIsoCountry() === 'CO') {
    if (!(lastMonth >= 1 && lastMonth <= 12)) return;
    const utilAnualizada = m.utilidad ? m.utilidad * (12 / lastMonth) : 0;
    const roe        = m.patrimonio && m.utilidad ? (utilAnualizada / m.patrimonio * 100).toFixed(2) + '%' : '—';
    const roeSubLabel = `Month ${lastMonth} × ${Math.round(12 / lastMonth)}`;
    const firstBank  = ST.selectedOrder[0];
    const bankLabel  = firstBank ? `<span style="font-size:9px;color:var(--text3);font-family:var(--mono);margin-left:6px;">${bankName(firstBank)}</span>` : '';
    const moraLbl = m.colocaciones && Number.isFinite(m.mora90)
      ? fmtChartPct(nplPctFromRaw(m.mora90, m.colocaciones), false)
      : '—';
    const moraSub = !m.colocaciones
      ? '—'
      : `CUIF D+E +90d vs gross loans (${fmtKPI(m.mora90)} · ${fmtKPI(m.colocaciones)})`;
    const header     = document.getElementById('bankHeader');
    const headerName = document.getElementById('bankHeaderName');
    const headerSub  = document.getElementById('bankHeaderSub');
    if (header && firstBank) {
      const color = bankColor(firstBank, 0);
      header.style.display = 'block';
      header.style.borderLeftColor = color;
      headerName.textContent = bankName(firstBank);
      headerName.style.color = color;
      const others = ST.selectedOrder.slice(1).map(c => bankName(c));
      headerSub.textContent = others.length
        ? `Compared with: ${others.join(', ')} · ${periodLabel(m.lastP)}`
        : `Last period: ${periodLabel(m.lastP)}`;
    } else if (header) header.style.display = 'none';

    document.getElementById('kpiResumen').innerHTML = `
    <div class="kpi blue kpi-btn" onclick="showResChart('activos')"><div class="kpi-label">Total Assets ${bankLabel}</div><div class="kpi-val">${fmtKPI(m.totalAssets)}</div><div class="kpi-sub">${fmtP(m.colocaciones, m.totalAssets)} of loans</div></div>
    <div class="kpi green kpi-btn" onclick="showResChart('coloc')"><div class="kpi-label">Loans</div><div class="kpi-val">${fmtKPI(m.colocaciones)}</div><div class="kpi-sub">${fmtP(m.colocaciones, m.totalAssets)} of assets</div></div>
    <div class="kpi yellow kpi-btn" onclick="showResChart('dep_vista')"><div class="kpi-label">Demand Deposits</div><div class="kpi-val">${fmtKPI(m.depVista)}</div><div class="kpi-sub">${fmtP(m.depVista, m.depositos)} of deposits</div></div>
    <div class="kpi yellow kpi-btn" onclick="showResChart('dep_plazo')"><div class="kpi-label">Time Deposits</div><div class="kpi-val">${fmtKPI(m.depPlazo)}</div><div class="kpi-sub">${fmtP(m.depPlazo, m.depositos)} of deposits</div></div>
    <div class="kpi blue kpi-btn" onclick="showResChart('bonos')"><div class="kpi-label">Issued Bonds</div><div class="kpi-val">${fmtKPI(m.bonos)}</div><div class="kpi-sub">${fmtP(m.bonos, m.totalAssets)} of assets</div></div>
    <div class="kpi red kpi-btn" onclick="showResChart('pasivos')"><div class="kpi-label">Total Liabilities</div><div class="kpi-val">${fmtKPI(m.pasivos)}</div><div class="kpi-sub">${fmtP(m.pasivos, m.totalAssets)} of assets</div></div>
    <div class="kpi purple kpi-btn" onclick="showResChart('patrimonio')"><div class="kpi-label">Equity</div><div class="kpi-val">${fmtKPI(m.patrimonio)}</div><div class="kpi-sub">${fmtP(m.patrimonio, m.totalAssets)} of assets</div></div>
    <div class="kpi blue kpi-btn" onclick="showResChart('utilidad')"><div class="kpi-label">Net Income</div><div class="kpi-val ${m.utilidad < 0 ? 'neg' : ''}">${fmtKPI(m.utilidad)}</div><div class="kpi-sub">ROA ${fmtP(m.utilidad, m.totalAssets)}</div></div>
    <div class="kpi green kpi-btn" onclick="showROEChart()"><div class="kpi-label">Annual ROE</div><div class="kpi-val ${utilAnualizada < 0 ? 'neg' : ''}">${roe}</div><div class="kpi-sub">${roeSubLabel}</div></div>
    <div class="kpi red kpi-btn" onclick="showResChart('mora')"><div class="kpi-label">NPL +90d / Loans</div><div class="kpi-val">${moraLbl}</div><div class="kpi-sub">${moraSub}</div></div>`;

    document.getElementById('kpiBalance').innerHTML = `
    <div class="kpi blue"><div class="kpi-label">Total Assets</div><div class="kpi-val">${fmtKPI(m.totalAssets)}</div></div>
    <div class="kpi green"><div class="kpi-label">Gross Loans</div><div class="kpi-val">${fmtKPI(m.colocaciones)}</div></div>
    <div class="kpi yellow"><div class="kpi-label">Total Deposits</div><div class="kpi-val">${fmtKPI(m.depositos)}</div></div>
    <div class="kpi red"><div class="kpi-label">Equity</div><div class="kpi-val">${fmtKPI(m.patrimonio)}</div><div class="kpi-sub">Leverage ${m.patrimonio ? (m.totalAssets / m.patrimonio).toFixed(1) + 'x' : '—'}</div></div>`;

    document.getElementById('kpiResultados').innerHTML = `
    <div class="kpi blue"><div class="kpi-label">Net Income · 590000</div><div class="kpi-val ${m.utilidad < 0 ? 'neg' : ''}">${fmtKPI(m.utilidad)}</div><div class="kpi-sub">ROA ${fmtP(m.utilidad, m.totalAssets)}</div></div>
    <div class="kpi" style="grid-column:1/-1;"><div class="kpi-label">P&amp;L detail (CUIF r1)</div><div class="kpi-val">Income Statement tab</div><div class="kpi-sub">Main lines: interest, fees, operating income/expenses, credit losses, tax.</div></div>`;

    document.getElementById('kpiCalidad').innerHTML = `
    <div class="kpi" style="grid-column:1/-1;max-width:640px;"><div class="kpi-label">Credit quality · Colombia</div><div class="kpi-val">CUIF mora D+E</div><div class="kpi-sub">NPL en Resumen: suma 140435/440, 140820/825, 141020/025 y 141225 sobre colocación 140000 (análogo al +90d CMF Chile, distinta fuente).</div></div>
    <div class="kpi" style="grid-column:1/-1;max-width:720px;"><div class="kpi-label">Calificaciones (referencia)</div><div class="kpi-val">Davivienda, Scotiabank Colpatria y Banco Caja Social: AAA</div><div class="kpi-sub">Davivienda es AAA; Scotiabank Colpatria también es AAA; Banco Caja Social también lo es. Más bancos y perspectivas en la pestaña Banking System.</div></div>`;
    return;
  }

  if (!(lastMonth >= 1 && lastMonth <= 12)) return;
  const utilAnualizada = m.utilidad * (12 / lastMonth);
  const roe        = m.patrimonio ? (utilAnualizada / m.patrimonio * 100).toFixed(2) + '%' : '—';
  const roeSubLabel = `Month ${lastMonth} × ${Math.round(12 / lastMonth)}`;

  const firstBank  = ST.selectedOrder[0];
  const bankLabel  = firstBank ? `<span style="font-size:9px;color:var(--text3);font-family:var(--mono);margin-left:6px;">${bankName(firstBank)}</span>` : '';

  const header     = document.getElementById('bankHeader');
  const headerName = document.getElementById('bankHeaderName');
  const headerSub  = document.getElementById('bankHeaderSub');
  if (header && firstBank) {
    const color = bankColor(firstBank, 0);
    header.style.display = 'block';
    header.style.borderLeftColor = color;
    headerName.textContent = bankName(firstBank);
    headerName.style.color = color;
    const others = ST.selectedOrder.slice(1).map(c => bankName(c));
    headerSub.textContent = others.length
      ? `Compared with: ${others.join(', ')} · ${periodLabel(m.lastP)}`
      : `Last period: ${periodLabel(m.lastP)}`;
  } else if (header) {
    header.style.display = 'none';
  }

  document.getElementById('kpiResumen').innerHTML = `
    <div class="kpi blue kpi-btn" onclick="showResChart('activos')"><div class="kpi-label">Total Assets ${bankLabel}</div><div class="kpi-val">${fmtKPI(m.totalAssets)}</div><div class="kpi-sub">${fmtP(m.colocaciones, m.totalAssets)} of loans</div></div>
    <div class="kpi green kpi-btn" onclick="showResChart('coloc')"><div class="kpi-label">Loans</div><div class="kpi-val">${fmtKPI(m.colocaciones)}</div><div class="kpi-sub">${fmtP(m.colocaciones, m.totalAssets)} of assets</div></div>
    <div class="kpi yellow kpi-btn" onclick="showResChart('dep_vista')"><div class="kpi-label">Demand Deposits</div><div class="kpi-val">${fmtKPI(m.depVista)}</div><div class="kpi-sub">${fmtP(m.depVista, m.depositos)} of deposits</div></div>
    <div class="kpi yellow kpi-btn" onclick="showResChart('dep_plazo')"><div class="kpi-label">Time Deposits</div><div class="kpi-val">${fmtKPI(m.depPlazo)}</div><div class="kpi-sub">${fmtP(m.depPlazo, m.depositos)} of deposits</div></div>
    <div class="kpi blue kpi-btn" onclick="showResChart('bonos')"><div class="kpi-label">Issued Bonds</div><div class="kpi-val">${fmtKPI(m.bonos)}</div><div class="kpi-sub">${fmtP(m.bonos, m.totalAssets)} of assets</div></div>
    <div class="kpi red kpi-btn" onclick="showResChart('pasivos')"><div class="kpi-label">Total Liabilities</div><div class="kpi-val">${fmtKPI(m.pasivos)}</div><div class="kpi-sub">${fmtP(m.pasivos, m.totalAssets)} of assets</div></div>
    <div class="kpi purple kpi-btn" onclick="showResChart('patrimonio')"><div class="kpi-label">Equity</div><div class="kpi-val">${fmtKPI(m.patrimonio)}</div><div class="kpi-sub">${fmtP(m.patrimonio, m.totalAssets)} of assets</div></div>
    <div class="kpi blue kpi-btn" onclick="showResChart('utilidad')"><div class="kpi-label">Net Income</div><div class="kpi-val ${m.utilidad < 0 ? 'neg' : ''}">${fmtKPI(m.utilidad)}</div><div class="kpi-sub">ROA ${fmtP(m.utilidad, m.totalAssets)}</div></div>
    <div class="kpi green kpi-btn" onclick="showROEChart()"><div class="kpi-label">Annual ROE</div><div class="kpi-val ${utilAnualizada < 0 ? 'neg' : ''}">${roe}</div><div class="kpi-sub">${roeSubLabel}</div></div>
    <div class="kpi red kpi-btn" onclick="showResChart('mora')"><div class="kpi-label">NPL +90d / Loans</div><div class="kpi-val">${m.colocaciones ? fmtChartPct(nplPctFromRaw(m.mora90, m.colocaciones), false) : '—'}</div><div class="kpi-sub">CMF NPL vs total loans (${fmtKPI(m.mora90)} · loans ${fmtKPI(m.colocaciones)})</div></div>
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
}

// ---- Main data-fetch and render loop ----
export async function run() {
  if (!ST.selected.size) { showErr('Please select at least one bank'); return; }
  showErr('');
  setStatus('loading', 'Loading...');
  const _bar = document.getElementById('loadingBar');
  if (_bar) _bar.style.display = 'block';

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
    if (_bar) _bar.style.display = 'none';
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
  ST.exp.hierarchy = null;

  const rangeLabel = periodLabel(todosLosPeriodos[0]) + ' — ' + periodLabel(lastP);
  document.getElementById('rangePill').textContent = rangeLabel + (isTrimestral ? ' · trimestral' : '');

  const banks = [...ST.selected];

  try {
    if (datasetIsoCountry() === 'CO') {
      const B1_CO = coB1AccountsForRun();
      const R1_CO = coR1AccountsForRun();

      runAbortController?.abort();
      abortExplorerFetch();
      runAbortController = new AbortController();
      const signal = runAbortController.signal;

      console.log('[run CO] fetching — periodos:', periodos.length, 'banks:', banks);
      const [b1, r1] = await Promise.all([
        fetchData('b1', B1_CO, periodos, banks, signal),
        fetchData('r1', R1_CO, periodos, banks, signal),
      ]);
      const c1 = [];
      if (signal.aborted) return;

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
      ST._c1    = null;
      ST._lastP = lastP;
      ST._resTableData = null;

      showBalTab(ST._lastBalTab || 'assets');
      renderResTable(null);

      const hi = document.getElementById('headerInfo');
      if (hi) hi.textContent = rangeLabel;

      document.getElementById('dashContent').style.display = 'flex';
      if (_bar) _bar.style.display = 'none';
      setStatus('ok', `Colombia CUIF · ${periodos.length} periods${isTrimestral ? ' (quarterly)' : ''} · ${ST.selected.size} bank(s)`);
      const expPick = ST.exp.selected;
      if (expPick && getExpAccounts().includes(expPick)) await expSelect(expPick);
      return;
    }

    const B1_CUENTAS = ['100000000','105000000','107000000','110000000','120000000','130000000',
      '140000000','144000000','145000000','146000000','148000000','149000000',
      '150000000','160000000','170000000','175000000','185000000','190000000','195000000',
      '200000000','207000000','210000000','230000000','240000000','241000000','242000000',
      '243000000','244000000','245000000','246000000','250000000','255000000','260000000',
      '270000000','285000000','290000000','300000000','310000000','311000000','312000000',
      '320000000','330000000','340000000','350000000','380000000','390000000','500000000','505000000','510000000'];

    const R1_CUENTAS = ['520000000','525000000','530000000','540000000','550000000',
      '560000000','570000000','580000000','590000000','462000000','464000000',
      '466000000','468000000','469000000','470000000','480000000'];

    const C1_CUENTAS = ['851000000','852000000','853000000','854000000','855000000',
      '857000000','857100000','857200000','857300000','857400000',
      '813000000','814000000'];

    console.log('[run] fetching data — periodos:', periodos.length, 'banks:', banks);
    runAbortController?.abort();
    abortExplorerFetch();
    runAbortController = new AbortController();
    const signal = runAbortController.signal;

    const [b1, r1, c1] = await Promise.all([
      fetchData('b1', B1_CUENTAS, periodos, banks, signal),
      fetchData('r1', R1_CUENTAS, periodos, banks, signal),
      fetchData('c1', C1_CUENTAS, periodos, banks, signal),
    ]);
    if (signal.aborted) return;
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

    ST._kpiRaw = {
      totalAssets, colocaciones, depositos, depVista, depPlazo, bonos,
      patrimonio, utilidad, mora90,
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
    if (_bar) _bar.style.display = 'none';
    setStatus('ok', `${periodos.length} periods${isTrimestral ? ' (quarterly)' : ''} · ${ST.selected.size} bank(s) · ${periodLabel(todosLosPeriodos[0])} → ${periodLabel(lastP)}`);

    const expPick = ST.exp.selected;
    if (expPick && getExpAccounts().includes(expPick)) await expSelect(expPick);
    const hi = document.getElementById('headerInfo');
    if (hi) hi.textContent = rangeLabel;

  } catch (e) {
    if (e?.name === 'AbortError') {
      if (_bar) _bar.style.display = 'none';
      return;
    }
    if (_bar) _bar.style.display = 'none';
    setStatus('error', 'Error al consultar datos');
    showErr('Error al cargar datos: ' + e.message + ' — Abre la consola del navegador (F12) para más detalles.');
    console.error('[run] Error:', e.name, e.message, e);
    document.getElementById('dashContent').style.display = 'flex';
  }
}

// Key Data tile order in #kpiResumen (refreshKPIs HTML)
const KPI_RESUMEN_IDX = {
  activos: 0, coloc: 1, dep_vista: 2, dep_plazo: 3, bonos: 4,
  pasivos: 5, patrimonio: 6, utilidad: 7, roe: 8, mora: 9,
};

function syncKpiResumenActive(tipo) {
  const idx = KPI_RESUMEN_IDX[tipo];
  document.querySelectorAll('#kpiResumen .kpi-btn').forEach((el, i) => {
    el.classList.toggle('kpi-active', idx !== undefined && i === idx);
  });
}

// ---- Resumen chart ----
export function showResChart(tipo) {
  abortROEFetch();
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
  const titleEl = document.querySelector('#tab-resumen .panel-title');
  if (titleEl) titleEl.textContent = 'Banking System Evolution';

  const map = { activos:'📊 Assets', coloc:'💳 Loans', dep_vista:'👁 Demand Dep.', dep_plazo:'⏱ Time Dep.', bonos:'📄 Bonds', pasivos:'📉 Liabilities', patrimonio:'🏛 Equity', utilidad:'💰 Net Income', mora:'⚠️ NPL %' };
  document.querySelectorAll('.rcbtn').forEach(b => {
    b.classList.toggle('active', b.textContent.trim() === (map[tipo] || ''));
  });

  syncKpiResumenActive(tipo);

  if (!ST._series) return;
  const { periodos, b1, r1, c1 } = ST._series;
  const banks = [...ST.selected];

  const cuentaMap = datasetIsoCountry() === 'CO'
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
        const color = bankColor(code, i);
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
        const color = bankColor(code, i);
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
  } else {
    const { rows, cuenta } = cuentaMap[tipo] || cuentaMap.activos;
    const usdFactor = (ST.currency === 'USD' && ST.usdRate) ? (1 / ST.usdRate) : 1;
    series = banks.map((code, i) => {
      const color = bankColor(code, i);
      const data  = sparseData(periodos.map(p =>
        rows.filter(r => sameIns(r, code) && r.cuenta === cuenta && r.periodo === p)
            .reduce((s, r) => s + (r.monto_total || 0), 0) / 1e9 * usdFactor
      ));
      return { label: bankName(code), data, color };
    });
    chartOpts = undefined;
  }

  drawLineChart('chartResumen', periodos, series, chartOpts);
  setupChartTooltip('chartResumen', 'chartTooltip');

  document.getElementById('resumenLegend').innerHTML = series.map(s =>
    `<div class="leg-item"><div class="leg-dot" style="background:${s.color}"></div>${s.label}</div>`
  ).join('');

  const panel      = document.getElementById('resChartTablePanel');
  const tableEl    = document.getElementById('resChartTable');
  const tableTitleEl = document.getElementById('resChartTableTitle');
  if (panel && tableEl) {
    const metricLabels = { activos:'Assets', coloc:'Loans', pasivos:'Liabilities', patrimonio:'Equity', utilidad:'Net Income', mora:'NPL (% of total loans)', dep_vista:'Demand Deposits', dep_plazo:'Time Deposits', bonos:'Bonds' };
    if (tableTitleEl) tableTitleEl.textContent = metricLabels[tipo] || tipo;
    panel.style.display = 'block';

    let html = `<table class="tbl" style="white-space:nowrap;font-size:12px;"><thead><tr>
      <th style="white-space:nowrap;min-width:120px;" data-export="Bank">Bank</th>
      ${periodos.map(p => {
        const mm   = p.slice(4, 6);
        const yyyy = p.slice(0, 4);
        return `<th class="r" style="white-space:nowrap;min-width:80px;font-size:10px;" data-export="01/${mm}/${yyyy}">${periodLabel(p)}</th>`;
      }).join('')}
    </tr></thead><tbody>`;

    series.forEach(s => {
      html += `<tr>
        <td style="font-weight:600;color:${s.color};white-space:nowrap;">${s.label}</td>
        ${s.data.map(v => {
          if (v === null || v === undefined || !Number.isFinite(v)) return `<td class="r" style="color:var(--text3)">—</td>`;
          if (tipo === 'mora') return `<td class="r ${v < 0 ? 'neg' : ''}" style="white-space:nowrap;">${fmtChartPct(v, false)}</td>`;
          return `<td class="r ${v < 0 ? 'neg' : ''}" style="white-space:nowrap;">${fmtAxis(v)}</td>`;
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

  document.querySelectorAll('.rcbtn').forEach(b => {
    b.classList.toggle('active', b.textContent.trim() === '📈 Annual ROE');
  });
  syncKpiResumenActive('roe');
  const titleEl = document.querySelector('#tab-resumen .panel-title');
  if (titleEl) titleEl.textContent = 'Annual ROE — All Banks';

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

    const eqCuenta = datasetIsoCountry() === 'CO' ? CO_CUIF.patrimonio : '300000000';
    const utCuenta = datasetIsoCountry() === 'CO' ? CO_CUIF.utilidadNet : '590000000';

    const [rows, equityRows] = await Promise.all([
      apiDatos({ tipo: 'r1', cuentas: [utCuenta], periodos: [lastP], bancos: allBanks, select: 'ins_cod,monto_total' }, signal),
      apiDatos({ tipo: 'b1', cuentas: [eqCuenta], periodos: [lastP], bancos: allBanks, select: 'ins_cod,monto_total' }, signal),
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
      const isBTG  = b.code === (datasetIsoCountry() === 'CO' ? 66 : 59);
      const pct    = Math.abs(b.roe) / maxAbs * 100;
      const color  = b.roe >= 0 ? (isBTG ? '#2563eb' : 'var(--accent)') : 'var(--red)';
      html += `<div style="display:flex;align-items:center;gap:10px;cursor:pointer;"
        onclick="loadBankFromTable(${b.code})" title="Load ${b.name}">
        <div style="width:150px;font-size:12px;font-weight:${isBTG ? '700' : '400'};
          color:${isBTG ? '#2563eb' : 'var(--text)'};text-align:right;flex-shrink:0;
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
