# 6.0 B: notes and interaction

Working material for the integrator (part F): what a user needs to know about the lines, the menu and the cards of part B. Code: `src/notes6/`.

## A set on an axis

```
show x from -5 to 5
plot $g(x) = x^2 - 4$ in blue, thick
mark where $g(x) \le 0$ on the x-axis, labelled
```

`mark where <condition> on the x-axis` marks the set of x where the condition holds, as a bar on the x-axis. `on the y-axis` does the same with a condition in y.

- The condition: anything a region takes, in one variable: `<`, `\le`, `>`, `\ge`, `|x - 1| < 2` (write bars in `$...$`), chains (`0 \le x < 1`), `and`, `or`. Also an interval, `x \in [0, 1)` (on the x-axis the letter may be another one: `\lambda \in [0, 1]` is `0 <= x <= 1`), and an equation, `g(x) = 0`: its zeros, as dots.
- On the x-axis y is 0 (on the y-axis x is 0), so `mark where $x^2 + y^2 = 4$ on the x-axis` gives where the circle crosses the x-axis.
- The picture: a bar on the axis (at y = 0, or at the bottom edge when 0 is out of view); a filled dot at an end that belongs to the set (`\le`, `\ge`, `=`), an open dot at one that does not (`<`, `>`); an arrow where the set runs off the view.
- `labelled`: the set in set notation, `{x | g(x) ≤ 0} = [-2, 2]`, with unions (`(-∞, -2) ∪ (2, ∞)`), points (`{-2, 2}`), `∅` and `ℝ`. More than four pieces end in `∪ …`.
- Options: a colour (default teal), `thin`, `thick` (default very thick), `labelled`, `labelled "text"`, `hidden`.
- Computed values: `AX1_n` (the number of ends), `AX1_x`, `AX1_x2`, ... (the ends, left to right; on the y-axis `AX1_y`, `AX1_y2`, ...), `AX1_val` (the number of pieces).
- Full LaTeX: `\mark[x-axis, labelled]{g(x) \le 0}` (`y-axis` for the y-axis).
- Export: the bar and the arrows as `\draw`, the dots as marks (open dots: `fill=white`), the label as a node. A label with ℝ adds `\usepackage{amssymb}` to the document (or a `% Needs:` line).
- + Add: Calculus, "Set on the x-axis".

## A chord

```
slider lambda from 0 to 1, starting at 0.3
plot $g(x) = x^2/2 - 1$ in blue
draw the chord of g from -1 to 3 at $\lambda$, labelled
```

`draw the chord of g from a to b` draws the segment from (a, g(a)) to (b, g(b)) with its ends. `at λ` adds the point x = λa + (1 − λ)b, as in Jensen's inequality g(λa + (1 − λ)b) ≤ λg(a) + (1 − λ)g(b): the point on the chord, the point on the graph (in the function's colour) and the gap between them (dashed).

- a, b and λ are formulas (sliders allowed).
- `labelled`: `λ g(-1) + (1 - λ) g(3) = 2.3` at the point on the chord and `g(1.8) = 0.62` at the point on the graph. `labelled "text"` takes the locals `lambda`, `x`, `chord`, `graph`, `gap`.
- Options: a colour (default red), `thin`, `thick` (default), `dashed`, `labelled`, `hidden`.
- Computed values: `CH1_x` (x at λ), `CH1_y` (the chord there), `CH1_val` (the gap, chord minus graph: at least 0 for every λ when g is convex). Without `at`, the ends: `CH1_x`, `CH1_y`, `CH1_x2`, `CH1_y2`.
- Full LaTeX: `\draw[chord, from=-1, to=3, at=\lambda, labelled]{g}`.
- + Add: Calculus, "Chord (Jensen)" (adds the slider lambda).

## y follows what is drawn

A chart whose text gives x and no y (`show x from -5 to 5`) now fits y to what it draws, live: when a slider moves, when x changes, when an object is added. Before 6.0 such a chart showed the default y range, -0.5 to 5.

- Charts with a y range keep it. Charts without any range (no `show` line) and JSON blocks are as before.
- The chart field is `fitY` (true). The printer writes x only; writing y (the Chart tab, a pan, a zoom, Fit) turns it off. The Chart tab says so under the ranges.
- In the hover card of a formula a pan or zoom moves x only (y follows).

## Charts from formulas

Insert chart (the hover card, the command) and the sample of "Default chart for formulas" now:

