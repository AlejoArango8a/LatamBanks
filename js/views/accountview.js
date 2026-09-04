// ============================================================
// ACCOUNT VIEW — cross-bank account comparison
// ============================================================
import { ST, datasetIsoCountry } from '../state.js?v=bmon102';
import { accountViewLevel } from '../coCuentas.js?v=bmon102';
import { bankName, fmtKPIDecimal, toSentenceCase, getTipo, periodLabel } from '../format.js?v=bmon102';
import { apiDatos } from '../api.js?v=bmon102';
import { btgBlue, btgRgba } from '../config.js?v=bmon102';

const _isoCt = () => (datasetIsoCountry() === 'CO' ? 'CO' : 'CL');

// ---- Forma del código de cuenta en cada país ------------------------------
//
// Es lo que decide si el explorador puede armar un árbol o tiene que listar en
// plano, y hay cuatro formas distintas:
//
//   'cl'    numérico de la CMF, la jerarquía vive en los ceros finales
//           (105000000 → 105000100 → 105000101)
//   'co'    CUIF de seis dígitos, misma idea con otro largo
//   'dots'  códigos del BCU separados por puntos (1 → 1.1 → 1.1.1)
//   'flat'  sin jerarquía: slugs del regulador (ASSET, CAPITAL_SOCIAL) o
//           identificadores opacos como los Conta de IF.data
//
// Antes solo se distinguía Brasil, y todo lo demás se medía con la regla
// chilena. En Uruguay eso daba cero cuentas de primer nivel, así que el
// desplegable salía vacío hasta que uno escribía algo y caía en la búsqueda
// por texto, que no mira niveles. Lo mismo pasaba en Perú, Estados Unidos,
// Argentina, México y Panamá.
const CODE_SHAPE = Object.freeze({
  CL: 'cl',
  CO: 'co',
  UY: 'dots',
  BR: 'flat',
  PE: 'flat',
  US: 'flat',
  AR: 'flat',
  MX: 'flat',
  PA: 'flat',
});

/** Ante un país desconocido, plano: peor una lista sin jerarquía que vacía. */
function codeShape() {
  return CODE_SHAPE[datasetIsoCountry()] || 'flat';
}

const DOT_MAX_LEVEL = 3;

export function avGetLevel(c) {
  const shape = codeShape();
  if (shape === 'flat') return 1;
  if (shape === 'dots') {
    // Un segmento por nivel. Los códigos sin punto (A1_…, S_…) quedan en 1, o
    // sea raíces sueltas de la lista, que es lo que son.
    return Math.min(String(c).split('.').length, DOT_MAX_LEVEL);
  }
  return accountViewLevel(String(c), _isoCt());
}

/** ¿`cand` cuelga de `parent`? El nivel ya se filtró afuera. */
export function avIsChildOf(parent, cand) {
  const shape = codeShape();
  // Sin jerarquía nadie cuelga de nadie: comparar prefijos haría que
  // 'DEPOSITOS' pasara por hijo de 'DEP'.
  if (shape === 'flat') return false;
  if (shape === 'dots') {
    // Por ruta y no por prefijo: si no, '19.1' se colgaría de '1'.
    return cand.startsWith(`${parent}.`);
  }
  if (shape === 'co') {
    const pp = parent.replace(/0+$/, '');
    const cp = cand.replace(/0+$/, '');
    return cp.startsWith(pp) && cp.length > pp.length;
  }
  const trailingZeros = parent.match(/0+$/)?.[0].length || 0;
  return cand.startsWith(parent.slice(0, parent.length - trailingZeros));
}

// ---- Grupos por país ------------------------------------------------------
//
// Un grupo es el primer carácter del código, así que solo sirve donde ese
// carácter significa algo. Los países con slugs no tienen grupos y van a lista
// única.
const DEFAULT_GROUPS = Object.freeze([
  ['1', 'Assets'], ['2', 'Liabilities'], ['3', 'Equity'],
  ['4', 'Income Statement'], ['5', 'IS Summary'],
  ['6', 'Off-balance'], ['8', 'Supplementary'],
]);

const ACCOUNT_GROUPS = Object.freeze({
  CL: DEFAULT_GROUPS,
  CO: DEFAULT_GROUPS,
  BR: Object.freeze([
    ['1', 'Cosif new (≥2025)'], ['7', 'Cosif legacy (≤2024)'], ['8', 'Other'],
  ]),
  // El BCU numera activo, pasivo y patrimonio; el estado de resultados va
  // repartido entre el 4 y el 25, así que no se puede resumir en un botón y
  // queda dentro de "All accounts".
  UY: Object.freeze([['1', 'Assets'], ['2', 'Liabilities'], ['3', 'Equity']]),
});

function accountGroups() {
  return ACCOUNT_GROUPS[datasetIsoCountry()] || [];
}

/** Con qué grupo abre la pestaña: el primero, o todo si el país no tiene. */
function defaultGroup() {
  return accountGroups().length ? accountGroups()[0][0] : '';
}

