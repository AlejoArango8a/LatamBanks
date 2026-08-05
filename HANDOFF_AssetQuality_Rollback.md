# Rollback — Asset Quality Analytics

**Checkpoint tag (pre-change):** `pre-asset-quality-20260805`

Points at `main` immediately before the first Asset Quality merge.

## Restore

```bash
git show pre-asset-quality-20260805 --stat
git checkout -b restore/pre-asset-quality pre-asset-quality-20260805
```

Also see Funding rollback handoffs for sibling tags.

## What this change added

- New **Asset Quality** tab for **CL, CO, PE, UY** (peer compare, chart styles, custom groups)
- `js/aqCuentas.js` — per-country loan / NPL / coverage / special-lens maps
- `js/views/assetQuality.js` — analytics sheet (fork of Funding Analytics UX)
- **Uruguay:** `uruguay_loader.py` parses **Anexo 2** (`A2_*` residency × FX credit stocks) and **Anexo 4** (`A4_*` ratios as `tipo=q1`, percent×100)
- Colombia NPL/deterioro double-count fix (`coMoraNumerator` parent-only)
- Blueprint: `HANDOFF_AssetQuality_Blueprint.md`
- Cache bust: `bmon71`

## UY re-ingest

After deploy, history must be reloaded so `A2_*` / `A4_*` exist for all periods:

```bash
python3 uruguay_loader.py --all --from 202401 --to 202606
python3 uruguay_loader.py --all --from 202001 --to 202312
```
