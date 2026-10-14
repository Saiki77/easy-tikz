# Short posts: X, Mastodon, Bluesky

One announcement per network, then a thread of replies that show one feature each, then alt texts and answers to the usual questions.

**Attach to each announcement:** [`overview.mp4`](../media/overview.mp4) (40 s, 1920 x 1080, 8.4 MB, H.264, captions burnt in, no sound). If a network refuses the video, use [`overview.gif`](../media/overview.gif) (a 17.6 s loop of the film's second part, 4.6 MB), or the still [`social-1200x675.png`](../media/social-1200x675.png). Use [`overview-poster.png`](../media/overview-poster.png) where a network asks for a cover picture.

## X

**Limit:** 280 characters.

```text
Easy TikZ 4 for Obsidian is out.

A visual editor for TikZ and pgfplots charts:
- sliders move the picture while you drag
- drag a line and the numbers in its formula follow
- regions from inequalities
- an export that compiles with pdflatex

github.com/Saiki77/easy-tikz
```

## Mastodon

**Limit:** 500 characters.

```text
Easy TikZ 4 for Obsidian is out: a visual editor for TikZ and pgfplots charts, redesigned.

- Sliders move the picture while you drag them
- Drag a line, curve or point and the numbers in its formula follow
- Regions from inequalities, linear programs with their optimum
- Charts render in your notes, no TeX install
- The export compiles with pdflatex
- 20 step-by-step guides with screenshots

MIT, no network, no telemetry.

https://github.com/Saiki77/easy-tikz

#Obsidian #TikZ #pgfplots #LaTeX
```

## Bluesky

**Limit:** 300 characters.

```text
Easy TikZ 4 for Obsidian: a visual editor for TikZ and pgfplots charts. Sliders move the picture while you drag, a dragged line rewrites the numbers in its formula, regions come from inequalities, and the export compiles with pdflatex.

20 guides with screenshots: github.com/Saiki77/easy-tikz
```

## Thread

Replies to your own announcement, one feature each. Every text fits all three networks.

### Reply 1: drag to edit

**Attach:** [`clip-drag.mp4`](../media/clip-drag.mp4) (19 s), or the picture [`card-drag.png`](../media/card-drag.png).

**Limit:** 280 characters.

```text
Drag to edit: grab a line, curve or point in the preview, and Easy TikZ rewrites the numbers in its formula so it stays under the pointer.

Shift-drag turns a line around a pivot: 2x + 3y = c becomes 2.5x + 3y = c. A tip shows beforehand which numbers will change.
```

### Reply 2: sliders

**Attach:** [`clip-sliders.mp4`](../media/clip-sliders.mp4) (11 s), or the picture [`card-sliders.png`](../media/card-sliders.png).

**Limit:** 280 characters.

```text
Sliders: a named number you can use in any formula, domain, condition or label. The preview redraws while you drag, and play sweeps it.

Type a formula with an unknown letter and the editor offers to add the slider.
```

### Reply 3: regions and optimisation

**Attach:** [`clip-areas.mp4`](../media/clip-areas.mp4) (14 s), or the picture [`card-regions.png`](../media/card-regions.png).

**Limit:** 280 characters.

```text
Regions: a list of conditions, one per row, such as f2 <= y <= f1 or x + y <= 4.

That covers several areas between curves, and the feasible region of a linear program with its constraint lines, corner points and optimum.
```

### Reply 4: notes and export

**Attach:** [`clip-note.mp4`](../media/clip-note.mp4) (10 s), or the two pictures [`card-notes.png`](../media/card-notes.png) and [`card-export.png`](../media/card-export.png). Mastodon and Bluesky take either one video or pictures, not both.

**Limit:** 280 characters.

```text
In a note the chart keeps its sliders. Moving them redraws the chart and never edits the note.

For a paper, the Code tab holds a complete standalone document. pdflatex draws the picture the preview shows.
```

### Reply 5: guides

**Attach:** the picture [`social-1200x675.png`](../media/social-1200x675.png), or no media: the link shows the repository card. Before the Help tab guides ship, delete the last sentence.

**Limit:** 280 characters.

```text
20 step-by-step guides with 137 screenshots, from the first chart to linear programs and LaTeX export:

github.com/Saiki77/easy-tikz/blob/main/docs/guides/README.md

The same guides are in the editor's Help tab, with live charts.
```

## Alt texts

Paste into the description field of the media. Each is under 1000 characters.

**`overview.mp4`**

**Limit:** 1000 characters.

```text
Film of Easy TikZ 4 in Obsidian, 40 seconds, on a page of graph paper, with a caption for each step. A title card: Easy TikZ 4, TikZ charts from formulas, now fully interactive. Section 1, Drag to edit: on the Linear program example the dashed objective line 2x + 3y = c is dragged until it touches the optimum, and slider c follows from 5 to 9. With Shift held the line turns about the optimum (3, 1), and its Equation field now reads 2.5x + 3y = c. Section 2, Dynamics: the Tangent explorer example, with the area between the curve x^3 - 3x and its tangent added. The point where the tangent touches is dragged from a = 1 to a = -1: tangent, slope and area follow, and at a = 0 the area flips to the other side. Play then moves the slider by itself, and the three definitions behind the chart are shown as equations. An end card says how to install: Settings, Community plugins, Easy TikZ.
```

**`overview.gif`** (the loop of the film's section 2)

**Limit:** 1000 characters.

```text
A loop of about 18 seconds from the Easy TikZ 4 film, on graph paper. On the Tangent explorer example, with the area between the curve x^3 - 3x and its tangent added, the point where the tangent touches is dragged from a = 1 to a = -1. Tangent, slope and area follow; at a = 0 the area shrinks to nothing and grows back on the other side, and at a = -1 the tangent lies flat on the maximum. Play then moves the slider by itself, and the three definitions behind the chart are shown as equations: the curve, the tangent and the region between them.
```

**`clip-drag.mp4` and `clip-drag.gif`**

**Limit:** 1000 characters.

```text
A 19 second film on graph paper. It opens on the page Drag to edit with the Linear program example at c = 5, then moves into the editor. The dashed objective line 2x + 3y = c is dragged up through the feasible region and slider c follows from 5 to 9. With Shift held the line turns about the optimum (3, 1), marked as the pivot, and the tip at the pointer reads C1: 2.5x + 3y = c, c = 10.5, slope -5/6. The card then shows the new equation 2.5x + 3y = c, and the optimum card now reads Max of 2.5x + 3y over R1. The end card shows the install path: Settings, Community plugins, Easy TikZ.
```

**`card-drag.png`**

**Limit:** 1000 characters.

```text
A page on graph paper titled §1 Drag to edit. The text says: Drag a line and its numbers follow. Hold Shift and it turns about the ringed point instead. Below it, 2x + 3y = c with c = 9 becomes 2.5x + 3y = c with c = 10.5 after a Shift-drag from (1.5, 2) to (1.5, 2.25). Figure 1 shows Shift held over the dashed objective line of the Linear program example, with the pivot ringed at the optimum (3, 1) and a margin note: the pivot. The hover tip, enlarged beside the figure, reads: C1: 2x + 3y = c. Shift-drag turns around (3, 1). Also changes P1's objective (same text).
```

**`card-sliders.png`**

**Limit:** 1000 characters.

```text
Card with the headline "Sliders move the picture." A supply and demand chart shown at two values of slider a: small at 0.6 and large at 2.2, with the Sliders dock under it. The demand line turns, and the equilibrium point and the shaded consumer and producer surplus follow.
```

**`card-regions.png`**

**Limit:** 1000 characters.

```text
Card with the headline "Shade by inequality." Two areas between sin(x) and cos(x), shaded in blue and orange and labelled A1 and A2, and under them the region card of a linear program with its four conditions, one per row.
```

**`card-notes.png`**

**Limit:** 1000 characters.

```text
Card with the headline "Lives in your notes." A note titled Damped oscillation with a chart of a decaying wave and three sliders a, k and w under it. Slider k is being dragged.
```

**`card-export.png`**

**Limit:** 1000 characters.

```text
Card with the headline "Exports to LaTeX." The same linear program twice: as the preview in Obsidian and as the PDF that pdflatex compiled from the exported code. Below them the first lines of the LaTeX document.
```

**`card-3d.png`**

**Limit:** 1000 characters.

```text
Card with the headline "Surfaces in 3D." The bowl-shaped surface z = x^2 + y^2 in a box, cut by a horizontal plane at z = 3. A slider h under the chart moves the plane.
```

**`card-tools.png`**

**Limit:** 1000 characters.

```text
Card with the headline "Five tools. Not eleven." The + Add menu of the editor with its recipes in groups: Functions, Regions, Curves and lines, Points, Segments and arrows, Labels, Sliders.
```

## Answers to the usual questions

Texts you can adapt in replies. No length limit is checked here; shorten them for X.

**How is this different from TikZJax?**

```text
TikZJax compiles TikZ code you write, inside Obsidian. Easy TikZ is the other way round: you build the chart in a visual editor, the plugin draws it with its own renderer, and it writes the pgfplots code for you when you want to compile elsewhere. The two can be installed together: Easy TikZ only handles easy-tikz code blocks unless you switch on a setting.
```

**Do I need LaTeX installed?**

```text
Not for charts in your notes: the plugin draws them itself. You need LaTeX only to compile the exported code into a PDF.
```

**What happens to my 3.x charts?**

```text
They keep working. A 3.x chart is converted when it renders or opens, and the note is only rewritten when you press Save changes in the editor. Blocks saved with version 4 cannot be read by 3.x.
```

**Does it work on mobile?**

```text
No. Easy TikZ is a desktop plugin and needs Obsidian 1.13 or newer.
```
