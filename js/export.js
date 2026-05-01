// ============================================================
// EXPORT — Excel export helpers (uses XLSX from CDN script tag)
// ============================================================
import { ST, reportingLocalCurrencyISO } from './state.js?v=bmon12';
import { periodLabel } from './format.js?v=bmon12';

export function parseExportVal(text) {
  if (!text || text === '—' || text === '') return text;
  const s   = text.trim();
  const neg = s.startsWith('-') || s.startsWith('−') || /^-\s*USD/i.test(s);
  const clean = s.replace(/^[+\-−]\s*(USD\s+|USD|\$\s*)?/i, '')
                  .replace(/^(USD\s+|USD|\$\s*)/i, '').trim();
  if (clean.endsWith('%')) {
    const num = parseFloat(clean.slice(0, -1).replace(',', '.'));
    return isNaN(num) ? text : (neg ? -Math.abs(num) : Math.abs(num));
  }
  const mult = { T: 1e12, B: 1e9, M: 1e6, K: 1e3 };
  const m = clean.match(/^([\d.,]+)\s*([TBMK])?x?$/i);
  if (m) {
    const num    = parseFloat(m[1].replace(',', '.'));
    const factor = mult[m[2]?.toUpperCase()] || 1;
    return (neg ? -1 : 1) * num * factor;
  }
  const plain = parseFloat(clean.replace(',', '.'));
  return isNaN(plain) ? text : (neg ? -Math.abs(plain) : Math.abs(plain));
}

export function parseExportDate(text) {
  if (!text) return text;
  const months = {
    Jan:'01',Feb:'02',Mar:'03',Apr:'04',May:'05',Jun:'06',
    Jul:'07',Aug:'08',Sep:'09',Oct:'10',Nov:'11',Dec:'12',
  };
  const m = text.trim().match(/^([A-Za-z]{3})\s+(\d{4})$/);
  if (m && months[m[1]]) return `01/${months[m[1]]}/${m[2]}`;
  return text;
}

export function tableToData(table) {
  const rows = [];
  table.querySelectorAll('tr').forEach(tr => {
    const cells = [];
    tr.querySelectorAll('th, td').forEach(td => {
      const exportVal = td.getAttribute('data-export');
      if (exportVal !== null) { cells.push(exportVal); return; }
      const raw    = td.innerText.trim();
      const isDate = /^[A-Za-z]{3}\s+\d{4}$/.test(raw);
      if (isDate) { cells.push(parseExportDate(raw)); return; }
      const isVal  = /^-?\s*(USD\s+)?[\d.,]+\s*[TBMK]?x?%?$/.test(raw) && raw !== '';
      cells.push(isVal ? parseExportVal(raw) : raw);
    });
    if (cells.some(c => c !== '')) rows.push(cells);
  });
  return rows;
}

export function addMetaSheet(wb) {
  const lastP      = ST.periodos.length ? ST.periodos[ST.periodos.length - 1] : '—';
  const lastPLabel = ST.periodos.length ? periodLabel(lastP) : '—';
  const today      = new Date();
  const todayStr   = `${String(today.getDate()).padStart(2, '0')}-${String(today.getMonth() + 1).padStart(2, '0')}-${today.getFullYear()}`;
  const localIso = reportingLocalCurrencyISO();
  const rateLocale = ST.country === 'colombia' ? 'es-CO' : 'es-CL';
  const currencyMeta = ST.currency === 'USD' && ST.usdRate
    ? `USD (1 USD ≈ $${Math.round(ST.usdRate).toLocaleString(rateLocale)} ${localIso})`
    : `${localIso} (MM$, as reported)`;
  const metaData   = [
    ['Source',              'Bank Monitor — ALM BTG Pactual Chile'],
    ['Data source',         'CMF (Comisión para el Mercado Financiero) — Chile'],
    ['Accounting standard', 'IFRS — effective January 2022 (Circular N° 2.243)'],
    ['Built by',            'Alejandro Arango Ochoa — ALM BTG Pactual Chile'],
    ['Data updated through', lastPLabel],
    ['Exported on',         todayStr],
    ['Currency',            currencyMeta],
    ['Values',              'Raw numbers (no abbreviation)'],
  ];
  const ws = XLSX.utils.aoa_to_sheet(metaData);
  ws['!cols'] = [{ wch: 25 }, { wch: 55 }];
  XLSX.utils.book_append_sheet(wb, ws, 'Source');
}

export function exportTableById(tableContainerId, filename) {
  const container = document.getElementById(tableContainerId);
  if (!container) return;
  const table = container.id === 'avTable'
    ? document.getElementById('avResultTable')
    : (container.tagName === 'TABLE' ? container : container.querySelector('table'));
  if (!table) { alert('No data to export'); return; }
  try {
    const data   = tableToData(table);
    const wb     = XLSX.utils.book_new();
    const ws     = XLSX.utils.aoa_to_sheet(data);
    const maxLen = data.reduce((acc, row) => {
      row.forEach((c, i) => { acc[i] = Math.max(acc[i] || 8, String(c || '').length + 2); });
      return acc;
    }, []);
    ws['!cols'] = maxLen.map(w => ({ wch: Math.min(w, 40) }));
    XLSX.utils.book_append_sheet(wb, ws, filename.slice(0, 31));
    addMetaSheet(wb);
    const date = new Date().toISOString().slice(0, 10).split('-').reverse().join('-');
    XLSX.writeFile(wb, `${filename}_${date}.xlsx`);
  } catch (e) {
    console.error('Export failed:', e);
    alert('Export failed: ' + e.message);
  }
}

export function exportChartTable() {
  const metricLabels = {
    activos:'Assets', coloc:'Loans', pasivos:'Liabilities',
    patrimonio:'Equity', utilidad:'Net_Income', mora:'NPL_pct_of_loans',
    dep_vista:'Demand_Deposits', dep_plazo:'Time_Deposits', bonos:'Bonds',
  };
  const metric = ST._lastResChart || 'data';
  exportTableById('resChartTable', `Bank_Monitor_${metricLabels[metric] || metric}`);
}
