// ============================================================
// CREDIT RATINGS MAINTAINER — Config › Credit ratings
//
// Tabla de bancos × calificadoras por país. Chile trae seis columnas
// (Fitch Chile / Feller / Humphreys locales y Fitch / Moody's / S&P
// internacionales); el resto de los países, dos genéricas donde la celda
// declara qué calificadora emitió la nota.
//
// Se edita sobre un borrador local y se publica exportando el JSON a
// data/bank_ratings.json — el mismo circuito curado y revisable en git que ya
// usa el resto de los datos de referencia de la plataforma.
// ============================================================
import { ST, datasetIsoCountry } from '../state.js?v=bmon100';
import { API_BASE, btgCodeForCountry } from '../config.js?v=bmon100';
import { liveCountries } from '../paises.js?v=bmon100';
import { bankName, escapeHtml, escapeAttr } from '../format.js?v=bmon100';
import { fetchWithTimeout } from '../api.js?v=bmon100';
import {
  agenciesFor, SCOPE_LABEL, RATING_SCALES, OUTLOOKS, RATING_STATUS, normalizeOutlook,
  publishDraft, getWriteKey, setWriteKey,
  loadPublishedRatings, mergedBanks, setDraftCell, setDraftBankNote,
  clearDraft, replaceDraft, draftCount, isDraftCell, exportPayload,
  cellStatus, ratingTone, isStale, coverage,
} from '../ratings.js?v=bmon100';

const FLAG = {
  CL: '🇨🇱', CO: '🇨🇴', BR: '🇧🇷', PE: '🇵🇪', UY: '🇺🇾',
  US: '🇺🇸', AR: '🇦🇷', MX: '🇲🇽', PA: '🇵🇦', PY: '🇵🇾', LU: '🇱🇺',
};

/** Calificadoras habituales en la región, para las columnas genéricas. */
const AGENCY_SUGGESTIONS = [
  'Fitch Ratings', "Moody's", 'S&P Global', 'Feller Rate', 'Humphreys', 'ICR',
  'BRC Ratings', 'Apoyo & Asociados', 'Class & Asociados', 'Pacific Credit Rating',
  'Equilibrium', 'FIX SCR', 'HR Ratings', 'Verum', 'Austin Rating', 'SR Rating',
];

const FILTERS = [
  { key: 'all',        label: 'All' },
  { key: 'incomplete', label: 'Below minimum coverage' },
  { key: 'unverified', label: 'To verify' },
  { key: 'pending',    label: 'Not reviewed' },
];

/**
 * Brasil publica más de 1.300 entidades y Estados Unidos 300: pintarlas todas
 * de entrada vuelve la tabla inmanejable, así que se muestran las mayores por
 * patrimonio y el resto se alcanza buscando o con «ver todos». La franquicia
 * BTG se fija aparte, porque su tamaño no siempre la mete en el corte.
 */
const VISIBLE_CAP = 50;

const state = {
  iso: null,
  seed: null,
  loading: false,
  error: null,
  filter: 'all',
  search: '',
  showAll: false,
  publishing: false,
  banksByIso: {},   // ISO → [{ code, name, equity }]
  editing: null,
};

// ============================================================
// Datos
// ============================================================

/** Países del mantenedor: los que están en producción, en el orden del registro. */
function countryList() {
  return liveCountries().map((p) => ({ iso: p.iso, key: p.key, name: p.name }));
}

function countryKeyForIso(iso) {
  return (countryList().find((c) => c.iso === iso) || {}).key || null;
}

/**
 * Nombres con la misma normalización que el resto de la plataforma.
 *
 * `bankName()` decide según `ST.country` y `ST.bancos`: de ahí sale que Brasil
 * pierda el sufijo «- PRUDENCIAL», que Estados Unidos pierda «NATIONAL
 * ASSOCIATION» y que las siglas queden bien escritas. Para un país distinto al
 * activo se intercambian ambos durante el mapeo y se restauran al salir. Es
 * seguro porque el bloque es síncrono: nada más puede leer el estado mientras
 * dura, y un mismo código es otro banco en otra jurisdicción, así que llamar a
 * `bankName()` con el país equivocado daría el nombre equivocado.
 */
