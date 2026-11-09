---
name: Listening History
description: Ten years of Spotify listening, laid out as a music yearbook.
colors:
  yearbook-navy: "#1d2a5b"
  school-gold: "#f2b632"
  gold-ink: "#8a5f00"
  paper: "#ffffff"
  paper-shade: "#f5f3ec"
  ink: "#16130f"
  ink-secondary: "#4d4a45"
  ink-muted: "#6e6a63"
  masthead-muted: "#c3cbe6"
  grid-line: "#e7e4dc"
  axis-line: "#c9c4b8"
  podcast-orange: "#e0662e"
  audiobook-green: "#1f9a6c"
  heat-0: "#f1efe8"
  heat-1: "#dfe3f0"
  heat-2: "#b9c3e0"
  heat-3: "#8796c7"
  heat-4: "#5568a8"
  heat-5: "#34458a"
  heat-6: "#1d2a5b"
  night-page: "#0f1530"
  night-paper-shade: "#151c3c"
  night-surface: "#19214a"
  night-ink: "#f4f1e8"
  night-ink-secondary: "#c4c8da"
  night-ink-muted: "#969cb6"
  night-navy: "#9fb2f0"
  night-gold-ink: "#f2c75a"
  night-masthead: "#0a0f24"
  night-masthead-muted: "#a7aecb"
  night-grid-line: "#252d55"
  night-axis-line: "#3b4475"
  night-series-navy: "#8ea3ec"
  night-podcast-orange: "#e57a45"
  night-audiobook-green: "#2fb584"
  night-heat-0: "#18204a"
  night-heat-1: "#1f2d66"
  night-heat-2: "#2b3f88"
  night-heat-3: "#3f58ab"
  night-heat-4: "#6079c7"
  night-heat-5: "#93a7e3"
  night-heat-6: "#d3dcf8"
typography:
  year-numeral:
    fontFamily: "Alfa Slab One, Rockwell, serif"
    fontSize: "clamp(96px, 13vw, 168px)"
    fontWeight: 400
    lineHeight: 0.82
    fontFeature: "tnum"
  display:
    fontFamily: "Alfa Slab One, Rockwell, serif"
    fontSize: "clamp(44px, 7vw, 96px)"
    fontWeight: 400
    lineHeight: 0.98
  headline:
    fontFamily: "Alfa Slab One, Rockwell, serif"
    fontSize: "clamp(40px, 5vw, 64px)"
    fontWeight: 400
    lineHeight: 1.12
  title:
    fontFamily: "Alfa Slab One, Rockwell, serif"
    fontSize: "clamp(28px, 3vw, 36px)"
    fontWeight: 400
    lineHeight: 1.12
  slab-label:
    fontFamily: "Alfa Slab One, Rockwell, serif"
    fontSize: "24px"
    fontWeight: 400
    lineHeight: 1.1
  subhead:
    fontFamily: "Atkinson Hyperlegible Next, system-ui, sans-serif"
    fontSize: "20px"
    fontWeight: 800
    lineHeight: 1.12
  superlative-title:
    fontFamily: "Atkinson Hyperlegible Next, system-ui, sans-serif"
    fontSize: "19px"
    fontWeight: 800
    lineHeight: 1.2
  lede:
    fontFamily: "Atkinson Hyperlegible Next, system-ui, sans-serif"
    fontSize: "20px"
    fontWeight: 400
    lineHeight: 1.55
  body:
    fontFamily: "Atkinson Hyperlegible Next, system-ui, sans-serif"
    fontSize: "18px"
    fontWeight: 400
    lineHeight: 1.55
  ui:
    fontFamily: "Atkinson Hyperlegible Next, system-ui, sans-serif"
    fontSize: "17px"
    fontWeight: 600
    lineHeight: 1.55
  caption:
    fontFamily: "Atkinson Hyperlegible Next, system-ui, sans-serif"
    fontSize: "15px"
    fontWeight: 400
    lineHeight: 1.35
  now-playing:
    fontFamily: "Alfa Slab One, Rockwell, serif"
    fontSize: "15px"
    fontWeight: 400
    lineHeight: 1.35
