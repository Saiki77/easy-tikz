<p align="center">
  <img src="docs/media/hero.png" alt="Easy TikZ 4, an Obsidian plugin, on a page of graph paper. The headline says: TikZ and pgfplots charts for your Obsidian notes, drawn from formulas, now edited by dragging. Figure 1 is the redesigned editor on the Linear program example: the region card with its four conditions on the left, and on the right the shaded feasible region with constraint lines (1) and (2), its corner points, the dashed line z = 9 and the optimum x* = (3, 1). Notes in italics point at constraint line (1), x + y &lt;= 4 (drag this line: its formula follows), at the optimum (the optimum is computed) and at slider c (slider c moves the dashed line)." width="100%">
</p>

<p align="center">
  <a href="docs/media/overview.mp4"><img src="docs/media/overview.gif" alt="A 17.6 second loop on graph paper: section 2 of the overview film. A card reads: §2 Dynamics. Move one number and everything built on it follows. Then the editor shows the Tangent explorer example, x^3 - 3x with its tangent at slider a and the slope in the title, with a shaded area between the curve and the tangent added. The point where the tangent touches is dragged along the curve from a = 1, where the tangent lies flat on the minimum, to a = -1. Tangent, area and slope follow; the area shrinks to nothing at a = 0 and grows back on the other side (a note: at a = 0 the area flips), and at a = -1 a note says: flat on the maximum. Play is pressed in the Sliders dock, and the picture moves by itself. Last the caption says: One slider, three definitions. The rest follows. Beside the Build panel the definitions stand as equations: (1) f1(x) = x^3 - 3x, (2) f2(x) = f1(a) + (3a^2 - 3)(x - a), and (3) the region min(f1, f2) &lt;= y &lt;= max(f1, f2) for min(a, -2a) &lt;= x &lt;= max(a, -2a)." width="100%"></a>
</p>
<p align="center">Section 2 of the overview film: drag the tangent point of x^3 - 3x, and the tangent, its slope and the area between them follow; press play and it moves by itself. <a href="docs/media/overview.mp4">Watch the whole film</a> (40 s, MP4).</p>

