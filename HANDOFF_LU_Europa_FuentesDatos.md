# LatamBanks — Handoff: BTG Europa (Luxemburgo)

**Fecha:** agosto 2026  
**Estado:** **Opción A implementada + balance completo** — franchise snapshot en BTG Banks + profile + seed anual (`data/btg_europe_luxembourg.json`) con **assets/equity/loans/deposits/net_income + CET1 absoluto** poblados desde las **cuentas anuales publicadas por el propio banco** (btgpactual.eu/downloads) y su **Pillar 3 Disclosure Report**. Sin Banking System LU.  
**Entidad:** BTG Pactual Europe S.A. (ex FIS Privatbank S.A., RCS **B79983**)  
**HQ:** 29, Avenue de la Porte-Neuve, L-2227 Luxembourg  
**Supervisor:** CSSF (Less Significant Institution bajo CRR/CRD)

---

## 1. Veredicto

| Enfoque | Viabilidad | Notas |
|---------|------------|--------|
| **A. Perfil + KPIs puntuales en BTG Banks** (recomendado primero) | **Alta** | Moody’s / IR BTG ya publican cifras anuales clave (AuM, P&L, CET1, capitalizaciones). Encaja como 6.ª columna en franchise compare, **sin** Banking System LU. |
| **B. País `LU` live con loader mensual tipo Latam** | **Baja–media** | CSSF **no** publica un boletín multi-banco descargable comparable a CMF/BCU/SBS. FINREP es supervisory, no open data por entidad. |
| **C. Loader anual desde cuentas RCSL / LBR** | **Media** | Cuentas anuales se depositan en Luxembourg Business Registers (RCS B79983). Acceso a PDF a menudo **de pago / login**; LBR estuvo en maintenance al sondear (ago-2026). Automatización frágil. |

**Recomendación:** empezar por **A** (contexto + snapshot EUR/USD en BTG Banks + bank profile). Diferir Banking System Luxemburgo hasta tener un feed estable o un proceso semiautomático de cuentas anuales.

---

## 2. Hechos de negocio útiles (contexto producto)

