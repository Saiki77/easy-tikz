# Easy TikZ — visual TikZ / pgfplots editor with inline rendering

**Category:** Share & showcase
**Suggested title:** Easy TikZ — visual TikZ & pgfplots editor with inline rendering (no TeX install needed)

---

Hey everyone — I just shipped **Easy TikZ**, a visual editor for TikZ / pgfplots charts that renders them right inside your notes. No external TeX install needed for in-vault use; the plugin's renderer paints the chart in-process, and the *same model* exports clean pgfplots when you want to publish.

![Hero](https://raw.githubusercontent.com/Saiki77/easy-tikz/main/docs/screenshots/marketing-1-hero.png)

### What it does

- **Live SVG preview** as you type. 2D one-variable expressions, parametric `(x(t), y(t))`, polar `r(θ)`. Tangents and automatic extrema markers with one toggle. Fill (solid + patterns), dashed, color, thickness, per-function legend.
- **3D surfaces** for `f(x, y)` at ~60 fps. Mouse-drag rotates, wheel zooms, arrow keys nudge. Equal-aspect cube or data-proportional box, your choice. Up to 400 samples per axis on the slider (configurable in plugin settings).
- **Composable tools** layered on top of functions: area between two curves (by name, not index), intersection markers via bisection, reference lines, rectangles, circles, segments with arrows, braces with labels — plus 3D primitives (slice planes, points, segments).
- **Inline rendering in notes.** Click *Insert into note* and the plugin writes an `easy-tikz` JSON block which it renders as a chart in your reading/live-preview. Click the rendered chart to re-open the modal pre-filled with every setting; **Save changes** replaces the source block in place.
- **Real pgfplots export** when you want to publish. `\usepgfplotslibrary{fillbetween}` injected automatically when you use area-between, `axis equal image` lit up for cube mode, polar gets `axis equal` — the code that comes out compiles in any TeX install.

### Demos

A one-minute walkthrough showing the modal end-to-end, plus a tighter clip of the click-to-edit loop, are in the README:

https://github.com/Saiki77/easy-tikz#easy-tikz

### Install

- **Community plugins** → Browse → search **Easy TikZ** → Install + Enable.
- **BRAT** for early-access: BRAT settings → Add Beta Plugin → `Saiki77/easy-tikz`.

### Why I built it

Pgfplots is powerful but the syntax is fiddly and the feedback loop is "edit, recompile, squint." I wanted to drag a curve into place, see the result instantly, and have the right pgfplots come out the other end when I exported. The plugin also fixes a UX gap where rendering TikZ in notes today usually requires *another* plugin like obsidian-tikzjax — Easy TikZ renders its own format inline so the dependency goes away for in-vault use. (If you DO have tikzjax installed for plain `tikz` code, the two coexist; there's a setting to opt-in to `tikz` rendering for users who don't have tikzjax.)

### Source / issues

Repo: https://github.com/Saiki77/easy-tikz
License: MIT
Telemetry: none. Network: none. Math expressions are compiled with `Function` and evaluated in-renderer to draw the preview — nothing is persisted or transmitted.

Happy to take feedback / bug reports / feature requests here or on the GitHub issue tracker. 🎉
