#!/usr/bin/env python3
"""Build the site's data files from Spotify Extended Streaming History exports.

Reads the raw JSON export (never committed), removes exact duplicate records,
detects VPN-sourced country codes, converts times to local wall-clock time,
applies the exclusion rules in config/exclusions.json, strips private fields
(IP addresses, device serials, offline timestamps), and writes compact JSON to
docs/data/.

Usage:  python3 scripts/build_data.py [raw_data_dir]
"""
import json, glob, os, re, sys, collections
from datetime import datetime, timezone, timedelta
from zoneinfo import ZoneInfo

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, 'docs', 'data')
settings = json.load(open(os.path.join(ROOT, 'config', 'settings.json')))
rules_cfg = json.load(open(os.path.join(ROOT, 'config', 'exclusions.json')))['rules']
raw_dir = sys.argv[1] if len(sys.argv) > 1 else os.path.join(ROOT, settings['raw_data_dir'])
HOME_TZ = ZoneInfo(settings['home_timezone'])
CTZ = {k: ZoneInfo(v) for k, v in settings['country_timezones'].items()}
COUNTRIES = {  # iso2: (name, iso numeric for the world map)
    'US': ('United States', 840), 'BS': ('Bahamas', 44), 'BZ': ('Belize', 84), 'MX': ('Mexico', 484),
    'CR': ('Costa Rica', 188), 'IS': ('Iceland', 352), 'PA': ('Panama', 591), 'BB': ('Barbados', 52),
    'JP': ('Japan', 392), 'RO': ('Romania', 642), 'PL': ('Poland', 616), 'ZZ': ('Unknown', None)}
EPOCH = datetime(1970, 1, 1, tzinfo=timezone.utc)

# ---------- load + exact de-duplication ----------
files = sorted(glob.glob(os.path.join(raw_dir, 'Streaming_History_*.json')))
if not files:
    sys.exit(f'No Streaming_History_*.json files found in {raw_dir}')
seen, recs, dupes = set(), [], 0
for f in files:
    is_video = 'Video' in os.path.basename(f)
    for r in json.load(open(f, encoding='utf-8')):
        key = json.dumps(r, sort_keys=True)
        if key in seen:
            dupes += 1
            continue
        seen.add(key)
        r['_video'] = is_video
        ts = datetime.strptime(r['ts'], '%Y-%m-%dT%H:%M:%SZ').replace(tzinfo=timezone.utc)
        r['_start'] = ts - timedelta(milliseconds=r['ms_played'] or 0)
        recs.append(r)
recs.sort(key=lambda r: r['_start'])
print(f'{len(files)} files, {len(recs) + dupes} records, {dupes} exact duplicates removed -> {len(recs)}')

# ---------- VPN detection ----------
vcfg = settings['vpn_detection']
VPN_COUNTRIES = set(settings.get('vpn_countries', []))
win, maxrun = timedelta(minutes=vcfg['window_minutes']), timedelta(hours=vcfg['max_run_hours'])
us_times = [r['_start'] for r in recs if r['conn_country'] == 'US']
import bisect
i, n = 0, len(recs)
vpn_runs = []
while i < n:
    c = recs[i]['conn_country']
    if c in ('US', 'ZZ', None):
        i += 1; continue
    j = i
    while j + 1 < n and recs[j + 1]['conn_country'] == c:
        j += 1
    a, b = recs[i]['_start'], recs[j]['_start']
    k = bisect.bisect_left(us_times, a)
    before = us_times[k - 1] if k > 0 else None
    after = us_times[bisect.bisect_right(us_times, b)] if bisect.bisect_right(us_times, b) < len(us_times) else None
    is_vpn = c in VPN_COUNTRIES or (vcfg.get('auto') and before is not None and after is not None
                                    and a - before <= win and after - b <= win and b - a <= maxrun)
    for r in recs[i:j + 1]:
        r['_vpn'] = is_vpn
    if is_vpn:
        vpn_runs.append({'country': c, 'start': a.isoformat(), 'plays': j - i + 1})
    i = j + 1
print('VPN runs:', collections.Counter(v['country'] for v in vpn_runs))

# ---------- dictionaries ----------
artists, albums, tracks, shows, episodes, books = {}, {}, {}, {}, {}, {}
L = {'artists': [], 'albums': [], 'tracks': [], 'shows': [], 'episodes': [], 'books': []}
def idx(d, lst, key, val):
    if key not in d:
        d[key] = len(lst); lst.append(val)
    return d[key]

