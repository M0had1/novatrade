/* ============================================================
   NovaTrade — Dashboard Controller
   ============================================================ */

'use strict';

// ---- STATE ----
const State = {
  token:       null,
  account:     null,
  balance:     null,
  currency:    'USD',
  symbol:      'R_100',
  chartType:   'candle',
  granularity: 300,
  contracts:   {},
  history:     [],
  stats:       { total: 0, won: 0, lost: 0, netPnl: 0 },
  tickSubs:    {},    // symbol -> req_id for forget
  candleSub:   null,
};

// ---- DOM REFS ----
const $  = id => document.getElementById(id);
const authGate    = $('authGate');
const dashLayout  = $('dashLayout');
const authError   = $('authError');
const connectBtn  = $('connectBtn');
const demoBtn     = $('demoBtn');
const tokenInput  = $('apiTokenInput');
const toggleVis   = $('toggleVis');
const logoutBtn   = $('logoutBtn');
const balancePill = $('balanceDisplay');
const sidebarEl   = $('sidebar');
const sidebarTog  = $('sidebarToggle');
const symbolSel   = $('symbolSelect');
const granSel     = $('granularitySelect');
const stakeInput  = $('stakeInput');
const durInput    = $('durationInput');
const durUnit     = $('durationUnit');
const riseBtn     = $('riseBtn');
const fallBtn     = $('fallBtn');
const tradeRes    = $('tradeResult');
const payoutAmt   = $('payoutAmt');
const profitAmt   = $('profitAmt');
const priceVal    = $('priceValue');
const priceChg    = $('priceChange');
const chartLoad   = $('chartLoading');

// ---- TOAST ----
function toast(msg, type = 'info') {
  const tc = $('toastContainer');
  const el = document.createElement('div');
  el.className = `toast toast-${type}`;
  el.textContent = msg;
  tc.appendChild(el);
  setTimeout(() => {
    el.style.cssText = 'opacity:0;transform:translateX(20px);transition:all .3s';
    setTimeout(() => el.remove(), 320);
  }, 3500);
}

// ---- AUTH ERROR ----
function showAuthError(msg) {
  authError.textContent = msg;
  authError.classList.add('visible');
}
function clearAuthError() {
  authError.classList.remove('visible');
}

// ---- TOGGLE PASSWORD VISIBILITY ----
toggleVis.addEventListener('click', () => {
  tokenInput.type = tokenInput.type === 'password' ? 'text' : 'password';
});

// ---- CONNECT BUTTON ----
connectBtn.addEventListener('click', async () => {
  const t = tokenInput.value.trim();
  clearAuthError();

  if (!t) { showAuthError('Please enter your Deriv API token.'); return; }

  // Lock UI
  connectBtn.disabled = true;
  connectBtn.textContent = 'Connecting…';

  try {
    // Step 1 — open WebSocket
    await DerivWS.connect();

    // Step 2 — authorise
    connectBtn.textContent = 'Authenticating…';
    const account = await DerivWS.authorise(t);

    // Step 3 — success
    State.token   = t;
    State.account = account;
    enterDashboard(false);

  } catch (err) {
    showAuthError(err.message || 'Authentication failed. Please check your token and try again.');
  } finally {
    connectBtn.disabled = false;
    connectBtn.innerHTML = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4M10 17l5-5-5-5M13 12H3"/></svg> Connect &amp; Enter Platform`;
  }
});

// Allow Enter key in token input
tokenInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') connectBtn.click();
});

// ---- DEMO BUTTON ----
demoBtn.addEventListener('click', async () => {
  clearAuthError();
  demoBtn.disabled    = true;
  demoBtn.textContent = 'Loading demo…';

  try {
    await DerivWS.connect();
    // Demo mode: real ticks, simulated trading
    State.token   = '__demo__';
    State.account = {
      loginid:      'DEMO001',
      fullname:     'Demo Trader',
      email:        'demo@novatrade.io',
      country:      'KE',
      currency:     'USD',
      balance:      10000,
      account_type: 'demo',
      is_virtual:   1,
    };
    enterDashboard(true);
  } catch (err) {
    showAuthError('Could not connect to Deriv servers. Check your internet connection.');
  } finally {
    demoBtn.disabled    = false;
    demoBtn.textContent = 'Use Demo Account';
  }
});

