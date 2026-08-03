# Loaders — checklist para mañana (con `COCKROACH_URL`)

Objetivo: dejar **live con datos** CL/CO (ya), BR (backfill), UY, PE, US, **AR**, **MX**.

```bash
cd LatamBanks
# .env con COCKROACH_URL=...
pip install -r requirements.txt
```

## 1) Brasil — backfill histórico IF.data (PR #1)

```bash
python brasil_loader.py --all --from 201403 --to 202412
```

## 2) Uruguay — BCU Boletín SSF

```bash
python uruguay_loader.py --all --from 202001 --to 202606
```

## 3) Perú — SBS B-2201

```bash
python peru_loader.py --all --from 201501 --to 202512
```

## 4) Estados Unidos — FDIC top-100 por equity

```bash
python usa_loader.py --all --from 201503 --to 202603 --top 100
```

## 5) Argentina — BCRA datos abiertos (`.7z` mensual)

```bash
python argentina_loader.py --all --from 202001 --to 202604
python argentina_loader.py --month 202512   # smoke
python argentina_loader.py                  # incremental
# o GHA: Argentina BCRA open data
```

Fuente: `https://www.bcra.gob.ar/archivos/Pdfs/PublicacionesEstadisticas/Entidades/{YYYYMM}d.7z`  
Equity: `PATRIMONIO_NETO` · NI: `RESULTADO_NETO` (= A−P−PN). Valores: miles × 1000 → ARS.

## 6) México — CNBV Boletín Banca Múltiple (Pm2)

```bash
python mexico_loader.py --all --from 201501 --to 202605
python mexico_loader.py --month 202512   # smoke
python mexico_loader.py                  # incremental
# o GHA: Mexico CNBV Banca Múltiple
```

Fuente: `PortafolioInformacion/BE BM {YYYYMM}.xlsx` (o `BE_BM_*.xlsx`).  
Equity: `CAPITAL_CONTABLE` · NI: `RESULTADO_NETO`. Valores: MDP × 1e6 → MXN.

## Dry-run sin DB

```bash
python argentina_loader.py --dry-run --month 202512
python mexico_loader.py --dry-run --month 202512
python peru_loader.py --dry-run --month 202512
python uruguay_loader.py --dry-run --from 202606 --to 202606
python usa_loader.py --dry-run --quarter 202603 --top 5
```

## Verificación rápida en dashboard

1. Merge/deploy de PRs.
2. `?country=argentina` — Nación / Galicia, equity `PATRIMONIO_NETO`.
3. `?country=mexico` — BBVA / Banorte, equity `CAPITAL_CONTABLE`.
4. `?country=usa` — JPM / BofA, equity `EQTOT` (top 100).
5. Landing: **8 countries live**.

## Contratos de equity (sidebar)

| País | Cuenta equity | Env override |
|------|---------------|--------------|
| CL | `300000000` | — |
| CO | `300000` | `CO_EQUITY_CUENTA` |
| BR | `78186` / `140246` | — |
| UY | `3` | `UY_EQUITY_CUENTA` |
| PE | `PATRIMONIO` | `PE_EQUITY_CUENTA` |
| US | `EQTOT` | `US_EQUITY_CUENTA` |
| AR | `PATRIMONIO_NETO` | `AR_EQUITY_CUENTA` |
| MX | `CAPITAL_CONTABLE` | `MX_EQUITY_CUENTA` |

## Notas

- AR: solo entidades tipo «Bancos…» del catálogo BCRA; compañías financieras excluidas.
- MX: hoja Pm2 del boletín; captación total como proxy de depósitos.
- Sin BTG local en PE/UY/AR/MX/US → default = mayor patrimonio del ranking.
- FX: ARS/MXN vía cascada er-api / currency-api (ya cubierta).

## Freshness ops (Aug 2026)

- Chile: `chile_loader.py` + `.github/workflows/chile-cmf-monthly.yml` (probe articles-ID).
- Incremental lookback widened to **10 months** (PE/AR/MX/UY/PA) so missed months are recovered.
- Catch-up run: PE→202606, CO→202605, PA→202606, CL→202606 (articles-112240). AR May/Jun 2026 not published by BCRA yet. Chile probe window raised to 1000 IDs (May→Jun gap was ~754).
