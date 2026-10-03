// ============================================================
// Asset composition — how a bank's assets are split.
//
// Asset Quality keeps the credit-quality sheet. This module is the cut that
// comes first: where the money sits. Every country only exposes a lens the
// regulator actually publishes. A missing cut stays selectable and says why,
// instead of inventing a mortgage book, a residency flag, or a currency column.
//
// Lenses
//   business   mutually exclusive asset groups that should foot to total assets
//   currency   reporting-currency columns of that same balance (UY, CL)
//   residency  borrower residency, and only of the credit book (UY, BR)
//   credit     product mix of the loan book where the regulator prints one
// ============================================================
import {
  aqPct,
  aqSum,
  CL_AQ_INSTRUMENTS,
  CO_AQ_INSTRUMENTS,
  PE_AQ_INSTRUMENTS,
  PE_AQ_QUALITY,
  UY_AQ_INSTRUMENTS,
  US_AQ_INSTRUMENTS,
} from './aqCuentas.js?v=bmon105';

export const ASSET_LENSES = [
  { key: 'business', label: 'By business' },
  { key: 'currency', label: 'By currency' },
  { key: 'residency', label: 'By residency' },
  { key: 'credit', label: 'By credit type' },
  { key: 'quality', label: 'Credit quality' },
];

const C = {
  cash: '#0d9488',
  cb: '#115e59',
  loans: '#0d3b66',
  securities: '#0284c7',
  fv: '#38bdf8',
  hedge: '#7c3aed',
  subs: '#6d28d9',
  ppe: '#d97706',
  intang: '#ca8a04',
  tax: '#64748b',
  recv: '#94a3b8',
  other: '#78716c',
  residual: '#cbd5e1',
  fx: '#2563eb',
  local: '#0d9488',
  uf: '#0ea5e9',
  tc: '#ea580c',
  foreign: '#b45309',
};

// A line is noise below this share of the denominator. Residual uses the same
// bar so the table foots within 0.2% without a rounding row on every bank.
const SHOW_SHARE = 0.002;

const CL_FIELDS = [
  { key: 'clp', label: 'CLP, not indexed', short: 'CLP', field: 'monto_clp', color: C.local },
  { key: 'uf', label: 'Indexed (UF / IVP)', short: 'UF', field: 'monto_uf', color: C.uf },
  { key: 'tc', label: 'Adjusted by FX rate', short: 'FX-adj', field: 'monto_tc', color: C.tc },
  { key: 'ext', label: 'Foreign currency', short: 'Foreign', field: 'monto_ext', color: C.fx },
];

const UY_FIELDS = [
  { key: 'local', label: 'Pesos (UI sits inside M/N)', short: 'Pesos', field: 'monto_clp', color: C.local },
  { key: 'ext', label: 'Foreign currency', short: 'Foreign', field: 'monto_ext', color: C.fx },
];

function line(key, label, short, codes, color, extra = {}) {
  return { key, label, short, codes, color, ...extra };
}

function unavailable(label, scope, reason, instead, notes = []) {
  return {
    available: false, label, scope, reason, instead, notes, kind: 'unavailable',
  };
}

const UY_BUSINESS_LINES = [
  line('cash', 'Cash and due from banks', 'Cash', ['1.1'], C.cash),
  line('bcu', 'Central Bank of Uruguay', 'BCU', ['1.2'], C.cb),
  line('fvtpl', 'Securities at fair value through P&L', 'FVTPL', ['1.3'], C.securities),
  line('loans', 'Loans (amortized cost)', 'Loans', ['1.4.1', '1.4.2', '1.4.3'], C.loans, {
    // Some filings only print the 1.4 parent. Use it once, and drop the remainder
    // line so the parent is not counted twice.
    emptyFallback: {
      codes: ['1.4'],
      label: 'Amortized-cost assets',
      short: 'Amortized cost',
      suppress: 'acOther',
    },
  }),
  line('acOther', 'Debt and other amortized-cost assets', 'Other AC', null, C.fv, {
    remainderOf: ['1.4'], except: ['1.4.1', '1.4.2', '1.4.3'],
  }),
  line('fvoci', 'Securities at FVOCI', 'FVOCI', ['1.5'], '#0369a1'),
  line('fvopt', 'Fair value option', 'FV option', ['1.6'], '#7dd3fc'),
  line('eqoci', 'Equity instruments (OCI)', 'Equity', ['1.7'], '#1d4ed8'),
  line('hedge', 'Hedge derivatives', 'Hedges', ['1.8'], C.hedge),
  line('sale', 'Assets held for sale', 'For sale', ['1.9'], '#a78bfa'),
  line('subs', 'Subsidiaries and associates', 'Subsidiaries', ['1.10'], C.subs),
  line('pension', 'Pension assets', 'Pension', ['1.11'], '#db2777'),
  line('ppe', 'Property and equipment', 'Premises', ['1.12'], C.ppe),
  line('intang', 'Intangible assets', 'Intangibles', ['1.13'], C.intang),
  line('tax', 'Tax assets', 'Tax', ['1.14'], C.tax),
  line('recv', 'Other receivables', 'Receivables', ['1.15'], C.recv),
  line('other', 'Other assets', 'Other', ['1.16'], C.other),
];

