// ============================================================
// CONFIG — constants, colour maps, static lookup tables
// ============================================================
import { ST, datasetIsoCountry } from './state.js?v=bmon102';

// API_BASE: vacío ('') = mismo origen (Vercel / dominio propio).
const _h = window.location.hostname;
export const API_BASE =
  (_h === 'localhost' || _h === '127.0.0.1')
    ? 'http://localhost:3000'   // desarrollo local
    : '';                       // producción (Vercel) → mismo origen

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
  66: '#2563eb', // CO BTG Pactual (codigo 66)
  1000080336: '#2563eb',
  10001: '#047857',
};

export const CHART_COLORS = ['#38bdf8','#f59e0b','#f87171','#a78bfa','#fb923c','#34d399','#e879f9','#4ade80'];

// Azul de marca BTG. En tema claro se usa el navy corporativo (#062650);
// en tema oscuro un azul más brillante para conservar contraste sobre el fondo.
const _isLightTheme = () => document.body.classList.contains('light');
export const BTG_BLUE_LIGHT = '#062650';
export const BTG_BLUE_DARK  = '#2563eb';
export const btgBlue = () => (_isLightTheme() ? BTG_BLUE_LIGHT : BTG_BLUE_DARK);
export const btgRgba = (a = 0.08) => (_isLightTheme() ? `rgba(6,38,80,${a})` : `rgba(37,99,235,${a})`);
/** BTG franchise codes are country-specific (CL 59 ≠ PA 59). */
const BTG_CODE_BY_ISO = {
  CL: 59,
  CO: 66,
  BR: 1000080336,
  US: 35154,
  UY: 157,
  LU: 79983,
};

/** BTG's code in the active supervisor's registry, or null where it has no bank. */
export const btgCodeForCountry = (iso = datasetIsoCountry()) =>
  BTG_CODE_BY_ISO[iso] ?? null;

export const isBtgCode = (code) => {
  const btg = btgCodeForCountry();
  return btg != null && Number(code) === btg;
};

// Colores de marca compartidos entre países, indexados por fragmento de nombre en minúsculas.
// Permite que Santander Chile y Santander Brasil usen el mismo rojo, etc.
const BRAND_COLORS = new Map([
  ['santander', '#F70000'],
  ['itaú',      '#F75F01'],
  ['itau',      '#F75F01'],
  ['scotiabank','#6E0308'],
  ['jp morgan', '#382106'],
  ['jpmorgan',  '#382106'],
  ['j.p. morgan','#382106'],
  ['citibank',  '#1A73E8'],
  ['bbva',      '#004A97'],
  ['hsbc',      '#DB0011'],
  ['bradesco',  '#BE1931'],
]);

function brandColorByName(name) {
  if (!name) return null;
  const lower = name.toLowerCase();
  for (const [key, color] of BRAND_COLORS) {
    if (lower.includes(key)) return color;
  }
  return null;
}

/**
 * bankColor(code, i, name?)
 * name es opcional: cuando se pasa, permite emparejar colores de marca entre países.
 */
// Marcas muy reconocibles que SIEMPRE conservan su color, incluso en comparación.
const ITAU_ORANGE   = '#F75F01';
const NUBANK_PURPLE = '#820AD1';
const BCI_YELLOW    = '#EAB308';   // amarillo del logo BCI (tono legible en gráficos)
function protectedBrandColor(code, name) {
  if (isBtgCode(code)) return btgBlue();
  const l = (name || '').toLowerCase();
  if (l.includes('itaú') || l.includes('itau')) return ITAU_ORANGE;
  if (l.includes('nubank') || l.includes('nu pagamentos')) return NUBANK_PURPLE;
  if (l.includes('bci')) return BCI_YELLOW;
  return null;
}
// Paleta para "los demás" bancos en comparación: tonos bien separados que evitan
// el azul (BTG), el naranja (Itaú) y el morado (Nubank).
const COMPARE_PALETTE = ['#16a34a', '#dc2626', '#db2777', '#0d9488', '#65a30d', '#be123c', '#0e7490', '#a16207'];

