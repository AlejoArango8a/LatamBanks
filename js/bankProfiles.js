// ============================================================
// Bank profiles — curated executive briefs (country → code → meta)
// Missing banks fall back to a generated sketch from live ST data.
// ============================================================

/**
 * @typedef {object} BankProfile
 * @property {string} [legalName]
 * @property {string} [shortName]
 * @property {string} [hq]
 * @property {string} [founded]
 * @property {string} [ownership]     // public / private / state / cooperative
 * @property {string} [controlling]   // controlling shareholder / group
 * @property {string[]} [shareholders]
 * @property {string} [history]       // 2–4 short sentences
 * @property {string} [context]       // competitive positioning
 * @property {{agency:string, rating:string, outlook?:string}[]} [ratings]
 * @property {string} [website]
 * @property {string} [irUrl]
 * @property {{title:string, url:string, source?:string, date?:string}[]} [news]
 */

/** @type {Record<string, Record<number, BankProfile>>} */
export const BANK_PROFILES = {
  chile: {
    59: {
      shortName: 'Banco de Chile',
      legalName: 'Banco de Chile',
      hq: 'Santiago, Chile',
      founded: '1893',
      ownership: 'Public (SSE: CHILE)',
      controlling: 'LQ Inversiones Financieras / Quiñenco–Citigroup structure',
      shareholders: ['LQ Inversiones Financieras', 'Citigroup (via joint control arrangements)', 'Free float'],
      history: 'One of Chile’s oldest commercial banks. Combines a large retail franchise with corporate and treasury businesses. Part of the Quiñenco financial ecosystem with historical Citigroup ties.',
      context: 'Top-tier Chilean private bank by equity and loans; core competitor to Santander, BCI and Itaú.',
      website: 'https://www.bancochile.cl',
      irUrl: 'https://www.bancochile.cl',
      news: [
        { title: 'Banco de Chile — news search', url: 'https://news.google.com/search?q=Banco%20de%20Chile', source: 'Google News' },
      ],
    },
    37: {
      shortName: 'Santander Chile',
      legalName: 'Banco Santander-Chile',
      hq: 'Santiago, Chile',
      founded: '1978 (Santander franchise in Chile)',
      ownership: 'Public subsidiary of Banco Santander (Spain)',
      controlling: 'Banco Santander S.A.',
      history: 'Chilean unit of the Santander Group. Broad retail and corporate franchise with strong digital and consumer lending presence.',
      context: 'Usually among the largest private banks in Chile by assets and customers.',
      website: 'https://banco.santander.cl',
      news: [{ title: 'Santander Chile — news', url: 'https://news.google.com/search?q=Santander%20Chile%20banco', source: 'Google News' }],
    },
  },
  colombia: {
    66: {
      shortName: 'BTG Pactual Colombia',
      legalName: 'Banco BTG Pactual Colombia',
      hq: 'Bogotá, Colombia',
      ownership: 'Subsidiary of BTG Pactual',
      controlling: 'BTG Pactual',
      history: 'Investment-banking led franchise of BTG Pactual in Colombia, expanded into commercial banking and wealth platforms.',
      context: 'Niche corporate / capital-markets oriented bank versus large retail incumbents (Bancolombia, Davivienda, Bogotá).',
      website: 'https://www.btgpactual.com.co',
      news: [{ title: 'BTG Pactual Colombia — news', url: 'https://news.google.com/search?q=BTG%20Pactual%20Colombia', source: 'Google News' }],
    },
    7: {
      shortName: 'Bancolombia',
      legalName: 'Bancolombia S.A.',
      hq: 'Medellín, Colombia',
      founded: '1945',
      ownership: 'Public (BVC / NYSE: CIB ADR)',
      controlling: 'Grupo Sura / Grupo Argos ecosystem (significant influence)',
      history: 'Colombia’s largest bank by assets. Universal bank with retail, SME, corporate and Central-American affiliates.',
      context: 'Systemically important Colombian bank; primary peer set is Bogotá, Davivienda and Occidente.',
      website: 'https://www.bancolombia.com',
      irUrl: 'https://www.grupobancolombia.com/investor-relations',
      news: [{ title: 'Bancolombia — news', url: 'https://news.google.com/search?q=Bancolombia', source: 'Google News' }],
    },
  },
  brasil: {
    1000080336: {
      shortName: 'BTG Pactual',
      legalName: 'Banco BTG Pactual S.A.',
      hq: 'São Paulo, Brazil',
      founded: '1983',
      ownership: 'Public (B3: BPAC11)',
      controlling: 'Partnership / controlling group around founding partners',
      shareholders: ['Controlling partners', 'Free float (units BPAC11)'],
      history: 'Leading Brazilian investment bank that expanded into wealth, asset management and commercial banking. Listed via units on B3.',
      context: 'Competes with Itaú BBA, XP and global bulge brackets in IB/wealth; growing retail digital franchise.',
      website: 'https://www.btgpactual.com',
      irUrl: 'https://ri.btgpactual.com',
      news: [{ title: 'BTG Pactual — news', url: 'https://news.google.com/search?q=BTG%20Pactual', source: 'Google News' }],
    },
    1000080099: {
      shortName: 'Itaú Unibanco',
      legalName: 'Itaú Unibanco Holding S.A.',
      hq: 'São Paulo, Brazil',
      founded: '2008 merger (Itaú 1945 / Unibanco 1924 roots)',
      ownership: 'Public (B3 / NYSE: ITUB)',
      controlling: 'Itaúsa / family control structure',
      history: 'Largest private bank in Brazil after the Itaú–Unibanco merger. Universal bank with deep retail and wholesale franchises across LatAm.',
      context: 'Primary peer of Bradesco and Banco do Brasil in the Brazilian commercial banking oligopoly.',
      website: 'https://www.itau.com.br',
      irUrl: 'https://www.itau.com.br/relacoes-com-investidores',
      news: [{ title: 'Itaú Unibanco — news', url: 'https://news.google.com/search?q=Ita%C3%BA%20Unibanco', source: 'Google News' }],
    },
  },
  peru: {
    3: {
      shortName: 'BCP',
      legalName: 'Banco de Crédito del Perú',
      hq: 'Lima, Peru',
      founded: '1889',
      ownership: 'Subsidiary of Credicorp',
      controlling: 'Credicorp Ltd.',
      history: 'Peru’s largest bank. Flagship of Credicorp with nationwide retail and corporate coverage.',
      context: 'Leads Peruvian banking by loans and deposits; peers include Interbank, BBVA Perú and Scotiabank Perú.',
      website: 'https://www.viabcp.com',
      irUrl: 'https://www.credicorp.com',
      news: [{ title: 'BCP / Credicorp — news', url: 'https://news.google.com/search?q=Banco%20de%20Cr%C3%A9dito%20del%20Per%C3%BA%20OR%20Credicorp', source: 'Google News' }],
    },
  },
  uruguay: {
    1: {
      shortName: 'BROU',
      legalName: 'Banco de la República Oriental del Uruguay',
      hq: 'Montevideo, Uruguay',
      founded: '1896',
      ownership: 'State-owned',
      controlling: 'Oriental Republic of Uruguay',
      history: 'Uruguay’s largest bank and the main public commercial bank, with a broad retail and government-related franchise.',
      context: 'Systemically important; peers include Itaú Uruguay, Santander and Scotiabank.',
      website: 'https://www.brou.com.uy',
      news: [{ title: 'BROU — news', url: 'https://news.google.com/search?q=BROU%20banco%20Uruguay', source: 'Google News' }],
    },
  },
  argentina: {
    // Galicia — code depends on BCRA catalog; soft-match by name in resolver
  },
  mexico: {
    12: {
      shortName: 'BBVA México',
      legalName: 'BBVA México, S.A.',
      hq: 'Mexico City, Mexico',
      ownership: 'Subsidiary of BBVA (Spain)',
      controlling: 'Banco Bilbao Vizcaya Argentaria, S.A.',
      history: 'Largest bank in Mexico by many franchise metrics after the BBVA Bancomer integration. Universal bank with deep retail penetration.',
      context: 'Competes with Banorte, Santander México, Citibanamex and HSBC México.',
      website: 'https://www.bbva.mx',
      news: [{ title: 'BBVA México — news', url: 'https://news.google.com/search?q=BBVA%20M%C3%A9xico%20banco', source: 'Google News' }],
    },
  },
  usa: {
    // Soft-filled via name match for JPM / BAC etc.
  },
};

