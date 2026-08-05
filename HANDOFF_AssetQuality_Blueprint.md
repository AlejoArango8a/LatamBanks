# Asset Quality Analytics — Design Blueprint (all live countries)

**Status:** research + design only. No feature code in this branch.
**Method:** evidence-first. Every number below was pulled live from the production API
(`https://latambanks.vercel.app`) or from the regulator's own file during this pass.
**Sibling of:** `js/views/fundingAnalytics.js` (BR/CL/UY) — same `cfg()` engine, same peer
compare (banks / rating baskets / custom groups), same Bars / Lines / Area chart styles.

**Headline conclusion.** Asset Quality is a *bigger* opportunity than Funding Analytics,
because the raw data already exists at a far deeper level than the platform currently uses.
Three countries can ship on **day 1 with zero loader work** (CL, CO, PE). Four more are one
loader change away, and each of those loaders already downloads the file that contains the
missing data (UY Anexo 2, AR `esd`/`indicad`, BR IF.data report 130, MX CNBV `CCT` sheet).
And on the user's primary ask — **Uruguay foreign/external credit exposure** — the answer is
better than hoped: BCU publishes **true residency of the borrower**, not just a currency
proxy. See §1.

---

## 0. TL;DR decisions

| Question | Answer (evidence-backed) |
|---|---|
| Does Uruguay have real *residency* of borrowers, or only FX? | **Real residency.** BCU `Anexo 2 — Apertura de créditos y deterioro` has line `1.3 … sector no financiero privado residente` and `1.4 … sector no financiero privado no residente`, each split M/N and M/E, each with its own `(Deterioro)` line. BCU *also* publishes the ratio itself in `Anexo 4` as `VII.5 - Créditos a no residentes / Total de créditos brutos SNF`. We reproduced VII.5 to ±0.01 pp for all 11 UY banks (§1.4). |
| Is UY Anexo 2 in the database today? | **No.** `uruguay_loader.py` parses `Situación`, `Resultados` and the *liability* half of `Anexo 1` only — `parse_anexo1()` explicitly `break`s out of the asset block (`if low0.startswith("créditos"): in_pasivos = False`). Confirmed live: UY `planCuentas` has 191 accounts, 35 of them `A1_*` (all liabilities), **zero** `A2_*`. |
| Which countries can ship day 1 with **no** loader change? | **CL, CO, PE.** All three already have complete gross-loan / NPL / provision trees in `datos_financieros` (verified with live values in §2). |
| Which are one loader change away? | **UY** (Anexo 2 + Anexo 4), **AR** (two extra `COMPLETO.TXT` files inside the 7z the loader *already downloads*), **BR** (IF.data `dados{dt}_3.json`, same portal), **MX** (CNBV `CCT` + `Cartera y calif` sheets, same workbook), **US** (add ~12 FDIC field names to `FIELDS`). |
| Which have a genuine ceiling? | **PA** — SBP's balance file has loans **Locales / Extranjero** and provisions by geography, but **no** past-due line. Great foreign-exposure lens, no NPL. **LU / PY** — not in `datos_financieros` at all (`/api/bootstrap?country=LU` silently returns Chile's dataset — see §3.4). |
| Universal metric set | Gross loans, NPL (or best local equivalent), NPL %, provisions/allowance, coverage %, cost of risk, sector mix, FX share of loans, foreign/non-resident share. Never all nine per country — the `cfg()` contract declares which exist. |
| Rollback tag | `pre-asset-quality-20260805` on `main` before the first Asset Quality merge. |
| Cache-buster | Repo is on `?v=bmon70`; bump edited modules to the next `bmonNN`. |

---

## 1. Uruguay — foreign / external credit exposure (primary ask)

### 1.1 What BCU actually publishes

Each `institucion{ID}.xls` in the monthly boletín has 9 sheets:

```
Indice · Situación · Resultados · ERI · Anexo 1 · Anexo 2 · Anexo 3 · Anexo 4 · Anexo 5
```

The asset-quality payload is split across three of them:

| Sheet | Title | Shape | What it gives us | In DB today? |
|---|---|---|---|---|
| `Anexo 2` | Apertura de créditos y **deterioro** | 48×4 (`label`, M/N, M/E, Total) | Gross credit, **residente vs no residente**, foreign FIs, head office, vencidos with 3 sub-stages, `(Deterioro)` at every level | **No** |
| `Anexo 4` | Indicadores económico-financieros | 78×2 (`label`, value) | BCU's own published ratios: morosidad, deterioro, coverage, **dolarización de créditos**, **créditos a no residentes** | **No** |
| `Anexo 1` | Apertura por plazos contractuales | 67×6 | `Créditos vigentes por intermediación financiera` term buckets (asset side) | **No** — loader stops at the liability block |
| `Situación` | Estado de Situación | 121×4 | `1.4.1/1.4.2/1.4.3` loans **net of impairment**, `2.7.3 Provisiones estadísticas y generales` | **Yes** |

### 1.2 `Anexo 2` line map — BROU, 2026-06 (thousands of pesos)

Real values, `institucion1.xls`, sheet `Anexo 2`:

| Row | Label | M/N | M/E | Total |
|---:|---|---:|---:|---:|
| 9 | `Créditos` (gross) | 225,686,282 | 134,335,219 | **360,021,501** |
| 10 | `(Deterioro)` | −16,333,602 | −5,475,213 | **−21,808,814** |
| 11 | `1. Créditos vigentes` | 220,266,471 | 131,999,283 | 352,265,755 |
| 12 | `1.d. (Deterioro)` | −11,513,886 | −4,049,590 | −15,563,476 |
| 13 | `1.1. Banco Central del Uruguay` | 30,103,842 | 152,100,853 | 182,204,695 |
| 14 | `1.2. … sector financiero` | 4,401,057 | 11,431,421 | 15,832,479 |
| 16 | `1.2.1. Casa matriz` | 0 | 0 | 0 |
| 18 | `1.2.2. Bancos públicos` | 0 | 0 | 0 |
| 20 | `1.2.3. Bancos privados en el país` | 4,401,057 | 0 | 4,401,057 |
| 22 | `1.2.4. **Instituciones del exterior vinculadas**` | 0 | 0 | 0 |
| 24 | `1.2.5. **Instituciones del exterior no vinculadas**` | 0 | 11,404,877 | **11,404,877** |
| 26 | `1.2.6. Otros` | 0 | 26,545 | 26,545 |
| 28 | `1.3 … sector no financiero privado **residente**` | 198,965,631 | 119,601,159 | **318,566,790** |
| 29 | `1.3.d. (Deterioro)` | −10,982,555 | −4,042,954 | −15,025,509 |
| 30 | `1.4. … sector no financiero privado **no residente**` | 65,320 | 14,193 | **79,513** |
| 31 | `1.4.d. (Deterioro)` | −1,996 | −713 | −2,709 |
| 32 | `1.5. … sector no financiero público` | 16,834,463 | 952,510 | 17,786,974 |
| 34 | `2. Créditos Vencidos` | 5,419,811 | 2,335,936 | **7,755,747** |
| 35 | `2.d. (Deterioro)` | −4,819,715 | −1,425,623 | −6,245,338 |
| 40 | `2.2.1. Colocación vencida` | 643,318 | 367,142 | 1,010,459 |
| 42 | `2.2.2. Créditos en gestión` | 386,618 | 245,967 | 632,584 |
| 44 | `2.2.3. **Créditos morosos**` | 4,389,875 | 1,722,828 | **6,112,704** |
| 45 | `2.2.3.d (Deterioro)` | −4,329,990 | −1,256,821 | −5,586,811 |

**Three structural facts a parser must respect** (all verified on BROU *and* BTG *and* Santander):

1. **Row 11 (`1. Créditos vigentes`) EXCLUDES row 13 (`1.1. BCU`).**
   `1.2 + 1.3 + 1.4 + 1.5 = 15,832,479 + 318,566,790 + 79,513 + 17,786,974 = 352,265,755` = row 11, exactly.
   BTG: `1,740,973 + 53,080,966 + 1,237,663 + 1,508,952 = 57,568,554` = row 11, exactly.
   → **never** add `1.1` into a loan-stock aggregate. BCU placements are liquidity, not credit.
2. **Row 9 = row 11 + row 34.** `352,265,755 + 7,755,747 = 360,021,501` ✔.
3. **`Anexo 2` ties to `Situación` after impairment.**
   `Situación 1.4.2` (private SNF, live API) `= 305,128,493` and
   `(1.3 + 1.4 + 2.2) − (1.3.d + 1.4.d + 2.2.d) = 326,402,049 − 21,273,556 = 305,128,493` ✔ exact.
   Same for `1.4.1` (`15,832,479 − 1,905 = 15,830,573` ✔) and `1.4.3` (`17,786,974 − 533,353 = 17,253,620` ✔).
   → the existing `UY_KPI.colocaciones = ['1.4.1','1.4.2','1.4.3']` is **net** loans; Anexo 2 supplies the gross.

