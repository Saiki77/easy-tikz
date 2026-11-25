# 6.0 ML: the machine learning pack

Working material for the integrator (docs/reference.md, docs/ai.md, the Help guides, What's new). Code: `src/ml/` (function heads, the activation functions), `src/python/ml.ts` (NumPy), `src/guides/ml.ts`, `ml.ja.ts`, `examplesMl.ts`; small blocks marked `// 6.0 ML` in the shared files. Texts: `src/i18n/en/ml.ts`, `src/i18n/ja/ml.ts`. Tests: `tests/ml.test.ts` (heads, built-ins, the export, the GPU), `tests/ml-python.test.ts` (NumPy, matplotlib, frame(t), speed), `tests/ml-guides.test.ts` (the numbers the guides name).

## What is new

### frame(t) draws everything on the live canvas

A script's `def frame(t):` now draws on the live canvas (6.0 F4) what the still drawing draws:

- **Pictures:** `imshow` and `contourf`. Each picture is made once per content (its key is a hash of all its numbers) and kept on a small canvas (96 at most, the most recent): a picture that comes again (`snaps[k]` of a training) costs one `drawImage`. Nearest cells stay sharp squares; `interpolation='bilinear'` (and the other smooth ones) blends them. Measured in Obsidian: a 50 x 50 picture, its contour and 100 dots take 1.6 to 1.9 ms a frame (`data-paint-ms`); in node a frame of the network guide takes under 0.5 ms after its pictures are made (about 3 ms each, once).
- **Title, xlabel, ylabel:** written into the chart's own SVG texts each frame (sharp, no canvas text). The chart's title is the still frame's (`frame(0)` or `stillTime`) where the still drawing sets none, so the space for it is there. A title with `$...$` keeps the still frame's.
- **Legend and texts:** in the chart's font and sizes (the canvas used `10px sans-serif` before: it cannot read CSS variables), with a halo like the SVG's.
- **The export, print and SVG files** draw the still frame: its picture (a PNG beside the .tex), its texts and its legend. In the preview these still parts are hidden while the canvas draws (as the F4 still frame).

### imshow fixed

`origin='lower'` drew row 0 at the top (the logistic regression of the test was upside down). Now row 0 is at the bottom edge of the extent, and the default extent follows the origin as in matplotlib (`(-0.5, nx - 0.5, -0.5, ny - 0.5)` with `'lower'`).

### Function names as ML notes write them

| Written | Function | Printed back |
|---|---|---|
| `plot $\sigma(x) = \frac{1}{1 + e^{-x}}$` | sigma | as written |
| `plot $\mathrm{ReLU}(x) = \max(0, x)$` | ReLU | as written |
| `plot $\operatorname{softplus}(x) = \ln(1 + e^x)$` | softplus | as written |
| `plot $\text{relu}(x) = \max(0, x)$` | relu | as written |
| `plot $t(x) = \tanh x$` | t | as written |

Greek letters (not π and θ) and names in `\mathrm`, `\operatorname`, `\text`, `\textrm`, `\textit`, `\mathit`, `\mathsf`, `\mathbf` head a definition. The data keeps the plain name as `name` and the head as `head` (`"head": "\\sigma"`); a head that no longer names the function (renamed in the editor) is dropped. Other formulas call it either way: `\sigma(2x)`, `sigma(2x)`, `\mathrm{ReLU}(x - 1)`, `ReLU(x)`. Full LaTeX: `\plot{\sigma(x) = ...}`. `t` names a function of x only: `c(t) = (\cos t, \sin t)` stays parametric, a slider t is still refused, and in parametric formulas t is the parameter. Every chart of the guides, the examples and the templates (318) reads, prints and exports as before (checked against v6 at fbebd7e).

### Built-ins in formulas

`sigmoid` (also `\sigma` when nothing of the chart is named sigma), `relu` (`ReLU`), `softplus`, `gelu` (`GELU`), `silu` (`SiLU`, `swish`) of a number, or item by item of a vector or list; `softmax(v)` of a vector or a list (the same kind back) and `logsumexp(v)`. Plain or LaTeX (`\operatorname{gelu}(x)`, `\mathrm{GELU}(x)`). None overflows: softplus is `max(x, 0) + ln(1 + e^{-|x|})`, softmax and logsumexp subtract the largest number first. GELU is x Φ(x) with the erf of Abramowitz and Stegun 7.1.26 (within 1.5e-7), the same in the preview, the GPU and the export.

They are functions the chart has without a line (MathContext hands them out after its own names): a function, a slider, a let value or a script name of the same name wins, so every old chart reads as before. The pgfplots export writes them out (`1/(1+exp(-x))`, `max(0,x)`, the erf polynomial); a coloured plane of them has its GLSL (`colour the plane by $\sigma(x y)$` runs on the GPU). `logsumexp(u)` of a let vector exports as its number, `softmax` of a vector as its parts written out.

### NumPy

- `keepdims=True` on every reduction (`z.max(axis=1, keepdims=True)`: the softmax by rows).
- `np.linalg.svd` (full or thin, `compute_uv`), `pinv`, `lstsq` (x, residuals, rank, singular values), `matrix_rank`: one-sided Jacobi, exact to rounding for the matrices a chart holds; each right singular vector has its largest entry positive.
- `np.cov` (rows are variables unless `rowvar=False`; `bias`, `ddof`, a second array), `np.corrcoef`, `np.logaddexp`, `np.bincount` (`weights`, `minlength`), `np.vander` (`N`, `increasing`), `np.random.multivariate_normal(mean, cov, size)` (Cholesky; a square root from the SVD when cov is only semi-definite).
- `np.exp` of large numbers gives `inf` as NumPy does, and `1 / (1 + np.exp(-z))` gives 0 and 1 at the ends.
- Speed: `+ - * /` of arrays of one shape, a number or a row (`X @ W + b`) run without a function call per item; real matrix products run along memory; `.T` of a matrix is direct. The network of the guide trains in about half the time (in node 940 ms to 430 ms for 1200 steps under load).

### matplotlib

- `contourf(X, Y, Z, levels, cmap=, colors=, alpha=)`: filled bands as a picture (bilinear in each grid cell, so the borders are where the level lines are); values outside the levels are left out; levels as a count get round boundaries that hold every value.
- `contour`: `colors=` one colour or one per level; with one colour the negative levels are dashed (matplotlib's default); `linestyles=`, `alpha=`.
- `hist`: `range=`, `weights=`, `density=`, `cumulative=`, `histtype='step'` (the outline as one line), `bins='auto'` (and the other names: the larger of Sturges and Freedman-Diaconis); returns `n, bins, patches` as matplotlib.
- `legend(loc='upper left')` and the other corners; without `loc`, the emptiest corner as before.
- `scatter(s=...)`: matplotlib's area in points squared (one, or one per dot): the dot's radius is sqrt(s) / 2 points, s = 36 is the normal dot (2 pt in the export). `plot(..., markersize=)` is a diameter in points. Such dots have a thin rim.
- Colours: lines without a colour take C0, C1, ... in turn, and `frame(t)` goes on after the still drawing's colours, so a legend never shows one colour twice unless asked. matplotlib's shades are their own colours (`navy`, `crimson`, `darkred`, `royalblue`, ... 60 names): two different names never draw alike. The basic names stay theme colours.
- `colorbar()` and `clabel()` draw nothing: the chart has no room beside the plot. Say what the colours mean in the title or a legend.

## The Help section "Machine learning"

On the Help home after Dynamics and fractals (`ml.home.section`, `ml.home.about`), English and Japanese:

| Id | Title | Steps | Moves |
|---|---|---|---|
| `ml-activations` | Activation functions and softmax | σ, tanh, ReLU as heads; GELU, softplus built-in; softmax bars with a temperature slider T (and the built-in in a label); T = 0.2 | |
| `ml-optimizers` | Optimizers on a loss surface | the banana valley as a heat map; gradient descent as an orbit with `eta` (0.02 crawls, 0.04 arrives in 60 steps, 0.05 flies off); momentum; Adam | |
| `ml-logistic` | Logistic regression | two classes; trained boundary (accuracy 0.98); the probability as a picture; slider n for the steps | |
| `ml-network` | A neural network that learns | XOR clouds; a 2-8-1 network after 600 steps; its training played by frame(t) | yes |
| `ml-kmeans` | k-means step by step | three clouds; k-means++ start; the steps played; the cells by `contourf` | yes |
| `ml-pca` | Principal components | a tilted cloud; the SVD directions (93 %); projection on a line at `angle` (peak 2.74 near 34°) | |
| `ml-overfitting` | Overfitting and regularisation | degree slider; errors on new data (0.052 and 0.056 at degree 3); degree 12; ridge with λ = 10^l (best near 0.001) | |
| `ml-landscape` | A loss landscape in 3D | a surface with two valleys; the gradient flow rolled down from (a, b), traced; the start across the ridge | yes |

The section also shows the two Showcase pages, which stay in the Showcase right after the Lorenz page:

| Id | Title | Steps |
|---|---|---|
| `optimizer-race` | The optimizer race | the valley; gradient descent alone; the race of gradient descent, momentum, RMSprop and Adam (40 steps a second, heads gliding between steps; Adam arrives near step 90, momentum near 175) |
| `network-learns` | A network learns | the XOR clouds; the network learning them; two rings learned with 12 hidden units |

Editor examples (src/guides/examplesMl.ts): `ml-classifier` (logistic regression with its picture), `ml-clusters` (k-means that moves), `ml-activation-functions`. docs/ai.md: the built-ins and heads under Formulas, the new NumPy and matplotlib under Python scripts, six rows in Recipes and a block "Machine learning" (a classifier; activations with softmax in a label).

## Limits

- A script run has 1.5 s (frame(t): 250 ms a call). Training loops in the guides take 60 to 450 ms in node; keep training to a few hundred steps of small arrays, and keep pictures in a list instead of making them in frame(t).
- A frame's title with `$...$` stays the still frame's; a chart whose still drawing has no title gets none from later frames.
- Pictures kept per chart: 96; a script that makes a new picture every frame (a blend of two snapshots) works but makes one each frame (about 3 ms for 50 x 50).
- `imshow` takes 2-d arrays (no RGB images); `contourf` has no `extend` and no hatches.
- `svd` signs differ from LAPACK's (each right singular vector has its largest entry positive); `lstsq` uses the pseudo-inverse.
- The function heads read at the start of a definition only; `let $\sigma = ...$` is a value named sigma (then `\sigma(x)` is sigma times x).
- `t(x) = ...` cannot be used inside a parametric curve (there t is the parameter).
