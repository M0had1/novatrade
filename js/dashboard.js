/* ============================================================
   NovaTrade — Dashboard Controller
   ============================================================ */

'use strict';

// ---- STATE ----
const State = {
  token:     null,
  account:   null,
  balance:   null,
  currency:  'USD',
  symbol:    'R_100',
  chartType: 'candle',
  granularity: 300,
  contracts: {},     // id -> contract data
  history:   [],
  stats: { total: 0, won: 0, lost: 0, netPnl: 0 },
};

// ---- DOM REFS ----
const $ = id => document.getElementById(id);
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
  const tc  = $('toastContainer');
  const el  = document.createElement('div');
  el.className = `toast toast-${type}`;
  el.textContent = msg;
  tc.appendChild(el);
  setTimeout(() => { el.style.opacity = '0'; el.style.transform = 'translateX(20px)'; el.style.transition = 'all .3s'; setTimeout(() => el.remove(), 300); }, 3500);
}

// ---- AUTH ----
function showError(msg) {
  authError.textContent = msg;
  authError.classList.add('visible');
}
function clearError() { authError.classList.remove('visible'); }

toggleVis.addEventListener('click', () => {
  tokenInput.type = tokenInput.type === 'password' ? 'text' : 'password';
});

connectBtn.addEventListener('click', () => {
  const t = tokenInput.value.trim();
  clearError();
  if (!t) { showError('Please enter your API token.'); return; }
  connectBtn.disabled = true;
  connectBtn.textContent = 'Connecting…';
  DerivWS.connect();
  DerivWS.on('open', () => {
    DerivWS.authorise(t, (account, err) => {
      connectBtn.disabled = false;
      connectBtn.innerHTML = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4M10 17l5-5-5-5M13 12H3"/></svg> Connect &amp; Enter Platform`;
      if (err) { showError(err.message || 'Authentication failed. Check your token.'); return; }
      State.token   = t;
      State.account = account;
      enterDashboard();
    });
  });
});

demoBtn.addEventListener('click', () => {
  // Use Deriv's public demo environment token placeholder
  tokenInput.value = '';
  clearError();
  demoBtn.disabled = true;
  demoBtn.textContent = 'Loading demo…';
  DerivWS.connect();
  DerivWS.on('open', () => {
    // Authorise without token = use as unauth guest (ticks only, no trading)
    // Actually we send a demo signal to enter with limited capabilities
    demoBtn.disabled = false;
    demoBtn.textContent = 'Use Demo Account';
    State.token   = '__demo__';
    State.account = {
      loginid: 'DEMO001',
      fullname: 'Demo User',
      email: 'demo@novatrade.io',
      country: 'KE',
      currency: 'USD',
      balance: 10000,
      account_type: 'demo',
      is_virtual: 1,
    };
    enterDashboard(true);
  });
});

function enterDashboard(isDemo = false) {
  authGate.style.display = 'none';
  dashLayout.style.display = 'grid';

  const acc = State.account;
  const name = acc.fullname || acc.loginid || 'Trader';
  $('accountName').textContent = name;
  $('accountType').textContent = acc.is_virtual ? '🟡 Demo' : '🟢 Real';
  $('accountAvatar').textContent = (name[0] || 'T').toUpperCase();

  // Populate portfolio details
  $('detailLoginId').textContent  = acc.loginid   || '—';
  $('detailCurrency').textContent = acc.currency   || 'USD';
  $('detailType').textContent     = acc.is_virtual ? 'Virtual / Demo' : 'Real Money';
  $('detailCountry').textContent  = acc.country    || '—';
  $('detailEmail').textContent    = acc.email      || '—';

  State.currency = acc.currency || 'USD';

  if (isDemo) {
    balancePill.textContent = `${State.currency} 10,000.00`;
    $('portfolioBalance').textContent = `${State.currency} 10,000.00`;
    // Ticks still work without auth
    initChartAndTicks();
    toast('Demo mode — live prices, no real trading', 'info');
  } else {
    DerivWS.getBalance((data) => {
      if (data.balance) updateBalance(data.balance.balance, data.balance.currency);
    });
    DerivWS.on('balance', (data) => {
      if (data.balance) updateBalance(data.balance.balance, data.balance.currency);
    });
    initChartAndTicks();
    loadHistory();
    loadOpenContracts();
    toast(`Welcome back, ${name}!`, 'success');
  }

  loadMarketWatchlist();
  setupPayoutPreview();
}

