# 6.0 F2: guides and examples

Working material for the integrator. What part F2 added to the Help tab, the Showcase, the editor's examples and the AI tools. Media (docs/guides/*.md, screenshots) are not made yet: they come after the user's OK on a sample (`npm run media:guides` reads the same data).

## Help guides (14, English and Japanese)

One step per screen, each step a live chart (steps with `then` play in the Help with the player of part D). Two new categories, after Regions and optimisation: **Linear algebra and complex numbers** (線形代数と複素数) and **Dynamics and fractals** (力学系とフラクタル).

| id | Title | Category | Steps | File |
|---|---|---|---|---|
| `values-let` | Vectors, matrices and complex numbers | Chart language | 4 | src/guides/values.ts |
| `sums-series` | Sums: Taylor and Fourier series | Calculus | 4 | src/guides/values.ts |
| `ask-curve` | Ask the curve | Getting started | 5 | src/guides/interact.ts |
| `sets-convexity` | Sets and convex functions | Regions and optimisation | 4 | src/guides/interact.ts |
| `formula-cards` | Cards of sets, matrices and sums | Notes and export | 5 | src/guides/interact.ts |
| `steps-frames` | Steps you can play | Notes and export | 4 | src/guides/interact.ts |
| `vectors-arrows` | Vectors and arrows | Linear algebra and complex numbers | 4 | src/guides/linear.ts |
| `matrix-plane` | A matrix moves the plane | Linear algebra and complex numbers | 4 | src/guides/linear.ts |
| `complex-maps` | Complex numbers and maps | Linear algebra and complex numbers | 4 | src/guides/linear.ts |
| `fractals` | Fractals: Mandelbrot, Julia and Newton | Dynamics and fractals | 4 | src/guides/dynamics.ts |
| `orbits-cobwebs` | Orbits, cobwebs and bifurcation | Dynamics and fractals | 5 | src/guides/dynamics.ts |
| `vector-fields` | Vector fields and rest points | Dynamics and fractals | 5 | src/guides/dynamics.ts |
| `systems` | Solutions of systems in 2D and 3D | Dynamics and fractals | 4 | src/guides/dynamics.ts |
| `descent-newton` | Gradient descent and Newton's method | Regions and optimisation | 5 | src/guides/dynamics.ts |

Japanese: `src/guides/{values,interact,linear,dynamics}.ja.ts`, registered in src/guides/ja.ts.

The title of `sets-convexity` has no "axis": the search test wants "ax" to find the formulas guide first, and a title word "axis" would win it.

## Showcase pages (6 of F2, English and Japanese)

In src/guides/showcase.ts (and showcase.ja.ts), first in the Showcase, so the Help's gallery and the empty Build tab open with them.

| id | Title | Steps |
|---|---|---|
| `mandelbrot-orbit` | The orbit of a point in the Mandelbrot set | 3 |
| `matrix-grid` | A matrix with a slider moves the grid | 4 |
| `lorenz-butterfly` | Two paths of the Lorenz system | 3 |
| `pendulum-field` | A pendulum as a vector field | 4 |
| `domain-colouring` | Colour the plane by a complex function | 3 |
| `fourier-circles` | Circles that draw a square wave | 3 |

### 6.0 showcase: the other prototypes of the plan page (5 new, 2 changed)

Every prototype of the plan page has a Showcase page now. In src/guides/showcase.ts (and showcase.ja.ts), English and Japanese, each step a live chart.

