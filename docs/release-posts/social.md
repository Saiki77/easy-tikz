# Short-form posts (X / Mastodon / Bluesky)

Three flavours of the same announcement. Pair each with the `demo-overview.gif` from `docs/screenshots/` (or convert to mp4 for Mastodon, which auto-plays mp4 cleanly).

---

## X / Twitter (≤ 280 chars)

```
Just shipped Easy TikZ for Obsidian 📈

→ Visual editor for TikZ / pgfplots
→ Renders inline in your notes (no TeX install needed)
→ 2D + 3D + parametric + polar
→ Composable tools: area between curves, intersections, braces
→ MIT, zero telemetry

github.com/Saiki77/easy-tikz
```

## Mastodon (~500 chars, more room to breathe)

```
Just shipped Easy TikZ for Obsidian 📈

A visual editor for TikZ / pgfplots charts that renders them inline in your notes - no external TeX install or third-party TikZ plugin needed for in-vault use.

→ 2D, 3D, parametric, polar
→ Composable tools layer (area between curves by name, intersections, reference lines, free shapes, 3D primitives)
→ Click any rendered chart in a note → modal re-opens pre-filled → save replaces the block in place
→ Real pgfplots export when you want to publish

MIT licensed, zero telemetry, zero network calls.

github.com/Saiki77/easy-tikz

#ObsidianMD #TikZ #pgfplots
```

## Bluesky (300 chars)

```
Just shipped Easy TikZ for Obsidian - a visual editor for TikZ / pgfplots charts that renders inline in your notes. No TeX install needed. 2D, 3D, polar, parametric, plus a composable tools layer (area between curves, intersections, braces, ref lines).

github.com/Saiki77/easy-tikz
```

---

## Reply hooks (if people ask "how is this different from obsidian-tikzjax?")

```
TikZJax is great if you want to compile arbitrary TikZ inside Obsidian - it ships a WebAssembly LaTeX engine. Easy TikZ is the opposite trade-off: it's a visual editor with its own SVG renderer for the chart subset (functions + tools), so the in-vault render is instant and the plugin's footprint is small. It still exports clean pgfplots when you want to compile elsewhere. The two coexist - Easy TikZ only claims the `easy-tikz` code-block tag by default, so your `tikz` blocks stay with tikzjax.
```
