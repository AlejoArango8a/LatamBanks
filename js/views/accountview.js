// ============================================================
// ACCOUNT VIEW — cross-bank account comparison
// ============================================================
import { ST } from '../state.js?v=bmon11';
import { bankName, fmtKPIDecimal, toSentenceCase, getTipo, periodLabel } from '../format.js?v=bmon11';
import { apiDatos } from '../api.js?v=bmon11';

// ---- Hierarchy level helper ----
export function avGetLevel(c) {
  if (/^[1-9]0+$/.test(c)) return 0;
  const trailing = c.match(/0+$/)?.[0].length || 0;
  if (trailing >= 4) return 1;
  if (trailing >= 1) return 2;
  return 3;
}

export function initAccountView() {
  const desde = document.getElementById('avDesde');
  const hasta  = document.getElementById('avHasta');
  if (!desde || !hasta || !ST.periodos.length) return;
  if (desde.options.length === 0) {
    ST.periodos.forEach(p => {
      desde.innerHTML += `<option value="${p}">${periodLabel(p)}</option>`;
      hasta.innerHTML  += `<option value="${p}">${periodLabel(p)}</option>`;
    });
    const n = ST.periodos.length;
    desde.selectedIndex = Math.max(0, n - 13);
    hasta.selectedIndex  = n - 1;
  }
  if (!ST._avGroup) avSelectGroup('1');
}

export function avClearAccount() {
  ST._avAccount = null;
  const input = document.getElementById('avAccountInput');
  if (input) { input.value = ''; input.focus(); }
  const box = document.getElementById('avSuggestions');
  if (box) box.style.display = 'none';
  const tableEl   = document.getElementById('avTable');
  if (tableEl) tableEl.innerHTML = '';
  const exportBtn = document.getElementById('avExportBtn');
  if (exportBtn) exportBtn.style.display = 'none';
  if (ST._avGroup) avSuggest('');
}

export function avSelectGroup(digit) {
  ST._avGroup   = digit;
  ST._avAccount = null;
  const input = document.getElementById('avAccountInput');
  if (input) {
    input.value       = '';
    input.placeholder = digit ? `Search in group ${digit}...` : 'Search by code or name...';
  }
  const sel = document.getElementById('avSelectedAccount');
  if (sel) sel.textContent = '';
  document.querySelectorAll('.avgrp').forEach(b => {
    const isActive        = b.textContent.trim().startsWith(digit || 'All');
    b.style.background    = isActive ? 'rgba(56,189,248,0.12)' : 'var(--bg3)';
    b.style.borderColor   = isActive ? 'var(--accent)' : 'var(--border)';
    b.style.color         = isActive ? 'var(--accent)' : 'var(--text)';
    b.style.fontWeight    = isActive ? '600' : '400';
  });
  avSuggest('');
}

export function avSuggest(query) {
  const box = document.getElementById('avSuggestions');
  if (!box) return;
  const q = query.trim().toLowerCase();

  if (q && !/^\d{3,}$/.test(q)) {
    const matches = Object.entries(ST.planCuentas).filter(([c, l]) => {
      const groupOk = !ST._avGroup || c[0] === ST._avGroup;
      return groupOk && (c.includes(q) || l.toLowerCase().includes(q));
    }).slice(0, 120);
    if (!matches.length) { box.style.display = 'none'; return; }
    box.style.display = 'block';
    box.innerHTML = `<div onclick="event.stopPropagation()">` +
      `<div style="padding:5px 14px;font-size:10px;color:var(--text3);
        font-family:var(--mono);border-bottom:1px solid var(--border);">
        ${matches.length} results for "${q}"</div>` +
      matches.map(([c, l]) => avRowHtml(c, l, 0, false)).join('') +
      `</div>`;
    return;
  }

  if (!ST._avGroup && !q) { box.style.display = 'none'; return; }
  const digit      = ST._avGroup;
  const allInGroup = Object.keys(ST.planCuentas)
    .filter(c => (!digit || c[0] === digit) && avGetLevel(c) > 0)
    .sort();
  const l1 = allInGroup.filter(c => avGetLevel(c) === 1);
  box.style.display = 'block';
  avRenderTree(box, digit, l1, allInGroup);
}