**Easy TikZ** is an [Obsidian](https://obsidian.md) plugin for TikZ and pgfplots charts, without writing TikZ. Write a chart in your note in plain words, or build it in the editor from formulas and cards. It draws in the note as you type, with no TeX install, on phones and tablets too, and exports pgfplots code that compiles with pdflatex.

<p align="center">
  <a href="docs/whats-new.md">What's new</a> ·
  <a href="docs/guides/README.md">Guides</a> ·
  <a href="docs/reference.md">Reference</a> ·
  <a href="docs/ai.md">AI guide</a> ·
  <a href="CHANGELOG.md">Changelog</a>
</p>

- **Charts in plain words.** `plot f(x) = x^2 in blue`, `shade where x + y <= 4 and x >= 0`, `mark the maximum of 2x + 3y in the region`. While you type, the chart draws right under the block.
- **Drag to edit.** Grab a line, curve or point in the editor and the numbers in its formula follow; Shift turns a line about a point.
- **Live sliders and computed values.** Any number can be a slider, in your notes too, and computed points publish values such as `P1_x` that any formula or label can use.
- **Pictures for lectures.** Areas between curves, tangents, linear and integer programs with their optimum, level curves, market equilibria, parametric and polar curves, 3D surfaces.
- **LaTeX and AI.** Export a standalone pgfplots document that compiles with pdflatex, or let an AI app make the chart: it checks it with the plugin's own code ([AI guide](docs/ai.md)).

## What's new in 4.5

<p align="center">
  <a href="docs/media/text.mp4"><img src="docs/media/text.gif" alt="A 28 second film on graph paper: §3 Charts as text. Write the chart in plain words. A note in Obsidian holds a block, the cursor in it, its chart right under it. Typed one by one, the lines shade where x + y &lt;= 4 and x + 3y &lt;= 6 and x &gt;= 0 and y &gt;= 0, numbered, then slider c from 0 to 15, starting at 6, then draw 2x + 3y = c in red, dashed, then mark the maximum of 2x + 3y in the region, large, with coordinates: region, slider, dashed line and the optimum (3, 1) appear in the chart as their lines are typed. The 4 in x + y &lt;= 4 becomes a 5 and the optimum slides to (4.5, 0.5). A click on the note's first line hands the lines over to the chart." width="100%"></a>
</p>
<p align="center">Each line is typed in words, and the chart under the block follows every key. <a href="docs/media/text.mp4">Watch the MP4</a> (28 s).</p>

- **Charts in plain words.** A line says what it does: `show`, `plot`, `shade`, `draw`, `mark`, `write`. Options read like words: `in red, dashed`, `with its tangent at a`.
- **The chart under the block.** While you edit a block in Live Preview, its chart sits right under it and changes as you type.
- **The editor writes these lines.** Insert into note and Save changes write the new lines, and keep the ones you did not touch.

[Everything new in version 4](docs/whats-new.md): charts as text, phones and tablets (4.4), charts with AI (4.3), drag to edit and live sliders (4.0).

## Guides

24 step-by-step guides (171 steps) take you from the first formula to integer programs, live calculations and LaTeX export. They come from one source and exist in two places:

- **In the editor:** the **Help** tab. Search or pick a guide; every step shows a live chart and has a button **Open this step in the editor**, and the things to type are rows with a **Copy** button.
- **On GitHub:** [docs/guides](docs/guides/README.md). The same steps with 166 screenshots of the plugin in Obsidian, one for nearly every step, and every guide ends with its finished chart as a block to paste into a note.

Five to start with:

| Finished chart | Guide |
| --- | --- |
| <a href="docs/guides/first-chart.md"><img src="docs/guides/img/first-chart-card.png" alt="Finished chart: 2 + sin(x) in blue and 2 + cos(x) in black on a grid, with a legend" width="260"></a> | **[Your first chart](docs/guides/first-chart.md)**<br>From an empty editor to a chart in your note: type a formula, style it, set the ranges and insert it.<br>Start here · 5 min · 8 steps |
| <a href="docs/guides/drag-to-edit.md"><img src="docs/guides/img/drag-to-edit-card.png" alt="Finished chart: a blue wave and a black straight line that crosses it" width="260"></a> | **[Drag shapes to edit them](docs/guides/drag-to-edit.md)**<br>Grab a line or a curve in the preview and its numbers follow: move, turn, stretch, undo.<br>Start here · 7 min · 8 steps |
| <a href="docs/guides/sliders.md"><img src="docs/guides/img/sliders-card.png" alt="Finished chart: a wave under a title that prints the slider value, Amplitude a = -1.2" width="260"></a> | **[Sliders that move the picture](docs/guides/sliders.md)**<br>Turn a letter in a formula into a slider, set its range, play it and print its value in the chart.<br>Core · 6 min · 7 steps |
| <a href="docs/guides/areas-between.md"><img src="docs/guides/img/areas-between-card.png" alt="Finished chart: the areas A1 and A2 between two waves, shaded in blue and orange, with the crossing points marked" width="260"></a> | **[Shade the areas between two curves](docs/guides/areas-between.md)**<br>Two curves, the areas between them in two colours, and their crossing points as the limits of the shading.<br>Core · 7 min · 7 steps |
| <a href="docs/guides/linear-program.md"><img src="docs/guides/img/linear-program-card.png" alt="Finished chart: a feasible region with two labelled constraint lines, its corner points, the dashed objective line and the optimum" width="260"></a> | **[Solve a linear program in a picture](docs/guides/linear-program.md)**<br>Feasible region, labelled constraint lines, an objective line on a slider, the optimum, the corners, and a sensitivity test by dragging.<br>Core · 10 min · 8 steps |

All guides by topic: [Getting started](docs/guides/README.md#getting-started), [Functions and sliders](docs/guides/README.md#functions-and-sliders), [Regions and optimisation](docs/guides/README.md#regions-and-optimisation), [Points, lines and labels](docs/guides/README.md#points-lines-and-labels), [3D](docs/guides/README.md#3d), [Notes and export](docs/guides/README.md#notes-and-export) and [Reference](docs/guides/README.md#reference) (coming from 3.x, shortcuts and troubleshooting).

## Privacy and permissions

- **Clipboard:** writes TikZ code / SVG / PNG on the *Copy …* buttons, the text of a "type" row when you press **Copy** in a guide, and the AI guide, connection lines and token when you press their **Copy** buttons in the AI tab or the settings. It reads the clipboard only when you press **Paste the chart** in the AI tab.
- **Active note:** inserts an `easy-tikz` block on **Insert into note**, replaces an existing block when saving from click-to-edit, and updates `displayWidth` / `displayAlign` when you use a chart's width or alignment controls. Inline sliders never write to the note.
- **Plugin data:** the [plugin settings](docs/reference.md#plugin-settings) (with the AI access token), your saved function templates, the state of the **Edit shapes by dragging** switch (and that its first-use tip was shown), which version of the What's new popup was shown and, while the editor is open, an autosaved draft of the chart (cleared when you insert or save).
- **Your notes, read only:** when the plugin starts without any stored data and What's new is switched on, it looks through your notes for an `easy-tikz` block and stops at the first one. A 3.x user who never changed a setting has charts but no stored data, and this tells such an update from a new install. It runs once, since its answer is stored, and it never writes to a note.
- **Network:** nothing goes to the internet. The guides in the Help tab are part of the plugin and their charts are drawn locally; each guide has a link to its page on GitHub, which opens in your browser only when you click it. With **Let AI apps make charts** switched on (off by default), the plugin answers HTTP on `127.0.0.1` at the port you choose, which only programs on this computer can reach. Every request needs the token from the settings, and a POST must carry JSON; requests from web pages (with an `Origin` header) and for other host names are refused. It serves the AI guide, checks and draws charts one at a time (charts over its size limits are refused before anything is computed), and adds `easy-tikz` blocks to Markdown notes (at the end, below a heading, or in place of a placeholder line) or replaces them, nothing else: never in hidden folders and never in instruction files for AI agents such as `AGENTS.md` or `CLAUDE.md`. A new note is only made when the AI asks for it. Each change shows a notice, with **Undo** when an existing note changed.
- **Vault root, on request:** **Tell AI agents in this vault** adds or updates a marked Easy TikZ section in `AGENTS.md` and `CLAUDE.md` at the top of the vault (creating them if needed). It never touches the rest of those files.
- **Telemetry:** none.
- **Math evaluation:** user expressions are parsed by a built-in parser and compiled into closures; no dynamically generated code runs. Nothing is persisted or transmitted.

## License

[MIT](LICENSE.md). Working on the plugin itself: [Developing Easy TikZ](docs/development.md).
