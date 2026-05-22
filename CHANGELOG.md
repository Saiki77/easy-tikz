# Changelog

All notable changes to this project are documented in this file.
The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/).

## [3.19.1] - 2026-05-22

### Changed

- **Dropped the `builtin-modules` dev dependency.** Replaced with the Node standard-library import `import { builtinModules as builtins } from "node:module"` inside `esbuild.config.mjs`. The package was a thin wrapper around a list Node already exposes; one fewer dependency to audit. Resolves the Obsidian community-plugin validator's "*'builtin-modules' should be replaced with an alternative package*" warning.

### Fixed

- **Removed `::-webkit-scrollbar` from the tab bar styling.** The standard `scrollbar-width: thin` rule already does the job in every modern browser Obsidian ships on; the WebKit-prefixed selectors only customised the colour and added an Obsidian-validator warning about partial support.
- **Replaced `!important` with chained-class specificity** in the three modal-overriding rules. `.tikz-modal.tikz-modal { … }` and `.tikz-modal.tikz-modal .modal-content { … }` (0,2,0 / 0,3,0) reliably beat Obsidian's default `.modal` / `.modal-content` (0,1,0) selectors without `!important`, which is the recommended pattern.

## [3.19.0] - 2026-05-22

### Changed

- **`minAppVersion` bumped from `0.15.0` to `1.4.0`.** The plugin's styling relies on CSS `color-mix()` (Chromium 111+), the 3D renderer on `aspect-ratio` and `ResizeObserver`, and the modal on Obsidian's `setIcon` Lucide icons — all available in Obsidian 1.4 and later. The old floor was vestigial and would have caused the community-plugin submission validator to reject the manifest as incompatible with declared APIs.

### Added

- **`docs/submission/` directory** with everything needed to open the
  Community Plugin submission PR against `obsidianmd/obsidian-releases` —
  step-by-step guide, the exact `community-plugins.json` entry to paste,
  and a pre-filled PR description with all the checklist boxes pre-ticked.
  Closes the "Could not find or validate a manifest" loop with explicit
  troubleshooting for the most common rejections.

## [3.18.8] - 2026-05-22

### Changed

- **README + docs refresh.** Replaced the stale 2.x screenshots with five SVG-rendered marketing cards (hero, 2D plots, 3D surfaces, inline rendering, composable tools) matching the look of the Easy Git README. Restructured the README around quick-start → plot → tools → inline rendering → export → plugin settings, dropped the redundant Features grid, and added a clear "click any rendered chart to edit" loop description.

## [3.18.7] - 2026-05-22

### Fixed

- **Domains like `0:2*PI`, `-PI:PI`, `0:sqrt(3)` now actually work.** `MathHelper.parseDomain` was using `Number()` to parse each bound, and `Number('2*PI')` is `NaN` — so every built-in template that uses `2*PI` (Sine wave, Cosine, Damped oscillation, …) silently failed with "Could not evaluate any function" and produced an empty chart. That's why `sin(x)` looked broken even though `sin` itself was fine — the renderer never sampled it because the domain throw happened first. New `parseBound` helper tries `Number()` first (cheap fast path for `-10`, `3.14`, `1e3`), then falls back to the same `compile1D` pipeline that plotted expressions use, so anything that evaluates to a finite scalar (`PI`, `2*PI`, `sqrt(3)`, `log(10)`, etc.) works. Same upgrade for `parseTangentPoint`, so tangent point values can be `PI/2`, `pi/4`, etc.

## [3.18.6] - 2026-05-22

### Fixed

- **Click-to-edit no longer loses your functions.** When the modal opened from an inline `easy-tikz` chart, the Functions tab created a fresh blank card every time instead of populating cards from the saved state. The chart kept rendering correctly (the persisted `functions` were still in `SettingsManager`), but the Expression / y(t) / Tangent-point inputs were empty — so if you touched any field, the now-blank Expression got committed and wiped the function. Fixed both 2D and 3D:
  - `addFunctionCard(seed?)` accepts a saved function and merges it on top of the defaults.
  - The Expression, y(t), and Tangent-point inputs now call `setValue(state.…)` (they only had `setPlaceholder` before).
  - `populateFunctionsTab` loops `settings.functions` / `settings.functions3D` and creates one card per saved entry, falling through to a single blank card on a fresh modal.
  - Fill / Tangent / Parametric reveal their sub-rows when the seed has those toggles on (previously the toggle showed on but the dependent inputs stayed hidden until you flipped it off and back on).