function resolveNames(iso, instituciones) {
  const key = countryKeyForIso(iso);
  const prevCountry = ST.country;
  const prevBancos = ST.bancos;
  try {
    if (key) {
      ST.country = key;
      ST.bancos = Object.fromEntries(
        instituciones.map((r) => [Number(r.codigo), r.razon_social]),
      );
    }
    return new Map(instituciones.map((r) => {
      const code = Number(r.codigo);
      return [code, bankName(code) || `Bank ${code}`];
    }));
  } finally {
    ST.country = prevCountry;
    ST.bancos = prevBancos;
  }
}

/** Instituciones del país, ordenadas por patrimonio de mayor a menor. */
async function loadBanks(iso) {
  if (state.banksByIso[iso]) return state.banksByIso[iso];

  const r = await fetchWithTimeout(`${API_BASE}/api/bootstrap?country=${encodeURIComponent(iso)}`, {}, 30000);
  if (!r.ok) throw new Error(`bootstrap ${iso}: status ${r.status}`);
  const j = await r.json();
  if (!j.ok) throw new Error(j.error || `bootstrap ${iso} falló`);

  const equity = {};
  (j.patrimonioRows || []).forEach((row) => {
    const c = Number(row.ins_cod);
    equity[c] = (equity[c] || 0) + Number(row.monto_total || 0);
  });

  const names = resolveNames(iso, j.instituciones || []);
  const banks = [...names.keys()]
    .filter((code) => code !== 999)
    .map((code) => ({ code, name: names.get(code), equity: equity[code] || 0 }))
    .sort((a, b) => (b.equity - a.equity) || (a.code - b.code));

  state.banksByIso[iso] = banks;
  return banks;
}

async function ensureLoaded(iso) {
  state.loading = true;
  state.error = null;
  render();
  try {
    const [seed] = await Promise.all([loadPublishedRatings(), loadBanks(iso)]);
    state.seed = seed;
  } catch (e) {
    state.error = e.message || String(e);
  } finally {
    state.loading = false;
    render();
  }
}

// ============================================================
// Entrada
// ============================================================

export function paintRatingsAdmin() {
  if (!document.getElementById('ratingsAdminRoot')) return;
  if (!state.iso) state.iso = datasetIsoCountry();
  if (state.seed && state.banksByIso[state.iso]) { render(); return; }
  ensureLoaded(state.iso);
}

// ============================================================
// Render
// ============================================================

function render() {
  const root = document.getElementById('ratingsAdminRoot');
  if (!root) return;

  const iso = state.iso;
  const drafts = draftCount(iso);
  // Repintar reemplaza el buscador entero, así que hay que devolverle el foco
  // para poder seguir escribiendo.
  const searchHadFocus = document.activeElement?.id === 'raSearch';

  root.innerHTML = `
    ${heroHtml(drafts)}
    ${countryBarHtml()}
    ${bodyHtml()}
    <ul class="fa-notes">
      <li><strong>Minimum coverage</strong>: every bank should carry at least one local and one international rating. The percentage is measured against all institutions in the country, not just the visible ones.</li>
      <li><strong>Verified</strong> means checked against the rating agency’s own publication; <strong>unverified</strong> is inherited data still to be confirmed. <strong>Not rated</strong> records that the agency does not cover the bank, which is different from not having reviewed it.</li>
      <li>Edits stay as a draft in this browser. Publishing means exporting the JSON into <span style="font-family:var(--mono);">data/bank_ratings.json</span>, so every change stays reviewable in the repository.</li>
    </ul>
  `;

  if (searchHadFocus) {
    const el = document.getElementById('raSearch');
    if (el) {
      el.focus();
      el.setSelectionRange(el.value.length, el.value.length);
    }
  }
}

