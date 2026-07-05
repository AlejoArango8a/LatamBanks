# LatamBanks — Handoff técnico: Integración de Brasil + Detección de cambios de esquema

**Para:** Agente de IA en Cursor (Claude Opus 4.8 / Sonnet 5)
**Fecha:** Julio 2026
**Autor del análisis:** Investigación y validación de fuente hecha por fuera de Cursor. Todos los endpoints y hallazgos de este documento fueron probados manualmente contra la API real.

---

## 0. Cómo usar este documento

Este documento tiene tres partes:

1. **Contexto del proyecto** — qué es LatamBanks y cómo está construido hoy.
2. **Tarea A — Detección de cambios de esquema** (universal, aplica a los 3 países).
3. **Tarea B — Integración de Brasil** (nuevo país).

**IMPORTANTE — antes de escribir código:**
Este documento describe QUÉ hacer y POR QUÉ, con todo el conocimiento de la fuente de datos ya validado. Pero NO conoce el estado exacto de todas las tablas de la base de datos. Antes de implementar:

- Lee `colombia_loader.py` completo (es el loader de referencia, el más reciente y limpio).
- Lee `cmf_loader.py` (loader de Chile).
- Lee la carpeta `migrations/` completa para conocer el DDL real de `datos_financieros`, `plan_cuentas`, `instituciones` y `carga_log`.
- Lee `api/` (backend serverless) para ver cómo se sirven los datos al frontend.
- Confirma la estructura real de cada tabla con el usuario o inspeccionando la BD antes de asumir nombres de columnas.

No rompas lo que ya funciona. Chile y Colombia están en producción y con datos reales. Todo cambio debe ser aditivo y retrocompatible.

---

## 1. Contexto del proyecto

**LatamBanks** (`latambanks.vercel.app`) es un dashboard multi-país de datos financieros de bancos latinoamericanos, construido sobre datos regulatorios oficiales. Sirve al equipo ALM de BTG Pactual y como producto público.

### Stack
- **Frontend:** HTML + Vanilla JS (ES Modules), desplegado en Vercel. `dashboard.html` (SPA principal) + `index.html` (landing).
- **Backend:** Node.js serverless functions en `api/` (Vercel), con `pg` → CockroachDB.
- **Base de datos:** CockroachDB (PostgreSQL-compatible).
- **ETL:** Scripts Python por país (`cmf_loader.py`, `colombia_loader.py`).
- **Scheduler:** GitHub Actions (`.github/workflows/`).

### Países actuales
| País | Código | Fuente | Frecuencia | Estado |
|---|---|---|---|---|
| Chile | CL | CMF (ZIPs) | Mensual | ✅ Producción |
| Colombia | CO | datos.gov.co (Socrata) | Mensual | ✅ Producción |
| **Brasil** | **BR** | **IF.data BCB (Olinda)** | **Trimestral** | 🔨 Esta tarea |
| Perú | PE | Por definir | — | Stub "Coming Soon" |

### Modelo de datos (confirmar contra `migrations/` antes de usar)
La tabla `datos_financieros` tiene columnas de monto pensadas para Chile:
`monto_clp, monto_uf, monto_tc, monto_ext, monto_total`.

**Convención multi-país ya en uso en Colombia:** el valor único de la fuente va en `monto_total`, y las otras cuatro columnas van en `0`. Brasil debe seguir exactamente esta convención.

La clave primaria de `datos_financieros` es `(country, periodo, tipo, ins_cod, cuenta)` (confirmar en migración real).

El campo `tipo` clasifica la cuenta: `b1` (balance), `r1` (resultados), `c1` (cuentas de orden / otros). En Colombia se infiere del primer dígito del número de cuenta.

El campo `periodo` es texto `YYYYMM`.

---

## 2. TAREA A — Detección de cambios de esquema (universal)

### Motivación
Actualmente los loaders cargan datos asumiendo que la estructura de la fuente nunca cambia. Esto es frágil:
- Cuando el workflow de Colombia falló por falta de credencial, falló en silencio hasta que alguien lo notó.
- Brasil **cambió su plan de cuentas completo** en marzo 2025 (ver Tarea B). Un loader ingenuo cargaría datos inconsistentes o se rompería sin explicar por qué.

El objetivo: que **cada loader detecte y registre** cuando la fuente cambia su estructura (cuentas nuevas que aparecen, cuentas conocidas que desaparecen), en vez de fallar silenciosamente o corromper la serie.

