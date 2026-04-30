/* ============================================================
   NovaTrade — Automated Trading Bot v1
   Strategy : Even / Odd alternating  +  Martingale
   Market   : Volatility Index only (digit contracts)
   Duration : 1 tick  —  trades on every single tick
   ============================================================ */
'use strict';

const TradingBot = (() => {

  /* ------------------------------------------------------------------ */
  /* CONSTANTS                                                            */
  /* ------------------------------------------------------------------ */
  const SYMBOLS = [
    { sym: 'R_10',     name: 'Volatility 10 Index'       },
    { sym: 'R_25',     name: 'Volatility 25 Index'       },
    { sym: 'R_50',     name: 'Volatility 50 Index'       },
    { sym: 'R_75',     name: 'Volatility 75 Index'       },
    { sym: 'R_100',    name: 'Volatility 100 Index'      },
    { sym: '1HZ10V',   name: 'Volatility 10 (1s) Index'  },
    { sym: '1HZ25V',   name: 'Volatility 25 (1s) Index'  },
    { sym: '1HZ50V',   name: 'Volatility 50 (1s) Index'  },
    { sym: '1HZ75V',   name: 'Volatility 75 (1s) Index'  },
    { sym: '1HZ100V',  name: 'Volatility 100 (1s) Index' },
  ];

  /*
     STRATEGY RECAP
     ──────────────
     Start: EVEN  @ default stake
     WIN  → keep same type  | reset stake to default
     LOSS → switch type     | double stake (martingale)
     Bot halts on Take Profit / Stop Loss / Max steps exceeded
  */

  /* ------------------------------------------------------------------ */
  /* STATE                                                                */
  /* ------------------------------------------------------------------ */
  let _running      = false;
  let _locked       = false;   // true while waiting for contract to settle
  let _contractId   = null;
  let _retryTimer   = null;

  // live session state
  let _type         = 'DIGITEVEN';
  let _stake        = 1.00;
  let _defaultStake = 1.00;
  let _consLosses   = 0;
  let _pnl          = 0.00;
  let _wins         = 0;
  let _losses       = 0;
  let _trades       = 0;
  let _highWater    = 0.00;   // peak P&L this session
  let _startTime    = null;

  // config snapshot when started
  let _cfg = { symbol:'R_100', stake:1, tp:50, sl:50, maxSteps:8 };

  /* ------------------------------------------------------------------ */
  /* DOM HELPERS                                                          */
  /* ------------------------------------------------------------------ */
  const $b  = id  => document.getElementById(id);
  const set = (id, v) => { const e = $b(id); if (e) e.textContent = v; };

  function _elapsed() {
    if (!_startTime) return '—';
    const s = Math.floor((Date.now() - _startTime) / 1000);
    const h = String(Math.floor(s / 3600)).padStart(2,'0');
    const m = String(Math.floor((s % 3600) / 60)).padStart(2,'0');
    const sc = String(s % 60).padStart(2,'0');
    return `${h}:${m}:${sc}`;
  }

  /* ------------------------------------------------------------------ */
  /* LOG PANEL                                                            */
  /* ------------------------------------------------------------------ */
  function _log(html, cls = 'info') {
    const c = $b('botLogContainer');
    if (!c) return;
    const el = document.createElement('div');
    el.className = `bll bll--${cls}`;
    el.innerHTML = `<span class="bll-ts">${new Date().toLocaleTimeString()}</span>${html}`;
    c.insertBefore(el, c.firstChild);
    while (c.children.length > 120) c.removeChild(c.lastChild);
  }

  /* ------------------------------------------------------------------ */
  /* UI UPDATE                                                            */
  /* ------------------------------------------------------------------ */
  function _ui() {
    // Stats
    const pnlEl = $b('botPnl');
    if (pnlEl) {
      pnlEl.textContent = (_pnl >= 0 ? '+' : '') + '$' + Math.abs(_pnl).toFixed(2);
      pnlEl.style.color = `var(${_pnl >= 0 ? '--green' : '--red'})`;
    }
    const hwEl = $b('botHighwater');
    if (hwEl) {
      hwEl.textContent = (_highWater >= 0 ? '+' : '') + '$' + _highWater.toFixed(2);
      hwEl.style.color = `var(${_highWater >= 0 ? '--green' : '--red'})`;
    }
    set('botWins',         _wins);
    set('botLosses',       _losses);
    set('botTotalTrades',  _trades);
    set('botConsLosses',   _consLosses);
    set('botElapsed',      _elapsed());
    set('botCurrentStake', '$' + _stake.toFixed(2));

    const wr = _trades ? ((_wins / _trades) * 100).toFixed(1) + '%' : '—';
    set('botWinRate', wr);

    // Win-rate progress bar
    const bar = $b('botWrBar');
    if (bar) bar.style.width = _trades ? ((_wins / _trades) * 100) + '%' : '0%';

    // Mode badge  
    const modeEl = $b('botModeDisplay');
    if (modeEl) {
      modeEl.className = `bot-mode-badge ${_type === 'DIGITEVEN' ? 'mode-even' : 'mode-odd'}`;
      modeEl.textContent = _type === 'DIGITEVEN' ? '⚡ EVEN' : '⚡ ODD';
    }

    // Next-trade preview
    const nxt = $b('botNextInfo');
    if (nxt) {
      nxt.innerHTML = _running
        ? `Next: <b>${_type === 'DIGITEVEN' ? 'EVEN' : 'ODD'}</b> @ <b>$${_stake.toFixed(2)}</b> ${_locked ? '<span class="bot-dot-spin">◌ waiting…</span>' : '<span class="bot-dot-ready">● ready</span>'}`
        : '—';
    }

    // TP / SL progress bars
    if (_cfg.tp > 0) {
      const tpPct = Math.min(100, Math.max(0, (_pnl / _cfg.tp) * 100));
      const slPct = Math.min(100, Math.max(0, (-_pnl / _cfg.sl) * 100));
      const tpBar = $b('botTpBar');
      const slBar = $b('botSlBar');
      if (tpBar) tpBar.style.width = tpPct + '%';
      if (slBar) slBar.style.width = slPct + '%';
      set('botTpPct', tpPct.toFixed(0) + '%');
      set('botSlPct', slPct.toFixed(0) + '%');
    }

    // Buttons
    const startBtn = $b('botStartBtn');
    const stopBtn  = $b('botStopBtn');
    if (startBtn) startBtn.disabled = _running;
    if (stopBtn)  stopBtn.disabled  = !_running;

    // Status pill
    const pill = $b('botStatusPill');
    if (pill) {
      pill.className   = `bot-pill ${_running ? 'bot-pill--running' : 'bot-pill--idle'}`;
      pill.textContent = _running ? '● Running' : '○ Idle';
    }

    // Trade count badge
    set('botTradeCount', _trades);
  }

  /* ------------------------------------------------------------------ */
  /* START / STOP                                                         */
  /* ------------------------------------------------------------------ */
  function start() {
    if (_running) return;

    // Guard: need real account
    if (window.ST && ST.token === '__demo__') {
      _log('⚠️ Bot requires a real Deriv account. Demo mode is not supported for live digit contracts.', 'warn');
      return;
    }
    if (!window.ST || !ST.token) {
      _log('⚠️ Not connected. Please log in first.', 'warn');
      return;
    }

    const stake    = parseFloat($b('botStake').value);
    const tp       = parseFloat($b('botTakeProfit').value);
    const sl       = parseFloat($b('botStopLoss').value);
    const symbol   = $b('botSymbol').value;
    const maxSteps = parseInt($b('botMaxMartingale').value) || 8;

    if (!stake || stake < 0.35)  { _log('⚠️ Minimum stake is $0.35', 'warn'); return; }
    if (!tp    || tp  <= 0)      { _log('⚠️ Take Profit must be greater than $0', 'warn'); return; }
    if (!sl    || sl  <= 0)      { _log('⚠️ Stop Loss must be greater than $0', 'warn'); return; }
    if (maxSteps < 1 || maxSteps > 15) { _log('⚠️ Max steps must be between 1 and 15', 'warn'); return; }

    _cfg = { symbol, stake, tp, sl, maxSteps };

    // Reset all state
    _running      = true;
    _locked       = false;
    _contractId   = null;
    _type         = 'DIGITEVEN';
    _stake        = stake;
    _defaultStake = stake;
    _consLosses   = 0;
    _pnl          = 0;
    _highWater    = 0;
    _wins         = 0;
    _losses       = 0;
    _trades       = 0;
    _startTime    = Date.now();
    clearTimeout(_retryTimer);

    // Clear displays
    const logC = $b('botLogContainer');
    if (logC) logC.innerHTML = '';
    const tbody = $b('botTradeTbody');
    if (tbody) tbody.innerHTML = '<tr class="empty-row"><td colspan="8">Waiting for first trade…</td></tr>';

    _ui();

    const stakeMax = (stake * Math.pow(2, maxSteps - 1)).toFixed(2);
    _log(`🚀 <b>Bot started</b> — ${symbol} | Stake: $${stake.toFixed(2)} | TP: $${tp.toFixed(2)} | SL: $${sl.toFixed(2)} | Max steps: ${maxSteps} (max single bet ≈ $${stakeMax})`, 'success');
    _log(`📋 Strategy: Start EVEN → WIN keeps type (reset stake) | LOSS switches type (martingale ×2)`, 'info');

    _nextTrade();
  }

  function stop(reason) {
    _running     = false;
    _locked      = false;
    _contractId  = null;
    clearTimeout(_retryTimer);
    DerivWS.off('proposal_open_contract', _pocHandler);
    _ui();

    const isProfit = reason && (reason.includes('Take Profit') || reason.includes('TP'));
    _log(`🛑 ${reason || 'Bot stopped manually'}`, isProfit ? 'success' : 'warn');

    if (_trades > 0) {
      _log(
        `📊 Session summary — Trades: ${_trades} | Wins: ${_wins} | Losses: ${_losses} | Win rate: ${((_wins / _trades) * 100).toFixed(1)}% | Final P&L: ${_pnl >= 0 ? '+' : ''}$${_pnl.toFixed(2)}`,
        _pnl >= 0 ? 'success' : 'error'
      );
    }
  }

  /* ------------------------------------------------------------------ */
  /* CORE: NEXT TRADE                                                     */
  /* ------------------------------------------------------------------ */
  function _nextTrade() {
    if (!_running) return;
    if (_locked)   return;

    // Safety: max martingale check
    if (_consLosses >= _cfg.maxSteps) {
      stop(`⚠️ Max martingale steps (${_cfg.maxSteps}) reached. Next stake would be $${(_stake * 2).toFixed(2)}. Bot stopped for safety.`);
      return;
    }

    _locked = true;
    _ui();

    const currency = (window.ST && ST.currency) ? ST.currency : 'USD';

    DerivWS.send({
      proposal:      1,
      amount:        _stake.toFixed(2),
      basis:         'stake',
      contract_type: _type,
      currency,
      duration:      1,
      duration_unit: 't',
      symbol:        _cfg.symbol,
    }, (propData) => {
      if (!_running) { _locked = false; _ui(); return; }

      if (propData.error) {
        _log(`⚠️ Proposal error: <b>${propData.error.message}</b> — retrying in 1.5s`, 'warn');
        _locked = false;
        _retryTimer = setTimeout(_nextTrade, 1500);
        return;
      }

      const proposal = propData.proposal;
      _addTradeRow(_trades + 1, _type, _stake);

      // Register POC handler BEFORE sending buy (avoids missing first event)
      DerivWS.on('proposal_open_contract', _pocHandler);

      DerivWS.send({ buy: String(proposal.id), price: parseFloat(_stake.toFixed(2)) }, (buyData) => {
        if (!_running) {
          DerivWS.off('proposal_open_contract', _pocHandler);
          _locked = false;
          _ui();
          return;
        }

        if (buyData.error) {
          DerivWS.off('proposal_open_contract', _pocHandler);
          _log(`⚠️ Buy error: <b>${buyData.error.message}</b> — retrying in 1s`, 'warn');
          _locked = false;
          _retryTimer = setTimeout(_nextTrade, 1000);
          return;
        }

        const bought    = buyData.buy;
        _contractId     = bought.contract_id;
        _trades++;

        const typeLabel = _type === 'DIGITEVEN'
          ? '<span class="bot-span-even">EVEN</span>'
          : '<span class="bot-span-odd">ODD</span>';

        _log(
          `#${_trades} ${typeLabel} @$${parseFloat(bought.buy_price).toFixed(2)} | payout $${parseFloat(bought.payout).toFixed(2)} | contract #${bought.contract_id}`,
          'info'
        );

        // Subscribe for live P&L and settlement
        DerivWS.send({
          proposal_open_contract: 1,
          contract_id: bought.contract_id,
          subscribe: 1,
        }, (pocData) => {
          if (!pocData || !pocData.proposal_open_contract) return;
          const poc = pocData.proposal_open_contract;
          // Immediate settlement (very rare but handle it)
          if (poc.status && poc.status !== 'open') {
            if (_contractId === poc.contract_id) {
              DerivWS.off('proposal_open_contract', _pocHandler);
              _contractId = null;
              _onSettle(poc);
            }
          }
        });

        _ui();
      });
    });
  }

  /* ------------------------------------------------------------------ */
  /* PROPOSAL_OPEN_CONTRACT STREAM HANDLER                               */
  /* ------------------------------------------------------------------ */
  function _pocHandler(d) {
    if (!d.proposal_open_contract) return;
    const poc = d.proposal_open_contract;
    if (!_contractId || poc.contract_id !== _contractId) return;

    // Live mid-contract P&L update
    if (poc.status === 'open') {
      _updateLiveRow(poc);
      return;
    }

    // Settled
    DerivWS.off('proposal_open_contract', _pocHandler);
    const cid = _contractId;
    _contractId = null;  // clear before settling to prevent double-call
    _onSettle(poc);
  }

  /* ------------------------------------------------------------------ */
  /* SETTLEMENT LOGIC                                                     */
  /* ------------------------------------------------------------------ */
  function _onSettle(poc) {
    if (!_running) return;

    _locked = false;
    const won      = poc.status === 'won';
    const tradePnl = parseFloat(poc.profit || 0);
    const digit    = _lastDigit(poc.exit_tick || poc.current_spot || '');

    _pnl += tradePnl;
    if (_pnl > _highWater) _highWater = _pnl;

    const typeLabel = _type === 'DIGITEVEN'
      ? '<span class="bot-span-even">EVEN</span>'
      : '<span class="bot-span-odd">ODD</span>';

    if (won) {
      _wins++;
      _consLosses = 0;
      const prevType = _type;
      // Keep same type, reset stake
      _stake = _defaultStake;

      _log(
        `✅ <b>WIN</b> ${typeLabel} digit=<b>${digit}</b> | ` +
        `+$${tradePnl.toFixed(2)} | Cum P&L: <b>${_pnl >= 0 ? '+' : ''}$${_pnl.toFixed(2)}</b> | ` +
        `Next: ${prevType === 'DIGITEVEN' ? '<span class="bot-span-even">EVEN</span>' : '<span class="bot-span-odd">ODD</span>'} @$${_stake.toFixed(2)}`,
        'success'
      );
    } else {
      _losses++;
      _consLosses++;
      const prevType = _type;
      const prevStake = _stake;
      // Martingale: double stake, switch type
      _stake = Math.min(_stake * 2, 50000);
      _type  = _type === 'DIGITEVEN' ? 'DIGITODD' : 'DIGITEVEN';

      const nextLabel = _type === 'DIGITEVEN'
        ? '<span class="bot-span-even">EVEN</span>'
        : '<span class="bot-span-odd">ODD</span>';

      _log(
        `❌ <b>LOSS</b> ${typeLabel} digit=<b>${digit}</b> | ` +
        `-$${Math.abs(tradePnl).toFixed(2)} | Cum P&L: <b>${_pnl >= 0 ? '+' : ''}$${_pnl.toFixed(2)}</b> | ` +
        `Switching → ${nextLabel} @$${_stake.toFixed(2)} (step ${_consLosses})`,
        'error'
      );
    }

    _finalizeRow(won, tradePnl, _pnl, digit, poc);
    _ui();

    // ── TAKE PROFIT ──
    if (_pnl >= _cfg.tp) {
      stop(`🎯 Take Profit reached! Final P&L: +$${_pnl.toFixed(2)}`);
      return;
    }
    // ── STOP LOSS ──
    if (_pnl <= -_cfg.sl) {
      stop(`💔 Stop Loss triggered. Final P&L: -$${Math.abs(_pnl).toFixed(2)}`);
      return;
    }

    // Place next trade immediately — no artificial delay, true every-tick trading
    _nextTrade();
  }

  /* ------------------------------------------------------------------ */
  /* DIGIT EXTRACTION                                                     */
  /* ------------------------------------------------------------------ */
  function _lastDigit(price) {
    if (!price) return '?';
    const s = String(parseFloat(price)); // "12345.6789"
    const clean = s.replace('.', '');   // "123456789"
    return clean[clean.length - 1] || '?';
  }

  /* ------------------------------------------------------------------ */
  /* TRADE TABLE MANAGEMENT                                               */
  /* ------------------------------------------------------------------ */
  const PENDING_ROW_ID = 'bot-pending-row';

  function _addTradeRow(num, type, stake) {
    const tbody = $b('botTradeTbody');
    if (!tbody) return;
    if (tbody.querySelector('.empty-row')) tbody.innerHTML = '';

    const evens = ['0','2','4','6','8'];
    const typeLabel = type === 'DIGITEVEN' ? 'EVEN' : 'ODD';
    const typeCls   = type === 'DIGITEVEN' ? 'bot-badge-even' : 'bot-badge-odd';

    const tr = document.createElement('tr');
    tr.id = PENDING_ROW_ID;
    tr.innerHTML = `
      <td>#${num}</td>
      <td>${new Date().toLocaleTimeString()}</td>
      <td><span class="${typeCls}">${typeLabel}</span></td>
      <td>$${stake.toFixed(2)}</td>
      <td class="bot-digit-cell">—</td>
      <td><span class="bot-status-open">⏳ Open</span></td>
      <td>—</td>
      <td>—</td>`;
    tbody.insertBefore(tr, tbody.firstChild);

    // Trim to 200 rows max
    while (tbody.children.length > 200) tbody.removeChild(tbody.lastChild);
  }

  function _updateLiveRow(poc) {
    const tr = $b(PENDING_ROW_ID);
    if (!tr) return;
    const p = parseFloat(poc.profit || 0);
    const c = tr.cells[6];
    if (!c) return;
    c.textContent = (p >= 0 ? '+' : '') + '$' + Math.abs(p).toFixed(2);
    c.style.color = `var(${p >= 0 ? '--green' : '--red'})`;
  }

  function _finalizeRow(won, tradePnl, cumPnl, digit, poc) {
    const tr = $b(PENDING_ROW_ID);
    if (!tr) return;
    tr.removeAttribute('id');

    if (tr.cells[4]) tr.cells[4].textContent = digit;
    if (tr.cells[5]) tr.cells[5].innerHTML   = won
      ? '<span class="badge-won">WIN</span>'
      : '<span class="badge-lost">LOSS</span>';
    if (tr.cells[6]) {
      tr.cells[6].textContent = (tradePnl >= 0 ? '+' : '') + '$' + Math.abs(tradePnl).toFixed(2);
      tr.cells[6].style.color = `var(${tradePnl >= 0 ? '--green' : '--red'})`;
    }
    if (tr.cells[7]) {
      tr.cells[7].textContent = (cumPnl >= 0 ? '+' : '') + '$' + Math.abs(cumPnl).toFixed(2);
      tr.cells[7].style.color = `var(${cumPnl >= 0 ? '--green' : '--red'})`;
    }
    tr.style.background = won
      ? 'rgba(38,166,154,.06)'
      : 'rgba(239,83,80,.06)';
  }

  /* ------------------------------------------------------------------ */
  /* ELAPSED TIMER (updates every second while running)                  */
  /* ------------------------------------------------------------------ */
  setInterval(() => {
    if (_running) {
      set('botElapsed', _elapsed());
      _ui();
    }
  }, 1000);

  /* ------------------------------------------------------------------ */
  /* INIT                                                                 */
  /* ------------------------------------------------------------------ */
  function init() {
    // Populate symbol selector (also pre-filled in HTML as fallback)
    const sel = $b('botSymbol');
    if (sel && sel.options.length === 0) {
      // Only write innerHTML if the select is empty (HTML fallback already populated)
      sel.innerHTML = SYMBOLS.map(s =>
        `<option value="${s.sym}"${s.sym === 'R_100' ? ' selected' : ''}>${s.name}</option>`
      ).join('');
    }

    // Attach button listeners (safe to call multiple times — addEventListener deduplicates)
    const startBtn = $b('botStartBtn');
    const stopBtn  = $b('botStopBtn');
    if (startBtn) {
      const newStart = startBtn.cloneNode(true); // remove any duplicate listeners
      startBtn.parentNode.replaceChild(newStart, startBtn);
      newStart.addEventListener('click', start);
    }
    if (stopBtn) {
      const newStop = stopBtn.cloneNode(true);
      stopBtn.parentNode.replaceChild(newStop, stopBtn);
      newStop.addEventListener('click', () => stop('Manual stop by user'));
    }

    _ui();
  }

  // Auto-init as soon as DOM is ready — bot.js loads before dashboard.js
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  return { init, start, stop };
})();

window.TradingBot = TradingBot;
