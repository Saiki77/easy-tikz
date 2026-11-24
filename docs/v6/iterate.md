# 6.0 E: iterate and colour the plane

Working material for the integrator (docs/reference.md, docs/ai.md, the Help guides). Code: `src/iterate/`; small blocks marked `// 6.0 E` in the shared files. Tests: `tests/iterate-text.test.ts`, `iterate-scene`, `iterate-export`, and the `iterate-*` charts of `tests/latex.test.ts`.

## The lines

After the formula, the pieces between commas are the start (`$z_0 = 0$`), the names the recurrence reads (`$c = P$`, `$c = a + bi$`), the steps (`40 steps`) and the options, in any order. A start or a name may be a formula, a point `(1, 2)` or a points tool `P` (drag P and the picture follows). Recurrences are written `z_{n+1} = F` (also `x_{n + 1}`, `p_(n+1)`, a Greek state `\theta_{n+1}`); F reads the state as `z_n`. Sliders work everywhere.

### Orbit of a recurrence

```
mark P at (-0.12, 0.75)
draw the orbit of $z_{n+1} = z_n^2 + c$, $z_0 = 0$, $c = P$, 40 steps
```

```
slider eta from 0 to 0.5, starting at 0.1
let $f(x, y) = x^2 + 4y^2$
mark P at (2, 1)
draw the orbit of $p_{n+1} = p_n - \eta \nabla f(p_n)$, $p_0 = P$, 25 steps, labelled
```

- The points z_0, z_1, ... joined by a line, z_0 a little larger. Complex numbers and vectors of 2 are points of the plane (a point P is the complex number x + iy where the recurrence is one of complex numbers); numbers are drawn as (n, x_n).
- It stops where a value is no number or runs a million chart sizes away.
- Options: a colour (default red), `thin` (default), `thick`, `small` (default), `large`, `as a path` (no dots), `labelled` (z₀ to z₅ in the view), `hidden`.
- Publishes OR1_n (points drawn), OR1_x, OR1_y (the last point).
- Full LaTeX: `\orbit[z_0=0, c=P, steps=40, as a path]{z_{n+1} = z_n^2 + c}`.

### Cobweb

```
slider r from 2.5 to 4, starting at 3.7
plot $f(x) = r x (1 - x)$ in blue, thick
draw the cobweb of $x_{n+1} = f(x_n)$ from 0.2, 80 steps
```

- The line y = x (gray), the graph of the map (blue, thick; left out when the map is `f(x_n)` of a function the chart draws), and the path (x₀, 0), (x₀, x₁), (x₁, x₁), (x₁, x₂), ..., its first quarter faintest. A dot at (x₀, 0).
- `draw the cobweb of f from 0.2` is short for `x_{n+1} = f(x_n)`. Defaults: from 0.2, 40 steps.
- Options: a colour (default orange), `thin`, `thick`, `hidden`. Publishes CW1_x (the last x_n), CW1_n.
- Full LaTeX: `\cobweb[from=0.2, steps=80]{x_{n+1} = f(x_n)}`.

### Bifurcation diagram

```
show x from 2.5 to 4 and y from 0 to 1
draw the bifurcation diagram of $x_{n+1} = r x_n (1 - x_n)$ for r from 2.5 to 4
```

- For each r on the x-axis (one per pixel column), where the orbit of x₀ settles: 400 steps run in, the next 300 are drawn as dots, denser rows darker. A picture (pixel layer, CPU only), so the export writes a PNG.
- Optional start `$x_0 = 0.3$` (default 0.5). Options: a colour (default blue), `hidden`.
- Full LaTeX: `\bifurcation[r=2.5:4, x_0=0.3]{x_{n+1} = r x_n (1 - x_n)}`.

### Newton's method

```
plot f(x) = x^2 - 2
draw Newton's method for f from 2.5, 5 steps, labelled
```

- For a function of the chart: each tangent from (x_k, f(x_k)) down to (x_{k+1}, 0), a dashed line from the axis up to the graph, dots on the axis (the last one larger) and on the graph. f' by central differences.
- It stops where the slope is 0 or there is no value (an info note with the step).
- Options: a colour (default red), `thin`, `thick`, `labelled` (x₀, x₁, ... while they stand apart), `hidden`. Publishes NM1_x (the last x_k), NM1_val (f there), NM1_n.
- Full LaTeX: `\newton[from=2.5, steps=5, labelled]{f}`.

### Colour the plane

