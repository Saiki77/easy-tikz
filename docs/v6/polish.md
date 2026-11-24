# 6.0 F1: polish

What changed for users. Code: small blocks marked `// 6.0 F1` in the shared files, and src/values/order.ts, src/iterate/pick.ts, src/iterate/askOrbit.ts, src/notes6/press.ts. Tests: tests/polish.test.ts.

## A chart reads top to bottom

A printed chart writes its `let` lines right after the sliders, before the functions and tools that use them:

```
slider a from 0 to 2
let v = (2, 1)
plot f(x) = a x
draw v as an arrow
```

A step keeps its own `let` lines first (`then let w = (1, 1)`). The editor puts a new definition (+ Add, Definition, and the recipes that bring a let matrix) before the other tools, and its line after the let lines of the block, else after the sliders. A let line typed below another tool line stays where it is (the tools keep the order of their lines). Charts without let lines print as before.

## Chart words for version 6

Settings, Chart words has a piece for every line, phrase and option of version 6:

| Group | Pieces |
|---|---|
| Lines | `let`, `then`, `frames`, `transform the plane by`, `transform space by`, `colour the plane by` |
| Phrases | `as an arrow`, `as arrows`, `the points of`, `the points`, `on the x-axis`, `on the y-axis`, `the chord of`, `the vector field`, `the rest points of`, `the solution of`, `through`, `the grid`, `the basis vectors`, `the eigenvectors of`, `the image of`, `the unit square`, `the unit cube`, `the span of`, `the orbit of`, `the cobweb of`, `the bifurcation diagram of`, `Newton's method for`, `the circles of`, `steps` |
| Options | `tip to tail`, `joined`, `with moving particles`, `with streamlines`, `coloured by length`, `coloured by time`, `as a path`, `with its wave` |

A chart reads the same in the built-in words and in a person's own words; the plugin writes theirs (also the `then` of a step). The clash check, sharing as text and the "Rewrite N charts" offer work for them as for the others. Built-in words now compare without case (`Newton's method for`).

## Labels

- A `$...$` label never wraps onto a second line (MathJax may break long inline math at `=` or `∪`).
- The chart in a formula's hover card draws once more when MathJax has styled a new label, so its labels have their real size.
- A set on an axis whose label would take more than three quarters of the plot's width (a small chart such as the hover card, a long union) is labelled with the set alone: `[-1.732, 0] ∪ [1.732, ∞)` instead of `{x | x³ - 3x ≥ 0} = [-1.732, 0] ∪ [1.732, ∞)`.
- Auto-fit (and the y that follows a chart without a y range) leaves room for the labels of `mark the points ..., labelled`: about as far out as each label is long, on its side. The roots of unity stay clear of the plot border.

## Ask the curve

- On touch, a long press (half a second) opens the questions while the finger rests; a tap still works.
- A click on an orbit: More steps (twice), Fewer steps (half), Label its points (z₀, z₁, ...). The step questions need a number of steps (not a slider).
- A click on a coloured plane made from a recurrence whose plane point is `x + iy` (the Mandelbrot set: `c = x + iy`; a Julia set: `z_0 = x + iy`): "The orbit of this point" adds `mark P at (a, b)` at the click and `draw the orbit of $z_{n+1} = z_n^2 + c$, $z_0 = 0$, $c = P$, 40 steps` (P2, P3, ... when P is taken). Heat maps and domain colouring ask nothing.

## Smaller fixes

- A function a transform moves keeps its legend entry (the preview's legend, and `\addlegendimage` + `\addlegendentry` in the export).
- Label placeholders may hold any value a label prints: `write "v = {v}, A^-1 = {A^(-1)}" at (1, 2)` has no problem.
- `$\|v\|$` (and `\lVert v \rVert`) is the length of v in every formula field.
- In a 3D chart the lines of part E (coloured planes, orbits, cobwebs, bifurcation diagrams, Newton's method, turning circles) say "... is drawn in 2D charts only".
- Full LaTeX: a solution writes its points once, several points as `through={P, (1.5, 1)}`; `\vectorfield[colormap/heat]` keeps its colour map through words and back.
- A chart with steps keeps its lines and comments when the editor (or an Ask answer) changes it: a new object goes to the end of its step (`then` before it when it starts a new last step); a moved line keeps the steps where they start and writes its own step when it lands in another one (`step=0`, `step=2`); a deleted line that started a step leaves its `then`. `step=0` written out means the first step.

## Not done

- Item 4 of the brief (the 3D clock and `traced`) went to F4.
- The orbit questions change the steps only when they are a number.
- "The orbit of this point" is not ticked after it went in (each click adds another point and orbit).
