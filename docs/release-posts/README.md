# Release posts

Copy-paste-ready announcements for each channel. Update version numbers / dates per release.

- [`reddit.md`](reddit.md) - [r/ObsidianMD](https://reddit.com/r/ObsidianMD) post. Mention the "Plugin" / "Showcase" flair when posting.
- [`github-release.md`](github-release.md) - body for the GitHub Release page (paste into the description field when you tag a release).
- [`social.md`](social.md) - X / Mastodon / Bluesky variants in one file.

### Suggested order when you ship a release

1. **Tag + push.** `git push --atomic origin main <version>` - release workflow attaches `main.js` / `manifest.json` / `styles.css` and publishes the GitHub Release.
2. **GitHub Release.** Open the auto-published release, paste the contents of `github-release.md` (edit highlights for that version), save.
3. **Reddit.** Post `reddit.md` to r/ObsidianMD with the Plugin / Showcase flair. Reply to comments for a couple of hours after posting.
4. **Social.** Send the three variants in `social.md` to X / Mastodon / Bluesky in whatever order suits your audience. Each pairs naturally with `docs/screenshots/demo-overview.gif`.

### Pull-quote inventory (drop into any post)

- "Visual editor for TikZ & pgfplots that renders inline in your notes - no TeX install needed."
- "Click the rendered chart to re-open the modal pre-filled."
- "Composable tools layer: area between curves, intersections, reference lines, free shapes - all referenced by name, not index."
- "60 fps surfaces. Up to 400 samples per axis."
- "MIT licensed. Zero telemetry. Zero network."