function heroHtml(drafts) {
  const updated = state.seed?.updated
    ? `Published ${escapeHtml(state.seed.updated)}`
    : 'Not published';
  const badge = drafts
    ? `<span class="ra-draft-badge">${drafts} unpublished change${drafts === 1 ? '' : 's'}</span>`
    : '';
  return `
    <div class="fa-hero ra-hero">
      <div>
        <div class="fa-eyebrow">Configuration · Data maintenance</div>
        <div class="fa-title">Credit ratings</div>
        <div class="fa-sub">Credit rating maintainer, by bank and rating agency. It records the rating, the outlook, the date, the source and — above all — whether the figure is confirmed or still has to be checked.</div>
      </div>
      <div class="ra-hero-meta">
        <div class="ra-hero-updated">${updated}</div>
        ${badge}
      </div>
    </div>`;
}

function countryBarHtml() {
  const pills = countryList().map((c) => `
    <button type="button" class="rcbtn ${c.iso === state.iso ? 'active' : ''}"
      onclick="ratingsAdmin.selectCountry('${c.iso}')">
      ${FLAG[c.iso] || '🏳'} ${escapeHtml(c.name)}
    </button>`).join('');
  return `<div class="ra-country-bar">${pills}</div>`;
}

function bodyHtml() {
  if (state.error) {
    return `<div class="panel"><div class="panel-body">
      <div class="fa-empty">
        <div class="fa-empty-title">Could not load the banks</div>
        <div class="fa-empty-sub">${escapeHtml(state.error)}</div>
        <button type="button" class="rcbtn" onclick="ratingsAdmin.reload()">Retry</button>
      </div></div></div>`;
  }
  if (state.loading || !state.seed) {
    return `<div class="panel"><div class="panel-body">
      <div class="fa-empty"><div class="fa-empty-sub">Loading ratings…</div></div>
    </div></div>`;
  }

  const iso = state.iso;
  const agencies = agenciesFor(iso);
  const banks = state.banksByIso[iso] || [];
  const data = mergedBanks(state.seed, iso);
  const cov = coverage(data, agencies, banks.map((b) => b.code));

  if (!banks.length) {
    return `<div class="panel"><div class="panel-body">
      <div class="fa-empty">
        <div class="fa-empty-title">No institutions loaded</div>
        <div class="fa-empty-sub">This country has no banks in the database yet.</div>
      </div></div></div>`;
  }

  const q = state.search.trim().toLowerCase();
  const matched = q
    ? banks.filter((b) => b.name.toLowerCase().includes(q) || String(b.code).includes(q))
    : banks;
  const capped = !state.showAll && !q && matched.length > VISIBLE_CAP;
  let shown = capped ? matched.slice(0, VISIBLE_CAP) : matched;

  // La franquicia BTG es la razón de ser del mantenedor, así que entra siempre,
  // aunque su patrimonio la deje fuera del corte. En Estados Unidos queda de
  // última entre 301 instituciones: sin esto no aparecería nunca.
  const btgCode = btgCodeForCountry(iso);
  let pinnedCode = null;
  if (capped && btgCode != null && !shown.some((b) => b.code === btgCode)) {
    const btg = matched.find((b) => b.code === btgCode);
    if (btg) {
      // Va al final y el orden por patrimonio se mantiene: si quedó fuera del
      // corte es porque tiene menos que cualquiera de los que sí entraron.
      shown = [...shown, btg];
      pinnedCode = btg.code;
    }
  }

  const scope = q
    ? `${matched.length} of ${banks.length} banks match “${escapeHtml(state.search.trim())}”`
    : capped
      ? `Showing the ${VISIBLE_CAP} largest by equity of ${banks.length} banks${pinnedCode ? ', plus BTG' : ''}`
      : `${banks.length} banks sorted by equity`;

  return `
    ${kpisHtml(cov)}
    <div class="panel">
      <div class="panel-head">
        <div>
          <div class="panel-title">${escapeHtml(paisNameFor(iso))} · ${agencies.length} rating agencies</div>
          <div class="panel-sub">${scope} · click a cell to edit it</div>
        </div>
        <div class="ra-actions">
          <input id="raSearch" class="ra-search" type="search" placeholder="Search bank…"
            value="${escapeAttr(state.search)}" oninput="ratingsAdmin.setSearch(this.value)">
          <div class="ra-filter-group" role="group" aria-label="Filter banks">
            ${FILTERS.map((f) => `<button type="button" class="ra-filter ${state.filter === f.key ? 'active' : ''}"
              onclick="ratingsAdmin.setFilter('${f.key}')">${f.label}</button>`).join('')}
          </div>
          ${draftCount(iso) ? `<button type="button" class="rcbtn ra-publish" onclick="ratingsAdmin.publish()"
            ${state.publishing ? 'disabled' : ''}>${state.publishing ? 'Publishing…' : `Publish ${draftCount(iso)}`}</button>` : ''}
          <button type="button" class="rcbtn ra-export" onclick="ratingsAdmin.exportJson()">Export JSON</button>
          <button type="button" class="rcbtn" onclick="ratingsAdmin.importJson()">Import</button>
          ${draftCount(iso) ? `<button type="button" class="rcbtn ra-discard" onclick="ratingsAdmin.discard()">Discard draft</button>` : ''}
        </div>
      </div>
      <div class="panel-body ra-table-wrap">${tableHtml(iso, agencies, shown, data, pinnedCode)}</div>
      ${capped ? `<div class="ra-more">
        <button type="button" class="rcbtn" onclick="ratingsAdmin.showAll()">Show all ${banks.length} banks</button>
      </div>` : ''}
    </div>`;
}