const CL_BUSINESS_LINES = [
  line('cash', 'Cash and deposits in banks', 'Cash', ['105000000'], C.cash),
  line('liq', 'Operations in liquidation', 'Liquidation', ['107000000'], C.cb),
  line('fvtpl', 'Trading book (fair value through P&L)', 'Trading', ['110000000'], C.securities),
  line('fvoci', 'Securities at FVOCI', 'FVOCI', ['120000000'], '#0369a1'),
  line('hedge', 'Hedge derivatives', 'Hedges', ['130000000'], C.hedge),
  line('loans', 'Loans and amortized-cost assets', 'Loans & AC', ['140000000'], C.loans),
  line('subs', 'Investments in subsidiaries', 'Subsidiaries', ['150000000'], C.subs),
  line('intang', 'Intangible assets', 'Intangibles', ['160000000'], C.intang),
  line('ppe', 'Fixed assets', 'Premises', ['170000000'], C.ppe),
  line('tax', 'Deferred tax', 'Tax', ['185000000'], C.tax),
  line('other', 'Other assets', 'Other', ['190000000'], C.other),
];

const CO_BUSINESS_LINES = [
  line('cash', 'Cash and deposits in banks', 'Cash', ['105000'], C.cash),
  line('liq', 'Operations in liquidation', 'Liquidation', ['107000'], C.cb),
  line('fvtpl', 'Securities at fair value through P&L', 'FVTPL', ['110000'], C.securities),
  line('fvoci', 'Securities at FVOCI', 'FVOCI', ['120000'], '#0369a1'),
  line('hedge', 'Hedge derivatives', 'Hedges', ['130000'], C.hedge),
  line('loans', 'Loans (net of deterioro)', 'Loans', ['140000'], C.loans),
  line('subs', 'Subsidiaries and associates', 'Subsidiaries', ['150000'], C.subs),
  line('intang', 'Intangible assets', 'Intangibles', ['160000'], C.intang),
  line('ppe', 'Property and equipment', 'Premises', ['170000'], C.ppe),
  line('invprop', 'Investment property', 'Inv. property', ['175000'], '#b45309'),
  line('tax', 'Deferred tax', 'Tax', ['185000'], C.tax),
  line('other', 'Other assets', 'Other', ['190000'], C.other),
  line('services', 'Services and other contracts', 'Services', ['195000'], C.recv),
];

const PE_BUSINESS_LINES = [
  line('cash', 'Cash and due from banks', 'Cash', ['DISPONIBLE'], C.cash),
  line('interbank', 'Interbank funds', 'Interbank', ['FONDOS_INTERBANCARIOS'], C.cb),
  line('securities', 'Investments (net)', 'Investments', ['INVERSIONES_NETAS'], C.securities),
  line('loans', 'Loans (net of provisions)', 'Loans', ['CREDITOS_NETOS'], C.loans),
  line('recv', 'Accounts receivable (net)', 'Receivables', ['CUENTAS_POR_COBRAR_NETAS_DE_PROVISIONES'], C.recv),
  line('ppe', 'Property and equipment', 'Premises', ['INMUEBLES_MOBILIARIO_Y_EQUIPO_NETO'], C.ppe),
  line('other', 'Other assets', 'Other', ['OTROS_ACTIVOS'], C.other),
];

