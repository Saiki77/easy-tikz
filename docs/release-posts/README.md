# Release posts: the Easy TikZ 4 relaunch

Announcement texts per channel, ready to copy. Each text sits in a code block (use the copy button), and above it are the media files to attach and the length limit of the platform.

| File | Channel | Limit | Attach |
| --- | --- | --- | --- |
| [`github-release.md`](github-release.md) | GitHub Release page | 125,000 characters | [`hero.png`](../media/hero.png) and [`overview.gif`](../media/overview.gif), linked by URL in the text |
| [`forum.md`](forum.md) | Obsidian forum, Share & showcase | title 255, body 32,000 characters | [`hero.png`](../media/hero.png), [`overview.gif`](../media/overview.gif) and three cards, linked by URL in the text |
| [`reddit.md`](reddit.md) | r/ObsidianMD | title 300, body 40,000 characters | [`overview.mp4`](../media/overview.mp4) |
| [`social.md`](social.md) | X, Mastodon, Bluesky | 280, 500 and 300 characters | [`overview.mp4`](../media/overview.mp4), then one card or clip per reply |

## Before you post

1. **Release first, then post.** The guides in the Help tab ship with 4.1.0 (tagged 2026-10-13), together with the fixes the media show (formulas in labels at the size the PDF has, the Start a chart field with the cursor in it). The README on `main` and every post describe that version, so post once its release is live.
2. **The media travel with that push.** `docs/media` and `docs/guides` have to be on `main`: the GitHub release text and the forum post load their pictures from there, and every post links the guides.
3. **Set the social preview.** Upload [`docs/media/social-1280x640.png`](../media/social-1280x640.png) under repository Settings > General > Social preview. A link to the repository then shows that card wherever a platform builds a link preview.
4. **Rebuild the media if the plugin changed** since they were made (see [`scripts/media`](../../scripts/media/README.md)), then look at every file. `npm run media:guides` rewrites the guides; pictures that still show the same stay untouched. The overview film and the drag clip come from `npm run media:film -- overview` and `npm run media:film -- sample --name clip-drag`, the hero and the drag page from the proofs of `npm run media:brand`: these write to a folder of their own, so copy what you approve into `docs/media`. The other cards, the social images and the other clips come from the first-round scripts (`node scripts/media/build-promo.mjs`, `node scripts/media/build-video.mjs clip-sliders`); a video is rewritten whenever it is filmed, so name the scenarios that changed.

## Order

1. **Version, tag and push.** Rename `## [Unreleased]` in the changelog to `## [x.y.z] - date`, then run `npm version x.y.z`: it sets the version in `package.json`, `manifest.json` and `versions.json`, commits them with the changelog and creates the tag `x.y.z` (no `v`, see `.npmrc`). Push `main` and the tag (`git push origin main x.y.z`). The release workflow stops when the tag and the version in `manifest.json` differ; otherwise it publishes the GitHub Release with the changelog section of that version as its text and attaches `main.js`, `manifest.json` and `styles.css`. Before tagging, run `npm run build && npm run media:smoke -- --root`.
2. **GitHub Release.** Open the published release and paste the text of `github-release.md` above the notes the workflow put there.
3. **Forum.** Post `forum.md` in Share & showcase.
4. **Reddit.** Post `reddit.md` to r/ObsidianMD. Read the subreddit rules in the sidebar first and pick the flair it offers for plugins.
5. **Social.** Send the three posts in `social.md`, each with the overview video. The replies under "Thread" can follow over the next days, one feature each.

## Media

Everything is in [`docs/media`](../media), captured from the plugin running in Obsidian (light theme).

