# Changelog

All notable changes to this project are documented in this file.
The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/).

## [4.0.0] - 2026-10-12

Version 4 is a redesign around four goals: a clearer editor, sliders that move the picture while you drag them, shapes you edit by dragging them in the preview, and more power for complex pictures (several areas between curves, optimisation models) from fewer, more general tools instead of more special-purpose ones. Under the hood, expressions are compiled once into closures, and one scene layer computes every shape for both the preview and the export, so the two can no longer disagree. 3.x blocks are migrated when they render or open; the breaking changes are listed at the end of this section.

### Added

- **A redesigned editor with four tabs: Build, Chart, Code and Help.** The eight 3.x tabs (Graph, Axis, Functions, Tools, Annotations, Grid, Code, Reference) spread related settings over several places and needed a new tab for every kind of tool. **Build** now holds everything you draw as one list of cards (functions, or surfaces in 3D, then "Shapes and marks"); **Chart** holds ranges, axes, grid, export size, note width and the 3D view; **Code** shows the LaTeX; **Help** is the rewritten reference. Every card follows one pattern: colour swatch, a renameable name badge (a rename updates every formula and label placeholder that uses it), a plain-language summary ("Shaded where f2 <= y <= f1, 0 <= x <= 4", "Max of 2x + 3y over R1"), an eye toggle, and a menu with Duplicate, Move up / down and Delete (Alt+Up / Alt+Down move the focused card). The header switches 2D / 3D and Cartesian / Polar; the preview gets a status chip, a coordinate readout and an action pill (Fit, Reset, Grid, Lock pan and zoom, Edit shapes by dragging, 3D zoom); Cmd/Ctrl+Enter inserts or saves. When the editor is narrower than 700 px, or narrower than 900 px and taller than 0.8 times its width, the preview stacks above the cards.
- **Sliders (parameters) that update the preview while you drag.** A slider is a named number usable in every field: formulas, domains, region conditions, point lists, labels and axis ranges. The **Sliders** dock sits under the preview in every tab, with play (sweeps between minimum and maximum, about 4 s each way), editable minimum / maximum and step, rename, and compact pills from five sliders on. A drag redraws on the next animation frame at draft resolution and once more at full quality 150 ms after the last move. Expressions read slider values when they run, so dragging never recompiles anything, and each tool is recomputed only when a slider it uses changes (dragging the objective slider of a linear program redraws the objective line, not the feasible region).
- **Drag to edit: grab a shape in the preview and its numbers follow.** Until now a shape changed only when you typed (text labels were the one thing you could drag): to put a constraint line through a corner, you worked out its right-hand side yourself. In the 2D preview of the editor you can now drag a line, a curve, a point or a text label, and Easy TikZ rewrites the numbers in its formula so that the part you grabbed stays under the pointer. Only numbers are rewritten, with their signs (`-x + 4` dragged down by 6 reads `-x - 2`): your spacing, `*` or no `*` and `≤` stay as you typed them, the card and the Sliders dock follow while you drag, and dragging back to where you started restores the text exactly.
  - **Two gestures.** A plain drag moves. **Shift-drag** reshapes around the pivot ⊕ drawn in the preview: straight lines turn, curves stretch, circles and discs resize around their centre, and a segment turns around its other end. Points, segment ends and labels have no shape to change, so Shift moves them straight (horizontal, vertical or diagonal). Easy TikZ places ⊕ for you and shows it as soon as you hold Shift over a shape: a marked point or a region corner on the line, otherwise the point where a single number does the turn (the intercept (0, 1) for `2x + 1`); for a curve, the point that lets the fewest numbers change (the vertex of a parabola, the origin for `sin(x)`). Pressing or releasing Shift in the middle of a drag switches the gesture without a jump, and the drag stays one undo step.
  - **Which numbers change, in this order.** Sliders first (varying is what they are for; they stay on their step and inside their range), then the numbers you typed (a fraction such as `1/2` counts as one number), and only when those cannot produce the motion, an inserted number: a shift `(x - h)`, an offset `+ k`, a factor or a scale. No more numbers change than the motion needs. A constant exponent never changes (the `2` in `x^2`; a rate inside an exponent, such as the `0.5` in `e^(0.5x)`, is an ordinary number), and neither does a number multiplied by `pi`, `e` or a slider (`2pi` becomes `2pi + 0.3`, not `2.1pi`). A slider that also sets an axis range is left alone, and labels never move sliders, because the chart would move under them. Written values are as round as the screen allows: the roundest number within about 2 px of the pointer. A coefficient that lands on 1 is dropped when you release (`x + 1`, not `1x + 1`).
  - **Look before you drag.** Rest the pointer on a shape and a tip in the corner of the preview shows its formula with the numbers that will change highlighted and anything that would be inserted spelled out (`sin(x - h) + k`, "Adds a shift and an offset"). It also says when a slider is used by other objects. During the drag the tip follows the pointer with the live text and slider values.
  - **What you can grab.** Functions y = f(x) (an extremum marker drags its function, and a tangent slides along the curve when "Tangent at" is a number or a slider); the edges and constraint lines of a region (each belongs to one condition; an edge written with a function, as in `f2 <= y <= f1`, drags that function); the lines, circles and level curves of the curve tool (dragging one level changes its value in the Levels list, Shift-drag reshapes the equation behind all levels); listed points; the ends of a segment, or the whole segment by one of its sides; text labels (a position written as a formula gets an offset: `P1_x` becomes `P1_x + 0.4`). When one side of a curve's equation is the same text as the objective of a points tool (`2x + 3y = c` and the objective `2x + 3y` in the Linear program example), both change together, so the objective line and the computed optimum stay in step.
  - **Computed points stay computed.** An optimum, the corners of a region, intersections and integer points are results, so they cannot be dragged. The tip says what computes them and what to drag instead ("P1 is computed: the max of 2x + 3y over R1", "Drag R1's lines or C1 instead"), and a press on such a point goes through to the line under it, so a constraint line can be grabbed right at a marked corner. The same holds for whatever follows a computed value: an edge at `P1_y`, a tangent at `min`, a segment built from a points tool, and the plain drag of a level `P1_val` (Shift-drag still reshapes its curve).
  - **Snapping, and Alt for fine control.** A moved shape snaps its grabbed point to nearby markers and to the origin, and a moved line snaps so that it passes through a nearby marker (the objective line of a linear program stops exactly on the optimum). Points, segment ends and labels snap to the major grid, and so does the vertex of a moved graph. Turns click into simple slopes (1, -1/2, 5/6, horizontal, vertical), stretches into the factors 1/2, 1, 2 and -1 (mirrored). The tip names each snap ("through P1", "slope -1/2", "on the grid"). Hold **Alt** (Option on macOS) to switch off snapping and the rounding to rounder numbers.
  - **Keyboard.** Click a shape to select it (its card flashes in the Build tab). The arrow keys then move it by about a tenth of a grid step (Shift: ten times as far, Alt: a tenth), presses within one second count as one undo step, Enter (or a double-click on the shape) opens its field with the first number a move would change selected, and Esc clears the selection. Selections and finished drags are announced to screen readers. Hold Space, or use the middle mouse button, to pan from on top of a shape.
  - **Undo for the whole chart.** A finished drag is one step. A bar at the bottom names it ("Turned R1 (2)") and offers **Undo** for 6 seconds, and **Cmd/Ctrl+Z** and **Cmd/Ctrl+Shift+Z** undo and redo up to 50 steps while the chart stays open in the editor. The same history holds arrow-key moves, slider changes made in the dock, Make slider, and deleted cards and sliders, so Cmd/Ctrl+Z also brings back a deleted card (redo covers drags, arrow-key moves and slider changes). In a text field the shortcuts keep undoing your typing. An undo never overwrites a later edit: it restores what still holds the dragged value and says what it left alone ("Undone, except R1 (2), which was edited since"). **Esc** during a drag cancels it and puts every text and slider back.
  - **Make slider.** When a drag changed exactly one typed number, the Undo bar also offers **Make slider**: the number becomes a new slider that starts at that value, with a range from 0 to a round number at least twice it. Drag a line to where it belongs, then turn the number you found into something you can play.
  - **Switching it off.** The pointer button **Edit shapes by dragging** in the preview's action pill turns the feature off and on, and the choice is remembered. Switched off, the preview pans wherever you drag, as in 3.x, and text labels still move. The first time the pointer rests on a draggable shape, a tip explains the gestures once.
  - **Not draggable yet:** parametric and polar curves, the inside of a region (grab an edge or a constraint line), the automatic labels of regions, curves and points, 3D charts (dragging rotates the view) and charts in notes (drag to edit works in the editor preview only).
  - **Examples**, each a row of the golden table in `tests/drag-golden.test.ts`:
    - Slider first: `2x + 3y = c` with the slider `c` at 9, dragged from (3, 1) to (3.3, 1.2). The text stays, and `c` becomes 10.2.
    - A typed number: Shift-drag the constraint `x + 3y <= 6` from (0, 2) up to (0, 2.5). It turns around the corner (3, 1) and reads `x + 2y <= 5`.
    - Inserted numbers: `sin(x)` dragged 0.5 to the right and 0.5 up becomes `sin(x - 0.5) + 0.5`. Shift-dragging its peak from 1 up to 1.5 stretches it from the origin: `1.5sin(x)`.
    - Exponents stay: Shift-drag the edge of the disc `(x - 3)^2 + (y - 2)^2 <= 2^2` from (5, 2) to (5.5, 2). It resizes around its centre to `(x - 3)^2 + (y - 2)^2 <= 2.5^2`.
  - **Tested** by 264 tests in the eight `tests/drag-*.test.ts` files: 44 golden rows (each also checks that releasing causes no jump and that dragging back restores the text byte for byte), 2300 random expressions whose rewritten text must compute the same values as the dragged shape, and solver, hit-testing, session and regression cases.
