/*
 * Guides of the category Getting started (5.1): the first chart in the
 * editor, the chart of every formula in a note, and drag to edit. Each step
 * adds or changes a line or two; the Help shows the chart in words with the
 * new lines lit.
 */
import type { Guide } from './types';
import { chart } from './chart';

// ------------------------------------------------------------- first-chart

const FIRST_VIEW = ['size 12 x 8', 'show x from 0 to 2pi and y from 0 to 4'];
const SINE = 'plot $f(x) = 2 + \\sin(x)$';
const COSINE = 'plot $g(x) = 2 + \\cos(x)$';
const FIRST_DONE = chart(...FIRST_VIEW, 'with a grid', `${SINE} in blue, very thick, with a legend`, `${COSINE} in orange, very thick, with a legend`);

const FIRST_CHART: Guide = {
    id: 'first-chart',
    title: 'Your first chart',
    summary: 'Open the editor, plot two formulas, give them colours, a legend and a grid, and insert the chart.',
    category: 'Getting started',
    level: 'start',
    minutes: 3,
    outcomes: ['Open the editor and plot a formula', 'Style curves with colours, a legend and a grid', 'Insert the chart into a note and edit it again'],
    chart: FIRST_DONE,
    steps: [
        {
            title: 'Type a formula and press Enter',
            body: 'Put the cursor in a note where the chart goes. Run `Easy Graphs Charts and TikZ: Open editor` from the command palette or the ribbon, type `2 + \\sin(x)` under Start a chart and press Enter.',
            chart: chart(...FIRST_VIEW, SINE),
            tip: 'Formula fields take LaTeX as in your notes, or the plain form `2 + sin(x)`.',
        },
        {
            title: 'Pick a colour and a thick line',
            body: 'Click the colour swatch at the left of the card and pick Blue. Under Options, pick Very Thick in the Line row.',
            chart: chart(...FIRST_VIEW, `${SINE} in blue, very thick`),
        },
        {
            title: 'Add a second function',
            body: 'Click + Add, choose Function y = f(x) and type `2 + \\cos(x)`. Give it Orange and Very Thick the same way.',
            chart: chart(...FIRST_VIEW, `${SINE} in blue, very thick`, `${COSINE} in orange, very thick`),
        },
        {
            title: 'Show a legend and a grid',
            body: 'Click Legend under Options on each card: a box names the curves. The Major grid button at the bottom right of the preview adds the grid.',
            chart: FIRST_DONE,
        },
        {
            title: 'Insert it into your note',
            body: 'Click Insert into note or press Cmd+Enter (Ctrl+Enter on Windows and Linux). The note keeps these lines in an `easy-tikz` block, and a click on the chart edits it again.',
            chart: FIRST_DONE,
            tip: 'If you close the editor by accident, it offers the unsaved chart the next time it opens.',
        },
    ],
    next: ['notes-formulas', 'chart-language', 'sliders'],
};

// ---------------------------------------------------------- notes-formulas

/** A cubic as the card of `$f(x) = x^3 - 3x$` draws it, in a window that frames it. */
const CUBIC = chart('size 12 x 8', 'show x from -3 to 3 and y from -4 to 4', 'plot $f(x) = x^3 - 3x$ in blue, thick');
/** The card of `$f(x) = ax^2 + bx$`: a slider for each letter, from -5 to 5, at 1. */
const FAMILY = 'plot $f(x) = ax^2 + bx$ in blue, thick';
const SEQUENCE = chart('size 12 x 8', 'show x from 0 to 20 and y from 0.45 to 0.85', 'xlabel n', 'plot $f(x) = \\frac{2x^2+x+1}{3x^2+2}$ in blue, thick');
const SADDLE = chart('3d', 'cube', 'show x from -5 to 5, y from -5 to 5 and z from -25 to 25', 'plot $z = x^2 - y^2$ in viridis');