const BR_BUSINESS_LINES = [
  line('cash', 'Cash (disponibilidades)', 'Cash', ['140198'], C.cash),
  line('interbank', 'Interbank liquidity', 'Interbank', ['140199'], C.cb),
  line('securities', 'Securities (TVM)', 'Securities', ['140200'], C.securities),
  line('deriv', 'Derivatives', 'Derivatives', ['141612'], C.hedge),
  line('loans', 'Loans', 'Loans', ['140205'], C.loans),
  line('leasing', 'Financial leasing', 'Leasing', ['140210'], C.fv),
  line('otherCredit', 'Other credit-like operations', 'Other credit', ['140216'], '#0369a1'),
  line('recv', 'Receivables from payments', 'Receivables', ['145833'], C.recv),
  line('otherReal', 'Other realizable assets', 'Other real.', ['140218'], C.other),
  line('permanent', 'Permanent assets (subsidiaries, premises, intangibles)', 'Permanent', ['140219'], C.subs),
];

const US_BUSINESS_LINES = [
  line('cash', 'Cash and due from banks', 'Cash', ['CHBAL'], C.cash),
  line('securities', 'Securities', 'Securities', ['SC'], C.securities),
  line('loans', 'Net loans and leases', 'Loans', ['LNLS'], C.loans),
  line('other', 'Other assets (not in this FDIC cut)', 'Other', null, C.residual, {
    remainderOf: ['ASSET'], except: ['CHBAL', 'SC', 'LNLS'],
  }),
];

function fromInstruments(defs, colorOf) {
  return defs.map((d) => line(
    d.key,
    d.label,
    d.short || d.label,
    d.codes,
    (colorOf && colorOf[d.key]) || C.loans,
    { foreign: d.group === 'foreign' },
  ));
}

function currencyUnavailable(sentence) {
  return unavailable(
    'By currency',
    'Reporting currency of the asset',
    `${sentence} There is no per-line currency split to chart, so this lens stays empty on purpose.`,
    'business',
  );
}

function residencyUnavailable(who) {
  return unavailable(
    'By residency',
    'Resident and non-resident assets',
    `${who} does not publish a resident / non-resident split of the balance sheet or of the loan book. A foreign-currency column, where it exists, is not the same thing as a non-resident borrower.`,
    'business',
  );
}