rounded:
  none: "0px"
  full: "9999px"
spacing:
  row: "8px"
  tight: "14px"
  gutter: "24px"
  section: "48px"
  wide: "64px"
  chapter: "96px"
components:
  masthead:
    backgroundColor: "{colors.yearbook-navy}"
    textColor: "{colors.paper}"
    padding: "14px 24px"
  masthead-brand:
    textColor: "{colors.school-gold}"
    typography: "{typography.slab-label}"
  nav-link:
    textColor: "{colors.masthead-muted}"
    typography: "{typography.ui}"
    padding: "6px 0"
  nav-link-active:
    textColor: "{colors.paper}"
  button-primary:
    backgroundColor: "{colors.yearbook-navy}"
    textColor: "{colors.paper}"
    typography: "{typography.ui}"
    rounded: "{rounded.none}"
    padding: "10px 18px"
  button-primary-night:
    backgroundColor: "{colors.night-navy}"
    textColor: "{colors.night-page}"
  button-text:
    textColor: "{colors.yearbook-navy}"
    typography: "{typography.ui}"
    padding: "8px 0"
  play-button:
    textColor: "{colors.yearbook-navy}"
    rounded: "{rounded.full}"
    size: "40px"
  play-button-hover:
    backgroundColor: "{colors.school-gold}"
    textColor: "{colors.ink}"
  cover-play-badge:
    backgroundColor: "{colors.school-gold}"
    textColor: "{colors.ink}"
    rounded: "{rounded.full}"
    size: "44px"
  picker-item:
    textColor: "{colors.ink-secondary}"
    typography: "{typography.ui}"
    padding: "4px 0"
  picker-item-on:
    textColor: "{colors.yearbook-navy}"
  superlative-art:
    rounded: "{rounded.none}"
    size: "112px"
  superlative-label:
    textColor: "{colors.yearbook-navy}"
    typography: "{typography.slab-label}"
  portrait:
    backgroundColor: "{colors.paper-shade}"
    rounded: "{rounded.none}"
  input-underline:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.ink}"
    rounded: "{rounded.none}"
    padding: "9px 4px"
  search-field:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.ink}"
    rounded: "{rounded.none}"
    padding: "9px 12px"
  player-dock:
    backgroundColor: "{colors.yearbook-navy}"
    padding: "8px"
    height: "96px"
---

# Design System: Listening History

## Overview

**Creative North Star: "The Music Yearbook"**

The site is printed like a school yearbook: bright white paper, two school colors, near-black ink. Each year is a spread. A giant navy year numeral and a strict grid of artist portraits sit on the left, a thick gold gutter divides the page, and the right column lists the year's superlatives, each one a large square cover with a gold-edged slab label and the song title set big. Album covers and artist photos carry most of the color; navy and gold are the school colors that frame them.

Density is generous and calm. Sections breathe on a 96px chapter rhythm, type is large (18px body), and nothing is boxed. Separation comes from space, from portraits sitting in their grid, and from gold rules. Depth appears only when something is picked up: a cover lifts on hover, a playing song lifts and wears a gold ring with a slab "Now playing" line under it. Motion steps into place and stops; nothing drifts.

The world rejects the streaming-app default: no Wrapped-style gradients, no black-and-green app look, no dashboard stat tiles, no cards or bordered boxes.

**Key Characteristics:**
- White yearbook paper with navy fields and headings and gold rules and labels.
- Collegiate slab (Alfa Slab One) for years, headings and superlative labels; Atkinson Hyperlegible Next for everything read.
- Portraits in 4:5, covers in 1:1, both square-cornered and unframed, captioned underneath.
- Gold rules are the only lines: a 6px gutter, 6px section rules, 2px superlative dividers, 3px underlines for the current tab.
- Lift-on-pick-up depth; flat at rest.
- A navy night edition (not black) for dark mode, with gold kept unchanged.

## Colors

Two school colors on white paper, with album art supplying everything else.

