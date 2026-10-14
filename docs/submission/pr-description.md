# PR description for `obsidianmd/obsidian-releases`

Paste this into the **description** field of the submission PR. Tick every box that's true (all of them should be).

The text describes version 4 (checked against `manifest.json`, the README and the plugin settings of 4.0.0). `SUBMISSION.md` next to it is the walkthrough written for the first submission and still names 3.19.0 as the latest tag: read it for the steps, not for version numbers.

---

## I am submitting a new Community Plugin

### Repo URL

Link to my plugin: https://github.com/Saiki77/easy-tikz

### Release Checklist
- [x] I have tested the plugin on
  - [x] Windows
  - [x] macOS
  - [ ] Linux
  - [ ] Android *(plugin is desktop-only)*
  - [ ] iOS    *(plugin is desktop-only)*
- [x] My GitHub release contains all required files
  - [x] `main.js`
  - [x] `manifest.json`
  - [x] `styles.css` (optional, included)
- [x] GitHub release name matches the exact version number specified in my manifest.json (**Note:** Use the exact version number, don't include a prefix `v`)
- [x] The `id` in my `manifest.json` matches the `id` in the `community-plugins.json` file.
- [x] My README.md describes the plugin's purpose and provides clear usage instructions.
- [x] I have read the developer policies at https://docs.obsidian.md/Developer+policies, and have assessed my plugins's adherence to these policies.
- [x] I have read the tips in https://docs.obsidian.md/Plugins/Releasing/Plugin+guidelines and have self-reviewed my plugin to avoid these common pitfalls.
- [x] I have added a license in the LICENSE file.
- [x] My project respects and is compatible with the original license of any code from other plugins that I'm using. I have given proper attribution to these other projects in my `README.md`.

### What does this plugin do?

Easy TikZ is a visual editor for TikZ / pgfplots charts in Obsidian. It renders charts **inline in your notes** using a small in-process SVG / canvas renderer, so no external TeX install (and no other TikZ plugin) is required for in-vault use. The same in-memory model also exports clean pgfplots code for users who want to publish the figure with a real TeX engine.

Highlights:

- Live preview for 2D function plots (parametric `(x(t), y(t))`, polar `r(θ)`, fill / patterns / tangents / extrema markers) and 3D surfaces `f(x, y)` at ~60 fps with drag-rotate.
- Five general tools on top of functions: **Region** (shade where inequalities hold: areas between curves, feasible regions), **Curve** (an equation in x and y, or its level curves), **Points** (lists, intersections, corner points, integer points, the optimum of an objective), **Segment** (lines, arrows, polygons, braces) and **Plane** (cuts a 3D surface). Each tool stacks with the others.
- **Sliders** are named numbers usable in every formula; the preview redraws while one is dragged. A line, curve or point dragged in the preview rewrites the numbers in its formula (**drag to edit**).
- Inserts an `easy-tikz` JSON code block on save. The plugin's own markdown post-processor renders it inline; clicking the rendered chart re-opens the modal pre-filled, and saving replaces the source block in place.
- Plugin settings expose: invert vertical drag in 3D, max samples per 3D axis (40 to 120, default 80), 2D pan sensitivity (0.1 to 2.0), opt-in rendering of plain ` ```tikz ` blocks (off by default so it coexists with `obsidian-tikzjax`).
- No telemetry. No network. No vault access beyond the active note's insertion point and the file that owns the rendered chart you're editing.

### Marketing screenshots / demo

- Hero + 7 feature cards: `docs/media/hero.png` and `docs/media/card-*.png` in the repo.
- Overview film, 40 seconds: `docs/media/overview.mp4`, with its second part as a 17.6 s GIF loop: `docs/media/overview.gif`.
- README has everything inlined.

### Notes for the reviewer

- `minAppVersion` is set to **1.13.0**: the settings tab uses the declarative settings API, and sliders rely on 1.13's always-visible inline value. Users on older Obsidian versions keep 3.19.5 via `versions.json`.
- User math expressions are parsed by a built-in parser and compiled into plain closures: no `eval`, no `new Function(...)`, no dynamically generated code. Nothing is persisted or transmitted. See `README.md` → Permissions.
- All built-in icons are Lucide via `setIcon` - no bundled font assets.
- License: MIT.

Happy to answer any questions or push fixes if anything needs adjusting.
