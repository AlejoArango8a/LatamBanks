// ============================================================
// STATE — single source of truth for mutable app state
// ============================================================
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

/** Código país para API y BD (bootstrap /datos): CL | CO */
export function datasetIsoCountry() {
  return ST.country === 'colombia' ? 'CO' : 'CL';
}

/**
 * ISO 4217 label for the local-currency side of the topbar toggle (per active dashboard).
 * Chile → CLP, Colombia → COP; extend when more jurisdictions go live.
 */
export function reportingLocalCurrencyISO() {
  if (ST.country === 'colombia') return 'COP';
  if (ST.country === 'chile') return 'CLP';
  if (ST.country === 'peru') return 'PEN';
  if (ST.country === 'uruguay') return 'UYU';
  return 'Local';
}

// Chart instances (canvas Chart.js objects if needed in future)
export const CHARTS = {};

// Bar chart tooltip hit-testing, keyed by canvas ID
export const CHART_STATE = {};
