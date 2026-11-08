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
  P.rs = Uint8Array.from(pl.rs); P.re = Uint8Array.from(pl.re);
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
  parts.push(F.personal ? 'personal listening' : 'everything');
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
    .attr('fill', d => (highlight != null && d.key !== highlight ? 'var(--axis)' : color));
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
        .attr('fill', highlight != null && highlight !== d.key ? 'var(--axis)' : k.color);
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
const tile = (v, l, s = '') => `<div class="tile"><div class="v num">${v}</div><div class="l">${l}</div>${s ? `<div class="s">${s}</div>` : ''}</div>`;
const PLAY_SVG = '<svg viewBox="0 0 24 24" aria-hidden="true" width="14" height="14"><path d="M7 4.5v15a1 1 0 0 0 1.53.85l12-7.5a1 1 0 0 0 0-1.7l-12-7.5A1 1 0 0 0 7 4.5Z" fill="currentColor"/></svg>';
function playBtn(type, id, label) {
  return id ? `<button class="play" type="button" data-play="${type}:${esc(id)}" aria-label="Play ${esc(label)}">${PLAY_SVG}</button>` : '';
}
/** song row: cover, title (link), artist (link), detail, play button */
function songRow(t, detail, n) {
  const [name, ai, , id] = D.lib.tracks[t];
  return `<li class="song">${n != null ? `<span class="n">${n}</span>` : ''}${img(trackUrl(t), name, 'sm')}<div class="who"><div><div class="t">${trackLink(t)}</div><div class="a">${artistLink(ai)}</div></div></div><span class="v">${esc(detail)}</span>${playBtn('track', id, name + ' by ' + D.lib.artists[ai])}</li>`;
}
function rankList(items) {
  return `<ol class="rank-list">${items.map((it, i) => `<li><span class="n">${i + 1}</span>${img(it.url, it.title, it.round ? 'sm round' : 'sm')}<div class="who"><div><div class="t">${it.titleHtml || esc(it.title)}</div>${it.sub ? `<div class="a">${it.subHtml || esc(it.sub)}</div>` : ''}</div></div><span class="v">${esc(it.value)}</span>${it.play || ''}</li>`).join('')}</ol>`;
}
function topArtistsList(st, n = 10) {
  return rankList(topN(st.artists.secs, n).map(a => ({ url: artistUrl(a), title: D.lib.artists[a], titleHtml: artistLink(a), value: fmtH(st.artists.secs[a]), round: true })));
}
function topSongsList(st, n = 10) {
  return `<ol class="rank-list">${topN(st.tracks.plays, n).map((t, i) => songRow(t, fmtInt(st.tracks.plays[t]) + ' plays', i + 1)).join('')}</ol>`;
}
const embed = (type, id) => id ? `<iframe class="embed" src="https://open.spotify.com/embed/${type}/${esc(id)}?utm_source=generator" loading="lazy" allow="autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture" title="Spotify player"></iframe>` : '';
const storyYears = () => memo('storyYears', () => P.years.filter(y => itemStats(y).totals.music > 20 * 3600), false);
function yearPicker(cur, onPick, includeAll = true) {
  const ys = storyYears();
  const html = `<nav class="picker" aria-label="Year">${includeAll ? `<button type="button" data-y="all" class="${cur === 'all' ? 'on' : ''}">All years</button>` : ''}${ys.map(y => `<button type="button" data-y="${y}" class="${+cur === y ? 'on' : ''}">${y}</button>`).join('')}</nav>`;
  return { html, bind: root => root.querySelectorAll('.picker [data-y]').forEach(b => b.onclick = () => onPick(b.dataset.y === 'all' ? 'all' : +b.dataset.y)) };
}
function filterNote() {
  const on = D.meta.rules.filter(r => F.rules[r.id]);
  if (!F.personal || !on.length) return 'Showing everything you played.';
  const genres = on.filter(r => r.group === 'genre').map(r => r.short || r.label.toLowerCase());
  return `Showing your personal listening${genres.length ? `, without ${genres.join(' or ')} artists` : ''}.`;
}
const lastT = () => P.t[P.n - 1];
const monthName = t => `${MONTH[dateOf(t).getUTCMonth()]} ${dateOf(t).getUTCFullYear()}`;
/** first-ever play time per artist / track (current filters, all years) */
function firstSeen(what) {
  return memo('first-' + what, () => {
    const act = active(), len = what === 'artist' ? D.lib.artists.length : D.lib.tracks.length, out = new Float64Array(len).fill(Infinity);
    for (let p = 0; p < P.n; p++) { if (!act[p] || P.k[p] !== 0 || P.s[p] < 30) continue; const j = what === 'artist' ? P.artist[p] : P.i[p]; if (P.t[p] < out[j]) out[j] = P.t[p]; }
    return out;
  }, false);
}

