// TradrEdge: NASDAQ + NSE + BSE + crypto, probability alerts, Buy/Sell/Hold signal,
// fresh news with images, and push notifications that reach phones even when the app is closed.
// Setup: see README.md.  Run: node server.js
const http = require('http'), fs = require('fs'), path = require('path');
const KEY = process.env.FINNHUB_KEY, PORT = process.env.PORT || 3000, THR = +(process.env.THRESHOLD || 0.01);
if (!KEY) { console.error('Set FINNHUB_KEY (free key at finnhub.io)'); process.exit(1); }
const US = (process.env.STOCKS || 'AAPL,NVDA,TSLA,MSFT,AMZN').split(',');
const INDIA = (process.env.INDIA || 'RELIANCE.NS,TCS.NS,HDFCBANK.NS,INFY.NS,ICICIBANK.NS,SBIN.NS,TATAMOTORS.NS,RELIANCE.BO,^NSEI,^BSESN').split(',');
const COINS = { bitcoin: 'BTC', ethereum: 'ETH', solana: 'SOL' };
const NAMES = { BTC: /bitcoin|\bbtc\b/i, ETH: /ethereum|\bether\b|\beth\b/i, SOL: /solana|\bsol\b/i };
const IDX = { '^NSEI': 'NIFTY 50', '^BSESN': 'SENSEX' };
const A = {}, history = [], clients = new Set();

// ---------- web push (optional: needs `npm install` and VAPID keys) ----------
let webpush = null; try { webpush = require('web-push'); } catch (e) {}
const VP = process.env.VAPID_PUBLIC, VK = process.env.VAPID_PRIVATE, PUSH = !!(webpush && VP && VK);
if (PUSH) webpush.setVapidDetails(process.env.VAPID_EMAIL || 'mailto:admin@example.com', VP, VK);
else console.log('Push disabled (run npm install and set VAPID_PUBLIC / VAPID_PRIVATE). In-page alerts still work.');
const SUBF = path.join(__dirname, 'subs.json'); let SUBS = [];
try { SUBS = JSON.parse(fs.readFileSync(SUBF, 'utf8')); } catch (e) {}
const saveSubs = () => { try { fs.writeFileSync(SUBF, JSON.stringify(SUBS)); } catch (e) {} };
async function sendPush(al) {
  if (!PUSH) return; const n = al.news[0];
  const body = JSON.stringify({ title: `${al.sig.a} signal: ${al.disp} ${al.pct > 0 ? '+' : ''}${al.pct}%`,
    body: (n ? n.h + ' (' + n.s + '). ' : '') + al.sig.w, image: n && n.i, url: '/' });
  for (const sub of SUBS.slice()) { try { await webpush.sendNotification(sub, body); }
    catch (e) { if (e.statusCode === 404 || e.statusCode === 410) { SUBS = SUBS.filter(x => x !== sub); saveSubs(); } } }
}

// ---------- maths ----------
const erf = x => { const s = x < 0 ? -1 : 1; x = Math.abs(x); const t = 1 / (1 + .3275911 * x);
  return s * (1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - .284496736) * t + .254829592) * t * Math.exp(-x * x)); };
const get = async u => { const r = await fetch(u, { headers: { 'User-Agent': 'Mozilla/5.0' } });
  if (!r.ok) throw new Error(r.status + ' ' + u.split('?')[0]); return r.json(); };
const mean = a => a.reduce((s, x) => s + x, 0) / a.length;

function prob(a, r) {
  const w = a.r.slice(-30); if (w.length < 10) return 1;
  const m = mean(w), sd = Math.max(Math.sqrt(w.reduce((s, x) => s + (x - m) ** 2, 0) / (w.length - 1)), 5e-4);
  return Math.max(2 * (1 - .5 * (1 + erf((r - m) / sd / Math.SQRT2))), 1e-9);
}
function signal(a, r) {
  let g = 0, l = 0; a.r.slice(-15).forEach(x => x > 0 ? g += x : l -= x);
  const h = a.h.slice(-21, -1);
  if (h.length < 5) return { a: 'HOLD', cf: 'low', w: 'Not enough price history yet. Wait for confirmation.' };
  const rsi = l === 0 ? 100 : 100 - 100 / (1 + g / l), av = mean(h);
  const sd = Math.sqrt(h.reduce((s, x) => s + (x - av) ** 2, 0) / h.length) || av * 5e-4, dev = (a.p - av) / sd;
  let b = 0, s = 0; r < 0 ? b++ : s++;
  if (rsi < 30) b++; else if (rsi > 70) s++;
  if (dev < -1.5) b++; else if (dev > 1.5) s++;
  const act = b >= 2 ? 'BUY' : s >= 2 ? 'SELL' : 'HOLD', v = Math.max(b, s);
  return { a: act, cf: act === 'HOLD' ? 'low' : v === 3 ? 'high' : 'medium',
    w: act === 'HOLD' ? 'Mixed signals. Wait for confirmation.' :
      `RSI ${Math.round(rsi)}, ${Math.abs(dev).toFixed(1)} deviations ${dev < 0 ? 'below' : 'above'} its recent average.` };
}

