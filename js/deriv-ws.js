/* ============================================================
   NovaTrade — Deriv WebSocket Client
   App ID: 1089  |  wss://ws.binaryws.com/websockets/v3
   ============================================================ */
'use strict';

const DerivWS = (() => {
  const APP_ID = 1089;
  const WS_URL = `wss://ws.binaryws.com/websockets/v3?app_id=${APP_ID}`;
  const PING_MS = 25000;

  let ws          = null;
  let pingTimer   = null;
  let reqId       = 1;
  let callbacks   = {};       // req_id  -> one-shot callback
  let subscribers = {};       // msg_type -> [fn, ...]
  let onOpenQueue = [];       // fns waiting for open
  let autoReauth  = null;     // stored token for reconnects

  // ---- UI status helpers ----
  function setStatus(cls, text) {
    const dot   = document.querySelector('#wsStatus .ws-dot');
    const label = document.querySelector('#wsStatus .ws-label');
    if (dot)   dot.className     = `ws-dot ${cls}`;
    if (label) label.textContent = text;
  }

  // ---- Internal: create a fresh WebSocket ----
  function _createSocket() {
    if (ws) {
      ws.onopen = ws.onmessage = ws.onclose = ws.onerror = null;
      try { ws.close(); } catch (_) {}
    }
    ws = new WebSocket(WS_URL);
    setStatus('connecting', 'Connecting…');

    ws.onopen = () => {
      console.log('[NovaTrade] WebSocket open');
      setStatus('connecting', 'Authenticating…');
      startPing();
      // Flush any queued open callbacks
      const q = onOpenQueue.splice(0);
      q.forEach(fn => fn());
    };

    ws.onmessage = (e) => {
      let data;
      try { data = JSON.parse(e.data); } catch (_) { return; }
      _dispatch(data);
    };

    ws.onclose = (code) => {
      console.log('[NovaTrade] WebSocket closed, code:', code);
      stopPing();
      setStatus('disconnected', 'Disconnected');
      callbacks = {};
      onOpenQueue = [];
      // Auto-reconnect if we had a live session
      if (autoReauth) {
        setTimeout(() => {
          console.log('[NovaTrade] Reconnecting…');
          _createSocket();
        }, 3000);
      }
    };

    ws.onerror = (e) => {
      console.warn('[NovaTrade] WebSocket error', e);
      setStatus('disconnected', 'Error');
      try { ws.close(); } catch (_) {}
    };
  }

  function _dispatch(data) {
    // One-shot request callbacks
    if (data.req_id && callbacks[data.req_id]) {
      const cb = callbacks[data.req_id];
      delete callbacks[data.req_id];
      cb(data);
      // Also emit for persistent subscribers (e.g. balance subscribe)
    }
    // Persistent type subscribers
    const type = data.msg_type;
    if (type && subscribers[type]) {
      subscribers[type].forEach(fn => { try { fn(data); } catch(err) { console.error(err); } });
    }
  }

  // ---- send ----
  function send(payload, cb) {
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      console.warn('[NovaTrade] send() — not connected, payload:', payload);
      if (cb) cb({ error: { message: 'Not connected to server.' } });
      return;
    }
    const id = reqId++;
    payload.req_id = id;
    if (cb) callbacks[id] = cb;
    ws.send(JSON.stringify(payload));
    return id;
  }

  // ---- connect — returns Promise ----
  function connect() {
    return new Promise((resolve, reject) => {
      // Already fully open
      if (ws && ws.readyState === WebSocket.OPEN) {
        console.log('[NovaTrade] connect() — already open');
        resolve();
        return;
      }
      // Queue until open
      let settled = false;
      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        reject(new Error('Connection timed out. Please check your internet connection.'));
      }, 10000);

      onOpenQueue.push(() => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve();
      });

      // Only create socket if not already in progress
      if (!ws || ws.readyState === WebSocket.CLOSED || ws.readyState === WebSocket.CLOSING) {
        _createSocket();
      }
      // If CONNECTING, the open event will flush the queue — just wait
    });
  }

  // ---- authorise — returns Promise ----
  function authorise(token) {
    return new Promise((resolve, reject) => {
      send({ authorize: token }, (data) => {
        if (data.error) {
          console.warn('[NovaTrade] Auth error:', data.error.message);
          setStatus('disconnected', 'Auth failed');
          reject(new Error(data.error.message));
          return;
        }
        console.log('[NovaTrade] Authorised:', data.authorize.loginid);
        autoReauth = token;
        setStatus('connected', 'Live ●');
        resolve(data.authorize);
      });
    });
  }

  // ---- disconnect ----
  function disconnect() {
    autoReauth = null;
    stopPing();
    onOpenQueue = [];
    callbacks = {};
    if (ws) {
      ws.onopen = ws.onmessage = ws.onclose = ws.onerror = null;
      try { ws.close(); } catch (_) {}
      ws = null;
    }
    setStatus('disconnected', 'Disconnected');
  }

  function startPing() {
    stopPing();
    pingTimer = setInterval(() => {
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ ping: 1 }));
      }
    }, PING_MS);
  }
  function stopPing() { clearInterval(pingTimer); }

  // ---- event subscription ----
  function on(type, fn) {
    if (!subscribers[type]) subscribers[type] = [];
    if (!subscribers[type].includes(fn)) subscribers[type].push(fn);
  }
  function off(type, fn) {
    if (subscribers[type]) subscribers[type] = subscribers[type].filter(f => f !== fn);
  }

  // ---- API helpers ----
  function getBalance(cb)          { send({ balance: 1, subscribe: 1 }, cb); }
  function getOpenContracts(cb)    { send({ portfolio: 1 }, cb); }
  function getAccountStatement(cb) { send({ profit_table: 1, description: 1, limit: 100, sort: 'DESC' }, cb); }
  function subscribeContract(id, cb) { send({ proposal_open_contract: 1, contract_id: id, subscribe: 1 }, cb); }

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
    send({
      proposal:      1,
      amount:        params.amount,
      basis:         'stake',
      contract_type: params.contract_type,
      currency:      params.currency || 'USD',
      duration:      params.duration,
      duration_unit: params.duration_unit,
      symbol:        params.symbol,
    }, (propData) => {
      if (propData.error) { cb(null, propData.error); return; }
      send({ buy: propData.proposal.id, price: params.amount }, (buyData) => {
        if (buyData.error) { cb(null, buyData.error); return; }
        cb(buyData.buy, null);
      });
    });
  }

  function sellContract(id, cb) { send({ sell: id, price: 0 }, cb); }

  return {
    connect, disconnect, send, on, off,
    authorise, getBalance, getOpenContracts,
    getAccountStatement, subscribeContract,
    getCandles, buyContract, sellContract,
  };
})();

window.DerivWS = DerivWS;
