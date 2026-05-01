// ============================================================
// CONFIG TAB — settings panel, visit counter, period/bank info
// ============================================================
import { ST } from '../state.js?v=bmon10';
import { API_BASE } from '../config.js?v=bmon10';
import { MESES } from '../config.js?v=bmon10';
import { bankName, periodLabel } from '../format.js?v=bmon10';
import { fetchWithTimeout } from '../api.js?v=bmon10';

export function populateConfig() {
  const statusEl = document.getElementById('configStatus');
  if (statusEl && ST._lastP) {
    const banks = [...ST.selected].map(c => bankName(c)).join(', ');
    const desde = ST.desde ? periodLabel(ST.desde) : '—';
    const hasta  = ST.hasta  ? periodLabel(ST.hasta)  : '—';
    statusEl.textContent = banks ? `${banks} · ${desde} → ${hasta}` : 'No active query';
  }

  if (ST.periodos.length) {
    const last = ST.periodos[ST.periodos.length - 1];
    document.getElementById('configLastUpdate').textContent = periodLabel(last) + ' · ' + last;
  }

  if (ST.periodos.length) {
    const grouped = {};
    ST.periodos.forEach(p => {
      const y = p.slice(0, 4);
      if (!grouped[y]) grouped[y] = [];
      grouped[y].push(MESES[parseInt(p.slice(4, 6))]);
    });
    document.getElementById('configPeriodos').innerHTML = Object.entries(grouped)
      .map(([y, ms]) => `<span style="color:var(--text)">${y}:</span> ${ms.join(', ')}`)
      .join('<br>');
  }

  if (Object.keys(ST.bancos).length) {
    document.getElementById('configBanks').innerHTML = Object.entries(ST.bancos)
      .filter(([c]) => parseInt(c) !== 999)
      .map(([c]) => `<span style="color:var(--text)">${String(c).padStart(3, '0')}</span> ${bankName(parseInt(c))}`)
      .join(' &nbsp;·&nbsp; ');
  }
}

export async function trackVisit() {
  try {
    let country = 'Unknown', countryCode = '??';
    try {
      const geo = await fetch('https://ipapi.co/json/');
      if (geo.ok) {
        const d = await geo.json();
        country     = d.country_name || 'Unknown';
        countryCode = d.country_code || '??';
      }
    } catch {}

    const myCount = (parseInt(localStorage.getItem('btg_my_visits') || '0') + 1);
    localStorage.setItem('btg_my_visits', String(myCount));
    ST._myVisits      = myCount;
    ST._myCountry     = country;
    ST._myCountryCode = countryCode;

    fetch(`${API_BASE}/api/visits`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ country_code: countryCode, country_name: country }),
    }).catch(() => {});
  } catch (e) { console.warn('Visit tracking:', e.message); }
}

export async function loadVisitStats() {
  try {
    const flagEmoji = code => code?.length === 2
      ? String.fromCodePoint(...[...code].map(c => 0x1F1E6 + c.charCodeAt(0) - 65))
      : '🌐';

    const myEl = document.getElementById('myVisitCount');
    if (myEl) myEl.textContent = (parseInt(localStorage.getItem('btg_my_visits') || '0')).toLocaleString();

    const locEl = document.getElementById('visitCountry');
    if (locEl && ST._myCountry) locEl.textContent = `${flagEmoji(ST._myCountryCode)} ${ST._myCountry}`;

    try {
      const r = await fetchWithTimeout(`${API_BASE}/api/visits`, {}, 5000);
      if (!r.ok) throw new Error(`status ${r.status}`);
      const j = await r.json();

      const countEl = document.getElementById('visitCount');
      if (countEl) countEl.textContent = j.ok && j.total != null ? Number(j.total).toLocaleString() : '—';

      const el = document.getElementById('visitsByCountry');
      if (el && j.ok && Array.isArray(j.byCountry) && j.byCountry.length) {
        const maxV = j.byCountry[0].visit_count || 1;
        el.innerHTML = j.byCountry.map(d => {
          const pct = (d.visit_count / maxV * 100).toFixed(0);
          return `<div style="display:flex;align-items:center;gap:10px;">
            <div style="width:140px;font-size:12px;color:var(--text);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">
              ${flagEmoji(d.country_code)} ${d.country_name}</div>
            <div style="flex:1;background:var(--bg3);border-radius:3px;height:14px;">
              <div style="width:${pct}%;height:100%;background:var(--accent);border-radius:3px;opacity:0.7;"></div>
            </div>
            <div style="width:36px;font-family:var(--mono);font-size:11px;color:var(--text2);text-align:right;">${Number(d.visit_count).toLocaleString()}</div>
          </div>`;
        }).join('');
      } else if (el) {
        el.innerHTML = '<div style="font-size:12px;color:var(--text3);">No visit data yet.</div>';
      }
    } catch (e) {
      const countEl = document.getElementById('visitCount');
      if (countEl) countEl.textContent = '—';
      console.warn('loadVisitStats (global):', e.message);
    }
  } catch (e) { console.warn('loadVisitStats:', e.message); }
}