export const bankColor = (code, i, name = '') => {
  // BTG, Itaú y Nubank SIEMPRE conservan su color de marca.
  const prot = protectedBrandColor(code, name);
  if (prot) return prot;
  // En "Bank Comparison" (varios bancos): el resto usa una paleta por índice →
  // colores garantizadamente distintos y fáciles de comparar.
  const comparing = !!(ST && ST.selected && ST.selected.size > 1);
  if (comparing) return COMPARE_PALETTE[i % COMPARE_PALETTE.length];
  // Vista de un solo banco: se respeta el color de marca de cada institución.
  const byLogo = logoBrandColor(datasetIsoCountry(), code);
  if (byLogo) return byLogo;
  // BANK_COLORS is Chile-centric by supervisory code — do not reuse on other ISOs.
  if (datasetIsoCountry() === 'CL' && BANK_COLORS[code]) return BANK_COLORS[code];
  const byBrand = brandColorByName(name);
  if (byBrand) return byBrand;
  return CHART_COLORS[i % CHART_COLORS.length];
};

// ---- Logo slugs ----
// Mapea "ISO-codigo" → slug de archivo en assets/logos/logo-{slug}.png
// Un slug por marca visual; bancos de la misma marca en distintos países apuntan al mismo archivo.
export const LOGO_SLUGS = {
  // Chile (CL) — código CMF
  'CL-1':        'bancochile',
  'CL-9':        'internacional',
  'CL-12':       'bancoestado',
  'CL-14':       'scotiabank',
  'CL-16':       'bci',
  'CL-28':       'bice',
  'CL-31':       'hsbc',
  'CL-37':       'santander',
  'CL-39':       'itau',
  'CL-41':       'jpmorgan',
  'CL-51':       'falabella',
  'CL-53':       'ripley',
  'CL-55':       'consorcio',
  'CL-59':       'btg',
  'CL-60':       'ccb',
  'CL-61':       'bankofchina',
  'CL-62':       'tanner',
  // Colombia (CO) — código CUIF
  'CO-1':        'bogota',
  'CO-2':        'popular',
  'CO-6':        'itau',
  'CO-7':        'bancolombia',
  'CO-9':        'citibank',
  'CO-12':       'gnbsudameris',
  'CO-13':       'bbva',
  'CO-23':       'occidente',
  'CO-30':       'cajasocial',
  'CO-39':       'davivienda',
  'CO-42':       'scotiabank',
  'CO-43':       'agrario',
  'CO-56':       'falabella',
  'CO-59':       'santander',
  'CO-64':       'jpmorgan',
  'CO-65':       'lulo',
  'CO-66':       'btg',
  'CO-10001':    'aval',
  // Brasil (BR) — ISPB (CodInst IF.data)
  // Códigos prudenciais (c0 = '1000...') del rebuild IF.data (Conglomerados
  // Prudenciais e Instituições Independentes). Reemplazan los CNPJ individuales
  // que usaba el nivel de consolidación viejo.
  'BR-1000080336': 'btg',
  'BR-1000080185': 'santander',
  'BR-1000080099': 'itau',
  'BR-1000080075': 'bradesco',
  'BR-1000080329': 'bancodobrasil',
  'BR-1000080738': 'caixaeconomica',
  'BR-1000080219': 'ubs',
  'BR-1000084693': 'nubank',
  'BR-1000080192': 'citibank',
  'BR-1000080116': 'jpmorgan',
  'BR-1000080109': 'safra',
  'BR-1000080745': 'sicredi',
  'BR-1000080673': 'bnp',
  'BR-1000082475': 'xp',
  'BR-1000080154': 'banrisul',
  'BR-1000080484': 'votorantim',
  'BR-1000081593': 'nordeste',
  // Uruguay (UY) — código institución BCU / SSF
  'UY-113': 'itau',
  'UY-128': 'scotiabank',
  'UY-137': 'santander',
  'UY-153': 'bbva',
  'UY-157': 'btg',
  'UY-205': 'citibank',
  // Luxembourg (LU) — franchise-only BTG Europe (RCS B79983)
  'LU-79983': 'btg',
  // Perú (SBS B-2201) — slugs con PNG en assets/logos/ (resto → generico)
  'PE-1':   'bbva',
  'PE-6':   'scotiabank',
  'PE-7':   'citibank',
  'PE-10':  'gnbsudameris',
  'PE-11':  'falabella',
  'PE-12':  'santander',
  'PE-13':  'ripley',
  'PE-16':  'bankofchina',
  'PE-17':  'bci',
  // US FDIC CERT → logos existentes
  'US-628':   'jpmorgan',
  'US-7213':  'citibank',
  'US-5416':  'hsbc',

};

/** Devuelve la URL relativa del logo, o null si no hay entrada para ese banco. */
export function bankLogoUrl(iso, code) {
  // Backend casts codigo::int, so BR codes like '00000000' arrive as 0.
  // Re-pad to 8 digits so keys match LOGO_SLUGS entries.
  const key = iso === 'BR'
    ? `BR-${String(code).padStart(8, '0')}`
    : `${iso}-${code}`;
  const slug = LOGO_SLUGS[key];
  return slug ? `assets/logos/logo-${slug}.png` : null;
}

