// EnergyPulse PWA — plain JavaScript, no build step, no dependencies.
// Data comes from data/live/*.json (written daily by the GitHub Actions robot)
// or data/demo/*.json (illustrative). The two are NEVER mixed.

const $view = document.getElementById('view');
const $pill = document.getElementById('mode-pill');
const $banner = document.getElementById('demo-banner');

// ---------------------------------------------------------------- settings
const store = {
  get(k, d) { try { const v = localStorage.getItem('ep.' + k); return v === null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem('ep.' + k, JSON.stringify(v)); } catch { /* private mode */ } },
};
let mode = store.get('mode', 'live');            // 'live' | 'demo'
const cache = {};                                 // per-mode in-memory cache
let deferredPrompt = null;                        // Android install prompt, when Chrome offers one

async function load(name) {
  const key = mode + '/' + name;
  if (cache[key]) return cache[key];
  try {
    const res = await fetch(`data/${mode}/${name}.json`, { cache: 'no-cache' });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const json = await res.json();
    // Safety net: refuse data whose declared mode doesn't match the selected mode.
    if (json.mode !== mode) throw new Error(`File says mode "${json.mode}", expected "${mode}"`);
    cache[key] = json;
    return json;
  } catch (e) {
    return { mode, status: 'error', last_error: String(e.message || e) };
  }
}

// ---------------------------------------------------------------- helpers
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmt = (n, d = 2) => (n == null || isNaN(n) ? '—' : Number(n).toLocaleString('en-IN', { minimumFractionDigits: d, maximumFractionDigits: d }));
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const fmtDate = (s) => { if (!s) return '—'; const [y, m, d] = s.slice(0, 10).split('-'); return d ? `${+d} ${MONTHS[m - 1]} ${y}` : `${MONTHS[m - 1]} ${y}`; };
const fmtMonth = (s) => { const [y, m] = s.split('-'); return `${MONTHS[m - 1]} ${y.slice(2)}`; };
function ago(iso) {
  if (!iso) return '';
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 60) return `${Math.max(mins, 1)}m ago`;
  const h = Math.round(mins / 60); if (h < 48) return `${h}h ago`;
  return `${Math.round(h / 24)}d ago`;
}
function changeHtml(latest, previous, unit = '') {
  if (!latest || !previous) return '';
  const diff = latest - previous, pct = (diff / previous) * 100;
  const cls = diff > 0 ? 'up' : diff < 0 ? 'down' : '';
  const arrow = diff > 0 ? '▲' : diff < 0 ? '▼' : '■';
  return `<span class="change ${cls}">${arrow} ${fmt(Math.abs(diff))}${unit} (${fmt(Math.abs(pct), 1)}%)</span>`;
}
const STATUS_TEXT = { ok: 'Live', stale: 'Stale', partial: 'Partly live', error: 'Unavailable', not_configured: 'Not set up', demo: 'Demo' };
function badge(obj) {
  const st = mode === 'demo' ? 'demo' : (obj?.status || 'error');
  const when = obj?.checked_at && mode === 'live' ? ` · ${ago(obj.checked_at)}` : '';
  return `<span class="badge ${st}" title="${esc(obj?.last_error || '')}">${STATUS_TEXT[st] || st}${when}</span>`;
}
function unavailable(obj, what) {
  const reason = obj?.status === 'not_configured' ? 'This feed is not set up yet (see the Sources tab).'
    : 'No verified data available right now.';
  return `<div class="unavailable">${esc(what)}: ${reason}<br><span class="small">Live mode never substitutes demo numbers.</span></div>`;
}

// Only compare with a previous value that is close in time (PPAC's daily archive has gaps).
function recentPrev(obj, maxDays = 7) {
  const a = obj?.latest, b = obj?.previous;
  if (!a || !b) return null;
  return (new Date(a.date) - new Date(b.date)) / 864e5 <= maxDays ? b : null;
}
function recentHistory(obj, days = 120) {
  const h = obj?.history || []; if (!h.length) return [];
  const cutoff = new Date(h.at(-1).date) - days * 864e5;
  return h.filter((p) => new Date(p.date) >= cutoff);
}