const SPECS = {
  UY: {
    business: partition({
      label: 'By business',
      scope: 'Whole balance sheet. Lines are the BCU level-2 asset groups and should add up to total assets.',
      denomLabel: 'assets',
      total: { codes: ['1'] },
      lines: UY_BUSINESS_LINES,
      headlineKey: 'loans',
      headlineLabel: 'Loans / assets',
      notes: [
        '<strong>Loans</strong> are amortized-cost credit to the financial sector, private non-financial residents and non-residents, and the public sector (1.4.1–1.4.3). Debt securities held at amortized cost, when the bank reports them, sit on the next line rather than inside loans.',
        '<strong>Securities</strong> are the fair-value books (FVTPL, FVOCI, fair-value option, equity OCI). <strong>Subsidiaries</strong> are 1.10. The BCU does not publish a mortgage, card or corporate split — that cut is the credit-type lens, and it is empty for Uruguay.',
        'A line below 0.2% of assets is hidden. Anything the groups do not cover shows up as <em>Not in these lines</em>.',
      ],
    }),
    currency: currency({
      scope: 'Whole balance sheet, in the two columns the BCU prints: moneda nacional and moneda extranjera.',
      denomLabel: 'assets',
      total: { codes: ['1'] },
      lines: UY_BUSINESS_LINES,
      fields: UY_FIELDS,
      headlineField: 'ext',
      headlineLabel: 'Foreign-currency share of assets',
      notes: [
        '<strong>Unidades indexadas are not a third column.</strong> The SSF classifies UI-denominated instruments inside moneda nacional and publishes no per-bank UI balance.',
        '<strong>Foreign currency</strong> is Actividad en M/E: every foreign currency, mostly US dollars, measured in pesos. Shares divide by the published total. The BCU rounds each column on its own, so pesos + foreign can miss that total by a thousand pesos a line.',
      ],
    }),
    residency: partition({
      label: 'By residency',
      scope: 'Of the credit book (BCU Anexo 2), not of total assets. Residency and currency are different cuts.',
      denomLabel: 'credit book',
      total: { codes: ['A2_GROSS'] },
      totalMode: 'fallback-sum',
      lines: fromInstruments(UY_AQ_INSTRUMENTS, {
        snfPrivRes: '#0d3b66',
        snfPrivNoRes: '#b45309',
        snfPub: '#0369a1',
        sfLocal: '#0d9488',
        sfExtVinc: '#7c3aed',
        sfExtNoVinc: '#db2777',
        vencidos: '#dc2626',
      }),
      headlineKey: 'snfPrivNoRes',
      headlineLabel: 'Non-resident private credit / credit book',
      notes: [
        'The non-resident stock is <strong>performing</strong> private non-financial credit (Anexo 2 · 1.4). Overdue loans are not split by residency, so this share sits a little below BCU indicator VII.5, which includes them.',
        'Foreign banks (vinculadas and no vinculadas) are a second non-resident exposure. They are not part of the private non-resident ratio.',
        'A bank can be mostly dollarized and barely non-resident. Currency is the other lens.',
      ],
    }),
    credit: unavailable(
      'By credit type',
      'Mortgage, card, corporate and other product lines',
      'The BCU does not publish mortgage, credit-card or corporate loan balances. It classifies credit by <strong>who the borrower is</strong> — resident, non-resident, public sector, banks — which is By residency. Debt securities and subsidiaries are their own lines in By business.',
      'business',
    ),
  },
  CL: {
    business: partition({
      label: 'By business',
      scope: 'Whole balance sheet. Level-1 CMF asset groups, which should add up to total assets.',
      denomLabel: 'assets',
      total: { codes: ['100000000'] },
      lines: CL_BUSINESS_LINES,
      headlineKey: 'loans',
      headlineLabel: 'Loans and amortized-cost assets / assets',
      notes: [
        '<strong>Loans and amortized-cost assets</strong> (140) is one CMF line: the loan book and debt held at amortized cost together. Mortgage, consumer, commercial and due-from-banks are inside it — open <strong>By credit type</strong> to split the loan book.',
        '<strong>Trading</strong> and <strong>FVOCI</strong> are the fair-value securities books. <strong>Subsidiaries</strong> are inversiones en sociedades (150).',
        'Provisions (149) sit inside amortized cost, so this loan line is not a gross colocaciones figure. Gross loans and arrears stay in Credit quality.',
      ],
    }),
    currency: currency({
      scope: 'Whole balance sheet, in the four CMF columns: CLP, UF/IVP, FX-rate adjusted, and foreign currency.',
      denomLabel: 'assets',
      total: { codes: ['100000000'] },
      lines: CL_BUSINESS_LINES,
      fields: CL_FIELDS,
      headlineField: 'ext',
      headlineLabel: 'Foreign-currency share of assets',
      notes: [
        'Amounts are the CMF columns already expressed in pesos. <strong>UF/IVP</strong> is indexed local currency, not foreign currency. <strong>Foreign</strong> is payable in foreign currency.',
        'The foreign-currency share is not a non-resident share. Chile does not publish residency of the borrower.',
      ],
    }),
    residency: residencyUnavailable('The CMF'),
    credit: partition({
      label: 'By credit type',
      scope: 'Of the loan book: commercial, mortgage, consumer, and due from banks.',
      denomLabel: 'loan book',
      total: { codes: ['500000000'] },
      totalMode: 'max',
      lines: fromInstruments(CL_AQ_INSTRUMENTS, {
        comercial: '#0d3b66', vivienda: '#0ea5e9', consumo: '#f59e0b', bancos: '#64748b',
      }),
      headlineKey: 'comercial',
      headlineLabel: 'Commercial loans / loan book',
      notes: [
        'These four lines are the CMF loan segments. Shares use total colocaciones (500) when that stock is larger than the segments, and the segments themselves when due-from-banks sits outside it — so the mix still adds up.',
        'Debt securities and subsidiaries are not loan segments. They are in By business.',
      ],
    }),
  },
  CO: {
    business: partition({
      label: 'By business',
      scope: 'Whole balance sheet. CUIF asset groups, which should add up to total assets.',
      denomLabel: 'assets',
      total: { codes: ['100000'] },
      lines: CO_BUSINESS_LINES,
      headlineKey: 'loans',
      headlineLabel: 'Net loans / assets',
      notes: [
        '<strong>Loans</strong> are CUIF 140000, already <strong>net of deterioro</strong>. Commercial, consumer, mortgage, employee and microcredit portfolios are gross and live in By credit type — they will not add up to this net line.',
        'Deterioro families 148 and 149 are not added again. Securities are the FVTPL and FVOCI lines. Subsidiaries are 150000.',
      ],
    }),
    currency: currencyUnavailable('The SFC CUIF statements we load are a single column in Colombian pesos.'),
    residency: residencyUnavailable('The SFC'),
    credit: partition({
      label: 'By credit type',
      scope: 'Of the gross loan portfolios: commercial, consumer, housing, employees, microcredit.',
      denomLabel: 'gross portfolios',
      totalMode: 'sum',
      lines: fromInstruments(CO_AQ_INSTRUMENTS, {
        comercial: '#0d3b66', consumo: '#f59e0b', vivienda: '#0ea5e9', empleados: '#0d9488', microcredito: '#7c3aed',
      }),
      headlineKey: 'comercial',
      headlineLabel: 'Commercial portfolio / gross portfolios',
      notes: [
        'Shares are of these five <strong>gross</strong> portfolios. Deterioro sits outside them, so the stocks will not add up to net loans (140000) in By business.',
      ],
    }),
  },
  PE: {
    business: partition({
      label: 'By business',
      scope: 'Whole balance sheet. SBS asset groups, which should add up to total assets.',
      denomLabel: 'assets',
      total: { codes: ['TOTAL_ACTIVO'] },
      lines: PE_BUSINESS_LINES,
      headlineKey: 'loans',
      headlineLabel: 'Net loans / assets',
      notes: [
        '<strong>Loans</strong> are créditos netos. Current, refinanced and past-due are inside that line, so they are not added again. Product detail (mortgage, card, trade finance) is By credit type.',
        'Investments are the securities book. The SBS file has no separate subsidiaries line.',
      ],
    }),
    currency: currencyUnavailable('The SBS balance we load is a single column in soles.'),
    residency: residencyUnavailable('The SBS'),
    credit: partition({
      label: 'By credit type',
      scope: 'Of the gross loan book: the SBS product lines, plus whatever those lines do not cover.',
      denomLabel: 'gross loans',
      total: { codes: PE_AQ_QUALITY.gross },
      lines: [
        ...fromInstruments(PE_AQ_INSTRUMENTS, {
          prestamos: '#0d3b66',
          hipotecarios: '#0ea5e9',
          tarjetas: '#f59e0b',
          leasing: '#0d9488',
          comercioExterior: '#7c3aed',
          descuentos: '#0369a1',
          factoring: '#db2777',
        }),
        line('other', 'Other / unallocated', 'Other', null, C.residual, {
          remainderOf: PE_AQ_QUALITY.gross,
          except: PE_AQ_INSTRUMENTS.flatMap((d) => d.codes),
        }),
      ],
      headlineKey: 'hipotecarios',
      headlineLabel: 'Mortgages / gross loans',
      notes: [
        'The named products do <strong>not</strong> add up to gross loans. Créditos por liquidar and anything else the SBS leaves unnamed is the Other line, not a forced 100%.',
      ],
    }),
  },
  BR: {
    business: partition({
      label: 'By business',
      scope: 'Whole balance sheet. Cosif asset groups, which should add up to total assets.',
      denomLabel: 'assets',
      total: { codes: ['140220'], legacy: ['78182'] },
      lines: BR_BUSINESS_LINES,
      headlineKey: 'loans',
      headlineLabel: 'Loans / assets',
      notes: [
        '<strong>Loans</strong>, <strong>leasing</strong> and <strong>other credit-like operations</strong> are separate Cosif groups. Securities are TVM. Subsidiaries, premises and intangibles are together in <strong>permanent assets</strong> — Bacen does not split that group in this feed.',
        'Older filings may only carry the legacy total (78182) and not these groups. What the groups miss shows up as <em>Not in these lines</em>.',
      ],
    }),
    currency: currencyUnavailable('IF.data Cosif stocks are a single column in reais.'),
    residency: partition({
      label: 'By residency',
      scope: 'Of the SCR credit book, not of total assets. Domestic regions versus loans booked abroad.',
      denomLabel: 'SCR credit book',
      total: { codes: ['24454'] },
      totalMode: 'fallback-sum',
      lines: [
        line('domestic', 'Domestic (all regions)', 'Domestic', ['23358', '23362', '23360', '23359', '23361', '24449'], C.loans),
        line('exterior', 'Overseas (exterior)', 'Exterior', ['23383'], C.foreign),
      ],
      headlineKey: 'exterior',
      headlineLabel: 'Overseas credit / SCR book',
      notes: [
        '<strong>Exterior</strong> is the SCR overseas book, the closest published stand-in for non-resident exposure. It is not a legal residency flag, and it is not a currency split.',
        'The regional detail (Sudeste, Sul, and the rest) stays in Credit quality. This lens only answers domestic versus overseas.',
      ],
    }),
    credit: unavailable(
      'By credit type',
      'Mortgage, card, corporate and other product lines',
      'This Bacen feed does not publish a mortgage, card or corporate product mix. <strong>By business</strong> separates loans, leasing, securities and permanent assets (where subsidiaries sit). Domestic versus overseas is By residency.',
      'business',
    ),
  },
  US: {
    business: partition({
      label: 'By business',
      scope: 'Whole balance sheet, in the FDIC cut we store: cash, securities, loans, and everything else.',
      denomLabel: 'assets',
      total: { codes: ['ASSET'] },
      lines: US_BUSINESS_LINES,
      headlineKey: 'loans',
      headlineLabel: 'Net loans / assets',
      notes: [
        'BankFind financials in this cut are <strong>cash</strong> (CHBAL), <strong>securities</strong> (SC) and <strong>net loans and leases</strong> (LNLS). Premises, trading assets, goodwill and subsidiaries are not separate lines — they sit in Other assets.',
        'Real estate, C&amp;I, consumer and the other loan categories are inside net loans. Open By credit type to split them.',
      ],
    }),
    currency: currencyUnavailable('The FDIC slice we load has no borrower-currency columns.'),
    residency: residencyUnavailable('BankFind'),
    credit: partition({
      label: 'By credit type',
      scope: 'Of net loans and leases: the FDIC loan categories.',
      denomLabel: 'net loans',
      total: { codes: ['LNLS'] },
      lines: [
        ...fromInstruments(US_AQ_INSTRUMENTS, {
          re: '#0d3b66', ci: '#0284c7', con: '#f59e0b', ag: '#16a34a', dep: '#64748b', muni: '#7c3aed', fg: '#b45309',
        }),
        line('other', 'Other / residual', 'Other', null, C.residual, {
          remainderOf: ['LNLS'],
          except: US_AQ_INSTRUMENTS.flatMap((d) => d.codes),
        }),
      ],
      headlineKey: 're',
      headlineLabel: 'Real estate loans / net loans',
      notes: [
        'Credit cards and auto loans nest under <strong>Consumer</strong> in this cut. Foreign governments are a borrower class, not a residency split of the whole bank.',
      ],
    }),
  },
};

