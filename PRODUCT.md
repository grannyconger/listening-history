# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users
The owner (a teacher who has used Spotify since 2015) and the friends and family they share the link with. Visitors arrive with no background: they don't know the data or the vocabulary of a streaming export. Used equally on phones and computers.

## Product Purpose
A personal "music life" site built from the owner's full Spotify Extended Streaming History (about 249,000 plays, 2015 to today). Its jobs, in order of how often they matter:
1. Rediscover songs: remember what the owner loved in a season or year, and find songs worth playing again.
2. See the big picture: how taste, habits and favorite artists changed over a decade.
3. Show it off: a shareable story that friends and family can read in a few minutes, like a Wrapped for every year.
Success: a visitor can follow the story without help, and the owner keeps finding songs to play again.

## Positioning
Unlike Spotify Wrapped (one year, Spotify's framing), this covers every year since 2015, is cleaned to reflect real personal listening, and lets the owner decide what counts.

## Operating Context
Static site on GitHub Pages (public, `noindex`). Data is pre-built JSON from `scripts/build_data.py`; cover art from `scripts/fetch_art.py`. Spotify embeds can play songs in the page.

## Capabilities and Constraints
- "Personal listening" filter: exclusion rules remove classroom music, novelty and game-show songs, kids songs, sleep sounds, and songs that kept playing while the owner was asleep. Viewers can toggle rules.
- Planned: filters to leave out Christian artists and instrumental artists (artist tagging in progress, owner confirms uncertain artists).
- Removed by the owner: Places, Devices and Calendar pages. Location, device and IP data are never published.
- Same song across releases counts as one song. Exact duplicate records are removed.

## Brand Commitments
The owner's design rules (written for classroom slides) are binding for this site:
- Simple, presenter-style, calm and bright. Big text, plenty of open space, one idea per section.
- Small, subtle color on major elements, with each color tied to one idea and used the same way everywhere.
- Plain, direct language for readers with no background knowledge. Labels give information or instructions, never summaries. No taglines or slogans. No em dashes or semicolons.
- Avoid: tags and pills, excessive italics, Instrument Serif, negative letter spacing, over-detailed UI, overused dividers, color shades and opacities (tinted boxes, faded colors), containers with borders, overly detailed diagrams, verbose text, code breadcrumbs, section numbering, eyebrows, dithering, ASCII images, squircles, excessive mono fonts, ALL CAPS subtitles, gradient backgrounds, periods in titles.
- Exception confirmed by the owner: heatmaps may use light-to-dark shading because it carries data.

## Evidence on Hand
Real data only: `docs/data/*.json` (plays, library, rules), `docs/data/art.json` (album covers, artist photos). No invented stats or quotes.

## Product Principles
1. Songs first: every view should make it easy to see and play the music, not just numbers.
2. Tell the story, then let people dig: lead with the finding in plain words, with detail one step away.
3. The owner decides what counts: filters are honest and visible, and their effect is shown.
4. Calm over clever chrome: cleverness lives in how things connect (song to year to artist), not in decoration.
