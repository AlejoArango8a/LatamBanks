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
  exp: { hierarchy: null, path: [], selected: null, history: [] },

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

  // Explorer state
  _expSubFilter: true,
};

// Chart instances (canvas Chart.js objects if needed in future)
export const CHARTS = {};

// Bar chart tooltip hit-testing, keyed by canvas ID
export const CHART_STATE = {};
