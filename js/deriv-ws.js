/* ============================================================
   NovaTrade — Deriv WebSocket Client v3
   App ID: 1089  |  endpoint: ws.binaryws.com
   ============================================================ */
'use strict';

const DerivWS = (() => {
  const APP_ID   = 1089;
  const WS_URL   = `wss://ws.binaryws.com/websockets/v3?app_id=${APP_ID}&l=EN&brand=deriv`;
  const PING_MS  = 30000;
  const CONN_TMO = 12000;
  const MAX_RC   = 10;

  let _ws            = null;
  let _reqId         = 1;
  let _pending       = {};      // req_id -> cb  (one-shot)
  let _subs          = {};      // msg_type -> [fn...]
  let _queue         = [];      // { payload, cb } — sent once open
  let _token         = null;    // stored for reconnect
  let _pingTimer     = null;
  let _reconnTimer   = null;
  let _reconnCount   = 0;
  let _reconnEnabled = false;
  let _openResolvers = [];      // pending connect() promises

  /* ---- UI STATUS ---- */
  function _status(cls, text) {
    const dot = document.querySelector('#wsStatus .ws-dot');
    const lbl = document.querySelector('#wsStatus .ws-label');
    if (dot) dot.className = `ws-dot ${cls}`;
    if (lbl) lbl.textContent = text;
  }

  /* ---- SOCKET LIFECYCLE ---- */
  function _createSocket() {
    // Hard-close any existing socket first
    if (_ws) {
      _ws.onopen = _ws.onmessage = _ws.onclose = _ws.onerror = null;
      try { _ws.close(); } catch (_) {}
      _ws = null;
    }

    _status('connecting', 'Connecting…');
    _ws = new WebSocket(WS_URL);

    // One-time open handler – resolves all waiting connect() promises
    _ws.addEventListener('open', () => {
      console.info('[NT-WS] Connected');
      _reconnCount = 0;
      _startPing();
      _status('connecting', 'Authenticating…');

      // Flush queued messages
      const q = _queue.splice(0);
      q.forEach(item => _rawSend(item.payload, item.cb));

      // Resolve pending connect promises
      const resolvers = _openResolvers.splice(0);
      resolvers.forEach(r => r.resolve());
    }, { once: true });

    _ws.addEventListener('error', () => {
      console.warn('[NT-WS] Socket error');
      // Errors are followed by close; handle in onclose
      const resolvers = _openResolvers.splice(0);
      resolvers.forEach(r => r.reject(new Error('WebSocket error — cannot connect to Deriv servers.')));
    }, { once: true });

    _ws.onmessage = _onMessage;
    _ws.onclose   = _onClose;
  }

  function _onMessage(evt) {
    let data;
    try { data = JSON.parse(evt.data); } catch (_) { return; }

    // Dispatch one-shot callbacks
    if (data.req_id !== undefined && _pending[data.req_id]) {
      const cb = _pending[data.req_id];
      delete _pending[data.req_id];
      try { cb(data); } catch (e) { console.error('[NT-WS cb]', e); }
      // Don't return — also emit to type-subscribers (for subscribe=1 continuations)
    }

    // Emit to persistent type subscribers
    if (data.msg_type) _emit(data.msg_type, data);
  }

  function _onClose(evt) {
    console.info('[NT-WS] Closed', evt.code, evt.reason || '');
    _stopPing();
    _pending = {};
    _status('disconnected', 'Disconnected');

    // Reject any open connect promises
    const resolvers = _openResolvers.splice(0);
    resolvers.forEach(r => r.reject(new Error('Connection closed unexpectedly.')));

    if (_reconnEnabled && _reconnCount < MAX_RC) {
      _reconnCount++;
      const delay = Math.min(1500 * Math.pow(1.6, _reconnCount - 1), 30000);
      console.info(`[NT-WS] Reconnecting in ${(delay / 1000).toFixed(1)}s… (${_reconnCount}/${MAX_RC})`);
      _status('connecting', `Reconnecting… (${_reconnCount})`);
      _reconnTimer = setTimeout(() => {
        _createSocket();
        // Re-authorize automatically
        if (_token) {
          _openResolvers.push({
            resolve: () => _rawSend({ authorize: _token }, (d) => {
              if (!d.error) { _reconnEnabled = true; _status('connected', 'Live ●'); }
            }),
            reject: () => {},
          });
        }
      }, delay);
    }
  }

  /* ---- SEND ---- */
  function _rawSend(payload, cb) {
    if (!_ws || _ws.readyState !== WebSocket.OPEN) {
      console.warn('[NT-WS] send() on closed socket — queuing', payload);
      _queue.push({ payload, cb });
      return null;
    }
    const id = _reqId++;
    payload.req_id = id;
    if (cb) _pending[id] = cb;
    _ws.send(JSON.stringify(payload));
    return id;
  }

  // Public send — queues if not connected
  function send(payload, cb) {
    if (_ws && _ws.readyState === WebSocket.OPEN) {
      return _rawSend(payload, cb);
    }
    _queue.push({ payload: Object.assign({}, payload), cb });
    return null;
  }

  /* ---- PING ---- */
  function _startPing() {
    _stopPing();
    _pingTimer = setInterval(() => {
      if (_ws && _ws.readyState === WebSocket.OPEN) {
        _ws.send(`{"ping":1,"req_id":${_reqId++}}`);
      }
    }, PING_MS);
  }
  function _stopPing() { clearInterval(_pingTimer); _pingTimer = null; }

  /* ---- EVENT BUS ---- */
  function _emit(type, data) {
    (_subs[type] || []).forEach(fn => { try { fn(data); } catch (e) { console.error('[NT-WS emit]', type, e); } });
  }
  function on(type, fn) {
    if (!_subs[type]) _subs[type] = [];
    if (!_subs[type].includes(fn)) _subs[type].push(fn);
  }
  function off(type, fn) {
    if (_subs[type]) _subs[type] = _subs[type].filter(f => f !== fn);
  }

  /* ---- PUBLIC API ---- */
  function connect() {
    return new Promise((resolve, reject) => {
      // Already open
      if (_ws && _ws.readyState === WebSocket.OPEN) { resolve(); return; }

      // Enqueue resolver
      let settled = false;
      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        // Remove from queue
        _openResolvers = _openResolvers.filter(r => r.resolve !== wrappedResolve);
        reject(new Error('Connection timed out (12s). Check your internet connection.'));
      }, CONN_TMO);

      function wrappedResolve() { if (!settled) { settled = true; clearTimeout(timer); resolve(); } }
      function wrappedReject(e) { if (!settled) { settled = true; clearTimeout(timer); reject(e); } }

      _openResolvers.push({ resolve: wrappedResolve, reject: wrappedReject });

      // Create socket if not already in progress
      if (!_ws || _ws.readyState >= WebSocket.CLOSING) {
        _createSocket();
      }
      // If CONNECTING, already has listeners — just wait in _openResolvers
    });
  }

  function authorise(token) {
    return new Promise((resolve, reject) => {
      _rawSend({ authorize: token }, (data) => {
        if (data.error) {
          _status('disconnected', 'Auth failed');
          reject(new Error(data.error.message));
          return;
        }
        _token         = token;
        _reconnEnabled = true;
        _status('connected', 'Live ●');
        console.info('[NT-WS] Authorised as:', data.authorize.loginid);
        resolve(data.authorize);
      });
    });
  }

  function disconnect() {
    _token         = null;
    _reconnEnabled = false;
    _reconnCount   = 0;
    clearTimeout(_reconnTimer);
    _stopPing();
    _pending = {};
    _queue   = [];
    if (_ws) {
      _ws.onopen = _ws.onmessage = _ws.onclose = _ws.onerror = null;
      try { _ws.close(); } catch (_) {}
      _ws = null;
    }
    _status('disconnected', 'Disconnected');
  }

  /* ---- DERIV API HELPERS ---- */
  function getBalance(cb)          { send({ balance: 1, subscribe: 1 }, cb); }
  function getOpenContracts(cb)    { send({ portfolio: 1 }, cb); }
  function getStatement(cb)        { send({ profit_table: 1, description: 1, limit: 100, sort: 'DESC' }, cb); }
  function getActiveSymbols(cb)    { send({ active_symbols: 'brief', product_type: 'basic' }, cb); }
  function forget(subId, cb)       { send({ forget: subId }, cb || (() => {})); }

  function subscribeTicks(symbol, cb) {
    return send({ ticks: symbol, subscribe: 1 }, cb);
  }

  function getCandles(symbol, granularity, count, cb) {
    return send({
      ticks_history: symbol,
      style:         'candles',
      granularity:   Number(granularity),
      count:         count || 200,
      end:           'latest',
      subscribe:     1,
    }, cb);
  }

  function getProposal(params, cb) {
    return send({
      proposal:      1,
      subscribe:     1,
      amount:        String(params.amount),
      basis:         'stake',
      contract_type: params.contract_type,
      currency:      params.currency || 'USD',
      duration:      Number(params.duration),
      duration_unit: params.duration_unit,
      symbol:        params.symbol,
    }, cb);
  }

  function buyProposal(proposalId, price, cb) {
    send({ buy: String(proposalId), price: Number(price) }, cb);
  }

  function subscribeContract(contractId, cb) {
    send({ proposal_open_contract: 1, contract_id: contractId, subscribe: 1 }, cb);
  }

  function sellContract(contractId, cb) {
    send({ sell: String(contractId), price: 0 }, cb);
  }

  return {
    connect, disconnect, send, on, off,
    authorise, getBalance, getOpenContracts,
    getStatement, getActiveSymbols,
    forget, subscribeTicks, getCandles,
    getProposal, buyProposal, subscribeContract, sellContract,
  };
})();

window.DerivWS = DerivWS;
