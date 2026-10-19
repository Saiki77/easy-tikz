# Developing Easy TikZ

[Overview](../README.md) · [Reference](reference.md) · [Changelog](../CHANGELOG.md)

```bash
npm install
npm run dev    # watch mode; also rebuilds styles.css when a stylesheet changes
npm run build  # type check, production bundle, styles.css
npm test       # unit tests and the media pipelines' tests, plus a pdflatex compile test when pdflatex is on PATH
node scripts/run-tests.mjs geometry   # only the test files whose name contains "geometry"

npm run media:smoke    # smoke test in a real, isolated Obsidian, about 40 s (macOS)
npm run media:guides   # docs/guides: the guide pages and their screenshots, 2 to 3 minutes
npm run media:brand    # the brand kit: its tests, the brand sheet and proofs of the hero and the drag page, to a temporary folder or --out
npm run media:film -- overview --out /tmp/film   # a film of scripts/media/cinema/scenes: MP4, GIF loop, poster, contact sheets
```

`styles.css` in the repository root is generated: `scripts/build-css.mjs` concatenates `src/styles.css` and every `src/ui/*.css`, so edit those. Tests live in `tests/*.test.ts` and cover the pure modules (no `obsidian` import); `scripts/run-tests.mjs` bundles each file with esbuild and runs it in node. There are 25 test files with 728 tests (60 of them are the pdflatex compiles); after them `npm test` runs the three test files of the media pipelines (`scripts/media/brand/kit.test.mjs` and `math.test.mjs`, `scripts/media/cinema/timeline.test.mjs`) with plain node, since they need no Obsidian, browser or TeX fonts. `dom-classes` scans the sources for class names that only real Obsidian rejects (a space in a class given to `createSvg` or `addClass` throws there), since no node test can run Obsidian's DOM helpers. The eight `drag-*` files (264 tests) cover drag to edit: `drag-golden` is a table of real drags with the exact text each one must produce, and `drag-fuzz` rewrites 2300 random expressions and checks that the new text computes the same values. `guides` loads every chart of every guide (the finished chart and each step) and fails on any problem, and checks ids, links between guides, step titles and that each "type" row is accepted by the field it names. `whatsnew` covers who sees the What's new popup (an update, with or without stored data, never a new install), its text, and its live chart along the whole slider; it also checks that the number of guides the popup names matches the guide list, the pages in `docs/guides` and the README. `labels` takes the charts where labels used to be struck, stacked or clipped and fails when a label box meets a stroke, a function curve or another label, or leaves the plot frame. The LaTeX test compiles every example, the finished chart of every guide, the chart of the What's new popup, a 3.x block of every legacy tool type and stress cases with pdflatex (30 s per file; set `ETZ_LATEX_KEEP=<dir>` to keep the `.tex`, `.pdf` and `.log` files).

**Guides.** `src/guides` is the single source of the guides: the Help tab draws them with live charts, and `npm run media:guides` writes `docs/guides/<id>.md` with a screenshot for every step that has something to show in the app. The files in `docs/guides` are generated, so edit `src/guides/*.ts` and run the script again.

**Media toolkit.** The four `media:*` scripts ([`scripts/media`](../scripts/media/README.md), development only, no npm dependencies beyond esbuild) drive the real plugin in a second Obsidian that runs next to your own: its own profile, a throwaway vault and its own debugging port. Your own Obsidian, its profile and your vaults are never opened or written. The scripts click, drag and type through real input events, so every screenshot and video in `docs` shows the plugin as it runs. They need macOS, Obsidian in `/Applications` (or `OBSIDIAN_BIN`) and Node 22 or newer; the guides also need ImageMagick; the brand kit and the films need ImageMagick, a headless Chromium (the one Playwright keeps in its cache, or `CHROMIUM_BIN`) and a TeX Live with New Computer Modern and Latin Modern (found with `kpsewhich`), and the films `ffmpeg`.