### Primary
- **Yearbook Navy** (yearbook-navy): the masthead band, slab headings, year numerals, rank numbers, primary buttons, the player dock, and the dark end of every heatmap. On night pages it becomes Night Navy (night-navy) for fills, and headings switch to Night Ink.

### Secondary
- **School Gold** (school-gold): rules, the spread gutter, active tab and picker underlines, focus rings, link underlines, the play-button hover fill, the cover play badge, the playing ring, and the brand name on the masthead. It is a line and fill color, never body text on white. It stays the same in both editions.
- **Gold Ink** (gold-ink): the text-safe gold, for the "Now playing" line, path arrows and the input caret. Night Gold Ink (night-gold-ink) replaces it on night pages.

### Tertiary
- **Podcast Orange** (podcast-orange) and **Audiobook Green** (audiobook-green): chart series only, one idea each (podcasts, audiobooks). Music is always navy. Night pages use their night variants.

### Neutral
- **Paper** (paper): the page and the floating surfaces (search results, filters panel, tooltip, toast).
- **Paper Shade** (paper-shade): empty portrait and cover placeholders, row hover in search results and tables.
- **Ink** (ink): headings set in sans, song titles, body text. Also the fixed text color on any gold fill.
- **Ink Secondary** (ink-secondary): ledes, captions, artist lines, inactive picker items.
- **Ink Muted** (ink-muted): chart labels, placeholder initials, notes.
- **Masthead Muted** (masthead-muted): inactive tabs and icons on the navy band.
- **Grid Line** (grid-line) and **Axis Line** (axis-line): chart gridlines and axes, the play-button ring, the input underline at rest.
- **Heat 0 to 6** (heat-0 to heat-6): the paper-to-navy shade for heatmaps and era lines. Night pages run Night Heat 0 to 6 from deep navy to pale blue.

### Named Rules
**The Two School Colors Rule.** Navy and gold are the only chrome colors. Any other color on the page comes from album art, a photo, or a chart series that names one kind of listening.

**The Gold Is a Line Rule.** Gold draws rules, underlines, rings and small fills. Text that must be read in gold uses Gold Ink, never School Gold on white.

**The Night Edition Rule.** Dark mode is navy paper (night-page), never black, and never paired with green. Gold does not change between editions.

**The Shade Carries Data Rule.** Light-to-dark shading appears only where it encodes a quantity (heatmaps, era lines). Nowhere else are colors faded or tinted.

## Typography

**Display Font:** Alfa Slab One (with Rockwell, serif)
**Body Font:** Atkinson Hyperlegible Next (with system-ui, -apple-system, Segoe UI, sans-serif)

**Character:** A heavy collegiate slab for the things a yearbook would stamp (years, headings, superlative names) against a highly legible sans for everything a visitor actually reads. The slab is always weight 400 and never tracked; the sans does emphasis with weight 800, not size jumps.

### Hierarchy
- **Year Numeral** (slab 400, clamp(96px, 13vw, 168px), 0.82, tabular): the giant year that opens each spread. Decorative and hidden from screen readers; the spread's real heading follows it.
- **Display** (slab 400, clamp(44px, 7vw, 96px), 0.98, max 14ch): the cover title on the Story page only.
- **Headline** (slab 400, clamp(40px, 5vw, 64px), 1.12): page titles. Artist and song pages go up to clamp(40px, 5.5vw, 72px).
- **Title** (slab 400, clamp(28px, 3vw, 36px), 1.12): section headings. Inside a spread the heading is set in Ink with the artist link in navy.
- **Slab Label** (slab 400, 24px to 26px, 1.1): superlative names, the "Superlatives" column head, week and race year labels. Month heads go to 30px, the masthead brand to 22px.
- **Subhead** (sans 800, 20px): third-level headings.
- **Superlative Title** (sans 800, 19px, 1.2): the winning song or album under its slab label.
- **Lede** (sans 400, 19px to 22px, 1.55, max 68ch): the one-sentence finding under a heading.
- **Body** (sans 400, 18px, 1.55; 17px under 900px): running text, capped at 68ch.
- **UI** (sans 600, 17px): tabs, buttons, picker items. Song names in lists use 600 to 800.
- **Caption** (sans 400, 15px, 1.35): portrait and cover captions, artist lines, table headers, chart legends. Name lines in captions are 800.
- **Now Playing** (slab 400, 15px, Gold Ink): the single status line added under whatever is playing.

