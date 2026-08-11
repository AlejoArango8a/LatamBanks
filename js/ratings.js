// ============================================================
// CREDIT RATINGS — modelo compartido del mantenedor
//
// Fuente publicada: data/bank_ratings.json (servido por GET /api/ratings).
// Encima se aplica un borrador local por navegador, para poder revisar banco a
// banco sin publicar en cada edición. `exportPayload()` devuelve el JSON ya
// fusionado, listo para reemplazar el archivo del repo.
//
// Una celda es la calificación de UN banco por UNA calificadora:
//   { rating, status, agency?, outlook?, as_of?, source?, note? }
// `status` es lo que responde "¿este dato es confiable?":
//   verified   → contrastado contra la fuente primaria
//   unverified → heredado o cargado sin contrastar
//   not_rated  → confirmado que la calificadora no cubre al banco
//   (ausente)  → pendiente de revisar
// ============================================================
import { API_BASE } from './config.js?v=bmon95';

/**
 * Columnas por país. Chile trabaja con calificadoras nombradas (tres locales y
 * tres internacionales); el resto usa dos columnas genéricas donde la propia
 * celda declara qué calificadora la emitió (`open: true`).
 */
export const RATING_AGENCIES = Object.freeze({
  CL: [
    { key: 'fitch_cl',  label: 'Fitch Chile',   short: 'Fitch',     scope: 'local',  scale: 'local' },
    { key: 'feller',    label: 'Feller Rate',   short: 'Feller',    scope: 'local',  scale: 'local' },
    { key: 'humphreys', label: 'Humphreys',     short: 'Humphreys', scope: 'local',  scale: 'local' },
    { key: 'fitch',     label: 'Fitch Ratings', short: 'Fitch',     scope: 'global', scale: 'global' },
    { key: 'moodys',    label: "Moody's",       short: "Moody's",   scope: 'global', scale: 'moodys' },
    { key: 'sp',        label: 'S&P Global',    short: 'S&P',       scope: 'global', scale: 'global' },
  ],
});

export const RATING_AGENCIES_DEFAULT = Object.freeze([
  { key: 'local',         label: 'Calificadora local',         short: 'Local',         scope: 'local',  scale: 'local',  open: true },
  { key: 'international', label: 'Calificadora internacional', short: 'Internacional', scope: 'global', scale: 'global', open: true },
]);

/** Columnas del país, en orden: primero las locales, después las internacionales. */
export function agenciesFor(iso) {
  return RATING_AGENCIES[iso] || RATING_AGENCIES_DEFAULT;
}

export const SCOPE_LABEL = Object.freeze({
  local: 'Escala local',
  global: 'Escala internacional',
});

/** Sugerencias del editor. El campo acepta texto libre para notas con sufijos. */
export const RATING_SCALES = Object.freeze({
  local: ['AAA', 'AA+', 'AA', 'AA-', 'A+', 'A', 'A-', 'BBB+', 'BBB', 'BBB-',
          'BB+', 'BB', 'BB-', 'B+', 'B', 'B-', 'C', 'D', 'E'],
  global: ['AAA', 'AA+', 'AA', 'AA-', 'A+', 'A', 'A-', 'BBB+', 'BBB', 'BBB-',
           'BB+', 'BB', 'BB-', 'B+', 'B', 'B-', 'CCC+', 'CCC', 'CCC-', 'CC', 'C', 'D'],
  moodys: ['Aaa', 'Aa1', 'Aa2', 'Aa3', 'A1', 'A2', 'A3', 'Baa1', 'Baa2', 'Baa3',
           'Ba1', 'Ba2', 'Ba3', 'B1', 'B2', 'B3', 'Caa1', 'Caa2', 'Caa3', 'Ca', 'C'],
});

export const OUTLOOKS = Object.freeze([
  'Estable', 'Positiva', 'Negativa', 'En Observación', 'En Desarrollo',
]);

export const RATING_STATUS = Object.freeze({
  verified:   { label: 'Verificada',    short: 'Verificada',  color: 'var(--green)',  hint: 'Contrastada contra la fuente primaria.' },
  unverified: { label: 'Sin verificar', short: 'Sin verif.',  color: 'var(--yellow)', hint: 'Cargada pero sin contrastar con la calificadora.' },
  not_rated:  { label: 'No calificado', short: 'No califica', color: 'var(--text3)',  hint: 'Confirmado: la calificadora no cubre a este banco.' },
  pending:    { label: 'Pendiente',     short: 'Pendiente',   color: 'var(--text3)',  hint: 'Todavía no se revisa.' },
});

