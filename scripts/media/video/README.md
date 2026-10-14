# Video scenarios

The first-round videos of the 4.0 relaunch, one file per video. `../build-video.mjs` films them from the real
plugin in the isolated Obsidian of the media toolkit (see `../README.md`): port 9344, window 1728 x 1117 CSS px
at 2x, light theme.

Since 4.2, `overview` and `clip-drag` in `docs/media` are films of the cinema pipeline
([`../cinema`](../cinema/README.md), `npm run media:film`). The npm script `media:video` is retired, and
`build-video.mjs` never writes `overview.*` or `clip-drag.*` into `docs/media`: a run leaves the two scenarios
out, and naming one of them stops before anything is filmed. With `--out <another dir>` it still films them.

```bash
node scripts/media/build-video.mjs                              # the six it may write into docs/media
node scripts/media/build-video.mjs clip-sliders clip-3d         # only these: film what changed, not everything
node scripts/media/build-video.mjs --list                       # names and allowed lengths
node scripts/media/build-video.mjs --sheets ~/Desktop/sheets    # where the contact sheets go
node scripts/media/build-video.mjs clip-drag --out /tmp/try --retries 0   # the old drag clip, outside docs/media
```

| Scenario | Shows |
| --- | --- |
| `overview` | a new chart (the editor is open from the first frame), Linear program example, slider c, dragging and Shift-turning the objective line, Undo, typing a new limit, Code tab, Insert into note, the slider strip in the note, click to edit again |
| `clip-sliders` | Tangent explorer (its live slope text as the chart title): drag slider a, then play |
| `clip-drag` | the hover tip (with an enlarged copy of it), drag a constraint line of a linear program, Cmd/Ctrl+Z |
| `clip-shift` | Shift-drag turns `0.5x - 1` into `x - 1` and stretches `sin(x)` into `2sin(x)` |
| `clip-areas` | Add > Area between two functions, Add > Intersections of two functions, drag a curve |
| `clip-quickfix` | type `a x^2 - 3x`, click the quick fix "Add slider a", drag the slider |
| `clip-3d` | Surface and plane: turn the view, move the plane with slider h |
| `clip-note` | Market equilibrium in a note: the slider strip, Reset |

## Output

Per scenario, into `docs/media` (or `--out`):

- `<name>.mp4`: H.264, CRF 18, 30 fps, at 1x of the filmed area (overview 1728 x 1116, editor clips
  1464 x 1050, the note clip 880 x 770);
- `<name>.gif`: 960 px wide, 20 fps and 256 colours when that stays under 6 MB, coarser otherwise
  (`encodeGif` in `common.mjs` steps down until it fits);
- `<name>-poster.png`: one telling frame at 2x (the frame a scenario marks with `d.poster()`), saved with a
  palette of 256 colours, which makes the file about a third and cannot be seen in a screen recording.

A filmed scenario always replaces its MP4 and GIF: two takes of one scenario differ in most frames (a drag is
drawn at slightly different moments), so nothing can tell a small deliberate change from a new take. Every run
therefore adds its videos to the history of the repository: film the scenarios that changed, by name. The poster
is one picture and stays untouched when the new one shows the same (`../lib/stable.mjs`).

Review material, into `--sheets` (default `<work dir>/video`): `<name>-sheet.png` (20 frames spread over the
clip) and `<name>-review-NN.png` (a frame every 0.75 s, six per sheet, large enough to read the captions).
Look at them before publishing: every caption readable, no half-open menu, no status chip, the pointer where
the caption says.

## Writing a scenario

```js
export default {
    name: 'clip-drag',                  // file name of the outputs
    title: 'Drag a constraint line',    // one line for the build log
    frame: 'editor',                    // 'window', 'editor' or { note: { height, margin } }
    seconds: [6, 14],                   // the build fails outside this range
    async setup(d) { ... },             // not filmed: open the editor, load a chart, write a note, park the pointer
    async run(d) { ... },               // filmed
};
```

`d` (made by `createDirector` in `common.mjs`) wraps the toolkit recorder:

| Call | Does |
| --- | --- |
| `d.charts.lp`, `.areas`, `.tangent`, `.levels`, `.surplus`, `.plane3d` | deep copies of the plugin's own examples (`EXAMPLES` in `src/migrate.ts`) |
| `d.caption(text)` | the caption bar; at most 62 characters |
| `d.hold(seconds)` | waits until the picture is final, checks it, shows it |
| `d.move(target)`, `d.click(target, { until, count, pause })` | glide; glide and click, filming the result only once `until()` resolved |
| `d.rest(target)` | rests on a shape until its hover tip shows; returns the tip's text |
| `d.drag(path, { shift })` | a whole drag |
| `d.dragStart(path, { shift })`, `d.dragTo(target)`, `d.dragHold(seconds)`, `d.dragEnd()` | a drag in parts, to hold the picture while the button is down |
| `d.slider(name, value, { scope })` | drags a slider's thumb (`scope: 'note'` for the strip in a note) |
| `d.type(text, { cps })`, `d.key(name, mods)` | keyboard |
| `d.realtime(seconds)` | films something that runs on its own clock (slider play) at its true speed |
| `d.poster()` | the frame shown now becomes the poster: pick a settled one (no Undo bar of an earlier gesture, no error, every card showing its final text) |
| `d.lens(true \| false)` | an enlarged live copy of the hover tip in the top right of the preview (see below) |
| `d.expect(condition, message)` | fails the scenario |
| `d.park(target)` | moves the pointer without filming (setup) |
| `d.obs`, `d.ui` | the session (`../lib/obsidian.mjs`); selectors of the real UI |

Rules the scenarios follow:

- Real input only. A value changes because the pointer dragged a slider or a line, or a key was typed: never
  through `obs.setSlider` or `obs.loadChart` while filming.
- Nothing is drawn that the app does not draw, with three exceptions that are not UI of the plugin: the pointer,
  the caption bar, and `d.lens()`. The hover tip is 11 and 13 px text in a corner of the preview and cannot be
  read in a GIF, so `d.lens(true)` shows a second, larger copy of it: a clone of the real element, kept in step
  with it (text, highlighted numbers, shown or hidden), framed in blue. Use it where a caption talks about the tip.
- The first frame is the still that GitHub and video players show: start on the editor with something to see,
  and get to the first chart within two seconds.
- Keep labels readable through a sweep: a slider value at which a label leaves the plot or is struck through by
  a line reads as a rendering fault. Try the range first, and say in a comment why it is what it is.
- Check what the caption claims with `d.expect` (the formula after a drag, the slider value, that the note file
  did not change). A scenario that fails writes nothing; the build films it again up to two more times, because
  a take can be spoilt from outside (another window taking the focus ends a drag).
- `d.hold` and `d.click` fail when the status chip shows a problem or the console logged an error.
- Pace for a reader: about 0.7 s to reach a target, at least 0.6 s on a result, 1 s on a caption before the
  action it announces is over.
- A chart that is not one of the examples as shipped says so in a comment at the top of the scenario.
