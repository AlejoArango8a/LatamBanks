// ============================================================
// EXPLORADOR — account hierarchy browser
// ============================================================
import { ST } from '../state.js?v=bmon9';
import { CUENTAS_PRINCIPALES, bankColor } from '../config.js?v=bmon9';
import { bankName, fmtKPIDecimal, toSentenceCase, getTipo, getExpLabel, periodLabel } from '../format.js?v=bmon9';
import { apiDatos } from '../api.js?v=bmon9';
import { drawLineChart, setupChartTooltip } from '../charts.js?v=bmon9';
import { setStatus } from '../utils.js?v=bmon9';

let expAbortController = null;

/** Abort any in-flight Explorer API calls (e.g. when starting a dashboard run). */
export function abortExplorerFetch() {
  expAbortController?.abort();
}

export function getExpAccounts() {
  return Object.keys(CUENTAS_PRINCIPALES).sort();
}

export function renderExpGrid() {
  const accounts = getExpAccounts();
  const SECTION_COLORS = {
    '1': '#38bdf8', '2': '#f87171', '3': '#a78bfa',
    '4': '#f59e0b', '5': '#34d399', '6': '#fb923c', '8': '#e879f9',
  };
  let html = '';
  accounts.forEach(c => {
    const label  = getExpLabel(c);
    const color  = SECTION_COLORS[c[0]] || 'var(--text2)';
    const active = ST.exp.selected === c;
    html += `<div onclick="expSelect('${c}')" style="
      display:flex;align-items:center;gap:12px;
      padding:10px 16px;cursor:pointer;border-left:3px solid ${active ? color : 'transparent'};
      background:${active ? 'rgba(56,189,248,0.06)' : 'transparent'};
      border-bottom:1px solid var(--border);transition:all 0.15s;">
      <span style="font-family:var(--mono);font-size:14px;color:${color};flex-shrink:0;width:16px;text-align:center;">${c[0]}</span>
      <span style="font-size:13px;color:${active ? 'var(--white)' : 'var(--text)'};font-weight:${active ? '600' : '400'};line-height:1.3;">${label}</span>
    </div>`;
  });
  document.getElementById('expTree').innerHTML = html;
}

export function initExplorer() {
  renderExpGrid();
}

