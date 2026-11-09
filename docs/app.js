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
  getJSON('data/similar.json').then(sim => { D.sim = sim; memoStore.forEach((v, k) => { if (k.startsWith('mightLike')) memoStore.delete(k); }); if (/^#\/(connections|artist)/.test(location.hash)) route(); }).catch(() => {});
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
const ARROW_SVG = '<svg class="arrow" viewBox="0 0 32 32" width="36" height="36" aria-hidden="true"><path d="M6 16h20M18 8l8 8-8 8" fill="none" stroke="currentColor" stroke-width="3.5" stroke-linecap="square"/></svg>';
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
/** Yearbook portrait grid. items: [{a (artist idx) | img, name, nameHtml, cap (html)}] */
function portraits(items, cls = '') {
  return `<ul class="portraits ${cls}">${items.map(it => {
    const url = it.a != null ? artistUrl(it.a) : it.img, name = it.a != null ? D.lib.artists[it.a] : it.name;
    const long = String(name).split(/\s+/).some(w => w.length > 11);
    return `<li class="${long ? 'long' : ''}"><figure>${url ? `<img src="${esc(url)}" alt="" loading="lazy" referrerpolicy="no-referrer">` : `<span class="ph" aria-hidden="true">${initials(name)}</span>`}<figcaption><span class="t">${it.nameHtml || (it.a != null ? artistLink(it.a) : esc(name))}</span>${it.cap ? `<span class="c">${it.cap}</span>` : ''}</figcaption></figure></li>`;
  }).join('')}</ul>`;
}
const artistPortraits = (list, capFn, cls) => portraits(list.map(a => ({ a, cap: capFn ? capFn(a) : '' })), cls);
/** A superlative: big square cover, gold label, title, detail, play */
function superlative(label, t, detail, album) {
  const [name, ai, al, id] = D.lib.tracks[t];
  const title = album ? esc(D.lib.albums[al][0]) : trackLink(t);
  const ans = album ? `by ${artistLink(ai)}, most played song ${trackLink(t)}` : `${artistLink(ai)}${detail ? `, ${esc(detail)}` : ''}`;
  return `<div class="sup">${img(album ? albumUrl(al) : trackUrl(t), name, 'sup-art')}<div class="sup-txt"><h4 class="sup-l">${esc(label)}</h4><p class="sup-t">${title}</p><p class="sup-d">${ans}</p></div>${playBtn('track', id, name + ' by ' + D.lib.artists[ai])}</div>`;
}
/** The first few songs of a list as big covers, so lists open with music, not rows */
function coverRow(tracks, detailFn) {
  return `<ul class="cover-row">${tracks.map((t, i) => { const [name, ai, , id] = D.lib.tracks[t]; return `<li>${id ? `<button class="cover-play" type="button" data-play="track:${esc(id)}" aria-label="Play ${esc(name)}">${img(trackUrl(t), name, 'big')}<span class="cover-btn" aria-hidden="true">${PLAY_SVG}</span></button>` : img(trackUrl(t), name, 'big')}<span class="t">${trackLink(t)}</span><span class="a">${artistLink(ai)}${detailFn ? `<br>${esc(detailFn(t, i))}` : ''}</span></li>`; }).join('')}</ul>`;
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
  if (!years.length) { view().innerHTML = `<section class="page-intro"><h1>Story</h1><p>${esc(filterNote())} There is not enough listening to tell a story.</p></section>`; return; }
  const nArtists = all.artists.secs.filter(v => v > 0).length;
  const Y = years.includes(+yr) ? +yr : years[years.length - 1], i = years.indexOf(Y);
  const prev = years[i - 1], next = years[i + 1];
  view().innerHTML = `
    <section class="cover-page">
      <h1>The yearbook of ${years[0]} to ${years[years.length - 1]}</h1>
      <p>${fmtInt(T.total / 3600)} hours of music across ${fmtInt(nArtists)} artists. Your first plays go back to ${MONTH[dateOf(T.first).getUTCMonth()]} ${dateOf(T.first).getUTCFullYear()}, and every year from ${years[0]} has its own page.</p>
      <nav class="ribbon" aria-label="Years">${years.map(y => { const f = yearFacts(y), al = f.topAlbum; return `<a href="#/story/${y}" class="${y === Y ? 'on' : ''}" ${y === Y ? 'aria-current="page"' : ''}>${img(al != null ? albumUrl(al) : null, String(y), 'cover')}<span>${y}</span></a>`; }).join('')}</nav>
      <p class="note">${esc(filterNote())}</p>
    </section>
    ${chapter(Y)}
    <nav class="page-turn" aria-label="Turn the page">
      ${prev ? `<a href="#/story/${prev}" class="prev" aria-label="Previous year, ${prev}">${ARROW_SVG}<span class="y">${prev}</span></a>` : '<span></span>'}
      ${next ? `<a href="#/story/${next}" class="next" aria-label="Next year, ${next}"><span class="y">${next}</span>${ARROW_SVG}</a>` : '<span></span>'}
    </nav>`;
  if (yr) requestAnimationFrame(() => { const el = $('.spread'); if (el && el.getBoundingClientRect().top > innerHeight * 0.6) jumpTo('y' + Y, false); else if (el && el.getBoundingClientRect().top < 0) jumpTo('y' + Y, false); });
};
function jumpTo(id, smooth = true) { const el = document.getElementById(id); if (el) el.scrollIntoView({ behavior: smooth && !matchMedia('(prefers-reduced-motion: reduce)').matches ? 'smooth' : 'auto', block: 'start' }); }
function chapter(Y) {
  const f = yearFacts(Y), st = f.st, T = st.totals, L = D.lib;
  const ta = topN(st.artists.secs, 1)[0], tt = topN(st.tracks.plays, 1)[0];
  const newcomer = f.newArtists[0];
  const newSong = newcomer != null ? topN(st.tracks.plays, 1, t => L.tracks[t][1] === newcomer)[0] : null;
  const albumSong = f.topAlbum != null ? topN(st.tracks.plays, 1, t => L.tracks[t][2] === f.topAlbum)[0] : null;
  const sups = [];
  if (tt != null) sups.push(superlative('Most played', tt, `${fmtInt(st.tracks.plays[tt])} plays`));
  if (f.run.n >= 5 && f.run.id !== tt) sups.push(superlative('Most on repeat', f.run.id, `${f.run.n} times in a row`));
  if (albumSong != null) sups.push(superlative('Album of the year', albumSong, '', true));
  if (newSong != null && newSong !== tt) sups.push(superlative('Best newcomer', newSong, `${fmtH(st.artists.secs[newcomer])} in your first year`));
  const songs = topN(st.tracks.plays, 10);
  return `<section class="spread" id="y${Y}" aria-labelledby="h${Y}">
    <div class="spread-head">
      <div class="year" aria-hidden="true">${Y}</div>
      <h2 id="h${Y}">${ta != null ? `${artistLink(ta)} was your top artist` : `${Y}`}</h2>
      <p class="spread-lede">${fmtInt(T.total / 3600)} hours of music, ${fmtInt(f.newArtists.length)} artists heard for the first time${f.bestDay ? `, and your biggest day was ${fmtDay(f.bestDay[0]).replace(/, \d+$/, '')} with ${fmtH(f.bestDay[1])}` : ''}.</p>
    </div>
    <div class="spread-port">${artistPortraits(topN(st.artists.secs, 8), a => fmtH(st.artists.secs[a]))}</div>
    <div class="gutter" aria-hidden="true"></div>
    <div class="spread-r">
      <h3 class="slab">Superlatives</h3>
      ${sups.join('')}
    </div>
    <details class="spread-songs">
      <summary><span class="slab">Top 10 songs of ${Y}</span><span class="open-lbl">Show the list</span></summary>
      ${mixTools(songs, `My top songs of ${Y}`, `My 10 most played songs of ${Y}, from my listening history.`)}
      <ol class="rank-list two-col">${songs.map((t, i) => songRow(t, fmtInt(st.tracks.plays[t]) + ' plays', i + 1)).join('')}</ol>
    </details>
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
      ${forgotten.length ? `${mixTools(forgotten.slice(0, 50), `Forgotten favorites${RD.era === 'all' ? '' : ' from ' + RD.era}`, 'Songs I loved and stopped playing, from my listening history.')}
        ${coverRow(forgotten.slice(0, 4), t => `${fmtInt(S.plays[t])} plays, last in ${monthName(S.last[t])}`)}
        <ol class="rank-list">${forgotten.slice(4, RD.shown).map(t => songRow(t, `${fmtInt(S.plays[t])} plays, last in ${monthName(S.last[t])}`)).join('')}</ol>
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

// ---------------- Binges: school years (Aug 1 to Jul 31), seasons and data-driven sub-eras
// Seasons follow the school year: Fall Aug to Nov, Winter Dec to Feb, Spring Mar to May, Summer Jun to Jul.
const SEASONS = ['Fall', 'Winter', 'Spring', 'Summer'];
const SEASON_MONTHS = ['Aug to Nov', 'Dec to Feb', 'Mar to May', 'Jun and Jul'];
const schoolYear = (y, m) => (m >= 7 ? y : y - 1);
const seasonQ = m => (m >= 7 && m <= 10 ? 0 : m === 11 || m <= 1 ? 1 : m <= 4 ? 2 : 3);
const seasonOf = (y, m) => schoolYear(y, m) * 4 + seasonQ(m);
const syLabel = sy => `${sy}–${String(sy + 1).slice(2)}`;
function seasonLabel(k) { const sy = Math.floor(k / 4), q = k % 4; return `${SEASONS[q]} ${q === 0 ? sy : q === 1 ? syLabel(sy) : sy + 1}`; }
const syStart = sy => Date.UTC(sy, 7, 1) / 1000, syEnd = sy => Date.UTC(sy + 1, 7, 1) / 1000;
const BINGE_MIN = 8; // plays in the season before a song can count as a binge
function bingeData() {
  return memo('binge', () => {
    const act = active(), total = trackStatsAll().plays, per = new Map(); // season -> Map(track -> {n, days})
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
/** Merge neighbouring units (months or weeks) while their top artists stay alike */
function segmentUnits(units, MIN, THRESH) {
  const unit = m => { const v = new Map(); let s = 0; m.forEach((x, a) => { const r = Math.sqrt(x); v.set(a, r); s += r * r; }); s = Math.sqrt(s) || 1; v.forEach((x, a) => v.set(a, x / s)); return v; };
  const sum = (u, v) => { const o = new Map(u); v.forEach((x, a) => o.set(a, (o.get(a) || 0) + x)); return o; };
  const cos = (u, v) => { let d = 0, nu = 0, nv = 0; const [sm, lg] = u.size < v.size ? [u, v] : [v, u]; sm.forEach((x, a) => { const y = lg.get(a); if (y) d += x * y; }); u.forEach(x => { nu += x * x; }); v.forEach(x => { nv += x * x; }); return d / Math.sqrt(nu * nv || 1); };
  let segs = units.map(u => ({ a: u.k, b: u.k, n: 1, v: unit(u.m) }));
  while (segs.length > 1) {
    let bi = -1, bs = -Infinity;
    for (let i = 0; i < segs.length - 1; i++) { const sc = cos(segs[i].v, segs[i + 1].v) + (Math.min(segs[i].n, segs[i + 1].n) < MIN ? 1 : 0); if (sc > bs) { bs = sc; bi = i; } }
    if (bs < THRESH) break;
    const x = segs[bi], y = segs[bi + 1];
    segs.splice(bi, 2, { a: x.a, b: y.b, n: x.n + y.n, v: sum(x.v, y.v) });
  }
  return segs;
}
const SUB_MIN_WEEKS = 4, SUB_THRESH = 0.72;
/** One school year: its sub-eras (from week-by-week artist changes), seasons and totals */
function schoolYearData(sy) {
  return memo('sy', () => {
    const { seq } = musicSeq(), t0 = syStart(sy), t1 = syEnd(sy), d0 = Math.floor(t0 / 86400);
    let lo = 0, hi = seq.length; while (lo < hi) { const m = (lo + hi) >> 1; if (P.t[seq[m]] < t0) lo = m + 1; else hi = m; }
    const plays = []; for (let j = lo; j < seq.length && P.t[seq[j]] < t1; j++) plays.push(seq[j]);
    if (!plays.length) return null;
    const weeks = new Map(), wk = p => Math.min(51, Math.floor((P.day[p] - d0) / 7));
    let secs = 0; const yearArt = new Map();
    for (const p of plays) { const w = wk(p); let m = weeks.get(w); if (!m) weeks.set(w, m = new Map()); m.set(P.artist[p], (m.get(P.artist[p]) || 0) + P.s[p]); secs += P.s[p]; yearArt.set(P.artist[p], (yearArt.get(P.artist[p]) || 0) + P.s[p]); }
    const units = [...weeks.keys()].sort((a, b) => a - b).filter(w => { let x = 0; weeks.get(w).forEach(v => { x += v; }); return x >= 3600; }).map(w => ({ k: w, m: weeks.get(w) }));
    const segs = units.length ? segmentUnits(units, SUB_MIN_WEEKS, SUB_THRESH) : [{ a: 0, b: 51 }];
    segs.forEach((g, i) => { g.a = i === 0 ? 0 : g.a; g.b = i < segs.length - 1 ? segs[i + 1].a - 1 : 51; });
    const total = trackStatsAll().plays;
    const subs = segs.map(g => ({ a: g.a, b: g.b, start: (d0 + g.a * 7) * 86400, end: (g.b >= 51 ? t1 : Math.min(t1, (d0 + (g.b + 1) * 7) * 86400)) - 1, tr: new Map(), ar: new Map(), secs: 0 }));
    const subOf = w => subs.findIndex(x => w >= x.a && w <= x.b);
    for (const p of plays) { const x = subs[subOf(wk(p))]; x.secs += P.s[p]; x.tr.set(P.i[p], (x.tr.get(P.i[p]) || 0) + 1); x.ar.set(P.artist[p], (x.ar.get(P.artist[p]) || 0) + P.s[p]); }
    subs.forEach(x => {
      x.songs = [...x.tr].filter(([, c]) => c >= 4).map(([t, c]) => ({ t, n: c, share: c / (total[t] || c), score: c * c / (total[t] || c) })).sort((u, v) => v.score - u.score);
      x.artists = [...x.ar].sort((u, v) => v[1] - u[1]);
      const sig = [...x.ar].map(([a, v]) => [a, v * v / (yearArt.get(a) || v)]).sort((u, v) => v[1] - u[1]);
      x.lead = [sig[0][0]]; if (sig[1] && sig[1][1] > sig[0][1] * 0.45) x.lead.push(sig[1][0]);
    });
    return { sy, secs, subs: subs.filter(x => x.secs > 0), plays: plays.length };
  }, true, 'sy' + sy);
}
const subName = x => listText(x.lead.map(a => D.lib.artists[a]));
const fmtMD = t => { const d = dateOf(t); return `${MON[d.getUTCMonth()]} ${d.getUTCDate()}`; };
function schoolYears() { return memo('sys', () => { const ys = new Set(bingeData().map(s => Math.floor(s.k / 4))); return [...ys].filter(sy => { const d = schoolYearData(sy); return d && d.secs >= 20 * 3600; }).sort((a, b) => a - b); }, false); }

const BG = { shown: 10 };
V.binges = ([syS, qS]) => {
  const seasons = bingeData(), sys = schoolYears();
  if (!seasons.length || !sys.length) { view().innerHTML = `<section class="page-intro"><h1>Binges</h1><p>${esc(filterNote())} No songs were played enough in one season to count.</p></section>`; return; }
  if (syS == null) return bingesLanding(seasons, sys);
  const sy = sys.includes(+syS) ? +syS : sys[sys.length - 1];
  bingesYear(sy, seasons, sys, qS != null ? +qS : null);
};
function bingesLanding(seasons, sys) {
  const byK = new Map(seasons.map(s => [s.k, s]));
  const rows = sys.slice().reverse().map(sy => `<div class="binge-row"><a class="binge-year" href="#/binges/${sy}">${syLabel(sy)}</a>${SEASONS.map((_, q) => {
    const s = byK.get(sy * 4 + q);
    if (!s) return `<span class="binge-cell empty" aria-hidden="true"></span>`;
    const top = s.songs[0], [name, ai] = D.lib.tracks[top.t];
    return `<a class="binge-cell" href="#/binges/${sy}/${q}" aria-label="${esc(seasonLabel(s.k))}: ${esc(name)} by ${esc(D.lib.artists[ai])}">${img(trackUrl(top.t), name, 'cover')}<span class="t">${esc(name)}</span></a>`;
  }).join('')}</div>`).join('');
  view().innerHTML = `
    <section class="page-intro"><h1>Binges</h1><p>The songs you couldn't stop playing, one school year per row, from August 1 to July 31. Each cover is that season's biggest binge. Pick a year to see it season by season and sub-era by sub-era.</p></section>
    <div class="binge-grid binge-landing">
      <div class="binge-row head" aria-hidden="true"><span class="binge-year"></span>${SEASONS.map((s, q) => `<span class="binge-season">${s}<small>${SEASON_MONTHS[q]}</small></span>`).join('')}</div>
      ${rows}
    </div>
    <p class="note">${esc(filterNote())} A binge is a song you played at least ${BINGE_MIN} times in one season, ranked by how many of its plays ever happened in that season.</p>`;
}
function bingesYear(sy, seasons, sys, focusQ) {
  const d = schoolYearData(sy), i = sys.indexOf(sy), prev = sys[i - 1], next = sys[i + 1];
  const byK = new Map(seasons.map(s => [s.k, s])), span = syEnd(sy) - syStart(sy);
  const monthTicks = d3.range(12).map(m => ({ m: (m + 7) % 12, x: (Date.UTC(sy + (m + 7 >= 12 ? 1 : 0), (m + 7) % 12, 1) / 1000 - syStart(sy)) / span * 100 }));
  const subs = d.subs;
  const arrow = dir => `<svg viewBox="0 0 32 32" width="34" height="34" aria-hidden="true" ${dir === 'l' ? 'style="transform:scaleX(-1)"' : ''}><path d="M6 16h20M18 8l8 8-8 8" fill="none" stroke="currentColor" stroke-width="3.5" stroke-linecap="square"/></svg>`;
  view().innerHTML = `
    <a class="back" href="#/binges"><svg viewBox="0 0 32 32" width="26" height="26" aria-hidden="true"><path d="M26 16H6M14 8l-8 8 8 8" fill="none" stroke="currentColor" stroke-width="3.5" stroke-linecap="square"/></svg>All school years</a>
    <section class="sy-head">
      ${prev != null ? `<a class="sy-turn prev" href="#/binges/${prev}" aria-label="Earlier school year, ${syLabel(prev)}">${arrow('l')}<span>${syLabel(prev)}</span></a>` : '<span class="sy-turn"></span>'}
      <div class="sy-title"><h1>${syLabel(sy)}</h1><p>August 1, ${sy} to July 31, ${sy + 1}. ${fmtInt(d.secs / 3600)} hours of music.</p></div>
      ${next != null ? `<a class="sy-turn next" href="#/binges/${next}" aria-label="Later school year, ${syLabel(next)}"><span>${syLabel(next)}</span>${arrow('r')}</a>` : '<span class="sy-turn"></span>'}
    </section>
    <section class="block sy-timeline-block">
      <h2>Sub-eras</h2>
      <p class="sub">${subs.length === 1 ? 'This school year was one steady stretch: the artists you played stayed about the same all year.' : `This school year had ${subs.length} sub-eras. A new one starts when the artists you play shift for a few weeks or more.`}</p>
      <div class="sy-track">
      <div class="sy-timeline" role="list">
        ${subs.map((x, k) => { const s = x.songs[0]; const left = (x.start - syStart(sy)) / span * 100, width = (x.end + 1 - x.start) / span * 100; return `<a role="listitem" class="sy-seg ${width < 15 ? 'narrow' : ''} ${k % 2 ? 'alt' : ''}" href="#sub${k}" data-sub="${k}" style="--x:${left.toFixed(2)}%;--w:${width.toFixed(2)}%" aria-label="${esc(subName(x))}, ${fmtMD(x.start)} to ${fmtMD(x.end)}">${s ? img(trackUrl(s.t), D.lib.tracks[s.t][0], 'seg-art') : ''}<span class="seg-txt" aria-hidden="true"><span class="seg-t">${esc(subName(x))}</span><span class="seg-d">${fmtMD(x.start)} to ${fmtMD(x.end)}</span></span></a>`; }).join('')}
      </div>
      <div class="sy-months" aria-hidden="true">${monthTicks.map(t => `<span style="--x:${t.x.toFixed(2)}%">${MON[t.m]}</span>`).join('')}</div>
      </div>
      <div class="sy-labels" aria-hidden="true">${subs.map((x, k) => `<a class="sy-label" href="#sub${k}" data-sub="${k}" tabindex="-1" style="--x:${((x.start - syStart(sy)) / span * 100).toFixed(2)}%"><span class="seg-t">${esc(subName(x))}</span><span class="seg-d">${fmtMD(x.start)} to ${fmtMD(x.end)}</span></a>`).join('')}</div>
    </section>
    ${subs.map((x, k) => `<section class="block sub-era" id="sub${k}">
      <h2>${esc(subName(x))}</h2>
      <p class="sub">${fmtMD(x.start)} to ${fmtMD(x.end)}, ${fmtH(x.secs)} of music.${x.songs[0] ? ` The song of this stretch was ${trackLink(x.songs[0].t)}, played ${fmtInt(x.songs[0].n)} times.` : ''}</p>
      <div class="era-grid">
        <div>${x.songs.length ? `${mixTools(x.songs.slice(0, 30).map(o => o.t), `${subName(x)}, ${fmtMD(x.start)} ${yearOf(x.start)} to ${fmtMD(x.end)} ${yearOf(x.end)}`, `My songs from ${fmtMD(x.start)} to ${fmtMD(x.end)} in ${syLabel(sy)}.`)}
          ${coverRow(x.songs.slice(0, 3).map(o => o.t), (t, j) => `${fmtInt(x.songs[j].n)} plays`)}
          <ol class="rank-list">${x.songs.slice(3, 8).map((o, j) => songRow(o.t, `${fmtInt(o.n)} plays`, j + 4)).join('')}</ol>` : '<p class="muted">No song was played enough to stand out.</p>'}</div>
        <div><h3>Top artists</h3>${portraits(x.artists.slice(0, 3).map(([a, v]) => ({ a, cap: fmtH(v) })), 'three')}</div>
      </div>
    </section>`).join('')}
    <section class="block" id="seasons">
      <h2>Season by season</h2>
      <p class="sub">The biggest binges of each season of ${syLabel(sy)}.</p>
      <div class="season-cols">${SEASONS.map((sn, q) => { const s = byK.get(sy * 4 + q); return `<div class="season-col ${focusQ === q ? 'on' : ''}" id="season${q}"><h3 class="slab">${sn}</h3><p class="muted season-m">${SEASON_MONTHS[q]}</p>${s ? `${mixTools(s.songs.slice(0, 30).map(o => o.t), `Binges: ${seasonLabel(s.k)}`, `The songs I could not stop playing in ${seasonLabel(s.k)}.`)}<ol class="rank-list">${s.songs.slice(0, 5).map((o, j) => songRow(o.t, `${fmtInt(o.n)} plays`, j + 1)).join('')}</ol>` : '<p class="muted">No binges this season.</p>'}</div>`; }).join('')}</div>
    </section>`;
  if (focusQ != null) requestAnimationFrame(() => jumpTo('season' + focusQ, false));
  view().querySelectorAll('[data-sub]').forEach(a => a.onclick = e => { e.preventDefault(); jumpTo('sub' + a.dataset.sub); });
  layoutSubLabels(); if (document.fonts) document.fonts.ready.then(layoutSubLabels);
}
/** Place sub-era names under the timeline at their start dates, moving a name down a row when it would collide */
function layoutSubLabels() {
  const box = $('.sy-labels'); if (!box || getComputedStyle(box).display === 'none') return;
  const W = box.clientWidth, ends = [], gap = 18, rowH = 58;
  box.querySelectorAll('.sy-label').forEach(l => {
    let x = parseFloat(l.style.getPropertyValue('--x')) / 100 * W; const w = Math.min(l.offsetWidth, 280);
    x = Math.min(x, W - w);
    let r = ends.findIndex(e => e + gap <= x); if (r < 0) { r = ends.length; ends.push(0); }
    ends[r] = x + w; l.style.left = x + 'px'; l.style.top = r * rowH + 'px'; l.style.setProperty('--lead', (r * rowH + 36) + 'px'); // leader runs up to the gold axis
  });
  box.style.height = ends.length * rowH + 'px';
}
document.addEventListener('keydown', e => { // arrow keys turn school years on a Binges year page
  if (!/^#\/binges\/\d+/.test(location.hash) || /input|textarea|select/i.test(document.activeElement.tagName)) return;
  const a = e.key === 'ArrowRight' ? $('.sy-turn.next') : e.key === 'ArrowLeft' ? $('.sy-turn.prev') : null;
  if (a && a.href) { e.preventDefault(); location.hash = a.getAttribute('href'); }
});

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
  view().innerHTML = `${backLink()}<section class="hero person">${img(artistUrl(ai), L.artists[ai], 'lg portrait')}<div class="meta"><h1>${esc(L.artists[ai])}</h1>
      <p>Your number ${rank} artist. You've listened for ${fmtH(secs)} since ${monthName(first)}, most of all in ${MONTH[peak[0] % 12]} ${Math.floor(peak[0] / 12)}.</p>${artistStart(ai)}</div></section>
    <p class="lead-text facts-line">${fmtInt(plays)} plays across ${fmtInt(topTracks.length)} different songs. You played ${pct(done / started)} of them to the end, and last played this artist in ${monthName(last)}.</p>
    <section class="block"><h2>Listening over time</h2><p class="sub">Hours per month</p><div class="chart" id="c-am"></div></section>
    <div class="grid g2">
      <section class="block"><h2>Top songs</h2><ol class="rank-list">${topTracks.slice(0, 15).map(([t, n], i) => songRow(t, fmtInt(n) + ' plays', i + 1)).join('')}</ol></section>
      <section class="block"><h2>Albums</h2>${rankList([...alS].sort((a, b) => b[1] - a[1]).slice(0, 10).map(([al, s]) => ({ url: albumUrl(al), title: L.albums[al][0], value: fmtH(s) })))}</section>
    </div>
    ${artistLinksBlock(ai)}`;
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
  view().innerHTML = `${backLink()}<section class="hero">${img(trackUrl(ti), name, 'lg')}<div class="meta"><h1>${esc(name)}</h1>
      <p>${artistLink(ai)}, from ${esc(L.albums[al][0])}</p>
      <p>You first played it in ${monthName(P.t[first])} and have played it ${fmtInt(plays)} times since. It peaked in ${MONTH[peak[0] % 12]} ${Math.floor(peak[0] / 12)}.${lifeNote(ti)}</p>
      <button class="btn" type="button" data-play="track:${esc(id)}">${PLAY_SVG} Play</button></div></section>
    <p class="lead-text facts-line">You played it ${best.n} times in a row at most, played it to the end ${pct(done / started)} of the time, and last played it in ${monthName(P.t[last])}.</p>
    ${trackStartBlock(ti)}
    ${goesWithBlock(ti)}
    <section class="block"><h2>Plays per month</h2><div class="chart" id="c-tm"></div></section>
    <section class="block"><h2>Time of day</h2><p class="sub">Plays by hour</p><div class="chart" id="c-th"></div></section>`;
  const m0 = Math.min(...monP.keys()), m1 = Math.max(...monP.keys());
  barChart($('#c-tm'), { data: d3.range(m0, m1 + 1).map(mk => ({ key: mk, label: m1 - m0 < 24 ? MON[mk % 12] : (mk % 12 === 0 ? String(mk / 12) : ''), full: `${MON[mk % 12]} ${Math.floor(mk / 12)}`, value: monP.get(mk) || 0 })), labelEvery: 1, fmt: v => fmtInt(v), height: 200 });
  $('#c-tm').querySelectorAll('svg text').forEach(t => { if (!t.textContent) t.remove(); });
  barChart($('#c-th'), { data: d3.range(24).map(h => ({ key: h, label: hourLabel(h), value: hourP[h] })), fmt: v => fmtInt(v), height: 160 });
};

// ---------------- Patterns: the big picture
const PATTERN_SECTIONS = [['p-race', 'Artist race'], ['p-how', 'Play to the end or skip'], ['p-new', 'New music'], ['p-sessions', 'Sessions'], ['p-other', 'Podcasts and books'], ['p-when', 'When you listen']];
V.patterns = () => {
  const yp = yearPicker(F.year, y => { F.year = y; V.patterns(); });
  view().innerHTML = `
    <section class="page-intro"><h1>Patterns</h1><p>How your listening changed over the years.</p></section>
    <nav class="jump" aria-label="On this page">${PATTERN_SECTIONS.map(([id, l]) => `<a href="#${id}" data-to="${id}">${l}</a>`).join('')}</nav>
    <div class="year-bar"><label class="year-bar-l" for="ySelP">Year shown</label>${yp.html}<select id="ySelP" class="input select year-sel"><option value="all" ${F.year === 'all' ? 'selected' : ''}>All years</option>${storyYears().map(y => `<option value="${y}" ${+F.year === y ? 'selected' : ''}>${y}</option>`).join('')}</select></div>
    <section class="block" id="p-race"><h2>Artist race</h2><p class="sub">Total hours per artist, building month by month across every year.</p>
      <div class="toolbar"><button class="btn" id="raceBtn" type="button">Play</button><input type="range" id="raceSlider" min="0" value="0" aria-label="Month"><span id="raceLbl" class="num race-lbl"></span></div>
      <div class="chart" id="race"></div></section>
    <section class="block" id="p-how"><h2>Play to the end or skip</h2><p class="sub">Artists with at least 150 plays${F.year === 'all' ? '' : ` in ${F.year}`}. Skips count songs ended with the next button.</p>
      <div class="grid g2"><div><h3 class="sub-head">Artists you play to the end</h3><div id="comp-hi"></div></div><div><h3 class="sub-head">Artists you skip</h3><div id="comp-lo"></div></div></div></section>
    <section class="block" id="p-new"><h2>New music</h2><p class="sub">Artists you heard for the first time, by year.</p><div class="chart" id="c-na"></div></section>
    <section class="block" id="p-sessions"><h2>Sessions</h2><p class="sub">A session ends after 30 minutes of silence.</p><div id="sess"></div></section>
    <section class="block" id="p-other"><h2>Podcasts and audiobooks</h2><div id="pods"></div></section>
    <section class="block" id="p-when"><h2>When you listen</h2><p class="sub">Hours by weekday and hour of day.</p><div id="clock"></div>
      <h3 class="sub-head">By month of the year</h3><div class="chart" id="c-moy"></div></section>`;
  yp.bind($('.year-bar'));
  $('#ySelP').onchange = e => { F.year = e.target.value === 'all' ? 'all' : +e.target.value; V.patterns(); };
  view().querySelectorAll('[data-to]').forEach(a => a.onclick = e => { e.preventDefault(); jumpTo(a.dataset.to); });
  race(); behavior(); discovery(); sessionsBlock(); podsBlock(); clockAndSeasons();
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
  const sc = scope();
  const st = itemStats(), comp = new Map();
  for (let p = 0; p < P.n; p++) { if (!sc[p] || P.k[p] !== 0) continue; const a = P.artist[p]; let o = comp.get(a); if (!o) comp.set(a, o = [0, 0]); o[0]++; if (P.re[p] === REASON.trackdone) o[1]++; }
  const elig = [...comp].filter(([, o]) => o[0] >= 150).map(([a, o]) => [a, o[1] / o[0], o[0]]);
  const li = list => rankList(list.map(([a, r, n]) => ({ url: artistUrl(a), title: D.lib.artists[a], titleHtml: artistLink(a), sub: `${fmtInt(n)} plays`, value: pct(r), round: true })));
  $('#comp-hi').innerHTML = elig.length ? li(elig.slice().sort((a, b) => b[1] - a[1]).slice(0, 8)) : '<p class="muted">Not enough plays.</p>';
  $('#comp-lo').innerHTML = elig.length ? li(elig.slice().sort((a, b) => a[1] - b[1]).slice(0, 8)) : '<p class="muted">Not enough plays.</p>';
}
function discovery() {
  const firstA = firstSeen('artist'), yrs = storyYears();
  const newA = new Map(yrs.map(y => [y, 0])); firstA.forEach(t => { if (isFinite(t)) { const y = dateOf(t).getUTCFullYear(); if (newA.has(y)) newA.set(y, newA.get(y) + 1); } });
  barChart($('#c-na'), { data: yrs.map(y => ({ key: y, label: String(y), full: String(y), value: newA.get(y) })), height: 200, highlight: F.year === 'all' ? null : +F.year });
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
  $('#sess').innerHTML = `<p class="lead-text">${fmtInt(ss.length)} sessions. A typical one lasts ${Math.round(med / 60)} minutes${longest[0] ? `, and the longest ran for ${fmtH(longest[0].secs)}` : ''}.</p>
    <div class="grid g2"><div><h3 class="sub-head">How long sessions last</h3><div class="chart" id="c-sl"></div></div>
    <div><h3 class="sub-head">Longest sessions</h3><ol class="rank-list plain">${longest.map(s => `<li><div class="who"><div><div class="t">${fmtDate(s.start)}</div><div class="a">Mostly ${esc(label([...s.art].sort((a, b) => b[1] - a[1])[0][0]))}</div></div></div><span class="v">${fmtH(s.secs)}</span></li>`).join('')}</ol></div></div>
    <h3 class="sub-head">Songs on repeat</h3><ol class="rank-list">${runs.slice(0, 8).map(r => songRow(r.id, `${r.n} in a row, ${monthName(r.t)}`)).join('')}</ol>`;
  const shortL = ['<5 min', '5–15', '15–30', '30–60', '1–2 h', '2 h+'], narrow = $('#c-sl').clientWidth < 520;
  barChart($('#c-sl'), { data: buckets.map(([a, b, l], i) => ({ key: i, label: narrow ? shortL[i] : l, full: l, value: lens.filter(v => v >= a && v < b).length })), height: 180, labelEvery: 1 });
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

// ================================================================ CONNECTIONS AND ERAS
// Everything below uses only your own plays (current filters), except "You might like",
// which reads data/similar.json from scripts/fetch_similar.py (ListenBrainz).
const SESSION_GAP = 1800; // seconds of silence that end a session

/** Counted music plays (30 s or more) in time order, plus a session number for each */
function musicSeq() {
  return memo('musicSeq', () => {
    const act = active(), q = [];
    for (let p = 0; p < P.n; p++) if (act[p] && P.k[p] === 0 && P.s[p] >= 30) q.push(p);
    const seq = Int32Array.from(q), sess = new Int32Array(seq.length);
    let s = 0;
    for (let j = 1; j < seq.length; j++) { const a = seq[j - 1], b = seq[j]; if (P.t[b] - (P.t[a] + P.s[a]) > SESSION_GAP) s++; sess[j] = s; }
    return { seq, sess, nSess: s + 1 };
  }, false);
}
/** Play times per track, grouped (CSR layout): times[off[t] .. off[t+1]) */
function trackTimes() {
  return memo('trackTimes', () => {
    const { seq } = musicSeq(), n = D.lib.tracks.length, off = new Int32Array(n + 1);
    for (const p of seq) off[P.i[p] + 1]++;
    for (let t = 0; t < n; t++) off[t + 1] += off[t];
    const fill = off.slice(0, n), times = new Float64Array(seq.length), at = new Int32Array(seq.length);
    seq.forEach((p, j) => { const k = fill[P.i[p]]++; times[k] = P.t[p]; at[k] = j; });
    return { off, times, at };
  }, false);
}
const yearsText = (y0, y1) => (y0 === y1 ? String(y0) : `${y0} to ${y1}`);
const yearOf = t => dateOf(t).getUTCFullYear();
function listText(names) { return names.length <= 1 ? (names[0] || '') : names.slice(0, -1).join(', ') + ' and ' + names[names.length - 1]; }
function durText(sec) { const d = sec / 86400; if (d < 14) return `${Math.max(1, Math.round(d))} days`; if (d < 70) return `${Math.round(d / 7)} weeks`; return `${Math.round(d / 30.4)} months`; }

// ---------------- songs played near each other
/** Songs you often played within 3 songs of track ti, in the same session */
function goesWith(ti, n = 10) {
  const { seq, sess } = musicSeq(), T = trackTimes(), total = trackStatsAll().plays, W = 3;
  const days = new Map(); // track -> Set(day)
  for (let k = T.off[ti]; k < T.off[ti + 1]; k++) {
    const j = T.at[k];
    for (let d = -W; d <= W; d++) {
      const m = j + d; if (!d || m < 0 || m >= seq.length || sess[m] !== sess[j]) continue;
      const o = P.i[seq[m]]; if (o === ti) continue;
      let s = days.get(o); if (!s) days.set(o, s = new Set()); s.add(P.day[seq[j]]);
    }
  }
  const out = [];
  const own = D.lib.tracks[ti][1];
  days.forEach((s, o) => { if (s.size >= 2) { const ds = [...s]; out.push({ t: o, days: s.size, y0: yearOf(Math.min(...ds) * 86400), y1: yearOf(Math.max(...ds) * 86400), score: s.size / Math.sqrt(total[o] || 1) * (D.lib.tracks[o][1] === own ? 0.5 : 1) }); } });
  return out.sort((a, b) => b.score - a.score).slice(0, n);
}

// ---------------- artist graph: artists played right after one another
function artistGraph() {
  return memo('artistGraph', () => {
    const { seq, sess } = musicSeq(), edge = new Map(), last = new Map();
    const A = D.lib.artists.length, deg = new Float64Array(A);
    for (let j = 1; j < seq.length; j++) {
      if (sess[j] !== sess[j - 1]) continue;
      const a = P.artist[seq[j - 1]], b = P.artist[seq[j]]; if (a === b) continue;
      const key = a < b ? a * A + b : b * A + a;
      if (last.get(key) === sess[j]) continue; // count each pair once per session
      last.set(key, sess[j]); edge.set(key, (edge.get(key) || 0) + 1); deg[a]++; deg[b]++;
    }
    const adj = new Map();
    edge.forEach((c, key) => {
      if (c < 2) return;
      const a = Math.floor(key / A), b = key % A, sim = c / Math.sqrt(deg[a] * deg[b]);
      for (const [x, y] of [[a, b], [b, a]]) { let l = adj.get(x); if (!l) adj.set(x, l = []); l.push([y, c, sim]); }
    });
    return { adj, deg, A, sim: (a, b) => { const c = edge.get(a < b ? a * A + b : b * A + a) || 0; return c ? c / Math.sqrt(deg[a] * deg[b]) : 0; } };
  }, false);
}
const edgeCost = sim => -Math.log(Math.min(0.95, sim)) + 0.15; // strong links are short, every hop costs a little
function minHeap() {
  const h = [];
  return {
    get size() { return h.length; },
    push(x) { h.push(x); let i = h.length - 1; while (i) { const pa = (i - 1) >> 1; if (h[pa][0] <= h[i][0]) break; [h[pa], h[i]] = [h[i], h[pa]]; i = pa; } },
    pop() { const top = h[0], end = h.pop(); if (h.length) { h[0] = end; let i = 0; for (;;) { const l = 2 * i + 1, r = l + 1; let m = i; if (l < h.length && h[l][0] < h[m][0]) m = l; if (r < h.length && h[r][0] < h[m][0]) m = r; if (m === i) break; [h[m], h[i]] = [h[i], h[m]]; i = m; } } return top; },
  };
}
function shortestPath(from, to) {
  const { adj } = artistGraph(), dist = new Map([[from, 0]]), prev = new Map(), heap = minHeap();
  heap.push([0, from]);
  while (heap.size) {
    const [d, u] = heap.pop(); if (u === to) break; if (d > dist.get(u)) continue;
    for (const [v, , sim] of adj.get(u) || []) { const nd = d + edgeCost(sim); if (nd < (dist.has(v) ? dist.get(v) : Infinity)) { dist.set(v, nd); prev.set(v, u); heap.push([nd, v]); } }
  }
  if (!dist.has(to)) return null;
  const path = [to]; while (path[0] !== from) path.unshift(prev.get(path[0]));
  return path;
}
/** For each hop of an artist path, the pair of songs you most often played back to back */
function pathSongs(path) {
  const { seq, sess } = musicSeq(), pos = new Map(path.map((a, i) => [a, i])), pairs = path.slice(1).map(() => new Map());
  for (let j = 1; j < seq.length; j++) {
    if (sess[j] !== sess[j - 1]) continue;
    const pa = seq[j - 1], pb = seq[j], ia = pos.get(P.artist[pa]), ib = pos.get(P.artist[pb]);
    if (ia == null || ib == null || Math.abs(ia - ib) !== 1) continue;
    const lo = Math.min(ia, ib), [x, y] = ia < ib ? [P.i[pa], P.i[pb]] : [P.i[pb], P.i[pa]], key = x + ':' + y;
    pairs[lo].set(key, (pairs[lo].get(key) || 0) + 1);
  }
  const blocks = path.map(() => ({ inn: [], out: [] }));
  pairs.forEach((m, h) => {
    [...m].sort((a, b) => b[1] - a[1]).slice(0, 2).forEach(([key]) => { const [x, y] = key.split(':').map(Number); blocks[h].out.push(x); blocks[h + 1].inn.push(y); });
  });
  const out = [];
  blocks.forEach(b => { // arrive on the top incoming song, leave on the top outgoing song
    const order = [b.inn[0], b.inn[1], b.out[1], b.out[0]].filter(t => t != null);
    order.forEach(t => { if (!out.includes(t)) out.push(t); });
  });
  return out;
}
/** Artists that sit between groups of your top artists (weighted betweenness) */
function bridgeArtists() {
  return memo('bridges', () => {
    const st = allTime(), top = topN(st.artists.secs, 150), inTop = new Set(top), { adj } = artistGraph();
    const nb = new Map(top.map(a => [a, (adj.get(a) || []).filter(([b]) => inTop.has(b))]));
    const bc = new Map(top.map(a => [a, 0]));
    for (const s of top) { // Brandes with Dijkstra
      const S = [], pred = new Map(top.map(a => [a, []])), sigma = new Map(top.map(a => [a, 0])), dist = new Map();
      sigma.set(s, 1); dist.set(s, 0); const Q = minHeap(), done = new Set(); Q.push([0, s]);
      while (Q.size) {
        const [d, v] = Q.pop(); if (done.has(v)) continue; done.add(v); S.push(v);
        for (const [w, , sim] of nb.get(v)) {
          const nd = d + edgeCost(sim), dw = dist.has(w) ? dist.get(w) : Infinity;
          if (nd < dw - 1e-9) { dist.set(w, nd); Q.push([nd, w]); sigma.set(w, sigma.get(v)); pred.set(w, [v]); }
          else if (Math.abs(nd - dw) < 1e-9) { sigma.set(w, sigma.get(w) + sigma.get(v)); pred.get(w).push(v); }
        }
      }
      const delta = new Map(top.map(a => [a, 0]));
      while (S.length) { const w = S.pop(); for (const v of pred.get(w)) delta.set(v, delta.get(v) + sigma.get(v) / sigma.get(w) * (1 + delta.get(w))); if (w !== s) bc.set(w, bc.get(w) + delta.get(w)); }
    }
    const g = artistGraph();
    return [...bc].filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([a]) => {
      const near = nb.get(a).slice().sort((x, y) => y[2] - x[2]).slice(0, 6).map(x => x[0]);
      let pair = null, best = Infinity;
      for (let i = 0; i < near.length; i++) for (let k = i + 1; k < near.length; k++) { const s = g.sim(near[i], near[k]); if (s < best) { best = s; pair = [near[i], near[k]]; } }
      return { a, pair };
    });
  }, false);
}

// ---------------- how things started
/** Context of a play: what came right before it in the same session, and how it started */
function playContext(j) {
  const { seq, sess } = musicSeq(), p = seq[j], prev = j > 0 && sess[j - 1] === sess[j] ? seq[j - 1] : -1, rs = P.rs[p];
  const by = prev >= 0 ? `${trackLink(P.i[prev])} by ${artistLink(P.artist[prev])}` : '';
  if (prev < 0) return { prev, html: rs === REASON.clickrow ? 'You picked it to start listening.' : 'It started a listening session.' };
  if (rs === REASON.clickrow) return { prev, html: `You picked it, right after ${by}.` };
  if (rs === REASON.trackdone) return { prev, html: `It played by itself after ${by}.` };
  if (rs === REASON.fwdbtn) return { prev, html: `It came on when you skipped ${by}.` };
  return { prev, html: `It came right after ${by}.` };
}
/** First counted play of each artist: seq index */
function firstPlayIdx() {
  return memo('firstIdx', () => {
    const { seq } = musicSeq(), a = new Int32Array(D.lib.artists.length).fill(-1);
    for (let j = 0; j < seq.length; j++) { const x = P.artist[seq[j]]; if (a[x] < 0) a[x] = j; }
    return a;
  }, false);
}
function gatewayData() {
  return memo('gateway', () => {
    const st = allTime(), first = firstPlayIdx(), { seq } = musicSeq();
    const favs = topN(st.artists.secs, 1e9, a => st.artists.secs[a] >= 10 * 3600 && first[a] >= 0);
    const led = new Map();
    const rows = favs.map(a => {
      const j = first[a], ctx = playContext(j);
      if (ctx.prev >= 0 && P.artist[ctx.prev] !== a) { const g = P.artist[ctx.prev]; if (!led.has(g)) led.set(g, []); led.get(g).push(a); }
      return { a, j, p: seq[j], ctx };
    });
    const gateways = [...led].filter(([, l]) => l.length >= 2).sort((x, y) => y[1].length - x[1].length || st.artists.secs[y[0]] - st.artists.secs[x[0]]);
    return { rows, gateways };
  }, false);
}

// ---------------- eras: stretches of months with similar top artists
const monthKeyLabel = mk => `${MON[mk % 12]} ${Math.floor(mk / 12)}`;
function erasData() {
  return memo('eras', () => {
    const { seq } = musicSeq(), months = new Map();
    for (const p of seq) { const mk = P.year[p] * 12 + P.mon[p]; let m = months.get(mk); if (!m) months.set(mk, m = new Map()); m.set(P.artist[p], (m.get(P.artist[p]) || 0) + P.s[p]); }
    const unit = m => { const v = new Map(); let s = 0; m.forEach((x, a) => { const r = Math.sqrt(x); v.set(a, r); s += r * r; }); s = Math.sqrt(s) || 1; v.forEach((x, a) => v.set(a, x / s)); return v; };
    const sum = (u, v) => { const o = new Map(u); v.forEach((x, a) => o.set(a, (o.get(a) || 0) + x)); return o; };
    const cos = (u, v) => { let d = 0, nu = 0, nv = 0; const [s, l] = u.size < v.size ? [u, v] : [v, u]; s.forEach((x, a) => { const y = l.get(a); if (y) d += x * y; }); u.forEach(x => { nu += x * x; }); v.forEach(x => { nv += x * x; }); return d / Math.sqrt(nu * nv || 1); };
    const keys = [...months.keys()].sort((a, b) => a - b).filter(mk => { let s = 0; months.get(mk).forEach(x => { s += x; }); return s >= 3 * 3600; });
    if (!keys.length) return [];
    let segs = keys.map(mk => ({ a: mk, b: mk, n: 1, v: unit(months.get(mk)) }));
    const MIN = 3, THRESH = 0.88; // tuned on this history: about one era per 8 to 12 months
    while (segs.length > 1) {
      let bi = -1, bs = -Infinity;
      for (let i = 0; i < segs.length - 1; i++) { const s = cos(segs[i].v, segs[i + 1].v) + (Math.min(segs[i].n, segs[i + 1].n) < MIN ? 1 : 0); if (s > bs) { bs = s; bi = i; } }
      if (bs < THRESH) break;
      const x = segs[bi], y = segs[bi + 1];
      segs.splice(bi, 2, { a: x.a, b: y.b, n: x.n + y.n, v: sum(x.v, y.v) });
    }
    // era boundaries cover the whole timeline: each era runs until the next one starts
    const lastMk = P.year[seq[seq.length - 1]] * 12 + P.mon[seq[seq.length - 1]];
    segs.forEach((s, i) => { s.b = i < segs.length - 1 ? segs[i + 1].a - 1 : lastMk; });
    segs[0].a = P.year[seq[0]] * 12 + P.mon[seq[0]]; // quiet early months belong to the first era
    const total = trackStatsAll().plays, life = allTime().artists.secs, eras = segs.map(s => ({ a: s.a, b: s.b, tr: new Map(), ar: new Map(), secs: 0 }));
    const idx = mk => { let lo = 0, hi = eras.length - 1; while (lo < hi) { const m = (lo + hi + 1) >> 1; if (eras[m].a <= mk) lo = m; else hi = m - 1; } return lo; };
    for (const p of seq) {
      const e = eras[idx(P.year[p] * 12 + P.mon[p])]; e.secs += P.s[p];
      e.tr.set(P.i[p], (e.tr.get(P.i[p]) || 0) + 1); e.ar.set(P.artist[p], (e.ar.get(P.artist[p]) || 0) + P.s[p]);
    }
    const first = firstSeen('artist');
    return eras.map(e => {
      const songs = [...e.tr].filter(([, c]) => c >= 3).map(([t, c]) => ({ t, n: c, share: c / (total[t] || c), score: c * c / (total[t] || c) })).sort((x, y) => y.score - x.score);
      const artists = [...e.ar].sort((x, y) => y[1] - x[1]);
      const signature = [...e.ar].map(([a, s]) => [a, s * s / (life[a] || s)]).sort((x, y) => y[1] - x[1]);
      const lead = [signature[0][0]]; if (signature[1] && signature[1][1] > signature[0][1] * 0.45) lead.push(signature[1][0]);
      const newFavs = artists.filter(([a]) => first[a] >= Date.UTC(Math.floor(e.a / 12), e.a % 12, 1) / 1000 && first[a] < Date.UTC(Math.floor((e.b + 1) / 12), (e.b + 1) % 12, 1) / 1000 && life[a] >= 3 * 3600).map(([a]) => a);
      return { a: e.a, b: e.b, secs: e.secs, songs, artists, lead, newFavs, months: e.b - e.a + 1 };
    });
  }, false);
}
const eraName = e => `The ${listText(e.lead.map(a => D.lib.artists[a]))} era`;
const eraRange = e => (e.a === e.b ? monthKeyLabel(e.a) : `${monthKeyLabel(e.a)} to ${monthKeyLabel(e.b)}`);

// ---------------- lifecycles: lasting favorites, short obsessions, slow burns
function lifecycles() {
  return memo('life', () => {
    const T = trackTimes(), n = D.lib.tracks.length, lasting = [], burst = [], slow = [];
    for (let t = 0; t < n; t++) {
      const o = T.off[t], c = T.off[t + 1] - o; if (c < 20) continue;
      const ts = T.times.subarray(o, o + c), yc = new Map();
      ts.forEach(x => { const y = yearOf(x); yc.set(y, (yc.get(y) || 0) + 1); });
      const ys = [...yc].filter(([, k]) => k >= 2).map(([y]) => y).sort((a, b) => a - b);
      if (ys.length >= 5) lasting.push({ t, c, years: ys.length, y0: ys[0], y1: ys[ys.length - 1] });
      const m = Math.ceil(c * 0.7); let win = Infinity, at = 0;
      for (let i = 0; i + m - 1 < c; i++) { const w = ts[i + m - 1] - ts[i]; if (w < win) { win = w; at = i; } }
      if (c >= 25 && win <= 42 * 86400) burst.push({ t, c, m, win, start: ts[at] });
      if (c >= 30) {
        const firstT = ts[0], early = ts.filter(x => x < firstT + 90 * 86400).length;
        const bestY = [...yc].sort((a, b) => b[1] - a[1])[0][0];
        if (early <= 3 && bestY - yearOf(firstT) >= 1) slow.push({ t, c, firstT, bestY });
      }
    }
    lasting.sort((a, b) => b.years - a.years || b.c - a.c); burst.sort((a, b) => b.c - a.c); slow.sort((a, b) => b.c - a.c);
    return { lasting, burst, slow };
  }, false);
}

// ---------------- ListenBrainz similar artists
const normName = s => String(s || '').normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/&/g, 'and').replace(/[^a-z0-9]+/g, '');
function nameIndex() {
  return memo('nameIdx', () => {
    const st = itemStats('all'), m = new Map();
    D.lib.artists.forEach((nm, a) => { const k = normName(nm), cur = m.get(k); if (cur == null || st.artists.secs[a] > st.artists.secs[cur]) m.set(k, a); });
    return m;
  }, false);
}
/** Artists you have never played, ranked by how similar they are to the artists you play most */
function youMightLike() {
  return memo('mightLike', () => {
    const S = D.sim; if (!S || !S.artists) return [];
    const st = allTime(), names = nameIndex(), agg = new Map();
    for (const [aS, v] of Object.entries(S.artists)) {
      const a = +aS, h = st.artists.secs[a] / 3600; if (!(h > 0) || !v.similar.length) continue;
      const w = Math.sqrt(h), max = v.similar[0][2] || 1;
      v.similar.forEach(([nm, mb, sc]) => {
        if (names.has(normName(nm)) || /^\[.*\]$|^various artists$/i.test(nm)) return; // played at some point, or a placeholder like [theatre]
        let o = agg.get(mb); if (!o) agg.set(mb, o = { name: nm, mb, score: 0, from: [] });
        const c = w * sc / max; o.score += c; o.from.push([a, c]);
      });
    }
    return [...agg.values()].filter(o => o.from.length >= 2).sort((x, y) => y.score - x.score).map(o => ({ ...o, from: o.from.sort((x, y) => y[1] - x[1]).map(x => x[0]) }));
  }, false);
}
const spotifySearch = name => `https://open.spotify.com/search/${encodeURIComponent(name)}`;
function newArtistList(items) {
  return portraits(items.map(o => ({ img: D.sim.photos && D.sim.photos[o.mb], name: o.name, nameHtml: `<a href="${esc(spotifySearch(o.name))}" target="_blank" rel="noopener">${esc(o.name)}</a>`, cap: `Similar to ${listText(o.from.slice(0, 3).map(a => artistLink(a)))}` })));
}

// ---------------- playlists: save to Spotify or copy links
const MIX = new Map(); let mixSeq = 0;
function mixTools(tracks, name, description) {
  const ids = [...new Set(tracks)].map(t => D.lib.tracks[t][3]).filter(Boolean);
  if (ids.length < 2) return '';
  const id = 'mix' + (++mixSeq); MIX.set(id, { ids, name, description });
  const canSave = !!D.meta.spotify_client_id;
  return `<div class="toolbar mix-tools" data-mix="${id}">${canSave ? `<button class="btn" type="button" data-mix-act="save">${SPOTIFY_SVG} Save as a Spotify playlist</button>` : ''}<button class="btn ghost" type="button" data-mix-act="copy">Copy ${ids.length} song links</button><span class="mix-msg muted" role="status" aria-live="polite"></span></div>`;
}
const SPOTIFY_SVG = '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><circle cx="12" cy="12" r="10" fill="none" stroke="currentColor" stroke-width="2"/><path d="M7 9.5c3.4-1 7-.7 10 1M7.6 12.8c2.8-.8 5.6-.5 8 .9M8.2 15.9c2.2-.6 4.3-.4 6.1.7" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>';
async function mixAction(btn) {
  const box = btn.closest('[data-mix]'), mix = MIX.get(box.dataset.mix), msg = box.querySelector('.mix-msg');
  if (!mix) return;
  if (btn.dataset.mixAct === 'copy') {
    const text = mix.ids.map(id => `https://open.spotify.com/track/${id}`).join('\n');
    try { await navigator.clipboard.writeText(text); msg.textContent = 'Copied. In the Spotify desktop app, open a playlist and paste.'; }
    catch (e) { msg.textContent = 'Copying is blocked in this browser.'; }
    return;
  }
  btn.disabled = true; msg.textContent = 'Saving to Spotify';
  try { const url = await spotify.save(mix); msg.innerHTML = url ? `Saved. <a href="${esc(url)}" target="_blank" rel="noopener">Open the playlist in Spotify</a>` : ''; }
  catch (e) { msg.textContent = e.message; }
  btn.disabled = false;
}

// Spotify login with PKCE (no client secret), then create a private playlist and add the songs.
const spotify = {
  redirect: () => location.origin + location.pathname,
  token: () => store.get('lh-spotify', null),
  async login(pending) {
    if (location.hostname === 'localhost') throw new Error('Spotify only accepts 127.0.0.1. Open this page at http://127.0.0.1' + (location.port ? ':' + location.port : '') + location.pathname + ' and try again.');
    const rnd = n => Array.from(crypto.getRandomValues(new Uint8Array(n)), b => 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~'[b % 66]).join('');
    const verifier = rnd(64), state = rnd(16);
    const hash = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier)));
    const challenge = btoa(String.fromCharCode(...hash)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    try { sessionStorage.setItem('lh-spotify-auth', JSON.stringify({ verifier, state, pending, hash: location.hash })); } catch (e) { throw new Error('This browser blocks storage, so Spotify login cannot work here.'); }
    location.href = 'https://accounts.spotify.com/authorize?' + new URLSearchParams({ response_type: 'code', client_id: D.meta.spotify_client_id, scope: 'playlist-modify-private playlist-modify-public', redirect_uri: this.redirect(), code_challenge_method: 'S256', code_challenge: challenge, state });
    return new Promise(() => {}); // the page is leaving
  },
  async tokenRequest(params) {
    const r = await fetch('https://accounts.spotify.com/api/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ client_id: D.meta.spotify_client_id, ...params }) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error('Spotify login failed (' + (j.error_description || j.error || r.status) + ').');
    const old = this.token() || {};
    const tok = { access: j.access_token, refresh: j.refresh_token || old.refresh, exp: Date.now() + (j.expires_in - 60) * 1000 };
    store.set('lh-spotify', tok); return tok;
  },
  async access() {
    let tok = this.token();
    if (tok && tok.exp > Date.now()) return tok.access;
    if (tok && tok.refresh) { try { tok = await this.tokenRequest({ grant_type: 'refresh_token', refresh_token: tok.refresh }); return tok.access; } catch (e) { store.set('lh-spotify', null); } }
    return null;
  },
  async api(path, body) {
    const r = await fetch('https://api.spotify.com/v1' + path, { method: 'POST', headers: { Authorization: 'Bearer ' + await this.access(), 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    if (r.status === 401) { store.set('lh-spotify', null); throw Object.assign(new Error('relogin'), { relogin: true }); }
    if (r.status === 403) throw new Error('Spotify refused. Only accounts the site owner has added to the Spotify app can save playlists from this site.');
    if (!r.ok) throw Object.assign(new Error(`Spotify could not save the playlist (error ${r.status}).`), { status: r.status });
    return r.json().catch(() => ({}));
  },
  async save(mix) {
    if (!(await this.access())) return this.login(mix);
    try {
      const pl = await this.api('/me/playlists', { name: mix.name, description: mix.description || 'Made from my listening history', public: false });
      const uris = mix.ids.map(id => 'spotify:track:' + id);
      for (let i = 0; i < uris.length; i += 100) {
        const chunk = { uris: uris.slice(i, i + 100) };
        try { await this.api(`/playlists/${pl.id}/items`, chunk); }
        catch (e) { if (e.status === 404) await this.api(`/playlists/${pl.id}/tracks`, chunk); else throw e; }
      }
      return (pl.external_urls && pl.external_urls.spotify) || `https://open.spotify.com/playlist/${pl.id}`;
    } catch (e) { if (e.relogin) return this.login(mix); throw e; }
  },
  /** Back from Spotify's login page: finish login, save the waiting playlist, restore the page */
  async finishLogin() {
    const q = new URLSearchParams(location.search); if (!q.has('code') && !q.has('error')) return;
    let saved = null; try { saved = JSON.parse(sessionStorage.getItem('lh-spotify-auth')); sessionStorage.removeItem('lh-spotify-auth'); } catch (e) { /* storage unavailable */ }
    history.replaceState(null, '', location.pathname + ((saved && saved.hash) || location.hash));
    if (!saved || q.get('state') !== saved.state) return toast('Spotify login did not finish. Try again.');
    if (q.has('error')) return toast('Spotify login was cancelled.');
    try {
      await this.tokenRequest({ grant_type: 'authorization_code', code: q.get('code'), redirect_uri: this.redirect(), code_verifier: saved.verifier });
      if (saved.pending) { toast('Saving to Spotify'); const url = await this.save(saved.pending); toast(`Saved "${esc(saved.pending.name)}". <a href="${esc(url)}" target="_blank" rel="noopener">Open it in Spotify</a>`, 12000); }
    } catch (e) { toast(esc(e.message), 12000); }
  },
};
let toastTimer = null;
function toast(html, ms = 6000) { const t = $('#toast'); t.innerHTML = html; t.hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => { t.hidden = true; }, ms); }

// ---------------- additions to the song and artist pages
function lifeNote(ti) {
  const L = lifecycles(), f = (arr) => arr.find(r => r.t === ti);
  const a = f(L.lasting), b = f(L.burst), c = f(L.slow);
  if (a) return ` It's one of your lasting favorites, played in ${a.years} different years.`;
  if (c) return ` It grew on you: you first heard it in ${monthName(c.firstT)} but played it most in ${c.bestY}.`;
  if (b) return ` It was a short obsession: ${b.m} of its ${b.c} plays came within ${durText(b.win)}.`;
  return '';
}
function trackStartBlock(ti) {
  const T = trackTimes(); if (T.off[ti] === T.off[ti + 1]) return '';
  const j = T.at[T.off[ti]], p = musicSeq().seq[j];
  return `<section class="block"><h2>How it started</h2><p class="lead-text">You first played it on ${fmtDate(P.t[p])} at ${fmtTime(P.t[p])}. ${playContext(j).html}</p></section>`;
}
function goesWithBlock(ti) {
  const gw = goesWith(ti, 10); if (!gw.length) return '';
  const name = D.lib.tracks[ti][0];
  return `<section class="block"><h2>Goes with</h2><p class="sub">Songs you often played within a few songs of this one. Rare songs that keep showing up next to it rank higher than your all-time hits.</p>
    ${mixTools([ti].concat(gw.map(g => g.t)), `Goes with ${name}`, `Songs I played next to ${name}, from my listening history.`)}
    ${coverRow(gw.slice(0, 4).map(g => g.t), (t, i) => `Together on ${gw[i].days} days`)}
    <ol class="rank-list">${gw.slice(4).map((g, i) => songRow(g.t, `Together on ${g.days} days, ${yearsText(g.y0, g.y1)}`, i + 5)).join('')}</ol></section>`;
}
function artistStart(ai) {
  const j = firstPlayIdx()[ai]; if (j < 0) return '';
  const p = musicSeq().seq[j];
  return `<p>The first song you played was ${trackLink(P.i[p])}, on ${fmtDate(P.t[p])}. ${playContext(j).html}</p>`;
}
function artistLinksBlock(ai) {
  const g = artistGraph(), st = allTime();
  const near = (g.adj.get(ai) || []).filter(([, c]) => c >= 3).sort((x, y) => y[2] - x[2]).slice(0, 8);
  const sim = D.sim && D.sim.artists && D.sim.artists[ai];
  let simHtml = '';
  if (sim && sim.similar.length) {
    const names = nameIndex(), rows = sim.similar.slice(0, 10).map(([nm, mb]) => {
      const a = names.get(normName(nm));
      if (a != null && st.artists.secs[a] > 0) return `<li>${img(artistUrl(a), nm, 'sm round')}<div class="who"><div><div class="t">${artistLink(a)}</div></div></div><span class="v">${fmtH(st.artists.secs[a])}</span></li>`;
      return `<li>${img(D.sim.photos && D.sim.photos[mb], nm, 'sm round')}<div class="who"><div><div class="t"><a href="${esc(spotifySearch(nm))}" target="_blank" rel="noopener">${esc(nm)}</a></div><div class="a">${a != null ? 'Hidden by your filters' : 'Never played'}</div></div></div><a class="v" href="${esc(spotifySearch(nm))}" target="_blank" rel="noopener">Find on Spotify</a></li>`;
    });
    simHtml = `<section class="block"><h2>Similar artists</h2><p class="sub">From ListenBrainz, an open music database.</p><ol class="rank-list">${rows.join('')}</ol></section>`;
  }
  if (!near.length && !simHtml) return '';
  return `<div class="grid g2">
    ${near.length ? `<section class="block"><h2>Played next to</h2><p class="sub">Artists you often played right before or after ${esc(D.lib.artists[ai])}.</p>${portraits(near.slice(0, 6).map(([b, c]) => ({ a: b, cap: `${fmtInt(c)} sessions together` })), 'three')}</section>` : '<div></div>'}
    ${simHtml}</div>`;
}

// ---------------- Eras page
const EZ = { month: null, shown: { lasting: 8, burst: 8, slow: 8 } };
V.eras = ([aS]) => {
  const eras = erasData();
  if (!eras.length) { view().innerHTML = `<section class="page-intro"><h1>Eras</h1><p>${esc(filterNote())} There is not enough listening to find eras.</p></section>`; return; }
  const cur = eras.find(e => e.a === +aS) || eras[eras.length - 1];
  const t0 = eras[0].a, t1 = eras[eras.length - 1].b + 1, span = t1 - t0;
  const lead = cur.songs[0];
  const maxH = Math.max(...eras.map(e => e.secs));
  view().innerHTML = `
    <section class="page-intro"><h1>Eras</h1><p>Your listening, split into eras. A new era starts when the artists you play month to month change. Each volume is as thick as the era was long. Pull one off the shelf to open it.</p></section>
    <section class="shelf-wrap" aria-label="Every era">
      <ol class="shelf">${eras.map(e => { const s = e.songs[0], on = e === cur, w = Math.max(62, Math.round(30 + e.months * 3.6)), h = Math.round(340 + 160 * e.secs / maxH); const title = eraName(e).replace(/^The /, '').replace(/ era$/, '');
        return `<li style="--w:${w}px;--h:${h}px"><a class="spine ${on ? 'on' : ''}" href="#/eras/${e.a}" ${on ? 'aria-current="true"' : ''} aria-label="${esc(eraName(e))}, ${esc(eraRange(e))}" title="${esc(eraName(e))}, ${esc(eraRange(e))}">${s ? img(trackUrl(s.t), title, 'spine-art') : ''}<span class="spine-t ${title.length > 28 ? 'long' : ''}" aria-hidden="true">${esc(title)}</span><span class="spine-y" aria-hidden="true">${Math.floor(e.a / 12) === Math.floor(e.b / 12) ? Math.floor(e.a / 12) : `${String(Math.floor(e.a / 12)).slice(2)}–${String(Math.floor(e.b / 12)).slice(2)}`}</span></a></li>`; }).join('')}</ol>
      <div class="shelf-board" aria-hidden="true"></div>
      <p class="shelf-hint" hidden><svg viewBox="0 0 40 32" width="30" height="24" aria-hidden="true"><path d="M5 16h30M12 9l-7 7 7 7M28 9l7 7-7 7" fill="none" stroke="currentColor" stroke-width="3.5" stroke-linecap="square"/></svg>Swipe the shelf sideways to see all ${eras.length} eras</p>
      <p class="note shelf-note">${eras.length} eras since ${monthKeyLabel(t0)}. ${esc(filterNote())}</p>
    </section>
    <section class="block era-detail" id="era-open" aria-labelledby="eraH">
      <h2 id="eraH">${esc(eraName(cur))}</h2>
      <p class="sub">${esc(eraRange(cur))}, ${cur.months} ${cur.months === 1 ? 'month' : 'months'} and ${fmtInt(cur.secs / 3600)} hours of music.${lead ? ` The song that defined it was ${trackLink(lead.t)} by ${artistLink(D.lib.tracks[lead.t][1])}, played ${fmtInt(lead.n)} times${lead.share >= 0.5 ? `, ${pct(lead.share)} of all its plays ever` : ''}.` : ''}</p>
      <div class="era-grid">
        <div>
          <h3>Songs that defined it</h3>
          <p class="sub">Played often in this era, and much less at any other time.</p>
          ${mixTools(cur.songs.slice(0, 30).map(s => s.t), `${eraName(cur)} (${yearsText(Math.floor(cur.a / 12), Math.floor(cur.b / 12))})`, `The songs that defined ${eraRange(cur)} in my listening history.`)}
          ${coverRow(cur.songs.slice(0, 3).map(s => s.t), (t, i) => `${fmtInt(cur.songs[i].n)} plays`)}
          <ol class="rank-list">${cur.songs.slice(3, 12).map((s, i) => songRow(s.t, `${fmtInt(s.n)} plays`, i + 4)).join('')}</ol>
        </div>
        <div>
          <h3>Top artists</h3>
          ${portraits(cur.artists.slice(0, 6).map(([a, s]) => ({ a, cap: fmtH(s) })), 'three')}
          ${cur.newFavs.length ? `<h3 class="sub-head">New artists you went on to love</h3><p class="muted">${listText(cur.newFavs.slice(0, 6).map(artistLink))}</p>` : ''}
        </div>
      </div>
    </section>
    <section class="block" id="life"></section>
    <section class="block" id="month"></section>`;
  lifeBlock(); monthBlock();
  if (aS) requestAnimationFrame(() => { const el = $('.era-detail'); if (el && (el.getBoundingClientRect().top < 0 || el.getBoundingClientRect().top > innerHeight * 0.75)) jumpTo('era-open', false); });
  const sh = $('.shelf'), on = $('.spine.on'); const lastLi = sh.lastElementChild; if (lastLi && lastLi.offsetLeft + lastLi.offsetWidth > sh.clientWidth + 2) { $('.shelf-hint').hidden = false; if (on) sh.scrollLeft = on.parentElement.offsetLeft - sh.clientWidth / 2 + on.offsetWidth / 2; }
};
function lifeBlock() {
  const L = lifecycles(), sh = EZ.shown;
  const col = (key, title, sub, rows, detail, mixName) => `<div><h3 class="sub-head">${title}</h3><p class="sub">${sub}</p>
    ${rows.length ? `${mixTools(rows.slice(0, 40).map(r => r.t), mixName, '')}<ol class="rank-list">${rows.slice(0, sh[key]).map(r => songRow(r.t, detail(r))).join('')}</ol>
    ${rows.length > sh[key] ? `<button class="btn ghost more" data-life="${key}">Show more</button>` : ''}` : '<p class="muted">None with the current filters.</p>'}</div>`;
  $('#life').innerHTML = `<h2>Lasting favorites and short obsessions</h2>
    <p class="sub">Some songs stay with you for years. Others take over for a few weeks and then disappear.</p>
    <div class="grid g2">
      ${col('lasting', 'Lasting favorites', 'Played in at least 5 different years.', L.lasting, r => `${r.years} years, ${yearsText(r.y0, r.y1)}`, 'Lasting favorites')}
      ${col('burst', 'Short obsessions', 'Most of their plays came within 6 weeks.', L.burst, r => `${r.m} of ${r.c} plays in ${durText(r.win)}, ${monthName(r.start)}`, 'Short obsessions')}
    </div>
    ${col('slow', 'Songs that grew on you', 'You heard them early but only started playing them a lot a year or more later.', L.slow, r => `First heard ${monthName(r.firstT)}, most plays in ${r.bestY}`, 'Songs that grew on me')}`;
  $('#life').querySelectorAll('[data-life]').forEach(b => b.onclick = () => { sh[b.dataset.life] += 10; lifeBlock(); });
}
function monthBlock() {
  const { seq } = musicSeq(), lastMk = P.year[seq[seq.length - 1]] * 12 + P.mon[seq[seq.length - 1]], firstMk = P.year[seq[0]] * 12 + P.mon[seq[0]];
  if (EZ.month == null) EZ.month = lastMk - 12;
  EZ.month = Math.max(firstMk, Math.min(lastMk, EZ.month));
  const mk = EZ.month, total = trackStatsAll().plays, first = firstSeen('artist'), life = allTime().artists.secs;
  const tr = new Map(), ar = new Map(), monS = new Map();
  let secs = 0;
  for (const p of seq) {
    const k = P.year[p] * 12 + P.mon[p];
    if (Math.floor(k / 12) === Math.floor(mk / 12)) monS.set(k, (monS.get(k) || 0) + P.s[p]);
    if (k !== mk) continue;
    secs += P.s[p]; tr.set(P.i[p], (tr.get(P.i[p]) || 0) + 1); ar.set(P.artist[p], (ar.get(P.artist[p]) || 0) + P.s[p]);
  }
  const yearAvg = [...monS.values()].reduce((s, v) => s + v, 0) / (monS.size || 1);
  const top = [...tr].sort((a, b) => b[1] - a[1]).slice(0, 5);
  const only = [...tr].filter(([, c]) => c >= 3).map(([t, c]) => [t, c, c * c / (total[t] || c)]).sort((a, b) => b[2] - a[2]).filter(([t]) => !top.slice(0, 3).some(x => x[0] === t)).slice(0, 5);
  const m0 = Date.UTC(Math.floor(mk / 12), mk % 12, 1) / 1000, m1 = Date.UTC(Math.floor((mk + 1) / 12), (mk + 1) % 12, 1) / 1000;
  const newA = [...ar.keys()].filter(a => first[a] >= m0 && first[a] < m1).sort((a, b) => life[b] - life[a]).slice(0, 5);
  const ys = d3.range(Math.floor(firstMk / 12), Math.floor(lastMk / 12) + 1);
  const cmp = !secs ? '' : secs > yearAvg * 1.25 ? `, more than a typical month that year (${fmtInt(yearAvg / 3600)} hours)` : secs < yearAvg * 0.75 ? `, less than a typical month that year (${fmtInt(yearAvg / 3600)} hours)` : ', about a typical month for that year';
  $('#month').innerHTML = `<h2>Pick any month</h2>
    <p class="sub">See what you were playing in any month, and what made it different.</p>
    <div class="toolbar">
      <label><span class="sr-only">Month</span><select id="mSel" class="input select">${MONTH.map((m, i) => `<option value="${i}" ${i === mk % 12 ? 'selected' : ''}>${m}</option>`).join('')}</select></label>
      <label><span class="sr-only">Year</span><select id="ySel" class="input select">${ys.map(y => `<option ${y === Math.floor(mk / 12) ? 'selected' : ''}>${y}</option>`).join('')}</select></label>
      <button class="btn ghost" type="button" id="mPrev" ${mk <= firstMk ? 'disabled' : ''}>Previous month</button>
      <button class="btn ghost" type="button" id="mNext" ${mk >= lastMk ? 'disabled' : ''}>Next month</button>
    </div>
    <h3 class="month-head">${MONTH[mk % 12]} ${Math.floor(mk / 12)}</h3>
    ${secs ? `<p class="sub">${fmtH(secs)} of music${cmp}.</p>
    <div class="grid g2">
      <div><h3 class="sub-head">Played most</h3><ol class="rank-list">${top.map(([t, c], i) => songRow(t, `${c} plays`, i + 1)).join('')}</ol></div>
      <div><h3 class="sub-head">Mostly that month</h3>${only.length ? `<ol class="rank-list">${only.map(([t, c]) => songRow(t, `${c} of ${total[t]} plays ever`)).join('')}</ol>` : '<p class="muted">Nothing stood out.</p>'}
      ${newA.length ? `<h3 class="sub-head">Heard for the first time</h3>${rankList(newA.map(a => ({ url: artistUrl(a), title: D.lib.artists[a], titleHtml: artistLink(a), value: `${fmtH(life[a])} since`, round: true })))}` : ''}</div>
    </div>` : '<p class="muted">No music this month with the current filters.</p>'}`;
  const set = v => { EZ.month = v; monthBlock(); };
  $('#mSel').onchange = () => set(Math.floor(mk / 12) * 12 + +$('#mSel').value);
  $('#ySel').onchange = () => set(+$('#ySel').value * 12 + mk % 12);
  $('#mPrev').onclick = () => set(mk - 1); $('#mNext').onclick = () => set(mk + 1);
}

// ---------------- Connections page
const CX = { from: null, to: null, found: 8, like: 8 };
V.connections = () => {
  const st = allTime(), G = gatewayData();
  const names = topN(st.artists.secs, 3000);
  if (CX.from == null || !(st.artists.secs[CX.from] > 0) || CX.to == null || !(st.artists.secs[CX.to] > 0)) {
    const ys = storyYears(), a = ys.length ? topN(itemStats(ys[0]).artists.secs, 1)[0] : names[0];
    CX.from = a ?? names[0];
    // start with a pair that has artists in between, so the first playlist shows what the tool does
    const pool = names.slice(0, 80).filter(x => x !== CX.from), lens = pool.map(x => (shortestPath(CX.from, x) || []).length);
    const best = Math.max(...lens); CX.to = pool[lens.findIndex(l => l === Math.min(best, 4))] ?? names[1];
  }
  const like = youMightLike(), bridges = bridgeArtists();
  view().innerHTML = `
    <section class="page-intro"><h1>Connections</h1><p>How your artists link up: the songs you played back to back, how you found your favorites, and new artists close to them.</p></section>
    <nav class="jump" aria-label="On this page"><a href="#c-path" data-to="c-path">From one artist to another</a><a href="#c-found" data-to="c-found">How you found them</a><a href="#c-bridge" data-to="c-bridge">Bridges</a>${like.length ? '<a href="#c-new" data-to="c-new">You might like</a>' : ''}</nav>
    <section class="block" id="c-path">
      <h2>From one artist to another</h2>
      <p class="sub">Pick two artists. You get a playlist that travels between them, using songs you really played back to back.</p>
      <form class="pathform" id="pathForm">
        <label><span class="lbl">From</span><input class="input" id="pFrom" list="artistNames" value="${esc(D.lib.artists[CX.from])}" autocomplete="off"></label>
        <label><span class="lbl">To</span><input class="input" id="pTo" list="artistNames" value="${esc(D.lib.artists[CX.to])}" autocomplete="off"></label>
        <button class="btn" type="submit">Make the playlist</button>
        <button class="btn ghost" type="button" id="pRand">Surprise me</button>
      </form>
      <datalist id="artistNames">${names.map(a => `<option value="${esc(D.lib.artists[a])}">`).join('')}</datalist>
      <div id="pathOut" aria-live="polite"></div>
    </section>
    <section class="block" id="c-found">
      <h2>How you found your favorite artists</h2>
      <p class="sub">The first song you played by each artist you went on to hear for 10 hours or more, and what you were playing right before.</p>
      ${portraits(G.rows.slice(0, CX.found).map(r => { const t = P.i[r.p], id = D.lib.tracks[t][3]; return { a: r.a, cap: `First song ${trackLink(t)}, ${MON[dateOf(P.t[r.p]).getUTCMonth()]} ${yearOf(P.t[r.p])}. ${r.ctx.html} ${playBtn('track', id, D.lib.tracks[t][0])}` }; }), 'found')}
      ${G.rows.length > CX.found ? `<button class="btn ghost more" id="foundMore">Show more</button>` : ''}
      ${G.gateways.length ? `<h3 class="sub-head">Artists that led you to others</h3><p class="sub">You were playing these artists right before you first heard several later favorites.</p>
        ${portraits(G.gateways.slice(0, 4).map(([g, l]) => ({ a: g, cap: `Led to ${listText(l.slice(0, 4).map(artistLink))}${l.length > 4 ? ` and ${l.length - 4} more` : ''}` })))}` : ''}
    </section>
    <section class="block" id="c-bridge">
      <h2>Bridge artists</h2>
      <p class="sub">Among your top 150 artists, these sit between groups you rarely play together. They show up most often on the shortest path from one artist to another.</p>
      ${bridges.length ? portraits(bridges.map(({ a, pair }) => ({ a, cap: pair ? `Links ${artistLink(pair[0])} and ${artistLink(pair[1])}` : '' }))) : '<p class="muted">Not enough listening to find bridges.</p>'}
    </section>
    ${like.length ? `<section class="block" id="c-new">
      <h2>You might like</h2>
      <p class="sub">Artists you have never played that are similar to several of your favorites. Similar artists come from ListenBrainz, an open music database, so a few matches may be off.</p>
      ${newArtistList(like.slice(0, CX.like))}
      ${like.length > CX.like ? `<button class="btn ghost more" id="likeMore">Show more</button>` : ''}
    </section>` : ''}`;
  view().querySelectorAll('[data-to]').forEach(a => a.onclick = e => { e.preventDefault(); jumpTo(a.dataset.to); });
  const byName = new Map(); names.slice().reverse().forEach(a => byName.set(D.lib.artists[a].toLowerCase(), a));
  const run = () => {
    const f = byName.get($('#pFrom').value.trim().toLowerCase()), t = byName.get($('#pTo').value.trim().toLowerCase());
    if (f == null || t == null) { $('#pathOut').innerHTML = `<p class="muted">Pick both artists from the list.</p>`; return; }
    CX.from = f; CX.to = t; pathBlock(f, t);
  };
  $('#pathForm').onsubmit = e => { e.preventDefault(); run(); };
  $('#pRand').onclick = () => { const pool = names.slice(0, 120); const f = pool[Math.floor(Math.random() * pool.length)]; let t = f; while (t === f) t = pool[Math.floor(Math.random() * pool.length)]; $('#pFrom').value = D.lib.artists[f]; $('#pTo').value = D.lib.artists[t]; run(); };
  const fm = $('#foundMore'); if (fm) fm.onclick = () => { CX.found += 8; V.connections(); jumpTo('c-found', false); };
  const lm = $('#likeMore'); if (lm) lm.onclick = () => { CX.like += 8; V.connections(); jumpTo('c-new', false); };
  pathBlock(CX.from, CX.to);
};
function pathBlock(f, t) {
  const out = $('#pathOut');
  if (f === t) { out.innerHTML = '<p class="muted">Pick two different artists.</p>'; return; }
  const path = shortestPath(f, t);
  if (!path) { out.innerHTML = `<p class="muted">You never played these two anywhere near each other, so there is no path between them.</p>`; return; }
  const songs = pathSongs(path), A = D.lib.artists;
  out.innerHTML = `<p class="path">${path.map(a => artistLink(a)).join('<span class="arrow" aria-hidden="true"> → </span><span class="sr-only"> then </span>')}</p>
    <p class="sub">${path.length - 2 === 0 ? 'You played these two back to back.' : `${path.length - 2} ${path.length - 2 === 1 ? 'artist' : 'artists'} in between.`} Each pair of songs is one you played back to back.</p>
    ${mixTools(songs, `From ${A[f]} to ${A[t]}`, `A path from ${A[f]} to ${A[t]} through my listening history.`)}
    <ol class="rank-list">${songs.map((s, i) => songRow(s, '', i + 1)).join('')}</ol>`;
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
const NAV = [['story', 'Story'], ['eras', 'Eras'], ['rediscover', 'Rediscover'], ['binges', 'Binges'], ['connections', 'Connections'], ['explore', 'Explore'], ['patterns', 'Patterns']];
const ALIASES = { '': 'story', overview: 'story', wrapped: 'story', library: 'explore', covers: 'explore', trends: 'patterns', habits: 'patterns', sessions: 'patterns', discovery: 'patterns', podcasts: 'patterns', onthisday: 'rediscover', binge: 'binges', timeline: 'binges', excluded: 'hidden', era: 'eras', lifecycles: 'eras', paths: 'connections', discover: 'connections' };
// in-app history, so song and artist pages can offer a Back link to the screen you came from
const HIST = [];
function backLink() {
  const prev = HIST[HIST.length - 2];
  const label = !prev ? 'All songs and artists' : 'Back';
  return `<a class="back" href="${prev ? esc(prev) : '#/explore/tracks'}" ${prev ? 'data-back' : ''}><svg viewBox="0 0 32 32" width="26" height="26" aria-hidden="true"><path d="M26 16H6M14 8l-8 8 8 8" fill="none" stroke="currentColor" stroke-width="3.5" stroke-linecap="square"/></svg>${label}</a>`;
}
function route() {
  const h = location.hash || '#/story';
  if (HIST.length > 1 && HIST[HIST.length - 2] === h) HIST.pop(); else if (HIST[HIST.length - 1] !== h) HIST.push(h);
  if (HIST.length > 50) HIST.shift();
  if (raceTimer) { clearInterval(raceTimer); raceTimer = null; }
  tip.hide(); closeSearch(); MIX.clear();
  const parts = location.hash.replace(/^#\/?/, '').split('/').filter(Boolean);
  let name = parts[0] || 'story'; name = ALIASES[name] || name;
  const args = parts.slice(1);
  const fn = V[name] || V.notfound;
  const section = { artist: 'explore', track: 'explore', hidden: 'story' }[name] || name;
  const navEl = $('#nav');
  document.querySelectorAll('#nav a').forEach(a => { const on = a.dataset.r === section; if (on && navEl.scrollWidth > navEl.clientWidth) navEl.scrollLeft = a.offsetLeft - 16; a.classList.toggle('active', on); if (on) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current'); });
  try { fn(args); markPlaying(); } catch (e) { console.error(e); view().innerHTML = `<section class="page-intro"><h1>This page could not be shown</h1><p>Reload the page to try again.</p><pre class="muted">${esc(e.stack || e)}</pre></section>`; }
  const navName = (NAV.find(n => n[0] === section) || [0, ''])[1];
  document.title = `${navName ? navName + ', ' : ''}Listening History`;
  if (!((name === 'story' || name === 'eras' || name === 'binges') && args[1] != null || (name === 'story' || name === 'eras') && args[0])) window.scrollTo(0, 0);
  view().focus({ preventScroll: true });
}
function invalidate() { memoStore.clear(); }

// docked player
// Uses Spotify's iFrame API so one click on a play button also starts playback in the player.
// If the API hasn't loaded (blocked or slow), falls back to the plain embed, which needs a second click.
const SP = { api: null, ctl: null, pending: null, wantPlay: false, plain: false };
window.onSpotifyIframeApiReady = api => { SP.api = api; if (SP.pending) { const s = SP.pending; SP.pending = null; play(s); } };
/** Mark whatever is playing: its cover lifts and a gold "Now playing" line appears */
function markPlaying() {
  view().querySelectorAll('.playing').forEach(el => el.classList.remove('playing'));
  view().querySelectorAll('.now-playing').forEach(el => el.remove());
  if (!SP.current) return;
  view().querySelectorAll(`[data-play="${CSS.escape(SP.current)}"]`).forEach(b => {
    const host = b.closest('.sup, .cover-row li, .portraits li, .rank-list li, .hero'); if (!host) return;
    host.classList.add('playing');
    const tag = document.createElement('span'); tag.className = 'now-playing'; tag.textContent = 'Now playing';
    (host.querySelector('.sup-txt, .who > div, figcaption, .meta') || host).appendChild(tag);
  });
}
function startPlaying() { // the player fires 'ready' each time a song finishes loading
  if (!SP.wantPlay || !SP.ctl) return;
  SP.wantPlay = false; SP.ctl.play();
}
function play(spec) {
  const [type, id] = spec.split(':'); if (!id) return;
  SP.current = spec; markPlaying();
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
  SP.wantPlay = false; SP.pending = null; SP.current = null; markPlaying();
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
function updateFilterBtn() { const on = F.personal ? D.meta.rules.filter(r => F.rules[r.id]).length : 0; $('#filtersBtn').textContent = on ? `What counts (${on} on)` : 'What counts (all plays)'; $('#filtersBtn').title = on ? `${on} filters are on` : 'No filters are on'; }

async function init() {
  try { await load(); } catch (e) { view().innerHTML = `<section class="page-intro"><h1>The listening data did not load</h1><p>Check your connection and reload the page. (${esc(e.message)})</p></section>`; return; }
  F.year = 'all';
  $('#nav').innerHTML = NAV.map(([r, l]) => `<a href="#/${r}" data-r="${r}">${l}</a>`).join('');
  updateFilterBtn(); renderFilters();
  const fb = $('#filtersBtn'), panel = $('#filters');
  fb.onclick = () => { panel.showModal(); };
  $('#filtersClose').onclick = () => panel.close();
  panel.addEventListener('click', e => { if (e.target !== panel) return; const r = panel.getBoundingClientRect(); if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) panel.close(); }); // only a click on the dim area outside the window
  panel.addEventListener('close', () => fb.focus());
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
    const mb = e.target.closest('[data-mix-act]'); if (mb) { e.preventDefault(); mixAction(mb); }
    const bk = e.target.closest('[data-back]'); if (bk) { e.preventDefault(); history.back(); }
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
  spotify.finishLogin();
  let lastW = innerWidth; addEventListener('resize', debounce(() => { if (Math.abs(innerWidth - lastW) > 40) { lastW = innerWidth; route(); } }, 250));
  route();
}
init();
