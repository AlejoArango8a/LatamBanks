// ============================================================
// CONFIG TAB — settings panel, visit counter, period/bank info
// ============================================================
import { ST, datasetIsoCountry } from '../state.js?v=bmon22';
import { API_BASE } from '../config.js?v=bmon22';
import { MESES } from '../config.js?v=bmon22';
import { bankName, periodLabel } from '../format.js?v=bmon22';
import { fetchWithTimeout } from '../api.js?v=bmon22';

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

  loadSchemaAlerts();
}

// ============================================================
// Tarea A — Alertas de cambio de estructura (por mes) del país activo
// ============================================================
export async function loadSchemaAlerts() {
  const el = document.getElementById('schemaAlerts');
  if (!el) return;
  try {
    const country = datasetIsoCountry();
    const r = await fetchWithTimeout(`${API_BASE}/api/schema-alerts?country=${country}`, {}, 8000);
    if (!r.ok) throw new Error(`status ${r.status}`);
    const j = await r.json();

    const alerts = (j.ok && Array.isArray(j.alerts))
      ? j.alerts.filter(a => a.estado === 'alerta_esquema')
      : [];

    if (!alerts.length) {
      el.innerHTML = `<div style="display:flex;align-items:center;gap:8px;font-size:13px;color:var(--text2);">
        <span style="width:8px;height:8px;border-radius:50%;background:#22c55e;display:inline-block;"></span>
        No structural changes detected.</div>`;
      return;
    }

    el.innerHTML = alerts.map(a => {
      const d = a.detalle || {};
      const faltantes = Array.isArray(d.criticas_faltantes) ? d.criticas_faltantes : [];
      const nn = d.n_nuevas ?? 0;
      const nd = d.n_desaparecidas ?? 0;

      const criticalLine = faltantes.length
        ? `<div style="color:#f87171;font-size:12px;margin-top:6px;">Missing key accounts:
             <span style="font-family:var(--mono);">${faltantes.join(', ')}</span></div>`
        : '';

      return `<div style="border:1px solid var(--border);border-left:3px solid #f59e0b;border-radius:6px;padding:12px;margin-bottom:10px;background:var(--bg2);">
        <div style="display:flex;align-items:center;gap:8px;">
          <span style="font-size:10px;font-weight:700;letter-spacing:.5px;color:#0b0b0b;background:#f59e0b;border-radius:4px;padding:2px 6px;">ALERT</span>
          <span style="font-weight:600;color:var(--white);">${periodLabel(a.periodo)}</span>
          <span style="font-family:var(--mono);font-size:11px;color:var(--text3);">${a.periodo}</span>
        </div>
        <div style="font-size:13px;color:var(--text);margin-top:8px;line-height:1.5;">${d.resumen || 'Structural change detected.'}</div>
        ${criticalLine}
        <div style="font-size:12px;color:var(--text2);margin-top:4px;">New accounts: ${nn} &nbsp;·&nbsp; Disappeared: ${nd}</div>
      </div>`;
    }).join('');
  } catch (e) {
    el.innerHTML = `<div style="font-size:12px;color:var(--text3);">Could not load alerts: ${e.message}</div>`;
    console.warn('loadSchemaAlerts:', e.message);
  }
}

export async function trackVisit() {
  try {
    let country = 'Unknown', countryCode = '??';
    try {
      const geo = await fetchWithTimeout(`${API_BASE}/api/geo`, {}, 5000);
      if (geo.ok) {
        const d = await geo.json();
        if (d.ok && d.country_code) {
          country     = d.country_name || 'Unknown';
          countryCode = d.country_code || '??';
        }
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