function updateBalance(bal, curr) {
  State.balance  = parseFloat(bal);
  State.currency = curr || State.currency;
  const fmt = new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(State.balance);
  balancePill.textContent = `${State.currency} ${fmt}`;
  $('portfolioBalance').textContent = `${State.currency} ${fmt}`;
}

logoutBtn.addEventListener('click', () => {
  DerivWS.disconnect();
  dashLayout.style.display = 'none';
  authGate.style.display   = 'flex';
  tokenInput.value = '';
  State.token = null; State.account = null;
  toast('Disconnected.', 'info');
});

// ---- SIDEBAR TOGGLE ----
sidebarTog.addEventListener('click', () => { sidebarEl.classList.toggle('open'); });

// ---- TABS ----
document.querySelectorAll('.sidebar-link[data-tab]').forEach(link => {
  link.addEventListener('click', (e) => {
    e.preventDefault();
    const tab = link.dataset.tab;
    document.querySelectorAll('.sidebar-link').forEach(l => l.classList.remove('active'));
    link.classList.add('active');
    document.querySelectorAll('.tab-content').forEach(t => t.classList.remove('active'));
    $(`tab-${tab}`).classList.add('active');
    if (tab === 'history') loadHistory();
    if (tab === 'portfolio') updatePortfolioStats();
  });
});

// ---- CHART & TICKS ----
let tickUnsub = null;
let candleUnsub = null;
let lastPrice = null;