- Adquisición: FIS Privatbank S.A. — anuncio mar-2023, cierre sep-2023 (~EUR 21,3 m).  
- Rebrand: **15-ene-2024** → BTG Pactual Europe S.A.  
- Modelo: private banking / wealth + hub europeo para clientes LatAm.  
- Moody’s (28-may-2025): issuer **Baa3** / deposits **Baa2**, outlook estable; BCA **ba3**.  
- Señales 2024: pérdida neta Lux GAAP ~**€0,94 m** / IFRS **€1,55 m**; AuM **€408 m** (YE23) → **€1.674 m** (YE24); **CET1 absoluto €206,3 m**, RWA €360,7 m, **CET1 ratio 57,19%** (Pillar 3 auditado; Moody's citó ~65% aprox.); inyecciones (share premium) €55 m (sep-23) + €150 m (ene-24) + €200 m (abr-25).

Fuentes: **cuentas anuales del banco 2024/2025 + Pillar 3** (btgpactual.eu/downloads), [Moody's Baa3](https://static.btgpactual.com/media/moodys-ratings-assigns-baa3.pdf), North Data / RCSL B79983.

---

## 3. Fuentes de datos (qué hay / qué no)

### 3.1 No hay equivalente “open monthly banking system”

A diferencia de CL (CMF), UY (BCU), CO (SFC), etc., Luxemburgo **no** ofrece un Excel público mensual con balance/PyG de todos los bancos por institución.

CSSF publica divulgación prudencial **agregada** y marcos FINREP; los templates FINREP individuales **no** son un dump abierto para ETL.

### 3.2 Cuentas anuales + Pillar 3 (¡PÚBLICAS en el sitio del banco!)

**Hallazgo clave (ago-2026):** el propio banco publica sus cuentas anuales auditadas y su Pillar 3 en `https://www.btgpactual.eu/downloads` (PDFs en `static.btgpactual.com/media/...`). No hace falta el paywall de LBR.

| Documento | URL |
|-----------|-----|
| Annual accounts 2024 (Lux GAAP, auditado) | https://static.btgpactual.com/media/btg-pactual-europe-sa-annual-accounts-2024.pdf |
| Annual accounts 2025 (IFRS, con comparativo YE2024) | https://static.btgpactual.com/media/btg-pactual-europe-sa-annual-accounts-2025.pdf |
| Annual accounts 2023 | https://static.btgpactual.com/media/btg-pactual-europe-sa-annual-accounts-2023.pdf |
| Pillar 3 / Disclosure Report 2024 (EU KM1, own funds) | https://static.btgpactual.com/media/btg-pactual-europe-disclosure-report-2024.pdf |
| Pillar 3 / Disclosure Report 2025 | https://static.btgpactual.com/media/btg-pactual-europe-disclosure-report-2025.pdf |
| Pillar 3 2023 / FIS Privatbank 2022 | .../btg-pactual-europe-pillar3-2023.pdf ; .../disclosure-report-2022-fis-privatbank-en.pdf |

**Cifras YE2024 (IFRS, del comparativo en las cuentas FY2025; miles EUR):** Total assets **662,902**; Loans & advances to customers **226,910**; Debt securities **100,533**; Deposits **309,542**; Debt securities issued **128,737**; Total liabilities **450,390**; Total equity **212,512** (share capital 9,989 + share premium 205,000 + reserves 3,565 − retained (4,488) − loss (1,554)); Net loss IFRS **1,554** (Lux GAAP **936**).

**Own funds YE2024 (Pillar 3 EU KM1, EUR):** CET1 = Tier 1 = Total capital **206,291,697**; RWA **360,699,089**; **CET1 ratio 57.19%** (Moody's citó ~65%, aprox.); Leverage 29.84%; LCR 442%; NSFR 122%.

**YE2025 (última auditada):** assets 1,257,971; equity 415,483; deposits 551,797; net profit 2,971; CET1 402,781,379; RWA 677,836,778; CET1 ratio 59.42% (miles EUR / EUR).

| Ítem | Detalle |
|------|---------|
| Registro | RCS **B79983**, EUID `LURCSL.B79983` |
| Portal LBR (respaldo) | [lbr.lu](https://www.lbr.lu/) — paywall/login; **ya no necesario**, el banco publica los PDFs |
| Frecuencia | **Anual** (cuentas + Pillar 3). No hay feed mensual/trimestral abierto |

### 3.3 IR / rating disclosures (rápido para MVP)

- Notas y FS consolidados de **Banco BTG Pactual S.A.** mencionan la subsidiaria LU.  
- Comunicados Moody’s con KPIs YE.  
- Suficiente para **cards** Equity / Assets / Net Income / AuM (si se modela AuM aparte) en moneda **EUR**.

### 3.4 Otras entidades (no confundir)

- **BTG Pactual Europe Management Company S.A.** — manCo / fondos; **no** es el banco.  
- Sucursales / platforms en otros países EU pueden existir bajo passporting; el **banco con licencia** es la SA luxemburguesa.

---

## 4. Encaje con LatamBanks

### Opción A — Franchise only (menor invasión)

1. `BANK_PROFILES.luxembourg` o `europe` con código sintético (ej. `1` o `79983`).  
2. Extender `GET /api/btg-banks/snapshot` con fila `LU` / `EUR`.  
3. Seed manual o semi-manual de últimos YE metrics (tabla `datos_financieros` country=`LU` **o** JSON estático versionado).  
4. UI: BTG Banks muestra Luxemburgo; **sin** flag “Banking System LU” en landing.  
5. FX: EUR→USD ya cubierto si el cliente usa tasas existentes.

**Esfuerzo relativo:** bajo–medio (frontend + API + seed anual).  
**Riesgo:** datos no se auto-actualizan hasta que alguien refresque el seed / corre un job anual.

### Opción B — País live completo

Requiere: `paises.json` LU, `luCuentas.js`, loader, ranking, sidebar, GHA.  
**Bloqueador:** fuente mensual multi-banco. Sin ella, el “system” sería un solo banco — poco valor vs. costo.

### Opción C — Loader anual RCSL

1. Descargar annual accounts PDF/XBRL de B79983.  
2. Parsear balance/PyG → `datos_financieros` (`periodo`=`YYYY12`).  
3. Cron anual + alerta si falta filing.

**Esfuerzo:** medio–alto (PDF/XBRL + auth LBR). Útil si se quiere serie histórica YE sin depender de Moody’s.

---

## 5. Métricas comparables con BTG Banks actuales

| KPI franchise | LU viable? | Comentario |
|---------------|------------|------------|
| Total Assets | Sí (anual) | Balance |
| Equity | Sí | Balance |
| Net Income | Sí | PyG (puede ser pérdida en ramp-up) |
| Total Loans | Parcial | Private bank: loans pueden ser chicos vs AuM |
| Total Deposits | Sí | Depósitos / funding |
| Loans / Equity | Parcial | Menos informativo que en bancos retail LatAm |
| ROE | Sí | Cuidado con equity inflado por capitalizaciones |
| **AuM** | Muy relevante | No está en el set LatAm actual; valorar KPI extra solo LU/EU |

---

## 6. Riesgos / decisiones abiertas

1. **Nombre producto:** “Luxembourg” vs “Europe” en UI (legal: *BTG Pactual Europe S.A.*, domicilio LU).  
2. **Frecuencia:** aceptar **anual** o trimestral si BTG publica interim LU (hoy no hay feed trimestral abierto claro).  
3. **Moneda:** reportar EUR nativo; convertir a USD en BTG Banks como el resto.  
4. **Alcance geográfico:** ¿solo el banco LU o también AUM de platforms EU? Empezar **solo banco RCS B79983**.  
5. **Compliance scraping:** preferir documentos IR/Moody’s o descarga LBR autorizada; evitar scrapers frágiles del RCS.

---

## 7. Qué quedó implementado (Opción A)

| Pieza | Ubicación |
|-------|-----------|
| Seed anual **YE2025** (IFRS) | `data/btg_europe_luxembourg.json` |
| País `luxembourg` status `franchise` | `paises.json` (no entra en LIVE_ISOS / landing) |
| Snapshot API | `GET /api/btg-banks/snapshot` → fila `LU` |
| UI | `js/views/btgBanks.js` (orden + AuM en subtitle) |
| Profile | `js/bankProfiles.js` → `luxembourg[79983]` |

**Fuente pública confirmada:** `https://www.btgpactual.eu/downloads` → PDFs en `static.btgpactual.com/media/`.

**YE2025 (seed actual):** assets **€1.258 m**; loans **€498,0 m**; equity **€415,5 m**; liabilities **€842,5 m**; deposits **€551,8 m**; net income **€2,97 m**; CET1 **€402,8 m**; CET1 ratio **59,42%**.

**YE2024 (en `extras.prior_year`):** equity **€212,5 m**; CET1 **€206,3 m**; ratio **57,19%**; net income IFRS **−€1,55 m** (Lux GAAP −€0,94 m).

## 8. Próximos pasos

1. Checklist anual: descargar el último `annual-accounts-YYYY.pdf` + `disclosure-report-YYYY.pdf` de `btgpactual.eu/downloads` → actualizar seed.  
2. Actualizar AuM cuando Moody’s / IR publiquen YE2025 (hoy AuM en seed sigue siendo YE2024).

---

## 9. Referencias

- **Cuentas anuales 2024 (Lux GAAP):** https://static.btgpactual.com/media/btg-pactual-europe-sa-annual-accounts-2024.pdf  
- **Cuentas anuales 2025 (IFRS, comparativo YE2024):** https://static.btgpactual.com/media/btg-pactual-europe-sa-annual-accounts-2025.pdf  
- **Pillar 3 Disclosure Report 2024 (own funds €206,3 m):** https://static.btgpactual.com/media/btg-pactual-europe-disclosure-report-2024.pdf  
- **Pillar 3 Disclosure Report 2025:** https://static.btgpactual.com/media/btg-pactual-europe-disclosure-report-2025.pdf  
- Índice de descargas del banco: https://www.btgpactual.eu/downloads  
- Moody’s: https://static.btgpactual.com/media/moodys-ratings-assigns-baa3.pdf  
- North Data: https://www.northdata.com/BTG%20Pactual%20Europe%20SA,%20Luxembourg/B79983  
- CSSF supervisory disclosure: https://www.cssf.lu/en/supervisory-disclosure/  
- LBR (respaldo, paywall): https://www.lbr.lu/
