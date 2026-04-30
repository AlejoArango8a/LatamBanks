// ============================================================
// CONFIG — constants, colour maps, static lookup tables
// ============================================================
export const API_BASE = 'https://latambanks-api.onrender.com';

export const BANK_COLORS = {
  1:  '#0A1464',
  12: '#205491',
  14: '#6E0308',
  16: '#F2DC21',
  37: '#F70000',
  39: '#F75F01',
  41: '#382106',
  51: '#C4D201',
  53: '#5E2C8B',
  59: '#2563eb',
  62: '#00A9E4',
};

export const CHART_COLORS = ['#38bdf8','#f59e0b','#f87171','#a78bfa','#fb923c','#34d399','#e879f9','#4ade80'];

export const bankColor = (code, i) => BANK_COLORS[code] || CHART_COLORS[i % CHART_COLORS.length];

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
};

export const RATING_COLORS = {
  'AAA': '#059669', 'AA+': '#10b981', 'AA': '#34d399', 'AA-': '#6ee7b7',
  'A+': '#f59e0b', 'A': '#fbbf24', 'A-': '#fcd34d',
  'BBB+': '#f87171', 'BBB': '#ef4444',
};

export const BTG_LOGO_DARK_SRC = 'assets/btg-logo-dark.png';
