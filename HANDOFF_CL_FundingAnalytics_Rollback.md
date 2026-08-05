# Rollback — Chile Funding Analytics

**Checkpoint tag (pre-change):** `pre-cl-funding-analytics-20260805`

Points at `main` immediately before Chile Funding Analytics / multi-country funding expansion.

## Restore

```bash
git show pre-cl-funding-analytics-20260805 --stat
git checkout -b restore/pre-cl-funding pre-cl-funding-analytics-20260805
```

Also see `HANDOFF_BR_FundingAnalytics_Rollback.md` for the earlier Brazil-only checkpoint (`pre-br-funding-analytics-20260805`).

## What this expansion added

- Funding Analytics enabled for **Chile** and **Brazil**
- `js/clCuentas.js` — CMF funding instruments, UF/FX dims, MR1 expense maps
- Chile Balance Sheet: deeper vista/plazo/letras/bonos/T2/AT1 rows
- Chile-specific views: funding mix, UF/FX share (not tax-exempt letters), cost proxy from `412*`