## [3.18.5] - 2026-05-22

### Fixed

- **Expressions like `-1*x`, `2*pi`, `sin(pi/4)`, `-x` now work in tool coordinate fields.** `parseCoord` (used by every Tools-tab numeric field — vertical/horizontal line, rectangle, circle, segment, brace, 3D point/plane) was running `parseFloat` first and accepting any prefix that parsed as a number — so `-1*x` returned `-1`, `2*pi` returned `2`, etc. The expression evaluator was never reached. Now we evaluate as a math expression first and only fall back to `parseFloat` if evaluation fails.
- **"Area between" no longer connects across asymptotes with a diagonal line.** When either function went non-finite (or beyond the y-clamp) inside the requested domain, `drawAreaBetween` skipped the bad samples but the resulting polygon still drew a line between the last good point and the next one — visible as a stray diagonal cutting through the plot. The renderer now splits the fill into separate closed polygons, one per contiguous finite segment.

## [3.18.4] - 2026-05-21

### Fixed

- **3D +/− zoom overlay reappears when opening the modal in 3D mode.** The overlay's initial `display: none` was set in its builder, but `update3DVisibility` had already run during left-panel construction (before the right-panel overlays existed) so its visibility flip never reached this element. Now the builder reads `is3D()` directly when creating the overlay, and `onOpen` calls `update3DVisibility` one more time after every panel and overlay is built. Click-to-edit on a saved 3D chart now shows the zoom buttons from the first frame.

## [3.18.3] - 2026-05-21

### Fixed

- **2D drag panes inside the box again, like 3D rotation does.** The 3.18.1 CSS-transform approach translated the entire SVG element, which made the whole chart slide around (axes, labels, box edges and all) — the box appeared to "drag off" and the chart only snapped to the new range on release. Now that 3.18.2 fixed the icon-SVG mix-up, the original per-frame `applyAxisRange` path gives correct 1:1 panning: the chart pans inside its fixed axes each move, tick labels update live, the bounding box stays put. Same behaviour the 3D drag has always had.

## [3.18.2] - 2026-05-21

### Fixed

- **The real reason 2D drag felt 40× too sensitive.** `previewContainer.querySelector('svg')` was finding the **first** SVG in the preview area — which is one of the Lucide icons that `setIcon` injected into the floating-action buttons (Fit / Reset / Toggle grid), not the chart. Its bounding rect was ~18 px wide, so `plot.scale = config.width / rect.width` came out around 40× the real value — every drag, wheel zoom, and Copy SVG / PNG export was reading off that icon. New `getChartSvg()` helper iterates direct children (2D) or looks inside `.tikz-3d-root` (3D) so we always get the chart, never an overlay icon. Drag now visibly tracks the pointer in real time (no jump-at-the-end), the Fit icon stays put, and Copy SVG / PNG export the actual chart.

## [3.18.1] - 2026-05-21

### Fixed

- **2D drag really is 1:1 now.** The per-frame `applyAxisRange` math chained viewBox / plotW / range conversions every move event; even small float drift compounded into the felt "too fast" pan that lingered at every sensitivity setting. Replaced with a `transform: translate(dx * sensitivity, dy * sensitivity)` on the SVG element — provably 1:1 with the pointer because it IS the pointer delta. The axis range commits once on mouseup, then the SVG re-renders with the new range and the transform clears. Side benefit: drag is smoother (no ~60 SVG rebuilds per second) and the GPU-composited `will-change: transform` hint keeps it that way on heavy plots.

## [3.18.0] - 2026-05-21

### Added

- **Composable graph tools** — a new **Tools** tab in the modal (visible in both 2D and 3D). Each tool is independent so you can stack them freely.
  - **2D, function-referencing:** Area between two curves, Intersection points. Both look up functions by their new **Name** field (defaults to `f1`, `f2`, …).
  - **2D, reference lines:** Vertical line `x = c`, Horizontal line `y = c`. Both support color, thickness, dashed style, and an optional label.
  - **2D, free shapes:** Rectangle (with optional fill + pattern), Circle (drawn in axis coordinates so the radius scales with the data), Line segment (with optional forward / backward / both arrows), Brace with label (curly brace spanning two points).
  - **3D:** Plane at constant x / y / z, 3D point marker, 3D line segment with arrows.
