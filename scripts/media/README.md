# Media toolkit

Scripts that drive the real plugin in a real Obsidian to make screenshots, videos and a release smoke test.
Development only: nothing here ships with the plugin, and there are no npm dependencies beyond the repository's
own `esbuild`.

Every picture and video shows Easy TikZ as it runs. The toolkit clicks, drags and types through real input
events; it never draws UI of its own, apart from the pointer and the caption bar in videos (the real mouse
pointer is not part of a capture) and, in the first-round `clip-drag`, an enlarged copy of the hover tip (a
clone of the real element, see [video/README.md](video/README.md)).

Two pipelines build on this toolkit and make the media of 4.2 in the "Math notebook" design (graph paper,
TeX fonts, notes and arrows around real captures):

- [`brand/`](brand/README.md), the brand kit: paper, type, callouts, pointer and page templates, with the
  proofs of the hero picture and the drag page (`npm run media:brand`);
- [`cinema/`](cinema/README.md), the films: a scene is captured in the isolated Obsidian, then edited and
  composited on a stage page in headless Chromium (`npm run media:film`). It made the overview film and the
  drag clip.

They write to a folder of their own (a temporary one, or `--out`), never into `docs/media`: look at the
result (the contact sheets and stills of a film, the 800 px copy of a page), then copy it there. The
first-round scripts `build-promo.mjs` and `build-video.mjs` still make the other images and clips of
`docs/media`, but have no npm script any more, and they never write the files the new pipelines replaced
(see [The first-round scripts](#the-first-round-scripts)).

## What runs

A second, isolated Obsidian next to your own:

- its own profile (`--user-data-dir`) and a throwaway vault, both inside one work dir;
- its own debugging port, so several scripts can run at once;
- the plugin built from the current sources into that vault (the `main.js` in the repository root is not touched).

Your own Obsidian, its profile and your vaults are never opened or written. The only thing read from your
profile is the newest `obsidian-*.asar` in `~/Library/Application Support/obsidian`, which is copied, because the
app bundle on its own is older than the plugin's `minAppVersion`.

Requirements: macOS, Obsidian in `/Applications` (or `OBSIDIAN_BIN=/path/to/Obsidian`), Node 22 or newer.
On the PATH: `ffmpeg` and `ffprobe` for videos, ImageMagick (`magick`) for the guide pictures, the promo
images and the two pipelines, and `pdflatex` with pgfplots for the promo card that shows the compiled export.
The brand kit and the films also need a headless Chromium (the one Playwright keeps in its cache, or
`CHROMIUM_BIN`) and a TeX Live with New Computer Modern and Latin Modern, found with `kpsewhich` (nothing is
copied into the repository: `brand/fonts.css` is generated and not committed).

While a script runs, an Obsidian window opens behind your other windows. It ignores your mouse and does not take
the keyboard, so you can keep working. It closes when the script ends.

## Commands

```bash
npm run media:smoke                      # release smoke test, about 30 s; exit code 1 when a check fails
npm run media:smoke -- --root            # test the main.js / styles.css in the repository root (after npm run build)
npm run media:smoke -- --port 9350 --work /tmp/etz-smoke

node scripts/media/lib/example.mjs       # tour of the toolkit: 4 pictures and a 4 s clip in <tmp>/easy-tikz-media/example
node scripts/media/lib/example.mjs --out ~/Desktop/etz-example

npm run media:guides                     # docs/guides/*.md and their screenshots, about 2 minutes

npm run media:brand                      # brand kit: fonts.css, its tests, specimen.png, the proofs (to <tmp>/easy-tikz-media/brand)
npm run media:brand -- --out /tmp/brand --only hero
npm run media:film -- --list             # the scenes of cinema/scenes
npm run media:film -- overview --out /tmp/film --port 9381   # a film: MP4, GIF loop, poster, contact sheets, stills
npm run media:film -- overview --out /tmp/film --skip-capture # edit again from the last capture: composite only

node scripts/media/build-promo.mjs       # first-round images: docs/media/card-*.png, social-*.png, square-1080.png
node scripts/media/build-video.mjs clip-3d   # first-round clips: film what changed, not everything
```

The tests of the two pipelines are part of `npm test` (`scripts/run-tests.mjs` runs `brand/*.test.mjs` and
`cinema/*.test.mjs` with node: pure functions, no Obsidian, browser, TeX fonts or ffmpeg). One at a time:

```bash
node scripts/media/brand/kit.test.mjs       # the paper's lines, the callout curve, the pointer's keycap
node scripts/media/brand/math.test.mjs      # the formula formatter on the formulas of the media
node scripts/media/cinema/timeline.test.mjs # layout, camera, cadence, the edit, a film with a section card
```

### The new pipelines

`npm run media:brand` (`brand/build.mjs`) and `npm run media:film` (`cinema/build.mjs`) have their own
notes: [brand/README.md](brand/README.md) and [cinema/README.md](cinema/README.md). By default the brand kit
writes its proofs to `<tmp>/easy-tikz-media/brand` (only `brand/specimen.png`, the brand sheet, is written
next to its README), and a film goes to `<work dir>/cinema-out`, the work dir being
`<tmp>/easy-tikz-media/port-<port>`. Pass `--out <dir>` for another folder. Neither writes into `docs`.

To publish a film, look at its contact sheets and stills, then copy `<name>.mp4`, `<name>.gif` and
`<name>-poster.png` into `docs/media`. The drag clip of the README is the `sample` scene, named by
`--name clip-drag` (19 s). The overview is the `overview` scene: 40.5 s at 1920 x 1080, and its GIF is the
loop the scene sets (`loop: { from: 17.0, to: 34.6 }`: section 2, 17.6 s).

### The first-round scripts

`build-promo.mjs` and `build-video.mjs` made every image and video of the 4.0 relaunch. Since 4.2 the hero
picture and the drag page (`hero.png`, `card-drag.png`) come from the brand kit and the films `overview.*`
and `clip-drag.*` from the cinema pipeline. The npm scripts `media:promo` and `media:video` are retired, and
the two scripts never write those names into `docs/media` (`lib/replaced.mjs`): a run leaves them out with a
line on the log, and naming one (`--only hero`, `build-video.mjs overview`) stops with exit code 2 before
anything is captured. With `--out <another dir>` they still make the old versions, for a comparison. They
still make the other six feature cards, the social images and six clips, which the release posts use.

The three build scripts below (`build-guides.mjs` and the two first-round scripts) write into the repository
by default, so look at `git status` afterwards. `--out <dir>` sends the result somewhere else, for example to
compare a fresh run with what is committed.

**What a run changes.** No capture is byte stable (text is antialiased a little differently every time), so
the scripts compare before they write. A PNG that shows the same picture as the file already in `docs` is
thrown away and the old file stays (`lib/stable.mjs`: at most 24 pixels may differ by more than 6 % of a
channel; one changed digit is more than that). After a run in which nothing looks different, `git status` is
clean for the guide pictures, the promo images and the video posters. Videos cannot be compared that way (two
takes of a scenario differ in most frames), so a scenario that is filmed always replaces its MP4 and GIF:
pass the names of the scenarios that changed instead of filming all six.

`build-guides.mjs` turns `src/guides` (the data the Help tab shows) into `docs/guides/<id>.md`,
`docs/guides/README.md` and one real screenshot per step in `docs/guides/img/`. Run it again whenever a guide
in `src/guides` changes.

```bash
npm run media:guides -- --only regions,sliders     # pictures of these guides only (every page is rewritten)
npm run media:guides -- --only regions --step 3    # one picture
npm run media:guides -- --no-shots                 # pages only, from the pictures already in docs/guides/img
npm run media:guides -- --root                     # the build in the repository root instead of the sources
npm run media:guides -- --port 9352 --work /tmp/etz-guides --out /tmp/guides
npm run media:guides -- --keep-raw                 # keep the uncropped captures in <work dir>/guides-raw
```

A step whose picture fails is tried once more and then reported; the run ends with a check of every page
(links, pictures, tables, the chart block) and exits with code 1 when anything is wrong.

A step whose `shot.actions` open a menu (`{ menu: 'add' }`) is pictured on the chart of the step before, or on
a new chart for a first step: the menu is what the reader sees before the result of the step exists.

`build-promo.mjs` captures the plugin, compiles the exported LaTeX and composes the images from the HTML
templates in `promo/`. Its own notes are in [promo/README.md](promo/README.md).

```bash
node scripts/media/build-promo.mjs --only card-sliders,card-3d
node scripts/media/build-promo.mjs --skip-capture  # compose again from the last captures in promo/shots
node scripts/media/build-promo.mjs --plugin root --port 9353 --work /tmp/etz-promo --out /tmp/promo
```

`build-video.mjs` films one scenario per file in `video/`. Its own notes are in
[video/README.md](video/README.md).

```bash
node scripts/media/build-video.mjs clip-sliders clip-3d    # only these scenarios
node scripts/media/build-video.mjs --list                  # names and lengths
node scripts/media/build-video.mjs --sheets /tmp/sheets    # keep the contact sheets: look at them before publishing
node scripts/media/build-video.mjs --out /tmp/video --work /tmp/etz-video --retries 0
```

### The smoke test

`smoke.mjs` checks what no node test can. It prints one `PASS` / `FAIL` line per check:

- Obsidian starts and the plugin loads (also from a brand new profile);
- the editor opens on an empty chart with all example tiles;
- in Help, the figure of a guide step with `$...$` labels, the first chart of the run to use them, ends up with
  label boxes as wide as the labels (MathJax styles a new formula only after its first drawing, so the figure
  has to draw again by itself);
- every example in `EXAMPLES` (`src/migrate.ts`) and every chart of every guide in `src/guides` (the finished
  chart and each step) loads through the editor with no issue and no status chip;
- the four tabs show their panels, and the Code tab holds a standalone `tikzpicture`;
- the Sliders dock sets a value;
- drag to edit with real mouse events: dragging the objective line of the Linear program example moves slider
  `c` from 9 to 10.2 and Cmd/Ctrl+Z puts it back; Shift-drag turns the line around the optimum (3, 1);
  Escape during a drag puts the condition back, also while Shift is still held;
- typing a formula and pressing Enter adds a function;
- Insert into note writes the block, the chart renders in the note with its slider strip, moving a slider in the
  note does not write the file, clicking the chart reopens it, and Save changes writes it back;
- the dark theme draws;
- the "What's new" popup: no popup at the start (the toolkit's `data.json` marks it seen); with data like a 3.x
  user's (no record of the popup) a reload of the plugin, as after an update, shows it once with its title, its
  icons and the live example, and records it in `data.json` without touching the rest; the example follows its
  slider and play, and a typed value outside the slider's range stops at its end; after Close a reload shows
  nothing; no `data.json` but a note with an easy-tikz block (a 3.x user who never changed a setting) shows it
  once; no `data.json` and no block in the vault (a fresh install) shows nothing and records it as seen; an
  unreadable `data.json` stays on disk as it is; the setting switches it off, and loading the plugin writes
  nothing; the command opens it, and Try an example opens the editor on its chart; every icon id it uses draws
  (an id Obsidian does not know leaves the icon blank); closing it while it plays logs nothing; the link in the
  Help tab opens it, its buttons act on that editor, and cancelling the Replace dialog keeps the Help tab;
- nothing was logged to the console as an error during the whole run.

A failed check saves a screenshot to `<work dir>/smoke/fail-<n>.png` and names it.

## Ports and work dirs

One port and one work dir per script, never shared:

| Script | Port | Default work dir |
| --- | --- | --- |
| `smoke.mjs`, `lib/example.mjs` | 9341 | `<tmp>/easy-tikz-media/port-9341` |
| `build-guides.mjs` | 9342 | `<tmp>/easy-tikz-media/port-9342` |
| `build-promo.mjs` | 9343 | `<tmp>/easy-tikz-media/port-9343` |
| `build-video.mjs` | 9344 | `<tmp>/easy-tikz-media/port-9344` |
| `brand/build.mjs` | 9371 | `<tmp>/easy-tikz-media/brand-9371` |
| `cinema/build.mjs` | 9373 | `<tmp>/easy-tikz-media/port-9373` |

`<tmp>` is `os.tmpdir()`. Override with `--port` / `--work` where a script takes them, or with the environment
variables `ETZ_MEDIA_PORT` and `ETZ_MEDIA_WORK`. `ETZ_MEDIA_PLUGIN=root` makes every script use the build in the
repository root instead of bundling the sources.

A work dir holds `vault/` (the notes a script wrote, `.obsidian/plugins/easy-tikz/`), `userdata/` (the profile)
and `obsidian.log`. It is wiped at the start of each run. The toolkit only wipes a directory it created itself
(it leaves a `.etz-media-workdir` marker) and refuses your home, your Obsidian profile and anything that looks
like a vault.

## Where output goes

- `smoke.mjs` writes nothing but failure screenshots in its work dir.
- A build script replaces a picture in `docs` only when the new one shows something else (see "What a run
  changes" above).
- `lib/example.mjs` writes to `--out` (default `<tmp>/easy-tikz-media/example`).
- `build-guides.mjs` and the first-round scripts write into the repository: `docs/guides/` and `docs/media/`
  (the first-round scripts never write `hero.png`, `card-drag.png`, `overview.*` or `clip-drag.*` there).
- `brand/build.mjs` and `cinema/build.mjs` write to `--out` or a temporary folder, never into `docs/`; only
  the brand sheet `brand/specimen.png` is written into the repository.
- A recording keeps its frame PNGs in the `dir` you give the recorder and deletes them after `encode()`
  (pass `keepFrames: true` to keep them; one minute at 30 fps is about 1 GB).

## Writing a capture script

```js
import { launch, importTs, chartBlock } from './lib/obsidian.mjs';
import { createRecorder } from './lib/record.mjs';

const { EXAMPLES } = await importTs('src/migrate.ts');      // any pure TypeScript module of the repository
const lp = EXAMPLES.find((e) => e.id === 'lp').data;

const obs = await launch({ port: 9342, width: 1440, height: 900, theme: 'light' });
try {
    await obs.openEditor({ chart: lp });
    await obs.screenshot('out/editor.png', { clip: 'editor', padding: 24 });
} finally {
    await obs.quit();                                         // always: no instance is left running
}
```

`lib/example.mjs` is a complete script to copy from.

### launch(options)

| Option | Default | Meaning |
| --- | --- | --- |
| `port` | 9341 | debugging port |
| `workDir` | `<tmp>/easy-tikz-media/port-<port>` | vault, profile and log |
| `width`, `height` | 1440 x 900 | page size in CSS px; pictures are 2x (`scale`) |
| `theme` | `'light'` | or `'dark'` |
| `plugin` | `'source'` | `'source'` bundles the current sources into the vault; `'root'` copies `main.js`, `styles.css`, `manifest.json` from the repository root; a path copies from that folder |
| `pluginData` | `{ dragTipSeen: true, whatsNewSeen: '<version>' }` | merged into the plugin's `data.json` (`DEFAULT_PLUGIN_DATA`; the version is `WHATS_NEW_VERSION` of `src/whatsnew.ts`, so no picture shows the "What's new" popup). Pass `{ dragTipSeen: false }` to see the one-time first-hover tip, `{ whatsNewSeen: undefined }` for data like a user's who updated (the popup opens once), or `null` for no `data.json` at all (a fresh install; the popup opens when a note of the vault holds an easy-tikz block, as for a 3.x user who never changed a setting) |
| `notes` | `{}` | `{ 'Name.md': 'markdown' }` written before the app starts |
| `appConfig`, `corePlugins` | | merged into `.obsidian/app.json` and `core-plugins.json` |
| `sidebars` | `false` | both sidebars collapsed |
| `shield` | `true` | the window ignores the real mouse and stays behind other windows |
| `ignoreErrors` | `[]` | `RegExp[]` of console errors that do not count |
| `quiet` | `false` | no progress lines on stderr |

The vault is set up for calm pictures: spell check off, and the core plugins that only add ribbon icons or
status bar items (word count, backlinks, sync, ...) off. Inline titles are on, as in a new vault, so a note
shows its file name as the title: do not repeat it as a `#` heading. Native menus are off
(`nativeMenus: false`): on macOS Obsidian would otherwise pop up system menus for "+ Add" and the header menu,
which no screenshot can show and which block the app while they are open.

### The session object

Window and app

| Call | Does |
| --- | --- |
| `setWindowSize(w, h)` | exact page size. The window is resized when the screen can hold it; a larger size is laid out by device metrics emulation (same pictures) |
| `setTheme('light' \| 'dark')` | `app.changeTheme`, then redraws the open chart in the new colours |
| `setSidebars(true \| false)` | expand or collapse both sidebars |
| `shield(true \| false)` | see `shield` above; `shield(false)` brings the window to the front for watching |
| `versions()` | `{ obsidian, plugin }` |
| `quit()` | closes the connection and stops the app |

Editor

| Call | Does |
| --- | --- |
| `openEditor({ chart, keepDraft })` | runs the command "Easy TikZ: Open editor" and waits for the first render. Forgets the autosaved draft first, so no "Unsaved chart" banner shows, unless `keepDraft: true` |
| `closeEditor()` | closes it |
| `loadChart(data)` | the modal's public `loadChart` (the path the examples use). Answers "Replace the current chart?" with Replace |
| `showTab('build' \| 'chart' \| 'code' \| 'help')` | the modal's public `showTab` |
| `reveal(source, field?)` | expands and scrolls to a card: `'f1'`, `'R1'`, `'label:0'`, or a slider name. With `field` (`'expression'`, `'condition:2'`, ...) the field is focused; without it nothing keeps the focus, so no caret is in the picture |
| `setSlider(name, value, { scope })` | sets a slider as a drag to that value would (`input` then `change`); `scope: 'note'` for the strip under a chart in a note |
| `sliderValue(name, { scope })` | the value its range input shows |
| `insertIntoNote()` | a real click on "Insert into note" / "Save changes"; waits until the editor closed |
| `waitForRender({ settle })` | resolves when the picture is final: no render timer pending, charts in the note drawn, CSS transitions finished |
| `waitForSelector(css, { gone })` | waits for something visible to match (a menu, a dialog) |
| `chart()` | the chart as Insert would write it |
| `issues()`, `statusChip()` | problems of the last render; the chip text or `null` |
| `editorState()` | `{ tab, is3D, cta, banner, undo, hint, narrow }` |
| `previewInfo()`, `codeText()` | what the preview drew; the LaTeX in the Code tab |

Notes

| Call | Does |
| --- | --- |
| `writeNote(name, markdown)` | creates or overwrites a note. `chartBlock(data)` returns the fenced `easy-tikz` block |
| `openNote(name, { mode, cursor })` | `mode`: `'reading'` (default), `'live'`, `'source'`. Waits for the charts to render. For Insert into note open the note in `'live'` mode: the cursor is put at the end |
| `readNote(name)` | the text (an open editor is saved first) |
| `noteCharts()` | `[{ drawn, sliders, issues, width }]` for the charts in the active note |
| `editChartInNote(index)` | a real click on the chart; waits for the editor it opens |

Input (real events through the DevTools protocol, so hover states, drags and typing behave as for a user)

| Call | Does |
| --- | --- |
| `mouse.move(target, { steps })` | moves the pointer; `steps` intermediate events, eased |
| `mouse.down()`, `mouse.up()`, `mouse.click(target, { count })` | press, release, click (`count: 2` double-clicks) |
| `mouse.drag(path, { shift, alt, steps, hold })` | press on the first target, move through the others, release. `shift` / `alt` hold the key for the gesture. `hold: true` keeps the button down for a picture; call `mouse.up()` and `keyUp('Shift')` afterwards |
| `mouse.wheel(target, deltaY)` | wheel (zooms the preview) |
| `hover(target, { shift })` | rests on a shape until the hover tip shows and returns its text. `shift: true` holds Shift (pivot ring); call `keyUp('Shift')` afterwards |
| `type(text, { delay })` | types into the focused field, one key press per character |
| `key(name, { mod, shift, alt })` | `key('Enter')`, `key('z', { mod: true })`, `key('ArrowLeft', { shift: true })` |
| `keyDown(name)`, `keyUp(name)` | hold a modifier across other calls |
| `selectAll()` | selects the focused field's text |
| `blur()` | drops the keyboard focus, so no caret or focus ring is in the picture |

A target is one of:

| Target | Means |
| --- | --- |
| `[x, y]` | math coordinates of the 2D editor preview, mapped through the modal's own layout (`mathToClient`) |
| `{ x, y }` | client px |
| `'css selector'` | centre of the first visible match (scrolled into view) |
| `{ selector, text, at }` | first visible match whose trimmed text is `text`; `at: [fx, fy]` picks a point inside it |
| `{ preview: [fx, fy] }` | fractions of the editor's chart box; works in 3D, where a drag rotates |
| `{ slider: 'c', value: 12, scope }` | where the thumb of slider `c` sits for that value (omit `value` for where it is now) |

`mathToClient(x, y)`, `clientToMath(x, y)`, `point(target)` and `clipRect(clip)` return the numbers.

Pictures

`screenshot(file, { clip, padding, scale })` writes a PNG at 2x and returns `{ file, width, height }`.

| `clip` | Shows |
| --- | --- |
| `'window'` | the whole window (default) |
| `'editor'` | the editor modal |
| `'preview'` | the chart picture alone (in 3D: the chart box) |
| `'stage'` | the preview with its buttons, status chip and readout |
| `'panel'`, `'dock'` | the left column of the editor; the Sliders dock |
| `'note'`, `'page'` | the active note; its text column only |
| `'inline'` | the first chart in the note with its slider strip |
| a CSS selector, or `{ x, y, width, height }` | that element or rectangle |

`padding` (a number, or `[horizontal, vertical]`) adds space around the clip and stays inside the window.
`scale` sets the output size relative to 2x: `0.5` gives a 1x picture, and since the editor is 1325 CSS px wide
in the default 1440 x 900 window, `{ clip: 'editor', scale: 0.6 }` gives a picture about 1590 px wide.

Errors

`obs.errors` collects uncaught exceptions, `console.error` calls and error-level log entries as
`{ type, text, at }`. `obs.clearErrors()` empties it.

Anything else: `obs.call(fn, ...args)` runs a function in the page (it is sent as source text, so it can use only
its arguments and the page's globals, such as `app`), and `obs.cdp.send(method, params)` sends a raw protocol
command.

### Recipes

The hover tip, then the pivot ring, then a drag frozen in the middle:

```js
await obs.openEditor({ chart: lp });
console.log(await obs.hover([1.5, 2]));                   // "C1: 2x + 3y = c Drag to move ..."
await obs.screenshot('hover.png', { clip: 'stage' });

await obs.hover([1.5, 2], { shift: true });               // pivot ring at (3, 1)
await obs.screenshot('pivot.png', { clip: 'stage' });
await obs.keyUp('Shift');

await obs.mouse.drag([[1.5, 2], [1.5, 2.5]], { shift: true, hold: true });
await obs.screenshot('turning.png', { clip: 'stage' });   // ghost line, pivot, live tip
await obs.mouse.up();
await obs.keyUp('Shift');
```

A chart in a note with its slider strip:

```js
await obs.writeNote('Linear program', `Some text.\n\n${chartBlock({ ...lp, displayWidth: 560 })}\n`);
await obs.openNote('Linear program');
await obs.setSlider('c', 6, { scope: 'note' });
await obs.screenshot('note.png', { clip: 'inline', padding: 16 });
```

Insert from the editor, then edit from the note:

```js
await obs.writeNote('Demo', 'A chart:\n\n');
await obs.openNote('Demo', { mode: 'live' });
await obs.openEditor({ chart: lp });
await obs.insertIntoNote();
await obs.editChartInNote(0);                              // the editor again, button "Save changes"
```

Menus and dialogs, with real clicks (find things by their visible text):

```js
await obs.mouse.click('.modal.tikz-modal .etz-build-add');                       // "+ Add"
await obs.waitForSelector('.menu');
await obs.screenshot('add-menu.png');
await obs.mouse.click({ selector: '.menu .menu-item', text: 'Feasible region (inequalities)' });
await obs.waitForRender();

await obs.mouse.click('.modal.tikz-modal .etz-header button[aria-label="Examples and templates"]');
await obs.waitForSelector('.menu');
await obs.mouse.click({ selector: '.menu .menu-item', text: 'Tangent explorer' });
await obs.waitForSelector('.modal.etz-dialog');                                  // "Replace the current chart?"
await obs.mouse.click({ selector: '.modal.etz-dialog button', text: 'Replace' });
await obs.waitForRender();

await obs.mouse.click({ selector: '.modal.tikz-modal .etz-tab', text: 'Code' }); // a tab
await obs.mouse.click({ selector: '.modal.tikz-modal .etz-build-example', at: [0.5, 0.3] });   // first example tile
```

Escape closes an open menu; with no menu open it closes the editor.

Typing a formula, and the quick fix under the field:

```js
await obs.openEditor();
await obs.mouse.click('.modal.tikz-modal .etz-build-start input');
await obs.type('a x^2 - 3x');
await obs.waitForSelector('.modal.tikz-modal .etz-build-start .mod-quickfix');   // "Add slider a"
await obs.mouse.click('.modal.tikz-modal .etz-build-start .mod-quickfix');
await obs.waitForRender();
```

A 3D chart: rotate by dragging across the chart box.

```js
await obs.loadChart(EXAMPLES.find((e) => e.id === 'plane3d').data);
await obs.mouse.drag([{ preview: [0.4, 0.5] }, { preview: [0.6, 0.45] }], { steps: 20 });
```

## Recording video

`lib/record.mjs` is a deterministic frame recorder. A scenario performs small steps and takes a frame after
each one; every frame is one tick of a 30 fps clock, however long the capture took. Nothing is filmed in real
time, so a recording comes out the same on a slow and on a fast machine.

```js
const rec = await createRecorder(obs, { dir: 'out/frames', clip: 'editor', padding: [24, 60], caption: { margin: 8 } });
await rec.caption('Drag the objective line: slider c follows');
await rec.hold(0.4);
await rec.drag([[1.5, 2], [2.1, 2.4]], { seconds: 1.0 });
await rec.caption('Or drag the slider');
await rec.slider('c', 9, { seconds: 0.8 });
const files = await rec.encode({ out: 'out/demo' });       // demo.mp4, demo.gif, demo-sheet.png, demo-poster.png
await rec.close();
```

| Call | Does |
| --- | --- |
| `createRecorder(obs, { dir, fps, clip, padding, scale, cursor, cursorScale, caption, keepFrames })` | `clip` and `padding` as for `screenshot`, resolved once: all frames have one size. `scale: 0.5` films at 1x, about twice as fast. `caption: { position: 'bottom' \| 'top', margin, size }` or `false` |
| `frame(repeat)` | captures the screen as the next frame (shown for `repeat` frames) |
| `hold(seconds)` | one capture shown for that long: for a still screen |
| `live(seconds)` | captures in real time: for things that animate on their own (slider play, the 3D canvas settling) |
| `caption(text)` | sets the caption bar; `''` hides it |
| `move(target, { seconds })` | glides the pointer, one frame per step |
| `click(target, { seconds, count, pause })` | glide, press (the pointer shows a ring), release |
| `drag(path, { seconds, approach, shift, alt, hold, settle })` | glide to the start, press, drag with one frame per step, release. With `shift` the pivot ring is shown for half a second before the press |
| `slider(name, value, { seconds, scope })` | drags a slider's thumb with the mouse |
| `type(text, { cps })` | types at `cps` characters per second |
| `key(name, mods, { pause })` | a key press and what it does |
| `showCursor(false)` | hides the drawn pointer |
| `encode({ out, ... })` | writes `<out>.mp4` (H.264, yuv420p, faststart, CRF 20), `<out>.gif` (palettegen + paletteuse, 960 px wide, 15 fps), `<out>-sheet.png` (contact sheet, 5 x 4 tiles spread over the recording) and `<out>-poster.png` (last frame). Options: `mp4`, `gif`, `sheet`, `poster` (false skips one), `mp4Width`, `crf`, `gifWidth`, `gifFps`, `gifColors`, `gifDither`, `sheetColumns`, `sheetRows`, `posterFrame` (`'first'`, `'middle'`, `'last'` or a frame number). Returns `{ frames, seconds, mp4, gif, sheet, poster, bytes }` |
| `close()` | removes the pointer and the caption bar from the page |

The caption bar sits inside the clip, `margin` px from its bottom (or top) edge. To keep it off the editor,
film the editor with vertical padding and put the bar into that band: the modal is 86 % of the window height, so
at 900 px there are 63 px above and below it (`padding: [24, 60], caption: { margin: 8 }`).

Look at the contact sheet before you publish a video: it shows at a glance whether a step was captured half
drawn, a caption is wrong or the pointer went somewhere odd.

To make a GIF smaller: `gifWidth: 800`, `gifFps: 12`, `gifColors: 128`, or `gifDither: 'none'`.

## Composed pages (promo cards)

`lib/chromium.mjs` renders an HTML file to a PNG of exact size with headless Chromium (the one Playwright keeps
in `~/Library/Caches/ms-playwright`, or `CHROMIUM_BIN`). Use it for images composed around real screenshots; it
is not Obsidian and never shows the plugin running.

```js
import { launchChromium } from './lib/chromium.mjs';

const chrome = await launchChromium({ port: 9343 });
try {
    await chrome.render('scripts/media/promo/hero.html', 'docs/media/hero.png', { width: 2400, height: 1350 });
    await chrome.render('scripts/media/promo/social.html', 'docs/media/social-1280x640.png', { width: 1280, height: 640 });
} finally {
    await chrome.close();
}
```

`render(page, out, { width, height, scale, query, selector, transparent, settle })` waits for fonts and images
(it fails when an image does not load), then captures the viewport, or one element with `selector`. `scale: 2`
doubles the pixels. `chrome.errors` lists console errors of the pages, and `chrome.cdp` is the raw client
(`lib/cdp.mjs`: `send`, `evaluate`, `call`, `screenshot`, `on`).

## How it works, and what to know when something breaks

- **Start.** `launch` prepares the work dir, starts Obsidian with `--remote-debugging-port`, a private
  `--user-data-dir`, `--force-device-scale-factor=2` and three flags that keep the page painting while the
  window is covered (without them screenshots hang), then connects to the page `app://obsidian.md/index.html`.
- **New profile.** A new profile starts in restricted mode behind "Do you trust the author of this vault?".
  Clicking through that dialog opens the settings in a second window, where the editor would then open too. So
  the toolkit switches community plugins on (`app.plugins.setEnable(true)`) and reloads the app once: it then
  starts like any trusted vault.
- **The editor modal.** Obsidian keeps no list of open modals, so the toolkit wraps `Modal.prototype.open` in
  the page to remember the editor. It reads these private fields of `TikzModal` (`src/modal.ts`), which exist at
  runtime because the bundle is not minified: `settings`, `layout`, `chartEl`, `chartSvg`, `issues`, `frameRaf`,
  `fullTimer`, `updateTimer`, `statusTimer`, `codeTimer`, `activeTab`, `build`, `dock`, `ready`. If one is
  renamed, `openEditor()` fails with a message that names it: update `MODAL_FIELDS` and `pageHooks` in
  `lib/obsidian.mjs`. The toolkit also relies on these class names: `tikz-modal`, `etz-stage`, `etz-chart`,
  `etz-dock`, `etz-editor`, `etz-status-chip`, `etz-drag-hint`, `etz-undo`, `etz-actionbar`, `etz-dialog`,
  `etz-tab`, `etz-tabpanel`, `etz-code-textarea`, `etz-inline`, `etz-inline-box`, `etz-inline-strip`,
  `etz-inline-issues`, `tikz-hidden`.
- **Scroll bars.** macOS chooses the scroll bar style from the pointing devices: with a mouse connected,
  scroll bars are always visible and take 15 px of every scrolling panel; with a trackpad alone they overlay
  the content and show only while scrolling. The same script would so give different pictures on the same
  Mac. `launch` passes `-AppleShowScrollBars WhenScrolling` to its Obsidian (a default for that one process;
  your system setting and your own Obsidian are not changed), which pins the overlay style, and prints a
  warning if the app still reserves space for scroll bars.
- **Window size.** The window is resized through Obsidian's own `electron.remote`. A size the screen cannot
  hold (more than about 1000 px high on a 14 inch MacBook) is laid out with `Emulation.setDeviceMetricsOverride`
  instead; clicks and pictures use the same coordinates either way.
- **Math coordinates.** `[x, y]` targets use the modal's `layout` (plot rectangle and view of the last render)
  and the on-screen box of the SVG: the inverse of the modal's own `toMath`. They are valid until the view
  changes (pan, zoom, a new chart): resolve them again afterwards. 3D charts have no such layout; use
  `{ preview: [fx, fy] }`.
- **Leftovers.** If a script is killed, its Obsidian may stay open. The next `launch` on the same work dir
  stops it first (it is found by its `--user-data-dir`, so your own Obsidian is never touched). By hand:
  `pkill -f "user-data-dir=<work dir>/userdata"`.
- **"Port ... is in use".** Another script runs on that port. Pass `--port`.
- **The plugin does not load.** Read `<work dir>/obsidian.log`. A source build needs the sources to bundle:
  `npx tsc -noEmit -skipLibCheck` shows what is broken.
- **A picture shows a half-open card or a fading highlight.** Call `await obs.waitForRender()` before the
  screenshot: it also waits for CSS transitions.
- **A `$...$` label or a legend entry sits a few pixels off in a picture.** A formula that is new in the session
  is drawn twice: once before MathJax has styled it, and again a moment later with its real size.
  `waitForRender()` does not know about the second drawing. After loading a chart with new math labels, wait
  about half a second (`await obs.sleep(500)`) and call `waitForRender()` again; `build-guides.mjs` redraws
  until the label sizes stop changing.
- **Charts further down a note are missing.** Obsidian renders a note's sections when they scroll into view.
  Keep the chart near the top, or scroll to it first.
