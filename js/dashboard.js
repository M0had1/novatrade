/* ============================================================
   NovaTrade — Dashboard Controller v3
   Full live trading — real Deriv data, real contracts
   ============================================================ */
'use strict';

/* ============================================================
   STATE
   ============================================================ */
const ST = {
  token:         null,
  account:       null,
  currency:      'USD',
  balance:        0,

  symbol:        'R_100',
  granularity:   300,
  chartType:     'candle',

  candleSubId:   null,     // ohlc subscription id
  tickSubId:     null,     // tick subscription id

  proposalSubId: null,     // current payout proposal sub
  proposalId:    null,     // proposal id for buy

  openContracts: {},       // contractId -> row data
  history:       [],
  stats:         { total: 0, won: 0, lost: 0, pnl: 0 },

  lastPrice:     null,
  lastPricePrev: null,
};

/* ============================================================
   DOM HELPERS
   ============================================================ */
const $  = id => document.getElementById(id);
const $$ = sel => document.querySelectorAll(sel);

function toast(msg, type = 'info', duration = 4000) {
  const tc = $('toastContainer');
  if (!tc) return;
  const el = document.createElement('div');
  el.className = `toast toast-${type}`;
  el.innerHTML = msg;
  tc.appendChild(el);
  requestAnimationFrame(() => el.classList.add('visible'));
  setTimeout(() => {
    el.style.opacity   = '0';
    el.style.transform = 'translateX(24px)';
    el.style.transition = 'opacity .3s, transform .3s';
    setTimeout(() => el.remove(), 320);
  }, duration);
}

function fmtPrice(p, sym) {
  const v = parseFloat(p);
  if (isNaN(v)) return '—';
  return v > 99 ? v.toFixed(2) : v.toFixed(sym && sym.startsWith('frx') ? 5 : 2);
}

function fmtMoney(amount, currency) {
  return `${currency || ST.currency} ${parseFloat(amount || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function setBalanceEl(amount, currency) {
  ST.balance  = parseFloat(amount);
  ST.currency = currency || ST.currency;
  const fmt   = fmtMoney(amount, currency);
  const el    = $('balanceDisplay');
  if (el) el.textContent = fmt;
  const pb = $('portfolioBalance');
  if (pb) pb.textContent = fmt;
}

/* ============================================================
   AUTH GATE
   ============================================================ */
const authGate  = $('authGate');
const dashWrap  = $('dashLayout');

function showAuthErr(msg) {
  const el = $('authError');
  if (!el) return;
  el.textContent = msg;
  el.classList.add('visible');
}
function clearAuthErr() {
  const el = $('authError');
  if (el) el.classList.remove('visible');
}

// Toggle token visibility
$('toggleVis').addEventListener('click', () => {
  const inp = $('apiTokenInput');
  inp.type  = inp.type === 'password' ? 'text' : 'password';
});

// Enter key on input
$('apiTokenInput').addEventListener('keydown', e => {
  if (e.key === 'Enter') $('connectBtn').click();
});

/* ---- CONNECT ---- */
$('connectBtn').addEventListener('click', async () => {
  const token = $('apiTokenInput').value.trim();
  clearAuthErr();
  if (!token) { showAuthErr('Please enter your Deriv API token.'); return; }

  const btn = $('connectBtn');
  btn.disabled    = true;
  btn.textContent = 'Connecting…';

  try {
    console.log('[NT] Connecting WebSocket…');
    await DerivWS.connect();
    console.log('[NT] Socket open. Authorising…');
    btn.textContent = 'Authenticating…';

    const acct = await DerivWS.authorise(token);
    console.log('[NT] Authorised:', acct.loginid, acct.currency);

    ST.token   = token;
    ST.account = acct;
    _enterDashboard();

  } catch (err) {
    console.error('[NT] Auth error:', err);
    showAuthErr(err.message || 'Authentication failed. Check your token and try again.');
  } finally {
    btn.disabled    = false;
    btn.textContent = 'Connect & Enter Platform';
    btn.innerHTML   = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4M10 17l5-5-5-5M13 12H3"/></svg> Connect &amp; Enter Platform`;
  }
});