def device(p):
    p = str(p or '')
    m = re.search(r'\((iPhone|iPad|iPod)(\d+),(\d+)\)', p)
    models = {'iPhone5,3': 'iPhone 5c', 'iPhone9,2': 'iPhone 7 Plus', 'iPhone12,1': 'iPhone 11',
              'iPhone9,1': 'iPhone 7', 'iPhone10,3': 'iPhone X'}
    if m:
        code = f'{m.group(1)}{m.group(2)},{m.group(3)}'
        return models.get(code, f'{m.group(1)} ({code})')
    pl = p.lower()
    for pat, name in [(r'^ios$', 'iPhone (model not reported)'), (r'os x|osx|macos', 'Mac'), (r'windows', 'Windows PC'),
                      (r'android', 'Android'), (r'garmin', 'Garmin watch'), (r'webos_tv|lg;', 'LG TV'),
                      (r'apple_tv', 'Apple TV'), (r'cast_tv|chromecast|^cast$', 'Chromecast / Cast'),
                      (r'sonos', 'Sonos'), (r'savant', 'Savant audio'), (r'echo|alexa|amazon', 'Amazon Echo'),
                      (r'web_player|web player', 'Web player'), (r'playstation|ps4|ps5', 'PlayStation'),
                      (r'xbox', 'Xbox'), (r'tv', 'TV'), (r'not_applicable', 'Not reported'), (r'unknown', 'Not reported')]:
        if re.search(pat, pl):
            return name
    return 'Other'

# ---------- exclusion rules ----------
rules = []
for bit, rc in enumerate(rules_cfg):
    w = rc.get('when')
    rules.append({**rc, 'bit': bit,
                  '_tr': re.compile(rc['track_regex'], re.I) if rc.get('track_regex') else None,
                  '_al': re.compile(rc['album_regex'], re.I) if rc.get('album_regex') else None,
                  '_sh': re.compile(rc['show_regex'], re.I) if rc.get('show_regex') else None,
                  '_ar': set(rc.get('artists', [])),
                  '_days': set(w['days']) if w else None,
                  '_t0': int(w['start'][:2]) * 60 + int(w['start'][3:]) if w else None,
                  '_t1': int(w['end'][:2]) * 60 + int(w['end'][3:]) if w else None})
assert len(rules) <= 30

def tz_for(r):
    c = r['conn_country'] or 'ZZ'
    return HOME_TZ if (c in ('US', 'ZZ') or r.get('_vpn')) else CTZ.get(c, HOME_TZ)

# ---------- "playing while asleep" detection (rules with "type": "overnight") ----------
# A "touch" is anything the listener did: picking a song, play button, skip, back, Connect remote,
# opening the app. A play is "asleep" when it started on its own during a stretch where the
# listener stopped touching Spotify late at night and didn't touch it again until the morning.
USER_STARTS = {'clickrow', 'fwdbtn', 'backbtn', 'playbtn', 'remote', 'appload'}
USER_ENDS = {'fwdbtn', 'backbtn'}
def hm(s): return int(s[:2]) * 60 + int(s[3:])
touches = sorted([r['_start'] for r in recs if r.get('reason_start') in USER_STARTS] +
                 [datetime.strptime(r['ts'], '%Y-%m-%dT%H:%M:%SZ').replace(tzinfo=timezone.utc)
                  for r in recs if r.get('reason_end') in USER_ENDS])
for ru in rules:
    if ru.get('type') != 'overnight':
        continue
    p = {'grace_minutes': 30, 'counts_from': '23:00', 'last_touch_before': '04:00', 'next_touch_after': '05:00',
         'min_untouched_hours': 3, 'stops_at': '09:00', **ru.get('params', {})}
    grace, min_gap = timedelta(minutes=p['grace_minutes']), timedelta(hours=p['min_untouched_hours'])
    for r in recs:
        if r.get('reason_start') in USER_STARTS:
            continue  # the listener started this one, so they were awake
        s = r['_start']; k = bisect.bisect_right(touches, s)
        if k == 0 or k >= len(touches):
            continue
        last, nxt = touches[k - 1], touches[k]
        tz = tz_for(r); ls = s.astimezone(tz)
        night = (ls - timedelta(hours=12)).date()  # evening this play's night started on
        at = lambda hhmm, day_off: datetime(night.year, night.month, night.day, tzinfo=tz) + timedelta(days=day_off, minutes=hm(hhmm))
        start_of_night = at(p['counts_from'], 0) if hm(p['counts_from']) >= 12 * 60 else at(p['counts_from'], 1)
        if (last <= at(p['last_touch_before'], 1) and nxt >= at(p['next_touch_after'], 1) and nxt - last >= min_gap
                and s >= start_of_night and s >= last + grace and s < nxt and s < at(p['stops_at'], 1)):
            r.setdefault('_overnight', set()).add(ru['id'])

