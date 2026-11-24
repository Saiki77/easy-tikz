# 6.0 G: GeoGebra commands

Working material for the integrator (docs/reference.md, docs/ai.md, the Help guides). Code: `src/geogebra/`; small blocks marked `// 6.0 G` in the shared files. Tests: `tests/geogebra-commands.test.ts`, `geogebra-text`, `geogebra-scene`, and the `geogebra-*` charts of `tests/latex.test.ts`. Help guide: `geogebra-commands` (Chart language, en + ja). Examples: `geogebra-construction`, `geogebra-mandelbrot` (src/guides/examples.ts). AI guide: **GeoGebra commands** in The text syntax, `\geogebra` in Full LaTeX, `#### geogebra` in Fields.

## Commands in every formula field

GeoGebra's names, argument orders, 1-based positions and list braces, plain and in `$...$` (in LaTeX, lists are `\{...\}`). They compile into part A's value engine (`geogebraCall` in `src/values/compile.ts`, after the chart's own names); a formula without them compiles as before.

| Command | Value |
| --- | --- |
| `Sequence(expr, k, a, b[, step])`, `Sequence(n)` | a list (at most 100000 items) |
| `IterationList(expr, z, {start}, n)`, `IterationList(expr, a, b, {s1, s2}, n)`, `IterationList(f, start, n)` | the start and n steps (n + 1 items for one variable) |
| `Iteration(...)` | the last item of the same |
| `KeepIf(condition, list)` (the items are `x`), `KeepIf(condition, var, list)`, `CountIf(...)` | the items where the condition holds, their count |
| `Element(list, i)`, `Element(M, i, j)`, `Element(list, i, j)` | 1-based; past the end: no value |
| `Zip(expr, var1, list1, var2, list2, ...)` | as long as the shortest list |
| `Sum(list[, n])`, `Product(list[, n])`, `Sum(expr, k, a, b)` | of numbers, complex numbers, points or matrices |
| `Length`, `First(list[, n])`, `Last`, `Append(list, x)`, `Append(x, list)`, `Join(l1, l2, ...)`, `Join(list of lists)`, `Reverse`, `Sort`, `Unique`, `Flatten`, `Take(list, m[, n])`, `Max`, `Min`, `Mean` | as GeoGebra (`First(list)` is a list of one, `Length(v)` of a vector is its length) |
| `If(c, a[, b])`, `If(c1, a1, c2, a2, ..., else)` | no `else`: no value |
| `x(P)`, `y(P)`, `z(P)`, `abs`, `arg`, `conjugate`, `real`, `imaginary`, `sgn` | of points, complex numbers and lists of them; `x(x + 1)` stays a product |
| `Vector(A, B)`, `Vector(P)`, `UnitVector`, `Dot`, `Cross`, `Midpoint`, `Distance`, `Point({x, y})` | vectors and points |
| `Determinant`, `Transpose`, `Invert` | matrices |
| `Root(f, a)`, `Root(f, a, b)`, `Integral(f, a, b)`, `Derivative(f[, n])` | numeric: Newton from a, bisection in [a, b], Simpson with 2000 steps, central differences at the field's x (orders 1 to 3). f is a function's name or a formula in x |
| `Translate(P, v)`, `Rotate(P, angle[, C])`, `Dilate(P, k[, C])`, `Reflect(P, Q)` | of points and lists of points (of objects: on their own line) |

Lists: `{1, 2, 3}`, matrices `{{1, 2}, {3, 4}}` (rows of different lengths are a list of lists). `ί` (GeoGebra's imaginary unit) and `i` are both i, `ℯ` is e. A start point of `IterationList` in a formula of complex numbers (`z^3` of a point) is the complex number x + iy. Problems say how a command is written: "Sequence is written Sequence(<expression>, <variable>, <from>, <to>[, <step>]) or Sequence(<n>)".

## GeoGebra lines as chart lines

| Line | Draws |
| --- | --- |
| `A = (1, 2)`, `A = (1, 2, 3)` (3D), `z_1 = 1 + 2ί` | a point; free (numbers only) blue, dependent black, with its name (`$A$`, `$Z_{0}$`) |
| `u = (3, 1)` (a lower case name) | a vector: an arrow from the origin |
| `c = Circle(M, r)`, `Circle(M, P)`, `Circle(A, B, C)` | a circle (black) |
| `Segment(A, B)`, `Line(A, B)`, `Ray(A, B)`, `Vector(A, B)` | segment; line cut to the view; ray; arrow |
| `Polygon(A, B, C, ...)`, `Polygon(list)`, `Polygon(A, B, n)`, `Polyline(...)` | brown polygon with fill 0.1; regular polygon; open polyline |
| `C = Curve(x(t), y(t), t, a, b)` (also 3 formulas in 3D) | a curve, 400 steps |
| `f = x^2 - 2`, `g = Derivative(f)`, `h = Function(f, 0, 2)` | graphs of functions of x over the view (or [a, b]) |
| `L = Sequence(...)`, a list of points or complex numbers | dots (small for more than 100 points), black |
| `M = {{1, 2}, {3, 4}}`, `n = 5` | nothing (a value) |
| `T = Text("d = " + Distance(A, B), P)` | a text at P (top left without one); values with 2 decimals |
| `Translate(obj, v)`, `Rotate(obj, angle[, C])`, `Dilate(obj, k[, C])`, `Reflect(obj, P)`, `Reflect(obj, line)` | the moved object; nested commands work: `Reflect(p, Line(A, B))` |
| `a = Slider(0, 5)`, `a = Slider(0, 5, 0.5)` | a slider of the chart (starts at its low end; moved, it prints `a = Slider(0, 5), starting at 2`) |
| `IterationList(z^2 + c, z, {0 + 0ί}, 20)` (no name) | the same, named G1, G2, ... (no label) |

- **Values are definitions.** A named value (point, number, list, matrix) or function of x is a definition of the chart, as a let name: every formula reads it (`plot g(x) = x(A) x`, `mark the points of L`, `{x(A)}` in a label). Objects (circles, segments, ...) are not values; transforms and `Reflect(p, l)` read them by name.
- **Prints back as written.** The line keeps its text; options go after it: `c = Circle(A, 3) in red, dashed`. Options: a colour, `thin`, `thick`, `dashed`, `small`, `large`, `opacity 0.3` (fill of a polygon or circle), `labelled` (the name), `no label`, `labelled "text"`, `hidden` (a hidden value is still usable).
- **Full LaTeX:** `\geogebra[red, dashed]{c = Circle(A, 3)}`, `\geogebra{IterationList(z^2 + c, z, {0}, 20)}`.
- **Data:** tool type `geogebra`: `command`, `named` (false: a bare command), `color` (`''`: GeoGebra's), `thickness` (`''`: thick), `dashed`, `size` (`''`), `fillOpacity` (-1: GeoGebra's), `nameLabel` (`auto`, `shown`, `hidden`), `label`. Sliders: a parameter with `geogebra: true`. Prefix G.
- **Editor:** Build tab card (command, value now, Name chip, line); + Add, section GeoGebra: Point, Triangle and its circumcircle. Rename rewrites the commands (texts in quotes stay).
- **Fit:** points, circles, polygons, curves, texts; lines and rays set nothing; functions as the generic rule.
- **Export:** scene primitives, so pgfplots draws the same picture as numeric coordinates (markers as `only marks` plots).

## Which lines are GeoGebra's

`name = formula` is a GeoGebra line when the name is no name of the chart (a slider, a function, a let name, a named object of another kind), not `x`, `y`, `z`, `r`, `t`, `theta` or a constant, and the formula has no comparison at the top and is not a formula in both x and y without a command. So old lines read as before: `a = x^2 + y^2` with a slider a and `k = x^2 + y` stay curves, `y = 2x` a function, `r = 2` polar, `c: x^2 + y^2 = 4` a named curve. A bare command is GeoGebra's when it is one whole call with GeoGebra's capital name (`Line(A, B)`; the words' `line from ...` and `polygon (0, 0), ...` are unchanged). These lines were problems before (an unknown name), so no working chart changes.

## Differences to GeoGebra

- Names: `B'` and names with spaces are no names (write `B_1`); `x`, `y`, `z`, `r`, `t` are taken. `f(x) = x^2` is the chart's own function line (printed `plot f(x) = x^2`).
- `f = x^2` is a function of x as in GeoGebra; a formula in x and y without a command stays the chart's curve (GeoGebra would make a function of two variables).
- Points are not draggable in the preview (change the numbers, or use `mark P at (1, 2)`, which GeoGebra lines read by name).
- A slider starts at its low end; GeoGebra's other Slider arguments (speed, width, ...) are ignored.
- Points and lists are not labelled with their values; `Text` writes values with 2 decimals.
- In formulas of complex numbers, a point given as `(x, y)` is x + iy only as the start of `IterationList`; elsewhere write the complex number (`c = -0.4 + 0.6ί`).
- No conics, angles, loci, implicit curves by command, CAS (symbolic) commands, `Execute`, scripting, or `:=`; `Derivative` and `Integral` are numeric.
- The export writes points and curves as coordinates (a list of thousands of points makes a large .tex).

## Not done

- Drag of GeoGebra points in the editor; Ask the curve questions for GeoGebra objects; hover cards of GeoGebra formulas in notes.
- 3D: circles, lines, rays, functions and texts draw nothing (an info says 2D only).
- Chart words: GeoGebra lines have no English words, so there are no pieces for them.
