# Changelog

All notable changes to this project are documented in this file.
The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/).

## [3.5.0] - 2026-05-20

### Changed

- **Real-time 3D rotation.** Rotation, drag pan, and wheel zoom now render on `requestAnimationFrame` instead of the 150 ms debounce, so the FPS cap moves from ~7 to whatever the renderer can sustain (60+ on typical surfaces).
- **3D renderer is stateful.** The SVG, its child groups, and a polygon pool are built once per modal open and mutated in place across rotations. No more `createElementNS` storm per frame.
- **Sampled surface data is cached.** Cache key encodes the expression, both domains, the z range, and the sample count. Pure camera changes (rotation, view zoom) skip the function evaluation pass entirely; the cache is rebuilt only when one of those inputs changes.
- **Projection in one pass.** Each grid vertex projects once into a Float64Array; quads then read from the buffer instead of calling project four times per cell.

Settings that change the data (expression, domain, samples) still use the 150 ms debounce so text editing does not re-sample on every keystroke. The two paths cooperate: a pending fast render cancels a pending debounced render and vice versa.

No behaviour change. The visual output of any given config is identical; only the performance budget is different.

## [3.4.0] - 2026-05-20

### Added

- **Copy SVG** button on the action bar. Copies the live preview as an SVG with a transparent background. CSS variables are resolved at export time so the file renders correctly outside the plugin (Inkscape, Figma, Obsidian as `<img>`).
- **Copy PNG** button on the action bar. Rasterises the SVG at 2x resolution and copies a PNG to the clipboard, also with a transparent background.
- Reference tab gets a new "Exporting the preview" section covering the four output options.

### Changed

- **Renderer performance.** The 2D renderer used to recompile every expression `new Function()` on every one of the 500 samples per render; the 3D renderer did the same for every cell of its 40x40 grid. Compiled functions are now cached on the expression string (capped at 128 entries with LRU eviction), so a render compiles each expression once.
- 2D inner loop converted from per-sample object allocation and `try/catch` to a pair of `Float64Array`s plus inline screen-coordinate math. Drag-pan and wheel-zoom feel noticeably tighter, especially with tangents and extrema on.
- 3D `sampleSurface` switched from a nested array-of-arrays to a flat `Float64Array` with a 1D index. Same numerical output, fewer allocations per render.
- Action bar wraps to a second line on narrow modal widths instead of overflowing.

## [3.3.0] - 2026-05-20

### Added

- **Annotations tab.** New tab to place text labels at any (x, y) (or x, y, z in 3D) point. Each label has color, size (small/normal/large), and anchor (above/below/left/right/center). Rendered in the live preview and emitted as `\node` commands in the exported TikZ.
- **2D fill patterns.** Fill toggle now exposes a Fill pattern dropdown: Solid, Horizontal lines, Vertical lines, Crosshatch, Dots, NE diagonal, NW diagonal. Each pattern is supported in the SVG preview (via `<pattern>` defs) and in the exported pgfplots code (`pattern=...`).
- **2D fill opacity slider.** Per-function opacity from 0.05 to 1.0. Same value used by the preview and the exported code (was previously hardcoded and different between the two).
- **3D Samples slider** on every surface card (8 to 80, default 40). Higher = smoother surface in the preview and a higher `samples=` value in the exported `\addplot3`.

### Changed

- **Preview aspect ratio follows Width/Height (cm).** The live SVG used to be a fixed 0.7 ratio regardless of the configured cm dimensions. It now matches the cm aspect (clamped to a reasonable range), so the preview is a much closer match for the compiled pgfplots output.
- Reference tab gets Annotations, expanded Function options coverage, Samples in 3D options, and a new "Preview vs exported code" section explaining the two-pipeline architecture.

## [3.2.0] - 2026-05-20

### Added

- **Larger live preview by default.** Bumped the SVG render size from 550x400 to 760x532 so it no longer floats lost in the right pane.
- **Preview size slider** on the Graph tab (400 to 1400 px wide). Controls the live preview only; the exported TikZ dimensions stay under Width / Height (cm).
- **Mouse-wheel zoom in 2D.** Scrolling on the preview zooms in or out around the cursor. The new range writes back to xmin/xmax/ymin/ymax, so the generated TikZ code reflects what you see.
- **Click-and-drag pan in 2D.** Drag the preview to move the view; the axis range inputs and the generated code follow along. 3D drag still rotates the camera.

### Changed

- Axis range text inputs are now kept in sync when the view is zoomed or panned, so what's on screen is always what gets exported.
- Preview area grab/grabbing cursor styles unified across 2D and 3D.

## [3.1.2] - 2026-05-20

### Fixed

- Reference tab code blocks were getting flex-shrunk to a single line. Switched the panel to normal block flow and pinned `<pre>` blocks against shrinking.

### Added

- Reference tab is now much richer: Function options, Tangent, Extrema, 3D surface options, Camera controls, Grid, a Recipes table with copy-ready expressions/domains/ranges, and a Troubleshooting section.

## [3.1.1] - 2026-05-20

### Fixed

- Active tab no longer lags behind when scrolling the settings column. Replaced the IntersectionObserver-based tracking (which only fired when sections crossed a threshold) with a scroll listener throttled by `requestAnimationFrame` that picks whichever section is currently at the active line.

