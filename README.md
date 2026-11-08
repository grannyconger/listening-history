# Listening History

A static site for exploring a full Spotify Extended Streaming History export (2015 → today):
overview, Wrapped for any year, calendar heatmap, searchable library, artist and song pages,
trends and an artist race, on-this-day, habits, sessions, discovery, podcasts and audiobooks, and a cover wall.

Everything runs in the browser from pre-built JSON in `docs/data/`. The site is served from `docs/` (GitHub Pages: *Settings → Pages → Deploy from branch → `main` / `docs`*).

## Layout

```
config/exclusions.json   rules that mark plays as "not personal listening"
config/settings.json     raw-data path, home timezone, VPN countries, privacy switches
scripts/build_data.py    raw export → docs/data/{meta,library,plays}.json
scripts/fetch_art.py     cover art / artist images → docs/data/art.json
docs/                    the website (index.html, app.js, styles.css, data/)
```

## Rebuilding after a new export

1. Put the new `Spotify Extended Streaming History` folder next to this repo (or update `raw_data_dir` in `config/settings.json`).
2. `python3 scripts/build_data.py`
3. `python3 scripts/fetch_art.py` (incremental; only fetches what's missing)
4. Preview: `cd docs && python3 -m http.server 8000` → http://localhost:8000
5. Commit and push.

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
