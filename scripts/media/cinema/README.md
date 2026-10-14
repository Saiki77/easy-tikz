# Cinema: the videos, in two passes

The videos of Easy TikZ 4 are films in the "Math notebook" identity of [`../brand`](../brand/README.md): the
editor lies on a page of graph paper as its figure, a camera pushes in on what happens, a drawn pointer shows
the hand, and captions, margin notes, the title card and the end card are set in the TeX fonts of the brand.

What is filmed is the real plugin in a real Obsidian, driven by real mouse and keyboard events
([`../lib/obsidian.mjs`](../README.md)). What is added around it is not UI of the plugin: paper, camera,
pointer, click rings, a keycap while a key is held, captions, callout arrows with their notes and the two cards.

```bash
node scripts/media/cinema/build.mjs sample --out /tmp/cinema                 # capture, then composite
node scripts/media/cinema/build.mjs overview --out /tmp/cinema --port 9381   # the overview (two sections)
node scripts/media/cinema/build.mjs sample --out /tmp/cinema --skip-capture  # edit again: composite only
node scripts/media/cinema/build.mjs sample --out /tmp/cinema --skip-capture --stills 2.4,6.2,9
node scripts/media/cinema/build.mjs sample --out /tmp/cinema --skip-capture --stills every:0.5
node scripts/media/cinema/build.mjs --list
node scripts/media/cinema/timeline.test.mjs                                  # the pure parts, no app needed
```

`npm run media:film -- <scene> [options]` is the same as `node scripts/media/cinema/build.mjs <scene>`, and
`npm test` runs `timeline.test.mjs` as well. A film goes to `--out`, by default `<work>/cinema-out`, never into
`docs/media`: look at the sheets and the stills, then copy `<name>.mp4`, `<name>.gif` and `<name>-poster.png`
there. The overview and the drag clip of the README are `overview` and `sample --name clip-drag`.

Options: `--port 9373` (Obsidian for the capture, then headless Chromium for the composite, one after the
other), `--work DIR` (profile, vault and the raw frames; default `<tmp>/easy-tikz-media/port-<port>`),
`--name NAME` (file name of the outputs), `--fps 60`, `--retries 2`, `--keep-master`, `--no-loop`,
`--plugin root`.

