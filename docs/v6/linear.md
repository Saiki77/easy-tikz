# 6.0 D: linear algebra and complex maps

Working material for the integrator (docs/reference.md, docs/ai.md, the Help guides). Code: `src/linear/`; small blocks marked `// 6.0 D` in the shared files. Tests: `tests/linear-text.test.ts`, `linear-scene`, `linear-ask`, `linear-drag`, and the `linear-*` charts of `tests/latex.test.ts`.

The look is 3Blue1Brown's "Essence of linear algebra": the grid moves, î and ĵ land on the columns of A, the old grid stays faint.

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

In a note: step 1 shows the grid, î, ĵ and the unit square; Play (or Next) moves them to A in 0.7 s, (1 − t)I + tA; step 3 adds the eigenvectors with their λ. The PDF shows the last step; with `frames`, every step side by side.

## The grid

```
draw the grid
draw the grid from -2 to 2 in steps of 0.5
draw the grid from -1.5 to 1.5 in steps of 0.25 in red, thick
```

The lines x = k·s and y = k·s from `from` to `to` (both axes; formulas, sliders allowed). Without a range the grid reaches twice as far as the view, so a shear or a stretch still fills the view. Steps default to 1; at most 401 lines per direction (a problem names the count). The lines through 0 are stronger (they show where the axes go). In 3D: the lines of a grid cube (default from -1 to 1 up to -3 to 3, as the box allows; at most 21 values per axis).

- Options: a colour (default blue), `thin`, `thick`, `hidden`.
- When a transform moves the grid, a faint gray copy stays where it was (3D: thin, dashed).
- Tool `planeGrid` (`from`, `to`, `spacing`, `thickness`), names G1, G2, ...
- Full LaTeX: `\draw[grid]`, `\draw[grid, from=-2, to=2, spacing=0.5]`.

## The basis vectors

```
draw the basis vectors
draw the basis vectors in blue, thin
```

î = (1, 0) in green and ĵ = (0, 1) in red (3D: k̂ = (0, 0, 1) in blue), very thick arrows with `$\hat{\imath}$`, `$\hat{\jmath}$`, `$\hat{k}$` beside the tips. Any colour but green draws all of them in it.