export function avRenderTree(box, digit, l1, allInGroup) {
  const total = allInGroup.length;
  let html = `<div style="padding:5px 14px;font-size:10px;color:var(--text3);
    font-family:var(--mono);border-bottom:1px solid var(--border);">
    ${total} ACCOUNTS IN GROUP ${digit} — click ▸ to expand</div>`;

  const renderNode = (c, indent) => {
    const level        = avGetLevel(c);
    const label        = toSentenceCase(ST.planCuentas[c] || c);
    const isExpanded   = ST._avTreeExpanded[c];
    const trailingZeros = c.match(/0+$/)?.[0].length || 0;
    const sigPart      = c.slice(0, c.length - trailingZeros);
    const children     = level < 3
      ? allInGroup.filter(ch => {
          if (ch === c) return false;
          if (avGetLevel(ch) !== level + 1) return false;
          return ch.startsWith(sigPart);
        })
      : [];
    const hasKids = children.length > 0;
    let row = avRowHtml(c, label, indent, hasKids, isExpanded);
    if (hasKids && isExpanded) {
      children.forEach(ch => { row += renderNode(ch, indent + 1); });
    }
    return row;
  };

  l1.forEach(c => { html += renderNode(c, 0); });
  box.innerHTML = `<div onclick="event.stopPropagation()">${html}</div>`;
}

export function avRowHtml(c, label, indent, hasKids, isExpanded) {
  const indentPx   = (indent * 18) + 'px';
  const icon       = hasKids ? (isExpanded ? '▾' : '▸') : '';
  const isSelected = ST._avAccount?.code === c;
  const bg         = isSelected ? 'rgba(56,189,248,0.1)' : 'transparent';
  return `<div data-code="${c}" style="
    display:flex;gap:0;align-items:center;
    border-bottom:1px solid var(--border);background:${bg};">
    ${hasKids ? `
    <div onclick="avTreeToggle('${c}')" title="Expand/collapse" style="
      padding:8px 8px 8px calc(14px + ${indentPx});
      cursor:pointer;color:var(--text3);font-size:11px;flex-shrink:0;min-width:calc(30px + ${indentPx});"
      onmouseover="this.style.color='var(--accent)'"
      onmouseout="this.style.color='var(--text3)'">${icon}</div>` :
    `<div style="padding:8px 8px 8px calc(14px + ${indentPx});flex-shrink:0;min-width:calc(30px + ${indentPx});"></div>`
    }
    <div onclick="avSelectAccount('${c}')" style="
      display:flex;gap:10px;align-items:center;flex:1;
      padding:8px 14px 8px 0;cursor:pointer;"
      onmouseover="this.parentElement.style.background='rgba(56,189,248,0.06)'"
      onmouseout="this.parentElement.style.background='${isSelected ? 'rgba(56,189,248,0.1)' : 'transparent'}'">
      <span style="font-family:var(--mono);font-size:10px;color:var(--accent);
        flex-shrink:0;min-width:90px;">${c}</span>
      <span style="font-size:12px;color:var(--text);
        font-weight:${indent === 0 ? '600' : '400'};">${label}</span>
    </div>
  </div>`;
}

export function avTreeToggle(code) {
  ST._avTreeExpanded[code] = !ST._avTreeExpanded[code];
  const digit      = ST._avGroup;
  const allInGroup = Object.keys(ST.planCuentas)
    .filter(c => (!digit || c[0] === digit) && avGetLevel(c) > 0)
    .sort();
  const l1  = allInGroup.filter(c => avGetLevel(c) === 1);
  const box = document.getElementById('avSuggestions');
  if (box) avRenderTree(box, digit, l1, allInGroup);
}

