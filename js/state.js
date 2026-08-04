// ============================================================
// STATE — single source of truth for mutable app state
// ============================================================
import { paisIso, paisCurrency } from './paises.js?v=bmon60';

export const ST = {
  /** Active dataset jurisdiction (bootstrap sets Chile; clears cache when switching live backends). */
  country: 'chile',
  periodos: [],
  bancos: {},
  selected: new Set(),
  selectedOrder: [],
  compareMode: false,
  desde: null,
  hasta: null,
  data: {},
  planCuentas: {},
  lastPeriodo: null,

  // UI prefs (set immediately so boot code can reference them)
  theme: 'light',
  showBarLabels: true,   // labels de barras ON por defecto
  _deltaMode: false,     // herramienta de comparación Δ% entre 2 puntos
  _deltaSel: [],         // puntos seleccionados [{periodo,label,val}]
  currency: 'USD',
  usdRate: null,
  usdDate: null,
  /** Fuente FX activa (open.er-api.com | currency-api | mindicador.cl) */
  usdFxSource: null,
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