export async function expSelect(code) {
  abortExplorerFetch();
  expAbortController = new AbortController();
  const signal = expAbortController.signal;

  if (ST.exp.selected && ST.exp.selected !== code) ST.exp.history.push(ST.exp.selected);
  ST.exp.selected = code;
  renderExpGrid();

  const backBtn = document.getElementById('expBackBtn');
  if (backBtn) backBtn.style.display = ST.exp.history.length > 0 ? 'block' : 'none';

  document.getElementById('expResult').style.display      = 'block';
  document.getElementById('expPlaceholder').style.display = 'none';

  const tipo  = getTipo(code);
  const label = getExpLabel(code);
  document.getElementById('expCode').textContent = code;
  document.getElementById('expName').textContent = label;
  const tipoLabels = { b1: 'Consolidated balance', r1: 'Income statement', c1: 'Supplementary information' };
  document.getElementById('expType').textContent = tipoLabels[tipo] || '';

  setStatus('loading', 'Loading account...');
  try {
    const selDesde = document.getElementById('selDesde').value;
    const selHasta = document.getElementById('selHasta').value;
    const periodos = ST.periodos.filter(p => p >= selDesde && p <= selHasta);
    const banks    = [...ST.selected];
    if (!periodos.length) {
      setStatus('error', 'No periods in selected range');
      document.getElementById('expResult').style.display      = 'block';
      document.getElementById('expPlaceholder').style.display = 'none';
      document.getElementById('expTable').innerHTML =
        `<div class="empty"><p>No periods in From/To range. Adjust selectors and retry.</p></div>`;
      return;
    }
    if (!banks.length) {
      setStatus('error', 'No banks selected');
      return;
    }
    const lastP = periodos[periodos.length - 1];

    const rows = await apiDatos({ tipos: ['b1','r1','c1'], cuentas: [code], periodos, bancos: banks, select: 'periodo,ins_cod,cuenta,monto_total' }, signal);
    if (signal.aborted) return;
    const usdFactor  = (ST.currency === 'USD' && ST.usdRate) ? (1 / ST.usdRate) : 1;
    const bankCodes  = banks.filter(c => c !== 999);

    const series = bankCodes.map((c, i) => ({
      label: bankName(c),
      color: bankColor(c, i),
      data:  periodos.map(p =>
        rows.filter(r => r.ins_cod === c && r.periodo === p)
            .reduce((s, r) => s + (r.monto_total || 0), 0) / 1e9 * usdFactor
      ),
    }));

    if (ST.selected.has(999)) {
      series.unshift({
        label: 'Sistema Bancario', color: '#94a8be',
        data: periodos.map(p =>
          rows.filter(r => r.ins_cod === 999 && r.periodo === p)
              .reduce((s, r) => s + (r.monto_total || 0), 0) / 1e9 * usdFactor
        ),
      });
    }

    document.getElementById('expLegend').innerHTML = series.map(s =>
      `<div class="leg-item"><div class="leg-dot" style="background:${s.color}"></div>${s.label}</div>`
    ).join('');

    drawLineChart('chartExp', periodos, series);
    setupChartTooltip('chartExp', 'chartTooltip');

    const tableRows = bankCodes.map(c => ({
      name: bankName(c),
      val:  rows.filter(r => r.ins_cod === c && r.periodo === lastP)
               .reduce((s, r) => s + (r.monto_total || 0), 0),
    })).sort((a, b) => Math.abs(b.val) - Math.abs(a.val));

    let tHtml = `<table class="tbl"><thead><tr><th>Bank</th><th class="r">Last period</th></tr></thead><tbody>`;
    tableRows.forEach(r => {
      tHtml += `<tr><td>${r.name}</td><td class="r ${r.val < 0 ? 'neg' : ''}">${fmtKPIDecimal(r.val)}</td></tr>`;
    });
    tHtml += '</tbody></table>';
    document.getElementById('expTable').innerHTML = tHtml;

    // Sub-accounts (3-level hierarchical tree)
    const digit    = code[0];
    const allSubs  = Object.keys(ST.planCuentas)
      .filter(c => c[0] === digit && !/^[1-9]0{8}$/.test(c))
      .sort();

    const subPanel = document.getElementById('expSubPanel');
    if (allSubs.length > 0) {
      subPanel.style.display = 'block';
      document.getElementById('expSubTitle').textContent = `Sub-accounts`;

      const subRows = await apiDatos({ tipos: ['b1','r1','c1'], cuentas: allSubs, periodos: [lastP], bancos: banks, select: 'cuenta,ins_cod,monto_total' }, signal);
      if (signal.aborted) return;
      const getSubVal = c => subRows
        .filter(r => r.cuenta === c && banks.includes(r.ins_cod))
        .reduce((s, r) => s + (r.monto_total || 0), 0);

      const getLevel = c => {
        const trailing = c.match(/0+$/)?.[0].length || 0;
        if (trailing >= 6) return 1;
        if (trailing >= 2) return 2;
        return 3;
      };

      if (!ST._expTreeExpanded) ST._expTreeExpanded = {};

      const renderTree = () => {
        const subList = document.getElementById('expSubList');
        if (!subList) return;

        const l1Accounts = allSubs.filter(c => getLevel(c) === 1);

        let html = `
          <div style="display:flex;justify-content:flex-start;padding:8px 14px 0;">
            <button id="expSubFilterBtn" onclick="toggleExpSubFilter()" style="
              padding:4px 12px;border-radius:4px;font-size:11px;cursor:pointer;
              font-family:var(--sans);border:1px solid ${ST._expSubFilter ? 'var(--accent)' : 'var(--border)'};
              background:${ST._expSubFilter ? 'var(--accent)' : 'var(--bg3)'};
              color:${ST._expSubFilter ? '#fff' : 'var(--text2)'};">
              ${ST._expSubFilter ? '✓ Only accounts with data' : 'Only accounts with data'}
            </button>
          </div>
          <table class="tbl"><thead><tr>
            <th style="width:110px;">Code</th>
            <th>Description</th>
            <th class="r" style="width:120px;">Last period</th>
          </tr></thead><tbody>`;

        const renderRow = (c, indent) => {
          const val        = getSubVal(c);
          const hasData    = val !== 0;
          if (ST._expSubFilter && !hasData) return '';
          const lbl        = toSentenceCase(ST.planCuentas[c] || c);
          const level      = getLevel(c);
          const children   = level < 3 ? allSubs.filter(ch =>
            ch !== c && ch[0] === digit && getLevel(ch) === level + 1 &&
            ch.startsWith(c.slice(0, c.length - (level === 1 ? 6 : (level === 2 ? 2 : 0))))
          ) : [];
          const hasChildren = children.length > 0;
          const isExpanded  = ST._expTreeExpanded[c];
          const isSelected  = ST.exp.selected === c;
          const isBold      = level === 1 || isSelected;
          const indentPx    = (indent * 16) + 'px';
          const rowBg       = isSelected ? 'background:rgba(56,189,248,0.08);' : '';

          let row = `<tr onmouseover="this.style.background='rgba(56,189,248,0.04)'"
            onmouseout="this.style.background='${isSelected ? 'rgba(56,189,248,0.08)' : 'transparent'}'"
            style="${rowBg}">
            <td class="cod" style="color:${isSelected ? '#2563eb' : 'var(--accent)'};padding-left:calc(14px + ${indentPx});white-space:nowrap;font-weight:${isSelected ? '700' : '400'};">
              ${hasChildren
                ? `<span onclick="expTreeToggle('${c}')" style="cursor:pointer;margin-right:2px;">${isExpanded ? '▾' : '▸'}</span>`
                : '<span style="margin-right:8px;"></span>'}
              <span onclick="expSelect('${c}')" style="cursor:pointer;">${c}</span>
            </td>
            <td onclick="expSelect('${c}')" style="color:${isSelected ? '#2563eb' : 'var(--text)'};font-weight:${isBold ? '600' : '400'};
              padding-left:${indent > 0 ? '4px' : '14px'};cursor:pointer;">${isSelected ? '▶ ' : ''}${lbl}</td>
            <td class="r ${val < 0 ? 'neg' : ''}" onclick="expSelect('${c}')" style="${!hasData ? 'color:var(--text3)' : ''};cursor:pointer;font-weight:${isSelected ? '700' : '400'};">
              ${hasData ? fmtKPIDecimal(val) : '—'}
            </td>
          </tr>`;

          if (hasChildren && isExpanded) {
            children.forEach(ch => { row += renderRow(ch, indent + 1); });
          }
          return row;
        };

        l1Accounts.forEach(c => { html += renderRow(c, 0); });
        html += '</tbody></table>';
        subList.innerHTML = html;
      };

      ST._expRenderTree = renderTree;
      renderTree();
    } else {
      subPanel.style.display = 'none';
    }

    setStatus('ok', `Cuenta ${code}`);
  } catch (e) {
    if (e?.name === 'AbortError') return;
    setStatus('error', 'Error loading account');
    console.error(e);
  }
}