function paisNameFor(iso) {
  const c = countryList().find((x) => x.iso === iso);
  return c ? c.name : iso;
}

function kpisHtml(cov) {
  const pct = cov.banks ? Math.round((cov.complete / cov.banks) * 100) : 0;
  const tiles = [
    { label: 'Banks', value: cov.banks, sub: 'in the maintainer', tone: '' },
    { label: 'Minimum coverage', value: `${pct}%`, sub: `${cov.complete} with local + international`, tone: 'ra-tone-accent' },
    { label: 'Verified', value: cov.verified, sub: 'checked against the source', tone: 'ra-tone-ok' },
    { label: 'To verify', value: cov.unverified, sub: 'loaded but not checked', tone: 'ra-tone-warn' },
    { label: 'Not reviewed', value: cov.pending, sub: `of ${cov.cells} cells`, tone: 'ra-tone-muted' },
    { label: 'Not rated', value: cov.not_rated, sub: 'confirmed as not covered', tone: 'ra-tone-muted' },
  ];
  return `<div class="ra-kpi-grid">${tiles.map((t) => `
    <div class="kpi ${t.tone}">
      <div class="kpi-label">${t.label}</div>
      <div class="kpi-val">${t.value}</div>
      <div class="kpi-sub">${t.sub}</div>
    </div>`).join('')}</div>`;
}

function rowPassesFilter(cells, agencies) {
  if (state.filter === 'all') return true;
  const st = agencies.map((a) => cellStatus(cells[a.key]));
  if (state.filter === 'unverified') return st.includes('unverified');
  if (state.filter === 'pending') return st.includes('pending');
  // incomplete: le falta local o internacional con nota cargada
  const has = (scope) => agencies.some((a, i) =>
    a.scope === scope && (st[i] === 'verified' || st[i] === 'unverified'));
  return !(has('local') && has('global'));
}