// ---- ENTER DASHBOARD ----
function enterDashboard(isDemo) {
  authGate.style.display  = 'none';
  dashLayout.style.display = 'grid';

  const acc  = State.account;
  const name = acc.fullname || acc.loginid || 'Trader';

  $('accountName').textContent   = name;
  $('accountType').textContent   = acc.is_virtual ? '🟡 Demo' : '🟢 Real';
  $('accountAvatar').textContent = (name[0] || 'T').toUpperCase();

  $('detailLoginId').textContent  = acc.loginid  || '—';
  $('detailCurrency').textContent = acc.currency || 'USD';
  $('detailType').textContent     = acc.is_virtual ? 'Virtual / Demo' : 'Real Money';
  $('detailCountry').textContent  = acc.country  || '—';
  $('detailEmail').textContent    = acc.email    || '—';

  State.currency = acc.currency || 'USD';

  if (isDemo) {
    setBalanceDisplay(10000, 'USD');
    toast('Demo mode active — live prices, simulated trading', 'info');
  } else {
    // Real: subscribe to balance
    DerivWS.getBalance((data) => {
      if (data && data.balance) updateBalance(data.balance.balance, data.balance.currency);
    });
    DerivWS.on('balance', (data) => {
      if (data && data.balance) updateBalance(data.balance.balance, data.balance.currency);
    });
    loadOpenContracts();
    loadHistory();
    toast(`Welcome back, ${name}! 🚀`, 'success');
  }

  initChartAndTicks();
  loadMarketWatchlist();
  setupPayoutPreview();
}

function updateBalance(bal, curr) {
  State.balance  = parseFloat(bal);
  State.currency = curr || State.currency;
  setBalanceDisplay(State.balance, State.currency);
  $('portfolioBalance').textContent = formatMoney(State.balance, State.currency);
}

function setBalanceDisplay(bal, curr) {
  balancePill.textContent          = formatMoney(bal, curr);
  $('portfolioBalance').textContent = formatMoney(bal, curr);
}

function formatMoney(amount, currency) {
  return `${currency || 'USD'} ${new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(amount)}`;
}

// ---- LOGOUT ----
logoutBtn.addEventListener('click', () => {
  DerivWS.disconnect();
  dashLayout.style.display = 'none';
  authGate.style.display   = 'flex';
  tokenInput.value = '';
  Object.assign(State, { token: null, account: null, balance: null, contracts: {}, history: [], stats: { total:0, won:0, lost:0, netPnl:0 } });
  clearAuthError();
  toast('Disconnected.', 'info');
});

// ---- SIDEBAR TOGGLE (mobile) ----
sidebarTog.addEventListener('click', () => sidebarEl.classList.toggle('open'));

// ---- TABS ----
document.querySelectorAll('.sidebar-link[data-tab]').forEach(link => {
  link.addEventListener('click', (e) => {
    e.preventDefault();
    const tab = link.dataset.tab;
    document.querySelectorAll('.sidebar-link').forEach(l => l.classList.remove('active'));
    link.classList.add('active');
    document.querySelectorAll('.tab-content').forEach(t => t.classList.remove('active'));
    $(`tab-${tab}`).classList.add('active');
    if (tab === 'history')   loadHistory();
    if (tab === 'portfolio') updatePortfolioStats();
  });
});

// ================================================================
// CHART & LIVE TICKS
// ================================================================
let lastPrice     = null;
let lastTickSymbol = null;

function initChartAndTicks() {
  NTChart.init($('priceChart'));
  loadChart();

  symbolSel.addEventListener('change', () => {
    State.symbol = symbolSel.value;
    lastPrice = null;
    loadChart();
  });

  granSel.addEventListener('change', () => {
    State.granularity = parseInt(granSel.value);
    loadChart();
  });

  document.querySelectorAll('.chart-type-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.chart-type-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      State.chartType = btn.dataset.type;
      NTChart.setType(State.chartType);
    });
  });

  // Listen for candle updates (ohlc subscription)
  DerivWS.on('ohlc', (data) => {
    if (data.ohlc && data.ohlc.symbol === State.symbol) {
      NTChart.pushCandle(data.ohlc);
    }
  });

  // Listen for tick updates
  DerivWS.on('tick', (data) => {
    if (data.tick && data.tick.symbol === State.symbol) {
      handleTick(data.tick);
    }
  });
}

