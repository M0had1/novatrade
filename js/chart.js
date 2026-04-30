/* ============================================================
   NovaTrade — Canvas Chart Engine v2
   Candlestick + Line, crosshair, real-time push
   ============================================================ */
'use strict';

const NTChart = (() => {
  let _canvas = null;
  let _ctx    = null;
  let _candles = [];    // { time, open, high, low, close }
  let _type    = 'candle';
  let _crossX  = null;
  let _crossY  = null;

  const PAD = { L: 8, R: 68, T: 16, B: 28 };

  const COLOR = {
    bg:       '#0e1017',
    grid:     'rgba(255,255,255,.04)',
    axisText: 'rgba(200,205,230,.4)',
    up:       '#26a69a',
    upBody:   'rgba(38,166,154,.85)',
    down:     '#ef5350',
    downBody: 'rgba(239,83,80,.85)',
    line:     '#6C63FF',
    lineFill: ['rgba(108,99,255,.22)', 'rgba(108,99,255,0)'],
    cross:    'rgba(255,255,255,.12)',
    crossLbl: '#6C63FF',
  };

  function init(canvas) {
    _canvas = canvas;
    _ctx    = canvas.getContext('2d');
    _attachEvents();
  }

  function setType(t) { _type = t; _render(); }

  function setCandles(raw) {
    _candles = raw.map(c => ({
      time:  +c.epoch,
      open:  +c.open,
      high:  +c.high,
      low:   +c.low,
      close: +c.close,
    })).sort((a, b) => a.time - b.time);
    _render();
  }

  function pushCandle(raw) {
    const c = { time: +raw.epoch, open: +raw.open, high: +raw.high, low: +raw.low, close: +raw.close };
    const last = _candles[_candles.length - 1];
    if (last && last.time === c.time) _candles[_candles.length - 1] = c;
    else { _candles.push(c); if (_candles.length > 600) _candles.shift(); }
    _render();
  }

  function pushTick(tick) {
    const p = +tick.quote;
    const t = +tick.epoch;
    if (!_candles.length) return;
    const last = _candles[_candles.length - 1];
    last.close = p;
    if (p > last.high) last.high = p;
    if (p < last.low)  last.low  = p;
    _render();
  }

  function clear() { _candles = []; _render(); }

  /* ---- RENDER ---- */
  function _render() {
    if (!_canvas || !_ctx) return;
    const dpr  = window.devicePixelRatio || 1;
    const rect = _canvas.getBoundingClientRect();
    if (!rect.width || !rect.height) return;

    _canvas.width  = rect.width  * dpr;
    _canvas.height = rect.height * dpr;
    _ctx.scale(dpr, dpr);

    const W  = rect.width;
    const H  = rect.height;
    const cW = W - PAD.L - PAD.R;
    const cH = H - PAD.T - PAD.B;

    // Background
    _ctx.fillStyle = COLOR.bg;
    _ctx.fillRect(0, 0, W, H);

    const data = _candles;
    if (!data.length) {
      _ctx.fillStyle = COLOR.axisText;
      _ctx.font = '13px Inter,sans-serif';
      _ctx.textAlign = 'center';
      _ctx.fillText('Waiting for market data…', W / 2, H / 2);
      return;
    }

    // Price range
    let minP = Infinity, maxP = -Infinity;
    data.forEach(c => {
      if (c.low  < minP) minP = c.low;
      if (c.high > maxP) maxP = c.high;
    });
    const spread = maxP - minP || maxP * 0.001;
    minP -= spread * 0.06;
    maxP += spread * 0.06;

    const toX = i => PAD.L + (i / (data.length - 1 || 1)) * cW;
    const toY = p => PAD.T + cH - ((p - minP) / (maxP - minP)) * cH;

    // Grid + Y labels
    _ctx.setLineDash([2, 5]);
    _ctx.lineWidth = 1;
    const GRID_LINES = 5;
    for (let g = 0; g <= GRID_LINES; g++) {
      const y = PAD.T + (g / GRID_LINES) * cH;
      _ctx.strokeStyle = COLOR.grid;
      _ctx.beginPath(); _ctx.moveTo(PAD.L, y); _ctx.lineTo(W - PAD.R, y); _ctx.stroke();
      const priceAtY = maxP - (g / GRID_LINES) * (maxP - minP);
      _ctx.fillStyle   = COLOR.axisText;
      _ctx.font        = '10px Inter,sans-serif';
      _ctx.textAlign   = 'left';
      _ctx.fillText(_fmt(priceAtY), W - PAD.R + 4, y + 4);
    }
    _ctx.setLineDash([]);

    if (_type === 'line') {
      /* ---- LINE ---- */
      const pts = data.map((c, i) => ({ x: toX(i), y: toY(c.close) }));
      // Fill
      const grad = _ctx.createLinearGradient(0, PAD.T, 0, PAD.T + cH);
      grad.addColorStop(0, COLOR.lineFill[0]);
      grad.addColorStop(1, COLOR.lineFill[1]);
      _ctx.beginPath();
      _ctx.moveTo(pts[0].x, PAD.T + cH);
      pts.forEach(p => _ctx.lineTo(p.x, p.y));
      _ctx.lineTo(pts[pts.length - 1].x, PAD.T + cH);
      _ctx.closePath();
      _ctx.fillStyle = grad;
      _ctx.fill();
      // Line
      _ctx.beginPath();
      pts.forEach((p, i) => i ? _ctx.lineTo(p.x, p.y) : _ctx.moveTo(p.x, p.y));
      _ctx.strokeStyle = COLOR.line;
      _ctx.lineWidth   = 2;
      _ctx.lineJoin    = 'round';
      _ctx.stroke();
      // Dot
      const lp = pts[pts.length - 1];
      _ctx.beginPath();
      _ctx.arc(lp.x, lp.y, 3.5, 0, Math.PI * 2);
      _ctx.fillStyle = COLOR.line;
      _ctx.fill();
    } else {
      /* ---- CANDLES ---- */
      const rawW = cW / data.length;
      const bW   = Math.max(1.5, Math.min(14, rawW * 0.72));

      data.forEach((c, i) => {
        const x  = toX(i);
        const up = c.close >= c.open;
        const fillCol   = up ? COLOR.upBody   : COLOR.downBody;
        const strokeCol = up ? COLOR.up       : COLOR.down;
        const oY = toY(c.open);
        const cY = toY(c.close);
        const hY = toY(c.high);
        const lY = toY(c.low);

        // Wick
        _ctx.strokeStyle = strokeCol;
        _ctx.lineWidth   = 1;
        _ctx.beginPath(); _ctx.moveTo(x, hY); _ctx.lineTo(x, lY); _ctx.stroke();

        // Body
        const top  = Math.min(oY, cY);
        const bodyH = Math.max(1.5, Math.abs(cY - oY));
        _ctx.fillStyle   = fillCol;
        _ctx.strokeStyle = strokeCol;
        _ctx.lineWidth   = 1;
        _ctx.fillRect(x - bW / 2, top, bW, bodyH);
        _ctx.strokeRect(x - bW / 2, top, bW, bodyH);
      });
    }

    // X-axis time labels
    const labelStep = Math.max(1, Math.floor(data.length / 6));
    _ctx.fillStyle = COLOR.axisText;
    _ctx.font      = '9px Inter,sans-serif';
    _ctx.textAlign = 'center';
    for (let i = 0; i < data.length; i += labelStep) {
      const d = new Date(data[i].time * 1000);
      const lbl = `${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
      _ctx.fillText(lbl, toX(i), H - 8);
    }

    // Crosshair
    if (_crossX !== null && _crossY !== null) {
      _ctx.setLineDash([3, 4]);
      _ctx.strokeStyle = COLOR.cross;
      _ctx.lineWidth   = 1;
      _ctx.beginPath(); _ctx.moveTo(_crossX, PAD.T); _ctx.lineTo(_crossX, PAD.T + cH); _ctx.stroke();
      _ctx.beginPath(); _ctx.moveTo(PAD.L, _crossY); _ctx.lineTo(W - PAD.R, _crossY); _ctx.stroke();
      _ctx.setLineDash([]);

      // Price label on right axis
      const hp = maxP - ((_crossY - PAD.T) / cH) * (maxP - minP);
      const lh = 17;
      _ctx.fillStyle = COLOR.crossLbl;
      _ctx.fillRect(W - PAD.R + 1, _crossY - lh / 2, PAD.R - 2, lh);
      _ctx.fillStyle = '#fff';
      _ctx.font      = 'bold 9px Inter,sans-serif';
      _ctx.textAlign = 'left';
      _ctx.fillText(_fmt(hp), W - PAD.R + 4, _crossY + 3);
    }
  }

  function _fmt(p) {
    if (p >= 10000) return p.toFixed(2);
    if (p >= 100)   return p.toFixed(3);
    return p.toFixed(5);
  }

  function _attachEvents() {
    _canvas.addEventListener('mousemove', e => {
      const r = _canvas.getBoundingClientRect();
      _crossX = e.clientX - r.left;
      _crossY = e.clientY - r.top;
      _render();
    }, { passive: true });
    _canvas.addEventListener('mouseleave', () => {
      _crossX = null; _crossY = null; _render();
    });
    window.addEventListener('resize', _render, { passive: true });
  }

  return { init, setType, setCandles, pushCandle, pushTick, clear };
})();

window.NTChart = NTChart;
