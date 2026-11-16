/*
 * Guides of the category Notes and export (5.1): charts in notes (insert,
 * edit, sliders, connected sliders), charts kept as SVG files, and the
 * export to LaTeX. The steps say what to do in the note or the editor; the
 * chart of each step grows a little, so the Help lights the lines it adds.
 */
import type { Guide } from './types';
import { chart } from './chart';

// --------------------------------------------------------- charts-in-notes

/** Growth and decay: two exponentials, later with a rate k on a connected slider. */
const CN_WINDOW = ['size 12 x 8', 'show x from -3 to 3 and y from -0.5 to 5', 'axes in the middle', 'with a grid'];
const CN_GROW = 'plot $f(x) = e^{x/2}$ in teal, very thick, filled, opacity 0.15';
const CN_DECAY = 'plot $g(x) = e^{-x/2}$ in orange, very thick, filled, opacity 0.15';
const CN_SLIDER = 'slider k from 0.1 to 1.5, starting at 0.5';
const CN_GROW_K = 'plot $f(x) = e^{kx}$ in teal, very thick, filled, opacity 0.15';
const CN_DECAY_K = 'plot $g(x) = e^{-kx}$ in orange, very thick, filled, opacity 0.15';
const CN_CONNECTED = `${CN_SLIDER}, connected`;

const CHARTS_IN_NOTES: Guide = {
    id: 'charts-in-notes',
    title: 'Charts in your notes',
    summary: 'Insert a chart into a note, edit it again, and move its sliders there, also across charts.',
    category: 'Notes and export',
    level: 'start',
    minutes: 3,
    outcomes: ['Insert a chart and open it again from the note', 'Use the sliders under a chart without changing the note', 'Connect sliders of the same name across charts'],
    requires: ['first-chart'],
    chart: chart(...CN_WINDOW, CN_CONNECTED, CN_GROW_K, CN_DECAY_K),
    steps: [
        {
            title: 'Insert a chart into a note',
            body: 'Put the cursor in a note and open the editor with the ribbon icon. Insert into note, or Cmd+Enter (Ctrl+Enter on Windows), writes the chart there as lines like these.',
            chart: chart(...CN_WINDOW, CN_GROW),
            tip: 'A formula in a note has a chart too: rest the pointer on it and click Insert chart.',
        },
        {
            title: 'Click the chart to edit it',
            body: 'Click the chart in the note, and the editor opens with it. Add a curve and click Save changes: the block in the note gets the new line.',
            chart: chart(...CN_WINDOW, CN_GROW, CN_DECAY),
        },
        {
            title: 'Move its slider in the note',
            body: 'A slider such as `k` shows under the chart in the note. Dragging it changes the picture, never the note; the round arrow goes back to the saved value.',
            chart: chart(...CN_WINDOW, CN_SLIDER, CN_GROW_K, CN_DECAY_K),
        },
        {
            title: 'Connect sliders across charts',
            body: 'Add `connected` to a slider here and to the slider of the same name in another chart of the note. Moving one then moves both.',
            chart: chart(...CN_WINDOW, CN_CONNECTED, CN_GROW_K, CN_DECAY_K),
            tip: 'In the note, the link button at the end of a slider row switches it; in the editor, Connect with others.',
        },
    ],
    next: ['svg-files', 'export-latex'],
};

// --------------------------------------------------------------- svg-files

/** A Lissajous figure, later with its first frequency on a slider. */
const SV_WINDOW = ['size 12 x 8', 'show x from -1.25 to 1.25 and y from -1.25 to 1.25', 'equal scale', 'axes in the middle'];
const SV_GRID = 'with a grid';
const SV_FIGURE = 'plot $c(t) = (\\sin(3t), \\sin(2t))$ for t from 0 to 2pi in purple, very thick';
const SV_SLIDER = 'slider k from 1 to 5, starting at 3, in steps of 1';
const SV_FIGURE_K = 'plot $c(t) = (\\sin(kt), \\sin(2t))$ for t from 0 to 2pi in purple, very thick';
const SV_TITLE = 'title Week 3: Lissajous figures';