/** Todas las cuentas del grupo activo, ya ordenadas. */
function accountsInGroup(digit) {
  return Object.keys(ST.planCuentas)
    .filter((c) => (!digit || c[0] === digit) && avGetLevel(c) > 0)
    .sort();
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
  syncAvGroupButtonsForCountry();
  if (!ST._avGroup) avSelectGroup(defaultGroup());
}

const AVGRP_STYLE = `padding:8px 16px;border-radius:5px;border:1px solid var(--border);
  background:var(--bg3);color:var(--text);cursor:pointer;font-family:var(--sans);
  font-size:13px;transition:all 0.15s;`;
const AVGRP_ALL_STYLE = AVGRP_STYLE.replace('color:var(--text)', 'color:var(--text2)')
  .replace('font-size:13px', 'font-size:12px');

/** Dibuja la barra de grupos del país activo. */
function syncAvGroupButtonsForCountry() {
  const wrap = document.getElementById('avGroupBtns');
  if (!wrap) return;
  const iso = datasetIsoCountry();
  // Repintar en cada visita haría perder el resaltado del grupo elegido.
  if (wrap.dataset.groupIso === iso) return;
  wrap.dataset.groupIso = iso;

  const groups = accountGroups();
  const btn = (digit, label, style) =>
    `<button class="avgrp" onclick="avSelectGroup('${digit}')" style="${style}">${label}</button>`;
  // Brasil numera por plan de cuentas, no por rubro, y sus códigos son
  // identificadores opacos: ahí el botón dice "todas las cuentas".
  const allLabel = iso === 'CL' || iso === 'CO' ? 'All groups' : 'All accounts';
  const suffix = iso === 'BR' ? '…' : '';

  wrap.innerHTML = [
    ...groups.map(([d, label]) => btn(d, `${d}${suffix} — ${label}`, AVGRP_STYLE)),
    btn('', allLabel, AVGRP_ALL_STYLE),
  ].join('');
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

  // Sin nada escrito se muestran las cuentas del grupo activo, y todas cuando
  // el país no tiene grupos: la lista disponible tiene que estar a la vista sin
  // que haya que adivinar una letra para que aparezca.
  const digit      = ST._avGroup;
  const allInGroup = accountsInGroup(digit);
  const l1 = allInGroup.filter(c => avGetLevel(c) === 1);
  if (!allInGroup.length) {
    box.style.display = 'block';
    box.innerHTML = `<div onclick="event.stopPropagation()"
      style="padding:10px 14px;font-size:11px;color:var(--text3);">
      No accounts in this group for ${datasetIsoCountry()}.</div>`;
    return;
  }
  box.style.display = 'block';
  avRenderTree(box, digit, l1, allInGroup);
}

export function avRenderTree(box, digit, l1, allInGroup) {
  const total = allInGroup.length;
  const hasTree = codeShape() !== 'flat';
  let html = `<div style="padding:5px 14px;font-size:10px;color:var(--text3);
    font-family:var(--mono);border-bottom:1px solid var(--border);">
    ${total} ACCOUNTS${digit ? ` IN GROUP ${digit}` : ''}${hasTree ? ' — click ▸ to expand' : ''}</div>`;

  const renderNode = (c, indent) => {
    const level        = avGetLevel(c);
    const label        = toSentenceCase(ST.planCuentas[c] || c);
    const isExpanded   = ST._avTreeExpanded[c];
    const children     = level < 3
      ? allInGroup.filter(ch => ch !== c
          && avGetLevel(ch) === level + 1
          && avIsChildOf(c, ch))
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
  const allInGroup = accountsInGroup(digit);
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
  const box = document.getElementById('avSuggestions');
  if (box && box.style.display !== 'none') {
    const digit      = ST._avGroup;
    const allInGroup = accountsInGroup(digit);
    const l1 = allInGroup.filter(c => avGetLevel(c) === 1);
    avRenderTree(box, digit, l1, allInGroup);
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
    // q1 y x1 van incluidos porque ahí viven las cuentas de ratio y de capital
    // regulatorio: el Anexo 4 del BCU y la Basilea III de la CMF. Sin ellos, esas
    // cuentas se podían elegir en la lista y siempre respondían "sin datos".
    const rows = await apiDatos({ tipos: ['b1','r1','c1','q1','x1'], cuentas: [code], periodos: [desde, hasta], bancos: allBanks, select: 'ins_cod,periodo,monto_total' });

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

    const BTG_BANK = datasetIsoCountry() === 'CO' ? 66 : datasetIsoCountry() === 'BR' ? 1000080336 : 59;
    bankData.forEach(b => {
      const isBTG      = Number(b.code) === BTG_BANK;
      const dv         = (b.v2 - b.v1) * usdFactor;
      const dp         = b.v1 !== 0 ? ((b.v2 - b.v1) / Math.abs(b.v1) * 100) : null;
      const deltaColor = dv > 0 ? 'var(--green)' : dv < 0 ? 'var(--red)' : 'var(--text3)';
      const rowStyle   = isBTG
        ? `background:${btgRgba(0.07)};border-left:3px solid ${btgBlue()};`
        : `border-left:3px solid transparent;`;
      html += `<tr style="${rowStyle}">
        <td style="font-weight:${isBTG ? '700' : '500'};color:${isBTG ? btgBlue() : 'var(--text)'};">
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
