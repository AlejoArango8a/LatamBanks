# Loaders — checklist para mañana (con `COCKROACH_URL`)

Objetivo: dejar **live con datos** CL (ya), CO (ya), BR (backfill hist.), UY (nuevo), PE (nuevo).

```bash
cd LatamBanks
# .env con COCKROACH_URL=...
pip install -r requirements.txt
```

## 1) Brasil — backfill histórico IF.data (PR #1)

```bash
python brasil_loader.py --all --from 201403 --to 202412
# o GHA: Brasil - Auto Update → mode=range, from=201403, to=202412
```

Continúa la serie prudencial previa a 2025 (mismo portal IF.data).

## 2) Uruguay — BCU Boletín SSF (PR #3 / rama UY)

```bash
python uruguay_loader.py --all --from 202001 --to 202606
python uruguay_loader.py   # incremental después
# o GHA: Uruguay BCU/SSF → mode=range
```

## 3) Perú — SBS B-2201 (esta rama)

```bash
python peru_loader.py --all --from 201501 --to 202512
# smoke de un mes:
python peru_loader.py --month 202512
python peru_loader.py   # incremental
# o GHA: Peru SBS B-2201 → mode=range
```

Dry-run sin DB:
```bash
python peru_loader.py --dry-run --month 202512
python uruguay_loader.py --dry-run --from 202606 --to 202606
```

## 4) Verificación rápida en dashboard

1. Merge/deploy de PRs (UY + PE + BR hist.).
2. `dashboard.html?country=brasil` — series pre-2025.
3. `?country=uruguay` — BROU / Itaú, equity cuenta `3`.
4. `?country=peru` — BCP / Interbank, equity `PATRIMONIO`.

## Contratos de equity (sidebar)

| País | Cuenta equity | Env override |
|------|---------------|--------------|
| CL | `300000000` | — |
| CO | `300000` | `CO_EQUITY_CUENTA` |
| BR | `78186` / `140246` | — |
| UY | `3` | `UY_EQUITY_CUENTA` |
| PE | `PATRIMONIO` | `PE_EQUITY_CUENTA` |

## Notas

- PE/UY: valores en unidades enteras (miles × 1000).
- PE: excluye “Total Banca Múltiple” y BCP con sucursales exterior.
- Sin BTG local en PE ni UY → default = mayor patrimonio.
- Si un mes SBS/BCU aún no salió, el discover lo salta; reintentar al día siguiente.