- **Recipes and examples.** **+ Add** lists 23 recipes in 2D and 7 in 3D in plain words (Area between two functions, Feasible region, Vertical line x = c, Level curves of F(x, y), Intersections of two functions, Optimum over a region, Integer points in a region, Brace with label, Slider, Text label, ...). Apart from functions (surfaces in 3D), text labels and sliders, each recipe is a pre-filled card of one of the five general tools, so a recipe also shows what the tool behind it can do. Six examples (Linear program, Areas between two curves, Tangent explorer, Level curves and a constraint, Market equilibrium, Surface and plane) open from the empty state, the header menu and the Help tab as working charts to change. A new chart opens on "Start a chart": type a formula and press Enter.
- **Inline errors with quick fixes.** A problem appears under its field after a short pause, often with a one-click fix: **Add slider k** for an unknown name, **Use a\*x** for `ax` (which is one name), **Use sin** for `sni(x)`, "Did you mean sin(x)?" for `sinx`. The status chip on the preview lists every problem (errors first) and jumps to the field; a tab containing an error shows a dot. A chart with an error still draws everything else.
- **Undo and autosaved drafts.** Deleting a card or a slider shows an Undo bar for 6 seconds, and Cmd/Ctrl+Z undoes it as well (the chart-wide history is described under Drag to edit). While the editor is open, the chart is saved as a draft one second after each change, so closing the editor by accident (Escape, a click outside) loses nothing: the next time the editor opens it offers "Unsaved chart from 14:32 [Restore] [Discard]". Drafts older than 7 days are ignored, a draft of a chart opened from a note is only offered for that same unchanged block, and Insert / Save clears it.
- **Computed values (derived names).** Every points tool publishes its results under its name: `P1_x`, `P1_y` (`P1_z` in 3D), `P1_val` (objective value), `P1_n` (number of points), and `P1_x2`, `P1_y2`, ... for later points. Any field can use them and they update live, which turns computed results from dead ends into building blocks: an objective line `2x + 3y = P1_val` through the optimum, the level curve that touches a constraint (levels `P1_val`), surplus regions bounded by the equilibrium price `P1_y`, a tangent at `P1_x`. Tools are computed in dependency order, and a circular reference is reported on each tool involved ("circular reference: R1 -> P1 -> R1").
- **Label templates.** Every text (chart title, text labels, region, condition, curve, point and segment labels) can show live values: `{c}` prints with up to 3 decimals, `{P1_val:1}` with 1. Points add `{x}`, `{y}`, `{z}`, `{val}` and `{i}` (`;` separates per-point labels: `A; B; C`), curves add `{level}`, `{{` and `}}` give a brace that is not a placeholder (a LaTeX group), and a placeholder that cannot be computed shows `?`.
- **A richer expression language.** Implicit multiplication (`2x`, `3(x + 1)`, `a x + b`), `pi`, `e`, `π`, `θ`, `ln`, `sec`, `csc`, `cot`, `≤ ≥ ≠`, `and` / `or`, chained comparisons (`0 <= x <= 4` means both hold), functions called by name (`f1(x - 1)`; a bare `f1` means `f1(x)`), and **Axis variables** (Chart > Axes) for models written in `x1, x2` or `q, p`. Apart from chained comparisons (3.19.6 read `3 > 2 > 1` the JavaScript way, as false), everything 3.19.6 accepted still compiles with the same meaning, checked against a corpus of 212 expressions with the values 3.19.6 computed for them (`tests/expr.test.ts`).
- **Formulas in axis ranges, and Equal scale.** Ranges accept formulas and sliders (`xmax = 2a`); pan and zoom leave such axes alone. **Equal scale** (Chart > Axes; always on in polar charts) gives both axes the same units so circles stay round, in the preview and as `axis equal image` in the export.
- **Sliders in your notes.** A chart with sliders shows them under it in the note (up to three rows, then "Show N more", plus a reset button). Moving them redraws the chart live for the current session and never writes to the note; Chart > In your note > Show sliders in note turns the strip off. Problems appear as a muted line under the chart instead of replacing it.

### Changed: tools and migration

- **Eleven tool types condensed into five: Region, Curve, Points, Segment and Plane.** Each 3.x tool did one thing (an area between exactly two functions, a vertical line, a circle, ...) and could not be combined, so a feasible region, three areas between curves or an optimum point had no tool at all. The v4 tools are general:
  - **Region** shades where every condition holds (one condition per row; chains, `and`, `or`): areas between any number of curves, areas under a curve, feasible regions with full-length constraint lines labelled `(1)`, `(2)`, ..., rectangles, disks, unions. Linear conditions give exact polygons; other conditions are traced on a grid with their corners solved exactly.
  - **Curve** draws any equation in x and y (`2x + 3y = 12`, `x = 2`, `x^2 + y^2 = 4`) or the level curves of a formula (levels `2, 4, c`).
  - **Points** marks a list of points, the intersections of two functions or curves, the corners of a region or the integer points inside it, and an optional objective keeps only the best: the continuous optimum over a region (nonlinear objectives and curved boundaries included), the best integer point, the best listed point. An objective that is unbounded within the view, or an empty region, is reported in the status chip.
  - **Segment** is a path through any number of points (formulas, or a points tool's name): line, arrows or closed polygon in 2D and 3D, or a brace with a label in 2D.
  - **Plane** is the 3D plane x, y or z = value, now depth-sorted with the surfaces it cuts instead of painted on top.
- **3.x blocks are migrated when they render or open.** Migration happens in memory: the note is only rewritten when you press Save changes in the editor (the width and alignment controls still patch only their own keys). What it does:
  - Every function gets a stored name. Blank names become `f1`, `f2`, ... by position as before; duplicate, reserved or malformed names are renamed and the references follow. From then on references use names only, so reordering functions no longer breaks them.
  - Legacy tools become v4 tools: `areaBetween` a region `min(f, g) <= y <= max(f, g)` (plus `a <= x <= b` for its domain), `rectangle` a region, `verticalLine` / `horizontalLine` the curves `x = c` / `y = c`, `circle` a curve (a region when filled), `intersection` and `point3D` points, `segment`, `brace` and `segment3D` segments; `plane3D` stays a plane.
  - Tools that 3.x drew nothing for (an area or intersection naming a missing function or one without a domain, a circle with a non-positive radius) are migrated as hidden, so the picture does not change.
  - **3.x functions with an empty domain stay hidden.** 3.x skipped them, while v4 reads an empty domain as "the visible x range". Migration marks them hidden to keep the old picture; they remain callable by name, and the eye button on the card shows them.
  - Label text (title, axis labels, legend entries, text labels, tool labels) was raw TeX in 3.x. It is converted to v4 label text that typesets the same (`50\%` becomes `50%`, `\textbf{EUR}` stays LaTeX), and braces in template fields are escaped so they do not become placeholders.
  - Numeric ranges become strings, and ranges 3.x left blank fall back to the defaults, as 3.x did. The document setup choice carries over as the Standalone document switch.

### Changed: export

- **Standalone document by default.** The export is a complete file (`\documentclass[border=5pt]{standalone}`, the packages and TikZ libraries the picture uses, `\begin{document}` ... `\end{document}`). 3.x had no document class, and turning the document setup off produced code that did not compile. With **Standalone document** off (Code tab) the export is just the `tikzpicture`, preceded by `% Needs: ...` comment lines listing what your preamble must load.
- **Trigonometry in radians** (`trig format plots=rad`). pgfplots evaluates trig functions in degrees by default, so 3.x exports of `sin(x)` (and of any trig inside a polar r(θ)) did not match the preview. Polar and parametric curves are exported with `x` as the variable; 3.x's parametric plots used a `parametric` key and a variable `t` that pgfplots does not know, and did not compile.
- **Colours match the preview.** The palette colours a picture uses are defined inside it (`\definecolor{etBlue}{HTML}{3498DB}`), instead of relying on xcolor's names, whose `green`, `purple`, `teal` and `orange` look quite different. "Auto" (the theme's text colour) exports as black.
- **Steep functions compile.** `restrict x to domain` / `restrict y to domain` (ten view spans around the view) and `unbounded coords=jump` keep `x^3`, `exp(x)` or `tan(x)` on a wide view from stopping pdflatex with "Dimension too large", and curves are split where the preview breaks them (poles, jumps) instead of getting vertical connectors.
- **Legend entries stay with their functions.** Every `\addplot` without a legend entry gets `forget plot`; in 3.x a tangent or extremum plot took the next function's legend slot.
- **Text and formulas are escaped for LaTeX.** Outside math, characters such as `%`, `&`, `#` and `_` print as typed, and `$...$` passes through (details under 2D export below). Formulas reach pgfmath fully parenthesised, because pgfmath reads `^` and `?:` left to right and gives `&&` and `||` the same precedence; `log` is written as `ln`, `%`, `round` and the other JavaScript-only functions are spelled out, slider values are substituted, and functions used by name are inlined (guarded by their domain). Legend entries for formulas are typeset (`\frac`, `\sqrt`, `\le`, ...).
- **Layers like the preview.** Fills sit on pgfplots' axis background layer (`set layers`), below axes, curves, markers and labels, so a marker on an axis (a linear program's corner at (0, 0)) is no longer hidden by the axis line. `clip mode=individual` keeps labels at the border of the plot visible.
- **Shapes are exported from the preview's scene.** Regions, curves, points, segments, braces, tangents and extrema are exported as coordinates computed by the plugin: even-odd fills with holes, and patterns as a hatch over the tint (with `\usetikzlibrary{patterns}`, which 3.x left out). They match the preview exactly but do not recompute if you edit the LaTeX, and `fillbetween` is no longer needed. Paths are simplified to stay within TeX's memory (at most 3000 points per path and 15000 per picture). A function's Fill now exports the area between the curve and the x-axis, as the preview shows it; 3.x closed the curve back to its first point and shaded a different area.

