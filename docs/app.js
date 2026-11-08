'use strict';
/* Listening History - single-page explorer for Spotify Extended Streaming History.
   Data: data/meta.json, data/library.json, data/plays.json (columnar), data/art.json (optional). */

// ---------------------------------------------------------------- utilities
const $ = (s, el = document) => el.querySelector(s);
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MONTH = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const DOW = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmtInt = n => Math.round(n).toLocaleString('en-US');
const pct = (x, d = 0) => (isFinite(x) ? (x * 100).toFixed(d) : '0') + '%';
function fmtH(sec) {
  const h = sec / 3600;
  if (h < 1) return Math.round(sec / 60) + ' min';
  if (h < 10) return h.toFixed(1) + ' h';
  return fmtInt(h) + ' h';
}
const fmtHnum = sec => { const h = sec / 3600; return h === 0 ? '0' : h < 10 ? h.toFixed(1) : fmtInt(h); };
const dateOf = t => new Date(t * 1000);
function fmtDate(t) { if (!isFinite(t)) return '–'; const d = dateOf(t); return `${MON[d.getUTCMonth()]} ${d.getUTCDate()}, ${d.getUTCFullYear()}`; }
const fmtDay = day => fmtDate(day * 86400);
function fmtTime(t) { const d = dateOf(t); let h = d.getUTCHours(); const m = d.getUTCMinutes(); const ap = h < 12 ? 'am' : 'pm'; h = h % 12 || 12; return `${h}:${String(m).padStart(2, '0')} ${ap}`; }
const hourLabel = h => (h % 12 || 12) + (h < 12 ? 'a' : 'p');
const store = {
  get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* storage unavailable */ } },
};
const initials = s => esc(String(s || '?').replace(/[^\p{L}\p{N} ]/gu, '').split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0]).join('').toUpperCase() || '♪');
const debounce = (fn, ms) => { let id; return (...a) => { clearTimeout(id); id = setTimeout(() => fn(...a), ms); }; };

// ---------------------------------------------------------------- state
const D = {};          // meta, lib, art
const P = {};          // decoded play columns
const F = { personal: store.get('lh-personal', true), rules: store.get('lh-rules', null), year: store.get('lh-year', 'all') };
const KIND = { MUSIC: 0, POD: 1, BOOK: 2 };
let REASON = {};

async function getJSON(url) { const r = await fetch(url); if (!r.ok) throw new Error(url + ' ' + r.status); return r.json(); }

async function load() {
  const [meta, lib, plays, art] = await Promise.all([
    getJSON('data/meta.json'), getJSON('data/library.json'), getJSON('data/plays.json'),
    getJSON('data/art.json').catch(() => ({})),
  ]);
  D.meta = meta; D.lib = lib; D.art = Object.assign({ albums: {}, artists: {}, shows: {}, books: {} }, art);
  meta.reasons.forEach((r, i) => { REASON[r] = i; });
  if (!F.rules) F.rules = Object.fromEntries(meta.rules.map(r => [r.id, r.enabled]));
  meta.rules.forEach(r => { if (!(r.id in F.rules)) F.rules[r.id] = r.enabled; });
  decode(plays);
}

function decode(pl) {
  const n = pl.t.length; P.n = n;
  P.t = new Float64Array(n); let acc = 0;
  for (let i = 0; i < n; i++) { acc += pl.t[i]; P.t[i] = acc; }
  P.s = Int32Array.from(pl.s); P.k = Uint8Array.from(pl.k); P.i = Int32Array.from(pl.i);
  P.d = Uint8Array.from(pl.d); P.rs = Uint8Array.from(pl.rs); P.re = Uint8Array.from(pl.re);
  P.f = Uint8Array.from(pl.f); P.x = Int32Array.from(pl.x);
  P.day = new Int32Array(n); P.year = new Uint16Array(n); P.mon = new Uint8Array(n); P.hour = new Uint8Array(n); P.dow = new Uint8Array(n);
  P.artist = new Int32Array(n); P.album = new Int32Array(n); P.show = new Int32Array(n);
  const ymCache = new Map(); const T = D.lib.tracks, E = D.lib.episodes;
  P.byDay = new Map();
  for (let p = 0; p < n; p++) {
    const t = P.t[p], day = Math.floor(t / 86400);
    P.day[p] = day; P.hour[p] = Math.floor((t - day * 86400) / 3600); P.dow[p] = ((day % 7) + 10) % 7; // 1970-01-01 was Thursday
    let ym = ymCache.get(day);
    if (!ym) { const d = new Date(day * 864e5); ym = [d.getUTCFullYear(), d.getUTCMonth()]; ymCache.set(day, ym); }
    P.year[p] = ym[0]; P.mon[p] = ym[1];
    const k = P.k[p], it = P.i[p];
    P.artist[p] = k === 0 ? T[it][1] : -1; P.album[p] = k === 0 ? T[it][2] : -1; P.show[p] = k === 1 ? E[it][1] : -1;
    let arr = P.byDay.get(day); if (!arr) P.byDay.set(day, arr = []); arr.push(p);
  }
  P.years = [...new Set(P.year)].sort((a, b) => a - b);
}

// ---------------------------------------------------------------- filters & memo
function ruleMask() { let m = 0; for (const r of D.meta.rules) if (F.rules[r.id]) m |= 1 << r.bit; return m; }
const effMask = () => (F.personal ? ruleMask() : 0);
const memoStore = new Map();
function memo(name, fn, withYear = true, year = F.year) {
  const key = `${name}|${effMask()}|${withYear ? year : '*'}`;
  if (!memoStore.has(key)) memoStore.set(key, fn());
  return memoStore.get(key);
}
/** active: personal filter only (all years) */
const active = () => memo('active', () => { const m = effMask(), a = new Uint8Array(P.n); for (let p = 0; p < P.n; p++) a[p] = (P.x[p] & m) ? 0 : 1; return a; }, false);
/** scope: personal filter + global year filter (or a given year) */
function scope(year = F.year) {
  return memo('scope', () => {
    const a = active(); if (year === 'all') return a;
    const y = +year, s = new Uint8Array(P.n); for (let p = 0; p < P.n; p++) s[p] = a[p] && P.year[p] === y ? 1 : 0; return s;
  }, true, year);
}
function scopeLabel(useYear = true) {
  const parts = [useYear && F.year !== 'all' ? String(F.year) : 'All years'];
  const on = D.meta.rules.filter(r => F.rules[r.id]).length;
  parts.push(F.personal ? `personal listening (${on} exclusion rule${on === 1 ? '' : 's'})` : 'everything, nothing excluded');
  return parts.join(' · ');
}

// ---------------------------------------------------------------- aggregation
function itemStats(year = F.year) {
  return memo('items', () => {
    const sc = scope(year), L = D.lib;
    const mk = len => ({ secs: new Float64Array(len), plays: new Int32Array(len), first: new Float64Array(len).fill(Infinity), last: new Float64Array(len).fill(-Infinity) });
    const S = { tracks: mk(L.tracks.length), artists: mk(L.artists.length), albums: mk(L.albums.length), shows: mk(L.shows.length), episodes: mk(L.episodes.length), books: mk(L.books.length) };
    const add = (o, j, p) => { o.secs[j] += P.s[p]; if (P.s[p] >= 30) o.plays[j]++; if (P.t[p] < o.first[j]) o.first[j] = P.t[p]; if (P.t[p] > o.last[j]) o.last[j] = P.t[p]; };
    let total = 0, music = 0, pod = 0, book = 0, plays = 0; const days = new Set(); let first = Infinity;
    for (let p = 0; p < P.n; p++) {
      if (!sc[p]) continue;
      const s = P.s[p]; total += s; if (s >= 30) plays++; days.add(P.day[p]); if (P.t[p] < first) first = P.t[p];
      const k = P.k[p], it = P.i[p];
      if (k === 0) { music += s; add(S.tracks, it, p); add(S.artists, P.artist[p], p); add(S.albums, P.album[p], p); }
      else if (k === 1) { pod += s; add(S.episodes, it, p); add(S.shows, P.show[p], p); }
      else if (k === 2) { book += s; add(S.books, it, p); }
    }
    S.totals = { total, music, pod, book, plays, days: days.size, first };
    return S;
  }, true, year);
}
function topN(arr, n, filter) {
  const idx = []; for (let j = 0; j < arr.length; j++) if (arr[j] > 0 && (!filter || filter(j))) idx.push(j);
  idx.sort((a, b) => arr[b] - arr[a]); return idx.slice(0, n);
}
const allTime = () => itemStats('all');
function artistTopAlbum(ai) {
  const S = memo('artistTopAlbum', () => {
    const st = allTime(), best = new Int32Array(D.lib.artists.length).fill(-1), bestS = new Float64Array(D.lib.artists.length);
    D.lib.albums.forEach((al, j) => { const s = st.albums.secs[j]; if (s > bestS[al[1]] && D.art.albums[j]) { bestS[al[1]] = s; best[al[1]] = j; } });
    return best;
  }, false);
  return S[ai];
}

// ---------------------------------------------------------------- art helpers
function img(url, label, cls = '') {
  return url ? `<img class="art ${cls}" src="${esc(url)}" alt="" loading="lazy" referrerpolicy="no-referrer">` : `<span class="art ${cls}" aria-hidden="true">${initials(label)}</span>`;
}
const albumUrl = j => D.art.albums[j];
const trackUrl = ti => albumUrl(D.lib.tracks[ti][2]);
function artistUrl(ai) { if (D.art.artists[ai]) return D.art.artists[ai]; const a = artistTopAlbum(ai); return a >= 0 ? albumUrl(a) : null; }
const showUrl = si => D.art.shows[si];
const bookUrl = bi => D.art.books[bi];
const artistLink = ai => `<a href="#/artist/${ai}">${esc(D.lib.artists[ai])}</a>`;
const trackLink = ti => `<a href="#/track/${ti}">${esc(D.lib.tracks[ti][0])}</a>`;
function playLabel(p) {
  const k = P.k[p], it = P.i[p], L = D.lib;
  if (k === 0) return { title: L.tracks[it][0], sub: L.artists[L.tracks[it][1]], url: trackUrl(it), href: `#/track/${it}`, subHref: `#/artist/${L.tracks[it][1]}` };
  if (k === 1) return { title: L.episodes[it][0], sub: L.shows[L.episodes[it][1]], url: showUrl(L.episodes[it][1]), href: '#/podcasts' };
  if (k === 2) return { title: L.books[it][0], sub: 'Audiobook', url: bookUrl(it), href: '#/podcasts' };
  return { title: 'Unknown item', sub: '', url: null };
}

// ---------------------------------------------------------------- tooltip
const tipEl = () => $('#tip');
const tip = {
  show(html, ev) { const t = tipEl(); t.innerHTML = html; t.hidden = false; this.move(ev); },
  move(ev) {
    const t = tipEl(); if (t.hidden) return;
    const r = t.getBoundingClientRect(); let x = ev.clientX + 14, y = ev.clientY + 14;
    if (x + r.width > innerWidth - 8) x = ev.clientX - r.width - 14;
    if (y + r.height > innerHeight - 8) y = ev.clientY - r.height - 14;
    t.style.left = Math.max(8, x) + 'px'; t.style.top = Math.max(8, y) + 'px';
  },
  hide() { tipEl().hidden = true; },
};
const tipRows = rows => rows.map(([k, v]) => `<div class="row"><span class="k">${esc(k)}</span><span class="num">${esc(v)}</span></div>`).join('');