function loadChart() {
  chartLoad.classList.remove('hidden');

  // Forget previous candle subscription
  if (State.candleSub) {
    DerivWS.send({ forget: State.candleSub });
    State.candleSub = null;
  }

  // Subscribe to ticks for this symbol
  DerivWS.send({ ticks: State.symbol, subscribe: 1 }, (data) => {
    if (data.subscription) State.tickSubs[State.symbol] = data.subscription.id;
  });

  // Load candle history + subscribe
  DerivWS.getCandles(State.symbol, State.granularity, 200, (data) => {
    chartLoad.classList.add('hidden');
    if (data.error) {
      toast('Chart error: ' + data.error.message, 'error');
      return;
    }
    if (data.candles) {
      NTChart.setCandles(data.candles);
      NTChart.setType(State.chartType);
    }
    if (data.subscription) State.candleSub = data.subscription.id;
  });
}

function handleTick(tick) {
  const price = parseFloat(tick.quote);
  if (isNaN(price)) return;

  const prev  = lastPrice;
  lastPrice   = price;
  const dp    = prev !== null ? price - prev : 0;
  const dpPct = prev ? ((dp / prev) * 100).toFixed(3) : '0.000';

  priceVal.textContent = price > 100 ? price.toFixed(2) : price.toFixed(5);
  priceChg.textContent = `${dp >= 0 ? '+' : ''}${dpPct}%`;
  priceChg.className   = `price-change ${dp >= 0 ? 'up' : 'down'}`;

  NTChart.pushTick(tick);
}

// ================================================================
// ORDER FORM & PAYOUT PREVIEW
// ================================================================
function setupPayoutPreview() {
  [stakeInput, durInput, durUnit].forEach(el => el.addEventListener('input', updatePayoutPreview));

  document.querySelectorAll('.quick-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      stakeInput.value = btn.dataset.val;
      updatePayoutPreview();
    });
  });

  document.querySelectorAll('.ct-tab').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.ct-tab').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      updatePayoutPreview();
    });
  });

  updatePayoutPreview();
}

function updatePayoutPreview() {
  const stake      = parseFloat(stakeInput.value) || 10;
  const payoutMult = 1.85;
  const payout     = (stake * payoutMult).toFixed(2);
  const profit     = (stake * (payoutMult - 1)).toFixed(2);
  payoutAmt.textContent = `$${payout}`;
  profitAmt.textContent = `+$${profit}`;
}

// ---- PLACE TRADE ----
async function placeTrade(direction) {
  const isDemo = State.token === '__demo__';
  const stake  = parseFloat(stakeInput.value);
  const dur    = parseInt(durInput.value);
  const unit   = durUnit.value;

  if (!stake || stake < 0.35) { setTradeResult('Please enter a valid stake (min $0.35).', 'error'); return; }
  if (!dur    || dur < 1)     { setTradeResult('Please enter a valid duration.', 'error');    return; }

  const contractType = direction === 'rise' ? 'CALL' : 'PUT';

  if (isDemo) {
    const fakeId = 'DEMO_' + Date.now();
    setTradeResult(`📊 Demo ${direction.toUpperCase()} placed on ${State.symbol} for $${stake}. (Simulated — not a real trade)`, 'info');
    addToOpenContracts({ contract_id: fakeId, underlying: State.symbol, contract_type: contractType, buy_price: stake, payout: (stake * 1.85).toFixed(2), profit: '—' });
    toast(`Demo ${direction.toUpperCase()} placed`, 'info');
    return;
  }

  riseBtn.disabled = true;
  fallBtn.disabled = true;
  setTradeResult('⏳ Getting price proposal…', 'info');

  DerivWS.buyContract({
    symbol:        State.symbol,
    contract_type: contractType,
    amount:        stake,
    duration:      dur,
    duration_unit: unit,
    currency:      State.currency,
  }, (result, err) => {
    riseBtn.disabled = false;
    fallBtn.disabled = false;

    if (err) {
      setTradeResult(`❌ ${err.message}`, 'error');
      toast('Trade failed: ' + err.message, 'error');
      return;
    }

    setTradeResult(`✅ ${contractType} #${result.contract_id} bought for $${result.buy_price}`, 'success');
    toast(`${direction.toUpperCase()} placed — Contract #${result.contract_id}`, 'success');

    addToOpenContracts({
      contract_id:  result.contract_id,
      underlying:   result.underlying_symbol || State.symbol,
      contract_type: contractType,
      buy_price:    result.buy_price,
      payout:       result.payout,
      profit:       '—',
    });

    // Subscribe for live P&L updates
    DerivWS.subscribeContract(result.contract_id, (u) => {
      if (u.proposal_open_contract) updateOpenContract(u.proposal_open_contract);
    });
    DerivWS.on('proposal_open_contract', (u) => {
      if (u.proposal_open_contract) updateOpenContract(u.proposal_open_contract);
    });
  });
}

