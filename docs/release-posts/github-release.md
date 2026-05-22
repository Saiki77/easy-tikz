# GitHub Release notes

Use this as the body when creating the GitHub Release for the latest tag (e.g. `3.18.8`). Update the version at the top each release.

---

## Easy TikZ 3.18.8

Visual TikZ / pgfplots editor for Obsidian with inline rendering — no external TeX install needed for in-vault use.

### Highlights since the last release

- **Inline rendering.** Insert into note now emits an `easy-tikz` JSON block that the plugin renders inline using the same SVG / 3D pipeline as the live preview. Click the rendered chart to re-open the modal pre-filled.
- **Composable tools layer.** Stack area-between, intersection markers, reference lines, free shapes (rectangles, circles, segments, braces) and 3D primitives (slice planes, points, segments) on top of any function. Function references are by name, so tool wiring survives reordering and renaming.
- **Per-mode polar labels.** Cartesian and polar axis labels are stored separately; toggling Coordinate system doesn't trample the other set.
- **3D box aspect.** New "Equal (cube)" vs "True (proportional)" setting controls how each axis is scaled. Exported pgfplots gets `axis equal image` when Equal is selected.
- **Plugin settings.** Invert vertical drag (3D), Max 3D samples per axis, Also render plain `tikz` blocks, 2D pan sensitivity.

### Fixes since the last release

- 2D drag is now provably 1:1 with the pointer. The old `querySelector('svg')` was grabbing the first Lucide icon SVG from the floating action overlay instead of the chart — `plot.scale` came out ~40× too large and every drag / wheel-zoom / export pulled from the wrong element. New `getChartSvg()` helper picks the chart in 2D and the off-screen SVG in 3D.
- 3D `+ / − / ↻` overlay now shows up on the first paint when the modal opens from an existing chart.
- 3D canvas no longer changes aspect mid-drag (canvas was carrying an inline `style.width` that beat the CSS `width: 100%`; removed so both render paths occupy the same box).
- `parseDomain` accepts expressions like `0:2*PI`, `-PI:PI`, `0:sqrt(3)` — `Number('2*PI')` is `NaN` so every built-in template using `2*PI` was silently producing "Could not evaluate any function" errors. Same upgrade for `parseTangentPoint`.
- `parseCoord` (Tools-tab numeric fields) evaluates expressions instead of short-circuiting on `parseFloat` — `2*pi`, `sin(pi/4)`, `-x` now all work where `-1*x` used to be the only thing that "worked" (because parseFloat ate the `-1`).
- Click-to-edit hydrates the function cards properly. Previously the Expression / y(t) / Tangent-point inputs had `setPlaceholder` but no `setValue`, so editing an existing chart presented blank inputs and any field change committed an empty expression.
- "Area between" splits its fill polygon at NaN gaps so asymptotes don't produce a diagonal connector across the chart.

### Install

- Community plugins → Browse → **Easy TikZ** → Install + Enable.
- BRAT: paste `Saiki77/easy-tikz` as a beta plugin.
- Manual: download the assets attached to this release into `<vault>/.obsidian/plugins/easy-tikz/`.

### Verification

`main.js`, `manifest.json`, `styles.css` are published with build provenance (see the workflow run). SHA-256s and the manifest version are pinned to the tag.

### Full changelog

See `CHANGELOG.md` in the repo for the per-version history.
