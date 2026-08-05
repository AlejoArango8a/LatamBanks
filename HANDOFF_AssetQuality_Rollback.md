# Rollback — Asset Quality Analytics

**Checkpoint tag (pre-change):** `pre-asset-quality-20260805`

Points at `main` immediately before the first Asset Quality merge.

## Restore

```bash
git show pre-asset-quality-20260805 --stat
git checkout -b restore/pre-asset-quality pre-asset-quality-20260805
```

Also see `HANDOFF_CL_FundingAnalytics_Rollback.md` / `HANDOFF_BR_FundingAnalytics_Rollback.md` /
`HANDOFF_UY_FundingAnalytics_Rollback.md` for the sibling Funding tags.

## What this change added

Front-end only — **no loader was touched in this PR**.

| File | Change |
|---|---|
| `js/aqCuentas.js` | **new** — credit-quality account maps and snapshots for CL / CO / PE / UY, plus `aqSum`, `aqSeries`, `aqPct`, `aqRatioFromQ1`, `aqPickQ1` |
| `js/views/assetQuality.js` | **new** — the sheet; a deliberate fork of `js/views/fundingAnalytics.js` |
| `js/coCuentas.js` | `coMoraNumerator` now sums only the seven CUIF deterioro **parent** accounts; new `CO_DETERIORO_PARENT_CODES` / `coIsDeterioroParentCuenta`; balance rows `148000` / `149000` use the same allowlist |
| `js/ui.js` | `ASSET_QUALITY_ENABLED_ISO = ['CL','CO','PE','UY']`; `showTab('assetquality')`; `DETAIL_TAB_TITLES`; greyed-out tooltip in `syncCountryDisabledTabs()` |
| `js/app.js` | imports `renderAssetQuality`, exposes it on `window` |
| `dashboard.html` | `Asset Quality` tab button next to Funding, `#tab-assetquality` / `#assetQualityRoot`, small `.aq-*` CSS block on top of the existing `.fa-*` shell |

Cache-buster left at `?v=bmon70` — the global bump to `bmon71` happens outside this PR.

## Behaviour change to be aware of on revert

`coMoraNumerator` feeds the **Bank Monitor** NPL KPI and NPL chart for Colombia, not only
Asset Quality. Before this change it summed every `148*` / `149*` account, so it counted CUIF
parents *and* their `…05/10/15/20/25` children and reported roughly **2× the real deterioro**.
After the change it sums the seven parents
(`148700 · 148800 · 148900 · 149100 · 149300 · 149500 · 149800`), which reconcile exactly to the
published total (Banco de Bogotá 2026-05: 4,375,346,174,720).

**Reverting this file puts the inflated Colombia NPL back.** If you need to roll back the Asset
Quality sheet but keep the fix, revert `js/aqCuentas.js`, `js/views/assetQuality.js`,
`js/ui.js`, `js/app.js` and `dashboard.html` only, and leave `js/coCuentas.js` in place.

## Uruguay depends on a loader re-ingest

The Uruguay lens reads synthetic accounts that `uruguay_loader.py` must emit:

- `A2_*` (Anexo 2 stocks) under `tipo='b1'`
- `A4_*` (Anexo 4 ratios) under `tipo='q1'`, stored as percent ×100 (2.25% → 225)

Until that re-ingest lands, the Uruguay sheet renders empty stocks and says so in the honesty
block under the KPI grid — it does not render zeros as if they were data. That loader change is
independently revertible: it only adds new `cuenta` keys and a new `tipo`, so reverting the
front end alone leaves the extra rows harmlessly unread. Tag it separately
(`pre-uy-anexo2-20260805`) before the re-ingest.

## Known follow-ups

- **Extract the shared shell.** `assetQuality.js` duplicates the peer picker, group editor,
  chart-style toggle and compare table from `fundingAnalytics.js`. That was a deliberate call to
  keep this PR reviewable; both should move onto a `js/views/peerAnalyticsShell.js` before the
  duplication drifts (blueprint §4.4).
- **`btnResChartMora`** is still disabled for PE and UY in `syncCountryChartButtons()`. Turning it
  on per country is a separate, small change now that the numerators exist.
- Phases 3+ (US, PA, AR, MX, BR) each need their own loader change first — see blueprint §4.7.
