# Obsidian forum: Share & showcase

For [forum.obsidian.md](https://forum.obsidian.md), category Share & showcase. Add the tags the forum offers for plugins.

**Attach:** nothing to upload if `docs/media` is on `main`: the text loads [`hero.png`](../media/hero.png), [`overview.gif`](../media/overview.gif), [`card-drag.png`](../media/card-drag.png), [`card-sliders.png`](../media/card-sliders.png) and [`card-regions.png`](../media/card-regions.png) by URL. If a picture does not show in the preview of the post, delete its line and upload the file in its place. Should the forum refuse the GIF (4.6 MB), use [`overview-poster.png`](../media/overview-poster.png) and keep the link to the video.

## Title

**Limit:** 255 characters.

```text
Easy TikZ 4: a visual editor for TikZ and pgfplots charts, with live sliders and drag to edit
```

## Text

**Limit:** 32000 characters.

````markdown
![Easy TikZ 4: the editor on a linear program, with the shaded feasible region, its constraint lines, corner points and the optimum](https://raw.githubusercontent.com/Saiki77/easy-tikz/main/docs/media/hero.png)

Easy TikZ is a plugin for drawing function plots, shaded regions and optimisation diagrams in a visual editor instead of writing TikZ. A chart renders in your note with no TeX install, and the Code tab holds pgfplots code that compiles with pdflatex.

Version 4 is a redesign of the whole editor. Here is one slider at work: drag the point where the tangent touches the curve, and the tangent and the area between them follow. The whole film, 40 seconds with drag to edit first: [MP4](https://github.com/Saiki77/easy-tikz/blob/main/docs/media/overview.mp4).

![Part 2 of the Easy TikZ 4 overview film: on the Tangent explorer example, with the area between x^3 - 3x and its tangent added, the tangent point is dragged from a = 1 to a = -1, and tangent, slope and area follow; then play moves the slider by itself, and the three definitions behind the chart are shown](https://raw.githubusercontent.com/Saiki77/easy-tikz/main/docs/media/overview.gif)

## Drag a shape and its numbers follow

Grab a line, curve, point or label in the preview. Easy TikZ rewrites the numbers in its formula so that the part you grabbed stays under the pointer, and only the numbers: your spacing and your way of writing the formula stay. Shift-drag turns a line or stretches a curve around a pivot. Rest the pointer on a shape and a tip shows in advance what will change. Every drag is one undo step.

![Drag to edit: Shift held over the dashed objective line 2x + 3y = c of a linear program, with the pivot ringed at the optimum (3, 1); beside it, 2x + 3y = c with c = 9 becomes 2.5x + 3y = c with c = 10.5 after a Shift-drag](https://raw.githubusercontent.com/Saiki77/easy-tikz/main/docs/media/card-drag.png)

## Sliders move the picture

A slider is a named number you can use in any formula, domain, condition, label or axis range. The preview redraws while you drag, and play sweeps the slider. Type a formula with a letter the chart does not know, and the line under the field offers to add the slider. A chart in a note keeps its sliders under it; moving them redraws the chart and never writes to the note.

![Sliders: the Market equilibrium example at a = 0.6 and a = 2.2, where the demand line, the equilibrium and the surplus areas follow the slider](https://raw.githubusercontent.com/Saiki77/easy-tikz/main/docs/media/card-sliders.png)

## Regions from inequalities, and optimisation diagrams

Five general tools replace the eleven single-purpose tools of 3.x: Region, Curve, Points, Segment and Plane. A region is a list of conditions, one per row, such as `f2 <= y <= f1` or `x + y <= 4`. That covers several areas between curves in different colours, and the feasible region of a linear program with labelled constraint lines, its corner points and its optimum. A points tool publishes what it finds (`P1_x`, `P1_y`, `P1_val`), so other formulas and labels can use the optimum. The + Add menu lists 23 recipes in plain words that pre-fill these tools.

![Regions: two areas between sin(x) and cos(x) in two colours, and the region card of a linear program with one condition per row](https://raw.githubusercontent.com/Saiki77/easy-tikz/main/docs/media/card-regions.png)

## Also in version 4

- Four tabs (Build, Chart, Code, Help) instead of eight.
- The export is a complete standalone document: trigonometry in radians, the colours of the preview, shapes exported from the scene the preview draws.
- Problems show under their field, often with a one-click fix, and the rest of the chart still draws.
- Undo and redo for the whole chart, and a draft that survives closing the editor by accident.
- 3D surfaces with planes that are sorted in depth with the surface they cut.

## Guides

There are 20 step-by-step guides with 137 screenshots, from [Your first chart](https://github.com/Saiki77/easy-tikz/blob/main/docs/guides/first-chart.md) to [Solve a linear program in a picture](https://github.com/Saiki77/easy-tikz/blob/main/docs/guides/linear-program.md) and [Export to LaTeX](https://github.com/Saiki77/easy-tikz/blob/main/docs/guides/export-latex.md): [all guides](https://github.com/Saiki77/easy-tikz/blob/main/docs/guides/README.md). The same guides are in the editor's Help tab, where every step shows a live chart and can be loaded into the editor.

## Coming from 3.x

Your charts keep working. They are converted when they render or open, and a note is only rewritten when you press Save changes. Three things to know: blocks saved with version 4 cannot be read by 3.x; a drag that starts on a shape now edits it (drag empty space to pan, or switch the feature off in the preview); and `ax` is one name, so write `a x` or `a*x`. The guide [Coming from 3.x](https://github.com/Saiki77/easy-tikz/blob/main/docs/guides/from-3x.md) shows where the old tabs and tools went.

## Install

Settings > Community plugins > Browse, search "Easy TikZ". Or with BRAT: `Saiki77/easy-tikz`. Easy TikZ needs Obsidian 1.13 or newer and runs on desktop only.

Repository, changelog and issues: https://github.com/Saiki77/easy-tikz

MIT licensed, no network access, no telemetry. Which pictures could you not draw with it? I would like to know.
````