### 1.3 `Anexo 4` — BCU's own ratios, and the formulas reverse-engineered

`Anexo 4` (BROU 2026-06) publishes, among others:

```
I.2  - Deterioro de créditos vencidos brutos totales      80.53
IV.1 - Morosidad                                          2.25
IV.2 - Participación del crédito en el activo            31.03
IV.3 - Grado de deterioro total                           7.16
V.1  - Posición neta en moneda extranjera / Patrimonio    50.90
VII.1 - Dolarización de créditos brutos SNF              35.71
VII.4 - Créditos brutos SNF > 1 año / total SNF          78.43
VII.5 - Créditos a no residentes / Total créditos brutos SNF   0.02
VII.6 - Depósitos de no residentes / Total depósitos SNF        2.37
```

We reproduced each from `Anexo 2` + `Situación`. Let `SNF_gross = 1.3 + 1.4 + 1.5 + 2.2 + 2.3`:

| Ratio | Formula we verified | BROU check | Santander check |
|---|---|---|---|
| `IV.1 Morosidad` | `(2.2 + 2.3) / SNF_gross` | 7,755,747 / 344,189,023 = **2.253 → 2.25** ✔ | 5,715,986 / 242,706,046 = **2.355 → 2.36** ✔ |
| `VII.1 Dolarización` | `SNF_gross(M/E) / SNF_gross(Total)` | 122,903,798 / 344,189,023 = **35.71** ✔ exact | 115,119,714 / 242,706,046 = **47.43** ✔ exact |
| `IV.3 Grado de deterioro` | `(|row 10| + Situación 2.7.3) / row 9` | (21,808,814 + 3,964,330) / 360,021,501 = **7.159 → 7.16** ✔ exact | — |
| `I.2 Cobertura de vencidos` | `|2.d| / 2` | 6,245,338 / 7,755,747 = **80.53** ✔ exact | 4,421,460 / 5,715,986 = **77.35** ✔ exact |
| `VII.5 No residentes` | `1.4 / SNF_gross` | 79,513 / 344,189,023 = 0.023 → **0.02** ✔ | 2,920,921 / 242,706,046 = 1.203 vs published **1.21** (Δ0.007 pp) |