// ---------------- reused chart builders
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
  const maxChars = Math.max(4, Math.floor(colW * 0.9 / 7.8));
  ranks.forEach((list, yi) => list.forEach((a, r) => {
    const gg = cells.append('g').attr('data-a', a).style('cursor', 'pointer');
    gg.append('rect').attr('x', x(years[yi]) - colW * 0.42).attr('y', yy(r) - 12).attr('width', colW * 0.84).attr('height', 24).attr('fill', 'var(--page)');
    const nm = D.lib.artists[a];
    gg.append('text').attr('x', x(years[yi])).attr('y', yy(r) + 4).attr('text-anchor', 'middle').attr('class', 'lbl').text(nm.length > maxChars ? nm.slice(0, maxChars - 1) + '…' : nm);
    gg.on('mouseenter', ev => { hl(a); tip.show(`<b>${esc(nm)}</b>${tipRows(pos.get(a).map(([yi2, r2]) => [String(years[yi2]), `#${r2 + 1} · ${fmtH(itemStats(years[yi2]).artists.secs[a])}`]))}`, ev); })
      .on('mousemove', ev => tip.move(ev)).on('mouseleave', () => { hl(null); tip.hide(); }).on('click', () => { tip.hide(); location.hash = `#/artist/${a}`; });
  }));
  function hl(a) {
    lines.selectAll('path').attr('stroke', function () { return a != null && +this.dataset.a === a ? 'var(--accent)' : 'var(--axis)'; }).attr('stroke-width', function () { return a != null && +this.dataset.a === a ? 3 : 2; });
    cells.selectAll('g').each(function () { const on = a != null && +this.dataset.a === a; d3.select(this).select('text').attr('fill', a == null ? null : on ? 'var(--accent-ink)' : 'var(--text-muted)').attr('font-weight', on ? 700 : null); });
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

// ================================================================ VIEWS
const V = {};

// ---------------- Story: hero + one chapter per year
function yearFacts(Y) {
  return memo('yearFacts', () => {
    const st = itemStats(Y), act = active(), firstA = firstSeen('artist');
    const dayS = new Map(); let run = { n: 0 }, cur = { id: -1, n: 0 };
    for (let p = 0; p < P.n; p++) {
      if (!act[p] || P.year[p] !== Y) continue;
      dayS.set(P.day[p], (dayS.get(P.day[p]) || 0) + P.s[p]);
      if (P.k[p] === 0) { if (P.i[p] === cur.id) cur.n++; else cur = { id: P.i[p], n: 1 }; if (cur.n > run.n) run = { ...cur }; }
    }
    const newArtists = topN(st.artists.secs, 1e9).filter(a => dateOf(firstA[a]).getUTCFullYear() === Y);
    const bestDay = [...dayS].sort((a, b) => b[1] - a[1])[0];
    return { st, newArtists, bestDay, run, topAlbum: topN(st.albums.secs, 1, j => !!albumUrl(j))[0] ?? topN(st.albums.secs, 1)[0] };
  }, true, Y);
}
V.story = ([yr]) => {
  const all = allTime(), T = all.totals, years = storyYears();
  const nArtists = all.artists.secs.filter(v => v > 0).length;
  view().innerHTML = `
    <section class="lede">
      <h1>You've listened to <span class="hl">${fmtInt(T.total / 3600)} hours</span> of music since ${MONTH[dateOf(T.first).getUTCMonth()]} ${dateOf(T.first).getUTCFullYear()}.</h1>
      <p>That's about ${fmtInt(T.total / 86400)} full days, across ${fmtInt(nArtists)} artists. Pick a year to jump to it.</p>
    </section>
    <nav class="ribbon" aria-label="Years">${years.map(y => { const f = yearFacts(y), al = f.topAlbum; return `<a href="#/story/${y}" data-jump="${y}">${img(al != null ? albumUrl(al) : null, String(y), 'cover')}<span>${y}</span></a>`; }).join('')}</nav>
    <p class="note">${esc(filterNote())}</p>
    ${years.map(chapter).join('')}`;
  view().querySelectorAll('[data-jump]').forEach(a => a.onclick = e => { e.preventDefault(); history.replaceState(null, '', `#/story/${a.dataset.jump}`); jumpTo('y' + a.dataset.jump); });
  if (yr) requestAnimationFrame(() => jumpTo('y' + yr, false));
};
function jumpTo(id, smooth = true) { const el = document.getElementById(id); if (el) el.scrollIntoView({ behavior: smooth && !matchMedia('(prefers-reduced-motion: reduce)').matches ? 'smooth' : 'auto', block: 'start' }); }
function chapter(Y) {
  const f = yearFacts(Y), st = f.st, T = st.totals, L = D.lib;
  const ta = topN(st.artists.secs, 1)[0], tt = topN(st.tracks.plays, 1)[0];
  const lines = [];
  if (tt != null) lines.push(`Your most played song was ${trackLink(tt)} by ${artistLink(L.tracks[tt][1])}, ${fmtInt(st.tracks.plays[tt])} times.`);
  if (f.run.n >= 5) lines.push(`You played ${trackLink(f.run.id)} ${f.run.n} times in a row.`);
  return `<section class="chapter" id="y${Y}" aria-labelledby="h${Y}">
    <div class="year" aria-hidden="true">${Y}</div>
    <div class="chapter-body">
      <h2 id="h${Y}">${ta != null ? `${artistLink(ta)} was your top artist in ${Y}` : `${Y}`}</h2>
      <p class="chapter-lede">${lines.join(' ')}</p>
      <div class="chapter-grid">
        <div>
          <h3>Top songs</h3>
          ${topSongsList(st, 5)}
        </div>
        <div>
          <h3>Top artists</h3>
          ${topArtistsList(st, 5)}
        </div>
      </div>
      <dl class="facts">
        <div><dt>Listening</dt><dd>${fmtInt(T.total / 3600)} hours</dd></div>
        <div><dt>Artists you heard for the first time</dt><dd>${fmtInt(f.newArtists.length)}</dd></div>
        ${f.bestDay ? `<div><dt>Biggest day</dt><dd>${fmtDay(f.bestDay[0]).replace(/, \d+$/, '')}, ${fmtH(f.bestDay[1])}</dd></div>` : ''}
        ${f.topAlbum != null ? `<div><dt>Top album</dt><dd>${esc(L.albums[f.topAlbum][0])}</dd></div>` : ''}
      </dl>
    </div>
  </section>`;
}

// ---------------- Rediscover
const RD = { era: 'all', shown: 20, deepSeed: 1, weekOffset: 0 };
function trackStatsAll() {
  return memo('trackAll', () => {
    const act = active(), n = D.lib.tracks.length;
    const plays = new Int32Array(n), done = new Int32Array(n), started = new Int32Array(n), last = new Float64Array(n), peakYear = new Uint16Array(n);
    const yr = new Map();
    for (let p = 0; p < P.n; p++) {
      if (!act[p] || P.k[p] !== 0) continue;
      const t = P.i[p]; started[t]++; if (P.re[p] === REASON.trackdone) done[t]++;
      if (P.s[p] >= 30) { plays[t]++; last[t] = P.t[p]; const key = t * 100 + (P.year[p] - 2000); yr.set(key, (yr.get(key) || 0) + 1); }
    }
    const best = new Int32Array(n);
    yr.forEach((c, key) => { const t = Math.floor(key / 100); if (c > best[t]) { best[t] = c; peakYear[t] = 2000 + (key % 100); } });
    return { plays, done, started, last, peakYear };
  }, false);
}
V.rediscover = () => {
  const S = trackStatsAll(), end = lastT(), cutoff = end - 365 * 86400;
  const forgotten = []; for (let t = 0; t < S.plays.length; t++) if (S.plays[t] >= 15 && S.last[t] < cutoff && (RD.era === 'all' || S.peakYear[t] === RD.era)) forgotten.push(t);
  forgotten.sort((a, b) => S.plays[b] - S.plays[a]);
  const deep = []; for (let t = 0; t < S.plays.length; t++) if (S.plays[t] >= 3 && S.plays[t] <= 9 && S.done[t] === S.started[t]) deep.push(t);
  let seed = RD.deepSeed; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const deepPick = deep.map(t => [t, rnd()]).sort((a, b) => a[1] - b[1]).slice(0, 12).map(x => x[0]);
  const eras = yearPicker(RD.era, y => { RD.era = y; RD.shown = 20; V.rediscover(); });
  view().innerHTML = `
    <section class="page-intro"><h1>Rediscover</h1><p>Songs worth playing again. Press play on any song to hear it here.</p></section>
    <section class="block">
      <h2>Forgotten favorites</h2>
      <p class="sub">Songs you played at least 15 times but not in the last year. Pick the year you loved them most.</p>
      ${eras.html}
      ${forgotten.length ? `<ol class="rank-list">${forgotten.slice(0, RD.shown).map(t => songRow(t, `${fmtInt(S.plays[t])} plays, last in ${monthName(S.last[t])}`)).join('')}</ol>
        ${forgotten.length > RD.shown ? `<button class="btn ghost more" id="fmore">Show ${Math.min(20, forgotten.length - RD.shown)} more</button>` : ''}` : '<p class="muted">No forgotten favorites for this year.</p>'}
    </section>
    <section class="block" id="week"></section>
    <section class="block">
      <h2>Deep cuts</h2>
      <p class="sub">Songs you only played a few times, and never skipped.</p>
      <ol class="rank-list">${deepPick.map(t => songRow(t, `${S.plays[t]} plays, last in ${monthName(S.last[t])}`)).join('')}</ol>
      <button class="btn ghost more" id="reshuffle">Show different songs</button>
    </section>`;
  eras.bind(view());
  const m = $('#fmore'); if (m) m.onclick = () => { RD.shown += 20; V.rediscover(); };
  $('#reshuffle').onclick = () => { RD.deepSeed = (RD.deepSeed * 48271) % 2147483647 || 7; V.rediscover(); };
  weekBlock();
};
function weekBlock() {
  const act = active(), now = new Date(), base = new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate() + RD.weekOffset * 7));
  const startMD = new Date(base.getTime() - ((base.getUTCDay() + 6) % 7) * 864e5); // Monday of that week
  const label = d => `${MON[d.getUTCMonth()]} ${d.getUTCDate()}`;
  const endMD = new Date(startMD.getTime() + 6 * 864e5);
  const rows = storyYears().slice().reverse().map(y => {
    const d0 = Math.floor(Date.UTC(y, startMD.getUTCMonth(), startMD.getUTCDate()) / 864e5), c = new Map();
    for (let d = d0; d < d0 + 7; d++) for (const p of P.byDay.get(d) || []) if (act[p] && P.k[p] === 0 && P.s[p] >= 30) c.set(P.i[p], (c.get(P.i[p]) || 0) + 1);
    const top = [...c].sort((a, b) => b[1] - a[1]).slice(0, 3);
    return top.length ? `<div class="week-year"><h3>${y}</h3><ol class="rank-list">${top.map(([t, n]) => songRow(t, `${n} plays that week`)).join('')}</ol></div>` : '';
  }).join('');
  $('#week').innerHTML = `<h2>${label(startMD)} to ${label(endMD)} in past years</h2>
    <p class="sub">What you played most during this same week in each year.</p>
    <div class="toolbar"><button class="btn ghost" id="wprev">Previous week</button><button class="btn ghost" id="wnext">Next week</button>${RD.weekOffset ? '<button class="btn ghost" id="wnow">This week</button>' : ''}</div>
    <div class="week-grid">${rows || '<p class="muted">Nothing played this week in past years.</p>'}</div>`;
  $('#wprev').onclick = () => { RD.weekOffset--; weekBlock(); };
  $('#wnext').onclick = () => { RD.weekOffset++; weekBlock(); };
  const wn = $('#wnow'); if (wn) wn.onclick = () => { RD.weekOffset = 0; weekBlock(); };
}

// ---------------- Binge: songs played heavily in one season
// Seasons: winter Dec–Feb (December counts toward the next year's winter), spring Mar–May, summer Jun–Aug, fall Sep–Nov.
const SEASONS = ['Winter', 'Spring', 'Summer', 'Fall'];
const seasonOf = (y, m) => (m === 11 ? (y + 1) * 4 : y * 4 + Math.floor((m + 1) / 3) % 4);
function seasonLabel(k) { const y = Math.floor(k / 4), q = k % 4; return q === 0 ? `Winter ${y - 1}–${String(y).slice(2)}` : `${SEASONS[q]} ${y}`; }
const BINGE_MIN = 8; // plays in the season before a song can count as a binge
function bingeData() {
  return memo('binge', () => {
    const act = active(), total = trackStatsAll().plays, per = new Map(); // season -> Map(track -> {n, days: Map(day -> n)})
    for (let p = 0; p < P.n; p++) {
      if (!act[p] || P.k[p] !== 0 || P.s[p] < 30) continue;
      const k = seasonOf(P.year[p], P.mon[p]); let m = per.get(k); if (!m) per.set(k, m = new Map());
      let o = m.get(P.i[p]); if (!o) m.set(P.i[p], o = { n: 0, days: new Map() });
      o.n++; o.days.set(P.day[p], (o.days.get(P.day[p]) || 0) + 1);
    }
    const seasons = [];
    per.forEach((m, k) => {
      const songs = [];
      m.forEach((o, t) => {
        if (o.n < BINGE_MIN) return;
        const share = o.n / (total[t] || o.n);
        const [bestDay, bestN] = [...o.days].sort((a, b) => b[1] - a[1])[0];
        songs.push({ t, n: o.n, share, bestDay, bestN, score: o.n * share });
      });
      songs.sort((a, b) => b.score - a.score);
      if (songs.length) seasons.push({ k, songs });
    });
    seasons.sort((a, b) => a.k - b.k);
    return seasons;
  }, false);
}
const BG = { shown: 10 };
V.binge = ([kS]) => {
  const seasons = bingeData();
  if (!seasons.length) { view().innerHTML = `<section class="page-intro"><h1>Binge</h1><p>${esc(filterNote())} No songs were played enough in one season to count.</p></section>`; return; }
  const byK = new Map(seasons.map(s => [s.k, s]));
  const cur = byK.get(+kS) || seasons[seasons.length - 1];
  const y0 = Math.floor(seasons[0].k / 4), y1 = Math.floor(seasons[seasons.length - 1].k / 4);
  const rows = d3.range(y1, y0 - 1, -1).map(y => {
    const cells = SEASONS.map((_, q) => {
      const s = byK.get(y * 4 + q);
      if (!s) return `<span class="binge-cell empty" aria-hidden="true"></span>`;
      const top = s.songs[0], [name, ai] = D.lib.tracks[top.t];
      return `<a class="binge-cell ${s.k === cur.k ? 'on' : ''}" href="#/binge/${s.k}" aria-label="${esc(seasonLabel(s.k))}: ${esc(name)} by ${esc(D.lib.artists[ai])}" ${s.k === cur.k ? 'aria-current="true"' : ''}>${img(trackUrl(top.t), name, 'cover')}<span class="t">${esc(name)}</span></a>`;
    }).join('');
    return `<div class="binge-row"><span class="binge-year">${y}</span>${cells}</div>`;
  }).join('');
  const list = cur.songs.slice(0, BG.shown);
  const lead = cur.songs[0];
  view().innerHTML = `
    <section class="page-intro"><h1>Binge</h1><p>The songs you couldn't stop playing, season by season. A binge is a song you played at least ${BINGE_MIN} times in one season, ranked by how many of its plays ever happened in that season.</p></section>
    <section class="block">
      <h2>${esc(seasonLabel(cur.k))}</h2>
      <p class="sub">${trackLink(lead.t)} by ${artistLink(D.lib.tracks[lead.t][1])} was your biggest binge, ${fmtInt(lead.n)} plays. ${lead.share >= 0.5 ? `That's ${pct(lead.share)} of every play it has ever had.` : ''}${lead.bestN >= 3 ? ` On ${fmtDay(lead.bestDay)} alone you played it ${lead.bestN} times.` : ''}</p>
      <ol class="rank-list">${list.map((s, i) => songRow(s.t, `${fmtInt(s.n)} plays, ${pct(s.share)} of all its plays`, i + 1)).join('')}</ol>
      ${cur.songs.length > BG.shown ? `<button class="btn ghost more" id="bmore">Show ${Math.min(10, cur.songs.length - BG.shown)} more</button>` : ''}
    </section>
    <section class="block">
      <h2>Every season</h2>
      <p class="sub">The top binge of each season. Pick one to see its list.</p>
      <p class="note">${esc(filterNote())}</p>
      <div class="binge-grid">
        <div class="binge-row head" aria-hidden="true"><span class="binge-year"></span>${SEASONS.map(s => `<span class="binge-season">${s}</span>`).join('')}</div>
        ${rows}
      </div>
    </section>`;
  const m = $('#bmore'); if (m) m.onclick = () => { BG.shown += 10; V.binge([String(cur.k)]); };
  view().querySelectorAll('.binge-cell[href]').forEach(a => a.addEventListener('click', () => { BG.shown = 10; }));
};

// ---------------- Explore: library + cover wall
const LIB = { tab: 'tracks', q: '', sort: 'secs', shown: 50 };
V.explore = ([tab]) => {
  if (tab && tab !== LIB.tab) { LIB.tab = tab; LIB.shown = 50; }
  const yp = yearPicker(F.year, y => { F.year = y; LIB.shown = 50; V.explore([LIB.tab]); });
  view().innerHTML = `
    <section class="page-intro"><h1>Explore</h1><p>Every song, artist, album, podcast and audiobook you've played. Click a name to see its story.</p></section>
    <div class="explore-controls">
      <nav class="picker" aria-label="Show">${[['tracks', 'Songs'], ['artists', 'Artists'], ['albums', 'Albums'], ['shows', 'Podcasts'], ['books', 'Audiobooks'], ['wall', 'Cover wall']].map(([k, l]) => `<a class="${LIB.tab === k ? 'on' : ''}" href="#/explore/${k}">${l}</a>`).join('')}</nav>
      ${LIB.tab === 'wall' ? '' : `<label class="field"><span class="sr-only">Filter this list</span><input id="q" class="input" type="search" placeholder="Filter this list" value="${esc(LIB.q)}"></label>`}
    </div>
    ${yp.html}
    <div id="libTable" class="table-wrap"></div>`;
  yp.bind(view());
  if (LIB.tab === 'wall') return coverWall($('#libTable'));
  const q = $('#q'); q.addEventListener('input', debounce(() => { LIB.q = q.value; LIB.shown = 50; libTable(); }, 150));
  libTable();
};
function libTable() {
  const st = itemStats(), L = D.lib, tab = LIB.tab, S = st[tab];
  const q = LIB.q.trim().toLowerCase();
  const nameOf = j => tab === 'tracks' ? L.tracks[j][0] : tab === 'artists' ? L.artists[j] : tab === 'albums' ? L.albums[j][0] : tab === 'shows' ? L.shows[j] : L.books[j][0];
  const subOf = j => tab === 'tracks' ? L.artists[L.tracks[j][1]] : tab === 'albums' ? L.artists[L.albums[j][1]] : '';
  const rows = []; for (let j = 0; j < S.secs.length; j++) if (S.secs[j] > 0 && (!q || (nameOf(j) + ' ' + subOf(j)).toLowerCase().includes(q))) rows.push(j);
  const key = LIB.sort;
  rows.sort({ secs: (a, b) => S.secs[b] - S.secs[a], plays: (a, b) => S.plays[b] - S.plays[a], first: (a, b) => S.first[a] - S.first[b], last: (a, b) => S.last[b] - S.last[a], name: (a, b) => nameOf(a).localeCompare(nameOf(b)) }[key]);
  const urlOf = j => tab === 'tracks' ? trackUrl(j) : tab === 'artists' ? artistUrl(j) : tab === 'albums' ? albumUrl(j) : tab === 'shows' ? showUrl(j) : bookUrl(j);
  const linkOf = j => tab === 'tracks' ? trackLink(j) : tab === 'artists' ? artistLink(j) : tab === 'albums' ? artistLink(L.albums[j][1]).replace(/>[^<]*</, `>${esc(nameOf(j))}<`) : esc(nameOf(j));
  const subLink = j => tab === 'tracks' ? artistLink(L.tracks[j][1]) : tab === 'albums' ? artistLink(L.albums[j][1]) : '';
  const th = (k, l, cls = '') => `<th class="sortable ${cls} ${key === k ? 'sorted' : ''}" data-k="${k}" aria-sort="${key === k ? 'descending' : 'none'}"><button type="button">${l}</button></th>`;
  const noun = { tracks: 'songs', artists: 'artists', albums: 'albums', shows: 'podcasts', books: 'audiobooks' }[tab];
  $('#libTable').innerHTML = `<p class="count">${fmtInt(rows.length)} ${noun}${F.year !== 'all' ? ` in ${F.year}` : ''}</p>
    <table class="tbl lib"><thead><tr><th class="rank"><span class="sr-only">Rank</span></th>${th('name', 'Name')}${th('plays', 'Plays', 'r')}${th('secs', 'Hours', 'r')}${th('first', 'First played', 'hide-sm')}${th('last', 'Last played', 'hide-sm')}${tab === 'tracks' ? '<th><span class="sr-only">Play</span></th>' : ''}</tr></thead><tbody>
    ${rows.slice(0, LIB.shown).map((j, i) => `<tr><td class="rank">${i + 1}</td><td><div class="who">${img(urlOf(j), nameOf(j), tab === 'artists' ? 'sm round' : 'sm')}<div><div class="t name">${linkOf(j)}</div>${subOf(j) ? `<div class="a">${subLink(j)}</div>` : ''}</div></div></td>
      <td class="r">${fmtInt(S.plays[j])}</td><td class="r">${fmtHnum(S.secs[j])}</td>
      <td class="num hide-sm">${fmtDate(S.first[j])}</td><td class="num hide-sm">${fmtDate(S.last[j])}</td>${tab === 'tracks' ? `<td>${playBtn('track', L.tracks[j][3], nameOf(j))}</td>` : ''}</tr>`).join('')}</tbody></table>
    ${rows.length > LIB.shown ? `<button class="btn ghost more" id="more">Show ${Math.min(100, rows.length - LIB.shown)} more</button>` : ''}`;
  $('#libTable').querySelectorAll('th.sortable button').forEach(b => b.addEventListener('click', () => { LIB.sort = b.parentElement.dataset.k; libTable(); }));
  const m = $('#more'); if (m) m.addEventListener('click', () => { LIB.shown += 100; libTable(); });
}
function coverWall(el) {
  const st = itemStats(), S = st.albums, L = D.lib;
  const ids = topN(S.secs, 120, j => !!albumUrl(j)), max = S.secs[ids[0]] || 1;
  el.innerHTML = `<p class="count">Your ${ids.length} most played albums${F.year !== 'all' ? ` in ${F.year}` : ''}. Bigger covers got more hours.</p><div class="covers">${ids.map(j => {
    const px = Math.round(72 + 128 * Math.sqrt(S.secs[j] / max));
    return `<a class="cover" href="#/artist/${L.albums[j][1]}" data-j="${j}" style="width:${px}px;height:${px}px" aria-label="${esc(L.albums[j][0])} by ${esc(L.artists[L.albums[j][1]])}, ${fmtH(S.secs[j])}"><img src="${esc(albumUrl(j))}" alt="" loading="lazy" referrerpolicy="no-referrer"></a>`;
  }).join('')}</div>`;
  el.querySelectorAll('.cover').forEach(a => {
    const j = +a.dataset.j;
    a.addEventListener('mouseenter', ev => tip.show(`<b>${esc(L.albums[j][0])}</b><br><span class="k">${esc(L.artists[L.albums[j][1]])}</span>${tipRows([['Hours', fmtHnum(S.secs[j])]])}`, ev));
    a.addEventListener('mousemove', ev => tip.move(ev)); a.addEventListener('mouseleave', () => tip.hide());
  });
}

// ---------------- Artist page
V.artist = ([aiS]) => {
  const ai = +aiS, act = active(), L = D.lib; if (!(ai >= 0 && ai < L.artists.length)) return V.notfound();
  const st = allTime();
  let secs = 0, plays = 0, started = 0, done = 0, first = Infinity, last = -Infinity; const monS = new Map(), trS = new Map(), trP = new Map(), alS = new Map();
  for (let p = 0; p < P.n; p++) {
    if (!act[p] || P.artist[p] !== ai) continue;
    const s = P.s[p]; secs += s; started++; if (s >= 30) plays++; if (P.re[p] === REASON.trackdone) done++;
    first = Math.min(first, P.t[p]); last = Math.max(last, P.t[p]);
    const mk = P.year[p] * 12 + P.mon[p]; monS.set(mk, (monS.get(mk) || 0) + s);
    trS.set(P.i[p], (trS.get(P.i[p]) || 0) + s); if (s >= 30) trP.set(P.i[p], (trP.get(P.i[p]) || 0) + 1); alS.set(P.album[p], (alS.get(P.album[p]) || 0) + s);
  }
  if (!secs) { view().innerHTML = `<section class="page-intro"><h1>${esc(L.artists[ai])}</h1><p>${esc(filterNote())} No plays for this artist are included.</p></section>`; return; }
  const rank = 1 + Array.prototype.filter.call(st.artists.secs, v => v > secs).length;
  const peak = [...monS].sort((a, b) => b[1] - a[1])[0];
  const topTracks = [...trP].sort((a, b) => b[1] - a[1]);
  view().innerHTML = `<section class="hero">${img(artistUrl(ai), L.artists[ai], 'lg round')}<div class="meta"><h1>${esc(L.artists[ai])}</h1>
      <p>Your number ${rank} artist. You've listened for ${fmtH(secs)} since ${monthName(first)}, most of all in ${MONTH[peak[0] % 12]} ${Math.floor(peak[0] / 12)}.</p></div></section>
    <div class="tiles">${tile(fmtInt(plays), 'plays')}${tile(String(topTracks.length), 'different songs')}${tile(pct(done / started), 'played to the end')}${tile(monthName(last).replace(/^(\w{3})\w*/, '$1'), 'last played')}</div>
    <section class="block"><h2>Listening over time</h2><p class="sub">Hours per month</p><div class="chart" id="c-am"></div></section>
    <div class="grid g2">
      <section class="block"><h2>Top songs</h2><ol class="rank-list">${topTracks.slice(0, 15).map(([t, n], i) => songRow(t, fmtInt(n) + ' plays', i + 1)).join('')}</ol></section>
      <section class="block"><h2>Albums</h2>${rankList([...alS].sort((a, b) => b[1] - a[1]).slice(0, 10).map(([al, s]) => ({ url: albumUrl(al), title: L.albums[al][0], value: fmtH(s) })))}</section>
    </div>`;
  const m0 = Math.min(...monS.keys()), m1 = Math.max(...monS.keys());
  barChart($('#c-am'), { data: d3.range(m0, m1 + 1).map(mk => ({ key: mk, label: m1 - m0 < 24 ? MON[mk % 12] : (mk % 12 === 0 ? String(mk / 12) : ''), full: `${MON[mk % 12]} ${Math.floor(mk / 12)}`, value: (monS.get(mk) || 0) / 3600 })), fmt: v => fmtHnum(v * 3600) + ' h', labelEvery: 1, height: 220 });
  $('#c-am').querySelectorAll('svg text').forEach(t => { if (!t.textContent) t.remove(); });
};

// ---------------- Song page
V.track = ([tiS]) => {
  const ti = +tiS, act = active(), L = D.lib; if (!(ti >= 0 && ti < L.tracks.length)) return V.notfound();
  const [name, ai, al, id] = L.tracks[ti];
  let secs = 0, plays = 0, started = 0, done = 0, first = -1, last = -1, run = 0, best = { n: 0, p: -1 }, prev = -1; const monP = new Map(), hourP = new Float64Array(24);
  for (let p = 0; p < P.n; p++) {
    if (!act[p]) continue;
    if (P.k[p] === 0) { if (P.i[p] === ti) { run = prev === ti ? run + 1 : 1; if (run > best.n) best = { n: run, p }; } prev = P.i[p]; }
    if (P.k[p] !== 0 || P.i[p] !== ti) continue;
    started++; secs += P.s[p]; if (P.re[p] === REASON.trackdone) done++;
    if (P.s[p] >= 30) { plays++; const mk = P.year[p] * 12 + P.mon[p]; monP.set(mk, (monP.get(mk) || 0) + 1); hourP[P.hour[p]]++; if (first < 0) first = p; last = p; }
  }
  if (!plays) { view().innerHTML = `<section class="page-intro"><h1>${esc(name)}</h1><p>${esc(filterNote())} No plays of this song are included.</p></section>`; return; }
  const peak = [...monP].sort((a, b) => b[1] - a[1])[0];
  view().innerHTML = `<section class="hero">${img(trackUrl(ti), name, 'lg')}<div class="meta"><h1>${esc(name)}</h1>
      <p>${artistLink(ai)}, from ${esc(L.albums[al][0])}</p>
      <p>You first played it in ${monthName(P.t[first])} and have played it ${fmtInt(plays)} times since. It peaked in ${MONTH[peak[0] % 12]} ${Math.floor(peak[0] / 12)}.</p>
      <button class="btn" type="button" data-play="track:${esc(id)}">${PLAY_SVG} Play</button></div></section>
    <div class="tiles">${tile(fmtInt(plays), 'plays')}${tile(best.n + ' times', 'most in a row')}${tile(pct(done / started), 'played to the end')}${tile(monthName(P.t[last]).replace(/^(\w{3})\w*/, '$1'), 'last played')}</div>
    <section class="block"><h2>Plays per month</h2><div class="chart" id="c-tm"></div></section>
    <section class="block"><h2>Time of day</h2><p class="sub">Plays by hour</p><div class="chart" id="c-th"></div></section>`;
  const m0 = Math.min(...monP.keys()), m1 = Math.max(...monP.keys());
  barChart($('#c-tm'), { data: d3.range(m0, m1 + 1).map(mk => ({ key: mk, label: m1 - m0 < 24 ? MON[mk % 12] : (mk % 12 === 0 ? String(mk / 12) : ''), full: `${MON[mk % 12]} ${Math.floor(mk / 12)}`, value: monP.get(mk) || 0 })), labelEvery: 1, fmt: v => fmtInt(v), height: 200 });
  $('#c-tm').querySelectorAll('svg text').forEach(t => { if (!t.textContent) t.remove(); });
  barChart($('#c-th'), { data: d3.range(24).map(h => ({ key: h, label: hourLabel(h), value: hourP[h] })), fmt: v => fmtInt(v), height: 160 });
};

// ---------------- Patterns: the big picture
const PATTERN_SECTIONS = [['p-rank', 'Rankings'], ['p-race', 'Artist race'], ['p-when', 'When you listen'], ['p-how', 'Skips and shuffle'], ['p-new', 'New music'], ['p-sessions', 'Sessions'], ['p-other', 'Podcasts and books']];
V.patterns = () => {
  const yp = yearPicker(F.year, y => { F.year = y; V.patterns(); });
  view().innerHTML = `
    <section class="page-intro"><h1>Patterns</h1><p>How your listening changed over the years.</p></section>
    <nav class="jump" aria-label="On this page">${PATTERN_SECTIONS.map(([id, l]) => `<a href="#${id}" data-to="${id}">${l}</a>`).join('')}</nav>
    <section class="block" id="p-rank"><h2>Your top 10 artists each year</h2><p class="sub">Ranked by hours. Point at a name to follow that artist across years, or click to open it.</p><div class="chart" id="bump"></div></section>
    <section class="block" id="p-race"><h2>Artist race</h2><p class="sub">Total hours per artist, building month by month.</p>
      <div class="toolbar"><button class="btn" id="raceBtn" type="button">Play</button><input type="range" id="raceSlider" min="0" value="0" aria-label="Month"><span id="raceLbl" class="num race-lbl"></span></div>
      <div class="chart" id="race"></div></section>
    <section class="block" id="p-when"><h2>When you listen</h2><p class="sub">Hours by weekday and hour of day.</p>${yp.html}<div id="clock"></div>
      <h3 class="sub-head">By month of the year</h3><div class="chart" id="c-moy"></div></section>
    <section class="block" id="p-how"><h2>Skips and shuffle</h2><p class="sub">Share of songs each year. Skips count songs ended with the next button, because Spotify did not record skips before 2022.</p><div class="grid g2 small-multiples" id="c-beh"></div>
      <div class="grid g2"><div><h3 class="sub-head">Artists you play to the end</h3><div id="comp-hi"></div></div><div><h3 class="sub-head">Artists you skip</h3><div id="comp-lo"></div></div></div></section>
    <section class="block" id="p-new"><h2>New music</h2><div class="grid g2"><div><h3 class="sub-head">Artists heard for the first time</h3><div class="chart" id="c-na"></div></div><div><h3 class="sub-head">Share of hours on songs new that year</h3><div class="chart" id="c-fr"></div></div></div>
      <h3 class="sub-head">Your top 30 artists through the years</h3><div id="strip" class="table-wrap"></div></section>
    <section class="block" id="p-sessions"><h2>Sessions</h2><p class="sub">A session ends after 30 minutes of silence.</p><div id="sess"></div></section>
    <section class="block" id="p-other"><h2>Podcasts and audiobooks</h2><div id="pods"></div></section>`;
  yp.bind($('#p-when'));
  view().querySelectorAll('[data-to]').forEach(a => a.onclick = e => { e.preventDefault(); jumpTo(a.dataset.to); });
  bumpChart($('#bump')); race(); clockAndSeasons(); behavior(); discovery(); sessionsBlock(); podsBlock();
};
function clockAndSeasons() {
  const sc = scope(), grid = Array.from({ length: 7 }, () => new Float64Array(24)), monS = new Float64Array(12); let total = 0;
  for (let p = 0; p < P.n; p++) { if (!sc[p]) continue; grid[P.dow[p]][P.hour[p]] += P.s[p]; monS[P.mon[p]] += P.s[p]; total += P.s[p]; }
  const el = $('#clock'), w = el.clientWidth, cw = Math.max(11, Math.floor((w - 50) / 24)), ch = Math.min(30, cw);
  const max = Math.max(...grid.map(r => Math.max(...r))) || 1, thr = [0.1, 0.25, 0.45, 0.65, 0.85].map(f => f * max), color = seqScale(thr);
  const svg = d3.select(el).append('svg').attr('width', 50 + 24 * cw).attr('height', 7 * ch + 22).attr('role', 'img').attr('aria-label', 'Listening by weekday and hour');
  DOW.forEach((d, i) => svg.append('text').attr('x', 40).attr('y', i * ch + ch / 2 + 4).attr('text-anchor', 'end').attr('class', 'axis-lbl').text(d));
  d3.range(0, 24, 3).forEach(h => svg.append('text').attr('x', 50 + h * cw + cw / 2).attr('y', 7 * ch + 16).attr('text-anchor', 'middle').attr('class', 'axis-lbl').text(hourLabel(h)));
  for (let d = 0; d < 7; d++) for (let h = 0; h < 24; h++) svg.append('rect').attr('x', 50 + h * cw).attr('y', d * ch).attr('width', cw - 2).attr('height', ch - 2).attr('fill', color(grid[d][h]))
    .on('mouseenter', ev => tip.show(`<b>${DOW[d]} ${hourLabel(h)}m</b>${tipRows([['Hours', fmtHnum(grid[d][h])], ['Share', pct(grid[d][h] / total, 1)]])}`, ev)).on('mousemove', ev => tip.move(ev)).on('mouseleave', () => tip.hide());
  dataTable(el, ['Day'].concat(d3.range(24).map(hourLabel)), DOW.map((d, i) => [d].concat(Array.from(grid[i], v => fmtHnum(v)))));
  barChart($('#c-moy'), { data: MON.map((m, i) => ({ key: i, label: m, full: MONTH[i], value: monS[i] / 3600 })), fmt: v => fmtInt(v) + ' h', height: 180 });
}
function behavior() {
  const act = active(), sc = scope(), yrs = storyYears(), beh = new Map(yrs.map(y => [y, { n: 0, done: 0, fwd: 0, shuf: 0, pick: 0 }]));
  for (let p = 0; p < P.n; p++) { if (!act[p] || P.k[p] !== 0) continue; const o = beh.get(P.year[p]); if (!o) continue; o.n++; if (P.re[p] === REASON.trackdone) o.done++; if (P.re[p] === REASON.fwdbtn) o.fwd++; if (P.f[p] & 1) o.shuf++; if (P.rs[p] === REASON.clickrow) o.pick++; }
  [['Played to the end', 'done'], ['Skipped with next', 'fwd'], ['Shuffle on', 'shuf'], ['Picked by you', 'pick']].forEach(([name, k]) => {
    const box = document.createElement('div'); box.innerHTML = `<h3>${esc(name)}</h3><div class="chart"></div>`; $('#c-beh').appendChild(box);
    lineChart(box.querySelector('.chart'), { series: [{ name, color: 'var(--ink)', values: yrs.map(y => beh.get(y)[k] / (beh.get(y).n || 1)) }], xLabels: yrs.map(String), fmt: v => pct(v), yDomain: [0, 1], height: 160 });
  });
  const st = itemStats(), comp = new Map();
  for (let p = 0; p < P.n; p++) { if (!sc[p] || P.k[p] !== 0) continue; const a = P.artist[p]; let o = comp.get(a); if (!o) comp.set(a, o = [0, 0]); o[0]++; if (P.re[p] === REASON.trackdone) o[1]++; }
  const elig = [...comp].filter(([, o]) => o[0] >= 150).map(([a, o]) => [a, o[1] / o[0], o[0]]);
  const li = list => rankList(list.map(([a, r, n]) => ({ url: artistUrl(a), title: D.lib.artists[a], titleHtml: artistLink(a), sub: `${fmtInt(n)} plays`, value: pct(r), round: true })));
  $('#comp-hi').innerHTML = elig.length ? li(elig.slice().sort((a, b) => b[1] - a[1]).slice(0, 8)) : '<p class="muted">Not enough plays.</p>';
  $('#comp-lo').innerHTML = elig.length ? li(elig.slice().sort((a, b) => a[1] - b[1]).slice(0, 8)) : '<p class="muted">Not enough plays.</p>';
}
function discovery() {
  const act = active(), firstA = firstSeen('artist'), firstT = firstSeen('track'), yrs = storyYears();
  const newA = new Map(yrs.map(y => [y, 0])); firstA.forEach(t => { if (isFinite(t)) { const y = dateOf(t).getUTCFullYear(); if (newA.has(y)) newA.set(y, newA.get(y) + 1); } });
  const fresh = new Map(yrs.map(y => [y, [0, 0]]));
  for (let p = 0; p < P.n; p++) { if (!act[p] || P.k[p] !== 0) continue; const o = fresh.get(P.year[p]); if (!o) continue; o[1] += P.s[p]; if (isFinite(firstT[P.i[p]]) && dateOf(firstT[P.i[p]]).getUTCFullYear() === P.year[p]) o[0] += P.s[p]; }
  barChart($('#c-na'), { data: yrs.map(y => ({ key: y, label: String(y).slice(2).padStart(3, "'"), full: String(y), value: newA.get(y) })), height: 180 });
  lineChart($('#c-fr'), { series: [{ name: 'Share of hours', color: 'var(--series-1)', values: yrs.map(y => fresh.get(y)[0] / (fresh.get(y)[1] || 1)) }], xLabels: yrs.map(y => String(y).slice(2).padStart(3, "'")), fmt: v => pct(v), yDomain: [0, 1], height: 180 });
  const st = allTime(), top = topN(st.artists.secs, 30).sort((a, b) => firstA[a] - firstA[b]);
  const thr = [2, 5, 10, 20, 35].map(h => h * 3600), color = seqScale(thr);
  $('#strip').innerHTML = `${seqLegend(thr, fmtH)}<table class="tbl strip"><thead><tr><th>Artist</th>${yrs.map(y => `<th class="r">${String(y).slice(2).padStart(3, "'")}</th>`).join('')}</tr></thead><tbody>${top.map(a => `<tr><td class="name">${artistLink(a)}</td>${yrs.map(y => { const v = itemStats(y).artists.secs[a]; return `<td title="${esc(D.lib.artists[a])}, ${y}, ${fmtH(v)}"><div class="cell" style="background:${color(v)}"></div></td>`; }).join('')}</tr>`).join('')}</tbody></table>`;
}
function sessionsBlock() {
  const sc = scope(), ss = memo('sessions', () => sessions(sc)).filter(s => s.secs > 0);
  const lens = ss.map(s => s.secs).sort((a, b) => a - b), med = lens[Math.floor(lens.length / 2)] || 0;
  const buckets = [[0, 300, '< 5 min'], [300, 900, '5 to 15 min'], [900, 1800, '15 to 30 min'], [1800, 3600, '30 to 60 min'], [3600, 7200, '1 to 2 h'], [7200, Infinity, '2 h +']];
  const longest = ss.slice().sort((a, b) => b.secs - a.secs).slice(0, 6);
  const label = key => key[0] === 'a' ? D.lib.artists[+key.slice(1)] : key[0] === 's' ? D.lib.shows[+key.slice(1)] : D.lib.books[+key.slice(1)][0];
  const runs = []; let cur = null;
  for (let p = 0; p < P.n; p++) { if (!sc[p] || P.k[p] !== 0) continue; if (cur && cur.id === P.i[p]) cur.n++; else { if (cur && cur.n >= 5) runs.push(cur); cur = { id: P.i[p], n: 1, t: P.t[p] }; } }
  if (cur && cur.n >= 5) runs.push(cur); runs.sort((a, b) => b.n - a.n);
  $('#sess').innerHTML = `<div class="tiles">${tile(fmtInt(ss.length), 'sessions')}${tile(Math.round(med / 60) + ' min', 'typical session')}${tile(longest[0] ? fmtH(longest[0].secs) : '', 'longest session')}</div>
    <div class="grid g2"><div><h3 class="sub-head">How long sessions last</h3><div class="chart" id="c-sl"></div></div>
    <div><h3 class="sub-head">Longest sessions</h3><ol class="rank-list plain">${longest.map(s => `<li><div class="who"><div><div class="t">${fmtDate(s.start)}</div><div class="a">Mostly ${esc(label([...s.art].sort((a, b) => b[1] - a[1])[0][0]))}</div></div></div><span class="v">${fmtH(s.secs)}</span></li>`).join('')}</ol></div></div>
    <h3 class="sub-head">Songs on repeat</h3><ol class="rank-list">${runs.slice(0, 8).map(r => songRow(r.id, `${r.n} in a row, ${monthName(r.t)}`)).join('')}</ol>`;
  barChart($('#c-sl'), { data: buckets.map(([a, b, l], i) => ({ key: i, label: l, value: lens.filter(v => v >= a && v < b).length })), height: 180, labelEvery: 1 });
}
function podsBlock() {
  const st = itemStats(), act = active(), L = D.lib, py = new Map(), by = new Map();
  for (let p = 0; p < P.n; p++) { if (!act[p]) continue; if (P.k[p] === 1) py.set(P.year[p], (py.get(P.year[p]) || 0) + P.s[p]); if (P.k[p] === 2) by.set(P.year[p], (by.get(P.year[p]) || 0) + P.s[p]); }
  const ys = [...new Set([...py.keys(), ...by.keys()])].sort().filter(y => (py.get(y) || 0) + (by.get(y) || 0) > 1800);
  const shows = topN(st.shows.secs, 8), books = topN(st.books.secs, 8, j => st.books.secs[j] > 1800);
  $('#pods').innerHTML = `<div class="chart" id="c-pb"></div><div class="grid g2">
    <div><h3 class="sub-head">Top podcasts</h3>${rankList(shows.map(s => ({ url: showUrl(s), title: L.shows[s], value: fmtH(st.shows.secs[s]) })))}</div>
    <div><h3 class="sub-head">Top audiobooks</h3>${books.length ? rankList(books.map(b => ({ url: bookUrl(b), title: L.books[b][0], value: fmtH(st.books.secs[b]) }))) : '<p class="muted">None in this period.</p>'}</div></div>`;
  stackedBars($('#c-pb'), { keys: [{ key: 'p', label: 'Podcasts', color: 'var(--series-2)' }, { key: 'b', label: 'Audiobooks', color: 'var(--series-3)' }], data: ys.map(y => ({ key: y, label: String(y), values: { p: (py.get(y) || 0) / 3600, b: (by.get(y) || 0) / 3600 } })), fmt: v => fmtHnum(v * 3600) + ' h', height: 180 });
}

// ---------------- What's hidden
V.hidden = () => {
  const rules = D.meta.rules, per = rules.map(() => new Map());
  for (let p = 0; p < P.n; p++) { const x = P.x[p]; if (!x) continue; rules.forEach((r, i) => { if (x >> r.bit & 1) { const key = P.k[p] + ':' + P.i[p]; const o = per[i].get(key) || { p, n: 0, s: 0 }; o.n++; o.s += P.s[p]; per[i].set(key, o); } }); }
  view().innerHTML = `<section class="page-intro"><h1>What's hidden</h1><p>Each filter and the plays it leaves out. Turn filters on or off with What counts at the top.</p></section>` +
    rules.map((r, i) => `<section class="block"><h2>${esc(r.label)}</h2><p class="sub">${F.rules[r.id] && F.personal ? 'Hidden now.' : 'Shown now.'} ${esc(r.description)} ${fmtInt(r.plays)} plays, ${r.hours} hours.</p>
      ${rankList([...per[i].values()].sort((a, b) => b.s - a.s).slice(0, 10).map(o => { const pl = playLabel(o.p); return { url: pl.url, title: pl.title, sub: pl.sub, value: `${fmtInt(o.n)} plays` }; }))}</section>`).join('');
};

V.notfound = () => { view().innerHTML = '<section class="page-intro"><h1>This page does not exist</h1><p><a href="#/">Go to your story</a></p></section>'; };

// ================================================================ chrome: router, player, search, filters
const NAV = [['story', 'Story'], ['rediscover', 'Rediscover'], ['binge', 'Binge'], ['explore', 'Explore'], ['patterns', 'Patterns']];
const ALIASES = { '': 'story', overview: 'story', wrapped: 'story', library: 'explore', covers: 'explore', trends: 'patterns', habits: 'patterns', sessions: 'patterns', discovery: 'patterns', podcasts: 'patterns', onthisday: 'rediscover', excluded: 'hidden' };
function route() {
  if (raceTimer) { clearInterval(raceTimer); raceTimer = null; }
  tip.hide(); closeSearch();
  const parts = location.hash.replace(/^#\/?/, '').split('/').filter(Boolean);
  let name = parts[0] || 'story'; name = ALIASES[name] || name;
  const args = parts.slice(1);
  const fn = V[name] || V.notfound;
  const section = { artist: 'explore', track: 'explore', hidden: 'story' }[name] || name;
  document.querySelectorAll('#nav a').forEach(a => { const on = a.dataset.r === section; a.classList.toggle('active', on); if (on) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current'); });
  try { fn(args); } catch (e) { console.error(e); view().innerHTML = `<section class="page-intro"><h1>This page could not be shown</h1><p>Reload the page to try again.</p><pre class="muted">${esc(e.stack || e)}</pre></section>`; }
  const navName = (NAV.find(n => n[0] === section) || [0, ''])[1];
  document.title = `${navName ? navName + ', ' : ''}Listening History`;
  if (!(name === 'story' && args[0])) window.scrollTo(0, 0);
  view().focus({ preventScroll: true });
}
function invalidate() { memoStore.clear(); }

// docked player
// Uses Spotify's iFrame API so one click on a play button also starts playback in the player.
// If the API hasn't loaded (blocked or slow), falls back to the plain embed, which needs a second click.
const SP = { api: null, ctl: null, pending: null, wantPlay: false, plain: false };
window.onSpotifyIframeApiReady = api => { SP.api = api; if (SP.pending) { const s = SP.pending; SP.pending = null; play(s); } };
function startPlaying() { // the player fires 'ready' each time a song finishes loading
  if (!SP.wantPlay || !SP.ctl) return;
  SP.wantPlay = false; SP.ctl.play();
}
function play(spec) {
  const [type, id] = spec.split(':'); if (!id) return;
  const dock = $('#player');
  dock.hidden = false; document.body.classList.add('has-player');
  const uri = `spotify:${type}:${id}`;
  SP.wantPlay = true;
  if (SP.ctl) { // reuse the player: load the new song, then play once it's ready
    SP.ctl.loadUri(uri);
    setTimeout(startPlaying, 2500); // backup in case no ready event arrives for this load
    return;
  }
  if (SP.api && !SP.plain) {
    const mount = document.createElement('div'); $('#playerMount').replaceChildren(mount);
    SP.api.createController(mount, { uri, width: '100%', height: 80 }, ctl => {
      SP.ctl = ctl;
      ctl.addListener('ready', startPlaying);
    });
    return;
  }
  if (!SP.plain) { // API still loading: wait briefly, then fall back to the plain embed
    SP.pending = spec;
    setTimeout(() => { if (SP.pending === spec && !SP.api) { SP.pending = null; SP.plain = true; play(spec); } }, 2500);
    return;
  }
  $('#playerMount').innerHTML = `<iframe title="Spotify player" src="https://open.spotify.com/embed/${type}/${encodeURIComponent(id)}?utm_source=generator&theme=0" allow="autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture"></iframe>`;
}
function closePlayer() {
  SP.wantPlay = false; SP.pending = null;
  if (SP.ctl) SP.ctl.pause(); else $('#playerMount').innerHTML = '';
  $('#player').hidden = true; document.body.classList.remove('has-player');
}

// search
let searchIdx = null;
function buildSearch() {
  const st = allTime(), L = D.lib, items = [];
  topN(st.artists.secs, 1e9).forEach(a => items.push({ k: 'artist', j: a, name: L.artists[a], lc: L.artists[a].toLowerCase(), s: st.artists.secs[a] }));
  topN(st.tracks.secs, 1e9).forEach(t => items.push({ k: 'track', j: t, name: L.tracks[t][0], sub: L.artists[L.tracks[t][1]], lc: (L.tracks[t][0] + ' ' + L.artists[L.tracks[t][1]]).toLowerCase(), s: st.tracks.secs[t] }));
  searchIdx = items;
}
function runSearch(q) {
  if (!searchIdx) buildSearch();
  q = q.trim().toLowerCase(); if (q.length < 2) return [];
  const starts = [], has = [];
  for (const it of searchIdx) { const i = it.lc.indexOf(q); if (i === 0 || it.lc.includes(' ' + q)) starts.push(it); else if (i > 0) has.push(it); if (starts.length > 40) break; }
  return starts.concat(has).sort((a, b) => (a.k === b.k ? b.s - a.s : a.k === 'artist' ? -1 : 1)).slice(0, 8);
}
let searchSel = -1;
function renderSearch() {
  const q = $('#search').value, res = runSearch(q), box = $('#searchResults');
  if (!res.length) { box.hidden = q.trim().length < 2; box.innerHTML = q.trim().length >= 2 ? '<p class="empty">No song or artist matches that.</p>' : ''; $('#search').setAttribute('aria-expanded', String(!box.hidden)); return; }
  searchSel = Math.min(searchSel, res.length - 1);
  box.innerHTML = res.map((it, i) => `<a role="option" id="sr${i}" aria-selected="${i === searchSel}" href="#/${it.k}/${it.j}" class="${i === searchSel ? 'sel' : ''}">${img(it.k === 'artist' ? artistUrl(it.j) : trackUrl(it.j), it.name, it.k === 'artist' ? 'sm round' : 'sm')}<span><span class="t">${esc(it.name)}</span><span class="a">${it.k === 'artist' ? 'Artist' : 'Song by ' + esc(it.sub)}</span></span></a>`).join('');
  box.hidden = false; $('#search').setAttribute('aria-expanded', 'true');
  $('#search').setAttribute('aria-activedescendant', searchSel >= 0 ? 'sr' + searchSel : '');
}
function closeSearch() { const b = $('#searchResults'); if (b) { b.hidden = true; $('#search').setAttribute('aria-expanded', 'false'); } }

// filters panel ("What counts")
function renderFilters() {
  const groups = [['genre', 'Leave out these artists'], ['personal', 'Not your own listening']];
  $('#filtersBody').innerHTML = `<label class="switch master"><input type="checkbox" id="personal" ${F.personal ? 'checked' : ''}><span>Use these filters</span></label>
    ${groups.map(([g, title]) => { const rs = D.meta.rules.filter(r => (r.group || 'personal') === g); return rs.length ? `<fieldset ${F.personal ? '' : 'disabled'}><legend>${title}</legend>${rs.map(r => `<label class="rule"><input type="checkbox" data-id="${esc(r.id)}" ${F.rules[r.id] ? 'checked' : ''}><span><span class="t">${esc(r.label)}</span><span class="d">${esc(r.description)} ${fmtInt(r.hours)} hours.</span></span></label>`).join('')}</fieldset>` : ''; }).join('')}
    <p class="filters-foot"><a href="#/hidden">See what each filter hides</a><button type="button" class="btn ghost" id="rulesReset">Reset to defaults</button></p>`;
  $('#personal').onchange = e => { F.personal = e.target.checked; store.set('lh-personal', F.personal); filtersChanged(); };
  $('#filtersBody').querySelectorAll('[data-id]').forEach(i => i.onchange = () => { F.rules[i.dataset.id] = i.checked; store.set('lh-rules', F.rules); filtersChanged(); });
  $('#rulesReset').onclick = () => { F.personal = true; F.rules = Object.fromEntries(D.meta.rules.map(r => [r.id, r.enabled])); store.set('lh-rules', F.rules); store.set('lh-personal', true); filtersChanged(); };
}
function filtersChanged() { searchIdx = null; renderFilters(); updateFilterBtn(); route(); }
function updateFilterBtn() { const on = F.personal ? D.meta.rules.filter(r => F.rules[r.id]).length : 0; $('#filtersBtn').textContent = on ? `What counts (${on} filters on)` : 'What counts (all plays)'; }

async function init() {
  try { await load(); } catch (e) { view().innerHTML = `<section class="page-intro"><h1>The listening data did not load</h1><p>Check your connection and reload the page. (${esc(e.message)})</p></section>`; return; }
  F.year = 'all';
  $('#nav').innerHTML = NAV.map(([r, l]) => `<a href="#/${r}" data-r="${r}">${l}</a>`).join('');
  updateFilterBtn(); renderFilters();
  const fb = $('#filtersBtn'), panel = $('#filters');
  fb.onclick = () => { const open = panel.hidden; panel.hidden = !open; fb.setAttribute('aria-expanded', String(open)); };
  // search
  const s = $('#search');
  s.addEventListener('input', debounce(() => { searchSel = -1; renderSearch(); }, 80));
  s.addEventListener('keydown', e => {
    const n = $('#searchResults').querySelectorAll('a').length;
    if (e.key === 'ArrowDown') { e.preventDefault(); searchSel = Math.min(n - 1, searchSel + 1); renderSearch(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); searchSel = Math.max(0, searchSel - 1); renderSearch(); }
    else if (e.key === 'Enter') { const a = $('#searchResults').querySelectorAll('a')[Math.max(0, searchSel)]; if (a) { location.hash = a.getAttribute('href'); s.value = ''; s.blur(); } }
    else if (e.key === 'Escape') { s.value = ''; closeSearch(); s.blur(); }
  });
  document.addEventListener('click', e => {
    if (!e.target.closest('.search')) closeSearch();
    const pb = e.target.closest('[data-play]'); if (pb) { e.preventDefault(); play(pb.dataset.play); }
    if (e.target.closest('#searchResults a')) { s.value = ''; closeSearch(); }
  });
  document.addEventListener('keydown', e => { if (e.key === '/' && !/input|textarea|select/i.test(document.activeElement.tagName)) { e.preventDefault(); s.focus(); } });
  $('#playerClose').onclick = closePlayer;
  $('#themeBtn').onclick = () => {
    const dark = document.documentElement.dataset.theme ? document.documentElement.dataset.theme === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches;
    document.documentElement.dataset.theme = dark ? 'light' : 'dark';
    try { localStorage.setItem('lh-theme', document.documentElement.dataset.theme); } catch (e) { /* storage unavailable */ }
  };
  addEventListener('hashchange', route);
  let lastW = innerWidth; addEventListener('resize', debounce(() => { if (Math.abs(innerWidth - lastW) > 40) { lastW = innerWidth; route(); } }, 250));
  route();
}
init();