### Named Rules
**The Slab Stamps, Sans Speaks Rule.** Slab is for years, headings, rank numbers and superlative labels. Sentences, captions and controls are always in Atkinson Hyperlegible Next.

**The Numbers Line Up Rule.** Years, ranks, hours and table figures use tabular numerals.

## Layout

A single centered column, 1200px wide, with 24px side padding (16px under 900px) and 56px top padding. Page sections stack on a 96px chapter rhythm; the first section after a page intro sits 48px down. Two-column grids use 48px rows and 64px columns and fold to one column under 900px.

The year spread is the signature layout: a three-track grid (1.15fr, 6px gold gutter, 1fr) with 48px column gaps. The left track holds the year numeral, heading, lede and a 4-column portrait grid; the right track holds the superlatives; the full-width row below holds the year's top songs behind a 6px gold rule. Under 960px the spread stacks as heading, gutter (now a horizontal 6px rule), superlatives, portraits, songs. Under 600px the spread's portraits drop to 3 columns showing 6 artists; other portrait and cover grids drop to 2 columns.

Portrait grids use 24px row and 18px column gaps; cover rows use 24px and 20px. Lists use 8px row padding with 14px between art and text. The cover ribbon on Story scrolls sideways with snap points, 92px to 124px per cover.

The masthead is a sticky navy band (14px vertical padding) holding the brand, tabs and search; under 1360px the tabs wrap to their own scrolling row, and under 900px the band stops sticking. Breakpoints in use: 1360px, 960px, 900px, 600px.

## Elevation & Depth

Flat at rest. One shadow value exists, the Lift, and it means "picked up": covers on hover and focus, the playing item, and the layers that float over the page (search results, the filters panel, tooltip, toast, player dock). Night pages use a deeper single-layer version.

### Shadow Vocabulary
- **Lift** (`box-shadow: 0 2px 6px rgba(22, 19, 15, .08), 0 18px 40px rgba(22, 19, 15, .16)`; night `0 18px 40px rgba(0, 0, 0, .5)`): hover lift on covers (with translateY -4px to -6px), and floating layers.
- **Playing Ring** (`box-shadow: var(--lift), 0 0 0 4px var(--gold)` with translateY -3px): the art of whatever is playing.
- **Gold Press** (`box-shadow: inset 0 -4px 0 var(--gold)`): primary button hover; a 2px version is the resting state of playlist action links.

### Named Rules
**The Picked Up Rule.** Shadows appear only when something is lifted by the visitor or floats above the page. Nothing sits in a raised panel at rest.

## Shapes

Square corners everywhere (0px): portraits, covers, buttons, inputs, panels. The only round shapes are functional: the 40px play button (34px in captions), the 44px gold play badge on covers, round artist art in some lists, and the toggle switch. Portraits are 4:5, covers 1:1, superlative covers 112px square (84px under 600px). Images are never framed or outlined, except that the selected year or binge cover gets a 5px gold outline with 3px offset.

Lines are always gold and always one or two sided: the spread gutter, 6px rules over the songs block and under hero headers, a 96px by 6px gold bar under page titles, 2px rules between superlatives, 3px under table headers and the active tab, 4px across the top of floating layers (tooltip, toast, player).

### Named Rules
**The No Box Rule.** No element is enclosed on all four sides by a border. Separation is space, a grid, or a single gold rule.

## Components

### Buttons
Quiet and confident: square navy slabs or plain words.
- **Shape:** square (0px).
- **Primary:** Yearbook Navy fill, white UI text, 10px by 18px. On night pages the fill is Night Navy and the text Night Page.
- **Hover / Focus:** a 4px gold bar presses up from the bottom edge (Gold Press). Focus everywhere is a 3px gold outline with 3px offset.
- **Text button:** no fill, navy text, 8px vertical padding; hover adds a 2px gold underline offset 4px.
- **Playlist actions:** a line of text buttons above a list, 16px weight 700, resting on a 2px gold underline that thickens to 4px on hover.
- **Disabled:** 55% opacity.

