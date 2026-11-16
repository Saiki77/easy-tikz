/*
 * Guides of the category Reference (5.1): what changed since 3.x, and the
 * keyboard shortcuts. The steps say what to do in the editor; the chart of
 * each step changes a little (as the step's keys would change it), so the
 * Help lights the lines that moved.
 */
import type { Guide } from './types';
import { chart } from './chart';

// ----------------------------------------------------------------- from-3x

/** A typical 3.x picture: the area between two curves, their crossings, a hidden mirror line and a brace. */
const OLD_WINDOW = ['size 12 x 8', 'show x from -0.5 to 6 and y from -0.5 to 5.5', 'title Area between two curves'];
const OLD_CURVES = ['plot $f(x) = \\frac{x^2}{4}$ from x = 0 to 5 in blue, thick', 'plot $g(x) = 2\\sqrt{x}$ from x = 0 to 5 in red, thick'];
const OLD_HIDDEN = 'plot $h(x) = x$ in gray, dashed, hidden';
const OLD_SHOWN = 'plot $h(x) = x$ in gray, dashed';
const OLD_AREA = 'shade between f and g from x = 0 to 4, opacity 0.3';
const OLD_CROSS = 'mark where f and g cross, with coordinates';
const OLD_BRACE = 'draw a brace from (4, 0) to (0, 0), labelled "width 4"';
const NEW_SLIDER = 'slider a from 0.5 to 4, starting at 3';
const NEW_AREA = 'shade between f and g from x = 0 to a, opacity 0.3';

const FROM_3X: Guide = {
    id: 'from-3x',
    title: 'Coming from 3.x',
    summary: 'What happens to your 3.x charts, where the old tabs and tools went, and what sliders add.',
    category: 'Reference',
    level: 'core',
    minutes: 2,
    outcomes: ['Open 3.x charts and save them without surprises', 'Find the old tabs and tools in the editor'],
    chart: chart(...OLD_WINDOW, NEW_SLIDER, ...OLD_CURVES, OLD_SHOWN, NEW_AREA, OLD_CROSS, OLD_BRACE),
    steps: [
        {
            title: 'Open an old chart',
            body: 'Click a chart you made with 3.x: it opens in the editor and draws as before. Nothing in the note changes until you click Save changes.',
            chart: chart(...OLD_WINDOW, ...OLD_CURVES, OLD_HIDDEN, OLD_AREA, OLD_CROSS),
        },
        {
            title: 'Find the old tabs and tools',
            body: 'The eight old tabs are now Build, Chart, Code and Help, next to the new AI tab. Each old tool is a card, and + Add names them in plain words, such as Brace with label.',
            chart: chart(...OLD_WINDOW, ...OLD_CURVES, OLD_HIDDEN, OLD_AREA, OLD_CROSS, OLD_BRACE),
        },
        {
            title: 'Show the functions 3.x skipped',
            body: '3.x did not draw a function with an empty domain, so such a function opens hidden. Click its eye to show it: here the line `y = x`.',
            chart: chart(...OLD_WINDOW, ...OLD_CURVES, OLD_SHOWN, OLD_AREA, OLD_CROSS, OLD_BRACE),
        },
        {
            title: 'Trade a number for a slider',
            body: 'Sliders are new, and any number can be one. Here the area ends at `x = a`: press play on `a` and it grows and shrinks.',
            chart: chart(...OLD_WINDOW, NEW_SLIDER, ...OLD_CURVES, OLD_SHOWN, NEW_AREA, OLD_CROSS, OLD_BRACE),
            tip: 'Save changes writes the format of version 4 and later, which 3.x cannot read.',
        },
    ],
    next: ['chart-language', 'shortcuts'],
};

// --------------------------------------------------------------- shortcuts

/**
 * A circle and a line with their crossings, in plain formulas (a drag or an
 * arrow key changes their numbers). Shift+Up lifts the line by one grid
 * step (the y range 7 has ticks of 1, a key moves a tenth of that, Shift
 * ten times as far); two presses of Right pan the view of width 10 by 1.
 */