### Diseño

**Migración necesaria (aditiva):**
Agregar una columna `detalle` (tipo `TEXT` o `JSONB`) a `carga_log`, para guardar el detalle de anomalías detectadas. Hoy `carga_log.estado` solo toma el valor `'ok'`; con esto podrá tomar además `'alerta_esquema'` u otros.

```sql
-- migrations/00X_carga_log_detalle.sql
ALTER TABLE carga_log ADD COLUMN IF NOT EXISTS detalle TEXT;
```

**Módulo de validación (compartido por todos los loaders):**
Idealmente crear un archivo nuevo `schema_guard.py` que los tres loaders importen, para no duplicar lógica. Funciones:

- `get_known_accounts(conn, country) -> set[str]`: lee las cuentas ya registradas en `plan_cuentas` para ese país.
- `detect_schema_changes(conn, country, incoming_accounts, periodo) -> dict`: compara el set de cuentas entrantes contra las conocidas. Devuelve un reporte con `new` (cuentas nuevas), `missing` (cuentas que desaparecieron), conteos y un `status` (`baseline` si es primera carga, `ok` si el cambio es menor, `structural_change` si supera un umbral configurable, ej. 20 cuentas).
- `log_schema_alert(conn, country, periodo, report)`: registra la anomalía en `carga_log` con `estado='alerta_esquema'` y el detalle en JSON.

**Comportamiento esperado:**
- En cada carga de un período, ANTES de hacer el INSERT de datos, el loader extrae el set de cuentas entrantes, llama a `detect_schema_changes`, y:
  - Si `status == 'structural_change'`: registra la alerta con `log_schema_alert`. Decisión de diseño a confirmar con el usuario: ¿frenar la carga de ese período para revisión manual, o alertar y continuar? Recomendación: continuar cargando pero dejar la alerta bien visible en `carga_log` y en los logs del workflow (para que el run de GitHub Actions quede marcado en amarillo/rojo).
  - Si `status == 'ok'` o `baseline`: proceder normal.
- El resultado del reporte debe imprimirse en el log del loader con nivel WARNING para que sea visible en la salida de GitHub Actions.

**Aplicar a los 3 loaders:** una vez validado en `colombia_loader.py`, replicar la llamada en `cmf_loader.py` y en el nuevo `brasil_loader.py`.

### Referencia de implementación (pseudocódigo, adaptar al código real)
```python
# En schema_guard.py
def detect_schema_changes(conn, country, incoming_accounts, periodo):
    known = get_known_accounts(conn, country)
    if not known:
        return {"status": "baseline", "new": [], "missing": [], "periodo": periodo}
    new_accounts = incoming_accounts - known
    missing_accounts = known - incoming_accounts
    THRESHOLD = 20
    is_structural = len(new_accounts) > THRESHOLD or len(missing_accounts) > THRESHOLD
    return {
        "status": "structural_change" if is_structural else "ok",
        "new": sorted(new_accounts), "missing": sorted(missing_accounts),
        "n_new": len(new_accounts), "n_missing": len(missing_accounts),
        "periodo": periodo,
    }
```

---

## 3. TAREA B — Integración de Brasil

### 3.1 Fuente de datos (100% validada)

**API:** IF.data del Banco Central do Brasil, plataforma Olinda (OData).
**Sin autenticación. Gratuita. Formato JSON.**

Endpoint de valores (datos financieros):
```
https://olinda.bcb.gov.br/olinda/servico/IFDATA/versao/v1/odata/IfDataValores(AnoMes=@AnoMes,TipoInstituicao=@TipoInstituicao,Relatorio=@Relatorio)?@AnoMes=YYYYMM&@TipoInstituicao=T&@Relatorio='R'&$format=json
```

Parámetros:
- `AnoMes`: período **trimestral** en formato `YYYYMM`. Solo valores de cierre de trimestre: `YYYY03`, `YYYY06`, `YYYY09`, `YYYY12`.
- `TipoInstituicao`: **usar `3`** (Conglomerado Financeiro — la consolidación más amplia, donde están los grandes bancos con su tamaño real). Ver nota abajo.
- `Relatorio`: número de reporte como string entre comillas simples, ej. `'1'`.

Filtros y selección OData soportados: `$filter`, `$select`, `$orderby`, `$top`, `$format=json`.

