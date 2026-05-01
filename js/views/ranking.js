// ============================================================
// RANKING — Chilean Banking System tab
// ============================================================
import { ST, datasetIsoCountry } from '../state.js?v=bmon11';
import { FELLER_RATINGS, RATING_COLORS } from '../config.js?v=bmon11';
import { CO_CUIF } from '../coCuentas.js?v=bmon11';
import { bankName, fmtKPIDecimal, periodLabel } from '../format.js?v=bmon11';
import { apiDatos } from '../api.js?v=bmon11';

export function getCBRatings() {
  try {
    const stored = JSON.parse(localStorage.getItem('cbRatings') || '{}');
    return { ...FELLER_RATINGS, ...stored };
  } catch { return { ...FELLER_RATINGS }; }
}

export function saveCBRating(code, val) {
  try {
    const stored = JSON.parse(localStorage.getItem('cbRatings') || '{}');
    if (val) stored[code] = val; else delete stored[code];
    localStorage.setItem('cbRatings', JSON.stringify(stored));
  } catch {}
}

export async function renderChileanBanks() {
  const el = document.getElementById('cbTable');
  if (!el) return;
  if (!ST.periodos.length) {
    el.innerHTML = '<div class="empty"><p>Load data first by clicking Analyze</p></div>';
    return;
  }

  el.innerHTML = `
    <div style="display:flex;flex-direction:column;align-items:center;justify-content:center;gap:24px;padding:60px 0;">
      <div class="ls-bars" style="height:40px;">
        ${Array.from({length:10},(_,i)=>`<div class="ls-bar" style="--i:${i}"></div>`).join('')}
      </div>
      <div class="ls-msg">Loading Banking System data...</div>
    </div>`;

  const lastP        = ST.periodos[ST.periodos.length - 1];
  document.getElementById('cbPeriodLabel').textContent  = `Ranked by equity — ${periodLabel(lastP)}`;
  document.getElementById('cbCurrencyLabel').textContent = ST.currency === 'USD' && ST.usdRate
    ? `1 USD = $${Math.round(ST.usdRate).toLocaleString('es-CL')}` : '';

  try {
    const allBanks   = Object.keys(ST.bancos).map(Number).filter(c => c !== 999);
    const isCO       = datasetIsoCountry() === 'CO';
    const cuentas   = isCO
      ? [CO_CUIF.activos, CO_CUIF.colocaciones, CO_CUIF.pasivos, CO_CUIF.patrimonio]
      : ['100000000','144000000','200000000','300000000'];
    const utilCuenta = isCO ? CO_CUIF.utilidadNet : '590000000';
    const loansKey   = isCO ? CO_CUIF.colocaciones : '144000000';
    const lastPYear   = parseInt(lastP.slice(0, 4));
    const lastPMonth  = lastP.slice(4, 6);
    const priorYearP    = `${lastPYear - 1}${lastPMonth}`;
    const priorYearDecP = `${lastPYear - 1}12`;
    const fetchSet    = new Set([lastP, priorYearP, priorYearDecP].filter(p => ST.periodos.includes(p)));
    const fetchPeriods = [...fetchSet];

    const [rows, incomeRows] = await Promise.all([
      apiDatos({ tipo: 'b1', cuentas, periodos: [lastP], bancos: allBanks, select: 'ins_cod,cuenta,monto_total' }),
      apiDatos({ tipo: 'r1', cuentas: [utilCuenta], periodos: fetchPeriods, bancos: allBanks, select: 'ins_cod,periodo,monto_total' }),
    ]);

    const actK = isCO ? CO_CUIF.activos : '100000000';
    const liaK = isCO ? CO_CUIF.pasivos : '200000000';
    const eqK  = isCO ? CO_CUIF.patrimonio : '300000000';
    const getVal       = (bank, cuenta) => rows.filter(r => r.ins_cod === bank && r.cuenta === cuenta).reduce((s, r) => s + (r.monto_total || 0), 0);
    const getIncomeVal = (bank, periodo) => incomeRows.filter(r => r.ins_cod === bank && r.periodo === periodo).reduce((s, r) => s + (r.monto_total || 0), 0);
    const getNetIncome12M = bank => {
      const ytdNow = getIncomeVal(bank, lastP);
      if (lastPMonth === '12') return ytdNow;
      return getIncomeVal(bank, priorYearDecP) + ytdNow - getIncomeVal(bank, priorYearP);
    };

    ST._cbData = allBanks.map(c => ({
      code: c, name: bankName(c),
      assets:      getVal(c, actK),
      loans:       getVal(c, loansKey),
      liabilities: getVal(c, liaK),
      equity:      getVal(c, eqK),
      netIncome12: getNetIncome12M(c),
    })).filter(b => b.assets > 0);

    if (!ST._cbSort) ST._cbSort = { col: 'equity', dir: -1 };
    renderCBTable();

  } catch (e) {
    el.innerHTML = `<div class="empty"><p>Error loading data: ${e.message}</p></div>`;
  }
}