/* ---- DEMO ---- */
$('demoBtn').addEventListener('click', async () => {
  clearAuthErr();
  const btn     = $('demoBtn');
  btn.disabled    = true;
  btn.textContent = 'Connecting…';

  try {
    await DerivWS.connect();
    // Authorise with Deriv's public virtual account token
    // We use a real WS connection with no auth — ticks work, trading is simulated
    ST.token   = '__demo__';
    ST.account = {
      loginid:    'DEMO',
      fullname:   'Demo Trader',
      email:      '',
      country:    '',
      currency:   'USD',
      balance:    10000,
      is_virtual: 1,
    };
    _enterDashboard();
  } catch (err) {
    showAuthErr('Could not reach Deriv servers. Check your internet connection.');
  } finally {
    btn.disabled    = false;
    btn.textContent = 'Use Demo Account';
  }
});

/* ---- LOGOUT ---- */
$('logoutBtn').addEventListener('click', () => {
  DerivWS.disconnect();
  _teardownSubs();
  dashWrap.style.display  = 'none';
  authGate.style.display  = 'flex';
  $('apiTokenInput').value = '';
  Object.assign(ST, {
    token: null, account: null, balance: 0,
    openContracts: {}, history: [],
    stats: { total: 0, won: 0, lost: 0, pnl: 0 },
    lastPrice: null, lastPricePrev: null,
    candleSubId: null, tickSubId: null,
    proposalSubId: null, proposalId: null,
  });
  clearAuthErr();
  toast('Disconnected.', 'info');
});

/* ============================================================
   ENTER DASHBOARD
   ============================================================ */
function _enterDashboard() {
  authGate.style.display   = 'none';
  dashWrap.style.display   = 'grid';

  const a    = ST.account;
  const name = a.fullname || a.loginid || 'Trader';

  $('accountName').textContent   = name;
  $('accountType').textContent   = a.is_virtual ? '🟡 Demo' : '🟢 Real';
  $('accountAvatar').textContent = (name[0] || 'T').toUpperCase();

  // Portfolio info
  $('detailLoginId').textContent  = a.loginid  || '—';
  $('detailCurrency').textContent = a.currency || 'USD';
  $('detailType').textContent     = a.is_virtual ? 'Virtual / Demo' : 'Real Money';
  $('detailCountry').textContent  = a.country  || '—';
  $('detailEmail').textContent    = a.email    || '—';

  if (ST.token !== '__demo__') {
    // Subscribe to live balance
    DerivWS.getBalance((d) => {
      if (d.balance) setBalanceEl(d.balance.balance, d.balance.currency);
    });
    DerivWS.on('balance', (d) => {
      if (d.balance) setBalanceEl(d.balance.balance, d.balance.currency);
    });
    // Load existing open contracts
    DerivWS.getOpenContracts(_onPortfolioLoad);
    // Load history
    _loadHistory();
    toast(`Welcome back, ${name}! 🚀`, 'success');
  } else {
    setBalanceEl(10000, 'USD');
    toast('Demo mode — live market data, simulated trades', 'info', 5000);
  }

  // Init chart (works for both real & demo)
  _initChart();
  _loadWatchlist();
  _setupOrderForm();
}

/* ============================================================
   CHART
   ============================================================ */
function _initChart() {
  NTChart.init($('priceChart'));
  _loadChartData();

  // Symbol change
  $('symbolSelect').addEventListener('change', () => {
    ST.symbol = $('symbolSelect').value;
    ST.lastPrice = null; ST.lastPricePrev = null;
    _priceDisplay('—', null);
    NTChart.clear();
    _teardownSubs();
    _loadChartData();
    _refreshProposal();
  });

  // Granularity change
  $('granularitySelect').addEventListener('change', () => {
    ST.granularity = parseInt($('granularitySelect').value);
    NTChart.clear();
    if (ST.candleSubId) { DerivWS.forget(ST.candleSubId); ST.candleSubId = null; }
    _loadChartData();
  });

  // Chart type toggle
  $$('.chart-type-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      $$('.chart-type-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      ST.chartType = btn.dataset.type;
      NTChart.setType(ST.chartType);
    });
  });

  // Persistent listeners
  DerivWS.on('ohlc', d => {
    if (d.ohlc && d.ohlc.symbol === ST.symbol) NTChart.pushCandle(d.ohlc);
  });
  DerivWS.on('tick', d => {
    if (d.tick && d.tick.symbol === ST.symbol) _onTick(d.tick);
  });
}

