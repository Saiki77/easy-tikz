# Easy TikZ: guide for AI assistants

[Easy TikZ](https://github.com/Saiki77/easy-tikz) is an Obsidian plugin that draws charts from `easy-tikz` code blocks in Markdown notes: function plots, tangents, areas between curves, feasible regions and linear programs, optimum and intersection points, level curves, arrows, parametric and polar curves and 3D surfaces, all with live sliders, plus LaTeX (pgfplots) export. A chart is a few lines of text, one line per object, written the way the math reads. You write it, Obsidian renders it in the note, and the user can click the chart to change it with sliders or by dragging. Users do not need to learn the editor when you write the block for them.

This guide is everything you need. It is served by the plugin's local AI server (see the end), published at `https://github.com/Saiki77/easy-tikz/blob/main/docs/ai.md`, and can be pasted into any chat.

## How to work

1. **Understand the chart.** Which functions, regions, lines and points; which numbers should be sliders; which part of the plane must be visible. Ask only when the request is ambiguous in a way that changes the picture.
2. **Start from an example.** With the AI server, `list_examples` and `get_example` give ready-made charts (linear program, areas between curves, tangent, level curves, market surplus, 3D, and one finished chart per guide). Otherwise adapt one of the blocks in this guide.
3. **Write the block.** One line per object: a `view` line first, so everything that matters is inside with a margin, then sliders, functions, shapes and labels. Leave out what the plugin fills in by itself.
4. **Check it.** With the AI server, `check_chart` runs the plugin's own code. Fix every problem it reports (a problem in the text names its line and column). Then read what it computed: where each region is shaded or that it is empty, where curves are drawn, the coordinates of computed points, the final text and position of every label, and how much of each function lies inside the view. Check the ends of each slider's range too (`sliders` argument). `render_chart` shows you a picture of the result.
5. **Put it in the note.** With the AI server, `add_chart` writes the block into the note (the open note, a named note, or a new one) and Obsidian shows it at once. Without it, write the block into the note yourself, or give it to the user as a fenced code block to paste into a note.
6. **Tell the user** what the chart shows, the key numbers, which sliders it has, and that clicking the chart opens the editor.

## Rules that prevent most mistakes

- One object per line. Options come after `|`, separated by commas: `f(x) = x^2 | blue, thick, dashed`.
- Formulas: `2x`, `a x` and `(x + 1)(x - 1)` multiply, but `ax` is one name, so write `a x` or `a*x`. Functions need brackets: `sin(x)`. `1/2x` is `(1/2)*x`, so write `1/(2x)` when x belongs below. Trigonometry is in radians.
- Every letter that is not `x`, `y`, a function name, a shape name or a built-in (`pi`, `e`, `sin`, ...) must be a slider: `slider a = 1 in 0..5`.
- Names: a function is named in its line, `f(x) = ...` or `demand(x) = ...`. Shapes are named `R1` (regions), `C1` (curves), `P1` (points), `S1` (segments) in order, or by a prefix: `eq: crossings of demand and supply`. Other lines use the names: `f2 <= y <= f1`, `P1_x`, `eq_y`. Built-in names such as `E`, `e`, `x` or `pi` cannot be taken.
- Shading is `shade` with `<=` and `>=` conditions. A line or circle is an equation such as `2x + 3y = 12`. A region condition never uses a single `=`.
- Colours: `black`, `gray`, `red`, `orange`, `brown`, `green`, `teal`, `blue`, `purple`, `magenta`. Nothing else exports.
- Labels are templates in quotes: `label "z = {c}"`; `{c}` or `{P1_val:2}` print a live value, `$x^2$` is math.
- Never invent options. The checker reports every word it does not know, with the options that object takes.
- The plugin does not differentiate or integrate. A slope or an area in a label is a formula you work out (for example `3a^2 - 3` or an antiderivative as a hidden function); tell the user it is yours.
- The LaTeX export is a snapshot: sliders are written with their current value.

## A first block

````markdown
```easy-tikz
view x -3..3, y -4..4
axes middle
title slope at x = {a}: {3a^2 - 3:2}
slider a = 0.5 in -2..2 step 0.05
f(x) = x^3 - 3x | blue, thick, tangent at a, extrema
```
````

A linear program: the feasible region with numbered constraint lines, the objective line on a slider, the corners and the optimum.

```easy-tikz
view x 0..5, y 0..4.5
axes edges
slider c = 6 in 0..15 step 0.1
R1: shade x + y <= 4, x + 3y <= 6, x >= 0, y >= 0 | constraint lines, numbered
2x + 3y = c | red, dashed, label "z = {c}"
corners of R1 | blue, label "({x}, {y})"
P1: max 2x + 3y over R1 | large, label "x* = ({x:2}, {y:2})"
```

The area between a curve and its tangent at a slider point: the tangent is a hidden function `g`, and the region lies between the curve and the tangent from the touching point `a` to the second crossing `-2a`.

```easy-tikz
view x -3..3, y -4..4
axes middle
title slope at x = {a}: {3a^2 - 3:2}
slider a = 0.8 in -1.1..1.1 step 0.05
f(x) = x^3 - 3x | blue, thick, tangent at a
g(x) = f(a) + (3a^2 - 3)(x - a) | hidden
shade between f and g for min(a, -2a) <= x <= max(a, -2a) | orange
```

## The text syntax

A block holds one statement per line. Empty lines and lines that start with `%` or `//` are skipped. Options follow the first `|` that is not part of `||` (or), separated by commas. Any line can start with a name and a colon: `R1: shade ...`, `eq: crossings of f and g`.

**The chart**

| Line | Means |
| --- | --- |
| `view x -3..3, y -4..4` (3D: `, z 0..8`) | The visible range. Formulas allowed: `x -a..a`, `x 0..2pi`. Always write it. |
| `axes middle`, `axes box`, `axes edges`, `axes none` | Axes through the origin (school style), a frame with ticks (the default), axes along the left and bottom edges (optimisation charts), or none. |
| `grid`, `grid minor`, `grid fine` | Major grid, minor grid, both. |
| `title ...`, `xlabel ...`, `ylabel ...`, `zlabel ...` | Title (a template) and axis names (plain text). Quote them when they hold a `|`. |
| `size 12 x 6` | Size of the exported figure in cm; it also gives the chart its shape in the note. |
| `equal scale` | Same unit on both axes, so circles stay round. |
| `polar` | Every function is r(θ), written with `theta`. A line `r(theta) = ...` makes the chart polar too. |
| `3d` | A 3D chart. A surface or plane line makes the chart 3D too. |
| `variables q, p` | Other axis letters. `x` and `y` keep working. |
| `snippet` | The LaTeX export is only the tikzpicture, not a document. |
| `set field = value` | Any chart field from the tables below, the value as JSON: `set showSlidersInNote = false`, `set displayWidth = 480`. |

**Sliders:** `slider a = 0.8 in -1.1..1.1 step 0.05`. The range and step are optional (default `0..10`, a step of about a hundredth of the range).

**Functions**

| Line | Means |
| --- | --- |
| `f(x) = x^2 - 2` | A function. Any name: `demand(x) = 20 - x`. `y = ...` alone gets the name `f1`, `f2`, ... |
| `c(t) = (cos(t), sin(t))` | A parametric curve (x(t), y(t)). |
| `r(theta) = 2cos(k theta)` | A polar curve (makes the chart polar). |
| `s(x, y) = x^2 + y^2` or `z = ...` | A surface (makes the chart 3D). |

Function options: a colour, `thin` `thick` `very thin` `very thick`, `dashed`, `hidden` (not drawn, still usable by name), `legend` or `legend "text"`, `domain 0..2pi` (parametric and polar: the t or θ range), `tangent at a` (a number, a formula, a slider, or `min`, `max`, `min2`, ...), `extrema`, `fill` (to the x-axis), `opacity 0.3`, `pattern dots`.

Surface options: a colour, `x -2..2`, `y -2..2`, `opacity 0.7`, `samples 40`, `wireframe`, `hidden`.

**Regions**

| Line | Means |
| --- | --- |
| `shade x + y <= 4, x >= 0, y >= 0` | Shaded where all conditions hold. A line with only conditions shades too: `x + y <= 4, x >= 0`. |
| `shade between f and g for 0 <= x <= 2` | Between two functions, for an x range. |
| `shade under f for 0 <= x <= b` | Between a function and the x-axis. |
| `shade x + y <= 4 "(1)", x + 3y <= 6 "labour"` | A label in quotes after a condition is drawn on its constraint line. |

Region options: a colour, `opacity 0.3`, `pattern dots` (`solid`, `horizontal`, `vertical`, `crosshatch`, `dots`, `north-east`, `north-west`), `outline`, `dashed outline`, `no fill`, `constraint lines` (each condition's boundary across the view), `numbered` (labels (1), (2), ... on the constraint lines, plain sign conditions such as `x >= 0` left out), `label "A"` (at the centre, large and bold), `hidden`.

**Curves:** an equation on its own line: `2x + 3y = 12`, `x = 2`, `(x - 3)^2 + (y - 2)^2 = 4`, `circle: x^2 + y^2 = 9`. Level curves: `levels x^2 + y^2 at 1, 3.2, 6` (the values may be formulas such as `P1_val`). Options: a colour, a thickness, `dashed`, `label "text"` (`{level}` is the level), `hidden`. Write `curve <equation>` when an equation starts with a keyword or looks like a function (`curve y = x + 1` is a curve; `y = x + 1` is a function).

**Points**

| Line | Means |
| --- | --- |
| `points (1, 2), (3, a), (P1_x, 0)` or `point (1, 2)` | Listed points. In 3D: `(x, y, z)`. |
| `crossings of f and g` | Where two functions or curves cross, sorted from left to right. |
| `corners of R1` | The corners of a region. |
| `max 2x + 3y over R1`, `min x^2 + y^2 over R1` | The best point of a region (nonlinear objectives too). |
| `integer points in R1`, `integer max 3x + 4y in R1` | Integer points of a region, or the best of them. |

Point options: a colour, `small` `normal` `large`, `drop lines` (dashed guides to the axes), `coordinates` (labels each point with its coordinates), `label "({x:2}, {y:2})"` (a template per point with `{x}` `{y}` `{val}` `{i}`), `labels "A; B; C"` (one label each), `hidden`.

**Lines, arrows and labels**

| Line | Means |
| --- | --- |
| `segment (0, 0) -- (3, 2) -- (4, 0)` | A path. A points tool's name inserts its points: `segment (0, 0) -- P1`. |
| `arrow (0, 0) -> (3, 2)` | An arrow (`<-` backwards, `<->` both ends). |
| `polygon (0, 0), (4, 0), (4, 3)` | A closed path. |
| `brace (0, -0.5) to (4, -0.5)` | A curly brace, bulging to the left of the direction from the first point to the second. |
| `text "optimum" at (P1_x, P1_y + 0.4)` | A text label at a point (3D: `(x, y, z)`). |
| `plane z = h` | A plane in a 3D chart (`x = ...`, `y = ...` too). |

Options: a colour, a thickness, `dashed`, `label "text"`, `hidden`. Text labels: a colour, `small` `normal` `large`, `above` `below` `left` `right` `center` (which side of the point the text sits on), `hidden`. Planes: a colour, `opacity 0.25`.

**Anything else:** every object takes `key=value` options for its fields in the tables below, the value as JSON: `f(x) = x^2 | fill, fillOpacity=0.4`, `points (1, 2) | dim=2`. And `raw tool {...}`, `raw function {...}`, `raw surface {...}`, `raw label {...}` hold one object as JSON. The editor writes these lines for what the words cannot say; you rarely need them.

A block can also be one JSON object (`"v": 4` first, then the fields below); the plugin reads both, and the editor keeps the form a block has. Write text.

## Fields

The options above set these fields. A `set` line or a `key=value` option can set any of them, and a JSON block uses them directly.

### The chart

| Field | Default | Meaning |
| --- | --- | --- |
| `xmin` `xmax` `ymin` `ymax` | `"-0.5"` `"10"` `"-0.5"` `"5"` | The visible range. Formulas allowed (`"-a"`, `"2pi"`). Always set them. |
| `axis_style` | `"box"` | `"box"` (frame with ticks), `"middle"` (axes through the origin, school style), `"axes"` (axes along the left and bottom edges, as for optimisation charts). |
| `title` | `""` | Text above the chart, a template: `"slope at x = {a}: {3a^2 - 3:2}"`. |
| `show_axis_label` `axis_label_x` `axis_label_y` | `true` `"x"` `"y"` | Axis names, plain text (no `{...}` values). |
| `showAxis` | `true` | Draw the axes. |
| `showLargeGrid` `showSmallGrid` `gridSize` | `false` `false` `5` | Major grid, minor grid, minor ticks per major step. |
| `size_x_cm` `size_y_cm` | `10` `10` | Size of the exported figure in cm. It also sets the shape of the chart in the note: `12` by `6` gives a wide chart. |
| `equalScale` | `false` | Same unit on both axes, so circles stay round. |
| `coordinateSystem` | `"cartesian"` | `"polar"`: every function is r(θ), written with `theta`. |
| `variables` | `"x, y"` | Other axis letters, such as `"q, p"` or `"x1, x2"`. `x` and `y` keep working, and point labels still use `{x}` and `{y}`. |
| `dimension` | `false` | `true` makes a 3D chart (see 3D). |
| `zmin` `zmax` `axis_label_z` | `"-5"` `"5"` `"z"` | 3D only. |
| `showSlidersInNote` | `true` | Sliders under the chart in the note. Moving them never edits the note. |
| `documentSetup` | `true` | The LaTeX export is a standalone document (`false`: only the tikzpicture). |
| `displayWidth` `displayAlign` | (unset) | Width in px and `"left"`, `"center"` or `"right"` of the chart in the note. Usually leave them out. |
| `parameters` `functions` `tools` `annotations` `functions3D` | `[]` | Sliders, functions, shapes, text labels and surfaces. Below. |

### Sliders: `parameters`

```json
"parameters": [{ "name": "c", "value": 9, "min": 0, "max": 15, "step": 0.1 }]
```

Give all five fields. The name is a letter or a word (`a`, `k`, `price`) that is not a built-in (`x`, `y`, `t`, `e`, `pi`, `sin`, ...). Every formula, condition, coordinate, range and label can use it. The note shows a slider for it; the editor also has a play button that sweeps it from `min` to `max` and back. Choose the range so the picture stays meaningful over all of it (a crossing that leaves the view, or two parallel lines, makes points and areas disappear).

### Functions: `functions`

| Field | Default | Meaning |
| --- | --- | --- |
| `name` | `"f1"`, `"f2"`, ... | Other formulas call it: `f1(2)`, `f1(x - 1)`, or bare `f1` for `f1(x)`. Functions are drawn in list order. |
| `expression` | `""` | y = f(x), in `x`. |
| `domain` | `""` | `"min:max"`, such as `"0:2pi"` or `"-a:a"`. Empty: drawn over the visible x range, and calls such as `f1(4)` work at any x. With a domain the function has no value outside it. |
| `color` `thickness` `dashed` | `"black"` `"thin"` `false` | Thickness: `"very thin"`, `"thin"`, `"thick"`, `"very thick"`. |
| `showLegend` `legendLabel` | `false` (unset) | Legend entry; the text defaults to the formula. |
| `fill` `fillOpacity` `fillPattern` | `false` `0.2` `"solid"` | Shade between the curve and the x-axis. For other areas use a region. |
| `tangent` `tangentPoint` | `false` `""` | A dashed tangent in the function's colour with a dot where it touches, at a number, a formula, a slider (`"a"`) or a keyword: `"min"`, `"max"`, `"min2"`, `"max3"` (first local minimum, first local maximum, ...). |
| `extrema` | `false` | Dots labelled `max` and `min` at the local extrema in the view. |
| `parametric` `expressionY` | `false` `""` | Parametric curve: `expression` is x(t), `expressionY` is y(t), `domain` is the t range (default `0:2*pi`). |
| `hidden` | `false` | Not drawn, but other formulas can still use it (a tangent or an antiderivative used in a region or label). |

### Shapes: `tools`

Every tool has `type`, `name` (`R1`, `C1`, `P1`, `S1`, `PL1`, ...), `color` and optionally `hidden`. Fills are always drawn below lines and points; otherwise tools are drawn in list order.

#### `region`: shade where conditions hold

| Field | Default | Meaning |
| --- | --- | --- |
| `conditions` | `[""]` | All must hold. Examples: `"x + y <= 4"`, `"0 <= x <= 4"`, `"f2 <= y <= f1"`, `"min(0, f1) <= y <= max(0, f1)"`, `"(x - 3)^2 + (y - 2)^2 <= 4"`, `"x <= 1 or x >= 3"`. Inside one entry `,` `;` `and` also mean "and", `or` means "or". Use `<=` and `>=`, never `=`. |
| `conditionLabels` | `[""]` | One text per condition, drawn on its constraint line: `["(1)", "(2)", "", ""]` or `["wood", "labour"]`. |
| `constraintLines` | `false` | Draw each condition's boundary line across the view (textbook linear programs). |
| `fill` `fillOpacity` `fillPattern` | `true` `0.25` `"solid"` | Patterns: `"solid"`, `"horizontal"`, `"vertical"`, `"crosshatch"`, `"dots"`, `"north-east"`, `"north-west"`. |
| `outline` `thickness` | `"none"` `"thin"` | Border: `"none"`, `"solid"`, `"dashed"`. |
| `label` | `""` | Text at the centre of the region, a template, drawn large and bold: keep it short (`A`, `CS = {...}`); use a text label for longer text. |
| `color` | `"blue"` | |

#### `curve`: an equation in x and y

| Field | Default | Meaning |
| --- | --- | --- |
| `equation` | `""` | `"2x + 3y = 12"`, `"x = 2"`, `"(x - 3)^2 + (y - 2)^2 = 4"`, `"x y = 4"`, `"2x + 3y = c"`. A bare formula F means F = 0. |
| `levels` | `""` | Draw F = value for each value: `"1, 3.2, 6"`, `"c"`, `"P1_val"` (level curves, indifference curves, iso-profit lines). |
| `label` | `""` | Template drawn beside the curve; `{level}` is the level. |
| `color` `thickness` `dashed` | `"black"` `"thin"` `false` | |

A line such as `y = x + 1` can be a function (then regions can use it by name, `y >= f1`) or a curve (needed for vertical lines and `ax + by = c` forms with sliders).

#### `points`: marked points

| Field | Default | Meaning |
| --- | --- | --- |
| `source` | `"list"` | `"list"`: `points`. `"intersections"`: where `ref1` and `ref2` cross (function or curve names). `"region"`: corners of region `regionName`, or with an `objective` the best point anywhere in it. `"lattice"`: integer points in `regionName` (or the whole view). |
| `points` | `""` | List source: `"(1, 2); (3, a); (P1_x, 0)"`. |
| `ref1` `ref2` | `""` | Intersections source: `"f1"`, `"C1"`. |
| `regionName` | `""` | Region and lattice sources: `"R1"`. |
| `objective` `sense` | `""` `"max"` | Keep only the best candidate(s): `"2x + 3y"` with `"max"` or `"min"`. Over a region this is the true optimum (nonlinear objectives too). |
| `label` | `""` | Template per point with `{x}` `{y}` `{val}` (objective value) `{i}` (number). `"({x:2}, {y:2})"` prints coordinates. `"A; B; C"` gives each point its own label. Empty: no labels. |
| `dropLines` | `false` | Dashed guides to the axes. |
| `size` | `"normal"` | `"small"`, `"normal"`, `"large"`. |
| `color` | `"red"` | |

#### `segment`: lines, arrows, polygons and braces

| Field | Default | Meaning |
| --- | --- | --- |
| `path` | `""` | Points separated by `;`: `"(0, 0); (3, 2)"`. A points tool's name inserts its points: `"(0, 0); P1"`. |
| `style` | `"line"` | `"line"`, `"forward"`, `"backward"`, `"both"` (arrow heads), `"brace"` (a curly brace over the first two points, bulging to the left of the direction from the first to the second). |
| `closed` | `false` | Join the last point back to the first. |
| `label` | `""` | Template beside the middle of the path. |
| `color` `thickness` `dashed` | `"black"` `"thin"` `false` | |

#### `plane3D` (3D only)

`{"type": "plane3D", "name": "PL1", "axis": "z", "value": "h", "fillOpacity": 0.25, "color": "orange"}` is the plane z = h (or x = ..., y = ...).

## Where labels go

The labels of points, curves, regions and constraint lines are placed by the plugin: it tries the spots around each point and picks one that does not cover lines, points or other labels. There is no field to choose the side. When a label must sit somewhere exact, use a text label instead.

### Text labels: `annotations`

```json
"annotations": [{ "x": "P1_x", "y": "P1_y + 0.4", "text": "optimum, z = {P1_val}", "color": "red", "anchor": "above" }]
```

Fields: `x`, `y` (and `z` in 3D) as formulas, `text` (a template), `color`, `size` (`"small"` is the size of the other labels, `"normal"` slightly larger, `"large"`), `anchor` (which side of the point the text sits on: `"above"`, `"below"`, `"left"`, `"right"`, or `"center"` on it), `hidden`.

## Templates (labels and the title)

- `{a}` prints the value of a formula with up to 3 decimals; `{a/3:1}` with up to 1 decimal.
- `$x^2$` is LaTeX math. No space after the opening `$` or before the closing one.
- `{{` and `}}` are literal braces. Outside math, `% & # _ ^ < >` print as typed.
- A value that cannot be computed prints `?`.

## Computed values

Every points tool publishes its results, and every other field can use them. They update when sliders move.

- `P1_x`, `P1_y` (and `P1_z`): the first point. `P1_x2`, `P1_y2`: the second, and so on.
- `P1_val`: the objective value at the first point (only with an objective). `P1_n`: how many points there are.

Examples: a line through the optimum `"2x + 3y = P1_val"`, a region up to a crossing `"0 <= x <= P1_x"`, a title `"crossings: {P1_n}"`.

Crossings (intersections) come sorted from left to right, so `P1_x < P1_x2 < ...`. Tools are computed in the order their references need, so a region may use the values of a points tool that comes after it in the list.

## Formulas

- Operators: `+ - * /`, `^` (power, right-associative; `-x^2` is `-(x^2)`), `%`, comparisons `< <= > >= == !=` (1 or 0), `and or !`, `c ? a : b`.
- Implicit multiplication: `2x`, `3(x + 1)`, `(x + 1)(x - 1)`, `2 pi`, `a x + b y`. But `ax` is one name: write `a x`. `1/2x` is `(1/2)*x`: write `1/(2x)` when x is below. `a(x - h)^2` is `a*(x - h)^2`; `f1(x + 1)` is a call because `f1` is a function.
- Functions: `sin cos tan sec csc cot asin acos atan atan2(y, x) sinh cosh tanh asinh acosh atanh exp ln log log10 log2 sqrt cbrt abs sign floor ceil round trunc min max hypot pow(a, b)`. `ln` and `log` are both natural. Trigonometry is in radians.
- Constants: `pi` (`π`), `e`.
- Variables: `x` in functions; `x` and `y` in regions, curves and surfaces; `t` in parametric curves; `theta` in polar charts.

## 3D

Write `3d` and a `view` with a z range. Surfaces are `s(x, y) = x^2 + y^2 | blue, x -2..2, y -2..2, opacity 0.7` (or `z = ...`); planes are `plane z = h`; points, segments and text labels take `(x, y, z)`. In JSON: `"dimension": true`, surfaces in `functions3D`, points and segments with `"dim": 3`.

```easy-tikz
3d
view x -2..2, y -2..2, z 0..8
slider h = 3 in 0..8
z = x^2 + y^2 | blue, x -2..2, y -2..2, opacity 0.7
plane z = h | orange
```

## Recipes

| You want | Example id | How it is built |
| --- | --- | --- |
| A function with a slider, its tangent and its extrema | `tangent` | slider `a`; `f1(x) = ... \| tangent at a, extrema`; the slope in the title. |
| The area between a curve and its tangent | `tangent-area` | the tangent as a hidden function `f2`; `shade between f1 and f2 for ...` from the touching point to the second crossing. |
| Areas between two curves | `areas` | one region where `f2 <= y <= f1` and one where `f1 <= y <= f2`, both with `0 <= x <= 2pi`, plus the crossings as points. For one colour per area, split at the crossings instead: points `P1` (intersections of `f1` and `f2`), then regions with `0 <= x <= P1_x`, `P1_x <= x <= P1_x2`, `P1_x2 <= x <= 2pi`. |
| A linear program | `lp` (axes along the edges) or `linear-program` (boxed) | region with the constraints and `constraintLines`; curve `2x + 3y = c` on a slider; points over the region with the objective (the optimum) and without (the corners). |
| An integer program | `integer-program` | the same with source `lattice` and the objective. |
| A nonlinear optimum | `levels` | level curves `x^2 + y^2` at `"1, 3.2, 6"`, the constraint as a region, the minimum as a points tool, and the touching level curve at `P1_val`. |
| Supply, demand and surplus | `surplus` | intersections give the equilibrium `P1`; regions `P1_y <= y <= f1` and `f2 <= y <= P1_y` with `0 <= x <= P1_x`. |
| A secant turning into a tangent | `secant-tangent` | sliders `a` and `h`; the difference quotient in the title. |
| An area that grows with a slider | `area-accumulation` | region `min(0, f1) <= y <= max(0, f1)` with `0 <= x <= b`; the area in its label comes from an antiderivative typed as a function. |
| Values computed from points | `computed-values` | `P1_n`, `P1_x2`, and a midpoint built from them. |
| A point that moves when you press play | `animate-play` | slider `a`; points `(cos(a) - 1.5, sin(a)); (a, sin(a))`; `f1` with domain `0:a`. |
| Parametric and polar curves | `parametric-polar` | `c(t) = (x(t), y(t))`, or `r(theta) = 2cos(k theta)` (a polar chart). |
| Arrows and braces | `arrows-braces` | `arrow (0, 0) -> (3, 2)` and `brace (0, 0) to (4, 0)`. |
| A surface and a plane | `plane3d` | `3d`, a surface and `plane z = h` on a slider. |

## The local AI server

When the user switches on **AI access** (in the editor's AI tab or the Easy TikZ settings), the plugin answers on `http://127.0.0.1:27150`. The port can be changed, so use the address the user gives you. Every request needs the token: the header `Authorization: Bearer <token>`, or `?token=<token>` at the end of the address for apps that cannot send headers. A POST must send its body as JSON with `Content-Type: application/json`. The AI tab shows ready-made connection lines for AI apps; agents that work in the vault can also read the token from the plugin's data file, `<config folder>/plugins/easy-tikz/data.json` (field `aiToken`; the config folder is usually `.obsidian`). The server only answers on this computer and refuses requests from web pages. It adds `easy-tikz` blocks to Markdown notes and replaces them, nothing else: never in hidden folders and never in files with instructions for AI agents (`AGENTS.md`, `CLAUDE.md`, `GEMINI.md`, ...). It computes one chart at a time and refuses charts over its limits (at most 50 functions, 50 shapes, 100 text labels, 10 surfaces, 200 levels per curve, 1000 listed points, 2000 characters per field, and functions that call each other so often that one point costs over 1000 evaluations). Obsidian shows a notice every time it writes, with Undo when it changed an existing note.

- **MCP:** `POST /mcp` (Streamable HTTP). AI apps that speak MCP get the tools below.
- **Plain HTTP:** `GET /guide` returns this guide, `GET /tools` lists the tools, and `POST /tools/<name>` with the arguments as a JSON body calls one. For example (with `PORT` and `TOKEN` from the user):

```bash
curl -s -X POST "http://127.0.0.1:PORT/tools/check_chart?token=TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"chart": "view x 0..7, y -1.5..1.5\nf(x) = sin(x) | blue"}'
```

Every tool answers with HTTP 200 and JSON: `{"ok": true, "text": "..."}`, or `{"ok": false, "text": "..."}` when the call did not do what was asked (`render_chart` adds `"image": {"mimeType": "image/png", "base64": "..."}`). A missing or wrong token gets HTTP 401, a body that is not JSON 415. The text is meant to be read. A check answers like this:

```text
OK: renders without problems.

What the chart shows:
2D chart: x 0..5, y 0..4.5, axis style axes
R1 region (x + y <= 4; x + 3y <= 6; x >= 0; y >= 0): shaded where x 0..4, y 0..2
P1 points (best point of region R1, max 2x + 3y): (3, 1) | label "x* = (3, 1)" above right of (3, 1)
Computed values: P1_n = 1, P1_val = 9, P1_x = 3, P1_y = 1
```

With problems, the first line is `2 problems: fix them, then check again.`, followed by one `PROBLEM` line each (problems in the text name their line and column). `add_chart` and `update_chart` refuse such a chart with `"ok": false` and the same lines, and write nothing.

Every `chart` argument is the text of a block (a string; a fenced block is fine too) or a JSON object. `add_chart` writes the block in the form the user chose in the settings (text by default); `update_chart` keeps the form the chart has in the note, and for text it rewrites only the lines whose object changed.

| Tool | Arguments | Does |
| --- | --- | --- |
| `get_guide` | `section` (optional) | This guide, or one section of it. |
| `list_examples` | | Ready-made charts: id, title, one line each. |
| `get_example` | `id`, `format` (optional: `"json"` for a JSON block) | One of them as a text block, with what the plugin fills in left out. |
| `check_chart` | `chart`, `sliders` (optional, such as `{"a": 2}`) | Problems, ignored fields, and what the chart computes. |
| `render_chart` | `chart`, `sliders` (optional) | A PNG picture of the chart. |
| `add_chart` | `chart`, `note` (optional: path or name; the open note when left out), `after` (optional: a heading or whole line of the note, such as `## Results` or just `Results`; the chart goes right below it), `replace` (optional: a placeholder line such as `(chart goes here)`: the whole line, once in the note, at most 200 characters), `create` (optional: `true` to make the note when it does not exist) | Checks the chart and writes it into the note. Lines in code blocks and frontmatter never match. Refused while the check reports problems, when `after` or `replace` match no line, for a note that does not exist unless `create` is true, and for instruction files of AI agents. The answer names line numbers, not the note's text. |
| `list_charts` | `note` (optional) | The charts in a note, numbered, each as the note writes it. |
| `update_chart` | `index`, `chart`, `note` (optional) | Replaces chart number `index` of the note. |
| `export_latex` | `chart`, `standalone` (optional, default true) | The pgfplots code the plugin exports. |
| `active_note` | | The open note: path and headings. |