riseBtn.addEventListener('click', () => placeTrade('rise'));
fallBtn.addEventListener('click', () => placeTrade('fall'));

function setTradeResult(msg, type) {
  tradeRes.textContent = msg;
  tradeRes.className   = `trade-result ${type}`;
  clearTimeout(tradeRes._timer);
  tradeRes._timer = setTimeout(() => { tradeRes.className = 'trade-result'; }, 8000);
}

// ================================================================
// OPEN CONTRACTS
// ================================================================
function addToOpenContracts(c) {
  State.contracts[c.contract_id] = c;
  renderOpenContracts();
}

function updateOpenContract(c) {
  const id = c.contract_id;
  if (!State.contracts[id]) return;

  State.contracts[id] = {
    ...State.contracts[id],
    profit: c.profit   || '—',
    payout: c.payout   || State.contracts[id].payout,
    status: c.status   || 'open',
  };
  renderOpenContracts();

  if (['sold', 'won', 'lost'].includes(c.status)) {
    const row = {
      time:   new Date((c.date_settlement || Date.now() / 1000) * 1000).toLocaleString(),
      symbol: c.underlying_symbol || c.underlying,
      type:   c.contract_type,
      stake:  c.buy_price,
      payout: c.payout || 0,
      pnl:    c.profit || 0,
      result: c.status,
    };
    State.history.unshift(row);
    updateHistoryStat(row);
    delete State.contracts[id];
    renderOpenContracts();
    renderHistory(State.history);
    toast(`Contract #${id} — ${c.status.toUpperCase()}`, c.status === 'won' ? 'success' : 'error');
  }
}

function renderOpenContracts() {
  const tbody = $('openContractsTbody');
  const list  = Object.values(State.contracts);
  $('openContractsBadge').textContent = list.length;

  if (!list.length) {
    tbody.innerHTML = '<tr class="empty-row"><td colspan="7">No open contracts. Place a trade above.</td></tr>';
    return;
  }
  tbody.innerHTML = list.map(c => {
    const pnl    = parseFloat(c.profit);
    const pnlStr = isNaN(pnl) ? '—' : (pnl >= 0 ? `+$${pnl.toFixed(2)}` : `-$${Math.abs(pnl).toFixed(2)}`);
    const pnlStyle = isNaN(pnl) ? '' : `style="color:var(${pnl >= 0 ? '--green' : '--red'})"`;
    return `<tr>
      <td>#${c.contract_id}</td>
      <td>${c.underlying}</td>
      <td>${c.contract_type}</td>
      <td>$${parseFloat(c.buy_price).toFixed(2)}</td>
      <td>$${parseFloat(c.payout).toFixed(2)}</td>
      <td ${pnlStyle}>${pnlStr}</td>
      <td><span class="badge-open">Open</span></td>
    </tr>`;
  }).join('');
}