function partition(spec) {
  return {
    available: true,
    kind: 'partition',
    totalMode: 'published',
    ...spec,
  };
}

function currency(spec) {
  return {
    available: true,
    kind: 'currency',
    label: 'By currency',
    totalMode: 'published',
    ...spec,
  };
}

function lensMap(iso) {
  return SPECS[iso] || null;
}

export function lensSpec(iso, key) {
  if (key === 'quality') {
    return {
      available: true,
      kind: 'quality',
      label: 'Credit quality',
      scope: 'Credit quality of the loan book — mix, the country lens, and NPL.',
    };
  }
  const map = lensMap(iso);
  if (!map || !map[key]) {
    return unavailable('This cut', 'Asset composition', 'This country has no asset-composition data yet.', 'quality');
  }
  return map[key];
}

function codesOf(entry) {
  if (!entry) return [];
  return [
    ...(entry.codes || []),
    ...(entry.legacy || []),
    ...(entry.remainderOf || []),
    ...(entry.except || []),
  ];
}

/** Accounts to union into the Asset Quality fetch so a lens switch does not refetch. */
export function lensAccountsFor(iso) {
  const map = lensMap(iso);
  const b1 = new Set();
  if (!map) return { b1: [] };
  Object.values(map).forEach((spec) => {
    if (!spec?.available) return;
    codesOf(spec.total).forEach((c) => b1.add(String(c)));
    (spec.lines || []).forEach((ln) => codesOf(ln).forEach((c) => b1.add(String(c))));
  });
  return { b1: [...b1] };
}

