// ============================================================
// CHARTS — canvas bar/line chart engine with tooltip support
// ============================================================
import { ST, CHART_STATE } from './state.js';
import { fmtAxis, periodLabel } from './format.js';

export function sparseData(rawData) {
  const firstNonZero = rawData.findIndex(v => v !== 0);
  if (firstNonZero === -1) return rawData;
  return rawData.map((v, i) => i < firstNonZero ? null : v);
}

export function niceScale(lo, hi) {
  const allNeg = hi <= 0 && lo < 0;
  const allPos = lo >= 0 && hi > 0;
  const forceZero = !allNeg && (lo < 0 || (allPos && lo < hi * 0.2));
  const scaleLo = forceZero ? Math.min(0, lo) : lo;
  const range = hi - scaleLo || 1;
  const roughStep = range / 4;
  const mag = Math.pow(10, Math.floor(Math.log10(Math.abs(roughStep) || 1)));
  const steps = [1, 2, 2.5, 5, 10];
  let step = mag;
  for (const s of steps) {
    if (s * mag >= roughStep) { step = s * mag; break; }
  }
  const nLo = Math.floor(scaleLo / step) * step;
  const nHi = Math.ceil(hi / step) * step;
  const ticks = [];
  for (let t = nLo; t <= nHi + step * 0.01; t += step) ticks.push(parseFloat(t.toPrecision(10)));
  return { ticks, lo: ticks[0], hi: ticks[ticks.length - 1] };
}

