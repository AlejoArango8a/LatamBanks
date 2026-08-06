# Rollback — United States Asset Quality (FDIC)

**Checkpoint tag (pre-change):** create on `main` before merge if not present:

```bash
git tag pre-us-asset-quality-20260806 main
git push origin pre-us-asset-quality-20260806
```

## Restore code

```bash
git checkout -b restore/pre-us-asset-quality pre-us-asset-quality-20260806
```

## What this change added

- Cron failure alerting: `.github/actions/notify-loader-failure` + wire-up on all 9 country loader workflows (`issues: write`)
- `usa_loader.py` — AQ Call Report fields (`LNLSNET`, `LNATRES`, `NCLNLS`, past-due, sector loans, `NTLNLSQ`/`ELNATR`, q1 ratios)
- `js/aqCuentas.js` — `US_AQ_*` maps + past-due special lens
- `js/views/assetQuality.js` — United States cfg
- `ASSET_QUALITY_ENABLED_ISO` includes `US`
- Cache bust `bmon75`

## Re-ingest

```bash
# smoke
python3 usa_loader.py --quarter 202603 --top 50
# history (upsert; refreshes AQ fields on already-loaded quarters)
python3 usa_loader.py --all --from 201503 --top 300
```

FDIC BankFind financials go back via the JPM anchor catalog (~40 recent quarters in practice).
