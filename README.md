# NovaTrade

> **Smart Trading, Unlimited Potential**

A professional Deriv-powered third-party trading platform.

## Features

- 🔐 **Deriv API Token Auth** — Login with real or demo tokens
- 📈 **Live Price Charts** — WebSocket-streamed candle & line charts
- ⚡ **One-click Trading** — Rise/Fall contracts with payout preview
- 💼 **Portfolio Dashboard** — Balance, P&L, win rate at a glance
- 📜 **Contract History** — Full trade log pulled from Deriv
- 👁️ **Market Watchlist** — Live tickers for 10+ symbols
- 🌐 **Netlify-ready** — Drop in and deploy in 60 seconds

## Tech Stack

- Pure HTML5 / CSS3 / Vanilla JS — zero build step, zero frameworks
- Deriv WebSocket API v3 (App ID: 1089)
- Canvas-rendered charts (no Chart.js bloat)
- Netlify hosting with security headers

## Deploy to Netlify

### Option A — Netlify Drop (fastest)
1. Go to [app.netlify.com](https://app.netlify.com)
2. Drag the `novatrade/` folder onto the drop zone
3. Done — live in ~10 seconds

### Option B — Git + Netlify CI
```bash
cd novatrade
git init && git add . && git commit -m "initial"
# Push to GitHub, then connect repo in Netlify dashboard
```

### Option C — Netlify CLI
```bash
npm i -g netlify-cli
cd novatrade
netlify deploy --prod --dir .
```

## Local Development

```bash
# Any static server works:
cd novatrade
npx serve .
# or
python3 -m http.server 3000
```
Open http://localhost:3000

## Deriv API Token

1. Log in at [deriv.com](https://deriv.com)
2. Go to **Account Settings → API Token**
3. Create a token with **Read** + **Trade** scopes
4. Paste into NovaTrade's login screen

## App ID

This platform uses Deriv's public third-party App ID **1089**.
For production at scale, register your own free App ID at [api.deriv.com](https://api.deriv.com).

## Disclaimer

NovaTrade is an independent third-party platform using the Deriv API.
It is not affiliated with or endorsed by Deriv Group.
Trading financial products involves risk. Trade responsibly.
