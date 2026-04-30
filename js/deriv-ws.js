/* ============================================================
   NovaTrade — Deriv WebSocket Client
   Official Deriv App ID: 1089 (public third-party)
   ============================================================ */

'use strict';

const DerivWS = (() => {
  const APP_ID  = 1089;
  const WS_URL  = `wss://ws.binaryws.com/websockets/v3?app_id=${APP_ID}`;
  const PING_MS = 25000;

  let ws           = null;
  let pingTimer    = null;
  let reconnTimer  = null;
  let reconnDelay  = 2000;
  let reconnMax    = 8;
  let reconnCount  = 0;
  let autoReconn   = false;   // only reconnect after a real session, not during auth

  let listeners    = {};      // persistent event listeners (balance, tick, etc.)
  let reqCallbacks = {};      // one-shot req_id callbacks
  let reqId        = 1;

  // ---- Status bar refs ----
  let $dot, $label;
  function setStatus(state, text) {
    if (!$dot)   $dot   = document.querySelector('#wsStatus .ws-dot');
    if (!$label) $label = document.querySelector('#wsStatus .ws-label');
    if ($dot)   $dot.className   = `ws-dot ${state}`;
    if ($label) $label.textContent = text;
  }

  // ---- Core connect — returns a Promise that resolves on open ----
  function connect() {
    return new Promise((resolve, reject) => {
      // If already open, resolve immediately
      if (ws && ws.readyState === WebSocket.OPEN) { resolve(); return; }

      // If connecting, wait for it
      if (ws && ws.readyState === WebSocket.CONNECTING) {
        const done = () => { resolve(); };
        ws.addEventListener('open', done, { once: true });
        ws.addEventListener('error', () => reject(new Error('Connection failed')), { once: true });
        return;
      }

      // Close any stale socket
      if (ws) { ws.onclose = null; ws.onerror = null; ws.onmessage = null; ws.close(); }

      setStatus('connecting', 'Connecting…');
      ws = new WebSocket(WS_URL);

      ws.onopen = () => {
        reconnCount = 0;
        reconnDelay = 2000;
        startPing();
        setStatus('connecting', 'Authenticating…');
        emit('ws_open');
        resolve();
      };

      ws.onmessage = handleMessage;

      ws.onclose = (e) => {
        stopPing();
        setStatus('disconnected', 'Disconnected');
        emit('ws_close', e);
        if (autoReconn && reconnCount < reconnMax) {
          reconnTimer = setTimeout(() => {
            reconnCount++;
            reconnDelay = Math.min(reconnDelay * 1.5, 30000);
            connect();
          }, reconnDelay);
        }
      };

      ws.onerror = () => {
        setStatus('disconnected', 'Connection error');
        ws.close();
        reject(new Error('WebSocket error'));
      };
    });
  }

  function handleMessage(e) {
    let data;
    try { data = JSON.parse(e.data); } catch (_) { return; }

    // One-shot request callbacks
    if (data.req_id && reqCallbacks[data.req_id]) {
      const cb = reqCallbacks[data.req_id];
      delete reqCallbacks[data.req_id];
      cb(data);
      return; // don't double-emit for req/response pairs
    }

    // Persistent subscriptions (tick, balance, proposal_open_contract, etc.)
    if (data.msg_type) emit(data.msg_type, data);
  }

  function disconnect() {
    autoReconn = false;
    reconnMax  = 0;
    clearTimeout(reconnTimer);
    stopPing();
    if (ws) { ws.onclose = null; ws.close(); ws = null; }
    setStatus('disconnected', 'Disconnected');
  }

  function send(payload, callback) {
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      console.warn('[DerivWS] send() called while not connected');
      if (callback) callback({ error: { message: 'Not connected' } });
      return null;
    }
    const id = reqId++;
    payload.req_id = id;
    if (callback) reqCallbacks[id] = callback;
    ws.send(JSON.stringify(payload));
    return id;
  }

  function startPing() {
    stopPing();
    pingTimer = setInterval(() => { if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ ping: 1 })); }, PING_MS);
  }
  function stopPing() { clearInterval(pingTimer); pingTimer = null; }

  // ---- Authorise — returns Promise<account> ----
  function authorise(apiToken) {
    return new Promise((resolve, reject) => {
      send({ authorize: apiToken }, (data) => {
        if (data.error) {
          setStatus('disconnected', 'Auth failed');
          reject(data.error);
          return;
        }
        autoReconn = true;   // enable reconnect only after successful auth
        setStatus('connected', 'Live ●');
        resolve(data.authorize);
      });
    });
  }

  // ---- Event bus ----
  function on(event, fn) {
    if (!listeners[event]) listeners[event] = [];
    // Prevent duplicate listeners
    if (!listeners[event].includes(fn)) listeners[event].push(fn);
  }
  function off(event, fn) {
    if (!listeners[event]) return;
    listeners[event] = listeners[event].filter(f => f !== fn);
  }
  function emit(event, data) {
    (listeners[event] || []).forEach(fn => { try { fn(data); } catch(e) { console.error('[DerivWS emit]', e); } });
  }

  // ---- API helpers ----
  function getBalance(cb)              { send({ balance: 1, subscribe: 1 }, cb); }
  function getAccountStatement(cb)     { send({ profit_table: 1, description: 1, limit: 100, sort: 'DESC' }, cb); }
  function getOpenContracts(cb)        { send({ portfolio: 1 }, cb); }
  function subscribeContract(id, cb)   { send({ proposal_open_contract: 1, contract_id: id, subscribe: 1 }, cb); }

  function getTicks(symbol, cb) {
    send({ ticks: symbol, subscribe: 1 }, cb);
    on('tick', (d) => { if (d.tick && d.tick.symbol === symbol && cb) cb(d); });
  }

  function getCandles(symbol, granularity, count, cb) {
    send({
      ticks_history: symbol,
      style: 'candles',
      granularity: parseInt(granularity),
      count: count || 200,
      end: 'latest',
      subscribe: 1,
    }, cb);
  }

  function buyContract(params, cb) {
    const proposal = {
      proposal:      1,
      amount:        params.amount,
      basis:         params.basis || 'stake',
      contract_type: params.contract_type,
      currency:      params.currency || 'USD',
      duration:      params.duration,
      duration_unit: params.duration_unit,
      symbol:        params.symbol,
    };
    send(proposal, (propData) => {
      if (propData.error) { cb(null, propData.error); return; }
      send({ buy: propData.proposal.id, price: params.amount }, (buyData) => {
        if (buyData.error) { cb(null, buyData.error); return; }
        cb(buyData.buy, null);
      });
    });
  }

  function sellContract(contractId, cb) { send({ sell: contractId, price: 0 }, cb); }

  return {
    connect, disconnect, send, on, off,
    authorise,
    getBalance, getAccountStatement, getOpenContracts,
    subscribeContract, getTicks, getCandles,
    buyContract, sellContract,
  };
})();

window.DerivWS = DerivWS;