export const STATUS_ORDER = ['verified', 'unverified', 'not_rated', 'pending'];

/** Una nota vigente rara vez pasa de 18 meses sin que la calificadora la revise. */
const STALE_MONTHS = 18;

// ---- Escala y color ----------------------------------------------------

// Moody's usa otro alfabeto; se traduce para poder comparar y colorear igual.
const MOODYS_TO_LETTER = {
  Aaa: 'AAA', Aa1: 'AA+', Aa2: 'AA', Aa3: 'AA-',
  A1: 'A+', A2: 'A', A3: 'A-',
  Baa1: 'BBB+', Baa2: 'BBB', Baa3: 'BBB-',
  Ba1: 'BB+', Ba2: 'BB', Ba3: 'BB-',
  B1: 'B+', B2: 'B', B3: 'B-',
  Caa1: 'CCC+', Caa2: 'CCC', Caa3: 'CCC-', Ca: 'CC', C: 'C',
};

const NOTCHES = ['AAA', 'AA+', 'AA', 'AA-', 'A+', 'A', 'A-', 'BBB+', 'BBB', 'BBB-',
                 'BB+', 'BB', 'BB-', 'B+', 'B', 'B-', 'CCC+', 'CCC', 'CCC-',
                 'CC', 'C', 'D', 'E'];

/** Quita sufijos de escala nacional: `AAA(cl)`, `AA+ (col)` → `AAA`, `AA+`. */
export function normalizeRating(value) {
  return String(value ?? '').replace(/\s*\(.*?\)\s*/g, '').trim().toUpperCase();
}

/** Posición en la escala (0 = AAA). `null` si el valor no es reconocible. */
export function ratingNotch(value) {
  const raw = String(value ?? '').replace(/\s*\(.*?\)\s*/g, '').trim();
  if (!raw) return null;
  const letter = MOODYS_TO_LETTER[raw] || normalizeRating(raw);
  const i = NOTCHES.indexOf(letter);
  return i === -1 ? null : i;
}

/** Color por banda de riesgo, consistente con el resto de la plataforma. */
export function ratingTone(value) {
  const n = ratingNotch(value);
  if (n === null) return 'var(--text3)';
  if (n <= 3) return 'var(--green)';    // AAA … AA-
  if (n <= 6) return 'var(--accent)';   // A+ … A-
  if (n <= 9) return 'var(--yellow)';   // BBB+ … BBB-
  return 'var(--red)';                  // BB+ y abajo
}

/** `true` si la nota lleva más de 18 meses sin revisarse. */
export function isStale(asOf) {
  const s = String(asOf ?? '').trim();
  const m = /^(\d{4})-(\d{2})/.exec(s);
  if (!m) return false;
  const months = (new Date().getFullYear() - Number(m[1])) * 12
    + (new Date().getMonth() + 1 - Number(m[2]));
  return months > STALE_MONTHS;
}

/** Estado efectivo de una celda: `pending` cuando no hay dato. */
export function cellStatus(cell) {
  if (!cell) return 'pending';
  if (cell.status === 'not_rated') return 'not_rated';
  if (!String(cell.rating ?? '').trim()) return 'pending';
  return cell.status === 'verified' ? 'verified' : 'unverified';
}

// ---- Dataset publicado -------------------------------------------------

let _published = null;

/** Descarga (una vez) el dataset completo. Nunca lanza: ante fallo, vacío. */
export function loadPublishedRatings() {
  if (_published) return _published;
  _published = (async () => {
    for (const url of [`${API_BASE}/api/ratings`, `${API_BASE}/data/bank_ratings.json`]) {
      try {
        const r = await fetch(url);
        if (!r.ok) continue;
        const j = await r.json();
        if (j && j.countries) return j;
      } catch { /* siguiente origen */ }
    }
    console.warn('bank_ratings.json no cargó; el mantenedor arranca vacío.');
    return { version: 1, updated: null, countries: {} };
  })();
  return _published;
}

function publishedBanks(seed, iso) {
  return seed?.countries?.[iso]?.banks || {};
}

// ---- Borrador local ----------------------------------------------------

const DRAFT_KEY = 'latambanks.ratingsDraft.v1';

export function getDraft() {
  try { return JSON.parse(localStorage.getItem(DRAFT_KEY) || '{}') || {}; }
  catch { return {}; }
}

function writeDraft(draft) {
  try { localStorage.setItem(DRAFT_KEY, JSON.stringify(draft)); }
  catch (e) { console.warn('No pude guardar el borrador de ratings:', e.message); }
}