- keep the note's name of a function: `$g(x) = x^2 - 4$` becomes `plot $g(x) = x^2 - 4$` (f, g, h for formulas without a name, for `g'(x)` and `g^{-1}(x)`, and when the name is one of the formula's sliders);
- write the x range only for a function (`show x from -5 to 5`), so y follows. Equations, regions and surfaces fit both axes as before.

## Ask the curve

A click on a curve of a chart opens a menu of questions about it: in the editor's preview, and in the chart under a block in Live Preview. A click that moves (a pan, a drag of the curve) asks nothing. On touch a tap asks. From the keyboard: in the editor, `?`, the menu key or Shift+F10 on the preview (the questions of the selection, else of the first function); under a block, Enter, Space or the menu key on the chart.

Pointing at a question (or moving the focus onto it) shows its answer faintly. Choosing it (click, tap, Enter, Space) adds it; a question whose answer is in the chart already is ticked, and choosing it takes the answer away. In the editor the answer is an edit with Undo and Redo; under a block it goes into the block's text (the note's Undo takes it back). Arrow keys, Home and End move in the menu; Escape and a press outside close it.

### The questions

A function f (y = f(x)), clicked at x = a:

| Question | Answer |
|---|---|
| Where is f ≤ 0? / ≥ 0? / < 0? / > 0? | `mark where $f(x) \le 0$ on the x-axis, labelled` (and `\ge`, `<`, `>`) |
| Where does f cross the x-axis? | `mark where $f(x) = 0$ on the x-axis, labelled` |
| Its maxima and minima | f `with its extrema` |
| Its inflection points (when it has some in view) | `mark (x1, f(x1)) and (x2, f(x2)), with coordinates` |
| The tangent here | f `with its tangent at a` |
| The value here, with its coordinates | `mark (a, f(a)), with coordinates` |
| A chord from here, with a slider λ | `slider lambda ...` and `draw the chord of f from a to b at $\lambda$, labelled` |
| The area to the x-axis | `shade under f from x = p to q` (the crossings around a, or a and one crossing, or the view) |
| A Riemann sum | `slider n ...` and `draw the left Riemann sum of f from p to q with n parts, labelled` |
| For each other function g: where do f and g cross? | `mark where f and g cross, with coordinates` |
| ... where is f ≤ g? | `mark where $f(x) \le g(x)$ on the x-axis, labelled` |
| ... the area between f and g | `shade between f and g from x = p to q` (the crossings around a) |

A region R: its corners (`mark the corners of R, with coordinates`), outline its border, the lines of its conditions, its highest, lowest, rightmost and leftmost point (`mark the maximum of y in R, with coordinates`, ...).

A curve C (an equation): where it crosses the x-axis and the y-axis (`mark where $<equation>$ on the x-axis, labelled`), where it crosses each function and each other curve.

A point P (of a points tool, computed ones too): lines to the axes, its coordinates.

### Adding questions (parts D and E)

`src/notes6/ask.ts`:

```ts
import { registerQuestions, AskContext, Question } from '../notes6/ask';

// Kinds: 'function' | 'region' | 'curve' | 'point'. Returns a function that takes the provider away again.
registerQuestions('function', (ctx: AskContext): Question[] => {
    const f = ctx.target.name;                     // what was clicked, ctx.target.x / .y where
    return [{
        id: 'newton',                              // unique in the menu
        group: 'Iterate',                          // heading (the reader's language: use t())
        label: `Newton's method from here`,        // menu text (the reader's language)
        answer: { lines: [`draw Newton's method for ${f} from ${ctx.num(ctx.target.x)}, 5 steps`] },
    }];
});
```

- `ctx`: `target` (kind, name, x, y), `data` (the chart as stored), `view`, `math` (slider values set), `functions`, `tools`, `parameters`, `num(v)` (a number as a line writes it), `formula(src)` (in `$...$` when LaTeX), `freeName(wanted)` (a name nobody has), `otherFunctions(but)`.
- An answer is `lines` (chart lines in the built-in words, added at the end of the block; a `slider` line whose name the chart has is left out) and/or `patch: { list: 'functions' | 'tools', name, on, off }` (fields of an object set to `on`; taking the answer away sets `off`).
- The hosts call `askQuestions`, `answerPresent`, `applyAnswer` and `removeAnswer`; nothing else is needed for a new question. A new kind of object to click needs a case in `pickTarget` and in `AskKind`.

## Hover cards

New cards (formulas that had none; today's formulas keep their cards exactly):

| Formula | Card |
|---|---|
| `\{x \in \mathbb{R}^n \mid g(x) \le 0\}`, `\{x \mid ...\}`, `\{x : ...\}` | the set on the x-axis (with the graph of g); n = 2: the region in the plane |
| `\{(x, y) \mid ...\}` | the region |
| `g: \mathbb{R}^n \to \mathbb{R}` | the graph of g; n = 2: its level curves |
| `g(x) \le 0`, `x > 0`, `\|x\| < 1`, `n \ge 3` | the set on the x-axis (another letter names the x-axis) |
| `\lambda \in [0, 1]`, `[a, b]`, `(a, b]` | the interval on the axis (letters as ends become sliders) |
| `g(\lambda x + (1-\lambda) y) \le \lambda g(x) + (1-\lambda) g(y)` | the chord of g with a slider λ |
| `\operatorname{epi} g = \{(x, t) \mid g(x) \le t\}` | the shade above the graph, labelled epi g |

- A function a formula uses without defining it (g) comes from the other formulas of the note (`g(x) = x^2 - 4`, also `:=`), with its sliders. When the note has none, the card uses the example g(x) = x² − 1 and says so on the card.
- ℝⁿ: the card has an n = 1 / n = 2 switch. For n = 2, g(x) reads as g(|x|), so x² is x₁² + x₂².
- These formulas are marked by "Highlight formulas in notes" too.

## Not done in this part

- The chart words (Settings, Chart words) have no pieces for `mark where ... on the x-axis` and `draw the chord of`: those lines are read in the built-in words only.
- A long press on touch: a tap asks, as a click does.
- Ask in Reading view: a click there still opens the editor (whose preview asks).
- A hover card's chart for Jensen does not say whether the inequality holds at λ (the gap `CH1_val` is there for a label).