| id | Title | Steps | What moves |
|---|---|---|---|
| `complex-two-ways` | Complex functions, seen two ways | 6 | z², 1/z and e^z each bend a grid in a `then` step (Play), then colour the plane (domain colouring); the e^z grid runs from -π to π, so it wraps once round |
| `two-valleys` | Gradient descent in a bowl and two valleys | 5 | slider `eta`, start P (`mark P at`, or `P: mark (a, 1.6)` on a slider; both drag in the editor), the path `traced`; η = 0.27 zigzags out of the bowl; in two valleys the ridge at x = 0.15 decides the valley |
| `julia-newton` | Julia sets and Newton basins | 5 | c = a + bi on sliders (rabbit, -0.8 + 0.156i, dust at 0.45 + 0.45i); Newton basins of z³ - 1 with P on sliders and its orbit `traced` |
| `logistic-map` | The logistic map: bifurcation and cobweb | 5 | the diagram with the slider r as a dashed line, then the cobweb at 3.2, 3.5, 3.9 |
| `unity-roots` | Roots of unity on a slider | 4 | n from 2 to 10 (labels ω⁰ to ω⁹: `labelled "$\omega^ {i - 1}$"`, a value cannot go inside a LaTeX group), the orbit of z ↦ ωz `traced`, the colouring of zⁿ - 1 |
| `lorenz-butterfly` (changed) | Two paths of the Lorenz system | 3 | both paths `traced` (and `turning` as before): they draw themselves and part while you watch |
| `fourier-circles` (changed) | Circles that draw square and sawtooth waves | 4 | five circles first (the plan's n), and a last step with a sawtooth: `\sum_{k=1}^{n} \frac{2(-1)^{k+1}}{\pi k} e^{ikt}` |

The ids avoid the ids of V6_EXAMPLES (`roots-of-unity`, `julia`, ...): the test wants ids unique among examples and guides.

**Order.** The gallery orders guides by category (GUIDE_CATEGORIES) and inside a category as the data file lists them; nothing else was reordered. SHOWCASE_GUIDES starts with the 11 pages of version 6, the ones that move first: Lorenz, complex functions, Fourier circles, two valleys, Mandelbrot orbit, pendulum, Julia and Newton, matrix grid, logistic map, domain colouring, roots of unity; then the 5.2 pages. The Showcase chip so shows the 6.0 pages first, and in the "All" view (Chart language has two tiles besides the tour) Lorenz and complex functions are tiles 3 and 4, in the first row. The empty Build tab and the editor's menu list the Showcase charts in the same order.

**Tests.** tests/guides.test.ts: the new ids in DOCUMENTED; the Showcase starts with the 6.0 pages and the gallery shows two of them in its first four tiles; the moving parts move (`turning` and `traced` on the Lorenz paths, traced orbits, a `then` transform on every grid step of `complex-two-ways`, a sawtooth sum in the last Fourier step); the numbers the steps name (the bowl settles at 0 for η = 0.2 and leaves at 0.27; right of x = 0.15 the shallow valley, left of it the deep one; the titles print c, inside the Mandelbrot set at step 1 and outside at step 3; P reaches the root 1; the cobweb at r = 3.2 ends on one of its two values; n steps of z ↦ ωz come back to 1). tests/guides-ja.test.ts covers the Japanese as for every guide.

Screenshots (isolated Obsidian): `scratchpad/showcase-shots/` (the gallery with the Showcase chip, one picture per new page).

## Examples (12)

`src/guides/examples.ts`: `V6_EXAMPLES` (ChartExample, title and description in English and Japanese), exported from src/guides/index.ts. One chart for each main new line that no Showcase page shows. The editor lists them after the Showcase charts and the examples of src/migrate.ts (src/ui/buildPanel.ts, src/modal.ts); the AI tools list them after EXAMPLES and before the guides' charts (src/ai/charttool.ts `examples()`, so `list_examples` and `get_example`).

| id | Title |
|---|---|
| `vectors` | Vectors and a matrix |
| `taylor` | Taylor polynomial as a sum |
| `roots-of-unity` | Roots of unity |
| `convex-set` | A set on the x-axis and a chord |
| `limit-cycle` | A system with a limit cycle |
| `complex-square` | z ↦ z² bends a grid |
| `gradient-descent` | Gradient descent |
| `cobweb` | Cobweb of the logistic map |
| `bifurcation` | Bifurcation diagram |
| `newton` | Newton's method |
| `julia` | Julia set with sliders |
| `newton-basins` | Newton basins |

With the Showcase charts they cover every tool type of 6.0 but `span` (a test checks the list).

## Tests and checks

- tests/guides.test.ts: the new files in DOCUMENTED and FILES; every chart of every guide loads with zero issues, exports and keeps the word limits (as before); two new tests for V6_EXAMPLES (unique ids among all examples and guides, zero issues, export; every main new line drawn by an example or a Showcase chart); one test that the numbers the steps name (det A = 2.5, [-2, 2], the gap below 0, √2, the crossings) are the ones the charts compute.
- tests/guides-ja.test.ts: the two new category names; the Japanese of V6_EXAMPLES in the Japanese style.
- scripts/media/smoke.mjs: the example tile count includes V6_EXAMPLES, and each one loads in the editor without an issue. The part E check "a slider repaints the plane" now reads the preview's canvas (`.etz-stage`): it read the first canvas of the modal, which is now a Showcase tile of the Help gallery.

## Shared files changed (blocks marked `// 6.0 F2`)

- src/guides/types.ts, src/guides/index.ts (two categories, the new files, `V6_EXAMPLES`), src/guides/ja.ts, src/guides/showcase.ts, src/guides/showcase.ja.ts.
- src/i18n/en/help.ts, src/i18n/ja/help.ts (the two category names), src/i18n/README.md (the terms).
- src/ui/buildPanel.ts: `V6_EXAMPLES` in the list; and example thumbnails keep a picture layer (a canvas that `cloneNode` loses) as an `<image>` painted on the CPU (`pixelImage`), so the Mandelbrot, Julia, Newton, domain colouring, heat map and bifurcation tiles are not empty.
- src/modal.ts: `V6_EXAMPLES` in the editor's menu.
- src/ai/charttool.ts: `V6_EXAMPLES` in `examples()`; `axisSet` and `chord` are known tool types (check refused part B's lines as an unknown "type").
- src/ai/mcp.ts: the description of `list_examples`.
- scripts/media/smoke.mjs: tile count, a check per example of 6.0, the preview's canvas in the part E check.
- tests/guides.test.ts, tests/guides-ja.test.ts, tests/full.test.ts, tests/text.test.ts.

## What keeps npm test red (not F2's to fix)

The guides are the first built-in charts with 6.0 lines, and tests/full.test.ts and tests/text.test.ts check every built-in chart. Two test changes were the tests' own: the 6.0 Full LaTeX commands (`\let`, `\then`, `\vectorfield`, `\restpoints`, `\solution`, `\transform`, `\orbit`, `\cobweb`, `\bifurcation`, `\newton`, `\colourplane`, `\circles`) count as commands, and a recolour picks a colour the object does not have (the basis vectors are green without a colour). What is left:

1. **tests/full.test.ts, 4 tests**: bugs in src/text/full.ts (F1's area, left alone):
   - words to Full LaTeX of a solution repeats its points: `\solution[through=P, t=0:8, through=P]` (the bar of `motionWords` does not count `through` as taken: it is not in `TAKES_VALUE`);
   - `\vectorfield[colormap/viridis]` to words and back is `\vectorfield[viridis]` (`motionFull` reads a bare colour map name as a plain option);
   - from the first: a solution through `P and (1.5, 1)` prints as `\raw[tool]{...}`, and recolouring a solution rewrites 4 lines;
   - adding an object after a `\then` line writes the whole block anew with `step=` options, and its comments are lost (the random edit test, "add region" on `matrix-grid` step 2).

   This patch fixes the first three (3 of the 4 tests pass with it, checked in a copy):

   ```diff
   -const TAKES_VALUE = new Set(['name', 'at', 'in', 'levels', 'labels', 'text', 'from', 'to' /* 6.0 A, B */]);
   +const TAKES_VALUE = new Set(['name', 'at', 'in', 'levels', 'labels', 'text', 'from', 'to' /* 6.0 A, B */, 'through']);
   ...
            if (c) return `colormap/${(c[1] ?? 'viridis').toLowerCase()}`;
   +        if (isColormap(o.trim().toLowerCase())) return `colormap/${o.trim().toLowerCase()}`;
            if (/^moving\s+particles$/i.test(o.trim())) return 'particles';
   ```

   The fourth needs a decision in the writer (keep the block and write the new line with its step, or accept a new block for charts with steps, as the test accepts for a shape moved above the one it reads).
2. **tests/whatsnew.test.ts, 1 test**: docs/guides has no page for the 20 new guides (media come after the user's OK on a sample: `npm run media:guides`), and README.md and docs/guides/README.md count the old number of guides (F3).

## For the integrator

- docs/ai.md (F3) still names the old examples for `list_examples`; the tool's description in src/ai/mcp.ts now says vectors, sums, fractals, orbits, systems.
- A guide step cannot drag (the Help has sliders only), so the steps that drag (î, ĵ, a vector tip, P) say "In the editor" and show the chart after the drag.
- Media: `npm run media:guides` makes docs/guides/<id>.md for the 20 new ids.

## The Help home (6.0 help)

The gallery with 11 category chips is gone. The home (src/ui/helpPanel.ts) reads its groups from src/guides/home.ts; the guides keep their categories (docs/guides and the AI tools use those).

1. Search; Start here (Getting started); "Write a chart in words", a smaller card.
2. **New in 6**: `lorenz-butterfly`, `complex-two-ways` (its tile shows step 2, the coloured plane of z²), `fourier-circles`, `mandelbrot-orbit`, as taller tiles.
3. Topic sections, each a heading, one line, its first 4 tiles and "Show all N" (opens the rest in place):

| Section | Guides |
|---|---|
| Basics and the chart language | Chart language (not the tour, GeoGebra, Python, let values), Points, lines and labels |
| Showcase | Showcase, without the 4 of New in 6 and the 3 Python pages |
| Functions and calculus | Functions and sliders, Calculus |
| Regions, optimisation and data | Regions and optimisation, Data and probability |
| Linear algebra and complex numbers | `values-let` first, then the category |
| Dynamics and fractals | the category |
| Scripting: Python and GeoGebra | `python-chart`, `geogebra-commands`, `python-heart`, `python-plot`, `python-wave` |
| 3D | `surfaces-3d`, and the 3D guides of other sections (`systems`) |
| Notes, export and AI | Notes and export, and a link to the AI tab |

4. The Reference (its 2 guides and the 15 sections of the cheat sheet) as a compact list at the end.

Four tiles in a row, two at narrow widths: no section is taller than two rows until "Show all". tests/help-home.test.ts: every guide is on the home in one place of its own, New in 6, the sections, the texts in English and Japanese.