// ================================================================
// CONTRACT HISTORY
// ================================================================
function loadHistory() {
  if (State.token === '__demo__') { renderHistory([]); return; }
  DerivWS.getAccountStatement((data) => {
    if (data.error || !data.profit_table) return;
    const rows = (data.profit_table.transactions || []).map(t => ({
      time:   new Date(t.purchase_time * 1000).toLocaleString(),
      symbol: t.app_id ? `App ${t.app_id}` : '—',
      type:   t.shortcode || '—',
      stake:  t.buy_price  || 0,
      payout: t.sell_price || 0,
      pnl:    ((parseFloat(t.sell_price) || 0) - (parseFloat(t.buy_price) || 0)).toFixed(2),
      result: (parseFloat(t.sell_price) || 0) >= (parseFloat(t.buy_price) || 0) ? 'won' : 'lost',
    }));
    State.history = rows;
    renderHistory(rows);
    let won = 0, lost = 0, netPnl = 0;
    rows.forEach(r => { const p = parseFloat(r.pnl); if (p >= 0) won++; else lost++; netPnl += p; });
    State.stats = { total: rows.length, won, lost, netPnl };
    updatePortfolioStats();
  });
}

function renderHistory(rows) {
  const tbody = $('historyTbody');
  if (!rows.length) {
    tbody.innerHTML = '<tr class="empty-row"><td colspan="7">No contract history yet.</td></tr>';
    return;
  }
  tbody.innerHTML = rows.map(r => {
    const pnl      = parseFloat(r.pnl);
    const pnlStyle = `style="color:var(${pnl >= 0 ? '--green' : '--red'});font-weight:600"`;
    const badge    = r.result === 'won' ? 'badge-won' : 'badge-lost';
    return `<tr>
      <td>${r.time}</td>
      <td>${r.symbol}</td>
      <td style="font-size:.77rem;max-width:140px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${r.type}</td>
      <td>$${parseFloat(r.stake).toFixed(2)}</td>
      <td>$${parseFloat(r.payout).toFixed(2)}</td>
      <td ${pnlStyle}>${pnl >= 0 ? '+' : ''}$${Math.abs(pnl).toFixed(2)}</td>
      <td><span class="${badge}">${r.result.charAt(0).toUpperCase() + r.result.slice(1)}</span></td>
    </tr>`;
  }).join('');
}

$('refreshHistory').addEventListener('click', loadHistory);

function updateHistoryStat(row) {
  const pnl = parseFloat(row.pnl);
  State.stats.total++;
  if (row.result === 'won') State.stats.won++; else State.stats.lost++;
  State.stats.netPnl += pnl;
  updatePortfolioStats();
}

function updatePortfolioStats() {
  const { total, won, lost, netPnl } = State.stats;
  $('totalTrades').textContent = total;
  $('tradesWon').textContent   = won;
  $('tradesLost').textContent  = lost;
  $('winRate').textContent     = total ? ((won / total) * 100).toFixed(1) + '%' : '—';
  $('netPnl').textContent      = `${netPnl >= 0 ? '+' : '-'}$${Math.abs(netPnl).toFixed(2)}`;
  $('netPnl').style.color      = `var(${netPnl >= 0 ? '--green' : '--red'})`;
}

// ================================================================
// OPEN CONTRACTS (real account on load)
// ================================================================
function loadOpenContracts() {
  DerivWS.getOpenContracts((data) => {
    if (data.error || !data.portfolio) return;
    (data.portfolio.contracts || []).forEach(c => {
      addToOpenContracts({
        contract_id:   c.contract_id,
        underlying:    c.underlying_symbol,
        contract_type: c.contract_type,
        buy_price:     c.buy_price,
        payout:        c.payout,
        profit:        c.profit || '—',
      });
    });
  });
}

