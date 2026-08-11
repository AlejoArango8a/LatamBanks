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
import { datasetIsoCountry } from '../state.js?v=bmon94';
import { API_BASE } from '../config.js?v=bmon94';
import { liveCountries } from '../paises.js?v=bmon94';
import { bankName, escapeHtml, escapeAttr } from '../format.js?v=bmon94';
import { fetchWithTimeout } from '../api.js?v=bmon94';
import {
  agenciesFor, SCOPE_LABEL, RATING_SCALES, OUTLOOKS, RATING_STATUS,
  loadPublishedRatings, mergedBanks, setDraftCell, setDraftBankNote,
  clearDraft, replaceDraft, draftCount, isDraftCell, exportPayload,
  cellStatus, ratingTone, isStale, coverage,
} from '../ratings.js?v=bmon94';

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
  { key: 'all',        label: 'Todos' },
  { key: 'incomplete', label: 'Sin cobertura mínima' },
  { key: 'unverified', label: 'Por verificar' },
  { key: 'pending',    label: 'Sin revisar' },
];

const state = {
  iso: null,
  seed: null,
  loading: false,
  error: null,
  filter: 'all',
  banksByIso: {},   // ISO → [{ code, name }]
  editing: null,
};

// ============================================================
// Datos
// ============================================================

/** Países del mantenedor: los que están en producción, en el orden del registro. */
function countryList() {
  return liveCountries().map((p) => ({ iso: p.iso, key: p.key, name: p.name }));
}

/** Partículas que no se capitalizan dentro de una razón social. */
const NAME_PARTICLES = new Set(['de', 'del', 'la', 'las', 'los', 'y', 'e', 'do', 'da', 'dos', 'das', 'en', 'el']);

/** Convierte una razón social en mayúsculas a algo legible. */
function cleanName(raw) {
  const s = String(raw || '').trim();
  if (!s || s !== s.toUpperCase()) return s;
  return s.toLowerCase()
    .split(/\s+/)
    .map((tok, i) => {
      if (i > 0 && NAME_PARTICLES.has(tok)) return tok;
      if (/^s\.?a\.?[a-z]*\.?$/.test(tok)) return tok.toUpperCase();
      return tok.charAt(0).toUpperCase() + tok.slice(1);
    })
    .join(' ');
}

/**
 * Instituciones del país, ordenadas por patrimonio. `bankName()` normaliza
 * según el país activo del dashboard, así que solo se usa cuando coincide:
 * un mismo código es otro banco en otra jurisdicción.
 */
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

  const isActive = iso === datasetIsoCountry();
  const banks = (j.instituciones || [])
    .map((row) => {
      const code = Number(row.codigo);
      return {
        code,
        name: isActive ? bankName(code) : (cleanName(row.razon_social) || `Bank ${code}`),
        equity: equity[code] || 0,
      };
    })
    .filter((b) => b.code !== 999)
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

  root.innerHTML = `
    ${heroHtml(drafts)}
    ${countryBarHtml()}
    ${bodyHtml()}
    <ul class="fa-notes">
      <li><strong>Cobertura mínima</strong>: cada banco debería tener al menos una calificación local y una internacional.</li>
      <li><strong>Verificada</strong> significa contrastada contra la publicación de la propia calificadora; <strong>sin verificar</strong> es un dato heredado que todavía no se confirma. <strong>No calificado</strong> deja constancia de que la calificadora no cubre a ese banco, que es distinto de no haberlo revisado.</li>
      <li>Las ediciones quedan en un borrador de este navegador. Se publican exportando el JSON a <span style="font-family:var(--mono);">data/bank_ratings.json</span>, de modo que cada cambio quede revisable en el repositorio.</li>
    </ul>
  `;
}