const KEY_WINDOW = ['size 12 x 8', 'axes in the middle', 'with a grid'];
const KEY_VIEW = 'show x from -5 to 5 and y from -3.5 to 3.5';
const KEY_PANNED = 'show x from -4 to 6 and y from -3.5 to 3.5';
const KEY_CIRCLE = 'C: draw $x^2 + y^2 = 4$ in blue, very thick';
const KEY_DISK = 'shade where $x^2 + y^2 \\le 4$ in blue, opacity 0.15';
const KEY_LINE = 'L: draw $y = x/2 + 1$ in red, thick';
const KEY_LIFTED = 'L: draw $y = x/2 + 2$ in red, thick';
const KEY_SLIDER = 'slider b from -2.5 to 2.5, starting at 1';
const KEY_LINE_B = 'L: draw $y = x/2 + b$ in red, thick';
const KEY_CROSS = 'mark where C and L cross in purple, large, with coordinates';
/** The circle, its disk, the line `line` and their crossings. */
const keyShapes = (line: string): string[] => [KEY_CIRCLE, KEY_DISK, line, KEY_CROSS];

const SHORTCUTS: Guide = {
    id: 'shortcuts',
    title: 'Keyboard shortcuts',
    summary: 'The keys of the editor: insert, undo, move shapes and the view, and move between tabs.',
    category: 'Reference',
    level: 'start',
    minutes: 3,
    outcomes: ['Insert, save and undo from the keyboard', 'Move shapes and the view with the arrow keys', 'Move between tabs, cards and guide steps'],
    chart: chart(...KEY_WINDOW, KEY_PANNED, KEY_SLIDER, ...keyShapes(KEY_LINE_B)),
    steps: [
        {
            title: 'Insert or save with Cmd+Enter',
            body: 'Cmd+Enter (Ctrl+Enter on Windows and Linux) inserts the chart into the note, or saves a chart you opened from one.',
            chart: chart(...KEY_WINDOW, KEY_VIEW, ...keyShapes(KEY_LINE)),
            tip: 'Escape cancels a drag or a selection; otherwise it closes the editor and keeps the chart as a draft.',
        },
        {
            title: 'Move a shape with the arrow keys',
            body: 'Click a shape in the preview and press an arrow key: it moves a tenth of a grid step, with Shift ten times as far. Here Shift+Up lifted the line.',
            chart: chart(...KEY_WINDOW, KEY_VIEW, ...keyShapes(KEY_LIFTED)),
            tip: 'Alt (Option on macOS) moves a tenth as far, and Enter opens the field the move changes.',
        },
        {
            title: 'Undo and redo',
            body: 'Cmd+Z (Ctrl+Z) undoes the last move, drag, slider change or deleted card, as here; Cmd+Shift+Z redoes it. In a text field they undo typing.',
            chart: chart(...KEY_WINDOW, KEY_VIEW, ...keyShapes(KEY_LINE)),
        },
        {
            title: 'Pan the view, or turn it in 3D',
            body: 'With the preview focused and nothing selected, the arrow keys pan the view, here twice to the right. In 3D they turn the chart by 5 degrees.',
            chart: chart(...KEY_WINDOW, KEY_PANNED, ...keyShapes(KEY_LINE)),
            tip: 'Hold Space and drag to pan, even over lines and points.',
        },
        {
            title: 'Move through tabs, cards and steps',
            body: 'On the tab bar, Left and Right switch tabs, and in the Help they move between steps. Alt+Up and Alt+Down move the focused card.',
            chart: chart(...KEY_WINDOW, KEY_PANNED, KEY_SLIDER, ...keyShapes(KEY_LINE_B)),
            tip: 'In a number field, such as the value of `b`, Up and Down change it by one step.',
        },
    ],
    next: ['drag-to-edit', 'chart-language'],
};

export const REFERENCE_GUIDES: Guide[] = [FROM_3X, SHORTCUTS];