| File | What it is | Use it for |
| --- | --- | --- |
| [`hero.png`](../media/hero.png) | 2400 x 1350, the title page on graph paper: the redesigned editor on the Linear program example, with notes | top of a long post |
| [`overview.mp4`](../media/overview.mp4) | 40.5 s, 1920 x 1080, 60 fps, 8.4 MB, no sound. Title card, §1 Drag to edit (the Linear program example: drag the objective line, Shift-turn it about the optimum), §2 Dynamics (the Tangent explorer example with the area between curve and tangent added: drag the tangent point, press play, the three definitions), end card | the main video on every channel |
| [`overview.gif`](../media/overview.gif) | §2 of the film as a 17.6 s loop, 960 x 540, 4.6 MB | where a video cannot be embedded |
| [`overview-poster.png`](../media/overview-poster.png) | 1920 x 1080, a frame of §2: the tangent flat on the maximum, the area beside it | video cover, or a still where no video is possible |
| [`card-drag.png`](../media/card-drag.png) | 1600 x 1000, the page "§1 Drag to edit" in the same design as the film (Shift held over the objective line, the pivot, the equations before and after) | the drag to edit reply or section |
| `card-sliders.png`, `card-regions.png`, `card-notes.png`, `card-export.png`, `card-3d.png`, `card-tools.png` | 1600 x 1000 feature cards of the first round, numbered 02 to 07 in this order | one card per reply or per section |
| [`clip-drag`](../media/clip-drag.mp4) | 19 s, `.mp4` at 1920 x 1080 (4.2 MB), `.gif` at 960 x 540 (6.9 MB), `-poster.png` at 1920 x 1080. Drag to edit as a film of its own, with the moves of the overview's §1: drag the objective line, Shift-turn it, its formula follows | the drag to edit post |
| `clip-shift`, `clip-sliders`, `clip-areas`, `clip-quickfix`, `clip-3d`, `clip-note` | 10 to 14 s each, as `.mp4`, `.gif` and `-poster.png` (a still at twice the size of the video) | one feature per post |
| [`social-1280x640.png`](../media/social-1280x640.png) | GitHub social preview | repository settings (step 3 above) |
| [`social-1200x675.png`](../media/social-1200x675.png) | 16:9 card | a single-image post, a link card |
| [`square-1080.png`](../media/square-1080.png) | 1080 x 1080 | channels that prefer square pictures |

The videos have captions burnt in and no sound, so they work muted. Write alt text when a platform offers the field: `social.md` has it for the overview video and its GIF, the drag clip and every card.

## Facts you can quote

All of these are true of the repository today. Check them again if the plugin changed.

- Easy TikZ is a visual editor for TikZ and pgfplots charts in Obsidian. Charts render in the note with no TeX install.
- Four tabs (Build, Chart, Code, Help) replace the eight tabs of 3.x.
- Five general tools (Region, Curve, Points, Segment, Plane) replace the eleven single-purpose tools of 3.x. + Add lists 23 recipes in 2D and 7 in 3D.
- Sliders redraw the preview while you drag them, and play sweeps them. In a note, moving a slider never writes to the note.
- Drag to edit rewrites only the numbers of a formula. Shift-dragging the constraint `x + 3y <= 6` from (0, 2) to (0, 2.5) turns it around the corner (3, 1) into `x + 2y <= 5`.
- The export is a standalone document that compiles with pdflatex. The test suite compiles 35 exports with pdflatex.
- 600 unit tests in 20 files, 264 of them for drag to edit, plus a smoke test of about 40 checks in a real Obsidian.
- 20 guides with 142 steps. On GitHub they come with 137 screenshots of the plugin in Obsidian, one for nearly every step (five steps have nothing to show in the app).
- 3.x charts are converted when they render or open. A note is only rewritten when you press Save changes.
- Needs Obsidian 1.13 or newer, desktop only. MIT licensed, no network access, no telemetry.

## One-liners for other places

Plugin lists, profile links, newsletters, a talk slide.

**Limit:** 60 characters.

```text
Draw TikZ and pgfplots charts in Obsidian.
```

**Limit:** 120 characters.

```text
Easy TikZ 4: a visual editor for TikZ and pgfplots charts in Obsidian, with live sliders, drag to edit and LaTeX export.
```

**Limit:** 250 characters.

```text
Easy TikZ 4 is an Obsidian plugin for drawing function plots, shaded regions and optimisation diagrams without writing TikZ. Sliders move the picture, a dragged line rewrites the numbers in its formula, and the export compiles with pdflatex.
```

## Checking the posts

The links, the attached files and the lengths were checked when these texts were written: every relative link exists, and every code block is within the **Limit** stated above it. After an edit, count again. X and Mastodon count every link as 23 characters whatever its length; Bluesky counts the characters you see.
