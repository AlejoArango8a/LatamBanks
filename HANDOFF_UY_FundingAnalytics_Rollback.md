# Rollback — Uruguay Funding Analytics

**Checkpoint tag (pre-change):** `pre-uy-funding-analytics-20260805`

Points at `main` immediately before Uruguay Funding Analytics (currency lens + Anexo 1 term structure).

## Restore

```bash
git show pre-uy-funding-analytics-20260805 --stat
git checkout -b restore/pre-uy-funding pre-uy-funding-analytics-20260805
```

Also see `HANDOFF_CL_FundingAnalytics_Rollback.md` / `HANDOFF_BR_FundingAnalytics_Rollback.md`.

## What this expansion added

- Funding Analytics enabled for **Uruguay** (with Brazil & Chile)
- `uruguay_loader.py`: M/N → `monto_clp`, M/E → `monto_ext`; Anexo 1 → synthetic `A1_*` vista/plazo accounts
- `js/uyCuentas.js` — funding instruments, FX dims, term buckets, cost proxy (`5`)
- Special view: **FX (≈USD) share** of ordinary funding + demand/term panel from Anexo 1
- Full historical re-ingest required so currency columns and `A1_*` accounts are populated

See `HANDOFF_UY_FundingAnalytics_Blueprint.md` for the evidence-backed design.
