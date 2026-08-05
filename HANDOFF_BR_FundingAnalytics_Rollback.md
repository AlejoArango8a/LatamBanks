# Rollback — Brazil Funding Analytics

**Checkpoint tag (pre-change):** `pre-br-funding-analytics-20260805`

Points at `main` immediately before the Funding Analytics / Brazil funding granularity expansion.

## Restore that version

```bash
# inspect
git show pre-br-funding-analytics-20260805 --stat

# hard reset local main to checkpoint (destructive to later commits)
git checkout main
git reset --hard pre-br-funding-analytics-20260805

# or create a revert branch without rewriting history
git checkout -b restore/pre-br-funding pre-br-funding-analytics-20260805
```

Production rollback: open a PR from a branch based on the tag, or revert the Funding Analytics merge commit on `main`.

## What the expansion added

- Tab **Funding Analytics** (Brazil only): mix, tax-advantaged LCA+LCI, cost proxy
- Balance Sheet LCI / LCA / LF rows with Cosif old+new codes
- Bank Monitor: demand/time deposits + LCA+LCI charts enabled
- Account View enabled for Brazil (flat IF.data Conta search)