/**
 * Primary brand colors by logo slug — sampled directly from the actual PNG
 * files in assets/ (dominant saturated color). 'btg' is intentionally absent
 * (handled via theme-aware btgBlue()). Monochrome/black logos (bancolombia,
 * safra, xp) fall back to a neutral dark; jpmorgan uses its bronze/brown brand.
 */
const BRAND_TEXT_COLORS = {
  // Chile
  'bancochile':    '#103878',
  'bancoestado':   '#C80038',
  'scotiabank':    '#E82820',
  'bci':           '#E83840',
  'bice':          '#003868',
  'hsbc':          '#F83028',
  'santander':     '#F80000',
  'itau':          '#F86000',
  'jpmorgan':      '#6B4423',
  'falabella':     '#007830',
  'ripley':        '#582880',
  'consorcio':     '#14284F',
  'tanner':        '#00B0F0',
  'internacional': '#0068A0',
  // Colombia
  'bancolombia':   '#3A3A3A',
  'bogota':        '#F8D000',
  'popular':       '#088038',
  'citibank':      '#002870',
  'bbva':          '#005098',
  'occidente':     '#0890D8',
  'davivienda':    '#F80000',
  'aval':          '#2058A8',
  'lulo':          '#B9CC00',
  'gnbsudameris':  '#88C038',
  'agrario':       '#0090D0',
  'cajasocial':    '#0070B8',
  // Brasil
  'bradesco':      '#E81828',
  'bancodobrasil': '#303088',
  'caixaeconomica':'#0068B8',
  'ubs':           '#E00000',
  'nubank':        '#681878',
  'safra':         '#3A3A3A',
  'sicredi':       '#F8B828',
  'bnp':           '#00A868',
  'xp':            '#1F1F1F',
  'banrisul':      '#10256B',
  'votorantim':    '#D81848',
  'nordeste':      '#A01838',
  'bankofchina':   '#B00830',
  'ccb':           '#184098',
  // Extras present in assets/
  'barclays':      '#00B0F0',
  'ing':           '#002868',
};

/**
 * Concrete brand color (hex) from the bank's logo, or null when there is no
 * mapped logo, the logo is BTG (theme-aware, handled elsewhere), or the slug
 * has no color entry. Safe for charts (never returns a CSS var).
 */
export function logoBrandColor(iso, code) {
  const key = iso === 'BR'
    ? `BR-${String(code).padStart(8, '0')}`
    : `${iso}-${code}`;
  const slug = LOGO_SLUGS[key];
  if (!slug || slug === 'btg') return null;
  return BRAND_TEXT_COLORS[slug] || null;
}

/**
 * Returns the brand text color for a bank, or null if BTG
 * (caller should then use btgBlue()) or unknown slug (use var(--white)).
 */
export function bankBrandTextColor(iso, code) {
  const key = iso === 'BR'
    ? `BR-${String(code).padStart(8, '0')}`
    : `${iso}-${code}`;
  const slug = LOGO_SLUGS[key];
  if (!slug || slug === 'btg') return null;
  return BRAND_TEXT_COLORS[slug] ?? 'var(--white)';
}

/**
 * Per-logo max-height overrides (px). Default is 42px.
 * Slugs that need a custom size are listed here.
 */