// ================================================================
// MARKET WATCHLIST
// ================================================================
const WATCH_SYMBOLS = [
  { sym: 'R_100',     name: 'Volatility 100 Index' },
  { sym: 'R_75',      name: 'Volatility 75 Index' },
  { sym: 'R_50',      name: 'Volatility 50 Index' },
  { sym: 'CRASH500',  name: 'Crash 500 Index' },
  { sym: 'BOOM500',   name: 'Boom 500 Index' },
  { sym: 'CRASH1000', name: 'Crash 1000 Index' },
  { sym: 'BOOM1000',  name: 'Boom 1000 Index' },
  { sym: 'frxEURUSD', name: 'Euro / US Dollar' },
  { sym: 'frxGBPUSD', name: 'British Pound / US Dollar' },
  { sym: 'frxUSDJPY', name: 'US Dollar / Japanese Yen' },
  { sym: 'frxXAUUSD', name: 'Gold / US Dollar' },
];
const watchPrices = {};

function loadMarketWatchlist() {
  WATCH_SYMBOLS.forEach(s => {
    watchPrices[s.sym] = { price: null, prev: null };
    DerivWS.send({ ticks: s.sym, subscribe: 1 }, () => {});
  });

  DerivWS.on('tick', (d) => {
    if (!d.tick) return;
    const sym = d.tick.symbol;
    if (!watchPrices[sym]) return;
    watchPrices[sym].prev  = watchPrices[sym].price;
    watchPrices[sym].price = parseFloat(d.tick.quote);
    renderWatchlist($('marketSearch').value.toLowerCase());
  });

  renderWatchlist('');
  $('marketSearch').addEventListener('input', (e) => renderWatchlist(e.target.value.toLowerCase()));
}

function renderWatchlist(filter) {
  const container = $('marketsWatchlist');
  const filtered  = WATCH_SYMBOLS.filter(s =>
    !filter || s.name.toLowerCase().includes(filter) || s.sym.toLowerCase().includes(filter)
  );

  if (!filtered.length) {
    container.innerHTML = '<div style="padding:1.5rem;text-align:center;color:var(--text-dim)">No symbols found.</div>';
    return;
  }

  container.innerHTML = filtered.map(s => {
    const d      = watchPrices[s.sym];
    const p      = d ? d.price : null;
    const prev   = d ? d.prev  : null;
    const dp     = (p !== null && prev !== null) ? p - prev : 0;
    const dpPct  = prev ? ((dp / prev) * 100).toFixed(3) : '0.000';
    const pStr   = p !== null ? (p > 100 ? p.toFixed(2) : p.toFixed(5)) : '—';
    const cls    = dp >= 0 ? 'wi-up' : 'wi-down';
    const arrow  = dp >= 0 ? '▲' : '▼';
    return `<div class="watchlist-item" data-sym="${s.sym}">
      <div>
        <div class="wi-symbol">${s.sym}</div>
        <div class="wi-name">${s.name}</div>
      </div>
      <div>
        <div class="wi-price">${pStr}</div>
        <div class="wi-change ${cls}">${arrow} ${dpPct}%</div>
      </div>
    </div>`;
  }).join('');

  container.querySelectorAll('.watchlist-item').forEach(el => {
    el.addEventListener('click', () => {
      const sym = el.dataset.sym;
      if (!sym) return;
      symbolSel.value = sym;
      State.symbol    = sym;
      lastPrice       = null;
      // Switch to Trade tab
      document.querySelectorAll('.sidebar-link').forEach(l => l.classList.remove('active'));
      document.querySelector('[data-tab="trade"]').classList.add('active');
      document.querySelectorAll('.tab-content').forEach(t => t.classList.remove('active'));
      $('tab-trade').classList.add('active');
      loadChart();
    });
  });
}

// ================================================================
// AUTO-RECONNECT: re-auth after reconnect
// ================================================================
DerivWS.on('ws_open', () => {
  // Only re-auth if we already have a real token (reconnect scenario)
  if (State.token && State.token !== '__demo__' && dashLayout.style.display !== 'none') {
    DerivWS.authorise(State.token).then(() => {
      DerivWS.getBalance((data) => {
        if (data && data.balance) updateBalance(data.balance.balance, data.balance.currency);
      });
    }).catch(() => {});
  }
});

// ================================================================
// NOTE: No DerivWS.connect() call here at init.
// Connection is ONLY triggered by user clicking Connect or Demo button.
// This prevents the "already open, on('open') never fires" bug.
// ================================================================
