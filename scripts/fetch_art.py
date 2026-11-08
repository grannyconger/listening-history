#!/usr/bin/env python3
"""Fetch cover art / artist images and save their URLs to docs/data/art.json.

Two modes:
  * Spotify Web API (preferred) - put SPOTIFY_CLIENT_ID and SPOTIFY_CLIENT_SECRET in a
    .env file at the repo root (it is git-ignored). Gets album covers, artist photos,
    podcast and audiobook art.
  * oEmbed fallback (no credentials) - album covers for the most-listened albums,
    podcast and audiobook art. No artist photos.

The script runs locally; secrets never reach the website. It is incremental: re-running
only fetches what is missing.   Usage: python3 scripts/fetch_art.py [--limit N] [--oembed]
"""
import json, os, sys, time, base64, urllib.request, urllib.parse, urllib.error, collections
from concurrent.futures import ThreadPoolExecutor

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = os.path.join(ROOT, 'docs', 'data')
ART = os.path.join(DATA, 'art.json')
args = sys.argv[1:]
LIMIT = int(args[args.index('--limit') + 1]) if '--limit' in args else 4000
FORCE_OEMBED = '--oembed' in args

def load_env():
    p = os.path.join(ROOT, '.env')
    if os.path.exists(p):
        for line in open(p):
            line = line.strip()
            if line and not line.startswith('#') and '=' in line:
                k, v = line.split('=', 1)
                os.environ.setdefault(k.strip(), v.strip().strip('"').strip("'"))
load_env()

lib = json.load(open(os.path.join(DATA, 'library.json')))
plays = json.load(open(os.path.join(DATA, 'plays.json')))
art = json.load(open(ART)) if os.path.exists(ART) else {}
for k in ('albums', 'artists', 'shows', 'books'):
    art.setdefault(k, {})

# listening seconds per album / track / show / book, to prioritise and pick representatives
album_secs, track_secs, show_secs, ep_secs, book_secs = (collections.Counter() for _ in range(5))
for k, i, s in zip(plays['k'], plays['i'], plays['s']):
    if k == 0:
        track_secs[i] += s; album_secs[lib['tracks'][i][2]] += s
    elif k == 1:
        ep_secs[i] += s; show_secs[lib['episodes'][i][1]] += s
    elif k == 2:
        book_secs[i] += s
rep_track = {}
for ti, s in track_secs.most_common():
    rep_track.setdefault(lib['tracks'][ti][2], ti)
rep_ep = {}
for ei, s in ep_secs.most_common():
    rep_ep.setdefault(lib['episodes'][ei][1], ei)

def save():
    art['updated'] = time.strftime('%Y-%m-%d')
    json.dump(art, open(ART, 'w'), separators=(',', ':'))

def get_json(url, headers=None, data=None, tries=5):
    for attempt in range(tries):
        req = urllib.request.Request(url, data=data, headers=headers or {})
        try:
            with urllib.request.urlopen(req, timeout=20) as r:
                return json.loads(r.read())
        except urllib.error.HTTPError as e:
            if e.code == 429:
                wait = int(e.headers.get('Retry-After', '5')) + 1
                print(f'  rate limited, waiting {wait}s'); time.sleep(wait); continue
            if e.code in (500, 502, 503, 504):
                time.sleep(2 ** attempt); continue
            raise
        except (urllib.error.URLError, TimeoutError):
            time.sleep(2 ** attempt)
    return None

def pick(images):
    if not images: return None
    imgs = sorted(images, key=lambda im: abs((im.get('width') or 300) - 300))
    return imgs[0]['url']