- Options: a colour, `thin`, `thick`, `hidden`; `valueLabel=false` leaves the labels out.
- Drag: when one matrix moves them all the way, the tips of î and ĵ are drag handles. Dragging ĵ writes column 2 of the matrix (the let value `A`, or the transform's own matrix when it is written there), when every entry is a plain number (`[[1, 1], [0, 1]]` or `\begin{pmatrix} 1 & 1 \\ 0 & 1 \end{pmatrix}`); otherwise the chip says why it cannot.
- Tool `basisVectors` (`thickness`, `valueLabel`), names BV1, ...
- Full LaTeX: `\draw[basis vectors]`.

## Transform the plane

```
transform the plane by A
transform the plane by $\begin{pmatrix} 0 & -1 \\ 1 & 0 \end{pmatrix}$
transform the plane by [[2, 0], [0, 0.5]]
transform the plane by $z \mapsto z^2$
transform the plane by $z \mapsto \frac{1}{z}$
transform the plane by $(x, y) \mapsto (x + y, y)$
transform the plane by f                 (a let function f(z), or f(x, y) of 2 numbers)
transform space by B                     (3D: a 3 x 3 matrix or (x, y, z) ↦ ...)
then transform the plane by A            (moves while its step comes in)
```

It moves every object drawn before it: the functions of its step or an earlier one, and the tools above it in the list (of its step or an earlier one): curves, regions, points, segments, arrows, the grid, sets on an axis, labels of those objects (their spots move with them). The axes, the background grid, text labels (`write ...`) and objects after it stay. Several transforms apply in order (the first, then the second).

- The map: a matrix (a let name, a plain or LaTeX literal; sliders allowed) of the chart's size; or a map written with `\mapsto` (also `|->`, `->`, `↦`): `z ↦ ...` (complex numbers; `w` too), `(x, y) ↦ (..., ...)`, `v ↦ A v` (a vector).
- In a step (`then`): progress t from 0 to 1 while the step comes in: (1 − t)I + tA, or (1 − t)z + t f(z). Before its step: nothing moves (the transform is hidden); after: settled. Going back shows a step settled.
- A map that bends lines (z ↦ z²) cuts every line into short pieces first and breaks it where it jumps (a pole) or leaves the view far behind.
- Functions it moves: the transform draws them (sampled two views to each side); the renderer and the export leave their curves out (`Scene2D.movedFunctions`). Their legend entries are left out too.
- Option: `hidden`.
- Tool `transform` (`map`), names T1, ...
- Full LaTeX: `\transform{A}`, `\transform{z \mapsto z^2}` (reads as `transform by ...` in both 2D and 3D).
- Export: everything as coordinates at the last step (progress 1); the faint grid with `draw opacity=0.35`.

## Eigenvectors

```
draw the eigenvectors of A, labelled
draw the eigenvectors of [[2, 1], [1, 2]], dashed
```

The lines through 0 along the real eigenvectors of a 2 x 2 (3D: 3 x 3) matrix, well past the view, with `λ₁ = 2.5`, `λ₂ = 1` (`λ = 1` for one) along them. Complex eigenvalues: no lines, an info note on the card ("No real eigenvectors: λ = 0 ± 1i. The matrix turns every line.") and, `labelled`, the same as a label at the top left. A = λI: lines in 8 directions, labelled "every vector: λ = 2".

- Options: a colour (default orange), `thin`, `thick`, `dashed`, `labelled`, `hidden`.
- Tool `eigenvectors` (`matrix`, `thickness`, `dashed`, `valueLabel`), names EV1, ...
- Full LaTeX: `\draw[eigenvectors, labelled]{A}`.

## The unit square

```
shade the unit square, labelled
shade the unit square, labelled "det A = {det(A)}"
shade the image of the unit square, labelled
shade the unit cube, labelled            (3D)
```

The square [0, 1]², shaded (default purple, opacity 0.3) with its outline. Drawn before a transform, it moves with it and its label follows (the label sits at its middle). `the image of the unit square`: the square moved by the transforms above it (for a line added after the transform, as Ask does), and by those below it like any object.

- `labelled`: its signed area now: `area = 1` before any move, `det A = 2.5` when one named matrix (or a product, `det (BA)`) has moved it all the way, `area = 1.73` while it moves, `area ≈ 0.8` under a map that bends it. 3D: the volume.
- `labelled "text"`: a template; locals `area` (signed) and `det`.
- Options: a colour, `opacity 0.3`, `labelled`, `labelled "text"`, `hidden`.
- Tool `unitSquare` (`image`, `fillOpacity`, `label`, `valueLabel`), names U1, ...
- Full LaTeX: `\shade[unit square, labelled]`, `\shade[unit square, image]`, `\shade[unit cube]`.

## Span

```
draw the span of v and w, labelled
draw the span of v
draw the span of (1, 2) and (2, 4)
```

The span of vectors (let names or formulas): the whole plane (shaded, opacity 0.15), a line through 0, or the point 0. 3D: a line, a plane (a mesh of lines) or all of space. `labelled`: `span(v⃗, w⃗) = ℝ²` (the export adds amssymb), `span(v⃗)` along the line.

- Options: a colour (default teal), `thin`, `thick`, `opacity 0.15`, `labelled`, `hidden`.
- Tool `span` (`vectors`, `fillOpacity`, `thickness`, `valueLabel`), names SP1, ...
- Full LaTeX: `\draw[span]{v, w}`.

## Drag the tips of vectors

Arrows of let vectors (`draw v as an arrow`, also from a point) whose definition is written as numbers (`let v = (2, 1)`, `let $v = \begin{pmatrix} 2 \\ 1 \end{pmatrix}$`) get drag handles at their tips (part A drew them without): the drag writes the new numbers, rounded to what the pixel shows (Alt: one more decimal). Arrows moved by a transform have no handles while moved. Undo, Escape and the card follow as for other drags.

## Ask the curve

A click on an arrow, on the moved grid or on a function a transform draws opens questions:

| Clicked | Questions |
|---|---|
| a transform by a matrix (its grid lines) | its eigenvectors; the image of the unit square with det; the span of its columns; the inverse transform in the next step (`transform the plane by $A^{-1}$, step=2`); a function it moves (y = x²/4, in its step) |
| a transform by a map of points | the image of the unit square; a function it moves |
| a grid no transform moves | a shear in the next step; the basis vectors |
| an arrow of a let vector v | its span; the span of v and w, v + w tip to tail (each other let vector w); A v as an arrow (each let matrix A) |
| the basis vectors | the image of the unit square; the eigenvectors of the matrix that moves them |

Kinds `vector` and `transform` (src/notes6/ask.ts AskKind); providers in src/linear/ask.ts, what a click hits in src/linear/pick.ts.

## Hover cards

| Formula | Card |
|---|---|
| `\begin{pmatrix} 2 & 1 \\ 0 & 1 \end{pmatrix}`, `A = \begin{pmatrix} ... \end{pmatrix}` (2 x 2 or 3 x 3) | the grid, î, ĵ and the unit square moved by (1 − s)I + sA, a slider s from 0 to 1 |
| `A v`, `A\vec{v}` | v and A v as arrows, the grid moving with s |
| `\det A`, `\det(A)` | the unit square and its area, moving with s |
| `A v = \lambda v` | the eigenvectors of A, the grid moving with s |

A and v come from the note's formulas (`A = \begin{pmatrix} ... \end{pmatrix}`, `v = (1, 1)`); without them the card uses an example (A = [[2, 1], [1, 2]], v = (1, 0.5)) and says so. The slider is s (t is an axis variable). These formulas are marked by "Highlight formulas in notes" too.

## The player in Help and What's new

Live charts (src/ui/liveChart.ts) with steps or moving objects get the player of notes: Previous, Play, Next, "Step k of n", and Pause for moving objects, above the sliders. A chart without steps is drawn as before.

## Editor

Build tab cards: Grid (from, to, steps, line), Basis vectors (line, Labels), Transform (By: the matrix or map, a hint), Eigenvectors (matrix, line, Dashed, Labels), Unit square (Image under the transforms above, Labels, label, opacity), Span (vectors, opacity, line, Labels). + Add, section Linear algebra: Transform the plane by a matrix (a let matrix A when the chart has none, the grid, î, ĵ, the unit square labelled, and the transform in the next step; 3D: Transform space by a matrix), Eigenvectors, Grid and basis vectors, Complex map z ↦ f(z) (2D: a small grid that z ↦ z² bends in the next step).

## Not done in this part

- The chart words (Settings, Chart words) have no pieces for these lines: they are read in the built-in words only.
- In 3D the faint grid cube is drawn thin, dashed and gray (3D lines have no opacity).
- A function moved by a transform has no legend entry; it cannot be dragged or asked about at its old place (it is the transform's line now).
- The live chart player was checked in the build only, not with a guide in Obsidian (no guide has steps yet).
