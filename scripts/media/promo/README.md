# Promo images

`npm run media:promo` (`scripts/media/build-promo.mjs`) writes these to `docs/media/`:

| File | Size | Used for |
| --- | --- | --- |
| `hero.png` | 2400 x 1350 | top of the README, release posts |
| `card-drag.png`, `card-sliders.png`, `card-regions.png`, `card-notes.png`, `card-export.png`, `card-3d.png`, `card-tools.png` | 1600 x 1000 | feature grid in the README, one card per post |
| `social-1280x640.png` | 1280 x 640 | GitHub repository social preview (Settings > General > Social preview) |
| `social-1200x675.png` | 1200 x 675 | link cards on X, Mastodon, Bluesky, the forum |
| `square-1080.png` | 1080 x 1080 | square posts |

All of them are light: the captures are taken in Obsidian's light theme.

## How an image is made

1. **Capture** (`capture.mjs`). The plugin runs in the isolated Obsidian of `../lib/obsidian.mjs` at
   1728 x 1117 CSS px, device scale 2. Every shot is the whole window (3456 x 2234 pixels). With each
   shot the script records where the editor, the preview, the Sliders dock, the hover tip and so on sit, and where
   the pointer was. Pictures and `meta.js` go to `shots/`, which is not committed.
2. **Export.** The LaTeX of the Linear program example is read from the Code tab, compiled with `pdflatex`
   and rendered to `shots/export-lp.png`. `card-export` puts it next to the preview. No `pdflatex`, no card.
3. **Compose.** Each `*.html` here is a page of the final pixel size. `promo.js` fills its frames with crops of
   the shots and headless Chromium renders it.
4. **Optimise.** Metadata is stripped and the PNG recompressed (a 256 colour palette only if a file is over
   its budget of 900 KB).
5. **Install.** An image replaces the one in `docs/media` only when it shows something else
   (`../lib/stable.mjs`), so composing again without a change leaves `git status` clean.

The rule: the templates never draw plugin UI. Charts, cards, menus and tips in the images are crops of real
captures. The templates add text, frames, the pointer (no capture contains it; its position is the recorded one)
and, in `card-drag`, an enlarged copy of the tip.

Two things to keep when you change a template:

- A crop of UI whose text the copy points at must be readable at half size (a card is about 800 px wide in the
  README): about 14 px text in the captured app needs a crop at 1.3 times its size or more. Where that does
  not fit (the Sliders dock), print the value once more in type, read from the app (`data-value`), as
  `card-sliders` and `card-3d` do.
- The repository address is set in the sans face (`.crumb.is-url`). The hyphen of the mono face is as wide as a
  letter and reads as a dash.

## Working on the design

```bash
npm run media:promo                               # captures, then all images
npm run media:promo -- --skip-capture             # compose again from the last captures, about 15 s
npm run media:promo -- --skip-capture --only hero,card-drag --out /tmp/promo-test
```

After a first run you can also open a template in a browser (`open scripts/media/promo/card-drag.html`): it
reads the same `shots/`. Its size comes from `data-width` / `data-height` on `<body>`.

A frame is one element:

```html
<div class="shot" data-shot="lp-turn" data-rect="preview" data-pointer="34" style="width: 776px"></div>
```

`data-shot` names a capture and `data-rect` one of its recorded rectangles (or `x,y,width,height` in CSS px of
the captured window). `data-pad` adds or cuts px around it, `data-fit` is `width` (default), `height`, `cover`
or `contain`, and `data-pointer` draws the pointer. `data-text="versions.plugin"` and
`data-value="surplus-2.a"` print values read from the app. The header of `promo.js` lists everything.

The build fails when a template reports a problem: an unknown capture, text that leaves the canvas, text cut
off by its box, text under a capture, a console error. It does not judge the look: open every PNG before you
commit it.

## Files

| File | What it is |
| --- | --- |
| `charts.mjs` | the charts and notes that are captured: the plugin's examples (three of them with a change that the file names: another view, the Linear program without its objective line for `card-drag`, the 3D example turned and sampled more finely), plus a damped oscillation with three sliders |
| `capture.mjs` | the capture scenario: which states, which rectangles |
| `promo.css`, `promo.js` | the shared look, and the code that places crops |
| `hero.html`, `card-*.html`, `social.html`, `square.html` | one page per image (`social.html` serves both social sizes) |

To add a card: capture what it needs in `capture.mjs`, copy a `card-*.html`, add it to `TARGETS` in
`../build-promo.mjs` and raise `CARDS` in `promo.js`.
