// ============================================================
// BALANCE, RESULTADOS, CALIDAD, COMPARATIVO
// ============================================================
import { ST, datasetIsoCountry, reportingLocalCurrencyISO } from '../state.js?v=bmon14';
import { bankColor } from '../config.js?v=bmon14';
import { bankName, fmtKPI, fmtKPIDecimal, fmtM, fmtP, fmtB, fmtChartPct, nplPctFromRaw } from '../format.js?v=bmon14';
import { sumRows } from '../api.js?v=bmon14';
import { BAL_CO_SECTIONS, R1_CO_ROWS } from '../coCuentas.js?v=bmon14';

// ---- Balance section definitions ----
export const BAL_SECTIONS = {
  activos: [
    {c:'100000000',l:'TOTAL ASSETS',cls:'hl'},
    {c:'105000000',l:'Efectivo y Depósitos en Bancos',cls:'i1'},
    {c:'107000000',l:'Operaciones en Liquidación',cls:'i1'},
    {c:'110000000',l:'Activos Financieros para Negociar (VR)',cls:'i1'},
    {c:'120000000',l:'Activos Financieros a VR con cambios en ORI',cls:'i1'},
    {c:'130000000',l:'Derivados de Cobertura Contable',cls:'i1'},
    {c:'140000000',l:'Activos Financieros a Costo Amortizado',cls:'i1'},
    {c:'144000000',l:'Créditos y Cuentas por Cobrar a Clientes',cls:'i2'},
    {c:'145000000',l:'Colocaciones Comerciales',cls:'i3'},
    {c:'146000000',l:'Colocaciones para Vivienda',cls:'i3'},
    {c:'148000000',l:'Colocaciones de Consumo',cls:'i3'},
    {c:'149000000',l:'Provisiones por Riesgo de Crédito',cls:'i3'},
    {c:'500000000',l:'TOTAL LOANS',cls:'hl'},
    {c:'150000000',l:'Inversiones en Sociedades',cls:'i1'},
    {c:'160000000',l:'Activos Intangibles',cls:'i1'},
    {c:'170000000',l:'Activos Fijos',cls:'i1'},
    {c:'185000000',l:'Impuestos Diferidos',cls:'i1'},
    {c:'190000000',l:'Otros Activos',cls:'i1'},
  ],
  pasivos: [
    {c:'200000000',l:'TOTAL LIABILITIES',cls:'hl'},
    {c:'207000000',l:'Operaciones en Liquidación',cls:'i1'},
    {c:'210000000',l:'Pasivos Financieros para Negociar (VR)',cls:'i1'},
    {c:'230000000',l:'Derivados de Cobertura Contable',cls:'i1'},
    {c:'240000000',l:'Pasivos Financieros a Costo Amortizado',cls:'i1'},
    {c:'241000000',l:'Depósitos a la Vista',cls:'i2'},
    {c:'242000000',l:'Depósitos y Captaciones a Plazo',cls:'i2'},
    {c:'243000000',l:'Obligaciones por Retrocompra',cls:'i2'},
    {c:'244000000',l:'Obligaciones con Bancos',cls:'i2'},
    {c:'245000000',l:'Instrumentos de Deuda Emitidos',cls:'i2'},
    {c:'250000000',l:'Obligaciones por Arrendamiento',cls:'i1'},
    {c:'255000000',l:'Capital Regulatorio Emitido',cls:'i1'},
    {c:'260000000',l:'Provisiones por Contingencias',cls:'i1'},
    {c:'270000000',l:'Provisiones Especiales Riesgo de Crédito',cls:'i1'},
    {c:'290000000',l:'Otros Pasivos',cls:'i1'},
  ],
  patrimonio: [
    {c:'300000000',l:'TOTAL EQUITY',cls:'hl'},
    {c:'310000000',l:'Capital',cls:'i1'},
    {c:'311000000',l:'Capital Pagado',cls:'i2'},
    {c:'320000000',l:'Reservas',cls:'i1'},
    {c:'330000000',l:'Otro Resultado Integral Acumulado',cls:'i1'},
    {c:'340000000',l:'Utilidades Acumuladas de Períodos Anteriores',cls:'i1'},
    {c:'350000000',l:'Utilidad (Pérdida) del Ejercicio',cls:'i1'},
    {c:'380000000',l:'Patrimonio de los Propietarios',cls:'hl'},
  ],
};
BAL_SECTIONS.assets      = BAL_SECTIONS.activos;
BAL_SECTIONS.liabilities = BAL_SECTIONS.pasivos;
BAL_SECTIONS.equity      = BAL_SECTIONS.patrimonio;