/**
 * Registra el cambio de una celda. `cell = null` la borra; el borrador guarda
 * la baja explícitamente para poder deshacer una celda que sí está publicada.
 */
export function setDraftCell(iso, code, agencyKey, cell) {
  const draft = getDraft();
  const country = draft[iso] || (draft[iso] = {});
  const bank = country[code] || (country[code] = {});
  const cells = bank.cells || (bank.cells = {});
  cells[agencyKey] = cell;
  writeDraft(draft);
}

export function setDraftBankNote(iso, code, note) {
  const draft = getDraft();
  const country = draft[iso] || (draft[iso] = {});
  const bank = country[code] || (country[code] = {});
  bank.note = note || null;
  writeDraft(draft);
}

export function clearDraft(iso) {
  const draft = getDraft();
  if (iso) delete draft[iso]; else Object.keys(draft).forEach((k) => delete draft[k]);
  writeDraft(draft);
}

export function replaceDraft(draft) {
  writeDraft(draft && typeof draft === 'object' ? draft : {});
}

/** Cuántas celdas tocó el borrador (todo el mundo, o un país). */
export function draftCount(iso) {
  const draft = getDraft();
  const isos = iso ? [iso] : Object.keys(draft);
  let n = 0;
  isos.forEach((k) => {
    Object.values(draft[k] || {}).forEach((bank) => {
      n += Object.keys(bank.cells || {}).length;
      if ('note' in bank) n += 1;
    });
  });
  return n;
}

// ---- Fusión ------------------------------------------------------------

function mergeBank(base, over) {
  const cells = { ...(base?.cells || {}) };
  Object.entries(over?.cells || {}).forEach(([key, cell]) => {
    if (cell) cells[key] = cell; else delete cells[key];
  });
  const note = over && 'note' in over ? over.note : base?.note;
  const out = {};
  if (Object.keys(cells).length) out.cells = cells;
  if (note) out.note = note;
  return out;
}

/**
 * Bancos de un país con el borrador ya aplicado.
 * Devuelve `{ [codigo]: { cells, note } }`.
 */
export function mergedBanks(seed, iso) {
  const base = publishedBanks(seed, iso);
  const over = getDraft()[iso] || {};
  const out = {};
  new Set([...Object.keys(base), ...Object.keys(over)]).forEach((code) => {
    const bank = mergeBank(base[code], over[code]);
    if (bank.cells || bank.note) out[code] = bank;
  });
  return out;
}

/** `true` si el borrador tocó esa celda (para marcarla como no publicada). */
export function isDraftCell(iso, code, agencyKey) {
  return Boolean(getDraft()[iso]?.[code]?.cells?.hasOwnProperty(agencyKey));
}

/** Dataset completo publicado + borrador, en el formato de data/bank_ratings.json. */
export function exportPayload(seed) {
  const draft = getDraft();
  const isos = new Set([...Object.keys(seed?.countries || {}), ...Object.keys(draft)]);
  const countries = {};
  [...isos].sort().forEach((iso) => {
    const banks = mergedBanks(seed, iso);
    const sorted = {};
    Object.keys(banks)
      .sort((a, b) => Number(a) - Number(b))
      .forEach((code) => { sorted[code] = banks[code]; });
    if (Object.keys(sorted).length) countries[iso] = { banks: sorted };
  });
  return {
    version: seed?.version ?? 1,
    updated: new Date().toISOString().slice(0, 10),
    generator: seed?.generator ?? 'tools/build_bank_ratings_seed.py',
    note: seed?.note ?? '',
    countries,
  };
}

// ---- Cobertura ---------------------------------------------------------

/**
 * Resumen de avance de un país: cuántas celdas hay en cada estado y cuántos
 * bancos cumplen el mínimo de una calificación local y una internacional.
 */
export function coverage(banks, agencies, codes) {
  const byStatus = { verified: 0, unverified: 0, not_rated: 0, pending: 0 };
  let complete = 0;

  codes.forEach((code) => {
    const cells = banks[code]?.cells || {};
    let hasLocal = false;
    let hasGlobal = false;
    agencies.forEach((a) => {
      const st = cellStatus(cells[a.key]);
      byStatus[st] += 1;
      if (st === 'verified' || st === 'unverified') {
        if (a.scope === 'local') hasLocal = true; else hasGlobal = true;
      }
    });
    if (hasLocal && hasGlobal) complete += 1;
  });

  return {
    banks: codes.length,
    cells: codes.length * agencies.length,
    complete,
    ...byStatus,
  };
}
