// ============================================================
// CONFIG — constants, colour maps, static lookup tables
// ============================================================
// API_BASE: vacío ('') = mismo origen (Vercel, dominio propio).
// GitHub Pages necesita la URL absoluta de Render como fallback transitorio.
const _h = window.location.hostname;
export const API_BASE =
  (_h === 'localhost' || _h === '127.0.0.1')
    ? 'http://localhost:3000'                          // desarrollo local
    : _h.includes('github.io')
      ? 'https://latambanks-api.onrender.com'         // GitHub Pages → Render
      : '';                                            // Vercel / dominio propio → mismo origen

export const BANK_COLORS = {
  1:  '#0A1464',
  12: '#327CD3',
  14: '#6E0308',
  16: '#F2DC21',
  37: '#F70000',
  39: '#F75F01',
  41: '#382106',
  51: '#C4D201',
  53: '#5E2C8B',
  59: '#2563eb',
  62: '#00A9E4',
  66: '#2563eb',
  10001: '#047857',
};

export const CHART_COLORS = ['#38bdf8','#f59e0b','#f87171','#a78bfa','#fb923c','#34d399','#e879f9','#4ade80'];

export const bankColor = (code, i) => {
  const c = Number(code);
  if (c === 59 || c === 66) return BANK_COLORS[59];
  return BANK_COLORS[code] ?? CHART_COLORS[i % CHART_COLORS.length];
};

export const BANK_NAMES = {
  1:   'Banco de Chile',
  9:   'Banco Internacional',
  12:  'Banco Estado',
  14:  'Scotiabank',
  16:  'BCI',
  28:  'Banco BICE',
  31:  'HSBC Bank',
  37:  'Santander',
  39:  'Itaú',
  41:  'JP Morgan',
  49:  'Banco Security',
  51:  'Banco Falabella',
  53:  'Banco Ripley',
  55:  'Banco Consorcio',
  59:  'BTG Pactual Chile',
  60:  'China Construction Bank',
  61:  'Bank of China',
  62:  'Tanner Digital',
  999: 'Total Sistema Financiero',
};

export const BANK_LOGOS = {
  1:   'https://www.bancochile.cl/favicon.ico',
  9:   'https://www.bancointernacional.cl/favicon.ico',
  12:  'https://www.bancoestado.cl/favicon.ico',
  14:  'https://www.scotiabank.cl/favicon.ico',
  16:  'https://www.bci.cl/favicon.ico',
  28:  'https://www.bice.cl/favicon.ico',
  31:  'https://www.hsbc.com/favicon.ico',
  37:  'https://www.santander.cl/favicon.ico',
  39:  'https://www.itau.cl/favicon.ico',
  41:  'https://www.jpmorgan.com/favicon.ico',
  49:  'https://www.security.cl/favicon.ico',
  51:  'https://www.bancofalabella.cl/favicon.ico',
  53:  'https://www.bancoripley.cl/favicon.ico',
  55:  'https://www.consorcio.cl/favicon.ico',
  59:  'https://www.btgpactual.com/favicon.ico',
  60:  'https://www.ccb.cn/favicon.ico',
  61:  'https://www.bankofchina.com/favicon.ico',
  62:  'https://www.tanner.cl/favicon.ico',
  66:  'https://www.btgpactual.com/favicon.ico',
};