export function renderBankTabs(containerId, activeCode, onSelect) {
  const banks     = [...ST.selected];
  const container = document.getElementById(containerId);
  if (!container) return;
  if (banks.length <= 1) { container.innerHTML = ''; return; }
  container.innerHTML = banks.map((code, i) => {
    const color  = bankColor(code, i);
    const active = code === activeCode;
    return `<button onclick="${onSelect}(${code})" style="
      padding:3px 10px;border-radius:3px;font-size:11px;cursor:pointer;
      font-family:var(--mono);border:1px solid ${color};
      background:${active ? color : 'transparent'};
      color:${active ? '#000' : color};transition:all 0.15s;">
      ${bankName(code)}
    </button>`;
  }).join('');
}

export function showBalTab(sec, bankCode) {
  ST._lastBalTab = sec;
  const banks = [...ST.selected];

  document.querySelectorAll('#tab-balance .itab').forEach(b =>
    b.classList.toggle('active', b.textContent.trim().toLowerCase() === sec));
  if (!ST._b1) return;

  const rows = datasetIsoCountry() === 'CO' ? BAL_CO_SECTIONS[sec] : BAL_SECTIONS[sec];
  if (!rows) return;

  const isCO = datasetIsoCountry() === 'CO';

  const b1Map = new Map();
  ST._b1.forEach(r => {
    if (r.periodo !== ST._lastP) return;
    const key = `${r.cuenta}|${r.ins_cod}`;
    if (!b1Map.has(key)) b1Map.set(key, []);
    b1Map.get(key).push(r);
  });
  const getRows = (cuenta, code) => b1Map.get(`${cuenta}|${code}`) || [];

  if (banks.length === 1) {
    const code = banks[0];
    const loc = reportingLocalCurrencyISO();
    if (isCO) {
      let html = `<div style="overflow-x:auto"><table class="tbl"><thead><tr>
        <th class="cod">Account</th><th>Description</th>
        <th class="r">MM$ ${loc}</th>
      </tr></thead><tbody>`;
      rows.forEach(row => {
        const bankRows = getRows(row.c, code);
        const tot = bankRows.reduce((s, r) => s + (r.monto_total || 0), 0);
        const neg = tot < 0 ? 'neg' : '';
        html += `<tr>
        <td class="cod">${row.c}</td>
        <td class="${row.cls}">${row.l}</td>
        <td class="r ${row.cls === 'hl' ? 'hl' : ''} ${neg}">${fmtKPI(tot)}</td>
      </tr>`;
      });
      html += `</tbody></table></div>`;
      document.getElementById('balBankTabs').innerHTML = '';
      document.getElementById('balTable').innerHTML = html;
      return;
    }
    let html = `<div style="overflow-x:auto"><table class="tbl"><thead><tr>
      <th class="cod">Cuenta</th><th>Descripción</th>
      <th class="r">CLP Non-adj.</th><th class="r">Adj. UF/IVP</th>
      <th class="r">Adj. FX Rate</th><th class="r">Foreign Curr.</th>
      <th class="r">TOTAL</th>
    </tr></thead><tbody>`;
    rows.forEach(row => {
      const bankRows = getRows(row.c, code);
      const cols = [
        bankRows.reduce((s, r) => s + (r.monto_clp || 0), 0),
        bankRows.reduce((s, r) => s + (r.monto_uf  || 0), 0),
        bankRows.reduce((s, r) => s + (r.monto_tc  || 0), 0),
        bankRows.reduce((s, r) => s + (r.monto_ext || 0), 0),
      ];
      const tot = cols.reduce((a, b) => a + b, 0);
      const neg = tot < 0 ? 'neg' : '';
      html += `<tr>
        <td class="cod">${row.c}</td>
        <td class="${row.cls}">${row.l}</td>
        <td class="r ${neg}">${fmtKPI(cols[0])}</td>
        <td class="r ${neg}">${fmtKPI(cols[1])}</td>
        <td class="r ${neg}">${fmtKPI(cols[2])}</td>
        <td class="r ${neg}">${fmtKPI(cols[3])}</td>
        <td class="r ${row.cls === 'hl' ? 'hl' : ''} ${neg}">${fmtKPI(tot)}</td>
      </tr>`;
    });
    html += `</tbody></table></div>`;
    document.getElementById('balBankTabs').innerHTML = '';
    document.getElementById('balTable').innerHTML = html;
  } else {
    document.getElementById('balBankTabs').innerHTML = '';
    let html = `<div style="overflow-x:auto"><table class="tbl"><thead><tr><th>Descripción</th>`;
    banks.forEach((code, i) => {
      html += `<th class="r" style="color:${bankColor(code, i)}">${bankName(code)}</th>`;
    });
    html += `</tr></thead><tbody>`;
    rows.forEach(row => {
      html += `<tr><td class="${row.cls}">${row.l}</td>`;
      banks.forEach(code => {
        const tot = getRows(row.c, code).reduce((s, r) => s + (r.monto_total || 0), 0);
        const neg = tot < 0 ? 'neg' : '';
        html += `<td class="r ${row.cls === 'hl' ? 'hl' : ''} ${neg}">${fmtKPI(tot)}</td>`;
      });
      html += `</tr>`;
    });
    html += `</tbody></table></div>`;
    document.getElementById('balTable').innerHTML = html;
  }
}