function tableHtml(iso, agencies, banks, data, pinnedCode = null) {
  const locals = agencies.filter((a) => a.scope === 'local');
  const globals = agencies.filter((a) => a.scope === 'global');
  const firstGlobal = globals[0]?.key;

  const head = `
    <thead>
      <tr>
        <th rowspan="2" class="ra-col-bank">Bank</th>
        <th colspan="${locals.length}" class="ra-group">${SCOPE_LABEL.local}</th>
        <th colspan="${globals.length}" class="ra-group ra-group-split">${SCOPE_LABEL.global}</th>
        <th rowspan="2" class="ra-col-cov"
          title="Minimum coverage: the first dot marks a local rating, the second an international one">Min.</th>
      </tr>
      <tr>
        ${agencies.map((a) => `<th class="ra-col-agency ${a.key === firstGlobal ? 'ra-split' : ''}"
          title="${escapeAttr(a.label)}">${escapeHtml(a.short)}</th>`).join('')}
      </tr>
    </thead>`;

  const rows = banks.map((b) => {
    const bank = data[b.code] || {};
    const cells = bank.cells || {};
    if (!rowPassesFilter(cells, agencies)) return '';

    const hasLocal = locals.some((a) => ['verified', 'unverified'].includes(cellStatus(cells[a.key])));
    const hasGlobal = globals.some((a) => ['verified', 'unverified'].includes(cellStatus(cells[a.key])));
    const covTip = hasLocal && hasGlobal
      ? 'Meets minimum coverage: has both a local and an international rating'
      : `Missing the ${!hasLocal && !hasGlobal ? 'local and international ratings' : !hasLocal ? 'local rating' : 'international rating'}`;
    const covMark = `<span class="ra-pips" title="${escapeAttr(covTip)}">
      <span class="ra-pip ${hasLocal ? 'on' : ''}"></span>
      <span class="ra-pip ${hasGlobal ? 'on' : ''}"></span>
    </span>`;

    const note = bank.note
      ? `<div class="ra-bank-note" title="${escapeAttr(bank.note)}">${escapeHtml(bank.note)}</div>`
      : '';

    return `<tr>
      <td class="ra-col-bank">
        <button type="button" class="ra-bank-btn" onclick="ratingsAdmin.editNote(${b.code})"
          title="Edit this bank’s note">${escapeHtml(b.name)}</button>
        <span class="ra-bank-code">${b.code}</span>
        ${b.code === pinnedCode ? `<span class="ra-pin"
          title="Always shown: BTG franchise, outside the top ${VISIBLE_CAP} by equity">BTG</span>` : ''}
        ${note}
      </td>
      ${agencies.map((a) => cellHtml(iso, b.code, a, cells[a.key], a.key === firstGlobal)).join('')}
      <td class="ra-col-cov">${covMark}</td>
    </tr>`;
  }).join('');

  const visible = rows.trim();
  if (!visible) {
    return `<div class="fa-empty">
      <div class="fa-empty-title">Nothing to review</div>
      <div class="fa-empty-sub">No bank matches the “${FILTERS.find((f) => f.key === state.filter).label}” filter.</div>
    </div>`;
  }
  return `<table class="fa-table ra-table">${head}<tbody>${rows}</tbody></table>`;
}

