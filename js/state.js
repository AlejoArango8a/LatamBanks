// ============================================================
// STATE — single source of truth for mutable app state
// ============================================================
import { paisIso, paisCurrency } from './paises.js?v=bmon27';

export const ST = {
  /** Active dataset jurisdiction (bootstrap sets Chile; clears cache when switching live backends). */
  country: 'chile',
  periodos: [],
  bancos: {},
  selected: new Set(),
  selectedOrder: [],
  desde: null,
  hasta: null,
  data: {},
  planCuentas: {},
  lastPeriodo: null,

  // UI prefs (set immediately so boot code can reference them)
  theme: 'light',
  showBarLabels: null,
  currency: 'USD',
  usdRate: null,
  usdDate: null,
  fontSize: 14,

  // Account View state
  _avAccount: null,
  _avGroup: '',
  _avTreeExpanded: {},
};

/** Código país para API y BD (bootstrap /datos): CL | CO … (según paises.json) */
export function datasetIsoCountry() {
  return paisIso(ST.country);
}

/**
 * ISO 4217 de la moneda local del dashboard activo (para el toggle de la barra).
 * Se toma del registro de países (paises.json).
 */
export function reportingLocalCurrencyISO() {
  return paisCurrency(ST.country);
}

// Chart instances (canvas Chart.js objects if needed in future)
export const CHARTS = {};

// Bar chart tooltip hit-testing, keyed by canvas ID
export const CHART_STATE = {};
