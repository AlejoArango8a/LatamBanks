// ============================================================
// FX — tipo de cambio USD → moneda local (CL/CO/BR/PE/UY/AR/MX; US/PA = 1)
// Fuentes en cascada; falla cerrada (usdRate = null) si todas fallan.
// ============================================================
import { ST, reportingLocalCurrencyISO } from './state.js?v=bmon94';
import { paisCurrency, paisLocale } from './paises.js?v=bmon94';

const FX_TIMEOUT_MS = 8000;

/** @typedef {{ rate: number, date: string, source: string }} FxQuote */

async function fetchJson(url, timeoutMs = FX_TIMEOUT_MS) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const r = await fetch(url, { signal: ctrl.signal, cache: 'no-store' });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return await r.json();
  } finally {
    clearTimeout(t);
  }
}

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

function validQuote(rate, date, source) {
  const n = Number(rate);
  if (!(n > 0) || !Number.isFinite(n)) return null;
  return { rate: n, date: date || todayISO(), source };
}

/** Primary / shared: open.er-api.com (Open Exchange Rates free endpoint). */
async function fromErApi(ccy) {
  const data = await fetchJson('https://open.er-api.com/v6/latest/USD');
  if (data?.result !== 'success' || !data.rates?.[ccy]) {
    throw new Error(`er-api: sin ${ccy}`);
  }
  const date = data.time_last_update_unix
    ? new Date(data.time_last_update_unix * 1000).toISOString().slice(0, 10)
    : todayISO();
  return validQuote(data.rates[ccy], date, 'open.er-api.com');
}

/**
 * Fallback CDN (Fawaz Ahmed currency-api + mirror pages.dev).
 * Respuesta: { date, usd: { clp: 950, … } } (keys en minúscula).
 */
async function fromCurrencyApi(ccy) {
  const key = String(ccy).toLowerCase();
  const urls = [
    `https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@latest/v1/currencies/usd.min.json`,
    `https://latest.currency-api.pages.dev/v1/currencies/usd.min.json`,
  ];
  let lastErr;
  for (const url of urls) {
    try {
      const data = await fetchJson(url);
      const rate = data?.usd?.[key];
      const q = validQuote(rate, data?.date, 'currency-api');
      if (q) return q;
      lastErr = new Error(`currency-api: sin ${ccy}`);
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr || new Error('currency-api falló');
}

/** Chile oficial (BCCh vía mindicador). */
async function fromMindicador() {
  const data = await fetchJson('https://mindicador.cl/api/dolar');
  const row = data?.serie?.[0];
  if (!row?.valor) throw new Error('mindicador: sin serie');
  return validQuote(row.valor, String(row.fecha || '').slice(0, 10), 'mindicador.cl');
}

/** Chile macros from LatamBanks DB (chile_macros_loader → /api/chile/macros). */
async function fromChileMacrosApi() {
  const { fetchChileMacros } = await import('./chileMacros.js?v=bmon94');
  const data = await fetchChileMacros();
  const usd = Number(data?.macros?.usd);
  if (!(usd > 0)) throw new Error('chile/macros: sin USD');
  const period = data.period || todayISO();
  const date = period.length === 6
    ? `${period.slice(0, 4)}-${period.slice(4, 6)}-01`
    : todayISO();
  return validQuote(usd, date, 'CMF/mindicador·DB');
}

function formatFxSidebar(ccy, rate, date, source) {
  const loc = paisLocale(ST.country) || 'es-CL';
  const d = date || '—';
  const src = source ? ` · ${source}` : '';
  switch (ccy) {
    case 'COP':
      return `1 USD ≈ $${Math.round(rate).toLocaleString(loc)} COP · ${d}${src}`;
    case 'BRL':
      return `1 USD ≈ R$${rate.toFixed(2)} BRL · ${d}${src}`;
    case 'UYU':
      return `1 USD ≈ $${rate.toFixed(2)} UYU · ${d}${src}`;
    case 'PEN':
      return `1 USD ≈ S/ ${rate.toFixed(3)} PEN · ${d}${src}`;
    case 'CLP':
    default:
      return `1 USD ≈ $${Math.round(rate).toLocaleString(loc)} ${ccy} · ${d}${src}`;
  }
}

export function clearUsdRate() {
  ST.usdRate = null;
  ST.usdDate = null;
  ST.usdFxSource = null;
}

export function hasUsdRate() {
  return Number(ST.usdRate) > 0 && Number.isFinite(Number(ST.usdRate));
}

/**
 * Obtiene TRM USD→moneda local del país activo.
 * Cascada por país; limpia tasa previa al empezar (fail-closed).
 * @returns {Promise<boolean>} true si hay tasa usable
 */
export async function fetchUSDRate() {
  const sbl = document.getElementById('usdSidebarLabel');
  const countryAtStart = ST.country;
  const ccy = paisCurrency(ST.country) || reportingLocalCurrencyISO() || 'CLP';

  clearUsdRate();

  // US / Panamá: la moneda de reporte ya es USD (FDIC / SBP).
  if (ccy === 'USD' || ST.country === 'usa' || ST.country === 'panama') {
    ST.usdRate = 1;
    ST.usdDate = todayISO();
    ST.usdFxSource = 'native';
    if (sbl) {
      sbl.textContent = ST.country === 'panama'
        ? 'Amounts in USD · SBP reportes individuales'
        : 'Amounts in USD · FDIC Call Reports';
    }
    return true;
  }

  if (sbl) sbl.textContent = `Loading USD → ${ccy}…`;

  /** @type {Array<() => Promise<FxQuote|null>>} */
  const chain = [];
  if (ccy === 'CLP') {
    chain.push(fromChileMacrosApi);
    chain.push(fromMindicador);
  }
  chain.push(() => fromErApi(ccy));
  chain.push(() => fromCurrencyApi(ccy));

  for (const step of chain) {
    try {
      const q = await step();
      if (ST.country !== countryAtStart) return false; // switch concurrente
      if (!q) continue;
      ST.usdRate = q.rate;
      ST.usdDate = q.date;
      ST.usdFxSource = q.source;
      if (sbl) sbl.textContent = formatFxSidebar(ccy, q.rate, q.date, q.source);
      return true;
    } catch (e) {
      console.warn(`[fx] ${ccy} fuente falló:`, e?.message || e);
    }
  }

  if (ST.country !== countryAtStart) return false;
  // Fail closed: no dejar tasa de otro país. Preferencia USD se mantiene;
  // la UI muestra moneda local hasta que haya TRM (fmtKPI ignora USD sin rate).
  clearUsdRate();
  if (sbl) {
    sbl.textContent = `USD rate unavailable for ${ccy} — showing ${ccy}`;
  }
  return false;
}