function sumCodes(rows, codes, periodo, field) {
  if (!codes?.length) return 0;
  return aqSum(rows, codes, periodo, field);
}

/**
 * Line stock, including the Uruguay fallback that substitutes parent 1.4 when
 * the loan children are absent — and zeroes the sibling that would otherwise
 * repeat that parent.
 */
function amount(rows, spec, entry, periodo, field = 'monto_total') {
  if (!entry) return 0;
  if (entry.emptyFallback) {
    const primary = lineAmount(rows, entry, periodo, field);
    if (primary !== 0) return primary;
    return lineAmount(rows, entry.emptyFallback, periodo, field);
  }
  const owner = (spec?.lines || []).find((ln) => ln.emptyFallback?.suppress === entry.key);
  if (owner) {
    const primary = lineAmount(rows, owner, periodo, field);
    if (primary === 0 && lineAmount(rows, owner.emptyFallback, periodo, field) !== 0) return 0;
  }
  return lineAmount(rows, entry, periodo, field);
}

function usesFallback(rows, entry, periodo) {
  if (!entry?.emptyFallback) return false;
  return lineAmount(rows, entry, periodo) === 0
    && lineAmount(rows, entry.emptyFallback, periodo) !== 0;
}

/** Primary codes, then the legacy code when the primary is zero for that period. */
export function lineAmount(rows, entry, periodo, field = 'monto_total') {
  if (!entry) return 0;
  if (entry.remainderOf) {
    const parent = sumCodes(rows, entry.remainderOf, periodo, field);
    // No parent on this filing: the children already stand as their own lines.
    if (parent === 0) return 0;
    const kids = sumCodes(rows, entry.except, periodo, field);
    const gap = parent - kids;
    const scale = Math.max(Math.abs(parent), 1);
    if (Math.abs(gap) / scale < SHOW_SHARE) return 0;
    return gap;
  }
  const primary = sumCodes(rows, entry.codes, periodo, field);
  if (primary !== 0 || !entry.legacy?.length) return primary;
  return sumCodes(rows, entry.legacy, periodo, field);
}

