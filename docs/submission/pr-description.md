# PR description for `obsidianmd/obsidian-releases`

Paste this into the **description** field of the submission PR. Tick every box that's true (all of them should be).

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
- A composable **Tools** layer on top of functions: area between two curves (referenced by name), intersection markers (bisection root-finder), reference lines, free shapes (rectangles / circles / segments / braces), and 3D primitives (slice planes, points, segments). Each tool stacks with the others.
- Inserts an `easy-tikz` JSON code block on save. The plugin's own markdown post-processor renders it inline; clicking the rendered chart re-opens the modal pre-filled, and saving replaces the source block in place.
- Plugin settings expose: invert vertical drag in 3D, max samples per 3D axis (40–400), 2D pan sensitivity (0.1–2.0), opt-in rendering of plain ` ```tikz ` blocks (off by default so it coexists with `obsidian-tikzjax`).
- No telemetry. No network. No vault access beyond the active note's insertion point and the file that owns the rendered chart you're editing.

### Marketing screenshots / demo

- Hero + 4 feature cards: `docs/screenshots/marketing-1-hero.png` … `marketing-5-tools.png` in the repo.
- 60-second overview GIF: `docs/screenshots/demo-overview.gif` (mp4 alongside).
- README has everything inlined.

### Notes for the reviewer

- `minAppVersion` is set to **1.4.0** because the styling uses `color-mix()`, which needs Chromium 111+ (Obsidian 1.4.0 onwards).
- The plugin compiles user math expressions with `new Function(...)` so the live preview can sample them at 500+ points per render without per-sample overhead. Compiled functions are LRU-cached (128 entries). This is in-renderer only - never persisted, never transmitted. Discussed in `README.md` → Permissions.
- All built-in icons are Lucide via `setIcon` - no bundled font assets.
- License: MIT.

Happy to answer any questions or push fixes if anything needs adjusting.
