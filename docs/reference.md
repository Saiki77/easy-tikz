# Easy Graphs Charts and TikZ reference

[Overview](../README.md) · [What's new](whats-new.md) · [Guides](guides/README.md) · [AI guide](ai.md) · [Changelog](../CHANGELOG.md)

Everything the plugin does, by topic. The [guides](guides/README.md) show it step by step; the Help tab in the editor has the same guides with live charts and a reference you can search.

## The editor

1. Click the function icon in the ribbon (or run *Easy Graphs Charts and TikZ: Open editor* from the command palette).
2. The **Build** tab opens on "Start a chart". Type a formula such as `x^2 - 2x` and press Enter, or pick one of the six examples below the field.
3. Use **+ Add** for everything else: more functions, shaded regions, lines and curves, points, arrows, braces, text labels and sliders. The preview redraws as you type.
4. Adjust by hand: drag a line, curve, point or label in the preview and its numbers change so it follows the pointer; Shift-drag turns lines and stretches curves (see [Drag to edit](#drag-to-edit)). Drag empty space to pan, scroll to zoom.
5. **Insert into note** (Cmd/Ctrl+Enter). The plugin writes an `easy-tikz` code block and renders it inline.

Click a chart in your note to edit it again: the editor opens with every setting filled in, and **Save changes** replaces the block in place.

The editor has four tabs:

| Tab       | What is there                                                                                              |
| --------- | ---------------------------------------------------------------------------------------------------------- |
| **Build** | Everything you draw, as cards: functions (or surfaces in 3D), then shapes, points and labels.              |
| **Chart** | Ranges (formulas allowed), axes (their style, or **None** for no axes) and their numbers (Auto, Every a step, At chosen values, Off), axis variables, equal scale, grid and its opacity, export size, note width, 3D view. |
| **Code**  | The LaTeX, with a **Standalone document** switch. Hand edits are kept until you press Regenerate.          |
| **Help**  | Step-by-step [guides](guides/README.md) with live charts, the full reference with **Open example** buttons, and a link to What's new. |

Under the preview sits the **Sliders** dock (visible in every tab). The header switches between 2D / 3D and Cartesian / Polar; its "more" menu opens the examples and your saved templates.

**Fitting the ranges.** The first formula fits the ranges once, while they are still the defaults. **Fit ranges to the chart** in the preview's action pill (and **Auto-fit** in Chart, Ranges) fits them whenever you like: round ends on a nice step of about a twentieth of the span, holding everything the chart draws (functions and surfaces, points, computed ones too, labels, segments, arrows, and the regions and level curves that are bounded). 0 is taken in when it is near, a nearly symmetric range becomes symmetric, and a curve that runs off to an asymptote is cut at its 1st and 99th percentile. A function without a domain goes on forever, so x stays and y is fitted over it. Axes whose bounds are formulas (`2a`) are left alone, and fitting twice changes nothing.

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

**Full LaTeX.** The same chart can be written as LaTeX: `\begin{chart}`, one command per line with its options in `[ ]` before its argument in `{ }` as in pgfplots and TikZ, and `\end{chart}`. Formulas are LaTeX math without `$`:

```easy-tikz
\begin{chart}
\axis[xmin=0, xmax=5, ymin=0, ymax=4.5, axis lines=left]
\slider[min=0, max=15, start=6]{c}
\shade[numbered, constraint lines]{x + y \le 4, x + 3y \le 6, x \ge 0, y \ge 0}
\draw[red, dashed, label={$z = {c}$}]{2x + 3y = c}
\mark[corners, blue, label={({x}, {y})}]
\mark[max, large, label={x* = ({x:2}, {y:2})}]{2x + 3y}
\end{chart}
```

Chart settings go in `\axis[...]` with the names pgfplots gives them (`xmin`, `axis lines`, `grid`, `xtick distance`, `title`, `xlabel`, `width`); `\slider`, `\plot`, `\shade`, `\draw`, `\mark` and `\node` make the objects, with the options of the words (`red`, `dashed`, `label={...}`, `domain=0:4`, `tangent=a`). The setting **Chart language** (Words + LaTeX math, or Full LaTeX) decides how new charts are written: by the editor, the charts of formulas and the AI tools. Both forms are always read, a chart you edit keeps its form, and your own chart words apply to the words only. A problem names its line and column in the block, and a line no command knows is read as `\command[options]{rest}`, so no line is lost. The AI guide has the whole list: [ai.md](ai.md#full-latex).

## Chart words

Settings, Chart words, **Edit words** gives every piece of the chart language your own words. The pieces are grouped: lines (`show`, `plot`, `shade`, `draw`, `mark`, `write`, `slider`, `title`, ...), phrases (`from`, `to`, `and`, `where`, `the maximum of`, `the region`, `an arrow`, ...), options (`in` before a colour, `dashed`, `thick`, `numbered`, `with its tangent at`, `labelled`, ...) and colours.

- **Several words for one piece:** separate them with commas; the first is the one the plugin writes. Empty: only the built-in word.
- **The built-in words keep working** beside yours. A word can belong to one piece only, and never be a name formulas use (`sin`, `x`, `pi`); the window says when a word clashes.
- **One word for several options:** `objective` = `in red, dashed`, written like any option: `draw 2x + 3y = c, objective`.
- **Where words are read:** in the places their pieces go. A formula, a name the chart defines (a slider called `rot`), a function call (`rot(x)`), a title, a label in quotes and comment lines stay as typed.
- **What the plugin writes:** your words (setting **Write charts with**), or the built-in ones while yours are only read. Lines you did not change keep their words either way.
- **Changing a word later:** charts in your notes that used the old word are offered for rewriting (**Rewrite N charts**): only the changed words are replaced, each chart only when it stays exactly the same chart.
- **Sharing:** **Copy your words** gives them as text (`plot = graph`, `objective := in red, dashed`); paste such text into the box to take words over.
- **AI apps** get your words with the guide they read, so they can read your charts. They may write the built-in words, which always work.

Problem messages under a chart use the built-in words, and their columns point at what you typed.

## Make charts with AI

Describe the chart and let an AI build it. Easy Graphs Charts and TikZ hands the AI everything it needs, checks every chart with the plugin's own code, and the chart lands in your note, ready to drag and slide. Open the **AI** tab in the editor; it has three ways in:

- **AI apps on this computer** (Claude Code, Codex, Cursor, VS Code, Gemini CLI, Claude Desktop, LM Studio). Switch on **Let AI apps make charts** and copy the one line your app needs. The app then reads the chart guide, checks charts, looks at a picture of them and adds them to your notes by itself, through a small server that answers only on this computer ([how it works](ai.md#the-local-ai-server)).
- **AI chats** (ChatGPT, Claude, Gemini in the browser). **Copy the guide** into the chat, describe your chart, then **Paste the chart** the AI writes: it opens in the editor, checked. Blocks pasted straight into a note work too, also with the comments and trailing commas AI chats like to write.
- **AI agents in your vault folder.** **Add the section** puts a short Easy Graphs Charts and TikZ part into `AGENTS.md` and `CLAUDE.md`, which agents read on their own.

The guide the AI gets is [ai.md](ai.md); AIs write the text form, which reads like the math and is hard to get wrong. Then ask, for example: *"In this note, add a chart of the feasible region x + y <= 4, x + 3y <= 6, x >= 0, y >= 0, with the line 2x + 3y = c on a slider and the point where 2x + 3y is largest."*

## Plot

**2D.** Any formula in x. `^` is power, `sin`, `exp`, `ln`, `sqrt`, ... are bare names, `pi` and `e` are constants (`PI`, `E` and `Math.*` still work). You can leave out `*`: `2x`, `3(x + 1)`, `a x + b`. Each function card has a name (`f1`, `f2`, ...) that other formulas use: `f1(x - 1)`, `2 f1 + 1`, `f2 <= y <= f1`. Per function: legend (your own text or the formula typeset), fill to the x-axis (solid or pattern), dashed, thickness, tangent at a number, a slider or `min` / `max`, automatic extrema markers, parametric (`x(t), y(t)`), or polar (`r(θ)`) via the header switch. Drag empty space in the preview to pan (hold Space or use the middle mouse button to pan from on top of a shape) and scroll to zoom; the lock button switches both off, and axes whose bounds are formulas (`2a`) are left alone. A drag that starts on a shape edits it: see [Drag to edit](#drag-to-edit).

**3D.** Formulas in x and y. Wireframe or filled with adjustable opacity, planes, points, arrows and labels with a z position. Drag the preview to rotate (arrow keys for fine steps when it has focus) and use the zoom buttons in its corner. A plugin setting controls the maximum samples-per-axis slider (default cap 80, up to 120). A chart switched to 3D starts in a cube box; Chart, 3D view, **Box** switches to **Proportional**, the true proportions of the ranges, or to **Custom**, lengths of your own, x : y : z, such as 1 : 2 : 0.6 for a long box that still shows its heights (charts that are already 3D keep their box; in text, the lines `cube` and `box 1 x 2 x 0.6`; in Full LaTeX `cube` and `plot box ratio={1 2 0.6}`). The LaTeX export draws the same box. The box fills the chart as the view shows it, as in the PDF: a long box fills a wide chart, and while it turns it grows or shrinks so that it always fits. A surface is shaded light to dark in its colour, or by height with a colour map from the row **Colours by height**: Viridis, Heat, Cool, Diverging (white at z = 0), Rainbow or Greyscale (in text `in viridis`, like a colour). The LaTeX export draws the same colours. **Mesh lines** on the surface card fades the lines on a filled surface (0 %: smooth; `mesh 0.2` in text). The preview paints from far to near, so a solid surface hides what lies behind it, and draws the box as the PDF does: the outline and the back edges, with the numbers outside the box and the grid (Chart, Grid) on the floor and the back walls. **No axes** (6.2.1: Chart, Axes, Style **None**; `no axes` in text, `hide axis` in Full LaTeX) leaves out the box edges, tick marks, numbers and axis names: surfaces, planes, curves, points and labels stay, and the grid only when the chart asks for one (`with a grid`). The LaTeX export writes `hide axis`, or with a grid invisible axes, so the grid stays on the back walls.

```
sin(x)                       sin(x) exp(-x/5)              r = 1 + cos(θ)
x^3 - 3x                     1/(1 + x^2)                   (cos(t), sin(t))
sin(sqrt(x^2 + y^2))         exp(-(x^2 + y^2)/4)           x y
```

Two traps: `ax` is one name (write `a x` or `a*x`; the error offers **Use a\*x**), and `1/2x` is `(1/2)*x`. The Help tab lists every operator and function. For models in other letters, set **Axis variables** in Chart > Axes to `x1, x2` or `q, p`.

**LaTeX math (5.0).** A formula can also be written as in your notes, in LaTeX between dollars: `plot $f(x) = \frac{1}{2}x^2 - 2$ in blue`, `shade where $x + y \le 4$ and $x \ge 0$`, `plot $r(\theta) = 1 + \cos\theta$`. `\frac`, `\sqrt`, powers in braces, `\sin x`, `|x|`, `\cdot`, `\le`, `\ge`, `\pi` and Greek letters read as you expect. The plugin writes a LaTeX formula back in dollars and a plain one as it is. Drag to edit changes the numbers of plain formulas only.

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

Names are stable: functions are `f1, f2, ...`, tools `R1, C1, P1, S1, PL1, ...` (6.0 adds `V1` arrows, `LP1` point lists, `AX1` sets, `CH1` chords, `VF1` fields, `RP1` rest points, `TR1` solutions, `G1` grids, `BV1` basis vectors, `T1` transforms, `EV1` eigenvectors, `U1` unit squares, `SP1` spans, `OR1` orbits, `CW1` cobwebs, `BD1` bifurcation diagrams, `NM1` Newton's method, `CP1` coloured planes and `FC1` circles; a `let` line is named by its name), all renameable on the card, and a rename updates every formula and label placeholder that uses the name.

Guides: [Shade a region with inequalities](guides/regions.md), [Shade the areas between two curves](guides/areas-between.md), [Shade between a curve and its tangent](guides/tangent-area.md), [Points, intersections and live labels](guides/points-labels.md), [Segments, arrows and braces](guides/arrows-braces.md), [Calculate with computed points](guides/computed-values.md).

## Data, probability and calculus

Beyond functions, a 2D chart draws data, distributions, Riemann sums and slope fields, in the preview and in the LaTeX export alike. **+ Add** has them under their own headings; in text they are lines like any other ([AI guide](ai.md#the-text-syntax)).

**Data.** Put a Markdown table in the note and the chart block below it, with the line `use the table above`: the chart takes the first two columns of numbers as x and y (or `use the table above, columns hours and score`), and the headers name the axes when the chart has no axis names of its own. Rows with something that is not a number are left out, and a minus may be `−`. The chart reads the table where it is drawn (Reading view, Live Preview, the chart under a block you edit, and the editor opened from the block) and follows it a moment after you change it; the block keeps its one line, and **Save changes** never writes the rows into it. Points can be typed too: `data (1, 52), (2, 55), (3, 61)`. Draw the data with `mark the data`, `draw the data as bars`, `draw the data as a line`, and `draw its regression line, labelled` (the least-squares line with its equation and R²). The export writes the values the chart has at that moment, so the `.tex` file compiles on its own.

```easy-tikz
show x from 0 to 6 and y from 0 to 80
data (1, 52), (2, 55), (3, 61), (4, 60), (5, 68)
mark the data
draw its regression line in red, labelled
```

**Probability.** `plot the normal distribution with mean 0 and sd 1` draws the bell curve and `plot the binomial distribution with n = 10 and p = 0.4` its bars; the parameters may be sliders. `shade P(-1 <= X <= 1), labelled` shades the area under the curve (or colours the bars in range) and labels it with the probability, `P(-1 ≤ X ≤ 1) = 0.683`. The event may be written in LaTeX as in a note (`$P(X \le 2)$`), with `<`, `>` and `=` too, and its bounds may be sliders. A shade line is about the distribution its event names, else the nearest one above it.

```easy-tikz
show x from -4 to 4 and y from 0 to 0.5
slider a from 0 to 3, starting at 1
plot the normal distribution with mean 0 and sd 1, thick
shade P(-a <= X <= a), labelled
```

**Riemann sums.** `draw the left Riemann sum of f from 0 to 2 with 6 parts, labelled` draws the rectangles under a function of the chart (`right` and `middle` too, and `draw the trapezoid rule of f ...`), labelled with the sum and the integral. Put the number of parts on a slider and press play to watch the sum close in on the integral; **+ Add > Riemann sum** sets that up.

```easy-tikz
show x from -0.5 to 4.5 and y from -0.5 to 5.5
slider n from 1 to 40, starting at 6, in steps of 1
plot f(x) = x^2/4 + 1, thick
draw the left Riemann sum of f from 0 to 4 with n parts, labelled
```

**Slope fields.** `draw the slope field of $y' = x - y$` draws short segments with the slope at each point of a grid, all the same length on screen. `draw the solution through P` adds the solution through a point (`mark P at (1, 2)`): drag P in the editor's preview and the solution follows it.

```easy-tikz
show x from -3 to 3 and y from -3 to 3
draw the slope field of $y' = x - y$
mark P at (-2, 1), large
draw the solution through P
```

Each of these draws in 2D charts only; in a 3D chart its line shows a problem.

## Values: complex numbers, vectors, matrices and sums (6.0)

Every formula field takes more than numbers now: complex numbers, vectors, matrices and lists, plain or in LaTeX, with sliders inside all of them.

| LaTeX                                                        | Plain                                          | Meaning                                                    |
| ------------------------------------------------------------ | ---------------------------------------------- | ---------------------------------------------------------- |
| `\sum_{k=1}^{n} \frac{1}{k^2}`, `\prod_{k=1}^{n} k`          | `sum(1/k^2, k, 1, n)`, `prod(k, k, 1, n)`      | sums and products (bounds may be sliders, at most 100000 terms) |
| `n!`, `\binom{n}{k}`                                         | `factorial(n)`, `binom(n, k)`                  | factorial (the gamma function between whole numbers), binomial coefficient |
| `-0.8 + 0.156i`, `e^{i\theta}`, `\arg z`, `\bar z`, `\Re z`, `\Im z` | `abs(z)`, `arg(z)`, `conj(z)`, `re(z)`, `im(z)` | complex numbers and their parts                         |
| `\begin{pmatrix} 2 \\ 1 \end{pmatrix}`, `(2, 1)`             | `(2, 1)`                                       | a vector: `v + w`, `2v`, `v \cdot w`, `v \times w`, `v_x`  |
| `\begin{pmatrix} 1 & 2 \\ 3 & 4 \end{pmatrix}` (also `bmatrix`) | `[[1, 2], [3, 4]]`                          | a matrix: `A v`, `AB`, `A^{-1}`, `A^T`, `\det A`, `\operatorname{tr} A` |
| `\{(k, k^2) : k = 1, \dots, 10\}`, `\{1, 2, 3\}`             | `[(k, k^2) : k = 1..10]`, `[1, 2, 3]`          | a list                                                     |
| `\nabla f(p)`                                                | `grad(f, p)`                                   | the numeric gradient of a let function                     |

The modulus of a complex number and the length of a vector are `|z|` and `|v|`. More functions: `norm`, `dot`, `cross`, `inv`, `transpose`, `len`, `unit`, `angle(v, w)`. A real function of a real number stays real: `\sqrt{-4}` has no value, while `\sqrt{-4 + 0i}` is 2i. A field that needs a number (a function, a bound, a coordinate) takes a complex value whose imaginary part is 0; a vector there is a problem that says so ("This formula gives a vector of 2 numbers, not a number"). Problems name the place and the values: "Cannot multiply a 2 x 2 matrix by a vector of 3 numbers".

**Names: `let`.** A `let` line gives a value or a function a name that every formula of the chart can use, in any order:

```easy-tikz
show x from -3 to 3 and y from -3 to 3
equal scale
let v = (2, 1)
let w = (-1, 1.5)
let A = [[0, -1], [1, 0]]
draw v and w as arrows, labelled
draw v + w tip to tail in red, labelled
draw A v as an arrow in green, labelled
write "det A = {det(A)}" at (1.5, -2)
```

Also `let $c = -0.8 + 0.156i$`, `let $f(x, y) = x^2 + 4y^2$` (then `f(1, 2)`, `shade where $f(x, y) \le 4$`) and `let $R(\theta) = \begin{pmatrix} \cos\theta & -\sin\theta \\ \sin\theta & \cos\theta \end{pmatrix}$`. A function's body reads its parameters, sliders and the chart's names. A name is letters, digits and `_`, and never `x`, `y`, `z`, `t`, `theta`, a built-in, a slider or a function. Full LaTeX: `\let{v = (2, 1)}`.

**Arrows.** `draw v as an arrow`, `draw v and w as arrows, labelled`, `draw v as an arrow from (1, 1)` (or from a points tool, so a dragged point moves them) and `draw v + w tip to tail` (the terms end to end, then the sum). A vector is a let name, a formula (`A v`, `(1, 3)`) or a complex number. Options: a colour, `thin`, `thick`, `dashed`, `labelled` (`$\vec{v}$`, `$A \vec{v}$`), `labelled "text"`, `hidden`. 2D and 3D. Full LaTeX: `\draw[vector, labelled]{v, w}`, `\draw[vector, from={(1, 1)}]{v}`, `\draw[vector, tip to tail]{v + w}`. The export draws them as arrows (`\draw[->]`).

**Points of a list.** `mark the points $\{e^{2\pi i k / n} : k = 0, \dots, n - 1\}$, joined, labelled` marks the n-th roots of unity, joined into a polygon; `mark the points of S` marks a let list. Complex numbers are drawn at (re, im). Options: a colour, `small`, `large`, `thin`, `thick`, `joined`, `labelled`, `labelled "text"`, `hidden`. It publishes `LP1_n`, `LP1_x`, `LP1_y`, `LP1_x2`, ... Full LaTeX: `\mark[list, joined, labelled]{...}`.

**Sums in the export.** pgfplots has no sum, so the export writes a sum out term by term at the sliders' values, and the curve is exact. Complex numbers are written as their real and imaginary parts.

```easy-tikz
show x from -7.5 to 7.5 and y from -3 to 3
slider n from 0 to 12, starting at 4, in steps of 1
plot $\sin x$ in gray, thick
plot $T(x) = \sum_{k=0}^{n} \frac{(-1)^k x^{2k+1}}{(2k+1)!}$ in red, thick
```

## Sets on an axis and chords (6.0)

**A set on an axis.** `mark where $g(x) \le 0$ on the x-axis, labelled` draws the set of x where a condition holds as a bar on the x-axis, with its label in set notation: {x ∣ g(x) ≤ 0} = [−2, 2], with unions, single points, `∅` and `ℝ`.

```easy-tikz
show x from -5 to 5
plot $g(x) = x^2 - 4$ in blue, thick
mark where $g(x) \le 0$ on the x-axis, labelled
```

- The condition is anything a region takes, in one variable: `<`, `\le`, `>`, `\ge`, absolute values, chains (`0 \le x < 1`), `and`, `or`, an interval (`x \in [0, 1)`), or an equation (`g(x) = 0`: its zeros, as dots). `on the y-axis` takes a condition in y.
- A filled dot ends the bar where the end belongs to the set (`\le`, `\ge`), an open dot where it does not (`<`, `>`), and an arrow where the set runs off the view.
- Options: a colour (default teal), `thin`, `thick`, `labelled`, `labelled "text"`, `hidden`. It publishes `AX1_n` (the ends), `AX1_x`, `AX1_x2`, ... and `AX1_val` (the pieces).
- Full LaTeX: `\mark[x-axis, labelled]{g(x) \le 0}` (`y-axis`). The export draws the bar, the dots and the arrows; a label with ℝ adds `\usepackage{amssymb}`.

**A chord.** `draw the chord of g from -1 to 3` draws the segment from (a, g(a)) to (b, g(b)). `at $\lambda$` adds the point x = λa + (1 − λ)b on the chord and on the graph and the gap between them: Jensen's inequality, live on a slider.

```easy-tikz
slider lambda from 0 to 1, starting at 0.3
plot $g(x) = x^2/2 - 1$ in blue
draw the chord of g from -1 to 3 at $\lambda$, labelled
```

Options: a colour (default red), `thin`, `thick`, `dashed`, `labelled`, `labelled "text"` (with `{lambda}`, `{x}`, `{chord}`, `{graph}`, `{gap}`), `hidden`. It publishes `CH1_x`, `CH1_y` and `CH1_val` (the gap: at least 0 for every λ when g is convex). Full LaTeX: `\draw[chord, from=-1, to=3, at=\lambda, labelled]{g}`.

**y follows what is drawn.** A chart whose text gives x and no y (`show x from -5 to 5`) fits y to what it draws, live: when a slider moves, when x changes, when an object is added. Charts with a y range keep it; writing a y range (the Chart tab, a pan, a zoom, Fit) turns it off.

## Charts that move: steps, the clock, vector fields and systems (6.0)

**Steps.** `then` before a line starts the next step. Lines before the first `then` are step 1, and every later line stays in the step of the `then` above it. A `then` alone is a pause.

```easy-tikz
show x from -4 to 4 and y from -3 to 3
plot f(x) = sin(x) in blue
then plot g(x) = cos(x) in red
then mark (0, 1), with coordinates
```

- **In notes and the editor**, a chart with steps gets Previous, Play, Next and "Step k of n" in the strip under it (in the editor over the preview). It starts at its last step, as print and the PDF show it; Play starts at step 1 and goes through every step. New objects pop in, and a transform moves while its step comes in. Print hides the strip.
- **In the editor** each card has a Step row while the chart has steps, and the card menu's **Show in step n** puts an object in a new step. Every object also takes `step=3`.
- **In the PDF** the export shows the last step. The chart line `frames` (Full LaTeX: `\axis[frames]`) exports every step side by side, one picture per step. Full LaTeX for a step: `\then \plot[red]{g(x) = \cos x}`.

**The animation clock.** Objects that move by themselves (moving particles, turning circles, and the `traced` option of solutions and orbits, which draws the curve over time) run on a clock. A chart with one gets a Pause and Play button in its strip. The clock runs only while the chart is on screen and starts paused when your system asks for reduced motion. The export, print and the SVG files draw a still frame: time 0, or `set stillTime = 1.5`.

**Vector fields and rest points.** `draw the vector field $F(x, y) = (y, -\sin x - 0.25y)$` draws short arrows on a grid over the view, all the same length on screen. `mark the rest points of F, labelled` marks where F is zero: filled when stable, open when not, labelled stable node, unstable node, stable spiral, unstable spiral, saddle or centre.

```easy-tikz
show x from -6.3 to 6.3 and y from -4.2 to 4.2
draw the vector field $F(x, y) = (y, -\sin x - 0.25y)$, coloured by length, with moving particles
mark the rest points of F, labelled
```

Field options: a colour, `thin`, `thick`, `coloured by length` (viridis, or `coloured by length in heat`), `with moving particles` (450 particles leave fading trails over faint arrows; the export draws faint arrows and a few streamlines), with them `speed 2`, `300 particles`, `trails 0.9`, `width 1.4`, `arrows 0.025` or `no arrows`, `with streamlines` (still curves, also in the export), `density=30` (arrows across, 4 to 60), `hidden`. Rest points: a colour, `small`, `large`, `labelled`, `hidden`; they publish `RP1_n`, `RP1_x`, `RP1_y`, ... (at most 40). 2D charts only. Full LaTeX: `\vectorfield[colormap/viridis, particles, streamlines]{F(x, y) = ...}`, `\restpoints[labelled]{F}`.

**Solutions of systems.** `draw the solution of $\dot{p} = (y, -x)$ through P for t from 0 to 10` draws the solution through a points tool (drag P and it follows) or a point, by RK4. The right side has 2 formulas in a 2D chart and 3 in a 3D chart, in x, y (z) and t. In 3D it draws the Lorenz attractor:

```easy-tikz
3d
show x from -25 to 25, y from -30 to 30 and z from 0 to 50
draw the solution of $\dot{p} = (10(y - x), x(28 - z) - y, xy - \frac{8}{3}z)$ through (1, 1, 1) for t from 0 to 72, coloured by time
```

The left side may be `\dot{p} =`, `p' =`, `\frac{dp}{dt} =` or left out. Options: a colour, `thin`, `thick`, `dashed`, `coloured by time`, `traced`, `hidden`. At most 20000 steps (a longer range gets a coarser step and a note) and 3000 points drawn. Full LaTeX: `\solution[through=P, t=0:10]{\dot{p} = (y, -x)}`.

## Linear algebra and complex maps (6.0)

The grid moves, î and ĵ land on the columns of A, and the old grid stays faint:

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

In a note, step 1 shows the grid, î, ĵ and the unit square; Play moves them to A in 0.7 s, as (1 − t)I + tA; step 3 adds the eigenvectors.

| Line | What it draws | Full LaTeX |
| --- | --- | --- |
| `draw the grid`, `draw the grid from -2 to 2 in steps of 0.5` | The lines x = k·s and y = k·s that a transform moves; without a range it reaches twice as far as the view (at most 401 lines per direction). 3D: a grid cube. | `\draw[grid]`, `\draw[grid, from=-2, to=2, spacing=0.5]` |
| `draw the basis vectors` | î in green and ĵ in red (3D: k̂ in blue), with their names. | `\draw[basis vectors]` |
| `transform the plane by A` | Moves every object above it, but not the axes or text labels. The map is a matrix (a let name or a literal, sliders allowed), `$z \mapsto z^2$`, `$(x, y) \mapsto (x + y, y)$` or a let function. A map that bends lines cuts them into short pieces first. 3D: `transform space by B`. | `\transform{A}`, `\transform{z \mapsto z^2}` |
| `draw the eigenvectors of A, labelled` | The lines along the real eigenvectors with λ₁, λ₂; complex eigenvalues draw no line and say so. | `\draw[eigenvectors, labelled]{A}` |
| `shade the unit square, labelled` | The square [0, 1]², moved by the transforms below it, labelled with its signed area (`det A = 2.5`). `shade the image of the unit square` moves it by the transforms above it too; 3D: `shade the unit cube`. | `\shade[unit square, labelled]`, `\shade[unit square, image]` |
| `draw the span of v and w, labelled` | The plane (shaded), a line through 0, or 0: `span(v⃗, w⃗) = ℝ²`. | `\draw[span, labelled]{v, w}` |

**Drag the tips.** In the editor, the tips of î and ĵ are drag handles when one matrix moves them all the way: dragging them writes the columns of the matrix, when every entry is a plain number. Arrows of let vectors written as numbers (`let v = (2, 1)`) have handles at their tips too. Undo, Escape and Alt (one more decimal) work as for other drags.

**The export** draws everything at the last step, as coordinates, with the faint grid at 35 % opacity.

## Iterate and colour the plane (6.0)

After the formula, the pieces between commas are the start (`$z_0 = 0$`), the names the recurrence reads (`$c = P$`), the steps (`40 steps`) and the options, in any order. A start or a name may be a formula, a point or a points tool, so dragging P moves the picture.

```easy-tikz
show x from -2.4 to 1 and y from -1.15 to 1.15
equal scale
colour the plane by $z_{n+1} = z_n^2 + c$, $z_0 = 0$, $c = x + iy$, 200 steps
mark P at (-0.12, 0.75), large
draw the orbit of $z_{n+1} = z_n^2 + c$, $z_0 = 0$, $c = P$, 40 steps, as a path
```

| Line | What it draws | Full LaTeX |
| --- | --- | --- |
| `draw the orbit of $z_{n+1} = z_n^2 + c$, $z_0 = 0$, $c = P$, 40 steps` | The points z₀, z₁, ... joined by a line. Complex numbers and vectors are points of the plane; numbers are drawn as (n, xₙ). Gradient descent: `draw the orbit of $p_{n+1} = p_n - \eta \nabla f(p_n)$, $p_0 = P$, 25 steps`. Options `as a path`, `labelled`, `traced`. | `\orbit[z_0=0, c=P, steps=40]{z_{n+1} = z_n^2 + c}` |
| `draw the cobweb of $x_{n+1} = f(x_n)$ from 0.2, 80 steps` | The line y = x, the graph of the map, and the path of the orbit between them. | `\cobweb[from=0.2, steps=80]{x_{n+1} = f(x_n)}` |
| `draw the bifurcation diagram of $x_{n+1} = r x_n (1 - x_n)$ for r from 2.5 to 4` | For each r, where the orbit settles: 400 steps run in, the next 300 drawn as dots. | `\bifurcation[r=2.5:4]{x_{n+1} = r x_n (1 - x_n)}` |
| `draw Newton's method for f from 2.5, 5 steps, labelled` | Each tangent down to the x-axis and the line up to the graph, for a function of the chart. | `\newton[from=2.5, steps=5, labelled]{f}` |
| `colour the plane by $z_{n+1} = z_n^2 + c$, $z_0 = 0$, $c = x + iy$, 200 steps` | Escape time: the Mandelbrot set (`c = x + iy`), Julia sets (`z_0 = x + iy`, `c = a + bi`), Newton basins (orbits that settle take the colour of the point they reach). | `\colourplane[z_0=0, c=x + iy, steps=200]{...}` |
| `colour the plane by $f(z) = \frac{z^2 - 1}{z^2 + 1}$` | Domain colouring: the hue is the angle of f(z), zeros dark, poles white. | `\colourplane{f(z) = ...}` |
| `colour the plane by $f(x, y) = \sin x \cos y$, in viridis` | A heat map from the lowest value in the view to the highest. | `\colourplane[colormap/viridis]{f(x, y) = ...}` |
| `draw the circles of $\sum_{k=1}^{n} \frac{4}{\pi (2k - 1)} e^{i(2k - 1)t}$, with its wave` | Turning circles, each term of the sum on the tip of the one before, on the chart's clock, and the wave they draw. | `\circles[wave]{\sum_{k=1}^{n} ...}` |

- **Colour maps** of a coloured plane: `cyclic` (the default for fractals), `viridis`, `heat`, `cool`, `diverging`, `rainbow`, `greyscale`; also `opacity 0.5`. `color the plane by` works too. The plane lies under the grid and everything else.
- **On screen** the GPU paints a coloured plane at once, and the sliders move it live. Without WebGL, for a formula with no GPU form, or deep in a zoom, the CPU paints it with 64-bit numbers: a coarse picture first, then the full one in tiles, so typing never waits.
- **In the export** a coloured plane and a bifurcation diagram are a PNG beside the `.tex` file, drawn with `\addplot graphics` over exactly the view; the axes and the labels stay vector. **Copy LaTeX** saves the PNG in the note's attachment folder and says where. The SVG files and Copy SVG / PNG hold the picture in the file.
- **2D only:** in a 3D chart these lines draw nothing.
- **Limits**, so that no chart freezes a phone: 2000 steps of an orbit, 1000 of a cobweb, 100 of Newton's method, 1000 per pixel of a coloured plane, 60 terms of turning circles. A larger count is drawn at the limit, with a note.

## Ask the curve (6.0)

Click a curve in the editor's preview, or in the chart under a block in Live Preview: a menu of questions about it opens. Point at a question and its answer shows faintly in the chart; choose it and the answer is added as a line of the chart (in the editor with Undo, under a block in the block's text). A question whose answer is already in the chart is ticked, and choosing it takes the answer away. A click that moves (a pan, a drag) asks nothing. From the keyboard: `?`, the menu key or Shift+F10 in the editor's preview, Enter on a chart under a block; arrow keys, Home and End move in the menu, Escape closes it.

| Clicked | Questions |
| --- | --- |
| a function f | where f ≤ 0, ≥ 0, < 0, > 0 and where it crosses the x-axis (a set on the x-axis); its maxima and minima; its inflection points; the tangent and the value here; a chord from here with a slider λ; the area to the x-axis; a Riemann sum; for each other function g: where f and g cross, where f ≤ g, the area between them; Newton's method and the cobweb from here |
| a region | its corners, its border, the lines of its conditions, its highest, lowest, rightmost and leftmost point |
| a curve | where it crosses the axes, each function and each other curve |
| a point | lines to the axes, its coordinates |
| a transform or the grid | the eigenvectors, the image of the unit square with det, the span of the columns, the inverse in the next step, a function it moves; a shear in the next step |
| an arrow of a let vector | its span, the span with another vector, the sum tip to tail, A v for each let matrix |

The menu is built from what the chart holds, so it grows with the chart.

## Sliders and live values

A slider is a named number you can use anywhere: in formulas, domains, region conditions, point lists, labels and axis ranges (`xmax = 2a`).

- **Create one** with **Add slider** in the dock, with + Add > Slider, or with the **Add slider k** fix that appears under any field using an unknown name.
- **Drag it and the picture follows while you drag**: the preview redraws on the next animation frame, then once more at full quality 150 ms after you stop. Expressions are compiled once and read slider values at call time, and each tool is recomputed only when a slider it uses changes.
- **Play** sweeps a slider between its minimum and maximum. Type a value outside the range and the range widens.
- **Computed values.** Every points tool publishes its results under its name: `P1_x`, `P1_y` (`P1_z` in 3D), `P1_val` (objective value), `P1_n` (count), and `P1_x2`, `P1_y2`, ... for later points. Any field can use them, and they update live: a line `2x + 3y = P1_val` through the optimum, a region bounded by `P1_y`, a tangent at `P1_x`.
- **Label templates.** Every text (title, text labels, region, condition, curve, point and segment labels) can show values: `{c}` (up to 3 decimals), `{P1_val:1}` (1 decimal). Points add `{x}`, `{y}`, `{z}`, `{val}` and `{i}`; curves add `{level}`. `$...$` is LaTeX math.
- **Connected sliders (5.0).** `slider a from 0 to 2, connected` in two charts of one note: moving `a` in one chart moves `a` in the other, as long as both are connected. The link button at the end of a slider row in the note (shown when another chart of the note has a slider of that name) switches it on or off and writes it into the block; in the editor it is **Connect with others** in the slider's options. Like every slider in a note, it never changes the note itself.
- **In your notes** the chart shows its sliders underneath (up to three rows, then "Show N more", plus a reset button). Moving them changes the picture for the current session only and never edits the note. Switch them off in Chart > In your note.

Guides: [Sliders that move the picture](guides/sliders.md), [Animate a chart with play](guides/animate-play.md), [From secant to tangent](guides/secant-tangent.md), [An area that grows with a slider](guides/area-accumulation.md), [Calculate with computed points](guides/computed-values.md).

## Drag to edit

In the editor's 2D preview, drag a line, curve, point or text label, and Easy Graphs Charts and TikZ rewrites the numbers in its formula so that the part you grabbed follows the pointer. Only numbers and their signs are rewritten (your spacing, `*` and `≤` stay as typed), and the card and the Sliders dock update while you drag. The film in [What's new](whats-new.md#40-drag-to-edit-live-sliders-a-new-editor) shows a drag and a Shift-turn on the Linear program example.

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

The plugin registers an `easy-tikz` markdown code-block processor. **Insert into note** writes a text block ([Charts as text](#charts-as-text); JSON if you choose it in the settings); the same renderers that power the editor preview draw the chart in your note, and a chart with sliders gets its own slider strip underneath. Click the rendered chart to re-open the editor pre-filled with every setting: change something, **Save changes**, and the block in the source file is updated in place (a text block line by line, keeping your comments). Hover the chart for alignment and width controls. If something in the chart cannot be drawn, a muted line under the chart names the problem, with its line and column in a text block; the rest of the chart still renders. When a block changes, its chart glides from the old picture to the new one and new objects pop in (setting **Animate chart changes**; never with reduced motion). While you edit a block in Live Preview, its chart sits right under the lines and changes as you type; when the cursor leaves, Obsidian's own chart takes over in the same frame (setting **Chart under the block while you edit**). A click on a curve of that chart asks its questions ([Ask the curve](#ask-the-curve-60)). A chart with steps has Previous, Play and Next in its strip, and a chart with moving objects a Pause button ([Charts that move](#charts-that-move-steps-the-clock-vector-fields-and-systems-60)).

Guide: [Charts in your notes](guides/charts-in-notes.md).

## Every formula is a chart

Rest the pointer on a formula in a note, `$...$` or `$$...$$`, in Reading view or Live Preview (also in lists, callouts and tables), and a card opens next to it: the formula, what it is (function, surface, polar curve, curve, region), its chart and a slider for each letter (`a`, `b`, `k`). On a phone, tap the formula. **Insert chart** writes the chart as a block under the paragraph; **Open in the editor** opens it to change first. In the editor, the command **Plot the formula at the cursor** and the right-click item **Plot this formula** do the same.

- `y = ax^2 + b` and `f(x) = \frac{1}{2}x^2` are functions, `z = x^2 - y^2` is a surface (3D), `r = 1 + \cos\theta` a polar curve, `x^2 + y^2 = 4` a curve, `x + y \le 4` a region. A surface is seen from elevation 25° and azimuth 30°, so a ridge such as `\max(x_1, x_2)` shows its height, and a formula in x_1 and x_2 names its axes x₁ and x₂ (6.2.1).
- **Formula recognition** decides which formulas have a card: Smart (default) or Rules (see [Plugin settings](#plugin-settings)).
- **Charts for formulas** switches the card off. **Highlight formulas in notes** (on by default) draws a dotted line under each formula that has a chart and tints it under the pointer; switched off, formulas look as usual and their chart still opens. **Sliders in formula charts** leaves out the sliders.
- **Default chart for formulas:** **Edit** opens the editor on a sample formula chart; set it up as you like (axes or no axes, grid, numbers, size, the line) and click **Save as default**. Every formula card and every inserted chart then has this look. **Reset** goes back to the built-in look.
- **Default 3D chart for formulas** (6.2.1): the same for 3D charts, such as the surface of `$f(x, y) = x^2 + y^2$`. **Edit** opens the editor on a sample surface; set the box (Cube, Proportional or Custom), the colours by height or a colour of its own, the mesh lines, the opacity, the view (elevation, azimuth, zoom), axes or no axes and the grid, and click **Save as 3D default**. Every 3D card, **Insert chart** and **Plot the formula at the cursor** then use it. Until you save one, 3D charts take the axes, grid and numbers of the default chart for formulas (as before 6.2.1); **Reset** goes back to that.
- **More cards (6.0).** Sets (`\{x \in \mathbb{R}^n \mid g(x) \le 0\}`, `\{(x, y) \mid ...\}`) show the set on the x-axis or the region; maps (`g: \mathbb{R}^n \to \mathbb{R}`) the graph, for n = 2 its level curves; conditions in one variable (`g(x) \le 0`, `x > 0`) and intervals (`\lambda \in [0, 1]`, `(a, b]`) the set on an axis; Jensen's inequality the chord of g with a slider λ; the epigraph `\operatorname{epi} g` the shade above the graph. A matrix, `A v`, `\det A` and `A v = \lambda v` show the grid moving with a slider s; `z_{n+1} = z_n^2 + c` the orbit of 0 with c on sliders; `x_{n+1} = r x_n (1 - x_n)` its cobweb; a sum `\sum_{k=1}^{n} ...` the partial sum with a slider n; `f(z) = ...` its domain colouring.
- **Names from the note.** A name a formula uses without defining it (g, A, v) comes from the other formulas of the same note (`g(x) = x^2 - 4`, `A = \begin{pmatrix} ... \end{pmatrix}`). When the note has none, the card uses an example and says so. Formulas in ℝⁿ get an n = 1 / n = 2 switch.
- **Charts from formulas** keep the note's name of a function (`$g(x) = x^2 - 4$` becomes `plot $g(x) = x^2 - 4$`) and write the x range only, so y follows what is drawn.

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
- **Steps and motion (6.0):** the export draws the last step, and with the line `frames` every step side by side. Moving objects are drawn at their still frame. Sums are written out term by term.
- **Pictures (6.0):** a coloured plane or a bifurcation diagram is a PNG beside the `.tex` file (`ddplot graphics`); Copy LaTeX saves it in the note's attachment folder.

The editor's **Copy SVG** and **Copy PNG** buttons serialize the live preview with theme colours already resolved.

**Charts as SVG files (5.0).** With the setting **Charts as SVG files** on, every chart of a note also lives as an SVG file in your attachment folder, named after the note (`Week 3 · chart 1.svg`, numbered from the top), with a white background and the light theme's colours. The files follow the note: a short time after a change, the plugin writes the files whose picture changed, with the sliders at their saved values. Obsidian Publish, GitHub and other apps show such a file where the plugin does not run: embed it with `![[Week 3 · chart 1.svg]]`. The command **Save the charts of this note as SVG files** writes them at once, also with the setting off. The plugin never deletes a file.

Guide: [Export to LaTeX](guides/export-latex.md) (standalone document or snippet, the size on paper, colours and label text, what the export freezes, hand edits).

## Plugin settings

Settings → Community plugins → **Easy Graphs Charts and TikZ**:

- **Interface language.** Follow Obsidian (default), English or 日本語: menus, buttons, settings, messages and the guides in the Help tab. A language Easy Graphs Charts and TikZ does not have yet shows in English. Formulas, the chart language and the exported code stay as they are; command names change after Obsidian restarts.
- **Write new charts as.** Text (default, one line per object in words) or JSON. A chart you edit keeps the form its block has.
- **Chart colours.** From your theme (default: native colours that follow light and dark mode) or As in the LaTeX export (the fixed colours of the PDF). CSS snippets can set `--etz-red`, `--etz-blue`, ... directly.
- **Chart look.** Clean (default) or Classic. Clean: axes through the middle without arrowheads, thin and light grey (an axis whose 0 is outside the view lies at the near edge), a light grid, small grey numbers without the 0 at the origin and out of the way of marked points and curves, no axis letters x and y unless the chart names its axes, slightly thicker curves, dots for extrema without min and max, and values the plugin writes (`labelled`) in soft pills. Classic: the look of version 6.0. The LaTeX export draws the look you choose. A chart that sets its own look keeps it: `axes in a box` draws it wholly as Classic, and `axes on the edges`, `axes in the middle`, `with a grid`, `no grid`, `grid opacity`, axis names and line thicknesses win over the look. Polar and 3D charts keep their own look. JSON blocks written before 6.1 store every default; there `"axis_style": "box"`, `"showLargeGrid": false` and `"thickness": "thin"` count as left open. CSS snippets can set `--etz-clean-grid`, `--etz-clean-axis`, `--etz-clean-tick` and `--etz-clean-pill-line`.
- **Axis lines, Axis arrows, Axis names, Axis numbers** (6.2.1), under **Chart look**. Each changes one thing of the axes of either look, and each is **As the look** by default (Clean: thin lines, no arrowheads, only names the chart gives, small numbers; Classic: thick lines, arrowheads, x and y always, large numbers). **Axis lines:** Thin (the clean look's light grey line) or Thick (Classic's darker, wider line; in the export pgfplots' own). **Axis arrows:** With or Without arrowheads at the ends of axes through the middle or on the edges (axes in a box never have them). **Axis names:** Always (x and y, unless the chart names its axes otherwise) or Only when the chart names them. **Axis numbers:** Small (`\scriptsize`, 7 pt) or Large (10 pt). They apply to every chart in the note, the editor, the formula cards, Copy SVG and Copy PNG and the LaTeX export, also to a chart in a box and a polar chart. In 3D they set the edges of the box (Thin: the light grey), the names x, y and z and the size of the numbers; arrows do not apply. With small numbers Classic keeps the steps of its numbers (pgfplots picks them whatever their size); Clean gives large numbers wider steps, in the note and the PDF alike. One chart can choose its own in the editor's **Chart** tab, under Axes (**As the default** follows these settings), or with a line of its text: `thin axes` or `thick axes`, `axes with arrows` or `axes without arrows`, `with axis names` (x and y too) or `no axis letters` (only names the chart gives), `small numbers` or `large numbers`; in Full LaTeX the same words go into `\axis[...]`, such as `\axis[thick axes, axes with arrows, small numbers]`. What a chart chooses wins over these settings, which win over the look; its own axis names (`xlabel`, `ylabel`) and the Axis labels switch (off: no names at all) stay as they are.
- **Chart under the block while you edit.** On by default: in Live Preview, a block you are editing shows its chart right under its lines, changing as you type.
- **Animate chart changes.** On by default: when a block changes, values glide and new objects pop in. Charts never move when your system asks for reduced motion.
- **Invert vertical drag in 3D.** Trackball convention by default (drag down tilts the scene up); flip for direct manipulation (camera follows finger).
- **Max 3D samples per axis.** Upper bound of the per-surface Samples slider. Default 80, at most 120. The export always uses at most 60 samples per axis, because pdflatex runs out of memory above that.
- **2D pan sensitivity.** Default 1.0 (direct: 1 mouse pixel = 1 chart pixel), from 0.1 to 2.0.
- **Also render plain `tikz` blocks.** Off by default; on if you want one tag for everything (conflicts with obsidian-tikzjax).
- **Charts for formulas**, **Highlight formulas in notes**, **Sliders in formula charts**, **Default chart for formulas** and **Default 3D chart for formulas**: see [Every formula is a chart](#every-formula-is-a-chart).
- **Formula recognition** (6.2). Which formulas of a note open a card, and which kind. **Smart** (default): a small network, all of its weights written by hand, reads each formula with the words around it, the name of the note and the note's other formulas. Notation gets no card and no dotted line (`\frac{1}{m-1}` in a statistics sentence, `y = +1` as a class label, `\lVert w\rVert`), and formulas the checks of 6.1 missed get theirs (`x(t) = x_0 e^{at}` is a curve in t). It decides the kind; the card is drawn by the same builders as before, and when that builder cannot draw the formula, the formula gets the card of the 6.1 checks, if they have one. **Rules**: exactly the checks of version 6.1, which chart every formula they can draw. Changing it marks the open notes anew.
- **Charts as SVG files.** Off by default: see [Export](#export).
- **Show what's new after updates.** On by default. After an update that brings something new, a short popup shows what changed, once. The command **Show what's new in Easy Graphs Charts and TikZ 6** and the link in the Help tab open it at any time.
- **AI access** (on a computer; phones and tablets show only the guide and the agents' section). **Let AI apps make charts** (off by default) starts the local AI server; below it: its status, the **Port** (default 27150), the **Token** with **Copy** and **New token**, **Connect an AI app** with the line each app needs, **Tell AI agents in this vault** and **Copy the guide for AI chats**. The editor's **AI** tab has the same switch.

## Live rendering, briefly

The preview is drawn in-process by a small custom pipeline (no shell-out, no LaTeX compile, no image round-trip), which is what lets sliders and the camera follow the cursor without lag. Expressions are parsed once and compiled into plain closures (no `eval`, no `Function`); sliders are read when the closure runs, so dragging one never recompiles anything. Regions, curves and points are memoised per tool and keyed by the sliders and names they use: dragging the objective slider `c` recomputes the objective line, not the feasible region. While a slider moves, the 2D preview draws at draft resolution on every animation frame and redraws at full quality once you stop. Drag to edit rides on the same loop: each pointer event solves for the new numbers, rewrites the text and requests a draft frame.

A typical 3D surface (samples=40, 1,600 quads) sits at ~60 fps; the slider's upper end (samples=120, 14,400 quads) settles above 30 fps. Sampled surface data is cached per surface, keyed by expression, domain, sample count, z-range and the sliders the surface uses, so a pure camera change (rotation, zoom) re-projects from the cache without re-evaluating the function.

## Privacy and permissions

- **Clipboard:** writes TikZ code / SVG / PNG on the *Copy …* buttons, the text of a "type" row when you press **Copy** in a guide, the AI guide, connection lines and token when you press their **Copy** buttons in the AI tab or the settings, and your chart words when you press **Copy your words**. It reads the clipboard only when you press **Paste the chart** in the AI tab.
- **Active note:** inserts an `easy-tikz` block on **Insert into note** or a formula's **Insert chart** (under its paragraph), replaces an existing block when saving from click-to-edit, updates `displayWidth` / `displayAlign` when you use a chart's width or alignment controls, and adds or removes `connected` on a slider line when you press its link button. Inline sliders never write to the note.
- **Pictures of coloured planes, on Copy LaTeX:** when the code you copy draws a coloured plane or a bifurcation diagram, the plugin saves its PNG (`plane-<hash>.png`) in the note's attachment folder and says where. The same picture keeps the same name.
- **SVG files, on request:** with **Charts as SVG files** switched on (off by default), or with the command **Save the charts of this note as SVG files**, the plugin writes one SVG file per chart into your attachment folder, named after the note, and rewrites a file only when its picture changed. It never deletes a file.
- **Plugin data:** the [plugin settings](#plugin-settings) (with the AI access token), your saved function templates, the state of the **Edit shapes by dragging** switch (and that its first-use tip was shown), which version of the What's new popup was shown and, while the editor is open, an autosaved draft of the chart (cleared when you insert or save).
- **Notes with charts, after you change your chart words:** the plugin looks through the notes that hold `easy-tikz` blocks for charts that used a word you changed. Only when you agree (**Rewrite N charts**) does it rewrite those lines in your new words, each chart only when it stays exactly the same chart.
- **Your notes, read only:** when the plugin starts without any stored data and What's new is switched on, it looks through your notes for an `easy-tikz` block and stops at the first one. A 3.x user who never changed a setting has charts but no stored data, and this tells such an update from a new install. It runs once, since its answer is stored, and it never writes to a note.
- **Network:** nothing goes to the internet, with one exception you choose: the last slide of What's new plays the 6.0 film from YouTube (`youtube-nocookie.com`, YouTube's privacy-enhanced mode) when you press **Play**, and nothing of it loads before that click; **Open on YouTube** opens the film in your browser. The guides in the Help tab are part of the plugin and their charts are drawn locally; each guide has a link to its page on GitHub, which opens in your browser only when you click it. With **Let AI apps make charts** switched on (off by default), the plugin answers HTTP on `127.0.0.1` at the port you choose, which only programs on this computer can reach. Every request needs the token from the settings, and a POST must carry JSON; requests from web pages (with an `Origin` header) and for other host names are refused. It serves the AI guide, checks and draws charts one at a time (charts over its size limits are refused before anything is computed), and adds `easy-tikz` blocks to Markdown notes (at the end, below a heading, or in place of a placeholder line) or replaces them, nothing else: never in hidden folders and never in instruction files for AI agents such as `AGENTS.md` or `CLAUDE.md`. A new note is only made when the AI asks for it. Each change shows a notice, with **Undo** when an existing note changed.
- **Vault root, on request:** **Tell AI agents in this vault** adds or updates a marked Easy Graphs Charts and TikZ section in `AGENTS.md` and `CLAUDE.md` at the top of the vault (creating them if needed). It never touches the rest of those files.
- **Telemetry:** none.
- **Math evaluation:** user expressions are parsed by a built-in parser and compiled into closures; no dynamically generated code runs. Nothing is persisted or transmitted.
