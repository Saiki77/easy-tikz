# 6.0 media: the pictures the docs name

Working material for the release (part F). README.md and docs/whats-new.md already name these files; they do not exist yet. Make each one in the isolated Obsidian (`scripts/media`), in the README's look: light theme, the plugin as it runs, real input. The chart text of each is below, so the picture shows exactly these lines. The screenshots on the preview page (scratchpad `v6-shots.mjs`) used the same charts.

| File | Used in | What it must show |
| --- | --- | --- |
| `docs/media/v6-fractal.png` | README "Every idea is a picture", docs/whats-new.md 6.0 | Left: the Mandelbrot set with a point P dragged near its edge and the orbit of 0 for c = P as a red path (chart `mandel`). Right: a Julia set with its two sliders a and b in the strip under it (chart `julia`). |
| `docs/media/v6-matrix.png` | README "A matrix moves the plane" | Left: the matrix chart half way through Play (the grid leaning, the faint old grid behind it, the strip showing Pause and Step 2 of 3). Right: the same chart at its last step, with the eigenvectors labelled λ₁ = 2.5, λ₂ = 1 and the unit square labelled det A = 2.5 (chart `matrix`). |
| `docs/media/v6-motion.png` | README "Charts that move" | Left: the damped pendulum field, coloured by length, with moving particles and its rest points labelled (chart `pendulum`). Right: the Lorenz attractor in 3D coloured by time (chart `lorenz`; with `traced` once part F1 is in, caught mid-way). |
| `docs/media/v6-ask.png` | README "Ask the curve" | The editor with g and h (chart `ask`), the menu open after a click on g near x = 1.5, the pointer on "Where is g ≤ 0?" and its answer faint in the chart (the bar from -2 to 2 with its set label). |
| `docs/media/v6-hover.png` | README "Notes that read sets and maps" | Reading view of a note that defines `$g(x) = x^2 - 4$` and has `$\{x \in \mathbb{R}^n \mid g(x) \le 0\}$` in a sentence; the pointer on the set and its card open (the parabola, the set on the x-axis, the n = 1 / n = 2 switch, "g(x) = x^2 - 4 comes from this note"). |
| `docs/media/v6-iterate.png` | README "Values, sums and iterations" | Four charts in a 2 x 2 grid: the Taylor polynomial with n = 4 (chart `taylor`), the 7th roots of unity joined and labelled (chart `roots`), the cobweb at r = 3.7 (chart `cobweb`), the bifurcation diagram (chart `bifurcation`). |

## The charts

```
mandel       show x from -2.4 to 1 and y from -1.15 to 1.15
             equal scale
             colour the plane by $z_{n+1} = z_n^2 + c$, $z_0 = 0$, $c = x + iy$, 200 steps
             mark P at (-0.12, 0.75), large
             draw the orbit of $z_{n+1} = z_n^2 + c$, $z_0 = 0$, $c = P$, 40 steps, as a path

julia        show x from -1.8 to 1.8 and y from -1.2 to 1.2
             equal scale
             slider a from -1 to 1, starting at -0.8
             slider b from -1 to 1, starting at 0.156
             colour the plane by $z_{n+1} = z_n^2 + c$, $z_0 = x + iy$, $c = a + bi$, 200 steps, in cyclic

matrix       show x from -4.5 to 4.5 and y from -3 to 3
             equal scale
             let $A = \begin{pmatrix} 1.5 & 1 \\ 0.5 & 2 \end{pmatrix}$
             draw the grid
             draw the basis vectors
             shade the unit square, labelled
             then transform the plane by A
             then draw the eigenvectors of A, labelled

pendulum     show x from -6.3 to 6.3 and y from -4.2 to 4.2
             draw the vector field $F(x, y) = (y, -\sin x - 0.25y)$, coloured by length, with moving particles
             mark the rest points of F, labelled

lorenz       3d
             show x from -25 to 25, y from -30 to 30 and z from 0 to 50
             draw the solution of $\dot{p} = (10(y - x), x(28 - z) - y, xy - \frac{8}{3}z)$ through (1, 1, 1) for t from 0 to 72, coloured by time

ask          show x from -4 to 4 and y from -5 to 7
             plot $g(x) = x^2 - 4$ in blue, thick
             plot $h(x) = 2 - x$ in red, thick

taylor       show x from -7.5 to 7.5 and y from -3 to 3
             slider n from 0 to 12, starting at 4, in steps of 1
             plot $\sin x$ in gray, thick
             plot $T(x) = \sum_{k=0}^{n} \frac{(-1)^k x^{2k+1}}{(2k+1)!}$ in red, thick

roots        show x from -1.65 to 1.65 and y from -1.1 to 1.1
             equal scale
             slider n from 2 to 16, starting at 7, in steps of 1
             draw $x^2 + y^2 = 1$ in gray
             mark the points $\{e^{2\pi i k / n} : k = 0, \dots, n - 1\}$, joined, labelled

cobweb       show x from 0 to 1 and y from 0 to 1
             equal scale
             slider r from 2.5 to 4, starting at 3.7
             plot $f(x) = r x (1 - x)$ in blue, thick
             draw the cobweb of $x_{n+1} = f(x_n)$ from 0.2, 80 steps

bifurcation  show x from 2.5 to 4 and y from 0 to 1
             draw the bifurcation diagram of $x_{n+1} = r x_n (1 - x_n)$ for r from 2.5 to 4
```

The What's new popup itself needs no picture: its slides are live charts (src/whatsnew.ts).
