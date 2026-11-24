# Easy TikZ 6.0 build spec ("Every idea is a picture")

Branch `v6` (from main at 5.2.6, 61479c7). Plan page with prototypes: https://claude.ai/artifact/EbeWoFmzcrzMk7qAChtkkY
This folder (docs/v6/) is working material for the build; it is folded into docs/ and removed before the release.

## Parts and owners

| Part | Owner | Needs |
|---|---|---|
| A. Values: complex numbers, vectors, matrices, lists, sums, `let`, arrows, point lists | wave 1 | nothing |
| B. Notes and interaction: sets on an axis, Ask the curve, hover cards, chords, formula-chart fixes | wave 1 | nothing |
| C. Motion: `then` steps, Play in notes, frames in the PDF, the animation clock, vector fields with particles, solutions of systems in 2D and 3D | wave 1 | nothing |
| D. Linear algebra and complex maps: `transform the plane by`, grid, basis vectors, eigenvectors, unit square | wave 2 | A, C |
| E. Iterate and colour the plane: orbits, cobwebs, bifurcation, colour the plane (GPU + CPU), Fourier circles | wave 2 | A, C |
| F. Release work: Help guides (en + ja), Showcase, What's new, README, docs, AI guide, smoke test, version | integrator | all |

## Rules for every part

- **Existing charts draw exactly as before.** `npm test` stays green; old chart text parses and prints the same.
- **Follow the 5.0 pattern** of `src/beyond/` for every new object type: an interface in `src/types.ts` (add it to `Tool`), a name prefix in `TOOL_PREFIX` (parse.ts), the words line in `src/text/parse.ts` and `src/text/print.ts`, the Full LaTeX line in `src/text/full.ts`, scene primitives (fills, strokes, markers, texts: the preview and the pgfplots export then draw it alike), the auto-fit (`src/beyond/fit.ts` pattern), rename fields (`src/beyond/tools.ts` pattern), a Build tab card (`src/beyond/cards.ts` pattern) and an + Add recipe.
- **Put the logic in your own files**: `src/values/` (A), `src/notes6/` (B), `src/motion6/` (C), `src/linear/` (D), `src/iterate/` (E). In shared files (parse.ts, print.ts, full.ts, scene.ts, fit.ts, export.ts, renderer.ts, renderer3d.ts, types.ts, modal.ts, main.ts, the i18n index files) add small blocks only, each marked with a comment `// 6.0 <part letter>`, so the merge is easy.
- **Texts:** a new file per part in `src/i18n/en/` and `src/i18n/ja/` (`values.ts`, `notes6.ts`, `motion6.ts`, `linear.ts`, `iterate.ts`), keys start with the file name, registered in both index files. Every new UI string gets its Japanese text in the same commit. Chart words stay English.
- **Plain, short wording** in comments and UI, as the existing code. Never an em dash (—) anywhere: code, comments, UI, docs.
- **Obsidian review scan:** no `eval`/`new Function`, no method named `eval`, no `btoa`/`atob`, no `innerHTML` with user text, `createDiv` instead of `createEl('div')`, no `!important`, no `clip-path`, no Node types in src/, no unneeded `as` casts.
- **Pure where the old code is pure:** scene, maths and text modules have no DOM and no Obsidian.
- **LaTeX export:** every new object exports to pgfplots/TikZ as numeric coordinates, the same picture as the preview. A pixel layer (E) exports as a PNG beside the .tex file with `\addplot graphics`.
- **Tests:** `tests/<part>*.test.ts` for parse, print (round trip), Full LaTeX, scene output and export of every new line. Run `npm run build` and `npm test` before every commit.
- **Git:** commit on your own branch only. Never push, never touch main, never tag.
- **Never** open the user's Obsidian or vaults. The isolated smoke test (`npm run media:smoke -- --root --port <your port>`) is allowed; use the port your brief gives you.
- **Docs:** write what a user needs to know about your lines (syntax, options, Full LaTeX, examples) into `docs/v6/<part>.md`. The integrator moves it into docs/reference.md, docs/ai.md and the Help guides.

## The words (chart text)

Formulas may be plain or LaTeX in `$...$`, as in 5.x. Every new line also has a Full LaTeX form (`\command[options]{argument}`); the owner picks it after the style of `src/text/full.ts`.