export function selectBalBank(code) {
  ST._activeBalBank = code;
  showBalTab(ST._lastBalTab || 'assets', code);
}

// ---- Income Statement ----
export function selectResBank(code) {
  ST._activeResBank = code;
  renderResTable(ST._resTableData);
}

export function renderResTable(m) {
  const banks = [...ST.selected];
  const R1_ROWS = [
    {l:'Net Interest Income',              c:'520000000', cls:''},
    {l:'Net UF/IVP Adjustment Income',     c:'525000000', cls:''},
    {l:'Net Fee Income',                   c:'530000000', cls:''},
    {l:'Net Financial Result',             c:'540000000', cls:''},
    {l:'TOTAL OPERATING INCOME',           c:'550000000', cls:'hl'},
    {l:'Personnel Expenses',               c:'462000000', cls:'i1'},
    {l:'Administrative Expenses',          c:'464000000', cls:'i1'},
    {l:'TOTAL OPERATING EXPENSES',         c:'560000000', cls:'hl'},
    {l:'Op. Result before Credit Losses',  c:'570000000', cls:''},
    {l:'Credit Loss Expense',              c:'470000000', cls:'i1'},
    {l:'OPERATING RESULT',                 c:'580000000', cls:'hl'},
    {l:'Income Tax',                       c:'480000000', cls:'i1'},
    {l:'NET INCOME (LOSS)',                c:'590000000', cls:'hl'},
  ];
  const r1Rows = datasetIsoCountry() === 'CO' ? R1_CO_ROWS : R1_ROWS;

  if (ST._series && ST._series.r1 && ST._lastP) {
    const r1    = ST._series.r1;
    const lastP = ST._lastP;
    const getVal = (cuenta, code) =>
      r1.filter(r => r.cuenta === cuenta && r.ins_cod === code && r.periodo === lastP)
        .reduce((s, r) => s + (r.monto_total || 0), 0);

    let html = `<div style="overflow-x:auto"><table class="tbl"><thead><tr><th>Concepto</th>`;
    banks.forEach((code, i) => {
      html += `<th class="r" style="color:${bankColor(code, i)}">${bankName(code)}</th>`;
    });
    html += `</tr></thead><tbody>`;
    r1Rows.forEach(row => {
      html += `<tr><td class="${row.cls}">${row.l}</td>`;
      banks.forEach(code => {
        const v = getVal(row.c, code);
        html += `<td class="r ${v < 0 ? 'neg' : ''} ${row.cls === 'hl' ? 'hl' : ''}">${fmtKPI(v)}</td>`;
      });
      html += `</tr>`;
    });
    html += `</tbody></table></div>`;
    document.getElementById('resBankTabs').innerHTML = '';
    document.getElementById('resTable').innerHTML = html;
  } else {
    const colLabel = ST.currency === 'USD' ? 'USD' : `MM$ ${reportingLocalCurrencyISO()}`;
    let html = `<table class="tbl"><thead><tr><th>Concepto</th><th class="r">${colLabel}</th></tr></thead><tbody>`;
    r1Rows.forEach(row => {
      const v = m[row.c] || 0;
      html += `<tr><td class="${row.cls}">${row.l}</td><td class="r ${v < 0 ? 'neg' : 'pos'} ${row.cls === 'hl' ? 'hl' : ''}">${fmtKPI(v)}</td></tr>`;
    });
    html += `</tbody></table>`;
    document.getElementById('resTable').innerHTML = html;
  }
}

