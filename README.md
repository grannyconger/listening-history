# Listening History

A static site for exploring a full Spotify Extended Streaming History export (2015 → today):
a story for every year, automatically found listening eras, lasting favorites and short obsessions,
rediscovery, seasonal binges, connections between artists (playlists from one artist to another, how you found
each favorite, bridge artists, similar artists you've never played), a searchable library, artist and song pages
(with "goes with" songs), and long-term patterns. Lists can be saved as Spotify playlists.

Everything runs in the browser from pre-built JSON in `docs/data/`. The site is served from `docs/` (GitHub Pages: *Settings → Pages → Deploy from branch → `main` / `docs`*).

## Layout

```
config/exclusions.json   rules that mark plays as "not personal listening"
config/settings.json     raw-data path, home timezone, VPN countries, privacy switches
scripts/build_data.py    raw export → docs/data/{meta,library,plays}.json
scripts/fetch_art.py     cover art / artist images → docs/data/art.json
scripts/fetch_similar.py ListenBrainz similar artists for your top artists → docs/data/similar.json
docs/                    the website (index.html, app.js, styles.css, data/)
```

## Rebuilding after a new export

1. Put the new `Spotify Extended Streaming History` folder next to this repo (or update `raw_data_dir` in `config/settings.json`).
2. `python3 scripts/build_data.py`
3. `python3 scripts/fetch_art.py` (incremental; only fetches what's missing)
4. Optional: `python3 scripts/fetch_similar.py` (incremental; MusicBrainz allows 1 request a second, so a first run of 200 artists takes about 10 minutes)
5. Preview: `cd docs && python3 -m http.server 8000 --bind 127.0.0.1` → http://127.0.0.1:8000 (use 127.0.0.1, not localhost, so Spotify login works)
6. Commit and push.

## Cleaning applied by the build

- **Exact duplicate records** (identical in every field) are removed.
- **Same song, different release**: plays of the same title by the same artist are merged into one song.
- **VPN**: plays logged in `vpn_countries` (Japan, Romania, Poland) are treated as home listening and kept out of trips.
- **Times** are local: home timezone for US/VPN/unknown plays, the country's timezone on trips. Spotify stamps each stream when it *ended*; start times are back-calculated.

## Exclusion rules

`config/exclusions.json` lists rules (artist names, track/album/show regexes, optional weekday + time window).
Each rule's `enabled` flag sets the site default; viewers can toggle rules in the **Exclusions** panel and turn
all of them off with **Personal only**. The **Excluded plays** page (`#/excluded`) shows what each rule removes.
Edit the file and re-run `build_data.py` to add or change rules.

## Privacy

The published data includes every track, podcast and audiobook played, with timestamps and the exclusion-rule
flags. It does **not** include IP addresses, usernames, devices, countries, trips or offline timestamps.
To publish country/trip or device data again, set `publish_countries` / `publish_devices` to `true` in
`config/settings.json` (the site's Places and Devices pages were removed and would need restoring).

The repository and the GitHub Pages site are public. The page asks search engines not to index it.

## Design

The site follows a calm, presenter-style rule set: no cards, boxes, pills or gradients, square corners, big type and
white space. Colors keep one meaning everywhere (blue music, orange podcasts, green audiobooks, red excluded), and
shading appears only inside heatmaps.

## Cover art

`scripts/fetch_art.py` uses the Spotify Web API when `SPOTIFY_CLIENT_ID` and `SPOTIFY_CLIENT_SECRET` are set in a
git-ignored `.env` file (see `.env.example`); otherwise it falls back to Spotify's public oEmbed endpoint
(album/podcast/audiobook art, no artist photos). Secrets are only used locally; the site just stores image URLs.

## Save as a Spotify playlist

Playlist lists (eras, binges, forgotten favorites, "goes with", artist-to-artist paths, lifecycles) have a
**Save as a Spotify playlist** button. It logs in with Spotify using Authorization Code with PKCE, so only the
public Client ID is needed. `build_data.py` copies `SPOTIFY_CLIENT_ID` from `.env` into `meta.json`; the Client
Secret is never published. In the Spotify developer dashboard the app needs these Redirect URIs:
`https://grannyconger.github.io/listening-history/` and `http://127.0.0.1:8000/`. In Spotify's Development Mode only
accounts added to the app (up to 5) can save; others see a message and can still use **Copy song links**.
The login is stored in the viewer's browser, and Spotify asks again after its refresh token expires.

## Similar artists

`scripts/fetch_similar.py` matches each top artist to a MusicBrainz ID (exact name, high score only), asks
ListenBrainz's experimental similar-artists dataset for neighbours, and adds Deezer photos for artists you have
never played. The site uses it for **You might like** (Connections) and **Similar artists** (artist pages). No
Spotify API data is used for recommendations.