**Nota sobre TipoInstituicao (importante, validado empíricamente):**
- `1` = Instituições Independentes (bancos sin conglomerado; los grandes NO están aquí)
- `2` = Conglomerados Prudenciais
- `3` = Conglomerados Financeiros ← **este es el correcto**; aquí Banco do Brasil, Itaú, Caixa, Bradesco, Santander aparecen con activos en los billones de R$, y BTG Pactual aparece consolidado.

### 3.2 Estructura de cada registro
```json
{
  "TipoInstituicao": 3,
  "CodInst": "30306294",
  "AnoMes": "202403",
  "NomeRelatorio": "Resumo",
  "NumeroRelatorio": "1",
  "Grupo": null,
  "Conta": "78182",
  "NomeColuna": "Ativo Total",
  "DescricaoColuna": "[10000007] + [20000004]",
  "Saldo": 436579845128.6
}
```

Mapeo al esquema `datos_financieros`:
| Campo Olinda | Campo BD | Notas |
|---|---|---|
| `CodInst` | `ins_cod` | Es el CNPJ base / ISPB. Ver mapeo de bancos abajo. |
| `AnoMes` | `periodo` | Ya viene `YYYYMM`, usar tal cual. |
| `Conta` | `cuenta` | OJO: cambia entre planes de cuentas (ver 3.4). |
| `NomeColuna` | (clave de mapeo) | El nombre legible del concepto. |
| `Saldo` | `monto_total` | Valor. Las otras 4 columnas monto van en 0. |

### 3.3 Mapeo de bancos (CodInst → nombre)

**Problema conocido:** el endpoint oficial `IfDataCadastro` (que daría los nombres) devuelve error 500 de forma consistente, sin importar la sintaxis. NO depender de él.

**Solución:** mapeo manual curado. El `CodInst` en IF.data es el ISPB / CNPJ base del banco, que es público y estable. Tabla de mapeo validada con fuente oficial del BC (códigos ISPB) para los principales bancos (TipoInstituicao=3, marzo 2024):

| CodInst | Banco | Verificación |
|---|---|---|
| `00000000` | Banco do Brasil | ISPB oficial |
| `60701190` | Itaú Unibanco | ISPB oficial |
| `00360305` | Caixa Econômica Federal | ISPB oficial |
| `60746948` | Bradesco | ISPB oficial |
| `90400888` | Santander Brasil | ISPB oficial |
| `30306294` | **BTG Pactual** (banco foco) | CNPJ/ISPB oficial |
| `33479023` | Citibank Brasil | ISPB oficial |
| `60872504` | Banco Safra | Por confirmar por tamaño |
| `01181521` | Banco Cooperativo Sicredi | Confirmado |

**Recomendación de implementación:** en vez de hardcodear solo esta lista, el loader puede poblar la tabla `instituciones` con TODOS los `CodInst` distintos que aparezcan en los datos (usando el `CodInst` como `razon_social` provisional cuando no haya nombre conocido), y sobreescribir con nombres legibles los que están en la tabla de mapeo curada. Así ningún banco queda fuera y los principales quedan con nombre bonito. La tabla de mapeo curada puede vivir en un archivo aparte (`brasil_banks_map.py` o un JSON) para poder ampliarla fácilmente.

También existe un endpoint que SÍ funciona para nombres, si se quiere enriquecer, pero cruza por CNPJ (no por CodInst directamente):
`https://olinda.bcb.gov.br/olinda/servico/Instituicoes_em_funcionamento/versao/v1/odata/SedesBancoComMultCE?$format=json` — trae `CNPJ` (8 dígitos) y `NOME_INSTITUICAO`. El `CodInst` de IF.data coincide con esos 8 dígitos de CNPJ base para muchos bancos, así que se puede usar como fuente de nombres complementaria.

### 3.4 EL PUNTO CRÍTICO: cambio de plan de cuentas en marzo 2025

Brasil implementó la **Resolución CMN 4.966/2021** (estándar IFRS 9) con vigencia **1 enero 2025**. Esto reemplazó el plan de cuentas Cosif viejo por uno nuevo. El BC confirmó que los reportes del IF.data reflejan el cambio **a partir de marzo 2025**.

**Consecuencia:** el mismo concepto tiene código de cuenta distinto según el período. Ejemplo real del Relatorio 1 (Resumo) para BTG:

