# Uruguay (BCU / SSF) — Funding Analytics Implementation Blueprint

**Author:** research pass, evidence-first (live API + real BCU XLS).
**Scope:** design the richest possible Funding Analytics for Uruguay, analogous to
Brazil (Cosif LCI/LCA tax lens) and Chile (CMF UF/FX currency lens).
**Headline conclusion:** Uruguay's natural special metric is **currency mix — foreign
currency (M/E, ≈USD) share of funding** — and the BCU boletín already carries the data
to build it, plus a full **vista / plazo term structure** in *Anexo 1*. The only reason
it isn't live today is that `uruguay_loader.py` throws away the M/N and M/E columns and
stores everything in `monto_total` (with `monto_clp/uf/tc/ext = 0`).

---

## 0. TL;DR / decisions

| Question | Answer (evidence-backed) |
|---|---|
| BTG Uruguay bank code | **`157`** (loader override maps it; live DB still shows legacy `HSBC Bank (Uruguay) S.A.` because it hasn't been re-ingested — see §7). |
| USD vs UYU — how? | BCU splits **every** balance line into **`Actividad en M/N`** (moneda nacional / UYU) and **`Actividad en M/E`** (moneda extranjera ≈ USD), both in pesos, plus `Total`. Loader currently keeps only `Total`. Re-ingest: `MN → monto_clp`, `ME → monto_ext`, `Total → monto_total`. **No DB schema change** (columns already exist). |
| Special metric | **FX (M/E) share of funding** = `Σ monto_ext / Σ monto_total` over funding instruments — mirrors Chile's `fxPct` exactly, just using `monto_ext`. |
| Vista vs plazo | **NOT** in the main `Situación` (deposits are split by *sector*, not term). It **is** in **`Anexo 1 — Apertura por plazos contractuales`** (Vista / <30d / <91d / <181d / <367d / <3y / ≥3y), each with M/N & M/E. Requires a new loader parser (Tier B). |
| Cost proxy | Account **`5` — Gastos por intereses y reajustes** (r1). YTD-accumulated, **resets in January** (confirmed monotonic). De-accumulate month-over-month then annualize ×12 — **reuse Chile's `clExpenseMonth` logic verbatim**. |
| Reporting frequency | **Monthly** boletín (periodos `202001`…`202606` continuous). Balance = stock at month-end; Resultados = YTD from Jan 1. |
| Rollback tag | `pre-uy-funding-analytics-20260805` on `main` before merge. |

---

## 1. Data model as it exists today

### 1.1 Where UY lives
- Loader: `uruguay_loader.py` (country=`UY`). Source: BCU/SSF *Boletín informativo mensual*,
  files `institucion{ID}.xls`. Values are **miles de pesos** in the XLS, multiplied by
  `SCALE = 1000` → stored as **integer pesos** in `monto_total`.
- Front-end account map: `js/uyCuentas.js` (`UY_KPI`, `BAL_UY_SECTIONS`, `R1_UY_ROWS`,
  `uySum`, `uySeries`, `uyB1AccountsForRun`, `uyR1AccountsForRun`).
- Balance/Income wiring: `js/views/balance.js` already imports `BAL_UY_SECTIONS` / `R1_UY_ROWS`.
- Table `datos_financieros` columns (shared across countries):
  `country, periodo, tipo, ins_cod, cuenta, monto_clp, monto_uf, monto_tc, monto_ext, monto_total`.
  UY rows are written by the loader as `(COUNTRY, periodo, "b1"|"r1", ins_cod, cuenta, 0, 0, 0, 0, val)`.

### 1.2 The bug that blocks currency analytics
`uruguay_loader.py` → `parse_institution_xls()`:
```python
# Columna Total = índice 3 (MN=1, ME=2, Total=3)
total_col = 3 if sh.ncols > 3 else sh.ncols - 1
val = _cell_num(sh, r, total_col)
rows.append((COUNTRY, periodo, "b1", ins_cod, cuenta, 0, 0, 0, 0, val))
```
It reads only column 3 (Total) and hard-codes the currency columns to `0`.
**Verified live** (`POST /api/datos`, UY, 202606): every row returns
`monto_clp:0, monto_uf:0, monto_tc:0, monto_ext:0`. So today the front-end cannot compute
any currency split for UY — that is the single change that unlocks the whole feature.

---

## 2. Proof from the real BCU XLS (2026-06, `institucion1.xls` = BROU)

`Situación` sheet is `121 rows × 4 cols`. Header row 8:
```
['', 'Actividad en M/N', 'Actividad en M/E', 'Total']
```
i.e. **col0 = label, col1 = M/N (UYU), col2 = M/E (foreign ≈USD), col3 = Total** — both
currency columns already expressed in pesos.

Real liability values (thousands of pesos, before ×1000 scaling):

| Cuenta | Label | M/N | M/E | Total | **M/E %** |
|---|---|---:|---:|---:|---:|
| `2 - PASIVOS` | Total liabilities | — | — | 919,700,913 | — |
| `2.1` | Pasivos a costo amortizado | 290,381,567 | 606,467,796 | 896,849,364 | **67.6%** |
| `2.1.1` | Banco Central del Uruguay | 227,161 | 721,660 | 948,821 | 76% |
| `2.1.2` | Depósitos sector financiero | 563,211 | 164,721 | 727,933 | 23% |
| `2.1.3` | Depósitos SNF **privado** | — | — | 810,656,900 | (see A1) |
| `2.1.4` | Depósitos SNF **público** | — | — | 64,737,476 | — |
| `2.1.5` | Débitos por valores negociables | 9,222,693 | 5,813,522 | 15,036,215 | 39% |
| `2.1.6` | Otros | 222,312 | 4,519,705 | 4,742,017 | 95% |
| `2.10` | Obligaciones emitidas no negociables | — | — | 0 | — |

> M/N and M/E come from `Anexo 1` (row 26 for `2.1`); the main `Situación` carries the
> same MN/ME/Total triple on every line — that is where the loader must read cols 1 & 2.

Cross-check that confirms the mapping is correct: `Anexo 1` "Depósitos sector no
financiero" total `875,394,376` = `2.1.3` (810,656,900) + `2.1.4` (64,737,476). ✔

### 2.1 BTG Uruguay (code 157), 2026-06 — `Situación`
| Cuenta | Label | M/N | M/E | Total | **M/E %** |
|---|---|---:|---:|---:|---:|
| `2` | PASIVOS | 30,909,736 | 55,443,945 | 86,353,682 | **64.2%** |
| `2.1.3` | Depósitos SNF privado | 12,635,290 | 49,691,142 | 62,326,432 | **79.7%** |
| `2.1.5` | Débitos por valores negociables | 16,616,168 | 2,406,789 | 19,022,957 | 12.7% |
| `2.10.1` | Pasivos subordinados | 0 | 681,972 | 681,972 | 100% |
| `2.10.4` | Instr. subordinados contingentemente convertibles (AT1/CoCo) | 0 | 1,203,480 | 1,203,480 | 100% |
| `2.10.5` | Acreedores por intereses | 0 | 28,153 | 28,153 | 100% |

**This is the market narrative, quantified:** BROU ~68% and BTG ~80% of private deposits
are foreign currency. Subordinated / AT1 are 100% USD.

Schema stability verified: `institucion1.xls` for **2020-12** has the identical
`Situación` header and column layout (`2.1.3` = MN 129,765,298 / ME 475,118,763), so a
re-ingest works uniformly across the whole 2020-01 → 2026-06 history.

---

## 3. Currency (USD) — exact mechanism

- **M/E ≈ USD but not exactly.** `Actividad en M/E` is *all* foreign currency converted to
  pesos; in Uruguay this is overwhelmingly USD, with a small EUR/AR$/BR$ tail. Label the
  UI metric **"FX (foreign currency)"** with a note "predominantly USD" — same honesty
  caveat Chile uses for `monto_ext`.
- **UI (Unidad Indexada) / UR:** Uruguay's inflation-indexed unit is **not** broken out in
  the boletín main statement. UI-denominated instruments sit inside **M/N** (they are
  peso instruments). So — unlike Chile's `monto_uf` — there is **no UF/UI column** for us
  to populate. Leave `monto_uf = 0`, `monto_tc = 0`.
- **Field mapping (the whole feature hinges on this):**
  - `monto_clp` ← `Actividad en M/N` (col 1) — local currency (UYU). *(We reuse the CLP
    column name generically = "local currency" for UY, exactly as Chile reuses it.)*
  - `monto_ext` ← `Actividad en M/E` (col 2) — foreign currency (≈USD).
  - `monto_total` ← `Total` (col 3) — unchanged.
- **Front-end FX share** (mirrors `clFundingSnapshot`):
  `fxPct = Σ monto_ext / Σ monto_total`, `localPct = Σ monto_clp / Σ monto_total`.

---

## 4. Instrument map — `UY_FUNDING_INSTRUMENTS`

Two tiers. **Tier A** works the moment the loader re-ingests MN/ME (no new parser).
**Tier B** adds vista/plazo granularity from `Anexo 1` (needs a new parser).

### 4.1 Tier A — from `Situación` account tree (recommended MVP)
Mutually exclusive; do **not** also sum parents (`2`, `2.1`).

```js
export const UY_FUNDING_INSTRUMENTS = [
  { key:'depSNFPriv', label:'Deposits — private non-financial', short:'Dep. priv.',  codes:['2.1.3'], group:'deposits',  special:false },
  { key:'depSNFPub',  label:'Deposits — public non-financial',  short:'Dep. púb.',   codes:['2.1.4'], group:'deposits',  special:false },
  { key:'depSF',      label:'Deposits — financial sector',       short:'Dep. fin.',   codes:['2.1.2'], group:'deposits',  special:false },
  { key:'bcu',        label:'Central Bank funding (BCU)',        short:'BCU',         codes:['2.1.1'], group:'wholesale', special:false },
  { key:'valores',    label:'Marketable debt securities',        short:'Valores',     codes:['2.1.5'], group:'debt',      special:false },
  { key:'otrosCA',    label:'Other amortized-cost liabilities',  short:'Otros CA',    codes:['2.1.6'], group:'wholesale', special:false },
  { key:'fvDeposits', label:'Deposits at fair value',            short:'Dep. FV',     codes:['2.2.2','2.3.1'], group:'deposits', special:false },
  { key:'fvValores',  label:'Debt securities at fair value',     short:'Val. FV',     codes:['2.2.1','2.3.2'], group:'debt',      special:false },
  { key:'subord',     label:'Subordinated liabilities',          short:'Subord.',     codes:['2.10.1'], group:'capital',  special:true },
  { key:'at1',        label:'AT1 / contingent convertibles',     short:'AT1',         codes:['2.10.4'], group:'capital',  special:true },
  { key:'prefShares', label:'Preferred shares',                  short:'Pref.',       codes:['2.10.2'], group:'capital',  special:true },
];
```
Notes on grouping / totals:
- **Ordinary funding** (for ratios / cost / FX-share denominators) = groups
  `deposits + wholesale + debt` = codes `2.1.1, 2.1.2, 2.1.3, 2.1.4, 2.1.5, 2.1.6`
  (+ FV deposits/valores if non-zero). Exclude `capital` group, exactly like Chile.
- **Deposits total** (for LtD) = `2.1.2 + 2.1.3 + 2.1.4` (matches existing `UY_KPI.captaciones`).
- `2.10.3 Capital reembolsable a la vista` and `2.10.5 Acreedores por intereses` exist but
  are tiny/accrual — leave out of the stack (or fold `2.10.5` into "Otros").

### 4.2 Tier B — vista/plazo from `Anexo 1` (the "richest" extension)
`Anexo 1 — Apertura por plazos contractuales` is `67 rows × 6 cols`
(`label 0-2, M/N=3, M/E=4, Total=5`). For **Depósitos sector no financiero** (rows 43-50)
BROU 2026-06:

| Term bucket | M/N | M/E | Total | share of dep |
|---|---:|---:|---:|---:|
| **Vista** (demand) | 213,122,742 | 479,909,876 | 693,032,618 | **79.2%** |
| < 30 días | 269 | 20,003 | 20,272 | 0.0% |
| < 91 días | 5,876,765 | 17,810,942 | 23,687,708 | 2.7% |
| < 181 días | 8,775,755 | 42,271,537 | 51,047,292 | 5.8% |
| < 367 días | 30,292,551 | 35,468,743 | 65,761,294 | 7.5% |
| < 3 años | 20,803,923 | 18,958,832 | 39,762,755 | 4.5% |
| ≥ 3 años | 1,274,181 | 808,251 | 2,082,432 | 0.2% |

→ Vista ≈ 79% of deposits, and vista is ~69% M/E. This is the "vista vs plazo + USD"
double lens the desk wants.

`Anexo 1` sections (each with the 7 term rows above): `Depósitos sector financiero`,
`Depósitos sector no financiero`, `Débitos representados por valores negociables`,
`Banco Central del Uruguay`, `Otros`, plus the asset-side `Créditos …`.

**Parser design (Tier B):** rows have *no* account code — identify by the running section
header + indentation, and emit composite `cuenta` keys, e.g.
`A1_DEPSNF_VISTA`, `A1_DEPSNF_LT30`, `A1_DEPSNF_LT91`, `A1_DEPSNF_LT181`, `A1_DEPSNF_LT367`,
`A1_DEPSNF_LT3Y`, `A1_DEPSNF_GE3Y` (and `A1_VALORES_*`, `A1_BCU_*`, …). Store with
`tipo='b1'`, `monto_clp=MN`, `monto_ext=ME`, `monto_total=Total`. Then a Tier-B instrument
map can present `Demand (vista)` vs `Term ≤1y` vs `Term >1y`, each FX-split.
Guard with `schema_guard` since these are new synthetic accounts.

### 4.3 Colors — `UY_FUNDING_COLORS`
Reuse the Chile palette convention (blues = deposits, stone = wholesale, gold/green =
debt, browns = capital) plus `fxShare`/`localShare`/`funding`:
```js
export const UY_FUNDING_COLORS = {
  depSNFPriv:'#0ea5e9', depSNFPub:'#38bdf8', depSF:'#0284c7',
  bcu:'#0369a1', valores:'#ca8a04', otrosCA:'#a8a29e',
  fvDeposits:'#7dd3fc', fvValores:'#eab308',
  subord:'#b45309', at1:'#9a3412', prefShares:'#78716c',
  fxShare:'#2563eb', localShare:'#0d9488', funding:'#0d3b66',
};
```

---

## 5. Cost proxy — interest expense

- Numerator: account **`5` — Gastos por intereses y reajustes** (r1, stored negative).
  Optionally add account `6` "Remuneración de capital reembolsable a la vista" (usually 0).
- **Accumulation:** YTD from Jan 1, resets in January. **Verified live** for BTG (157):
  202601 `-157,759,000` → 202602 `-400,973,000` → 202603 `-611,371,000` (monotonic), and
  the June file's Resultados header literally reads `(Período 1.01.2026 - 30.06.2026)`.
- **De-accumulate + annualize:** identical to Chile — reuse `clExpenseMonth`:
  `monthFlow = YTD(m) − YTD(m−1)` (Jan = raw), then `cost% = |monthFlow| × 12 / avgStock × 100`
  where `avgStock = (fundingOrdinary(m) + fundingOrdinary(m−1)) / 2`.
- Bonus: account `5` is itself MN/ME-split in the XLS (BROU H1-26: MN −2,872,725 / ME
  −1,818,623), so once the loader captures `r1` MN/ME you can even show **cost of USD
  funding vs cost of peso funding** — a differentiator neither BR nor CL has.

`UY_FUNDING_EXPENSES = { total:['5'] }` (+ `['6']` optional).

---

## 6. Front-end wiring — exact edits

The `fundingAnalytics.js` engine is fully generic via `cfg()`; adding UY is a new `cfg()`
branch plus map exports, matching the existing CL branch almost 1:1.

1. **`js/uyCuentas.js`** — add:
   - `UY_FUNDING_INSTRUMENTS`, `UY_FUNDING_COLORS`, `UY_FUNDING_EXPENSES`, `UY_CURRENCY_DIMS`.
   - `UY_KPI.fundingOrdinary = ['2.1.1','2.1.2','2.1.3','2.1.4','2.1.5','2.1.6']`.
   - `uySum(rows, codes, periodo, field='monto_total')` — add a `field` arg (copy Chile's
     `clSum`/`clSeries`) so the engine can read `monto_ext` / `monto_clp`.
   - `uyExpenseMonth` = re-export of Chile's month de-accumulation (or import `clExpenseMonth`).
   - `uyFundingSnapshot(rows, periodo)` returning
     `{ periodo, funding, captacoes:funding, depositos, loans, capital, ext, local,
        fxPct, localPct, taxEligible:null, taxEligiblePct:null, instruments, ltd, ltf }`
     — clone `clFundingSnapshot`, swap `uf→(nothing)`, use `ext` for FX and `clp` for local.
   - `uyFundingAccountsForRun()` / `uyFundingExpenseAccountsForRun()`.
2. **`js/views/fundingAnalytics.js`**:
   - `FUNDING_COUNTRIES` → add `'UY'`.
   - Import the UY symbols.
   - Add an `if (iso === 'UY')` branch in `cfg()` modeled on the `CL` branch:
     `specialMetric:'currency'`, `specialLabel:'FX (USD) mix'`, `fundingLabel:'Captaciones'`,
     `specialSeries`/`specialPctSeries`/`costSeries`/`fundingSeries` using
     `monto_ext` for `primary`/FX and `fundingOrdinary` for totals.
   - The `iso === 'CL'` UI conditionals (KPI titles, UF/FX table columns, legends) should
     be generalized to `specialMetric === 'currency'` so UY reuses them. Where a label says
     "UF-indexed", branch on iso: CL→"UF-indexed", UY→"Local (UYU)". FX side is shared.
   - `renderKpis`/`renderCompareKpis`: the CL `ufPct/fxPct` block already exists; for UY show
     `localPct` (or just `fxPct` as the headline) — reuse `snap.fxPct`.
3. **`js/ui.js`**: `FUNDING_ENABLED_ISO = ['BR','CL','UY']`.
4. **`js/app.js`**: no change (already routes `funding` → `renderFundingAnalytics`).
5. **`dashboard.html`**: no change (`#fundingAnalyticsRoot` + CSS are country-agnostic).
6. **`uruguay_loader.py`** (the enabler): in `parse_institution_xls`, read `mn = _cell_num(sh,r,1)`,
   `me = _cell_num(sh,r,2)`, `tot = _cell_num(sh,r,3)` and append
   `(COUNTRY, periodo, tipo, ins_cod, cuenta, mn, 0, 0, me, tot)`. Guard `ncols` (Resultados &
   Situación are 4-col). Then **backfill re-ingest** all periods: `python uruguay_loader.py --all`.
   *(Tier B adds a `parse_anexo1()` producing the `A1_*` synthetic accounts.)*

### Cache-buster
Bump the `?v=bmonNN` query string on the edited modules (repo convention; currently `bmon68/69`).

---

## 7. BTG Uruguay bank code — confirmed

- **`157`** = BTG Pactual Uruguay (formerly *HSBC Bank (Uruguay) S.A.*; BTG acquired HSBC's
  Uruguay franchise). `uruguay_loader.py` already encodes the rename:
  `RAZON_SOCIAL_OVERRIDES = {157: "BTG Pactual Uruguay"}`.
- **Live-DB caveat:** `GET /api/bootstrap?country=UY` still returns
  `{"codigo":157,"razon_social":"HSBC Bank (Uruguay) S.A."}` — the override hasn't been
  applied because UY hasn't been re-ingested since it was added. The same re-ingest that
  fixes currency columns (§6.6) will also correct the display name. Until then, the UI will
  label 157 as HSBC.
- Other majors (from bootstrap): 1 BROU, 91 BHU, 110 Bandes, 113 Itaú, 128 Scotiabank,
  137 Santander, 153 BBVA, 162 Banque Heritage, 205 Citibank, 246 Banco Nación Argentina.

---

## 8. Gaps & honest UI notes

- **No account-level vista/plazo in the main balance.** Deposits in `Situación` split only
  by *sector* (financiero / privado / público). Term structure exists **only in `Anexo 1`**
  → Tier B is required for a true vista-vs-plazo chart. Until then, note "term split from
  Anexo 1 (contractual maturities)".
- **M/E ≠ pure USD.** It is total foreign currency (mostly USD). Label "FX (≈USD)".
- **No UF/UI column.** Inflation-indexed instruments are inside M/N; cannot isolate them
  from the boletín. (If ever needed, `Anexo`/other tables might help — out of scope.)
- **Currency data is retroactive-only after re-ingest.** All history (2020-01→) must be
  reloaded (`--all`) because past rows were stored with `monto_ext=0`.
- **FV / trading-book funding (`2.2`, `2.3`) is ~0** for most banks — keep in the map for
  completeness but expect empty bars.
- **Cost proxy is accounting cost**, not contractual coupon; and interest expense mixes all
  liabilities (can't cleanly attribute to a single instrument without the interest-expense
  sub-tree, which the boletín doesn't break out the way Chile's MR1 412* does).
- **Aggregate IDs 99/997** (grupo oficiales/privados) are excluded from banks — do not treat
  as institutions.

---

## 9. Files to create / change

| File | Change |
|---|---|
| `uruguay_loader.py` | **(enabler)** capture MN→`monto_clp`, ME→`monto_ext`; optional `parse_anexo1()` for Tier B; then `--all` re-ingest. |
| `js/uyCuentas.js` | add `UY_FUNDING_INSTRUMENTS`, `UY_FUNDING_COLORS`, `UY_FUNDING_EXPENSES`, `UY_CURRENCY_DIMS`, `UY_KPI.fundingOrdinary`, `uyFundingSnapshot`, `uyFundingAccountsForRun`, `uyFundingExpenseAccountsForRun`, `uySum/uySeries` `field` arg, month de-accum helper. |
| `js/views/fundingAnalytics.js` | add `'UY'` to `FUNDING_COUNTRIES`; import UY symbols; add `iso==='UY'` `cfg()` branch (currency lens); generalize CL-only `currency` UI conditionals. |
| `js/ui.js` | `FUNDING_ENABLED_ISO = ['BR','CL','UY']`. |
| `HANDOFF_UY_FundingAnalytics_Rollback.md` | new rollback note (tag below). |
| `dashboard.html`, `js/app.js` | none (already generic). |

---

## 10. Rollback

Tag `main` immediately before the UY merge:
```bash
git tag pre-uy-funding-analytics-20260805 main
git push origin pre-uy-funding-analytics-20260805
```
Restore:
```bash
git checkout -b restore/pre-uy-funding pre-uy-funding-analytics-20260805
```
(Consistent with `pre-br-funding-analytics-20260805` / `pre-cl-funding-analytics-20260805`.)

---

## 11. Evidence appendix (real values, proving the codes work)

- `GET /api/bootstrap?country=UY` → 76 periodos (`202001`…`202606`); 11 instituciones;
  full `planCuentas` (liability tree `2.1.1`–`2.1.6`, `2.10.1`–`2.10.5`).
- `POST /api/datos {country:UY, tipo:b1, periodos:[202606], bancos:[1,157],
  cuentas:[2,2.1,2.1.1..2.1.6,2.10,2.10.1,1,3]}` → returned real stocks (BROU pasivos
  919,700,913,000; 2.1.3 810,656,900,000; BTG 157 2.1.3 62,326,432,000; 2.1.5
  19,022,957,000; 2.10.1 681,972,000). **All `monto_ext=0`** → confirms currency columns
  are empty today.
- `POST /api/datos {tipo:r1, bancos:[157], cuentas:[4,5,R_EJERCICIO]}` across 202601-03 →
  interest expense (5) `-157,759,000 → -400,973,000 → -611,371,000` (YTD, monotonic) → cost
  proxy needs de-accumulation.
- Real XLS `2026/Junio/institucion1.xls` & `institucion157.xls` & `2020/Diciembre/
  institucion1.xls`: `Situación` header `['','Actividad en M/N','Actividad en M/E','Total']`
  on all three; `Anexo 1` term buckets with MN/ME confirmed (BROU deposits 79% vista, ~68%
  M/E; BTG deposits ~80% M/E). Sheets present: `Indice, Situación, Resultados, ERI,
  Anexo 1..5`.
