#!/usr/bin/env python3
"""Find wake-up alarm songs: songs an Alexa / Google Home routine played as the first song of the morning.

For each local day, takes the first play that starts at or after 04:00. It looks like an alarm when it played
on a smart speaker (platform not reported, or Amazon Echo) and was started remotely (reason_start 'remote' or
'playbtn'), not by a tap on the phone. Those mornings are grouped by song into stretches (a gap of more than
GAP_DAYS days starts a new stretch). Read-only: prints a summary and writes candidates JSON.

Usage: python3 scripts/find_alarms.py [out.json]
"""
import json, glob, os, sys, collections, statistics
from datetime import datetime, timezone, timedelta
from zoneinfo import ZoneInfo

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
settings = json.load(open(os.path.join(ROOT, 'config', 'settings.json')))
raw_dir = os.path.join(ROOT, settings['raw_data_dir'])
HOME_TZ = ZoneInfo(settings['home_timezone'])
CTZ = {k: ZoneInfo(v) for k, v in settings['country_timezones'].items()}
VPN = set(settings.get('vpn_countries', []))
OUT = sys.argv[1] if len(sys.argv) > 1 else os.path.join(ROOT, 'alarm_candidates.json')
AFTER_MIN, GAP_DAYS, MIN_MORNINGS = 4 * 60, 45, 3
ALARM_REASONS = {'remote', 'playbtn'}

def speaker(platform):
    p = str(platform or '').lower()
    return 'Amazon Echo' if ('echo' in p or 'amazon' in p) else 'Smart speaker (not reported)' if p == 'not_applicable' else None

seen, recs = set(), []
for f in sorted(glob.glob(os.path.join(raw_dir, 'Streaming_History_*.json'))):
    for r in json.load(open(f, encoding='utf-8')):
        k = json.dumps(r, sort_keys=True)
        if k in seen:
            continue
        seen.add(k)
        ts = datetime.strptime(r['ts'], '%Y-%m-%dT%H:%M:%SZ').replace(tzinfo=timezone.utc)
        c = r['conn_country'] or 'ZZ'
        tz = HOME_TZ if c in ('US', 'ZZ') or c in VPN else CTZ.get(c, HOME_TZ)
        r['_l'] = (ts - timedelta(milliseconds=r['ms_played'] or 0)).astimezone(tz)
        recs.append(r)
recs.sort(key=lambda r: r['_l'])

first = {}
for r in recs:
    l = r['_l']
    if l.hour * 60 + l.minute >= AFTER_MIN and l.date() not in first:
        first[l.date()] = r

by_song = collections.defaultdict(list)
firsts_by_song = collections.Counter()
for d, r in first.items():
    if not r.get('spotify_track_uri'):
        continue
    key = (r['master_metadata_track_name'], r['master_metadata_album_artist_name'])
    firsts_by_song[key] += 1
    dev = speaker(r.get('platform'))
    if dev and r.get('reason_start') in ALARM_REASONS:
        by_song[key].append((d, r, dev))

cands = []
for (track, artist), rows in by_song.items():
    rows.sort(key=lambda x: x[0])
    groups = [[rows[0]]]
    for row in rows[1:]:
        (groups[-1].append(row) if (row[0] - groups[-1][-1][0]).days <= GAP_DAYS else groups.append([row]))
    for g in groups:
        if len(g) < MIN_MORNINGS:
            continue
        mins = [r['_l'].hour * 60 + r['_l'].minute for _, r, _ in g]
        times = collections.Counter(f'{m // 60:02d}:{m % 60:02d}' for m in mins)
        top_time, top_n = times.most_common(1)[0]
        span = (g[-1][0] - g[0][0]).days + 1
        cands.append({
            'track': track, 'artist': artist, 'from': g[0][0].isoformat(), 'to': g[-1][0].isoformat(),
            'mornings': len(g), 'span_days': span, 'typical_time': top_time,
            'median_time': (lambda m: f'{int(m) // 60:02d}:{int(m) % 60:02d}')(statistics.median(mins)),
            'same_minute_share': round(top_n / len(g), 2),
            'times': [t for t, _ in times.most_common(4)],
            'devices': dict(collections.Counter(dv for _, _, dv in g)),
            'dates': [d.isoformat() for d, _, _ in g],
            'all_first_plays_of_song': firsts_by_song[(track, artist)],
        })
for c in cands:
    density = c['mornings'] / c['span_days']
    c['strong'] = c['mornings'] >= 5 and (density >= 0.25 or c['same_minute_share'] >= 0.4)
cands.sort(key=lambda c: -c['mornings'])
json.dump({'generated': datetime.now(timezone.utc).isoformat(timespec='seconds'), 'candidates': cands},
          open(OUT, 'w'), indent=1, ensure_ascii=False)
alarm_days = sum(len(v) for v in by_song.values())
print(f'{len(first)} mornings, {alarm_days} look like alarms, {len(cands)} candidate stretches '
      f'({sum(c["strong"] for c in cands)} strong) -> {OUT}')
for c in cands[:25]:
    print(f"  {'*' if c['strong'] else ' '} {c['mornings']:>3}  {c['from']} – {c['to']}  {c['typical_time']}  {c['track']} — {c['artist']}")