// ---- Calidad de Cartera ----
export function renderCalidad({ carNorm, carSub, carInc, mora90, colocaciones, castigos, recup }) {
  const tot  = carNorm + carSub + carInc;
  const bars = [
    { l: 'Normal',         v: carNorm, color: '#34d399', pct: tot ? carNorm / tot : 0 },
    { l: 'Subestándar',    v: carSub,  color: '#fbbf24', pct: tot ? carSub  / tot : 0 },
    { l: 'Incumplimiento', v: carInc,  color: '#f87171', pct: tot ? carInc  / tot : 0 },
  ];
  let bHtml = '<div class="bars">';
  bars.forEach(b => {
    bHtml += `<div class="bar-row">
      <div class="bar-lbl">${b.l}</div>
      <div class="bar-track"><div class="bar-fill" style="width:${(b.pct * 100).toFixed(1)}%;background:${b.color}"></div></div>
      <div class="bar-val">${fmtKPI(b.v)}</div>
    </div>`;
  });
  bHtml += '</div>';
  document.getElementById('calBars').innerHTML = bHtml;

  const mRows = [
    { l: 'Adeudado Banks',  c: '857100000' },
    { l: 'Col. Comerciales', c: '857200000' },
    { l: 'Col. Vivienda',    c: '857300000' },
    { l: 'Col. Consumo',     c: '857400000' },
  ];
  const colLabel = ST.currency === 'USD' ? 'USD' : 'MM$ CLP';
  let mHtml = `<table class="tbl"><thead><tr><th>Cartera</th><th class="r">${colLabel}</th></tr></thead><tbody>`;
  mRows.forEach(r => {
    const v = sumRows(ST._c1 || [], r.c, ST._lastP);
    mHtml += `<tr><td class="i1">${r.l}</td><td class="r">${fmtKPI(v)}</td></tr>`;
  });
  mHtml += `<tr><td class="hl">TOTAL +90d (CMF)</td><td class="r hl">${fmtKPI(mora90)}</td></tr>`;
  mHtml += `<tr><td class="hl">NPL / colocaciones</td><td class="r hl">${colocaciones ? fmtChartPct(nplPctFromRaw(mora90, colocaciones), false) : '—'}</td></tr>`;
  mHtml += `<tr><td style="padding-top:8px;color:var(--text3)">Castigos</td><td class="r neg">${fmtKPI(castigos)}</td></tr>`;
  mHtml += `<tr><td>Recuperaciones</td><td class="r pos">${fmtKPI(recup)}</td></tr>`;
  mHtml += `<tr><td class="hl">Castigos Netos</td><td class="r hl neg">${fmtKPI(castigos - recup)}</td></tr>`;
  mHtml += '</tbody></table>';
  document.getElementById('calMora').innerHTML = mHtml;
}

