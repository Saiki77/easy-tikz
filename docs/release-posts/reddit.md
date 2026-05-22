# Reddit / r/ObsidianMD

**Suggested title:** [Plugin] Easy TikZ - visual TikZ & pgfplots editor that renders charts inline (no TeX install needed)

**Flair:** Plugin / Showcase

---

I just shipped **Easy TikZ**, a visual editor for TikZ / pgfplots charts in Obsidian. The thing that makes it different from existing TikZ tooling is that **it renders the charts directly in your notes** - no external `obsidian-tikzjax` or TeX install needed for in-vault use. The same in-memory model also exports real pgfplots when you want to publish elsewhere.

**What you can do with it:**

- 2D plots - any one-variable expression. Parametric `(x(t), y(t))` and polar `r(θ)` modes. Per-function: fill (solid + patterns), tangent at any x, automatic extrema markers, dashed, legend, color.
- 3D surfaces - `f(x, y)` rendered at ~60 fps. Drag to rotate, wheel zooms, arrow keys for fine control. Cube or data-proportional aspect.
- **Composable tools** on top of functions: area between two curves (referenced by name), intersection markers, reference lines, rectangles / circles / segments with arrows / braces with labels. 3D primitives too (slice planes, points, segments).
- **Click-to-edit.** Click any rendered chart in your note → the modal re-opens pre-filled with every setting. Save → the source block updates in place.
- Real pgfplots export when you want a publication-quality figure - `fillbetween` library is injected automatically when you use area-between tools, axis-equal flips on for cube mode, polar gets `axis equal`.

Repo + screenshots + a 60-second walkthrough GIF: https://github.com/Saiki77/easy-tikz

**Install:** Community plugins → Browse → Easy TikZ → Install + Enable. Or BRAT with `Saiki77/easy-tikz` for the beta channel.

MIT licensed, no telemetry, no network calls. Expressions are compiled and evaluated in-renderer for the live preview - nothing leaves the vault.

Would love feedback, especially on the Tools tab (the composable layer is new and I'd be curious which combinations of tools people end up using for their own diagrams).