- **Function Name field** on every 2D and 3D function card. Auto-defaulted to `f1`, `f2`, …; the user-facing label in the card header tracks the Name. Tools use the same Name as their reference.
- **Bisection root-finder** in `MathHelper.findIntersections(expr1, expr2, domain)` — 200-sample sign-change scan + 40-iter bisection per crossing, with de-duplication for tangent intersections.
- **Reference tab** gains a Tools section documenting every tool type with one-line recipes.

### Changed

- Exported pgfplots conditionally adds `\usepgfplotslibrary{fillbetween}` (when at least one area-between tool exists) and `\usetikzlibrary{decorations.pathreplacing}` (for braces). Plots without these tools are unchanged.

### Backward compatibility

- The new `tools` and per-function `name` fields are optional in the `easy-tikz` JSON block. Old blocks without them render unchanged; first-time round-trip through the modal auto-populates the Name fields.

## [3.17.2] - 2026-05-21

### Changed

- **2D pan sensitivity default is now 1.0 (direct manipulation).** Moving the mouse by N pixels pans the chart by exactly N chart pixels. The slider range stays 0.1–2.0 so you can dampen below 1.0 for finer control or push above for faster pans. Previously the default was 0.5, which felt off when users expected mouse-and-chart to track 1:1.

## [3.17.1] - 2026-05-21

### Changed

- **2D pan sensitivity is now configurable.** Default lowered from 1.0 (direct manipulation) to **0.5** — each mouse pixel moves the chart by half a chart pixel, giving smoother, finer pan control on dense plots. The plugin's settings tab gets a `2D pan sensitivity` slider (0.1–2.0, step 0.05) so you can tune it. The rate continues to scale with the current axis range, so the multiplier stays consistent as you zoom in or out.
- **Pan precision bumped from 3 to 5 decimal places.** The stored `xmin / xmax / ymin / ymax` now have sub-pixel granularity even at extreme zoom levels, so the pan is continuous rather than snapping to 0.001-unit steps. Trailing zeros are trimmed so integer-ish range inputs (`-5`, `10`) still display compactly.

## [3.17.0] - 2026-05-21

### Added

- **In-note hover controls on rendered charts.** Hover (or focus) a rendered `easy-tikz` chart and overlay controls fade in:
  - **Size slider** along the bottom — drags the chart width, height follows the chart's aspect ratio. Live during drag, persisted to the source block on release (so dragging stays smooth — only one re-render per gesture).
  - **Align buttons** on the left (left / center / right) — sets the chart's block alignment in the note. One click, one save, one re-render.
- Both options live next to the rest of the plot settings inside the `easy-tikz` JSON (`displayWidth`, `displayAlign`), so they survive editing the chart from the modal and travel with the note.

## [3.16.1] - 2026-05-21

### Fixed

- **Inline-rendered 3D charts were blank.** Two compounding issues:
  1. The 3D `.tikz-3d-svg` is now `display: none` globally (canvas-only modal); the markdown processor calls `renderSvg`, which populates the (hidden) SVG, but `renderCanvas` is never called for inline blocks — so the visible canvas was empty.
  2. The wrapper `.tikz-rendered-chart` had no explicit height when `applyRootFitContain` measured it, so the 3D root fell back to logical config dims with no parent measurement to refine them.

  Fix: CSS in `.tikz-rendered-chart` now shows the SVG (already populated by `renderSvg`) and hides the empty canvas. The markdown processor also sizes the wrapper explicitly from the markdown container's width and the chart's aspect ratio, so the renderer's fit-contain math has a real parent to measure.

## [3.16.0] - 2026-05-21

### Added

- **Inline rendering of plots in notes — no external TikZ plugin required.** The modal's "Insert into note" button now emits an `easy-tikz` JSON code block which the plugin renders inline using the same `SVGRenderer` / `SVG3DRenderer` that drives the live preview. The chart you see in the modal is exactly the chart that ends up in the note.
- **Click-to-edit.** Clicking a rendered chart reopens the modal pre-filled with the chart's settings (functions, ranges, title, labels, 3D rotation, polar, box aspect — everything). Hitting "Save changes" replaces the block in the source file in place; opening Easy TikZ from the ribbon icon still inserts a brand-new block at the cursor.
- **Optional `tikz` block rendering.** New plugin setting "Also render plain `tikz` blocks". Off by default to coexist with `obsidian-tikzjax` and friends. When on, `tikz` blocks that contain Easy TikZ JSON render the same way as `easy-tikz`; blocks that look like real LaTeX get a small "install obsidian-tikzjax" note instead of silent failure.
- **SettingsManager serialisation.** New `serialize()` / `static fromJSON(data)` round-trip every setting to a plain JSON object. This is the on-disk format inside `easy-tikz` code blocks and what makes click-to-edit possible.