// Automatic update schedule (keep in sync with the cron lines in .github/workflows/update-and-deploy.yml)
const UPDATE_SLOTS_IST = [[8, 0], [16, 0]];
const slotLabel = ([h, m]) => `${((h + 11) % 12) + 1}:${String(m).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`;
const SCHEDULE_TEXT = `Updates automatically every day at ${UPDATE_SLOTS_IST.map(slotLabel).join(' and ')} IST`;
function nextUpdateLabel() {
  const ist = new Date(Date.now() + 5.5 * 3600e3);              // IST clock read via UTC getters
  const mins = ist.getUTCHours() * 60 + ist.getUTCMinutes();
  const next = UPDATE_SLOTS_IST.find(([h, m]) => h * 60 + m > mins);
  return next ? `today ${slotLabel(next)}` : `tomorrow ${slotLabel(UPDATE_SLOTS_IST[0])}`;
}
function scheduleNote(meta) {
  const last = mode === 'live' && meta?.generated_at_ist ? `Last updated <b>${esc(meta.generated_at_ist.replace(' IST', ''))}</b> · ` : '';
  return `<div class="schedule"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>
    <span>${last}${SCHEDULE_TEXT}. Next update ${nextUpdateLabel()} (may run a few minutes late).</span></div>`;
}

async function renderTicker() {
  const el = document.getElementById('ticker'); if (!el) return;
  const meta = await load('meta');
  const parts = [`⏱ Next update ${nextUpdateLabel()} IST`, `🔄 ${SCHEDULE_TEXT}`];
  if (mode === 'live' && meta.generated_at_ist) parts.push(`✓ Last updated ${meta.generated_at_ist}`);
  if (mode === 'demo') parts.unshift('⚠ DEMO DATA — not real prices');
  const seg = parts.map((p) => `<span>${esc(p)}</span>`).join('<span class="dot">•</span>');
  el.innerHTML = `<div class="ticker-seg">${seg}<span class="dot">•</span></div><div class="ticker-seg" aria-hidden="true">${seg}<span class="dot">•</span></div>`;
}
setInterval(renderTicker, 60000);                                // keep "next update" current

// ---------------------------------------------------------------- install prompt
const isStandalone = () => window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
const isIOS = () => /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

// Works out which browser this is and how to add the app to the home screen in it.
const ICO = {
  share: '<svg class="inline-ico" viewBox="0 0 24 24"><path d="M12 3v12M8 7l4-4 4 4M5 12v7a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-7"/></svg>',
  dots: '<b>⋯</b>', kebab: '<b>⋮</b>',
};
function installGuide() {
  const ua = navigator.userAgent;
  const inApp = /FBAN|FBAV|Instagram|WhatsApp|Line\/|LinkedInApp|Snapchat|Twitter|GSA\//i.test(ua);
  if (isIOS()) {
    if (inApp) return { name: 'an in-app browser', steps: [
      `Tap ${ICO.dots} or the compass/browser icon and choose <b>Open in Safari</b>.`,
      'Then tap <b>Install app</b> again on this card for the Safari steps.'] };
    if (/CriOS/.test(ua)) return { name: 'Chrome on iPhone', steps: [
      `Tap the <b>Share</b> icon ${ICO.share} in the address bar (top right).`,
      'Scroll down and tap <b>Add to Home Screen</b>.', 'Tap <b>Add</b>.'] };
    if (/FxiOS/.test(ua)) return { name: 'Firefox on iPhone', steps: [
      'Tap the menu <b>☰</b> (bottom right).', `Tap <b>Share</b> ${ICO.share}.`,
      'Tap <b>Add to Home Screen</b>, then <b>Add</b>.'] };
    if (/EdgiOS/.test(ua)) return { name: 'Edge on iPhone', steps: [
      `Tap the menu ${ICO.dots} (bottom).`, `Tap <b>Share</b> ${ICO.share}.`,
      'Tap <b>Add to Home Screen</b>, then <b>Add</b>.'] };
    return { name: 'Safari on iPhone', steps: [
      `Tap the <b>Share</b> button ${ICO.share}. If you don't see it, tap ${ICO.dots} at the bottom right first, then <b>Share</b>.`,
      'Scroll down and tap <b>Add to Home Screen</b> (tap <b>View More</b> if it isn\'t listed).',
      'Keep <b>Open as Web App</b> on and tap <b>Add</b>.'] };
  }
  if (/Android/i.test(ua)) {
    if (inApp) return { name: 'an in-app browser', steps: [
      `Tap ${ICO.kebab} (top right) and choose <b>Open in Chrome</b>.`,
      'Then tap <b>Install app</b> again on this card.'] };
    if (/SamsungBrowser/.test(ua)) return { name: 'Samsung Internet', steps: [
      'Tap the menu <b>☰</b> (bottom right).', 'Tap <b>Add page to</b> → <b>Home screen</b>.', 'Tap <b>Add</b>.'] };
    if (/Firefox/.test(ua)) return { name: 'Firefox on Android', steps: [
      `Tap the menu ${ICO.kebab}.`, 'Tap <b>Add app to Home screen</b> (or <b>Install</b>).', 'Tap <b>Add</b>.'] };
    if (/EdgA/.test(ua)) return { name: 'Edge on Android', steps: [
      'Tap the menu <b>☰</b> or ⋯ (bottom).', 'Tap <b>Add to phone</b> / <b>Add to Home screen</b>.', 'Tap <b>Install</b>.'] };
    return { name: 'Chrome on Android', steps: [
      `Tap the menu ${ICO.kebab} (top right).`, 'Tap <b>Add to Home screen</b> or <b>Install app</b>.', 'Tap <b>Install</b>.'] };
  }
  if (/Edg\//.test(ua)) return { name: 'Edge', steps: [
    'Click the <b>App available</b> icon in the address bar, or menu ⋯ → <b>Apps</b> → <b>Install this site as an app</b>.', 'Click <b>Install</b>.'] };
  if (/Chrome\//.test(ua)) return { name: 'Chrome', steps: [
    'Click the <b>Install</b> icon at the right end of the address bar, or menu ⋮ → <b>Cast, save and share</b> → <b>Install page as app</b>.', 'Click <b>Install</b>.'] };
  if (/Safari\//.test(ua) && /Macintosh/.test(ua)) return { name: 'Safari on Mac', steps: [
    'In the menu bar choose <b>File</b> → <b>Add to Dock</b>.', 'Click <b>Add</b>.'] };
  if (/Firefox/.test(ua)) return { name: 'Firefox', steps: [
    'Firefox on computers can\'t install web apps.', 'Open this page in <b>Chrome</b>, <b>Edge</b> or <b>Safari</b> to install it.'] };
  return { name: 'your browser', steps: ['Open the browser menu and look for <b>Add to Home screen</b> or <b>Install app</b>.'] };
}
const isMobile = () => isIOS() || /Android/i.test(navigator.userAgent);