function denomAt(rows, spec, periodo, lineValues) {
  const published = spec.total
    ? lineAmount(rows, spec.total, periodo)
    : 0;
  const summed = (lineValues || spec.lines).reduce((s, lv) => {
    const v = typeof lv === 'number' ? lv : amount(rows, spec, lv, periodo);
    return s + (v > 0 ? v : 0);
  }, 0);
  if (spec.totalMode === 'sum') return summed;
  if (spec.totalMode === 'max') return Math.max(published, summed);
  if ((spec.totalMode === 'fallback-sum' || spec.totalFallback === 'sum') && published <= 0) {
    return summed;
  }
  return published;
}

function showLine(value, denom) {
  if (!Number.isFinite(value) || value === 0) return false;
  if (!denom) return true;
  return Math.abs(value) / Math.abs(denom) >= SHOW_SHARE;
}

function capSeries(series) {
  const live = series.filter((s) => (s.values || []).some((v) => Math.abs(v) > 0));
  const CAP = 8;
  if (live.length <= CAP) return live;
  const ranked = [...live].sort((a, b) => {
    const av = Math.abs(a.values[a.values.length - 1] || 0);
    const bv = Math.abs(b.values[b.values.length - 1] || 0);
    return bv - av;
  });
  const top = ranked.slice(0, CAP - 1);
  const rest = ranked.slice(CAP - 1);
  const n = top[0].values.length;
  const values = Array.from({ length: n }, (_, i) => rest.reduce((s, g) => s + (g.values[i] || 0), 0));
  top.push({
    key: 'smaller', label: 'Smaller lines', short: 'Smaller', color: C.residual, values,
  });
  return top;
}

function snapshotLines(rows, spec, periodo) {
  const raw = (spec.lines || []).map((ln) => {
    const fallback = usesFallback(rows, ln, periodo);
    return {
      ...ln,
      value: amount(rows, spec, ln, periodo),
      label: fallback ? ln.emptyFallback.label : ln.label,
      short: fallback ? ln.emptyFallback.short : ln.short,
    };
  });
  const denom = denomAt(rows, spec, periodo, raw.map((r) => r.value));
  const used = raw.reduce((s, r) => s + r.value, 0);
  const gap = denom - used;
  if (Number.isFinite(denom) && denom !== 0 && Math.abs(gap) / Math.abs(denom) >= SHOW_SHARE) {
    raw.push({
      key: 'residual',
      label: gap < 0 ? 'Lines exceed the total' : 'Not in these lines',
      short: gap < 0 ? 'Overlap' : 'Residual',
      color: C.residual,
      value: gap,
    });
  }
  return {
    denom,
    lines: raw
      .filter((r) => showLine(r.value, denom))
      .map((r) => ({ ...r, pct: aqPct(r.value, denom) }))
      .sort((a, b) => Math.abs(b.value) - Math.abs(a.value)),
  };
}

function currencyParts(rows, spec, entry, periodo) {
  const parts = (spec.fields || []).map((f) => ({
    ...f,
    value: amount(rows, spec, entry, periodo, f.field),
  }));
  const total = amount(rows, spec, entry, periodo, 'monto_total');
  const fx = parts.find((p) => p.key === 'ext');
  return {
    parts: parts.map((p) => ({ ...p, pct: aqPct(p.value, total) })),
    fxPct: aqPct(fx ? fx.value : 0, total),
    total,
  };
}