function _loadChartData() {
  const loading = $('chartLoading');
  if (loading) loading.classList.remove('hidden');

  // Cancel previous candle sub
  if (ST.candleSubId) { DerivWS.forget(ST.candleSubId); ST.candleSubId = null; }
  if (ST.tickSubId)   { DerivWS.forget(ST.tickSubId);   ST.tickSubId   = null; }

  // Subscribe ticks (price display + line chart fallback)
  DerivWS.subscribeTicks(ST.symbol, d => {
    if (d.subscription) ST.tickSubId = d.subscription.id;
    if (d.tick) _onTick(d.tick);
    if (d.error) console.warn('[NT] tick subscribe error:', d.error.message);
  });

  // Request candle history + subscribe
  DerivWS.getCandles(ST.symbol, ST.granularity, 200, d => {
    if (loading) loading.classList.add('hidden');
    if (d.error) {
      console.warn('[NT] candles error:', d.error.message, '— using line chart');
      ST.chartType = 'line';
      $$('.chart-type-btn').forEach(b => b.classList.toggle('active', b.dataset.type === 'line'));
      NTChart.setType('line');
      return;
    }
    if (d.candles && d.candles.length) {
      NTChart.setCandles(d.candles);
      NTChart.setType(ST.chartType);
    }
    if (d.subscription) ST.candleSubId = d.subscription.id;
  });
}

function _onTick(tick) {
  const p = parseFloat(tick.quote);
  if (isNaN(p)) return;
  ST.lastPricePrev = ST.lastPrice;
  ST.lastPrice     = p;
  _priceDisplay(p, ST.lastPricePrev);
  NTChart.pushTick(tick);
  // Update watchlist cell for this symbol
  _updateWatchlistCell(tick.symbol, p);
}

function _priceDisplay(price, prev) {
  const el  = $('priceValue');
  const chg = $('priceChange');
  if (!el) return;
  if (price === '—') { el.textContent = '—'; if (chg) chg.textContent = ''; return; }
  el.textContent = fmtPrice(price, ST.symbol);
  if (chg && prev !== null && prev !== undefined) {
    const dp    = price - prev;
    const dpPct = prev ? ((dp / prev) * 100).toFixed(3) : '0.000';
    chg.textContent = `${dp >= 0 ? '+' : ''}${dpPct}%`;
    chg.className   = `price-change ${dp >= 0 ? 'up' : 'down'}`;
  }
}

function _teardownSubs() {
  if (ST.candleSubId)   { DerivWS.forget(ST.candleSubId);   ST.candleSubId   = null; }
  if (ST.tickSubId)     { DerivWS.forget(ST.tickSubId);     ST.tickSubId     = null; }
  if (ST.proposalSubId) { DerivWS.forget(ST.proposalSubId); ST.proposalSubId = null; }
}

/* ============================================================
   ORDER FORM — LIVE PROPOSALS
   ============================================================ */
let _proposalDebounce = null;

function _setupOrderForm() {
  // Quick stake buttons
  $$('.quick-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      $('stakeInput').value = btn.dataset.val;
      _refreshProposal();
    });
  });

  // Contract type tabs
  $$('.ct-tab').forEach(btn => {
    btn.addEventListener('click', () => {
      $$('.ct-tab').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      _refreshProposal();
    });
  });

  // Input changes
  ['stakeInput', 'durationInput', 'durationUnit'].forEach(id => {
    $(id).addEventListener('input', () => {
      clearTimeout(_proposalDebounce);
      _proposalDebounce = setTimeout(_refreshProposal, 500);
    });
  });

  // Trade buttons
  $('riseBtn').addEventListener('click', () => _placeTrade('CALL'));
  $('fallBtn').addEventListener('click', () => _placeTrade('PUT'));

  _refreshProposal();
}