export const LOGO_SIZES = {
  'bancoestado':   44,
  'bancochile':    34,
  'bci':           34,
  'scotiabank':    34,
  'ccb':           34,
  'bancodobrasil': 52,
  'caixaeconomica': 72,
  'bradesco':      52,
  'itau':          62,
  'hsbc':          72,
  'consorcio':     56,
  'ripley':        52,
  'safra':         68,
  'jpmorgan':      62,
  'bancolombia':   72,
  'bogota':        56,
  'popular':       72,
  'falabella':     62,
  'gnbsudameris':  56,
  'nordeste':      56,
  'votorantim':    56,
  'banrisul':      56,
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

/**
 * Chile — solvencia local (largo plazo). Preferimos Feller Rate cuando existe;
 * si el banco no está clasificado por Feller, usamos Fitch Chile / ICR / Humphreys.
 * Claves = `instituciones.codigo` CMF.
 *
 * Verificado (fuentes públicas, 2025–2026):
 * - Feller: Chile, Estado, BCI, Santander, Itaú, BICE, Internacional, Falabella,
 *   Consorcio, BTG Chile, CCB, HSBC, JP Morgan, Bank of China → ver listado bancos CL.
 * - Scotiabank (14): Fitch AAA(cl) + ICR AAA (IR Scotiabank Chile) — no Feller.
 * - Security (49): ICR AA+ (post fusión BICECORP / Grupo Security).
 * - Ripley (53): Humphreys / Fitch Chile / ICR AA- (IR Ripley).
 * - Tanner (62): Humphreys / ICR AA- (Tanner Banco Digital).
 */
export const FELLER_RATINGS = {
  1:  'AAA', // Banco de Chile — Feller
  9:  'AA',  // Banco Internacional — Feller
  12: 'AAA', // BancoEstado — Feller
  14: 'AAA', // Scotiabank Chile — Fitch Chile / ICR (no Feller)
  16: 'AAA', // BCI — Feller
  28: 'AA+', // Banco BICE — Feller
  31: 'AAA', // HSBC Bank (Chile) — Feller
  37: 'AAA', // Santander-Chile — Feller
  39: 'AAA', // Itaú Chile — Feller
  41: 'AAA', // JPMorgan Chase N.A. (CL) — Feller
  49: 'AA+', // Banco Security — ICR
  51: 'AA',  // Banco Falabella — Feller
  53: 'AA-', // Banco Ripley — Humphreys / Fitch Chile / ICR
  55: 'AA',  // Banco Consorcio — Feller
  59: 'AA',  // BTG Pactual Chile — Feller
  60: 'AAA', // China Construction Bank Agencia CL — Feller
  61: 'AAA', // Bank of China Agencia CL — Feller
  62: 'AA-', // Tanner Banco Digital — Humphreys / ICR
};

/**
 * Perspectiva / calificadora (Chile). Tooltip en Banking System y Config.
 */
export const BANK_RATINGS_CL_META = Object.freeze({
  14: {
    outlook: 'Estable',
    agency: 'Fitch Chile / ICR',
    analysis:
      'Solvencia local AAA(cl) / AAA. Fitch Chile (largo plazo) e ICR confirman la nota máxima; respaldo de The Bank of Nova Scotia.',
  },
  1: {
    outlook: 'Estable',
    agency: 'Feller Rate',
    analysis: 'Máxima categoría de solvencia local (AAA) con perspectivas estables.',
  },
  12: {
    outlook: 'Estable',
    agency: 'Feller Rate',
    analysis: 'Banco público soberano; solvencia AAA con perspectivas estables.',
  },
  16: {
    outlook: 'Estable',
    agency: 'Feller Rate',
    analysis: 'Solvencia AAA (Feller); una de las franquicias privadas de mayor escala en Chile.',
  },
  37: {
    outlook: 'Estable',
    agency: 'Feller Rate',
    analysis: 'Solvencia AAA; filial chilena de Banco Santander S.A.',
  },
  39: {
    outlook: 'Estable',
    agency: 'Feller Rate',
    analysis: 'Solvencia AAA; franquicia Itaú en Chile.',
  },
  28: {
    outlook: 'Estable',
    agency: 'Feller Rate',
    analysis: 'Solvencia AA+ (Feller); en proceso de integración con Banco Security.',
  },
  49: {
    outlook: 'Estable',
    agency: 'ICR',
    analysis:
      'ICR subió la solvencia a AA+ tras el acuerdo de fusión BICECORP / Grupo Security.',
  },
  53: {
    outlook: 'Estable',
    agency: 'Humphreys / Fitch / ICR',
    analysis: 'Banco Ripley Chile en AA- (distinto de Ripley Corp / Ripley Chile retail).',
  },
  62: {
    outlook: 'Estable',
    agency: 'Humphreys / ICR',
    analysis: 'Tanner Banco Digital clasificado en AA- tras el inicio de operaciones bancarias.',
  },
  59: {
    outlook: 'Estable',
    agency: 'Feller Rate',
    analysis: 'Solvencia AA; banco chileno del grupo BTG Pactual.',
  },
});

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
    outlook: 'Estable',
    agency: 'Fitch / BRC',
    analysis:
      'AAA(col) nacional con perspectiva estable (Fitch). El IDR internacional mantiene outlook negativo por el soberano; la nota local sigue en la máxima categoría.',
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
/** Same mark as dashboard brand / light theme (blue BTG on white square). */
export const BTG_LOGO_LIGHT_SRC = 'assets/btg-logo-light.png';
/** Blue wordmark (transparent) — landing circle / dark-friendly accents. */
export const BTG_LOGO_BLUE_SRC = 'assets/logos/logo-btg.png';