function heroHtml(drafts) {
  const updated = state.seed?.updated
    ? `Publicado ${escapeHtml(state.seed.updated)}`
    : 'Sin publicar';
  const badge = drafts
    ? `<span class="ra-draft-badge">${drafts} cambio${drafts === 1 ? '' : 's'} sin publicar</span>`
    : '';
  return `
    <div class="fa-hero ra-hero">
      <div>
        <div class="fa-eyebrow">Configuration · Data maintenance</div>
        <div class="fa-title">Credit ratings</div>
        <div class="fa-sub">Mantenedor de calificaciones de riesgo por banco y calificadora. Registra la nota, la perspectiva, la fecha, la fuente y — sobre todo — si el dato está confirmado o todavía hay que contrastarlo.</div>
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
        <div class="fa-empty-title">No pude cargar los bancos</div>
        <div class="fa-empty-sub">${escapeHtml(state.error)}</div>
        <button type="button" class="rcbtn" onclick="ratingsAdmin.reload()">Reintentar</button>
      </div></div></div>`;
  }
  if (state.loading || !state.seed) {
    return `<div class="panel"><div class="panel-body">
      <div class="fa-empty"><div class="fa-empty-sub">Cargando calificaciones…</div></div>
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
        <div class="fa-empty-title">Sin instituciones cargadas</div>
        <div class="fa-empty-sub">Este país todavía no tiene bancos en la base de datos.</div>
      </div></div></div>`;
  }

  return `
    ${kpisHtml(cov)}
    <div class="panel">
      <div class="panel-head">
        <div>
          <div class="panel-title">${escapeHtml(paisNameFor(iso))} · ${agencies.length} calificadoras</div>
          <div class="panel-sub">${banks.length} bancos ordenados por patrimonio · clic en una celda para editarla</div>
        </div>
        <div class="ra-actions">
          <div class="ra-filter-group" role="group" aria-label="Filtrar bancos">
            ${FILTERS.map((f) => `<button type="button" class="ra-filter ${state.filter === f.key ? 'active' : ''}"
              onclick="ratingsAdmin.setFilter('${f.key}')">${f.label}</button>`).join('')}
          </div>
          <button type="button" class="rcbtn ra-export" onclick="ratingsAdmin.exportJson()">Exportar JSON</button>
          <button type="button" class="rcbtn" onclick="ratingsAdmin.importJson()">Importar</button>
          ${draftCount(iso) ? `<button type="button" class="rcbtn ra-discard" onclick="ratingsAdmin.discard()">Descartar borrador</button>` : ''}
        </div>
      </div>
      <div class="panel-body ra-table-wrap">${tableHtml(iso, agencies, banks, data)}</div>
    </div>`;
}

function paisNameFor(iso) {
  const c = countryList().find((x) => x.iso === iso);
  return c ? c.name : iso;
}

