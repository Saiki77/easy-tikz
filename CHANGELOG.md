# Changelog

All notable changes to this project are documented in this file.
The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/).

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