function _getOrderParams() {
  const ctTab   = document.querySelector('.ct-tab.active');
  const ct      = ctTab ? ctTab.dataset.ct : 'rise_fall';
  const stake   = parseFloat($('stakeInput').value) || 1;
  const dur     = parseInt($('durationInput').value) || 5;
  const unit    = $('durationUnit').value || 'm';
  return { ct, stake, dur, unit };
}

function _refreshProposal() {
  if (ST.token === '__demo__') {
    // Estimate locally for demo
    const { stake } = _getOrderParams();
    $('payoutAmt').textContent  = `$${(stake * 1.87).toFixed(2)}`;
    $('profitAmt').textContent  = `+$${(stake * 0.87).toFixed(2)}`;
    return;
  }

  // Cancel previous proposal subscription
  if (ST.proposalSubId) {
    DerivWS.forget(ST.proposalSubId);
    ST.proposalSubId = null;
    ST.proposalId    = null;
  }

  const { stake, dur, unit } = _getOrderParams();
  if (stake < 0.35 || !ST.symbol) return;

  // Get live proposal for CALL — payout is same for PUT
  DerivWS.getProposal({
    symbol:        ST.symbol,
    amount:        stake,
    contract_type: 'CALL',
    duration:      dur,
    duration_unit: unit,
    currency:      ST.currency,
  }, (d) => {
    if (d.subscription) ST.proposalSubId = d.subscription.id;
    if (d.error) {
      $('payoutAmt').textContent = 'N/A';
      $('profitAmt').textContent = 'N/A';
      $('profitAmt').style.color = 'var(--text-muted)';
      return;
    }
    if (d.proposal) _updatePayoutDisplay(d.proposal);
  });

  // Live payout updates from proposal subscription
  DerivWS.on('proposal', (d) => {
    if (d.proposal && d.subscription && d.subscription.id === ST.proposalSubId) {
      _updatePayoutDisplay(d.proposal);
    }
  });
}

function _updatePayoutDisplay(proposal) {
  ST.proposalId = proposal.id;
  const payout  = parseFloat(proposal.payout);
  const stake   = parseFloat(proposal.ask_price);
  const profit  = payout - stake;
  $('payoutAmt').textContent  = `$${payout.toFixed(2)}`;
  $('profitAmt').textContent  = `+$${profit.toFixed(2)}`;
  $('profitAmt').style.color  = profit > 0 ? 'var(--green)' : 'var(--red)';
}

/* ============================================================
   PLACE TRADE
   ============================================================ */
function _setTradeStatus(msg, type) {
  const el = $('tradeResult');
  if (!el) return;
  el.innerHTML  = msg;
  el.className  = `trade-result ${type}`;
  clearTimeout(el._t);
  if (type !== 'info' || msg.includes('⏳')) return; // keep loading
  el._t = setTimeout(() => { el.className = 'trade-result'; }, 8000);
}