### Play Button
- **Style:** a 40px circle with a 2px Axis Line ring and a navy play triangle.
- **Hover:** fills School Gold with Ink icon and loses the ring (150ms).
- **On covers:** a 44px gold badge sits 10px in from the bottom right corner, hidden until hover or focus, when it rises 6px into place; on touch devices it is always shown.

### Navigation
- **Masthead:** sticky Yearbook Navy band; brand in slab School Gold at 22px (18px under 900px).
- **Tabs:** UI type in Masthead Muted with 6px vertical padding; hover turns white; the active tab is white with a 3px gold underline.
- **Year picker:** a wrapping row of plain year words in Ink Secondary; the current year is navy, weight 800, with a 3px gold underline. No pills.
- **Page turn:** previous and next years at the foot of a spread, small direction word over a headline-size slab year; hover adds a 4px gold underline.

### Inputs / Fields
- **Search (on the masthead):** white field, no border, square, 9px by 12px; focus is a 3px gold outline flush to the edge.
- **Page inputs:** no border, a 2px Axis Line underline; focus swaps to a 3px gold underline. Checkboxes and sliders take navy as their accent color.
- **Switch:** a 40px by 22px pill track in Axis Line that turns navy when on, with a white knob.

### Superlative
The yearbook's signature row. A 112px square cover, then the slab label (Most played, Most on repeat, Album of the year, Best newcomer) in navy, the winner in Superlative Title, a caption line of artist and detail, and a play button at the end. Rows are separated by 2px gold rules with 18px vertical padding; the last row has no rule.

### Portrait Grid
Artist photos in 4:5, no frame, Paper Shade behind any missing photo (with slab initials). Caption below: name in 800 (clamped to two lines), hours or detail in Ink Secondary. Hovering a portrait raises its saturation slightly; it does not move.

### Cover Row
The first songs of a list shown as big 1:1 covers in a 4-column grid (3 in eras, 2 on phones), each a play button. Hover lifts the cover 4px with the Lift shadow and reveals the gold play badge. Title (800, one line) and artist caption below.

### Rank List
Rows with a slab rank number in navy (28px column), small square art, song and artist, and the value pushed to the right in Ink Secondary tabular numerals. Can flow into two columns of five.

### Now Playing State
When a song plays, every place it appears on the page gets the Playing Ring (lift plus 4px gold ring, raised 3px), its play control fills gold, and a slab "Now playing" line in Gold Ink is appended to its caption.

### Player Dock
A navy dock fixed 16px above the bottom edge, up to 720px wide, with a 4px gold top rule and the Lift shadow, holding the 80px Spotify embed and a close icon. It rises 24px into place over 350ms.

## Do's and Don'ts

### Do:
- **Do** open each year as a spread: slab year numeral, 4:5 portrait grid, 6px gold gutter, superlatives column.
- **Do** let album covers and artist photos carry the color, framed by navy and gold.
- **Do** separate with space and single gold rules (2px between rows, 3px for active underlines, 6px between major parts).
- **Do** use the Lift shadow only for hover, the playing item, and floating layers.
- **Do** move with cubic-bezier(.2, .8, .2, 1) at 150ms to 350ms, and drop all motion under prefers-reduced-motion.
- **Do** keep every corner square except the round play controls and toggle.
- **Do** use Gold Ink, not School Gold, for any gold text on white.

### Don't:
- **Don't** use gradients as color (the only linear-gradient is a solid gold bar drawn under page titles).
- **Don't** build a black-and-green app look; the night edition is navy.
- **Don't** make dashboard stat tiles; numbers go in sentences, captions and right-aligned list values.
- **Don't** enclose content in cards or four-sided bordered boxes.
- **Don't** add pills, tags or chips; pickers are plain words with a gold underline.
- **Don't** set sentences, captions or controls in the slab, or track the slab.
- **Don't** introduce a third chrome color; extra hues are reserved for chart series that each name one kind of listening.