## [3.1.0] - 2026-05-20

### Added

- New **Reference** tab inside the modal with full function syntax docs: operators, trig (including hyperbolic), exp/log, roots, rounding, constants, and worked examples for both 2D and 3D.
- Bare Math functions are now in scope inside expressions: `tan(x)`, `tanh(x)`, `sin(x)`, `cos(x)`, `exp(x)`, `log(x)`, `sqrt(x)`, and the rest. `Math.tan(x)` still works. Constants `PI`, `E`, `LN2`, `LN10`, `LOG2E`, `LOG10E`, `SQRT2` are also accessible.
- New **Major divisions** slider on the Grid tab. Controls how many major grid cells span the X axis (Y follows proportionally). Renamed the existing slider to **Minor subdivisions** so the relationship is clear.

### Changed

- Settings tabs (Graph, Axis, Functions, Grid) now share one continuous scrollable column. Tab clicks smooth-scroll to the corresponding section; scrolling manually updates the active tab via an IntersectionObserver. Code and Reference remain standalone panels.
- Code panel: full-height editable textarea, no resize handle, no rounded border. Manual edits in the textarea round-trip out through "Copy TikZ code" and "Insert into note". Settings changes still refresh the code, unless the textarea is currently focused.
- Modal max-width 1200 to 1400 px (92vw). Axis min/max inputs no longer crash into each other.
- Tab bar background matches the content area; active tab no longer fills with a contrasting block. Focus ring switched from an outline to an inset box-shadow.
- Function cards: top-left and bottom-left corners squared so the colored stripe is flush.
- Action bar background harmonised with the rest of the chrome; padding and divider tone softened.
- Logo refined: thinner axes (3.5 px), thinner curve (6 px), tick marks on both axes, a very light grey background grid, and refined arrowheads. Pure black-on-white with no fills or border.

## [3.0.2] - 2026-05-20

### Changed

- Redrew the logo: downward parabola with sharp butt-cap line ends, larger arrowheads, no border.
- Trimmed the README: shorter "Why" section, simpler Permissions list, tightened feature captions.

## [3.0.1] - 2026-05-20

### Fixed

- `.gitignore` accidentally matched `src/styles.css` as well as the root build output, so CI builds failed with ENOENT when the inline-import plugin tried to read the stylesheet. Anchored the ignore rules to the repo root so only build artefacts are excluded.

This is the first 3.x release with working GitHub-Actions artifacts. 3.0.0 metadata exists in history but no release assets were published.

## [3.0.0] - 2026-05-20

### Migration from 2.x

The plugin was renamed from "Tikz Graph Helper" to "Easy TikZ" and the folder
changed from `tikz_graph_helper` to `easy-tikz` to follow the Obsidian
community convention. Existing BRAT or manual users:

1. Disable the plugin in Settings, Community plugins.
2. Rename `.obsidian/plugins/tikz_graph_helper/` to `.obsidian/plugins/easy-tikz/`.
3. Re-enable the plugin.

Plugin settings carry over with the rename. No data is lost.

### Changed

- Plugin renamed to "Easy TikZ" with id `easy-tikz` (was "Tikz Graph Helper" / `tikz_graph_helper`).
- Hardened release pipeline: tag-vs-manifest version check, build provenance attestation, Node 20, `npm ci`, release notes sourced from this changelog.
- Consolidated three duplicate color maps into one shared `src/colors.ts` module.
- Extracted `niceInterval`, `formatTick`, `stripLatex`, and color helpers into a shared `src/util.ts` module.
- Replaced the inline error banner with Obsidian `Notice` toasts for transient errors.
- Modal microcopy clarified for camera angles, function syntax help, and button labels.
- Manifest description rewritten to start with an action verb and pass community-store guidelines.

### Added

- Hero image, animated demo, feature grid, and logo in the README.
- Keyboard support for 3D rotation: focus the preview and use the arrow keys.
- ARIA roles on the tab bar, labels on icon-only buttons, and a `tabindex` on the preview.
- Numeric validation on axis-range inputs with a Notice on invalid entries.
- Per-function syntax help text under the expression input.
- Named constants for renderer padding, sampling, drag rates, and derivative step (no more magic numbers).
- JSDoc on every exported math helper, renderer, and color utility.

### Fixed

- Memory leak: window `mousemove` and `mouseup` listeners are now removed when the modal closes.
- Memory leak: the injected `<style>` tag is now removed when the modal closes.
- 3D renderer used a hardcoded `#888888` that was effectively invisible in light theme. Now uses Obsidian's `--text-normal` and shades it correctly.
- Three `console.error` calls on routine user-input parsing failures removed.
- `parseDomain` now validates that the domain string is well-formed and that min is less than max.

## [2.2.0] - 2026-03-23

### Changed

- Iterative tuning of the previous release pipeline.

## [2.1.0] - 2026-03-23

### Added

- Quality-of-life refinements over 2.0.x.

## [2.0.1] - 2026-03-23

### Fixed

- Patch release on top of 2.0.0.

## [2.0.0] - 2026-03-23

### Added

- First public release. Live SVG preview, 2D and 3D plotting, tangent lines, extrema detection, TikZ and pgfplots code generation, dark/light theme support.
