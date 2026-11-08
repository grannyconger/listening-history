#!/usr/bin/env python3
"""Look up each artist's primary genre in Apple's public iTunes Search API (no key needed).

Used as evidence when tagging artists as Christian or instrumental (config/artist_tags.json).
Results are cached in config/artist_genres.json, so re-runs only look up new artists.
Apple rate-limits this API (~20 requests/minute), so a full run is slow; it runs fine in the background.

Usage: python3 scripts/tag_artists.py [--min-minutes 30]
"""
import json, os, re, sys, time, unicodedata, urllib.request, urllib.parse, urllib.error, collections

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, 'config', 'artist_genres.json')
args = sys.argv[1:]
MIN_SECS = 60 * (int(args[args.index('--min-minutes') + 1]) if '--min-minutes' in args else 30)

lib = json.load(open(os.path.join(ROOT, 'docs', 'data', 'library.json')))
plays = json.load(open(os.path.join(ROOT, 'docs', 'data', 'plays.json')))
secs = collections.Counter()
for k, i, s in zip(plays['k'], plays['i'], plays['s']):
    if k == 0:
        secs[lib['tracks'][i][1]] += s
cache = json.load(open(OUT)) if os.path.exists(OUT) else {}

def norm(s):
    s = unicodedata.normalize('NFKD', s or '').encode('ascii', 'ignore').decode().casefold().replace('&', 'and')
    return re.sub(r'[^a-z0-9]', '', re.sub(r'^the ', '', s))

def lookup(name):
    url = 'https://itunes.apple.com/search?' + urllib.parse.urlencode({'term': name, 'entity': 'musicArtist', 'limit': 10})
    for attempt in range(6):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers={'User-Agent': 'listening-history-site/1.0'}), timeout=20) as r:
                res = json.loads(r.read())
            break
        except urllib.error.HTTPError as e:
            if e.code in (403, 429, 503):
                time.sleep(60); continue
            return None
        except Exception:
            time.sleep(10)
    else:
        return None
    hits = [r.get('primaryGenreName') for r in res.get('results', []) if norm(r.get('artistName')) == norm(name)]
    return hits[0] if hits else ''

todo = [a for a, s in secs.most_common() if s >= MIN_SECS and lib['artists'][a] not in cache]
print(f'{len(todo)} artists to look up')
for n, a in enumerate(todo, 1):
    name = lib['artists'][a]
    g = lookup(name)
    if g is not None:
        cache[name] = g
    if n % 25 == 0 or n == len(todo):
        json.dump(cache, open(OUT, 'w'), indent=0, ensure_ascii=False, sort_keys=True)
        print(f'  {n}/{len(todo)}', flush=True)
    time.sleep(3.1)
print('done')