export function avSelectAccount(code) {
  const label = toSentenceCase(ST.planCuentas[code] || code);
  const tipo  = getTipo(code);
  ST._avAccount = { code, label, tipo };
  const input   = document.getElementById('avAccountInput');
  if (input) input.value = `${code} — ${label}`;
  const level = avGetLevel(code);
  if (level < 3) ST._avTreeExpanded[code] = true;
  const digit = ST._avGroup;
  if (digit) {
    const allInGroup = Object.keys(ST.planCuentas)
      .filter(c => c[0] === digit && avGetLevel(c) > 0).sort();
    const l1  = allInGroup.filter(c => avGetLevel(c) === 1);
    const box = document.getElementById('avSuggestions');
    if (box && box.style.display !== 'none') avRenderTree(box, digit, l1, allInGroup);
  }
}

// Close suggestions on outside click
document.addEventListener('click', e => {
  const input = document.getElementById('avAccountInput');
  const box   = document.getElementById('avSuggestions');
  if (!box) return;
  if (e.target === input) {
    avSuggest(input.value.split('—')[0].trim() || '');
  } else if (
    !e.target.closest('#avSuggestions') &&
    !e.target.closest('#avAccountInput') &&
    !e.target.closest('#avGroupBtns')
  ) {
    box.style.display = 'none';
  }
});