function _placeTrade(contractType) {
  if (ST.token === '__demo__') { _placeDemoTrade(contractType); return; }

  const { stake, dur, unit } = _getOrderParams();
  if (stake < 0.35) { _setTradeStatus('Minimum stake is $0.35.', 'error'); return; }

  $('riseBtn').disabled = true;
  $('fallBtn').disabled = true;
  _setTradeStatus('⏳ Submitting contract…', 'info');

  const doBuy = (proposalId) => {
    DerivWS.buyProposal(proposalId, stake, (d) => {
      $('riseBtn').disabled = false;
      $('fallBtn').disabled = false;

      if (d.error) {
        _setTradeStatus(`❌ ${d.error.message}`, 'error');
        toast(`Trade failed: ${d.error.message}`, 'error');
        return;
      }

      const bought = d.buy;
      const label  = contractType === 'CALL' ? '▲ Rise' : '▼ Fall';
      _setTradeStatus(`✅ ${label} #${bought.contract_id} — Stake $${parseFloat(bought.buy_price).toFixed(2)} | Payout $${parseFloat(bought.payout).toFixed(2)}`, 'success');
      toast(`${label} placed — Contract #${bought.contract_id}`, 'success');

      _addOpenContract({
        contract_id:   bought.contract_id,
        underlying:    bought.underlying_symbol || ST.symbol,
        contract_type: contractType,
        buy_price:     bought.buy_price,
        payout:        bought.payout,
        profit:        null,
        status:        'open',
      });

      // Live P&L tracking
      DerivWS.subscribeContract(bought.contract_id, (u) => {
        if (u.proposal_open_contract) _onContractUpdate(u.proposal_open_contract);
      });
      DerivWS.on('proposal_open_contract', (u) => {
        if (u.proposal_open_contract && u.proposal_open_contract.contract_id === bought.contract_id) {
          _onContractUpdate(u.proposal_open_contract);
        }
      });

      // Get fresh proposal for next trade
      ST.proposalSubId = null;
      ST.proposalId    = null;
      _refreshProposal();
    });
  };

  // Use existing proposal id if available, else get fresh one
  if (ST.proposalId) {
    doBuy(ST.proposalId);
  } else {
    DerivWS.getProposal({
      symbol:        ST.symbol,
      amount:        stake,
      contract_type: contractType,
      duration:      dur,
      duration_unit: unit,
      currency:      ST.currency,
    }, (d) => {
      if (d.error) {
        $('riseBtn').disabled = false;
        $('fallBtn').disabled = false;
        _setTradeStatus(`❌ ${d.error.message}`, 'error');
        return;
      }
      doBuy(d.proposal.id);
    });
  }
}

function _placeDemoTrade(contractType) {
  const { stake, dur, unit } = _getOrderParams();
  if (stake < 0.35) { _setTradeStatus('Minimum stake is $0.35.', 'error'); return; }

  const fakeId = 'D' + Date.now();
  const payout = +(stake * 1.87).toFixed(2);
  const label  = contractType === 'CALL' ? '▲ Rise' : '▼ Fall';
  _setTradeStatus(`✅ Demo ${label} #${fakeId} — Stake $${stake.toFixed(2)} | Payout $${payout}`, 'success');
  toast(`Demo ${label} placed`, 'info');
  _addOpenContract({ contract_id: fakeId, underlying: ST.symbol, contract_type: contractType, buy_price: stake, payout, profit: null, status: 'open' });

  // Simulate settlement after duration
  const durationMs = unit === 't' ? dur * 2000 : unit === 's' ? dur * 1000 : unit === 'm' ? dur * 60000 : unit === 'h' ? dur * 3600000 : dur * 86400000;
  setTimeout(() => {
    const won   = Math.random() > 0.5;
    const pl    = won ? +(payout - stake).toFixed(2) : -stake;
    _onContractUpdate({ contract_id: fakeId, status: won ? 'won' : 'lost', profit: pl, payout: won ? payout : 0, underlying_symbol: ST.symbol, contract_type: contractType, buy_price: stake, date_settlement: Date.now() / 1000 });
    setBalanceEl(ST.balance + pl, ST.currency);
  }, Math.min(durationMs, 30000));
}

/* ============================================================
   OPEN CONTRACTS
   ============================================================ */
function _addOpenContract(c) {
  ST.openContracts[c.contract_id] = c;
  _renderOpenContracts();
}

function _onContractUpdate(c) {
  const id = c.contract_id;
  if (!ST.openContracts[id]) return;

  ST.openContracts[id] = { ...ST.openContracts[id], profit: c.profit, payout: c.payout, status: c.status };
  _renderOpenContracts();

  if (['won', 'lost', 'sold'].includes(c.status)) {
    const row = {
      time:   new Date((c.date_settlement || Date.now() / 1000) * 1000).toLocaleString(),
      symbol: c.underlying_symbol || c.underlying || ST.symbol,
      type:   c.contract_type,
      stake:  c.buy_price,
      payout: c.payout || 0,
      pnl:    parseFloat(c.profit || 0),
      result: c.status,
    };
    ST.history.unshift(row);
    _updateStats(row);
    delete ST.openContracts[id];
    _renderOpenContracts();
    _renderHistory(ST.history);

    const won = c.status === 'won';
    toast(
      `${won ? '🎉' : '❌'} Contract #${id} ${c.status.toUpperCase()} — ${won ? '+' : ''}$${parseFloat(c.profit || 0).toFixed(2)}`,
      won ? 'success' : 'error',
      6000
    );
  }
}