// ---- Comparativo ----
export function renderComparativo(b1, r1, c1, lastP) {
  ST._c1 = c1;
  const codes = [...ST.selected].filter(c => c !== 999);
  if (codes.length < 2) {
    document.getElementById('compTable').innerHTML = '<div class="empty"><div class="empty-icon">📊</div><p>Selecciona 2 o más bancos individuales para comparar</p></div>';
    return;
  }

  const getB1V = (cuenta, bank) =>
    b1.filter(r => r.cuenta === cuenta && r.ins_cod === bank && r.periodo === lastP)
      .reduce((s, row) => s + (row.monto_total || 0), 0);

  const metrics = [
    { l: 'Total Assets',  fn: c => getB1V('100000000', c) },
    { l: 'Colocaciones',   fn: c => getB1V('500000000', c) },
    { l: 'Dep. Vista',     fn: c => getB1V('241000000', c) },
    { l: 'Dep. Plazo',     fn: c => getB1V('242000000', c) },
    { l: 'Equity',         fn: c => getB1V('300000000', c) },
    { l: 'Utilidad',       fn: c => r1.filter(r => r.cuenta === '590000000' && r.ins_cod === c && r.periodo === lastP).reduce((s, r) => s + (r.monto_total || 0), 0) },
    {
      l: 'NPL +90 / loans',
      fn: c => nplPctFromRaw(
        c1.filter(r => r.cuenta === '857000000' && r.ins_cod === c && r.periodo === lastP).reduce((s, r) => s + (r.monto_total || 0), 0),
        getB1V('500000000', c)
      ),
      fmtCell: v => (v == null || !Number.isFinite(v) ? '—' : fmtChartPct(v, false)),
    },
  ];

  let html = `<div style="overflow-x:auto"><table class="tbl"><thead><tr><th>Indicador</th>`;
  codes.forEach(c => { html += `<th class="r">${bankName(c)}</th>`; });
  html += '</tr></thead><tbody>';

  metrics.forEach(m => {
    const vals = codes.map(m.fn);
    const nums = vals.filter(v => typeof v === 'number' && Number.isFinite(v));
    const maxA = nums.length ? Math.max(...nums.map(Math.abs)) : 0;
    html += `<tr><td>${m.l}</td>`;
    vals.forEach(v => {
      const absOk = typeof v === 'number' && Number.isFinite(v);
      const isMax = absOk && Math.abs(v) === maxA && maxA > 0;
      const cell = m.fmtCell ? m.fmtCell(v) : fmtM(v);
      html += `<td class="r ${typeof v === 'number' && v < 0 ? 'neg' : ''} ${isMax ? 'hl' : ''}">${cell}</td>`;
    });
    html += '</tr>';
  });

  html += `<tr><td style="color:var(--text3);padding-top:10px;font-size:10px">Ratios</td>${codes.map(() => '<td></td>').join('')}</tr>`;
  html += `<tr><td class="i1">ROA</td>`;
  codes.forEach(c => {
    const act = getB1V('100000000', c);
    const ut  = r1.filter(r => r.cuenta === '590000000' && r.ins_cod === c && r.periodo === lastP).reduce((s, r) => s + (r.monto_total || 0), 0);
    html += `<td class="r">${act ? (ut / act * 100).toFixed(2) + '%' : '—'}</td>`;
  });
  html += '</tr>';
  html += `<tr><td class="i1">Apalancamiento</td>`;
  codes.forEach(c => {
    const act = getB1V('100000000', c);
    const pat = getB1V('300000000', c);
    html += `<td class="r">${pat ? (act / pat).toFixed(1) + 'x' : '—'}</td>`;
  });
  html += '</tr>';
  html += '</tbody></table></div>';
  document.getElementById('compTable').innerHTML = html;
}