export function sortCBBy(col) {
  if (!ST._cbSort) ST._cbSort = { col, dir: -1 };
  if (ST._cbSort.col === col) {
    ST._cbSort.dir *= -1;
  } else {
    ST._cbSort.col = col;
    ST._cbSort.dir = col === 'name' ? 1 : -1;
  }
  renderCBTable();
}

export function renderCBTable() {
  const el = document.getElementById('cbTable');
  if (!el || !ST._cbData) return;

  const ratings  = getCBRatings();
  const { col, dir } = ST._cbSort;
  const bankData = [...ST._cbData].sort((a, b) => {
    if (col === 'name') return dir * a.name.localeCompare(b.name);
    if (col === 'rating') {
      const order = ['AAA','AA+','AA','AA-','A+','A','A-','BBB+','BBB','—'];
      return dir * (order.indexOf(ratings[a.code] || '—') - order.indexOf(ratings[b.code] || '—'));
    }
    return dir * ((a[col] || 0) - (b[col] || 0));
  });

  const thStyle  = `padding:10px 14px;font-size:11px;font-weight:700;letter-spacing:0.5px;
    text-transform:uppercase;color:var(--white);border-bottom:2px solid var(--border2);
    cursor:pointer;user-select:none;white-space:nowrap;`;
  const thStyleL = thStyle + 'text-align:left;';
  const arrow    = c => col === c ? (dir === 1 ? ' ↑' : ' ↓') : ' ↕';

  let html = `<div style="overflow-x:auto"><table class="tbl" style="table-layout:fixed;width:100%;">
    <thead><tr style="background:var(--bg4);">
      <th style="${thStyle}width:4%;text-align:center;">#</th>
      <th style="${thStyleL}width:20%;" onclick="sortCBBy('name')">Bank${arrow('name')}</th>
      <th style="${thStyle}width:7%;text-align:center;" onclick="sortCBBy('rating')">Rating${arrow('rating')}</th>
      <th class="r" style="${thStyle}width:12%;" onclick="sortCBBy('assets')">Total Assets${arrow('assets')}</th>
      <th class="r" style="${thStyle}width:11%;" onclick="sortCBBy('loans')">Total Loans${arrow('loans')}</th>
      <th class="r" style="${thStyle}width:11%;" onclick="sortCBBy('liabilities')">Total Liab.${arrow('liabilities')}</th>
      <th class="r" style="${thStyle}width:11%;" onclick="sortCBBy('equity')">Equity${arrow('equity')}</th>
      <th class="r" style="${thStyle}width:12%;" onclick="sortCBBy('netIncome12')">Net Income 12M${arrow('netIncome12')}</th>
      <th class="r" style="${thStyle}width:12%;" onclick="sortCBBy('loansEq')">Loans / Equity${arrow('loansEq')}</th>
    </tr></thead>
    <tbody>`;

  bankData.forEach((b, rowIdx) => {
    const btgCode  = datasetIsoCountry() === 'CO' ? 66 : 59;
    const isBTG    = b.code === btgCode;
    const rating   = ratings[b.code] || '—';
    const rColor   = RATING_COLORS[rating] || 'var(--text3)';
    const loansEq  = b.equity ? (b.loans / b.equity).toFixed(1) + 'x' : '—';
    b.loansEq      = b.equity ? b.loans / b.equity : 0;
    const niColor  = b.netIncome12 >= 0 ? 'var(--green)' : 'var(--red)';
    const rowStyle = isBTG
      ? 'background:rgba(37,99,235,0.08);border-left:3px solid #2563eb;'
      : 'border-left:3px solid transparent;';
    const nameStyle = isBTG ? 'font-weight:700;color:#2563eb;' : 'font-weight:500;color:var(--text);';
    html += `<tr style="${rowStyle}transition:background 0.1s;cursor:pointer;"
      onclick="loadBankFromTable(${b.code})"
      onmouseover="this.style.background='${isBTG ? 'rgba(37,99,235,0.14)' : 'rgba(56,189,248,0.06)'}'"
      onmouseout="this.style.background='${isBTG ? 'rgba(37,99,235,0.08)' : 'transparent'}'">
      <td style="text-align:center;font-family:var(--mono);font-size:11px;color:var(--text3);">${rowIdx + 1}</td>
      <td style="${nameStyle}overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">
        ${isBTG ? '★ ' : ''}${b.name}
      </td>
      <td style="text-align:center;">
        <span style="font-family:var(--mono);font-size:11px;font-weight:700;color:${rColor};">${rating}</span>
      </td>
      <td class="r">${fmtKPIDecimal(b.assets)}</td>
      <td class="r">${fmtKPIDecimal(b.loans)}</td>
      <td class="r">${fmtKPIDecimal(b.liabilities)}</td>
      <td class="r" style="font-weight:600;${isBTG ? 'color:#2563eb;' : ''}">${fmtKPIDecimal(b.equity)}</td>
      <td class="r" style="color:${niColor};font-weight:600;">${b.netIncome12 !== 0 ? fmtKPIDecimal(b.netIncome12) : '—'}</td>
      <td class="r" style="color:var(--text2);font-family:var(--mono);">${loansEq}</td>
    </tr>`;
  });

  const tot = bankData.reduce((acc, b) => {
    acc.assets += b.assets; acc.loans += b.loans;
    acc.liabilities += b.liabilities; acc.equity += b.equity;
    acc.netIncome12 += b.netIncome12; return acc;
  }, { assets:0, loans:0, liabilities:0, equity:0, netIncome12:0 });
  const totLoansEq = tot.equity ? (tot.loans / tot.equity).toFixed(1) + 'x' : '—';
  const totNiColor = tot.netIncome12 >= 0 ? 'var(--green)' : 'var(--red)';

  html += `<tr style="background:var(--bg4);border-top:2px solid var(--border2);border-left:3px solid transparent;">
    <td></td>
    <td style="font-weight:700;color:var(--white);font-size:11px;letter-spacing:0.5px;text-transform:uppercase;">System Total</td>
    <td></td>
    <td class="r" style="font-weight:700;color:var(--white);">${fmtKPIDecimal(tot.assets)}</td>
    <td class="r" style="font-weight:700;color:var(--white);">${fmtKPIDecimal(tot.loans)}</td>
    <td class="r" style="font-weight:700;color:var(--white);">${fmtKPIDecimal(tot.liabilities)}</td>
    <td class="r" style="font-weight:700;color:var(--white);">${fmtKPIDecimal(tot.equity)}</td>
    <td class="r" style="font-weight:700;color:${totNiColor};">${fmtKPIDecimal(tot.netIncome12)}</td>
    <td class="r" style="font-weight:700;color:var(--text2);font-family:var(--mono);">${totLoansEq}</td>
  </tr>`;

  html += '</tbody></table></div>';
  el.innerHTML = html;
}

