# Rollback — Uruguay Funding Analytics

**Checkpoint tag (pre-change):** `pre-uy-funding-analytics-20260805`

Points at `main` immediately before the Uruguay Funding Analytics rollout.

## Restore

```bash
git show pre-uy-funding-analytics-20260805 --stat
git checkout -b restore/pre-uy-funding pre-uy-funding-analytics-20260805
```

See `HANDOFF_CL_FundingAnalytics_Rollback.md` and `HANDOFF_BR_FundingAnalytics_Rollback.md`
for the earlier Chile / Brazil checkpoints
(`pre-cl-funding-analytics-20260805`, `pre-br-funding-analytics-20260805`).

## What this expansion added

- Funding Analytics enabled for **Uruguay** (now `BR` + `CL` + `UY`).
- `js/uyCuentas.js` — funding instruments (Tier A Situación + Tier B Anexo 1 term buckets),
  currency dims, expense map (account `5`), `uyFundingSnapshot`, term breakdown, `field`-aware
  `uySum`/`uySeries`, `uyExpenseMonth` (re-export of Chile's `clExpenseMonth`).
- `js/views/fundingAnalytics.js` — `UY` added to `FUNDING_COUNTRIES`, new `cfg()` branch on the
  local (UYU) vs FX (≈USD) currency lens, generalized currency UI (KPIs, compare table, instrument
  columns, chart legend/colors), optional Anexo 1 term-structure panel.
- `js/ui.js` — `FUNDING_ENABLED_ISO = ['BR','CL','UY']`, `UY_DISABLED_TABS`, updated disable tooltip.

## Depends on the loader

The special metric (FX ≈USD share) and the term panel only populate once `uruguay_loader.py`
re-ingests `Actividad en M/N → monto_clp` / `Actividad en M/E → monto_ext` and emits the
`A1_*` Anexo 1 synthetic accounts. Until then the FX share reads 0% and the term panel is hidden.
