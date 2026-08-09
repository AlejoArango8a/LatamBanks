// ============================================================
// RANKING — Chilean Banking System tab
// ============================================================
import { ST, datasetIsoCountry } from '../state.js?v=bmon72';
import { paisSystemName, paisLocale } from '../paises.js?v=bmon72';

function bankingSystemPanelTitle() {
  return paisSystemName(ST.country);
}

function wireCbExportButton() {
  const btn = document.getElementById('cbExportBtn');
  if (!btn || typeof window.exportTableById !== 'function') return;
  const slug = datasetIsoCountry() === 'CO' ? 'Colombian_Banking_System'
    : datasetIsoCountry() === 'BR' ? 'Brazilian_Banking_System'
    : datasetIsoCountry() === 'UY' ? 'Uruguayan_Banking_System'
    : datasetIsoCountry() === 'PE' ? 'Peruvian_Banking_System'
    : datasetIsoCountry() === 'US' ? 'US_Banking_System'
    : datasetIsoCountry() === 'AR' ? 'Argentine_Banking_System'
    : datasetIsoCountry() === 'MX' ? 'Mexican_Banking_System'
    : datasetIsoCountry() === 'PA' ? 'Panamanian_Banking_System'
    : 'Chilean_Banking_System';
  btn.onclick = () => window.exportTableById('cbTable', slug);
}
import { API_BASE, FELLER_RATINGS, BANK_RATINGS_CL_META, BANK_RATINGS_CO, BANK_RATINGS_CO_META, RATING_COLORS, btgBlue, btgRgba } from '../config.js?v=bmon72';

/** Live CL ratings from data/cl_bank_ratings.json (Humphreys refresh + curated Feller). */
let _clRatingsLive = null;
let _clRatingsMetaLive = null;

export async function ensureClRatingsLoaded() {
  if (_clRatingsLive) return _clRatingsLive;
  try {
    const urls = [`${API_BASE}/api/chile/ratings`, `${API_BASE}/data/cl_bank_ratings.json`];
    for (const url of urls) {
      try {
        const r = await fetch(url);
        if (!r.ok) continue;
        const j = await r.json();
        const ratings = j.ratings || j;
        if (ratings && typeof ratings === 'object') {
          _clRatingsLive = Object.fromEntries(
            Object.entries(ratings).map(([k, v]) => [Number(k), v]),
          );
          _clRatingsMetaLive = j.meta
            ? Object.fromEntries(Object.entries(j.meta).map(([k, v]) => [Number(k), v]))
            : null;
          return _clRatingsLive;
        }
      } catch (_) { /* try next */ }
    }
  } catch (_) { /* fall through */ }
  _clRatingsLive = FELLER_RATINGS;
  _clRatingsMetaLive = BANK_RATINGS_CL_META;
  return _clRatingsLive;
}
import { CO_CUIF } from '../coCuentas.js?v=bmon72';
import { BR_KPI } from '../brCuentas.js?v=bmon72';
import { UY_KPI } from '../uyCuentas.js?v=bmon72';
import { PE_KPI } from '../peCuentas.js?v=bmon72';
import { US_KPI } from '../usCuentas.js?v=bmon72';
import { AR_KPI } from '../arCuentas.js?v=bmon72';
import { MX_KPI } from '../mxCuentas.js?v=bmon72';
import { PA_KPI } from '../paCuentas.js?v=bmon72';
import { bankName, fmtKPIDecimal, periodLabel } from '../format.js?v=bmon72';
import { apiDatos } from '../api.js?v=bmon91';

const asCodes = (c) => (Array.isArray(c) ? c : [c]);

function escapeAttr(s) {
  return String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
}

/** Overrides por jurisdicción: el mismo `codigo` numérico es otro banco en cada país. */
function cbRatingsStorageKey() {
  return `cbRatings_${datasetIsoCountry()}`;
}

function cbRatingsBase() {
  const iso = datasetIsoCountry();
  if (iso === 'CO') return BANK_RATINGS_CO;
  if (iso === 'CL') return _clRatingsLive || FELLER_RATINGS;
  // PE / UY / BR: sin mapa sembrado (evitar colisión con códigos Feller CL)
  return {};
}

function cbRatingsMetaCl(code) {
  return (_clRatingsMetaLive && _clRatingsMetaLive[code]) || BANK_RATINGS_CL_META[code];
}

