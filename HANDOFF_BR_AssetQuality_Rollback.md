# Rollback — Brazil Asset Quality (SCR dados_3)

**Checkpoint tag (pre-change):** create before merge if not present:

```bash
git tag pre-br-asset-quality-20260806 main
git push origin pre-br-asset-quality-20260806
```

## Restore code

```bash
git show pre-br-asset-quality-20260806 --stat
git checkout -b restore/pre-br-asset-quality pre-br-asset-quality-20260806
```

## What this change added

- `brasil_loader.py` also ingests `dados{dt}_3.json` (SCR credit) and labels lids from `info{dt}.json`
- `--skip-olinda` for resilient/fast reloads when Olinda is down
- `js/aqCuentas.js` — `BR_AQ_*` maps (geography, Exterior, Inadimplência, C1–C5, Cosif provisions)
- `js/views/assetQuality.js` — Brazil cfg (overseas lens)
- `ASSET_QUALITY_ENABLED_ISO` includes `BR`
- Cache bust `bmon74`

## Re-ingest

```bash
python3 brasil_loader.py --all --skip-olinda --from 201403
# smoke:
python3 brasil_loader.py --quarter 202603 --skip-olinda
```

SCR `Inadimplência` / C1–C5 lids exist from **202412**; Exterior + geography go back to **201403**.

## Uruguay companion (same ops window)

Historical A2/A4 gap `202008–202312` was filled with:

```bash
python3 uruguay_loader.py --all --from 202008 --to 202312
```
