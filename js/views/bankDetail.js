// ============================================================
// Bank Profile — executive brief for the selected institution
// ============================================================
// IMPORTANT: import shared modules with the same ?v= as the rest of the app.
// A different query string creates a second ST instance and the profile tab
// always looks "unselected".
import { ST, datasetIsoCountry, reportingLocalCurrencyISO } from '../state.js?v=bmon54';
import { bankName, fmtKPI } from '../format.js?v=bmon54';
import { pais } from '../paises.js?v=bmon54';
import { resolveBankProfile } from '../bankProfiles.js?v=bmon54';
import { getCBRatings } from './ranking.js?v=bmon54';
import { API_BASE, bankLogoUrl } from '../config.js?v=bmon54';
import { fetchWithTimeout } from '../api.js?v=bmon54';

let _bdReq = 0;

function esc(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function selectedBankCode() {
  if (ST.selectedOrder?.length) return ST.selectedOrder[0];
  const first = [...(ST.selected || [])][0];
  return first ?? null;
}

function liveSnapshot(code) {
  const equity = ST._patrimonioMap?.[code];
  const m = ST._lastMetrics?.[code] || ST._metrics?.[code] || null;
  return {
    equity,
    assets: m?.activos ?? m?.TOTAL_ACTIVO ?? m?.totalAct ?? m?.totalAssets ?? null,
    ni: m?.utilidad ?? m?.RESULTADO_NETO ?? m?.ni ?? null,
    loans: m?.colocaciones ?? m?.CREDITOS_NETOS ?? m?.loans ?? null,
  };
}

function fmtEmployees(n) {
  if (n == null || n === '' || Number.isNaN(Number(n))) return '—';
  try {
    return Number(n).toLocaleString('en-US');
  } catch {
    return String(n);
  }
}

function fmtRoe(v) {
  if (v == null || Number.isNaN(Number(v))) return '—';
  return `${Number(v).toFixed(1)}%`;
}

function factCell(label, value, hint) {
  const v = (value == null || value === '') ? '—' : String(value);
  return `<div class="bd-fact-cell">
    <div class="bd-fact-label">${esc(label)}</div>
    <div class="bd-fact-val">${esc(v)}</div>
    ${hint ? `<div class="bd-fact-hint">${esc(hint)}</div>` : ''}
  </div>`;
}

function ratingBlock(code, profile) {
  const stored = getCBRatings()?.[code];
  const rows = [];
  if (stored && stored !== '—') {
    rows.push({ agency: 'Dashboard', rating: stored });
  }
  (profile.ratings || []).forEach(r => rows.push(r));
  if (!rows.length) {
    return `<p class="bd-muted">No rating loaded yet.</p>`;
  }
  return `<div class="bd-rating-row">${rows.map(r => `
    <div class="bd-rating-chip">
      <span class="bd-rating-agency">${esc(r.agency)}</span>
      <span class="bd-rating-val">${esc(r.rating)}</span>
      ${r.outlook ? `<span class="bd-rating-out">${esc(r.outlook)}</span>` : ''}
    </div>`).join('')}</div>`;
}

function linksBlock(profile, displayName) {
  const links = [];
  if (profile.website) links.push({ label: 'Website', url: profile.website });
  if (profile.irUrl || profile.ir_url) links.push({ label: 'Investor relations', url: profile.irUrl || profile.ir_url });
  const q = encodeURIComponent(displayName);
  links.push({ label: 'News', url: `https://news.google.com/search?q=${q}` });
  return `<div class="bd-links">${links.map(l => `
    <a class="bd-link" href="${esc(l.url)}" target="_blank" rel="noopener noreferrer">${esc(l.label)}</a>
  `).join('')}</div>`;
}

function kpiCell(label, value, isPct = false) {
  let display = '—';
  if (value != null && value !== '' && !Number.isNaN(Number(value))) {
    display = isPct ? fmtRoe(value) : fmtKPI(value);
  }
  return `<div class="bd-kpi">
    <div class="bd-kpi-label">${esc(label)}</div>
    <div class="bd-kpi-val">${display}</div>
  </div>`;
}

function prose(text, empty = 'Not curated yet.') {
  const t = (text || '').trim();
  if (!t || t === '—') return `<p class="bd-muted">${esc(empty)}</p>`;
  return `<p>${esc(t)}</p>`;
}

function mergeProfile(local, remote) {
  if (!remote) return { ...local };
  const shareholders = Array.isArray(remote.shareholders)
    ? remote.shareholders
    : (local.shareholders || []);
  return {
    ...local,
    shortName: remote.short_name || local.shortName,
    legalName: remote.legal_name || local.legalName,
    founded: remote.founded || local.founded,
    ownership: remote.ownership || local.ownership,
    controlling: remote.controlling || local.controlling,
    shareholders,
    originCountry: remote.origin_country || local.originCountry,
    originCountryName: remote.origin_country_name || local.originCountryName,
    employeesInCountry: remote.employees_in_country ?? local.employeesInCountry,
    employeesAsOf: remote.employees_as_of || local.employeesAsOf,
    businessFocus: remote.business_focus || local.businessFocus,
    hqCity: remote.hq_city || local.hqCity || local.hq,
    hq: remote.hq_city || local.hqCity || local.hq,
    history: remote.history || local.history,
    context: remote.context || local.context,
    website: remote.website || local.website,
    irUrl: remote.ir_url || local.irUrl,
    ratings: Array.isArray(remote.ratings) && remote.ratings.length ? remote.ratings : local.ratings,
    news: Array.isArray(remote.news) && remote.news.length ? remote.news : local.news,
    sources: Array.isArray(remote.sources) ? remote.sources : local.sources,
    curated: true,
  };
}

function paintBrief(root, {
  code, countryKey, name, profile, metrics, snap, periodLabel, ccy, iso, logoHtml, meta,
}) {
  const title = profile.shortName || name;
  const legal = profile.legalName || name;
  const hqCity = profile.hqCity || profile.hq || null;
  const origin = profile.originCountryName
    || (profile.originCountry ? String(profile.originCountry) : null);
  const employees = profile.employeesInCountry != null
    ? `${fmtEmployees(profile.employeesInCountry)}${profile.employeesAsOf ? ` (${profile.employeesAsOf})` : ''}`
    : (profile.employeesAsOf || null);

  const assets = metrics?.assets ?? snap.assets;
  const equity = metrics?.equity ?? snap.equity;
  const roeAvg = metrics?.roe_avg_3y;
  const roeHint = (metrics?.roe_years || []).length
    ? metrics.roe_years.map(y => `${y.year}: ${fmtRoe(y.roe)}`).join(' · ')
    : null;
  const metricPeriod = metrics?.period || periodLabel;
  const metricCcy = metrics?.currency || ccy;

  root.innerHTML = `
    <article class="bd-brief">
      <header class="bd-hero">
        <div class="bd-hero-text">
          <div class="bd-eyebrow">${esc(meta?.name || countryKey)} · Bank Profile</div>
          <h1 class="bd-title">${esc(title)}</h1>
          <p class="bd-legal">${esc(legal)} <span class="bd-code">· ${esc(code)}</span></p>
          <div class="bd-meta-line">
            ${hqCity ? `<span>${esc(hqCity)}</span>` : ''}
            ${profile.founded ? `<span>Founded ${esc(profile.founded)}</span>` : ''}
            <span>${esc(metricPeriod)} · ${esc(metricCcy)}</span>
          </div>
        </div>
        <div class="bd-hero-aside">${logoHtml}</div>
      </header>

      <section class="bd-facts" aria-label="Institution facts">
        ${factCell('Year founded', profile.founded)}
        ${factCell('Controlling owner / partners', profile.controlling || profile.ownership)}
        ${factCell('Country of origin', origin)}
        ${factCell('Employees (this country)', employees)}
        ${factCell('Business focus', profile.businessFocus)}
        ${factCell('HQ city (this country)', hqCity)}
      </section>

      <section class="bd-kpis" aria-label="Live supervisory metrics">
        ${kpiCell('Total assets', assets)}
        ${kpiCell('Total equity', equity)}
        ${kpiCell('Avg annual ROE (3y)', roeAvg, true)}
        ${kpiCell('Net income (latest)', metrics?.net_income ?? snap.ni)}
      </section>
      <p class="bd-footnote">
        Assets, equity and ROE come from supervisory data already in LatamBanks
        ${roeHint ? `· Annual ROE: ${esc(roeHint)}` : ''}.
        ${metrics?.note ? ` ${esc(metrics.note)}` : ''}
      </p>

      <section class="bd-lead">
        <h2>Business focus &amp; positioning</h2>
        ${prose(profile.businessFocus || profile.context, 'Curated positioning not loaded for this code yet.')}
        ${profile.context && profile.businessFocus && profile.context !== profile.businessFocus
          ? `<p class="bd-secondary">${esc(profile.context)}</p>` : ''}
      </section>

      <div class="bd-split">
        <section class="bd-panel">
          <h2>Franchise</h2>
          ${prose(profile.history, 'No curated franchise note yet — narrative is withheld rather than inferred from another bank.')}
          ${profile.ownership ? `<div class="bd-fact"><span>Ownership</span><strong>${esc(profile.ownership)}</strong></div>` : ''}
          ${(profile.shareholders || []).length ? `
            <ul class="bd-bullet">${profile.shareholders.map(s => `<li>${esc(s)}</li>`).join('')}</ul>
          ` : ''}
          ${(profile.sources || []).length ? `
            <div class="bd-sources">
              <div class="bd-fact-label">Sources</div>
              <ul class="bd-bullet">${profile.sources.map(s => {
                const label = s.label || s.url || 'Source';
                return s.url
                  ? `<li><a class="bd-link" href="${esc(s.url)}" target="_blank" rel="noopener noreferrer">${esc(label)}</a></li>`
                  : `<li>${esc(label)}</li>`;
              }).join('')}</ul>
            </div>
          ` : ''}
        </section>

        <section class="bd-panel">
          <h2>Ratings &amp; links</h2>
          ${ratingBlock(code, profile)}
          <div class="bd-panel-gap"></div>
          ${linksBlock(profile, title)}
        </section>
      </div>
    </article>
  `;
}

export function renderBankDetail() {
  const root = document.getElementById('bankDetailRoot');
  if (!root) return;

  const code = selectedBankCode();
  if (code == null) {
    root.innerHTML = `<div class="bd-empty">
      <h2>Bank Profile</h2>
      <p>Select a bank in the sidebar to open its executive brief.</p>
    </div>`;
    return;
  }

  const countryKey = ST.country || 'chile';
  const meta = pais(countryKey);
  const name = bankName(code);
  const local = resolveBankProfile(countryKey, code, name);
  const snap = liveSnapshot(code);
  const ccy = reportingLocalCurrencyISO();
  const iso = datasetIsoCountry();
  const period = ST.hasta || ST.periodos?.[ST.periodos.length - 1] || '—';
  const logoUrl = bankLogoUrl(iso, code);
  const logoHtml = logoUrl
    ? `<img class="bd-logo" src="${logoUrl}" alt="" onerror="this.style.display='none'">`
    : '';

  // Paint local/fallback immediately, then enrich from API.
  paintBrief(root, {
    code, countryKey, name, profile: local, metrics: null, snap,
    periodLabel: period, ccy, iso, logoHtml, meta,
  });

  const reqId = ++_bdReq;
  fetchWithTimeout(
    `${API_BASE}/api/bank-profile?country=${encodeURIComponent(iso)}&codigo=${encodeURIComponent(code)}`,
    {},
    12000,
  ).then(async (r) => {
    if (reqId !== _bdReq) return;
    const j = await r.json();
    if (!r.ok || !j.ok) return;
    const profile = mergeProfile(local, j.profile);
    paintBrief(root, {
      code, countryKey, name, profile, metrics: j.metrics || null, snap,
      periodLabel: period, ccy, iso, logoHtml, meta,
    });
  }).catch(() => {
    // Keep local fallback if API is unreachable.
  });
}
