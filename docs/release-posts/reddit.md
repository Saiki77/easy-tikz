# Reddit: r/ObsidianMD

Read the subreddit rules in the sidebar before posting and pick the flair it offers for plugins.

**Attach:** [`overview.mp4`](../media/overview.mp4) (54 s, 1.6 MB, captions burnt in, no sound). Put it at the top of the post. If the post editor takes pictures only, use [`hero.png`](../media/hero.png), [`card-drag.png`](../media/card-drag.png), [`card-sliders.png`](../media/card-sliders.png) and [`card-regions.png`](../media/card-regions.png) as a gallery and link the video on GitHub.

## Title

**Limit:** 300 characters.

```text
Easy TikZ 4: draw TikZ / pgfplots charts in Obsidian with live sliders and drag to edit (free, open source)
```

## Text

**Limit:** 40000 characters.

````markdown
I maintain Easy TikZ, a plugin for drawing function plots, shaded regions and optimisation diagrams in a visual editor instead of writing TikZ. The chart renders in your note with no TeX install, and when you need the figure in a paper, the Code tab holds pgfplots code that compiles with pdflatex.

Version 4 is a redesign. The video shows it in 54 seconds. What changed:

- **Sliders that move the picture.** A slider is a named number you can use in any formula, domain, condition or label. The preview redraws while you drag it, and play sweeps it.
- **Drag to edit.** Grab a line, curve, point or label in the preview and the plugin rewrites the numbers in its formula so it stays under the pointer. Shift-drag turns a line around a pivot: the constraint `x + 3y <= 6` becomes `x + 2y <= 5`. Before you drag, a tip shows which numbers will change. Every drag is one undo step.
- **Five general tools instead of eleven special ones.** A region is a list of inequalities, one per row (`f2 <= y <= f1`, `x + y <= 4`). A curve is any equation in x and y. A points tool marks intersections, corners, integer points, or the optimum of an objective. The + Add menu lists 23 recipes in plain words, so you rarely pick a tool yourself.
- **Optimisation diagrams.** Feasible region, labelled constraint lines, objective line on a slider, the optimum and the corner points. Drag a constraint and the optimum follows.
- **Charts in notes keep their sliders.** Moving a slider in a note redraws the chart and never edits the note. Click the chart to open it in the editor again.
- **An export that compiles.** A complete standalone document. The PDF shows the picture the preview shows, because both are drawn from the same scene.
- **Guides.** 20 step-by-step guides, in the editor's Help tab with live charts, and on GitHub with 137 screenshots: https://github.com/Saiki77/easy-tikz/blob/main/docs/guides/README.md

If you used 3.x: your charts keep working. They are converted when they render or open, and a note is only rewritten when you press Save changes. Blocks saved with version 4 cannot be read by 3.x, and a drag that starts on a shape now edits it instead of panning (drag empty space, or switch the feature off in the preview). The guide "Coming from 3.x" shows where the eight old tabs went.

**Install:** Settings > Community plugins > Browse, search "Easy TikZ". Or BRAT with `Saiki77/easy-tikz`. It needs Obsidian 1.13 or newer and runs on desktop only.

**Repository:** https://github.com/Saiki77/easy-tikz

MIT licensed, no network access, no telemetry.

I would like to hear two things: which pictures you tried to draw and could not, and where dragging a shape changed a number you did not expect.
````
