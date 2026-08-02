// ============================================================
// Bank Profile — executive brief for the selected institution
// ============================================================
// IMPORTANT: import shared modules with the same ?v= as the rest of the app.
// A different query string creates a second ST instance and the profile tab
// always looks "unselected".
import { ST, datasetIsoCountry, reportingLocalCurrencyISO } from '../state.js?v=bmon48';
import { bankName, fmtKPI } from '../format.js?v=bmon48';
import { pais } from '../paises.js?v=bmon48';
import { resolveBankProfile } from '../bankProfiles.js?v=bmon48';
import { getCBRatings } from './ranking.js?v=bmon48';
import { bankLogoUrl } from '../config.js?v=bmon48';

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
    assets: m?.activos ?? m?.TOTAL_ACTIVO ?? m?.totalAct ?? null,
    ni: m?.utilidad ?? m?.RESULTADO_NETO ?? m?.ni ?? null,
    loans: m?.colocaciones ?? m?.CREDITOS_NETOS ?? m?.loans ?? null,
  };
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
  if (profile.irUrl) links.push({ label: 'Investor relations', url: profile.irUrl });
  const q = encodeURIComponent(displayName);
  links.push({ label: 'News', url: `https://news.google.com/search?q=${q}` });
  return `<div class="bd-links">${links.map(l => `
    <a class="bd-link" href="${esc(l.url)}" target="_blank" rel="noopener noreferrer">${esc(l.label)}</a>
  `).join('')}</div>`;
}

function kpiCell(label, value) {
  const v = value == null || Number.isNaN(Number(value)) ? '—' : fmtKPI(value);
  return `<div class="bd-kpi">
    <div class="bd-kpi-label">${esc(label)}</div>
    <div class="bd-kpi-val">${v}</div>
  </div>`;
}

function prose(text, empty = 'Not curated yet.') {
  const t = (text || '').trim();
  if (!t || t === '—') return `<p class="bd-muted">${esc(empty)}</p>`;
  return `<p>${esc(t)}</p>`;
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
  const profile = resolveBankProfile(countryKey, code, name);
  const snap = liveSnapshot(code);
  const ccy = reportingLocalCurrencyISO();
  const iso = datasetIsoCountry();
  const period = ST.hasta || ST.periodos?.[ST.periodos.length - 1] || '—';
  const logoUrl = bankLogoUrl(iso, code);
  const logoHtml = logoUrl
    ? `<img class="bd-logo" src="${logoUrl}" alt="" onerror="this.style.display='none'">`
    : '';

  const title = profile.shortName || name;
  const legal = profile.legalName || name;
  const controlLine = [profile.ownership, profile.controlling].filter(Boolean).join(' · ');

  root.innerHTML = `
    <article class="bd-brief">
      <header class="bd-hero">
        <div class="bd-hero-text">
          <div class="bd-eyebrow">${esc(meta?.name || countryKey)} · Bank Profile</div>
          <h1 class="bd-title">${esc(title)}</h1>
          <p class="bd-legal">${esc(legal)} <span class="bd-code">· ${esc(code)}</span></p>
          <div class="bd-meta-line">
            ${profile.hq ? `<span>${esc(profile.hq)}</span>` : ''}
            ${profile.founded ? `<span>${esc(profile.founded)}</span>` : ''}
            <span>${esc(period)} · ${esc(ccy)}</span>
          </div>
        </div>
        <div class="bd-hero-aside">${logoHtml}</div>
      </header>

      <section class="bd-kpis" aria-label="Live snapshot">
        ${kpiCell('Equity', snap.equity)}
        ${kpiCell('Assets', snap.assets)}
        ${kpiCell('Net income', snap.ni)}
        ${kpiCell('Loans', snap.loans)}
      </section>
      <p class="bd-footnote">Supervisory snapshot for the selected period. Values follow the active currency display.</p>

      <section class="bd-lead">
        <h2>Positioning</h2>
        ${prose(profile.context, 'Curated positioning not loaded for this code. Use the live KPIs and Bank Comparison for size benchmarks.')}
      </section>

      <div class="bd-split">
        <section class="bd-panel">
          <h2>Franchise</h2>
          ${prose(profile.history, 'No curated franchise note yet — narrative is withheld rather than inferred from another bank.')}
          ${controlLine ? `<div class="bd-fact"><span>Ownership</span><strong>${esc(controlLine)}</strong></div>` : ''}
          ${(profile.shareholders || []).length ? `
            <ul class="bd-bullet">${profile.shareholders.map(s => `<li>${esc(s)}</li>`).join('')}</ul>
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
