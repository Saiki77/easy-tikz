# What's new in Easy TikZ

[Overview](../README.md) · [Guides](guides/README.md) · [Reference](reference.md) · [Changelog](../CHANGELOG.md)

## 4.5: charts in plain words, drawn as you type

<p align="center">
  <a href="media/text.mp4"><img src="media/text.gif" alt="A 37 second film on graph paper: §3 Charts as text. Write the chart in plain words. A note in Obsidian holds one sentence and no chart. A block is opened with three backticks and easy-tikz; Obsidian closes it, and nothing shows under the empty block. The first line, size 12 x 6, makes the chart fade up under the block on the default range; the next, show x from 0 to 5.5 and y from 0 to 3, makes its axes glide there as the numbers are typed, and axes on the edges moves them to the edges. Then, one line each: shade where x + y &lt;= 4 and x + 3y &lt;= 6 and x &gt;= 0 and y &gt;= 0, numbered (the region fades in), slider c from 0 to 15, starting at 6 (a slider appears under the chart), draw 2x + 3y = c in red, dashed (the dashed line draws itself) and mark the maximum of 2x + 3y in the region, large, with coordinates (the optimum (3, 1) pops in). The 4 in x + y &lt;= 4 becomes a 5: the region grows and the optimum slides to (4.5, 0.5), and a note says: the optimum slides. A click on the note's first line hands the lines over to the chart." width="100%"></a>
</p>
<p align="center">One note in Live Preview, from no chart at all: a block is opened, each line is typed in words, and the chart appears under the block and follows every key. <a href="media/text.mp4">Watch the MP4</a> (37 s).</p>

```easy-tikz
show x from 0 to 5.5 and y from 0 to 3
axes on the edges
size 12 x 6
shade where x + y <= 4 and x + 3y <= 6 and x >= 0 and y >= 0, numbered
slider c from 0 to 15, starting at 6
draw 2x + 3y = c in red, dashed
mark the maximum of 2x + 3y in the region, large, with coordinates
```