```
colour the plane by $z_{n+1} = z_n^2 + c$, $z_0 = 0$, $c = x + iy$, 200 steps
slider a from -1 to 1, starting at -0.8
slider b from -1 to 1, starting at 0.156
colour the plane by $z_{n+1} = z_n^2 + c$, $z_0 = x + iy$, $c = a + bi$, 300 steps
colour the plane by $z_{n+1} = z_n - \frac{z_n^3 - 1}{3z_n^2}$, $z_0 = x + iy$, 40 steps
colour the plane by $f(z) = \frac{z^2 - 1}{z^2 + 1}$
colour the plane by $f(x, y) = \sin x \cos y$, in viridis, opacity 0.8
```

`color the plane by` works too. What the formula is decides the picture:

- **A recurrence** (escape time): every pixel runs the orbit, its point x + iy wherever the line says (`c = x + iy`: the Mandelbrot set; `z_0 = x + iy`: Julia sets, Newton basins). An orbit that leaves |z| > 16 is coloured by its smooth speed through the colour map (default `cyclic`, made for fractals: navy, blue, sky, cream, orange, wine and round again). An orbit that neither leaves nor settles is dark. When the plane is in z₀ alone (one map for every pixel), an orbit that settles takes the colour of the point it reaches (its angle on a blue, orange, rose wheel, shifted by its size), darker the more steps it took: the basins of Newton's method. Default 200 steps. The recurrence must be one of complex numbers (no vectors, lists or sums: a problem says so).
- **A function of z** (`f(z) = ...`, or a formula in z alone): domain colouring. The hue is the angle of f(z), the light grows with |f(z)| (zeros dark, poles white), with bands at every power of 2.
- **A function of x and y** (`f(x, y) = ...`, or a formula in x and y, let functions and functions of the chart too): a heat map through a colour map (default viridis), from the lowest value in the view to the highest (a 48 x 48 grid of the view).
- Options: a colour map (`in viridis`, `heat`, `cool`, `diverging`, `rainbow`, `greyscale`, `cyclic`), `opacity 0.5`, `hidden`.
- It lies under the grid, the fills and everything else, over the plot rectangle.
- Full LaTeX: `\colourplane[z_0=0, c=x + iy, steps=200, colormap/cyclic]{z_{n+1} = z_n^2 + c}` (also `\colorplane`), `\colourplane[opacity=0.7]{f(z) = \frac{z^2 - 1}{z^2 + 1}}`.

### Turning circles

```
slider n from 1 to 20, starting at 5, in steps of 1
draw the circles of $\sum_{k=1}^{n} \frac{4}{\pi (2k - 1)} e^{i(2k - 1)t}$, with its wave
```