def rule_mask(r, local):
    mask = 0
    tn, ar, al = r.get('master_metadata_track_name') or '', r.get('master_metadata_album_artist_name') or '', r.get('master_metadata_album_album_name') or ''
    sh = r.get('episode_show_name') or ''
    for ru in rules:
        if ru.get('type') == 'overnight':
            if ru['id'] in r.get('_overnight', ()):
                mask |= 1 << ru['bit']
            continue
        hit = (ar in ru['_ar']) or (ru['_tr'] and ru['_tr'].search(tn)) or (ru['_al'] and ru['_al'].search(al)) \
            or (ru['_sh'] and ru['_sh'].search(sh)) or (ru['_tr'] and r.get('episode_name') and ru['_tr'].search(r['episode_name']))
        if hit and ru['_days'] is not None:
            mins = local.hour * 60 + local.minute
            hit = local.weekday() in ru['_days'] and ru['_t0'] <= mins < ru['_t1']
        if hit:
            mask |= 1 << ru['bit']
    return mask

# ---------- encode plays ----------
REASONS, DEVICES, CTRY = [], [], []
def enum(lst, v):
    if v not in lst: lst.append(v)
    return lst.index(v)

cols = {k: [] for k in ('t', 's', 'k', 'i', 'c', 'd', 'rs', 're', 'f', 'x')}
rule_hits = collections.Counter(); rule_secs = collections.Counter()
prev_t = 0
for r in recs:
    c = r['conn_country'] or 'ZZ'
    vpn = r.get('_vpn', False)
    local = r['_start'].astimezone(tz_for(r))
    wall = int((local.replace(tzinfo=timezone.utc) - EPOCH).total_seconds())
    if r.get('audiobook_uri'):
        kind = 2; it = idx(books, L['books'], r['audiobook_uri'], [r.get('audiobook_title') or '?', r['audiobook_uri'].split(':')[-1]])
    elif r.get('spotify_episode_uri'):
        kind = 1
        si = idx(shows, L['shows'], r.get('episode_show_name') or '?', r.get('episode_show_name') or '?')
        it = idx(episodes, L['episodes'], r['spotify_episode_uri'], [r.get('episode_name') or '?', si, r['spotify_episode_uri'].split(':')[-1]])
    elif r.get('spotify_track_uri'):
        kind = 0
        an = r.get('master_metadata_album_artist_name') or '?'
        ai = idx(artists, L['artists'], an, an)
        ali = idx(albums, L['albums'], (r.get('master_metadata_album_album_name') or '?', ai), [r.get('master_metadata_album_album_name') or '?', ai])
        # Same song title by the same artist = one song, even across releases/compilations with different URIs.
        tname = r.get('master_metadata_track_name') or '?'
        it = idx(tracks, L['tracks'], (tname.casefold().strip(), ai), [tname, ai, ali, r['spotify_track_uri'].split(':')[-1]])
    else:
        kind, it = 3, -1
    flags = (1 if r.get('shuffle') else 0) | (2 if r.get('skipped') else 0) | (4 if r.get('offline') else 0) \
        | (8 if r.get('incognito_mode') else 0) | (32 if r['_video'] else 0)  # bit 16 (VPN) deliberately not published
    x = rule_mask(r, local)
    for ru in rules:
        if x >> ru['bit'] & 1:
            rule_hits[ru['id']] += 1; rule_secs[ru['id']] += (r['ms_played'] or 0) / 1000
    cols['t'].append(wall - prev_t); prev_t = wall
    cols['s'].append(round((r['ms_played'] or 0) / 1000))
    cols['k'].append(kind); cols['i'].append(it)
    cols['c'].append(enum(CTRY, c)); cols['d'].append(enum(DEVICES, device(r.get('platform'))))
    cols['rs'].append(enum(REASONS, r.get('reason_start') or 'unknown')); cols['re'].append(enum(REASONS, r.get('reason_end') or 'unknown'))
    cols['f'].append(flags); cols['x'].append(x)
    r['_wall'] = wall; r['_c'] = c