| Concepto | Cosif viejo (≤ dic 2024) | Cosif nuevo (≥ mar 2025) | Comparable |
|---|---|---|---|
| Ativo Total | `78182` | `140220` | ✅ nombre idéntico |
| Patrimônio Líquido | `78186` | `140246` | ✅ nombre idéntico |
| Lucro Líquido | `78187` | `141870` | ✅ nombre idéntico |
| Captações | `78185` | `140239` | ✅ nombre idéntico |
| Carteira de Crédito | `78183` "Classificada" | `141873` "Carteira de Crédito" | ⚠️ definición cambió (IFRS 9 usa estágios, no niveles A-H) |
| Passivo | `78184` "Circulante e Exigível LP..." | `140244` "Passivo Exigível" | ⚠️ definición cambió |
| Títulos e Valores Mobiliários | — | `140200` | 🆕 columna nueva |

Además, los códigos contables base ganaron un dígito: `[10000007]` (viejo) → `[1000000009]` (nuevo, 9 dígitos + verificador, 6 niveles de agregación).

**Implicación de diseño para la opción B (máxima granularidad, serie histórica completa 2022→hoy):**

1. **NO usar el código de cuenta (`Conta`) como identificador estable del concepto.** Cambia en la frontera de mar-2025.
2. **Usar `NomeColuna` como puente semántico** entre planes. Para los KPIs centrales (Ativo Total, Patrimônio, Lucro, Captações) el nombre es idéntico y el mapeo es directo.
3. **Construir una tabla de equivalencias curada** para los conceptos donde el nombre o la definición cambió (Carteira de Crédito, Passivo). Documentar la discontinuidad.
4. **Marcar en el dashboard / metadata** que existe una ruptura metodológica en mar-2025 (IFRS 9), para que las series que cruzan esa fecha se interpreten con cuidado. Esto es análogo a advertir un cambio de norma contable.
5. **Aquí entra la Tarea A:** el `brasil_loader.py` debe usar la capa de detección de cambios. Al cargar mar-2025 detectará automáticamente "desaparecieron las cuentas 781xx, aparecieron las 14xxxx" y lo registrará como alerta de esquema. Esto valida que el mecanismo de la Tarea A funciona.

### 3.5 Reportes disponibles (IF.data)
El parámetro `Relatorio` selecciona distintos reportes temáticos. Para máxima granularidad hay que cargar varios. Números de reporte por convención de la API:
- `'1'` = Resumo (KPIs de alto nivel — validado, estable a través del cambio Cosif para los 4 KPIs centrales)
- `'2'` = Ativo
- `'3'` = Passivo
- `'4'` = Demonstração de Resultado (P&G)
- `'5'` = Carteira de crédito por nível de risco / estágios (equivalente a NPL — clave para calidad de cartera)

**Advertencia:** la disponibilidad y numeración exacta de reportes puede variar entre el Cosif viejo y el nuevo. El loader debe iterar sobre los reportes de forma defensiva (probar cada Relatorio, y si devuelve vacío o error, registrarlo sin romper toda la corrida). Se recomienda empezar por el Relatorio 1 (que está validado punta a punta) y luego ir agregando 2, 3, 4, 5 verificando cada uno contra períodos de ambos lados de la frontera mar-2025.

### 3.6 Frecuencia y calendario de publicación
- **Trimestral** (no mensual). Períodos válidos: `YYYY03, YYYY06, YYYY09, YYYY12`.
- Retraso de publicación: ~60 días después del cierre de trimestre (90 días para el cierre de diciembre).
- **Implicación para el scheduler:** el workflow de GitHub Actions de Brasil NO debe correr mensualmente como Colombia. Debe correr una vez al mes pero solo actuar cuando detecte un trimestre nuevo disponible (lógica incremental), o programarse en los meses en que se publican trimestres (aprox. marzo, junio, septiembre, diciembre — es decir ~2-3 meses después de cada cierre). Recomendación: correr mensualmente pero con lógica incremental que no hace nada si no hay trimestre nuevo (igual que Colombia ya hace con `latest_cut_date_from_api`).

### 3.7 Carga histórica
- Objetivo: desde **2022** (consistente con Chile y Colombia) hasta el trimestre más reciente.
- Iterar trimestre por trimestre: `202203, 202206, 202209, 202212, 202303, ...`.
- Cruza la frontera Cosif en mar-2025, por lo que la carga histórica es el mejor test del mapeo doble y de la detección de cambios.