function kpisHtml(cov) {
  const pct = cov.banks ? Math.round((cov.complete / cov.banks) * 100) : 0;
  const tiles = [
    { label: 'Bancos', value: cov.banks, sub: 'en el mantenedor', tone: '' },
    { label: 'Cobertura mínima', value: `${pct}%`, sub: `${cov.complete} con local + internacional`, tone: 'ra-tone-accent' },
    { label: 'Verificadas', value: cov.verified, sub: 'contrastadas con la fuente', tone: 'ra-tone-ok' },
    { label: 'Por verificar', value: cov.unverified, sub: 'cargadas sin contrastar', tone: 'ra-tone-warn' },
    { label: 'Sin revisar', value: cov.pending, sub: `de ${cov.cells} celdas`, tone: 'ra-tone-muted' },
    { label: 'No calificados', value: cov.not_rated, sub: 'confirmado sin cobertura', tone: 'ra-tone-muted' },
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

function tableHtml(iso, agencies, banks, data) {
  const locals = agencies.filter((a) => a.scope === 'local');
  const globals = agencies.filter((a) => a.scope === 'global');
  const firstGlobal = globals[0]?.key;

  const head = `
    <thead>
      <tr>
        <th rowspan="2" class="ra-col-bank">Banco</th>
        <th colspan="${locals.length}" class="ra-group">${SCOPE_LABEL.local}</th>
        <th colspan="${globals.length}" class="ra-group ra-group-split">${SCOPE_LABEL.global}</th>
        <th rowspan="2" class="ra-col-cov"
          title="Cobertura mínima: el primer punto marca si el banco tiene calificación local y el segundo si tiene internacional">Mín.</th>
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
      ? 'Cumple la cobertura mínima: tiene calificación local e internacional'
      : `Falta la calificación ${!hasLocal && !hasGlobal ? 'local y la internacional' : !hasLocal ? 'local' : 'internacional'}`;
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
          title="Editar la nota de este banco">${escapeHtml(b.name)}</button>
        <span class="ra-bank-code">${b.code}</span>
        ${note}
      </td>
      ${agencies.map((a) => cellHtml(iso, b.code, a, cells[a.key], a.key === firstGlobal)).join('')}
      <td class="ra-col-cov">${covMark}</td>
    </tr>`;
  }).join('');

  const visible = rows.trim();
  if (!visible) {
    return `<div class="fa-empty">
      <div class="fa-empty-title">Nada que revisar</div>
      <div class="fa-empty-sub">Ningún banco cumple el filtro «${FILTERS.find((f) => f.key === state.filter).label}».</div>
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
    inner = `<span class="ra-dot" style="background:${meta.color};"></span><span class="ra-na">no califica</span>`;
  } else {
    const sub = agency.open && cell.agency ? escapeHtml(cell.agency) : escapeHtml(cell.outlook || '');
    inner = `
      <span class="ra-dot" style="background:${meta.color};"></span>
      <span class="ra-rating" style="color:${ratingTone(cell.rating)};">${escapeHtml(cell.rating)}</span>
      ${sub ? `<span class="ra-cell-sub">${sub}</span>` : ''}`;
  }

  const tip = [
    agency.label,
    cell?.agency && agency.open ? `Calificadora: ${cell.agency}` : '',
    cell?.rating ? `Nota: ${cell.rating}` : '',
    cell?.outlook ? `Perspectiva: ${cell.outlook}` : '',
    cell?.as_of ? `Fecha: ${cell.as_of}` : '',
    `Estado: ${meta.label} — ${meta.hint}`,
    cell?.note || '',
  ].filter(Boolean).join('\n');

  return `<td class="ra-cell ra-st-${st} ${split ? 'ra-split' : ''} ${draft ? 'ra-draft' : ''}"
    title="${escapeAttr(tip)}"
    onclick="ratingsAdmin.openCell(${code}, '${agency.key}')">
    ${inner}
    ${stale ? '<span class="ra-stale" title="Más de 18 meses sin revisión">⏳</span>' : ''}
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

  const el = dialogEl();
  el.innerHTML = `
    <div class="ra-dialog" role="dialog" aria-modal="true">
      <div class="ra-dialog-head">
        <div>
          <div class="ra-dialog-eyebrow">${escapeHtml(SCOPE_LABEL[agency.scope === 'local' ? 'local' : 'global'])}</div>
          <div class="ra-dialog-title">${escapeHtml(bank?.name || `Bank ${code}`)}</div>
          <div class="ra-dialog-sub">${escapeHtml(agency.label)}${agency.open ? ' · indica qué calificadora emitió la nota' : ''}</div>
        </div>
        <button type="button" class="custom-kpi-close" onclick="ratingsAdmin.close()">×</button>
      </div>

      <div class="ra-dialog-body">
        ${agency.open ? `
        <label class="ra-field">
          <span class="ra-field-lbl">Calificadora</span>
          <input id="raAgency" list="raAgencyList" class="ra-input" autocomplete="off"
            placeholder="p. ej. Fitch Ratings" value="${escapeAttr(cell.agency || '')}">
          <datalist id="raAgencyList">${AGENCY_SUGGESTIONS.map((a) => `<option value="${escapeAttr(a)}">`).join('')}</datalist>
        </label>` : ''}

        <div class="ra-field-row">
          <label class="ra-field">
            <span class="ra-field-lbl">Calificación</span>
            <input id="raRating" list="raScale" class="ra-input ra-input-mono" autocomplete="off"
              placeholder="—" value="${escapeAttr(cell.rating || '')}">
            <datalist id="raScale">${scale.map((r) => `<option value="${r}">`).join('')}</datalist>
          </label>
          <label class="ra-field">
            <span class="ra-field-lbl">Perspectiva</span>
            <select id="raOutlook" class="ra-input">
              <option value="">—</option>
              ${OUTLOOKS.map((o) => `<option value="${o}" ${o === cell.outlook ? 'selected' : ''}>${o}</option>`).join('')}
            </select>
          </label>
          <label class="ra-field">
            <span class="ra-field-lbl">Fecha de la nota</span>
            <input id="raAsOf" type="month" class="ra-input" value="${escapeAttr(String(cell.as_of || '').slice(0, 7))}">
          </label>
        </div>

        <div class="ra-field">
          <span class="ra-field-lbl">Confiabilidad del dato</span>
          <div class="ra-status-seg" id="raStatus" data-value="${status}">
            ${['verified', 'unverified', 'not_rated'].map((k) => `
              <button type="button" class="ra-status-opt ${k === status ? 'active' : ''}" data-k="${k}"
                title="${escapeAttr(RATING_STATUS[k].hint)}"
                onclick="ratingsAdmin.pickStatus('${k}')">${RATING_STATUS[k].label}</button>`).join('')}
          </div>
        </div>

        <label class="ra-field">
          <span class="ra-field-lbl">Fuente</span>
          <input id="raSource" class="ra-input" placeholder="URL del comunicado de la calificadora"
            value="${escapeAttr(cell.source || '')}">
        </label>

        <label class="ra-field">
          <span class="ra-field-lbl">Nota interna</span>
          <textarea id="raNote" class="ra-input ra-textarea" rows="3"
            placeholder="Qué se revisó, qué falta contrastar…">${escapeHtml(cell.note || '')}</textarea>
        </label>
      </div>

      <div class="ra-dialog-foot">
        <button type="button" class="rcbtn ra-discard" onclick="ratingsAdmin.clearCell()">Limpiar celda</button>
        <div class="ra-foot-right">
          <button type="button" class="rcbtn" onclick="ratingsAdmin.close()">Cancelar</button>
          <button type="button" class="rcbtn active" onclick="ratingsAdmin.saveCell()">Guardar</button>
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
    `Nota de ${bank?.name || `Bank ${code}`}\n\nContexto sobre la cobertura de calificadoras de este banco.`,
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
        throw new Error('el archivo no tiene un bloque "countries"');
      }
      // Entra como borrador: lo publicado sigue siendo el archivo del repo.
      const draft = {};
      Object.entries(data.countries).forEach(([iso, block]) => {
        draft[iso] = block.banks || {};
      });
      replaceDraft(draft);
      render();
    } catch (e) {
      window.alert(`No pude leer el archivo: ${e.message}`);
    }
  };
  input.click();
}

function discard() {
  if (!window.confirm(`Se descartan los cambios sin publicar de ${paisNameFor(state.iso)}. ¿Continuar?`)) return;
  clearDraft(state.iso);
  render();
}

// ============================================================
// API pública
// ============================================================

export const ratingsAdmin = {
  selectCountry(iso) {
    if (iso === state.iso) return;
    state.iso = iso;
    state.filter = 'all';
    if (state.banksByIso[iso]) render(); else ensureLoaded(iso);
  },
  setFilter(key) { state.filter = key; render(); },
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
};