function cellHtml(iso, code, agency, cell, split) {
  const st = cellStatus(cell);
  const meta = RATING_STATUS[st];
  const draft = isDraftCell(iso, code, agency.key);
  const stale = cell && isStale(cell.as_of);

  // Una celda pendiente no lleva punto de estado: sumaría ruido en una tabla
  // que arranca mayormente vacía. Solo queda el "+" que invita a completarla.
  let inner;
  if (st === 'pending') {
    inner = `<span class="ra-add">+</span>`;
  } else if (st === 'not_rated') {
    inner = `<span class="ra-dot" style="background:${meta.color};"></span><span class="ra-na">not rated</span>`;
  } else {
    const sub = agency.open && cell.agency ? escapeHtml(cell.agency) : escapeHtml(cell.outlook || '');
    inner = `
      <span class="ra-dot" style="background:${meta.color};"></span>
      <span class="ra-rating" style="color:${ratingTone(cell.rating)};">${escapeHtml(cell.rating)}</span>
      ${sub ? `<span class="ra-cell-sub">${sub}</span>` : ''}`;
  }

  const tip = [
    agency.label,
    cell?.agency && agency.open ? `Agency: ${cell.agency}` : '',
    cell?.rating ? `Rating: ${cell.rating}` : '',
    cell?.outlook ? `Outlook: ${normalizeOutlook(cell.outlook)}` : '',
    cell?.as_of ? `Date: ${cell.as_of}` : '',
    `Status: ${meta.label} — ${meta.hint}`,
    cell?.note || '',
  ].filter(Boolean).join('\n');

  return `<td class="ra-cell ra-st-${st} ${split ? 'ra-split' : ''} ${draft ? 'ra-draft' : ''}"
    title="${escapeAttr(tip)}"
    onclick="ratingsAdmin.openCell(${code}, '${agency.key}')">
    ${inner}
    ${stale ? '<span class="ra-stale" title="More than 18 months without review">⏳</span>' : ''}
  </td>`;
}

// ============================================================
// Editor de celda
// ============================================================

function dialogEl() {
  let el = document.getElementById('raOverlay');
  if (el) return el;
  el = document.createElement('div');
  el.id = 'raOverlay';
  el.className = 'ra-overlay';
  el.addEventListener('click', (ev) => { if (ev.target === el) closeEditor(); });
  document.body.appendChild(el);
  document.addEventListener('keydown', (ev) => {
    if (ev.key === 'Escape' && el.style.display === 'flex') closeEditor();
  });
  return el;
}

function openCell(code, agencyKey) {
  const iso = state.iso;
  const agency = agenciesFor(iso).find((a) => a.key === agencyKey);
  if (!agency) return;

  const bank = (state.banksByIso[iso] || []).find((b) => b.code === code);
  const cell = (mergedBanks(state.seed, iso)[code]?.cells || {})[agencyKey] || {};
  state.editing = { code, agencyKey };

  const scale = RATING_SCALES[agency.scale] || RATING_SCALES.local;
  const status = cellStatus(cell) === 'pending' ? 'unverified' : cellStatus(cell);
  const outlook = normalizeOutlook(cell.outlook);

  const el = dialogEl();
  el.innerHTML = `
    <div class="ra-dialog" role="dialog" aria-modal="true">
      <div class="ra-dialog-head">
        <div>
          <div class="ra-dialog-eyebrow">${escapeHtml(SCOPE_LABEL[agency.scope === 'local' ? 'local' : 'global'])}</div>
          <div class="ra-dialog-title">${escapeHtml(bank?.name || `Bank ${code}`)}</div>
          <div class="ra-dialog-sub">${escapeHtml(agency.label)}${agency.open ? ' · state which agency issued the rating' : ''}</div>
        </div>
        <button type="button" class="custom-kpi-close" onclick="ratingsAdmin.close()">×</button>
      </div>

      <div class="ra-dialog-body">
        ${agency.open ? `
        <label class="ra-field">
          <span class="ra-field-lbl">Rating agency</span>
          <input id="raAgency" list="raAgencyList" class="ra-input" autocomplete="off"
            placeholder="e.g. Fitch Ratings" value="${escapeAttr(cell.agency || '')}">
          <datalist id="raAgencyList">${AGENCY_SUGGESTIONS.map((a) => `<option value="${escapeAttr(a)}">`).join('')}</datalist>
        </label>` : ''}

        <div class="ra-field-row">
          <label class="ra-field">
            <span class="ra-field-lbl">Rating</span>
            <input id="raRating" list="raScale" class="ra-input ra-input-mono" autocomplete="off"
              placeholder="—" value="${escapeAttr(cell.rating || '')}">
            <datalist id="raScale">${scale.map((r) => `<option value="${r}">`).join('')}</datalist>
          </label>
          <label class="ra-field">
            <span class="ra-field-lbl">Outlook</span>
            <select id="raOutlook" class="ra-input">
              <option value="">—</option>
              ${OUTLOOKS.map((o) => `<option value="${o}" ${o === outlook ? 'selected' : ''}>${o}</option>`).join('')}
            </select>
          </label>
          <label class="ra-field">
            <span class="ra-field-lbl">Rating date</span>
            <input id="raAsOf" type="month" class="ra-input" value="${escapeAttr(String(cell.as_of || '').slice(0, 7))}">
          </label>
        </div>

        <div class="ra-field">
          <span class="ra-field-lbl">Reliability</span>
          <div class="ra-status-seg" id="raStatus" data-value="${status}">
            ${['verified', 'unverified', 'not_rated'].map((k) => `
              <button type="button" class="ra-status-opt ${k === status ? 'active' : ''}" data-k="${k}"
                title="${escapeAttr(RATING_STATUS[k].hint)}"
                onclick="ratingsAdmin.pickStatus('${k}')">${RATING_STATUS[k].label}</button>`).join('')}
          </div>
        </div>

        <label class="ra-field">
          <span class="ra-field-lbl">Source</span>
          <input id="raSource" class="ra-input" placeholder="URL of the agency’s release"
            value="${escapeAttr(cell.source || '')}">
        </label>

        <label class="ra-field">
          <span class="ra-field-lbl">Internal note</span>
          <textarea id="raNote" class="ra-input ra-textarea" rows="3"
            placeholder="What was reviewed, what is still to be checked…">${escapeHtml(cell.note || '')}</textarea>
        </label>
      </div>

      <div class="ra-dialog-foot">
        <button type="button" class="rcbtn ra-discard" onclick="ratingsAdmin.clearCell()">Clear cell</button>
        <div class="ra-foot-right">
          <button type="button" class="rcbtn" onclick="ratingsAdmin.close()">Cancel</button>
          <button type="button" class="rcbtn active" onclick="ratingsAdmin.saveCell()">Save</button>
        </div>
      </div>
    </div>`;
  el.style.display = 'flex';
  setTimeout(() => document.getElementById('raRating')?.focus(), 30);
}