> **Honest caveat on VII.5.** Our stock-based numerator uses `1.4`, which is *performing*
> non-resident credit only. `Anexo 2` does **not** split `2. Créditos Vencidos` by residency, so
> BCU's published VII.5 is very slightly higher (Santander Δ0.007 pp ≈ 15.8 M pesos of overdue
> non-resident credit; BTG Δ0.01 pp ≈ 4.9 M). **Ship both**: the ingested `Anexo 4` VII.5 as the
> headline number (it is the regulator's own, complete), and the `Anexo 2` stocks underneath for
> the M/N–M/E and impairment decomposition. Label the stock version
> *"non-resident, performing (Anexo 2)"* — do not silently present it as the total.

### 1.4 Full Uruguay evidence table — 2026-06, all 11 banks

Computed from each bank's `Anexo 2`; the `A4` columns are BCU's published `Anexo 4` values,
shown side-by-side to prove the mapping. Amounts in thousands of pesos.

| Bank (ins_cod) | Gross créditos | SNF gross | **Non-resident** | **NoRes %** | A4 VII.5 | Foreign FIs (1.2.4+1.2.5) | Vencidos % | A4 IV.1 | Coverage % | FX of créditos % | A4 VII.1 |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| BROU (1) | 360,021,501 | 344,189,023 | 79,513 | 0.02 | 0.02 | 11,404,877 | 2.25 | 2.25 | 80.5 | 35.71 | 35.71 |
| BHU (91) | 57,327,942 | 57,227,926 | 0 | 0.00 | 0.00 | 0 | 0.41 | 0.41 | 12.6 | 0.03 | 0.03 |
| Bandes (110) | 1,248,363 | 1,248,363 | 99 | 0.01 | 0.02 | 0 | 10.47 | 10.47 | 55.3 | 34.82 | 34.82 |
| **Itaú (113)** | 264,774,100 | 228,044,688 | **31,321,051** | **13.73** | **13.74** | **35,416,599** | 1.07 | 1.07 | 74.0 | 68.07 | 68.07 |
| Scotiabank (128) | 97,611,955 | 96,803,672 | 49,961 | 0.05 | 0.05 | 0 | 1.69 | 1.69 | 58.8 | 49.06 | 49.06 |
| Santander (137) | 246,702,817 | 242,706,046 | 2,920,921 | 1.20 | 1.21 | 3,564,512 | 2.36 | 2.36 | 77.4 | 47.43 | 47.43 |
| BBVA (153) | 137,008,740 | 135,005,976 | 37,442 | 0.03 | 0.03 | 1,764,974 | 1.19 | 1.19 | 62.7 | 54.84 | 54.84 |
| **BTG Pactual UY (157)** | 58,479,532 | 56,738,559 | **1,237,663** | **2.18** | **2.19** | 1,197,189 | 1.61 | 1.61 | 48.2 | 53.16 | 53.16 |
| Heritage (162) | 11,729,772 | 11,587,734 | 8,237 | 0.07 | 0.07 | 91,120 | 0.17 | 0.17 | 96.1 | 74.33 | 74.33 |
| Citibank (205) | 2,972,712 | 2,972,712 | 0 | 0.00 | 0.00 | 0 | 0.00 | 0.00 | 0.0 | 19.79 | 19.79 |
| Nación Argentina (246) | 2,262,182 | 883,611 | 7,511 | 0.85 | 0.85 | 907,113 | 4.13 | 4.13 | 80.8 | 91.13 | 91.13 |

**The market narrative, quantified.** Uruguay's non-resident lending is overwhelmingly one bank:
**Itaú at 13.7%** of its SNF book plus **35.4 bn** of exposure to foreign financial institutions.
BTG Pactual Uruguay is second at **2.19%**, with a further **1.20 bn** to foreign FIs (of which
433 M to *vinculadas* — i.e. intra-group). BROU, BHU, Scotiabank, BBVA and Citibank are
essentially 100% domestic. Currency and residency are **different** stories: BTG is 53% dollarised
but only 2.2% non-resident; Heritage is 74% dollarised and 0.07% non-resident.

BTG Pactual Uruguay detail (157, 2026-06), the reason to build the drill-down:

| Line | M/N | M/E | Total |
|---|---:|---:|---:|
| `1.2.4 Instituciones del exterior **vinculadas**` | 0 | 433,486 | 433,486 |
| `1.2.5 Instituciones del exterior **no vinculadas**` | 0 | 763,703 | 763,703 |
| `1.3 SNF privado **residente**` | 24,306,961 | 28,774,006 | 53,080,966 |
| `1.4 SNF privado **no residente**` | 87,671 | 1,149,992 | **1,237,663** |
| `1.4.d (Deterioro)` | −541 | −6,193 | −6,734 |
| `2.2.3 Créditos morosos` | 346,338 | 169,083 | 515,421 |

Note `1.4` is **93% M/E** — non-resident lending out of Uruguay is a dollar business. That
cross-tab (residency × currency) exists in no other country in the platform.

### 1.5 Schema stability

`institucion1.xls` for **2020-12** has an identical `Anexo 2` (48×4, same 40 line labels, same
row indices) and an `Anexo 4` whose `IV.*` and `VII.*` labels are byte-identical. Only three
`Anexo 4` labels drifted (`I.4`, `I.5`, `I.9` gained/changed wording when counterparty risk was
added to the denominator). → **parse `Anexo 4` by the roman-numeral prefix before the first
` - `, never by the full label.** A backfill to 2020-01 is safe.

### 1.6 Uruguay honest gaps

- **Vencidos are not split by residency.** `2.2` is private-SNF total. Non-resident NPL is not
  publishable from Anexo 2. Use BCU's `VII.5` for the total share, and say so.
- **No sector-of-industry breakdown.** BCU splits credit by *counterparty type* (financial /
  private SNF / public SNF) and by *residency*, not by commercial / consumer / mortgage. Uruguay
  cannot join the "sector mix" chart. `Anexo 3` splits *deposits* by ticket size and residency —
  funding, not asset quality.
- **`1.2.4 vinculadas` vs `1.2.5 no vinculadas`** is a related-party split of exposure to foreign
  banks. It is *not* the same concept as `1.4` (non-resident *borrowers* in the real economy).
  Keep them in separate rows; do not add them into a single "foreign exposure" number without
  labelling what is inside.
- **M/E ≈ USD, not exactly** — same caveat already carried by Funding Analytics.
- **`Anexo 4` is a ratio sheet, not stocks.** Ingesting it means storing percentages in
  `monto_total`. Use a distinct `tipo` (proposal: `q1`) or an unambiguous `A4_*` prefix so no
  balance-sheet aggregation ever sums them. See §4.5.

---

## 2. Country-by-country asset-quality audit

Every "live" value below was fetched from production during this pass.

### 2.1 Chile (CMF) — the richest, and **already fully loaded**

Chile needs **no loader work**. Both `b1` (balance) and `c1` (complementary) are populated.

**Loan stock and provisions (`b1`), with the four-way currency split already present:**

| Code | Label | BCI (16), 2026-06 |
|---|---|---:|
| `500000000` | TOTAL COLOCACIONES | 59,347,385,003,406 |
| `143000000` | Adeudado por bancos | 904,784,642,447 |
| `145000000` | Colocaciones comerciales | 38,479,835,337,267 |
| `146000000` | Colocaciones para vivienda | 16,387,401,872,609 |
| `148000000` | Colocaciones de consumo | 3,514,578,993,946 |
| `149000000` | Provisiones por riesgo de crédito | −886,160,491,890 |
| `149500100` | Provisiones comerciales | −489,097,817,356 |
| `149600100` | Provisiones vivienda | −131,182,236,677 |
| `149700100` | Provisiones consumo | −265,880,437,857 |
| `143150100` / `143250100` | Provisiones bancos país / **exterior** | — / −969,220,083 |

Currency dims on the same rows (BCI `500000000`): `clp 12,054,893,686,928 · uf 20,125,018,166,908 · tc 232,692,534,542 · ext 26,934,780,615,028` → **FX share of loans 45.4%, UF share 33.9%**. This is a first-class Chile lens that no other country has at loan level.

**Credit quality (`c1`), live values:**

| Code | Label | Banco de Chile (1) | BCI (16) | BTG Chile (59) |
|---|---|---:|---:|---:|
| `857000000` | Mora **90+** días, costo amortizado | 664,197,751,676 | 793,872,225,728 | **0** |
| `857200102` | ↳ Préstamos comerciales **en el exterior** | — | 48,488,524,897 | — |
| `811000000` | Créditos en **cartera deteriorada** | 1,489,326,991,214 | 2,558,347,503,730 | 104,469,375,832 |
| `811200102` | ↳ Comerciales **en el exterior** | — | 613,216,889,159 | — |
| `812000000` | Créditos con **devengo suspendido** | 661,200,601,057 | 1,149,096,996,812 | 53,907,387,965 |
| `813000000` | **Castigos** | 256,655,328,006 | 248,104,659,475 | 2,528,980,608 |
| `814000000` | **Recuperaciones** de castigados | 33,663,548,690 | 52,481,249,409 | — |
| `851000000` | Cartera normal · eval. individual | 15,601,367,802,127 | 31,722,421,459,292 | 3,688,474,057,129 |
| `852000000` | Cartera **subestándar** · individual | 248,955,043,403 | 2,705,906,759,798 | 175,557,643,831 |
| `853000000` | Cartera en **incumplimiento** · individual | 292,585,141,837 | 604,795,711,809 | 55,735,967,132 |
| `854000000` | Cartera normal · eval. grupal | 23,529,388,800,993 | 22,927,407,626,441 | 0 |
| `855000000` | Cartera en **incumplimiento** · grupal | 1,151,461,006,123 | 1,327,014,896,862 | 0 |
| `821000000` | Montos adeudados por los clientes (gross) | 41,957,447,306,456 | 59,954,325,266,087 | 3,919,767,668,092 |

Derived, BCI: NPL 90+ **1.34%**, coverage `149000000 / 857000000` = **111.6%**, impaired
`811000000` **4.31%**, and **24% of the impaired book is offshore** (`811200102`) — BCI owns City
National Bank of Florida, so this is real signal, not noise.

Also present in the plan (not yet probed for coverage, worth a Tier-B pass): `858*`/`859*` mora
90+ for FVOCI/FVTPL portfolios, `856*` risk grades on *contingent* credit, and IFRS-9 stage codes
`…901/902/903` ("fase 1 / 2 / 3") on the amortized-cost impairment sub-trees.

**Foreign lens for Chile.** `811`, `812`, `813`, `814`, `857` and `821` all carry the same
sub-structure with `…100200 Bancos del exterior` and `…200102 Préstamos comerciales en el exterior`,
plus `…200600 Créditos de comercio exterior`. So Chile gets a *foreign-exposure* lens on the
**deteriorated / overdue** book — arguably richer than a plain stock split.

**Honest gaps (CL).** `857000000 = 0` for BTG Chile — a corporate/investment bank with no 90-day
retail arrears. The UI must not render "NPL 0.00%" as if it were a triumph; for such banks lead
with `852+853` (subestándar + incumplimiento = **5.9%** of BTG Chile's loans) and `811` (2.67%),
and mark 90+ as "n/a — no arrears reported". Also `c1` requires a **third `fetchData` tipo**; the
Funding engine only fetches `b1` + `r1` (§4.4).

### 2.2 Colombia (SFC / CUIF) — **already fully loaded**, full A–E grid

No loader work. `140000` gross loans, and the *entire* CUIF risk-category grid is present, by
segment **and** by category, with matching `deterioro` accounts.

Banco de Bogotá (1), 2026-05 (COP):

| Segment | Gross | Cat A | Cat B | Cat C | Cat D | Cat E | Deterioro |
|---|---:|---:|---:|---:|---:|---:|---:|
| Comercial (`141000`) | 59,374,547,136,107 | 54,686,827,802,149 | 1,370,561,854,252 | 949,070,934,325 | 1,511,983,470,447 | 856,103,074,934 | `149500` 2,212,456,922,331 |
| Consumo (`140800`) | 22,026,637,472,924 | 20,020,177,511,543 | 544,281,123,814 | 554,536,030,393 | 750,560,771,505 | 157,082,035,668 | `149100` 1,153,211,732,670 |
| Vivienda (`140400`) | 13,538,384,704,493 | 12,900,896,531,363 | 221,643,356,291 | 151,993,917,834 | 85,427,354,359 | 178,423,544,646 | `148900` 243,333,955,811 |
| Empleados (`141400`) | 611,653,772,843 | 609,274,593,170 | 820,192,598 | 665,868,198 | 745,016,086 | 148,102,791 | `148800` 6,470,395,922 |
| Microcrédito (`141200`) | — | — | — | — | — | — | `149300` |
| **Total (`140000`)** | **91,175,876,911,648** | | | | | | + `148700` contracyclical 618,418,933,183, `149800` general 141,454,234,803 |

Derived: **C+D+E = 5,191,726,878,092 = 5.69%** of gross loans (SFC's standard "cartera de mayor
riesgo"); total deterioro **4,375,346,174,720 = 4.80%**; coverage of C+D+E **84.3%**.

Colombia also has `121035 RESIDENTES DEL EXTERIOR` and a large `EMISORES/SUBSIDIARIAS EXTRANJERAS`
family, but those sit in the *investment* tree (13xxxx), not the loan book. **No non-resident
borrower split for CO — do not invent one.**

Colombia's special lens is therefore the **A→E migration** view: a stacked category chart per
segment, plus provision-per-category to show whether the coverage build matches the migration.

### 2.3 Peru (SBS B-2201) — **already fully loaded**

No loader work. Slug accounts, verified live for 2026-06 (soles):

| Slug | Label | BBVA Perú (1) | BCP (3) |
|---|---|---:|---:|
| `VIGENTES` | Current loans | 81,678,909,006 | 126,968,164,324 |
| `REFINANCIADOS_Y_REESTRUCTURADOS` | Refinanced / restructured | 1,441,180,861 | 1,643,729,231 |
| `ATRASADOS` | **Past due** | 2,295,854,800 | 3,616,363,339 |
| `EN_COBRANZA_JUDICIAL` | ↳ in judicial collection | 1,590,129,058 | 2,189,811,227 |
| `CREDITOS_NETOS` | Loans net of provisions | 81,593,264,107 | 125,445,320,484 |
| `PROVISIONES_CREDITOS` (`r1`) | Loan-loss provision charge (YTD) | 669,712,976 | 710,411,755 |
| `PRESTAMOS` | Loans | 43,024,630,498 | 78,112,161,868 |
| `HIPOTECARIOS_PARA_VIVIENDA` | Mortgages | 18,514,275,361 | 24,230,864,636 |
| `TARJETAS_DE_CREDITO` | Credit cards | 4,203,241,721 | 6,705,576,730 |
| `ARRENDAMIENTO_FINANCIERO` | Leasing | 2,988,415,742 | 4,954,464,789 |
| `COMERCIO_EXTERIOR` | **Trade finance** | 6,006,527,507 | 3,194,450,959 |
| `DESCUENTOS` / `FACTORING` | Discounts / factoring | 963,157,059 / 47,083,282 | 3,847,969,683 / 0 |

Derived for BBVA Perú: gross = `VIGENTES + REFIN + ATRASADOS` = 85,415,944,667;
**NPL (`ATRASADOS`) = 2.69%**; NPL+refin ("cartera de alto riesgo") = **4.37%**;
allowance = gross − net = 3,822,680,560 = **4.48%** of gross; **coverage 166%**.

**Honest gaps (PE).** The balance slug `PROVISIONES` returns garbage (`−3,774,467` for BBVA
against an implied ~3.8 bn allowance; `0` for BANCOM) — a scrape artefact. **Derive the allowance
as gross − net** and mark `PROVISIONES` as unusable. Also `gross − Σ(sector slugs)` leaves a ~6 bn
residual for BBVA (`CREDITOS_POR_LIQUIDAR`, other), so the sector mix chart needs an explicit
"other" bucket rather than being forced to 100%. No FX split (`monto_ext` is 0 for PE) and no
residency split.

### 2.4 Brazil (Bacen IF.data) — one loader change, and it unlocks a *lot*

**What's in the DB today** (from `dados{dt}_1.json`, the only file `brasil_loader.py` ingests):
`78191` Operações de Crédito (d1), `78192` Provisão sobre Operações de Crédito (d2), `78193` net,
`78183` Carteira de Crédito Classificada, `141873` Carteira de Crédito, `145831/145832` Valor
Contábil Bruto / Perda Esperada, `78213` Resultado de Provisão para Créditos de Difícil Liquidação.
→ **gross loans, provision stock, provision/loans, cost of risk. No NPL.**

**What is one file away.** The loader already talks to `www3.bcb.gov.br/ifdata/rest`. The same
quarter directory contains `dados{dt}_3.json`, whose columns are defined by `trel{dt}_1XX.json`
and labelled by `info{dt}.json` (`ifd` → label, `lid` → the column id used in `dados`). Reports:

| Report | Title | Key columns (`lid`) |
|---|---|---|
| **130** | Carteira de crédito ativa — por carteiras de instrumentos financeiros | **`148833` Ativos problemáticos**, **`148834` Inadimplência**, `148835–148839` C1…C5, `149385` não informada, `24454` Total Geral, **`23383` Total Exterior** |
| **126** | por região geográfica | `23358–23362` Sudeste/CO/NE/N/Sul, `24449` não informada, **`23383` Total Exterior** |
| **125** | por indexador | `23367` Prefixado, `23372` CDI, `23376` IPCA, `23370` Libor, … |
| 123 / 128 | PF / PJ — modalidade e prazo | per-modality `Vencido a Partir de 15 Dias` + maturity ladder |
| 127 | PJ por porte | `23363–23366` Micro/Pequena/Média/Grande |
| 124 | quantidade de clientes e operações | `23380`, `23381` |

Live values, **2026-03, prudential conglomerates** (R$):

| Institution | Total Geral | **Total Exterior** | **Exterior %** | Ativos problemáticos | Inadimplência |
|---|---:|---:|---:|---:|---:|
| Caixa (1000080738) | 1,415,650,989,333 | 0 | 0.0% | 0 | 52,049,697,635 |
| Itaú (1000080099) | 1,172,354,165,826 | 384,267,797,333 | **32.8%** | 0 | 26,421,383,547 |
| Bradesco (1000080075) | 845,747,187,856 | 92,075,278,386 | 10.9% | 0 | 32,926,061,428 |
| Santander (1000080185) | 550,002,223,988 | 82,467,797,170 | 15.0% | 0 | 22,235,029,592 |
| **BTG Pactual (1000080336)** | 175,252,834,503 | **47,251,198,036** | **27.0%** | **11,754,111,764** | 10,067,567,808 |

BTG's full report-130 row cross-foots exactly:
`Total do SCR (23382) 128,001,636,466 + Total Exterior 47,251,198,036 = 175,252,834,502` vs
`Total Geral 175,252,834,503` (1 unit rounding) ✔, and
`C1..C5 = 4,229,225,340 + 48,477,765,534 + 26,157,542,463 + 15,470,122,068 + 33,531,504,448 = 127,867,020,533 = Total Individualizado (23384)` ✔.

**Honest gaps (BR), important.**
- `Ativos problemáticos` is **populated for BTG but zero for Itaú, Bradesco, Santander and Caixa**
  at 2026-03. Do not build a peer chart on a column four of the five biggest banks leave blank.
  Treat it as bank-by-bank optional and render "not reported" rather than 0.
- `Inadimplência` (Res. 4557 default) is populated for all five, but the implied ratios
  (BTG 5.74% of Total Geral, Itaú 2.25%, Bradesco 3.89%, Santander 4.04%, Caixa 3.68%) are
  **wider than the 90-day NPL these banks publish in their own results**. This is a definitional
  gap, not a data error — SCR "inadimplência"/"ativos problemáticos" is broader than NPL 90.
  **Label the metric with the regulator's word (`Inadimplência (SCR)`), never "NPL 90".** Validate
  against one bank's investor release before enabling.
- IF.data warns in `trel.cp` that report-130 data comes from **document 3040 (SCR)** and can
  diverge from the accounting statements. Add that as a UI note.
- Olinda OData only serves `Relatorio='1'..'5'` (we probed 6, 7, 8, 11–14, 125, 126, 130 — all
  return `"value": []`). The credit reports are **portal-file only**; the dictionary must be built
  from `info{dt}.json`, not Olinda.
- BR is **quarterly**, so the sheet's period axis is coarser than CL/CO/PE/UY.

### 2.5 Mexico (CNBV) — one loader change, and it is a full sheet

`mexico_loader.py` reads only sheet `Pm2` (5 metrics). The **same workbook** (`BE BM {YYYYMM}.xlsx`,
2.4 MB, downloaded and inspected during this pass) has 34 sheets including:

**Sheet `CCT` — Cartera de crédito total**, per bank, with three date columns per metric:

| Bank | Cartera total (MDP) | **IMOR %** | **ICOR %** | Pérdida esperada % |
|---|---:|---:|---:|---:|
| Sistema | 8,345,222 | 2.32 | 145.34 | 3.37 |
| BBVA México | 2,176,490 | 1.68 | 192.55 | 3.23 |
| Banorte | 1,226,445 | 1.52 | 134.56 | 2.05 |
| Santander | 995,433 | 2.35 | 143.56 | 3.38 |
| Banamex | 536,418 | 3.14 | 173.17 | 5.44 |
| Scotiabank | 539,439 | 4.04 | 73.80 | 2.98 |
| HSBC | 457,617 | 3.07 | 118.37 | 3.63 |
| Banco Azteca | 208,241 | 5.50 | 216.59 | 11.90 |
| J.P. Morgan | 24,721 | 0.00 | `-` | 0.71 |

`IMOR` = índice de morosidad (NPL %), `ICOR` = índice de cobertura (coverage %). Both are exactly
the universal metrics, published by the regulator.

**Sheet `Cartera y calif`** — IFRS-9 **stages** with sector mix, banks as column pairs
(monto, %). BBVA México, May-2026 (MDP): `Cartera etapa 1` 2,082,882 (95.7%), `etapa 2` 43,389
(1.99%), and within stage 1: comerciales 1,150,025 (empresas 904,096 / entidades financieras
52,072 / gubernamentales 193,857), consumo 549,591, vivienda 383,266.

Also present: `CCE` (empresas), `CCCT`/`CCCTC` (consumo, tarjeta), `CCV` (vivienda), `CCCMicro`,
`Indicadores` (ROA/ROE), `Evaluación Calidad` sheets.

**Honest gaps (MX).** `IMOR`/`ICOR` are **ratios**, so ingesting them means storing percentages
(§4.5). Stage amounts are in **MDP** (×1e6) while `Pm2` already uses `SCALE = 1_000_000` — same
scale, good. `J.P. Morgan` shows `ICOR = "-"` (no NPL to cover) → the parser must map non-numeric
cells to `NULL`, not `0`. Bank identity in `Cartera y calif` is a **column header**, not a row, so
it needs a separate transposing parser from `CCT`. No FX and no residency split for MX.

### 2.6 Argentina (BCRA) — one loader change, **zero extra download**

`argentina_loader.py` already downloads `{YYYYMM}d.7z` (35 MB) and extracts
`Entfin/Tec_Cont/baldet/COMPLETO.TXT`. **The same archive contains** (2,100 files total):

- `Entfin/Tec_Cont/esd/COMPLETO.TXT` — **Estado de Situación de Deudores**, 2,254 lines, 32 accounts
- `Entfin/Tec_Cont/indicad/completo.txt` — **Indicadores**, 2,604 lines, 31 ratios

`esd` account map (all 32 codes read out; `($)` are amounts in **millones** de ARS, `(%)` are shares):

```
500110001000 TOTAL DE FINANCIACIONES Y GARANTIAS OTORGADAS ($)
500110001010..050 TF.Sit.1 normal / Sit.2 seguimiento especial / Sit.3 con problemas /
                  Sit.4 alto riesgo de insolvencia / Sit.5 irrecuperable   (%)
500110002000 TOTAL GARANTIZADO - Garantías Preferidas A y B (%)
500110101000 CARTERA COMERCIAL ($)                + 101010..050 Sit.1-5 (%) + 102000 garantizado
500110201000 CARTERA DE CONSUMO O VIVIENDA ($)    + 201010..050 Sit.1-5 (%) + 202000 garantizado
500110301000 CARTERA COMERCIAL ASIMILABLE A CONSUMO ($) + 301010..050 + 302000
500130003000 Previsiones por riesgo de incobrabilidad constituídas ($)
```

`indicad` (relevant subset): `800010200090 A9 - Total Cartera Irregular / Total Financiaciones (%)`,
`800010200140 A14 - Previsiones sobre Cartera Irregular Total (%)`,
`800010200110 A11` irregular sector privado, `800010200160/170 A16/A17` irregular consumo/comercial,
`800010201030 AG3` importancia de cartera vencida, `800010100020/30 C2/C3` pérdida potencial
situación 2-5 / 3-5, `800010401030 RG3` cargos por incobrabilidad / activo.

**Column layout — confirmed twice, not assumed.** `esd` rows carry 5 numeric columns then an
`"N"`/`"P"` format flag. For Banco Galicia (00007), file `202604`:

```
500110001000 TOTAL FINANCIACIONES  [10,650,244.05  21,705,288.93  21,335,688.39  22,890,889.46  22,424,272.34] N
500110001010 Sit.1 normal (%)      [96.65  89.84  89.31  89.74  89.16] P
500110001020 Sit.2 (%)             [ 1.53   3.26   3.04   2.58   2.76] P
500110001030 Sit.3 (%)             [ 0.97   3.31   3.29   2.97   2.62] P
500110001040 Sit.4 (%)             [ 0.75   3.07   3.81   4.02   4.62] P
500110001050 Sit.5 (%)             [ 0.11   0.52   0.55   0.69   0.85] P
```

Column 5 sums to `89.16 + 2.76 + 2.62 + 4.62 + 0.85 = 100.01` ✔, and irregular
(`Sit.3+4+5`) `= 8.09%`, which is **exactly** `indicad` `A9` column 5 (`8.09`) ✔✔.
→ **the 5th numeric column is the reporting month**; columns 1–4 are the year-ago month and
m−3, m−2, m−1. `indicad` rows have 8 numeric columns; the 5th is likewise the reporting month
(the last three appear to be peer/system values — confirm against the BCRA layout doc before
using them).

Galicia 202604 derived: cartera irregular **8.09%**, coverage (`A14`) **87.83%**, previsiones
constituidas 1,592,832 (millones ARS), cartera comercial 8,416,317 / consumo-vivienda 8,408,560.

**Honest gaps (AR).** `esd` amounts are in **millones** de ARS while `baldet` is in **miles** —
different scale in the same archive; `SCALE` must be per-file. Sit.1–5 are **percentages**, so
peso amounts must be derived (`% × TOTAL FINANCIACIONES`) or stored as ratios (§4.5). ARS figures
are nominal in a high-inflation economy, so the sheet should default to *ratios* for Argentina and
suppress level comparisons across years. `financiaciones` includes guarantees granted, so it is
wider than `baldet 130000 PRESTAMOS` (Galicia: 22.4 tn vs 18.7 tn) — never mix the two denominators.

### 2.7 United States (FDIC) — one loader change (add field names)

`usa_loader.py` requests 14 fields. The FDIC financials API returns everything we need on the
same call. Verified live for **CERT 628 (JPMorgan Chase Bank NA), 2026-03-31** (US$ thousands):

| Field | Meaning | Value |
|---|---|---:|
| `LNLS` | Total loans & leases (gross) | 1,519,711,000 |
| `LNLSNET` | Net of allowance | 1,493,977,000 |
| `LNATRES` | **Allowance for credit losses** | 25,734,000 |
| `NCLNLS` | **Noncurrent loans & leases** (90+ or nonaccrual) | 12,861,000 |
| `NCLNLSR` | Noncurrent / loans **%** | 0.8463 |
| `LNRESNCR` | Allowance / noncurrent **%** | 200.09 |
| `LNATRESR` | Allowance / loans **%** | 1.6933 |
| `P3ASSET` | 30–89 days past due | 6,246,000 |
| `P9ASSET` | 90+ days **still accruing** | 3,076,000 |
| `NTLNLSQ` | **Net charge-offs**, quarter | 2,320,000 |
| `ELNATR` | Provision expense | 2,540,000 |
| `LNRE` / `LNCI` / `LNCON` | Real estate / C&I / consumer | 504,275,000 / 237,664,000 / 275,044,000 |
| `LNCRCD` / `LNAUTO` | Credit card / auto | 206,178,000 / 56,741,000 |
| `LNAG` / `LNDEP` / `LNMUNI` / `LNFG` | Agricultural / depositories / municipal / **foreign govts** | 499,000 / 16,051,000 / 29,984,000 / 5,977,000 |

**Honest gaps (US).** `NCLNLSR`, `LNRESNCR`, `LNATRESR` are **ratios** (`usa_loader.py` already
has a `RATIO_FIELDS` path for `ROA`/`ROE` — reuse it). `NTLNLSQ`/`ELNATR` are flow fields that
belong in `r1`. `LNFG` is loans to *foreign governments* only — it is **not** a foreign-borrower
share; FDIC's summary financials do not expose Call Report RC-C foreign-office detail, so **the
US gets no non-resident lens.** US is quarterly, and the `funding` / `balance` / `resultados` /
`accountview` tabs are currently disabled for US precisely because there is no detailed chart of
accounts — Asset Quality would be the **first** detail tab US can support, on aggregate fields.

### 2.8 Panama (SBP) — foreign geography, but no NPL

The SBP per-bank balance file (`RE-BALANCE-BANCO-en-{Slug}.xlsx`) — downloaded and inspected —
splits the loan book by geography and carries provisions per geography:

Bladex (Banco Latinoamericano de Comercio Exterior), Dec-2025 column (thousands of balboas = US$):

```
CARTERA CREDITICIA          9,088,795
   Locales                    840,103
   Extranjero               8,341,198        → 91.8% foreign
   Menos Provisiones           92,506
      Locales                   9,420
      Extranjero               83,086
…
PATRIMONIO
   Otras Reservas             159,093
       Provisiones Dinámicas  154,538        ← Panama's dynamic provision, in equity
```

`panama_loader.py` currently keeps only the parent `CARTERA CREDITICIA`. Adding
`CARTERA_LOCAL`, `CARTERA_EXTRANJERO`, `PROV_CARTERA_LOCAL`, `PROV_CARTERA_EXTRANJERO`,
`PROVISIONES_DINAMICAS` is a small, low-risk `B1_LABELS` extension with indentation handling.

**Honest gap (PA), decisive.** There is **no cartera vencida / morosa / deteriorada line** in this
file. Panama can ship *loans by geography + allowance by geography + dynamic provisions* and
therefore **provision coverage of loans**, but **not NPL**. Do not synthesise one. (A separate SBP
"Informe de Cartera" publication would be needed; out of scope for this blueprint.)

### 2.9 Luxembourg / Paraguay — not backed by data

`GET /api/bootstrap?country=LU` returns `country: "CL"` with `BANCO DE CHILE, BANCO INTERNACIONAL,
…` and Chile's 2,396 accounts. Same for `PY`. The backend falls back to the default country for
any unrecognised ISO. `paises.json` marks LU as `status: "franchise"` (annual manual seed) and PY
as `"soon"`.

→ Asset Quality must **not** be enabled for LU/PY, and this fallback is a latent correctness bug
worth its own ticket: an unknown `country` should 404 (or return an empty dataset), not silently
serve Chile.

---

## 3. What already exists in the UI

### 3.1 The only NPL primitive

`js/format.js:85`

```js
export function nplPctFromRaw(moraAbs, loansAbs) {
  const l = Number(loansAbs);
  if (!l) return null;
  return (Number(moraAbs) || 0) / l * 100;
}
```

Called from `resumen.js`, `balance.js` and `ranking.js`. Two countries feed it:

- **Chile** — `resumen.js:1166` `mora90 = c1v('857000000')`, KPI at `:1213`, time series
  `moraPct` at `:1218-1220`, plus `renderCalidad()` in `balance.js:348-385`, which draws the
  Normal / Subestándar / Incumplimiento bars (`851+854` / `852` / `853+855`, wired in
  `ui.js:672-679`) and a mora table split by `857100000/857200000/857300000/857400000` with
  `castigos 813000000` and `recuperaciones 814000000`.
- **Colombia** — `coMoraNumerator()` in `coCuentas.js:48-52` over gross `140000`.

### 3.2 A real bug to fix while we're here

`coDeterioroActivoCuentasFromPlan()` returns **every** plan account whose 6-digit form starts
`148`/`149`, and `coMoraNumerator()` sums `Math.abs(monto_total)` over all of them. Because CUIF
publishes parents *and* children, this **double counts**. Verified on Banco de Bogotá 2026-05:

```
148700 DETERIORO COMPONENTE CONTRACICLICO INDIVIDUAL   618,418,933,183
148705   ↳ consumo                                     322,491,457,539
148710   ↳ comerciales                                 295,927,475,644     (705+710 = 700 exactly)
```

The same pattern repeats for `148800/148900/149100/149300/149500/149800` and all their
`…05/10/15/20/25` children — the current Colombia "NPL" KPI is roughly **2× too high**.
Fix: keep only the segment parents `148700, 148800, 148900, 149100, 149300, 149500, 149800`
(or filter to codes whose last two digits are `00`). This belongs in the Asset Quality PR since
it rewrites CO credit quality anyway.

### 3.3 Where the mora chart is switched off

`ui.js:391-397` disables `btnResChartMora` for **BR, UY, PE, US, AR, MX, PA** — i.e. every
country except CL and CO. Seven of those nine can be turned on by this project (all but PA, which
has no NPL, and with US/MX/AR/BR/UY needing their loader change first).

### 3.4 Tab gating to mirror

`js/ui.js:454-455`

```js
const FUNDING_ENABLED_ISO = ['BR', 'CL', 'UY'];
const NON_FUNDING_COUNTRY_DISABLED = ['funding'];
```

Consumed by `showTab()` (`ui.js:270-283`) and `syncCountryDisabledTabs()` (`ui.js:464-492`), which
also sets the greyed-out tooltip. The tab button lives at `dashboard.html:1154` and the mount
point at `dashboard.html:1394` (`#fundingAnalyticsRoot`).

---

## 4. Blueprint — Asset Quality sheet

### 4.1 Universal metric contract

Nine metrics; each country declares which it has. The UI renders `—` plus a one-line reason for
the rest — never a zero, never a silent omission.

| # | Metric | Definition | CL | CO | PE | UY | BR | MX | AR | US | PA |
|---|---|---|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|
| 1 | Gross loans | pre-allowance stock | ✅ | ✅ | ✅ | 🔧 | ✅ | 🔧 | 🔧 | 🔧 | ✅ |
| 2 | NPL stock | regulator's overdue/impaired | ✅ `857`/`811` | ✅ C+D+E | ✅ `ATRASADOS` | 🔧 `2.2` | 🔧 `Inadimplência` | 🔧 IMOR×stock | 🔧 Sit.3-5 | 🔧 `NCLNLS` | ❌ |
| 3 | NPL % | (2)/(1) | ✅ | ✅ | ✅ | 🔧 | 🔧 | 🔧 | 🔧 | 🔧 | ❌ |
| 4 | Allowance | balance-sheet provision | ✅ `149*` | ✅ `148/149` | ✅ derived | 🔧 `Deterioro` | ✅ `78192` | 🔧 via ICOR | 🔧 `esd` | 🔧 `LNATRES` | 🔧 by geography |
| 5 | Coverage % | (4)/(2) | ✅ | ✅ | ✅ | 🔧 `I.2` | 🔧 | 🔧 `ICOR` | 🔧 `A14` | 🔧 `LNRESNCR` | ❌ |
| 6 | Cost of risk | provision charge / avg loans | ✅ | ✅ | ✅ | 🔧 acct `7` | ✅ `78213` | ➖ | 🔧 `RG3` | 🔧 `ELNATR` | ➖ |
| 7 | Sector mix | commercial / consumer / mortgage | ✅ | ✅ | ✅ | ❌ | 🔧 PF/PJ | 🔧 | 🔧 3 carteras | 🔧 | ❌ |
| 8 | FX share of loans | `monto_ext / monto_total` | ✅ | ❌ | ❌ | 🔧 M/E | ➖ indexador | ❌ | ❌ | ➖ | ➖ USD |
| 9 | **Foreign / non-resident** | borrower outside the country | ✅ `…exterior` sub-accounts | ❌ | ➖ trade finance | 🔧 **true residency** | 🔧 **Total Exterior** | ❌ | ❌ | ❌ `LNFG` only | ✅ **Locales/Extranjero** |

✅ live today · 🔧 needs the loader change named in §2 · ➖ partial/proxy only · ❌ not available

### 4.2 Country "special lens" — the analogue of Funding's tax/UF/FX

| ISO | `specialMetric` | Headline | Source |
|---|---|---|---|
| **UY** | `residency` | **Non-resident credit share** + residency × currency cross-tab | `A2_*` stocks + `A4_VII_5` |
| **CL** | `riskgrade` | Normal / Subestándar / Incumplimiento migration + offshore impaired | `851–855`, `811200102` |
| **CO** | `category` | A→E migration by segment, with provision per category | `140405…141480`, `148/149…` |
| **BR** | `overseas` | **Total Exterior %** of the credit book + C1–C5 | report 130 `23383`, `148835-9` |
| **PE** | `stage` | Vigentes / Refinanciados / Atrasados / Judicial ladder | `VIGENTES`, `REFIN…`, `ATRASADOS`, `EN_COBRANZA_JUDICIAL` |
| **MX** | `ifrs9` | Etapa 1 / 2 / 3 with IMOR & ICOR | `Cartera y calif`, `CCT` |
| **AR** | `situacion` | Situación 1–5 grid × 3 carteras (ratio-first) | `esd` |
| **US** | `pastdue` | 30–89 vs 90+ accruing vs nonaccrual + net charge-offs | `P3ASSET`, `P9ASSET`, `NCLNLS`, `NTLNLSQ` |
| **PA** | `geography` | Loans **Locales vs Extranjero**, allowance by geography, dynamic provisions | SBP balance |

### 4.3 Instrument-style maps, analogous to `FUNDING_INSTRUMENTS`

The engine wants (a) a mutually exclusive stack for the bar chart and (b) named aggregates for
ratios. Sketch for the two most interesting countries:

```js
// js/uyCuentas.js — mirrors UY_FUNDING_INSTRUMENTS shape.
// Codes are the synthetic accounts uruguay_loader.py must emit from Anexo 2 (§4.5).
export const UY_CREDIT_SEGMENTS = [
  { key:'snfPrivRes',  label:'Private non-financial — resident',     short:'SNF res.',  codes:['A2_1_3'],          group:'domestic', special:false },
  { key:'snfPrivNoRes',label:'Private non-financial — NON-RESIDENT', short:'No res.',   codes:['A2_1_4'],          group:'foreign',  special:true  },
  { key:'snfPub',      label:'Public non-financial',                  short:'SNF púb.',  codes:['A2_1_5'],          group:'domestic', special:false },
  { key:'sfLocal',     label:'Financial sector — domestic banks',     short:'SF país',   codes:['A2_1_2_3'],        group:'domestic', special:false },
  { key:'sfExtVinc',   label:'Foreign FIs — related',                 short:'Ext. vinc.',codes:['A2_1_2_4'],        group:'foreign',  special:true  },
  { key:'sfExtNoVinc', label:'Foreign FIs — unrelated',               short:'Ext. n/v',  codes:['A2_1_2_5'],        group:'foreign',  special:true  },
  { key:'vencidos',    label:'Overdue (vencidos)',                    short:'Vencidos',  codes:['A2_2_2'],          group:'npl',      special:false },
];
// NOTE: A2_1_1 (BCU) is deliberately absent — Anexo 2 row 11 excludes it (§1.2).

export const UY_CREDIT_NPL = {
  vencidos:  ['A2_2_2','A2_2_3'],                    // private + public SNF overdue
  ladder:    ['A2_2_2_1','A2_2_2_2','A2_2_2_3'],     // colocación vencida / en gestión / morosos
  allowance: ['A2_D_TOTAL'],                          // Anexo 2 row 10
  general:   ['2.7.3'],                               // Situación — provisiones estadísticas y generales
};
export const UY_CREDIT_RATIOS = {                     // Anexo 4, ingested as ratios
  npl:'A4_IV_1', deterioro:'A4_IV_3', coverage:'A4_I_2',
  fxLoans:'A4_VII_1', nonResident:'A4_VII_5', nonResidentDeposits:'A4_VII_6',
};
```

```js
// js/clCuentas.js — all codes already live, no loader work.
export const CL_CREDIT_SEGMENTS = [
  { key:'comercial', label:'Commercial loans', short:'Comercial', codes:['145000000'], group:'segment' },
  { key:'vivienda',  label:'Mortgage loans',   short:'Vivienda',  codes:['146000000'], group:'segment' },
  { key:'consumo',   label:'Consumer loans',   short:'Consumo',   codes:['148000000'], group:'segment' },
  { key:'bancos',    label:'Due from banks',   short:'Bancos',    codes:['143000000'], group:'segment' },
];
export const CL_CREDIT_QUALITY = {
  npl90:      ['857000000'],                             // c1
  npl90Ext:   ['857100200','857200102'],                 // c1 — offshore slice
  impaired:   ['811000000'],
  impairedExt:['811100200','811200102'],
  nonAccrual: ['812000000'],
  chargeOffs: ['813000000'],
  recoveries: ['814000000'],
  grossClient:['821000000'],
  grades: { normal:['851000000','854000000'], substandard:['852000000'], default:['853000000','855000000'] },
  allowance:  ['149000000'],                             // b1, negative
  allowanceBySeg:{ comercial:['149500100'], vivienda:['149600100'], consumo:['149700100'],
                   bancosPais:['143150100'], bancosExt:['143250100'] },
};
```

`CO_CREDIT_*`, `PE_CREDIT_*`, `BR_CREDIT_*`, `MX_CREDIT_*`, `AR_CREDIT_*`, `US_CREDIT_*`,
`PA_CREDIT_*` follow the same shape using the codes tabulated in §2.

### 4.4 Engine changes — `fundingAnalytics.js` is *almost* reusable as-is

The `cfg()` contract (`fundingAnalytics.js:243-476`) is genuinely generic: `instruments`,
`colors`, `b1Accounts`, `r1Accounts`, `snapshot`, `series`, `sum`, `specialSeries`,
`specialPctSeries`, `costSeries`, `fundingSeries`, `specialKpi`, `specialCompareRows`,
`instrumentExtraHead/Cell`, `notes`. Two real gaps:

1. **`c1` fetch.** `loadFundingData()` (`:525-528`) fetches exactly `b1` + `r1`. Chile's whole
   quality tree is `tipo='c1'`, and UY's `Anexo 4` ratios want their own tipo. Generalise to a
   declared list, e.g. `c.tipos = ['b1','r1','c1']` driving `Promise.all(c.tipos.map(t => fetchData(t, c.accounts[t](), …)))`.
   `fetchData` (`api.js:58`) already takes an arbitrary `tipo` and caches per tipo, so this is
   additive.
2. **Ratio rows must never be summed.** `sumRows`-style helpers add `monto_total` across accounts.
   Ratio accounts (`A4_*`, MX `IMOR`, AR `Sit.*`, US `NCLNLSR`) must be read with a
   *pick-one-bank-one-period* accessor and, for group entities, **recomputed from stocks**, not
   averaged. See §4.5.

Everything else transfers: `resolveEntities()` (banks / rating baskets / custom groups),
`MAX_COMPARE_ENTITIES = 6`, `MAX_FETCH_BANKS = 24`, the Bars / Lines / Area `chartStyle`
switch, the custom-group editor and its `faBankGroups_{ISO}` localStorage key (Asset Quality
should read the **same** key — one saved peer group, both sheets), and `drawLineChart`/`sparseData`.

**Recommendation:** extract the shared shell (peer picker, group editor, chart-style toggle,
compare table, KPI grid) into `js/views/peerAnalyticsShell.js` and have both
`fundingAnalytics.js` and `assetQuality.js` supply a `cfg()`. If that refactor is judged too
invasive for one PR, ship `assetQuality.js` as a deliberate fork of the file and schedule the
extraction — but say so in the PR, because 56 KB of duplicated UI will drift.

### 4.5 Storing ratios — the one schema decision

`datos_financieros` is `(country, periodo, tipo, ins_cod, cuenta, monto_clp, monto_uf, monto_tc,
monto_ext, monto_total)` with `PK (country, periodo, tipo, ins_cod, cuenta)`. Regulator-published
ratios (UY `Anexo 4`, MX `IMOR`/`ICOR`, AR `Sit.*`/`A9`/`A14`, US `NCLNLSR`) don't fit "amount"
semantics.

**Recommended:** new `tipo = 'q1'` ("quality indicators"), values stored in `monto_total` as
**basis points ×100** (i.e. `2.25% → 225`) to stay integral, with the convention documented in
each loader header and a `js/format.js` helper `ratioFromQ1(v) => v / 100`.
This (a) needs **no migration** — `tipo` is already a free-text key, (b) keeps ratios out of
every existing balance/income aggregation, which all filter by `tipo`, and (c) mirrors what
`usa_loader.py` already does for `ROA`/`ROE` via `RATIO_FIELDS`, except with a tipo that can't be
mistaken for a stock. `schema_guard` will flag the new accounts on first ingest — expected.

**Group aggregation rule (must be enforced in code):** for a rating basket or custom group,
**sum the stocks then divide**; never average the published ratios. Where a country has *only*
the ratio (MX `IMOR`, AR `Sit.*`), reconstruct the stock as `ratio × stock` per bank, sum, then
divide — and add a UI note that the group figure is reconstructed.

### 4.6 Files to create / change

| File | Change |
|---|---|
| `js/views/assetQuality.js` | **new** — the sheet (or `cfg()` for the extracted shell) |
| `js/views/peerAnalyticsShell.js` | **new (recommended)** — peers / compare / chart-style / group editor extracted from `fundingAnalytics.js` |
| `js/clCuentas.js` | add `CL_CREDIT_SEGMENTS`, `CL_CREDIT_QUALITY`, `clCreditSnapshot`, `clCreditAccountsForRun` (b1 + c1) |
| `js/coCuentas.js` | add `CO_CREDIT_*`, `coCreditSnapshot`; **fix `coDeterioroActivoCuentasFromPlan` double count (§3.2)** |
| `js/peCuentas.js` | add `PE_CREDIT_*`, `peCreditSnapshot`; `peSum/peSeries` gain a `field` arg for consistency |
| `js/uyCuentas.js` | add `UY_CREDIT_SEGMENTS`, `UY_CREDIT_NPL`, `UY_CREDIT_RATIOS`, `uyCreditSnapshot` |
| `js/brCuentas.js` | add `BR_CREDIT_*` (`78191/78192/78193/78183`, plus report-130 columns once ingested) |
| `js/mxCuentas.js`, `js/arCuentas.js`, `js/usCuentas.js`, `js/paCuentas.js` | add `*_CREDIT_*` maps (currently 5–19 accounts each; these files are small) |
| `js/format.js` | add `ratioFromQ1`, `coveragePct`, `costOfRiskPct`; leave `nplPctFromRaw` intact |
| `js/ui.js` | add `ASSET_QUALITY_ENABLED_ISO`; extend `DETAIL_TAB_TITLES`, `showTab()`, `syncCountryDisabledTabs()`; re-enable `btnResChartMora` per country as each lands |
| `js/app.js` | route `assetquality` → `renderAssetQuality` and expose on `window` |
| `dashboard.html` | tab button next to `data-tab="funding"`; `<div id="assetQualityRoot">` inside a new `#tab-assetquality`; reuse the `#fundingAnalyticsRoot` CSS block |
| `uruguay_loader.py` | `parse_anexo2()` → `A2_*`; `parse_anexo4()` → `A4_*` as `tipo='q1'`; optionally extend `parse_anexo1()` to the `Créditos vigentes` block; **`--all` re-ingest** |
| `argentina_loader.py` | extract `esd/COMPLETO.TXT` + `indicad/completo.txt` from the archive it already downloads; per-file `SCALE`; take numeric column 5; re-ingest |
| `brasil_loader.py` | ingest `dados{dt}_3.json` with the `info{dt}.json` label dictionary; report 130 + 126 columns; re-ingest |
| `mexico_loader.py` | parse `CCT` (banks as rows) and `Cartera y calif` (banks as columns); non-numeric → `NULL`; re-ingest |
| `usa_loader.py` | extend `FIELDS` with the §2.7 list; `NCLNLSR`/`LNRESNCR`/`LNATRESR` → ratio path; `NTLNLSQ`/`ELNATR` → `r1`; re-ingest |
| `panama_loader.py` | extend `B1_LABELS` with `Locales`/`Extranjero`/`Menos Provisiones` children + `Provisiones Dinámicas`; re-ingest |
| `HANDOFF_AssetQuality_Rollback.md` | new rollback note |

All edited modules get the next `?v=bmonNN` (repo is at `bmon70`).

### 4.7 Day-1 enablement

**Phase 1 — ship with zero loader risk.** `ASSET_QUALITY_ENABLED_ISO = ['CL','CO','PE']`.
Everything needed is already in `datos_financieros`; the only backend dependency is the `c1` fetch
(§4.4). This alone gives NPL, coverage, cost of risk and sector mix for three countries, plus
Chile's offshore-impaired lens — and it fixes the Colombia double count.

**Phase 2 — the user's primary ask.** Uruguay: `parse_anexo2` + `parse_anexo4` + `--all`
re-ingest, then `ASSET_QUALITY_ENABLED_ISO += ['UY']`. Ships the residency lens, the
residency × currency cross-tab, and BCU's own `VII.5` / `IV.1` / `VII.1` as validation rows.
Independent of Phase 1 and can run in parallel; do it as its own PR so the re-ingest is revertible.

**Phase 3 — one loader each, in ascending risk order.**
`US` (add field names — lowest risk, and it becomes the first detail tab US supports) →
`PA` (label map, geography lens, **no NPL**) →
`AR` (two extra files from an archive already downloaded; ratio-first UI) →
`MX` (two new sheet parsers, one transposed) →
`BR` (new portal-file path + `info{dt}` dictionary; **do not enable `Ativos problemáticos` until
validated against a bank's own disclosure**).

**Greyed out with a message, day 1 and after:** `LU`, `PY` (no data at all — and fix the
bootstrap fallback, §2.9). Tooltip copy, following the existing pattern at `ui.js:483-485`:
`"Asset Quality is available for Chile, Colombia and Peru"`, widened as phases land.

**Per-country UI honesty strings** (render under the KPI grid, not buried in notes):

- PA — *"SBP does not publish past-due loans. NPL and coverage of NPL are unavailable; this sheet
  shows loans by geography and allowance coverage of total loans."*
- UY — *"Non-resident share from Anexo 2 covers performing credit only; BCU's published VII.5
  (shown alongside) includes overdue non-resident credit, which Anexo 2 does not split by residency."*
- BR — *"SCR-based (document 3040); may diverge from accounting statements. `Inadimplência` and
  `Ativos problemáticos` are Res. 4557 definitions, wider than 90-day NPL."*
- CL — for banks where `857000000 = 0`: *"No 90+ day arrears reported; leading with impaired
  portfolio and subestándar + incumplimiento."*
- AR — *"ARS levels are nominal in a high-inflation economy; ratios are the comparable series."*
- PE — *"Allowance derived as gross − net; the published `PROVISIONES` balance line is unreliable."*
- MX / AR — *"Group figures reconstructed from per-bank ratios × stock, then re-divided."*

---

## 5. Rollback

Tag `main` immediately before the first Asset Quality merge, matching the Funding convention
(`pre-br-funding-analytics-20260805`, `pre-cl-…`, `pre-uy-…`):

```bash
git tag pre-asset-quality-20260805 main
git push origin pre-asset-quality-20260805
```

Restore:

```bash
git checkout -b restore/pre-asset-quality pre-asset-quality-20260805
```

Because Phases 2 and 3 each require a **historical re-ingest**, tag per phase as well
(`pre-uy-anexo2-20260805`, `pre-ar-esd-…`, …). Loader changes here are all *additive* — new
`cuenta` keys, new `tipo='q1'` rows — so a revert of the front-end alone leaves the extra rows
harmlessly unread; only `plan_cuentas` grows. `schema_guard` will flag the new accounts on the
first ingest of each phase, which is the expected signal, not a failure.

---

## 6. Evidence appendix — how to reproduce every number

```bash
# UY — Anexo 2 / 4 straight from BCU (all 11 banks, 2026-06)
curl -sk -A LatamBanksUY/1.0 -o i1.xls \
  "https://www.bcu.gub.uy/Servicios-Financieros-SSF/Boletin%20SSF/2026/Junio/institucion1.xls"
python3 -c "import xlrd;b=xlrd.open_workbook('i1.xls');sh=b.sheet_by_name('Anexo 2');
print([[sh.cell_value(r,c) for c in range(4)] for r in range(8,48)])"
# schema stability: same shape at .../2020/Diciembre/institucion1.xls

# UY — confirm Anexo 2/4 are NOT in the DB (191 accounts, 35 A1_*, zero A2_*)
curl -s "https://latambanks.vercel.app/api/bootstrap?country=UY" | python3 -c \
 "import json,sys;d=json.load(sys.stdin);pc=d['planCuentas'];print(len(pc),
  len([x for x in pc if x['cuenta'].startswith('A1_')]),
  len([x for x in pc if x['cuenta'].startswith('A2_')]))"

# CL — quality tree, live (c1)
curl -s -X POST https://latambanks.vercel.app/api/datos -H 'Content-Type: application/json' \
 -d '{"country":"CL","tipo":"c1","periodos":["202606"],"bancos":[1,16,59],
      "cuentas":["857000000","857200102","811000000","811200102","812000000","813000000",
                 "814000000","851000000","852000000","853000000","854000000","855000000","821000000"]}'

# CO — full A–E grid + deterioro (and the double-count proof: 148705+148710 == 148700)
curl -s -X POST https://latambanks.vercel.app/api/datos -H 'Content-Type: application/json' \
 -d '{"country":"CO","tipo":"b1","periodos":["202605"],"bancos":[1],
      "cuentas":["140000","141000","141005","141015","141020","141025",
                 "148700","148705","148710","149500","149100","148900","149800"]}'

# PE — vigentes / refinanciados / atrasados + sector slugs
curl -s -X POST https://latambanks.vercel.app/api/datos -H 'Content-Type: application/json' \
 -d '{"country":"PE","tipo":"b1","periodos":["202606"],"bancos":[1,3],
      "cuentas":["VIGENTES","REFINANCIADOS_Y_REESTRUCTURADOS","ATRASADOS","EN_COBRANZA_JUDICIAL",
                 "CREDITOS_NETOS","PRESTAMOS","HIPOTECARIOS_PARA_VIVIENDA","COMERCIO_EXTERIOR"]}'

# BR — report 130: Total Exterior, Ativos problemáticos, Inadimplência, C1–C5
P=https://www3.bcb.gov.br/ifdata/rest
curl -s "$P/arquivos?nomeArquivo=ifdata_2025_2030//202603/info202603.json"      -o info.json
curl -s "$P/arquivos?nomeArquivo=ifdata_2025_2030//202603/trel202603_130.json"  -o trel130.json
curl -s "$P/arquivos?nomeArquivo=ifdata_2025_2030//202603/dados202603_3.json"   -o dados3.json
# join: trel130.c[].ifd -> info[].id -> info[].lid -> dados3.values[].v[].i
# BTG Pactual prudential = entity 1000080336

# MX — CNBV workbook: sheets CCT (IMOR/ICOR) and "Cartera y calif" (etapas 1/2/3)
curl -sk -o mx.xlsx "https://portafolioinfo.cnbv.gob.mx/PortafolioInformacion/BE%20BM%20202605.xlsx"

# AR — same 7z the loader already downloads; esd + indicad
curl -sk -A Mozilla/5.0 -o ar.7z \
 "https://www.bcra.gob.ar/archivos/Pdfs/PublicacionesEstadisticas/Entidades/202604d.7z"
python3 -c "import py7zr;py7zr.SevenZipFile('ar.7z').extract(path='arx',targets=[
 'Entfin/Tec_Cont/esd/COMPLETO.TXT','Entfin/Tec_Cont/indicad/completo.txt'])"
# Galicia (00007): esd Sit.3+4+5 col5 = 8.09 == indicad A9 col5 = 8.09

# US — FDIC credit quality on the same endpoint usa_loader.py already uses
curl -sL -G "https://api.fdic.gov/banks/financials" \
 --data-urlencode "filters=CERT:628 AND REPDTE:20260331" \
 --data-urlencode "fields=LNLS,LNLSNET,LNATRES,NCLNLS,NCLNLSR,LNRESNCR,LNATRESR,P3ASSET,P9ASSET,NTLNLSQ,ELNATR,LNRE,LNCI,LNCON,LNCRCD,LNAUTO,LNAG,LNDEP,LNMUNI,LNFG"

# PA — SBP balance: CARTERA CREDITICIA → Locales / Extranjero / Menos Provisiones
curl -sk -o pa.xlsx "https://www.superbancos.gob.pa/documentos/financiera_y_estadistica/\
reportes_estadisticos/2026/05/balance_individual_por_banco/RE-BALANCE-BANCO-en-Bladex.xlsx"

# LU / PY fall back to Chile (bug, §2.9)
curl -s "https://latambanks.vercel.app/api/bootstrap?country=LU" | head -c 200
```