export function drawLineChart(canvasId, periodos, series, chartType) {
  chartType = chartType || 'bars';
  const canvas = document.getElementById(canvasId);
  if (!canvas) return;

  const rawW = canvas.parentElement.clientWidth || canvas.parentElement.offsetWidth;
  if (!rawW || rawW < 10) {
    requestAnimationFrame(() => drawLineChart(canvasId, periodos, series, chartType));
    return;
  }

  const dpr = window.devicePixelRatio || 1;
  const W = rawW;
  const isResumen = canvasId === 'chartResumen';
  const H = isResumen ? 360 : 180;

  canvas.width  = W * dpr;
  canvas.height = H * dpr;
  canvas.style.width  = W + 'px';
  canvas.style.height = H + 'px';
  const ctx = canvas.getContext('2d');
  ctx.scale(dpr, dpr);

  const PAD = { t: 16, r: 16, b: 44, l: 72 };
  const cW = W - PAD.l - PAD.r;
  const cH = H - PAD.t - PAD.b;

  ctx.clearRect(0, 0, W, H);

  const COLORS = {
    'var(--accent)': '#38bdf8',
    'var(--green)':  '#34d399',
    'var(--red)':    '#f87171',
    'var(--purple)': '#a78bfa',
    'var(--yellow)': '#fbbf24',
  };

  const allVals = series.flatMap(s => s.data).filter(v => v !== null && isFinite(v));
  if (!allVals.length) return;

  let rawLo = Math.min(...allVals);
  let rawHi = Math.max(...allVals);

  const nSeries = series.filter(s => s.data.some(v => v !== null)).length;

  if (nSeries >= 2 && rawLo >= 0) {
    rawLo = 0;
  } else if (nSeries >= 2 && rawHi <= 0) {
    rawHi = 0;
  } else if (nSeries === 1) {
    const absMax = Math.max(Math.abs(rawLo), Math.abs(rawHi)) || 1;
    const dataRange = rawHi - rawLo;
    const minRange = absMax * 0.15;
    if (dataRange < minRange) {
      const pad = (minRange - dataRange) / 2;
      rawLo -= pad;
      rawHi += pad;
    }
  }

  const rangeGuard = (rawHi - rawLo) || Math.abs(rawHi) * 0.1 || 1;
  rawHi += rangeGuard * 0.08;
  if (rawLo > 0) rawLo -= rangeGuard * 0.05;

  const scale = niceScale(rawLo, rawHi);
  const lo = scale.lo, hi = scale.hi;

  const toY  = v => PAD.t + cH - ((v - lo) / (hi - lo)) * cH;
  const zeroY = toY(0);

  const gridColor = ST.theme === 'light' ? '#d1dce8' : '#1e2d3d';
  const axisColor = ST.theme === 'light' ? '#6b8aaa' : '#94a8be';
  ctx.strokeStyle = gridColor;
  ctx.lineWidth = 1;
  scale.ticks.forEach(tick => {
    const y = toY(tick);
    if (y < PAD.t - 2 || y > PAD.t + cH + 2) return;
    ctx.beginPath(); ctx.moveTo(PAD.l, y); ctx.lineTo(PAD.l + cW, y); ctx.stroke();
    ctx.fillStyle = axisColor;
    ctx.font = '10px DM Mono, monospace';
    ctx.textAlign = 'right';
    ctx.fillText(fmtAxis(tick), PAD.l - 5, y + 3);
  });

  if (rawLo < 0) {
    ctx.strokeStyle = ST.theme === 'light' ? '#94a3b8' : '#3a5068';
    ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.moveTo(PAD.l, zeroY); ctx.lineTo(PAD.l + cW, zeroY); ctx.stroke();
  }

  const n = periodos.length;
  const groupW = cW / n;
  const barPad = Math.max(groupW * 0.1, 2);
  const barW   = Math.max((groupW - barPad * 2) / nSeries, 2);

  CHART_STATE[canvasId] = { bars: [], periodos, series, PAD, W, H, dpr };

  if (chartType === 'line') {
    series.forEach(s => {
      const color = COLORS[s.color] || s.color;
      ctx.strokeStyle = color;
      ctx.lineWidth = 2.5;
      ctx.lineJoin = 'round';
      ctx.beginPath();
      let started = false;
      s.data.forEach((v, i) => {
        if (v === null) { started = false; return; }
        const x = PAD.l + (i + 0.5) * groupW;
        const y = toY(v);
        if (!started) { ctx.moveTo(x, y); started = true; }
        else ctx.lineTo(x, y);
      });
      ctx.stroke();
      const lastIdx = s.data.reduceRight((f, v, i) => f === -1 && v !== null ? i : f, -1);
      if (lastIdx >= 0) {
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.arc(PAD.l + (lastIdx + 0.5) * groupW, toY(s.data[lastIdx]), 4, 0, Math.PI * 2);
        ctx.fill();
      }
    });
  } else {
    const showLabels = ST.showBarLabels === null ? nSeries === 1 : ST.showBarLabels === true;
    const labelsToDraw = [];

    series.forEach((s, si) => {
      const color = COLORS[s.color] || s.color;
      s.data.forEach((v, i) => {
        if (v === null) return;
        const x = PAD.l + i * groupW + barPad + si * barW;
        const refY  = Math.min(Math.max(zeroY, PAD.t), PAD.t + cH);
        const valY  = Math.min(Math.max(toY(v),  PAD.t), PAD.t + cH);
        const barTop    = Math.min(refY, valY);
        const barBottom = Math.max(refY, valY);
        const h = Math.max(1, barBottom - barTop);
        ctx.fillStyle = color;
        ctx.globalAlpha = 0.85;
        ctx.beginPath();
        ctx.roundRect(x, barTop, barW, h, 2);
        ctx.fill();
        ctx.globalAlpha = 1;
        CHART_STATE[canvasId].bars.push({ x, y: barTop, w: barW, h, val: v, periodo: periodos[i], label: s.label, color });

        if (showLabels) {
          const labelX  = x + barW / 2;
          const txt     = fmtAxis(v);
          const aboveY  = barTop - 5;
          const insideY = barTop + 11;
          const labelY  = aboveY > PAD.t + 12 ? aboveY : insideY;
          labelsToDraw.push({ labelX, labelY, v: txt, inside: aboveY <= PAD.t + 12 });
        }
      });
    });

    ctx.font = `bold 10px DM Mono, monospace`;
    ctx.textAlign = 'center';
    labelsToDraw.forEach(({ labelX, labelY, v }) => {
      const txt = typeof v === 'string' ? v : fmtAxis(v);
      const tw  = ctx.measureText(txt).width;
      ctx.fillStyle = ST.theme === 'light' ? 'rgba(255,255,255,0.92)' : 'rgba(15,23,35,0.85)';
      ctx.fillRect(labelX - tw / 2 - 3, labelY - 11, tw + 6, 14);
      ctx.fillStyle = ST.theme === 'light' ? '#1e293b' : '#f1f5f9';
      ctx.fillText(txt, labelX, labelY);
    });
  }

  const step = Math.ceil(n / 10);
  periodos.forEach((p, i) => {
    if (i % step !== 0 && i !== n - 1) return;
    const x = PAD.l + i * groupW + groupW / 2;
    ctx.fillStyle = axisColor;
    ctx.font = '10px DM Mono, monospace';
    ctx.textAlign = 'center';
    ctx.fillText(periodLabel(p), x, PAD.t + cH + 36);
  });
}

export function setupChartTooltip(canvasId, tooltipId) {
  const canvas  = document.getElementById(canvasId);
  const tooltip = document.getElementById(tooltipId);
  if (!canvas || !tooltip) return;

  canvas.addEventListener('mousemove', e => {
    const state = CHART_STATE[canvasId];
    if (!state) return;
    const rect = canvas.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    let found = null;
    for (const bar of state.bars) {
      if (mx >= bar.x && mx <= bar.x + bar.w && my >= bar.y && my <= bar.y + bar.h) {
        found = bar; break;
      }
    }
    if (found) {
      tooltip.style.display = 'block';
      tooltip.innerHTML = `<span style="color:${found.color}">${found.label}</span><br><strong>${periodLabel(found.periodo)}</strong>: ${fmtAxis(found.val)}`;
      const ttW = tooltip.offsetWidth || 160;
      const ttH = tooltip.offsetHeight || 48;
      const spaceRight = window.innerWidth - e.clientX;
      const left = spaceRight < ttW + 20 ? e.clientX - ttW - 12 : e.clientX + 12;
      const top  = Math.max(8, e.clientY - ttH / 2);
      tooltip.style.left = left + 'px';
      tooltip.style.top  = top  + 'px';
    } else {
      tooltip.style.display = 'none';
    }
  });
  canvas.addEventListener('mouseleave', () => { tooltip.style.display = 'none'; });
}