function pickStatus(key) {
  const seg = document.getElementById('raStatus');
  if (!seg) return;
  seg.dataset.value = key;
  seg.querySelectorAll('.ra-status-opt').forEach((b) => b.classList.toggle('active', b.dataset.k === key));
}

function saveCell() {
  const { code, agencyKey } = state.editing || {};
  if (code == null) return;
  const agency = agenciesFor(state.iso).find((a) => a.key === agencyKey);
  const val = (id) => document.getElementById(id)?.value.trim() || '';
  const status = document.getElementById('raStatus')?.dataset.value || 'unverified';
  const rating = val('raRating');

  // Sin nota y sin marca de "no calificado" no hay dato que guardar: la celda
  // vuelve a quedar pendiente en vez de dejar una fila vacía con metadatos.
  if (!rating && status !== 'not_rated') {
    clearCell();
    return;
  }

  const cell = { rating: status === 'not_rated' ? null : rating, status };
  if (agency?.open && val('raAgency')) cell.agency = val('raAgency');
  if (val('raOutlook')) cell.outlook = val('raOutlook');
  if (val('raAsOf')) cell.as_of = val('raAsOf');
  if (val('raSource')) cell.source = val('raSource');
  if (val('raNote')) cell.note = val('raNote');

  setDraftCell(state.iso, code, agencyKey, cell);
  closeEditor();
  render();
}

function clearCell() {
  const { code, agencyKey } = state.editing || {};
  if (code == null) return;
  setDraftCell(state.iso, code, agencyKey, null);
  closeEditor();
  render();
}