const NAME_ALIASES = [
  { country: 'argentina', re: /galicia/i, profile: {
    shortName: 'Banco Galicia',
    legalName: 'Banco de Galicia y Buenos Aires S.A.U.',
    hq: 'Buenos Aires, Argentina',
    ownership: 'Subsidiary of Grupo Financiero Galicia',
    controlling: 'Grupo Financiero Galicia',
    history: 'One of Argentina’s leading private banks with a large retail and SME franchise.',
    context: 'Peers include Santander Río, BBVA Argentina, Macro and Nación (public).',
    website: 'https://www.galicia.ar',
    news: [{ title: 'Banco Galicia — news', url: 'https://news.google.com/search?q=Banco%20Galicia%20Argentina', source: 'Google News' }],
  }},
  { country: 'usa', re: /jpmorgan|jp morgan|chase/i, profile: {
    shortName: 'JPMorgan Chase',
    legalName: 'JPMorgan Chase Bank, N.A.',
    hq: 'New York, USA',
    founded: '1799 / 2000 (Chase–JPM heritage)',
    ownership: 'Public (NYSE: JPM) — bank subsidiary of JPMorgan Chase & Co.',
    controlling: 'JPMorgan Chase & Co.',
    history: 'Largest U.S. bank by assets. Universal bank spanning consumer, commercial, markets and investment banking.',
    context: 'G-SIB; peers include Bank of America, Citibank and Wells Fargo.',
    website: 'https://www.jpmorganchase.com',
    irUrl: 'https://www.jpmorganchase.com/ir',
    news: [{ title: 'JPMorgan — news', url: 'https://news.google.com/search?q=JPMorgan%20Chase', source: 'Google News' }],
  }},
  { country: 'usa', re: /bank of america|bofa/i, profile: {
    shortName: 'Bank of America',
    legalName: 'Bank of America, N.A.',
    hq: 'Charlotte, USA',
    ownership: 'Public (NYSE: BAC)',
    controlling: 'Bank of America Corporation',
    history: 'One of the largest U.S. consumer and commercial banks, with a nationwide branch and digital franchise.',
    website: 'https://www.bankofamerica.com',
    irUrl: 'https://investor.bankofamerica.com',
    news: [{ title: 'Bank of America — news', url: 'https://news.google.com/search?q=Bank%20of%20America', source: 'Google News' }],
  }},
];

/**
 * @param {string} countryKey
 * @param {number} code
 * @param {string} [displayName]
 * @returns {BankProfile}
 */
export function resolveBankProfile(countryKey, code, displayName = '') {
  const byCode = BANK_PROFILES[countryKey]?.[code];
  if (byCode) return { ...byCode, shortName: byCode.shortName || displayName };

  const name = displayName || '';
  for (const alias of NAME_ALIASES) {
    if (alias.country === countryKey && alias.re.test(name)) {
      return { ...alias.profile };
    }
  }

  const q = encodeURIComponent(name || `bank ${code}`);
  return {
    shortName: displayName || `Bank ${code}`,
    legalName: displayName || `Institution ${code}`,
    history: 'Curated narrative not yet loaded for this institution. Snapshot below uses supervisory figures already in LatamBanks.',
    context: 'Select peers in Bank Comparison to benchmark franchise size and profitability.',
    news: [
      { title: `Recent news — ${displayName || code}`, url: `https://news.google.com/search?q=${q}`, source: 'Google News' },
    ],
    website: undefined,
  };
}