const SVG_FILES: Guide = {
    id: 'svg-files',
    title: 'Charts as SVG files',
    summary: 'Keep every chart of a note as an SVG file too, for Obsidian Publish, GitHub and other apps.',
    category: 'Notes and export',
    level: 'core',
    minutes: 2,
    outcomes: ['Keep the charts of your notes as SVG files', 'Find, update and embed the file of a chart'],
    requires: ['charts-in-notes'],
    chart: chart(...SV_WINDOW, SV_GRID, SV_TITLE, SV_SLIDER, SV_FIGURE_K),
    steps: [
        {
            title: 'Switch on Charts as SVG files',
            body: "In the plugin's settings, switch on Charts as SVG files. Every chart of a note then also lives as an SVG file in the attachment folder.",
            chart: chart(...SV_WINDOW, SV_FIGURE),
        },
        {
            title: 'Find the file of each chart',
            body: "A file takes the note's name and the chart's place in it: `Week 3 · chart 1.svg`. It has a white background and the light theme's colours.",
            chart: chart(...SV_WINDOW, SV_GRID, SV_FIGURE),
        },
        {
            title: 'Edit a chart, and its file follows',
            body: 'Change a chart, and a moment after the note is saved its file is written again. Only files whose picture changed are written.',
            chart: chart(...SV_WINDOW, SV_GRID, SV_SLIDER, SV_FIGURE_K),
            tip: 'A file cannot move, so sliders draw at their saved values.',
        },
        {
            title: 'Embed the file in other apps',
            body: 'Obsidian Publish, GitHub and other Markdown apps do not run the plugin, but they show the file. Embed it with `![[Week 3 · chart 1.svg]]`.',
            chart: chart(...SV_WINDOW, SV_GRID, SV_TITLE, SV_SLIDER, SV_FIGURE_K),
            tip: 'The command Save the charts of this note as SVG files writes them at once.',
        },
    ],
    next: ['export-latex', 'charts-in-notes'],
};

// ------------------------------------------------------------ export-latex

/** A damped oscillation inside its envelope, later with its frequency k on a slider. */
const EX_WINDOW = ['size 12 x 7', 'show x from 0 to 12 and y from -1.25 to 1.25', 'axes in the middle'];
const EX_WAVE = 'plot $f(x) = e^{-x/4}\\cos(2x)$ in blue, very thick, filled, opacity 0.15';
const EX_ENVELOPE = ['plot $g(x) = e^{-x/4}$ in red, dashed', 'plot $h(x) = -e^{-x/4}$ in red, dashed'];
const EX_SLIDER = 'slider k from 1 to 4, starting at 2, in steps of 0.5';
const EX_WAVE_K = 'plot $f(x) = e^{-x/4}\\cos(kx)$ in blue, very thick, filled, opacity 0.15';
const EX_SNIPPET = 'snippet';

const EXPORT_LATEX: Guide = {
    id: 'export-latex',
    title: 'Export to LaTeX',
    summary: 'Copy a chart as pgfplots code, compile it with pdflatex, or take only the picture for your document.',
    category: 'Notes and export',
    level: 'core',
    minutes: 3,
    outcomes: ['Copy a chart as a LaTeX document and compile it', 'Read and copy the code in the Code tab', 'Get only the `tikzpicture` for your own document'],
    requires: ['first-chart'],
    chart: chart(EX_SNIPPET, ...EX_WINDOW, EX_SLIDER, EX_WAVE_K, ...EX_ENVELOPE),
    steps: [
        {
            title: 'Copy the chart as TikZ',
            body: 'Copy TikZ, at the bottom of the editor, puts the chart on the clipboard as pgfplots code: a whole LaTeX document, in the colours of the preview.',
            chart: chart(...EX_WINDOW, EX_WAVE),
            tip: '`size 12 x 7` is the size of the figure on paper, in centimetres.',
        },
        {
            title: 'Compile it with pdflatex',
            body: 'Paste the code into a file such as `chart.tex` and run `pdflatex chart.tex`. You get a PDF cropped to the picture.',
            chart: chart(...EX_WINDOW, EX_WAVE, ...EX_ENVELOPE),
            tip: 'It needs pgfplots, which TeX Live and MiKTeX include; charts in your notes need no LaTeX.',
        },
        {
            title: 'Read the code in the Code tab',
            body: 'The Code tab shows the same code for the chart as it is now. Sliders are written in at their values, so copy again after you move one.',
            chart: chart(...EX_WINDOW, EX_SLIDER, EX_WAVE_K, ...EX_ENVELOPE),
        },
        {
            title: 'Leave out the document setup',
            body: 'Switch off Standalone document in the Code tab to get only the `tikzpicture`. Its first lines, `% Needs:`, list what your preamble must load.',
            chart: chart(EX_SNIPPET, ...EX_WINDOW, EX_SLIDER, EX_WAVE_K, ...EX_ENVELOPE),
            tip: 'In the lines of the chart, this switch is the word `snippet`.',
        },
    ],
    next: ['shortcuts', 'svg-files'],
};

export const NOTES_GUIDES: Guide[] = [CHARTS_IN_NOTES, SVG_FILES, EXPORT_LATEX];