function _renderOpenContracts() {
  const tbody = $('openContractsTbody');
  const list  = Object.values(ST.openContracts);
  const badge = $('openContractsBadge');
  if (badge) badge.textContent = list.length;
  if (!tbody) return;

  if (!list.length) {
    tbody.innerHTML = '<tr class="empty-row"><td colspan="7">No open contracts — place a trade above.</td></tr>';
    return;
  }

  tbody.innerHTML = list.map(c => {
    const pnl     = parseFloat(c.profit);
    const pnlStr  = isNaN(pnl) ? '—' : `${pnl >= 0 ? '+' : ''}$${Math.abs(pnl).toFixed(2)}`;
    const pnlStyle = isNaN(pnl) ? '' : `style="color:var(${pnl >= 0 ? '--green' : '--red'});font-weight:600"`;
    const ct       = c.contract_type === 'CALL' ? '▲ Rise' : c.contract_type === 'PUT' ? '▼ Fall' : c.contract_type;
    return `<tr>
      <td>#${c.contract_id}</td>
      <td>${c.underlying}</td>
      <td>${ct}</td>
      <td>$${parseFloat(c.buy_price).toFixed(2)}</td>
      <td>$${parseFloat(c.payout).toFixed(2)}</td>
      <td ${pnlStyle}>${pnlStr}</td>
      <td><span class="badge-open">Open</span></td>
    </tr>`;
  }).join('');
}

/* ============================================================
   PORTFOLIO LOAD (existing contracts on login)
   ============================================================ */
function _onPortfolioLoad(d) {
  if (d.error || !d.portfolio) return;
  (d.portfolio.contracts || []).forEach(c => {
    _addOpenContract({
      contract_id:   c.contract_id,
      underlying:    c.underlying_symbol,
      contract_type: c.contract_type,
      buy_price:     c.buy_price,
      payout:        c.payout,
      profit:        c.profit || null,
      status:        'open',
    });
    // Subscribe for live P&L
    DerivWS.subscribeContract(c.contract_id, u => {
      if (u.proposal_open_contract) _onContractUpdate(u.proposal_open_contract);
    });
  });
}

/* ============================================================
   HISTORY
   ============================================================ */
function _loadHistory() {
  if (ST.token === '__demo__') { _renderHistory([]); return; }
  DerivWS.getStatement(d => {
    if (d.error || !d.profit_table) return;
    const rows = (d.profit_table.transactions || []).map(t => ({
      time:   new Date(t.purchase_time * 1000).toLocaleString(),
      symbol: (t.shortcode || '').split('_').slice(0, 2).join('_') || '—',
      type:   t.shortcode || '—',
      stake:  t.buy_price  || 0,
      payout: t.sell_price || 0,
      pnl:    +(parseFloat(t.sell_price || 0) - parseFloat(t.buy_price || 0)).toFixed(2),
      result: parseFloat(t.sell_price || 0) >= parseFloat(t.buy_price || 0) ? 'won' : 'lost',
    }));
    ST.history = rows;
    _renderHistory(rows);
    // Compute stats
    let won = 0, lost = 0, pnl = 0;
    rows.forEach(r => { if (r.pnl > 0) won++; else lost++; pnl += r.pnl; });
    ST.stats = { total: rows.length, won, lost, pnl };
    _renderStats();
  });
}