**Brand kit and films.** The hero picture, the drag page, the drag clip and the overview film are made in the "Math notebook" design by two pipelines: [`scripts/media/brand`](../scripts/media/brand/README.md) (`npm run media:brand`: paper, TeX type, callouts, page templates) and [`scripts/media/cinema`](../scripts/media/cinema/README.md) (`npm run media:film`: a scene is captured in the isolated Obsidian, then edited and composited with the brand kit). Both write to a temporary folder or `--out`, never into `docs/media`: look at the contact sheets and stills, then copy the files there. Their tests (`scripts/media/brand/*.test.mjs`, `scripts/media/cinema/*.test.mjs`) are pure functions and run with `npm test`. The first-round scripts `scripts/media/build-promo.mjs` and `build-video.mjs` still make the other feature cards, the social images and six clips for the release posts. Their npm scripts `media:promo` and `media:video` are retired, and they refuse to write `hero.png`, `card-drag.png`, `clip-drag.*` and `overview.*` into `docs/media`, which would put the old design back (with `--out <another dir>` they still make them there).

**Smoke test.** `npm run media:smoke` checks what no node test can see, because it needs Obsidian's DOM and real input: the plugin loads in a new profile, the editor opens, a guide figure in Help draws its math labels with their real boxes, every example and every chart of every guide loads with no problem, the four tabs show, a drag on the objective line of the Linear program example moves its slider and Shift-drag turns the line, Escape cancels a drag (also with Shift held), typing a formula adds a function, Insert into note renders the chart with its slider strip, a slider in the note does not write the file, a click on the chart reopens it and Save changes writes it back, the dark theme draws, the What's new popup opens once for a user who updated (with stored data, or with none but a chart in a note) and never for a new install, its live chart follows its slider and play, the setting, the command and the link in the Help tab work, and nothing is logged as an error. It prints one `PASS` / `FAIL` line per check and exits with code 1 when a check fails. Run it before tagging a release: `npm run build && npm run media:smoke -- --root` tests the `main.js` and `styles.css` that the release ships.

