# 6.0 P: Python in a chart

Working material for the integrator (docs/reference.md, docs/ai.md, the Help guides). Code: `src/python/`; small blocks marked `// 6.0 P` in the shared files. Tests: `tests/python-lang.test.ts` (the language, budgets), `python-numpy` (NumPy, the FFT against known values, speed), `python-chart` (the block in words and Full LaTeX, values, the heart, matplotlib primitives, the view, frame(t), problems, the export), and the `python-*` charts of `tests/latex.test.ts`.

## The block

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

- A `python:` line and the lines below it that are indented deeper (any consistent indent; blank lines between them belong to it). The block ends at the first line that is not indented. A chart comment (`%`, `//`, or `#` at the start of the line) between its lines stays a chart comment and is no line of the script.
- Optional: a name (`PY2: python:`) and a colour (`python in red:`): the colour is the first colour of the script's matplotlib cycle (`C0`; blue by default).
- The script is printed back exactly as written. A block the editor did not change keeps its lines and its indent; a changed script is written with 4 spaces.
- Several blocks run in order and share one scope (a name of the first is a name of the second).
- **Full LaTeX:** `\begin{python}`, the lines as they are (no indent needed), `\end{python}`; options `\begin{python}[name=PY2, red]`.
- **Data:** a tool `{ "type": "python", "name": "PY1", "code": "..." }` (the script without the block's indent, lines joined by `\n`; trailing blank lines and spaces at line ends are dropped). Name prefix PY.

## What a script gives the chart

- **Names** it sets at the top are values of the chart, as `let` names (`src/values/table.ts` NativeValue): every line and formula reads them. Conversions:

| In the script | In the chart |
| --- | --- |
| int, float, bool | a number |
| `1 + 2j` | a complex number |
| NumPy array of 2 or 3 real numbers, tuple of 2 or 3 numbers | a vector |
| longer 1-d real array, list | a list (of numbers, or of what its items are) |
| complex array | a list of complex numbers |
| array of shape (n, 2) or (n, 3), n not 2 or 3 | a list of points |
| square array, list of equal rows of numbers | a matrix |
| `def f(x):`, `f = lambda x: ...` | a function of the chart (`plot g(x) = f(x)`; the export samples it as coordinates) |

  Names a slider, a function or an axis variable of the chart has (`x`, `y`, `z`, `t`, `theta`, `pi`, `e`) stay the chart's: the script may set them (the heart's `t`), the chart does not see them. `frame` and names that start with `_` are not given to the chart.