export const MESES = ['','Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

export const CUENTAS_PRINCIPALES = {
  '100000000': 'Assets',
  '200000000': 'Liabilities',
  '300000000': 'Equity accounts',
  '400000000': 'Income statement',
  '500000000': 'Income statement summary',
  '600000000': 'Off-balance',
  '800000000': 'Supplementary information',
};

export const FELLER_RATINGS = {
  1:  'AAA',
  9:  'AA',
  12: 'AAA',
  14: 'AA+',
  16: 'AAA',
  28: 'AA+',
  31: 'AAA',
  37: 'AAA',
  39: 'AAA',
  41: 'AAA',
  51: 'AA',
  53: 'AA-',
  55: 'AA',
  49: 'AA+',
  59: 'AA',
  60: 'AAA',
  61: 'AAA',
  62: 'AA-',
  66: 'AA',
};

/**
 * Fitch / BRC — escala nacional largo plazo.
 * Claves = `instituciones.codigo` del bootstrap CO (mismo codigo_entidad CUIF / Socrata).
 */
export const BANK_RATINGS_CO = Object.freeze({
  10_001: 'AAA', // Grupo Aval (sintético cliente)
  1: 'AAA',     // Banco de Bogotá
  2: 'AAA',     // Banco Popular
  6: 'AAA',     // Itaú
  7: 'AAA',     // Bancolombia
  9: 'AAA',     // Citibank
  12: 'AA+',    // GNB Sudameris
  13: 'AAA',    // BBVA Colombia
  23: 'AAA',    // Banco de Occidente
  30: 'AAA',    // Banco Caja Social
  39: 'AAA',    // Banco Davivienda
  42: 'AAA',    // Scotiabank Colpatria
  43: 'AAA',    // Banco Agrario
  49: 'AAA',    // AV Villas
  51: 'AAA',    // Bancien
  52: 'AA-',    // Bancamía
  53: 'AA',     // Banco W
  54: 'AA-',    // Coomeva
  55: 'AA+',    // Finandina
  56: 'AAA',    // Falabella
  57: 'A-',     // Pichincha
  58: 'AA',     // Coopcentral
  59: 'AAA',    // Banco Santander
  60: 'AA+',    // Mundo Mujer
  62: 'AAA',    // Mi Banco
  63: 'AA',     // Serfinanza
  64: 'AAA',    // J.P. Morgan
  65: 'A+',     // Lulo Bank
  66: 'AAA',    // BTG Pactual Colombia
  67: 'AA',     // Banco Unión
  68: 'A+',     // Banco Contactar
});

/**
 * Perspectiva, calificadora y síntesis analítica (solo CO). Tooltip en Banking System y Config.
 */
export const BANK_RATINGS_CO_META = Object.freeze({
  39: {
    outlook: 'Negativa',
    agency: 'Fitch / BRC',
    analysis:
      'Mantiene la nota máxima nacional por su sólida posición competitiva, aunque la perspectiva es negativa reflejando el entorno soberano de Colombia.',
  },
  42: {
    outlook: 'Estable',
    agency: 'Fitch / BRC',
    analysis:
      'Ratificado en la categoría más alta gracias al soporte estratégico de su casa matriz (The Bank of Nova Scotia) y su robusta capacidad de pago.',
  },
  30: {
    outlook: 'Estable',
    agency: 'BRC Ratings',
    analysis:
      'Por 15 años consecutivos ha mantenido la máxima nota local, destacando su resiliencia y fuerte enfoque en el sector de ahorro popular.',
  },
  59: {
    outlook: 'Estable',
    agency: 'Fitch Ratings',
    analysis:
      'Fitch afirmó su nota en marzo de 2026. El banco ha mejorado su perfil financiero y calidad de cartera (mora de 3,2%).',
  },
  62: {
    outlook: 'Estable',
    agency: 'Fitch Ratings',
    analysis:
      'En abril de 2026 recibió su sexta calificación AAA consecutiva. Es considerado de importancia estratégica para el Grupo Credicorp.',
  },
  52: {
    outlook: 'Estable',
    agency: 'BRC Ratings',
    analysis:
      'Subió su calificación a inicios de 2026. Es un grado de inversión muy alto, reflejando una excelente gestión en el nicho de microfinanzas.',
  },
});

export const RATING_COLORS = {
  'AAA': '#059669', 'AA+': '#10b981', 'AA': '#34d399', 'AA-': '#6ee7b7',
  'A+': '#f59e0b', 'A': '#fbbf24', 'A-': '#fcd34d',
  'BBB+': '#f87171', 'BBB': '#ef4444',
};

export const BTG_LOGO_DARK_SRC = 'assets/btg-logo-dark.png';