function installCard() {
  if (isStandalone() || store.get('installDismissed', false)) return '';
  const g = installGuide();
  return `<div class="card install-card"><div class="row"><b>📲 Get EnergyPulse on your ${isMobile() ? 'home screen' : 'computer'}</b>
    <button class="x" data-action="install-dismiss" aria-label="Dismiss">✕</button></div>
    <p class="small muted" style="margin:4px 0 10px">Opens full screen like an app, with its own icon.</p>
    <button class="btn accent" data-action="install">Install app</button>
    <div id="install-steps" class="install-steps" hidden>
      <p class="small" style="margin:12px 0 4px">In <b>${esc(g.name)}</b>:</p>
      <ol class="small">${g.steps.map((x) => `<li>${x}</li>`).join('')}</ol>
    </div></div>`;
}

// ---------------------------------------------------------------- chart (SVG)
let chartSeq = 0;
function chart(points, { type = 'line', height = 170, unit = '', label = fmtDate } = {}) {
  if (!points || points.length < 2) return '<div class="unavailable small">Not enough history for a chart yet.</div>';
  const id = 'c' + (++chartSeq);
  const W = 600, H = height + 20, P = { l: 52, r: 10, t: 12, b: 28 };
  const ys = points.map((p) => p.y);
  let min = Math.min(...ys), max = Math.max(...ys);
  if (type === 'bar') min = Math.min(0, min);
  const pad = (max - min) * 0.08 || 1; if (type !== 'bar') min -= pad; max += pad;
  const X = (i) => P.l + (i * (W - P.l - P.r)) / (points.length - 1 || 1);
  const Y = (v) => P.t + (1 - (v - min) / (max - min)) * (H - P.t - P.b);
  const ticks = [min, (min + max) / 2, max];
  let svg = `<svg class="chart" id="${id}" viewBox="0 0 ${W} ${H}" role="img" aria-label="chart">`;
  for (const t of ticks) svg += `<line class="grid-line" x1="${P.l}" x2="${W - P.r}" y1="${Y(t)}" y2="${Y(t)}"/><text class="axis" x="${P.l - 6}" y="${Y(t) + 3}" text-anchor="end">${fmt(t, t > 999 ? 0 : 1)}</text>`;
  svg += `<text class="axis" x="${P.l}" y="${H - 6}">${esc(label(points[0].x))}</text><text class="axis" x="${W - P.r}" y="${H - 6}" text-anchor="end">${esc(label(points.at(-1).x))}</text>`;
  if (type === 'bar') {
    const bw = Math.max(4, ((W - P.l - P.r) / points.length) * 0.65);
    const step = (W - P.l - P.r) / points.length;
    points.forEach((p, i) => { const x = P.l + step * i + (step - bw) / 2; svg += `<rect class="bar" x="${x}" y="${Y(p.y)}" width="${bw}" height="${Y(min) - Y(p.y)}" rx="3"/>`; });
  } else {
    const d = points.map((p, i) => `${i ? 'L' : 'M'}${X(i).toFixed(1)},${Y(p.y).toFixed(1)}`).join('');
    svg += `<path class="area" d="${d}L${X(points.length - 1)},${H - P.b}L${P.l},${H - P.b}Z"/><path class="line" d="${d}"/>`;
    svg += `<circle class="dot" cx="${X(points.length - 1)}" cy="${Y(points.at(-1).y)}" r="4"/>`;
  }
  svg += `<line class="cursor" x1="0" x2="0" y1="${P.t}" y2="${H - P.b}" visibility="hidden"/></svg><div class="chart-tip" id="${id}-tip">Touch the chart to read values.</div>`;
  // interaction is wired after insertion
  queueMicrotask(() => {
    const el = document.getElementById(id); if (!el) return;
    const tip = document.getElementById(id + '-tip'); const cur = el.querySelector('.cursor');
    const onMove = (ev) => {
      const r = el.getBoundingClientRect(); const x = ((ev.clientX - r.left) / r.width) * W;
      let i;
      if (type === 'bar') i = Math.floor(((x - P.l) / (W - P.l - P.r)) * points.length);
      else i = Math.round(((x - P.l) / (W - P.l - P.r)) * (points.length - 1));
      i = Math.max(0, Math.min(points.length - 1, i));
      const cx = type === 'bar' ? P.l + ((W - P.l - P.r) / points.length) * (i + 0.5) : X(i);
      cur.setAttribute('x1', cx); cur.setAttribute('x2', cx); cur.setAttribute('visibility', 'visible');
      tip.textContent = `${label(points[i].x)}: ${fmt(points[i].y)}${unit}`;
    };
    el.addEventListener('pointermove', onMove); el.addEventListener('pointerdown', onMove);
  });
  return svg;
}

