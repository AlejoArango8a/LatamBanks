// ============================================================
// Asset Quality — credit risk sheet
// Chile (CMF b1+c1) · Colombia (CUIF b1) · Peru (SBS b1) · Uruguay (BCU b1+q1)
// Peers: up to 5 banks from the left sidebar Bank Comparison
// ============================================================
import {
  aqSeries,
  aqPct,
  CL_AQ_INSTRUMENTS,
  CL_AQ_QUALITY,
  CL_AQ_GRADES,
  CL_AQ_COLORS,
  clAqAccountsForRun,
  clAqSnapshot,
  CO_AQ_INSTRUMENTS,
  CO_AQ_QUALITY,
  CO_AQ_GRADE_ORDER,
  CO_AQ_COLORS,
  coAqAccountsForRun,
  coAqSnapshot,
  PE_AQ_INSTRUMENTS,
  PE_AQ_LADDER,
  PE_AQ_QUALITY,
  PE_AQ_COLORS,
  peAqAccountsForRun,
  peAqSnapshot,
  UY_AQ_INSTRUMENTS,
  UY_AQ_QUALITY,
  UY_AQ_COLORS,
  uyAqAccountsForRun,
  uyAqSnapshot,
} from '../aqCuentas.js?v=bmon72';
import { ST, datasetIsoCountry } from '../state.js?v=bmon72';
import { fetchData } from '../api.js?v=bmon72';
import { bankName, fmtKPI, periodLabel } from '../format.js?v=bmon72';
import { btgBlue, bankColor } from '../config.js?v=bmon72';
import { drawLineChart, sparseData } from '../charts.js?v=bmon72';

const ASSET_QUALITY_COUNTRIES = new Set(['CL', 'CO', 'PE', 'UY']);
const MAX_COMPARE_ENTITIES = 5;
const MAX_FETCH_BANKS = 5;
const AQ_COMPARE_PALETTE = ['#0d3b66', '#16a34a', '#dc2626', '#0d9488', '#db2777', '#ca8a04', '#0284c7', '#a16207'];

const state = {
  loading: false,
  loaded: false,
  error: null,
  metric: 'mix', // mix | special | npl
  banks: [],
  periodos: [],
  rowsByTipo: {},
  iso: null,
  selectionKey: '',
  compare: false,
  lastEntityId: null,
  chartStyle: 'bars', // bars | lines | area
};

