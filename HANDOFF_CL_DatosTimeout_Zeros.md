# Diagnóstico: ceros / timeouts en `/api/datos`

## Reproducción (2026-08-07)

Consulta estilo **Institutional Funding** peor caso en producción:

- ~**1456 cuentas** (23 AGF × 3 buckets × 20 bancos + totales)
- **102 períodos** (todo el rango CoA Chile)
- Cliente 15s / Vercel `maxDuration` 30s

Resultado:

| Timeout | Resultado |
|---------|-----------|
| 15s (frontend) | `TimeoutError` |
| 30s | `TimeoutError` |
| 60s | **HTTP 504 Gateway Timeout** |

Misma API con payload liviano (Bank Monitor b1, ~5 cuentas × 102 períodos): **~0.2–0.3s**, sin ceros.

## Causas (no son “fallas aisladas” aleatorias)

1. **Presupuesto serverless**: pool DB `max: 2` + Vercel `maxDuration: 30` + cliente `fetch` 15s. Consultas muy anchas (muchas `cuenta` × muchos `periodo`) se acercan o cruzan el límite → abort / 504. La UI pinta **0** o vacío porque no hay filas (o el error se traga en algunos flujos).
2. **Desfase de series**: `carga_log` / CoA llega a meses donde otra serie aún no existe (p.ej. IF solo hasta `202505` mientras el boostrap lista `202606`). Eso **sí** da ceros “reales” (no hay dato), no es timeout.

Concurrencia extrema empeora (1), pero el fallo principal es **tamaño de query**, no un bug de “a veces la DB no responde”.

## Mitigaciones en este cambio

- IF: fetch en **2 fases** (summary ~76 cuentas; matriz AGF×banco lazy por AGF)
- Cap de períodos IF (48) + probe de meses con stock
- `fetchData`: timeout **28s**, mensajes claros en abort/504, **chunk** de períodos (36) si el rango es ancho