# ---------------- Web API mode ----------------
def api_mode(cid, secret):
    tok = get_json('https://accounts.spotify.com/api/token', data=b'grant_type=client_credentials',
                   headers={'Authorization': 'Basic ' + base64.b64encode(f'{cid}:{secret}'.encode()).decode(),
                            'Content-Type': 'application/x-www-form-urlencoded'})
    if not tok or 'access_token' not in tok:
        print('Could not get an access token - check the client ID/secret.'); return False
    H = {'Authorization': 'Bearer ' + tok['access_token']}

    def batch(endpoint, key, ids, extra=''):
        out = {}
        for j in range(0, len(ids), 50):
            chunk = ids[j:j + 50]
            try:
                res = get_json(f'https://api.spotify.com/v1/{endpoint}?ids={",".join(chunk)}{extra}', H)
                for obj in (res or {}).get(key, []):
                    if obj: out[obj['id']] = obj
            except urllib.error.HTTPError as e:
                if e.code in (403, 404):  # batch endpoint unavailable for this app -> single lookups
                    for one in chunk:
                        try:
                            obj = get_json(f'https://api.spotify.com/v1/{endpoint}/{one}?{extra.lstrip("&")}', H)
                            if obj: out[obj['id']] = obj
                        except urllib.error.HTTPError:
                            pass
                else:
                    raise
            if (j // 50) % 20 == 0:
                print(f'  {endpoint}: {min(j + 50, len(ids))}/{len(ids)}')
        return out

    # albums (+ artist ids) via one representative track per album
    todo = [a for a, _ in album_secs.most_common() if str(a) not in art['albums'] and a in rep_track]
    tid2album = {lib['tracks'][rep_track[a]][3]: a for a in todo}
    got = batch('tracks', 'tracks', list(tid2album))
    artist_ids = {}
    for tid, t in got.items():
        a = tid2album.get(tid)
        if a is None: continue
        url = pick(t.get('album', {}).get('images'))
        if url: art['albums'][str(a)] = url
        ai = lib['albums'][a][1]
        for ar in t.get('artists', []) + t.get('album', {}).get('artists', []):
            if ar.get('name') == lib['artists'][ai]:
                artist_ids.setdefault(ai, ar['id'])
    save()
    print(f'albums with art: {len(art["albums"])}')

    todo_ar = {ar_id: ai for ai, ar_id in artist_ids.items() if str(ai) not in art['artists']}
    got = batch('artists', 'artists', list(todo_ar))
    for ar_id, obj in got.items():
        url = pick(obj.get('images'))
        if url: art['artists'][str(todo_ar[ar_id])] = url
    save()
    print(f'artists with images: {len(art["artists"])}')

    todo_sh = {lib['episodes'][e][2]: s for s, e in rep_ep.items() if str(s) not in art['shows']}
    got = batch('episodes', 'episodes', list(todo_sh), '&market=US')
    for eid, obj in got.items():
        url = pick((obj.get('show') or {}).get('images') or obj.get('images'))
        if url: art['shows'][str(todo_sh[eid])] = url
    todo_bk = {lib['books'][b][1]: b for b in book_secs if str(b) not in art['books']}
    got = batch('audiobooks', 'audiobooks', list(todo_bk), '&market=US')
    for bid, obj in got.items():
        url = pick(obj.get('images'))
        if url: art['books'][str(todo_bk[bid])] = url
    save()
    print(f'shows: {len(art["shows"])}, books: {len(art["books"])}')
    art['source'] = 'Spotify Web API'
    return True

# ---------------- oEmbed mode ----------------
def oembed(kind, sid):
    u = 'https://open.spotify.com/oembed?url=' + urllib.parse.quote(f'https://open.spotify.com/{kind}/{sid}')
    try:
        res = get_json(u, {'User-Agent': 'listening-history-site/1.0'}, tries=3)
        return (res or {}).get('thumbnail_url')
    except urllib.error.HTTPError:
        return None

def oembed_mode():
    jobs = []
    for a, _ in album_secs.most_common(LIMIT):
        if str(a) not in art['albums'] and a in rep_track:
            jobs.append(('albums', a, 'track', lib['tracks'][rep_track[a]][3]))
    for s, e in rep_ep.items():
        if str(s) not in art['shows']:
            jobs.append(('shows', s, 'episode', lib['episodes'][e][2]))
    for b in book_secs:
        if str(b) not in art['books']:
            jobs.append(('books', b, 'audiobook', lib['books'][b][1]))
    print(f'oEmbed: {len(jobs)} lookups')
    done = 0
    with ThreadPoolExecutor(6) as ex:
        for (bucket, key, _, _), url in zip(jobs, ex.map(lambda j: oembed(j[2], j[3]), jobs)):
            if url: art[bucket][str(key)] = url
            done += 1
            if done % 250 == 0:
                print(f'  {done}/{len(jobs)}'); save()
    art.setdefault('source', 'Spotify oEmbed')
    save()
    print(f'albums: {len(art["albums"])}, shows: {len(art["shows"])}, books: {len(art["books"])}')

cid, secret = os.environ.get('SPOTIFY_CLIENT_ID'), os.environ.get('SPOTIFY_CLIENT_SECRET')
if cid and secret and not FORCE_OEMBED:
    print('Using Spotify Web API')
    if not api_mode(cid, secret):
        oembed_mode()
    else:
        oembed_mode()  # fills any gaps the API missed (e.g. region-locked items)
else:
    print('No SPOTIFY_CLIENT_ID/SECRET in .env - using oEmbed fallback')
    oembed_mode()