- A sum in t, `\sum_{k=a}^{b} c_k(t)` (bounds are formulas: sliders): each term a circle on the tip of the one before, turning on the animation clock (part C: 0.6 rad of t a second, so the first circle of this one turns in about 10 s), the arms, the tip, and the curve the tip draws over t from 0 to 2π (faint).
- `with its wave`: the imaginary part over the last turn, to the right of the circles (from 1.25 times their reach, or the middle of the view), the newest value next to them, joined to the tip by a dashed line.
- The export, print and the SVG files draw the still frame (time 0, or the chart's `stillTime`).
- Options: a colour (default blue), `thin`, `thick` (default), `with its wave`, `hidden`.
- Full LaTeX: `\circles[wave]{\sum_{k=1}^{n} \frac{4}{\pi (2k - 1)} e^{i(2k - 1)t}}`.

## Limits

So that no chart freezes a phone:

| What | At most |
|---|---|
| Steps of an orbit | 2000 (points with dots: the first 400; labels: the first 6) |
| Steps of a cobweb | 1000 |
| Steps of Newton's method | 100 |
| Steps per pixel of a coloured plane | 1000 (also the GLSL loop's bound) |
| A bifurcation diagram, per column | 400 steps run in, 300 drawn |
| Terms of turning circles | 60 |
| Pixels the GPU paints in one go | 2.5 million (canvas pixels at the screen's density, at most 2 per unit) |
| The CPU in the preview | 10 ms a frame (a coarse picture first, then tiles) |
| A picture in the export | 150 dpi of the plot, at most 900 pixels a side and 600 000 in all |
| A picture in the SVG files and Copy SVG / PNG | 800 pixels a side |

A larger count gets an info note ("Drawn with 2000 steps at most").

## The preview

A pixel layer is a `<foreignObject>` with a canvas over the plot rectangle (src/iterate/paint.ts). The GPU paints it at once: one WebGL 1 context for the plugin, a fragment shader made from the formula (`toGlsl` of part A), sliders as uniforms. The CPU paints it (64-bit) when there is no WebGL, no highp floats, a formula with no GLSL form (functions of the chart, sums), or a zoom past 32-bit floats (a pixel smaller than 4e-6 of the coordinates): a coarse picture at once, then the full one in tiles over animation frames, 10 ms a frame, so typing never waits. A finished picture (the CPU's, or a settled one of the GPU) is kept (six of them) and shown at once when a redraw changes nothing of it, so dragging a point over a fractal draws the fractal from there. Panning and zooming in the editor draw it again; during a slider drag or a pan (draft frames) the CPU keeps the coarse picture.

## The export

A pixel layer is a PNG (`plane-<hash>.png`, a pure-JS encoder: src/iterate/png.ts) drawn with
`\addplot[on layer=axis background, forget plot] graphics[xmin=..., xmax=..., ymin=..., ymax=...] {plane-<hash>.png};`
over exactly the view; the axes, the labels and everything else stay vector. **Copy LaTeX** in the editor (the action bar and the Code tab) saves the PNGs the code names in the note's attachment folder, and says where: put them beside the .tex file. The same picture has the same name. The code says which file it needs in a `% The picture plane-....png (beside the .tex file)` line. `frames` writes a picture per step. The AI server's export_latex gives the code only (no PNG): an AI app gets the `\addplot graphics` line and the comment.

**SVG files** (the setting) and Copy SVG / Copy PNG embed the picture as `<image href="data:image/png;base64,...">`, painted again on the CPU.

## Editor

- Build tab cards: Orbit (recurrence, start, with, steps, line, As a path, Labels), Cobweb (recurrence, start, steps, line), Bifurcation diagram (recurrence, parameter, from, to, start), Newton's method (function, start, steps, line, Labels x₀, x₁), Coloured plane (formula; start, with and steps for a recurrence; colours; opacity), Turning circles (sum, With its wave, line).
- + Add, section **Colour the plane**: Mandelbrot set, Julia set with sliders (a, b), Newton basins, Domain colouring, Heat map. Section **Iterate**: Orbit of a point (with P), Gradient descent (eta, let f, P, a heat map of f under it), Cobweb (with r), Bifurcation diagram, Newton's method (a function x² − 2 when the chart has none), Fourier circles (with n).
- Ask the curve, for a function f clicked at x = a: "Newton's method from here" (`draw Newton's method for f from a, 5 steps, labelled`); "The cobweb from here" (`draw the cobweb of $x_{n+1} = f(x_n)$ from a, 40 steps`) when f maps the part of the view where y = x shows into itself.
- Hover cards (a formula in a note): `z_{n+1} = z_n^2 + c` the orbit of 0 with c = a + bi on sliders; `x_{n+1} = r x_n (1 - x_n)` the cobweb from 0.2 with its letters on sliders; `\sum_{k=1}^{n} ...` the partial sum with a slider n (a curve when it reads x, else the partial sums as joined points); `f(z) = ...` its domain colouring.

## Data model

Tool types (names): `orbit` (OR1: recurrence, start, given, steps, path, size, thickness, valueLabel), `cobweb` (CW1: recurrence, start, steps, thickness), `bifurcation` (BD1: recurrence, parameter, from, to, start), `newton` (NM1: function, start, steps, thickness, valueLabel), `colourPlane` (CP1: formula, start, given, steps, colormap?, opacity), `fourierCircles` (FC1: sum, wave, thickness). `given` holds the names a recurrence reads, `c = P; eta = 0.1`. The scene adds `pixels?: PixelPrim[]` to SceneItem2D (src/iterate/pixels.ts: `key`, `opacity`, `tile(view, w, h, x0, y0, x1, y1, rgba)` 64-bit, `shader` GLSL or null, `cost`, `columns`, `bounds()` for the fit); the renderer draws them under the grid, the export as PNGs (`collectExportFiles(make)` hands the files over).

## Not done

- 2D only: in a 3D chart these lines draw nothing (no problem is named).
- The chart words (Settings, Chart words) have no pieces for these lines.
- Ask the curve has no questions for a click on an orbit or a coloured plane (no target kind for them).
- Orbit dots cannot be dragged; drag the points tool the start or c reads.