### A. Values

- `let $v = (2, 1)$`, `let $w = \begin{pmatrix} -1 \\ 2 \end{pmatrix}$`, `let $A = \begin{pmatrix} 1.5 & 1 \\ 0.5 & 2 \end{pmatrix}$`, `let $c = -0.8 + 0.156i$`, `let $f(x, y) = x^2 + 4y^2$`, `let $R(\theta) = \begin{pmatrix} \cos\theta & -\sin\theta \\ \sin\theta & \cos\theta \end{pmatrix}$`, `let $S = \{(k, k^2) : k = 1, \dots, 10\}$`. Plain forms: `(2, 1)`, `[[1.5, 1], [0.5, 2]]`, `-0.8 + 0.156i`. Sliders work inside every value.
- In every formula field: `\sum_{k=1}^{n} ...`, `\prod_{k=1}^{n} ...` (bounds may be sliders), `n!`, `\binom{n}{k}`; complex `i`, `|z|`, `\arg z`, `\bar z`, `\overline{z}`, `\Re z`, `\Im z`, `e^{i\theta}`; vectors `v + w`, `2v`, `v \cdot w`, `\|v\|`, `v \times w` (3D); matrices `Av`, `AB`, `A^{-1}`, `A^T`, `\det A`, `\operatorname{tr} A`; `\nabla f` (numeric gradient of a let function).
- `draw v as an arrow`, `draw v and w as arrows, labelled`, `draw v from (1, 1)` (arrow from a point), `draw v + w tip to tail` (the arrows of v and w end to end and the sum).
- `mark the points $\{e^{2\pi i k / n} : k = 0, \dots, n - 1\}$, joined, labelled` (a list of complex numbers or points; `joined` draws the closed polygon through them).
- `plot $T(x) = \sum_{k=0}^{n} \frac{(-1)^k x^{2k+1}}{(2k+1)!}$` (Taylor), `plot $f(x) = \sum_{k=1}^{n} \frac{\sin((2k - 1)x)}{2k - 1}$` (Fourier).
- API for D and E (src/values/index.ts): typed values `number | Complex | Vec | Mat | List`; compile an expression to a function that returns a value, given the scope (sliders, axis variables, let names); `defineValues` on the MathContext; errors as ExprError with positions; `toGlsl` for real and complex scalar expressions (E uses it for the GPU). Plain-number formulas keep today's compiler and speed.

### B. Notes and interaction