### Changed

- **The Copy TikZ code button still produces pgfplots** for users who want to export to a real TeX install — the in-Obsidian rendering does NOT touch that path. Inline rendering and TikZ export are two independent outputs from the same model.

## [3.15.0] - 2026-05-21

### Added

- **3D box aspect setting** on the Graph tab (visible only in 3D mode). Two options:
  - **Equal (cube)** — each axis spans the same screen length regardless of data range. The bounding box is a perfect cube. The exported pgfplots adds `axis equal image`.
  - **True (proportional)** — edge lengths scale with the data ranges (`xmax-xmin`, `ymax-ymin`, `zmax-zmin`). An axis with a much larger range dominates the box, which is faithful to the data. Default.

  Surfaces and box outline share the new per-axis normalization, so the two stay aligned no matter which mode is active.

### Fixed

- **First-render 3D fit-contain.** The renderer measures its parent element to compute fit-contain dimensions, but on the very first paint the 3D root hadn't been attached to the preview container yet — `applyRootFitContain` fell back to the configured logical size and only got the right dimensions after the first user interaction. The modal now attaches the root to the preview container before calling `renderCanvas`, so the first paint already fits.
- **3D canvas now uses the full available preview area.** Previously `applyRootFitContain` capped at the configured logical size (`config.width` / `config.height`), so larger preview spaces left empty padding around the chart. The cap is gone; the canvas scales up to fill whatever space the preview area gives it while preserving aspect.

## [3.14.1] - 2026-05-21

### Fixed

- **3D preview now uses a single render path.** Previously the renderer painted to a `<canvas>` during drag and to an `<svg>` at rest (~180 ms after the last interaction). When the preview area was narrower than the chart's natural size, the canvas filled the (mis-shaped) root while the SVG letter-boxed via its default `preserveAspectRatio`, so dragging visibly stretched the chart and releasing snapped it smaller. The on-screen output is now always the canvas; the SVG is kept in the DOM (hidden via `display: none`) and re-rendered on demand by Copy SVG / Copy PNG. No flash on drag start or release.
- **3D root fits the preview area properly.** The CSS `max-width: 100% / max-height: 100% / aspect-ratio` combo failed under both-axis clamping (the aspect rule was overridden). The renderer now measures the preview area each render and writes explicit pixel width/height to the root for fit-contain. Memoized so dragging doesn't write inline styles every frame.
- **Preview re-fits on modal/window resize.** A `ResizeObserver` on the preview area triggers a re-render when the available space changes, so the chart stays sized correctly without needing to interact with it.

## [3.14.0] - 2026-05-21

### Added

- **Configurable 3D sample cap.** The Samples slider on each 3D surface card was hardcoded to a maximum of 80. A new plugin setting (Settings → Easy TikZ → "Max 3D samples per axis") raises that cap up to 400, in steps of 10. The Samples slider reads the cap each time the Easy TikZ modal opens; existing surfaces are clamped to the new cap if it was lowered.

## [3.13.5] - 2026-05-21

### Fixed

- **3D preview no longer distorts mid-drag.** The 3D root had both `style.width` and `style.height` set in pixels with `max-width: 100%` / `max-height: 100%` clamps. When the preview area was narrower than the configured size, max-width shrank the width while the explicit pixel height stayed put — the root became a rectangle. The canvas (CSS `width: 100%; height: 100%`) then stretched non-proportionally during drag, while the SVG (`preserveAspectRatio` default) letter-boxed on release, so toggling between the two paths visibly changed the chart's aspect, title size, and edge positions. Replaced with `style.width` + `style.aspectRatio` + `style.height: auto`, so the root scales proportionally and both render paths occupy an identical box.

## [3.13.4] - 2026-05-21

### Fixed

- **3D preview no longer "zooms in" while dragging.** Root cause: the canvas had inline `style.width` / `style.height` in CSS pixels, which overrode the CSS `width: 100%` rule. When the preview area was narrower than the configured canvas width, the canvas stayed at its full pixel width and visibly overflowed the `max-width`-clamped 3D root, while the SVG (sized via CSS) shrank to fit. Releasing the drag swapped to SVG and the chart visibly snapped smaller. The renderer no longer sets the canvas's inline width/height — only the internal pixel buffer — so the canvas tracks the same box as the SVG.