// ---------- news: fetched at the moment of the alert, newest first, with images ----------
async function news(sym, a) {
  let items;
  if (a.kind === 'c') {
    const j = await get(`https://finnhub.io/api/v1/news?category=crypto&token=${KEY}`);
    const f = j.filter(n => NAMES[sym].test(n.headline + ' ' + n.summary)); items = (f.length ? f : j)
      .map(n => ({ h: n.headline, u: n.url, i: n.image, s: n.source, t: n.datetime * 1000 }));
  } else if (a.kind === 'i') {
    const q = IDX[sym] || sym.replace(/\.(NS|BO)$/, '') + ' ' + (sym.endsWith('.BO') ? 'BSE' : 'NSE');
    const j = await get('https://query1.finance.yahoo.com/v1/finance/search?quotesCount=0&newsCount=8&q=' + encodeURIComponent(q));
    items = (j.news || []).map(n => ({ h: n.title, u: n.link, s: n.publisher, t: n.providerPublishTime * 1000,
      i: n.thumbnail && n.thumbnail.resolutions && n.thumbnail.resolutions[0] && n.thumbnail.resolutions[0].url }));
  } else {
    const day = d => new Date(Date.now() - d * 864e5).toISOString().slice(0, 10);
    const j = await get(`https://finnhub.io/api/v1/company-news?symbol=${sym}&from=${day(2)}&to=${day(0)}&token=${KEY}`);
    items = j.map(n => ({ h: n.headline, u: n.url, i: n.image, s: n.source, t: n.datetime * 1000 }));
  }
  return items.sort((x, y) => y.t - x.t).slice(0, 3);
}

async function fire(sym, a, r, p) {
  const sg = signal(a, r); let n = [];
  try { n = await news(sym, a); } catch (e) { console.error('news:', e.message); }
  const al = { sym, disp: a.disp, ex: a.ex, cur: a.kind === 'i' ? '₹' : '$', price: +a.p.toFixed(a.p < 1 ? 6 : 2),
    pct: +(r * 100).toFixed(2), odds: Math.round(1 / p), sig: sg, news: n, ts: Date.now() };
  history.unshift(al); history.length = Math.min(history.length, 50);
  clients.forEach(c => c.write('data: ' + JSON.stringify(al) + '\n\n'));
  sendPush(al);
  console.log(`ALERT ${a.disp} ${al.pct}% ${sg.a} (${sg.cf}), ${n.length} headlines`);
}

function feed(sym, kind, price) {
  const ex = kind === 'c' ? 'Crypto' : kind === 'i' ? (sym.endsWith('.BO') || sym === '^BSESN' ? 'BSE' : 'NSE') : 'NASDAQ/US';
  const a = A[sym] || (A[sym] = { kind, ex, disp: IDX[sym] || sym.replace('.NS', ''), r: [], h: [price], p: price, cool: 0 });
  const r = price / a.p - 1; if (r === 0) return;
  const p = prob(a, r), ready = a.r.length >= 10;
  a.r.push(r); a.p = price; a.h.push(price); if (a.h.length > 60) a.h.shift(); a.cool--;
  if (ready && p < THR && a.cool <= 0) { a.cool = 8; fire(sym, a, r, p); }
}

// ---------- price polling ----------
const pollUS = () => Promise.all(US.map(async s => { try {
  const q = await get(`https://finnhub.io/api/v1/quote?symbol=${s}&token=${KEY}`); if (q.c) feed(s, 's', q.c); } catch (e) { console.error(e.message); } }));
const pollIN = () => Promise.all(INDIA.map(async s => { try {
  const j = await get('https://query1.finance.yahoo.com/v8/finance/chart/' + encodeURIComponent(s) + '?interval=1m&range=1d');
  const p = j.chart.result[0].meta.regularMarketPrice; if (p) feed(s, 'i', p); } catch (e) { console.error(s, e.message); } }));