- `mark where $g(x) \le 0$ on the x-axis, labelled` (any condition in x: `<`, `\le`, `>`, `\ge`, `|x - 1| < 2`, `and`, `or`); `mark where ... on the y-axis` (a condition in y). A bar on the axis; filled end dots for `\le`/`\ge`, open ones for `<`/`>`; arrows where it runs off the view; label in set notation (`{x | g(x) ≤ 0} = [−2, 2]`, unions, `∅`, `ℝ`). Options: colour, `thick`, `labelled`.
- `draw the chord of g from -1 to 3 at $\lambda$, labelled` (the chord between (a, g(a)) and (b, g(b)), the point at λ on the chord and on the graph, the gap between them; Jensen's inequality).
- **Ask the curve** (editor preview, and the chart under a block in Live Preview): a click on a function opens a menu of questions; pointing at one shows its answer faintly; choosing it adds the object (and its line). Questions for a function f: where f ≤ 0, ≥ 0, < 0, > 0 (on the x-axis); where f crosses the x-axis; where f crosses each other function; where f ≤ g (on the x-axis) for each other g; its extrema; its inflection points; the tangent here; the value here (point with coordinates); the area between f and the x-axis (between two crossings, or from here to a crossing); the area between f and g; a Riemann sum; the chord from here to another point. Also menus for a clicked region (its corners, its border lines, the max / min of a formula in it), a curve (crossings with the axes and other curves) and a point (drop lines, coordinates label). The menu is built from what exists in the chart, so it grows with the chart.
- **Hover cards** (src/formula.ts, src/ui/formulaHover.ts): sets `\{x \in \mathbb{R}^n \mid g(x) \le 0\}`, `\{x \mid ...\}`, `\{(x, y) \mid ...\}`; maps `g: \mathbb{R}^n \to \mathbb{R}`; conditions in one variable (`g(x) \le 0`, `x > 0`, `|x| < 1`, `\lambda \in [0, 1]`, intervals `[a, b]`, `(a, b]`) as sets on an axis; Jensen-type inequalities as a chord with a λ slider; the epigraph `\operatorname{epi} g = \{(x, t) \mid g(x) \le t\}` as the shade above the graph. Names a formula uses without defining them (g) are taken from the other formulas of the same note (`g(x) = x^2 - 4`); when the note has none, the card uses an example (convex, x² − 1) and says so on the card. ℝⁿ formulas get an n = 1 / n = 2 switch (x² reads as x₁² + x₂²).
- **Charts from formulas:** keep the note's function name (`g(x) = ...` stays g); write the x range only, so y fits itself (a chart without a y range fits y to what it draws, live). Charts that have a y range keep it.

### C. Motion

- **Steps:** `then` before any object line starts the next step: `then plot ...`, `then transform the plane by A`. Lines before the first `then` are step 0. In notes and the editor: Play and step buttons in the strip under the chart (print hides the strip, as since 5.2.6); new objects arrive with the motion of `src/motion.ts`; a moving object (D's transform) gets a progress 0..1 for its step. The export shows the last step; the chart line `frames` (Full LaTeX: an `\axis` option) exports every step side by side.
- **Animation clock:** objects that move by themselves (particles, turning circles) ask for a clock; it runs only while the chart is visible, pauses with a button in the strip, and honours reduced motion. The export draws a still frame.
- `draw the vector field $F(x, y) = (y, -\sin x - 0.25y)$` (short arrows, the same length on screen, option `coloured by length`), `, with moving particles` (animated), `, with streamlines` (still curves; the export draws these); `mark the rest points of F` (zeros of F, filled when stable, open when not).
- `draw the solution of $\dot{p} = (y, -x)$ through P for t from 0 to 10` (a 2D system), and in a 3D chart `draw the solution of $\dot{p} = (10(y - x), x(28 - z) - y, xy - \frac{8}{3}z)$ through (1, 1, 1) for t from 0 to 72, coloured by time` (RK4; a 3D curve in the preview and the export).

### D. Linear algebra and complex maps (wave 2)

- `draw the grid` (lines that transforms move), `draw the basis vectors` (î, ĵ), `transform the plane by A` (a matrix value, a literal, `$z \mapsto z^2$` or `$(x, y) \mapsto (x + y, y)$`): it maps every object drawn before it, except the axes; the old grid stays faint. With steps it moves: (1 − t)I + tA, or (1 − t)z + t f(z).
- `draw the eigenvectors of A, labelled`, `shade the unit square, labelled "det A = {det(A)}"` (it moves with the transform), `draw the span of v and w`.
- Drag the tips of î and ĵ (and of arrows of let vectors written as numbers): the numbers in the text change.
- In a 3D chart: `transform space by B` (grid cube, î ĵ k̂).

### E. Iterate and colour the plane (wave 2)

- `draw the orbit of $z_{n+1} = z_n^2 + c$, $z_0 = 0$, $c = P$, 40 steps` (complex, vector or number recurrences; a point list with lines; `as a path`), gradient descent `draw the orbit of $p_{n+1} = p_n - \eta \nabla f(p_n)$, $p_0 = P$, 25 steps`.
- `draw the cobweb of $x_{n+1} = f(x_n)$ from 0.2, 80 steps`, `draw the bifurcation diagram of $x_{n+1} = r x_n (1 - x_n)$ for r from 2.5 to 4`, `draw Newton's method for f from 2.5, 5 steps`.
- `colour the plane by $z_{n+1} = z_n^2 + c$, $z_0 = 0$, $c = x + iy$, 200 steps` (escape time; orbits that settle colour by the point they reach), `colour the plane by $f(z) = \frac{z^2 - 1}{z^2 + 1}$` (domain colouring), `colour the plane by $f(x, y) = ...$, in viridis` (heat map). WebGL in the preview with a CPU path (64-bit) for no WebGL and deep zooms; the export writes a PNG.
- `draw the circles of $\sum_{k=1}^{n} \frac{4}{\pi (2k - 1)} e^{i(2k - 1)t}$, with its wave` (turning circles on C's clock).
