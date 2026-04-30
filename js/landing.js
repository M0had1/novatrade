/* ============================================================
   NovaTrade — Landing Page JS
   ============================================================ */

'use strict';

// ---- NAVBAR SCROLL ----
const navbar = document.getElementById('navbar');
window.addEventListener('scroll', () => {
  navbar.classList.toggle('scrolled', window.scrollY > 40);
}, { passive: true });

// ---- MOBILE MENU ----
const hamburger = document.getElementById('hamburger');
const navLinks  = document.getElementById('navLinks');
hamburger.addEventListener('click', () => {
  navLinks.classList.toggle('open');
  const isOpen = navLinks.classList.contains('open');
  hamburger.setAttribute('aria-expanded', isOpen);
  // animate spans
  const spans = hamburger.querySelectorAll('span');
  if (isOpen) {
    spans[0].style.transform = 'translateY(7px) rotate(45deg)';
    spans[1].style.opacity   = '0';
    spans[2].style.transform = 'translateY(-7px) rotate(-45deg)';
  } else {
    spans.forEach(s => { s.style.transform = ''; s.style.opacity = ''; });
  }
});
navLinks.querySelectorAll('a').forEach(a => {
  a.addEventListener('click', () => {
    navLinks.classList.remove('open');
    hamburger.querySelectorAll('span').forEach(s => { s.style.transform = ''; s.style.opacity = ''; });
  });
});

// ---- HERO CANVAS (particle net) ----
(function initHeroCanvas() {
  const canvas = document.getElementById('heroCanvas');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  let W, H, particles, animId;

  function resize() {
    W = canvas.width  = canvas.parentElement.offsetWidth;
    H = canvas.height = canvas.parentElement.offsetHeight;
    buildParticles();
  }

  function buildParticles() {
    const count = Math.min(Math.floor((W * H) / 14000), 80);
    particles = Array.from({ length: count }, () => ({
      x:  Math.random() * W,
      y:  Math.random() * H,
      vx: (Math.random() - .5) * .4,
      vy: (Math.random() - .5) * .4,
      r:  Math.random() * 1.8 + .6,
    }));
  }

  function draw() {
    ctx.clearRect(0, 0, W, H);

    // Draw gradient overlay
    const grad = ctx.createRadialGradient(W * .4, H * .5, 0, W * .4, H * .5, H * .85);
    grad.addColorStop(0,  'rgba(108,99,255,.08)');
    grad.addColorStop(.5, 'rgba(0,201,167,.04)');
    grad.addColorStop(1,  'rgba(0,0,0,0)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, W, H);

    // Connections
    for (let i = 0; i < particles.length; i++) {
      for (let j = i + 1; j < particles.length; j++) {
        const dx = particles[i].x - particles[j].x;
        const dy = particles[i].y - particles[j].y;
        const d  = Math.sqrt(dx * dx + dy * dy);
        if (d < 120) {
          ctx.beginPath();
          ctx.strokeStyle = `rgba(108,99,255,${(1 - d / 120) * .18})`;
          ctx.lineWidth = .7;
          ctx.moveTo(particles[i].x, particles[i].y);
          ctx.lineTo(particles[j].x, particles[j].y);
          ctx.stroke();
        }
      }
    }

    // Dots
    particles.forEach(p => {
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(108,99,255,.55)';
      ctx.fill();

      p.x += p.vx; p.y += p.vy;
      if (p.x < 0 || p.x > W) p.vx *= -1;
      if (p.y < 0 || p.y > H) p.vy *= -1;
    });

    animId = requestAnimationFrame(draw);
  }

  window.addEventListener('resize', () => { cancelAnimationFrame(animId); resize(); draw(); }, { passive: true });
  resize();
  draw();
})();

// ---- LIVE TICKER ----
(function initTicker() {
  const strip = document.getElementById('tickerStrip');
  if (!strip) return;

  const SYMS  = ['R_100','R_75','frxEURUSD','frxGBPUSD','frxXAUUSD','frxUSDJPY','CRASH500','BOOM500','R_50','frxAUDUSD'];
  const NAMES = { R_100:'Vol 100', R_75:'Vol 75', frxEURUSD:'EUR/USD', frxGBPUSD:'GBP/USD', frxXAUUSD:'XAU/USD', frxUSDJPY:'USD/JPY', CRASH500:'Crash 500', BOOM500:'Boom 500', R_50:'Vol 50', frxAUDUSD:'AUD/USD' };
  const prices = {};

  function render() {
    const all = [...SYMS, ...SYMS];
    strip.innerHTML = all.map(s => {
      const d    = prices[s];
      const pStr = d ? (d.p > 100 ? d.p.toFixed(2) : d.p.toFixed(5)) : '—';
      const cls  = !d ? '' : d.dir > 0 ? 't-up' : d.dir < 0 ? 't-down' : '';
      const arr  = !d ? '' : d.dir > 0 ? '▲' : d.dir < 0 ? '▼' : '';
      return `<span class="ticker-item"><span class="t-sym">${NAMES[s]||s}</span><span class="t-price ${cls}">${arr} ${pStr}</span></span>`;
    }).join('');
  }

  render();

  try {
    const ws = new WebSocket('wss://ws.binaryws.com/websockets/v3?app_id=1089');
    ws.onopen = () => SYMS.forEach((s, i) => setTimeout(() => ws.send(JSON.stringify({ ticks: s, subscribe: 1, req_id: i + 1 })), i * 60));
    ws.onmessage = e => {
      try {
        const d = JSON.parse(e.data);
        if (d.tick) {
          const sym = d.tick.symbol;
          const p   = parseFloat(d.tick.quote);
          const dir = prices[sym] ? p - prices[sym].p : 0;
          prices[sym] = { p, dir };
          render();
        }
      } catch (_) {}
    };
  } catch (_) {}
})();

// ---- SCROLL REVEAL ----
const observer = new IntersectionObserver((entries) => {
  entries.forEach(e => {
    if (e.isIntersecting) {
      e.target.style.opacity = '1';
      e.target.style.transform = 'translateY(0)';
      observer.unobserve(e.target);
    }
  });
}, { threshold: .12 });

document.querySelectorAll('.feature-card, .market-card, .pricing-card').forEach(el => {
  el.style.opacity = '0';
  el.style.transform = 'translateY(24px)';
  el.style.transition = 'opacity .5s ease, transform .5s ease';
  observer.observe(el);
});