export async function runAccountView() {
  const tableEl   = document.getElementById('avTable');
  const exportBtn = document.getElementById('avExportBtn');
  if (!tableEl) return;

  if (!ST._avAccount) {
    tableEl.innerHTML = '<div class="empty"><p>Please select an account first</p></div>';
    return;
  }

  const desde = document.getElementById('avDesde')?.value;
  const hasta  = document.getElementById('avHasta')?.value;
  if (!desde || !hasta) return;
  if (desde > hasta) {
    tableEl.innerHTML = '<div class="empty"><p>From date must be before To date</p></div>';
    return;
  }

  tableEl.innerHTML = '<div style="padding:20px;color:var(--text2);">Loading...</div>';
  if (exportBtn) exportBtn.style.display = 'none';
  const box = document.getElementById('avSuggestions');
  if (box) box.style.display = 'none';

  const { code, label } = ST._avAccount;
  const allBanks  = Object.keys(ST.bancos).map(Number).filter(c => c !== 999);
  const usdFactor = (ST.currency === 'USD' && ST.usdRate) ? (1 / ST.usdRate) : 1;

  try {
    const rows = await apiDatos({ tipos: ['b1','r1','c1'], cuentas: [code], periodos: [desde, hasta], bancos: allBanks, select: 'ins_cod,periodo,monto_total' });

    const getVal = (bank, periodo) =>
      rows.filter(r => r.ins_cod === bank && r.periodo === periodo)
          .reduce((s, r) => s + (r.monto_total || 0), 0);

    const allBankData = allBanks.map(c => ({
      code: c, name: bankName(c),
      v1: getVal(c, desde),
      v2: getVal(c, hasta),
    }));
    const anyHasData = allBankData.some(b => b.v1 !== 0 || b.v2 !== 0);

    if (!anyHasData) {
      tableEl.innerHTML = `<div class="empty">
        <div class="empty-icon">📭</div>
        <p>No data found for <strong>${label}</strong> in the selected periods.</p>
        <p style="font-size:11px;color:var(--text3);margin-top:6px;">Try a different account or date range.</p>
      </div>`;
      return;
    }

    const bankData = allBankData.sort((a, b) => Math.abs(b.v2) - Math.abs(a.v2));
    const thStyle  = `padding:10px 14px;font-size:11px;font-weight:700;letter-spacing:0.5px;
      text-transform:uppercase;color:var(--white);border-bottom:2px solid var(--border2);white-space:nowrap;`;
    const mm1 = `01/${desde.slice(4, 6)}/${desde.slice(0, 4)}`;
    const mm2 = `01/${hasta.slice(4,  6)}/${hasta.slice(0,  4)}`;

    let html = `
      <div style="margin-bottom:12px;">
        <span style="font-size:14px;font-weight:600;color:var(--white);">${code} — ${label}</span>
        <span style="font-size:11px;color:var(--text3);margin-left:12px;font-family:var(--mono);">
          ${periodLabel(desde)} → ${periodLabel(hasta)}</span>
      </div>
      <div style="overflow-x:auto;">
      <table class="tbl" id="avResultTable" style="width:100%;">
        <thead><tr style="background:var(--bg4);">
          <th style="${thStyle}text-align:left;">Bank</th>
          <th class="r" style="${thStyle}" data-export="${mm1}">${periodLabel(desde)}</th>
          <th class="r" style="${thStyle}" data-export="${mm2}">${periodLabel(hasta)}</th>
          <th class="r" style="${thStyle}">Δ Value</th>
          <th class="r" style="${thStyle}">Δ %</th>
        </tr></thead>
        <tbody>`;

    bankData.forEach(b => {
      const isBTG      = b.code === 59;
      const dv         = (b.v2 - b.v1) * usdFactor;
      const dp         = b.v1 !== 0 ? ((b.v2 - b.v1) / Math.abs(b.v1) * 100) : null;
      const deltaColor = dv > 0 ? 'var(--green)' : dv < 0 ? 'var(--red)' : 'var(--text3)';
      const rowStyle   = isBTG
        ? 'background:rgba(37,99,235,0.07);border-left:3px solid #2563eb;'
        : `border-left:3px solid transparent;`;
      html += `<tr style="${rowStyle}">
        <td style="font-weight:${isBTG ? '700' : '500'};color:${isBTG ? '#2563eb' : 'var(--text)'};">
          ${isBTG ? '★ ' : ''}${b.name}</td>
        <td class="r">${fmtKPIDecimal(b.v1)}</td>
        <td class="r">${fmtKPIDecimal(b.v2)}</td>
        <td class="r" style="color:${deltaColor};font-weight:600;">
          ${dv >= 0 ? '+' : ''}${fmtKPIDecimal(b.v2 - b.v1)}</td>
        <td class="r" style="color:${deltaColor};font-family:var(--mono);font-weight:600;">
          ${dp !== null ? (dp >= 0 ? '+' : '') + dp.toFixed(1) + '%' : '—'}</td>
      </tr>`;
    });

    const tot1     = bankData.reduce((s, b) => s + b.v1, 0);
    const tot2     = bankData.reduce((s, b) => s + b.v2, 0);
    const totDp    = tot1 !== 0 ? ((tot2 - tot1) / Math.abs(tot1) * 100) : null;
    const totColor = tot2 > tot1 ? 'var(--green)' : tot2 < tot1 ? 'var(--red)' : 'var(--text3)';
    html += `<tr style="background:var(--bg4);border-top:2px solid var(--border2);font-weight:700;border-left:3px solid transparent;">
      <td style="color:var(--white);font-size:11px;text-transform:uppercase;letter-spacing:0.5px;">System Total</td>
      <td class="r" style="color:var(--white);">${fmtKPIDecimal(tot1)}</td>
      <td class="r" style="color:var(--white);">${fmtKPIDecimal(tot2)}</td>
      <td class="r" style="color:${totColor};font-weight:700;">${tot2 >= tot1 ? '+' : ''}${fmtKPIDecimal(tot2 - tot1)}</td>
      <td class="r" style="color:${totColor};font-family:var(--mono);font-weight:700;">
        ${totDp !== null ? (totDp >= 0 ? '+' : '') + totDp.toFixed(1) + '%' : '—'}</td>
    </tr>`;

    html += '</tbody></table></div>';
    tableEl.innerHTML = html;
    if (exportBtn) exportBtn.style.display = 'block';

  } catch (e) {
    tableEl.innerHTML = `<div class="empty"><p>Error: ${e.message}</p></div>`;
  }
}
