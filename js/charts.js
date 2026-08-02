// ============================================================
// CHARTS — canvas bar chart engine with tooltip support
// ============================================================
import { ST, CHART_STATE } from './state.js?v=bmon47';
import { fmtAxis, periodLabel, fmtChartPct } from './format.js?v=bmon47';

export function sparseData(rawData) {
  const firstNonZero = rawData.findIndex(v => v !== 0);
  if (firstNonZero === -1) return rawData;
  return rawData.map((v, i) => i < firstNonZero ? null : v);
}

export function niceScale(lo, hi, tickTarget = 4, forceZeroFlag = false) {
  const allNeg = hi <= 0 && lo < 0;
  const allPos = lo >= 0 && hi > 0;
  const forceZero = forceZeroFlag || (!allNeg && (lo < 0 || (allPos && lo < hi * 0.2)));
  const scaleLo = forceZero ? Math.min(0, lo) : lo;
  const range = hi - scaleLo || 1;
  const tgt = Math.max(2, tickTarget);
  const roughStep = range / tgt;
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

export function drawLineChart(canvasId, periodos, series, opts) {
  opts = opts || {};
  const valueScale = opts.valueScale || 'billions';
  const fmtVal = (v, compact) =>
    valueScale === 'percent' ? fmtChartPct(v, compact)
    : valueScale === 'ratio' ? `${Number(v).toFixed(1)}x`
    : fmtAxis(v, compact);

  const canvas = document.getElementById(canvasId);
  if (!canvas) return;

  const rawW = canvas.parentElement.clientWidth || canvas.parentElement.offsetWidth;
  if (!rawW || rawW < 10) {
    requestAnimationFrame(() => drawLineChart(canvasId, periodos, series, opts));
    return;
  }

  const dpr = window.devicePixelRatio || 1;
  const W = rawW;
  const isResumen = canvasId === 'chartResumen';
  const H = isResumen ? 300 : 180;   // coincide con .chart-canvas max-height → sin escalado/pixelado
  const narrowCanvas = W < 480;
  const veryNarrow   = W < 360;

  canvas.width  = W * dpr;
  canvas.height = H * dpr;
  canvas.style.width  = W + 'px';
  canvas.style.height = H + 'px';
  const ctx = canvas.getContext('2d');
  ctx.scale(dpr, dpr);

  const PAD_tb = veryNarrow
    ? { t: 12, b: 48 }
    : narrowCanvas ? { t: 13, b: 44 } : { t: 16, b: 44 };
  const PAD_r = narrowCanvas ? 10 : 16;
  const cH_prov = H - PAD_tb.t - PAD_tb.b;
  const tickTarget = veryNarrow
    ? Math.max(3, Math.min(5, Math.floor(cH_prov / 42)))
    : narrowCanvas
      ? Math.max(3, Math.min(6, Math.floor(cH_prov / 36)))
      : Math.max(4, Math.min(8, Math.floor(cH_prov / 34)));

  ctx.clearRect(0, 0, W, H);

  const gridColor = ST.theme === 'light' ? '#d1dce8' : '#1e2d3d';
  const axisColor = ST.theme === 'light' ? '#6b8aaa' : '#94a8be';

  const COLORS = {
    'var(--accent)': '#38bdf8',
    'var(--green)':  '#34d399',
    'var(--red)':    '#f87171',
    'var(--purple)': '#a78bfa',
    'var(--yellow)': '#fbbf24',
  };

  const allVals = series.flatMap(s => s.data).filter(v => v !== null && isFinite(v));
  if (!allVals.length) {
    const msg = opts.emptyMessage || '';
    if (msg) {
      ctx.font = `${narrowCanvas ? 11 : 12}px DM Mono, monospace`;
      ctx.fillStyle = axisColor;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      const lines = msg.split(/\n/);
      const midY = PAD_tb.t + (H - PAD_tb.t - PAD_tb.b) / 2;
      lines.forEach((line, i) => ctx.fillText(line, W / 2, midY + (i - (lines.length - 1) / 2) * 16));
    }
    CHART_STATE[canvasId] = { bars: [], periodos, series: [], PAD: { l: 0 }, W, H, dpr, valueScale };
    return;
  }

  let rawLo = Math.min(...allVals);
  let rawHi = Math.max(...allVals);

  const nSeries = series.filter(s => s.data.some(v => v !== null)).length;

  if (nSeries >= 2 && rawLo >= 0 && valueScale !== 'ratio') {
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
  if (valueScale === 'ratio') {
    // Loans/Equity: eje flexible (no forzar cero); piso ~1x por debajo del mínimo.
    rawHi += rangeGuard * 0.16;
    rawLo -= 1;
  } else if (valueScale === 'percent') {
    // % (ROE, NPL): arranca en cero (lo fuerza niceScale más abajo).
    rawHi += rangeGuard * 0.14;
  } else {
    // Montos ($): más amplitud abajo para que las variaciones se aprecien mejor.
    rawHi += rangeGuard * 0.16;
    if (rawLo > 0) rawLo -= rangeGuard * 0.20;
  }

  const scale = niceScale(rawLo, rawHi, tickTarget, valueScale === 'percent');
  const lo = scale.lo, hi = scale.hi;

  const axisPx = veryNarrow ? 8 : narrowCanvas ? 9 : 10;
  const axisCompact = narrowCanvas;
  ctx.font = `${axisPx}px DM Mono, monospace`;
  let maxLw = 28;
  for (const tick of scale.ticks) {
    const lw = ctx.measureText(fmtVal(tick, axisCompact)).width;
    if (lw > maxLw) maxLw = lw;
  }
  const PAD_l = Math.min(112, Math.max(38, Math.ceil(maxLw + 11)));
  const PAD = {
    t: PAD_tb.t,
    r: PAD_r,
    b: PAD_tb.b,
    l: PAD_l,
  };
  const cW = W - PAD.l - PAD.r;
  const cH = H - PAD.t - PAD.b;

  const toY = v => PAD.t + cH - ((v - lo) / (hi - lo)) * cH;
  const zeroY = toY(0);

  ctx.strokeStyle = gridColor;
  ctx.lineWidth = 1;
  scale.ticks.forEach(tick => {
    const y = toY(tick);
    if (y < PAD.t - 2 || y > PAD.t + cH + 2) return;
    ctx.beginPath(); ctx.moveTo(PAD.l, y); ctx.lineTo(PAD.l + cW, y); ctx.stroke();
    ctx.fillStyle = axisColor;
    ctx.font = `${axisPx}px DM Mono, monospace`;
    ctx.textAlign = 'right';
    ctx.fillText(fmtVal(tick, axisCompact), PAD.l - 5, y + 3);
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

  CHART_STATE[canvasId] = { bars: [], periodos, series, PAD, W, H, dpr, valueScale };

  /** On narrow canvas, do not auto-show bar top labels (readable axes first; user uses 123 toggle). */
  const showLabels =
    ST.showBarLabels === true
      ? true
      : ST.showBarLabels === false
        ? false
        : narrowCanvas ? false : nSeries === 1;
  const labelsToDraw = [];

  series.forEach((s, si) => {
    const color = COLORS[s.color] || s.color;
    s.data.forEach((v, i) => {
      if (v === null) return;
      const x = PAD.l + i * groupW + barPad + si * barW;
      const refY = Math.min(Math.max(zeroY, PAD.t), PAD.t + cH);
      const valY = Math.min(Math.max(toY(v), PAD.t), PAD.t + cH);
      const barTop = Math.min(refY, valY);
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
        labelsToDraw.push({ labelX: x + barW / 2, barTop, txt: fmtVal(v, axisCompact) });
      }
    });
  });

  const labelPx = veryNarrow ? 9 : narrowCanvas ? 10 : 12;
  ctx.font = `bold ${labelPx}px DM Mono, monospace`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';
  // TODAS las barras llevan label. Si dos se solaparían, el de arriba se EMPUJA
  // hacia arriba (por filas) y se vincula a su barra con una línea guía punteada.
  // Halo de contraste para que el texto se lea sobre cualquier color de barra.
  const rowH   = labelPx + 3;
  const ceilY  = PAD.t + labelPx + 1;                       // no subir sobre el área del gráfico
  const haloCol   = ST.theme === 'light' ? 'rgba(255,255,255,0.92)' : 'rgba(15,23,42,0.92)';
  const textCol   = ST.theme === 'light' ? '#0b1220' : '#f1f5f9';
  const leaderCol = ST.theme === 'light' ? 'rgba(30,41,59,0.45)' : 'rgba(203,213,225,0.5)';
  const placedBoxes = [];
  labelsToDraw
    .slice()
    .sort((a, b) => (a.labelX - b.labelX) || (a.barTop - b.barTop))
    .forEach(({ labelX, barTop, txt }) => {
      const halfW = ctx.measureText(txt).width / 2 + 1.5;
      let y = Math.max(ceilY, barTop - 6);                  // baseline objetivo, justo sobre la barra
      let guard = 0;
      const hits = () => placedBoxes.some(q =>
        (labelX - halfW) < q.r && (labelX + halfW) > q.l &&
        (y - labelPx) < q.b && (y + 3) > q.t);
      while (hits() && (y - rowH) >= ceilY && guard++ < 60) y -= rowH;   // empuja hacia arriba
      placedBoxes.push({ l: labelX - halfW, r: labelX + halfW, t: y - labelPx, b: y + 3 });
      // Línea guía punteada tenue cuando el label se separó de su barra.
      if (barTop - y > rowH * 0.9) {
        ctx.save();
        ctx.strokeStyle = leaderCol; ctx.lineWidth = 1; ctx.setLineDash([2, 3]);
        ctx.beginPath(); ctx.moveTo(labelX, y + 3); ctx.lineTo(labelX, barTop - 1); ctx.stroke();
        ctx.restore();
      }
      // Halo (contorno) + texto.
      ctx.lineJoin = 'round';
      ctx.lineWidth = 3; ctx.strokeStyle = haloCol;
      ctx.strokeText(txt, labelX, y);
      ctx.fillStyle = textCol;
      ctx.fillText(txt, labelX, y);
    });

  const xAxisPx = veryNarrow ? 8 : narrowCanvas ? 9 : 10;
  const periodStep = Math.max(
    1,
    Math.ceil(n / (veryNarrow ? 4 : narrowCanvas ? 5 : 10))
  );
  periodos.forEach((p, i) => {
    if (i % periodStep !== 0 && i !== n - 1) return;
    const x = PAD.l + i * groupW + groupW / 2;
    ctx.fillStyle = axisColor;
    ctx.font = `${xAxisPx}px DM Mono, monospace`;
    ctx.textAlign = 'center';
    const xAxisYOff = veryNarrow ? 34 : narrowCanvas ? 34 : 36;
    ctx.fillText(periodLabel(p), x, PAD.t + cH + xAxisYOff);
  });

  // ---- Herramienta Δ%: marca los puntos seleccionados y dibuja el conector ----
  if (ST._deltaMode && Array.isArray(ST._deltaSel) && ST._deltaSel.length) {
    const allBars = CHART_STATE[canvasId].bars;
    const sel = ST._deltaSel
      .map(s => allBars.find(b => b.periodo === s.periodo && b.label === s.label))
      .filter(Boolean);
    const ink = ST.theme === 'light' ? '#475569' : '#cbd5e1';   // gris pizarra, sobrio
    ctx.save();
    sel.forEach(b => {
      ctx.fillStyle = ink;
      ctx.beginPath(); ctx.arc(b.x + b.w / 2, b.y, 3.2, 0, Math.PI * 2); ctx.fill();
    });
    if (sel.length === 2) {
      // Siempre calcula el cambio en el sentido del avance del tiempo (período menor → mayor),
      // sin importar el orden de los clicks.
      const [a, b2] = [...sel].sort((p, q) => String(p.periodo).localeCompare(String(q.periodo)));
      const ax = a.x + a.w / 2, bx = b2.x + b2.w / 2;
      // La subida vertical ARRANCA por encima del label del valor (para no solaparlo),
      // sube lo suficiente para superarlo y ahí parte el travesaño horizontal.
      const labelClear = showLabels ? (labelPx + 10) : 6;
      const startA = a.y - labelClear;
      const startB = b2.y - labelClear;
      const topY = Math.max(PAD.t + 4, Math.min(startA, startB) - 9);
      // Conector tipo "bracket": subida vertical (sobre el label) + travesaño horizontal.
      ctx.strokeStyle = ink; ctx.lineWidth = 1; ctx.setLineDash([4, 5]);
      ctx.beginPath();
      if (startA > topY) { ctx.moveTo(ax, startA); ctx.lineTo(ax, topY); }
      if (startB > topY) { ctx.moveTo(bx, startB); ctx.lineTo(bx, topY); }
      ctx.moveTo(Math.min(ax, bx), topY); ctx.lineTo(Math.max(ax, bx), topY);
      ctx.stroke();
      ctx.setLineDash([]);
      const dPct = a.val ? (b2.val / a.val - 1) * 100 : null;
      const dAbs = b2.val - a.val;
      const pctTxt = (dPct === null || !isFinite(dPct)) ? '—' : (dPct >= 0 ? '+' : '') + dPct.toFixed(1) + '%';
      const absTxt = (dAbs >= 0 ? '+' : '') + fmtVal(dAbs, false);
      const txt = `${pctTxt}  ·  ${absTxt}`;
      const midX = (ax + bx) / 2;
      const labelY = Math.max(PAD.t + 11, topY - 7);
      ctx.font = '500 11px DM Mono, monospace';
      ctx.textAlign = 'center';
      const tw = ctx.measureText(txt).width;
      ctx.fillStyle = ST.theme === 'light' ? 'rgba(255,255,255,0.90)' : 'rgba(17,24,39,0.82)';
      ctx.fillRect(midX - tw / 2 - 6, labelY - 11, tw + 12, 15);
      ctx.fillStyle = ink;
      ctx.fillText(txt, midX, labelY);
    }
    ctx.restore();
  }
}

/**
 * Etiqueta de período para el tooltip. Si la serie es trimestral (o de mayor paso),
 * muestra el RANGO de meses que abarca la barra (p. ej. "Jan–Mar 2024") en vez del
 * solo mes de cierre. Detecta el paso a partir de los períodos vecinos.
 */
function periodSpanLabel(periodo, periodos) {
  const p = String(periodo);
  if (p.length < 6) return periodLabel(periodo);
  const y = parseInt(p.slice(0, 4), 10);
  const m = parseInt(p.slice(4, 6), 10);
  const monthsOf = s => {
    const t = String(s);
    return parseInt(t.slice(0, 4), 10) * 12 + parseInt(t.slice(4, 6), 10);
  };
  const list = Array.isArray(periodos) ? periodos : [];
  const idx = list.indexOf(periodo);
  let step = 1;
  if (idx > 0) step = monthsOf(periodo) - monthsOf(list[idx - 1]);
  else if (idx === 0 && list.length > 1) step = monthsOf(list[1]) - monthsOf(periodo);
  if (!(step > 1)) return periodLabel(periodo);   // mensual → un solo mes

  const endTot = y * 12 + m;
  const startTot = endTot - step + 1;
  const sy = Math.floor((startTot - 1) / 12);
  const sm = ((startTot - 1) % 12) + 1;
  const startP = `${sy}${String(sm).padStart(2, '0')}`;
  const endLbl = periodLabel(p);                    // "Mar 2024"
  if (sy === y) {
    const startMon = periodLabel(startP).replace(/\s+\d{4}$/, '');  // "Jan"
    return `${startMon}–${endLbl}`;                 // "Jan–Mar 2024"
  }
  return `${periodLabel(startP)}–${endLbl}`;         // cruza año: "Nov 2023–Jan 2024"
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
      const st = CHART_STATE[canvasId];
      const valTxt =
        st && st.valueScale === 'percent'
          ? fmtChartPct(found.val, false)
          : st && st.valueScale === 'ratio'
            ? `${Number(found.val).toFixed(1)}x`
            : fmtAxis(found.val);
      tooltip.innerHTML = `<span style="color:${found.color}">${found.label}</span><br><strong>${periodSpanLabel(found.periodo, state.periodos)}</strong>: ${valTxt}`;
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

  // Click para seleccionar puntos en modo Δ% (se enlaza una sola vez por canvas).
  if (!canvas._deltaClickBound) {
    canvas._deltaClickBound = true;
    canvas.style.cursor = 'pointer';
    canvas.addEventListener('click', e => {
      if (!ST._deltaMode) return;
      const state = CHART_STATE[canvasId];
      if (!state || !state.bars) return;
      const r = canvas.getBoundingClientRect();
      const mx = e.clientX - r.left, my = e.clientY - r.top;
      let hit = null;
      for (const bar of state.bars) {
        if (mx >= bar.x && mx <= bar.x + bar.w && my >= bar.y && my <= bar.y + bar.h) { hit = bar; break; }
      }
      if (!hit) return;
      if (!Array.isArray(ST._deltaSel) || ST._deltaSel.length >= 2) ST._deltaSel = [];
      ST._deltaSel.push({ periodo: hit.periodo, label: hit.label, val: hit.val });
      drawLineChart(canvasId, state.periodos, state.series, { valueScale: state.valueScale });
    });
  }
}
