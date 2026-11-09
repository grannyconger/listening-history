#!/usr/bin/env python3
"""Fetch similar artists for your top artists from ListenBrainz (open data, no login).

Steps for each of your top artists (by hours, with the default filters on):
  1. Find the artist's MusicBrainz ID (MBID). Only an exact name match with a high
     search score is accepted, so a few artists stay unmatched rather than mismatched.
  2. Ask ListenBrainz for similar artists (an experimental, session-based dataset).
  3. For similar artists you have never played, look up a photo on Deezer (exact name match).

Writes docs/data/similar.json. Re-runs only look up artists not already in the file.
Read only by the browser. build_data.py never reads it.

Usage:  python3 scripts/fetch_similar.py [how_many_top_artists, default 200]
"""
import json, os, sys, time, re, unicodedata, urllib.parse, urllib.request, urllib.error

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = os.path.join(ROOT, 'docs', 'data')
OUT = os.path.join(DATA, 'similar.json')
TOP = int(sys.argv[1]) if len(sys.argv) > 1 else 200
KEEP = 25  # similar artists kept per artist
UA = 'ListeningHistory/1.0 (https://github.com/grannyconger/listening-history)'
LB_ALGO = 'session_based_days_7500_session_300_contribution_5_threshold_10_limit_100_filter_True_skip_30'


def norm(s):
    s = unicodedata.normalize('NFKD', str(s or '')).encode('ascii', 'ignore').decode().casefold()
    s = s.replace('&', 'and')
    return re.sub(r'[^a-z0-9]+', '', s)


def get_json(url, tries=4):
    for i in range(tries):
        try:
            req = urllib.request.Request(url, headers={'User-Agent': UA, 'Accept': 'application/json'})
            with urllib.request.urlopen(req, timeout=30) as r:
                return json.load(r)
        except urllib.error.HTTPError as e:
            if e.code in (429, 503) and i < tries - 1:
                time.sleep(2 * (i + 1)); continue
            if e.code == 404:
                return None
            raise
        except (urllib.error.URLError, TimeoutError):
            if i < tries - 1:
                time.sleep(2 * (i + 1)); continue
            raise


_last = {}
def throttle(key, gap):
    now = time.time()
    wait = _last.get(key, 0) + gap - now
    if wait > 0: time.sleep(wait)
    _last[key] = time.time()


def mb_artist(name):
    """MusicBrainz search, exact normalised name and score >= 90 only."""
    throttle('mb', 1.1)  # MusicBrainz asks for at most 1 request per second
    q = urllib.parse.quote(f'artist:"{name}"')
    res = get_json(f'https://musicbrainz.org/ws/2/artist/?query={q}&fmt=json&limit=5') or {}
    target = norm(name)
    for a in res.get('artists', []):
        if a.get('score', 0) >= 90 and (norm(a.get('name')) == target or any(norm(al.get('name')) == target for al in a.get('aliases', []) if al.get('primary'))):
            return a['id']
    return None


def lb_similar(mbid):
    throttle('lb', 0.5)
    res = get_json(f'https://labs.api.listenbrainz.org/similar-artists/json?artist_mbids={mbid}&algorithm={LB_ALGO}') or []
    return [[r['name'], r['artist_mbid'], r.get('score', 0)] for r in res
            if r.get('artist_mbid') != mbid and not re.match(r'^\[.*\]$', r.get('name', ''))][:KEEP]  # skip [theatre], [unknown]


def deezer_photo(name):
    throttle('dz', 0.15)
    try:
        res = get_json('https://api.deezer.com/search/artist?limit=10&q=' + urllib.parse.quote(f'artist:"{name}"')) or {}
    except urllib.error.HTTPError:
        return None
    for a in res.get('data', []):
        pic = a.get('picture_big') or a.get('picture_medium')
        if norm(a.get('name')) == norm(name) and pic and '/artist//' not in pic:
            return pic
    return None


def top_artists():
    meta = json.load(open(os.path.join(DATA, 'meta.json')))
    lib = json.load(open(os.path.join(DATA, 'library.json')))
    pl = json.load(open(os.path.join(DATA, 'plays.json')))
    mask = 0
    for r in meta['rules']:
        if r['enabled']: mask |= 1 << r['bit']
    secs = {}
    for k, i, s, x in zip(pl['k'], pl['i'], pl['s'], pl['x']):
        if k != 0 or (x & mask): continue
        a = lib['tracks'][i][1]
        secs[a] = secs.get(a, 0) + s
    order = sorted(secs, key=lambda a: -secs[a])
    return lib, order


def main():
    lib, order = top_artists()
    out = json.load(open(OUT)) if os.path.exists(OUT) else {}
    out.setdefault('artists', {}); out.setdefault('nomatch', {}); out.setdefault('photos', {})
    known = {norm(n) for n in lib['artists']}
    todo = [a for a in order[:TOP] if str(a) not in out['artists'] and str(a) not in out['nomatch']]
    print(f'ListenBrainz: {len(todo)} of your top {TOP} artists to look up')

    def save():
        out['source'] = 'ListenBrainz similar artists (labs.api.listenbrainz.org), MusicBrainz IDs, Deezer photos'
        out['algorithm'] = LB_ALGO
        out['updated'] = time.strftime('%Y-%m-%d')
        tmp = OUT + '.tmp'
        with open(tmp, 'w') as f: json.dump(out, f, ensure_ascii=False, separators=(',', ':'))
        os.replace(tmp, OUT)

    for n, a in enumerate(todo, 1):
        name = lib['artists'][a]
        try:
            mbid = mb_artist(name)
            if not mbid:
                out['nomatch'][str(a)] = 1; continue
            sim = lb_similar(mbid)
            out['artists'][str(a)] = {'mbid': mbid, 'similar': sim}
        except Exception as e:  # keep going, the next run retries this artist
            print(f'  {name}: {e}')
        if n % 20 == 0:
            print(f'  {n}/{len(todo)}'); save()
    save()

    # photos for similar artists you have never played
    unknown = {}
    for v in out['artists'].values():
        for nm, mb, _ in v['similar']:
            if norm(nm) not in known and mb not in out['photos']: unknown[mb] = nm
    print(f'Deezer: {len(unknown)} new-artist photos to look up')
    for n, (mb, nm) in enumerate(unknown.items(), 1):
        out['photos'][mb] = deezer_photo(nm) or ''
        if n % 100 == 0: print(f'  {n}/{len(unknown)}'); save()
    save()
    print(f'Done: {len(out["artists"])} artists with similar artists, {len(out["nomatch"])} without a confident match')


if __name__ == '__main__':
    main()