const pollCoins = async () => { try {
  const j = await get('https://api.coingecko.com/api/v3/simple/price?vs_currencies=usd&ids=' + Object.keys(COINS).join());
  for (const id in COINS) if (j[id]) feed(COINS[id], 'c', j[id].usd); } catch (e) { console.error(e.message); } };
setInterval(pollUS, 15000); setInterval(pollIN, 30000); setInterval(pollCoins, 30000); pollUS(); pollIN(); pollCoins();

// ---------- web app ----------
const SW = `self.addEventListener('push',e=>{const d=e.data.json();e.waitUntil(self.registration.showNotification(d.title,{body:d.body,image:d.image,icon:'/icon.svg',badge:'/icon.svg',data:d.url}))});
self.addEventListener('notificationclick',e=>{e.notification.close();e.waitUntil(clients.openWindow(e.notification.data||'/'))});`;
const ICON = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="14" fill="#1f5eff"/><path d="M10 44l14-14 10 8 20-22" fill="none" stroke="#fff" stroke-width="6" stroke-linecap="round" stroke-linejoin="round"/></svg>';
const MANIFEST = JSON.stringify({ name: 'TradrEdge', short_name: 'TradrEdge', start_url: '/', display: 'standalone', background_color: '#0a0e15', theme_color: '#0a0e15', icons: [{ src: '/icon.svg', sizes: 'any', type: 'image/svg+xml' }] });

const PAGE = `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>TradrEdge</title>
<link rel="manifest" href="/manifest.json"><meta name="theme-color" content="#0a0e15"><meta name="apple-mobile-web-app-capable" content="yes">
<style>:root{--bg:#f4f6f9;--p:#fff;--ink:#0e1726;--m:#64718a;--l:#e1e6ee;--u:#0a8f5b;--d:#d1362b;color-scheme:light dark}
@media(prefers-color-scheme:dark){:root{--bg:#0a0e15;--p:#121925;--ink:#e6ebf5;--m:#8592a8;--l:#212b3b;--u:#2fcf8c;--d:#ff6f64}}
body{margin:0;background:var(--bg);color:var(--ink);font:15px/1.4 -apple-system,Segoe UI,Roboto,sans-serif}main{max-width:640px;margin:0 auto;padding:16px 12px 40px}
h1{font-size:20px;margin:0 0 4px}.m{color:var(--m);font-size:13px}button{font:inherit;padding:8px 14px;border-radius:8px;border:1px solid var(--l);background:var(--p);color:var(--ink);margin:10px 0}
.c{background:var(--p);border:1px solid var(--l);border-radius:12px;padding:12px;margin-bottom:12px}.c p{margin:6px 0}.u{color:var(--u)}.d{color:var(--d)}
.s{font-size:12px;font-weight:700;padding:1px 8px;border-radius:5px;border:1px solid currentColor}.BUY{color:var(--u)}.SELL{color:var(--d)}.HOLD{color:var(--m)}
.x{font-size:11px;color:var(--m);border:1px solid var(--l);border-radius:5px;padding:0 5px}
.n{display:flex;gap:10px;align-items:center;text-decoration:none;color:var(--ink);border-top:1px solid var(--l);padding:8px 0}.n img{width:84px;height:64px;object-fit:cover;border-radius:8px;flex:none}.n small{color:var(--m)}</style>
<main><h1>TradrEdge</h1><p class="m">NASDAQ, NSE, BSE and crypto. Alerts arrive with the latest headlines from the moment they fire.</p><button id="n">Turn on alerts</button><div id="l"></div></main>
<script>var L=document.getElementById('l'),pushOn=false;
function ago(t){var m=Math.round((Date.now()-t)/6e4);return m<1?'just now':m<60?m+' min ago':m<1440?Math.round(m/60)+' h ago':Math.round(m/1440)+' d ago'}
function esc(s){return String(s).replace(/[&<>"]/g,function(c){return{'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]})}
function b64(s){s=(s+'='.repeat((4-s.length%4)%4)).replace(/-/g,'+').replace(/_/g,'/');var r=atob(s),o=new Uint8Array(r.length);for(var i=0;i<r.length;i++)o[i]=r.charCodeAt(i);return o}
function card(a){var up=a.pct>0,h='<div class="c"><div><b>'+esc(a.disp)+'</b> <span class="x">'+esc(a.ex)+'</span> <span class="'+(up?'u':'d')+'">'+(up?'▲ ':'▼ ')+Math.abs(a.pct)+'%</span> <span class="s '+a.sig.a+'">'+a.sig.a+'</span></div><div class="m">1 in '+a.odds.toLocaleString()+' move at '+a.cur+a.price+' · '+a.sig.cf+' confidence · '+ago(a.ts)+'</div><p>'+esc(a.sig.w)+'</p>';
h+=a.news.length?a.news.map(function(n){return'<a class="n" href="'+esc(n.u)+'" target="_blank" rel="noopener noreferrer">'+(n.i?'<img src="'+esc(n.i)+'" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="this.remove()">':'')+'<span><b>'+esc(n.h)+'</b><br><small>'+esc(n.s)+' · '+ago(n.t)+'</small></span></a>'}).join(''):'<p class="m">No recent news found.</p>';return h+'</div>'}
fetch('/alerts').then(function(r){return r.json()}).then(function(x){L.innerHTML=x.length?x.map(card).join(''):'<p class="m">No alerts yet. To test, open /test?sym=RELIANCE&dir=down or /test?sym=AAPL&dir=up</p>'});
new EventSource('/events').onmessage=function(e){var a=JSON.parse(e.data);if(L.querySelector('p.m'))L.innerHTML='';L.insertAdjacentHTML('afterbegin',card(a));
if(!pushOn&&window.Notification&&Notification.permission==='granted'){var n=a.news[0];new Notification(a.sig.a+' signal: '+a.disp+' '+a.pct+'%',{body:(n?n.h+' ('+n.s+') ':'')+a.sig.w})}};
if('serviceWorker' in navigator)navigator.serviceWorker.getRegistration().then(function(r){return r&&r.pushManager.getSubscription()}).then(function(s){if(s){pushOn=true;document.getElementById('n').textContent='Alerts on, even when closed'}});
document.getElementById('n').onclick=async function(){var b=this;try{
if(!window.Notification){b.textContent='Not supported here. On iPhone, add to Home Screen first.';return}
var p=await Notification.requestPermission();if(p!=='granted'){b.textContent='Notifications blocked';return}
var v=await fetch('/vapid');
if(v.ok&&'serviceWorker' in navigator&&'PushManager' in window){var reg=await navigator.serviceWorker.register('/sw.js');await navigator.serviceWorker.ready;
var sub=await reg.pushManager.subscribe({userVisibleOnly:true,applicationServerKey:b64((await v.json()).key)});
await fetch('/subscribe',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(sub)});pushOn=true;b.textContent='Alerts on, even when closed'}
else b.textContent='Alerts on while this page is open'}catch(e){b.textContent='Could not enable: '+e.message}}</script>`;

