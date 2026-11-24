# 6.0 scripting: GeoGebra commands and Python

The user's decision (2026-11-24): charts accept scripts in languages people and AIs already know: **GeoGebra commands** and a **Python script block** (NumPy and matplotlib style). Goal: "allow arbitrary other cool stuff, people can use the scripting language themselves or with AI, and it should be similar or the same to others out there". Fourier of any drawing is the first example.

All rules of docs/v6/spec.md apply (patterns, own folders, `// 6.0 <part>` blocks in shared files, en + ja, tests, no eval, no em dashes, isolated Obsidian only).

## G. GeoGebra commands (src/geogebra/)

1. **Commands in every formula field** (plain and in `$...$`), with GeoGebra's names, argument orders and list braces `{1, 2, 3}`: `Sequence(expr, k, a, b[, step])`, `Sequence(n)`, `IterationList(expr, var, {start}, n)`, `Iteration(...)`, `KeepIf(condition, list)` and `KeepIf(condition, var, list)`, `Element(list, i)` (1-based), `Zip(expr, var, list, ...)`, `Sum(list)`, `Product(list)`, `Length`, `First(list[, n])`, `Last`, `Append`, `Join`, `Reverse`, `Sort`, `Max`/`Min` of lists, `Mean`, `If(condition, a[, b])`, `x(P)`, `y(P)`, `abs`, `arg`, `conjugate`, `real`, `imaginary`, `Vector`, `UnitVector`, `Dot`, `Cross`, `Determinant`, `Transpose`, `Invert`, `Root` (numeric), `Integral(f, a, b)` (numeric), `Derivative` (numeric, as a function). Complex `i` and GeoGebra's `ί`. They compile into part A's value engine (src/values/); plain-number formulas keep today's compiler.
2. **GeoGebra input lines as chart lines**, so a pasted construction draws: `A = (1, 2)`, `f(x) = x^2`, `c = Circle(A, 3)`, `s = Segment(A, B)`, `L = Sequence((k, k^2), k, 1, 10)`, `C = Curve(cos(t), sin(2t), t, 0, 2pi)`, `p = Polygon(A, B, C)`, `v = Vector(A, B)`, `M = {{1, 2}, {3, 4}}`, plus `Line`, `Ray`, `Text`, `Translate`, `Rotate`, `Dilate`, `Reflect`. Each becomes the matching chart object (point, function, curve, segment, polygon, arrow, point list, value) with GeoGebra's default look, prints back as written, and works with sliders (`a = Slider(0, 5)` or the plugin's slider lines).
3. The user's first screenshot must work as pasted: `IterationList(z^2 + c, z, {0 + 0ί}, 20)`, `KeepIf(abs(Element(IterationList(z^2 + c, z, {0 + 0i}, 20), 21)) <= 2, ...)` (a point set), Newton orbit `IterationList(z - (z^3 - 1) / (3z^2), z, {Z_0}, 30)`.
4. Full LaTeX form, the AI guide section, a Help guide "GeoGebra commands", 2 examples, tests (parse, values, scene, export, round trip).

## P. Python script block (src/python/)

1. **Where:** a `python:` line in the chart, followed by its indented lines (any consistent indent); the block ends at the first line that is not indented. Full LaTeX: `\begin{python} ... \end{python}`. The printer keeps the script exactly as written. Several blocks run in order and share one scope.
2. **The language:** a sandboxed Python subset written in TypeScript (tokenizer with indentation, parser, tree-walking interpreter; no eval, no Function, no Node, runs on phones). Statements: assignment (also augmented and tuple unpacking), `if/elif/else`, `for`, `while`, `break`, `continue`, `pass`, `def` with defaults and keyword arguments, `return`, `lambda`, `import` / `from ... import` of the allowed modules only (`numpy as np`, `math`, `cmath`, `matplotlib.pyplot as plt`, `random`). Values: int, float, complex (`1j`), bool, None, str (with f-strings), list, tuple, dict, range, slicing, comprehensions, `**`, `//`, `%`, `@`. Built-ins: `len, range, enumerate, zip, map, filter, sum, min, max, abs, round, sorted, reversed, list, tuple, dict, float, int, complex, print` (print goes to the chart's problem line as info). Budgets: a step limit and a recursion limit per run, with a clear problem message (line and column) instead of a freeze.
3. **NumPy subset** on Float64Array / complex arrays with broadcasting: `array, linspace, arange, zeros, ones, full, meshgrid, concatenate, stack, reshape, transpose (.T), sum, mean, std, min, max, argmin, argmax, cumsum, diff, dot, outer, sin, cos, tan, arcsin, arccos, arctan, arctan2, sinh, cosh, tanh, exp, log, log10, sqrt, abs, angle, real, imag, conj, floor, ceil, round, clip, where, pi, e, inf, nan`, `np.linalg` (`det, inv, eig, solve, norm`), `np.fft` (`fft, ifft, fftfreq, fftshift`), `np.random` (seeded: `seed, rand, randn, uniform, normal, randint, choice`). Element-wise operators, comparisons, boolean masks, fancy indexing for 1D.
4. **Drawing, matplotlib style** (`plt.` or a bare name): `plot(x, y, color=, linewidth=, linestyle=, label=)`, `scatter(x, y, s=, c=)`, `fill_between(x, y1, y2, alpha=)`, `arrow(x, y, dx, dy)` and `quiver(X, Y, U, V)`, `text(x, y, s)`, `title`, `xlabel`, `ylabel`, `xlim`, `ylim`, `axis('equal')`, `grid`, `legend`, `contour(X, Y, Z, levels)`, `imshow(Z, extent=, cmap=)` (a pixel layer, part E's), `axhline`, `axvline`. These make scene primitives (preview and pgfplots export alike) through the chart's renderer, in the chart's theme colours; matplotlib colour names and `C0..C9` map to the plugin's colours.
5. **Values into the chart:** names the script defines (numbers, complex numbers, lists, arrays of points, functions of numbers) can be used by every chart line and formula, as `let` values: `draw the circles of c`, `plot $g(x) = f(x)$`, `mark the points P`. Sliders of the chart are variables inside the script, so a script reruns when a slider moves (cached; only when its inputs change).
6. **Motion:** a script may define `def frame(t):` (t in seconds); its drawing calls then run on part C's clock (canvas layer of F4), and the export draws `frame(0)` (or the chart's still time).
7. **Fourier of any drawing:** `draw the circles of c` (part E) also takes a list or array of complex coefficients from a script (frequencies 0, 1, -1, 2, -2, ... or `np.fft.fftfreq` order, documented), so this works:

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
8. Errors: the problem line names the script line and column, in en and ja ("Line 4 of the script: name 'np' is not defined").
9. A Help guide "Python in a chart", Showcase pages (the Fourier heart, a matplotlib-style plot, an animated script), 3 examples, the AI guide section (what is supported, what is not), tests (interpreter, numpy, plotting, export, round trip, budgets).

## Order

G and P are built in parallel on their own branches from v6, then merged; films of the results are shown to the user before the merge.