function editNote(code) {
  const iso = state.iso;
  const bank = (state.banksByIso[iso] || []).find((b) => b.code === code);
  const current = mergedBanks(state.seed, iso)[code]?.note || '';
  const next = window.prompt(
    `Note for ${bank?.name || `Bank ${code}`}\n\nContext on this bank’s rating agency coverage.`,
    current,
  );
  if (next === null) return;
  setDraftBankNote(iso, code, next.trim());
  render();
}

function closeEditor() {
  const el = document.getElementById('raOverlay');
  if (el) el.style.display = 'none';
  state.editing = null;
}

// ============================================================
// Publicación
// ============================================================

function exportJson() {
  const payload = exportPayload(state.seed);
  const text = JSON.stringify(payload, null, 2) + '\n';
  const blob = new Blob([text], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'bank_ratings.json';
  a.click();
  URL.revokeObjectURL(a.href);
  navigator.clipboard?.writeText(text).catch(() => {});
}

function importJson() {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = 'application/json,.json';
  input.onchange = async () => {
    const file = input.files?.[0];
    if (!file) return;
    try {
      const data = JSON.parse(await file.text());
      if (!data || typeof data !== 'object' || !data.countries) {
        throw new Error('the file has no "countries" block');
      }
      // Entra como borrador: lo publicado sigue siendo el archivo del repo.
      const draft = {};
      Object.entries(data.countries).forEach(([iso, block]) => {
        draft[iso] = block.banks || {};
      });
      replaceDraft(draft);
      render();
    } catch (e) {
      window.alert(`Could not read the file: ${e.message}`);
    }
  };
  input.click();
}

function discard() {
  if (!window.confirm(`This discards the unpublished changes for ${paisNameFor(state.iso)}. Continue?`)) return;
  clearDraft(state.iso);
  render();
}

/**
 * Publica el borrador para que lo vea cualquier visitante. Pide la clave de
 * escritura si todavía no está en la sesión; si el servidor la rechaza se
 * olvida, para no reintentar con una clave mala.
 */
async function publish() {
  const iso = state.iso;
  const n = draftCount(iso);
  if (!n) return;

  let key = getWriteKey();
  if (!key) {
    key = window.prompt(
      `Publish ${n} change${n === 1 ? '' : 's'} for ${paisNameFor(iso)}.\n\n`
      + 'Enter the master write key. Everyone visiting the platform will see these ratings.',
      '',
    );
    if (!key) return;
    key = key.trim();
    if (!key) return;
  }

  state.publishing = true;
  render();
  try {
    const out = await publishDraft(iso, key);
    setWriteKey(key);
    state.seed = await loadPublishedRatings(true);
    window.alert(
      `Published for ${paisNameFor(iso)}.\n\n`
      + `${out.cellsWritten} rating${out.cellsWritten === 1 ? '' : 's'} saved`
      + `${out.cellsCleared ? `, ${out.cellsCleared} cleared` : ''}`
      + `${out.notesWritten ? `, ${out.notesWritten} note${out.notesWritten === 1 ? '' : 's'}` : ''}.`,
    );
  } catch (e) {
    if (/inválida|invalid/i.test(e.message)) setWriteKey('');
    window.alert(`Could not publish: ${e.message}\n\nThe draft is still here, nothing was lost.`);
  } finally {
    state.publishing = false;
    render();
  }
}

// ============================================================
// API pública
// ============================================================

export const ratingsAdmin = {
  selectCountry(iso) {
    if (iso === state.iso) return;
    state.iso = iso;
    state.filter = 'all';
    state.search = '';
    state.showAll = false;
    if (state.banksByIso[iso]) render(); else ensureLoaded(iso);
  },
  setFilter(key) { state.filter = key; render(); },
  setSearch(value) { state.search = value; render(); },
  showAll() { state.showAll = true; render(); },
  reload() { state.banksByIso = {}; ensureLoaded(state.iso); },
  openCell,
  pickStatus,
  saveCell,
  clearCell,
  editNote,
  close: closeEditor,
  exportJson,
  importJson,
  discard,
  publish,
};