- **Lines in plain words.** A line starts with what it does: `show`, `plot`, `shade`, `draw`, `mark` or `write`. Options read like words and need no `|`: `in red, thick and dashed`, `with its tangent at a and its extrema`, `from x = 0 to 4`. `the region` is the chart's only region, and `#` starts a comment. The short forms of 4.4 (`view x 0..5`, `f(x) = x^2 | blue`) keep working and mean the same.
- **The chart under the block.** While you edit a block in Live Preview, its chart sits right under its lines and changes as you type: numbers glide, new objects pop in, and a half-typed line keeps its last working version on screen. Leave the block and Obsidian's own chart takes over in the same frame. Setting **Chart under the block while you edit** (on by default).
- **The editor writes the new lines.** Insert into note and Save changes write lines in words, and lines you did not touch stay as you wrote them. The guides end with their finished chart in this form, and AI apps learn it from the [AI guide](ai.md#the-text-syntax).

**4.5.1.** A new block shows nothing under it until its first line draws something, then its chart fades up; problems under the chart wait until you pause typing.

## 4.4: charts as text, charts that move, phones and tablets

- **Charts as text.** A chart can live in the note as a few lines of text, one line per object, instead of a JSON object. The editor writes text back line by line, keeping your comments; JSON blocks keep working as before.
- **Charts that move.** Change a number and the chart glides to the new value; an object you add pops in. Setting **Animate chart changes**; nothing moves when your system asks for reduced motion.
- **Phones and tablets.** Charts draw in your notes on iPhone, iPad and Android, and the editor fills the screen there.
- **Theme colours.** Charts take the colours of your theme and follow light and dark mode. The setting **Chart colours** can pin the fixed colours of the LaTeX export.

## 4.3: make charts with AI

- **The AI tab.** A local AI server for AI apps on this computer (off until you switch it on), a guide to paste into AI chats with **Paste the chart** to bring the answer back, and a section for `AGENTS.md` and `CLAUDE.md`. See [Make charts with AI](reference.md#make-charts-with-ai).
- **Blocks written by hand or by an AI render even when they are a little off:** `//` and `/* */` comments, trailing commas, and a missing `"v": 4`.

## 4.2: What's new popup and four guides

- **A "What's new" popup.** After you update, Easy TikZ shows once what is new, with a live chart whose slider you can drag or play. A new install never shows it. Open it again with the command **Show what's new in version 4** or the link in the Help tab, or switch it off with the setting **Show what's new after updates**.
- **Four guides on live calculations and sliders:** [Animate a chart with play](guides/animate-play.md), [From secant to tangent](guides/secant-tangent.md), [An area that grows with a slider](guides/area-accumulation.md) and [Calculate with computed points](guides/computed-values.md).

## 4.0: drag to edit, live sliders, a new editor

**Drag to edit.** Grab a line, curve, point or label in the preview and the numbers in its formula follow the pointer. Hold Shift and a line turns about a point instead.

<p align="center">
  <img src="media/card-drag.png" alt="Section 1, Drag to edit, a page on graph paper. The text says: drag a line and its numbers follow; hold Shift and it turns about the ringed point instead. Below it, 2x + 3y = c with c = 9 becomes 2.5x + 3y = c with c = 10.5 after a Shift-drag from (1.5, 2) to (1.5, 2.25). Figure 1 shows Shift held over the dashed objective line of the Linear program example, with the pivot ringed at the optimum (3, 1). The hover tip, enlarged beside the figure, reads: C1: 2x + 3y = c. Shift-drag turns around (3, 1). Also changes P1's objective (same text)." width="100%">
</p>

<p align="center">
  <a href="media/clip-drag.mp4"><img src="media/clip-drag.gif" alt="A 19 second film on graph paper. It opens on the page Drag to edit with the Linear program example at c = 5, then moves into the editor. The dashed objective line 2x + 3y = c is dragged up through the feasible region and slider c follows from 5 to 9. With Shift held the line turns about the optimum (3, 1), marked as the pivot, and the tip at the pointer reads C1: 2.5x + 3y = c, c = 10.5, slope -5/6. The card then shows the new equation 2.5x + 3y = c, and the optimum card now reads Max of 2.5x + 3y over R1. The end card shows the install path: Settings, Community plugins, Easy TikZ." width="100%"></a>
</p>
<p align="center">Drag the line and slider c follows. Hold Shift and it turns about the optimum, and its formula follows: 2x + 3y = c becomes 2.5x + 3y = c. <a href="media/clip-drag.mp4">Watch the MP4</a> (19 s).</p>

- **Live sliders.** Any number can be a slider: in formulas, conditions, labels and axis ranges. Drag one or press play, and the picture follows while it moves. [Sliders and live values](reference.md#sliders-and-live-values)
- **Live calculations.** Points publish their results (`P1_x`, `P1_val`, `P1_n`), and any formula or label can use them: `z* = {P1_val:2}`.
- **Five general tools, not eleven.** Regions from inequalities, curves from equations, points (intersections, corners, the optimum, integer points), segments and 3D planes. [Tools](reference.md#tools)
- **Charts in your notes keep their sliders.** Moving them never changes the note. [Charts in notes](reference.md#charts-in-notes)
- **A redesigned editor.** Five tabs, one card per object, problems shown under their field (often with a one-click fix), undo, and a draft that survives closing. [The editor](reference.md#the-editor)
- **LaTeX that compiles.** A standalone document by default, in the colours and layers of the preview. [Export](reference.md#export)
- **Guides in the Help tab.** Step-by-step guides with live charts, and the same guides with screenshots on GitHub. [Guides](guides/README.md)

## Coming from 3.x or 2.x

**From 3.x.** Existing `easy-tikz` blocks keep working: they are migrated in memory when they render or open, and the note is only rewritten when you press **Save changes** in the editor. The guide [Coming from 3.x](guides/from-3x.md) shows where the eight old tabs went, and the [Changelog](../CHANGELOG.md) says what migration does.

**From 2.x.** The plugin id changed to `easy-tikz` in 3.0. Rename `.obsidian/plugins/tikz_graph_helper/` to `.obsidian/plugins/easy-tikz/`, then enable it again. Settings carry over.

Every picture and film on these pages shows the plugin running in Obsidian, moved by real mouse and keyboard input. The graph paper, the notes and the arrows around the captures are added afterwards. The scripts that make them are in [`scripts/media`](../scripts/media/README.md).