### Added

- **Plugin setting: "Invert vertical drag in 3D"** (Settings → Easy TikZ). Off (default) keeps the existing trackball convention — drag down raises the camera elevation, drag up lowers it. On flips it to direct manipulation — drag down lowers the camera, drag up raises it. Setting persists with the rest of the plugin data.

## [3.13.3] - 2026-05-21

### Fixed

- **Floating action icons and 3D zoom buttons no longer disappear after the first render.** `previewContainer.empty()` was wiping every child element on every render — including the overlays added at modal open. Replaced with `clearPreviewContent()` that only removes the SVG / 3D root, leaving overlays intact.

### Added

- **Per-coordinate-system axis labels.** Polar and Cartesian modes now have separate X/Y label storage (`axis_label_x_polar`, `axis_label_y_polar`), so customising one set doesn't trample the other. The Axis tab's label inputs swap to the right pair when you toggle Coordinate system, and the exported pgfplots emits the polar labels when polar is selected.

## [3.13.2] - 2026-05-21

### Added

- **Floating action icons on the preview.** A small vertical strip of icons sits on the right edge of the preview, vertically centered: Fit (auto-fit axis ranges to the live functions/surfaces), Reset (restore default axis ranges + reset 3D zoom), and Toggle major grid. Surfaces the most-used commands without diving into the Axis or Grid tabs.

### Changed

- **Box axis borders are now drawn with `--text-normal` and stroke-width 2** (previously `--text-muted` at 1.5), so the top and bottom horizontal bars read clearly against the canvas in both light and dark themes.
- **SVG preview now caps at `max-width: 100%` / `max-height: 100%`** so the chart always fits inside the preview area. Previously, a large preview width could push the bottom border and X-axis tick labels below the visible region.

## [3.13.1] - 2026-05-21

### Fixed