### 3.8 Diferencias frente a Colombia (para el loader)
| Aspecto | Colombia (`colombia_loader.py`) | Brasil (`brasil_loader.py`) |
|---|---|---|
| API | Socrata REST simple | Olinda OData (parámetros con `@` y comillas) |
| Frecuencia | Mensual | Trimestral |
| Períodos | Todos los meses | Solo cierres de trimestre |
| `periodo` | Derivar de `fecha_corte` ISO | `AnoMes` ya es YYYYMM |
| Plan de cuentas | Único (CUIF) | DOBLE (Cosif viejo + nuevo, frontera mar-2025) |
| Identificador banco | `codigo_entidad` con nombre incluido | `CodInst` sin nombre (mapeo manual) |
| Valor | campo `valor` (ya con signo) | campo `Saldo` |
| Múltiples reportes | No (un solo dataset) | Sí (Relatorio 1..5+) |

### 3.9 Reutilizar patrones de `colombia_loader.py`
El nuevo `brasil_loader.py` debe seguir la misma estructura que `colombia_loader.py`:
- Modos `--historical`, `--incremental`, `--institutions-plan`.
- Funciones análogas: `olinda_get()` (en vez de `socrata_get()`), `row_to_tuple()`, `upsert_institutions()`, `upsert_plan_cuentas()`, `ingest_tuple_batch()`, `bump_carga_log()`, `run_historical()`, `run_incremental()`.
- Respetar `COUNTRY = "BR"`, la convención de `monto_total`, el uso de `carga_log`.
- Integrar la capa de detección de cambios (Tarea A).

### 3.10 Frontend
- La bandera de Brasil ya existe como elemento. Activarla en el selector de países del dashboard y en el landing (`index.html`).
- Verificar cómo el frontend maneja la frecuencia: Chile y Colombia son mensuales; Brasil es trimestral. El selector de períodos y los gráficos deben tolerar series trimestrales (menos puntos, saltos de 3 meses). Revisar `js/` (especialmente manejo de períodos y charts) para que no asuma mensualidad.
- El `tipo` para inferencia en Brasil: confirmar la lógica. Con el Cosif nuevo de 9 dígitos, la inferencia por primer dígito puede necesitar ajuste respecto a Colombia.

---

## 4. Orden de trabajo sugerido

1. **Inspección:** leer `colombia_loader.py`, `cmf_loader.py`, `migrations/`, `api/`. Confirmar DDL real de las tablas.
2. **Tarea A primero** (base para todo): migración `detalle` en `carga_log` + módulo `schema_guard.py` + integrarlo en `colombia_loader.py` y probar que no rompe nada.
3. **Tarea B:** crear `brasil_loader.py` siguiendo el patrón de Colombia, empezando solo con Relatorio 1 y mapeo por `NomeColuna`.
4. Probar carga histórica de Brasil de unos pocos trimestres a ambos lados de mar-2025; confirmar que la detección de cambios dispara la alerta en mar-2025.
5. Ampliar a Relatorios 2-5 con tabla de equivalencias curada.
6. Migración multi-país para `country='BR'` donde haga falta; poblar `instituciones` y `plan_cuentas` de Brasil.
7. Workflow de GitHub Actions para Brasil (mensual con lógica incremental trimestral). Recordar configurar el secret `COCKROACH_URL` en el repo (ya existe para Colombia).
8. Frontend: activar bandera Brasil, tolerar frecuencia trimestral.

---

## 5. Riesgos y notas finales
- **Endpoint `IfDataCadastro` roto (500):** no depender de él. Mapeo manual de bancos.
- **Frontera Cosif mar-2025:** es el mayor riesgo de calidad de datos. El mapeo por `NomeColuna` + tabla de equivalencias + detección de cambios lo mitigan, pero hay que documentar la discontinuidad.
- **Series trimestrales en un frontend pensado para mensual:** revisar que no rompa gráficos ni cálculos de variación (ej. un "trailing 12M" en Brasil son 4 trimestres, no 12 puntos).
- **No romper Chile ni Colombia:** todo cambio aditivo y retrocompatible. Probar que los loaders existentes siguen corriendo igual.
- Todos los endpoints y hallazgos de este documento fueron validados manualmente contra la API real de Olinda en julio 2026.
