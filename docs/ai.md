# Easy Graphs Charts and TikZ: guide for AI assistants

[Easy Graphs Charts and TikZ](https://github.com/Saiki77/easy-tikz) is an Obsidian plugin that draws charts from `easy-tikz` code blocks in Markdown notes: function plots, tangents, areas between curves, feasible regions and linear programs, optimum and intersection points, level curves, arrows, parametric and polar curves and 3D surfaces; since version 6 also complex numbers, vectors, matrices and sums, sets on an axis, vector fields and systems, matrices that move the plane, orbits, fractals and coloured planes, and charts that play in steps. All with live sliders, plus LaTeX (pgfplots) export. A chart is a few lines of text, one line per object, in plain words: `plot f(x) = x^2 in blue`, `shade where x + y <= 4 and x >= 0`. You write it, Obsidian renders it in the note, and the user can click the chart to change it with sliders or by dragging. Users do not need to learn the editor when you write the block for them.

This guide is everything you need. It is served by the plugin's local AI server (see the end), published at `https://github.com/Saiki77/easy-tikz/blob/main/docs/ai.md`, and can be pasted into any chat.

## How to work

1. **Understand the chart.** Which functions, regions, lines and points; which numbers should be sliders; which part of the plane must be visible. Ask only when the request is ambiguous in a way that changes the picture.
2. **Start from an example.** With the AI server, `list_examples` and `get_example` give ready-made charts (linear program, areas between curves, tangent, level curves, market surplus, 3D, and one finished chart per guide). Otherwise adapt one of the blocks in this guide.
3. **Write the block.** One line per object: a `show` line first, so everything that matters is inside with a margin, then sliders, functions, shapes and labels. Leave out what the plugin fills in by itself.
4. **Check it.** With the AI server, `check_chart` runs the plugin's own code. Fix every problem it reports (a problem in the text names its line and column). Then read what it computed: where each region is shaded or that it is empty, where curves are drawn, the coordinates of computed points, the final text and position of every label, and how much of each function lies inside the view. Check the ends of each slider's range too (`sliders` argument). `render_chart` shows you a picture of the result.
5. **Put it in the note.** With the AI server, `add_chart` writes the block into the note (the open note, a named note, or a new one) and Obsidian shows it at once. Without it, write the block into the note yourself, or give it to the user as a fenced code block to paste into a note.
6. **Tell the user** what the chart shows, the key numbers, which sliders it has, and that clicking the chart opens the editor.

## Rules that prevent most mistakes

- One object per line, in words: `plot f(x) = x^2 in blue, thick, dashed`. Options follow the statement after commas, or after `|`.
- Formulas: `2x`, `a x` and `(x + 1)(x - 1)` multiply, but `ax` is one name, so write `a x` or `a*x`. Functions need brackets: `sin(x)`. `1/2x` is `(1/2)*x`, so write `1/(2x)` when x belongs below. Trigonometry is in radians.
- Every letter that is not `x`, `y`, a function name, a shape name or a built-in (`pi`, `e`, `sin`, ...) must be a slider (`slider a from 0 to 5, starting at 1`) or a let name (`let A = [[1, 2], [3, 4]]`).
- Names: a function is named in its line, `plot f(x) = ...` or `plot demand(x) = ...`. Shapes are named `R1` (regions), `C1` (curves), `P1` (points), `S1` (segments) in order, or by a prefix: `eq: mark where demand and supply cross`. Other lines use the names: `f2 <= y <= f1`, `P1_x`, `eq_y`. `the region` is the chart's only shaded region. Built-in names such as `E`, `e`, `x` or `pi` cannot be taken.
- Shading is `shade where ...` with `<=` and `>=` conditions joined by `and`. A line or circle is an equation such as `draw 2x + 3y = 12`. A region condition never uses a single `=`.
- Colours: `black`, `gray`, `red`, `orange`, `brown`, `green`, `teal`, `blue`, `purple`, `magenta`, written `in red`. Nothing else exports. A surface may take a colour map instead (`in viridis`, see 3D).
- Labels are templates in quotes: `labelled "z = {c}"`; `{c}` or `{P1_val:2}` print a live value, `$x^2$` is math.
- Names for values: `let v = (2, 1)`, `let A = [[1, 2], [3, 4]]`, `let $f(x, y) = x^2 + 4y^2$`. A let name is never `x`, `y`, `z`, `t` or `theta` (axis and time variables), a built-in (`e`, `pi`, `sin`) or the name of a slider or function: `let t = 2` is a problem.
- Real stays real: `\sqrt{-4}` has no value, so nothing is drawn. A complex number makes the formula complex: `\sqrt{-4 + 0i}` is 2i. A field that needs a number (a function, a bound, a coordinate, a label value) takes a complex value only when its imaginary part is 0, and a vector or a matrix there is a problem ("This formula gives a vector of 2 numbers, not a number"): print `{v_x}`, `{det(A)}`. Do not name a slider `i` in a chart with complex numbers.
- Braces in labels: outside `$...$`, a placeholder holds no LaTeX braces. Write `"{2^(n+1)}"`, not `"{2^{n+1}}"` (that prints `8}`). Inside `$...$` write LaTeX as usual: `"$\det A = {det(A)}$"`. In a JSON block every backslash is doubled: `"label": "$\\det A$"`.
- Steps: `then` goes before a line that draws something (`then plot ...`, `then transform the plane by A`), never before a chart line such as `show` or a slider.
- 2D only: sets on an axis, chords, vector fields and rest points, orbits, cobwebs, bifurcation diagrams, Newton's method, coloured planes and turning circles. A 3D chart takes arrows, point lists, the grid, the basis vectors, `transform space by`, the unit cube, spans and solutions of systems with 3 formulas.
- Never invent options. The checker reports every word it does not know, with the options that object takes.
- The plugin does not differentiate or integrate. A slope or an area in a label is a formula you work out (for example `3a^2 - 3` or an antiderivative as a hidden function); tell the user it is yours.
- The LaTeX export is a snapshot: sliders are written with their current value.

## A first block

````markdown
```easy-tikz
show x from -3 to 3 and y from -4 to 4
axes in the middle
title slope at x = {a}: {3a^2 - 3:2}
slider a from -2 to 2, starting at 0.5, in steps of 0.05
plot f(x) = x^3 - 3x in blue, thick, with its tangent at a and its extrema
```
````

A linear program: the feasible region with numbered constraint lines, the objective line on a slider, the corners and the optimum.

```easy-tikz
show x from 0 to 5 and y from 0 to 4.5
axes on the edges
slider c from 0 to 15, starting at 6, in steps of 0.1
shade where x + y <= 4 and x + 3y <= 6 and x >= 0 and y >= 0, numbered, with constraint lines
draw 2x + 3y = c in red, dashed, labelled "z = {c}"
mark the corners of the region in blue, labelled "({x}, {y})"
mark the maximum of 2x + 3y in the region, large, labelled "x* = ({x:2}, {y:2})"
```

The area between a curve and its tangent at a slider point: the tangent is a hidden function `g`, and the region lies between the curve and the tangent from the touching point `a` to the second crossing `-2a`.

```easy-tikz
show x from -3 to 3 and y from -4 to 4
axes in the middle
title slope at x = {a}: {3a^2 - 3:2}
slider a from -1.1 to 1.1, starting at 0.8, in steps of 0.05
plot f(x) = x^3 - 3x in blue, thick, with its tangent at a
plot g(x) = f(a) + (3a^2 - 3)(x - a), hidden
shade between f and g from x = min(a, -2a) to max(a, -2a) in orange
```

## The text syntax

A block holds one statement per line, in words. Empty lines and lines that start with `#`, `%` or `//` are skipped. A statement's options follow it after commas (`plot f(x) = x^2 in blue, thick, dashed`); a colour, a range and a `with ...` phrase may also follow without a comma (`plot f(x) = sqrt(x) from x = 0 to 4 in green`). Options joined by `and` are two options (`with its tangent at a and its extrema`). Options may instead follow a `|` (not part of `||`, which is "or"): then everything before it is the statement. Any line can start with a name and a colon: `R1: shade where ...`, `eq: mark where f and g cross`.

Someone may have given pieces their own words (Settings, Chart words): their blocks may read `graph f(x) = x^2` or `zeichne 2x + 3y = c`. The guide their plugin serves then ends with a section that lists those words. The built-in words of this guide always work, so you may write either.

The short forms of version 4.4 still work and mean the same: `view x -3..3, y -4..4`, `axes middle`, `slider a = 0.8 in -1.1..1.1 step 0.05`, `f(x) = x^2 | blue, tangent at a`, `shade x + y <= 4, x >= 0 | numbered`, `2x + 3y = c | red`, `corners of R1`, `max 2x + 3y over R1`, `arrow (0, 0) -> (3, 2)`, `text "A" at (1, 2)`. Write the words.

**The chart**

| Line | Means |
| --- | --- |
| `show x from -3 to 3 and y from -4 to 4` (3D: `show x from -2 to 2, y from -2 to 2 and z from 0 to 8`) | The visible range. Formulas allowed: `x from -a to a`, `x from 0 to 2pi`. Always write it. |
| `axes in the middle`, `axes in a box`, `axes on the edges`, `no axes` | Axes through the origin (school style), a frame with ticks (the default), axes along the left and bottom edges (optimisation charts), or none. |
| `with a grid`, `with a minor grid`, `with a fine grid` | Major grid, minor grid, both. In 3D the grid lies on the floor and the back walls of the box. |
| `grid opacity 0.3` | How strong the grid lines are, from 0 to 1 (without the line: 0.5). Minor lines are drawn at half of it. |
| `x numbers every pi/2` | The numbers on an axis (x, y or z): `every` a step (a formula; a step in pi prints in π), `at` chosen values each with an optional label in quotes (`x numbers at a "a", b "b"`), or `x numbers off` (no numbers, no tick marks; the grid stays). Without the line: automatic. |
| `title ...`, `xlabel ...`, `ylabel ...`, `zlabel ...` | Title (a template) and axis names (plain text). Quote them when they hold a `|`. |
| `size 12 x 6` | Size of the exported figure in cm; it also gives the chart its shape in the note. |
| `equal scale` | Same unit on both axes, so circles stay round. |
| `polar` | Every function is r(θ), written with `theta`. A line `plot r(theta) = ...` makes the chart polar too. |
| `3d` | A 3D chart. A surface or plane line makes the chart 3D too. |
| `cube` | 3D: the box is a cube, whatever the ranges. Without it, its edges follow the ranges. |
| `box 1 x 2 x 0.6` | 3D: the box with its own lengths, x : y : z, such as a long box that still shows its heights. |
| `variables q, p` | Other axis letters. `x` and `y` keep working. |
| `snippet` | The LaTeX export is only the tikzpicture, not a document. |
| `set field = value` | Any chart field from the tables below, the value as JSON: `set showSlidersInNote = false`, `set displayWidth = 480`. |

**Sliders:** `slider a from -1.1 to 1.1, starting at 0.8, in steps of 0.05`. `starting at` is optional (the slider starts at the low end), and so is `in steps of` (a step of about a hundredth of the range). Add `connected` when several charts of one note share the slider: `slider a from 0 to 2, connected` in two charts makes their sliders `a` move together in the note.

**Functions**

| Line | Means |
| --- | --- |
| `plot f(x) = x^2 - 2` | A function. Any name: `plot demand(x) = 20 - x`. `plot y = ...` or a bare `plot sin(x)` gets the name `f1`, `f2`, ... |
| `plot c(t) = (cos(t), sin(t))` | A parametric curve (x(t), y(t)). |
| `plot r(theta) = 2cos(k theta)` | A polar curve (makes the chart polar). |
| `plot s(x, y) = x^2 + y^2` or `plot z = ...` | A surface (makes the chart 3D). |

Function options: `in blue` (a colour), `thin` `thick` `very thin` `very thick`, `dashed`, `hidden` (not drawn, still usable by name), `with a legend` or `with the legend "text"`, `from x = 0 to 4` (parametric and polar: `for t from 0 to 2pi`, `for theta from 0 to pi`), `with its tangent at a` (a number, a formula, a slider, or `min`, `max`, `min2`, ...), `with its extrema`, `filled` (to the x-axis), `opacity 0.3`, `pattern dots`.

Surface options: `in blue`, `in viridis` (colours by height, see 3D), `for x from -2 to 2 and y from -2 to 2`, `opacity 0.7`, `mesh 0.2` (the mesh lines, see 3D), `with 40 samples`, `wireframe`, `hidden`.

**Regions**

| Line | Means |
| --- | --- |
| `shade where x + y <= 4 and x >= 0 and y >= 0` | Shaded where all conditions hold. A line with only conditions shades too: `x + y <= 4, x >= 0`. Inside a condition, `or` joins alternatives: `shade where x <= 1 or x >= 3` (then write the conditions with commas). |
| `shade between f and g from x = 0 to 2` | Between two functions, for an x range. |
| `shade under f from x = 0 to b` | Between a function and the x-axis. |
| `shade where x + y <= 4 "(1)" and x + 3y <= 6 "labour"` | A label in quotes after a condition is drawn on its constraint line. |

Region options: `in blue`, `opacity 0.3`, `pattern dots` (`solid`, `horizontal`, `vertical`, `crosshatch`, `dots`, `north-east`, `north-west`), `outlined`, `with a dashed outline`, `not filled`, `with constraint lines` (each condition's boundary across the view), `numbered` (labels (1), (2), ... on the constraint lines, plain sign conditions such as `x >= 0` left out), `labelled "A"` (at the centre, large and bold), `hidden`.

**Curves:** `draw 2x + 3y = 12`, `draw x = 2`, `draw (x - 3)^2 + (y - 2)^2 = 4`, `circle: draw x^2 + y^2 = 9`. Level curves: `draw the level curves of x^2 + y^2 at 1, 3.2 and 6` (the values may be formulas such as `P1_val`). Options: a colour, a thickness, `dashed`, `labelled "text"` (`{level}` is the level), `hidden`. `draw y = x + 1` is a curve; `plot y = x + 1` is a function.

**Points**

| Line | Means |
| --- | --- |
| `mark (1, 2), (3, a) and (P1_x, 0)` | Listed points. In 3D: `(x, y, z)`. |
| `mark where f and g cross` | Where two functions or curves cross, sorted from left to right. |
| `mark the corners of R1` | The corners of a region. |
| `mark the maximum of 2x + 3y in R1`, `mark the minimum of x^2 + y^2 in R1` | The best point of a region (nonlinear objectives too). |
| `mark the integer points in R1`, `mark the integer maximum of 3x + 4y in R1` | Integer points of a region, or the best of them. |

Instead of `R1`, write `in the region` (or `of the region`) when the chart shades one region. Point options: `in red`, `small` `normal` `large`, `with lines to the axes` (dashed guides), `with coordinates` (labels each point with its coordinates), `labelled "({x:2}, {y:2})"` (a template per point with `{x}` `{y}` `{val}` `{i}`; `"A; B; C"` gives each point its own label), `hidden`.

**Lines, arrows and labels**

| Line | Means |
| --- | --- |
| `draw a line from (0, 0) to (3, 2) to (4, 0)` | A path. A points tool's name inserts its points: `draw a line from (0, 0) to P1`. |
| `draw an arrow from (0, 0) to (3, 2)` | An arrow (`draw a double arrow from ...` has both heads; the option `backwards` puts the head at the start). |
| `draw a polygon through (0, 0), (4, 0) and (4, 3)` | A closed path. |
| `draw a brace from (0, -0.5) to (4, -0.5)` | A curly brace, bulging to the left of the direction from the first point to the second. |
| `write "optimum" at (P1_x, P1_y + 0.4)` | A text label at a point (3D: `(x, y, z)`). |
| `draw the plane z = h` | A plane in a 3D chart (`x = ...`, `y = ...` too). |

Options: a colour, a thickness, `dashed`, `labelled "text"`, `hidden`. Text labels: a colour, `small` `normal` `large`, `above` `below` `left` `right` `center` (which side of the point the text sits on), `hidden`. Planes: a colour, `opacity 0.25`.

**Data** (2D charts)

| Line | Means |
| --- | --- |
| `use the table above` | A data set: the nearest Markdown table above the block in the note (header row, separator row, body rows). It takes the first two columns of numbers as x and y; `use the table above, columns hours and score` takes them by header name (quote a name with a comma: `columns "hours, total" and score`). Rows with something that is not a number in a used column are left out; a minus may be `-` or `−`. When the chart has no axis names of its own, the headers name the axes. The block keeps this line: the plugin reads the table where the chart is drawn and follows it when it changes, and never writes the rows into the block. |
| `data (1, 52), (2, 55), (3, 61)` | A data set typed in the chart (formulas and sliders allowed). |
| `mark the data` | The data as points. Options: a colour, `small` `large`, `labelled` (each point's coordinates), `labelled "({x}, {y})"` (a template per point with `{x}` `{y}` `{i}`). |
| `draw the data as bars`, `draw the data as a line` | Bars from the x-axis (80 % of the smallest gap between two x values wide; `opacity 0.35`; `labelled` writes each bar's value over it), or a line through the points from left to right. |
| `draw its regression line, labelled` | The least-squares line y = mx + b over the data's x range. `labelled` shows the equation and R² (`$y = 4.21x + 47.6$, $R^2 = 0.98$`); `labelled "slope {m:2}"` is a label of your own with `{m}` `{b}` `{r2}` `{n}`. |

"The data" is the data set of the nearest data line above (else the first one below); with several, name one: `mark the data of D2`, `draw the data of scores as bars`, `draw the regression line of D2`. A data set publishes `D1_n` and its points (`D1_x`, `D1_y`, `D1_x2`, ...). A chart that reads the table shows the problem "No Markdown table above this chart" in a note without one; checked outside a note (the AI tools) it only notes that it reads the note's table.

**Probability** (2D charts)

| Line | Means |
| --- | --- |
| `plot the normal distribution with mean 0 and sd 1` | The density curve over the view. Mean and sd are formulas (sliders work); `standard deviation`, `mu` and `sigma` read too, and `plot the standard normal distribution` is mean 0 and sd 1. Options: a colour, a thickness, `dashed`. |
| `plot the binomial distribution with n = 10 and p = 0.4` | Bars at k = 0, 1, ..., n (n a whole number up to 1000, p from 0 to 1). Options: a colour, `opacity 0.35`. |
| `shade P(-1 <= X <= 1), labelled` | The area under the density between the bounds, or the binomial bars in range. The event may be `a <= X <= b`, `X <= b`, `X >= a`, `X = k`, with `<` and `>` too (strict bounds matter for the binomial), and in LaTeX: `shade $P(-1 \le X \le 1)$` (`\le`, `\leq`, `\ge`, `\geq`, `≤`, `≥`). The bounds are formulas. `labelled` shows the probability, `$P(-1 \le X \le 1) = 0.683$`; `labelled "{p:4}"` is a label of your own. Options: a colour, `opacity 0.5`, `pattern dots`. |

A shade line is about the distribution its event names (`P(X2 <= 1)`, or `shade P(X <= 1) of X2`), else the nearest distribution line above it (the first one below when there is none above). Name a distribution with a prefix: `X: plot the normal distribution with mean 0 and sd 1`. The probability is published as `PR1_val`.

**Riemann sums** (2D charts)

| Line | Means |
| --- | --- |
| `draw the left Riemann sum of f from 0 to 2 with 6 parts, labelled` | Rectangles under the function f (a function of the chart, named in its line: `plot f(x) = x^2`) over [0, 2] in 6 equal parts, their heights at the left ends; `right`, `middle` (or `midpoint`) take the right ends or the middles. The bounds and the number of parts are formulas: `with n parts` and `slider n from 1 to 40, starting at 6, in steps of 1` lets the sum close in on the integral. `labelled` shows the sum and the integral, `$L_{6} = 2.037$, $\int_{0}^{2} f(x)\,dx = 2.667$`; `labelled "{sum:2}"` is a label of your own (`{sum}`, `{exact}`, `{n}`). Options: a colour, a thickness (the outlines), `opacity 0.35`. |
| `draw the trapezoid rule of f from 0 to 2 with 6 parts` | The same with trapezoids (`T_{6}` in the label). |

The sum is published as `RS1_val`.

**Slope fields** (2D charts)

| Line | Means |
| --- | --- |
| `draw the slope field of $y' = x - y$` | Short segments on a grid over the view, each with the slope f(x, y) at its middle, all the same length on screen (`dy/dx = ...` and `\frac{dy}{dx} = ...` read too). Options: a colour, a thickness, `density=30` (segments across the longer side, 4 to 60, default 20). |
| `mark P at (1, 2)` | A point with its name (the same as `P: mark (1, 2)`). |
| `draw the solution through P` | The solution of the slope field's equation through the point P (RK4, forwards and backwards until it leaves the view, blows up or turns vertical). Drag P in the editor and the solution follows. Several: `draw the solutions through P, Q and (0, -1)`. Options: a colour, a thickness, `dashed`. |

A solution belongs to the nearest slope field line above it (else the first below); `draw the solution of SF2 through P` names another.

**Values** (version 6)

| Line | Means |
| --- | --- |
| `let v = (2, 1)`, `let $w = \begin{pmatrix} -1 \\ 2 \end{pmatrix}$` | A vector (2, 3 or more numbers). Every formula of the chart can use it by name, in any order: `v + w`, `2v`, `v \cdot w`, `v_x`, its length `abs(v)`. |
| `let A = [[1.5, 1], [0.5, 2]]`, `let $A = \begin{pmatrix} 1.5 & 1 \\ 0.5 & 2 \end{pmatrix}$` | A matrix (`bmatrix` too): `A v`, `AB`, `A^{-1}`, `A^T`, `\det A`, `\operatorname{tr} A`. |
| `let $c = -0.8 + 0.156i$` | A complex number: `abs(c)`, `\arg c`, `\bar c`, `\Re c`, `\Im c`, `e^{i\theta}`. |
| `let $f(x, y) = x^2 + 4y^2$` | A function of one or more variables: `f(1, 2)`, `\nabla f(p)` (its numeric gradient), `shade where $f(x, y) \le 4$`. Its body reads its parameters, sliders and let names, no axis variable of its own. |
| `let $S = \{(k, k^2) : k = 1, \dots, 10\}$` | A list (plain: `[(k, k^2) : k = 1..10]`, `[1, 2, 3]`). |
| `draw v as an arrow`, `draw v and w as arrows, labelled` | Arrows from the origin. A vector is a let name, a formula (`A v`, `(1, 3)`) or a complex number (its real and imaginary parts). |
| `draw v as an arrow from (1, 1)` (also `draw v from P`) | Arrows from a point or a points tool (drag P and they follow). |
| `draw v + w tip to tail` | The terms end to end (dashed, thin), then the sum. |
| `mark the points $\{e^{2\pi i k / n} : k = 0, \dots, n - 1\}$, joined, labelled`, `mark the points of S` | The points of a list of complex numbers or points. `joined` draws the closed polygon through them in their order. |

A let line draws nothing; its option is `hidden`. Arrow options: a colour, `thin`, `thick` (the default), `dashed`, `labelled` (`$\vec{v}$`, `$A \vec{v}$`), `labelled "text"` (one per arrow with `;`, placeholders `{x}` `{y}` `{z}` `{i}`), `hidden`. Point list options: a colour, `small`, `large`, `thin`, `thick`, `joined`, `labelled` (each point's value, `0.5 + 0.866i`), `labelled "text"`, `hidden`; it publishes `LP1_n`, `LP1_x`, `LP1_y`, `LP1_x2`, ... Arrows and point lists work in 3D too. In every formula: `\sum_{k=1}^{n}` and `\prod_{k=1}^{n}` (bounds may be sliders, at most 100000 terms), `n!`, `\binom{n}{k}`; see [Formulas](#formulas).

**Sets on an axis and chords** (2D charts)

| Line | Means |
| --- | --- |
| `mark where $g(x) \le 0$ on the x-axis, labelled` | The set of x where a condition in x holds, as a bar on the x-axis: `<`, `\le`, `>`, `\ge`, `abs(x - 1) < 2`, chains (`0 \le x < 1`), `and`, `or`, an interval `x \in [0, 1)`, or an equation (`g(x) = 0`: its zeros, as dots). Filled end dots belong to the set, open ones do not; an arrow where it runs off the view. `labelled` writes it in set notation, such as {x ∣ g(x) ≤ 0} = [-2, 2]. |
| `mark where $y > 1$ on the y-axis` | The same with a condition in y, on the y-axis. |
| `draw the chord of g from -1 to 3 at $\lambda$, labelled` | The chord from (a, g(a)) to (b, g(b)) of a function of the chart; `at λ` adds the point x = λa + (1 − λ)b on the chord and on the graph and the gap between them (Jensen's inequality). a, b and λ are formulas (sliders). |

Set options: a colour (default teal), `thin`, `thick` (default very thick), `labelled`, `labelled "text"`, `hidden`; it publishes `AX1_n` (ends), `AX1_x`, `AX1_x2`, ... (`AX1_y`, ... on the y-axis) and `AX1_val` (pieces). Chord options: a colour (default red), `thin`, `thick`, `dashed`, `labelled`, `labelled "text"` (placeholders `{lambda}` `{x}` `{chord}` `{graph}` `{gap}`), `hidden`; it publishes `CH1_x`, `CH1_y` and `CH1_val` (the gap, chord minus graph).

**Steps** (charts that play)

| Line | Means |
| --- | --- |
| `then plot g(x) = cos(x) in red` | `then` before an object line starts the next step. Lines before the first `then` are step 1; every later line stays in the step of the `then` above it. In the note, Previous, Play and Next under the chart go through the steps; the chart starts at its last step. |
| `then` (alone) | A step with nothing new: a pause. |
| `frames` | The LaTeX export draws every step side by side (one tikzpicture each). Without it, the export draws the last step. |
| `set stillTime = 1.5` | Moving objects (particles, turning circles) are drawn at this time in seconds in the export, print and SVG files (default 0). |

Every object also takes `step=3` (its step as a number). A transform in a step moves while its step comes in (see Linear algebra).

**Vector fields and systems**

| Line | Means |
| --- | --- |
| `draw the vector field $F(x, y) = (y, -\sin x - 0.25y)$` | Short arrows on a grid over the view, all the same length on screen. The formula is a pair (P, Q) in x and y; `F(x, y) =` names the field (without it: VF1). 2D charts. |
| `mark the rest points of F, labelled` | The zeros of F in the view: filled when stable, open when not; `labelled` writes the kind (stable node, unstable node, stable spiral, unstable spiral, saddle, centre). `mark the rest points` takes the nearest field above. 2D charts. |
| `draw the solution of $\dot{p} = (y, -x)$ through P for t from 0 to 10` | The solution of a system through points tools or points (several with `and`), by RK4. 2D chart: 2 formulas in x, y and t; 3D chart: 3 formulas in x, y, z and t, `through (1, 1, 1)`. The left side may be `\dot{p} =`, `p' =`, `\frac{dp}{dt} =` or left out. `for t from a to b` defaults to 0 to 10. |

Field options: a colour, `thin`, `thick`, `coloured by length` (viridis; `coloured by length in heat`, ...), `with moving particles` (they move on the chart's clock; the export draws faint arrows and a few streamlines), with them `speed 2`, `300 particles`, `trails 0.9`, `width 1.4`, `arrows 0.025` or `no arrows`, `with streamlines`, `density=30` (arrows across, 4 to 60), `hidden`. Rest point options: a colour, `small`, `large`, `labelled`, `hidden`; they publish `RP1_n`, `RP1_x`, `RP1_y`, `RP1_x2`, ... Solution options: a colour, `thin`, `thick`, `dashed`, `coloured by time` (`in heat`, ...), `traced` (the curve draws itself over time on the clock; `speed 2` draws it twice as fast), `hidden`. The 5.0 line `draw the solution through P` of a slope field is unchanged.

**Linear algebra** (the grid moves, î and ĵ land on the columns of A)

| Line | Means |
| --- | --- |
| `draw the grid`, `draw the grid from -2 to 2 in steps of 0.5` | The lines x = k·s and y = k·s that a transform moves (formulas, sliders). Without a range it reaches twice as far as the view. 3D: a grid cube. |
| `draw the basis vectors` | î = (1, 0) in green and ĵ = (0, 1) in red (3D: k̂ in blue), labelled. Another colour draws all of them in it; `valueLabel=false` leaves the labels out. |
| `transform the plane by A` | Moves every object above it (and the functions of its step or before), not the axes, text labels or objects after it; the old grid stays faint. The map: a matrix (a let name, `[[2, 0], [0, 0.5]]`, `$\begin{pmatrix} 0 & -1 \\ 1 & 0 \end{pmatrix}$`, sliders allowed), `$z \mapsto z^2$` (complex), `$(x, y) \mapsto (x + y, y)$`, or a let function. 3D: `transform space by B`. With `then` it moves while its step comes in: (1 − t)I + tA, or (1 − t)z + t f(z). |
| `draw the eigenvectors of A, labelled` | The lines through 0 along the real eigenvectors of a 2 x 2 (3D: 3 x 3) matrix, with `λ₁ = 2.5`, `λ₂ = 1`. Complex eigenvalues draw no line and say so. |
| `shade the unit square, labelled` | The square [0, 1]², shaded; a transform below it moves it, and `labelled` shows its signed area (`det A = 2.5` once one matrix moved it all the way). `labelled "det A = {det(A)}"` is a label of your own (placeholders `{area}` `{det}`). `shade the image of the unit square` moves it by the transforms above it too. 3D: `shade the unit cube`. |
| `draw the span of v and w, labelled` | The span of vectors: the plane (shaded), a line through 0, or 0. `labelled`: `span(v⃗, w⃗) = ℝ²`. |

Options: grid, a colour (default blue), `thin`, `thick`, `hidden`; basis vectors, a colour, `thin`, `thick`, `hidden`; transform, `hidden`; eigenvectors, a colour (default orange), `thin`, `thick`, `dashed`, `labelled`, `hidden`; unit square, a colour (default purple), `opacity 0.3`, `labelled`, `labelled "text"`, `hidden`; span, a colour (default teal), `thin`, `thick`, `opacity 0.15`, `labelled`, `hidden`. In the editor, the tips of î and ĵ (and of arrows of let vectors written as numbers) can be dragged: the numbers in the text change.

```easy-tikz
show x from -4.5 to 4.5 and y from -3 to 3
equal scale
let $A = \begin{pmatrix} 1.5 & 1 \\ 0.5 & 2 \end{pmatrix}$
draw the grid
draw the basis vectors
shade the unit square, labelled
then transform the plane by A
then draw the eigenvectors of A, labelled
```

**Iterate and colour the plane** (2D charts)

After the formula, the pieces between commas are the start (`$z_0 = 0$`), the names the recurrence reads (`$c = P$`, `$c = a + bi$`), the steps (`40 steps`) and the options, in any order. A start or a name is a formula, a point `(1, 2)` or a points tool `P` (drag P and the picture follows). A recurrence is written `z_{n+1} = F` with the state as `z_n` in F (also `x_{n+1}`, `p_{n+1}`, `\theta_{n+1}`).

| Line | Means |
| --- | --- |
| `draw the orbit of $z_{n+1} = z_n^2 + c$, $z_0 = 0$, $c = P$, 40 steps` | The points z₀, z₁, ... joined by a line. Complex numbers and vectors of 2 are points of the plane (a points tool P is x + iy); numbers are drawn as (n, x_n). Gradient descent: `draw the orbit of $p_{n+1} = p_n - \eta \nabla f(p_n)$, $p_0 = P$, 25 steps` with `let $f(x, y) = ...$` and a slider `eta`. |
| `draw the cobweb of $x_{n+1} = f(x_n)$ from 0.2, 80 steps` | The line y = x, the graph of the map, and the path (x₀, 0), (x₀, x₁), (x₁, x₁), ... `draw the cobweb of f from 0.2` is short for it. Defaults: from 0.2, 40 steps. |
| `draw the bifurcation diagram of $x_{n+1} = r x_n (1 - x_n)$ for r from 2.5 to 4` | For each r on the x-axis, where the orbit of x₀ settles, as dots (a picture). Optional start `$x_0 = 0.3$` (default 0.5). |
| `draw Newton's method for f from 2.5, 5 steps, labelled` | For a function of the chart: each tangent down to the x-axis and the line up to the graph. |
| `colour the plane by $z_{n+1} = z_n^2 + c$, $z_0 = 0$, $c = x + iy$, 200 steps` | Escape time: every pixel runs the orbit with its point x + iy where the line puts it (`c = x + iy`: the Mandelbrot set; `z_0 = x + iy`: Julia sets and Newton basins). Default 200 steps, colour map `cyclic`. The recurrence is one of complex numbers. |
| `colour the plane by $f(z) = \frac{z^2 - 1}{z^2 + 1}$` | Domain colouring: the hue is the angle of f(z), the light grows with the modulus of f(z) (zeros dark, poles white). |
| `colour the plane by $f(x, y) = \sin x \cos y$, in viridis` | A heat map from the lowest value in the view to the highest. |
| `draw the circles of $\sum_{k=1}^{n} \frac{4}{\pi (2k - 1)} e^{i(2k - 1)t}$, with its wave` | Turning circles: each term of a sum in t a circle on the tip of the one before, turning on the chart's clock, and the curve the tip draws. `with its wave`: the imaginary part over time beside them. The export draws the still frame. |

Options: orbit, a colour (default red), `thin`, `thick`, `small`, `large`, `as a path` (no dots), `labelled` (z₀ to z₅), `traced` (the orbit draws itself over time on the clock), `hidden`, publishing `OR1_n`, `OR1_x`, `OR1_y` (the last point); cobweb, a colour (default orange), `thin`, `thick`, `hidden`, publishing `CW1_x`, `CW1_n`; bifurcation diagram, a colour, `hidden`; Newton's method, a colour (default red), `thin`, `thick`, `labelled` (x₀, x₁, ...), `hidden`, publishing `NM1_x`, `NM1_val`, `NM1_n`; coloured plane, a colour map (`in viridis`, `heat`, `cool`, `diverging`, `rainbow`, `greyscale`, `cyclic`), `opacity 0.5`, `hidden`; circles, a colour (default blue), `thin`, `thick`, `with its wave`, `hidden`. `color the plane by` works too. A coloured plane lies under the grid and everything else. The export writes a coloured plane and a bifurcation diagram as a PNG (`\addplot graphics`) beside the .tex file; `export_latex` gives the code only, with a comment that names the PNG.

```easy-tikz
show x from -2.4 to 1 and y from -1.15 to 1.15
equal scale
colour the plane by $z_{n+1} = z_n^2 + c$, $z_0 = 0$, $c = x + iy$, 200 steps
mark P at (-0.12, 0.75), large
draw the orbit of $z_{n+1} = z_n^2 + c$, $z_0 = 0$, $c = P$, 40 steps, as a path
```

**Python scripts** (2D charts)

A `python:` line and the lines indented below it are a script (any indent; it ends at the first line that is not indented). It runs inside the plugin (no Python install, on phones too) and is printed back exactly as written. Use it for what formulas cannot say: loops, arrays, an FFT, a computed path. Several blocks run in order and share one scope.

```easy-tikz
show x from -20 to 20 and y from -15 to 15
equal scale
slider n from 1 to 120, starting at 40, in steps of 1
python:
    import numpy as np
    t = np.linspace(0, 2*np.pi, 256, endpoint=False)
    heart = 16*np.sin(t)**3 + 1j*(13*np.cos(t) - 5*np.cos(2*t) - 2*np.cos(3*t) - np.cos(4*t))
    c = np.fft.fft(heart) / len(heart)
draw the circles of c, using n circles, with its path
```

- **Names it sets are values of the chart**, as `let` names: every line and label can use them (`plot g(x) = f(x)`, `mark the points of P`, `{k:2}` in a label). A number is a number; `1 + 2j` a complex number; a NumPy array of 2 or 3 numbers a vector, a longer one a list; an array of shape (n, 2) a list of points (`mark the points of pts, joined`); a square array a matrix; a complex array a list of complex numbers; `def f(x):` a function of the chart (exported as sampled coordinates). Names a slider, a function or an axis variable has (`x`, `y`, `t`, `z`) stay the chart's: the script may use them, the chart does not see them.
- **Sliders and computed names are variables of the script** (`a`, `n`, `P1_x`): it runs again when one it reads changes (cached by them).
- **`draw the circles of c, using n circles, with its path`**: `c` a list of complex coefficients in NumPy's `fft` order (index k is frequency k for k < N/2, else k − N); the circles turn in the order 0, 1, −1, 2, −2, ...; `using n circles` keeps the first n (at most 400); `with its path` draws the path of the tip.
- **matplotlib calls draw** (`plt.` or `ax.` after `fig, ax = plt.subplots()`), in the chart's theme colours: `plot(x, y, 'r--', color=, linewidth=, linestyle=, marker=, label=, alpha=)`, `scatter(x, y, s=, c=, cmap=)`, `fill_between(x, y1, y2, where=, alpha=)`, `fill`, `bar`, `hist(x, bins, density=)`, `stem`, `step`, `arrow(x, y, dx, dy)`, `quiver(X, Y, U, V)`, `text(x, y, s)`, `annotate`, `axhline`, `axvline`, `hlines`, `vlines`, `contour(X, Y, Z, levels)`, `imshow(Z, extent=, origin=, cmap=)` (a picture: a PNG in the export), `plt.Circle`, `plt.Rectangle`, `plt.Polygon` with `add_patch`, `title`, `xlabel`, `ylabel` (the chart's title and axis names where it has none), `legend()` (a key in the corner that covers the least), `xlim`, `ylim`. Colours: `C0` to `C9`, `b g r c m y k w`, names (`red`, `tab:blue`, ...), `#rrggbb`, grey levels `'0.5'`; colour maps map to the plugin's six. A chart with no `show` line takes the script's `xlim` and `ylim`, else what it draws with matplotlib's margins. `grid`, ticks, `figure`, `show`, `savefig`, `colorbar`, `tight_layout` are accepted and do nothing (the chart's own lines set those).
- **`def frame(t):`** (t in seconds): what it draws moves on the chart's clock (Play and Pause in the strip); the export, print and SVG files draw `frame(0)` (or the chart's `stillTime`). Draw in it; do not change names outside it.
- **The language:** assignment (also `+=`, tuple unpacking, `a, *rest = ...`), `if/elif/else`, `for`, `while` (with `else`), `break`, `continue`, `pass`, `def` (defaults, keywords, `*args`, `**kwargs`, closures, `nonlocal`, `global`), `return`, `lambda`, comprehensions (list, dict, set, generator), `try/except/finally`, `raise`, `assert`, `del`, f-strings with format specs, `%` and `str.format`, slicing; int, float, complex (`1j`), bool, None, str, list, tuple, dict, set, range. Built-ins: `len range enumerate zip map filter sum min max abs round sorted reversed list tuple dict set float int complex bool str repr format isinstance any all divmod pow print` and more; `print` shows in the chart's problem line as a note. Imports: `numpy` (`as np`), `math`, `cmath`, `random`, `matplotlib.pyplot` (`as plt`), `matplotlib.patches`.
- **NumPy:** `array asarray linspace arange zeros ones full eye meshgrid concatenate stack vstack hstack column_stack reshape transpose (.T) flatten sum mean std var min max argmin argmax cumsum cumprod diff dot outer matmul (@) cross sin cos tan arcsin arccos arctan arctan2 sinh cosh tanh exp log log10 log2 sqrt abs angle real imag conj floor ceil round clip where sign maximum minimum hypot mod isnan isfinite sort argsort unique roll flip interp trapz polyfit polyval histogram pi e inf nan`, element-wise operators and comparisons with broadcasting, boolean masks, fancy indexing, `a[:, 0]`, `a[None]`; `np.linalg` (`det inv solve eig eigh eigvals norm matrix_power`), `np.fft` (`fft ifft fftfreq fftshift ifftshift rfft rfftfreq`, any length), `np.random` (`seed rand randn random uniform normal randint choice shuffle permutation default_rng`; every run starts from seed 0, so a chart draws the same each time). Complex arrays work in arithmetic, `exp`, `log`, `sqrt`, `sin`, `cos`, `abs`, `angle`.
- **Not there:** classes, `with`, generators (`yield`), `async`, decorators, other modules (pandas, scipy, sympy, os, files, internet), 3D plots and subplots (a chart is one plot), slices of an array as views (a slice is a copy: `a[1:3] = 0` works, `b = a[1:3]; b[0] = 9` does not change `a`). Whole floats print without `.0` (`2.0` prints as `2`).
- **Problems** name the script's line: "Line 4 of the script: name 'np' is not defined". A script stops after 2 000 000 steps, 1.5 seconds or 120 calls deep ("an endless loop?"); a list or array holds at most 4 000 000 items.

**Limits** (so that no chart freezes a phone). Over a limit, steps are drawn at the limit with a note ("Drawn with 2000 steps at most"); too many grid lines are a problem, and a sum of more than 100000 terms has no value.

| What | At most |
| --- | --- |
| Terms of a sum or product | 100000 |
| Steps of an orbit | 2000 (dots on the first 400, labels on the first 6) |
| Steps of a cobweb | 1000 |
| Steps of Newton's method | 100 |
| Steps per pixel of a coloured plane | 1000 |
| A bifurcation diagram, per column | 400 steps run in, 300 drawn |
| Terms of turning circles | 60 |
| Circles of a list of coefficients (a script's) | 400 |
| A script run | 2 000 000 steps, 1.5 s, calls 120 deep, 4 000 000 items in one array |
| A solution of a system | 20000 RK4 steps (a longer range gets a coarser step), 3000 points drawn |
| Rest points | 40 |
| Lines of the grid | 401 per direction (3D: 21 values per axis) |
| Arrows of a vector field | `density` 4 to 60 across |
| A picture in the export | 150 dpi, at most 900 pixels a side and 600 000 in all |

**Anything else:** every object takes `key=value` options for its fields in the tables below, the value as JSON: `plot f(x) = x^2, filled, fillOpacity=0.4`, `mark (1, 2), dim=2`. And `raw tool {...}`, `raw function {...}`, `raw surface {...}`, `raw label {...}` hold one object as JSON. The editor writes these lines for what the words cannot say; you rarely need them.

A block can also be one JSON object (`"v": 4` first, then the fields below); the plugin reads both, and the editor keeps the form a block has. Write text.

## Full LaTeX

The same charts can be written as LaTeX, for people who think in pgfplots and TikZ. A block whose first line is `\begin{chart}` holds one command per line until `\end{chart}`: the options in `[ ]` before the argument in `{ }`, as in `\addplot[blue]{x^2}`. A formula in the argument is LaTeX math without `$`. The plugin always reads both forms; the setting **Chart language** (Words + LaTeX math, or Full LaTeX) says which one new charts are written in, and a block keeps the form it has. Write words unless the person writes Full LaTeX or asks for it.

The linear program of the first section, in Full LaTeX:

```easy-tikz
\begin{chart}
\axis[xmin=0, xmax=5, ymin=0, ymax=4.5, axis lines=left]
\slider[min=0, max=15, start=6, step=0.1]{c}
\shade[numbered, constraint lines]{x + y \le 4, x + 3y \le 6, x \ge 0, y \ge 0}
\draw[red, dashed, label={$z = {c}$}]{2x + 3y = c}
\mark[corners, blue, label={({x}, {y})}]
\mark[max, large, label={x* = ({x:2}, {y:2})}]{2x + 3y}
\node[at={(3, 1.6)}, above]{optimum}
\end{chart}
```

- **Options** are separated by commas: words (`red`, `dashed`, `numbered`) and `key=value`. A value with a comma, a bracket or spaces goes in braces: `label={z = {c}}`, `at={(3, 1.2)}`, `title={Production plan}`. Label templates (`{c}`, `{x:2}`) keep their braces inside.
- **`\axis[...]`** holds everything about the chart, with the names pgfplots gives them. Write one `\axis` line, after `\begin{chart}`.
- **Names:** `name=R1` instead of `R1:`. `\mark[corners]`, `\mark[max]{...}` and `\mark[integer]` without `in=R1` use the chart's only region (`the region`).
- A Python script is `\begin{python}`, its lines as they are, `\end{python}` (`\begin{python}[name=PY2]` names it); `\circles[count=n, path]{c}` draws the circles of a list.
- `%` starts a comment. A line that is no command is read as a line in words. `\addplot` is `\plot`, a `;` at the end is fine, and TikZ's `\draw[->] (0, 0) -- (3, 2);` and `\node at (1, 2) {A};` work too.
- **Anything else:** a line in words `<command> <rest>, <options>` is `\<command>[<options>]{<rest>}` (`use the table above, hidden` is `\use[hidden]{the table above}`), `\set{field = value}` sets any chart field as JSON, and `\raw[tool]{...}` (`function`, `surface`, `label`, `slider`) holds one object as JSON.

| Words | Full LaTeX |
| --- | --- |
| `show x from 0 to 5 and y from 0 to 4.5` (3D: `and z from 0 to 8`) | `\axis[xmin=0, xmax=5, ymin=0, ymax=4.5]` (`zmin`, `zmax`) |
| `axes on the edges`, `axes in the middle`, `axes in a box`, `no axes` | `axis lines=left`, `axis lines=middle`, `axis lines=box`, `hide axis` |
| `with a grid`, `with a minor grid`, `with a fine grid`, `grid opacity 0.3` | `grid=major`, `grid=minor`, `grid=both`, `grid opacity=0.3` |
| `x numbers every pi/2`, `x numbers at a "a", b "b"`, `x numbers off` | `xtick distance=pi/2`, `xtick={a "a", b "b"}`, `xtick=\empty` (`ytick`, `ztick`) |
| `title ...`, `xlabel ...`, `ylabel ...`, `zlabel ...` | `title={...}`, `xlabel={...}`, `ylabel={...}`, `zlabel={...}` |
| `size 12 x 6`, `equal scale` | `width=12cm, height=6cm`, `axis equal` |
| `3d`, `cube`, `polar`, `snippet`, `variables q, p` | `3d`, `cube`, `polar`, `snippet`, `variables={q, p}` |
| `box 1 x 2 x 0.6` | `plot box ratio={1 2 0.6}` |
| `set displayWidth = 480` | `displayWidth=480` (in `\axis`), or `\set{displayWidth = 480}` |
| `slider c from 0 to 15, starting at 6, in steps of 0.1` | `\slider[min=0, max=15, start=6, step=0.1]{c}` |
| `plot f(x) = x^2 from x = 0 to 4 in blue, thick` | `\plot[domain=0:4, blue, thick]{f(x) = x^2}` |
| `with its tangent at a and its extrema`, `filled`, `with a legend`, `with the legend "f"` | `tangent=a, extrema`, `fill`, `legend`, `legend={f}` |
| `plot s(x, y) = x^2 + y^2 for x from -2 to 2 and y from -2 to 2 in viridis` | `\plot[domain=-2:2, y domain=-2:2, colormap/viridis]{s(x, y) = x^2 + y^2}` |
| `mesh 0.2`, `with 40 samples`, `wireframe` | `mesh=0.2`, `samples=40`, `wireframe` |
| `shade where x + y <= 4 and x >= 0, numbered` | `\shade[numbered]{x + y \le 4, x \ge 0}` |
| `shade where x + y <= 4 "(1)" and x >= 0` | `\shade[labels={(1), }]{x + y \le 4, x \ge 0}` |
| `shade between f and g from x = 0 to 2`, `shade under f` | `\shade[domain=0:2]{between f and g}`, `\shade{under f}` |
| `outlined`, `with a dashed outline`, `not filled`, `with constraint lines` | `outline`, `dashed outline`, `no fill`, `constraint lines` |
| `draw 2x + 3y = 12` | `\draw{2x + 3y = 12}` |
| `draw the level curves of x^2 + y^2 at 1, 4 and 9` | `\draw[levels={1, 4, 9}]{x^2 + y^2}` |
| `draw a line from (0, 0) to (3, 2) to P1` | `\draw{(0, 0) -- (3, 2) -- P1}` |
| `draw an arrow from A to B` (`backwards`), `draw a double arrow from A to B` | `\draw[->]{A -- B}` (`<-`), `\draw[<->]{A -- B}` |
| `draw a polygon through A, B and C`, `draw a brace from A to B` | `\draw{A -- B -- C -- cycle}`, `\draw[brace]{A -- B}` |
| `draw the plane z = h` | `\draw[plane]{z = h}` |
| `mark (1, 2) and (3, a)` | `\mark{(1, 2), (3, a)}` |
| `mark where f and g cross` | `\mark[crossings]{f, g}` |
| `mark the corners of the region`, `mark the corners of R1` | `\mark[corners]`, `\mark[corners, in=R1]` |
| `mark the maximum of 2x + 3y in the region` (`minimum`, `in R1`) | `\mark[max]{2x + 3y}` (`min`, `in=R1`) |
| `mark the integer points in R1`, `mark the integer points` (the whole view) | `\mark[integer, in=R1]`, `\mark[integer, in={}]` |
| `mark the integer maximum of 3x + 4y in R1` | `\mark[integer, max, in=R1]{3x + 4y}` |
| `with lines to the axes`, `with coordinates`, `small`, `large` | `drop lines`, `coordinates`, `small`, `large` |
| `write "optimum" at (3, 1.2), above` | `\node[at={(3, 1.2)}, above]{optimum}` |
| `R1: shade ...` | `\shade[name=R1]{...}` |
| `in red`, `thick`, `dashed`, `hidden`, `labelled "A"`, `opacity 0.3`, `pattern dots` | `red`, `thick`, `dashed`, `hidden`, `label={A}`, `opacity=0.3`, `pattern=dots` |
| `key=value` (a field) | `key=value` |
| `raw tool {...}` | `\raw[tool]{{...}}` |
| `let v = (2, 1)`, `let $f(x, y) = x^2 + 4y^2$` | `\let{v = (2, 1)}`, `\let{f(x, y) = x^2 + 4y^2}` |
| `draw v and w as arrows, labelled` | `\draw[vector, labelled]{v, w}` |
| `draw v as an arrow from (1, 1)`, `draw v + w tip to tail in red` | `\draw[vector, from={(1, 1)}]{v}`, `\draw[vector, tip to tail, red]{v + w}` |
| `mark the points $\{e^{2\pi i k / n} : k = 0, \dots, n - 1\}$, joined`, `mark the points of S` | `\mark[list, joined]{\{e^{2\pi i k / n} : k = 0, \dots, n - 1\}}`, `\mark[list]{S}` |
| `mark where $g(x) \le 0$ on the x-axis, labelled` (`on the y-axis`) | `\mark[x-axis, labelled]{g(x) \le 0}` (`y-axis`) |
| `draw the chord of g from -1 to 3 at $\lambda$, labelled` | `\draw[chord, from=-1, to=3, at=\lambda, labelled]{g}` |
| `then plot g(x) = \cos x in red`, `then` | `\then \plot[red]{g(x) = \cos x}`, `\then` |
| `frames` | `frames` (in `\axis`) |
| `draw the vector field $F(x, y) = (y, -\sin x - 0.25y)$, coloured by length, with moving particles and streamlines` | `\vectorfield[colormap/viridis, particles, streamlines]{F(x, y) = (y, -\sin x - 0.25y)}` |
| `mark the rest points of F, labelled` | `\restpoints[labelled]{F}` |
| `draw the solution of $\dot{p} = (y, -x)$ through P for t from 0 to 10, coloured by time` | `\solution[through=P, t=0:10, colormap/viridis]{\dot{p} = (y, -x)}` |
| `draw the grid from -2 to 2 in steps of 0.5`, `draw the basis vectors` | `\draw[grid, from=-2, to=2, spacing=0.5]`, `\draw[basis vectors]` |
| `transform the plane by A`, `transform the plane by $z \mapsto z^2$`, `transform space by B` | `\transform{A}`, `\transform{z \mapsto z^2}`, `\transform{B}` |
| `draw the eigenvectors of A, labelled`, `draw the span of v and w` | `\draw[eigenvectors, labelled]{A}`, `\draw[span]{v, w}` |
| `shade the unit square, labelled`, `shade the image of the unit square`, `shade the unit cube` | `\shade[unit square, labelled]`, `\shade[unit square, image]`, `\shade[unit cube]` |
| `draw the orbit of $z_{n+1} = z_n^2 + c$, $z_0 = 0$, $c = P$, 40 steps, as a path` | `\orbit[z_0=0, c=P, steps=40, as a path]{z_{n+1} = z_n^2 + c}` |
| `draw the cobweb of $x_{n+1} = f(x_n)$ from 0.2, 80 steps` | `\cobweb[from=0.2, steps=80]{x_{n+1} = f(x_n)}` |
| `draw the bifurcation diagram of $x_{n+1} = r x_n (1 - x_n)$ for r from 2.5 to 4` | `\bifurcation[r=2.5:4]{x_{n+1} = r x_n (1 - x_n)}` (start: `x_0=0.3`) |
| `draw Newton's method for f from 2.5, 5 steps, labelled` | `\newton[from=2.5, steps=5, labelled]{f}` |
| `colour the plane by $z_{n+1} = z_n^2 + c$, $z_0 = 0$, $c = x + iy$, 200 steps` | `\colourplane[z_0=0, c=x + iy, steps=200]{z_{n+1} = z_n^2 + c}` (also `\colorplane`) |
| `colour the plane by $f(x, y) = \sin x \cos y$, in viridis, opacity 0.8` | `\colourplane[colormap/viridis, opacity=0.8]{f(x, y) = \sin x \cos y}` |
| `draw the circles of $\sum_{k=1}^{n} \frac{4}{\pi (2k - 1)} e^{i(2k - 1)t}$, with its wave` | `\circles[wave]{\sum_{k=1}^{n} \frac{4}{\pi (2k - 1)} e^{i(2k - 1)t}}` |

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
| `gridOpacity` | `0.5` | Opacity of the major grid lines, 0 to 1 (the line `grid opacity 0.3`); minor lines at half of it. |
| `numbers_x` `numbers_step_x` `numbers_at_x` | `"auto"` `""` `""` | The numbers on x (and `_y`, `_z`): `"auto"`, `"every"` (with the step's formula), `"at"` (with the values) or `"off"` (the line `x numbers ...`). |
| `size_x_cm` `size_y_cm` | `10` `10` | Size of the exported figure in cm. It also sets the shape of the chart in the note: `12` by `6` gives a wide chart. |
| `equalScale` | `false` | Same unit on both axes, so circles stay round. |
| `coordinateSystem` | `"cartesian"` | `"polar"`: every function is r(θ), written with `theta`. |
| `variables` | `"x, y"` | Other axis letters, such as `"q, p"` or `"x1, x2"`. `x` and `y` keep working, and point labels still use `{x}` and `{y}`. |
| `dimension` | `false` | `true` makes a 3D chart (see 3D). |
| `zmin` `zmax` `axis_label_z` | `"-5"` `"5"` `"z"` | 3D only. |
| `boxAspect` | `"true"` | 3D only: `"true"` gives the box the proportions of the ranges, `"equal"` makes it a cube (the line `cube`), `"custom"` gives it the lengths of `boxRatio` (the line `box 1 x 2 x 0.6`). |
| `boxRatio` | none | 3D only, with `boxAspect` `"custom"`: the lengths of the box, x : y : z, such as `[1, 2, 0.6]`. |
| `showSlidersInNote` | `true` | Sliders under the chart in the note. Moving them never edits the note. |
| `documentSetup` | `true` | The LaTeX export is a standalone document (`false`: only the tikzpicture). |
| `displayWidth` `displayAlign` | (unset) | Width in px and `"left"`, `"center"` or `"right"` of the chart in the note. Usually leave them out. |
| `fitY` | `false` | `true`: y fits itself to what the chart draws, live (a text chart with an x range and no y range sets it). |
| `frames` | `false` | The LaTeX export draws every step side by side (the line `frames`). |
| `stillTime` | `0` | The time in seconds at which the export, print and SVG files draw moving objects. |
| `parameters` `functions` `tools` `annotations` `functions3D` | `[]` | Sliders, functions, shapes, text labels and surfaces. Below. |

### Sliders: `parameters`

```json
"parameters": [{ "name": "c", "value": 9, "min": 0, "max": 15, "step": 0.1 }]
```

Give all five fields (and `"connected": true` for a slider that moves with the sliders of the same name in the other charts of the note). The name is a letter or a word (`a`, `k`, `price`) that is not a built-in (`x`, `y`, `t`, `e`, `pi`, `sin`, ...). Every formula, condition, coordinate, range and label can use it. The note shows a slider for it; the editor also has a play button that sweeps it from `min` to `max` and back. Choose the range so the picture stays meaningful over all of it (a crossing that leaves the view, or two parallel lines, makes points and areas disappear).

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

Every tool has `type`, `name` (`R1`, `C1`, `P1`, `S1`, `PL1`, ...), `color` and optionally `hidden` and `step` (the step it arrives in, 0 for the first; functions, surfaces and text labels take `step` too). Fills are always drawn below lines and points; otherwise tools are drawn in list order.

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

#### `data` and `dataPlot` (2D only)

`{"type": "data", "name": "D1", "source": "table", "xColumn": "", "yColumn": ""}` reads the note's table (`xColumn` and `yColumn` by header name, empty: the first two columns of numbers); `{"type": "data", "source": "list", "points": "(1, 52); (2, 55)"}` holds typed points. A data set draws nothing itself. `{"type": "dataPlot", "data": "D1", "style": "points"}` draws one: `style` is `"points"`, `"bars"`, `"line"` or `"regression"`; fields `size`, `thickness`, `dashed`, `fillOpacity` (bars, default 0.35), `label` (a template: points get `{x}` `{y}` `{i}`, the regression line `{m}` `{b}` `{r2}` `{n}`) and `valueLabel` (`true`: the regression line's equation and R² as its label).

#### `distribution` and `probability` (2D only)

`{"type": "distribution", "name": "X1", "kind": "normal", "mean": "0", "sd": "1"}` or `{"type": "distribution", "kind": "binomial", "n": "10", "p": "0.4"}` (formulas), with `color`, `thickness`, `dashed` and `fillOpacity` (the bars). `{"type": "probability", "distribution": "X1", "event": "-1 <= X <= 1", "valueLabel": true}` shades P(event): `event` as written inside P(...), plain or LaTeX; `fillOpacity` (0.5), `fillPattern`, `label` (a template with `{p}`) and `valueLabel`.

#### `riemann` (2D only)

`{"type": "riemann", "name": "RS1", "function": "f", "method": "left", "from": "0", "to": "2", "parts": "6"}`: `method` is `"left"`, `"right"`, `"middle"` or `"trapezoid"`; `from`, `to` and `parts` are formulas (parts 1 to 2000, from less than to); `thickness`, `fillOpacity` (0.35), `label` (a template with `{sum}`, `{exact}`, `{n}`) and `valueLabel`.

#### `slopeField` and `solution` (2D only)

`{"type": "slopeField", "name": "SF1", "expression": "x - y", "density": 20}` (the right side of y' = f(x, y), in x and y), with `color` and `thickness`. `{"type": "solution", "field": "SF1", "through": "P; (0, -1)"}`: `through` lists points tools by name and points, separated by `;`; `thickness` and `dashed`.

#### `plane3D` (3D only)

`{"type": "plane3D", "name": "PL1", "axis": "z", "value": "h", "fillOpacity": 0.25, "color": "orange"}` is the plane z = h (or x = ..., y = ...).

#### `value`, `vector` and `listPoints` (version 6)

`{"type": "value", "name": "v", "params": "", "expression": "(2, 1)"}` is `let v = (2, 1)`; a function has `"params": "x, y"`. It draws nothing. `{"type": "vector", "name": "V1", "vectors": "v; w", "from": "", "tipToTail": false, "thickness": "thick", "dashed": false, "label": "", "valueLabel": true}` draws arrows (`vectors` separated by `;`, `from` a point or a points tool). `{"type": "listPoints", "name": "LP1", "points": "S", "joined": false, "size": "normal", "thickness": "thin", "label": "", "valueLabel": false}` marks the points of a list.

#### `axisSet` and `chord` (2D only)

`{"type": "axisSet", "name": "AX1", "condition": "g(x) <= 0", "axis": "x", "thickness": "very thick", "label": "", "valueLabel": true, "color": "teal"}` is a set on the x-axis (`"axis": "y"` for the y-axis). `{"type": "chord", "name": "CH1", "function": "g", "from": "-1", "to": "3", "at": "lambda", "thickness": "thick", "dashed": false, "label": "", "valueLabel": true, "color": "red"}` is a chord (`"at": ""` for the chord alone).

#### `vectorField`, `restPoints` and `trajectory`

`{"type": "vectorField", "name": "F", "expression": "(y, -sin(x) - 0.25y)", "density": 20, "thickness": "thin", "particles": false, "streamlines": false, "colormap": "viridis"}` (2D; leave out `colormap` for the tool's colour). `{"type": "restPoints", "name": "RP1", "field": "F", "size": "normal", "valueLabel": false}` (2D). `{"type": "trajectory", "name": "TR1", "expression": "(y, -x)", "through": "P; (0, -1)", "from": "0", "to": "10", "dim": 2, "thickness": "thick", "dashed": false}` is a solution of a system (`"dim": 3` with 3 formulas in a 3D chart; `colormap` colours it by time).

#### `planeGrid`, `basisVectors`, `transform`, `eigenvectors`, `unitSquare` and `span`

`{"type": "planeGrid", "name": "G1", "from": "", "to": "", "spacing": "", "thickness": "thin"}` (empty: beyond the view, a step of 1). `{"type": "basisVectors", "name": "BV1", "thickness": "very thick", "valueLabel": true, "color": "green"}`. `{"type": "transform", "name": "T1", "map": "A"}` (`map`: a matrix or `z \\mapsto z^2`, `(x, y) \\mapsto (x + y, y)`). `{"type": "eigenvectors", "name": "EV1", "matrix": "A", "thickness": "thick", "dashed": false, "valueLabel": true}`. `{"type": "unitSquare", "name": "U1", "image": false, "fillOpacity": 0.3, "label": "", "valueLabel": true}`. `{"type": "span", "name": "SP1", "vectors": "v; w", "fillOpacity": 0.15, "thickness": "thick", "valueLabel": false}`. In JSON, a LaTeX backslash is doubled.

#### `orbit`, `cobweb`, `bifurcation`, `newton`, `colourPlane` and `fourierCircles` (2D only)

`{"type": "orbit", "name": "OR1", "recurrence": "z_{n+1} = z_n^2 + c", "start": "0", "given": "c = P", "steps": "40", "path": false, "size": "small", "thickness": "thin", "valueLabel": false}` (`given`: the names it reads, `c = P; eta = 0.1`). `{"type": "cobweb", "name": "CW1", "recurrence": "x_{n+1} = f(x_n)", "start": "0.2", "steps": "40", "thickness": "thin"}`. `{"type": "bifurcation", "name": "BD1", "recurrence": "x_{n+1} = r x_n (1 - x_n)", "parameter": "r", "from": "2.5", "to": "4", "start": "0.5"}`. `{"type": "newton", "name": "NM1", "function": "f", "start": "2.5", "steps": "5", "thickness": "thin", "valueLabel": false}`. `{"type": "colourPlane", "name": "CP1", "formula": "z_{n+1} = z_n^2 + c", "start": "0", "given": "c = x + iy", "steps": "200", "colormap": "cyclic", "opacity": 1}` (a function of z or of x and y needs no `start`, `given` or `steps`). `{"type": "fourierCircles", "name": "FC1", "sum": "\\sum_{k=1}^{n} \\frac{4}{\\pi (2k - 1)} e^{i(2k - 1)t}", "wave": true, "thickness": "thick"}`.

#### `python` (2D)

`{"type": "python", "name": "PY1", "code": "import numpy as np\nc = np.fft.fft(z) / len(z)"}`: the script without the block's indent, lines joined by `\n`. A `fourierCircles` tool of a list has `"sum": "c"`, `"count": "n"` (how many circles, a formula) and `"path": true`.

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

Version 6 objects publish values the same way: sets on an axis (`AX1_n`, `AX1_x`, `AX1_val`), chords (`CH1_x`, `CH1_y`, `CH1_val`), point lists (`LP1_n`, `LP1_x`, ...), rest points (`RP1_n`, `RP1_x`, ...), orbits (`OR1_n`, `OR1_x`, `OR1_y`), cobwebs (`CW1_x`, `CW1_n`) and Newton's method (`NM1_x`, `NM1_val`, `NM1_n`).

## Formulas

- LaTeX math: a formula in a line may be LaTeX in dollars, as in a note: `plot $f(x) = \frac{1}{2}x^2 - 2$ in blue`, `shade where $x + y \le 4$ and $x \ge 0$`, `plot $r(\theta) = 1 + \cos\theta$`. `\frac`, `\sqrt`, `\sqrt[n]`, `^{...}`, `\sin x`, `\ln|x|`, `|x|`, `\cdot`, `\le`, `\ge`, `\pi` and Greek letters read as you would expect; `x_1` is the name `x_1`. Dragging in the editor changes only plain formulas, so write plain formulas when the user will drag the numbers.
- Operators: `+ - * /`, `^` (power, right-associative; `-x^2` is `-(x^2)`), `%`, comparisons `< <= > >= == !=` (1 or 0), `and or !`, `c ? a : b`.
- Implicit multiplication: `2x`, `3(x + 1)`, `(x + 1)(x - 1)`, `2 pi`, `a x + b y`. But `ax` is one name: write `a x`. `1/2x` is `(1/2)*x`: write `1/(2x)` when x is below. `a(x - h)^2` is `a*(x - h)^2`; `f1(x + 1)` is a call because `f1` is a function.
- Functions: `sin cos tan sec csc cot asin acos atan atan2(y, x) sinh cosh tanh asinh acosh atanh exp ln log log10 log2 sqrt cbrt abs sign floor ceil round trunc min max hypot pow(a, b)`. `ln` and `log` are both natural. Trigonometry is in radians.
- Constants: `pi` (`π`), `e`.
- Variables: `x` in functions; `x` and `y` in regions, curves and surfaces; `t` in parametric curves; `theta` in polar charts.
- Values (version 6), plain or LaTeX: complex numbers (`i`, `-0.8 + 0.156i`, `e^{i\theta}`, `|z|`, `\arg z`, `\bar z`, `\Re z`, `\Im z`; plain `abs`, `arg`, `conj`, `re`, `im`), vectors (`(2, 1)`, `\begin{pmatrix} 2 \\ 1 \end{pmatrix}`, `v + w`, `2v`, `v \cdot w`, `|v|`, `v \times w`, `v_x`; plain `dot`, `cross`, `norm`, `unit`, `angle(v, w)`), matrices (`[[1, 2], [3, 4]]`, `\begin{pmatrix} 1 & 2 \\ 3 & 4 \end{pmatrix}`, `A v`, `AB`, `A^{-1}`, `A^T`, `\det A`, `\operatorname{tr} A`; plain `det`, `tr`, `inv`, `transpose`), lists (`\{1, 2, 3\}`, `\{(k, k^2) : k = 1, \dots, 10\}`; plain `[1, 2, 3]`, `[(k, k^2) : k = 1..10]`, `len`), sums and products (`\sum_{k=1}^{n} \frac{1}{k^2}`, `\prod_{k=1}^{n} k`; plain `sum(1/k^2, k, 1, n)`, `prod(k, k, 1, n)`), `n!`, `\binom{n}{k}` and `\nabla f(p)` (plain `grad(f, p)`). The export writes a sum out term by term at the sliders' values.

## 3D

Write `3d` and a `show` line with a z range; add `cube` for a box that is a cube whatever the ranges, or `box 1 x 2 x 0.6` for a box with its own lengths x : y : z. Surfaces are `plot s(x, y) = x^2 + y^2 for x from -2 to 2 and y from -2 to 2 in blue, opacity 0.7` (or `plot z = ...`); planes are `draw the plane z = h`; points, segments and text labels take `(x, y, z)`. In JSON: `"dimension": true`, surfaces in `functions3D`, points and segments with `"dim": 3`. Version 6 lines in 3D: arrows of 3D vectors, point lists, `draw the grid` (a grid cube), `draw the basis vectors` (with k̂), `transform space by B` (a 3 x 3 matrix or `(x, y, z) \mapsto ...`), `shade the unit cube`, spans, eigenvectors of a 3 x 3 matrix, and `draw the solution of $\dot{p} = (10(y - x), x(28 - z) - y, xy - \frac{8}{3}z)$ through (1, 1, 1) for t from 0 to 72, coloured by time` (the Lorenz attractor).

A surface in a colour is shaded by height: light at the bottom of the box, the full colour at the top. A colour map colours it by height instead, written like a colour: `plot z = x^2 - y^2 in viridis`. The maps: `viridis` (dark purple to yellow), `heat` (black, red, yellow, white), `cool` (white, blue, magenta), `diverging` (blue below z = 0, white at 0, red above), `rainbow` (dark blue, cyan, yellow, dark red), `greyscale` (black to white). The colours spread over the z range of the box (`diverging`: from -m to m, m the larger of |zmin| and |zmax|); a wireframe draws its lines in the map's colours. The map is a surface's own option: on anything else it is a problem. In JSON it is the surface field `colormap`: `"colormap": "viridis"`; without it the surface takes its `color`.

A filled surface draws mesh lines between its facets at 40 %. `mesh 0.2` makes them fainter, `mesh 1` draws them at full strength, and `mesh 0` draws a smooth surface without lines. The value is a number from 0 to 1 (anything else is a problem); a wireframe is only lines and ignores it. In JSON it is the surface field `meshOpacity`: `"meshOpacity": 0.2`; without it the lines are at 0.4. The grid (`with a grid`, `grid opacity 0.3`) lies on the floor and the back walls of the box, under the surfaces.

```easy-tikz
3d
cube
show x from -2 to 2, y from -2 to 2 and z from 0 to 8
slider h from 0 to 8, starting at 3
plot z = x^2 + y^2 for x from -2 to 2 and y from -2 to 2 in blue, opacity 0.7
draw the plane z = h in orange
```

## Recipes

| You want | Example id | How it is built |
| --- | --- | --- |
| A function with a slider, its tangent and its extrema | `tangent` | slider `a`; `plot f1(x) = ..., with its tangent at a and its extrema`; the slope in the title. |
| The area between a curve and its tangent | `tangent-area` | the tangent as a hidden function `f2`; `shade between f1 and f2 from x = ... to ...` from the touching point to the second crossing. |
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
| Arrows and braces | `arrows-braces` | `draw an arrow from (0, 0) to (3, 2)` and `draw a brace from (0, 0) to (4, 0)`. |
| A surface and a plane | `plane3d` | `3d`, a surface and `draw the plane z = h` on a slider. |

## The local AI server

When the user switches on **AI access** (in the editor's AI tab or the Easy Graphs Charts and TikZ settings), the plugin answers on `http://127.0.0.1:27150`. The port can be changed, so use the address the user gives you. Every request needs the token: the header `Authorization: Bearer <token>`, or `?token=<token>` at the end of the address for apps that cannot send headers. A POST must send its body as JSON with `Content-Type: application/json`. The AI tab shows ready-made connection lines for AI apps; agents that work in the vault can also read the token from the plugin's data file, `<config folder>/plugins/easy-tikz/data.json` (field `aiToken`; the config folder is usually `.obsidian`). The server only answers on this computer and refuses requests from web pages. It adds `easy-tikz` blocks to Markdown notes and replaces them, nothing else: never in hidden folders and never in files with instructions for AI agents (`AGENTS.md`, `CLAUDE.md`, `GEMINI.md`, ...). It computes one chart at a time and refuses charts over its limits (at most 50 functions, 50 shapes, 100 text labels, 10 surfaces, 200 levels per curve, 1000 listed points, 2000 characters per field, and functions that call each other so often that one point costs over 1000 evaluations). Obsidian shows a notice every time it writes, with Undo when it changed an existing note.

- **MCP:** `POST /mcp` (Streamable HTTP). AI apps that speak MCP get the tools below.
- **Plain HTTP:** `GET /guide` returns this guide, `GET /tools` lists the tools, and `POST /tools/<name>` with the arguments as a JSON body calls one. For example (with `PORT` and `TOKEN` from the user):

```bash
curl -s -X POST "http://127.0.0.1:PORT/tools/check_chart?token=TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"chart": "show x from 0 to 7 and y from -1.5 to 1.5\nplot f(x) = sin(x) in blue"}'
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

Every `chart` argument is the text of a block (a string; a fenced block is fine too), in words or in Full LaTeX, or a JSON object. `add_chart` writes the block in the form the user chose in the settings (text by default, in their chart language: text in the other form is written in theirs); `update_chart` keeps the form the chart has in the note (JSON, words or Full LaTeX), and for text it rewrites only the lines whose object changed.

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