// ---------------------------------------------------------------- views
async function viewHome() {
  const [basket, markets, news, meta] = await Promise.all([load('basket'), load('markets'), load('news'), load('meta')]);
  const s = Object.fromEntries((markets.series || []).map((x) => [x.id, x]));
  const fx = s.usdinr?.latest?.usd;
  const b = basket.latest;

  const hero = b ? `
    <div class="row"><span class="muted small">Indian Crude Basket · ${fmtDate(b.date)}</span>${badge(basket)}</div>
    <div class="big">$${fmt(b.usd)}<span class="muted" style="font-size:15px;font-weight:500"> /bbl</span></div>
    ${recentPrev(basket) ? `<div>${changeHtml(b.usd, recentPrev(basket).usd)} <span class="muted small">vs ${fmtDate(recentPrev(basket).date)}</span></div>` : ''}
    ${fx ? `<div class="muted small" style="margin-top:6px">≈ ₹${fmt(b.usd * fx, 0)} /bbl at ₹${fmt(fx)} per $ (derived)</div>` : ''}
    ${basketChart(basket)}`
    : `<div class="row"><b>Indian Crude Basket</b>${badge(basket)}</div>${unavailable(basket, 'Indian Crude Basket')}`;

  const mini = (x, prefix = '$') => {
    if (!x) return '';
    const body = x.latest ? `<div class="mid">${prefix}${fmt(x.latest.usd)}</div>${changeHtml(x.latest.usd, x.previous?.usd)}<div class="muted small">${fmtDate(x.latest.date)}</div>`
      : `<div class="muted small" style="margin-top:6px">${STATUS_TEXT[x.status] || 'Unavailable'}</div>`;
    return `<div class="card"><div class="row"><span class="small muted">${esc(x.name.split(' (')[0])}</span>${badge(x)}</div>${body}</div>`;
  };

  const items = news.items || [];
  const safety = items.filter((i) => i.category === 'safety');
  const top = items.slice(0, 5);

  return `
    ${installCard()}
    <h1>Today</h1>
    <div class="card hero">${hero}</div>
    <div class="section-title">Benchmarks</div>
    <div class="grid four">${mini(s.brent)}${mini(s.wti)}${mini(s.usdinr, '₹')}
      <div class="card"><div class="row"><span class="small muted">Safety alerts (7d)</span>${badge(news)}</div>
        <div class="mid">${news.items ? safety.length : '—'}</div><a href="#/news?c=safety" class="small">View incidents →</a></div>
    </div>
    <div class="section-title">Latest headlines</div>
    ${news.items ? newsList(top) : unavailable(news, 'News')}
    <p class="disclaimer">Prices are indicative and for information only.</p>`;
}