function initChartAndTicks() {
  NTChart.init($('priceChart'));
  loadChart();

  symbolSel.addEventListener('change', () => {
    State.symbol = symbolSel.value;
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
}

function loadChart() {
  chartLoad.classList.remove('hidden');
  // Unsubscribe previous
  if (tickUnsub)   { DerivWS.send({ forget: tickUnsub }); tickUnsub = null; }
  if (candleUnsub) { DerivWS.send({ forget: candleUnsub }); candleUnsub = null; }

  DerivWS.getCandles(State.symbol, State.granularity, 200, (data) => {
    chartLoad.classList.add('hidden');
    if (data.error) { toast('Chart error: ' + data.error.message, 'error'); return; }
    if (data.candles) {
      NTChart.setCandles(data.candles);
      NTChart.setType(State.chartType);
      candleUnsub = data.subscription && data.subscription.id;
    }
  });

  // Subscribe ticks for live price
  DerivWS.getTicks(State.symbol, (data) => {
    if (data.tick) handleTick(data.tick);
    if (data.subscription) tickUnsub = data.subscription.id;
  });
  DerivWS.on('tick', (data) => {
    if (data.tick && data.tick.symbol === State.symbol) handleTick(data.tick);
  });
  DerivWS.on('ohlc', (data) => {
    if (data.ohlc && data.ohlc.symbol === State.symbol) NTChart.pushCandle(data.ohlc);
  });
}

function handleTick(tick) {
  const price = parseFloat(tick.quote);
  if (!isNaN(price)) {
    const prev = lastPrice;
    lastPrice = price;
    const dp = prev !== null ? price - prev : 0;
    const dpPct = prev ? ((dp / prev) * 100).toFixed(3) : '0.000';

    priceVal.textContent = price > 100 ? price.toFixed(2) : price.toFixed(5);
    priceChg.textContent = (dp >= 0 ? '+' : '') + dpPct + '%';
    priceChg.className   = `price-change ${dp >= 0 ? 'up' : 'down'}`;
    NTChart.pushTick(tick);
  }
}

// ---- PAYOUT PREVIEW ----
function setupPayoutPreview() {
  [stakeInput, durInput, durUnit].forEach(el => el && el.addEventListener('input', updatePayoutPreview));
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
  const stake = parseFloat(stakeInput.value) || 10;
  // Deriv typical payout is ~85-95% for binary options
  const payoutRate = 1.85;
  const payout = (stake * payoutRate).toFixed(2);
  const profit = (stake * (payoutRate - 1)).toFixed(2);
  payoutAmt.textContent = `$${payout}`;
  profitAmt.textContent = `+$${profit}`;
}

// ---- PLACE TRADE ----
function placeTrade(direction) {
  const isDemo = State.token === '__demo__';
  const stake  = parseFloat(stakeInput.value);
  const dur    = parseInt(durInput.value);
  const unit   = durUnit.value;

  if (!stake || stake < 0.35) { tradeResult('Please enter a valid stake (min $0.35).', 'error'); return; }
  if (!dur || dur < 1)        { tradeResult('Please enter a valid duration.', 'error'); return; }

  const contractType = direction === 'rise' ? 'CALL' : 'PUT';

  if (isDemo) {
    tradeResult(`📊 Demo trade placed — ${direction.toUpperCase()} on ${State.symbol} for $${stake}. (Demo mode — not a real trade)`, 'info');
    const fakeId = 'DEMO_' + Date.now();
    addToOpenContracts({
      contract_id: fakeId,
      underlying: State.symbol,
      contract_type: contractType,
      buy_price: stake,
      payout: (stake * 1.85).toFixed(2),
      profit: '—',
      status: 'open',
    });
    toast(`Demo ${direction.toUpperCase()} placed on ${State.symbol}`, 'info');
    return;
  }

  riseBtn.disabled = true;
  fallBtn.disabled = true;
  tradeResult('⏳ Getting price proposal…', 'info');

  DerivWS.buyContract({
    symbol: State.symbol,
    contract_type: contractType,
    amount: stake,
    duration: dur,
    duration_unit: unit,
    basis: 'stake',
  }, (result, err) => {
    riseBtn.disabled = false;
    fallBtn.disabled = false;

    if (err) {
      tradeResult(`❌ Error: ${err.message}`, 'error');
      toast('Trade failed: ' + err.message, 'error');
      return;
    }

    const msg = `✅ ${contractType} contract #${result.contract_id} bought for $${result.buy_price}.`;
    tradeResult(msg, 'success');
    toast(`${direction.toUpperCase()} placed! Contract #${result.contract_id}`, 'success');

    // Track open contract
    addToOpenContracts({
      contract_id: result.contract_id,
      underlying: result.underlying_symbol || State.symbol,
      contract_type: contractType,
      buy_price: result.buy_price,
      payout: result.payout,
      profit: '—',
      status: 'open',
    });

    // Subscribe for updates
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

function tradeResult(msg, type) {
  tradeRes.textContent = msg;
  tradeRes.className = `trade-result ${type}`;
  setTimeout(() => { tradeRes.className = 'trade-result'; }, 8000);
}

// ---- OPEN CONTRACTS TABLE ----
function addToOpenContracts(c) {
  State.contracts[c.contract_id] = c;
  renderOpenContracts();
}

function updateOpenContract(c) {
  const id = c.contract_id;
  if (!State.contracts[id]) return;
  State.contracts[id] = {
    ...State.contracts[id],
    profit: c.profit || '—',
    status: c.status || 'open',
    payout: c.payout || State.contracts[id].payout,
  };
  renderOpenContracts();

  // If settled, move to history
  if (c.status === 'sold' || c.status === 'won' || c.status === 'lost') {
    const result = {
      time: new Date(c.date_settlement * 1000).toLocaleString(),
      symbol: c.underlying_symbol || c.underlying,
      type: c.contract_type,
      stake: c.buy_price,
      payout: c.payout || 0,
      pnl: c.profit || 0,
      result: c.status,
    };
    State.history.unshift(result);
    updateHistoryStat(result);
    delete State.contracts[id];
    renderOpenContracts();
    loadHistory();
    toast(`Contract #${id} ${c.status}`, c.status === 'won' ? 'success' : 'error');
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
    const pnl   = parseFloat(c.profit);
    const pnlFmt = isNaN(pnl) ? '—' : (pnl >= 0 ? '+$' : '-$') + Math.abs(pnl).toFixed(2);
    const pnlCls = isNaN(pnl) ? '' : (pnl >= 0 ? 'style="color:var(--green)"' : 'style="color:var(--red)"');
    return `<tr>
      <td>#${c.contract_id}</td>
      <td>${c.underlying}</td>
      <td>${c.contract_type}</td>
      <td>$${parseFloat(c.buy_price).toFixed(2)}</td>
      <td>$${parseFloat(c.payout).toFixed(2)}</td>
      <td ${pnlCls}>${pnlFmt}</td>
      <td><span class="badge-open">Open</span></td>
    </tr>`;
  }).join('');
}

// ---- CONTRACT HISTORY ----
function loadHistory() {
  if (State.token === '__demo__' || !State.token) {
    renderHistory([]);
    return;
  }
  DerivWS.getAccountStatement((data) => {
    if (data.error || !data.profit_table) return;
    const rows = (data.profit_table.transactions || []).map(t => ({
      time:   new Date(t.purchase_time * 1000).toLocaleString(),
      symbol: t.shortcode ? t.shortcode.split('_')[0] : '—',
      type:   t.shortcode || t.app_id,
      stake:  t.buy_price,
      payout: t.sell_price,
      pnl:    (parseFloat(t.sell_price) - parseFloat(t.buy_price)).toFixed(2),
      result: parseFloat(t.sell_price) >= parseFloat(t.buy_price) ? 'won' : 'lost',
    }));
    renderHistory(rows);
    // Update stats
    let won = 0, lost = 0, netPnl = 0;
    rows.forEach(r => {
      const p = parseFloat(r.pnl);
      if (p > 0) won++; else lost++;
      netPnl += p;
    });
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
    const pnl    = parseFloat(r.pnl);
    const pnlCls = pnl >= 0 ? 'style="color:var(--green);font-weight:600"' : 'style="color:var(--red);font-weight:600"';
    const badge  = r.result === 'won' ? 'badge-won' : 'badge-lost';
    return `<tr>
      <td>${r.time}</td>
      <td>${r.symbol}</td>
      <td style="font-size:.77rem;max-width:140px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${r.type}</td>
      <td>$${parseFloat(r.stake).toFixed(2)}</td>
      <td>$${parseFloat(r.payout).toFixed(2)}</td>
      <td ${pnlCls}>${pnl >= 0 ? '+' : ''}$${Math.abs(pnl).toFixed(2)}</td>
      <td><span class="${badge}">${r.result.charAt(0).toUpperCase() + r.result.slice(1)}</span></td>
    </tr>`;
  }).join('');
}

$('refreshHistory').addEventListener('click', loadHistory);

function updateHistoryStat(result) {
  const pnl = parseFloat(result.pnl);
  State.stats.total++;
  if (result.result === 'won') State.stats.won++;
  else State.stats.lost++;
  State.stats.netPnl += pnl;
  updatePortfolioStats();
}

function updatePortfolioStats() {
  const { total, won, lost, netPnl } = State.stats;
  $('totalTrades').textContent = total;
  $('tradesWon').textContent   = won;
  $('tradesLost').textContent  = lost;
  $('winRate').textContent     = total ? ((won / total) * 100).toFixed(1) + '%' : '—';
  const sign = netPnl >= 0 ? '+' : '';
  $('netPnl').textContent = `${sign}$${Math.abs(netPnl).toFixed(2)}`;
  $('netPnl').style.color = netPnl >= 0 ? 'var(--green)' : 'var(--red)';
}

// ---- OPEN CONTRACTS (real) ----
function loadOpenContracts() {
  DerivWS.getOpenContracts((data) => {
    if (data.error || !data.portfolio) return;
    (data.portfolio.contracts || []).forEach(c => {
      addToOpenContracts({
        contract_id: c.contract_id,
        underlying: c.underlying_symbol,
        contract_type: c.contract_type,
        buy_price: c.buy_price,
        payout: c.payout,
        profit: c.profit || '—',
        status: 'open',
      });
    });
  });
}

// ---- MARKET WATCHLIST ----
const WATCHLIST_SYMBOLS = [
  { sym: 'R_100',      name: 'Volatility 100 Index' },
  { sym: 'R_75',       name: 'Volatility 75 Index' },
  { sym: 'R_50',       name: 'Volatility 50 Index' },
  { sym: 'CRASH500',   name: 'Crash 500 Index' },
  { sym: 'BOOM500',    name: 'Boom 500 Index' },
  { sym: 'frxEURUSD',  name: 'Euro / US Dollar' },
  { sym: 'frxGBPUSD',  name: 'British Pound / US Dollar' },
  { sym: 'frxUSDJPY',  name: 'US Dollar / Japanese Yen' },
  { sym: 'frxAUDUSD',  name: 'Australian Dollar / US Dollar' },
  { sym: 'frxXAUUSD',  name: 'Gold / US Dollar' },
];
const watchlistPrices = {};

function loadMarketWatchlist() {
  const container = $('marketsWatchlist');
  WATCHLIST_SYMBOLS.forEach(s => {
    watchlistPrices[s.sym] = { price: null, prev: null };
    DerivWS.getTicks(s.sym, (d) => {
      if (d.tick) updateWatchlistPrice(s.sym, d.tick.quote);
    });
  });
  DerivWS.on('tick', (d) => {
    if (d.tick && watchlistPrices[d.tick.symbol] !== undefined) {
      updateWatchlistPrice(d.tick.symbol, d.tick.quote);
    }
  });
  renderWatchlist('');

  $('marketSearch').addEventListener('input', (e) => renderWatchlist(e.target.value.toLowerCase()));
}

function updateWatchlistPrice(sym, quote) {
  const entry = watchlistPrices[sym];
  if (!entry) return;
  entry.prev  = entry.price;
  entry.price = parseFloat(quote);
  renderWatchlist($('marketSearch').value.toLowerCase());
}

function renderWatchlist(filter) {
  const container = $('marketsWatchlist');
  const filtered  = WATCHLIST_SYMBOLS.filter(s => !filter || s.name.toLowerCase().includes(filter) || s.sym.toLowerCase().includes(filter));
  if (!filtered.length) { container.innerHTML = '<div style="padding:1.5rem;text-align:center;color:var(--text-dim)">No symbols found.</div>'; return; }

  container.innerHTML = filtered.map(s => {
    const d    = watchlistPrices[s.sym];
    const p    = d ? d.price : null;
    const prev = d ? d.prev  : null;
    const dp   = (p !== null && prev !== null) ? p - prev : 0;
    const dpPct = prev ? ((dp / prev) * 100).toFixed(3) : '0.000';
    const priceStr = p !== null ? (p > 100 ? p.toFixed(2) : p.toFixed(5)) : '—';
    const cls  = dp >= 0 ? 'wi-up' : 'wi-down';
    const arrow = dp >= 0 ? '▲' : '▼';
    return `<div class="watchlist-item" data-sym="${s.sym}">
      <div>
        <div class="wi-symbol">${s.sym}</div>
        <div class="wi-name">${s.name}</div>
      </div>
      <div>
        <div class="wi-price">${priceStr}</div>
        <div class="wi-change ${cls}">${arrow} ${dpPct}%</div>
      </div>
    </div>`;
  }).join('');

  container.querySelectorAll('.watchlist-item').forEach(el => {
    el.addEventListener('click', () => {
      const sym = el.dataset.sym;
      if (sym) {
        symbolSel.value = sym;
        State.symbol = sym;
        // Switch to Trade tab
        document.querySelectorAll('.sidebar-link').forEach(l => l.classList.remove('active'));
        document.querySelector('[data-tab="trade"]').classList.add('active');
        document.querySelectorAll('.tab-content').forEach(t => t.classList.remove('active'));
        $('tab-trade').classList.add('active');
        loadChart();
      }
    });
  });
}

// ---- RECONNECT HANDLER ----
DerivWS.on('close', () => {
  if (State.token && State.token !== '__demo__') {
    setTimeout(() => {
      DerivWS.connect();
      DerivWS.on('open', () => {
        if (State.token && State.token !== '__demo__') {
          DerivWS.authorise(State.token, () => {
            DerivWS.getBalance();
          });
        }
      });
    }, 3000);
  }
});

// ---- INIT ----
// Pre-connect WS for landing ticker
DerivWS.connect();
