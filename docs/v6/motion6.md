# 6.0 C: Motion

Working material for the integrator (docs/reference.md, docs/ai.md, the Help guides). Code: `src/motion6/`; small blocks marked `// 6.0 C` in the shared files.

## Steps: `then`

`then` before an object line starts the next step. Lines before the first `then` are step 1 (stored as step 0); every later line stays in the step of the `then` above it. A bare `then` line starts a step with nothing new in it (a pause).

```easy-tikz
show x from -4 to 4 and y from -3 to 3
plot f(x) = sin(x) in blue
then plot g(x) = cos(x) in red
write "cos" at (0.3, 1.2)
then mark (0, 1), with coordinates
```

- Every function, surface, tool and text label has a step. `then` before a chart line or a slider is a problem ("then goes before a line that draws something").
- Objects of later steps are hidden as if `hidden` (still computed when another object reads them). Arriving objects enter by kind (see Step entrances); Previous fades the step that leaves.
- An explicit option `step=3` wins over the `then` count (the printer writes it when a list is not in step order).
- Print writes `then` where a step starts; a chart without steps prints exactly as before.
- **Notes:** a chart with steps gets a row in the strip under it: Previous, Play, Next and "Step k of n". It starts at its last step (the whole picture, as print and the PDF show it); Play starts at step 1 and goes through every step (1.6 s each). Print hides the strip (5.2.6 rule).
- **Editor:** the same bar over the preview (bottom left). Each card has a Step row while the chart has steps; the card menu's "Show in step n" puts an object in a new step (the way to make the first step without typing).
- **Full LaTeX:** `\then` before a command, or alone: `\then \plot[red]{g(x) = \cos x}`.

### `frames`

The chart line `frames` (Full LaTeX: `\axis[frames]`) exports every step side by side: one tikzpicture per step, in a row, each half the chart's size (at least 3 cm), with `% Step k of n` before it, one shared preamble (standalone) or one set of `% Needs:` lines (snippet). Without `frames` the export shows the last step. Chosen over groupplots: every frame is a normal pgfplots axis, so nothing changes in the preamble and every existing export rule applies per frame.

**SVG files** (the setting) show the last step, like the PDF: a note's image is one picture. Moving particles are drawn still (see the clock).

## The animation clock

