<p align="center">
  <img src="docs/screenshots/marketing-1-hero.png" alt="Easy TikZ: design TikZ & pgfplots charts in Obsidian" width="100%">
</p>

<table>
  <tr>
    <td width="50%"><img src="docs/screenshots/marketing-2-2d.png" alt="2D plots: any expression, live preview, tangents and extrema" width="100%"></td>
    <td width="50%"><img src="docs/screenshots/marketing-3-3d.png" alt="3D surfaces: f(x, y) at 60 fps, drag to rotate" width="100%"></td>
  </tr>
  <tr>
    <td width="50%"><img src="docs/screenshots/marketing-4-inline.png" alt="Renders inline in your notes - no external TikZ plugin" width="100%"></td>
    <td width="50%"><img src="docs/screenshots/marketing-5-tools.png" alt="Composable tools: area between, intersections, reference lines, free shapes" width="100%"></td>
  </tr>
</table>

<p align="center">
  <img src="docs/screenshots/demo-overview.gif" alt="One-minute overview of the 3.x editor: every tab, function and tool flowing end-to-end" width="960">
</p>
<p align="center"><sub>One-minute walkthrough, recorded with the 3.x editor. Version 4 regroups the same work into Build, Chart, Code and Help tabs (see <a href="#quick-start">Quick start</a>). <a href="docs/screenshots/demo-overview.mp4">(MP4)</a></sub></p>

<p align="center">
  <img src="docs/screenshots/demo.gif" alt="Tighter clip: open the modal, edit a plot, pan / drag, insert into the note, click the rendered chart to re-edit" width="960">
</p>
<p align="center"><sub>Tighter clip (3.x editor): open the editor, edit, pan / drag, insert, click the rendered chart to re-edit. The click-to-edit loop is unchanged in v4. <a href="docs/screenshots/demo.mp4">(MP4)</a></sub></p>

## Why

Pgfplots is powerful but the syntax is fiddly and the feedback loop is "edit, recompile, squint". Easy TikZ is a visual editor with a live preview that renders the chart in your note directly - no TeX install needed for in-vault use, and the same model exports clean pgfplots when you want to publish.

Version 4 adds sliders that move the picture while you drag them, drag to edit (grab a line, curve or point in the preview and its numbers follow), and a handful of general tools (regions from inequalities, curves from equations, computed points) that cover lecture-style pictures: several areas between curves, linear programs with their optimum, level curves touching a constraint, market equilibria.

## Install

**From inside Obsidian** (recommended)

1. Settings → Community plugins → **Browse**.
2. Search **Easy TikZ** and click **Install**, then **Enable**.

**Via BRAT** (early-access builds between releases)