export function getCBRatings() {
  const base = cbRatingsBase();
  const key = cbRatingsStorageKey();
  try {
    let raw = localStorage.getItem(key);
    if (!raw && datasetIsoCountry() === 'CL') {
      const legacy = localStorage.getItem('cbRatings');
      if (legacy) {
        raw = legacy;
        localStorage.setItem(key, legacy);
      }
    }
    const stored = JSON.parse(raw || '{}');
    return { ...base, ...stored };
  } catch { return { ...base }; }
}

export function saveCBRating(code, val) {
  try {
    const stored = JSON.parse(localStorage.getItem(cbRatingsStorageKey()) || '{}');
    if (val) stored[code] = val; else delete stored[code];
    localStorage.setItem(cbRatingsStorageKey(), JSON.stringify(stored));
  } catch {}
}

export async function renderChileanBanks() {
  const titleEl = document.getElementById('cbPanelTitle');
  if (titleEl) titleEl.textContent = bankingSystemPanelTitle();

  const el = document.getElementById('cbTable');
  if (!el) return;
  if (!ST.periodos.length) {
    el.innerHTML = '<div class="empty"><p>Load data first by clicking Analyze</p></div>';
    return;
  }

  if (datasetIsoCountry() === 'CL') {
    await ensureClRatingsLoaded();
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
  {
    const elCcy = document.getElementById('cbCurrencyLabel');
    if (elCcy) {
      const loc = paisLocale(ST.country) || 'es-CL';
      elCcy.textContent = ST.currency === 'USD' && Number(ST.usdRate) > 0
        ? `1 USD = ${Number(ST.usdRate).toLocaleString(loc, { maximumFractionDigits: 4 })}`
        : '';
    }
  }

  try {
    const allBanks   = Object.keys(ST.bancos).map(Number).filter(c => c !== 999);
    const iso        = datasetIsoCountry();
    const isCO       = iso === 'CO';
    const isBR       = iso === 'BR';
    const isUY       = iso === 'UY';
    const isPE       = iso === 'PE';
    const isUS       = iso === 'US';
    const isAR       = iso === 'AR';
    const isMX       = iso === 'MX';
    const isPA       = iso === 'PA';
    // Cada KPI es un CONJUNTO de códigos equivalentes. En CL/CO es un único
    // código; en BR son dos (plan Cosif viejo ≤2024 + nuevo ≥2025), que nunca
    // coexisten en un mismo trimestre, así que sumarlos mantiene la serie continua.
    // UY: códigos BCU. PE: slugs SBS. US: campos FDIC. AR/MX/PA: slugs loader.
    const actCodes  = isBR ? BR_KPI.activos      : isCO ? [CO_CUIF.activos]      : isUY ? asCodes(UY_KPI.activos)      : isPE ? asCodes(PE_KPI.activos)      : isUS ? asCodes(US_KPI.activos)      : isAR ? asCodes(AR_KPI.activos)      : isMX ? asCodes(MX_KPI.activos)      : isPA ? asCodes(PA_KPI.activos)      : ['100000000'];
    const loanCodes = isBR ? BR_KPI.colocaciones : isCO ? [CO_CUIF.colocaciones] : isUY ? asCodes(UY_KPI.colocaciones) : isPE ? asCodes(PE_KPI.colocaciones) : isUS ? asCodes(US_KPI.colocaciones) : isAR ? asCodes(AR_KPI.colocaciones) : isMX ? asCodes(MX_KPI.colocaciones) : isPA ? asCodes(PA_KPI.colocaciones) : ['144000000'];
    const eqCodes   = isBR ? BR_KPI.patrimonio   : isCO ? [CO_CUIF.patrimonio]   : isUY ? asCodes(UY_KPI.patrimonio)   : isPE ? asCodes(PE_KPI.patrimonio)   : isUS ? asCodes(US_KPI.patrimonio)   : isAR ? asCodes(AR_KPI.patrimonio)   : isMX ? asCodes(MX_KPI.patrimonio)   : isPA ? asCodes(PA_KPI.patrimonio)   : ['300000000'];
    const utilCodes = isBR ? BR_KPI.utilidad     : isCO ? [CO_CUIF.utilidadNet]  : isUY ? asCodes(UY_KPI.utilidad)     : isPE ? asCodes(PE_KPI.utilidad)     : isUS ? asCodes(US_KPI.utilidad)     : isAR ? asCodes(AR_KPI.utilidad)     : isMX ? asCodes(MX_KPI.utilidad)     : isPA ? asCodes(PA_KPI.utilidad)     : ['590000000'];
    const cuentas   = [...actCodes, ...loanCodes, ...eqCodes];
    const lastPYear   = parseInt(lastP.slice(0, 4));
    const lastPMonth  = lastP.slice(4, 6);
    const priorYearP    = `${lastPYear - 1}${lastPMonth}`;
    const priorYearDecP = `${lastPYear - 1}12`;
    const fetchSet    = new Set([lastP, priorYearP, priorYearDecP].filter(p => ST.periodos.includes(p)));
    const fetchPeriods = [...fetchSet];

    const [rows, incomeRows] = await Promise.all([
      apiDatos({ tipo: 'b1', cuentas, periodos: [lastP], bancos: allBanks, select: 'ins_cod,cuenta,monto_total' }),
      apiDatos({ tipo: 'r1', cuentas: utilCodes, periodos: fetchPeriods, bancos: allBanks, select: 'ins_cod,periodo,monto_total' }),
    ]);

    const getVal = (bank, codes) => {
      const bc  = Number(bank);
      const set = new Set(codes.map(c => String(c).trim()));
      return rows
        .filter(r => Number(r.ins_cod) === bc && set.has(String(r.cuenta).trim()))
        .reduce((s, r) => s + (Number(r.monto_total) || 0), 0);
    };
    const getIncomeVal = (bank, periodo) =>
      incomeRows
        .filter(r => Number(r.ins_cod) === Number(bank) && r.periodo === periodo)
        .reduce((s, r) => s + (Number(r.monto_total) || 0), 0);
    const getNetIncome12M = bank => {
      const ytdNow = getIncomeVal(bank, lastP);
      if (lastPMonth === '12') return ytdNow;
      return getIncomeVal(bank, priorYearDecP) + ytdNow - getIncomeVal(bank, priorYearP);
    };

    ST._cbData = allBanks.map(c => ({
      code: c, name: bankName(c),
      assets:      getVal(c, actCodes),
      loans:       getVal(c, loanCodes),
      equity:      getVal(c, eqCodes),
      netIncome12: getNetIncome12M(c),
    })).filter(b => b.assets > 0).map(b => ({
      ...b,
      roe12: b.equity ? (b.netIncome12 / b.equity) * 100 : null,
    }));

    if (!ST._cbSort) ST._cbSort = { col: 'equity', dir: -1 };
    renderCBTable();
    wireCbExportButton();

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

  if (ST._cbSort?.col === 'liabilities') ST._cbSort = { col: 'equity', dir: -1 };

  const ratings  = getCBRatings();
  const { col, dir } = ST._cbSort;
  const bankData = [...ST._cbData].sort((a, b) => {
    if (col === 'name') return dir * a.name.localeCompare(b.name);
    if (col === 'rating') {
      const order = ['AAA','AA+','AA','AA-','A+','A','A-','BBB+','BBB','—'];
      return dir * (order.indexOf(ratings[a.code] || '—') - order.indexOf(ratings[b.code] || '—'));
    }
    const av = a[col];
    const bv = b[col];
    const an = (av == null || !Number.isFinite(Number(av))) ? -Infinity : Number(av);
    const bn = (bv == null || !Number.isFinite(Number(bv))) ? -Infinity : Number(bv);
    return dir * (an - bn);
  });

  const thStyle  = `padding:10px 14px;font-size:11px;font-weight:700;letter-spacing:0.5px;
    text-transform:uppercase;color:var(--white);border-bottom:2px solid var(--border2);
    cursor:pointer;user-select:none;white-space:nowrap;`;
  const thStyleL = thStyle + 'text-align:left;';
  const arrow    = c => col === c ? (dir === 1 ? ' ↑' : ' ↓') : ' ↕';

  let html = `<div style="overflow-x:auto"><table class="tbl tbl-banking-system" style="table-layout:fixed;width:100%;">
    <thead><tr style="background:var(--bg4);">
      <th class="cb-col-rank" style="${thStyle}width:4%;text-align:center;">#</th>
      <th class="cb-col-bank" style="${thStyleL}width:20%;" onclick="sortCBBy('name')">Bank${arrow('name')}</th>
      <th class="cb-col-rating" style="${thStyle}width:6%;text-align:center;" onclick="sortCBBy('rating')">Rating${arrow('rating')}</th>
      <th class="cb-col-assets r" style="${thStyle}width:12%;" onclick="sortCBBy('assets')">Total Assets${arrow('assets')}</th>
      <th class="cb-col-equity r" style="${thStyle}width:11%;" onclick="sortCBBy('equity')">Equity${arrow('equity')}</th>
      <th class="cb-col-loans r" style="${thStyle}width:11%;" onclick="sortCBBy('loans')">Total Loans${arrow('loans')}</th>
      <th class="cb-col-ni r" style="${thStyle}width:12%;" onclick="sortCBBy('netIncome12')">Net Income 12M${arrow('netIncome12')}</th>
      <th class="cb-col-roe r" style="${thStyle}width:10%;" onclick="sortCBBy('roe12')">ROE % 12M${arrow('roe12')}</th>
      <th class="cb-col-loanseq r" style="${thStyle}width:12%;" onclick="sortCBBy('loansEq')">Loans / Equity${arrow('loansEq')}</th>
    </tr></thead>
    <tbody>`;

  bankData.forEach((b, rowIdx) => {
    const btgCode  = datasetIsoCountry() === 'CO' ? 66 : datasetIsoCountry() === 'BR' ? 1000080336 : 59;
    const isBTG    = b.code === btgCode;
    const rating   = ratings[b.code] || '—';
    const rColor   = RATING_COLORS[rating] || 'var(--text3)';
    const loansEq  = b.equity ? (b.loans / b.equity).toFixed(1) + 'x' : '—';
    b.loansEq      = b.equity ? b.loans / b.equity : 0;
    const roe12    = b.roe12;
    const roeLbl   = roe12 != null && Number.isFinite(roe12) ? `${roe12.toFixed(2)}%` : '—';
    const roeColor = roe12 == null || !Number.isFinite(roe12) ? 'var(--text3)'
      : roe12 >= 0 ? 'var(--green)' : 'var(--red)';
    const niColor  = b.netIncome12 >= 0 ? 'var(--green)' : 'var(--red)';
    const rowStyle = isBTG
      ? `background:${btgRgba(0.08)};border-left:3px solid ${btgBlue()};`
      : 'border-left:3px solid transparent;';
    const nameStyle = isBTG ? `font-weight:700;color:${btgBlue()};` : 'font-weight:500;color:var(--text);';
    const isoTip = datasetIsoCountry();
    const metaTip = isoTip === 'CO' ? BANK_RATINGS_CO_META[b.code]
      : isoTip === 'CL' ? cbRatingsMetaCl(b.code)
      : null;
    const tip = metaTip
      ? `Perspectiva: ${metaTip.outlook}. ${metaTip.agency}. ${metaTip.analysis}`
      : '';
    const tipAttr = tip ? ` title="${escapeAttr(tip)}"` : '';
    html += `<tr style="${rowStyle}transition:background 0.1s;cursor:pointer;"
      onclick="loadBankFromTable(${b.code})"
      onmouseover="this.style.background='${isBTG ? btgRgba(0.14) : 'rgba(56,189,248,0.06)'}'"
      onmouseout="this.style.background='${isBTG ? btgRgba(0.08) : 'transparent'}'">
      <td class="cb-col-rank" style="text-align:center;font-family:var(--mono);font-size:11px;color:var(--text3);">${rowIdx + 1}</td>
      <td class="cb-col-bank" style="${nameStyle}overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">
        ${isBTG ? '★ ' : ''}${b.name}
      </td>
      <td class="cb-col-rating" style="text-align:center;">
        <span${tipAttr} style="font-family:var(--mono);font-size:11px;font-weight:700;color:${rColor};${metaTip ? 'cursor:help;' : ''}">${rating}</span>
      </td>
      <td class="cb-col-assets r">${fmtKPIDecimal(b.assets)}</td>
      <td class="cb-col-equity r" style="font-weight:600;${isBTG ? `color:${btgBlue()};` : ''}">${fmtKPIDecimal(b.equity)}</td>
      <td class="cb-col-loans r">${fmtKPIDecimal(b.loans)}</td>
      <td class="cb-col-ni r" style="color:${niColor};font-weight:600;">${b.netIncome12 !== 0 ? fmtKPIDecimal(b.netIncome12) : '—'}</td>
      <td class="cb-col-roe r" style="color:${roeColor};font-weight:600;font-family:var(--mono);">${roeLbl}</td>
      <td class="cb-col-loanseq r" style="color:var(--text2);font-family:var(--mono);">${loansEq}</td>
    </tr>`;
  });

  const tot = bankData.reduce((acc, b) => {
    acc.assets += b.assets; acc.loans += b.loans;
    acc.equity += b.equity;
    acc.netIncome12 += b.netIncome12; return acc;
  }, { assets:0, loans:0, equity:0, netIncome12:0 });
  const totLoansEq = tot.equity ? (tot.loans / tot.equity).toFixed(1) + 'x' : '—';
  const totRoe12 = tot.equity ? (tot.netIncome12 / tot.equity) * 100 : null;
  const totRoeLbl = totRoe12 != null && Number.isFinite(totRoe12) ? `${totRoe12.toFixed(2)}%` : '—';
  const totRoeColor = totRoe12 == null || !Number.isFinite(totRoe12) ? 'var(--text3)'
    : totRoe12 >= 0 ? 'var(--green)' : 'var(--red)';
  const totNiColor = tot.netIncome12 >= 0 ? 'var(--green)' : 'var(--red)';

  html += `<tr style="background:var(--bg4);border-top:2px solid var(--border2);border-left:3px solid transparent;">
    <td class="cb-col-rank"></td>
    <td class="cb-col-bank" style="font-weight:700;color:var(--white);font-size:11px;letter-spacing:0.5px;text-transform:uppercase;">System Total</td>
    <td class="cb-col-rating"></td>
    <td class="cb-col-assets r" style="font-weight:700;color:var(--white);">${fmtKPIDecimal(tot.assets)}</td>
    <td class="cb-col-equity r" style="font-weight:700;color:var(--white);">${fmtKPIDecimal(tot.equity)}</td>
    <td class="cb-col-loans r" style="font-weight:700;color:var(--white);">${fmtKPIDecimal(tot.loans)}</td>
    <td class="cb-col-ni r" style="font-weight:700;color:${totNiColor};">${fmtKPIDecimal(tot.netIncome12)}</td>
    <td class="cb-col-roe r" style="font-weight:700;color:${totRoeColor};font-family:var(--mono);">${totRoeLbl}</td>
    <td class="cb-col-loanseq r" style="font-weight:700;color:var(--text2);font-family:var(--mono);">${totLoansEq}</td>
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
  const isoR = datasetIsoCountry();
  const defaultMap = cbRatingsBase();

  const ratingColHdr = isoR === 'CO' ? 'Rating (nacional)'
    : isoR === 'CL' ? 'Rating (solvencia local)'
    : 'Rating';
  const sourceColHdr = (isoR === 'CO' || isoR === 'CL') ? 'Calificadora · perspectiva' : 'Source';
  let html = `<table class="tbl"><thead><tr>
    <th>Bank</th>
    <th style="text-align:center;">${ratingColHdr}</th>
    <th style="text-align:center;">${sourceColHdr}</th>
  </tr></thead><tbody>`;

  banks.forEach(code => {
    const name      = bankName(code);
    const rating    = stored[code] || '—';
    const isDefault = defaultMap[code] !== undefined;
    const rColor    = RATING_COLORS[rating] || 'var(--text3)';
    const meta      = isoR === 'CO' ? BANK_RATINGS_CO_META[code]
      : isoR === 'CL' ? cbRatingsMetaCl(code)
      : null;
    const sourceLbl = !isDefault
      ? '✏️ Manual'
      : meta
        ? `${meta.agency} · ${meta.outlook}`
        : (isoR === 'CO' ? 'Referencia CO' : isoR === 'CL' ? 'Solvencia local' : '—');
    const sourceTip = meta ? escapeAttr(meta.analysis) : '';
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
      <td style="text-align:center;font-size:11px;color:var(--text3);" ${sourceTip ? `title="${sourceTip}"` : ''}>${sourceLbl}</td>
    </tr>`;
  });
  html += '</tbody></table>';
  el.innerHTML = html;
}

export function updateRating(code, val) {
  saveCBRating(code, val === '—' ? null : val);
  if (ST._cbData) renderCBTable();
}
