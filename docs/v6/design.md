# 6.0 F4: Design pass for moving pictures

Working material for the integrator (docs/reference.md, docs/ai.md, the Help guides, What's new). The look of the plan page's prototypes, in the plugin's style and theme colours. Code: `src/motion6/live.ts` (the live canvas), `src/motion6/liveprims.ts` (what moves, pure), small blocks marked `// 6.0 F4` in the shared files. Tests: `tests/design-f4.test.ts`.

## What changed

### Moving things are drawn on a live canvas (2D, notes and the editor)

A 2D chart with something that moves gets a canvas inside its SVG, over the plot: over the fills and lines, under the markers and labels. The clock draws only this canvas on each frame; the SVG is not drawn again. It runs only while the chart is on screen, the strip's button pauses it, and reduced motion starts it paused (the first picture still shows).

The SVG keeps the still frame of the moving parts, hidden while the canvas draws them. The export, Copy SVG / PNG and the SVG files draw that still frame and no canvas.

| Moving thing | On the live canvas | Still frame (export, SVG files) |
|---|---|---|
| `with moving particles` | the plan's flow: 450 particles (300 on phones) leave thin fading trails over very faint arrows | faint arrows and a few streamlines |
| `traced` solution or orbit | draws itself with a dot at its head, holds the whole picture 1.6 s, starts again | the whole curve |
| turning circles | circles, arms, tip and wave turn | the picture at time 0 (or `stillTime`) |

The flow follows the plan's recipe: every frame the canvas fades by a tenth, the arrow grid (19 points across) is drawn at 2.5 % (it settles near a fifth), and every particle takes one midpoint step and draws one segment from its old place to its new one, 1.4 px at 85 %. A particle older than 6 s or out of the view starts again somewhere at random. A new canvas (first drawing, resize, pan, theme change) runs 40 steps first. Particles move at the mean |F| across 0.28 of the view a second (the pendulum example: 1.4 s of t a second, as the plan).

### 3D runs the clock

- **`turning`** (chart line, 3D): the view turns slowly by itself in notes and the editor (12° a second, from the chart's azimuth). A drag turns it (in notes a sideways drag; the chart text keeps its view); the turn stops while dragged and goes on from there. The size stays the same all the way round. The export shows the view as set. Full LaTeX: `\axis[turning]`. The Chart tab has a "Turns by itself" chip in View 3D.
- Long curves (solutions in 3D) are drawn as smooth paths, in six depth bands (far ones fainter), each band and colour one path: a Lorenz curve costs about 0.5 ms a frame. The export draws the same runs with `smooth`.
- A solution in 3D is `thin` by default.

### `traced`

`draw the solution of ... , traced` (2D and 3D) and `draw the orbit of ... , traced`: the curve draws itself over time with a dot at its head (in the colour of the curve there), then starts again. The time of a solution is its own t (a solution over t from 0 to 10 takes 5 s, at most 20 s); an orbit takes a quarter second a step (at most 12 s), its dots come as they are reached. The export, print and the SVG files draw the whole curve. Full LaTeX: the option `traced` (`\solution[through=P, t=0:10, traced]{...}`, `\orbit[..., traced]{...}`). Cards: a "Traced" chip on the Solution and Orbit cards.

```easy-tikz
3d
turning
cube
show x from -20 to 20, y from -30 to 30 and z from 0 to 50
draw the solution of $\dot{p} = (10(y - x), x(28 - z) - y, xy - \frac{8}{3}z)$ through (1, 1, 1) for t from 0 to 72, coloured by time, traced
```

### `coloured by time`

`coloured by time` alone is now the default ramp: cobalt, violet, rose, amber (the plan's colours; a dark-theme twin of each in the dark theme, light ones on paper and in copied pictures). `coloured by time in viridis` (or any map) names a map; print always names it. 24 colour levels (was 8), so the gradient reads smooth. Data: `byTime: true` on the tool; `colormap` wins. The card's dropdown has "Cobalt to amber" first.

### Still pictures

- **Rest points**: amber (the palette's orange) by default; filled when stable, open when not, as before.
- **Solutions**: points chosen by shape (fast turns keep their points, straight runs lose theirs), at most 3000 as before; every RK4 step is computed.
- **Orbits**: small filled heads at 55 % of each step that is at least 16 pt long (60 at most; one where an orbit comes round again).
- **Cobweb**: fades in over eight levels (20 % to full), was four.
- **Turning circles**: faint gray circles (40 %), arms in the tool's colour, the wave in red with a dashed gray line to the tip, the tip's curve fainter (25 %).
- **Bifurcation diagram**: a deeper shade of the colour and stronger single dots, so the chaotic part reads as a density.

### Before and after

The same charts before (`scratchpad/v6-shots/`) and after (`scratchpad/v6-design-shots/`):

- Lorenz: small, thick, viridis, still; now smooth thin lines in the ramp, turning, and it fills the box.
- Pendulum: short thick blue strokes, pale arrows; now the plan's flow over faint arrows, amber rest points.
- Fourier: black arms, a blue wave, a strong tip curve; now blue arms, a red wave, faint circles.
- Orbits: plain lines; now small heads show the direction.

## Not done

- Tinted bands between level curves (gradient descent): not built. `colour the plane by $f(x, y)$, in cool, opacity 0.3` under the curves comes close.
- The hopping dot on roots of unity (optional in the brief).
- Charts without ranges in notes keep the default view (the editor's Fit writes the fitted ranges); a 3D Lorenz chart needs its `show` line.
- In 3D, curve legs are drawn over surfaces (as all 3D tools), in depth among themselves.
