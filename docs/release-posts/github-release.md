# GitHub Release text

For the Release page of the relaunch. The release workflow has already filled the release with the changelog section of the tag; paste the text below **above** those notes.

**Attach:** nothing to upload. The text loads [`hero.png`](../media/hero.png) and [`overview.gif`](../media/overview.gif) from the `main` branch, so `docs/media` has to be pushed first. The GIF is a 17.6 s loop of the film's second part; to show the whole film (40 s) as a player as well, drag [`overview.mp4`](../media/overview.mp4) into the text field under the GIF line.

**Limit:** 125000 characters.

````markdown
![Easy TikZ 4: the editor on a linear program, with the shaded feasible region, its constraint lines, corner points and the optimum](https://raw.githubusercontent.com/Saiki77/easy-tikz/main/docs/media/hero.png)

Easy TikZ is a visual editor for TikZ and pgfplots charts in Obsidian. Charts render in your notes with no TeX install, and the Code tab holds pgfplots code that compiles with pdflatex.

Version 4 is a redesign around four goals: a clearer editor, sliders that move the picture while you drag them, shapes you edit by dragging them in the preview, and more power for complex pictures from fewer, more general tools.

![Part 2 of the Easy TikZ 4 overview film: on the Tangent explorer example, with the area between x^3 - 3x and its tangent added, the tangent point is dragged from a = 1 to a = -1, and tangent, slope and area follow; then play moves the slider by itself, and the three definitions behind the chart are shown](https://raw.githubusercontent.com/Saiki77/easy-tikz/main/docs/media/overview.gif)

## What is new in version 4

- **Four tabs instead of eight.** Build holds everything you draw as one list of cards, Chart the ranges and axes, Code the LaTeX, Help the guides and the reference.
- **Sliders that move the picture.** A slider is a named number you can use in every formula, domain, condition, label and axis range. The preview redraws while you drag it, and play sweeps it.
- **Drag to edit.** Drag a line, curve, point or label in the 2D preview and Easy TikZ rewrites the numbers in its formula so that the part you grabbed stays under the pointer. Shift-drag turns a line or stretches a curve around a pivot: the constraint `x + 3y <= 6` becomes `x + 2y <= 5`. A tip shows in advance which numbers will change, and every drag is one undo step.
- **Five general tools instead of eleven special ones.** Region shades where inequalities hold. Curve draws an equation in x and y, or level curves. Points marks lists, intersections, corners, integer points, or the optimum of an objective. Segment draws lines, arrows, polygons and braces. Plane cuts a 3D surface. **+ Add** lists 23 recipes in plain words that pre-fill them.
- **Optimisation diagrams.** A feasible region with labelled constraint lines, an objective line on a slider, the optimum, the corner points, integer points, and level curves that touch a constraint.
- **Computed values and label templates.** A points tool publishes its results as `P1_x`, `P1_y` and `P1_val`. Any field can use them, and labels print them: `z* = {P1_val:1}`.
- **Sliders in your notes.** A chart in a note shows its sliders under it. Moving them redraws the chart and never writes to the note.
- **An export that compiles.** A complete standalone document, trigonometry in radians, the colours of the preview, and shapes exported from the same scene the preview draws.
- **Errors under the field, with a fix.** `a x^2` with no slider `a` offers **Add slider a**. The rest of the chart still draws. Closing the editor by accident loses nothing: the chart is kept as a draft.

## Guides

20 step-by-step guides (142 steps), from the first formula to integer programs and LaTeX export:

- In the editor: the **Help** tab. Every step shows a live chart and has a button that loads the step into the editor.
- On GitHub: [docs/guides](https://github.com/Saiki77/easy-tikz/blob/main/docs/guides/README.md). The same steps with 137 screenshots of the plugin in Obsidian.

Good ones to start with: [Your first chart](https://github.com/Saiki77/easy-tikz/blob/main/docs/guides/first-chart.md), [Drag shapes to edit them](https://github.com/Saiki77/easy-tikz/blob/main/docs/guides/drag-to-edit.md), [Sliders that move the picture](https://github.com/Saiki77/easy-tikz/blob/main/docs/guides/sliders.md), [Shade the areas between two curves](https://github.com/Saiki77/easy-tikz/blob/main/docs/guides/areas-between.md) and [Solve a linear program in a picture](https://github.com/Saiki77/easy-tikz/blob/main/docs/guides/linear-program.md).

## Coming from 3.x

- Your charts keep working. 3.x blocks are converted when they render or open, and a note is only rewritten when you press **Save changes**.
- Blocks saved with version 4 cannot be read by 3.x.
- A drag that starts on a shape now edits it. To pan, drag empty space, hold Space or use the middle mouse button, or switch **Edit shapes by dragging** off in the preview.
- `ax` is one name: write `a x` or `a*x`. `1/2x` means `(1/2)*x`.
- Exported code has a different shape: coordinates instead of `fillbetween`, radians, colours defined in the picture. If you post-process exports, check them again.

The guide [Coming from 3.x](https://github.com/Saiki77/easy-tikz/blob/main/docs/guides/from-3x.md) shows where the old tabs and tools went, and the [changelog](https://github.com/Saiki77/easy-tikz/blob/main/CHANGELOG.md) has the full list.

## Install

Easy TikZ needs Obsidian 1.13 or newer and runs on desktop only.

- **In Obsidian:** Settings > Community plugins > Browse, search **Easy TikZ**, Install, Enable.
- **BRAT:** add `Saiki77/easy-tikz` as a beta plugin.
- **By hand:** copy `main.js`, `manifest.json` and `styles.css` from this release into `<vault>/.obsidian/plugins/easy-tikz/`.

The three files are built by the release workflow and carry a build provenance attestation: `gh attestation verify main.js --repo Saiki77/easy-tikz`.

MIT licensed. No network access, no telemetry.
````