### Changed: 3D export

- The exported picture shows the side the preview shows. 3.x PDFs were mirrored by twice the azimuth.
- The box is sized to the paper with explicit x, y and z unit vectors, so it fills the configured width and height (no `view=`, `width=` or `unit vector ratio`). Ranges a TeX dimension cannot hold fall back to `view` plus `width` / `height`.
- Labels at the edges of the box are no longer clipped (`clip mode=individual`).
- Planes are drawn between the pieces of the surfaces they cut, in the order the camera sees them.
- Dense surfaces share one sample budget, so three or more detailed surfaces still compile. Each surface uses at most 60 samples per axis.

### Changed: 2D export

- CSS colour names export with their CSS values (`lime` is now `00FF00`, not xcolor's yellow-green).
- With middle axes, the axis labels sit beyond the arrow tips.
- The legend uses `\footnotesize`.
- Labels keep their LaTeX: `\textbf{A}`, `\%` and `\alpha` work outside `$...$`, while `%`, `_`, `<`, `|` and a lone `$` print as typed. Region labels are bold.

### Changed: preview

- **A drag on a shape edits it; a drag on empty space pans.** In 3.x a drag in the 2D preview panned unless it started on a text label. Now a drag that starts on a line, curve or point changes its numbers too (see Drag to edit under Added). Drag empty space to pan as before, hold Space or use the middle mouse button to pan from on top of a shape, or switch **Edit shapes by dragging** off in the preview's action pill.
- The preview canvas follows the true paper aspect, with the preview size on its long side.
- Text in the preview is set at the size the PDF uses, so the preview shows the exported proportions.
- Region labels land in the same spot whatever the preview's size.

### Changed: settings and defaults

- **Max 3D samples per axis** now goes up to 120 (was 400). The export uses at most 60 samples per axis anyway, because pdflatex runs out of memory above that, and the preview stays above 30 fps at 120.
- **The minor grid follows pgfplots' `minor tick num`**: the setting is the number of lines between two major ticks, as the export draws them (the 3.x preview divided the major step by it instead).
- **New charts start with an empty title** (3.x started with `My graph: \(\sum\)`).
- **Help replaces Reference**: rewritten for v4, with drag to edit, operators, the implicit-multiplication traps, sliders, every tool, computed values, label templates, optimisation recipes, export notes and keyboard shortcuts.

### Fixed

- **An axis bound of 0 was impossible.** The preview read ranges as `parseFloat(value) || default`, so `xmin = 0` was drawn as -0.5 (and pan and zoom started from the default), while the export used 0. Linear programs, which almost always start at 0, could not be previewed as exported. Each bound now resolves on its own, 0 included, and an invalid bound shows an error on its field instead of silently falling back.
- **Two charts in one note no longer interfere.** Clip paths, fill patterns and arrowheads used fixed SVG ids (`plot-clip`, `arrowhead`), so the second chart in a note could pick up the first one's clip area or patterns. Every render now gets its own id prefix, with one arrowhead per colour.
- **Sliders updated only when released.** Obsidian's slider component reports a change on release, and 3.x then waited another 150 ms. Every slider (dock, Chart tab, card opacity and samples, the strip in notes) now redraws on the next animation frame while you drag.
- **`a(x - h)^2` now means `a*((x - h)^2)`.** A slider in front of a bracket is written like a function call, and the parser applied the power to the whole product: the vertex form of a parabola was read as `(a*(x - h))^2`, so `a` was squared and a negative `a` no longer opened the curve downward. The power now belongs to the bracket only, exactly as in `2(x - h)^2`; write `(a(x - h))^2` to square the product. The same holds for a variable, a constant or a computed value in front of the bracket (`x(x + 1)^2`), while real function calls are unchanged (`sin(x)^2` and `f1(x)^2` square the value). The preview, the detection of linear conditions and equations, the pgfmath export and the typeset legend share the one rule.
- **`-x^2` and the Gaussian template export unambiguously.** The preview reads `-x^2` as `-(x^2)`, as 3.19.6 did, but 3.x pasted formulas into pgfmath as typed, where `^` groups left to right (`2^x^2` is `(2^x)^2`) and very old pgf versions read `-x^2` as `(-x)^2`. The export now writes `exp(-(x^2))`, so the Gaussian template and every other formula draw the same in the PDF as in the preview.
- **The Code tab no longer goes stale or loses edits.** 3.x regenerated the Code textarea on every preview frame (overwriting hand edits as soon as it lost focus), and Copy TikZ copied whatever the textarea held. The Code tab now regenerates only while it is shown. Hand edits are kept, with a banner ("Edited by hand. Chart changes are not applied here." [Regenerate] [Keep edits]), and Copy TikZ copies the edited text only when you edited it, fresh code otherwise.
- **No more error toasts while typing.** A render error raised a Notice on every keystroke; problems now appear under their field and in the status chip. Notices are left for clipboard and file errors.
- **Labels containing `$&`, `$$` or `$'` no longer corrupt the note.** Save changes and the width / alignment controls replaced the block with `String.replace`, which reads those sequences as replacement patterns. Both now splice the note by position through `vault.process`.
- **Enter or Space on a control inside an inline chart opened the editor** (the alignment buttons, for example). The editor now opens only when the chart itself has focus, so the hover controls and the slider strip work from the keyboard.
- **3D:** canvas text was always drawn at 10 px (a CSS variable in `ctx.font` is ignored), and 3D arrows drawn as SVG (charts in notes, Copy SVG) had no heads because they referenced a marker that did not exist. Both fixed.

### Breaking changes and notes

- **Blocks saved with 4.0 are not readable by 3.x.** They carry `"v": 4` and the new tool shapes, which 3.19.x does not draw. Blocks you only view are not rewritten; only Save changes writes the new format.
- **Exported code has a different shape.** Regions, curves and points are coordinates (no `fillbetween`, no `name path`), trigonometry is in radians, colours are `et...` names defined in the picture, normal-size labels are `\small` (3.x: `\normalsize`) and the legend is `\footnotesize`. If you post-process exported code, check it again.
- **Label text is a template.** `{` and `}` in labels now delimit placeholders; write `{{` and `}}` for a LaTeX group and `\{` `\}` to print a brace. Migrated 3.x labels are escaped automatically.
- **`ax` is one name.** With implicit multiplication, `2x` and `a x` multiply, but `ax` is a single name, and `1/2x` means `(1/2)*x`. The error under the field offers the fix.
- **An empty domain means the visible x range** (0 to 2π for parametric and polar curves). 3.x skipped such functions, which is why migrated ones are hidden (see Changed: tools and migration).
- **A drag that starts on a shape no longer pans.** In the 2D preview it edits the shape (Drag to edit). Drag empty space, hold Space, or use the middle mouse button to pan, or switch **Edit shapes by dragging** off to get the 3.x behaviour back.

## [3.19.6] - 2026-07-20

Community-directory review pass: resolves every error and warning from the
Obsidian plugin review bot. No new features; one real bug fix fell out of it.

### Changed

- **Math expressions are now compiled by a built-in parser instead of `new Function`.** The old compiler passed user expressions to `new Function` (JavaScript's cousin of `eval`), which flagged the plugin for "dynamic code execution" and made static review impossible. The new recursive-descent parser compiles the same language - numbers, `x`/`y`, `+ - * / % ^ **`, comparisons/ternaries for piecewise functions, all the bare Math names (`sin`, `atan2`, `min`, …), constants (`PI`, `E`, …), and `Math.foo(...)` member access - into plain closures, so no dynamically generated code runs at all. Two side effects are strict improvements: `-x^2` now parses as `-(x^2)` (the old compiler rejected it outright), and syntax errors carry positions ("Expected ')' … at position 5"). Verified against a 62-case regression suite covering every built-in template, operator precedence, piecewise logic, and error timing.
- **Requires Obsidian 1.13.0 or newer** (was 1.4.0). The settings tab now uses the declarative settings API - entries appear in Obsidian's settings search - and sliders rely on 1.13's always-visible inline value instead of the deprecated `setDynamicTooltip()`. Users on older Obsidian versions keep 3.19.5 via `versions.json`.
- **The editor modal no longer injects a `<style>` element.** It used to carry a bundled copy of the stylesheet and add it to `document.head` on open; the `styles.css` that ships with the plugin (and that Obsidian loads automatically) is now the single source. Also drops the `esbuild-plugin-inline-import` build dependency and shrinks `main.js` by ~10 KB.

### Fixed

- **"Save as" template naming now works.** Both Save-as buttons called `window.prompt()`, which Electron does not implement - the call returned nothing and no template was ever saved on desktop. Replaced with a small in-app naming modal (pre-filled with the expression, Enter to confirm).

### Housekeeping

Review-bot compliance details, no behavior changes intended:

- DOM nodes are created with Obsidian's `createEl` / `createDiv` / `createSvg` helpers instead of `document.createElement(NS)`.
- Static inline-style writes replaced with CSS classes (new `.tikz-hidden` utility) or the sanctioned `setCssStyles()` helper; the 3D surface pool toggles visibility via the SVG `display` attribute. Labels that end up inside the exported SVG intentionally keep inline styles so exports survive serialization.
- `setTimeout` / `requestAnimationFrame` calls go through `window.` for popout-window safety.
- NaN checks spelled as `Number.isNaN(x)` / `Number.isFinite(x)` instead of `x !== x` self-comparisons.
- `SettingsManager.getValue` is typed `<T = unknown>` (was `any`), the last `eslint-disable` is gone, `TikzSetting.defaultValue`/`insertText` take `unknown`, and a dozen now-redundant type assertions were dropped.
- Toolchain: `tsconfig` lib bumped to ES2020 (fixes `Object.entries`/`fromEntries` resolving as error-typed), TypeScript 4.4 → 5.9, `obsidian` typings 0.15 → 1.13.

## [3.19.5] - 2026-07-20

### Fixed

- **Annotation text now renders LaTeX markup instead of showing it literally.** Labels entered on the Annotations tab (2D and 3D, SVG and canvas) were inserted as raw text, so expressions like `$f(x,y,\mu)$` showed up with the dollar signs and backslashes still in them. They now run through `stripLatex()`, the same helper already used for chart titles.
- **Expanded `stripLatex()` LaTeX coverage.** Beyond the original handful of Greek-letter macros, it now expands `\frac{}{}` and `\sqrt[n]{}`, converts `^`/`_` to Unicode super/subscripts where a mapping exists, resolves a large set of operator/relation/arrow/set-theory symbol macros (`\times`, `\leq`, `\to`, `\in`, …), special-cases `^\circ` as a degree sign, and strips `\left`/`\right` sizing and `$` math-mode delimiters.
- **Axis range fields (xmin/xmax/ymin/ymax/…) rejected every attempt to type a leading `-`.** The field validated and reverted its value on every keystroke, so the instant you typed `-` to start a negative bound, `Number("-")` failed the check and the input was wiped before the next digit landed - negative bounds could only be pasted in, never typed. Validation now only reverts invalid input on blur, matching the pattern already used for the tangent-point field.
- **All plot text now uses a single consistent font.** Axis tick numbers, 3D axis labels, and coordinate/tool labels (2D and 3D, SVG and canvas) previously rendered in the monospace font while the title, annotations, and legend used the regular text font. Everything in the plot itself now uses `var(--font-text)`. The Code tab's generated-TikZ textarea and the Reference tab's code snippets are unaffected - those display literal source code and stay monospace on purpose.
- **Annotation cards disappeared from the editor on reopen, even though the labels kept rendering on the graph.** `buildAnnotationsTab()` had no hydration step - unlike the Functions tab, which seeds a card per saved function, the Annotations tab's `addCard()` never accepted a seed and was only ever called blank from the "+ Add label" button. So every fresh modal open (e.g. reopening after Save changes, or clicking a rendered chart to edit it) started with zero cards regardless of saved data; the graph still showed the labels because the renderer reads `settings.annotations` directly, independent of the UI. Existing annotations are now hydrated into cards on open, and the Text field (which never called `.setValue()`) now shows its saved value too.

### Added

- **Custom legend labels for functions.** Each function card's Legend toggle now reveals a "Legend label" field; when set, it's used verbatim for the `\addlegendentry{...}` in both the exported TikZ and the live SVG preview (which also runs it through `stripLatex()`). Leaving it blank keeps the previous auto-generated label derived from the expression.
- **Real LaTeX rendering (via Obsidian's built-in MathJax) for title, annotation, and legend-label text in the 2D live preview.** When one of these fields is a single `$...$` or `\(...\)` wrapped expression, it's now typeset with `renderMath()`/`finishRenderMath()` (the same engine Obsidian uses for `$...$` in notes) and embedded via `<foreignObject>`, instead of the `stripLatex()` Unicode approximation - so `\frac{}{}`, `\sqrt[n]{}`, matrices, accents (`\vec`, `\hat`), `\binom{}{}`, and anything else valid LaTeX now render correctly instead of degrading to flattened or garbled text. Plain prose, mixed text, and unwrapped macros still use the lightweight `stripLatex()` path (new file: `src/mathlabel.ts`). 3D preview and the default (non-custom) legend label derived from a function's expression are unaffected, since raw expression syntax isn't valid LaTeX.
- **Lock pan/zoom toggle for the 2D preview.** New padlock icon in the floating action strip (right edge of the preview). Dragging or scrolling on the canvas silently rewrites xmin/xmax/ymin/ymax, which could undo carefully-tuned axis ranges from an incidental click near the plot (e.g. while dragging an annotation). Locking disables the pan/zoom axis writes without affecting annotation dragging or 3D rotation. Per-session only; resets to unlocked next time the editor opens.

### Notes

- MathJax-rendered labels apply to the live preview only. "Copy as SVG" / "Copy as PNG" exports replace them with the `stripLatex()` Unicode approximation, since a standalone SVG can't carry MathJax's document-level stylesheet (and `<foreignObject>` content would break PNG rasterization).
- Obsidian loads MathJax lazily; the editor now triggers that load on open and re-renders once it's ready, so `$...$` labels typeset correctly even when nothing else in the vault has rendered math yet.

## [3.19.4] - 2026-05-23

### Changed

- Re-released to refresh the public release artifacts. No functional change since 3.19.3.

## [3.19.3] - 2026-05-22

### Fixed

- **Command palette entry registered.** Previously the plugin only added a ribbon icon, so users who hide the ribbon (or just prefer Cmd/Ctrl+P) had no way to launch the editor. Adds an `Easy TikZ: Open editor` command via `addCommand({ id: 'open-editor', ... })`. Reported in #2 by @playerofgames.

## [3.19.2] - 2026-05-22

### Changed

- Minor wording cleanup across the README, CHANGELOG, release-post templates, marketing card text, and source-file comments. No runtime change.

## [3.19.1] - 2026-05-22

### Changed

- **Dropped the `builtin-modules` dev dependency.** Replaced with the Node standard-library import `import { builtinModules as builtins } from "node:module"` inside `esbuild.config.mjs`. The package was a thin wrapper around a list Node already exposes; one fewer dependency to audit. Resolves the Obsidian community-plugin validator's "*'builtin-modules' should be replaced with an alternative package*" warning.

### Fixed

- **Removed `::-webkit-scrollbar` from the tab bar styling.** The standard `scrollbar-width: thin` rule already does the job in every modern browser Obsidian ships on; the WebKit-prefixed selectors only customised the colour and added an Obsidian-validator warning about partial support.
- **Replaced `!important` with chained-class specificity** in the three modal-overriding rules. `.tikz-modal.tikz-modal { … }` and `.tikz-modal.tikz-modal .modal-content { … }` (0,2,0 / 0,3,0) reliably beat Obsidian's default `.modal` / `.modal-content` (0,1,0) selectors without `!important`, which is the recommended pattern.

## [3.19.0] - 2026-05-22

### Changed

- **`minAppVersion` bumped from `0.15.0` to `1.4.0`.** The plugin's styling relies on CSS `color-mix()` (Chromium 111+), the 3D renderer on `aspect-ratio` and `ResizeObserver`, and the modal on Obsidian's `setIcon` Lucide icons - all available in Obsidian 1.4 and later. The old floor was vestigial and would have caused the community-plugin submission validator to reject the manifest as incompatible with declared APIs.

### Added

- **`docs/submission/` directory** with everything needed to open the
  Community Plugin submission PR against `obsidianmd/obsidian-releases` -
  step-by-step guide, the exact `community-plugins.json` entry to paste,
  and a pre-filled PR description with all the checklist boxes pre-ticked.
  Closes the "Could not find or validate a manifest" loop with explicit
  troubleshooting for the most common rejections.

## [3.18.8] - 2026-05-22

### Changed

- **README + docs refresh.** Replaced the stale 2.x screenshots with five SVG-rendered marketing cards (hero, 2D plots, 3D surfaces, inline rendering, composable tools) matching the look of the Easy Git README. Restructured the README around quick-start → plot → tools → inline rendering → export → plugin settings, dropped the redundant Features grid, and added a clear "click any rendered chart to edit" loop description.

## [3.18.7] - 2026-05-22

### Fixed

- **Domains like `0:2*PI`, `-PI:PI`, `0:sqrt(3)` now actually work.** `MathHelper.parseDomain` was using `Number()` to parse each bound, and `Number('2*PI')` is `NaN` - so every built-in template that uses `2*PI` (Sine wave, Cosine, Damped oscillation, …) silently failed with "Could not evaluate any function" and produced an empty chart. That's why `sin(x)` looked broken even though `sin` itself was fine - the renderer never sampled it because the domain throw happened first. New `parseBound` helper tries `Number()` first (cheap fast path for `-10`, `3.14`, `1e3`), then falls back to the same `compile1D` pipeline that plotted expressions use, so anything that evaluates to a finite scalar (`PI`, `2*PI`, `sqrt(3)`, `log(10)`, etc.) works. Same upgrade for `parseTangentPoint`, so tangent point values can be `PI/2`, `pi/4`, etc.

## [3.18.6] - 2026-05-22

### Fixed

- **Click-to-edit no longer loses your functions.** When the modal opened from an inline `easy-tikz` chart, the Functions tab created a fresh blank card every time instead of populating cards from the saved state. The chart kept rendering correctly (the persisted `functions` were still in `SettingsManager`), but the Expression / y(t) / Tangent-point inputs were empty - so if you touched any field, the now-blank Expression got committed and wiped the function. Fixed both 2D and 3D:
  - `addFunctionCard(seed?)` accepts a saved function and merges it on top of the defaults.
  - The Expression, y(t), and Tangent-point inputs now call `setValue(state.…)` (they only had `setPlaceholder` before).
  - `populateFunctionsTab` loops `settings.functions` / `settings.functions3D` and creates one card per saved entry, falling through to a single blank card on a fresh modal.
  - Fill / Tangent / Parametric reveal their sub-rows when the seed has those toggles on (previously the toggle showed on but the dependent inputs stayed hidden until you flipped it off and back on).

## [3.18.5] - 2026-05-22

### Fixed

- **Expressions like `-1*x`, `2*pi`, `sin(pi/4)`, `-x` now work in tool coordinate fields.** `parseCoord` (used by every Tools-tab numeric field - vertical/horizontal line, rectangle, circle, segment, brace, 3D point/plane) was running `parseFloat` first and accepting any prefix that parsed as a number - so `-1*x` returned `-1`, `2*pi` returned `2`, etc. The expression evaluator was never reached. Now we evaluate as a math expression first and only fall back to `parseFloat` if evaluation fails.
- **"Area between" no longer connects across asymptotes with a diagonal line.** When either function went non-finite (or beyond the y-clamp) inside the requested domain, `drawAreaBetween` skipped the bad samples but the resulting polygon still drew a line between the last good point and the next one - visible as a stray diagonal cutting through the plot. The renderer now splits the fill into separate closed polygons, one per contiguous finite segment.

## [3.18.4] - 2026-05-21

### Fixed

- **3D +/− zoom overlay reappears when opening the modal in 3D mode.** The overlay's initial `display: none` was set in its builder, but `update3DVisibility` had already run during left-panel construction (before the right-panel overlays existed) so its visibility flip never reached this element. Now the builder reads `is3D()` directly when creating the overlay, and `onOpen` calls `update3DVisibility` one more time after every panel and overlay is built. Click-to-edit on a saved 3D chart now shows the zoom buttons from the first frame.

## [3.18.3] - 2026-05-21

### Fixed

- **2D drag panes inside the box again, like 3D rotation does.** The 3.18.1 CSS-transform approach translated the entire SVG element, which made the whole chart slide around (axes, labels, box edges and all) - the box appeared to "drag off" and the chart only snapped to the new range on release. Now that 3.18.2 fixed the icon-SVG mix-up, the original per-frame `applyAxisRange` path gives correct 1:1 panning: the chart pans inside its fixed axes each move, tick labels update live, the bounding box stays put. Same behaviour the 3D drag has always had.

## [3.18.2] - 2026-05-21

### Fixed

- **The real reason 2D drag felt 40× too sensitive.** `previewContainer.querySelector('svg')` was finding the **first** SVG in the preview area - which is one of the Lucide icons that `setIcon` injected into the floating-action buttons (Fit / Reset / Toggle grid), not the chart. Its bounding rect was ~18 px wide, so `plot.scale = config.width / rect.width` came out around 40× the real value - every drag, wheel zoom, and Copy SVG / PNG export was reading off that icon. New `getChartSvg()` helper iterates direct children (2D) or looks inside `.tikz-3d-root` (3D) so we always get the chart, never an overlay icon. Drag now visibly tracks the pointer in real time (no jump-at-the-end), the Fit icon stays put, and Copy SVG / PNG export the actual chart.

## [3.18.1] - 2026-05-21

### Fixed

- **2D drag really is 1:1 now.** The per-frame `applyAxisRange` math chained viewBox / plotW / range conversions every move event; even small float drift compounded into the felt "too fast" pan that lingered at every sensitivity setting. Replaced with a `transform: translate(dx * sensitivity, dy * sensitivity)` on the SVG element - provably 1:1 with the pointer because it IS the pointer delta. The axis range commits once on mouseup, then the SVG re-renders with the new range and the transform clears. Side benefit: drag is smoother (no ~60 SVG rebuilds per second) and the GPU-composited `will-change: transform` hint keeps it that way on heavy plots.

## [3.18.0] - 2026-05-21

### Added

- **Composable graph tools** - a new **Tools** tab in the modal (visible in both 2D and 3D). Each tool is independent so you can stack them freely.
  - **2D, function-referencing:** Area between two curves, Intersection points. Both look up functions by their new **Name** field (defaults to `f1`, `f2`, …).
  - **2D, reference lines:** Vertical line `x = c`, Horizontal line `y = c`. Both support color, thickness, dashed style, and an optional label.
  - **2D, free shapes:** Rectangle (with optional fill + pattern), Circle (drawn in axis coordinates so the radius scales with the data), Line segment (with optional forward / backward / both arrows), Brace with label (curly brace spanning two points).
  - **3D:** Plane at constant x / y / z, 3D point marker, 3D line segment with arrows.
- **Function Name field** on every 2D and 3D function card. Auto-defaulted to `f1`, `f2`, …; the user-facing label in the card header tracks the Name. Tools use the same Name as their reference.
- **Bisection root-finder** in `MathHelper.findIntersections(expr1, expr2, domain)` - 200-sample sign-change scan + 40-iter bisection per crossing, with de-duplication for tangent intersections.
- **Reference tab** gains a Tools section documenting every tool type with one-line recipes.

### Changed

- Exported pgfplots conditionally adds `\usepgfplotslibrary{fillbetween}` (when at least one area-between tool exists) and `\usetikzlibrary{decorations.pathreplacing}` (for braces). Plots without these tools are unchanged.

### Backward compatibility

- The new `tools` and per-function `name` fields are optional in the `easy-tikz` JSON block. Old blocks without them render unchanged; first-time round-trip through the modal auto-populates the Name fields.

## [3.17.2] - 2026-05-21

### Changed

- **2D pan sensitivity default is now 1.0 (direct manipulation).** Moving the mouse by N pixels pans the chart by exactly N chart pixels. The slider range stays 0.1–2.0 so you can dampen below 1.0 for finer control or push above for faster pans. Previously the default was 0.5, which felt off when users expected mouse-and-chart to track 1:1.

## [3.17.1] - 2026-05-21

### Changed

- **2D pan sensitivity is now configurable.** Default lowered from 1.0 (direct manipulation) to **0.5** - each mouse pixel moves the chart by half a chart pixel, giving smoother, finer pan control on dense plots. The plugin's settings tab gets a `2D pan sensitivity` slider (0.1–2.0, step 0.05) so you can tune it. The rate continues to scale with the current axis range, so the multiplier stays consistent as you zoom in or out.
- **Pan precision bumped from 3 to 5 decimal places.** The stored `xmin / xmax / ymin / ymax` now have sub-pixel granularity even at extreme zoom levels, so the pan is continuous rather than snapping to 0.001-unit steps. Trailing zeros are trimmed so integer-ish range inputs (`-5`, `10`) still display compactly.

## [3.17.0] - 2026-05-21

### Added

- **In-note hover controls on rendered charts.** Hover (or focus) a rendered `easy-tikz` chart and overlay controls fade in:
  - **Size slider** along the bottom - drags the chart width, height follows the chart's aspect ratio. Live during drag, persisted to the source block on release (so dragging stays smooth - only one re-render per gesture).
  - **Align buttons** on the left (left / center / right) - sets the chart's block alignment in the note. One click, one save, one re-render.
- Both options live next to the rest of the plot settings inside the `easy-tikz` JSON (`displayWidth`, `displayAlign`), so they survive editing the chart from the modal and travel with the note.

## [3.16.1] - 2026-05-21

### Fixed

- **Inline-rendered 3D charts were blank.** Two compounding issues:
  1. The 3D `.tikz-3d-svg` is now `display: none` globally (canvas-only modal); the markdown processor calls `renderSvg`, which populates the (hidden) SVG, but `renderCanvas` is never called for inline blocks - so the visible canvas was empty.
  2. The wrapper `.tikz-rendered-chart` had no explicit height when `applyRootFitContain` measured it, so the 3D root fell back to logical config dims with no parent measurement to refine them.

  Fix: CSS in `.tikz-rendered-chart` now shows the SVG (already populated by `renderSvg`) and hides the empty canvas. The markdown processor also sizes the wrapper explicitly from the markdown container's width and the chart's aspect ratio, so the renderer's fit-contain math has a real parent to measure.

## [3.16.0] - 2026-05-21

### Added

- **Inline rendering of plots in notes - no external TikZ plugin required.** The modal's "Insert into note" button now emits an `easy-tikz` JSON code block which the plugin renders inline using the same `SVGRenderer` / `SVG3DRenderer` that drives the live preview. The chart you see in the modal is exactly the chart that ends up in the note.
- **Click-to-edit.** Clicking a rendered chart reopens the modal pre-filled with the chart's settings (functions, ranges, title, labels, 3D rotation, polar, box aspect - everything). Hitting "Save changes" replaces the block in the source file in place; opening Easy TikZ from the ribbon icon still inserts a brand-new block at the cursor.
- **Optional `tikz` block rendering.** New plugin setting "Also render plain `tikz` blocks". Off by default to coexist with `obsidian-tikzjax` and friends. When on, `tikz` blocks that contain Easy TikZ JSON render the same way as `easy-tikz`; blocks that look like real LaTeX get a small "install obsidian-tikzjax" note instead of silent failure.
- **SettingsManager serialisation.** New `serialize()` / `static fromJSON(data)` round-trip every setting to a plain JSON object. This is the on-disk format inside `easy-tikz` code blocks and what makes click-to-edit possible.

### Changed

- **The Copy TikZ code button still produces pgfplots** for users who want to export to a real TeX install - the in-Obsidian rendering does NOT touch that path. Inline rendering and TikZ export are two independent outputs from the same model.

## [3.15.0] - 2026-05-21

### Added

- **3D box aspect setting** on the Graph tab (visible only in 3D mode). Two options:
  - **Equal (cube)** - each axis spans the same screen length regardless of data range. The bounding box is a perfect cube. The exported pgfplots adds `axis equal image`.
  - **True (proportional)** - edge lengths scale with the data ranges (`xmax-xmin`, `ymax-ymin`, `zmax-zmin`). An axis with a much larger range dominates the box, which is faithful to the data. Default.

  Surfaces and box outline share the new per-axis normalization, so the two stay aligned no matter which mode is active.

### Fixed

- **First-render 3D fit-contain.** The renderer measures its parent element to compute fit-contain dimensions, but on the very first paint the 3D root hadn't been attached to the preview container yet - `applyRootFitContain` fell back to the configured logical size and only got the right dimensions after the first user interaction. The modal now attaches the root to the preview container before calling `renderCanvas`, so the first paint already fits.
- **3D canvas now uses the full available preview area.** Previously `applyRootFitContain` capped at the configured logical size (`config.width` / `config.height`), so larger preview spaces left empty padding around the chart. The cap is gone; the canvas scales up to fill whatever space the preview area gives it while preserving aspect.

## [3.14.1] - 2026-05-21

### Fixed

- **3D preview now uses a single render path.** Previously the renderer painted to a `<canvas>` during drag and to an `<svg>` at rest (~180 ms after the last interaction). When the preview area was narrower than the chart's natural size, the canvas filled the (mis-shaped) root while the SVG letter-boxed via its default `preserveAspectRatio`, so dragging visibly stretched the chart and releasing snapped it smaller. The on-screen output is now always the canvas; the SVG is kept in the DOM (hidden via `display: none`) and re-rendered on demand by Copy SVG / Copy PNG. No flash on drag start or release.
- **3D root fits the preview area properly.** The CSS `max-width: 100% / max-height: 100% / aspect-ratio` combo failed under both-axis clamping (the aspect rule was overridden). The renderer now measures the preview area each render and writes explicit pixel width/height to the root for fit-contain. Memoized so dragging doesn't write inline styles every frame.
- **Preview re-fits on modal/window resize.** A `ResizeObserver` on the preview area triggers a re-render when the available space changes, so the chart stays sized correctly without needing to interact with it.

## [3.14.0] - 2026-05-21

### Added

- **Configurable 3D sample cap.** The Samples slider on each 3D surface card was hardcoded to a maximum of 80. A new plugin setting (Settings → Easy TikZ → "Max 3D samples per axis") raises that cap up to 400, in steps of 10. The Samples slider reads the cap each time the Easy TikZ modal opens; existing surfaces are clamped to the new cap if it was lowered.

## [3.13.5] - 2026-05-21

### Fixed

- **3D preview no longer distorts mid-drag.** The 3D root had both `style.width` and `style.height` set in pixels with `max-width: 100%` / `max-height: 100%` clamps. When the preview area was narrower than the configured size, max-width shrank the width while the explicit pixel height stayed put - the root became a rectangle. The canvas (CSS `width: 100%; height: 100%`) then stretched non-proportionally during drag, while the SVG (`preserveAspectRatio` default) letter-boxed on release, so toggling between the two paths visibly changed the chart's aspect, title size, and edge positions. Replaced with `style.width` + `style.aspectRatio` + `style.height: auto`, so the root scales proportionally and both render paths occupy an identical box.

## [3.13.4] - 2026-05-21

### Fixed

- **3D preview no longer "zooms in" while dragging.** Root cause: the canvas had inline `style.width` / `style.height` in CSS pixels, which overrode the CSS `width: 100%` rule. When the preview area was narrower than the configured canvas width, the canvas stayed at its full pixel width and visibly overflowed the `max-width`-clamped 3D root, while the SVG (sized via CSS) shrank to fit. Releasing the drag swapped to SVG and the chart visibly snapped smaller. The renderer no longer sets the canvas's inline width/height - only the internal pixel buffer - so the canvas tracks the same box as the SVG.

### Added

- **Plugin setting: "Invert vertical drag in 3D"** (Settings → Easy TikZ). Off (default) keeps the existing trackball convention - drag down raises the camera elevation, drag up lowers it. On flips it to direct manipulation - drag down lowers the camera, drag up raises it. Setting persists with the rest of the plugin data.

## [3.13.3] - 2026-05-21

### Fixed

- **Floating action icons and 3D zoom buttons no longer disappear after the first render.** `previewContainer.empty()` was wiping every child element on every render - including the overlays added at modal open. Replaced with `clearPreviewContent()` that only removes the SVG / 3D root, leaving overlays intact.

### Added

- **Per-coordinate-system axis labels.** Polar and Cartesian modes now have separate X/Y label storage (`axis_label_x_polar`, `axis_label_y_polar`), so customising one set doesn't trample the other. The Axis tab's label inputs swap to the right pair when you toggle Coordinate system, and the exported pgfplots emits the polar labels when polar is selected.

## [3.13.2] - 2026-05-21

### Added

- **Floating action icons on the preview.** A small vertical strip of icons sits on the right edge of the preview, vertically centered: Fit (auto-fit axis ranges to the live functions/surfaces), Reset (restore default axis ranges + reset 3D zoom), and Toggle major grid. Surfaces the most-used commands without diving into the Axis or Grid tabs.

### Changed

- **Box axis borders are now drawn with `--text-normal` and stroke-width 2** (previously `--text-muted` at 1.5), so the top and bottom horizontal bars read clearly against the canvas in both light and dark themes.
- **SVG preview now caps at `max-width: 100%` / `max-height: 100%`** so the chart always fits inside the preview area. Previously, a large preview width could push the bottom border and X-axis tick labels below the visible region.

## [3.13.1] - 2026-05-21

### Fixed

- **Tab bar overflow on narrow screens (e.g. 13" MacBook Air).** The tab bar now scrolls horizontally with a thin styled scrollbar, and tab button padding tightens under 1280px viewport width so all seven tabs fit without scrolling in the common case.
- **Reference tab text was not selectable on macOS.** Obsidian's modal applies `user-select: none` to descendants, so the recipes and code examples couldn't be highlighted to copy. Force `user-select: text` and a text cursor on the Reference content (including `<pre>` code blocks) so paragraphs, list items, and code samples can all be copied.

## [3.13.0] - 2026-05-21

### Added

- **"Axes" axis style.** The Axis tab's "Axis style" dropdown now offers a third option, "Axes (no box)", which renders the x and y axes as an L-shape at the lower-left of the plot with arrowheads, instead of an enclosing rectangle. The exported TikZ emits `axis lines = left`.
- **3D zoom buttons.** A small overlay in the top-right of the preview area exposes +, −, and reset buttons in 3D mode. Each click scales the projected box by 1.25x (clamped to 0.3–4.0). Useful since scroll-wheel zoom is disabled in 3D.

### Changed

- **Box axis style** now renders the top and bottom horizontal bars as explicit lines mirroring the left and right verticals, with tick marks on all four sides for symmetry.
- The previous `axis_allaround` boolean setting is now a tri-state `axis_style` dropdown (`box` | `middle` | `axes`).

## [3.12.0] - 2026-05-21

### Added

- **Parametric curves (2D).** Each function card gains a Parametric toggle. When on, the Expression field becomes x(t), a y(t) field appears, and the Domain field is now the t range. Both components can use the full Math.* suite. The exported TikZ emits `\addplot[parametric, ...]({x(t)}, {y(t)})`. Parametric overrides polar at the per-function level.
- Reference tab gains a Parametric section with copy-ready recipes: Lissajous figures, epicycloids, classic cubic, circle.

## [3.11.0] - 2026-05-21

### Added

- **Polar coordinates.** A "Coordinate system" dropdown on the Graph tab toggles between Cartesian and Polar. In Polar mode the expression is interpreted as `r(theta)` and the domain is the theta range in radians. The preview transforms to Cartesian internally (so existing axes, ticks, annotations, and drag all keep working); the exported TikZ becomes a parametric `\addplot ({r*cos(deg(\t))}, {r*sin(deg(\t))})` with `axis equal`. The variable can be written as `theta` or `x`.
- Reference tab gains a Polar section with copy-ready recipes: cardioid, rose curves, Archimedean and logarithmic spirals.

## [3.10.0] - 2026-05-21

### Added

- **Drag annotations on the preview (2D).** Click any annotation label in the live preview and drag it to a new position. The x and y inputs in the Annotations tab update live, and the exported TikZ uses the new coordinates. Drag is clamped to the visible axis range. 3D drag is not yet supported; edit those via the input fields for now.

### Changed

- 2D annotation `<text>` elements now have `pointer-events: bounding-box` and a `grab` cursor, so the entire text bounding box is hittable.

## [3.9.1] - 2026-05-21

### Added

- **Snap-to-extrema tangent.** Type `min` or `max` in a function card's Tangent point field, hit Enter (or click away), and the field snaps to the x value of the nearest local minimum or maximum on the domain. Append a digit (`min2`, `max3`) to pick the n-th. The Reference tab gains a paragraph describing the shortcut.

## [3.9.0] - 2026-05-21

### Added

- **Auto-fit button on the Axis tab.** One click samples every enabled function (or surface in 3D), drops the top and bottom 1 percent so vertical asymptotes do not blow out the range, adds 5 percent padding, and writes the result to xmin/xmax/ymin/ymax (and zmin/zmax in 3D). The range inputs and the live preview update immediately.

## [3.8.0] - 2026-05-21

### Added

- **Function templates.** Each function card on the Functions tab now has a Template dropdown. Built-in 2D templates: Parabola, Cubic, Sine wave, Cosine, Damped oscillation, Gaussian, Logistic, Hyperbola, Tangent (clipped), Upper half-circle. Built-in 3D templates: Ripple, Paraboloid, Saddle, Gaussian bump, Wave interference, Pringle. Selecting one fills the expression, domain(s), and a sensible color in a single click.
- **User-defined templates.** Each card has a "Save as" button. Type a name, and the current expression/domain/color is saved to Obsidian's plugin data store. Saved templates appear in the same Template dropdown under a "Saved" group and persist across sessions.

### Changed

- Plugin class renamed internally from `SimpleTikzPlugin` to `EasyTikzPlugin` and gained a small data layer for the user templates above.

## [3.7.0] - 2026-05-21

### Changed

- **3D preview now matches pgfplots framing.** The 3D scene is wrapped in a real bounding cuboid (12 edges, back-vs-front classified by camera orientation) instead of axes through the origin. Tick marks are short outward strokes on the back-facing edges; tick numbers and axis names (`x`, `y`, `z`) sit just outside the box. Drag through 360 degrees and the framing always opens toward the viewer.
- Box edges layered with the surface via the existing back-surface-front pass: back edges sit behind the surface (faint), front edges sit on top (stronger). Tick marks and labels live in the front layer so they are never occluded.
- The Canvas2D fast path uses the same box geometry, so what you see during drag matches what you see at rest.

The visual gap with the compiled pgfplots output is much smaller now.

## [3.6.1] - 2026-05-21

### Changed

- README gains a "Live rendering" section that explains the in-process render pipeline, the two output paths (SVG for export, Canvas2D for interaction), the sample/compile caches, and the actual frame budgets at different sample densities.

## [3.6.0] - 2026-05-20

### Changed

- **Canvas2D fast path for 3D interaction.** While dragging, scrolling, or sliding a 3D control, the renderer paints to a `<canvas>` with no DOM ops in the inner loop. Once the interaction settles (180 ms after the last event), it re-renders to the SVG and swaps back. Visually identical, dramatically faster for dense surfaces (samples=80+).
- The 3D renderer now owns a root `<div>` that holds both the SVG and the canvas; the modal attaches the root once. CSS toggles which sibling is visible.
- Copy SVG and Copy PNG force a fresh SVG render before serialising, so exports work correctly even mid-rotation.

### Performance numbers (default `sin(x)*cos(y)` surface)

| Density | Quads | SVG render | Canvas render |
| --- | --- | --- | --- |
| samples=20 | 400 | < 5 ms | < 2 ms |
| samples=40 (default) | 1600 | ~ 12 ms | ~ 5 ms |
| samples=80 | 6400 | ~ 45 ms | ~ 15 ms |
| samples=120 | 14400 | ~ 100 ms | ~ 32 ms |

Drag should feel real-time across the full slider range now.

## [3.5.0] - 2026-05-20

### Changed

- **Real-time 3D rotation.** Rotation, drag pan, and wheel zoom now render on `requestAnimationFrame` instead of the 150 ms debounce, so the FPS cap moves from ~7 to whatever the renderer can sustain (60+ on typical surfaces).
- **3D renderer is stateful.** The SVG, its child groups, and a polygon pool are built once per modal open and mutated in place across rotations. No more `createElementNS` storm per frame.
- **Sampled surface data is cached.** Cache key encodes the expression, both domains, the z range, and the sample count. Pure camera changes (rotation, view zoom) skip the function evaluation pass entirely; the cache is rebuilt only when one of those inputs changes.
- **Projection in one pass.** Each grid vertex projects once into a Float64Array; quads then read from the buffer instead of calling project four times per cell.

Settings that change the data (expression, domain, samples) still use the 150 ms debounce so text editing does not re-sample on every keystroke. The two paths cooperate: a pending fast render cancels a pending debounced render and vice versa.

No behaviour change. The visual output of any given config is identical; only the performance budget is different.

## [3.4.0] - 2026-05-20

### Added

- **Copy SVG** button on the action bar. Copies the live preview as an SVG with a transparent background. CSS variables are resolved at export time so the file renders correctly outside the plugin (Inkscape, Figma, Obsidian as `<img>`).
- **Copy PNG** button on the action bar. Rasterises the SVG at 2x resolution and copies a PNG to the clipboard, also with a transparent background.
- Reference tab gets a new "Exporting the preview" section covering the four output options.

### Changed

- **Renderer performance.** The 2D renderer used to recompile every expression `new Function()` on every one of the 500 samples per render; the 3D renderer did the same for every cell of its 40x40 grid. Compiled functions are now cached on the expression string (capped at 128 entries with LRU eviction), so a render compiles each expression once.
- 2D inner loop converted from per-sample object allocation and `try/catch` to a pair of `Float64Array`s plus inline screen-coordinate math. Drag-pan and wheel-zoom feel noticeably tighter, especially with tangents and extrema on.
- 3D `sampleSurface` switched from a nested array-of-arrays to a flat `Float64Array` with a 1D index. Same numerical output, fewer allocations per render.
- Action bar wraps to a second line on narrow modal widths instead of overflowing.

## [3.3.0] - 2026-05-20

### Added

- **Annotations tab.** New tab to place text labels at any (x, y) (or x, y, z in 3D) point. Each label has color, size (small/normal/large), and anchor (above/below/left/right/center). Rendered in the live preview and emitted as `\node` commands in the exported TikZ.
- **2D fill patterns.** Fill toggle now exposes a Fill pattern dropdown: Solid, Horizontal lines, Vertical lines, Crosshatch, Dots, NE diagonal, NW diagonal. Each pattern is supported in the SVG preview (via `<pattern>` defs) and in the exported pgfplots code (`pattern=...`).
- **2D fill opacity slider.** Per-function opacity from 0.05 to 1.0. Same value used by the preview and the exported code (was previously hardcoded and different between the two).
- **3D Samples slider** on every surface card (8 to 80, default 40). Higher = smoother surface in the preview and a higher `samples=` value in the exported `\addplot3`.

### Changed

- **Preview aspect ratio follows Width/Height (cm).** The live SVG used to be a fixed 0.7 ratio regardless of the configured cm dimensions. It now matches the cm aspect (clamped to a reasonable range), so the preview is a much closer match for the compiled pgfplots output.
- Reference tab gets Annotations, expanded Function options coverage, Samples in 3D options, and a new "Preview vs exported code" section explaining the two-pipeline architecture.

## [3.2.0] - 2026-05-20

### Added

- **Larger live preview by default.** Bumped the SVG render size from 550x400 to 760x532 so it no longer floats lost in the right pane.
- **Preview size slider** on the Graph tab (400 to 1400 px wide). Controls the live preview only; the exported TikZ dimensions stay under Width / Height (cm).
- **Mouse-wheel zoom in 2D.** Scrolling on the preview zooms in or out around the cursor. The new range writes back to xmin/xmax/ymin/ymax, so the generated TikZ code reflects what you see.
- **Click-and-drag pan in 2D.** Drag the preview to move the view; the axis range inputs and the generated code follow along. 3D drag still rotates the camera.

### Changed

- Axis range text inputs are now kept in sync when the view is zoomed or panned, so what's on screen is always what gets exported.
- Preview area grab/grabbing cursor styles unified across 2D and 3D.

## [3.1.2] - 2026-05-20

### Fixed

- Reference tab code blocks were getting flex-shrunk to a single line. Switched the panel to normal block flow and pinned `<pre>` blocks against shrinking.

### Added

- Reference tab is now much richer: Function options, Tangent, Extrema, 3D surface options, Camera controls, Grid, a Recipes table with copy-ready expressions/domains/ranges, and a Troubleshooting section.

## [3.1.1] - 2026-05-20

### Fixed

- Active tab no longer lags behind when scrolling the settings column. Replaced the IntersectionObserver-based tracking (which only fired when sections crossed a threshold) with a scroll listener throttled by `requestAnimationFrame` that picks whichever section is currently at the active line.

## [3.1.0] - 2026-05-20

### Added

- New **Reference** tab inside the modal with full function syntax docs: operators, trig (including hyperbolic), exp/log, roots, rounding, constants, and worked examples for both 2D and 3D.
- Bare Math functions are now in scope inside expressions: `tan(x)`, `tanh(x)`, `sin(x)`, `cos(x)`, `exp(x)`, `log(x)`, `sqrt(x)`, and the rest. `Math.tan(x)` still works. Constants `PI`, `E`, `LN2`, `LN10`, `LOG2E`, `LOG10E`, `SQRT2` are also accessible.
- New **Major divisions** slider on the Grid tab. Controls how many major grid cells span the X axis (Y follows proportionally). Renamed the existing slider to **Minor subdivisions** so the relationship is clear.

### Changed

- Settings tabs (Graph, Axis, Functions, Grid) now share one continuous scrollable column. Tab clicks smooth-scroll to the corresponding section; scrolling manually updates the active tab via an IntersectionObserver. Code and Reference remain standalone panels.
- Code panel: full-height editable textarea, no resize handle, no rounded border. Manual edits in the textarea round-trip out through "Copy TikZ code" and "Insert into note". Settings changes still refresh the code, unless the textarea is currently focused.
- Modal max-width 1200 to 1400 px (92vw). Axis min/max inputs no longer crash into each other.
- Tab bar background matches the content area; active tab no longer fills with a contrasting block. Focus ring switched from an outline to an inset box-shadow.
- Function cards: top-left and bottom-left corners squared so the colored stripe is flush.
- Action bar background harmonised with the rest of the chrome; padding and divider tone softened.
- Logo refined: thinner axes (3.5 px), thinner curve (6 px), tick marks on both axes, a very light grey background grid, and refined arrowheads. Pure black-on-white with no fills or border.

## [3.0.2] - 2026-05-20

### Changed

- Redrew the logo: downward parabola with sharp butt-cap line ends, larger arrowheads, no border.
- Trimmed the README: shorter "Why" section, simpler Permissions list, tightened feature captions.

## [3.0.1] - 2026-05-20

### Fixed

- `.gitignore` accidentally matched `src/styles.css` as well as the root build output, so CI builds failed with ENOENT when the inline-import plugin tried to read the stylesheet. Anchored the ignore rules to the repo root so only build artefacts are excluded.

This is the first 3.x release with working GitHub-Actions artifacts. 3.0.0 metadata exists in history but no release assets were published.

## [3.0.0] - 2026-05-20

### Migration from 2.x

The plugin was renamed from "Tikz Graph Helper" to "Easy TikZ" and the folder
changed from `tikz_graph_helper` to `easy-tikz` to follow the Obsidian
community convention. Existing BRAT or manual users:

1. Disable the plugin in Settings, Community plugins.
2. Rename `.obsidian/plugins/tikz_graph_helper/` to `.obsidian/plugins/easy-tikz/`.
3. Re-enable the plugin.

Plugin settings carry over with the rename. No data is lost.

### Changed

- Plugin renamed to "Easy TikZ" with id `easy-tikz` (was "Tikz Graph Helper" / `tikz_graph_helper`).
- Hardened release pipeline: tag-vs-manifest version check, build provenance attestation, Node 20, `npm ci`, release notes sourced from this changelog.
- Consolidated three duplicate color maps into one shared `src/colors.ts` module.
- Extracted `niceInterval`, `formatTick`, `stripLatex`, and color helpers into a shared `src/util.ts` module.
- Replaced the inline error banner with Obsidian `Notice` toasts for transient errors.
- Modal microcopy clarified for camera angles, function syntax help, and button labels.
- Manifest description rewritten to start with an action verb and pass community-store guidelines.

### Added

- Hero image, animated demo, feature grid, and logo in the README.
- Keyboard support for 3D rotation: focus the preview and use the arrow keys.
- ARIA roles on the tab bar, labels on icon-only buttons, and a `tabindex` on the preview.
- Numeric validation on axis-range inputs with a Notice on invalid entries.
- Per-function syntax help text under the expression input.
- Named constants for renderer padding, sampling, drag rates, and derivative step (no more magic numbers).
- JSDoc on every exported math helper, renderer, and color utility.

### Fixed

- Memory leak: window `mousemove` and `mouseup` listeners are now removed when the modal closes.
- Memory leak: the injected `<style>` tag is now removed when the modal closes.
- 3D renderer used a hardcoded `#888888` that was effectively invisible in light theme. Now uses Obsidian's `--text-normal` and shades it correctly.
- Three `console.error` calls on routine user-input parsing failures removed.
- `parseDomain` now validates that the domain string is well-formed and that min is less than max.

## [2.2.0] - 2026-03-23

### Changed

- Iterative tuning of the previous release pipeline.

## [2.1.0] - 2026-03-23

### Added

- Quality-of-life refinements over 2.0.x.

## [2.0.1] - 2026-03-23

### Fixed

- Patch release on top of 2.0.0.

## [2.0.0] - 2026-03-23

### Added

- First public release. Live SVG preview, 2D and 3D plotting, tangent lines, extrema detection, TikZ and pgfplots code generation, dark/light theme support.