1. Install the [BRAT](https://github.com/TfTHacker/obsidian42-brat) plugin.
2. BRAT settings → **Add Beta Plugin** → paste `Saiki77/easy-tikz`.
3. Enable **Easy TikZ** under Settings → Community plugins.

**Manual:** download `main.js`, `manifest.json`, `styles.css` from the [latest release](../../releases) into `<your vault>/.obsidian/plugins/easy-tikz/`.

**Upgrading from 3.x.** Existing `easy-tikz` blocks keep working: they are migrated in memory when they render or open, and the note is only rewritten when you press **Save changes** in the editor. See the [CHANGELOG](CHANGELOG.md) for what migration does.

**Migrating from 2.x.** The plugin id changed to `easy-tikz` in 3.0. Rename `.obsidian/plugins/tikz_graph_helper/` to `.obsidian/plugins/easy-tikz/`, then re-enable. Settings carry over.

## Quick start

1. Click the function icon in the ribbon (or run *Easy TikZ: Open editor* from the command palette).
2. The **Build** tab opens on "Start a chart". Type a formula such as `x^2 - 2x` and press Enter, or pick one of the six examples below the field.
3. Use **+ Add** for everything else: more functions, shaded regions, lines and curves, points, arrows, braces, text labels and sliders. The preview redraws as you type.
4. Adjust by hand: drag a line, curve, point or label in the preview and its numbers change so it follows the pointer; Shift-drag turns lines and stretches curves (see [Drag to edit](#drag-to-edit)). Drag empty space to pan, scroll to zoom.
5. **Insert into note** (Cmd/Ctrl+Enter). The plugin writes an `easy-tikz` code block and renders it inline.

Click a chart in your note to edit it again: the editor opens with every setting filled in, and **Save changes** replaces the block in place.

The editor has four tabs:

| Tab       | What is there                                                                                              |
| --------- | ---------------------------------------------------------------------------------------------------------- |
| **Build** | Everything you draw, as cards: functions (or surfaces in 3D), then shapes, points and labels.              |
| **Chart** | Ranges (formulas allowed), axes, axis variables, equal scale, grid, export size, note width, 3D view.      |
| **Code**  | The LaTeX, with a **Standalone document** switch. Hand edits are kept until you press Regenerate.          |
| **Help**  | The full reference, with **Open example** buttons.                                                         |

Under the preview sits the **Sliders** dock (visible in every tab). The header switches between 2D / 3D and Cartesian / Polar; its "more" menu opens the examples and your saved templates.

Problems show under their field after a short pause, often with a one-click fix (**Add slider k**, **Use a\*x**, **Use sin**), and a status chip on the preview lists them all. A chart with an error still draws everything else. Deleting a card or finishing a drag shows an **Undo** bar, Cmd/Ctrl+Z and Cmd/Ctrl+Shift+Z undo and redo outside text fields, and a chart you close without inserting is kept as a draft that the editor offers to restore.

## Plot

**2D.** Any formula in x. `^` is power, `sin`, `exp`, `ln`, `sqrt`, ... are bare names, `pi` and `e` are constants (`PI`, `E` and `Math.*` still work). You can leave out `*`: `2x`, `3(x + 1)`, `a x + b`. Each function card has a name (`f1`, `f2`, ...) that other formulas use: `f1(x - 1)`, `2 f1 + 1`, `f2 <= y <= f1`. Per function: legend (your own text or the formula typeset), fill to the x-axis (solid or pattern), dashed, thickness, tangent at a number, a slider or `min` / `max`, automatic extrema markers, parametric (`x(t), y(t)`), or polar (`r(θ)`) via the header switch. Drag empty space in the preview to pan (hold Space or use the middle mouse button to pan from on top of a shape) and scroll to zoom; the lock button switches both off, and axes whose bounds are formulas (`2a`) are left alone. A drag that starts on a shape edits it: see [Drag to edit](#drag-to-edit).

**3D.** Formulas in x and y. Wireframe or filled with adjustable opacity, planes, points, arrows and labels with a z position. Drag the preview to rotate (arrow keys for fine steps when it has focus) and use the zoom buttons in its corner. A plugin setting controls the maximum samples-per-axis slider (default cap 80, up to 120).

```
sin(x)                       sin(x) exp(-x/5)              r = 1 + cos(θ)
x^3 - 3x                     1/(1 + x^2)                   (cos(t), sin(t))
sin(sqrt(x^2 + y^2))         exp(-(x^2 + y^2)/4)           x y
```

Two traps: `ax` is one name (write `a x` or `a*x`; the error offers **Use a\*x**), and `1/2x` is `(1/2)*x`. The Help tab lists every operator and function. For models in other letters, set **Axis variables** in Chart > Axes to `x1, x2` or `q, p`.

## Tools

Version 4 replaces the eleven special-purpose tools of 3.x with five general ones. Everything you can type in them is a formula, so sliders and computed values work in every field.

| Tool        | What it covers                                                                                                                                                                                                                                                         |
| ----------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Region**  | Shades where every condition holds, one condition per row: `x + y <= 4`, `0 <= x <= 2pi`, `f2 <= y <= f1`, `(x - 3)^2 + (y - 2)^2 <= 4`, `x <= 1 or x >= 3`. Areas between any number of curves, areas under a curve, feasible regions, rectangles, disks, unions. Fill, pattern, outline, a label, and **Constraint lines** that draw each condition's boundary across the view with its own label (`(1)`, `labour`). |
| **Curve**   | An equation in x and y: `2x + 3y = 12`, `x = 2`, `(x - 3)^2 + (y - 2)^2 = 4`, `x y = 4`. With **Levels** (`2, 4, c, P1_val`) it draws the level curves of a formula: indifference curves, iso-profit lines, contour plots.                                                    |
| **Points**  | Marks a list of points, the intersections of two functions or curves, the corners of a region, or the integer points inside a region. An optional objective (`2x + 3y`, Max / Min) keeps only the best: the continuous optimum over a region, the best integer point, the best listed point. Labels, drop lines to the axes. In 3D: a list of `(x, y, z)` points. |
| **Segment** | A path through two or more points (`(0, 0); (3, 2)`, or a points tool's name): line, arrow forward / backward / both, closed polygon, or a curly brace with a label. 2D and 3D (braces in 2D only).                                                                                 |
| **Plane**   | 3D only: the plane x, y or z = value (sliders allowed), sorted in depth with the surfaces it cuts.                                                                                                                                                                     |

Text labels sit at a position such as `(P1_x, P1_y + 0.3)` and can be dragged in the preview: plain numbers change, and a position written as a formula gets an offset (`P1_x + 0.4`).

You rarely pick a tool directly: **+ Add** lists recipes in plain words (Area between two functions, Feasible region, Vertical line x = c, Intersections of two functions, Optimum over a region, Integer points in a region, Brace with label, ...), and each of these is a pre-filled card of one of the five tools (the list also adds functions, text labels and sliders). 3.x blocks are converted on open: `areaBetween` and `rectangle` become regions, `verticalLine`, `horizontalLine` and `circle` become curves (a filled circle becomes a region), `intersection` and `point3D` become points, `segment`, `brace` and `segment3D` become segments, and `plane3D` stays a plane.

Names are stable: functions are `f1, f2, ...`, tools `R1, C1, P1, S1, PL1, ...`, all renameable on the card, and a rename updates every formula and label placeholder that uses the name.

## Sliders and live values

A slider is a named number you can use anywhere: in formulas, domains, region conditions, point lists, labels and axis ranges (`xmax = 2a`).

- **Create one** with **Add slider** in the dock, with + Add > Slider, or with the **Add slider k** fix that appears under any field using an unknown name.
- **Drag it and the picture follows while you drag**: the preview redraws on the next animation frame, then once more at full quality 150 ms after you stop. Expressions are compiled once and read slider values at call time, and each tool is recomputed only when a slider it uses changes.
- **Play** sweeps a slider between its minimum and maximum. Type a value outside the range and the range widens.
- **Computed values.** Every points tool publishes its results under its name: `P1_x`, `P1_y` (`P1_z` in 3D), `P1_val` (objective value), `P1_n` (count), and `P1_x2`, `P1_y2`, ... for later points. Any field can use them, and they update live: a line `2x + 3y = P1_val` through the optimum, a region bounded by `P1_y`, a tangent at `P1_x`.
- **Label templates.** Every text (title, text labels, region, condition, curve, point and segment labels) can show values: `{c}` (up to 3 decimals), `{P1_val:1}` (1 decimal). Points add `{x}`, `{y}`, `{z}`, `{val}` and `{i}`; curves add `{level}`. `$...$` is LaTeX math.
- **In your notes** the chart shows its sliders underneath (up to three rows, then "Show N more", plus a reset button). Moving them changes the picture for the current session only and never edits the note. Switch them off in Chart > In your note.

## Drag to edit

In the editor's 2D preview, drag a line, curve, point or text label, and Easy TikZ rewrites the numbers in its formula so that the part you grabbed follows the pointer. Only numbers and their signs are rewritten (your spacing, `*` and `≤` stay as typed), and the card and the Sliders dock update while you drag.

| Gesture                   | What it does                                                                                                         |
| ------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| Drag                      | Moves the shape.                                                                                                     |
| Shift-drag                | Turns a straight line, stretches a curve, resizes a circle, each around the ⊕ mark. Points and labels move straight. |
| Alt (Option) held         | Fine control: no snapping, no rounding to rounder numbers.                                                           |
| Click, then arrow keys    | Moves the selected shape by about a tenth of a grid step (Shift: ten times, Alt: a tenth). Enter opens its field.    |
| Space-drag, middle button | Pans, also from on top of a shape.                                                                                   |

- **Which numbers change:** sliders first, then the numbers you typed, and only if needed an inserted shift, offset or factor. A constant exponent (the `2` in `x^2`) never changes. Rest the pointer on a shape and a tip shows in advance what will change.
- **Examples:** dragging `sin(x)` by 0.5 to the right and 0.5 up gives `sin(x - 0.5) + 0.5`. Shift-dragging the constraint `x + 3y <= 6` from (0, 2) to (0, 2.5) turns it around the corner (3, 1) into `x + 2y <= 5`. Dragging `2x + 3y = c` leaves the text alone and moves the slider `c`.
- **You can grab** functions y = f(x), region edges and constraint lines, curve tool lines, circles and level curves, listed points, segments and their ends, and text labels. Computed points (optimum, corners, intersections, integer points) stay computed: drag the lines that define them. A press on one goes through to the line under it.
- **Snapping:** moved shapes snap to markers and the origin, lines snap through nearby markers, points, segment ends, labels and the vertex of a graph snap to the major grid, and turns click into simple slopes.
- **Undo:** Esc cancels a running drag. Each finished drag is one step in the Undo bar and under Cmd/Ctrl+Z (redo: Cmd/Ctrl+Shift+Z), in one history with deletes and slider changes. After a drag that changed one typed number, **Make slider** turns that number into a slider.
- **Switch:** the pointer button **Edit shapes by dragging** in the preview's action pill turns it off, and the preview then pans wherever you drag (text labels still move). Not draggable yet: parametric and polar curves, the inside of a region, 3D charts and charts in notes.

## Optimisation diagrams

A linear program with its feasible region, an objective line on a slider and the optimum, built in the editor:

1. **+ Add > Feasible region (inequalities).** It starts with `x >= 0`, `y >= 0` and constraint lines on. Type `x + y <= 4` in the empty row and add a row `x + 3y <= 6`; **Number them** labels the constraint lines (1), (2), ...
2. **+ Add > Line from an equation**, type `2x + 3y = c` and click **Add slider c** under the field. Set the curve label to `z = {c}`.
3. On the region card, **Find optimum**: a points tool over the region with the objective `2x + 3y`, Max. **Mark corners** adds the vertices with their coordinates.
4. In Chart > Ranges, set x from 0 to 5 and y from 0 to 4.5. Press play on `c` and watch the line sweep across the region: the last point it touches is the optimum (3, 1), at c = 9.

The same chart as a block you can paste into a note:

````
```easy-tikz
{
  "v": 4,
  "xmin": "0", "xmax": "5", "ymin": "0", "ymax": "4.5",
  "axis_style": "axes",
  "parameters": [{ "name": "c", "value": 6, "min": 0, "max": 15, "step": 0.1 }],
  "tools": [
    { "type": "region", "name": "R1", "color": "blue",
      "conditions": ["x + y <= 4", "x + 3y <= 6", "x >= 0", "y >= 0"],
      "conditionLabels": ["(1)", "(2)", "", ""], "constraintLines": true },
    { "type": "curve", "name": "C1", "color": "red", "dashed": true,
      "equation": "2x + 3y = c", "label": "z = {c}" },
    { "type": "points", "name": "P1", "color": "red", "size": "large",
      "source": "region", "regionName": "R1", "objective": "2x + 3y", "sense": "max",
      "label": "z* = {val} at ({x}, {y})" }
  ]
}
```
````

Missing fields take their defaults, and the editor fills them in when you save. From here:

- **Pin the line to the optimum** with `2x + 3y = P1_val` instead of the slider.
- **Drag instead of typing:** grab a constraint line in the preview, and the region, its corners and the optimum follow. Shift-drag the objective line to turn it: the objective of P1 changes with it, because both are the same text.
- **Sensitivity:** replace a right-hand side with a slider (`x + y <= b`) and press play. Region, corners and optimum follow.
- **Integer programs:** a points tool with source Integers over R1 and the same objective marks the best integer point.
- **Nonlinear objectives:** draw the objective as a curve with levels (`x^2 + y^2` at `1, 3.2, 6`), shade the constraint as a region, find the minimum with a points tool over it (Min), and add a curve `x^2 + y^2` with levels `P1_val`: the level curve that touches the constraint at the optimum.
- **Unbounded or infeasible:** the status chip says when the objective is unbounded within the view or the region is empty.

Help > Optimisation recipes walks through these, and the examples *Linear program*, *Level curves and a constraint* and *Market equilibrium* open them ready-made.

## Inline rendering in notes

The plugin registers an `easy-tikz` markdown code-block processor. **Insert into note** writes a JSON block; the same renderers that power the editor preview draw the chart in your note, and a chart with sliders gets its own slider strip underneath. Click the rendered chart to re-open the editor pre-filled with every setting - change something, **Save changes**, and the block in the source file is replaced in place. Hover the chart for alignment and width controls. If something in the chart cannot be drawn, a muted line under the chart names the problem; the rest of the chart still renders.

Plugin setting **"Also render plain `tikz` blocks"** opts in to claim the `tikz` language tag as well; off by default to coexist peacefully with `obsidian-tikzjax` and similar.

## Export

**Copy TikZ** (and the Code tab) produces pgfplots code that compiles with pdflatex. By default it is a standalone document (`\documentclass[border=5pt]{standalone}` plus the packages it needs); switch off **Standalone document** in the Code tab to get only the `tikzpicture`, with `% Needs: ...` lines listing what your preamble must load.

The preview and the export draw the same scene, so what you see is what pgfplots draws:

- **Functions** are exported as formulas (`\addplot`), with slider values substituted, functions used by name written out, and trigonometry in radians (`trig format plots=rad`). Curves are split where the preview breaks them (poles, jumps), and `restrict ... to domain` with `unbounded coords=jump` keeps steep functions such as `x^3` or `tan(x)` from stopping pdflatex with "Dimension too large".
- **Regions, curves, points, segments and braces** are computed by the plugin and exported as coordinates. They match the preview exactly, but they do not recompute if you edit the LaTeX. The export is a snapshot at the current slider values.
- **Colours** are defined with `\definecolor` inside the picture, so the PDF uses the preview's colours rather than xcolor's (whose `green`, `purple` or `teal` look quite different). "Auto" (the theme's text colour) exports as black.
- **Layers and legend:** fills sit on the axis background layer, below axes, curves and markers. Every `\addplot` without a legend entry (markers, extra pieces of a broken curve) carries `forget plot`, so legend entries stay with their functions.
- **Text:** labels are escaped, so `50% cut`, `x_1` or `R&D` print as typed, while `$...$` math and LaTeX commands such as `\textbf{A}` pass through.
- **Size and aspect:** width and height come from Chart > Export size; **Equal scale** (always on in polar charts) exports as `axis equal image`, which keeps your ranges and shrinks the box.

The editor's **Copy SVG** and **Copy PNG** buttons serialize the live preview with theme colours already resolved.

## Plugin settings

Settings → Community plugins → **Easy TikZ**:

- **Invert vertical drag in 3D.** Trackball convention by default (drag down tilts the scene up); flip for direct manipulation (camera follows finger).
- **Max 3D samples per axis.** Upper bound of the per-surface Samples slider. Default 80, at most 120. The export always uses at most 60 samples per axis, because pdflatex runs out of memory above that.
- **2D pan sensitivity.** Default 1.0 (direct: 1 mouse pixel = 1 chart pixel), from 0.1 to 2.0.
- **Also render plain `tikz` blocks.** Off by default; on if you want one tag for everything (conflicts with obsidian-tikzjax).

## Live rendering, briefly

The preview is drawn in-process by a small custom pipeline - no shell-out, no LaTeX compile, no image round-trip - which is what lets sliders and the camera follow the cursor without lag. Expressions are parsed once and compiled into plain closures (no `eval`, no `Function`); sliders are read when the closure runs, so dragging one never recompiles anything. Regions, curves and points are memoised per tool and keyed by the sliders and names they use: dragging the objective slider `c` recomputes the objective line, not the feasible region. While a slider moves, the 2D preview draws at draft resolution on every animation frame and redraws at full quality once you stop. Drag to edit rides on the same loop: each pointer event solves for the new numbers, rewrites the text and requests a draft frame.

A typical 3D surface (samples=40, 1,600 quads) sits at ~60 fps; the slider's upper end (samples=120, 14,400 quads) settles above 30 fps. Sampled surface data is cached per surface, keyed by expression, domain, sample count, z-range and the sliders the surface uses, so a pure camera change (rotation, zoom) re-projects from the cache without re-evaluating the function.

## Permissions

- **Clipboard:** writes TikZ code / SVG / PNG on the *Copy …* buttons. No reads.
- **Active note:** inserts an `easy-tikz` block on **Insert into note**, replaces an existing block when saving from click-to-edit, and updates `displayWidth` / `displayAlign` when you use a chart's width or alignment controls. Inline sliders never write to the note.
- **Plugin data:** the plugin settings above, your saved function templates, the state of the **Edit shapes by dragging** switch (and that its first-use tip was shown) and, while the editor is open, an autosaved draft of the chart (cleared when you insert or save).
- **Network:** none.
- **Telemetry:** none.
- **Math evaluation:** user expressions are parsed by a built-in parser and compiled into closures; no dynamically generated code runs. Nothing is persisted or transmitted.

## Development

```bash
npm install
npm run dev    # watch mode; also rebuilds styles.css when a stylesheet changes
npm run build  # type check, production bundle, styles.css
npm test       # unit tests, plus a pdflatex compile test when pdflatex is on PATH
node scripts/run-tests.mjs geometry   # only the test files whose name contains "geometry"
```

`styles.css` in the repository root is generated: `scripts/build-css.mjs` concatenates `src/styles.css` and every `src/ui/*.css`, so edit those. Tests live in `tests/*.test.ts` and cover the pure modules (no `obsidian` import); `scripts/run-tests.mjs` bundles each file with esbuild and runs it in node. There are 18 test files with 558 tests (35 of them are the pdflatex compiles). `dom-classes` scans the sources for class names that only real Obsidian rejects (a space in a class given to `createSvg` or `addClass` throws there), since no node test can run Obsidian's DOM helpers. The eight `drag-*` files (264 tests) cover drag to edit: `drag-golden` is a table of real drags with the exact text each one must produce, and `drag-fuzz` rewrites 2300 random expressions and checks that the new text computes the same values. The LaTeX test compiles every example, a 3.x block of every legacy tool type and stress cases with pdflatex (30 s per file; set `ETZ_LATEX_KEEP=<dir>` to keep the `.tex`, `.pdf` and `.log` files).

```
main.ts              # plugin entry: code-block processor, inline charts and slider strip, settings tab
src/
  modal.ts           # editor modal: layout, preview, render loop, drag to edit and undo wiring, autosave draft, click-to-edit save
  ui/
    host.ts          # PanelHost: the contract between the modal and its panels
    kit.ts           # UI kit: segmented controls, chips, live sliders, expression inputs, cards, popovers
    buildPanel.ts    # Build tab: card list, + Add menu, empty state, example thumbnails
    functionCards.ts # function and surface cards
    layerCards.ts    # region, curve, points, segment, plane and text label cards
    chartPanel.ts    # Chart tab
    codePanel.ts     # Code tab
    helpPanel.ts     # Help tab (reference and Open example buttons)
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
tests/               # unit tests (drag-*.test.ts: drag to edit), helpers (_lib.ts, _drag.ts), the pdflatex compile test
```

## License

[MIT](LICENSE.md).