export function renderRatingsEditor() {
  const el = document.getElementById('ratingsEditor');
  if (!el || !Object.keys(ST.bancos).length) return;

  const RATING_OPTIONS = ['AAA','AA+','AA','AA-','A+','A','A-','BBB+','BBB','BB+','BB','—'];
  const stored = getCBRatings();
  const banks  = Object.keys(ST.bancos).map(Number).filter(c => c !== 999).sort((a, b) => a - b);

  let html = `<table class="tbl"><thead><tr>
    <th>Bank</th>
    <th style="text-align:center;">Rating (Feller Rate)</th>
    <th style="text-align:center;">Source</th>
  </tr></thead><tbody>`;

  banks.forEach(code => {
    const name      = bankName(code);
    const rating    = stored[code] || '—';
    const isDefault = FELLER_RATINGS[code] !== undefined;
    const rColor    = RATING_COLORS[rating] || 'var(--text3)';
    html += `<tr>
      <td style="font-weight:500;">${name}</td>
      <td style="text-align:center;">
        <select onchange="updateRating(${code}, this.value)" style="
          font-family:var(--mono);font-size:12px;font-weight:700;color:${rColor};
          background:var(--bg3);border:1px solid var(--border);border-radius:4px;
          padding:3px 6px;cursor:pointer;text-align:center;">
          ${RATING_OPTIONS.map(r => `<option value="${r}" ${r === rating ? 'selected' : ''}>${r}</option>`).join('')}
        </select>
      </td>
      <td style="text-align:center;font-size:11px;color:var(--text3);">${isDefault ? 'Feller Rate' : '✏️ Manual'}</td>
    </tr>`;
  });
  html += '</tbody></table>';
  el.innerHTML = html;
}

export function updateRating(code, val) {
  saveCBRating(code, val === '—' ? null : val);
  if (ST._cbData) renderCBTable();
}