function basketChart(basket) {
  const daily = recentHistory(basket).map((p) => ({ x: p.date, y: p.usd }));
  if (daily.length >= 10) return chart(daily, { unit: ' $/bbl' });
  const monthly = (basket.monthly || []).map((p) => ({ x: p.month, y: p.usd }));
  if (monthly.length >= 2) return `<div class="small muted" style="margin-top:10px">Monthly average ($/bbl)</div>${chart(monthly, { type: 'bar', unit: ' $/bbl', label: fmtMonth })}`;
  return '';
}

let mktRange = 90;
async function viewMarkets() {
  const [basket, markets] = await Promise.all([load('basket'), load('markets')]);
  const s = Object.fromEntries((markets.series || []).map((x) => [x.id, x]));
  const monthly = (basket.monthly || []);
  const comp = basket.composition;

  const seriesCard = (x, unit, prefix = '$') => {
    if (!x) return '';
    const pts = (x.history || []).map((p) => ({ x: p.date, y: p.usd })).slice(-mktRange);
    return `<div class="card"><div class="row"><h2>${esc(x.name)}</h2>${badge(x)}</div>
      ${x.latest ? `<div class="row"><div class="mid">${prefix}${fmt(x.latest.usd)}</div>${changeHtml(x.latest.usd, x.previous?.usd)}</div>
      <div class="muted small">${fmtDate(x.latest.date)} · ${esc(x.source?.name || '')}</div>${chart(pts, { unit })}` : unavailable(x, x.name)}
    </div>`;
  };

  // Basket vs Brent differential on matching dates
  let diffCard = '';
  if (basket.history?.length && s.brent?.history?.length) {
    const brentBy = Object.fromEntries(s.brent.history.map((p) => [p.date, p.usd]));
    const pts = basket.history.filter((p) => brentBy[p.date] != null).map((p) => ({ x: p.date, y: p.usd - brentBy[p.date] }));
    if (pts.length) diffCard = `<div class="card"><div class="row"><h2>Indian Basket minus Brent</h2><span class="muted small">${pts.length} matching days</span></div>
      <div class="mid">${pts.at(-1).y >= 0 ? '+' : '−'}$${fmt(Math.abs(pts.at(-1).y))}</div><div class="muted small">${fmtDate(pts.at(-1).x)}</div>${chart(pts, { unit: ' $/bbl' })}</div>`;
  }

  return `
    <h1>Markets</h1>
    <div class="card hero">
      <div class="row"><h2>Indian Crude Basket</h2>${badge(basket)}</div>
      ${basket.latest ? `<div class="row"><div class="mid">$${fmt(basket.latest.usd)}</div>${changeHtml(basket.latest.usd, recentPrev(basket)?.usd)}</div>
        <div class="muted small">${fmtDate(basket.latest.date)} · ${esc(basket.source?.name || '')}</div>` : unavailable(basket, 'Indian Crude Basket')}
      ${recentHistory(basket, mktRange * 1.45).length >= 10 ? `<div class="small muted" style="margin-top:10px">Daily ($/bbl)</div>${chart(recentHistory(basket, mktRange * 1.45).map((p) => ({ x: p.date, y: p.usd })), { unit: ' $/bbl' })}` : ''}
      ${monthly.length ? `<div class="small muted" style="margin-top:12px">Monthly average ($/bbl)</div>${chart(monthly.map((p) => ({ x: p.month, y: p.usd })), { type: 'bar', unit: ' $/bbl', label: fmtMonth })}` : ''}
      ${comp ? `<details style="margin-top:10px"><summary class="small"><b>Basket composition (ICB ratio)</b></summary>
        <p class="small muted">${esc(comp.explanation)}</p>
        <table><tr><th>Month</th><th class="num">Ratio (as published)</th></tr>
        ${comp.ratios.slice().reverse().map((r) => `<tr><td>${fmtMonth(r.month)}</td><td class="num">${esc(r.ratio)}</td></tr>`).join('')}</table>
        <p class="small"><a href="${esc(comp.source?.url)}" target="_blank" rel="noopener">Source: PPAC</a></p></details>` : ''}
    </div>
    <div class="row" style="margin:16px 2px 8px"><span class="section-title" style="margin:0">International</span>
      <div class="seg" id="range">${[[30, '1M'], [90, '3M'], [260, '1Y']].map(([d, l]) => `<button data-range="${d}" class="${d === mktRange ? 'on' : ''}">${l}</button>`).join('')}</div></div>
    <div class="grid two">${seriesCard(s.brent, ' $/bbl')}${seriesCard(s.wti, ' $/bbl')}${seriesCard(s.usdinr, ' ₹/$', '₹')}${diffCard}</div>`;
}