function esc(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function fmtPct(n, digits = 1) {
  if (n == null || !Number.isFinite(Number(n))) return '—';
  return `${Number(n).toFixed(digits)}%`;
}

function selectedBanks() {
  return ST.selectedOrder?.length ? [...ST.selectedOrder] : [...ST.selected];
}

function periodRange() {
  const desde = document.getElementById('selDesde')?.value || ST.desde || ST.periodos[0];
  const hasta = document.getElementById('selHasta')?.value || ST.hasta || ST.periodos[ST.periodos.length - 1];
  return ST.periodos.filter((p) => p >= desde && p <= hasta);
}

function bankDisplayName(code) {
  return bankName(Number(code)) || `Bank ${code}`;
}

function selectionKey() {
  return selectedBanks().slice(0, MAX_COMPARE_ENTITIES).map(Number).join(',');
}

function syncCompareFromSelection({ preferCompareOnMulti = false } = {}) {
  const n = selectedBanks().length;
  if (n <= 1) state.compare = false;
  else if (preferCompareOnMulti) state.compare = true;
}

function entityColor(i) {
  return AQ_COMPARE_PALETTE[i % AQ_COMPARE_PALETTE.length];
}

/** Active peer entities: one per sidebar-selected bank (max 5). */
function resolveEntities() {
  return selectedBanks().slice(0, MAX_COMPARE_ENTITIES).map((code, i) => {
    const n = Number(code);
    const nm = bankDisplayName(n);
    return {
      id: `b:${n}`,
      label: nm,
      short: nm,
      codes: [n],
      color: bankColor(n, i, nm) || entityColor(i),
      kind: 'bank',
    };
  });
}

function banksNeededForEntities(entities) {
  const set = new Set();
  entities.forEach((e) => e.codes.forEach((c) => set.add(Number(c))));
  return [...set].slice(0, MAX_FETCH_BANKS);
}

// ------------------------------------------------------------
// Country configuration
// ------------------------------------------------------------

function stack(defs, rows, periodos, colors) {
  return defs.map((d) => ({
    key: d.key,
    label: d.label,
    color: colors[d.key] || '#64748b',
    values: aqSeries(rows, d.codes, periodos),
  }));
}

function cfg() {
  const iso = datasetIsoCountry();

  if (iso === 'CL') {
    const segCodes = CL_AQ_INSTRUMENTS.flatMap((i) => i.codes);
    const loansCodes = CL_AQ_QUALITY.loans;
    // TOTAL COLOCACIONES when the bank reports it, otherwise the segment sum.
    const clLoansSeries = (r, periodos) => {
      const head = aqSeries(r.b1 || [], loansCodes, periodos);
      const segs = aqSeries(r.b1 || [], segCodes, periodos);
      return head.map((v, i) => (v > 0 ? v : segs[i]));
    };
    return {
      iso: 'CL',
      title: 'Asset Quality',
      eyebrow: 'Chile · Credit risk',
      sub: 'CMF monthly balance (MB1) for the loan book and the complementary credit-quality tree (C1). Compare up to 5 banks via the sidebar Bank Comparison.',
      loadingLabel: 'Chile CMF',
      tipos: ['b1', 'c1'],
      accounts: clAqAccountsForRun,
      instruments: CL_AQ_INSTRUMENTS,
      colors: CL_AQ_COLORS,
      loansLabel: 'Gross loans',
      nplLabel: 'Mora 90+ (857)',
      snapshot: (r, p) => clAqSnapshot(r.b1 || [], r.c1 || [], p),
      loansSeries: clLoansSeries,
      mixStack: (r, periodos) => stack(CL_AQ_INSTRUMENTS, r.b1 || [], periodos, CL_AQ_COLORS),
      nplPctSeries: (r, periodos) => {
        const npl = aqSeries(r.c1 || [], CL_AQ_QUALITY.npl90, periodos);
        const loans = clLoansSeries(r, periodos);
        return npl.map((v, i) => aqPct(v, loans[i]));
      },
      // Special lens — risk-grade migration (851–855) plus the offshore impaired slice.
      specialMetric: 'riskgrade',
      specialLabel: 'Risk grades',
      specialCompareLabel: 'Subestándar + incumplimiento %',
      specialPanelTitle: 'Risk-grade migration',
      specialPanelSub: 'Normal / subestándar / incumplimiento (851–855, evaluación individual + grupal)',
      specialRowsHead: '',
      specialRowsCell: () => '',
      specialStack: (r, periodos) => stack(CL_AQ_GRADES, r.c1 || [], periodos, CL_AQ_COLORS),
      specialPctSeries: (r, periodos) => {
        const atRisk = aqSeries(r.c1 || [], [...CL_AQ_QUALITY.grades.substandard, ...CL_AQ_QUALITY.grades.default], periodos);
        const total = aqSeries(r.c1 || [], CL_AQ_GRADES.flatMap((g) => g.codes), periodos);
        return atRisk.map((v, i) => aqPct(v, total[i]));
      },
      specialKpi: (snap) => ({
        title: 'Impaired portfolio',
        val: fmtPct(snap.impairedPct),
        sub: `Subestándar + incumplimiento ${fmtPct(snap.atRiskPct)}${snap.impairedExt > 0 ? ` · offshore ${fmtPct(snap.impairedExtPct)} of impaired` : ''}`,
      }),
      specialCompareRows: [
        { label: 'Impaired (811) %', fmt: (s) => fmtPct(s?.impairedPct) },
        { label: 'Subestándar + incumplimiento %', fmt: (s) => fmtPct(s?.atRiskPct) },
        { label: 'Offshore impaired %', fmt: (s) => fmtPct(s?.impairedExtPct) },
      ],
      instrumentExtraHead: '<th class="r">UF</th><th class="r">FX</th>',
      instrumentExtraCell: (i) => `<td class="r">${fmtKPI(i.uf || 0)}</td><td class="r">${fmtKPI(i.ext || 0)}</td>`,
      fxKpi: (snap) => ({
        title: 'FX share of loans',
        val: fmtPct(snap.fxPct),
        sub: `UF-indexed ${fmtPct(snap.ufPct)} · CMF currency columns`,
      }),
      honest: (snap) => {
        const out = [];
        if (snap && !snap.nplReported) {
          out.push('No 90+ day arrears reported (<code>857000000 = 0</code>) — this is normal for corporate / investment banks. Lead with the impaired portfolio and subestándar + incumplimiento, not with "NPL 0.00%".');
        }
        if (snap && snap.impairedExt > 0) {
          out.push(`Offshore slice: ${fmtKPI(snap.impairedExt)} of the impaired book (${fmtPct(snap.impairedExtPct)}) sits in the <code>…exterior</code> sub-accounts — real signal for banks with foreign subsidiaries.`);
        }
        return out;
      },
      notes: [
        '<strong>Compare:</strong> overlay up to 5 banks selected in the left sidebar (Bank Comparison).',
        '<strong>Compare mode</strong> overlays each selected bank as its own series (up to 5) from the sidebar Bank Comparison.',
        '<strong>Mora 90+ (<code>857000000</code>)</strong> is the CMF 90-day arrears line at amortized cost. <strong>Cartera deteriorada (<code>811000000</code>)</strong> is wider and is the better lead for wholesale banks.',
        '<strong>Coverage</strong> = provisiones por riesgo de crédito (<code>149000000</code>) ÷ mora 90+. Coverage of the impaired book is shown alongside.',
        '<strong>Currency:</strong> <code>monto_uf</code> is CLP indexed to UF; <code>monto_ext</code> is payable in foreign currency. Chile is the only country with a currency split at loan level.',
      ],
    };
  }

  if (iso === 'CO') {
    const segCodes = CO_AQ_INSTRUMENTS.flatMap((i) => i.codes);
    const gradeCodes = (g) => CO_AQ_INSTRUMENTS.map((i) => i.grades[g]);
    const gradeDefs = CO_AQ_GRADE_ORDER.map((g) => ({
      key: g,
      label: `Category ${g}`,
      codes: gradeCodes(g),
    }));
    return {
      iso: 'CO',
      title: 'Asset Quality',
      eyebrow: 'Colombia · Credit risk',
      sub: 'SFC / CUIF monthly balance. Full A→E risk-category grid by segment, with deterioro per segment. Compare up to 5 banks via the sidebar Bank Comparison.',
      loadingLabel: 'Colombia SFC',
      tipos: ['b1'],
      accounts: coAqAccountsForRun,
      instruments: CO_AQ_INSTRUMENTS,
      colors: CO_AQ_COLORS,
      loansLabel: 'Gross loans',
      nplLabel: 'Cartera de mayor riesgo (C+D+E)',
      snapshot: (r, p) => coAqSnapshot(r.b1 || [], p),
      loansSeries: (r, periodos) => aqSeries(r.b1 || [], segCodes, periodos),
      mixStack: (r, periodos) => stack(CO_AQ_INSTRUMENTS, r.b1 || [], periodos, CO_AQ_COLORS),
      nplPctSeries: (r, periodos) => {
        const risky = aqSeries(r.b1 || [], CO_AQ_QUALITY.higherRisk.flatMap((g) => gradeCodes(g)), periodos);
        const loans = aqSeries(r.b1 || [], segCodes, periodos);
        return risky.map((v, i) => (v > 0 ? aqPct(v, loans[i]) : null));
      },
      // Special lens — A→E migration.
      specialMetric: 'category',
      specialLabel: 'A→E migration',
      specialCompareLabel: 'C+D+E %',
      specialPanelTitle: 'Risk-category grid (A→E)',
      specialPanelSub: 'CUIF categories summed across segments · C+D+E is SFC\u2019s "cartera de mayor riesgo"',
      specialRowsHead: '',
      specialRowsCell: () => '',
      specialStack: (r, periodos) => stack(gradeDefs, r.b1 || [], periodos, CO_AQ_COLORS),
      specialPctSeries: (r, periodos) => {
        const risky = aqSeries(r.b1 || [], CO_AQ_QUALITY.higherRisk.flatMap((g) => gradeCodes(g)), periodos);
        const grid = aqSeries(r.b1 || [], gradeDefs.flatMap((g) => g.codes), periodos);
        return risky.map((v, i) => aqPct(v, grid[i]));
      },
      specialKpi: (snap) => ({
        title: 'Cartera de mayor riesgo',
        val: fmtPct(snap.nplPct),
        sub: snap.hasGrid
          ? `C+D+E ${fmtKPI(snap.npl)} · coverage ${fmtPct(snap.coverage)}`
          : 'A→E grid not in the loaded accounts',
      }),
      specialCompareRows: [
        { label: 'C+D+E %', fmt: (s) => fmtPct(s?.nplPct) },
        { label: 'Deterioro / gross loans', fmt: (s) => fmtPct(s?.allowancePct) },
      ],
      instrumentExtraHead: '<th class="r">C+D+E</th>',
      instrumentExtraCell: (i) => `<td class="r">${fmtPct(i.higherRiskPct)}</td>`,
      fxKpi: () => ({
        title: 'FX share of loans',
        val: '—',
        sub: 'CUIF carries no currency split on the loan book',
      }),
      honest: (snap) => {
        const out = [
          'Deterioro sums the CUIF <strong>parent</strong> accounts only (<code>148700 · 148800 · 148900 · 149100 · 149300 · 149500 · 149800</code>). Summing the whole 148/149 family double counts parents and children and left the previous Colombia NPL roughly 2× too high.',
          'CUIF <code>140000</code> is <strong>net</strong> of deterioro — gross loans here are the sum of the segment accounts.',
        ];
        if (snap && !snap.hasGrid) {
          out.push('The A→E risk-category accounts are not present for this bank / period — showing deterioro coverage of gross loans instead of C+D+E.');
        } else if (snap) {
          const off = (snap.segments || []).filter((s) => s.value > 0 && !s.gradeTie).map((s) => s.short);
          if (off.length) {
            out.push(`A→E categories do not cross-foot to the segment total for <strong>${esc(off.join(', '))}</strong> — treat the migration view as indicative for those segments.`);
          }
        }
        out.push('Colombia has no non-resident borrower split: <code>121035 RESIDENTES DEL EXTERIOR</code> sits in the investment tree, not the loan book.');
        return out;
      },
      notes: [
        '<strong>Compare:</strong> overlay up to 5 banks selected in the left sidebar (Bank Comparison).',
        '<strong>Compare mode</strong> overlays each selected bank as its own series (up to 5) from the sidebar Bank Comparison.',
        '<strong>C+D+E</strong> is SFC\u2019s "cartera de mayor riesgo"; it is wider than a 90-day NPL and is the comparable Colombian metric.',
        '<strong>Coverage</strong> = deterioro (parent accounts) ÷ C+D+E. The contracyclical (<code>148700</code>) and general (<code>149800</code>) components are inside the numerator.',
      ],
    };
  }

  if (iso === 'PE') {
    return {
      iso: 'PE',
      title: 'Asset Quality',
      eyebrow: 'Peru · Credit risk',
      sub: 'SBS Boletín B-2201. Vigentes / refinanciados / atrasados ladder with the judicial-collection tail. Compare up to 5 banks via the sidebar Bank Comparison.',
      loadingLabel: 'Peru SBS',
      tipos: ['b1'],
      accounts: peAqAccountsForRun,
      instruments: PE_AQ_INSTRUMENTS,
      colors: PE_AQ_COLORS,
      loansLabel: 'Gross loans',
      nplLabel: 'Atrasados',
      snapshot: (r, p) => peAqSnapshot(r.b1 || [], p),
      loansSeries: (r, periodos) => aqSeries(r.b1 || [], PE_AQ_QUALITY.gross, periodos),
      mixStack: (r, periodos) => stack(PE_AQ_INSTRUMENTS, r.b1 || [], periodos, PE_AQ_COLORS),
      nplPctSeries: (r, periodos) => {
        const npl = aqSeries(r.b1 || [], PE_AQ_QUALITY.npl, periodos);
        const gross = aqSeries(r.b1 || [], PE_AQ_QUALITY.gross, periodos);
        return npl.map((v, i) => aqPct(v, gross[i]));
      },
      // Special lens — the SBS stage ladder.
      specialMetric: 'stage',
      specialLabel: 'Stage ladder',
      specialCompareLabel: 'Cartera de alto riesgo %',
      specialPanelTitle: 'Vigentes → refinanciados → atrasados',
      specialPanelSub: 'SBS stage ladder · the judicial-collection tail sits inside atrasados',
      specialRowsHead: '',
      specialRowsCell: () => '',
      specialStack: (r, periodos) => stack(PE_AQ_LADDER, r.b1 || [], periodos, PE_AQ_COLORS),
      specialPctSeries: (r, periodos) => {
        const high = aqSeries(r.b1 || [], PE_AQ_QUALITY.highRisk, periodos);
        const gross = aqSeries(r.b1 || [], PE_AQ_QUALITY.gross, periodos);
        return high.map((v, i) => aqPct(v, gross[i]));
      },
      specialKpi: (snap) => ({
        title: 'Cartera de alto riesgo',
        val: fmtPct(snap.highRiskPct),
        sub: `Atrasados + refinanciados · judicial ${fmtPct(snap.judicialPct)} of past due`,
      }),
      specialCompareRows: [
        { label: 'Cartera de alto riesgo %', fmt: (s) => fmtPct(s?.highRiskPct) },
        { label: 'Judicial / past due', fmt: (s) => fmtPct(s?.judicialPct) },
      ],
      instrumentExtraHead: '',
      instrumentExtraCell: () => '',
      fxKpi: () => ({
        title: 'FX share of loans',
        val: '—',
        sub: 'SBS B-2201 carries no currency split',
      }),
      honest: () => [
        'Allowance is <strong>derived as gross − net</strong>: the published <code>PROVISIONES</code> balance line is a scrape artefact (−3.8 M for BBVA against an implied ~3.8 bn allowance, 0 for others).',
        'The sector slugs do not add to gross loans — <code>CREDITOS_POR_LIQUIDAR</code> and other unmapped lines are shown as an explicit <strong>Other</strong> bucket rather than forcing the mix to 100%.',
        'No currency split and no residency split: <code>monto_ext</code> is 0 for Peru.',
      ],
      notes: [
        '<strong>Compare:</strong> overlay up to 5 banks selected in the left sidebar (Bank Comparison).',
        '<strong>Compare mode</strong> overlays each selected bank as its own series (up to 5) from the sidebar Bank Comparison.',
        '<strong>Gross loans</strong> = vigentes + refinanciados/reestructurados + atrasados. <strong>NPL</strong> = atrasados (SBS morosidad).',
        '<strong>Cartera de alto riesgo</strong> adds refinanciados to atrasados — the metric Peruvian analysts quote alongside morosidad.',
      ],
    };
  }

  if (iso === 'UY') {
    const instCodes = UY_AQ_INSTRUMENTS.flatMap((i) => i.codes);
    const domesticCodes = UY_AQ_INSTRUMENTS.filter((i) => i.group === 'domestic').flatMap((i) => i.codes);
    const residencyDefs = [
      { key: 'domestic', label: 'Resident borrowers (SNF res. + público + SF país)', codes: domesticCodes },
      { key: 'snfPrivNoRes', label: 'Private non-financial — NON-RESIDENT', codes: UY_AQ_QUALITY.nonResident },
      { key: 'foreignFis', label: 'Foreign financial institutions (vinculadas + no vinculadas)', codes: UY_AQ_QUALITY.foreignFis },
    ];
    const residencyColors = {
      domestic: UY_AQ_COLORS.snfPrivRes,
      snfPrivNoRes: UY_AQ_COLORS.snfPrivNoRes,
      foreignFis: UY_AQ_COLORS.sfExtNoVinc,
    };
    const snfPrivPub = ['A2_1_3', 'A2_1_4', 'A2_1_5'];
    return {
      iso: 'UY',
      title: 'Asset Quality',
      eyebrow: 'Uruguay · Credit risk & residency',
      sub: 'BCU/SSF Anexo 2 (apertura de créditos y deterioro) plus BCU\u2019s own Anexo 4 ratios. Residency of the borrower — resident vs non-resident — crossed with currency.',
      loadingLabel: 'Uruguay BCU',
      tipos: ['b1', 'q1'],
      accounts: uyAqAccountsForRun,
      instruments: UY_AQ_INSTRUMENTS,
      colors: UY_AQ_COLORS,
      loansLabel: 'Gross credit',
      nplLabel: 'Créditos vencidos',
      snapshot: (r, p) => uyAqSnapshot(r.b1 || [], r.q1 || [], p),
      loansSeries: (r, periodos) => {
        const head = aqSeries(r.b1 || [], UY_AQ_QUALITY.gross, periodos);
        const inst = aqSeries(r.b1 || [], instCodes, periodos);
        return head.map((v, i) => (v > 0 ? v : inst[i]));
      },
      mixStack: (r, periodos) => stack(UY_AQ_INSTRUMENTS, r.b1 || [], periodos, UY_AQ_COLORS),
      nplPctSeries: (r, periodos) => {
        const npl = aqSeries(r.b1 || [], UY_AQ_QUALITY.vencidos, periodos);
        const snf = aqSeries(r.b1 || [], UY_AQ_QUALITY.snf, periodos);
        return npl.map((v, i) => aqPct(v, snf[i]));
      },
      // Special lens — residency (the reason Uruguay is on this sheet).
      specialMetric: 'residency',
      specialLabel: 'Residency lens',
      specialCompareLabel: 'Non-resident %',
      specialPanelTitle: 'Residency × currency',
      specialPanelSub: 'Anexo 2 counterparty stocks · M/N = local (UYU), M/E = FX (≈USD)',
      specialRowsHead: '<th class="r">Local (M/N)</th><th class="r">FX (M/E)</th><th class="r">FX %</th>',
      specialRowsCell: (row) => `<td class="r">${fmtKPI(row.local || 0)}</td><td class="r">${fmtKPI(row.ext || 0)}</td><td class="r">${fmtPct(row.fxPct)}</td>`,
      specialStack: (r, periodos) => stack(residencyDefs, r.b1 || [], periodos, residencyColors),
      specialPctSeries: (r, periodos) => {
        const nores = aqSeries(r.b1 || [], UY_AQ_QUALITY.nonResident, periodos);
        const snf = aqSeries(r.b1 || [], snfPrivPub, periodos);
        return nores.map((v, i) => aqPct(v, snf[i]));
      },
      specialKpi: (snap) => {
        const pub = snap.published?.nonResident;
        return {
          title: 'Non-resident credit',
          val: fmtPct(pub != null ? pub : snap.nonResidentPct, 2),
          sub: pub != null
            ? `BCU Anexo 4 VII.5 · Anexo 2 stock (performing) ${fmtPct(snap.nonResidentSnfPct, 2)}`
            : `Anexo 2 stock · performing non-resident credit only · ${fmtKPI(snap.nonResident)}`,
        };
      },
      specialCompareRows: [
        { label: 'Non-resident % of SNF stock (1.4 ÷ 1.3+1.4+1.5)', fmt: (s) => fmtPct(s?.nonResidentPct, 2) },
        { label: 'Non-resident stock', fmt: (s) => fmtKPI(s?.nonResident) },
        { label: 'Non-resident in FX (M/E)', fmt: (s) => fmtPct(s?.nonResidentExtPct) },
        { label: 'Exposure to foreign FIs', fmt: (s) => fmtKPI(s?.foreignFis) },
      ],
      instrumentExtraHead: '<th class="r">Local</th><th class="r">FX</th>',
      instrumentExtraCell: (i) => `<td class="r">${fmtKPI(i.local || 0)}</td><td class="r">${fmtKPI(i.ext || 0)}</td>`,
      fxKpi: (snap) => ({
        title: 'FX (≈USD) share of credit',
        val: fmtPct(snap.fxPct),
        sub: snap.published?.fxLoans != null
          ? `BCU VII.1 dolarización SNF ${fmtPct(snap.published.fxLoans)}`
          : `SNF gross ${fmtPct(snap.fxSnfPct)} · M/E ≈ USD, not exactly`,
      }),
      publishedRows: (snap) => ([
        { label: 'IV.1 · Morosidad', pub: snap.published?.npl, own: snap.nplPct },
        { label: 'VII.1 · Dolarización de créditos brutos SNF', pub: snap.published?.fxLoans, own: snap.fxSnfPct },
        { label: 'VII.5 · Créditos a no residentes / créditos brutos SNF', pub: snap.published?.nonResident, own: snap.nonResidentSnfPct },
        { label: 'I.2 · Deterioro de créditos vencidos', pub: snap.published?.coverage, own: snap.coverage },
      ]),
      honest: (snap) => {
        const out = [];
        if (snap && snap.loans <= 0) {
          out.push('No <code>A2_*</code> accounts for this bank / period yet — Anexo 2 and Anexo 4 arrive with the <code>uruguay_loader.py</code> re-ingest. Everything below stays empty until then.');
        }
        out.push('Non-resident share from <strong>Anexo 2</strong> covers <strong>performing</strong> credit only (line <code>1.4</code>); BCU\u2019s published <strong>VII.5</strong> — shown alongside — also includes overdue non-resident credit, which Anexo 2 does not split by residency.');
        out.push('<code>1.2.4 vinculadas</code> / <code>1.2.5 no vinculadas</code> is exposure to <strong>foreign banks</strong>, a different concept from non-resident borrowers in the real economy (<code>1.4</code>). They are never added into one "foreign exposure" number here.');
        out.push('Central-bank placements (<code>1.1 BCU</code>) are excluded: Anexo 2 row 11 excludes them and they are liquidity, not credit.');
        if (snap && snap.hasPublished === false) {
          out.push('Published Anexo 4 ratios are shown per bank in Single view; in Compare we show each bank\'s own published ratio (or stock-based recompute) side by side.');
        }
        return out;
      },
      notes: [
        '<strong>Compare:</strong> overlay up to 5 banks selected in the left sidebar (Bank Comparison).',
        '<strong>Compare mode</strong> overlays each selected bank as its own series (up to 5) from the sidebar Bank Comparison.',
        '<strong>Uruguay publishes true residency of the borrower</strong>, not a currency proxy: residency and currency are different stories (a bank can be 53% dollarised and 2% non-resident).',
        '<strong>No sector-of-industry breakdown:</strong> BCU splits credit by counterparty type and residency, not by commercial / consumer / mortgage — Uruguay cannot join a sector-mix chart.',
        '<strong>FX ≈ USD, not exactly:</strong> BCU reports Actividad en M/E (all foreign currency, predominantly USD).',
        '<strong>Anexo 4 ratios</strong> are stored as <code>tipo=\u2019q1\u2019</code> percentages (×100) so no balance aggregation can ever sum them.',
      ],
    };
  }

  return null;
}

// ------------------------------------------------------------
// Data access
// ------------------------------------------------------------

function rowsForCodes(codes) {
  const set = new Set((codes || []).map(Number));
  const out = {};
  Object.entries(state.rowsByTipo).forEach(([tipo, rows]) => {
    out[tipo] = (rows || []).filter((r) => set.has(Number(r.ins_cod)));
  });
  return out;
}

function latestSnapshotFor(codes) {
  const c = cfg();
  if (!c || !codes?.length) return null;
  const lastP = state.periodos[state.periodos.length - 1];
  return c.snapshot(rowsForCodes(codes), lastP);
}

async function loadAssetQualityData() {
  const c = cfg();
  if (!c) return;

  const entities = resolveEntities();
  if (!entities.length) {
    state.error = peerEmptyMessage();
    state.loaded = false;
    render();
    return;
  }

  const banks = banksNeededForEntities(entities);
  const periodos = periodRange();
  if (!banks.length) {
    state.error = 'No banks available for the selected peers.';
    state.loaded = false;
    render();
    return;
  }
  if (!periodos.length) {
    state.error = 'No periods in the selected From/To range.';
    state.loaded = false;
    render();
    return;
  }

  state.loading = true;
  state.error = null;
  state.iso = c.iso;
  if (state.metric !== 'mix' && state.metric !== 'npl') state.metric = 'special';
  render();

  try {
    const accounts = c.accounts();
    const tipos = c.tipos.filter((t) => (accounts[t] || []).length);
    const results = await Promise.all(
      tipos.map((t) => fetchData(t, accounts[t], periodos, banks)),
    );
    const byTipo = {};
    tipos.forEach((t, i) => { byTipo[t] = results[i] || []; });
    state.banks = banks;
    state.periodos = periodos;
    state.rowsByTipo = byTipo;
    const ents = resolveEntities();
    state.lastEntityId = ents[0]?.id || null;
    state.selectionKey = selectionKey();
    state.loaded = true;
  } catch (e) {
    console.error('[assetQuality]', e);
    state.error = String(e.message || e);
    state.loaded = false;
  } finally {
    state.loading = false;
    render();
  }
}

function peerEmptyMessage() {
  return 'Select at least one bank in the sidebar (Bank Comparison), then open Asset Quality.';
}

// ------------------------------------------------------------
// Rendering
// ------------------------------------------------------------

function renderKpis(snap, c) {
  if (!snap) return '';
  const special = c.specialKpi(snap);
  const fx = c.fxKpi(snap);
  const nplSub = snap.nplReported
    ? `${esc(c.nplLabel)} ${fmtKPI(snap.npl)}`
    : 'not reported for this bank';

  return `
    <div class="kpi-grid fa-kpi-grid aq-kpi-grid">
      <div class="kpi-col">
        <div class="kpi-col-title">${esc(c.loansLabel)}</div>
        <div class="kpi blue"><div class="kpi-val">${fmtKPI(snap.loans)}</div>
        <div class="kpi-sub">${esc(periodLabel(snap.periodo))} · net ${fmtKPI(snap.net)}</div></div>
      </div>
      <div class="kpi-col">
        <div class="kpi-col-title">NPL ratio</div>
        <div class="kpi ${snap.nplReported ? 'red' : ''}"><div class="kpi-val">${fmtPct(snap.nplPct, 2)}</div>
        <div class="kpi-sub">${nplSub}</div></div>
      </div>
      <div class="kpi-col">
        <div class="kpi-col-title">Coverage</div>
        <div class="kpi green"><div class="kpi-val">${fmtPct(snap.coverage, 0)}</div>
        <div class="kpi-sub">Allowance ${fmtKPI(snap.allowance)} · ${fmtPct(snap.allowancePct)} of loans</div></div>
      </div>
      <div class="kpi-col">
        <div class="kpi-col-title">${esc(fx.title)}</div>
        <div class="kpi blue"><div class="kpi-val">${fx.val}</div>
        <div class="kpi-sub">${esc(fx.sub)}</div></div>
      </div>
      <div class="kpi-col">
        <div class="kpi-col-title">${esc(special.title)}</div>
        <div class="kpi purple"><div class="kpi-val">${special.val}</div>
        <div class="kpi-sub">${esc(special.sub)}</div></div>
      </div>
    </div>`;
}

function renderHonest(snap, c) {
  const lines = (c.honest ? c.honest(snap) : []).filter(Boolean);
  if (!lines.length) return '';
  return `<ul class="aq-honest">${lines.map((l) => `<li>${l}</li>`).join('')}</ul>`;
}

function renderCompareKpis(entities, c) {
  const lastP = state.periodos[state.periodos.length - 1];
  const snaps = entities.map((e) => ({ e, snap: latestSnapshotFor(e.codes) }));
  const head = snaps.map(({ e }) => `<th class="r">${esc(e.short)}</th>`).join('');
  const row = (label, fmt) => `<tr><td>${esc(label)}</td>${snaps.map(({ snap }) => `<td class="r">${fmt(snap)}</td>`).join('')}</tr>`;
  return `<div class="panel fa-panel" style="margin-bottom:18px;">
    <div class="panel-head"><div>
      <div class="panel-title">Peer snapshot · ${esc(periodLabel(lastP))}</div>
      <div class="panel-sub">Aggregated stocks for groups, then ratios · local reporting units</div>
    </div></div>
    <div class="panel-body" style="overflow-x:auto;padding:0;">
      <table class="data fa-table">
        <thead><tr><th>Metric</th>${head}</tr></thead>
        <tbody>
          ${row(c.loansLabel, (s) => fmtKPI(s?.loans))}
          ${row('NPL ratio', (s) => fmtPct(s?.nplPct, 2))}
          ${row('Coverage', (s) => fmtPct(s?.coverage, 0))}
          ${row('Allowance / loans', (s) => fmtPct(s?.allowancePct))}
          ${c.specialCompareRows.map((r) => row(r.label, r.fmt)).join('')}
        </tbody>
      </table>
    </div>
  </div>`;
}

function renderInstrumentTable(snap, c) {
  if (!snap) return '';
  const loans = snap.loans || 0;
  const rows = (snap.segments || [])
    .filter((i) => i.value !== 0)
    .sort((a, b) => Math.abs(b.value) - Math.abs(a.value));
  const body = rows.map((i) => {
    const pct = i.pct != null ? i.pct : aqPct(i.value, loans);
    const extraCells = c.instrumentExtraCell ? c.instrumentExtraCell(i) : '';
    return `<tr>
      <td><span class="fa-swatch" style="background:${c.colors[i.key] || '#64748b'}"></span>${esc(i.label)}</td>
      <td class="r">${fmtKPI(i.value)}</td>
      <td class="r">${fmtPct(pct)}</td>
      ${extraCells}
    </tr>`;
  }).join('');
  const extraHead = c.instrumentExtraHead || '';
  return `<table class="data fa-table">
    <thead><tr><th>Segment</th><th class="r">Stock</th><th class="r">% of loans</th>${extraHead}</tr></thead>
    <tbody>${body || '<tr><td colspan="6">No loan stocks for this period</td></tr>'}</tbody>
  </table>`;
}

function renderCompareInstrumentTable(entities, c) {
  const snaps = entities.map((e) => ({ e, snap: latestSnapshotFor(e.codes) }));
  const keys = [];
  const seen = new Set();
  snaps.forEach(({ snap }) => {
    (snap?.segments || []).forEach((seg) => {
      if (!seen.has(seg.key) && seg.value !== 0) {
        seen.add(seg.key);
        keys.push(seg);
      }
    });
  });
  keys.sort((a, b) => a.label.localeCompare(b.label));
  const head = snaps.map(({ e }) => `<th class="r" colspan="2">${esc(e.short)}</th>`).join('');
  const sub = snaps.map(() => '<th class="r">Stock</th><th class="r">%</th>').join('');
  const body = keys.map((seg) => {
    const cells = snaps.map(({ snap }) => {
      const row = snap?.segments?.find((i) => i.key === seg.key);
      const v = row?.value || 0;
      const pct = row?.pct != null ? row.pct : aqPct(v, snap?.loans);
      return `<td class="r">${fmtKPI(v)}</td><td class="r">${fmtPct(pct)}</td>`;
    }).join('');
    return `<tr><td><span class="fa-swatch" style="background:${c.colors[seg.key] || '#64748b'}"></span>${esc(seg.label)}</td>${cells}</tr>`;
  }).join('');
  return `<table class="data fa-table">
    <thead>
      <tr><th rowspan="2">Segment</th>${head}</tr>
      <tr>${sub}</tr>
    </thead>
    <tbody>${body || '<tr><td>No segments</td></tr>'}</tbody>
  </table>`;
}

function renderSpecialPanel(snap, c) {
  if (!snap) return '';
  const rows = (snap.specialRows || []).filter((r) => r.value !== 0);
  if (!rows.length) return '';
  const extraHead = c.specialRowsHead || '';
  const body = rows.map((r) => `<tr class="${r.foreign ? 'aq-row-foreign' : ''}">
      <td><span class="fa-swatch" style="background:${c.colors[r.key] || '#64748b'}"></span>${esc(r.label)}</td>
      <td class="r">${fmtKPI(r.value)}</td>
      <td class="r">${fmtPct(r.pct)}</td>
      ${c.specialRowsCell ? c.specialRowsCell(r) : ''}
    </tr>`).join('');
  return `<div class="panel fa-panel" style="margin-top:18px;">
    <div class="panel-head">
      <div>
        <div class="panel-title">${esc(c.specialPanelTitle)} · ${esc(periodLabel(snap.periodo))}</div>
        <div class="panel-sub">${esc(c.specialPanelSub)}</div>
      </div>
    </div>
    <div class="panel-body" style="overflow-x:auto;padding:0;">
      <table class="data fa-table">
        <thead><tr><th>Bucket</th><th class="r">Stock</th><th class="r">Share</th>${extraHead}</tr></thead>
        <tbody>${body}</tbody>
      </table>
    </div>
  </div>`;
}

function renderQualityPanel(snap, c) {
  if (!snap) return '';
  const rows = (snap.quality || []).filter((r) => r.value != null && r.value !== 0);
  if (!rows.length) return '';
  const body = rows.map((r) => `<tr>
      <td>${esc(r.label)}</td>
      <td class="r">${fmtKPI(r.value)}</td>
      <td class="r">${fmtPct(r.pct, 2)}</td>
    </tr>`).join('');
  return `<div class="panel fa-panel" style="margin-top:18px;">
    <div class="panel-head">
      <div>
        <div class="panel-title">Credit quality detail · ${esc(periodLabel(snap.periodo))}</div>
        <div class="panel-sub">Regulator lines as reported · local units · % of ${esc(c.loansLabel.toLowerCase())}</div>
      </div>
    </div>
    <div class="panel-body" style="overflow-x:auto;padding:0;">
      <table class="data fa-table">
        <thead><tr><th>Line</th><th class="r">Amount</th><th class="r">%</th></tr></thead>
        <tbody>${body}</tbody>
      </table>
    </div>
  </div>`;
}

/** Uruguay only: BCU's own Anexo 4 ratios next to the ones we rebuild from stocks. */
function renderPublishedPanel(snap, c) {
  if (!c.publishedRows || !snap || !snap.hasPublished) return '';
  const rows = c.publishedRows(snap).filter((r) => r.pub != null || r.own != null);
  if (!rows.length) return '';
  const body = rows.map((r) => `<tr>
      <td>${esc(r.label)}</td>
      <td class="r">${fmtPct(r.pub, 2)}</td>
      <td class="r">${fmtPct(r.own, 2)}</td>
    </tr>`).join('');
  return `<div class="panel fa-panel" style="margin-top:18px;">
    <div class="panel-head">
      <div>
        <div class="panel-title">BCU Anexo 4 · published vs rebuilt</div>
        <div class="panel-sub">Regulator ratio (tipo q1) against the same ratio recomputed from Anexo 2 stocks</div>
      </div>
    </div>
    <div class="panel-body" style="overflow-x:auto;padding:0;">
      <table class="data fa-table">
        <thead><tr><th>Indicator</th><th class="r">BCU published</th><th class="r">Rebuilt from stocks</th></tr></thead>
        <tbody>${body}</tbody>
      </table>
    </div>
  </div>`;
}

// ------------------------------------------------------------
// Charts
// ------------------------------------------------------------

function drawStackedChart(canvasId, series, title) {
  const canvas = document.getElementById(canvasId);
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const dpr = window.devicePixelRatio || 1;
  const cssW = canvas.clientWidth || 720;
  const cssH = 300;
  canvas.width = Math.floor(cssW * dpr);
  canvas.height = Math.floor(cssH * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, cssW, cssH);

  const periodos = state.periodos;
  const totals = periodos.map((_, i) => series.reduce((s, g) => s + Math.max(0, g.values[i] || 0), 0));
  const maxV = Math.max(1, ...totals);
  const pad = { t: 28, r: 16, b: 48, l: 64 };
  const plotW = cssW - pad.l - pad.r;
  const plotH = cssH - pad.t - pad.b;
  const n = Math.max(1, periodos.length);
  const barW = Math.min(28, (plotW / n) * 0.62);

  ctx.strokeStyle = 'rgba(148,163,184,0.25)';
  ctx.fillStyle = '#94a3b8';
  ctx.font = '11px ui-monospace, SFMono-Regular, Menlo, monospace';
  ctx.textAlign = 'right';
  for (let i = 0; i <= 4; i++) {
    const y = pad.t + (plotH * i) / 4;
    ctx.beginPath();
    ctx.moveTo(pad.l, y);
    ctx.lineTo(pad.l + plotW, y);
    ctx.stroke();
    ctx.fillText(fmtKPI(maxV * (1 - i / 4)), pad.l - 8, y + 4);
  }

  periodos.forEach((p, i) => {
    const cx = pad.l + (i + 0.5) * (plotW / n);
    const x = cx - barW / 2;
    let y = pad.t + plotH;
    series.forEach((g) => {
      const v = Math.max(0, g.values[i] || 0);
      if (!v) return;
      const h = (v / maxV) * plotH;
      y -= h;
      ctx.fillStyle = g.color || '#64748b';
      ctx.fillRect(x, y, barW, Math.max(1, h));
    });
    ctx.fillStyle = '#64748b';
    ctx.font = '10px Inter, "DM Sans", system-ui, sans-serif';
    ctx.textAlign = 'center';
    const label = String(p).length >= 6
      ? `${String(p).slice(4, 6)}/${String(p).slice(2, 4)}`
      : p;
    ctx.fillText(label, cx, cssH - 28);
  });

  ctx.fillStyle = '#475569';
  ctx.font = '600 12px Inter, "DM Sans", system-ui, sans-serif';
  ctx.textAlign = 'left';
  ctx.fillText(title, pad.l, 16);
}

function drawCompareChart(entities, c) {
  const periodos = state.periodos;
  let series;
  let valueScale = 'percent';
  let emptyMessage = 'No comparable series for these peers.';

  if (state.metric === 'mix') {
    valueScale = 'billions';
    series = entities.map((e) => ({
      label: e.short,
      color: e.color,
      data: sparseData(c.loansSeries(rowsForCodes(e.codes), periodos)),
    }));
    emptyMessage = 'No loan stocks for the selected peers.';
  } else if (state.metric === 'npl') {
    series = entities.map((e) => ({
      label: e.short,
      color: e.color,
      data: sparseData(c.nplPctSeries(rowsForCodes(e.codes), periodos).map((v) => (v == null ? null : v))),
    }));
    emptyMessage = 'No NPL series for the selected peers — the regulator may not publish an overdue line for them.';
  } else {
    series = entities.map((e) => ({
      label: e.short,
      color: e.color,
      data: sparseData(c.specialPctSeries(rowsForCodes(e.codes), periodos).map((v) => (v == null ? null : v))),
    }));
    emptyMessage = `No ${c.specialLabel.toLowerCase()} series for the selected peers.`;
  }

  drawLineChart('aqCompareChart', periodos, series, {
    valueScale,
    emptyMessage,
    height: 300,
    style: state.chartStyle || 'bars',
  });
}

function drawNplChart(codes, c) {
  const canvas = document.getElementById('aqNplChart');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const dpr = window.devicePixelRatio || 1;
  const cssW = canvas.clientWidth || 720;
  const cssH = 300;
  canvas.width = Math.floor(cssW * dpr);
  canvas.height = Math.floor(cssH * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, cssW, cssH);

  const rows = rowsForCodes(codes);
  const periodos = state.periodos;
  const npl = c.nplPctSeries(rows, periodos);
  const vals = npl.filter((v) => v != null && Number.isFinite(v));
  if (!vals.length) {
    ctx.fillStyle = '#94a3b8';
    ctx.font = '13px Inter, system-ui, sans-serif';
    ctx.fillText('No NPL series for this bank and period range.', 24, 40);
    return;
  }
  const maxV = Math.max(0.5, ...vals) * 1.2;
  const pad = { t: 28, r: 16, b: 48, l: 48 };
  const plotW = cssW - pad.l - pad.r;
  const plotH = cssH - pad.t - pad.b;
  const n = Math.max(1, periodos.length);

  ctx.strokeStyle = 'rgba(148,163,184,0.25)';
  for (let i = 0; i <= 4; i++) {
    const y = pad.t + (plotH * i) / 4;
    ctx.beginPath();
    ctx.moveTo(pad.l, y);
    ctx.lineTo(pad.l + plotW, y);
    ctx.stroke();
  }

  ctx.beginPath();
  let started = false;
  npl.forEach((v, i) => {
    if (v == null || !Number.isFinite(v)) { started = false; return; }
    const x = pad.l + (i + 0.5) * (plotW / n);
    const y = pad.t + plotH - (Math.max(0, v) / maxV) * plotH;
    if (!started) { ctx.moveTo(x, y); started = true; } else ctx.lineTo(x, y);
  });
  ctx.strokeStyle = btgBlue();
  ctx.lineWidth = 2;
  ctx.stroke();

  npl.forEach((v, i) => {
    if (v == null || !Number.isFinite(v)) return;
    const x = pad.l + (i + 0.5) * (plotW / n);
    const y = pad.t + plotH - (Math.max(0, v) / maxV) * plotH;
    ctx.fillStyle = btgBlue();
    ctx.beginPath();
    ctx.arc(x, y, 3.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#64748b';
    ctx.font = '10px Inter, system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(`${String(periodos[i]).slice(4, 6)}/${String(periodos[i]).slice(2, 4)}`, x, cssH - 28);
  });

  ctx.fillStyle = '#475569';
  ctx.font = '600 12px Inter, system-ui, sans-serif';
  ctx.textAlign = 'left';
  ctx.fillText(`${c.nplLabel} · % of ${c.loansLabel.toLowerCase()}`, pad.l, 16);
}

// ------------------------------------------------------------
// Interaction
// ------------------------------------------------------------

function setMetric(m) {
  state.metric = m;
  render();
}

function setEntity(id) {
  state.lastEntityId = id;
  render();
}

function setCompare(on) {
  state.compare = !!on;
  render();
}

function setChartStyle(style) {
  if (!['bars', 'lines', 'area'].includes(style)) return;
  state.chartStyle = style;
  render();
}

function renderPeerToolbar() {
  const compareBtns = `
    <div class="fa-compare-toggle" role="group" aria-label="View mode">
      <button type="button" class="rcbtn ${!state.compare ? 'active' : ''}" data-aq-compare="0">Single</button>
      <button type="button" class="rcbtn ${state.compare ? 'active' : ''}" data-aq-compare="1">Compare</button>
    </div>`;
  const n = Math.min(selectedBanks().length, MAX_COMPARE_ENTITIES);
  const hint = n
    ? `<div class="fa-peer-hint">${n} bank${n === 1 ? '' : 's'} from the sidebar${ST.compareMode || n === 1 ? '' : ' — turn on <strong>Bank Comparison</strong> to pick up to 5'}.</div>`
    : '<div class="fa-peer-hint">Select banks in the left sidebar. Turn on <strong>Bank Comparison</strong> to graph/table up to 5 at once.</div>';
  return `
    <div class="fa-peer-bar">
      <div class="fa-peer-row">
        <div class="fa-peer-hint" style="margin:0;">Sidebar peers · max ${MAX_COMPARE_ENTITIES}</div>
        ${compareBtns}
      </div>
      <div class="fa-peer-detail">${hint}</div>
    </div>`;
}

function bindPeerToolbar() {
  document.querySelectorAll('[data-aq-compare]').forEach((btn) => {
    btn.addEventListener('click', () => setCompare(btn.getAttribute('data-aq-compare') === '1'));
  });
}

function render() {
  const root = document.getElementById('assetQualityRoot');
  if (!root) return;
  const iso = datasetIsoCountry();
  const c = cfg();

  if (!ASSET_QUALITY_COUNTRIES.has(iso) || !c) {
    root.innerHTML = `<div class="fa-empty">
      <div class="fa-empty-title">Asset Quality</div>
      <div class="fa-empty-sub">Available for <strong>Chile</strong>, <strong>Colombia</strong>, <strong>Peru</strong> and <strong>Uruguay</strong> — the countries whose regulator publishes a loan-quality tree we can stand behind. Switch country to explore NPL, coverage and the country credit lens.</div>
    </div>`;
    return;
  }

  if (state.loading) {
    root.innerHTML = `<div class="fa-empty"><div class="ls-bars" aria-hidden="true"><div></div><div></div><div></div><div></div><div></div></div>
      <div class="fa-empty-sub" style="margin-top:16px;">Loading ${esc(c.loadingLabel)} credit quality…</div></div>`;
    return;
  }

  if (state.error && !state.loaded) {
    root.innerHTML = `
      ${renderPeerToolbar()}
      <div class="fa-empty">
        <div class="fa-empty-title" style="color:var(--red);">${esc(state.error)}</div>
        <button type="button" class="rcbtn" id="aqRetry" style="margin-top:12px;">Retry</button>
      </div>`;
    bindPeerToolbar();
    document.getElementById('aqRetry')?.addEventListener('click', () => loadAssetQualityData());
    return;
  }

  if (state.loaded && state.iso && state.iso !== c.iso) {
    state.loaded = false;
  }
  if (state.loaded && state.selectionKey !== selectionKey()) {
    state.loaded = false;
  }

  if (!state.loaded) {
    root.innerHTML = `
      ${renderPeerToolbar()}
      <div class="fa-empty">
        <div class="fa-empty-title">${esc(c.title)}</div>
        <div class="fa-empty-sub">${esc(c.sub)}</div>
        <button type="button" class="rcbtn active" id="aqLoad" style="margin-top:14px;">Load credit quality</button>
      </div>`;
    bindPeerToolbar();
    document.getElementById('aqLoad')?.addEventListener('click', () => loadAssetQualityData());
    return;
  }

  const entities = resolveEntities().filter((e) => {
    const have = new Set(state.banks.map(Number));
    return e.codes.some((code) => have.has(Number(code)));
  });

  if (!entities.length) {
    state.loaded = false;
    state.error = peerEmptyMessage();
    render();
    return;
  }

  const active = entities.find((e) => e.id === state.lastEntityId) || entities[0];
  state.lastEntityId = active.id;

  const comparing = state.compare && entities.length >= 2;
  const entityTabs = entities.map((e) => {
    const on = !comparing && e.id === active.id;
    return `<button type="button" class="rcbtn ${on ? 'active' : ''}" data-aq-entity="${esc(e.id)}" ${comparing ? 'disabled title="Switch to Single to focus one peer"' : ''}>
      <span class="fa-swatch" style="background:${e.color}"></span>${esc(e.short)}
    </button>`;
  }).join('');

  const metricBtns = [
    { key: 'mix', label: comparing ? c.loansLabel : 'Loan mix' },
    { key: 'special', label: comparing ? c.specialCompareLabel : c.specialLabel },
    { key: 'npl', label: comparing ? 'NPL %' : 'NPL & coverage' },
  ].map((m) => `<button type="button" class="rcbtn ${state.metric === m.key ? 'active' : ''}" data-aq-metric="${m.key}">${esc(m.label)}</button>`).join('');

  // Stacked composition charts only for Single + Bars on mix / the country lens.
  const stackedNative = !comparing
    && state.chartStyle === 'bars'
    && (state.metric === 'mix' || state.metric === 'special');
  const nplNative = !comparing && state.metric === 'npl' && state.chartStyle === 'bars';

  const chartId = stackedNative ? 'aqStackChart' : nplNative ? 'aqNplChart' : 'aqCompareChart';

  const styleBtns = [
    { key: 'bars', label: 'Bars' },
    { key: 'lines', label: 'Lines' },
    { key: 'area', label: 'Area' },
  ].map((s) => `<button type="button" class="rcbtn ${state.chartStyle === s.key ? 'active' : ''}" data-aq-style="${s.key}">${s.label}</button>`).join('');

  const panelTitle = comparing
    ? (state.metric === 'mix' ? `${c.loansLabel} · peer compare`
      : state.metric === 'npl' ? 'NPL ratio · peer compare'
        : `${c.specialLabel} · peer compare`)
    : (state.metric === 'mix' ? 'Loan composition over time'
      : state.metric === 'npl' ? 'NPL ratio over time'
        : c.specialPanelTitle);

  const focusLabel = comparing ? entities.map((e) => e.short).join(' · ') : active.label;
  const snap = comparing ? null : latestSnapshotFor(active.codes);

  root.innerHTML = `
    <div class="fa-hero aq-hero">
      <div>
        <div class="fa-eyebrow">${esc(c.eyebrow)}</div>
        <div class="fa-title">${esc(c.title)}</div>
        <div class="fa-sub">${esc(c.sub)}</div>
      </div>
      <button type="button" class="rcbtn" id="aqReload">Refresh</button>
    </div>

    ${renderPeerToolbar()}

    <div class="fa-toolbar">
      <div class="fa-bank-tabs">${entityTabs}</div>
      <div class="fa-metric-tabs">${metricBtns}</div>
    </div>

    ${comparing ? renderCompareKpis(entities, c) : renderKpis(snap, c)}
    ${comparing ? '' : renderHonest(snap, c)}

    <div class="panel fa-panel" style="margin-top:22px;">
      <div class="panel-head fa-chart-head">
        <div>
          <div class="panel-title">${esc(panelTitle)}</div>
          <div class="panel-sub">${esc(focusLabel)} · ${esc(periodLabel(state.periodos[0]))} — ${esc(periodLabel(state.periodos[state.periodos.length - 1]))}</div>
        </div>
        <div class="fa-chart-styles" role="group" aria-label="Chart style">${styleBtns}</div>
      </div>
      <div class="panel-body">
        <div class="chart-wrap" style="position:relative;min-height:280px;">
          <canvas id="${chartId}" height="300" style="width:100%;height:300px;"></canvas>
        </div>
      </div>
    </div>

    <div class="panel fa-panel" style="margin-top:18px;">
      <div class="panel-head">
        <div>
          <div class="panel-title">Loan composition · ${esc(periodLabel(state.periodos[state.periodos.length - 1]))}</div>
          <div class="panel-sub">${comparing ? 'Share of loans by peer' : `Share of ${esc(c.loansLabel.toLowerCase())} · local reporting units`}</div>
        </div>
      </div>
      <div class="panel-body" style="overflow-x:auto;padding:0;">
        ${comparing ? renderCompareInstrumentTable(entities, c) : renderInstrumentTable(snap, c)}
      </div>
    </div>

    ${comparing ? '' : renderSpecialPanel(snap, c)}
    ${comparing ? '' : renderPublishedPanel(snap, c)}
    ${comparing ? '' : renderQualityPanel(snap, c)}

    <ul class="fa-notes">${c.notes.map((n) => `<li>${n}</li>`).join('')}</ul>
  `;

  document.getElementById('aqReload')?.addEventListener('click', () => loadAssetQualityData());
  bindPeerToolbar();
  document.querySelectorAll('[data-aq-entity]').forEach((btn) => {
    btn.addEventListener('click', () => {
      if (btn.disabled) return;
      setEntity(btn.getAttribute('data-aq-entity'));
    });
  });
  document.querySelectorAll('[data-aq-metric]').forEach((btn) => {
    btn.addEventListener('click', () => setMetric(btn.getAttribute('data-aq-metric')));
  });
  document.querySelectorAll('[data-aq-style]').forEach((btn) => {
    btn.addEventListener('click', () => setChartStyle(btn.getAttribute('data-aq-style')));
  });

  requestAnimationFrame(() => {
    if (stackedNative) {
      const rows = rowsForCodes(active.codes);
      const series = state.metric === 'mix'
        ? c.mixStack(rows, state.periodos)
        : c.specialStack(rows, state.periodos);
      const title = state.metric === 'mix'
        ? 'Loan composition · stacked stock (local currency)'
        : `${c.specialPanelTitle} · stacked stock (local currency)`;
      drawStackedChart('aqStackChart', series, title);
    } else if (nplNative) {
      drawNplChart(active.codes, c);
    } else {
      drawCompareChart(comparing ? entities : [active], c);
    }
  });
}

/** Force reload after sidebar bank selection changes. */
export function refreshAssetQuality() {
  const prevKey = state.selectionKey;
  const nextKey = selectionKey();
  syncCompareFromSelection({ preferCompareOnMulti: prevKey !== nextKey && selectedBanks().length >= 2 });
  state.loaded = false;
  state.error = null;
  renderAssetQuality();
}

export function renderAssetQuality() {
  const iso = datasetIsoCountry();
  if (!ASSET_QUALITY_COUNTRIES.has(iso)) {
    state.loaded = false;
    state.iso = null;
    state.selectionKey = '';
    render();
    return;
  }
  if (state.loaded && state.iso && state.iso !== iso) {
    state.loaded = false;
    state.selectionKey = '';
  }
  if (state.loaded && state.selectionKey !== selectionKey()) {
    state.loaded = false;
  }
  syncCompareFromSelection();
  const entities = resolveEntities();
  if (!state.loaded && !state.loading && entities.length) {
    if (entities.length >= 2) state.compare = true;
    loadAssetQualityData();
  } else {
    render();
  }
}
