/* ============================================================
   NovaTrade — Lightweight Canvas Chart Engine
   Pure canvas — no external chart library dependencies
   ============================================================ */

'use strict';

const NTChart = (() => {
  let canvas, ctx;
  let data      = [];   // [{ time, open, high, low, close }]
  let lineData  = [];   // [{ time, price }]
  let type      = 'candle'; // 'candle' | 'line'
  let isDark    = true;

  // Colors
  const C = {
    up:         '#22c55e',
    down:       '#ef4444',
    upFill:     'rgba(34,197,94,.12)',
    downFill:   'rgba(239,68,68,.12)',
    linePurple: '#6C63FF',
    lineFill1:  'rgba(108,99,255,.2)',
    lineFill2:  'rgba(108,99,255,0)',
    grid:       'rgba(255,255,255,.045)',
    label:      'rgba(255,255,255,.35)',
    crosshair:  'rgba(255,255,255,.15)',
    bg:         '#12141f',
  };

  let crossX = null, crossY = null;
  let hoveredIdx = -1;

  function init(canvasEl) {
    canvas = canvasEl;
    ctx    = canvas.getContext('2d');
    attachEvents();
  }

  function setType(t) { type = t; render(); }

  function setCandles(candles) {
    data = candles.map(c => ({
      time:  c.epoch,
      open:  parseFloat(c.open),
      high:  parseFloat(c.high),
      low:   parseFloat(c.low),
      close: parseFloat(c.close),
    }));
    lineData = data.map(d => ({ time: d.time, price: d.close }));
    render();
  }

  function pushTick(tick) {
    const price = parseFloat(tick.quote);
    const time  = tick.epoch;
    if (!lineData.length || time !== lineData[lineData.length - 1].time) {
      lineData.push({ time, price });
      if (lineData.length > 500) lineData.shift();
    } else {
      lineData[lineData.length - 1].price = price;
    }
    // Update last candle close
    if (data.length) {
      data[data.length - 1].close = price;
      if (price > data[data.length - 1].high) data[data.length - 1].high = price;
      if (price < data[data.length - 1].low)  data[data.length - 1].low  = price;
    }
    render();
  }

  function pushCandle(candle) {
    const c = {
      time:  candle.epoch,
      open:  parseFloat(candle.open),
      high:  parseFloat(candle.high),
      low:   parseFloat(candle.low),
      close: parseFloat(candle.close),
    };
    const last = data[data.length - 1];
    if (last && last.time === c.time) {
      data[data.length - 1] = c;
    } else {
      data.push(c);
      if (data.length > 500) data.shift();
    }
    lineData = data.map(d => ({ time: d.time, price: d.close }));
    render();
  }

  function render() {
    if (!canvas || !ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return;

    canvas.width  = rect.width  * dpr;
    canvas.height = rect.height * dpr;
    ctx.scale(dpr, dpr);

    const W  = rect.width;
    const H  = rect.height;
    const PL = 10;
    const PR = 72;
    const PT = 12;
    const PB = 28;
    const chartW = W - PL - PR;
    const chartH = H - PT - PB;

    // Background
    ctx.fillStyle = C.bg;
    ctx.fillRect(0, 0, W, H);

    const dataset = type === 'candle' ? data : lineData;
    if (!dataset.length) {
      ctx.fillStyle = C.label;
      ctx.font = '13px Inter, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('Loading data…', W / 2, H / 2);
      return;
    }

    // Compute price range
    let minP, maxP;
    if (type === 'candle') {
      minP = Math.min(...data.map(d => d.low));
      maxP = Math.max(...data.map(d => d.high));
    } else {
      minP = Math.min(...lineData.map(d => d.price));
      maxP = Math.max(...lineData.map(d => d.price));
    }
    const pad  = (maxP - minP) * .08 || maxP * .001;
    minP -= pad; maxP += pad;

    function toY(price) { return PT + chartH - ((price - minP) / (maxP - minP)) * chartH; }
    function toX(i, total) { return PL + (i / (total - 1 || 1)) * chartW; }

    // Grid lines
    const gridLines = 5;
    ctx.setLineDash([3, 4]);
    ctx.strokeStyle = C.grid;
    ctx.lineWidth = 1;
    for (let i = 0; i <= gridLines; i++) {
      const y = PT + (i / gridLines) * chartH;
      ctx.beginPath(); ctx.moveTo(PL, y); ctx.lineTo(W - PR, y); ctx.stroke();
      const price = maxP - (i / gridLines) * (maxP - minP);
      ctx.fillStyle = C.label;
      ctx.font = '10px Inter, sans-serif';
      ctx.textAlign = 'left';
      ctx.fillText(formatPrice(price), W - PR + 6, y + 4);
    }
    ctx.setLineDash([]);

    if (type === 'line' && lineData.length > 1) {
      // ---- LINE CHART ----
      const pts = lineData.map((d, i) => ({ x: toX(i, lineData.length), y: toY(d.price) }));

      // Fill gradient
      const grad = ctx.createLinearGradient(0, PT, 0, PT + chartH);
      grad.addColorStop(0, C.lineFill1);
      grad.addColorStop(1, C.lineFill2);
      ctx.beginPath();
      ctx.moveTo(pts[0].x, PT + chartH);
      pts.forEach(p => ctx.lineTo(p.x, p.y));
      ctx.lineTo(pts[pts.length - 1].x, PT + chartH);
      ctx.closePath();
      ctx.fillStyle = grad;
      ctx.fill();

      // Line
      ctx.beginPath();
      pts.forEach((p, i) => { i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y); });
      ctx.strokeStyle = C.linePurple;
      ctx.lineWidth = 2;
      ctx.lineJoin = 'round';
      ctx.stroke();

      // Last dot
      const last = pts[pts.length - 1];
      ctx.beginPath();
      ctx.arc(last.x, last.y, 4, 0, Math.PI * 2);
      ctx.fillStyle = C.linePurple;
      ctx.fill();

    } else if (type === 'candle' && data.length) {
      // ---- CANDLE CHART ----
      const n = data.length;
      const candleW = Math.max(2, Math.min(16, chartW / n - 1));

      data.forEach((d, i) => {
        const x   = PL + (i / (n - 1 || 1)) * chartW;
        const isUp = d.close >= d.open;
        const col  = isUp ? C.up : C.down;
        const oY   = toY(d.open);
        const cY   = toY(d.close);
        const hY   = toY(d.high);
        const lY   = toY(d.low);

        // Wick
        ctx.beginPath();
        ctx.moveTo(x, hY); ctx.lineTo(x, lY);
        ctx.strokeStyle = col; ctx.lineWidth = 1;
        ctx.stroke();

        // Body
        const bodyTop = Math.min(oY, cY);
        const bodyH   = Math.max(1, Math.abs(cY - oY));
        ctx.fillStyle = isUp ? C.upFill : C.downFill;
        ctx.strokeStyle = col;
        ctx.lineWidth = 1;
        ctx.fillRect(x - candleW / 2, bodyTop, candleW, bodyH);
        ctx.strokeRect(x - candleW / 2, bodyTop, candleW, bodyH);
      });
    }

    // Crosshair
    if (crossX !== null && crossY !== null) {
      ctx.setLineDash([4, 4]);
      ctx.strokeStyle = C.crosshair;
      ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(crossX, PT); ctx.lineTo(crossX, PT + chartH); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(PL, crossY); ctx.lineTo(W - PR, crossY); ctx.stroke();
      ctx.setLineDash([]);

      // Price label on y-axis
      const hoverPrice = maxP - ((crossY - PT) / chartH) * (maxP - minP);
      const labelH = 16;
      ctx.fillStyle = C.linePurple;
      ctx.fillRect(W - PR + 2, crossY - labelH / 2, PR - 4, labelH);
      ctx.fillStyle = '#fff';
      ctx.font = 'bold 10px Inter, sans-serif';
      ctx.textAlign = 'left';
      ctx.fillText(formatPrice(hoverPrice), W - PR + 6, crossY + 4);
    }

    // Time axis labels
    const labelCount = Math.min(6, dataset.length);
    const step = Math.floor(dataset.length / labelCount);
    ctx.fillStyle = C.label;
    ctx.font = '9px Inter, sans-serif';
    ctx.textAlign = 'center';
    for (let i = 0; i < dataset.length; i += step) {
      const x = toX(i, dataset.length);
      const t = new Date((dataset[i].time || 0) * 1000);
      const lbl = `${t.getHours().toString().padStart(2,'0')}:${t.getMinutes().toString().padStart(2,'0')}`;
      ctx.fillText(lbl, x, H - 8);
    }
  }

  function formatPrice(p) {
    if (p >= 10000) return p.toFixed(2);
    if (p >= 100)   return p.toFixed(3);
    return p.toFixed(5);
  }

  function attachEvents() {
    canvas.addEventListener('mousemove', (e) => {
      const rect = canvas.getBoundingClientRect();
      crossX = e.clientX - rect.left;
      crossY = e.clientY - rect.top;
      render();
    }, { passive: true });
    canvas.addEventListener('mouseleave', () => {
      crossX = null; crossY = null; render();
    });
    window.addEventListener('resize', render, { passive: true });
  }

  return { init, setType, setCandles, pushTick, pushCandle, render };
})();

window.NTChart = NTChart;