// ---------------------------------------------------------------- chart primitives
function frame(el, height, m) {
  el.innerHTML = '';
  const w = Math.max(280, el.clientWidth || 600);
  const svg = d3.select(el).append('svg').attr('width', w).attr('height', height);
  const g = svg.append('g').attr('transform', `translate(${m.l},${m.t})`);
  return { svg, g, w, iw: w - m.l - m.r, ih: height - m.t - m.b };
}
// rounded top, square bottom (data-end rounded, anchored to baseline)
function barPath(x, y, w, h, r = 4) {
  if (h <= 0 || w <= 0) return '';
  r = Math.min(r, w / 2, h);
  return `M${x},${y + h}V${y + r}Q${x},${y} ${x + r},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + h}Z`;
}
function hbarPath(x, y, w, h, r = 4) {
  if (h <= 0 || w <= 0) return '';
  r = Math.min(r, h / 2, w);
  return `M${x},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + h - r}Q${x + w},${y + h} ${x + w - r},${y + h}H${x}Z`;
}
function dataTable(el, headers, rows) {
  const d = document.createElement('details'); d.className = 'data-table';
  d.innerHTML = `<summary>Show data table</summary><div class="table-wrap"><table class="tbl"><thead><tr>${headers.map((h, i) => `<th class="${i ? 'r' : ''}">${esc(h)}</th>`).join('')}</tr></thead><tbody>${rows.map(r => `<tr>${r.map((c, i) => `<td class="${i ? 'r' : ''}">${esc(c)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
  el.after(d);
}
function yAxis(g, y, iw, fmt, ticks = 4) {
  g.append('g').attr('class', 'gridline').call(d3.axisLeft(y).ticks(ticks).tickSize(-iw).tickFormat(fmt)).call(s => s.select('.domain').remove()).call(s => s.selectAll('line').attr('stroke', 'var(--grid)')).call(s => s.selectAll('text').attr('x', -6));
}
/** Vertical bar chart. data: [{key,label,value,tip}] */
function barChart(el, { data, height = 220, fmt = v => fmtInt(v), color = 'var(--series-1)', onClick, highlight, labelEvery, tableHeaders }) {
  const m = { t: 10, r: 8, b: 26, l: 46 };
  const { g, iw, ih } = frame(el, height, m);
  const x = d3.scaleBand().domain(data.map(d => d.key)).range([0, iw]).paddingInner(data.length > 60 ? 0.12 : 0.22).paddingOuter(0.05);
  const y = d3.scaleLinear().domain([0, d3.max(data, d => d.value) || 1]).nice().range([ih, 0]);
  yAxis(g, y, iw, fmt);
  const every = labelEvery || Math.max(1, Math.ceil(data.length * 34 / iw));
  g.append('g').attr('transform', `translate(0,${ih})`).selectAll('text').data(data.filter((d, i) => i % every === 0)).join('text')
    .attr('x', d => x(d.key) + x.bandwidth() / 2).attr('y', 16).attr('text-anchor', 'middle').text(d => d.label);
  g.append('line').attr('x1', 0).attr('x2', iw).attr('y1', ih).attr('y2', ih).attr('stroke', 'var(--axis)');
  const bars = g.selectAll('.b').data(data).join('g').attr('class', 'b');
  bars.append('path').attr('d', d => barPath(x(d.key), y(d.value), x.bandwidth(), ih - y(d.value), Math.min(4, x.bandwidth() / 2)))
    .attr('fill', d => (highlight != null && d.key !== highlight ? 'var(--seq-2)' : color));
  bars.append('rect').attr('x', d => x(d.key) - x.step() * x.paddingInner() / 2).attr('width', x.step()).attr('y', 0).attr('height', ih).attr('fill', 'transparent')
    .style('cursor', onClick ? 'pointer' : 'default')
    .on('mouseenter', (ev, d) => tip.show(d.tip || `<b>${esc(d.label)}</b><br>${esc(fmt(d.value))}`, ev)).on('mousemove', ev => tip.move(ev)).on('mouseleave', () => tip.hide())
    .on('click', (ev, d) => { tip.hide(); onClick && onClick(d); });
  dataTable(el, tableHeaders || ['', 'Value'], data.map(d => [d.full || d.label, fmt(d.value)]));
}
/** Stacked vertical bars. keys: [{key,label,color}], data: [{key,label,values:{}}] */
function stackedBars(el, { keys, data, height = 240, fmt = v => fmtInt(v), onClick, highlight }) {
  const legend = document.createElement('div'); legend.className = 'legend';
  legend.innerHTML = keys.map(k => `<span><i style="background:${k.color}"></i>${esc(k.label)}</span>`).join('');
  el.before(legend);
  const m = { t: 10, r: 8, b: 26, l: 46 };
  const { g, iw, ih } = frame(el, height, m);
  const x = d3.scaleBand().domain(data.map(d => d.key)).range([0, iw]).paddingInner(0.25).paddingOuter(0.05);
  const tot = d => keys.reduce((s, k) => s + (d.values[k.key] || 0), 0);
  const y = d3.scaleLinear().domain([0, d3.max(data, tot) || 1]).nice().range([ih, 0]);
  yAxis(g, y, iw, fmt);
  g.append('g').selectAll('text').data(data).join('text').attr('x', d => x(d.key) + x.bandwidth() / 2).attr('y', ih + 16).attr('text-anchor', 'middle').text(d => d.label);
  g.append('line').attr('x1', 0).attr('x2', iw).attr('y1', ih).attr('y2', ih).attr('stroke', 'var(--axis)');
  data.forEach(d => {
    let base = 0; const segs = keys.filter(k => (d.values[k.key] || 0) > 0);
    segs.forEach((k, si) => {
      const v = d.values[k.key], y0 = y(base), y1 = y(base + v), top = si === segs.length - 1;
      const h = Math.max(0, y0 - y1 - (si > 0 ? 2 : 0)); // 2px surface gap between segments
      g.append('path').attr('d', top ? barPath(x(d.key), y1, x.bandwidth(), h) : `M${x(d.key)},${y1}h${x.bandwidth()}v${h}h${-x.bandwidth()}Z`)
        .attr('fill', k.color).attr('opacity', highlight != null && highlight !== d.key ? 0.35 : 1);
      base += v;
    });
  });
  g.selectAll('.hit').data(data).join('rect').attr('class', 'hit').attr('x', d => x(d.key)).attr('width', x.bandwidth()).attr('y', 0).attr('height', ih).attr('fill', 'transparent')
    .style('cursor', onClick ? 'pointer' : 'default')
    .on('mouseenter', (ev, d) => tip.show(`<b>${esc(d.label)}</b>${tipRows(keys.map(k => [k.label, fmt(d.values[k.key] || 0)]).concat([['Total', fmt(tot(d))]]))}`, ev))
    .on('mousemove', ev => tip.move(ev)).on('mouseleave', () => tip.hide()).on('click', (ev, d) => { tip.hide(); onClick && onClick(d); });
  dataTable(el, [''].concat(keys.map(k => k.label)), data.map(d => [d.label].concat(keys.map(k => fmt(d.values[k.key] || 0)))));
}
/** Multi-line chart with crosshair. series: [{name,color,values:[y per x]}], xLabels */
function lineChart(el, { series, xLabels, height = 240, fmt = v => fmtInt(v), yDomain }) {
  if (series.length > 1) {
    const legend = document.createElement('div'); legend.className = 'legend';
    legend.innerHTML = series.map(s => `<span><i style="background:${s.color}"></i>${esc(s.name)}</span>`).join('');
    el.before(legend);
  }
  const m = { t: 12, r: series.length <= 4 && series.length > 1 ? 110 : 16, b: 26, l: 46 };
  const { g, iw, ih } = frame(el, height, m);
  const x = d3.scalePoint().domain(d3.range(xLabels.length)).range([0, iw]).padding(0.3);
  const y = d3.scaleLinear().domain(yDomain || [0, d3.max(series, s => d3.max(s.values)) || 1]).nice().range([ih, 0]);
  yAxis(g, y, iw, fmt);
  const every = Math.max(1, Math.ceil(xLabels.length * 40 / iw));
  g.append('g').selectAll('text').data(xLabels.map((l, i) => [l, i]).filter(([, i]) => i % every === 0)).join('text')
    .attr('x', d => x(d[1])).attr('y', ih + 16).attr('text-anchor', 'middle').text(d => d[0]);
  const line = d3.line().defined(v => v != null && isFinite(v)).x((v, i) => x(i)).y(v => y(v)).curve(d3.curveMonotoneX);
  const labels = [];
  series.forEach(s => {
    g.append('path').attr('d', line(s.values)).attr('fill', 'none').attr('stroke', s.color).attr('stroke-width', 2);
    if (series.length > 1 && series.length <= 4) {
      let li = s.values.length - 1; while (li > 0 && (s.values[li] == null || !isFinite(s.values[li]))) li--;
      labels.push({ x: x(li) + 8, y: y(s.values[li]) + 4, name: s.name });
    }
  });
  labels.sort((a, b) => a.y - b.y); // nudge direct labels apart so they never collide
  for (let i = 1; i < labels.length; i++) if (labels[i].y - labels[i - 1].y < 14) labels[i].y = labels[i - 1].y + 14;
  labels.forEach(l => g.append('text').attr('class', 'lbl').attr('x', l.x).attr('y', l.y).text(l.name));
  const cross = g.append('line').attr('y1', 0).attr('y2', ih).attr('stroke', 'var(--axis)').style('display', 'none');
  const dots = g.selectAll('.dot').data(series).join('circle').attr('r', 4).attr('fill', s => s.color).attr('stroke', 'var(--surface-1)').attr('stroke-width', 2).style('display', 'none');
  g.append('rect').attr('width', iw).attr('height', ih).attr('fill', 'transparent')
    .on('mousemove', ev => {
      const [mx] = d3.pointer(ev); let i = Math.round((mx - x(0)) / (x.step() || 1)); i = Math.max(0, Math.min(xLabels.length - 1, i));
      cross.style('display', null).attr('x1', x(i)).attr('x2', x(i));
      dots.style('display', s => (s.values[i] == null ? 'none' : null)).attr('cx', x(i)).attr('cy', s => y(s.values[i] ?? 0));
      tip.show(`<b>${esc(xLabels[i])}</b>${tipRows(series.map(s => [s.name, s.values[i] == null ? '–' : fmt(s.values[i])]))}`, ev);
    })
    .on('mouseleave', () => { cross.style('display', 'none'); dots.style('display', 'none'); tip.hide(); });
  dataTable(el, [''].concat(series.map(s => s.name)), xLabels.map((l, i) => [l].concat(series.map(s => (s.values[i] == null ? '–' : fmt(s.values[i]))))));
}
const SEQ = ['var(--seq-0)', 'var(--seq-1)', 'var(--seq-2)', 'var(--seq-3)', 'var(--seq-4)', 'var(--seq-5)', 'var(--seq-6)'];
function seqScale(thresholds) { return v => { if (!v) return SEQ[0]; let i = 0; while (i < thresholds.length && v >= thresholds[i]) i++; return SEQ[Math.min(SEQ.length - 1, i + 1)]; }; }
function seqLegend(thresholds, fmt) {
  const parts = [`<span>less</span>`, `<i style="background:${SEQ[1]}"></i>`];
  thresholds.forEach((t, i) => parts.push(`<i style="background:${SEQ[i + 2]}" title="≥ ${esc(fmt(t))}"></i>`));
  parts.push('<span>more</span>');
  return `<div class="cal-scale">${parts.join('')}</div>`;
}

// ---------------------------------------------------------------- layout helpers
const view = () => $('#view');
function head(title, sub, useYear = true) {
  return `<div class="page-head"><div><h1>${esc(title)}</h1>${sub ? `<p class="muted">${sub}</p>` : ''}</div><div class="scope-note">${esc(scopeLabel(useYear))}</div></div>`;
}
const tile = (v, l, s = '') => `<div class="tile"><div class="v num">${v}</div><div class="l">${l}</div>${s ? `<div class="s">${s}</div>` : ''}</div>`;
function rankList(items) {
  return `<ol class="rank-list">${items.map((it, i) => `<li><span class="n">${i + 1}</span>${img(it.url, it.title, it.round ? 'sm round' : 'sm')}<div class="who"><div><div class="t">${it.titleHtml || esc(it.title)}</div>${it.sub ? `<div class="a">${it.subHtml || esc(it.sub)}</div>` : ''}</div></div><span class="v">${esc(it.value)}</span></li>`).join('')}</ol>`;
}
function topArtistsList(st, n = 10, by = 'secs') {
  return rankList(topN(st.artists[by], n).map(a => ({ url: artistUrl(a), title: D.lib.artists[a], titleHtml: artistLink(a), value: by === 'secs' ? fmtH(st.artists.secs[a]) : fmtInt(st.artists.plays[a]) + ' plays', round: true })));
}
function topTracksList(st, n = 10) {
  return rankList(topN(st.tracks.plays, n).map(t => ({ url: trackUrl(t), title: D.lib.tracks[t][0], titleHtml: trackLink(t), sub: D.lib.artists[D.lib.tracks[t][1]], subHtml: artistLink(D.lib.tracks[t][1]), value: fmtInt(st.tracks.plays[t]) + ' plays' })));
}
const embed = (type, id) => id ? `<iframe class="embed" src="https://open.spotify.com/embed/${type}/${esc(id)}?utm_source=generator" loading="lazy" allow="autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture" title="Spotify player"></iframe>` : '';
function yearChips(cur, base, includeAll = false) {
  const ys = P.years.filter(y => itemStats(y).totals.total > 3600 * 3 || y === cur);
  return `<div class="chips">${includeAll ? `<a class="chip ${cur === 'all' ? 'on' : ''}" href="${base}all">All</a>` : ''}${ys.map(y => `<a class="chip ${y === cur ? 'on' : ''}" href="${base}${y}">${y}</a>`).join('')}</div>`;
}

// ================================================================ VIEWS
const V = {};

// ---------------- Overview
V.overview = () => {
  const st = itemStats(), T = st.totals;
  const nTracks = st.tracks.secs.filter(v => v > 0).length, nArtists = st.artists.secs.filter(v => v > 0).length;
  view().innerHTML = head('Your listening', 'Every stream since your first one, from the extended streaming history export.') + `
    <div class="tiles">
      ${tile(fmtInt(T.total / 3600), 'hours listened', `≈ ${fmtInt(T.total / 86400)} full days`)}
      ${tile(fmtInt(T.plays), 'streams (30 s +)')}
      ${tile(fmtInt(nTracks), 'different songs')}
      ${tile(fmtInt(nArtists), 'artists')}
      ${tile(fmtInt(T.days), 'days with listening')}
      ${tile(fmtDate(T.first).replace(/ \d+,/, ''), 'first stream')}
    </div>
    <div class="card"><h2>Hours per year</h2><div class="sub">Click a year to filter the whole site to it.</div><div class="chart" id="c-years"></div></div>
    <div class="grid g2">
      <div class="card"><h2>Top artists</h2><div class="sub">by hours</div>${topArtistsList(st)}</div>
      <div class="card"><h2>Top songs</h2><div class="sub">by streams of 30 seconds or more</div>${topTracksList(st)}</div>
    </div>
    <div class="grid g2">
      <div class="card"><h2>Milestones</h2><div class="sub">cumulative music hours (personal filter applied, all years)</div><div id="milestones"></div></div>
      <div class="card"><h2>About this data</h2><div class="sub">what was cleaned up before building this site</div><div id="dq"></div></div>
    </div>`;
  const act = active(), byYear = new Map();
  for (let p = 0; p < P.n; p++) {
    if (!act[p]) continue; const y = P.year[p]; let o = byYear.get(y); if (!o) byYear.set(y, o = { 0: 0, 1: 0, 2: 0 });
    if (P.k[p] < 3) o[P.k[p]] += P.s[p];
  }
  const data = [...byYear.keys()].sort().map(y => ({ key: y, label: String(y).slice(2).padStart(3, "'"), values: { m: byYear.get(y)[0] / 3600, p: byYear.get(y)[1] / 3600, b: byYear.get(y)[2] / 3600 } }));
  data.forEach(d => { d.label = String(d.key); });
  stackedBars($('#c-years'), {
    keys: [{ key: 'm', label: 'Music', color: 'var(--series-1)' }, { key: 'p', label: 'Podcasts', color: 'var(--series-2)' }, { key: 'b', label: 'Audiobooks', color: 'var(--series-3)' }],
    data, fmt: v => fmtInt(v) + ' h', highlight: F.year === 'all' ? null : +F.year, onClick: d => setYear(F.year === d.key ? 'all' : d.key),
  });
  // milestones
  const marks = [100, 500, 1000, 2500, 5000, 7500, 8000, 9000, 10000]; let cum = 0, mi = 0; const rows = [];
  for (let p = 0; p < P.n && mi < marks.length; p++) {
    if (!act[p] || P.k[p] !== 0) continue; cum += P.s[p];
    while (mi < marks.length && cum >= marks[mi] * 3600) { const pl = playLabel(p); rows.push(`<tr><td class="r num">${fmtInt(marks[mi])} h</td><td>${fmtDate(P.t[p])}</td><td><div class="name">${pl.href ? `<a href="${pl.href}">${esc(pl.title)}</a>` : esc(pl.title)} <span class="sub">${esc(pl.sub)}</span></div></td></tr>`); mi++; }
  }
  $('#milestones').innerHTML = `<table class="tbl"><thead><tr><th class="r">Hours</th><th>Reached</th><th>Song playing</th></tr></thead><tbody>${rows.join('')}</tbody></table>`;
  const M = D.meta, exclH = D.meta.rules.filter(r => F.rules[r.id]).reduce((s, r) => s + r.hours, 0);
  $('#dq').innerHTML = `<ul class="muted" style="padding-left:18px;margin:0">
    <li>${fmtInt(M.records_raw)} raw records → <b>${fmtInt(M.duplicates_removed)}</b> exact duplicates removed (identical in every field).</li>
    <li>${M.vpn_runs.reduce((s, v) => s + v.plays, 0)} plays logged in ${[...new Set(M.vpn_runs.map(v => v.country))].map(c => D.meta.countries.find(x => x.code === c)?.name || c).join(', ')} came through a VPN; they count as home listening.</li>
    <li>Times are local: ${esc(M.home_timezone.replace('_', ' '))} at home, local time on trips. The export stamps each stream when it <em>ended</em>; start times are back-calculated.</li>
    <li>Spotify didn't record skips before 2022 (every play says "not skipped"), so skip analysis uses how each song ended instead.</li>
    <li>IP addresses, device serial numbers and offline timestamps are stripped from the published data.</li>
    <li>Exclusion rules currently ${F.personal ? `hide about <b>${fmtInt(exclH)} h</b>` : 'are <b>off</b>'} · <a href="#/excluded">review excluded plays</a>.</li></ul>`;
};

// ---------------- Wrapped
V.wrapped = ([yr]) => {
  const years = P.years.filter(y => itemStats(y).totals.total > 3600 * 3);
  const Y = yr ? +yr : (F.year !== 'all' ? +F.year : years[years.length - 1]);
  const st = itemStats(Y), T = st.totals, act = active();
  if (!T.total) { view().innerHTML = head(`${Y} Wrapped`, '', false) + yearChips(Y, '#/wrapped/') + '<p class="muted" style="margin-top:20px">No listening that year.</p>'; return; }
  // first-ever plays (all-time, active) for discovery
  const firstArtist = firstSeen('artist');
  const newArtists = topN(st.artists.secs, 1e9).filter(a => dateOf(firstArtist[a]).getUTCFullYear() === Y);
  const dayS = new Map(), hourS = new Float64Array(24), monS = new Float64Array(12); let shuffled = 0, picked = 0, done = 0, started = 0;
  let run = { n: 0 }, cur = { id: -1, n: 0, p: -1 };
  for (let p = 0; p < P.n; p++) {
    if (!act[p] || P.year[p] !== Y) continue;
    dayS.set(P.day[p], (dayS.get(P.day[p]) || 0) + P.s[p]); hourS[P.hour[p]] += P.s[p]; monS[P.mon[p]] += P.s[p];
    if (P.k[p] === 0) {
      started++; if (P.f[p] & 1) shuffled++; if (P.rs[p] === REASON.clickrow) picked++; if (P.re[p] === REASON.trackdone) done++;
      if (P.i[p] === cur.id) cur.n++; else cur = { id: P.i[p], n: 1, p };
      if (cur.n > run.n) run = { ...cur };
    }
  }
  const bestDay = [...dayS].sort((a, b) => b[1] - a[1])[0];
  const peakHour = hourS.indexOf(Math.max(...hourS));
  const topAlbum = topN(st.albums.secs, 1)[0], topShow = topN(st.shows.secs, 1)[0], topBook = topN(st.books.secs, 1)[0];
  const trips = D.meta.trips.filter(t => t.year === Y && t.hours >= 0.5);
  const ta = topN(st.artists.secs, 1)[0];
  view().innerHTML = head(`${Y} Wrapped`, 'Your year in listening, any year you like.', false) + yearChips(Y, '#/wrapped/') + `
    <div class="wrapped-hero" style="margin-top:16px">
      <div class="big num">${fmtInt(T.total / 60)}</div><p>minutes listened in ${Y} · ${fmtInt(T.plays)} streams · ${fmtInt(T.days)} days</p>
    </div>
    <div class="grid g3">
      <div class="card" style="text-align:center">${img(artistUrl(ta), D.lib.artists[ta], 'lg round')}<h2 style="margin-top:12px">${artistLink(ta)}</h2><div class="sub">Top artist · ${fmtH(st.artists.secs[ta])}</div></div>
      <div class="card"><h2>Top artists</h2>${topArtistsList(st, 5)}</div>
      <div class="card"><h2>Top songs</h2>${topTracksList(st, 5)}</div>
    </div>
    <div class="card"><h2>Listening by month</h2><div class="chart" id="c-mon"></div></div>
    <div class="card"><h2>Highlights</h2><div class="facts" style="margin-top:8px">
      ${fact('Top album', topAlbum != null ? `${esc(D.lib.albums[topAlbum][0])} <span class="faint">· ${esc(D.lib.artists[D.lib.albums[topAlbum][1]])}</span>` : '–')}
      ${fact('Biggest day', bestDay ? `<a href="#/calendar/${bestDay[0]}">${fmtDay(bestDay[0])}</a> · ${fmtH(bestDay[1])}` : '–')}
      ${fact('Most on repeat', run.n > 1 ? `${trackLink(run.id)} · ${run.n}× in a row` : '–')}
      ${fact('New artists found', `${fmtInt(newArtists.length)}${newArtists[0] != null ? ` · best: ${artistLink(newArtists[0])}` : ''}`)}
      ${fact('Peak hour', `${hourLabel(peakHour)}m`)}
      ${fact('Shuffle', pct(shuffled / started))}
      ${fact('Songs you picked yourself', pct(picked / started))}
      ${fact('Songs played to the end', pct(done / started))}
      ${fact('Top podcast', topShow != null ? `${esc(D.lib.shows[topShow])} · ${fmtH(st.shows.secs[topShow])}` : '–')}
      ${fact('Top audiobook', topBook != null ? `${esc(D.lib.books[topBook][0])} · ${fmtH(st.books.secs[topBook])}` : '–')}
      ${fact('Trips', trips.length ? trips.map(t => esc(t.name)).join(', ') : 'none recorded')}
      ${fact('Different songs', fmtInt(st.tracks.secs.filter(v => v > 0).length))}
    </div></div>`;
  barChart($('#c-mon'), { data: MON.map((m, i) => ({ key: i, label: m, full: MONTH[i], value: monS[i] / 3600 })), fmt: v => fmtHnum(v * 3600) + ' h', height: 200 });
};
const fact = (l, v) => `<div class="fact"><div class="l">${esc(l)}</div><div class="v">${v}</div></div>`;
/** first-ever play time per artist / track (personal filter, all years) */
function firstSeen(what) {
  return memo('first-' + what, () => {
    const act = active(), len = what === 'artist' ? D.lib.artists.length : D.lib.tracks.length, out = new Float64Array(len).fill(Infinity);
    for (let p = 0; p < P.n; p++) { if (!act[p] || P.k[p] !== 0 || P.s[p] < 30) continue; const j = what === 'artist' ? P.artist[p] : P.i[p]; if (P.t[p] < out[j]) out[j] = P.t[p]; }
    return out;
  }, false);
}

// ---------------- Calendar
V.calendar = ([dayArg]) => {
  const act = active(), dayS = new Map();
  for (let p = 0; p < P.n; p++) if (act[p]) dayS.set(P.day[p], (dayS.get(P.day[p]) || 0) + P.s[p]);
  const thr = [0.5, 1, 2, 3.5, 6].map(h => h * 3600);
  const color = seqScale(thr);
  const years = F.year === 'all' ? P.years.slice().reverse() : [+F.year];
  view().innerHTML = head('Calendar', 'Every day you listened. Hover for the day, click to see what played.') + `
    <div class="card"><div class="toolbar" style="justify-content:space-between">${seqLegend(thr, v => fmtH(v))}<span class="faint" style="font-size:12px">Mon → Sun top to bottom</span></div><div id="cal"></div></div>
    <div class="card" id="dayPanel"><p class="muted">Click a day to list its plays.</p></div>`;
  const wrap = $('#cal'), w = wrap.clientWidth - 50, cell = Math.max(6, Math.min(14, Math.floor(w / 54) - 2)), gap = 2;
  years.forEach(y => {
    const row = document.createElement('div'); row.className = 'cal-year'; row.innerHTML = `<div class="y">${y}</div>`;
    const jan1 = Math.floor(Date.UTC(y, 0, 1) / 864e5), dec31 = Math.floor(Date.UTC(y, 11, 31) / 864e5), off = ((jan1 % 7) + 10) % 7;
    const W = 54 * (cell + gap), H = 7 * (cell + gap) + 14;
    const svg = d3.select(row).append('svg').attr('width', W).attr('height', H);
    for (let mo = 0; mo < 12; mo++) {
      const d = Math.floor(Date.UTC(y, mo, 1) / 864e5), wk = Math.floor((d - jan1 + off) / 7);
      svg.append('text').attr('x', wk * (cell + gap)).attr('y', 9).attr('fill', 'var(--text-muted)').attr('font-size', 10).text(MON[mo]);
    }
    const days = d3.range(jan1, dec31 + 1);
    svg.append('g').attr('transform', 'translate(0,14)').selectAll('rect').data(days).join('rect')
      .attr('x', d => Math.floor((d - jan1 + off) / 7) * (cell + gap)).attr('y', d => (((d % 7) + 10) % 7) * (cell + gap))
      .attr('width', cell).attr('height', cell).attr('rx', 2).attr('fill', d => color(dayS.get(d) || 0))
      .attr('stroke', d => (+dayArg === d ? 'var(--text-primary)' : 'none')).attr('stroke-width', 1.5)
      .style('cursor', 'pointer')
      .on('mouseenter', (ev, d) => {
        const s = dayS.get(d) || 0; let top = '';
        if (s) { const c = new Map(); for (const p of P.byDay.get(d) || []) if (act[p] && P.k[p] === 0) c.set(P.artist[p], (c.get(P.artist[p]) || 0) + P.s[p]); const best = [...c].sort((a, b) => b[1] - a[1])[0]; if (best) top = D.lib.artists[best[0]]; }
        tip.show(`<b>${fmtDay(d)}</b> · ${DOW[((d % 7) + 10) % 7]}${tipRows([['Listening', s ? fmtH(s) : 'none']].concat(top ? [['Top artist', top]] : []))}`, ev);
      })
      .on('mousemove', ev => tip.move(ev)).on('mouseleave', () => tip.hide())
      .on('click', (ev, d) => { tip.hide(); location.hash = `#/calendar/${d}`; });
    wrap.appendChild(row);
  });
  if (dayArg) dayPanel(+dayArg);
};
function dayPanel(day) {
  const act = active(), ps = P.byDay.get(day) || [];
  const total = ps.reduce((s, p) => s + (act[p] ? P.s[p] : 0), 0);
  const rules = D.meta.rules;
  $('#dayPanel').innerHTML = `<h2>${DOW[((day % 7) + 10) % 7]}, ${fmtDay(day)}</h2><div class="sub">${fmtH(total)} of personal listening · ${ps.length} plays logged · <a href="#/onthisday/${dateOf(day * 86400).getUTCMonth() + 1}-${dateOf(day * 86400).getUTCDate()}">this date in other years</a></div>
    <div class="day-list table-wrap"><table class="tbl"><thead><tr><th>Time</th><th>Item</th><th class="r">Played</th><th>Note</th></tr></thead><tbody>${ps.map(p => {
      const pl = playLabel(p), ex = P.x[p] & effMask(), names = rules.filter(r => ex >> r.bit & 1).map(r => r.label);
      return `<tr style="${ex ? 'opacity:.55' : ''}"><td class="num">${fmtTime(P.t[p])}</td><td><div class="who">${img(pl.url, pl.title, 'sm')}<div><div class="t">${pl.href ? `<a href="${pl.href}">${esc(pl.title)}</a>` : esc(pl.title)}</div><div class="a">${pl.subHref ? `<a href="${pl.subHref}">${esc(pl.sub)}</a>` : esc(pl.sub)}</div></div></div></td><td class="r num">${P.s[p] >= 60 ? Math.round(P.s[p] / 60) + ' min' : P.s[p] + ' s'}</td><td>${names.length ? `<span class="excl">excluded: ${esc(names.join(', '))}</span>` : (P.re[p] === REASON.fwdbtn ? '<span class="faint">skipped</span>' : '')}</td></tr>`;
    }).join('')}</tbody></table></div>`;
  $('#dayPanel').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

// ---------------- Library
const LIB = { tab: 'tracks', q: '', sort: 'secs', shown: 100 };
V.library = ([tab]) => {
  if (tab && tab !== LIB.tab) { LIB.tab = tab; LIB.shown = 100; }
  view().innerHTML = head('Library', 'Search every song, artist, album, podcast and audiobook you have played.') + `
    <div class="card">
      <div class="toolbar">
        <div class="chips">${[['tracks', 'Songs'], ['artists', 'Artists'], ['albums', 'Albums'], ['shows', 'Podcasts'], ['books', 'Audiobooks']].map(([k, l]) => `<a class="chip ${LIB.tab === k ? 'on' : ''}" href="#/library/${k}">${l}</a>`).join('')}</div>
        <input id="q" class="input" type="search" placeholder="Search…" value="${esc(LIB.q)}" aria-label="Search library">
      </div>
      <div id="libTable" class="table-wrap"></div>
    </div>`;
  const q = $('#q'); q.addEventListener('input', debounce(() => { LIB.q = q.value; LIB.shown = 100; libTable(); }, 150));
  libTable();
};
function libTable() {
  const st = itemStats(), L = D.lib, tab = LIB.tab, S = st[tab === 'books' ? 'books' : tab];
  const q = LIB.q.trim().toLowerCase();
  const nameOf = j => tab === 'tracks' ? L.tracks[j][0] : tab === 'artists' ? L.artists[j] : tab === 'albums' ? L.albums[j][0] : tab === 'shows' ? L.shows[j] : L.books[j][0];
  const subOf = j => tab === 'tracks' ? L.artists[L.tracks[j][1]] : tab === 'albums' ? L.artists[L.albums[j][1]] : '';
  let rows = []; for (let j = 0; j < S.secs.length; j++) if (S.secs[j] > 0 && (!q || (nameOf(j) + ' ' + subOf(j)).toLowerCase().includes(q))) rows.push(j);
  const key = LIB.sort;
  const cmp = { secs: (a, b) => S.secs[b] - S.secs[a], plays: (a, b) => S.plays[b] - S.plays[a], first: (a, b) => S.first[a] - S.first[b], last: (a, b) => S.last[b] - S.last[a], name: (a, b) => nameOf(a).localeCompare(nameOf(b)) }[key];
  rows.sort(cmp);
  const max = Math.max(...rows.slice(0, 500).map(j => S.secs[j]), 1);
  const urlOf = j => tab === 'tracks' ? trackUrl(j) : tab === 'artists' ? artistUrl(j) : tab === 'albums' ? albumUrl(j) : tab === 'shows' ? showUrl(j) : bookUrl(j);
  const linkOf = j => tab === 'tracks' ? trackLink(j) : tab === 'artists' ? artistLink(j) : esc(nameOf(j));
  const subLink = j => tab === 'tracks' ? artistLink(L.tracks[j][1]) : tab === 'albums' ? artistLink(L.albums[j][1]) : '';
  const th = (k, l, cls = '') => `<th class="sortable ${cls} ${key === k ? 'sorted' : ''}" data-k="${k}">${l}</th>`;
  $('#libTable').innerHTML = `<p class="faint" style="font-size:13px">${fmtInt(rows.length)} ${tab === 'shows' ? 'podcasts' : tab === 'books' ? 'audiobooks' : tab === 'tracks' ? 'songs' : tab}</p>
    <table class="tbl"><thead><tr><th class="rank">#</th>${th('name', 'Name')}${th('plays', 'Streams', 'r')}${th('secs', 'Hours', 'r')}<th></th>${th('first', 'First')}${th('last', 'Last')}</tr></thead><tbody>
    ${rows.slice(0, LIB.shown).map((j, i) => `<tr><td class="rank">${i + 1}</td><td><div class="who">${img(urlOf(j), nameOf(j), tab === 'artists' ? 'sm round' : 'sm')}<div><div class="t name">${linkOf(j)}</div>${subOf(j) ? `<div class="a">${subLink(j)}</div>` : ''}</div></div></td>
      <td class="r">${fmtInt(S.plays[j])}</td><td class="r">${fmtHnum(S.secs[j])}</td><td class="barcell"><div class="bar" style="width:${Math.max(1, S.secs[j] / max * 100)}%"></div></td>
      <td class="num">${fmtDate(S.first[j])}</td><td class="num">${fmtDate(S.last[j])}</td></tr>`).join('')}</tbody></table>
    ${rows.length > LIB.shown ? `<button class="btn ghost more" id="more">Show ${Math.min(200, rows.length - LIB.shown)} more</button>` : ''}`;
  $('#libTable').querySelectorAll('th.sortable').forEach(el => el.addEventListener('click', () => { LIB.sort = el.dataset.k; libTable(); }));
  const m = $('#more'); if (m) m.addEventListener('click', () => { LIB.shown += 200; libTable(); });
}

// ---------------- Artist page
V.artist = ([aiS]) => {
  const ai = +aiS, act = active(), L = D.lib; if (!(ai >= 0 && ai < L.artists.length)) return V.notfound();
  const st = allTime();
  let secs = 0, plays = 0, started = 0, done = 0, first = Infinity, last = -Infinity; const monS = new Map(), yearS = new Map(), trS = new Map(), trP = new Map(), alS = new Map();
  for (let p = 0; p < P.n; p++) {
    if (!act[p] || P.artist[p] !== ai) continue;
    const s = P.s[p]; secs += s; started++; if (s >= 30) plays++; if (P.re[p] === REASON.trackdone) done++;
    first = Math.min(first, P.t[p]); last = Math.max(last, P.t[p]);
    const mk = P.year[p] * 12 + P.mon[p]; monS.set(mk, (monS.get(mk) || 0) + s); yearS.set(P.year[p], (yearS.get(P.year[p]) || 0) + s);
    trS.set(P.i[p], (trS.get(P.i[p]) || 0) + s); if (s >= 30) trP.set(P.i[p], (trP.get(P.i[p]) || 0) + 1); alS.set(P.album[p], (alS.get(P.album[p]) || 0) + s);
  }
  if (!secs) { view().innerHTML = head(L.artists[ai], 'No plays for this artist with the current filters.', false); return; }
  const rank = 1 + Array.prototype.filter.call(st.artists.secs, v => v > secs).length;
  const peak = [...monS].sort((a, b) => b[1] - a[1])[0];
  const topTracks = [...trS].sort((a, b) => b[1] - a[1]);
  view().innerHTML = `<div class="hero">${img(artistUrl(ai), L.artists[ai], 'lg round')}<div class="meta"><div class="faint">Artist · #${rank} all-time</div><h1>${esc(L.artists[ai])}</h1>
      <p class="muted">${fmtH(secs)} · ${fmtInt(plays)} streams · ${topTracks.length} songs · since ${fmtDate(first)}</p>${embed('track', L.tracks[topTracks[0][0]][3])}</div></div>
    <div class="tiles">${tile(fmtDate(first), 'first listen')}${tile(fmtDate(last), 'latest listen')}${tile(`${MON[peak[0] % 12]} ${Math.floor(peak[0] / 12)}`, 'peak month', fmtH(peak[1]))}${tile(pct(done / started), 'played to the end')}${tile(pct(secs / allTime().totals.music, 1), 'of all your music')}</div>
    <div class="card"><h2>Listening over time</h2><div class="sub">hours per month</div><div class="chart" id="c-am"></div></div>
    <div class="grid g2">
      <div class="card"><h2>Top songs</h2><div class="table-wrap"><table class="tbl"><thead><tr><th class="rank">#</th><th>Song</th><th class="r">Streams</th><th class="r">Hours</th></tr></thead><tbody>
        ${topTracks.slice(0, 25).map(([t, s], i) => `<tr><td class="rank">${i + 1}</td><td><div class="who">${img(trackUrl(t), L.tracks[t][0], 'sm')}<div class="t name">${trackLink(t)}</div></div></td><td class="r">${fmtInt(trP.get(t) || 0)}</td><td class="r">${fmtHnum(s)}</td></tr>`).join('')}</tbody></table></div></div>
      <div class="card"><h2>Albums</h2>${rankList([...alS].sort((a, b) => b[1] - a[1]).slice(0, 12).map(([al, s]) => ({ url: albumUrl(al), title: L.albums[al][0], value: fmtH(s) })))}</div>
    </div>`;
  const m0 = Math.min(...monS.keys()), m1 = Math.max(...monS.keys());
  barChart($('#c-am'), { data: d3.range(m0, m1 + 1).map(mk => ({ key: mk, label: mk % 12 === 0 || m1 - m0 < 24 ? (m1 - m0 < 24 ? MON[mk % 12] : String(Math.floor(mk / 12))) : '', full: `${MON[mk % 12]} ${Math.floor(mk / 12)}`, value: (monS.get(mk) || 0) / 3600 })), fmt: v => fmtHnum(v * 3600) + ' h', labelEvery: 1, height: 220 });
  $('#c-am').querySelectorAll('svg text').forEach(t => { if (!t.textContent) t.remove(); });
};

// ---------------- Track page (song story)
V.track = ([tiS]) => {
  const ti = +tiS, act = active(), L = D.lib; if (!(ti >= 0 && ti < L.tracks.length)) return V.notfound();
  const [name, ai, al, id] = L.tracks[ti];
  let secs = 0, plays = 0, started = 0, done = 0, first = -1, last = -1, run = 0, best = { n: 0, p: -1 }, prevMusic = -1; const monP = new Map(), hourP = new Float64Array(24);
  for (let p = 0; p < P.n; p++) {
    if (!act[p]) continue;
    if (P.k[p] === 0) {
      if (P.i[p] === ti) { run = prevMusic === ti ? run + 1 : 1; if (run > best.n) best = { n: run, p }; }
      prevMusic = P.i[p];
    }
    if (P.k[p] !== 0 || P.i[p] !== ti) continue;
    started++; secs += P.s[p]; if (P.re[p] === REASON.trackdone) done++;
    if (P.s[p] >= 30) { plays++; const mk = P.year[p] * 12 + P.mon[p]; monP.set(mk, (monP.get(mk) || 0) + 1); hourP[P.hour[p]]++; if (first < 0) first = p; last = p; }
  }
  if (!started) { view().innerHTML = head(name, 'No plays for this song with the current filters.', false); return; }
  if (first < 0) { first = last = -1; }
  const peak = [...monP].sort((a, b) => b[1] - a[1])[0];
  view().innerHTML = `<div class="hero">${img(trackUrl(ti), name, 'lg')}<div class="meta"><div class="faint">Song story</div><h1>${esc(name)}</h1>
      <p class="muted">${artistLink(ai)} · ${esc(L.albums[al][0])}</p>${embed('track', id)}</div></div>
    <div class="tiles">${tile(fmtInt(plays), 'streams (30 s +)', fmtH(secs) + ' total')}${tile(first >= 0 ? fmtDate(P.t[first]) : '–', 'entered your life')}${tile(peak ? `${MON[peak[0] % 12]} ${Math.floor(peak[0] / 12)}` : '–', 'peak month', peak ? peak[1] + ' streams' : '')}${tile(last >= 0 ? fmtDate(P.t[last]) : '–', 'latest stream')}${tile(best.n + '×', 'most in a row', best.p >= 0 ? fmtDate(P.t[best.p]) : '')}${tile(pct(done / started), 'played to the end')}</div>
    <div class="card"><h2>The story so far</h2><div class="sub">streams per month</div><div class="chart" id="c-tm"></div></div>
    <div class="card"><h2>When you play it</h2><div class="sub">streams by hour of day</div><div class="chart" id="c-th"></div></div>`;
  if (monP.size) {
    const m0 = Math.min(...monP.keys()), m1 = Math.max(...monP.keys());
    barChart($('#c-tm'), { data: d3.range(m0, m1 + 1).map(mk => ({ key: mk, label: m1 - m0 < 24 ? MON[mk % 12] : (mk % 12 === 0 ? String(mk / 12) : ''), full: `${MON[mk % 12]} ${Math.floor(mk / 12)}`, value: monP.get(mk) || 0 })), labelEvery: 1, fmt: v => fmtInt(v), height: 200 });
    $('#c-tm').querySelectorAll('svg text').forEach(t => { if (!t.textContent) t.remove(); });
  }
  barChart($('#c-th'), { data: d3.range(24).map(h => ({ key: h, label: hourLabel(h), value: hourP[h] })), fmt: v => fmtInt(v), height: 160 });
};

// ---------------- Trends: bump chart + bar race
V.trends = () => {
  view().innerHTML = head('Trends', 'How your favorite artists rose and fell.', false) + `
    <div class="card"><h2>Top 10 artists each year</h2><div class="sub">Rank by hours. Hover an artist to trace them across years; click to open.</div><div class="chart" id="bump"></div></div>
    <div class="card"><h2>Artist race</h2><div class="sub">Cumulative hours, month by month.</div>
      <div class="toolbar"><button class="btn" id="raceBtn">Play</button><input type="range" id="raceSlider" min="0" value="0" style="flex:1;min-width:160px" aria-label="Month"><span id="raceLbl" class="num" style="font-weight:650;min-width:90px"></span></div>
      <div class="chart" id="race"></div></div>`;
  bumpChart($('#bump')); race();
};
function bumpChart(el) {
  const years = P.years.filter(y => itemStats(y).totals.music > 20 * 3600);
  const ranks = years.map(y => topN(itemStats(y).artists.secs, 10));
  const m = { t: 24, r: 10, b: 10, l: 10 }, rowH = 34;
  const { svg, g, iw } = frame(el, m.t + m.b + rowH * 10, m);
  const x = d3.scalePoint().domain(years).range([0, iw]).padding(0.5), colW = x.step();
  const yy = r => r * rowH + rowH / 2;
  years.forEach(y => g.append('text').attr('x', x(y)).attr('y', -8).attr('text-anchor', 'middle').attr('class', 'lbl-strong').text(y));
  const pos = new Map(); ranks.forEach((list, yi) => list.forEach((a, r) => { if (!pos.has(a)) pos.set(a, []); pos.get(a).push([yi, r]); }));
  const lines = g.append('g'), cells = g.append('g');
  pos.forEach((pts, a) => {
    for (let k = 1; k < pts.length; k++) if (pts[k][0] === pts[k - 1][0] + 1) {
      const [y0, r0] = pts[k - 1], [y1, r1] = pts[k];
      lines.append('path').attr('data-a', a).attr('d', `M${x(years[y0]) + colW * 0.42},${yy(r0)} C${x(years[y0]) + colW * 0.5},${yy(r0)} ${x(years[y1]) - colW * 0.5},${yy(r1)} ${x(years[y1]) - colW * 0.42},${yy(r1)}`)
        .attr('fill', 'none').attr('stroke', 'var(--axis)').attr('stroke-width', 2);
    }
  });
  const maxChars = Math.max(4, Math.floor(colW * 0.84 / 6.4));
  ranks.forEach((list, yi) => list.forEach((a, r) => {
    const gg = cells.append('g').attr('data-a', a).style('cursor', 'pointer');
    gg.append('rect').attr('x', x(years[yi]) - colW * 0.42).attr('y', yy(r) - 12).attr('width', colW * 0.84).attr('height', 24).attr('rx', 6).attr('fill', 'var(--surface-2)');
    const nm = D.lib.artists[a];
    gg.append('text').attr('x', x(years[yi])).attr('y', yy(r) + 4).attr('text-anchor', 'middle').attr('class', 'lbl').text(nm.length > maxChars ? nm.slice(0, maxChars - 1) + '…' : nm);
    gg.on('mouseenter', ev => { hl(a); tip.show(`<b>${esc(nm)}</b>${tipRows(pos.get(a).map(([yi2, r2]) => [String(years[yi2]), `#${r2 + 1} · ${fmtH(itemStats(years[yi2]).artists.secs[a])}`]))}`, ev); })
      .on('mousemove', ev => tip.move(ev)).on('mouseleave', () => { hl(null); tip.hide(); }).on('click', () => { tip.hide(); location.hash = `#/artist/${a}`; });
  }));
  function hl(a) {
    lines.selectAll('path').attr('stroke', function () { return a != null && +this.dataset.a === a ? 'var(--accent)' : 'var(--axis)'; }).attr('stroke-width', function () { return a != null && +this.dataset.a === a ? 3 : 2; }).attr('opacity', function () { return a == null || +this.dataset.a === a ? 1 : 0.35; });
    cells.selectAll('g').each(function () { const on = a != null && +this.dataset.a === a; d3.select(this).select('rect').attr('fill', on ? 'var(--accent)' : 'var(--surface-2)'); d3.select(this).select('text').attr('fill', on ? '#fff' : null).attr('opacity', a == null || on ? 1 : 0.45); });
  }
  dataTable(el, ['Rank'].concat(years.map(String)), d3.range(10).map(r => [`#${r + 1}`].concat(ranks.map(l => (l[r] != null ? D.lib.artists[l[r]] : '')))));
}
let raceTimer = null;
function race() {
  const act = active(), months = new Map();
  for (let p = 0; p < P.n; p++) { if (!act[p] || P.k[p] !== 0) continue; const mk = P.year[p] * 12 + P.mon[p]; let mm = months.get(mk); if (!mm) months.set(mk, mm = new Map()); mm.set(P.artist[p], (mm.get(P.artist[p]) || 0) + P.s[p]); }
  const keys = [...months.keys()].sort((a, b) => a - b).filter(k => k >= Math.min(...[...months].filter(([, v]) => [...v.values()].reduce((s, x) => s + x, 0) > 3600).map(([k]) => k)));
  const cum = new Float64Array(D.lib.artists.length), frames = [];
  for (const k of keys) { months.get(k).forEach((s, a) => { cum[a] += s; }); frames.push({ k, top: topN(cum, 12).map(a => [a, cum[a]]) }); }
  const el = $('#race'), slider = $('#raceSlider'), btn = $('#raceBtn'), lbl = $('#raceLbl');
  slider.max = frames.length - 1; slider.value = frames.length - 1;
  const m = { t: 6, r: 70, b: 6, l: 170 }, n = 12, bh = 26;
  const { g, iw } = frame(el, m.t + m.b + n * bh, m);
  const draw = (fi, dur) => {
    const fr = frames[fi]; lbl.textContent = `${MON[fr.k % 12]} ${Math.floor(fr.k / 12)}`;
    const x = d3.scaleLinear().domain([0, fr.top[0][1]]).range([0, iw]);
    const rows = g.selectAll('.rr').data(fr.top, d => d[0]);
    const ent = rows.enter().append('g').attr('class', 'rr').attr('transform', `translate(0,${n * bh})`).attr('opacity', 0);
    ent.append('path').attr('fill', 'var(--series-1)');
    ent.append('text').attr('class', 'lbl-strong nm').attr('x', -8).attr('y', bh / 2 + 4).attr('text-anchor', 'end');
    ent.append('text').attr('class', 'lbl val').attr('y', bh / 2 + 4);
    const all = ent.merge(rows);
    all.transition().duration(dur).ease(d3.easeLinear).attr('transform', (d, i) => `translate(0,${i * bh})`).attr('opacity', 1);
    all.select('path').transition().duration(dur).ease(d3.easeLinear).attr('d', d => hbarPath(0, 3, Math.max(1, x(d[1])), bh - 6));
    all.select('.nm').text(d => { const s = D.lib.artists[d[0]]; return s.length > 24 ? s.slice(0, 23) + '…' : s; });
    all.select('.val').transition().duration(dur).ease(d3.easeLinear).attr('x', d => x(d[1]) + 6).text(d => fmtInt(d[1] / 3600) + ' h');
    rows.exit().transition().duration(dur).attr('transform', `translate(0,${n * bh})`).attr('opacity', 0).remove();
  };
  draw(frames.length - 1, 0);
  const stop = () => { clearInterval(raceTimer); raceTimer = null; btn.textContent = 'Play'; };
  slider.oninput = () => { stop(); draw(+slider.value, 0); };
  btn.onclick = () => {
    if (raceTimer) return stop();
    if (+slider.value >= frames.length - 1) slider.value = 0;
    btn.textContent = 'Pause';
    raceTimer = setInterval(() => { const v = +slider.value + 1; if (v >= frames.length) return stop(); slider.value = v; draw(v, 140); }, 150);
  };
}

// ---------------- On this day
V.onthisday = ([md]) => {
  const now = new Date(); let [mo, dd] = md ? md.split('-').map(Number) : [now.getMonth() + 1, now.getDate()];
  const act = active();
  const cards = P.years.slice().reverse().map(y => {
    const day = Math.floor(Date.UTC(y, mo - 1, dd) / 864e5); const d = dateOf(day * 86400); if (d.getUTCMonth() !== mo - 1) return '';
    const ps = (P.byDay.get(day) || []).filter(p => act[p]); if (!ps.length) return '';
    const tot = ps.reduce((s, p) => s + P.s[p], 0), c = new Map();
    ps.forEach(p => { const key = P.k[p] + ':' + P.i[p]; const o = c.get(key) || { p, s: 0 }; o.s += P.s[p]; c.set(key, o); });
    const top = [...c.values()].sort((a, b) => b.s - a.s).slice(0, 5);
    return `<div class="card"><h2><a href="#/calendar/${day}">${y}</a> <span class="faint" style="font-weight:400;font-size:14px">· ${DOW[((day % 7) + 10) % 7]} · ${fmtH(tot)} · first play ${fmtTime(P.t[ps[0]])}</span></h2>${rankList(top.map(o => { const pl = playLabel(o.p); return { url: pl.url, title: pl.title, titleHtml: pl.href ? `<a href="${pl.href}">${esc(pl.title)}</a>` : null, sub: pl.sub, value: fmtH(o.s) }; }))}</div>`;
  }).filter(Boolean);
  view().innerHTML = head('On this day', `What you were listening to on ${MONTH[mo - 1]} ${dd} in every year.`, false) + `
    <div class="toolbar"><select id="otdM" class="select" aria-label="Month">${MONTH.map((m, i) => `<option value="${i + 1}" ${i + 1 === mo ? 'selected' : ''}>${m}</option>`).join('')}</select>
    <select id="otdD" class="select" aria-label="Day">${d3.range(1, 32).map(i => `<option ${i === dd ? 'selected' : ''}>${i}</option>`).join('')}</select>
    <button class="btn ghost" id="otdPrev">← Previous day</button><button class="btn ghost" id="otdNext">Next day →</button><button class="btn ghost" id="otdToday">Today</button><button class="btn ghost" id="otdRand">Random date</button></div>
    ${cards.length ? cards.join('') : '<p class="muted">No listening on this date in any year.</p>'}`;
  const go = (m2, d2) => { location.hash = `#/onthisday/${m2}-${d2}`; };
  const shift = k => { const d = new Date(Date.UTC(2024, mo - 1, dd + k)); go(d.getUTCMonth() + 1, d.getUTCDate()); };
  $('#otdM').onchange = e => go(+e.target.value, dd); $('#otdD').onchange = e => go(mo, +e.target.value);
  $('#otdPrev').onclick = () => shift(-1); $('#otdNext').onclick = () => shift(1);
  $('#otdToday').onclick = () => go(now.getMonth() + 1, now.getDate());
  $('#otdRand').onclick = () => { const d = new Date(Date.UTC(2024, 0, 1 + Math.floor(Math.random() * 366))); go(d.getUTCMonth() + 1, d.getUTCDate()); };
};

// ---------------- Habits
V.habits = () => {
  const sc = scope(), act = active(), grid = Array.from({ length: 7 }, () => new Float64Array(24)), monS = new Float64Array(12);
  let total = 0, off = 0, priv = 0, vid = 0;
  for (let p = 0; p < P.n; p++) { if (!sc[p]) continue; const s = P.s[p]; grid[P.dow[p]][P.hour[p]] += s; monS[P.mon[p]] += s; total += s; if (P.f[p] & 4) off += s; if (P.f[p] & 8) priv += s; if (P.f[p] & 32) vid += s; }
  const yrs = P.years.filter(y => itemStats(y).totals.music > 20 * 3600);
  const beh = new Map(yrs.map(y => [y, { n: 0, done: 0, fwd: 0, shuf: 0, pick: 0 }]));
  for (let p = 0; p < P.n; p++) { if (!act[p] || P.k[p] !== 0) continue; const o = beh.get(P.year[p]); if (!o) continue; o.n++; if (P.re[p] === REASON.trackdone) o.done++; if (P.re[p] === REASON.fwdbtn) o.fwd++; if (P.f[p] & 1) o.shuf++; if (P.rs[p] === REASON.clickrow) o.pick++; }
  view().innerHTML = head('Habits', 'When and how you listen.') + `
    <div class="tiles">${tile(fmtH(total), 'listening in view')}${tile(fmtH(off), 'played offline')}${tile(fmtH(priv), 'in private sessions')}${tile(fmtH(vid), 'video (podcasts & clips)')}</div>
    <div class="card"><h2>Your listening clock</h2><div class="sub">hours by weekday and hour of day</div><div id="clock"></div></div>
    <div class="grid g2">
      <div class="card"><h2>Seasons</h2><div class="sub">hours by month of year</div><div class="chart" id="c-moy"></div></div>
      <div class="card"><h2>How songs start and end</h2><div class="sub">share of music plays, by year (all years)</div><div class="chart" id="c-beh"></div>
        <p class="faint" style="font-size:12px;margin-top:8px">Spotify's own "skipped" flag wasn't recorded before 2022, so "skipped with next" uses how each song ended instead.</p></div>
    </div>
    <div class="grid g2"><div class="card"><h2>Songs you finish</h2><div class="sub">artists with 150+ plays in view, highest share played to the end</div><div id="comp-hi"></div></div>
    <div class="card"><h2>Songs you skip</h2><div class="sub">lowest share played to the end</div><div id="comp-lo"></div></div></div>`;
  // clock heatmap
  const el = $('#clock'), w = el.clientWidth, cw = Math.max(12, Math.floor((w - 50) / 24)), ch = Math.min(30, cw);
  const max = Math.max(...grid.map(r => Math.max(...r))) || 1, thr = [0.1, 0.25, 0.45, 0.65, 0.85].map(f => f * max);
  const color = seqScale(thr);
  const svg = d3.select(el).append('svg').attr('width', 50 + 24 * cw).attr('height', 7 * ch + 22);
  DOW.forEach((d, i) => svg.append('text').attr('x', 40).attr('y', i * ch + ch / 2 + 4).attr('text-anchor', 'end').attr('fill', 'var(--text-muted)').attr('font-size', 11).text(d));
  d3.range(0, 24, 3).forEach(h => svg.append('text').attr('x', 50 + h * cw + cw / 2).attr('y', 7 * ch + 16).attr('text-anchor', 'middle').attr('fill', 'var(--text-muted)').attr('font-size', 11).text(hourLabel(h)));
  for (let d = 0; d < 7; d++) for (let h = 0; h < 24; h++) {
    svg.append('rect').attr('x', 50 + h * cw).attr('y', d * ch).attr('width', cw - 2).attr('height', ch - 2).attr('rx', 3).attr('fill', color(grid[d][h]))
      .on('mouseenter', ev => tip.show(`<b>${DOW[d]} ${hourLabel(h)}m</b>${tipRows([['Hours', fmtHnum(grid[d][h])], ['Share', pct(grid[d][h] / total, 1)]])}`, ev)).on('mousemove', ev => tip.move(ev)).on('mouseleave', () => tip.hide());
  }
  dataTable(el, ['Day'].concat(d3.range(24).map(hourLabel)), DOW.map((d, i) => [d].concat(Array.from(grid[i], v => fmtHnum(v)))));
  barChart($('#c-moy'), { data: MON.map((m, i) => ({ key: i, label: m, full: MONTH[i], value: monS[i] / 3600 })), fmt: v => fmtInt(v) + ' h', height: 200 });
  const series = [['Played to the end', 'done', 'var(--series-1)'], ['Skipped with next', 'fwd', 'var(--series-2)'], ['Shuffle on', 'shuf', 'var(--series-3)'], ['Picked yourself', 'pick', 'var(--series-4)']]
    .map(([name, k, color]) => ({ name, color, values: yrs.map(y => beh.get(y)[k] / beh.get(y).n) }));
  lineChart($('#c-beh'), { series, xLabels: yrs.map(String), fmt: v => pct(v), yDomain: [0, 1], height: 220 });
  // completion
  const st = itemStats(), comp = new Map();
  for (let p = 0; p < P.n; p++) { if (!sc[p] || P.k[p] !== 0) continue; const a = P.artist[p]; let o = comp.get(a); if (!o) comp.set(a, o = [0, 0]); o[0]++; if (P.re[p] === REASON.trackdone) o[1]++; }
  const elig = [...comp].filter(([, o]) => o[0] >= 150).map(([a, o]) => [a, o[1] / o[0], o[0]]);
  const li = list => rankList(list.map(([a, r, n]) => ({ url: artistUrl(a), title: D.lib.artists[a], titleHtml: artistLink(a), sub: `${fmtInt(n)} plays · ${fmtH(st.artists.secs[a])}`, value: pct(r), round: true })));
  $('#comp-hi').innerHTML = elig.length ? li(elig.slice().sort((a, b) => b[1] - a[1]).slice(0, 10)) : '<p class="muted">Not enough plays.</p>';
  $('#comp-lo').innerHTML = elig.length ? li(elig.slice().sort((a, b) => a[1] - b[1]).slice(0, 10)) : '<p class="muted">Not enough plays.</p>';
};

// ---------------- Sessions & binges
function sessions(sc) {
  const out = []; let cur = null, prevEnd = -Infinity;
  for (let p = 0; p < P.n; p++) {
    if (!sc[p]) continue;
    if (P.t[p] - prevEnd > 1800 || !cur) { cur = { start: P.t[p], secs: 0, n: 0, first: p, art: new Map() }; out.push(cur); }
    cur.secs += P.s[p]; cur.n++; prevEnd = Math.max(prevEnd, P.t[p] + P.s[p]);
    const key = P.k[p] === 0 ? 'a' + P.artist[p] : P.k[p] === 1 ? 's' + P.show[p] : 'b' + P.i[p];
    cur.art.set(key, (cur.art.get(key) || 0) + P.s[p]);
  }
  return out;
}
V.sessions = () => {
  const sc = scope(), ss = memo('sessions', () => sessions(sc)).filter(s => s.secs > 0);
  const lens = ss.map(s => s.secs).sort((a, b) => a - b), med = lens[Math.floor(lens.length / 2)] || 0, mean = lens.reduce((a, b) => a + b, 0) / (lens.length || 1);
  const buckets = [[0, 300, '< 5 min'], [300, 900, '5–15 min'], [900, 1800, '15–30 min'], [1800, 3600, '30–60 min'], [3600, 7200, '1–2 h'], [7200, 14400, '2–4 h'], [14400, Infinity, '4 h +']];
  const actSess = memo('sessions-all', () => sessions(active()), false);
  const byYear = d3.rollups(actSess.filter(s => s.secs > 0), v => d3.mean(v, s => s.secs), s => dateOf(s.start).getUTCFullYear()).sort((a, b) => a[0] - b[0]).filter(([y]) => itemStats(y).totals.total > 3600 * 3);
  const longest = ss.slice().sort((a, b) => b.secs - a.secs).slice(0, 10);
  const label = key => key[0] === 'a' ? D.lib.artists[+key.slice(1)] : key[0] === 's' ? D.lib.shows[+key.slice(1)] : D.lib.books[+key.slice(1)][0];
  // on-repeat runs
  const runs = []; let cur = null;
  for (let p = 0; p < P.n; p++) {
    if (!sc[p] || P.k[p] !== 0) continue;
    if (cur && cur.id === P.i[p]) cur.n++; else { if (cur && cur.n >= 5) runs.push(cur); cur = { id: P.i[p], n: 1, t: P.t[p] }; }
  }
  if (cur && cur.n >= 5) runs.push(cur);
  runs.sort((a, b) => b.n - a.n);
  view().innerHTML = head('Sessions & binges', 'A session ends after 30 minutes of silence.') + `
    <div class="tiles">${tile(fmtInt(ss.length), 'sessions')}${tile(Math.round(med / 60) + ' min', 'typical (median) session')}${tile(Math.round(mean / 60) + ' min', 'average session')}${tile(longest[0] ? fmtH(longest[0].secs) : '–', 'longest session', longest[0] ? fmtDate(longest[0].start) : '')}</div>
    <div class="grid g2"><div class="card"><h2>Session lengths</h2><div class="sub">number of sessions</div><div class="chart" id="c-sl"></div></div>
    <div class="card"><h2>Average session by year</h2><div class="sub">minutes (all years)</div><div class="chart" id="c-sy"></div></div></div>
    <div class="grid g2">
      <div class="card"><h2>Longest sessions</h2><div class="table-wrap"><table class="tbl"><thead><tr><th>Started</th><th class="r">Length</th><th class="r">Plays</th><th>Mostly</th></tr></thead><tbody>
      ${longest.map(s => `<tr><td><a href="#/calendar/${Math.floor(s.start / 86400)}">${fmtDate(s.start)}</a> <span class="faint">${fmtTime(s.start)}</span></td><td class="r">${fmtH(s.secs)}</td><td class="r">${fmtInt(s.n)}</td><td class="name">${esc(label([...s.art].sort((a, b) => b[1] - a[1])[0][0]))}</td></tr>`).join('')}</tbody></table></div></div>
      <div class="card"><h2>On repeat</h2><div class="sub">the same song back-to-back</div><div class="table-wrap"><table class="tbl"><thead><tr><th>Song</th><th class="r">In a row</th><th>Date</th></tr></thead><tbody>
      ${runs.slice(0, 15).map(r => `<tr><td><div class="who">${img(trackUrl(r.id), D.lib.tracks[r.id][0], 'sm')}<div><div class="t name">${trackLink(r.id)}</div><div class="a">${artistLink(D.lib.tracks[r.id][1])}</div></div></div></td><td class="r">${r.n}×</td><td><a href="#/calendar/${Math.floor(r.t / 86400)}">${fmtDate(r.t)}</a></td></tr>`).join('')}</tbody></table></div></div>
    </div>`;
  barChart($('#c-sl'), { data: buckets.map(([a, b, l], i) => ({ key: i, label: l, value: lens.filter(v => v >= a && v < b).length })), fmt: v => fmtInt(v), height: 200, labelEvery: 1 });
  barChart($('#c-sy'), { data: byYear.map(([y, v]) => ({ key: y, label: String(y), value: v / 60 })), fmt: v => fmtInt(v) + ' min', height: 200, highlight: F.year === 'all' ? null : +F.year });
};

// ---------------- Discovery
V.discovery = () => {
  const act = active(), firstA = firstSeen('artist'), firstT = firstSeen('track');
  const yrs = P.years.filter(y => itemStats(y).totals.music > 20 * 3600);
  const newA = new Map(yrs.map(y => [y, 0]));
  firstA.forEach(t => { if (isFinite(t)) { const y = dateOf(t).getUTCFullYear(); if (newA.has(y)) newA.set(y, newA.get(y) + 1); } });
  const fresh = new Map(yrs.map(y => [y, [0, 0]]));
  for (let p = 0; p < P.n; p++) { if (!act[p] || P.k[p] !== 0) continue; const o = fresh.get(P.year[p]); if (!o) continue; o[1] += P.s[p]; if (isFinite(firstT[P.i[p]]) && dateOf(firstT[P.i[p]]).getUTCFullYear() === P.year[p]) o[0] += P.s[p]; }
  const st = allTime(), top = topN(st.artists.secs, 30).sort((a, b) => firstA[a] - firstA[b]);
  const lastT = P.t[P.n - 1], recent = topN(st.artists.secs, 15, a => firstA[a] > lastT - 365 * 86400);
  view().innerHTML = head('Discovery', 'New music versus old favorites.', false) + `
    <div class="grid g2"><div class="card"><h2>New artists each year</h2><div class="sub">artists streamed for the first time</div><div class="chart" id="c-na"></div></div>
    <div class="card"><h2>Fresh vs familiar</h2><div class="sub">share of music hours on songs first heard that year</div><div class="chart" id="c-fr"></div></div></div>
    <div class="card"><h2>Your top 30 artists through the years</h2><div class="sub">hours per year, ordered by when you found them</div><div id="strip" class="table-wrap"></div></div>
    <div class="card"><h2>Latest discoveries</h2><div class="sub">artists first heard in the last 12 months</div>${recent.length ? rankList(recent.map(a => ({ url: artistUrl(a), title: D.lib.artists[a], titleHtml: artistLink(a), sub: 'first heard ' + fmtDate(firstA[a]), value: fmtH(st.artists.secs[a]), round: true }))) : '<p class="muted">None.</p>'}</div>`;
  barChart($('#c-na'), { data: yrs.map(y => ({ key: y, label: String(y), value: newA.get(y) })), height: 200 });
  lineChart($('#c-fr'), { series: [{ name: 'Fresh share', color: 'var(--series-1)', values: yrs.map(y => fresh.get(y)[0] / (fresh.get(y)[1] || 1)) }], xLabels: yrs.map(String), fmt: v => pct(v), yDomain: [0, 1], height: 200 });
  const ys = yrs, vals = top.map(a => ys.map(y => itemStats(y).artists.secs[a]));
  const thr = [2, 5, 10, 20, 35].map(h => h * 3600), color = seqScale(thr);
  $('#strip').innerHTML = `${seqLegend(thr, fmtH)}<table class="tbl" style="margin-top:8px"><thead><tr><th>Artist</th>${ys.map(y => `<th class="r">${String(y).slice(2).padStart(3, "'")}</th>`).join('')}</tr></thead><tbody>${top.map((a, i) => `<tr><td class="name">${artistLink(a)}</td>${vals[i].map((v, j) => `<td title="${esc(D.lib.artists[a])} · ${ys[j]} · ${fmtH(v)}" style="padding:2px"><div style="height:22px;border-radius:4px;background:${color(v)}"></div></td>`).join('')}</tr>`).join('')}</tbody></table>`;
};

// ---------------- Places
V.places = async () => {
  const M = D.meta, mask = effMask(), byC = new Map();
  let vpnS = 0, unk = 0;
  Object.entries(M.country_secs || {}).forEach(([c, byMask]) => {
    const s = Object.entries(byMask).reduce((a, [x, v]) => a + ((+x & mask) ? 0 : v), 0);
    if (c === 'VPN') vpnS += s; else if (c === 'ZZ') unk += s; else if (s) byC.set(c, s);
  });
  const trips = M.trips;
  view().innerHTML = head('Places', 'Where you listened, from the country Spotify logged for each stream. Trip dates are shown by month only.', false) + `
    <div class="card"><h2>Countries</h2><div class="sub">Blue = trips abroad; gray-blue = home. VPN connections are counted as home.</div><div class="chart map" id="map"></div></div>
    <div class="card"><h2>Trips</h2><div class="table-wrap"><table class="tbl"><thead><tr><th>Country</th><th>When</th><th>Length</th><th class="r">Listening</th><th>Soundtrack</th></tr></thead><tbody>
      ${trips.map(t => `<tr><td>${esc(t.name)}</td><td>${esc(t.period)}</td><td>${esc(t.length)}</td><td class="r">${fmtH(t.hours * 3600)}</td><td class="name sub">${esc(t.top.join(', '))}</td></tr>`).join('')}</tbody></table></div></div>
    <div class="grid g2"><div class="card"><h2>VPN connections</h2><div class="sub">Logged abroad but played from home - counted as home listening (${fmtH(vpnS)}).</div>
      <table class="tbl"><thead><tr><th>Month</th><th>Logged as</th><th class="r">Plays</th></tr></thead><tbody>${M.vpn_runs.map(v => `<tr><td>${esc(v.month)}</td><td>${esc(M.countries.find(c => c.code === v.country)?.name || v.country)}</td><td class="r">${v.plays}</td></tr>`).join('')}</tbody></table></div>
      <div class="card"><h2>Unknown country</h2><div class="sub">Spotify logged "ZZ" (no country) for ${fmtH(unk)} of listening, mostly short bursts in 2017–2020 - typical of in-flight Wi-Fi or a network Spotify couldn't place.</div></div></div>`;
  let world;
  try { world = await getJSON('https://cdn.jsdelivr.net/npm/world-atlas@2.0.2/countries-110m.json'); } catch (e) { $('#map').innerHTML = '<p class="muted">Map unavailable offline.</p>'; return; }
  const el = $('#map'); if (!el) return;
  const w = el.clientWidth, h = Math.round(w * 0.5);
  const feats = topojson.feature(world, world.objects.countries).features;
  const proj = d3.geoNaturalEarth1().fitSize([w, h], { type: 'Sphere' }), path = d3.geoPath(proj);
  const svg = d3.select(el).append('svg').attr('width', w).attr('height', h);
  const byNum = new Map(M.countries.filter(c => c.iso_n).map(c => [c.iso_n, c]));
  svg.append('path').attr('d', path({ type: 'Sphere' })).attr('fill', 'var(--surface-2)');
  svg.selectAll('path.land').data(feats).join('path').attr('class', 'land').attr('d', path)
    .attr('fill', f => { const c = byNum.get(+f.id); if (!c || !byC.get(c.code)) return 'var(--seq-0)'; return c.code === 'US' ? 'var(--seq-2)' : 'var(--series-1)'; })
    .on('mouseenter', (ev, f) => { const c = byNum.get(+f.id); const s = c ? byC.get(c.code) : 0; if (!s) return; const tr = trips.filter(t => t.country === c.code); tip.show(`<b>${esc(c.name)}</b>${tipRows([['Listening', fmtH(s)]].concat(c.code !== 'US' ? [['Trips', String(tr.length)]] : []))}`, ev); })
    .on('mousemove', ev => tip.move(ev)).on('mouseleave', () => tip.hide());
  // small countries that 110m omits get a dot
  const centers = { BB: [-59.55, 13.15], BS: [-77.4, 25.0] };
  Object.entries(centers).forEach(([code, ll]) => { if (byC.get(code)) { const [x, y] = proj(ll); svg.append('circle').attr('cx', x).attr('cy', y).attr('r', 4).attr('fill', 'var(--series-1)').attr('stroke', 'var(--surface-1)').attr('stroke-width', 2); } });
  dataTable(el, ['Country', 'Listening'], [...byC].sort((a, b) => b[1] - a[1]).map(([c, s]) => [M.countries.find(x => x.code === c).name, fmtH(s)]));
};

// ---------------- Devices
V.devices = () => {
  const act = active(), M = D.meta, dv = new Map();
  for (let p = 0; p < P.n; p++) { if (!act[p]) continue; const d = P.d[p]; let o = dv.get(d); if (!o) dv.set(d, o = { secs: 0, first: Infinity, last: -Infinity }); o.secs += P.s[p]; o.first = Math.min(o.first, P.t[p]); o.last = Math.max(o.last, P.t[p]); }
  const rows = [...dv].filter(([, o]) => o.secs > 1800).sort((a, b) => a[1].first - b[1].first);
  view().innerHTML = head('Devices', 'What you listened on, and when.', false) + `
    <div class="card"><h2>Device timeline</h2><div class="sub">bar spans first to last use; label shows total listening</div><div class="chart" id="gantt"></div>
    <p class="faint" style="font-size:12px;margin-top:8px">From October 2022 Spotify stopped logging the iPhone model, so later phone listening shows as "iPhone (model not reported)".</p></div>`;
  const el = $('#gantt'), m = { t: 20, r: 70, b: 6, l: 190 }, rh = 30;
  const { g, iw } = frame(el, m.t + m.b + rows.length * rh, m);
  const x = d3.scaleTime().domain([dateOf(P.t[0]), dateOf(P.t[P.n - 1])]).range([0, iw]);
  g.append('g').attr('class', 'gridline').call(d3.axisTop(x).ticks(d3.timeYear.every(1)).tickSize(-rows.length * rh).tickFormat(d3.utcFormat('%Y'))).call(s => s.select('.domain').remove()).call(s => s.selectAll('line').attr('stroke', 'var(--grid)'));
  rows.forEach(([d, o], i) => {
    const x0 = x(dateOf(o.first)), x1 = Math.max(x0 + 4, x(dateOf(o.last)));
    g.append('text').attr('class', 'lbl-strong').attr('x', -10).attr('y', i * rh + rh / 2 + 4).attr('text-anchor', 'end').text(M.devices[d]);
    g.append('rect').attr('x', x0).attr('y', i * rh + 7).attr('width', x1 - x0).attr('height', rh - 14).attr('rx', 4).attr('fill', 'var(--series-1)')
      .on('mouseenter', ev => tip.show(`<b>${esc(M.devices[d])}</b>${tipRows([['Listening', fmtH(o.secs)], ['First', fmtDate(o.first)], ['Last', fmtDate(o.last)]])}`, ev)).on('mousemove', ev => tip.move(ev)).on('mouseleave', () => tip.hide());
    g.append('text').attr('class', 'lbl').attr('x', x1 + 6).attr('y', i * rh + rh / 2 + 4).text(fmtH(o.secs));
  });
  dataTable(el, ['Device', 'Listening', 'First', 'Last'], rows.map(([d, o]) => [M.devices[d], fmtH(o.secs), fmtDate(o.first), fmtDate(o.last)]));
};

// ---------------- Podcasts & audiobooks
V.podcasts = () => {
  const st = itemStats(), act = active(), L = D.lib, py = new Map(), by = new Map();
  for (let p = 0; p < P.n; p++) { if (!act[p]) continue; if (P.k[p] === 1) py.set(P.year[p], (py.get(P.year[p]) || 0) + P.s[p]); if (P.k[p] === 2) by.set(P.year[p], (by.get(P.year[p]) || 0) + P.s[p]); }
  const sc = scope(), eps = new Map(); for (let p = 0; p < P.n; p++) if (sc[p] && P.k[p] === 1) { const s = P.show[p]; if (!eps.has(s)) eps.set(s, new Set()); eps.get(s).add(P.i[p]); }
  const shows = topN(st.shows.secs, 40), books = topN(st.books.secs, 60, j => st.books.secs[j] > 300), topEps = topN(st.episodes.secs, 12);
  const ys = [...new Set([...py.keys(), ...by.keys()])].sort();
  view().innerHTML = head('Podcasts & audiobooks', 'Everything that isn\'t music.') + `
    <div class="card"><h2>Hours per year</h2><div class="chart" id="c-pb"></div></div>
    <div class="grid g2">
      <div class="card"><h2>Podcasts</h2><div class="table-wrap"><table class="tbl"><thead><tr><th>Show</th><th class="r">Hours</th><th class="r">Episodes</th><th>Last</th></tr></thead><tbody>
        ${shows.map(s => `<tr><td><div class="who">${img(showUrl(s), L.shows[s], 'sm')}<div class="t name">${esc(L.shows[s])}</div></div></td><td class="r">${fmtHnum(st.shows.secs[s])}</td><td class="r">${eps.get(s)?.size || 0}</td><td class="num">${fmtDate(st.shows.last[s])}</td></tr>`).join('')}</tbody></table></div></div>
      <div class="card"><h2>Audiobooks</h2><div class="sub">titles with 5+ minutes</div><div class="table-wrap"><table class="tbl"><thead><tr><th>Book</th><th class="r">Hours</th><th>Started</th><th>Last</th></tr></thead><tbody>
        ${books.map(b => `<tr><td><div class="who">${img(bookUrl(b), L.books[b][0], 'sm')}<div class="t name">${esc(L.books[b][0])}</div></div></td><td class="r">${fmtHnum(st.books.secs[b])}</td><td class="num">${fmtDate(st.books.first[b])}</td><td class="num">${fmtDate(st.books.last[b])}</td></tr>`).join('')}</tbody></table></div></div>
    </div>
    <div class="card"><h2>Most-played episodes</h2>${rankList(topEps.map(e => ({ url: showUrl(L.episodes[e][1]), title: L.episodes[e][0], sub: L.shows[L.episodes[e][1]], value: fmtH(st.episodes.secs[e]) })))}</div>`;
  stackedBars($('#c-pb'), { keys: [{ key: 'p', label: 'Podcasts', color: 'var(--series-2)' }, { key: 'b', label: 'Audiobooks', color: 'var(--series-3)' }], data: ys.map(y => ({ key: y, label: String(y), values: { p: (py.get(y) || 0) / 3600, b: (by.get(y) || 0) / 3600 } })), fmt: v => fmtHnum(v * 3600) + ' h', height: 200 });
};

// ---------------- Covers
const COV = { what: 'albums', n: 100 };
V.covers = () => {
  const st = itemStats(), S = st[COV.what], ids = topN(S.secs, COV.n), L = D.lib;
  view().innerHTML = head('Cover wall', 'Your most-played albums and artists, sized by hours.') + `
    <div class="toolbar"><div class="chips"><button class="chip ${COV.what === 'albums' ? 'on' : ''}" data-w="albums">Albums</button><button class="chip ${COV.what === 'artists' ? 'on' : ''}" data-w="artists">Artists</button></div>
      <select class="select" id="covN" aria-label="How many">${[50, 100, 200, 400].map(n => `<option ${n === COV.n ? 'selected' : ''}>${n}</option>`).join('')}</select>
      ${Object.keys(D.art.albums).length ? '' : '<span class="faint">No cover art yet - run scripts/fetch_art.py.</span>'}</div>
    <div class="covers" id="covers"></div>`;
  const max = S.secs[ids[0]] || 1, wrap = $('#covers');
  const size = s => Math.round(64 + 120 * Math.sqrt(s / max));
  wrap.innerHTML = ids.map(j => {
    const url = COV.what === 'albums' ? albumUrl(j) : artistUrl(j), name = COV.what === 'albums' ? L.albums[j][0] : L.artists[j], px = size(S.secs[j]);
    const href = COV.what === 'albums' ? `#/artist/${L.albums[j][1]}` : `#/artist/${j}`;
    return `<a class="cover" href="${href}" data-j="${j}" style="width:${px}px;height:${px}px" aria-label="${esc(name)}, ${fmtH(S.secs[j])}">${url ? `<img src="${esc(url)}" alt="" loading="lazy" referrerpolicy="no-referrer">` : initials(name)}</a>`;
  }).join('');
  wrap.querySelectorAll('.cover').forEach(a => {
    const j = +a.dataset.j;
    a.addEventListener('mouseenter', ev => tip.show(`<b>${esc(COV.what === 'albums' ? L.albums[j][0] : L.artists[j])}</b>${COV.what === 'albums' ? `<br><span class="k">${esc(L.artists[L.albums[j][1]])}</span>` : ''}${tipRows([['Hours', fmtHnum(S.secs[j])], ['Streams', fmtInt(S.plays[j])]])}`, ev));
    a.addEventListener('mousemove', ev => tip.move(ev)); a.addEventListener('mouseleave', () => tip.hide());
  });
  view().querySelectorAll('[data-w]').forEach(b => b.onclick = () => { COV.what = b.dataset.w; V.covers(); });
  $('#covN').onchange = e => { COV.n = +e.target.value; V.covers(); };
};

// ---------------- Excluded plays review
V.excluded = () => {
  const rules = D.meta.rules, per = rules.map(() => new Map());
  for (let p = 0; p < P.n; p++) { const x = P.x[p]; if (!x) continue; rules.forEach((r, i) => { if (x >> r.bit & 1) { const key = P.k[p] + ':' + P.i[p]; const o = per[i].get(key) || { p, n: 0, s: 0 }; o.n++; o.s += P.s[p]; per[i].set(key, o); } }); }
  view().innerHTML = head('Excluded plays', 'What each exclusion rule removes when "Personal only" is on. Toggle rules with the Exclusions button.', false) +
    rules.map((r, i) => `<div class="card"><h2>${esc(r.label)} <span class="chip ${F.rules[r.id] ? 'on' : ''}" style="font-size:12px;vertical-align:2px">${F.rules[r.id] ? 'on' : 'off'}</span></h2><div class="sub">${esc(r.description)} · ${fmtInt(r.plays)} plays · ${r.hours} h</div>
      ${rankList([...per[i].values()].sort((a, b) => b.s - a.s).slice(0, 12).map(o => { const pl = playLabel(o.p); return { url: pl.url, title: pl.title, sub: pl.sub, value: `${fmtInt(o.n)} plays · ${fmtH(o.s)}` }; }))}</div>`).join('');
};

V.notfound = () => { view().innerHTML = '<h1>Not found</h1><p><a href="#/">Back to overview</a></p>'; };

// ================================================================ router & chrome
const NAV = [['', 'Overview'], ['wrapped', 'Wrapped'], ['calendar', 'Calendar'], ['library', 'Library'], ['trends', 'Trends'], ['onthisday', 'On this day'], ['habits', 'Habits'], ['sessions', 'Sessions'], ['discovery', 'Discovery'], ['places', 'Places'], ['devices', 'Devices'], ['podcasts', 'Podcasts & books'], ['covers', 'Covers']];
function route() {
  if (raceTimer) { clearInterval(raceTimer); raceTimer = null; }
  tip.hide();
  const parts = location.hash.replace(/^#\/?/, '').split('/').filter(Boolean);
  const name = parts[0] || 'overview', fn = V[name] || V.notfound;
  document.querySelectorAll('#nav a').forEach(a => a.classList.toggle('active', (a.dataset.r || 'overview') === name));
  try { fn(parts.slice(1)); } catch (e) { console.error(e); view().innerHTML = `<h1>Something went wrong</h1><pre class="muted">${esc(e.stack || e)}</pre>`; }
  document.title = `${(NAV.find(n => (n[0] || 'overview') === name) || [0, name])[1]} · Listening History`;
}
function setYear(y) { F.year = y === 'all' ? 'all' : +y; store.set('lh-year', F.year); $('#yearSel').value = String(F.year); route(); }
function renderRules() {
  $('#rulesList').innerHTML = D.meta.rules.map(r => `<label class="rule"><input type="checkbox" data-id="${esc(r.id)}" ${F.rules[r.id] ? 'checked' : ''}><div><div><b>${esc(r.label)}</b></div><div class="d">${esc(r.description)}</div><div class="d faint">${fmtInt(r.plays)} plays · ${r.hours} h</div></div></label>`).join('') + `<p style="margin-top:12px"><a href="#/excluded" id="reviewEx">Review what each rule removes →</a></p>`;
  $('#rulesList').querySelectorAll('input').forEach(i => i.onchange = () => { F.rules[i.dataset.id] = i.checked; store.set('lh-rules', F.rules); updateRulesBtn(); route(); });
  $('#reviewEx').onclick = () => $('#rulesDlg').close();
}
function updateRulesBtn() { const on = D.meta.rules.filter(r => F.rules[r.id]).length; $('#rulesBtn').textContent = `Exclusions (${on})`; $('#rulesBtn').disabled = false; }

async function init() {
  try { await load(); } catch (e) { view().innerHTML = `<h1>Couldn't load data</h1><p class="muted">${esc(e.message)}. Run <code>python3 scripts/build_data.py</code> and serve the <code>docs/</code> folder over HTTP.</p>`; return; }
  $('#nav').innerHTML = NAV.map(([r, l]) => `<a href="#/${r}" data-r="${r || 'overview'}">${l}</a>`).join('');
  const ys = $('#yearSel'); ys.innerHTML = `<option value="all">All years</option>` + P.years.slice().reverse().map(y => `<option value="${y}">${y}</option>`).join('');
  if (F.year !== 'all' && !P.years.includes(+F.year)) F.year = 'all';
  ys.value = String(F.year); ys.onchange = () => setYear(ys.value);
  const pe = $('#personal'); pe.checked = F.personal; pe.onchange = () => { F.personal = pe.checked; store.set('lh-personal', F.personal); route(); };
  updateRulesBtn();
  $('#rulesBtn').onclick = () => { renderRules(); $('#rulesDlg').showModal(); };
  $('#rulesReset').onclick = () => { F.rules = Object.fromEntries(D.meta.rules.map(r => [r.id, r.enabled])); store.set('lh-rules', F.rules); renderRules(); updateRulesBtn(); route(); };
  $('#themeBtn').onclick = () => {
    const dark = document.documentElement.dataset.theme ? document.documentElement.dataset.theme === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches;
    document.documentElement.dataset.theme = dark ? 'light' : 'dark'; store.set('lh-theme-x', 1);
    try { localStorage.setItem('lh-theme', document.documentElement.dataset.theme); } catch (e) { /* ignore */ }
  };
  addEventListener('hashchange', route);
  let lastW = innerWidth; addEventListener('resize', debounce(() => { if (Math.abs(innerWidth - lastW) > 40) { lastW = innerWidth; route(); } }, 250));
  route();
}
init();