function _renderHistory(rows) {
  const tbody = $('historyTbody');
  if (!tbody) return;
  if (!rows.length) {
    tbody.innerHTML = '<tr class="empty-row"><td colspan="7">No trade history yet.</td></tr>';
    return;
  }
  tbody.innerHTML = rows.slice(0, 100).map(r => {
    const pnl   = parseFloat(r.pnl);
    const pstyle = `style="color:var(${pnl >= 0 ? '--green' : '--red'});font-weight:600"`;
    const badge  = r.result === 'won' ? 'badge-won' : 'badge-lost';
    const typeShort = (r.type || '').length > 30 ? r.type.slice(0, 28) + '…' : r.type;
    return `<tr>
      <td>${r.time}</td>
      <td>${r.symbol}</td>
      <td title="${r.type}">${typeShort}</td>
      <td>$${parseFloat(r.stake).toFixed(2)}</td>
      <td>$${parseFloat(r.payout).toFixed(2)}</td>
      <td ${pstyle}>${pnl >= 0 ? '+' : ''}$${Math.abs(pnl).toFixed(2)}</td>
      <td><span class="${badge}">${r.result.charAt(0).toUpperCase() + r.result.slice(1)}</span></td>
    </tr>`;
  }).join('');
}

$('refreshHistory').addEventListener('click', _loadHistory);

function _updateStats(row) {
  const p = parseFloat(row.pnl);
  ST.stats.total++;
  if (p > 0) ST.stats.won++; else ST.stats.lost++;
  ST.stats.pnl += p;
  _renderStats();
}

function _renderStats() {
  const { total, won, lost, pnl } = ST.stats;
  const set = (id, v) => { const el = $(id); if (el) el.textContent = v; };
  set('totalTrades', total);
  set('tradesWon',   won);
  set('tradesLost',  lost);
  set('winRate',     total ? ((won / total) * 100).toFixed(1) + '%' : '—');
  const np = $('netPnl');
  if (np) {
    np.textContent = `${pnl >= 0 ? '+' : '-'}$${Math.abs(pnl).toFixed(2)}`;
    np.style.color = `var(${pnl >= 0 ? '--green' : '--red'})`;
  }
}

/* ============================================================
   MARKET WATCHLIST — live ticks
   ============================================================ */
const WATCHLIST = [
  { sym: 'R_100',     name: 'Volatility 100 Index',    cat: 'Synthetics' },
  { sym: 'R_75',      name: 'Volatility 75 Index',     cat: 'Synthetics' },
  { sym: 'R_50',      name: 'Volatility 50 Index',     cat: 'Synthetics' },
  { sym: 'R_25',      name: 'Volatility 25 Index',     cat: 'Synthetics' },
  { sym: 'R_10',      name: 'Volatility 10 Index',     cat: 'Synthetics' },
  { sym: 'CRASH500',  name: 'Crash 500 Index',         cat: 'Synthetics' },
  { sym: 'BOOM500',   name: 'Boom 500 Index',          cat: 'Synthetics' },
  { sym: 'CRASH1000', name: 'Crash 1000 Index',        cat: 'Synthetics' },
  { sym: 'BOOM1000',  name: 'Boom 1000 Index',         cat: 'Synthetics' },
  { sym: 'stpRNG',    name: 'Step Index',              cat: 'Synthetics' },
  { sym: 'frxEURUSD', name: 'EUR / USD',               cat: 'Forex' },
  { sym: 'frxGBPUSD', name: 'GBP / USD',               cat: 'Forex' },
  { sym: 'frxUSDJPY', name: 'USD / JPY',               cat: 'Forex' },
  { sym: 'frxAUDUSD', name: 'AUD / USD',               cat: 'Forex' },
  { sym: 'frxUSDCAD', name: 'USD / CAD',               cat: 'Forex' },
  { sym: 'frxXAUUSD', name: 'Gold / USD',              cat: 'Commodities' },
  { sym: 'frxXAGUSD', name: 'Silver / USD',            cat: 'Commodities' },
];

const _wlPrices = {}; // sym -> { price, prev, direction }