const NOTES_FORMULAS: Guide = {
    id: 'notes-formulas',
    title: 'Every formula is a chart',
    summary: 'Rest the pointer on a formula in a note: its chart opens in a card, with sliders, ready to insert.',
    category: 'Getting started',
    level: 'start',
    minutes: 3,
    outcomes: ['Open the chart of any formula in a note', 'Move its sliders, zoom it and turn a surface', 'Insert the chart under the paragraph'],
    chart: SADDLE,
    steps: [
        {
            title: 'Rest the pointer on a formula',
            body: 'In Reading view or Live Preview, rest the pointer on a formula such as `$f(x) = x^3 - 3x$`: a card opens with its chart. A dotted line marks the formulas that have one.',
            chart: CUBIC,
            tip: 'The dotted line is the setting Highlight formulas in notes, and on a phone a tap opens the card.',
        },
        {
            title: 'Drag a slider for each letter',
            body: 'Each letter besides x becomes a slider: `$f(x) = ax^2 + bx$` gets `a` and `b`. Drag them and the chart follows.',
            chart: chart('size 12 x 8', 'show x from -5 to 5 and y from -2 to 32', 'slider a from -5 to 5, starting at 1', 'slider b from -5 to 5, starting at 1', FAMILY),
        },
        {
            title: 'Zoom in and insert the chart',
            body: 'In the card the wheel zooms, a drag pans and a double click goes back. Insert chart writes the chart under the paragraph, with the view and values you see.',
            chart: chart('size 12 x 8', 'show x from -3 to 7 and y from -4 to 8', 'slider a from -5 to 5, starting at 0.5', 'slider b from -5 to 5, starting at -2', FAMILY),
            tip: 'To change more first, click Open in the editor instead.',
        },
        {
            title: 'Chart a formula in n, t or k',
            body: 'A formula without x and y charts against its letter: `$\\frac{2n^2+n+1}{3n^2+2}$` shows n from 0 to 20, as a sequence does. The chart writes it in x, on an axis named n.',
            chart: SEQUENCE,
            tip: 'In a block of rows (`aligned`), the row under the pointer opens its chart.',
        },
        {
            title: 'Turn a surface with a drag',
            body: 'A formula in x and y is a surface: `$z = x^2 - y^2$` opens in 3D, coloured by height. Drag in the card to turn it.',
            chart: SADDLE,
        },
    ],
    next: ['formulas', 'sliders', 'surfaces-3d'],
};

// ------------------------------------------------------------ drag-to-edit

/** Plain formulas: a drag rewrites their numbers (a formula in LaTeX keeps its own). */
const DRAG_VIEW = ['size 12 x 8', 'show x from -0.5 to 10 and y from -0.5 to 5', 'axes in the middle', 'with a grid'];
const WAVE = 'plot g(x) = sin(x) + 2.5 in teal, very thick';
/** Make slider gives the dragged 2 a range from 0 to 5 in steps of 0.05. */
const MADE = 'slider a from 0 to 5, starting at 2, in steps of 0.05';
const TURNED = chart(...DRAG_VIEW, MADE, 'plot f(x) = 0.25x + a in orange, very thick', 'plot g(x) = 2sin(x) + 2.5 in teal, very thick');

const DRAG_TO_EDIT: Guide = {
    id: 'drag-to-edit',
    title: 'Drag shapes to edit them',
    summary: 'Grab a line or a curve in the preview and its numbers follow: move, turn, stretch, undo.',
    category: 'Getting started',
    level: 'start',
    minutes: 3,
    outcomes: ['Move a line and see which number changes', 'Turn a line and stretch a curve with Shift', 'Keep a dragged number as a slider, or undo the drag'],
    requires: ['first-chart'],
    chart: TURNED,
    steps: [
        {
            title: 'Drag the line up',
            body: 'Plot the line `0.5x + 1` and the wave `sin(x) + 2.5`. In the preview, drag the line up one unit: the tip names the number that changes, and the line reads `0.5x + 2`.',
            chart: chart(...DRAG_VIEW, 'plot f(x) = 0.5x + 2 in orange, very thick', WAVE),
            tip: 'A drag changes plain formulas only: a formula in LaTeX, such as `\\frac{1}{2}x`, keeps its numbers.',
        },
        {
            title: 'Keep the number as a slider',
            body: 'For six seconds after a drag, a bar at the bottom of the left pane offers Undo and Make slider. Make slider turns the `2` into a slider `a`.',
            chart: chart(...DRAG_VIEW, MADE, 'plot f(x) = 0.5x + a in orange, very thick', WAVE),
            tip: 'From now on a drag of the line moves the slider and leaves the formula alone.',
        },
        {
            title: 'Hold Shift to turn or stretch',
            body: "Hold Shift over a shape: ⊕ marks the point that stays. Shift-drag the line to turn it to `0.25x + a`, and the wave's crest up to stretch it to `2sin(x) + 2.5`.",
            chart: TURNED,
            tip: 'Turns click into simple slopes unless you also hold Alt (Option on macOS) for free values.',
        },
        {
            title: 'Undo a drag',
            body: 'Drag the wave somewhere you did not want it, then press Cmd+Z (Ctrl+Z on Windows and Linux) or click Undo in the bar: it jumps back. Escape cancels a drag on the way.',
            chart: TURNED,
            tip: 'To pan instead, switch off Edit shapes by dragging: the pointer button at the bottom right of the preview.',
        },
    ],
    next: ['sliders', 'linear-program', 'shortcuts'],
};

export const START_GUIDES: Guide[] = [FIRST_CHART, NOTES_FORMULAS, DRAG_TO_EDIT];