let newsCat = 'all', newsQuery = '';
function newsList(items) {
  if (!items.length) return '<div class="unavailable">No headlines match.</div>';
  return `<ul class="news-list">${items.map((i) => `
    <li class="card news-item"><a href="${esc(i.link)}" target="_blank" rel="noopener noreferrer">
      <div class="title">${esc(i.title)}</div>
      <div class="meta"><span class="tag ${esc(i.category)}">${esc((cache[mode + '/news']?.categories || {})[i.category] || i.category)}</span>
      <span>${esc(i.source)}</span>${i.published ? `<span>· ${ago(i.published)}</span>` : ''}</div></a></li>`).join('')}</ul>`;
}
async function viewNews(params) {
  const news = await load('news');
  if (params.get('c')) newsCat = params.get('c');
  const cats = { all: 'All', ...(news.categories || {}) };
  const items = (news.items || []).filter((i) => (newsCat === 'all' || i.category === newsCat)
    && (!newsQuery || i.title.toLowerCase().includes(newsQuery.toLowerCase())));
  return `
    <div class="row"><h1>News</h1>${badge(news)}</div>
    <div class="chips" id="chips">${Object.entries(cats).map(([k, v]) => `<button class="chip ${k === newsCat ? 'on' : ''}" data-cat="${k}">${esc(v)}</button>`).join('')}</div>
    <input class="search" id="q" type="search" placeholder="Search headlines…" value="${esc(newsQuery)}">
    ${newsCat === 'safety' ? '<p class="small muted">Headlines mentioning fires, explosions or leaks at refineries and petrochemical plants in the last 7 days, matched automatically by keyword. Check the original report before acting on it.</p>' : ''}
    <div id="news-results">${news.items ? newsList(items) : unavailable(news, 'News')}</div>
    <p class="disclaimer">${esc(news.source?.note || '')}</p>`;
}