function _loadWatchlist() {
  WATCHLIST.forEach(s => {
    _wlPrices[s.sym] = { price: null, prev: null, dir: 0 };
    DerivWS.subscribeTicks(s.sym, () => {});
  });

  DerivWS.on('tick', d => {
    if (!d.tick) return;
    const sym = d.tick.symbol;
    if (!_wlPrices[sym]) return;
    _wlPrices[sym].prev  = _wlPrices[sym].price;
    _wlPrices[sym].price = parseFloat(d.tick.quote);
    _wlPrices[sym].dir   = _wlPrices[sym].prev !== null ? (_wlPrices[sym].price - _wlPrices[sym].prev) : 0;
  });

  _renderWatchlist('');
  $('marketSearch').addEventListener('input', e => _renderWatchlist(e.target.value.toLowerCase().trim()));

  // Re-render every second for smooth updates
  setInterval(() => {
    const q = $('marketSearch').value.toLowerCase().trim();
    _renderWatchlist(q);
  }, 1000);
}

function _updateWatchlistCell(sym) {
  // Handled by interval re-render
}

function _renderWatchlist(filter) {
  const container = $('marketsWatchlist');
  if (!container) return;

  const filtered = WATCHLIST.filter(s =>
    !filter || s.name.toLowerCase().includes(filter) || s.sym.toLowerCase().includes(filter) || s.cat.toLowerCase().includes(filter)
  );

  if (!filtered.length) {
    container.innerHTML = '<div class="watchlist-empty">No symbols match your search.</div>';
    return;
  }

  // Group by category
  const cats = {};
  filtered.forEach(s => { if (!cats[s.cat]) cats[s.cat] = []; cats[s.cat].push(s); });

  let html = '';
  for (const [cat, syms] of Object.entries(cats)) {
    html += `<div class="wl-cat-label">${cat}</div>`;
    syms.forEach(s => {
      const d      = _wlPrices[s.sym];
      const p      = d ? d.price : null;
      const prev   = d ? d.prev  : null;
      const dp     = p !== null && prev !== null ? p - prev : 0;
      const dpPct  = prev ? ((dp / prev) * 100).toFixed(3) : '—';
      const pStr   = p !== null ? fmtPrice(p, s.sym) : '—';
      const cls    = dp > 0 ? 'wi-up' : dp < 0 ? 'wi-down' : '';
      const arrow  = dp > 0 ? '▲' : dp < 0 ? '▼' : '●';
      const isActive = s.sym === ST.symbol ? ' wl-active' : '';
      html += `<div class="watchlist-item${isActive}" data-sym="${s.sym}">
        <div class="wl-left">
          <div class="wi-symbol">${s.sym}</div>
          <div class="wi-name">${s.name}</div>
        </div>
        <div class="wl-right">
          <div class="wi-price ${cls}">${pStr}</div>
          <div class="wi-change ${cls}">${arrow} ${dpPct}%</div>
        </div>
      </div>`;
    });
  }

  container.innerHTML = html;

  container.querySelectorAll('.watchlist-item').forEach(el => {
    el.addEventListener('click', () => {
      const sym = el.dataset.sym;
      $('symbolSelect').value = sym;
      ST.symbol = sym;
      ST.lastPrice = null; ST.lastPricePrev = null;
      _priceDisplay('—', null);
      NTChart.clear();
      _teardownSubs();
      _loadChartData();
      _refreshProposal();
      // Switch to Trade tab
      _switchTab('trade');
    });
  });
}

/* ============================================================
   TABS
   ============================================================ */
function _switchTab(tabName) {
  $$('.sidebar-link[data-tab]').forEach(l => l.classList.remove('active'));
  const link = document.querySelector(`.sidebar-link[data-tab="${tabName}"]`);
  if (link) link.classList.add('active');
  $$('.tab-content').forEach(t => t.classList.remove('active'));
  const tab = $(`tab-${tabName}`);
  if (tab) tab.classList.add('active');
}

$$('.sidebar-link[data-tab]').forEach(link => {
  link.addEventListener('click', e => {
    e.preventDefault();
    const tab = link.dataset.tab;
    _switchTab(tab);
    if (tab === 'history')   _loadHistory();
    if (tab === 'portfolio') _renderStats();
  });
});

// Mobile sidebar toggle
$('sidebarToggle').addEventListener('click', () => $('sidebar').classList.toggle('open'));

// dashboard.js loaded — no landing-page ticker code here.