# ---------- trips (real, non-VPN, known foreign countries) ----------
trips = []
foreign = [r for r in recs if r['_c'] not in ('US', 'ZZ') and not r.get('_vpn')]
by_c = collections.defaultdict(list)
for r in foreign: by_c[r['_c']].append(r)
for c, rs in by_c.items():
    group = [rs[0]]
    for r in rs[1:] + [None]:
        if r is not None and (r['_start'] - group[-1]['_start']) <= timedelta(days=3):
            group.append(r); continue
        top = collections.Counter()
        for g in group:
            if g.get('master_metadata_album_artist_name'): top[g['master_metadata_album_artist_name']] += g['ms_played']
        s0 = datetime.fromtimestamp(group[0]['_wall'], timezone.utc); s1 = datetime.fromtimestamp(group[-1]['_wall'], timezone.utc)
        ndays = (s1.date() - s0.date()).days + 1
        m0, m1 = s0.strftime('%b %Y'), s1.strftime('%b %Y')
        period = m0 if m0 == m1 else (f"{s0.strftime('%b')} – {m1}" if s0.year == s1.year else f'{m0} – {m1}')
        length = 'a day' if ndays <= 1 else 'a few days' if ndays <= 4 else 'about a week' if ndays <= 10 else 'a couple of weeks' if ndays <= 21 else 'about a month'
        trips.append({'country': c, 'name': COUNTRIES.get(c, (c,))[0], '_sort': group[0]['_wall'],
                      'period': period, 'year': s0.year, 'length': length,
                      'hours': round(sum(g['ms_played'] for g in group) / 3.6e6, 1),
                      'top': [a for a, _ in top.most_common(3)]})
        if r is not None: group = [r]
trips = [t for t in trips if t['hours'] >= 0.1]  # drop stray single plays
trips.sort(key=lambda t: t['_sort'])
for t in trips: del t['_sort']

# Country totals, keyed by exclusion mask so the site can still honour the rule toggles
# without a per-play country column (which would reveal exact travel dates).
country_secs = collections.defaultdict(lambda: collections.defaultdict(float))
for r, x in zip(recs, cols['x']):
    key = 'VPN' if r.get('_vpn') else r['_c']
    country_secs[key][str(x)] += (r['ms_played'] or 0) / 1000
country_secs = {c: {m: round(s) for m, s in d.items()} for c, d in country_secs.items()}

# ---------- write ----------
os.makedirs(OUT, exist_ok=True)
def dump(name, obj):
    p = os.path.join(OUT, name)
    with open(p, 'w', encoding='utf-8') as fh:
        json.dump(obj, fh, ensure_ascii=False, separators=(',', ':'))
    print(f'  wrote {name}: {os.path.getsize(p) / 1e6:.2f} MB')

meta = {
    'generated': datetime.now(timezone.utc).isoformat(timespec='seconds'),
    'home_timezone': settings['home_timezone'],
    'records_raw': len(recs) + dupes, 'duplicates_removed': dupes, 'records': len(recs),
    'reasons': REASONS,
    'rules': [{'id': ru['id'], 'label': ru['label'], 'description': ru.get('description', ''), 'enabled': ru['enabled'],
               'bit': ru['bit'], 'plays': rule_hits[ru['id']], 'hours': round(rule_secs[ru['id']] / 3600, 1)} for ru in rules],
}
if settings.get('publish_countries'):
    meta['countries'] = [{'code': c, 'name': COUNTRIES.get(c, (c,))[0], 'iso_n': COUNTRIES.get(c, (c, None))[1]} for c in CTRY]
    meta['vpn_runs'] = [{'country': v['country'], 'plays': v['plays'],
                         'month': datetime.fromisoformat(v['start']).strftime('%b %Y')} for v in vpn_runs]
    meta['trips'] = trips
    meta['country_secs'] = country_secs
if settings.get('publish_devices'):
    meta['devices'] = DEVICES
else:
    del cols['d']
# Never publish a per-play country: combined with timestamps it pinpoints travel dates.
del cols['c']
dump('meta.json', meta)
dump('library.json', L)
dump('plays.json', cols)
for ru in meta['rules']:
    print(f"  rule {ru['id']:<20} enabled={ru['enabled']!s:<5} plays={ru['plays']:<6} hours={ru['hours']}")
