# TradrEdge server
Covers NASDAQ/US stocks, NSE, BSE and crypto. Alerts include a Buy/Sell/Hold signal, the reasons, and the latest headlines. Push notifications reach phones even when the app is closed.

## Run it
1. Get a free key at finnhub.io.
2. `npm install`
3. Generate push keys once: `npx web-push generate-vapid-keys`
4. Start:
   `FINNHUB_KEY=... VAPID_PUBLIC=... VAPID_PRIVATE=... VAPID_EMAIL=mailto:you@example.com node server.js`
5. Open http://localhost:3000 and tap "Turn on alerts".
6. Test: /test?sym=RELIANCE&dir=down   or   /test?sym=AAPL&dir=up

## Put it on your phone
Push needs HTTPS, so deploy to Render, Railway or Fly.io and set the same environment variables there. On iPhone (iOS 16.4+), open the site in Safari, tap Share, Add to Home Screen, then open it from the home screen and tap "Turn on alerts".

## Choose what to track
- `STOCKS=AAPL,NVDA` for US tickers
- `INDIA=RELIANCE.NS,TCS.NS,RELIANCE.BO,^NSEI` for NSE (.NS) and BSE (.BO)
- Crypto list is in COINS at the top of server.js
- `THRESHOLD=0.01` is the alert odds (0.01 = 1 in 100)

## Notes
- Indian prices and news use Yahoo Finance's unofficial endpoints. They need no key but can change or be rate limited. For production, use Upstox or Kite Connect.
- Prices only move during market hours. Crypto runs all day.
- Signals are rule-based, carry no guarantee, and are not investment advice. Test them on historical data before relying on them.