/**
 * One bank, one lens, the whole selected range.
 * `rows` are already filtered to that bank (tipo b1).
 * Returns the spec plus `lines` (latest period), `series` (stocks), `pctSeries`,
 * and `headline` (a percent series safe to chart across peers).
 */
export function buildComposition(rows, iso, key, periodos) {
  const spec = lensSpec(iso, key);
  if (!spec?.available || spec.kind === 'quality' || spec.kind === 'unavailable') return spec;
  const periods = periodos || [];
  const latest = periods[periods.length - 1] || null;

  if (spec.kind === 'currency') {
    const totalEntry = spec.total;
    const snap = snapshotLines(rows, { ...spec, kind: 'partition', totalMode: 'published' }, latest);
    const lines = snap.lines.map((ln) => {
      const entry = spec.lines.find((s) => s.key === ln.key);
      if (!entry) return { ...ln, parts: [], fxPct: null };
      const parts = currencyParts(rows, spec, entry, latest);
      return { ...ln, ...parts, value: ln.value, pct: ln.pct };
    });
    const totalParts = currencyParts(rows, spec, totalEntry, latest);
    const series = spec.fields.map((f) => ({
      key: f.key,
      label: f.label,
      short: f.short,
      color: f.color,
      values: periods.map((p) => lineAmount(rows, totalEntry, p, f.field)),
    }));
    const pctSeries = spec.fields.map((f) => ({
      key: f.key,
      label: f.short || f.label,
      short: f.short,
      color: f.color,
      values: periods.map((p) => aqPct(lineAmount(rows, totalEntry, p, f.field), lineAmount(rows, totalEntry, p))),
    }));
    const headline = {
      key: spec.headlineField,
      label: spec.headlineLabel,
      values: periods.map((p) => aqPct(
        lineAmount(rows, totalEntry, p, spec.fields.find((f) => f.key === spec.headlineField)?.field || 'monto_ext'),
        lineAmount(rows, totalEntry, p),
      )),
    };
    return {
      ...spec,
      periodo: latest,
      total: lineAmount(rows, totalEntry, latest),
      denom: lineAmount(rows, totalEntry, latest),
      lines,
      currencyTotal: { ...totalParts, label: 'Total assets', pct: 100 },
      series: capSeries(series),
      pctSeries: capSeries(pctSeries),
      headline,
    };
  }

  const snap = latest ? snapshotLines(rows, spec, latest) : { denom: 0, lines: [] };
  const stockSeries = (spec.lines || []).map((ln) => {
    const fallback = latest ? usesFallback(rows, ln, latest) : false;
    return {
      key: ln.key,
      label: fallback ? ln.emptyFallback.label : ln.label,
      short: fallback ? ln.emptyFallback.short : ln.short,
      color: ln.color,
      values: periods.map((p) => amount(rows, spec, ln, p)),
    };
  });
  const residualValues = periods.map((p) => {
    const raw = (spec.lines || []).map((ln) => amount(rows, spec, ln, p));
    const denom = denomAt(rows, spec, p, raw);
    const used = raw.reduce((s, v) => s + v, 0);
    const gap = denom - used;
    if (!denom || Math.abs(gap) / Math.abs(denom) < SHOW_SHARE) return 0;
    return gap;
  });
  if (residualValues.some((v) => v !== 0)) {
    stockSeries.push({
      key: 'residual',
      label: residualValues[residualValues.length - 1] < 0 ? 'Lines exceed the total' : 'Not in these lines',
      short: 'Residual',
      color: C.residual,
      values: residualValues,
    });
  }
  const pctSeries = stockSeries.map((s) => ({
    ...s,
    values: periods.map((p, i) => {
      const raw = (spec.lines || []).map((ln) => amount(rows, spec, ln, p));
      const denom = denomAt(rows, spec, p, raw);
      return aqPct(s.values[i], denom);
    }),
  }));
  const headlineLine = (spec.lines || []).find((ln) => ln.key === spec.headlineKey) || spec.lines?.[0];
  const headline = {
    key: headlineLine?.key || null,
    label: spec.headlineLabel,
    values: periods.map((p) => {
      const raw = (spec.lines || []).map((ln) => amount(rows, spec, ln, p));
      const denom = denomAt(rows, spec, p, raw);
      return aqPct(headlineLine ? amount(rows, spec, headlineLine, p) : 0, denom);
    }),
  };
  return {
    ...spec,
    periodo: latest,
    total: snap.denom,
    denom: snap.denom,
    lines: snap.lines,
    series: capSeries(stockSeries),
    pctSeries: capSeries(pctSeries),
    headline,
  };
}