- **Sliders and computed names** (`n`, `P1_x`) are variables of the script: the names it reads and never sets. A run is cached by their values (12 runs per program), so it runs again only when one of them changes.
- **Drawing:** the matplotlib calls (next section) as scene primitives in the theme's colours, in the preview, the export, Copy SVG and the SVG files alike. `title`, `xlabel` and `ylabel` become the chart's title and axis names where the chart has none of its own (a text with braces stays a text in the plot); `legend()` is a key in the corner that covers the least of the drawing (matplotlib's 'best').
- **The view:** a chart with no `show` line (the default range) takes the scripts' `xlim` and `ylim`, else what they draw with matplotlib's margins (5 %). A chart with `show x from a to b` only fits y as before (the fit holds what a script draws).
- **The export** writes the script as comments at the top of the tikzpicture (`% Python PY1 ...`), so the Code tab shows it, and draws its result as coordinates; `imshow` as a PNG (`\addplot graphics`, part E's pixel layer).

## Turning circles of a list

`draw the circles of c, using n circles, with its path` (part E's line, 6.0 P options):

- `c`: a name of the chart whose value is a list of complex numbers (or numbers), or a list written out. The list is read in NumPy's `fftfreq` order: index k is frequency k for k < N/2, else k − N (what `np.fft.fft(z) / len(z)` gives, so the tip draws z). The circles are drawn in the order 0, 1, −1, 2, −2, ...
- `using n circles` (a formula, a slider): the first n of that order (at most 400). Without it: all of them.
- `with its path`: the path of the tip in the colour of the circles (the preview draws it as the tip goes; the export draws it whole).
- Full LaTeX: `\circles[count=n, path]{c}`. Data: `count` (string), `path` (true). The card has a Circles row and a "With its path" chip.

## matplotlib

`import matplotlib.pyplot as plt`; calls as `plt.plot` or, after `fig, ax = plt.subplots()`, `ax.plot`, `ax.set_title`, `ax.set_xlim`, ...

| Call | Draws |
| --- | --- |
| `plot(y)`, `plot(x, y)`, `plot(x, y, 'r--')`, `plot(x1, y1, x2, y2)` | lines; `color=`/`c=`, `linewidth=`/`lw=`, `linestyle=`/`ls=` (`--`, `:`, `-.` dashed), `marker=` or `'o'` in the format (dots), `markersize=`, `alpha=`, `label=` |
| `scatter(x, y, s=, c=, cmap=, alpha=, label=)` | dots; `c=` an array colours them through the colour map |
| `fill_between(x, y1, y2=0, where=, alpha=, color=)`, `fill(x, y)` | fills (see-through: alpha 0.4 unless given) |
| `bar(x, height, width=, bottom=)`, `hist(x, bins=, density=)` | bars as fills |
| `stem`, `step`, `hlines`, `vlines`, `axhline(y)`, `axvline(x)` | lines (axhline and axvline across the view) |
| `arrow(x, y, dx, dy)`, `quiver(X, Y, U, V, scale=, scale_units='xy')` | arrows (quiver autoscales like matplotlib unless `scale` is given) |
| `text(x, y, s, ha=, va=, fontsize=)`, `annotate(s, xy, xytext=, arrowprops=)` | texts (`$...$` is LaTeX) |
| `contour(X, Y, Z, levels, colors=, cmap=)` | level lines (marching squares on the grid; 7 round levels by default) |
| `imshow(Z, extent=, origin=, cmap=, vmin=, vmax=, alpha=)` | a picture (a pixel layer; a PNG in the export) |
| `plt.Circle`, `plt.Rectangle`, `plt.Polygon` with `ax.add_patch` | shapes |
| `title`, `xlabel`, `ylabel`, `legend()` | the chart's title and axis names (where it has none), a key in the best corner |
| `xlim`, `ylim`, `axis([x0, x1, y0, y1])` | the view of a chart with no range of its own; the fit |
| `grid`, `xticks`, `yticks`, `figure`, `show`, `savefig`, `colorbar`, `tight_layout`, `close` | accepted, nothing drawn (the chart's lines say those) |

Colours: `C0` to `C9` (matplotlib's cycle as the plugin's blue, orange, green, red, purple, brown, magenta, gray, olive, teal; C0 is the block's colour), `b g r c m y k w`, names (`red`, `navy`, `tab:blue`, ...), `#rrggbb`, grey levels `'0.5'`, RGB tuples. Calls without a colour take the next colour of the cycle. Colour maps: `viridis`, `plasma`/`inferno`/`magma`/`hot` (heat), `cool`/`Blues`, `coolwarm`/`RdBu`/`bwr` (diverging), `jet`/`rainbow`/`hsv`/`turbo`, `gray`/`Greys`, `twilight` (cyclic). Line widths: up to 0.75 very thin, 1.25 thin, 2.5 thick, more very thick; no width is thick.

## frame(t)

A script with `def frame(t):` (t in seconds) moves: the chart gets a clock (Pause and Play in the strip; reduced motion starts it paused), and the preview's live canvas (6.0 F4) draws what `frame(time)` draws each frame: lines, dots, fills, arrows, circles, texts (no pictures). What the script draws at the top stays still. The export, print and the SVG files draw `frame(0)` (or the chart's `stillTime`). A problem in frame(t) is the chart's problem ("Line 6 of the script, in frame(t): ...").

## The language

A sandboxed Python subset in TypeScript: a tokenizer with indentation (`lexer.ts`), a parser (`parser.ts`), and a compiler of the tree into closures (`interp.ts`; no eval, no Function, no Node, so it runs on phones). Names are resolved by Python's scope rules when compiling (locals in slots, enclosing functions by depth, module names in cells).

- **Statements:** expressions, assignment (several targets, tuple unpacking, `a, *rest = ...`, items and attributes), augmented assignment (lists and arrays change in place), annotated assignment, `if/elif/else`, `for` and `while` (with `else`), `break`, `continue`, `pass`, `def` (defaults, keywords, `*args`, `**kwargs`, keyword-only, closures), `return`, `global`, `nonlocal`, `lambda`, `import` / `from ... import` (also `*`), `del`, `assert`, `raise`, `try/except/else/finally` (exception types `Exception`, `ValueError`, `TypeError`, `ZeroDivisionError`, `IndexError`, `KeyError`, `NameError`, ...; a budget cannot be caught).
- **Expressions:** Python's precedence; `**`, `//`, `%`, `@`, bit operators, chained comparisons, `in`, `is`, `and`/`or` returning their operand, `x if c else y`, `:=`, comprehensions (list, set, dict, generator; a generator is a list), slices with steps, f-strings (`{x:.2f}`, `{x!r}`, `{x=}`, nested specs), `%` formatting, `str.format`.
- **Values:** int and float (JS numbers: a whole float prints as an int, `2.0` as `2`; ints beyond 2^53 lose digits), complex, bool, None, str, list, tuple, dict, set, range, slice, functions, modules.
- **Built-ins:** `print len range enumerate zip map filter sum min max abs round sorted reversed list tuple dict set frozenset float int complex bool str repr format isinstance type any all divmod pow chr ord hex bin callable hasattr getattr iter next slice id hash`. `print` writes to the chart's problem line as a note (info), 50 lines at most.
- **Modules:** `numpy` (`np.linalg`, `np.fft`, `np.random`), `math`, `cmath`, `random`, `matplotlib.pyplot`, `matplotlib.patches`. Any other import is a problem that names these.
- **Methods:** of str (`split join strip replace format upper lower startswith endswith find count ...`), list (`append extend insert pop remove index count sort reverse copy clear`), dict (`get keys values items pop update setdefault copy clear`), set (`add remove discard union intersection difference update`).
- **Not there:** classes, `with`, generators (`yield`), `async`, decorators, other modules (pandas, scipy, sympy, os, files, the network), subplots beyond 1 x 1, 3D plots. In a 3D chart a script's names work, its drawing does not show.

### NumPy

Arrays are `Float64Array`s in C order with a dtype (float, int, bool, complex; complex arrays keep their imaginary parts in a second array). Element-wise operators and comparisons broadcast; a slice is a copy (setting items through a slice of a slice does not reach the first array; `a[1:3] = 0` does change `a`).

- **Making:** `array asarray copy linspace (endpoint, retstep) logspace arange zeros ones empty full zeros_like ones_like full_like eye identity diag meshgrid (indexing='ij')`; dtypes `float64 int64 complex128 bool_ ...`.
- **Element-wise:** `sin cos tan arcsin arccos arctan sinh cosh tanh arcsinh arccosh arctanh exp expm1 exp2 log log10 log2 log1p sqrt cbrt square abs absolute angle (deg) real imag conj floor ceil trunc rint sign radians degrees isnan isfinite isinf sinc round (decimals) clip arctan2 hypot maximum minimum fmax fmin mod fmod heaviside power add subtract multiply divide where (3 arguments, or 1: the indices) nonzero`; complex numbers in `+ - * / **`, `exp log log10 sqrt sin cos tan sinh cosh square abs angle conj`.
- **Reductions** (with `axis=`): `sum prod mean average (weights) std var (ddof) min max amin amax nanmin nanmax nansum nanmean median ptp argmin argmax any all count_nonzero cumsum cumprod diff (n, axis)`.
- **Shapes:** `reshape (-1) transpose .T ravel flatten squeeze expand_dims concatenate stack vstack hstack column_stack append flip roll tile repeat sort argsort unique shape size ndim`.
- **Indexing:** `a[i]`, `a[i, j]`, slices with steps, negative indices, `...`, `None`/`np.newaxis`, boolean masks (of one axis or the whole shape), lists and arrays of indices (several zip together), assignment through all of them.
- **Products:** `dot matmul @ inner vdot outer cross trace`.
- **Curves:** `trapz`/`trapezoid interp polyfit polyval histogram isclose allclose array_equal`.
- **`np.linalg`:** `det inv solve` (LU with pivoting), `eig eigvals` (symmetric: Jacobi; others: shifted complex QR, vectors by elimination, up to 60 x 60), `eigh eigvalsh norm (ord, axis) matrix_power`.
- **`np.fft`:** `fft ifft` (any length: radix 2, else Bluestein; `n=`, `axis=`, `norm=`), `fftfreq fftshift ifftshift rfft rfftfreq`.
- **`np.random`:** `seed rand randn random random_sample standard_normal uniform normal randint choice (replace, p) shuffle permutation exponential binomial poisson default_rng (random normal uniform integers choice ...)`. Every run starts from seed 0 (a chart draws the same picture each time); `random` (the module) too.
- Array attributes and methods: `shape ndim size dtype T real imag`, `sum mean std var min max argmin argmax cumsum cumprod any all round clip conj dot ptp nonzero repeat squeeze trace diagonal reshape transpose flatten ravel copy tolist item astype fill sort argsort`.

## Problems and budgets

Problems name the line and the column of the script, in the reader's language: "Line 4 of the script: name 'np' is not defined" (Japanese: 「スクリプトの 4 行目: ...」); with several blocks "Line 1 of script 2: ...". A block after a block that stopped says "Not run: script 1 above stopped first." Syntax problems name the spot too. The card shows the problem under the code area and marks its line.

| What | At most |
| --- | --- |
| Steps of one run (a statement, a loop turn, a call; array work 1 step per 256 numbers) | 2 000 000 |
| Time of one run | 1.5 s (frame(t): 250 ms and 500 000 steps; a function the chart calls: 200 ms and 200 000 steps) |
| Calls inside calls | 120 |
| Items in one list, string or array | 4 000 000 |
| Drawing calls of one run | 20 000 |
| Circles of a list of coefficients | 400 |
| Lines of print | 50 |

## Speed

Measured in node (tests/python-numpy.test.ts, worst of 30 runs with new inputs each): the heart script (256-point FFT) 0.4 to 0.6 ms; five 200-point curves with labels and a legend about 1 ms. A slider drag reruns only when a value the script reads changes, and the same values come from the cache.

## Editor

- Build tab card **Python script**: the script in a code area (monospace, line numbers, keeps indentation; Tab puts in 4 spaces, Shift-Tab takes them out, Enter keeps the indent and adds 4 after a colon); its problem under it, its line marked in the gutter; a line with the names it gives the chart, the names it reads, how long it ran, and whether frame(t) moves.
- + Add, section **Script**: Python plot (a slider a), Fourier drawing (the heart with n circles), Moving script (frame(t)).
- Renaming a slider renames it in the scripts (names, not strings, attributes or keyword arguments).
- Help: the guide **Python in a chart** (Chart language); Showcase: **A heart drawn by turning circles**, **A matplotlib plot with a slider**, **Two waves that move in Python**. Examples: Fourier drawing of a star, Gradient descent in NumPy, Random samples and the normal curve.

## Not done

- The chart words (Settings, Chart words) have no pieces for the python block.
- Ask the curve has no questions for what a script draws; script dots cannot be dragged.
- Classes, generators, `with`; pandas and scipy; subplots; 3D drawing.
- A slice is a copy, not a view; ints are 64-bit floats.
- In a 3D chart a script function used as a surface (`plot z = g(x, y)`) has no pgfplots form: the export leaves it out (2D curves of script functions export as coordinates).