async function viewImpact() {
  const [basket, markets] = await Promise.all([load('basket'), load('markets')]);
  const fx = (markets.series || []).find((x) => x.id === 'usdinr')?.latest?.usd;
  const m = basket.monthly || [];
  const defChange = 1;
  const lastMove = recentPrev(basket) ? basket.latest.usd - recentPrev(basket).usd : null;
  const saved = store.get('calc', {});
  const v = { change: saved.change ?? defChange, fx: saved.fx ?? (fx ? +fx.toFixed(2) : 88), mmt: saved.mmt ?? 70, bpt: saved.bpt ?? 7.33 };
  return `
    <h1>Crude cost impact</h1>
    <div class="card">
      <p class="small muted" style="margin-top:0">Estimate how a change in crude price moves the annual crude bill. Change any number; your inputs are remembered on this device.</p>
      <div class="field"><label for="c-change">Change in crude price ($/bbl)</label><input id="c-change" type="number" step="0.1" inputmode="decimal" value="${v.change}">
        <span class="hint">Starts at $1/bbl to show the sensitivity.${lastMove != null ? ` Latest Indian Basket move: ${lastMove >= 0 ? '+' : '−'}$${fmt(Math.abs(lastMove))} (${fmtDate(recentPrev(basket).date)} → ${fmtDate(basket.latest.date)}).` : ''}${m.length >= 2 ? ` Monthly average move ${fmtMonth(m.at(-2).month)} → ${fmtMonth(m.at(-1).month)}: ${m.at(-1).usd - m.at(-2).usd >= 0 ? '+' : '−'}$${fmt(Math.abs(m.at(-1).usd - m.at(-2).usd))}.` : ''}</span></div>
      <div class="field"><label for="c-fx">Exchange rate (₹ per $)</label><input id="c-fx" type="number" step="0.01" inputmode="decimal" value="${v.fx}">
        <span class="hint">${fx ? 'Pre-filled with the latest live USD/INR reference rate.' : 'Live rate unavailable; enter the rate you want to use.'}</span></div>
      <div class="field"><label for="c-mmt">Crude processed (million tonnes per year)</label><input id="c-mmt" type="number" step="0.1" inputmode="decimal" value="${v.mmt}">
        <span class="hint">Assumption — set this to the refinery or company throughput you want to model.</span></div>
      <div class="field"><label for="c-bpt">Barrels per tonne</label><input id="c-bpt" type="number" step="0.01" inputmode="decimal" value="${v.bpt}">
        <span class="hint">7.33 is a common average; lighter crude has more barrels per tonne.</span></div>
      <div class="result" id="calc-out"></div>
      <button class="btn secondary" id="calc-reset" style="margin-top:12px">Reset to defaults</button>
    </div>
    <p class="disclaimer">Indicative only. The Indian Basket is a national reference price, not any company's actual delivered crude cost, which also depends on its crude slate, contract differentials, freight and duties.</p>`;
}
function wireCalc() {
  const ids = ['change', 'fx', 'mmt', 'bpt'];
  const out = document.getElementById('calc-out'); if (!out) return;
  const run = () => {
    const [change, fx, mmt, bpt] = ids.map((k) => parseFloat(document.getElementById('c-' + k).value));
    store.set('calc', { change, fx, mmt, bpt });
    if ([change, fx, mmt, bpt].some((n) => isNaN(n))) { out.innerHTML = 'Enter all four numbers.'; return; }
    const bbl = mmt * 1e6 * bpt;                       // barrels per year
    const crore = (change * bbl * fx) / 1e7;           // ₹ crore per year
    const perRupee = (((basketPrice ?? 0) * bbl) / 1e7);  // ₹1 move in FX
    out.innerHTML = `
      <div class="small muted">Change in annual crude bill</div>
      <div class="mid">${crore >= 0 ? '+' : '−'}₹${fmt(Math.abs(crore), 0)} crore / year</div>
      <div class="small">≈ ₹${fmt(Math.abs(crore) / 12, 0)} crore per month · ₹${fmt(Math.abs(crore) / 365, 1)} crore per day · ${fmt(bbl / 1e6, 0)} million bbl/yr</div>
      ${basketPrice ? `<div class="small" style="margin-top:8px">Every ₹1 move in USD/INR changes the bill by about <b>₹${fmt(perRupee, 0)} crore / year</b> at the current basket price ($${fmt(basketPrice)}).</div>` : ''}
      <div class="formula" style="margin-top:8px">Δ$/bbl × MMT × 10⁶ × bbl/t × ₹/$ ÷ 10⁷</div>`;
  };
  ids.forEach((k) => document.getElementById('c-' + k).addEventListener('input', run));
  document.getElementById('calc-reset').addEventListener('click', () => { store.set('calc', {}); route(); });
  run();
}
let basketPrice = null;

async function viewAbout() {
  const [meta, basket, markets, news] = await Promise.all([load('meta'), load('basket'), load('markets'), load('news')]);
  const rows = [
    ['Indian Crude Basket', basket, basket.source],
    ...((markets.series || []).map((x) => [x.name, x, x.source])),
    ['News & safety headlines', news, news.source],
  ];
  return `
    <h1>Data sources</h1>
    <div class="card">
      <div class="row"><h2>Data mode</h2><div class="seg" id="mode-seg">
        <button data-mode="live" class="${mode === 'live' ? 'on' : ''}">Live</button>
        <button data-mode="demo" class="${mode === 'demo' ? 'on' : ''}">Demo</button></div></div>
      <p class="small muted">Live shows only real, attributed data refreshed by the daily robot. Demo shows made-up numbers for trying the app and is always marked with an orange banner.</p>
      ${scheduleNote(meta)}
    </div>
    <div class="section-title">Feeds</div>
    <div class="card"><table><tr><th>Feed</th><th>Status</th></tr>
      ${rows.map(([n, o, src]) => `<tr><td>${esc(n)}<br><span class="small muted">${src?.url ? `<a href="${esc(src.url)}" target="_blank" rel="noopener">${esc(src.name)}</a>` : esc(src?.name || '')}</span>
        ${o.last_error && mode === 'live' ? `<br><span class="small muted">${esc(o.last_error).slice(0, 160)}</span>` : ''}</td><td>${badge(o)}</td></tr>`).join('')}
    </table></div>
    <div class="section-title">Install on your phone</div>
    <div class="card small">
      ${isStandalone() ? '<p style="margin-top:0">✓ Installed — you are using the home-screen app.</p>' : ''}
      <p style="margin-top:0"><b>Android (Chrome):</b> tap ⋮ → <i>Add to Home screen</i> / <i>Install app</i>.</p>
      <p><b>iPhone (Safari):</b> tap Share <span aria-hidden="true">⎋</span> → <i>Add to Home Screen</i>.</p>
      <button class="btn accent" id="install-btn" hidden>Install EnergyPulse</button>
    </div>
    <p class="disclaimer">EnergyPulse is an information dashboard. Prices are indicative; headlines link to their publishers. Not investment advice.</p>`;
}