http.createServer((q, s) => {
  const u = new URL(q.url, 'http://x'), send = (t, body, code = 200) => { s.writeHead(code, { 'Content-Type': t }); s.end(body); };
  if (u.pathname === '/events') { s.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
    s.write(':ok\n\n'); clients.add(s); q.on('close', () => clients.delete(s)); return; }
  if (u.pathname === '/alerts') return send('application/json', JSON.stringify(history));
  if (u.pathname === '/sw.js') return send('application/javascript', SW);
  if (u.pathname === '/icon.svg') return send('image/svg+xml', ICON);
  if (u.pathname === '/manifest.json') return send('application/manifest+json', MANIFEST);
  if (u.pathname === '/vapid') return PUSH ? send('application/json', JSON.stringify({ key: VP })) : send('text/plain', 'push off', 404);
  if (u.pathname === '/subscribe' && q.method === 'POST') { let b = ''; q.on('data', c => { b += c; if (b.length > 1e5) q.destroy(); });
    q.on('end', () => { try { const sub = JSON.parse(b);
      if (sub && sub.endpoint && !SUBS.some(x => x.endpoint === sub.endpoint)) { SUBS.push(sub); saveSubs(); } send('text/plain', 'ok'); }
      catch (e) { send('text/plain', 'bad', 400); } }); return; }
  if (u.pathname === '/test') { const want = (u.searchParams.get('sym') || '').toUpperCase();
    const key = Object.keys(A).find(k => k.toUpperCase() === want || A[k].disp.toUpperCase() === want);
    if (!key) return send('text/plain', 'Not tracked yet: ' + want + '. Tracked: ' + Object.values(A).map(x => x.disp).join(', '), 404);
    fire(key, A[key], u.searchParams.get('dir') === 'up' ? .03 : -.03, 1e-4); return send('text/plain', 'Test alert sent for ' + want + '. Check the main page.'); }
  send('text/html; charset=utf-8', PAGE);
}).listen(PORT, () => console.log('TradrEdge running on http://localhost:' + PORT));