Objects that move by themselves (moving particles now; E's turning circles later) ask for a clock. A chart with one gets a Pause / Play button in its strip (and the editor bar). The clock runs only while the chart is on screen (IntersectionObserver), only in notes and the editor preview, and starts paused under `prefers-reduced-motion`. A chart without moving objects or steps gets no player and runs no frame loop.

The export (and print, SVG files, the first frame) draws the still frame: time 0, or the chart's `stillTime` in seconds (`set stillTime = 1.5`).

## Vector fields

```easy-tikz
show x from -4 to 4 and y from -3 to 3
draw the vector field $F(x, y) = (y, -\sin x - 0.25y)$, coloured by length, with moving particles and streamlines
```

- The formula is a pair `(P, Q)` in x and y (LaTeX or plain, sliders allowed). `F(x, y) =` names the field (the tool's name; without it: VF1). `draw the vector field (y, -x)` works too.
- Short arrows on a grid over the view, all the same length on screen (like slope fields). Options: a colour, `thin`/`thick`, `coloured by length` (viridis; `coloured by length in heat` for another map), `with moving particles`, `with streamlines`, `density=30` (arrows across, 4 to 60), `hidden`.
- Particles (6.0 F4, docs/v6/design.md): the plan's flow on the live canvas, 450 particles with fading trails over very faint arrows. The export draws the still frame: faint arrows and a few streamlines.
- Streamlines: still curves from a grid of seeds, kept apart; the export draws them.
- 2D charts only (a 3D chart names it as a problem).
- **Full LaTeX:** `\vectorfield[colormap/viridis, particles, streamlines]{F(x, y) = (y, -\sin x - 0.25y)}`.

## Rest points

```easy-tikz
draw the vector field $F(x, y) = (y, -\sin x - 0.25y)$
mark the rest points of F, labelled
```

- The zeros of F in the view (Newton's method from a 16 x 16 grid of starts, at most 40). Filled when stable (both eigenvalues of the Jacobian with a negative real part), open when not. `labelled` writes each kind: stable node, unstable node, stable spiral, unstable spiral, saddle, centre, not isolated.
- `mark the rest points` (no `of F`) takes the nearest vector field above. Options: a colour, `small`, `large`, `labelled`, `hidden`. Publishes RP1_n, RP1_x, RP1_y, RP1_x2, ...
- **Full LaTeX:** `\restpoints[labelled]{F}`.

## Solutions of systems

```easy-tikz
mark P at (1, 0)
draw the solution of $\dot{p} = (y, -x)$ through P for t from 0 to 10
```

```easy-tikz
3d
show x from -25 to 25 and y from -30 to 30 and z from 0 to 50
draw the solution of $\dot{p} = (10(y - x), x(28 - z) - y, xy - \frac{8}{3}z)$ through (1, 1, 1) for t from 0 to 72, coloured by time
```

- The right side is a tuple: 2 formulas in a 2D chart, 3 in a 3D chart, in x, y (z) and t (non-autonomous systems work), sliders allowed. The left side may be `\dot{p} =`, `p' =`, `\frac{dp}{dt} =` or left out.
- `through` points tools (drag P and the solution follows) and points, several with `and`. `for t from a to b` (formulas; default 0 to 10).
- RK4 with a step of 0.005 in t, at most 20000 steps (a longer range gets a coarser step and an info note saying so), at most 3000 points drawn. It stops where a value is no number or runs far outside the chart (info note with the time).
- Options: a colour, `thin`/`thick`, `dashed`, `coloured by time` (`in heat`, ...), `hidden`.
- 3D: legs the 3D renderer paints in depth with the rest; the export joins each run of one colour into one `\addplot3`.
- **Full LaTeX:** `\solution[through=P, t=0:10]{\dot{p} = (y, -x)}`, `\solution[through={(1, 1, 1)}, t=0:72, colormap/viridis]{...}`.
- The 5.0 line `draw the solution of SF1 through P` (a slope field) is unchanged.

## API for parts D and E

### Steps (src/motion6/steps.ts)

```ts
stepOf(obj): number                       // 0..99, the object's step (0 = from the start)
lastStep(data): number                    // 0 = no steps
atStep(data, k): data                     // objects of later steps hidden (the chart itself at k >= last)
stepProgress(frame: MotionFrame | undefined, objectStep): number
    // 1 when the object's step is behind the one shown, or for the still frame (export, print);
    // the frame's progress 0..1 while its own step comes in; 0 before it.
registerStepMover(type: string): void     // D: a tool type that moves while its step comes in
```

A tool reads its progress in its scene code: `stepProgress(input.motion, tool.step)`, with `input.motion` the frame of `SceneInput2D` (the renderer fills it from `RendererConfig.motion`; the export leaves the still frame, progress 1). D's `transform the plane by A` draws `(1 - p) I + p A` with `p = stepProgress(...)`. After `registerStepMover('transform')` the player draws frames for 0.7 s while such a step comes in (`PROGRESS_MS` in player.ts), progress 0 to 1; without it a step change draws once (pop-ins only). Going back shows a step settled (progress 1).

Caching: the scene memo (src/scene.ts runNodes) caches node outputs by their inputs, not by the frame. A node whose output depends on the progress or the time must either put it into its own output after the memo, as `motionStrokes` does (`src/motion6/scene.ts`, called in scene2D after the item is built, with `item.strokes = out.strokes.concat(...)`; never mutate the cached arrays), or include the value in what the node reads.

### Clock (src/motion6/clock.ts)

```ts
interface MotionFrame { time: number; step: number; progress: number }   // src/types.ts
registerClockType(type, moves: (tool) => boolean)   // E: 'fourierCircles', () => true
clockTime(frame | undefined): number                // seconds; 0 for the still frame
needsClock(data): boolean
stillFrame(stillTime): MotionFrame                  // what the export draws
```

The frame reaches the scene as `RendererConfig.motion` -> `SceneInput2D.motion` (the 2D renderer passes it; the export passes `stillFrame(chart.stillTime)`). E's circles: `registerClockType('fourierCircles', (t) => t.type === 'fourierCircles')` at module load, then compute the picture at `clockTime(input.motion)` after the memo (like `motionStrokes`). The time is a pure input: draw the same picture for the same time (the export and the first frame agree).

### Player (src/motion6/player.ts, src/motion6/host.ts)

`playerFor(data, { draw(frame, clock), watched() })` gives a `MotionPlayer` or null. Hosts: InlineChart in main.ts (`motionView`, `drawMotion`, the row in the strip), TikzModal in src/modal.ts (`syncPlayer`, `previewView`, the bar), each passing `player.frame()` in `config.motion`. Clock frames are drawn at draft quality (labels keep their spots); a step change draws a full frame.

### Step entrances (src/motion6/entrances.ts, timeline.ts)

When a step comes in, each of its objects enters in its own way (the approved demo): `draw` (functions, curves, solutions, orbits, 3D curves: along their length, 0.7 s), `sweep` (regions, areas, sets on an axis, the unit square, Riemann sums, bars: a mask from left to right over the item, 0.6 s; a set on the y-axis from the bottom), `pop` (every marker of the step, one after another, 40 ms apart and all started by 320 ms, 0.35 s each, with a small overshoot), `grow` (a function's tangent out of its touching point, eigenvector lines out of their middle, 0.5 s), `arrow` (vectors, basis vectors, segment arrows: tail to tip, the head moving along, 0.5 s), `rise` (texts of an item 0.6 of its own entrance in, free labels 0.6 of the step's longest entrance in: 8 px up and a fade, 0.35 s), `ripple` (vector fields, slope fields, grids, coloured planes, spans: a radial mask from the middle of the plot, 0.6 s), `surface` (heights scaled from z = 0, or the floor when 0 is outside the box, 0.7 s), `fade` (planes, braces, guides, traced curves). Transforms keep `stepProgress` over PROGRESS_MS. Easing: ease out (cubic); pop: back with c1 = 2.2.

- **Frames.** `MotionFrame.index` is the step shown (also the last one, where `step` is Infinity; this also lets a transform in the last step move), `enter` the ms since it came in, `leave` 0..1 while Previous fades it out (LEAVE_MS = 200). The still frame has none of them, so the export, print, SVG files and the AI tools are unchanged.
- **Player.** `StepTimeline` (pure) holds the step chosen and the step drawn: Next starts an entrance of `entranceMs(chart, step)` (a conservative total from the kinds, at most about 0.9 s), Previous keeps the old step drawn while it fades, Play from the last step starts again with step 1 coming in, and Play goes on only when a step is in and has stood `max(STEP_MS, entrance + HOLD_MS)`. When a step has come in (or faded), the player draws the settled picture once more as a full frame. `PlayerHost.chart()` gives the chart as it is now.
- **Renderers.** `StepEntrance.of(frame, config)` (null when nothing moves) says which objects move (`moves(obj)`: the object's step is `frame.index`) and how far each kind is (`at(kind, delay)`). The 2D renderer applies it after the scene (the memo and the label places stay those of the settled picture): curves and lines are cut (`partialLines`, in screen length), grown (`grownLine`) or drawn tail to tip before their path is made; markers get a scale about their centre; fills and lines of sweeps and ripples get an SVG `mask`; texts a translate and an opacity. The 3D renderer scales a surface's heights in `projectQuads`, cuts legs by their place along their tool's lines (`Scene3D` shapes carry `source`, the tool's name), scales markers and fades labels, planes and legs (`alpha` on the marks, canvas and SVG alike).
- **Hosts.** Frames of a step coming in are drawn at full quality in 2D (the scene is in the memo) and on the canvas in 3D; the generic pop-in of src/motion.ts is off for every drawing the player asks for. Help charts keep the view of the settled step while it comes in.
- **Off.** The chart line `set entrances = off` (chart field `entrances: false`, `set entrances = on` writes true; Full LaTeX `\axis[entrances=false]`), the plugin setting **Step entrances** (`stepEntrances`, default on, `setStepEntrances`), and reduced motion (the player): the objects of a step then appear at once.

## Where the code is

- `src/motion6/steps.ts`, `clock.ts`: the step and clock model (pure).
- `src/motion6/maths.ts`: tuples, compile with z and t, RK4, rest points and kinds, streamlines, particles (pure).
- `src/motion6/scene.ts`: scene primitives, 2D and 3D; `motionStrokes` (particles after the memo).
- `src/motion6/text.ts`: the lines in words both ways; `src/text/full.ts` holds the three Full LaTeX commands (6.0 C block).
- `src/motion6/frames.ts`: the `frames` export.
- `src/motion6/entrances.ts` (kinds, times, frames, shapes; pure), `timeline.ts` (the player's steps; pure); tests in `tests/entrances.test.ts`.
- `src/motion6/fit.ts`, `tools.ts` (defaults, migration, rename), `cards.ts`, `steprow.ts`, `player.ts`, `host.ts`; texts in `src/i18n/{en,ja}/motion6.ts`; styles in `src/ui/motion6.css`.
- Shared fields: `step` on FunctionParameters, Function3DParameters, Annotation, ToolBase; `StrokePrim.opacity`, `MarkerPrim.open`, `Scene3D.segments[].run`, `SceneInput2D.motion`, `RendererConfig.motion`; chart fields `frames`, `stillTime`.