// ---------------------------------------------------------------- router
const VIEWS = { home: viewHome, markets: viewMarkets, news: viewNews, impact: viewImpact, about: viewAbout };
async function route() {
  const [path, qs] = (location.hash.slice(2) || 'home').split('?');
  const name = VIEWS[path] ? path : 'home';
  document.querySelectorAll('.tabbar a').forEach((a) => a.classList.toggle('on', a.dataset.tab === name));
  renderMode();
  renderTicker();
  if (name === 'impact') { const b = await load('basket'); basketPrice = b.latest?.usd ?? null; }
  $view.innerHTML = await VIEWS[name](new URLSearchParams(qs || ''));
  if (name === 'impact') wireCalc();
  if (name === 'about') wireInstall();
}
function renderMode() {
  $banner.hidden = mode !== 'demo';
  $pill.className = 'mode-pill' + (mode === 'demo' ? ' demo' : '');
  $pill.textContent = mode === 'demo' ? 'DEMO' : 'Live data';
}
function setMode(m) { mode = m; store.set('mode', m); route(); }

document.addEventListener('click', (e) => {
  const t = e.target.closest('button'); if (!t) return;
  if (t.dataset.action === 'go-live') setMode('live');
  if (t.dataset.mode) setMode(t.dataset.mode);
  if (t.dataset.range) { mktRange = +t.dataset.range; route(); }
  if (t.dataset.cat) { newsCat = t.dataset.cat; history.replaceState(null, '', '#/news'); route(); }
});
document.addEventListener('input', async (e) => {
  if (e.target.id !== 'q') return;
  newsQuery = e.target.value;
  const news = await load('news');
  const items = (news.items || []).filter((i) => (newsCat === 'all' || i.category === newsCat) && i.title.toLowerCase().includes(newsQuery.toLowerCase()));
  document.getElementById('news-results').innerHTML = news.items ? newsList(items) : '';
});
window.addEventListener('hashchange', route);

// Pull fresh data when the app comes back to the foreground
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') { for (const k in cache) delete cache[k]; route(); }
});

// ---------------------------------------------------------------- install + service worker
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault(); deferredPrompt = e; wireInstall();
  if ((location.hash || '#/home').startsWith('#/home')) route();
});
window.addEventListener('appinstalled', () => { deferredPrompt = null; store.set('installDismissed', true); route(); });
document.addEventListener('click', async (e) => {
  const t = e.target.closest('[data-action]'); if (!t) return;
  if (t.dataset.action === 'install') {
    if (deferredPrompt) { deferredPrompt.prompt(); await deferredPrompt.userChoice; deferredPrompt = null; route(); return; }
    const steps = document.getElementById('install-steps');     // no system pop-up here: show this browser's steps
    if (steps) { steps.hidden = !steps.hidden; if (!steps.hidden) steps.scrollIntoView({ behavior: 'smooth', block: 'nearest' }); }
  }
  if (t.dataset.action === 'install-dismiss') { store.set('installDismissed', true); t.closest('.install-card')?.remove(); }
});
function wireInstall() {
  const b = document.getElementById('install-btn'); if (!b || !deferredPrompt) return;
  b.hidden = false;
  b.onclick = async () => { deferredPrompt.prompt(); await deferredPrompt.userChoice; deferredPrompt = null; b.hidden = true; };
}
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
}

route();