Requirements, besides those of the media toolkit: `ffmpeg`, ImageMagick (`magick`), a TeX Live with New
Computer Modern and Latin Modern (the brand's fonts, found with `kpsewhich`), and optionally `img2webp`
(libwebp) for the WebP loop. Nothing is installed by these scripts.

## The two passes

**1. Capture** (`capture.mjs`). A scene plays against the isolated Obsidian at full screen size (1728 x 1117
CSS px, 2x). Nothing is drawn into the page. Two things are written into `<work>/cinema/<scene>/`:

- raw frames: the whole window as 3456 x 2234 px PNGs, one per tick of a clock of 30 per second, a picture
  that equals the one before it only once (the sample: 203 pictures, 100 MB, for 14.1 s);
- `track.json`, the event track: which picture is on screen when, the pointer's position at every tick, when
  the button and which keys are down, the beats (caption, and the rectangle of the UI the beat is about,
  taken from the app's own element boxes), the callouts, the part of the window that is the film's figure,
  the pictures that become the figures of the cards, the frame that makes the poster, and the facts the scene
  read from the app and printed (a slider's value before and after a drag).

**2. Composite** (`edit.mjs`, `compose.mjs`, `stage.html`). The edit turns the track and the scene's cards
into a film: a plain object that says, for any second, where the camera is and what is on. Headless Chromium
then draws every frame of the output on the stage page, with the brand kit, and the frames are piped into
ffmpeg. No frame of the output touches the disk as a picture.

Because the passes are separate, a film can be edited again in a minute or two (`--skip-capture`): other
captions, other cards, another frame rate, another rhythm of the stage (`TIMING` in `timeline.mjs`), and the
`pad`, `align`, `zoom`, `move` of a beat or the place of a note, which are read from the track and can be
changed there. A change to what the app does, or to a rectangle the scene measures in the app, needs a new
capture.

```
scenes/<name>.mjs ──▶ capture.mjs ──▶ raw-00001.png ...  track.json
                                              │
                               edit.mjs ◀─────┘    makeFilm(): camera keys, captions, callouts, pointer, cards
                                   │
        stage.html + stage.mjs ◀───┘    draws stateAt(film, t)   (timeline.mjs: the clock, pure functions)
                   │  PNG per frame, piped
                   ▼
              compose.mjs ──▶ <name>.mp4, .gif, .webp, -poster.png, -sheet-NN.png, -still-N-<moment>.png
```

## What a film looks like

| Part | Rule |
| --- | --- |
| Page | 1920 x 1080. The brand's paper: unit 29 px, margin rule, running head on grid line 2. The page never moves and never changes its scale: no hairline of its grid can shimmer. The camera moves the figure only |
| Figure | A crop of the window: the editor's modal with its own corner radius (`d.figure('editor')`, the default when the editor is open), so no dimmed workspace can come into a close-up. In the wide shot it is 48 x 32 units, all four edges on grid lines, 72 % of the frame's width. `d.figure('window')` shows Obsidian whole: once, in the opening shot of the overview |
| Title card | The film's title set like the title of a paper (`§1 Drag to edit`), one sentence with the one highlighted phrase (the stroke draws on), and at the right a figure: a picture of the capture with a "Figure 1." caption. It is complete in the first frame (the frame a player shows before it plays) |
| Section card | Between two parts of a film (`d.section()`): the title card's twin (`§2 Dynamics`, one sentence, its highlighter stroke, a figure of the part to come with its caption). The window leaves the page as at the end, the card comes in as the end card does, is held complete for its `seconds` (2 by default, 1.5 at least), and leaves upwards while the window comes back. What the scene did between the parts (load the next chart, tidy, park the pointer) was never filmed |
| Transitions | The window slides onto the page from under the lower edge of the frame (0.45 s, slowing down as it lands, its shadow growing) while the title leaves, and off it again while the end card comes: opaque all the way, so the page is never seen through the window and is never empty. The first push begins as the window lands, and the window leaves as the pull back ends |
| Camera | Starts on the whole figure. Each beat that names a focus eases there (cubic in and out, 0.6 to 0.9 s) and holds. Between two framings the camera zooms about the one point both show at the same place, so nothing drifts sideways. A hold is exact: the same camera to the last digit, the figure's corner on a whole pixel |
| Framing | The largest zoom that shows the focus above the caption band, never more than 100 % of the capture (the build refuses; that is 2.07x for the editor). `align` puts an edge of the focus on an edge of the frame, so the frame's edges land on edges of the UI; the paper beside the figure is then the margin of the shot, for a note. The sample: the editor edge to edge (1.38x, capture at 67 %), the preview pane with a margin at the right (1.63x, 79 %), the Build panel with a margin at the left (2.07x, 100 %) |
| Pointer | The brand's arrow, a little larger than life. On a free glide it is drawn for every frame of the output; while the button is down it is where it was when the picture on screen was taken, so the hand and the line it holds stay locked. A ring expands and fades on every press and release, where the button went down or up (a hand that moves on leaves it behind, so a release never reads as a drag still held), a steady ring is held during a drag, and a keycap stands beside it while a key is down |
| Captions | One line at the margin, lower third, 56 px (28 px in a 960 px loop), at most 8 words, one per beat, on for at least 3 s; formulas between `$...$` are typeset by `../brand/math.mjs`. They fade and slide 12 px in and out. Under them lies the band: the same page again over the lower edge of the figure, about 190 px high (a mask, not a box). Over the caption stands the chip: the title of the film (or of its section) in small capitals, on for as long as the camera is in |
| Callouts | One at a time. A note in the brand's italic (38 px) and an arrow that draws on in 0.4 s and points at the spot. A note stands on free ground: in a free part of the UI (`dx`, `dy` from the spot), or on the page in the margin of the shot (`place`, in grid units), where it may also be numbered equations (50 px; `size: 0.85` sets them at the brand's 36 design px, for a block that needs the room). Nothing is set under 28 design px (the build refuses) |
| End card | "Easy TikZ 4", a rule that draws on, where to install it, the source, the licence, and at the right a figure of the capture ("Figure 2.", or "Figure 3." after a section card). It is held complete for 3 s in the overview and at least 2.2 s in a clip (`end.seconds`). The last frame is the whole card |

Numbers in a film come from the app: the scene reads a value, checks it (`d.expect`) and builds the caption or
the note from it. A scene that does not do what its captions say fails and writes nothing.

## Writing a scene

```js
export default {
    name: 'clip-drag',
    title: { secno: '§1', text: 'Drag to edit', lead: 'Drag a line and [[its numbers follow]].', seconds: 1.9 },
    end: { seconds: 2.2 },               // the card itself is END_CARD in edit.mjs
    seconds: [10, 14],                   // the length the film must have, cards included

    async setup(d) {                     // not filmed
        await d.obs.openEditor({ chart: d.charts.lp });
        await d.tidyBuild({ collapse: ['P2'] });
        await d.figure('editor');        // the figure of the film (the default when the editor is open)
        await d.park([3.6, 2.9]);        // where the pointer waits: inside the frame of the first beat
    },

    async run(d) {                       // filmed
        await d.hold(0.35);              // the window slides onto the page; the push begins as it lands
        await d.cardFigure('title', 'preview', { label: 'Figure 1.', text: 'The Linear program example.' });
        await d.beat({ id: 'drag', caption: 'Drag the line $2x + 3y = c$.', focus: { columns: 'editor', rows: 'dock' }, pad: [0, 0, 0, -12], align: 'bottom' });
        await d.rest([1.25, 0.83], { seconds: 1 });
        await d.dragStart([[1.25, 0.83], [1.87, 1.76]], { seconds: 2.2, approach: 0 });
        await d.callout({ at: { selector: '.modal.tikz-modal .etz-dock-value', at: [1, 0.5] }, text: '$c: 5 -> 9$', dx: 170, dy: 0, bend: -0.08 });
        await d.dragHold(0.4);
        d.poster();
        await d.dragEnd({ pause: 1.2 });
        await d.beat({ id: 'back', focus: 'window' });
        await d.hold(0.8);               // the window leaves as the pull back ends
        await d.cardFigure('end', 'preview', { label: 'Figure 2.', text: 'After the drag: $c = 9$.' });
    },
};
```

`d` is the director of `createCapture()`. It keeps the calls of the first video toolkit
([`../video/README.md`](../video/README.md)), so the interaction of an existing scenario moves over as it is:
`d.hold`, `d.move`, `d.click`, `d.rest`, `d.drag`, `d.dragStart`, `d.dragTo`, `d.dragHold`, `d.dragEnd`,
`d.slider`, `d.type`, `d.key`, `d.realtime`, `d.poster`, `d.expect`, `d.park`, `d.obs`, `d.ui`, `d.charts`,
`d.chartBlock`. `d.caption(text)` still works (a beat without a camera move). `d.lens()` is gone: the camera
does that job now.

What is new:

| Call | Does |
| --- | --- |
| `d.figure(spec, { radius })` | The part of the window that is the film's figure (see above). Moved inwards onto whole pixels of the capture |
| `d.beat({ id, caption, focus, pad, align, zoom, minZoom, move, lead })` | A new beat. `caption`: leave out to keep the one that is on, `''` to clear it. `focus`: what the camera frames, see below; `'window'` is the wide shot (it ends the caption that is on: there is no band there); leave out to keep the camera. `pad`: px of the output kept free around the focus (a number, `[x, y]` or `[left, top, right, bottom]`; the lower edge is the top of the caption band; a negative value lets the focus run under the band). `align`: `'left'`, `'right'`, `'top'`, `'bottom'` or a pair: that edge of the focus lies on that edge of the frame |
| `d.rect(spec)` | A rectangle of the UI in window px: `'editor'`, `'stage'`, `'preview'`, `'dock'`, `'panel'`, `'note'`, `'inline'`, a CSS selector, `{ math: [[x, y], ...] }` (the box around points of the 2D preview), `{ slider: 'c' }`, `{ of: spec, grow: n }`, `{ columns: spec, rows: spec }` (as wide as one and as high as another), or an array (the box around all of them). A beat's `focus` takes the same, or a plain `{ x, y, width, height }` the scene has worked out |
| `d.callout({ at, text, side, dx, dy, place, in, out, bend, gap, seconds, delay })` | An arrow with a note. `at` is a target as for `d.point`. The note stands `dx`, `dy` px of the output from the spot, on its `side`, or at `place: [x, y]` on the page (grid units: its left edge and first baseline). `in` is the side of the spot the arrow arrives from (degrees as in TikZ); `bend` instead makes a plain arc. `seconds: null` leaves it on until `d.calloutEnd()`. It takes no time itself: hold the picture while it shows |
| `d.callout({ at, equations: [['2x + 3y = c', 'a'], ['[[2.5]]x + 3y = c', 'b']], place })` | The same with numbered equations instead of a note: aligned on their relation sign, each on a grid line, `[[...]]` in the accent. The arrow leaves the last one |
| `d.cardFigure(which, spec, { label, text })` | The picture on screen, cropped to `spec`, becomes the figure of the `'title'` or the `'end'` card, with its caption |
| `d.keyDown(name, { label, side, offset })`, `d.keyUp(name)` | Hold a key. The film shows its keycap beside the pointer; `side` and `offset` move it to free ground |
| `d.dragStart(path, { shift, shiftHold, keycap })` | With `shift` the key goes down once the pointer rests on the shape, and what it shows (the pivot ring) is held before the press |
| `d.tidyBuild({ collapse, lead })` | Before filming, with real clicks and the wheel: close cards, scroll the Build panel so a group heading leads |
| `d.fact(name, value)` | Keep something the app reported in the track; the build prints it |
| `d.section({ secno, text, lead, seconds })` | End a part: a section card follows (see above). Call it with the camera back in the wide shot, the button up, no key held, no callout on and on the real clock; then set up the next part (nothing is filmed until the scene films again) and film its first picture (`d.hold(0.35)`: the window comes back with it) |
| `d.cardFigure('section', spec, { label, text })` | The figure of the last section card: call it after the first picture of its part, which is what it shows |
| `d.clock('film')`, `d.clock('real')` | The time the page's animation frames are handed. On the film clock every picture is one tick (1/30 s) of the page's time, however long a screenshot takes: something that runs on its own clock (a slider's play) moves at its true speed and is filmed in every tick, and a hold takes a picture per tick. `d.realtime()` films the wall clock instead (a picture whenever a screenshot is done: 3 to 7 per second) |
| `d.probe(fn)` | After every picture, `fn(t, file)` reads the app (it must not change it), until `d.probe(null)`: to check a claim about a moving stretch at each of its pictures |
| `d.dragStart(path, { ease })` | How the hand moves along the path (default minimum jerk, rest to rest), as a function of 0..1 to the share of the way. The overview's tangent drag sets the pace by what the picture shows instead: its `sweep()` says where the tangent point is at each moment (slow where the area is large, fast through a = 0, where there is none), and the ease maps that onto the hand's way, measured on the screen |
| `d.rest(target, { tip })` | Wait, before the rest is filmed, until the editor's tip matches `tip` (a pattern). The tip changes about 0.1 s after the pointer stops; until then the tip of a shape passed on the way can still be on (the curve under a tangent point), and the rest would film that one. Better still, come in on a way that touches nothing else: `bow: 0` (straight) and `via`, as for `d.move` |
| `d.move(target, { via, bow })` | `via`: targets the hand passes on its way (round a shape that would answer it, under a pane, along a row of controls), the corners rounded (`smoothPath` in `timeline.mjs`), one minimum-jerk pace along the whole way. `bow: 0` is a straight line. The overview checks every glide of its part 2 with `d.probe`: nothing may light up, show a tip or a tooltip, or lie under the hand but what it goes to |
| `d.beat({ lead })` | Negative: the camera sets off that long after the call, so the hand moves first (a way that would dip under the band while the camera rises, or ride the frame's edge while it pans) |

A scene may also set `title: { card: false }` (a clip: no title card, the film opens on the editor and the
running head carries the title until the chip takes over), `chip: false`, `chip: { secno, text }` (the chip of
the first part, when the title card names the whole film: the overview's title card says "Easy TikZ 4", its
first part is "§1 Drag to edit"), `head: { main, end }` (the running heads), `loop: { from, to }` (the README
loop is that part of the film only, in film seconds) and `capture: '<scene>'` (another edit of a capture that
exists; build it with `--skip-capture`).

Rules a scene follows, besides those of the first toolkit (real input only, check what a caption claims):

- A beat begins with motion: call `d.beat()` and then glide the pointer, so the camera and the hand move
  together and no time is dead. No wide hold: the first beat follows the landing of the window at once.
- Never start a camera move during a drag: put `d.beat()` before the pointer leaves or after the release.
- Frame on edges of the UI. A frame edge that cuts through a row of controls leaves debris; put it on the
  divider between two panes, on the editor's edge, or between two rows, and let the band begin where a pane
  ends. When the focus is narrower than the frame, give the rest to the paper (`align`), not to the next pane.
- Show the result. A caption that says a formula has followed needs that formula in the frame: go to the
  field that shows it.
- Keep the pointer in the frame: park it, in `setup`, at a place the first framing shows. The build notes a
  pointer that leaves the frame or goes under the caption band.
- Aim a callout at free ground and give its note free ground (see the brand's rules for callouts). Look at
  the still of every callout the build writes.
- A gesture must read in a 960 px loop: a turn of a few degrees does not. Swing it (the sample turns its
  line down and up again, 16 degrees in all), and take 2 s rather than 1 for a drag that clicks into snaps.
- A formula in a caption is written as the user types it, between dollar signs: `$2x + 3y <= 12$`.

## Output

| File | What |
| --- | --- |
| `<name>.mp4` | 1920 x 1080, 60 frames per second, H.264 (CRF 18, yuv420p, BT.709, faststart), no audio |
| `<name>.gif` | The loop for a README: 960 px wide, 20 frames per second and 256 colours when that stays under 8 MB, coarser otherwise |
| `<name>.webp` | The same loop as a lossless animated WebP (written when `img2webp` is on the PATH): full colour, somewhat smaller than the GIF |
| `<name>-poster.png` | The frame the scene marked with `d.poster()`, from the lossless master |
| `<name>-sheet-NN.png` | Contact sheets: the frame at every half second, twelve per sheet |
| `<name>-still-N-<moment>.png` | Full size frames of the MP4 at the moments worth a close look: the cards, the first drag, every callout, the poster |

The build prints the zoom of every beat, how long each caption is on, the cadence (how many frames each
picture of a moving stretch stays on: 2 at 60 frames per second), the facts of the scene, how still the holds
are in the MP4 (two frames in a row that were one picture on the stage), seconds of work per second of video
and the disk it used. Look at the sheets and the stills before a film is published.

**The loop of a long film.** The sample costs about 0.35 MB per second as a 960 px GIF at 20 frames per
second, so the whole overview (40 s) would be about 14 MB and the ladder would fall to coarser settings. Its
README loop is a highlight instead: `loop: { from, to }` in the scene, 12 to 18 s of it, with a link to the
MP4 beside it. Let it begin and end on a still frame (a held card, a settled shot), so the jump back to the
start is a cut between two still pictures, and end it before a callout or a caption begins to fade
(0.3 s before the pull back). The overview's loop is §2: the section card, the drag of the tangent point,
play, and the definitions that make it (17.6 s, 4.4 MB).

## Files

| File | What it is |
| --- | --- |
| `build.mjs` | The command line: capture, edit, composite, report |
| `capture.mjs` | Pass 1: `createCapture()` (the director), `readCapture()` |
| `edit.mjs` | `makeFilm()`: the track and the scene's cards become a film; `inspectFilm()`, `reviewMoments()`; the end card's text |
| `timeline.mjs` | The clock: layout of the page and the figure (`stageLayout`), the camera (`solveCamera`, `mixCamera`, `cameraAt`), `stateAt(film, t)`, the rhythm of the stage (`TIMING`). Pure functions, used by Node and by the stage page |
| `stage.html`, `stage.css`, `stage.mjs` | The stage page: draws `stateAt(film, t)` with the brand kit |
| `compose.mjs` | Pass 2: `openStage()`, `compose()`, the loop, contact sheets, stills, `steadiness()` |
| `chrome.mjs` | Headless Chromium for the stage: the toolkit's own binary and client, with two flags that make a screenshot take 35 ms instead of 250 |
| `scenes/` | One file per film |
| `timeline.test.mjs` | Tests of the pure parts: layout, camera, cadence, the pointer's lock, the edit, the stage moment by moment, a film with a section card |

## Things to know

- **Cadence.** The times of a track are ticks of the capture; the edit snaps them onto the tick grid and
  the title card onto whole frames, so every picture of a moving stretch is on for the same number of
  frames (a time rounded to four decimals once came a frame late two times out of three: 2, 3, 1 instead of
  2, 2, 2). The test asserts it and the build prints it.
- **Speed.** The sample (18.9 s at 60 frames per second) took six and a half minutes on a machine that
  was busy with other work (capture 137 s, draw 75 s for 656 different frames, MP4 23 s, the two loops
  127 s, review 21 s), about 20 s of work per second of video; the capture alone ran in under 30 s when
  the machine was quiet. Because the page stands still, only the figure is drawn anew per frame.
  `--fps 30` halves the drawing; `--no-loop` skips GIF and WebP; `--skip-capture` edits again without
  Obsidian.
- **Disk.** Raw frames stay in the work dir (about 0.5 MB each) until the next capture of that scene. The
  lossless master (about 4 MB per second) is deleted after encoding unless `--keep-master` is given.
- **Sharpness.** The figure's picture is scaled once, by the browser, from the 2x capture. At the closest
  zoom one pixel of the capture is one pixel of the output. Nothing is ever enlarged.
- **Holds.** A frame that looks the same as the one before it is not drawn again: the same PNG goes to the
  encoder, so a hold cannot jitter. What is left in the MP4 is the encoder's own rounding (the build prints
  it).
- **A screenshot that never answers.** Once in a thousand or so, a screenshot waits for a frame that does
  not come (in Obsidian and in headless Chromium alike). Both passes give it 8 s, ask the page for a frame
  and take it again; a capture that still fails is retaken as a whole (`--retries`).
- **Fonts.** `compose()` checks four frames of every film for text that is not drawn with a TeX font of the
  brand, and fails if there is any.
- **The loop.** Lossy animated WebP (img2webp) left ghosts where something small disappeared (the editor's
  hover tip), so the WebP is lossless. Whether a README shows the GIF or the WebP is the README's choice.
- **Sections.** A film is one or more parts with a section card between two of them (`d.section()`). The
  clock of the capture only runs while it films, so the set up of the next part takes no time of the film and
  no moving picture is cut. The edit maps every time of the track into its part (`parts` of the film: each
  begins on a whole frame, so the cadence holds), ends a caption with its part, refuses a callout, a press or
  a held key that runs across a card, and gives each part its chip. The pointer stays where its part ended
  while the window leaves. A film still has one figure: `d.figure()` after the first picture must find the
  same rectangle (the editor's modal is the same for every chart). A note with the chart in it, as a second
  figure, would need a layout per part; it is not built.
- **The film clock.** `d.clock('film')` wraps `window.requestAnimationFrame` in the page so its callbacks get
  the capture's time (nothing of the plugin is changed, and `d.close()` puts the browser's function back).
  Each picture then steps the page by 1/30 s and waits two animation frames (the step, and the drawing it
  asked for): a play of the overview shows 30 pictures per second at its true speed (2 units of `a` in 4 s),
  where `d.realtime()` gave 3 to 7. The pictures are the draft renders a user sees during play.
- **A slider's value during play.** `obs.sliderValue()` reads the range input, and the browser snaps that
  onto the slider's step; play moves on a finer grid (a half or a fifth of the step), so the input said
  -0.76 where the chart and its title said -0.765. Read the chart's own value
  (`(await obs.chart()).parameters`) for anything a caption prints about a playing slider.
- **The poster mark** lies half a tick before the clock when it was set; the edit takes the tick at or before
  it (rounding it to the nearest tick once put a mark set at the end of a hold onto the release).
