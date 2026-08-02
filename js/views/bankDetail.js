// ============================================================
// Bank Detail — executive brief for the selected institution
// ============================================================
import { ST, datasetIsoCountry, reportingLocalCurrencyISO } from '../state.js?v=bmon44';
import { bankName, fmtKPI } from '../format.js?v=bmon44';
import { pais } from '../paises.js?v=bmon44';
import { resolveBankProfile } from '../bankProfiles.js?v=bmon44';
import { getCBRatings } from './ranking.js?v=bmon44';
import { bankLogoUrl } from '../config.js?v=bmon44';

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
    return `<p class="bd-muted">No credit rating loaded for this bank yet. You can set one under Banking System → ratings editor where available.</p>`;
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
  if (profile.website) links.push({ label: 'Official website', url: profile.website });
  if (profile.irUrl) links.push({ label: 'Investor relations', url: profile.irUrl });
  const q = encodeURIComponent(displayName);
  links.push({ label: 'Google News', url: `https://news.google.com/search?q=${q}` });
  links.push({ label: 'Wikipedia search', url: `https://en.wikipedia.org/w/index.php?search=${q}` });
  return `<ul class="bd-link-list">${links.map(l => `
    <li><a href="${esc(l.url)}" target="_blank" rel="noopener noreferrer">${esc(l.label)} ↗</a></li>
  `).join('')}</ul>`;
}

function newsBlock(profile) {
  const items = profile.news || [];
  if (!items.length) return `<p class="bd-muted">No curated headlines yet — use the news search link.</p>`;
  return `<ul class="bd-news-list">${items.map(n => `
    <li>
      <a href="${esc(n.url)}" target="_blank" rel="noopener noreferrer">${esc(n.title)}</a>
      <span class="bd-news-meta">${esc([n.source, n.date].filter(Boolean).join(' · '))}</span>
    </li>`).join('')}</ul>`;
}

function kpiCard(label, value) {
  const v = value == null || Number.isNaN(Number(value)) ? '—' : fmtKPI(value);
  return `<div class="bd-kpi"><div class="bd-kpi-label">${esc(label)}</div><div class="bd-kpi-val">${v}</div></div>`;
}

export function renderBankDetail() {
  const root = document.getElementById('bankDetailRoot');
  if (!root) return;

  const code = selectedBankCode();
  if (code == null) {
    root.innerHTML = `<div class="bd-empty">
      <h2>Bank Detail</h2>
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

  const shareholders = (profile.shareholders || []).length
    ? `<ul class="bd-bullet">${profile.shareholders.map(s => `<li>${esc(s)}</li>`).join('')}</ul>`
    : (profile.controlling
      ? `<p>${esc(profile.controlling)}</p>`
      : `<p class="bd-muted">Ownership detail not curated yet.</p>`);

  root.innerHTML = `
    <article class="bd-brief">
      <header class="bd-hero">
        <div class="bd-hero-text">
          <div class="bd-eyebrow">${esc(meta?.name || countryKey)} · Supervisory brief</div>
          <h1 class="bd-title">${esc(profile.shortName || name)}</h1>
          <p class="bd-legal">${esc(profile.legalName || name)} · Code ${esc(code)}</p>
          <div class="bd-meta-line">
            ${profile.hq ? `<span>${esc(profile.hq)}</span>` : ''}
            ${profile.founded ? `<span>Founded ${esc(profile.founded)}</span>` : ''}
            ${profile.ownership ? `<span>${esc(profile.ownership)}</span>` : ''}
            <span>Period ${esc(period)} · ${esc(ccy)}</span>
          </div>
        </div>
        <div class="bd-hero-aside">${logoHtml}</div>
      </header>

      <section class="bd-kpis" aria-label="Live snapshot">
        ${kpiCard('Equity', snap.equity)}
        ${kpiCard('Total assets', snap.assets)}
        ${kpiCard('Net income', snap.ni)}
        ${kpiCard('Loans', snap.loans)}
      </section>
      <p class="bd-footnote">Snapshot from LatamBanks loaded supervisory data (latest selected period). Figures follow the active currency toggle.</p>

      <div class="bd-grid">
        <section class="bd-card">
          <h2>Context</h2>
          <p>${esc(profile.context || '—')}</p>
          <h3>History</h3>
          <p>${esc(profile.history || '—')}</p>
        </section>

        <section class="bd-card">
          <h2>Ownership</h2>
          <div class="bd-field"><span class="bd-field-label">Structure</span><span>${esc(profile.ownership || '—')}</span></div>
          <div class="bd-field"><span class="bd-field-label">Control</span><span>${esc(profile.controlling || '—')}</span></div>
          <h3>Shareholders / group</h3>
          ${shareholders}
        </section>

        <section class="bd-card">
          <h2>Credit ratings</h2>
          ${ratingBlock(code, profile)}
        </section>

        <section class="bd-card">
          <h2>Links</h2>
          ${linksBlock(profile, profile.shortName || name)}
          <h3>Recent coverage</h3>
          ${newsBlock(profile)}
        </section>
      </div>
    </article>
  `;
}