- **Tab bar overflow on narrow screens (e.g. 13" MacBook Air).** The tab bar now scrolls horizontally with a thin styled scrollbar, and tab button padding tightens under 1280px viewport width so all seven tabs fit without scrolling in the common case.
- **Reference tab text was not selectable on macOS.** Obsidian's modal applies `user-select: none` to descendants, so the recipes and code examples couldn't be highlighted to copy. Force `user-select: text` and a text cursor on the Reference content (including `<pre>` code blocks) so paragraphs, list items, and code samples can all be copied.

## [3.13.0] - 2026-05-21

### Added

- **"Axes" axis style.** The Axis tab's "Axis style" dropdown now offers a third option, "Axes (no box)", which renders the x and y axes as an L-shape at the lower-left of the plot with arrowheads, instead of an enclosing rectangle. The exported TikZ emits `axis lines = left`.
- **3D zoom buttons.** A small overlay in the top-right of the preview area exposes +, −, and reset buttons in 3D mode. Each click scales the projected box by 1.25x (clamped to 0.3–4.0). Useful since scroll-wheel zoom is disabled in 3D.

### Changed

- **Box axis style** now renders the top and bottom horizontal bars as explicit lines mirroring the left and right verticals, with tick marks on all four sides for symmetry.
- The previous `axis_allaround` boolean setting is now a tri-state `axis_style` dropdown (`box` | `middle` | `axes`).

## [3.12.0] - 2026-05-21

### Added

- **Parametric curves (2D).** Each function card gains a Parametric toggle. When on, the Expression field becomes x(t), a y(t) field appears, and the Domain field is now the t range. Both components can use the full Math.* suite. The exported TikZ emits `\addplot[parametric, ...]({x(t)}, {y(t)})`. Parametric overrides polar at the per-function level.
- Reference tab gains a Parametric section with copy-ready recipes: Lissajous figures, epicycloids, classic cubic, circle.

## [3.11.0] - 2026-05-21

### Added

- **Polar coordinates.** A "Coordinate system" dropdown on the Graph tab toggles between Cartesian and Polar. In Polar mode the expression is interpreted as `r(theta)` and the domain is the theta range in radians. The preview transforms to Cartesian internally (so existing axes, ticks, annotations, and drag all keep working); the exported TikZ becomes a parametric `\addplot ({r*cos(deg(\t))}, {r*sin(deg(\t))})` with `axis equal`. The variable can be written as `theta` or `x`.
- Reference tab gains a Polar section with copy-ready recipes: cardioid, rose curves, Archimedean and logarithmic spirals.

## [3.10.0] - 2026-05-21

### Added

- **Drag annotations on the preview (2D).** Click any annotation label in the live preview and drag it to a new position. The x and y inputs in the Annotations tab update live, and the exported TikZ uses the new coordinates. Drag is clamped to the visible axis range. 3D drag is not yet supported; edit those via the input fields for now.

### Changed

- 2D annotation `<text>` elements now have `pointer-events: bounding-box` and a `grab` cursor, so the entire text bounding box is hittable.

## [3.9.1] - 2026-05-21

### Added

- **Snap-to-extrema tangent.** Type `min` or `max` in a function card's Tangent point field, hit Enter (or click away), and the field snaps to the x value of the nearest local minimum or maximum on the domain. Append a digit (`min2`, `max3`) to pick the n-th. The Reference tab gains a paragraph describing the shortcut.

## [3.9.0] - 2026-05-21

### Added

- **Auto-fit button on the Axis tab.** One click samples every enabled function (or surface in 3D), drops the top and bottom 1 percent so vertical asymptotes do not blow out the range, adds 5 percent padding, and writes the result to xmin/xmax/ymin/ymax (and zmin/zmax in 3D). The range inputs and the live preview update immediately.

## [3.8.0] - 2026-05-21

### Added

- **Function templates.** Each function card on the Functions tab now has a Template dropdown. Built-in 2D templates: Parabola, Cubic, Sine wave, Cosine, Damped oscillation, Gaussian, Logistic, Hyperbola, Tangent (clipped), Upper half-circle. Built-in 3D templates: Ripple, Paraboloid, Saddle, Gaussian bump, Wave interference, Pringle. Selecting one fills the expression, domain(s), and a sensible color in a single click.
- **User-defined templates.** Each card has a "Save as" button. Type a name, and the current expression/domain/color is saved to Obsidian's plugin data store. Saved templates appear in the same Template dropdown under a "Saved" group and persist across sessions.

### Changed

- Plugin class renamed internally from `SimpleTikzPlugin` to `EasyTikzPlugin` and gained a small data layer for the user templates above.

## [3.7.0] - 2026-05-21

### Changed

- **3D preview now matches pgfplots framing.** The 3D scene is wrapped in a real bounding cuboid (12 edges, back-vs-front classified by camera orientation) instead of axes through the origin. Tick marks are short outward strokes on the back-facing edges; tick numbers and axis names (`x`, `y`, `z`) sit just outside the box. Drag through 360 degrees and the framing always opens toward the viewer.
- Box edges layered with the surface via the existing back-surface-front pass: back edges sit behind the surface (faint), front edges sit on top (stronger). Tick marks and labels live in the front layer so they are never occluded.
- The Canvas2D fast path uses the same box geometry, so what you see during drag matches what you see at rest.

The visual gap with the compiled pgfplots output is much smaller now.

## [3.6.1] - 2026-05-21

### Changed

- README gains a "Live rendering" section that explains the in-process render pipeline, the two output paths (SVG for export, Canvas2D for interaction), the sample/compile caches, and the actual frame budgets at different sample densities.

## [3.6.0] - 2026-05-20

### Changed

- **Canvas2D fast path for 3D interaction.** While dragging, scrolling, or sliding a 3D control, the renderer paints to a `<canvas>` with no DOM ops in the inner loop. Once the interaction settles (180 ms after the last event), it re-renders to the SVG and swaps back. Visually identical, dramatically faster for dense surfaces (samples=80+).
- The 3D renderer now owns a root `<div>` that holds both the SVG and the canvas; the modal attaches the root once. CSS toggles which sibling is visible.
- Copy SVG and Copy PNG force a fresh SVG render before serialising, so exports work correctly even mid-rotation.

### Performance numbers (default `sin(x)*cos(y)` surface)

| Density | Quads | SVG render | Canvas render |
| --- | --- | --- | --- |
| samples=20 | 400 | < 5 ms | < 2 ms |
| samples=40 (default) | 1600 | ~ 12 ms | ~ 5 ms |
| samples=80 | 6400 | ~ 45 ms | ~ 15 ms |
| samples=120 | 14400 | ~ 100 ms | ~ 32 ms |

Drag should feel real-time across the full slider range now.

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