```
main.ts              # plugin entry: code-block processor, inline charts and slider strip, the chart under a block being edited, settings tab, when What's new opens
src/
  live.ts            # the chart under a block while you edit it in Live Preview (a CodeMirror state field and block widget)
  motion.ts          # charts that move: glides between two pictures, pop-ins of new objects
  blockjson.ts       # reading a block: text or (lenient) JSON
  chartdata.ts       # chart data: canonical form, minimize
  text/              # charts as text (pure: no DOM, no Obsidian)
    parse.ts         # the lines in words (and the 4.4 short forms) into a chart, problems with line and column
    print.ts         # a chart as lines in words; writeChartText keeps the lines of objects that did not change
    fences.ts        # the chart blocks of a note, from its lines (for the chart under the block)
    words.ts         # chart words: a person's own words for the pieces of the language, read and written
    reword.ts        # after words changed: the charts of a note that used them, written in the new words
  ai/                # AI access: the local server, MCP tools, the vault host, connection lines
  modal.ts           # editor modal: layout, preview, render loop, drag to edit and undo wiring, autosave draft, click-to-edit save
  ui/
    host.ts          # PanelHost: the contract between the modal and its panels
    kit.ts           # UI kit: segmented controls, chips, live sliders, expression inputs, cards, popovers
    buildPanel.ts    # Build tab: card list, + Add menu, empty state, example thumbnails
    functionCards.ts # function and surface cards
    layerCards.ts    # region, curve, points, segment, plane and text label cards
    chartPanel.ts    # Chart tab
    codePanel.ts     # Code tab
    helpPanel.ts     # Help tab: guides browser and reader, search, the reference with Open example buttons
    whatsNewModal.ts # the What's new popup with its live chart
    wordsModal.ts    # Chart words: the pieces of the language with your words, bundles, sharing
    slidersDock.ts   # Sliders dock under the preview
    dragLayer.ts     # drag overlay over the chart (halo, ghost, pivot mark, snap ring) and the hint chip
    *.css            # per-panel styles
  drag/              # drag to edit engine (pure: no DOM, no Obsidian)
    types.ts         # shared types of the engine, the overlay and the modal
    hits.ts          # hit index: which drawn part the pointer is over
    targets.ts       # hit to target: the fields a part owns, delegation, locks, twin objectives
    numbers.ts       # the numbers of a formula by tier, slotted closures, text rewrite with a numeric safety net
    shapes.ts        # residual models: how far a shape is from its dragged samples
    pivot.ts         # pivot candidates and choice for Shift-drags
    solver.ts        # number priority, planning, per-event solve, rounding
    session.ts       # prepare, update, commit and cancel a drag; snapping; keyboard nudges
    describe.ts      # every user-facing string of drag to edit
    history.ts       # chart-level undo and redo
  guides/            # the guides (pure data: no DOM, no Obsidian), read by the Help tab and by scripts/media/build-guides.mjs
    types.ts         # the Guide, GuideStep and GuideShot contract
    index.ts         # GUIDES in display order, categories, GitHub links, search
    basics.ts        # Getting started; Functions and sliders
    optimisation.ts  # Regions and optimisation
    more.ts          # Points, lines and labels; 3D; Notes and export; Reference
    dynamic.ts       # live calculations and sliders: play, secant to tangent, a growing area, computed points
  expr.ts            # expression parser, closure compiler, pgfmath and LaTeX printers
  mathcontext.ts     # MathContext: names, sliders, computed values, validation, quick fixes, templates
  geometry.ts        # regions from inequalities, contours, crossings, optimisation, integer points
  scene.ts           # tools and function decorations as drawing primitives, shared by preview and export
  renderer.ts        # 2D SVG renderer
  renderer3d.ts      # 3D canvas / SVG renderer
  export.ts          # pgfplots export (2D and 3D)
  settings.ts        # chart state, serialisation, view resolution
  migrate.ts         # 3.x to v4 migration, defaults, + Add recipes, examples
  issues.ts          # problem text for the status chip and the line under inline charts
  whatsnew.ts        # the What's new popup: who sees it, what it says, its live chart
  mathlabel.ts       # MathJax labels in the preview
  math.ts            # MathHelper: compatibility wrapper over the expression engine
  colors.ts          # palette and its \definecolor names
  templates.ts       # built-in function templates, plugin data shape
  util.ts            # ticks, curve sampling, LaTeX stripping
  styles.css         # base styles (first part of styles.css)
  types.ts           # shared interfaces and the Tool union
scripts/
  build-css.mjs      # builds styles.css
  run-tests.mjs      # test runner
  media/             # media toolkit (development only), see scripts/media/README.md
    lib/             # DevTools protocol client, isolated Obsidian launcher and input helpers, frame recorder, headless Chromium renderer
    smoke.mjs        # real-Obsidian smoke test (npm run media:smoke)
    build-guides.mjs # docs/guides from src/guides (npm run media:guides)
    brand/           # the "Math notebook" brand kit: paper, TeX type, callouts, pointer, page templates (npm run media:brand)
    cinema/          # the films: capture in Obsidian, then edit and composite on a stage page (npm run media:film)
    build-promo.mjs  # first-round images in docs/media, composed by the templates in promo/ (never hero.png or card-drag.png)
    build-video.mjs  # first-round clips in docs/media, one scenario per file in video/ (never overview.* or clip-drag.*)
tests/               # unit tests (drag-*.test.ts: drag to edit, guides.test.ts: every guide chart, whatsnew.test.ts: the popup), helpers (_lib.ts, _drag.ts), the pdflatex compile test
docs/
  guides/            # generated: one page per guide, README.md as the index, img/ with the screenshots
  whats-new.md       # what is new in each 4.x release
  reference.md       # everything the plugin does, by topic
  ai.md              # the guide for AI assistants (also served by the AI server)
  media/             # generated: hero, feature cards, social images, videos (MP4, GIF, poster)
  release-posts/     # announcement texts per channel, each naming the media to attach
```
