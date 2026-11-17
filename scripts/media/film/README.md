# Film: frame-exact clean takes

Clean takes of the real plugin in the isolated Obsidian of [`../lib/obsidian.mjs`](../lib/obsidian.mjs): the
screen only (no paper, captions or cards), with a drawn pointer and an eased camera, at 60 fps. Made for the
5.2 tour. For the next release, add parts to `tour.mjs`, or write a new scene with `kit.mjs`.

```bash
npm run media:tour                                      # the whole tour: <tmp>/easy-tikz-media/film/tour.mp4
npm run media:tour -- proof                             # the opening only, about 12 s
npm run media:tour -- --root --out ~/Desktop/tour.mp4   # the build in the repository root, another file
npm run media:tour -- --size 1800x1200                  # 3:2 instead of 16:9 (1920 x 1080, the default for YouTube)
node scripts/media/film/check.mjs film.mp4 --sheet sheet.png   # uneven frames and a contact sheet of a video
```

Beside the MP4 the tour writes `<name>-sheet.png` (a picture per 2 s) and `<name>-stills/` (a picture per
second), and prints the check. The window takes the aspect of the frame at the full-screen height of a 16 inch
MacBook Pro (1117 CSS px): 1986 x 1117 for 16:9, so a wider frame shows more at the sides and nothing less
above and below (a window wider than the screen is emulated by the kit). The whole tour takes about 10 minutes (about 50 ms per picture, 4200 pictures).
It needs `ffmpeg`. Nothing is written into the repository: copy a film where it belongs.

## Why frame-exact

The 5.0 take stuttered. The causes, and what this kit does about them:

| Cause | Fix |
| --- | --- |
| `lib/record.mjs` waited one animation frame before a picture: in a drag the chart was drawn after about every second picture | Each picture waits until the plugin reports nothing left to draw (`window.__etzMedia.idle()`), then 2 frames |
| What the plugin animates by itself (slider play, chart motion) ran on the wall clock, while a picture takes longer than a frame | The page's `requestAnimationFrame` time moves on by exactly 1/fps per picture |
| CSS transitions (a card fading in, a menu) ran on the wall clock | They are paused as they start (`transitionrun`, `animationstart`) and stepped by 1/fps |
| 3D turns were rounded to whole degrees on every move | Fixed in the plugin (5.2.2): fractions of a degree while a drag runs |
| A slider with a coarse step moves the chart only every few frames | Give a dragged slider fine steps: `in steps of 0.01` |

## What each picture does (`kit.mjs`)

1. The film clock moves on by 1/fps: the page's animation frames and the stepped CSS animations.
2. The drawn pointer moves to the scripted mouse position. A ring grows on a press and fades after it.
3. The picture waits for `idle()` and 2 animation frames.
4. The camera rectangle (3:2, eased, zoom in log space) is captured with `Page.captureScreenshot` at the output
   size. Chromium draws it at that scale, so zoomed text stays sharp. It is piped into ffmpeg (a 1 px rounding
   of Chromium is scaled away).

Holds repeat the last picture when nothing moves and the camera rests.

## The kit

`createFilm(obs, { out, fps = 60, width = 1800, height = 1200, crf = 16, stills })` returns the film:

| Call | Does |
| --- | --- |
| `tick(n)` | `n` pictures |
| `hold(seconds, { still })` | Seconds of film; `still: false` takes real pictures (a caret blinks, a camera moves) |
| `camera(target, seconds, { pad })` | Ease the camera to a rectangle `{x, y, width, height}` (padded to 3:2), `{cx, cy, w}` or `'full'` |
| `cameraWait()` | Pictures until the camera arrives |
| `move(x, y, seconds)` | Glide the pointer on a slight arc, still at both ends |
| `press()`, `release()`, `click(x, y, seconds)` | The button, with its ring |
| `drag(points, seconds)` | Press, along the points (one smooth ease over the whole path), release |
| `type(text, cps)` | One key at a time, a little uneven, as a hand types; `\n` is Enter |
| `key(name, mods)` | A key and one picture (`obs.key('p', { mod: true })` for Cmd+P) |
| `wheel(x, y, total, seconds)` | Wheel steps spread over `seconds` (negative zooms in) |
| `scroll(selector, top, seconds)` | Set `scrollTop` per picture, eased |
| `pointer(on)` | Show or hide the drawn pointer |
| `finish()` | Close the film; returns frames, seconds and the capture time |

`rectOf(obs, selector)` gives the rectangle of the first visible element. `check.mjs` exports `checkFilm(file,
{ sheet })` and `unevenFrames(values, fps)`.

## Sound

```bash
npm run media:tour -- --sound --music                  # also tour-sound.mp4 (effects) and tour-music.mp4 (effects and a bed)
node scripts/media/film/sound.mjs tour.mp4 --music      # mix again from tour-events.json: seconds, no new film
```

While it films, the kit writes `<name>-events.json`: every key, press and release, drag, camera move, wheel and
scroll, at the second of the film it happens, and `film.mark('pop')` where the scene opens something (the
card, the editor, a menu, the palette). `sound.mjs` synthesises the sound from it, so each sound sits on its
frame. Nothing is recorded or downloaded, and the same events give the same sound (seeded).

| Event | Sound |
| --- | --- |
| `key` | A soft key: filtered noise and a low thump, a little different each time; Space and Enter lower |
| `press`, `release` | A crisp click; a softer, lower one |
| `camera`, `wheel`, `scroll` | A whoosh that follows the move: a band of noise that rises on a zoom in, falls on a zoom out |
| `drag` | A faint texture that swells and fades with the speed of the hand |
| `pop` | A soft rising blip |
| `--music` | Pads on Cmaj9, G6, Am9, Fmaj9 (two bars each at 76 bpm), a bass and a few plucks, in a small stereo room |

Levels are fixed: the effects peak at -3 dBFS, the bed's RMS is -21 dBFS, a soft limit above that. The 5.2
tour with the bed measures -18.9 LUFS, peak -1 dBFS; that version (effects and bed) was the one chosen.

## Adding a part

1. Add the part to `tour.mjs`: set the camera, act, hold. Measure positions in the app (`rectOf`,
   `obs.point([x, y])` for chart coordinates, `obs.point({ slider: 'n', value: 24 })` for a slider thumb).
2. Film `proof` when the opening changed; otherwise the whole tour.
3. Read the check: a run of uneven frames inside a drag means the chart follows only some pictures (a coarse
   slider step, a rounding, or a drawing that `idle()` does not wait for). A single one at a click or at the
   start of a camera move is an event, not judder.
4. Look at the contact sheet and the stills before using the film.

Things learned while filming 5.2:

- Use the documented chart syntax (`shade under f from x = 0 to 4`): other forms show an error in the editor.
- Chart labels (`write "..." at`) are drawn in 2D and in 3D: start a new chart for a 3D part (Cmd+P, Open editor).
- A formula card that was dragged in stays open: Escape closes it.
- The card opens after its delay in real time: hold the film first, then wait for the card, then tick.
- Grab a label at its drawn text (`svg text`), not at its anchor: the Riemann rectangles lie over the anchor.
- The vault of the tour turns off auto-paired brackets and marks and the spelling marks, so typing is clean.

The tour uses port 9345 (`PORTS.film`) and the work dir `<tmp>/easy-tikz-media/port-9345`.
