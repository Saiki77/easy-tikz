# Easy TikZ reference

[Overview](../README.md) · [What's new](whats-new.md) · [Guides](guides/README.md) · [AI guide](ai.md) · [Changelog](../CHANGELOG.md)

Everything the plugin does, by topic. The [guides](guides/README.md) show it step by step; the Help tab in the editor has the same guides with live charts and a reference you can search.

## The editor

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
| **Help**  | Step-by-step [guides](guides/README.md) with live charts, the full reference with **Open example** buttons, and a link to What's new. |

Under the preview sits the **Sliders** dock (visible in every tab). The header switches between 2D / 3D and Cartesian / Polar; its "more" menu opens the examples and your saved templates.

Problems show under their field after a short pause, often with a one-click fix (**Add slider k**, **Use a\*x**, **Use sin**), and a status chip on the preview lists them all. A chart with an error still draws everything else. Deleting a card or finishing a drag shows an **Undo** bar, Cmd/Ctrl+Z and Cmd/Ctrl+Shift+Z undo and redo outside text fields, and a chart you close without inserting is kept as a draft that the editor offers to restore.

## Charts as text

A chart lives in your note as a few lines of text, one line per object, in plain words:

```easy-tikz
show x from 0 to 5 and y from 0 to 4.5
axes on the edges
slider c from 0 to 15, starting at 6
shade where x + y <= 4 and x + 3y <= 6 and x >= 0 and y >= 0, numbered, with constraint lines
draw 2x + 3y = c in red, dashed, labelled "z = {c}"
mark the corners of the region in blue, labelled "({x}, {y})"
mark the maximum of 2x + 3y in the region, large, labelled "x* = ({x:2}, {y:2})"
```

- **Readable in the note.** Change a number without opening the editor. While the cursor is in the block (Live Preview), its chart sits right under the lines and follows every key. A typo shows under the chart with its line and column, such as *Line 4, column 9: unknown option "dashd"*.
- **The editor writes text back.** Click the chart, change it with cards, sliders or by dragging, and **Save changes** rewrites only the lines whose object changed: your other lines and comments stay as you wrote them. Charts the editor inserts are text too (the settings can switch to JSON), and JSON blocks keep working as before.
- **Charts move.** Change a number and the chart glides to the new value; an object you add pops in.
- **Everywhere.** Charts draw in your notes on iPhone, iPad and Android, in the colours of your theme, and follow light and dark mode.

The Help tab has the reference (**Charts as text**), and the AI guide lists every line and option: [ai.md](ai.md#the-text-syntax). The short forms of 4.4 (`view x 0..5, y 0..4.5`, `f(x) = x^2 | blue`) still work.

## Make charts with AI

Describe the chart and let an AI build it. Easy TikZ hands the AI everything it needs, checks every chart with the plugin's own code, and the chart lands in your note, ready to drag and slide. Open the **AI** tab in the editor; it has three ways in:

- **AI apps on this computer** (Claude Code, Codex, Cursor, VS Code, Gemini CLI, Claude Desktop, LM Studio). Switch on **Let AI apps make charts** and copy the one line your app needs. The app then reads the chart guide, checks charts, looks at a picture of them and adds them to your notes by itself, through a small server that answers only on this computer ([how it works](ai.md#the-local-ai-server)).
- **AI chats** (ChatGPT, Claude, Gemini in the browser). **Copy the guide** into the chat, describe your chart, then **Paste the chart** the AI writes: it opens in the editor, checked. Blocks pasted straight into a note work too, also with the comments and trailing commas AI chats like to write.
- **AI agents in your vault folder.** **Add the section** puts a short Easy TikZ part into `AGENTS.md` and `CLAUDE.md`, which agents read on their own.

The guide the AI gets is [ai.md](ai.md); AIs write the text form, which reads like the math and is hard to get wrong. Then ask, for example: *"In this note, add a chart of the feasible region x + y <= 4, x + 3y <= 6, x >= 0, y >= 0, with the line 2x + 3y = c on a slider and the point where 2x + 3y is largest."*

## Plot

**2D.** Any formula in x. `^` is power, `sin`, `exp`, `ln`, `sqrt`, ... are bare names, `pi` and `e` are constants (`PI`, `E` and `Math.*` still work). You can leave out `*`: `2x`, `3(x + 1)`, `a x + b`. Each function card has a name (`f1`, `f2`, ...) that other formulas use: `f1(x - 1)`, `2 f1 + 1`, `f2 <= y <= f1`. Per function: legend (your own text or the formula typeset), fill to the x-axis (solid or pattern), dashed, thickness, tangent at a number, a slider or `min` / `max`, automatic extrema markers, parametric (`x(t), y(t)`), or polar (`r(θ)`) via the header switch. Drag empty space in the preview to pan (hold Space or use the middle mouse button to pan from on top of a shape) and scroll to zoom; the lock button switches both off, and axes whose bounds are formulas (`2a`) are left alone. A drag that starts on a shape edits it: see [Drag to edit](#drag-to-edit).

**3D.** Formulas in x and y. Wireframe or filled with adjustable opacity, planes, points, arrows and labels with a z position. Drag the preview to rotate (arrow keys for fine steps when it has focus) and use the zoom buttons in its corner. A plugin setting controls the maximum samples-per-axis slider (default cap 80, up to 120).

```
sin(x)                       sin(x) exp(-x/5)              r = 1 + cos(θ)
x^3 - 3x                     1/(1 + x^2)                   (cos(t), sin(t))
sin(sqrt(x^2 + y^2))         exp(-(x^2 + y^2)/4)           x y
```

Two traps: `ax` is one name (write `a x` or `a*x`; the error offers **Use a\*x**), and `1/2x` is `(1/2)*x`. The Help tab lists every operator and function. For models in other letters, set **Axis variables** in Chart > Axes to `x1, x2` or `q, p`.

Guides: [Write formulas that work](guides/formulas.md), [Tangents and extrema](guides/tangents-extrema.md), [Parametric and polar curves](guides/parametric-polar.md), [Surfaces, planes and points in 3D](guides/surfaces-3d.md).

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

Guides: [Shade a region with inequalities](guides/regions.md), [Shade the areas between two curves](guides/areas-between.md), [Shade between a curve and its tangent](guides/tangent-area.md), [Points, intersections and live labels](guides/points-labels.md), [Segments, arrows and braces](guides/arrows-braces.md), [Calculate with computed points](guides/computed-values.md).

## Sliders and live values

A slider is a named number you can use anywhere: in formulas, domains, region conditions, point lists, labels and axis ranges (`xmax = 2a`).

- **Create one** with **Add slider** in the dock, with + Add > Slider, or with the **Add slider k** fix that appears under any field using an unknown name.
- **Drag it and the picture follows while you drag**: the preview redraws on the next animation frame, then once more at full quality 150 ms after you stop. Expressions are compiled once and read slider values at call time, and each tool is recomputed only when a slider it uses changes.
- **Play** sweeps a slider between its minimum and maximum. Type a value outside the range and the range widens.
- **Computed values.** Every points tool publishes its results under its name: `P1_x`, `P1_y` (`P1_z` in 3D), `P1_val` (objective value), `P1_n` (count), and `P1_x2`, `P1_y2`, ... for later points. Any field can use them, and they update live: a line `2x + 3y = P1_val` through the optimum, a region bounded by `P1_y`, a tangent at `P1_x`.
- **Label templates.** Every text (title, text labels, region, condition, curve, point and segment labels) can show values: `{c}` (up to 3 decimals), `{P1_val:1}` (1 decimal). Points add `{x}`, `{y}`, `{z}`, `{val}` and `{i}`; curves add `{level}`. `$...$` is LaTeX math.
- **In your notes** the chart shows its sliders underneath (up to three rows, then "Show N more", plus a reset button). Moving them changes the picture for the current session only and never edits the note. Switch them off in Chart > In your note.

Guides: [Sliders that move the picture](guides/sliders.md), [Animate a chart with play](guides/animate-play.md), [From secant to tangent](guides/secant-tangent.md), [An area that grows with a slider](guides/area-accumulation.md), [Calculate with computed points](guides/computed-values.md).

## Drag to edit

In the editor's 2D preview, drag a line, curve, point or text label, and Easy TikZ rewrites the numbers in its formula so that the part you grabbed follows the pointer. Only numbers and their signs are rewritten (your spacing, `*` and `≤` stay as typed), and the card and the Sliders dock update while you drag. The film in [What's new](whats-new.md#40-drag-to-edit-live-sliders-a-new-editor) shows a drag and a Shift-turn on the Linear program example.

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

Guide: [Drag shapes to edit them](guides/drag-to-edit.md). Every key and mouse gesture is in [Keyboard, mouse and troubleshooting](guides/shortcuts.md).

## Optimisation diagrams

A linear program with its feasible region, an objective line on a slider and the optimum, built in the editor:

1. **+ Add > Feasible region (inequalities).** It starts with `x >= 0`, `y >= 0` and constraint lines on. Type `x + y <= 4` in the empty row and add a row `x + 3y <= 6`; **Number them** labels the constraint lines (1), (2), ...
2. **+ Add > Line from an equation**, type `2x + 3y = c` and click **Add slider c** under the field. Set the curve label to `z = {c}`.
3. On the region card, **Find optimum**: a points tool over the region with the objective `2x + 3y`, Max. **Mark corners** adds the vertices with their coordinates.
4. In Chart > Ranges, set x from 0 to 5 and y from 0 to 4.5. Press play on `c` and watch the line sweep across the region: the last point it touches is the optimum (3, 1), at c = 9.

The same chart as a block you can paste into a note:

```easy-tikz
show x from 0 to 5 and y from 0 to 4.5
axes on the edges
slider c from 0 to 15, starting at 6, in steps of 0.1
shade where x + y <= 4 and x + 3y <= 6 and x >= 0 and y >= 0, numbered, with constraint lines
draw 2x + 3y = c in red, dashed, labelled "z = {c}"
mark the maximum of 2x + 3y in the region, large, labelled "z* = {val} at ({x}, {y})"
```

What the lines leave out takes its default. From here:

- **Pin the line to the optimum** with `draw 2x + 3y = P1_val` instead of the slider.
- **Drag instead of typing:** grab a constraint line in the preview, and the region, its corners and the optimum follow. Shift-drag the objective line to turn it: the objective of P1 changes with it, because both are the same text.
- **Sensitivity:** replace a right-hand side with a slider (`x + y <= b`) and press play. Region, corners and optimum follow.
- **Integer programs:** a points tool with source Integers over R1 and the same objective marks the best integer point.
- **Nonlinear objectives:** draw the objective as a curve with levels (`x^2 + y^2` at `1, 3.2, 6`), shade the constraint as a region, find the minimum with a points tool over it (Min), and add a curve `x^2 + y^2` with levels `P1_val`: the level curve that touches the constraint at the optimum.
- **Unbounded or infeasible:** the status chip says when the objective is unbounded within the view or the region is empty.

Four guides build such charts step by step: [Solve a linear program in a picture](guides/linear-program.md), [Compare an integer program with its relaxation](guides/integer-program.md), [Find a nonlinear optimum with level curves](guides/level-curves.md) and [Draw a market with surplus areas](guides/supply-demand.md). The reference in the Help tab has a section *Optimisation recipes*, and the examples *Linear program*, *Level curves and a constraint* and *Market equilibrium* open them ready-made.

## Charts in notes

The plugin registers an `easy-tikz` markdown code-block processor. **Insert into note** writes a text block ([Charts as text](#charts-as-text); JSON if you choose it in the settings); the same renderers that power the editor preview draw the chart in your note, and a chart with sliders gets its own slider strip underneath. Click the rendered chart to re-open the editor pre-filled with every setting: change something, **Save changes**, and the block in the source file is updated in place (a text block line by line, keeping your comments). Hover the chart for alignment and width controls. If something in the chart cannot be drawn, a muted line under the chart names the problem, with its line and column in a text block; the rest of the chart still renders. When a block changes, its chart glides from the old picture to the new one and new objects pop in (setting **Animate chart changes**; never with reduced motion). While you edit a block in Live Preview, its chart sits right under the lines and changes as you type; when the cursor leaves, Obsidian's own chart takes over in the same frame (setting **Chart under the block while you edit**).

Guide: [Charts in your notes](guides/charts-in-notes.md).

Plugin setting **"Also render plain `tikz` blocks"** opts in to claim the `tikz` language tag as well; off by default to coexist peacefully with `obsidian-tikzjax` and similar.

## Export

**Copy TikZ** (and the Code tab) produces pgfplots code that compiles with pdflatex. By default it is a standalone document (`\documentclass[border=5pt]{standalone}` plus the packages it needs); switch off **Standalone document** in the Code tab to get only the `tikzpicture`, with `% Needs: ...` lines listing what your preamble must load.

The preview and the export draw the same scene, so what you see is what pgfplots draws:

- **Functions** are exported as formulas (`\addplot`), with slider values substituted, functions used by name written out, and trigonometry in radians (`trig format plots=rad`). Curves are split where the preview breaks them (poles, jumps), and `restrict ... to domain` with `unbounded coords=jump` keeps steep functions such as `x^3` or `tan(x)` from stopping pdflatex with "Dimension too large".
- **Regions, curves, points, segments and braces** are computed by the plugin and exported as coordinates. They match the preview exactly, but they do not recompute if you edit the LaTeX. The export is a snapshot at the current slider values.
- **Colours** are defined with `\definecolor` inside the picture, so the PDF uses the plugin's own colours rather than xcolor's (whose `green`, `purple` or `teal` look quite different). In the note, charts use your theme's colours by default; the setting **Chart colours: As in the LaTeX export** shows exactly the PDF's colours there too. "Auto" (the theme's text colour) exports as black.
- **Layers and legend:** fills sit on the axis background layer, below axes, curves and markers. Every `\addplot` without a legend entry (markers, extra pieces of a broken curve) carries `forget plot`, so legend entries stay with their functions.
- **Text:** labels are escaped, so `50% cut`, `x_1` or `R&D` print as typed, while `$...$` math and LaTeX commands such as `\textbf{A}` pass through.
- **Size and aspect:** width and height come from Chart > Export size; **Equal scale** (always on in polar charts) exports as `axis equal image`, which keeps your ranges and shrinks the box.

The editor's **Copy SVG** and **Copy PNG** buttons serialize the live preview with theme colours already resolved.

Guide: [Export to LaTeX](guides/export-latex.md) (standalone document or snippet, the size on paper, colours and label text, what the export freezes, hand edits).

## Plugin settings

Settings → Community plugins → **Easy TikZ**:

- **Write new charts as.** Text (default, one line per object in words) or JSON. A chart you edit keeps the form its block has.
- **Chart colours.** From your theme (default: native colours that follow light and dark mode) or As in the LaTeX export (the fixed colours of the PDF). CSS snippets can set `--etz-red`, `--etz-blue`, ... directly.
- **Chart under the block while you edit.** On by default: in Live Preview, a block you are editing shows its chart right under its lines, changing as you type.
- **Animate chart changes.** On by default: when a block changes, values glide and new objects pop in. Charts never move when your system asks for reduced motion.
- **Invert vertical drag in 3D.** Trackball convention by default (drag down tilts the scene up); flip for direct manipulation (camera follows finger).
- **Max 3D samples per axis.** Upper bound of the per-surface Samples slider. Default 80, at most 120. The export always uses at most 60 samples per axis, because pdflatex runs out of memory above that.
- **2D pan sensitivity.** Default 1.0 (direct: 1 mouse pixel = 1 chart pixel), from 0.1 to 2.0.
- **Also render plain `tikz` blocks.** Off by default; on if you want one tag for everything (conflicts with obsidian-tikzjax).
- **Show what's new after updates.** On by default. After an update that brings something new, a short popup shows what changed, once. The command **Show what's new in version 4** and the link in the Help tab open it at any time.
- **AI access** (on a computer; phones and tablets show only the guide and the agents' section). **Let AI apps make charts** (off by default) starts the local AI server; below it: its status, the **Port** (default 27150), the **Token** with **Copy** and **New token**, **Connect an AI app** with the line each app needs, **Tell AI agents in this vault** and **Copy the guide for AI chats**. The editor's **AI** tab has the same switch.

## Live rendering, briefly

The preview is drawn in-process by a small custom pipeline (no shell-out, no LaTeX compile, no image round-trip), which is what lets sliders and the camera follow the cursor without lag. Expressions are parsed once and compiled into plain closures (no `eval`, no `Function`); sliders are read when the closure runs, so dragging one never recompiles anything. Regions, curves and points are memoised per tool and keyed by the sliders and names they use: dragging the objective slider `c` recomputes the objective line, not the feasible region. While a slider moves, the 2D preview draws at draft resolution on every animation frame and redraws at full quality once you stop. Drag to edit rides on the same loop: each pointer event solves for the new numbers, rewrites the text and requests a draft frame.

A typical 3D surface (samples=40, 1,600 quads) sits at ~60 fps; the slider's upper end (samples=120, 14,400 quads) settles above 30 fps. Sampled surface data is cached per surface, keyed by expression, domain, sample count, z-range and the sliders the surface uses, so a pure camera change (rotation, zoom) re-projects from the cache without re-evaluating the function.
