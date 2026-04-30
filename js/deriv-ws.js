/* ============================================================
   NovaTrade — Deriv WebSocket Client
   Official Deriv App ID: 1089 (public demo/third-party)
   ============================================================ */

'use strict';

const DerivWS = (() => {
  const APP_ID  = 1089;
  const WS_URL  = `wss://ws.binaryws.com/websockets/v3?app_id=${APP_ID}`;
  const PING_MS = 25000;

  let ws          = null;
  let token       = null;
  let pingTimer   = null;
  let reconnTimer = null;
  let reconnDelay = 2000;
  let maxReconn   = 8;
  let reconnCount = 0;
  let listeners   = {};
  let reqCallbacks = {};
  let reqId       = 1;

  // ---- Status element refs ----
  let statusDot, statusLabel;

  function setStatus(state, label) {
    if (!statusDot) {
      statusDot   = document.querySelector('#wsStatus .ws-dot');
      statusLabel = document.querySelector('#wsStatus .ws-label');
    }
    if (!statusDot) return;
    statusDot.className = `ws-dot ${state}`;
    statusLabel.textContent = label;
  }

  function connect() {
    if (ws && ws.readyState === WebSocket.OPEN) return;
    setStatus('connecting', 'Connecting…');

    ws = new WebSocket(WS_URL);

    ws.onopen = () => {
      reconnCount = 0;
      reconnDelay = 2000;
      startPing();
      if (token) authorise(token);
      else setStatus('connected', 'Connected');
      emit('open');
    };

    ws.onmessage = (e) => {
      let data;
      try { data = JSON.parse(e.data); } catch (_) { return; }

      // Handle pending callbacks keyed by req_id
      if (data.req_id && reqCallbacks[data.req_id]) {
        const cb = reqCallbacks[data.req_id];
        delete reqCallbacks[data.req_id];
        cb(data);
      }

      // Dispatch by msg_type
      if (data.msg_type) emit(data.msg_type, data);
      if (data.error)    emit('error_msg', data);
    };

    ws.onclose = (e) => {
      stopPing();
      setStatus('disconnected', 'Disconnected');
      emit('close', e);
      if (reconnCount < maxReconn) {
        reconnTimer = setTimeout(() => { reconnCount++; connect(); }, reconnDelay);
        reconnDelay = Math.min(reconnDelay * 1.5, 30000);
      }
    };

    ws.onerror = () => {
      ws.close();
    };
  }

  function disconnect() {
    maxReconn = 0;
    clearTimeout(reconnTimer);
    stopPing();
    if (ws) ws.close();
    token = null;
    setStatus('disconnected', 'Disconnected');
  }

  function send(payload, callback) {
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      console.warn('[DerivWS] Not connected; queuing send skipped.');
      return null;
    }
    const id = reqId++;
    payload.req_id = id;
    if (callback) reqCallbacks[id] = callback;
    ws.send(JSON.stringify(payload));
    return id;
  }

  function startPing() {
    pingTimer = setInterval(() => {
      send({ ping: 1 });
    }, PING_MS);
  }

  function stopPing() { clearInterval(pingTimer); }

  // ---- Authorise ----
  function authorise(apiToken, callback) {
    token = apiToken;
    send({ authorize: apiToken }, (data) => {
      if (data.error) {
        setStatus('disconnected', 'Auth Failed');
        if (callback) callback(null, data.error);
        return;
      }
      setStatus('connected', 'Live');
      if (callback) callback(data.authorize);
    });
  }

  // ---- Event emitter ----
  function on(event, fn) {
    if (!listeners[event]) listeners[event] = [];
    listeners[event].push(fn);
  }
  function off(event, fn) {
    if (!listeners[event]) return;
    listeners[event] = listeners[event].filter(f => f !== fn);
  }
  function emit(event, data) {
    (listeners[event] || []).forEach(fn => fn(data));
  }

  // ---- Public API helpers ----
  function getBalance(callback) {
    send({ balance: 1, subscribe: 1 }, callback);
  }

  function getAccountStatement(callback) {
    send({ profit_table: 1, description: 1, limit: 100, sort: 'DESC' }, callback);
  }

  function getOpenContracts(callback) {
    send({ portfolio: 1 }, callback);
  }

  function subscribeContract(contractId, callback) {
    send({ proposal_open_contract: 1, contract_id: contractId, subscribe: 1 }, callback);
  }

  function getTicks(symbol, callback) {
    send({ ticks: symbol, subscribe: 1 }, callback);
  }

  function getCandles(symbol, granularity, count, callback) {
    send({
      ticks_history: symbol,
      style: 'candles',
      granularity: parseInt(granularity),
      count: count || 150,
      end: 'latest',
      subscribe: 1,
    }, callback);
  }

  function getActiveSymbols(callback) {
    send({ active_symbols: 'full', product_type: 'basic' }, callback);
  }

  function buyContract(params, callback) {
    // params: { symbol, contract_type, amount, duration, duration_unit, basis }
    const proposal = {
      proposal: 1,
      amount: params.amount,
      basis: params.basis || 'stake',
      contract_type: params.contract_type,
      currency: 'USD',
      duration: params.duration,
      duration_unit: params.duration_unit,
      symbol: params.symbol,
    };

    send(proposal, (propData) => {
      if (propData.error) { callback(null, propData.error); return; }
      const id = propData.proposal.id;
      send({ buy: id, price: params.amount }, (buyData) => {
        if (buyData.error) { callback(null, buyData.error); return; }
        callback(buyData.buy);
      });
    });
  }

  function sellContract(contractId, callback) {
    send({ sell: contractId, price: 0 }, callback);
  }

  return {
    connect, disconnect,
    send, on, off,
    authorise,
    getBalance, getAccountStatement, getOpenContracts,
    subscribeContract, getTicks, getCandles, getActiveSymbols,
    buyContract, sellContract,
  };
})();

window.DerivWS = DerivWS;