export function sortExpSubBy(col) {
  if (!ST._expSubSort) ST._expSubSort = { col, dir: 1 };
  if (ST._expSubSort.col === col) {
    ST._expSubSort.dir *= -1;
  } else {
    ST._expSubSort.col = col;
    ST._expSubSort.dir = col === 'val' ? -1 : 1;
  }
  renderExpSubTable();
}

export function expTreeToggle(code) {
  if (!ST._expTreeExpanded) ST._expTreeExpanded = {};
  ST._expTreeExpanded[code] = !ST._expTreeExpanded[code];
  if (ST._expRenderTree) ST._expRenderTree();
}

export function toggleExpSubFilter() {
  ST._expSubFilter = !ST._expSubFilter;
  if (ST._expRenderTree) {
    ST._expRenderTree();
  } else {
    renderExpSubTable();
  }
}

export function renderExpSubTable() {
  const subList = document.getElementById('expSubList');
  if (!subList || !ST._expSubData) return;

  const { col, dir } = ST._expSubSort || { col: 'code', dir: 1 };
  let data = [...ST._expSubData.subData];
  if (ST._expSubFilter) data = data.filter(d => d.val !== 0);
  data.sort((a, b) => {
    if (col === 'code')  return dir * a.c.localeCompare(b.c);
    if (col === 'label') return dir * a.label.localeCompare(b.label);
    if (col === 'val')   return dir * (b.val - a.val);
    return 0;
  });

  const arrow = c => col === c ? (dir === 1 ? ' ↑' : ' ↓') : '';
  const thS   = 'cursor:pointer;user-select:none;';

  let html = `
    <div style="display:flex;justify-content:flex-start;padding:8px 14px 0;">
      <button id="expSubFilterBtn" onclick="toggleExpSubFilter()" style="
        padding:4px 12px;border-radius:4px;font-size:11px;cursor:pointer;
        font-family:var(--sans);border:1px solid ${ST._expSubFilter ? 'var(--accent)' : 'var(--border)'};
        background:${ST._expSubFilter ? 'var(--accent)' : 'var(--bg3)'};
        color:${ST._expSubFilter ? '#fff' : 'var(--text2)'};">
        ${ST._expSubFilter ? '✓ Only accounts with data' : 'Only accounts with data'}
      </button>
    </div>
    <table class="tbl"><thead><tr>
      <th style="${thS}" onclick="sortExpSubBy('code')">Code${arrow('code')}</th>
      <th style="${thS}" onclick="sortExpSubBy('label')">Description${arrow('label')}</th>
      <th class="r" style="${thS}" onclick="sortExpSubBy('val')">Last period${arrow('val')}</th>
    </tr></thead><tbody>`;

  data.forEach(({ c, label, val, hasData }) => {
    const dim = !hasData ? 'opacity:0.45;' : '';
    html += `<tr style="${dim}cursor:pointer;" onclick="expSelect('${c}')"
      onmouseover="this.style.background='rgba(56,189,248,0.04)'"
      onmouseout="this.style.background='transparent'">
      <td class="cod" style="color:var(--accent)">${c}</td>
      <td style="color:var(--text)">${label}</td>
      <td class="r ${val < 0 ? 'neg' : ''}">${hasData ? fmtKPIDecimal(val) : '—'}</td>
    </tr>`;
  });

  html += '</tbody></table>';
  subList.innerHTML = html;
}

export function expGoBack() {
  const prev            = ST.exp.history.pop();
  const currentSelected = ST.exp.selected;
  ST.exp.selected = prev;
  ST.exp.history  = ST.exp.history.filter(h => h !== prev);
  expSelect(prev);
  if (ST.exp.history[ST.exp.history.length - 1] === currentSelected) {
    ST.exp.history.pop();
  }
}
