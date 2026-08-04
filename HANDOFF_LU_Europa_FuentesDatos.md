# LatamBanks — Handoff: BTG Europa (Luxemburgo)

**Fecha:** agosto 2026  
**Estado:** análisis de viabilidad (sin implementación).  
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
- Señales 2024 (Moody's): pérdida neta ~**€0,94 m**; AuM **€408 m** (YE23) → **€1.674 m** (YE24); CET1 **~65%**; inyecciones de capital €55 m (sep-23) + €150 m (ene-24) + €200 m (abr-25).

Fuentes: estados consolidados BTG (IR), [Moody's Baa3](https://static.btgpactual.com/media/moodys-ratings-assigns-baa3.pdf), North Data / RCSL B79983.

---

## 3. Fuentes de datos (qué hay / qué no)

### 3.1 No hay equivalente “open monthly banking system”

A diferencia de CL (CMF), UY (BCU), CO (SFC), etc., Luxemburgo **no** ofrece un Excel público mensual con balance/PyG de todos los bancos por institución.

CSSF publica divulgación prudencial **agregada** y marcos FINREP; los templates FINREP individuales **no** son un dump abierto para ETL.

### 3.2 Cuentas anuales (RCSL / LBR)

| Ítem | Detalle |
|------|---------|
| Registro | RCS **B79983**, EUID `LURCSL.B79983` |
| Portal | [lbr.lu](https://www.lbr.lu/) (RCSL e-registre) |
| Contenido | Annual accounts / balances (IFRS típico para credit institutions) |
| Frecuencia | **Anual** (no mensual) |
| Fricción | Paywall / cuenta; scraping no confiable; portal a veces en maintenance |

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

## 7. Próximos pasos sugeridos (cuando se apruebe)

1. Confirmar con producto: ¿solo card en BTG Banks o también país LU?  
2. Seed YE2024 (y YE2023 si existe) de Assets / Equity / NI / Deposits (+ AuM opcional).  
3. Profile + logo BTG + fila en `/api/btg-banks/snapshot`.  
4. Documentar proceso de actualización anual (checklist).  
5. Evaluar LBR API / compra de accounts solo si se quiere automatizar C.

---

## 8. Referencias

- Moody’s: https://static.btgpactual.com/media/moodys-ratings-assigns-baa3.pdf  
- North Data: https://www.northdata.com/BTG%20Pactual%20Europe%20SA,%20Luxembourg/B79983  
- CSSF supervisory disclosure: https://www.cssf.lu/en/supervisory-disclosure/  
- LBR: https://www.lbr.lu/  
- BTG IR consolidated FS (nota de adquisición / rename FIS → BTG Europe)
