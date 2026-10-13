/*
 * Help tab: guides and the reference.
 *
 * Home is a search field and the guides (src/guides) as cards grouped by
 * category, each with a live thumbnail drawn by the plugin's own renderer.
 * A card opens the guide in the reader: outcomes, then every step on one
 * scrolling page with its copyable "type" rows, a live chart and "Open this
 * step in the editor" (host.loadChart, which asks before replacing a
 * non-empty chart). The reference is the last category: its sections are
 * data (SECTIONS below) rendered by a few small block types, with live
 * "Open example" buttons that load an entry of EXAMPLES (src/migrate.ts).
 *
 * Inline `backticks` in any text become <code>, **bold** runs <strong>.
 * Charts are drawn lazily, when their fixed-aspect box scrolls into view,
 * so nothing shifts when they appear. Everything here describes v4
 * behaviour; keep the reference in sync with mathcontext.ts, migrate.ts
 * recipes and the editor panels when they change.
 */
import { Notice, Platform, setIcon } from 'obsidian';
import { EXAMPLES } from '../migrate';
import {
    ChartData,
    GUIDE_CATEGORIES,
    GUIDE_LEVEL_LABELS,
    Guide,
    GuideStep,
    guideById,
    guideUrl,
    guidesIn,
    searchGuides,
    searchScore,
    searchTokens,
    stepChart,
} from '../guides';
import { MATH_REDRAW_LIMIT } from '../mathlabel';
import { SVGRenderer } from '../renderer';
import { SVG3DRenderer } from '../renderer3d';
import { SettingsManager } from '../settings';
import { cloneData, fitPixelScale } from '../util';
import { PanelHost } from './host';
import { iconButton, textButton, trapEscape, uniqueId, visuallyHidden } from './kit';

type Block =
    /** Paragraph. */
    | string
    /** Code sample: one entry per line; `[code, comment]` pairs are aligned in two columns. */
    | { code: (string | [string, string])[] }
    /** Bullet list. */
    | { list: string[] }
    /** Term / description pairs (terms are shown as code). */
    | { terms: [string, string][] }
    /** Keyboard shortcuts: alternatives separated by ' / ', keys of a combination by ' + '. */
    | { keys: [string, string][] }
    /** Example card with an "Open example" button; id of an EXAMPLES entry. */
    | { example: string }
    /** Small heading inside a section. */
    | { sub: string }
    /** Muted side note. */
    | { note: string };

interface Section {
    id: string;
    title: string;
    /** One line for the list of sections on the home page and for search results. */
    about: string;
    blocks: Block[];
}

/** Returned by createHelpPanel (the modal may ignore it). */
export interface HelpPanelHandle {
    el: HTMLElement;
    /** Back to the search field and the list of guides. */
    showHome(): void;
    /** Open a guide in the reader, optionally scrolled to a step (0-based). False when the id is unknown. */
    showGuide(id: string, step?: number): boolean;
    /** Open the reference, optionally at a section ('drag', 'keys', ...). False when the section is unknown. */
    showReference(section?: string): boolean;
    /** Stop observers and timers. Optional: a panel that left the document holds on to nothing. */
    destroy(): void;
}

const MOD = Platform.isMacOS ? 'Cmd' : 'Ctrl';

/** Thumbnail canvas: both sides below the renderer's compact limits (200 x 120), so it draws no ticks or texts. */
const THUMB_W = 196;
const THUMB_H = 98;
/** 3D thumbnails are drawn at this size, then zoomed onto the drawing. */
const THUMB_3D_W = 300;
const THUMB_3D_H = 150;
/** Charts start rendering this far (px) before they scroll into view. */
const LAZY_MARGIN_PX = 240;
/** Inline code up to this many characters never wraps (it fits the narrowest help pane). */
const INLINE_CODE_NOWRAP = 26;
/** Air above a heading the panel scrolled to (px). */
const SCROLL_GAP_PX = 12;
/** "Copied" stays on a Copy button this long. */
const COPIED_MS = 1500;
/**
 * Step figures of 3D charts: drawn at the width shown times this zoom (the
 * figure then zooms onto the drawing, which fills about 3 / 4 of the
 * canvas), within these limits in px, so their fixed-size texts stay readable.
 */
const FIGURE_3D_ZOOM = 1.3;
const FIGURE_3D_MIN_W = 320;
const FIGURE_3D_MAX_W = 640;

const SECTIONS: Section[] = [
    {
        id: 'start',
        title: 'Quick start',
        about: 'The first formula, + Add, and Insert into note.',
        blocks: [
            'Type a formula such as `2 + sin(x)` in the Build tab and press Enter. From then on the preview redraws as you type. Use **+ Add** for everything else: more functions, shaded regions, lines and curves, points, arrows, text labels and sliders.',
            {
                list: [
                    'A name the chart does not know yet (`k` in `k x^2`) gets an **Add slider k** button under the field. Drag the slider under the preview and the picture follows.',
                    'Chart holds ranges, axes, grid and export size; Code shows the LaTeX; Help has step-by-step guides and this reference.',
                    `**Insert into note** (${MOD}+Enter) saves the chart as an \`easy-tikz\` block. Click the chart in the note to edit it again.`,
                    '**Copy TikZ** puts the LaTeX code on the clipboard (see Export to LaTeX).',
                ],
            },
            'The quickest way to see what the tools can do is to open an example and change it. The recipes further down have more.',
            { example: 'lp' },
        ],
    },
    {
        id: 'drag',
        title: 'Drag to edit',
        about: 'Move, turn and stretch shapes in the preview.',
        blocks: [
            'Drag a line, curve, point or label in the preview. Easy TikZ changes the numbers in its formula (sliders first) so the part you grabbed follows the pointer.',
            {
                list: [
                    'Shift-drag turns straight lines and stretches curves around the ⊕ mark. Points move straight: horizontal, vertical or diagonal.',
                    'Hover first: the tip in the corner shows which numbers will change, and when a shift, an offset or a factor has to be added.',
                    'Computed points (optimum, corners, intersections) cannot be dragged. Drag the lines that define them.',
                    'Hold Alt (Option on macOS) for fine control without snapping. Esc cancels a drag; Cmd+Z (Ctrl+Z) undoes it, also after deleting or moving a slider.',
                    'Click an object to find its card; arrow keys then move it. Hold Space or use the middle mouse button to pan over objects. Turn dragging off with the pointer button in the preview toolbar.',
                ],
            },
            { example: 'lp' },
        ],
    },
    {
        id: 'expressions',
        title: 'Writing expressions',
        about: 'Operators, implicit multiplication, functions and constants.',
        blocks: [
            'Every formula field, range, condition, point list and label placeholder uses the same language.',
            { sub: 'Operators' },
            {
                terms: [
                    ['+  -  *  /', 'Arithmetic.'],
                    ['^', 'Power (`**` also works). It groups to the right: `2^3^2` is `2^9`. `-x^2` is `-(x^2)`, and `2^-x` is fine.'],
                    ['%', 'Remainder, as in JavaScript: `-1 % 3` is `-1`.'],
                    ['< <= > >= == !=', 'Comparisons, 1 when true and 0 when false. `≤ ≥ ≠` work too. A chain such as `0 <= x <= 4` means both comparisons hold.'],
                    ['and  or  !', 'Logic (`&&` and `||` also work).'],
                    ['c ? a : b', 'a when c holds, otherwise b.'],
                ],
            },
            { sub: 'Implicit multiplication' },
            'You can leave out `*` between a number, a name or a bracket and what follows:',
            {
                code: [
                    ['2x', '2*x'],
                    ['3(x + 1)', '3*(x + 1)'],
                    ['(x + 1)(x - 1)', '(x + 1)*(x - 1)'],
                    ['2 pi', '2*pi'],
                    ['a x + b y', 'a*x + b*y'],
                ],
            },
            'Three traps:',
            {
                list: [
                    '`ax` is one name, not `a*x`. Write `a x` or `a*x`. The error under the field offers **Use a*x**.',
                    '`1/2x` is `(1/2)*x`, not `1/(2x)`. Write the brackets when you mean a fraction with x below.',
                    'Functions need brackets: `sin(x)`, not `sin x`. `a(x + 1)` with a slider `a` is a product, `f1(x + 1)` with a function `f1` is a call. A power applies to the bracket only: `a(x - h)^2` is `a*(x - h)^2`, as `2(x - h)^2` is.',
                ],
            },
            { sub: 'Functions and constants' },
            {
                terms: [
                    ['sin cos tan', 'Trigonometry in radians. Degrees: `sin(x * pi / 180)`.'],
                    ['sec csc cot', 'Reciprocal trigonometry.'],
                    ['asin acos atan atan2(y, x)', 'Inverse trigonometry.'],
                    ['sinh cosh tanh asinh acosh atanh', 'Hyperbolic functions.'],
                    ['exp  ln  log  log10  log2', '`ln` and `log` are both the natural logarithm.'],
                    ['sqrt  cbrt  abs  sign', 'Roots, absolute value and sign.'],
                    ['floor  ceil  round  trunc', 'Rounding.'],
                    ['min  max  hypot  pow(a, b)', '`min` and `max` take any number of values.'],
                    ['pi  π  e', 'Constants (`PI` and `E` still work).'],
                ],
            },
            { sub: 'Variables' },
            'Functions use x; surfaces, conditions and curve equations use x and y. Parametric curves use t; polar curves r(θ) use `theta` (or `θ`). To write models in other letters, set **Axis variables** in Chart > Axes to `x1, x2` or `q, p`; x and y keep working as well.',
            { sub: 'Errors' },
            'A problem appears under its field after a short pause, with a fix button when there is one: **Add slider k**, **Use a*x**, **Use sin**. The status chip on the preview lists every problem; click it to jump to the field. A chart with an error still draws everything else.',
        ],
    },
    {
        id: 'sliders',
        title: 'Sliders',
        about: 'Named numbers for every field: create, play, rename.',
        blocks: [
            'A slider is a named number you can use anywhere: in formulas, domains, conditions, point lists, labels and axis ranges. Moving it redraws the picture immediately.',
            {
                list: [
                    'Create one with **Add slider** in the Sliders dock under the preview, with + Add > Slider, or with the **Add slider** fix on an unknown name.',
                    'Each row shows the name, the value and the slider. Type any value: a value outside the range widens the range. Click the small numbers at the slider ends to change the minimum and maximum; the more button also holds the step and Delete.',
                    'Play sweeps the value back and forth between minimum and maximum (about 4 seconds each way). Drag the slider while it plays to take over; it continues from where you let go.',
                    'Rename a slider in its name field: every formula and label that uses it is updated.',
                    'With five or more sliders the dock shows compact pills such as `a = 1.5`; click a pill to edit that slider.',
                ],
            },
            'In your note, the chart shows its sliders underneath (Chart > In your note > Show sliders in note). Moving them there changes the picture for the current session only and never edits the note.',
            { example: 'tangent' },
        ],
    },
    {
        id: 'functions',
        title: 'Functions',
        about: 'Names, domains, parametric and polar curves, tangents.',
        blocks: [
            'Each function has a name (`f1`, `f2`, ...) on its card. Click the name to rename it; references are updated.',
            {
                terms: [
                    ['f1(2)  f1(x - 1)', 'Call a function by name in any other formula.'],
                    ['2 f1 + 1', 'A bare name means `f1(x)`.'],
                    ['f2 <= y <= f1', 'Use functions in region conditions (see Regions).'],
                ],
            },
            {
                list: [
                    'Domain: `min:max`, for example `0:2pi` or `-a:a`. Empty means the visible x range (and `0:2*pi` for parametric and polar curves). Outside its domain a function has no value, so formulas that use it there draw nothing.',
                    'Types: y = f(x), or x(t), y(t) for a parametric curve (Options > type). In a polar chart (header switch) the formula is r(θ).',
                    'Hidden functions (eye button) are not drawn but can still be used by name. Parametric functions cannot be called.',
                    'Options: line thickness, Dashed, Legend (your own text, or the formula typeset), Fill to x-axis with pattern and opacity, Extrema (marks local minima and maxima).',
                    'Tangent at: a number, a formula or a slider, or `min` / `max` for the first local minimum or maximum (`min2`, `max3`, ... for later ones). The tangent follows when the function changes.',
                ],
            },
        ],
    },
    {
        id: 'regions',
        title: 'Regions',
        about: 'Conditions, constraint lines, corners and the optimum.',
        blocks: [
            'A region shades the points where every condition holds. Write one condition per row; all rows must hold at once.',
            {
                code: [
                    ['x + y <= 4', 'half-plane'],
                    ['0 <= x <= 4', 'a strip (a chain)'],
                    ['f2 <= y <= f1', 'between two functions'],
                    ['min(0, f1) <= y <= max(0, f1)', 'between f1 and the x-axis'],
                    ['(x - 3)^2 + (y - 2)^2 <= 2^2', 'a disk'],
                    ['x <= 1 or x >= 3', 'two pieces'],
                ],
            },
            {
                list: [
                    'Inside one row, `,` `;` `and` and `&&` also mean "and"; `or` (or `||`) separates alternatives, and "and" binds tighter than "or".',
                    'Use `<=` and `>=`; strict `<` and `>` shade the same. A single `=` is an error: draw lines with a Curve.',
                    'Fill: colour, pattern and opacity. Outline: none, solid or dashed.',
                    '**Constraint lines** draws the boundary line of every condition across the whole view, as textbooks do for linear programs. Give a row a label such as `(1)` or `labour` to print it on its line, or use **Number them**.',
                    'The region label (a template, see Labels) sits at the centre of the region.',
                    '**Mark corners** adds points at the corners of the region; **Find optimum** adds a point that maximises an objective over it.',
                ],
            },
            'Several areas between curves: add one region per area, each with its own colour, for example `f2 <= y <= f1` and `f1 <= y <= f2`, both with `0 <= x <= 2pi`.',
            { example: 'areas' },
        ],
    },
    {
        id: 'curves',
        title: 'Curves and lines',
        about: 'Equations in x and y, and level curves.',
        blocks: [
            'A curve draws an equation in x and y. A bare formula F means F = 0.',
            {
                code: [
                    ['2x + 3y = 12', 'a straight line'],
                    ['x = 2', 'a vertical line'],
                    ['(x - 3)^2 + (y - 2)^2 = 4', 'a circle'],
                    ['x y = 4', 'a hyperbola'],
                    ['2x + 3y = c', 'a line that moves with slider c'],
                ],
            },
            'Levels: write a list such as `2, 4, 8` and the curve F = value is drawn for each value (level curves, indifference curves, iso-profit lines). Levels may use sliders and computed values such as `P1_val`. Put `{level}` in the label to print each value at its curve.',
        ],
    },
    {
        id: 'points',
        title: 'Points',
        about: 'Lists, intersections, corners, optimum, computed values.',
        blocks: [
            {
                terms: [
                    ['List', 'The points you type: `(1, 2); (3, a)`.'],
                    ['Intersections', 'Where two functions or curves cross.'],
                    ['Region', 'Without an objective: the corner points of a region. With one: the best point anywhere in it.'],
                    ['Integers', 'Every point with whole-number coordinates inside a region, or in the whole view when no region is chosen (at most 2000).'],
                ],
            },
            'Objective (optional): with `2x + 3y` and Max or Min only the best point is kept (several if they tie). With Region the search covers the whole region, not just its corners, so nonlinear objectives work too. The status chip says when the objective is unbounded within the view or the region is empty.',
            'Labels: None, Coordinates, or Custom with placeholders `{x}`, `{y}`, `{val}` (objective value) and `{i}` (point number). Separate per-point labels with `;`, as in `A; B; C`. Drop lines draws dashed guides to the axes.',
            { sub: 'Computed values' },
            'Every points tool publishes its results under its name, and any field can use them. They update live when sliders move.',
            {
                terms: [
                    ['P1_x  P1_y', 'Coordinates of the first point (`P1_z` in 3D).'],
                    ['P1_x2  P1_y2', 'The second point, and so on.'],
                    ['P1_val', 'Objective value at the first point.'],
                    ['P1_n', 'Number of points.'],
                ],
            },
            'For example: a label `z* = {P1_val}`, a line `2x + 3y = P1_val` through the optimum, or a region bounded by `P1_y <= y`.',
        ],
    },
    {
        id: 'segments',
        title: 'Segments, arrows and braces',
        about: 'Lines, arrows, closed polygons and braces.',
        blocks: [
            'A segment joins points separated by `;`, for example `(0, 0); (3, 2)`. Coordinates may be formulas, and the name of a points tool inserts its points: `(0, 0); P1`.',
            {
                list: [
                    'Style: line, arrow forward, backward or both, or brace.',
                    '**Closed** joins the last point back to the first (a polygon outline).',
                    'A brace uses the first two points and bulges to the left of the direction from the first point to the second. Swap the points to flip it.',
                    'The label (a template) sits beside the middle of the path.',
                ],
            },
        ],
    },
    {
        id: 'labels',
        title: 'Labels and templates',
        about: 'Text labels and templates such as {a} with live values.',
        blocks: [
            'Text labels sit at a position `(x, y)` that may use formulas, sliders and computed values: `(P1_x, P1_y + 0.3)`. Drag a label in the preview to move it: plain numbers change, and a position written as a formula gets an offset (`P1_x + 0.4`).',
            'Every text field is a template: text labels, region, condition, curve, point and segment labels, and the chart title.',
            {
                terms: [
                    ['{a}', 'The value of a formula, with up to 3 decimals.'],
                    ['{a/3:1}', 'With up to 1 decimal (any number after the colon).'],
                    ['{{  }}', 'A brace that is not a placeholder (a LaTeX group).'],
                    ['$x^2$  \\(x^2\\)', 'LaTeX math: typeset in the preview and passed to LaTeX as written.'],
                ],
            },
            'A placeholder that cannot be computed shows `?`.',
            {
                list: [
                    'Outside math, `% & # _ ^ ~ < > | "` print as typed (`50% cut`, `x_1`, `x + y <= 4`).',
                    'A backslash starts LaTeX (`\\textbf{A}`, `\\%`, `\\$`, `\\alpha`); a brace right after a command is its argument, other braces are placeholders. Write `\\{ \\}` for literal braces.',
                    "Math is `$...$` with no space after the opening `$` or before the closing one, as in Obsidian; `$5 and $10` stays text.",
                    'Inside math a brace after `^`, `_` or an argument command (`\\frac`, `\\mathbf`) is LaTeX, so a value cannot go inside `x^{...}`.',
                ],
            },
        ],
    },
    {
        id: 'recipes',
        title: 'Optimisation recipes',
        about: 'Linear program, nonlinear objective, surplus.',
        blocks: [
            { sub: 'Linear program' },
            {
                list: [
                    'Region R1 with one constraint per row: `x + y <= 4`, `x + 3y <= 6`, `x >= 0`, `y >= 0`. Turn on Constraint lines and label the rows `(1)`, `(2)`.',
                    'Slider c and curve `2x + 3y = c`: the objective line. Press play on c to sweep it across the region.',
                    'Points P1 with source Region over R1, objective `2x + 3y`, Max: the optimum. A second points tool over R1 without an objective marks every corner.',
                    'Pin the line to the optimum with `2x + 3y = P1_val`, and print the value with a label `z* = {P1_val}`.',
                    'Sensitivity: replace a right-hand side with a slider (`x + y <= b`) and play b. The region, the corners and the optimum follow.',
                    'Integer program: source Integers over R1 with the same objective gives the best integer point.',
                ],
            },
            { example: 'lp' },
            { sub: 'Nonlinear objective' },
            'Draw the objective as level curves (`x^2 + y^2` with levels `1, 3.2, 6`), shade the constraint `x + 2y >= 4`, and find the minimum with a points tool over the region. A curve with levels `P1_val` is the level curve that touches the constraint at the optimum.',
            { example: 'levels' },
            { sub: 'Surplus and equilibrium' },
            'Intersections of demand and supply give the equilibrium P1. Regions bounded by `P1_y` and `0 <= x <= P1_x` shade consumer and producer surplus, and they follow when a demand slider moves.',
            { example: 'surplus' },
        ],
    },
    {
        id: 'threed',
        title: '3D',
        about: 'Surfaces, planes, points, labels and the 3D view.',
        blocks: [
            'Switch to 3D in the editor header. Surfaces are formulas in x and y with their own x and y domains, opacity, sample count and a wireframe option.',
            {
                list: [
                    'Planes: x, y or z equal to a value (sliders allowed).',
                    'Points: a list of `(x, y, z)` tuples. Segments and arrows take `(x, y, z)` points too.',
                    'Labels take a z position.',
                    'Drag the preview to rotate. Chart > 3D view sets elevation, azimuth and the box aspect.',
                ],
            },
            { example: 'plane3d' },
        ],
    },
    {
        id: 'export',
        title: 'Export to LaTeX',
        about: 'What Copy TikZ and the Code tab produce.',
        blocks: [
            'Copy TikZ and the Code tab produce pgfplots code that compiles with pdflatex.',
            {
                list: [
                    'Standalone document (default): a complete file with `\\documentclass[border=5pt]{standalone}` and every package it needs.',
                    'Snippet: turn off Standalone document in the Code tab to get only the tikzpicture. The first lines (`% Needs: ...`) list what your preamble must load, such as `\\usepackage{pgfplots}`.',
                    'Functions are exported as formulas (`\\addplot`), with sliders replaced by their current values, functions used by name written out, and trigonometry kept in radians.',
                    'Regions, curves, points, segments and braces are computed by the plugin and exported as coordinates. They match the preview exactly but do not recompute if you edit the LaTeX.',
                    'Colours are defined with `\\definecolor` so the PDF matches the preview. "Auto" (the text colour) exports as black.',
                    'The export is a snapshot at the current slider values.',
                ],
            },
            { note: 'Edits made by hand in the Code tab are kept only until you press Regenerate. Insert into note saves the chart settings, not that text.' },
        ],
    },
    {
        id: 'keys',
        title: 'Keyboard shortcuts',
        about: 'Every keyboard shortcut, and the mouse in the preview.',
        blocks: [
            {
                keys: [
                    [`${MOD} + Enter`, 'Insert into note (or Save changes)'],
                    ['Escape', 'Cancel a drag in the preview, or clear the selected object; close the open menu or popover; otherwise close the editor. A chart closed without inserting is kept as a draft, and the editor offers to restore it next time.'],
                    [`${MOD} + Z / ${MOD} + Shift + Z`, 'Undo or redo the last drag, delete or slider change (outside text fields, where they undo typing)'],
                    ['Left / Right', 'Switch tabs (tab bar focused); Home and End jump to the first and last tab'],
                    ['Alt + Up / Alt + Down', 'Move the focused card up or down'],
                    ['Up / Down', 'Number field: one step (Shift: ten steps, Alt: a tenth)'],
                    ['Arrow keys', 'Focused slider: one step; Home and End jump to its ends. Selected object in the preview: move it by a tenth of a grid step (Shift: ten times, Alt: a tenth); Enter opens its field'],
                    ['Enter', 'Apply a name or a number you typed'],
                    ['Space', 'Hold over the preview and drag to pan, even over lines and points'],
                ],
            },
            'In the 2D preview, drag empty space to pan and scroll to zoom; the lock button switches both off. Dragging lines, curves, points and labels changes their numbers (see Drag to edit). Ranges written as formulas (such as `2a`) are not changed by panning. In 3D, drag to rotate.',
        ],
    },
];

// -------------------------------------------------------------------- text

/** Paragraph-level text: `code` spans and **bold** runs. */
function rich(parent: HTMLElement, text: string): void {
    const parts = text.split(/(`[^`]+`|\*\*.+?\*\*)/);
    for (const part of parts) {
        if (!part) continue;
        if (part.startsWith('`') && part.endsWith('`') && part.length > 1) {
            const code = part.slice(1, -1);
            // A short formula stays on one line; a long one may wrap anywhere rather than overflow.
            parent.createEl('code', { cls: code.length <= INLINE_CODE_NOWRAP ? ['etz-help-code-inline', 'mod-short'] : 'etz-help-code-inline', text: code });
        } else if (part.startsWith('**') && part.endsWith('**') && part.length > 3) {
            parent.createEl('strong', { text: part.slice(2, -2) });
        } else {
            parent.appendText(part);
        }
    }
}

function renderBlock(parent: HTMLElement, block: Block, host: PanelHost): void {
    if (typeof block === 'string') {
        rich(parent.createEl('p', { cls: 'etz-help-p' }), block);
        return;
    }
    if ('sub' in block) {
        parent.createEl('h4', { cls: 'etz-help-sub', text: block.sub });
        return;
    }
    if ('note' in block) {
        rich(parent.createEl('p', { cls: 'etz-help-note' }), block.note);
        return;
    }
    if ('list' in block) {
        const ul = parent.createEl('ul', { cls: 'etz-help-list' });
        for (const item of block.list) rich(ul.createEl('li'), item);
        return;
    }
    if ('code' in block) {
        const pre = parent.createEl('pre', { cls: 'etz-help-code' });
        const width = Math.max(0, ...block.code.map((line) => (Array.isArray(line) ? line[0].length : 0)));
        const lines = block.code.map((line) => (Array.isArray(line) ? `${line[0].padEnd(width + 3)}${line[1]}` : line));
        // Comments are muted: one span per line keeps them selectable as plain text.
        const code = pre.createEl('code');
        lines.forEach((text, i) => {
            const line = block.code[i];
            if (Array.isArray(line)) {
                code.appendText(text.slice(0, width + 3));
                code.createSpan({ cls: 'etz-help-comment', text: line[1] });
            } else {
                code.appendText(text);
            }
            if (i < lines.length - 1) code.appendText('\n');
        });
        return;
    }
    if ('terms' in block) {
        const dl = parent.createEl('dl', { cls: 'etz-help-terms' });
        for (const [term, desc] of block.terms) {
            dl.createEl('dt').createEl('code', { cls: 'etz-help-code-inline', text: term });
            rich(dl.createEl('dd'), desc);
        }
        return;
    }
    if ('keys' in block) {
        const dl = parent.createEl('dl', { cls: ['etz-help-terms', 'mod-keys'] });
        for (const [keys, desc] of block.keys) {
            const dt = dl.createEl('dt');
            keys.split(' / ').forEach((combo, i) => {
                if (i > 0) dt.appendText(' / ');
                combo.split(' + ').forEach((key, j) => {
                    if (j > 0) dt.appendText('+');
                    dt.createEl('kbd', { cls: 'etz-help-kbd', text: key });
                });
            });
            rich(dl.createEl('dd'), desc);
        }
        return;
    }
    if ('example' in block) {
        const example = EXAMPLES.find((ex) => ex.id === block.example);
        if (!example) return;
        const card = parent.createDiv({ cls: 'etz-help-example' });
        const text = card.createDiv({ cls: 'etz-help-example-text' });
        const titleEl = text.createDiv({ cls: 'etz-help-example-title', text: example.title });
        titleEl.id = uniqueId('help-example');
        if (example.is3D) titleEl.createSpan({ cls: 'etz-help-badge', text: '3D' });
        text.createDiv({ cls: 'etz-help-example-desc', text: example.description });
        const button = textButton(card, {
            text: 'Open example',
            size: 'sm',
            cls: 'etz-help-example-btn',
            onClick: () => host.loadChart(cloneData(example.data)),
        });
        button.el.setAttr('aria-describedby', titleEl.id);
    }
}

/** Plain text of a reference block, for the search. */
function blockText(block: Block): string {
    if (typeof block === 'string') return block;
    if ('sub' in block) return block.sub;
    if ('note' in block) return block.note;
    if ('list' in block) return block.list.join(' ');
    if ('code' in block) return block.code.map((line) => (Array.isArray(line) ? line.join(' ') : line)).join(' ');
    if ('terms' in block) return block.terms.map((pair) => pair.join(' ')).join(' ');
    if ('keys' in block) return block.keys.map((pair) => pair.join(' ')).join(' ');
    const example = EXAMPLES.find((ex) => ex.id === block.example);
    return example ? `${example.title} ${example.description}` : '';
}

/** Reference sections that contain every word of the query, best first. */
function searchSections(query: string): Section[] {
    const tokens = searchTokens(query);
    if (!tokens.length) return [];
    return SECTIONS.map((section, index) => ({
        section,
        index,
        score: searchScore(tokens, [
            [section.title, 10],
            [section.about, 5],
            [section.blocks.map(blockText).join(' '), 1],
        ]),
    }))
        .filter((hit) => hit.score > 0)
        .sort((a, b) => b.score - a.score || a.index - b.index)
        .map((hit) => hit.section);
}

/**
 * Body of a guide step: paragraphs separated by blank lines; consecutive
 * lines starting with '- ' form a list.
 */
function renderBody(parent: HTMLElement, body: string): void {
    for (const paragraph of String(body ?? '').split(/\n[ \t]*\n/)) {
        let text: string[] = [];
        let items: string[] = [];
        const flushText = () => {
            if (text.length) rich(parent.createEl('p', { cls: 'etz-help-p' }), text.join(' '));
            text = [];
        };
        const flushItems = () => {
            if (items.length) {
                const ul = parent.createEl('ul', { cls: 'etz-help-list' });
                for (const item of items) rich(ul.createEl('li'), item);
            }
            items = [];
        };
        for (const raw of paragraph.split('\n')) {
            const line = raw.trim();
            if (!line) continue;
            if (line.startsWith('- ')) {
                flushText();
                items.push(line.slice(2).trim());
            } else {
                flushItems();
                text.push(line);
            }
        }
        flushText();
        flushItems();
    }
}

// ------------------------------------------------------------------ charts

/** Rendered guide thumbnails by thumbnailKey, cloned into cards (failures are retried next time). */
const THUMBNAILS = new Map<string, SVGSVGElement>();

/**
 * Cache key of a guide's thumbnail. 2D charts are drawn with the theme's CSS
 * variables and follow a theme switch by themselves; the 3D renderer resolves
 * its colours when it draws, so those thumbnails are kept per theme.
 */
function thumbnailKey(guide: Guide): string {
    if (!chartIs3D(guide.chart)) return guide.id;
    return `${guide.id}|${activeDocument.body.hasClass('theme-dark') ? 'dark' : 'light'}`;
}

/** Where the reader was when the editor closed: the Help tab opens there again (this session only). */
let lastRead: { guide: string; scroll: number } | null = null;

function chartIs3D(chart: ChartData): boolean {
    return chart.dimension === true;
}

/** Take the SVG out of a 3D renderer's root: outside the root no .tikz-3d-svg rule hides it. */
function detach3D(renderer: SVG3DRenderer): SVGSVGElement | null {
    const svg = renderer.getElement().querySelector('svg');
    if (!svg) return null;
    svg.remove();
    svg.classList.remove('tikz-3d-svg');
    return svg;
}

/** Let CSS size the picture; the viewBox keeps its proportions. */
function fluid(svg: SVGSVGElement): SVGSVGElement {
    svg.removeAttribute('width');
    svg.removeAttribute('height');
    svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');
    svg.setAttribute('aria-hidden', 'true');
    return svg;
}

/** Width : height of the preview canvas of a chart (its paper size), 1.25 when it cannot be read. */
function chartAspect(chart: ChartData): number {
    try {
        const { width, height } = SettingsManager.fromJSON(cloneData(chart)).previewCanvas();
        return width > 0 && height > 0 ? width / height : 1.25;
    } catch {
        return 1.25;
    }
}

/**
 * A chart as the editor would draw it, with the chart's own slider values.
 * The math context is private: the memoized one may be the editor's own
 * (same structure after "Open this step in the editor"), and its slider and
 * computed values must stay the editor's.
 */
function chartConfig(chart: ChartData) {
    const settings = SettingsManager.fromJSON(cloneData(chart));
    const math = settings.createMathContext({ memo: false });
    return { math, config: settings.toRendererConfig(math) };
}

/** Thumbnail of a chart: 2D in the renderer's compact mode (no ticks, no texts), 3D as a small export SVG. */
function renderThumbnail(chart: ChartData): SVGSVGElement | null {
    const { math, config } = chartConfig(chart);
    config.title = '';
    if (config.is3D) {
        config.width = THUMB_3D_W;
        config.height = THUMB_3D_H;
        const renderer = new SVG3DRenderer();
        renderer.renderSvg(config, { math });
        return detach3D(renderer);
    }
    config.width = THUMB_W;
    config.height = THUMB_H;
    // Grid lines are noise at this size.
    config.gridMajor = false;
    config.gridMinor = false;
    return new SVGRenderer(config, { math }).render() as SVGSVGElement;
}

/**
 * 3D charts: the camera leaves wide margins around the box, so once the SVG
 * is in the document, zoom its viewBox onto what is drawn (the groups and
 * the title; texts are display: none in thumbnails and do not count).
 * Returns the new viewBox, or null when nothing has a size.
 */
function fitToContent(svg: SVGSVGElement, pad: number): string | null {
    let x0 = Infinity;
    let y0 = Infinity;
    let x1 = -Infinity;
    let y1 = -Infinity;
    for (const el of Array.from(svg.querySelectorAll<SVGGraphicsElement>(':scope > g, :scope > text'))) {
        let b: DOMRect;
        try {
            b = el.getBBox();
        } catch {
            continue;
        }
        if (!(b.width > 0 && b.height > 0)) continue;
        x0 = Math.min(x0, b.x);
        y0 = Math.min(y0, b.y);
        x1 = Math.max(x1, b.x + b.width);
        y1 = Math.max(y1, b.y + b.height);
    }
    if (!Number.isFinite(x0) || !Number.isFinite(y0)) return null;
    const viewBox = `${x0 - pad} ${y0 - pad} ${x1 - x0 + 2 * pad} ${y1 - y0 + 2 * pad}`;
    svg.setAttribute('viewBox', viewBox);
    return viewBox;
}

let cloneCount = 0;

/**
 * Give a cloned chart its own ids. A clone repeats the ids of its original,
 * and `url(#id)` resolves to the first element with that id in the document:
 * when that copy sits in a hidden view (the home cards while a guide is
 * open), the clone's arrowheads, patterns and clip paths would not draw.
 */
function ownIds(svg: SVGSVGElement): SVGSVGElement {
    const suffix = `-c${++cloneCount}`;
    const ids = new Set<string>();
    for (const el of Array.from(svg.querySelectorAll('[id]'))) {
        ids.add(el.id);
        el.id += suffix;
    }
    if (!ids.size) return svg;
    for (const el of Array.from(svg.querySelectorAll('*'))) {
        for (const attr of Array.from(el.attributes)) {
            if (attr.name === 'id' || !attr.value.includes('#')) continue;
            let value = attr.value.replace(/url\((["']?)#([^)"']+)\1\)/g, (match: string, quote: string, id: string) =>
                ids.has(id) ? `url(${quote}#${id}${suffix}${quote})` : match
            );
            if ((attr.name === 'href' || attr.name === 'xlink:href') && value.startsWith('#') && ids.has(value.slice(1))) value += suffix;
            if (value !== attr.value) el.setAttribute(attr.name, value);
        }
    }
    return svg;
}

/**
 * Thumbnail SVG of a guide's finished chart (a clone of the cached drawing
 * with ids of its own), or null when it cannot be drawn. `key` is its cache
 * entry; `fresh` is true for a first render.
 */
function guideThumbnail(guide: Guide): { svg: SVGSVGElement; key: string; fresh: boolean } | null {
    const key = thumbnailKey(guide);
    let svg = THUMBNAILS.get(key) ?? null;
    const fresh = !svg;
    if (!svg) {
        try {
            svg = renderThumbnail(guide.chart);
        } catch {
            svg = null;
        }
        if (!svg) return null;
        THUMBNAILS.set(key, fluid(svg));
    }
    return { svg: ownIds(svg.cloneNode(true) as SVGSVGElement), key, fresh };
}

/** A drawn figure, and (2D charts with `$...$` labels) the renderer's promise that says whether to draw it again. */
interface DrawnFigure {
    svg: SVGSVGElement;
    settled: Promise<boolean> | null;
}

/** The full chart for a figure box of `boxW` x `boxH` CSS px, or null when it cannot be drawn. */
function renderFigure(chart: ChartData, boxW: number, boxH: number): DrawnFigure | null {
    try {
        const { math, config } = chartConfig(chart);
        if (config.is3D) {
            // 3D texts have a fixed size in viewBox units: draw near the size
            // shown, a little larger because the figure zooms onto the drawing.
            const aspect = config.width > 0 && config.height > 0 ? config.width / config.height : 1.25;
            const width = Math.round(Math.max(FIGURE_3D_MIN_W, Math.min(FIGURE_3D_MAX_W, (boxW > 0 ? boxW : FIGURE_3D_MAX_W) * FIGURE_3D_ZOOM)));
            config.width = width;
            config.height = Math.round(width / aspect);
            const renderer = new SVG3DRenderer();
            renderer.renderSvg(config, { math });
            const svg = detach3D(renderer);
            return svg ? { svg: fluid(svg), settled: null } : null;
        }
        const pixelScale = fitPixelScale(boxW, boxH, config.width, config.height);
        const renderer = new SVGRenderer(config, { math, pixelScale });
        const svg = fluid(renderer.render() as SVGSVGElement);
        return { svg, settled: renderer.mathSettled };
    } catch {
        return null;
    }
}

/**
 * Runs render jobs when their element scrolls into view, one per task so the
 * tab stays responsive. A class of its own on purpose: the observer keeps
 * its callback alive, and the callback must not hold on to the panel (the
 * jobs do, but they sit in a WeakMap keyed by their element), so a panel
 * that left the document is garbage like any other.
 */
class LazyJobs {
    private readonly jobs = new WeakMap<Element, () => void>();
    private queue: Array<() => void> = [];
    private timer: number | null = null;
    private observer: IntersectionObserver | null = null;

    constructor(scroller: HTMLElement) {
        if (typeof IntersectionObserver === 'undefined') return;
        this.observer = new IntersectionObserver(this.onEntries.bind(this), { root: scroller, rootMargin: `${LAZY_MARGIN_PX}px 0px` });
    }

    /** Run `job` once `el` is (nearly) visible; without IntersectionObserver, as soon as the queue gets to it. */
    add(el: Element, job: () => void): void {
        if (!this.observer) {
            this.queue.push(job);
            this.pump();
            return;
        }
        this.jobs.set(el, job);
        this.observer.observe(el);
    }

    /** Forget every pending job. */
    clear(): void {
        if (this.observer) this.observer.disconnect();
        this.queue = [];
        if (this.timer !== null) window.clearTimeout(this.timer);
        this.timer = null;
    }

    private onEntries(entries: IntersectionObserverEntry[]): void {
        for (const entry of entries) {
            if (!entry.isIntersecting) continue;
            if (this.observer) this.observer.unobserve(entry.target);
            const job = this.jobs.get(entry.target);
            if (!job) continue;
            this.jobs.delete(entry.target);
            this.queue.push(job);
        }
        this.pump();
    }

    private pump(): void {
        if (this.timer !== null || !this.queue.length) return;
        this.timer = window.setTimeout(() => {
            this.timer = null;
            const job = this.queue.shift();
            if (job) {
                try {
                    job();
                } catch {
                    // A picture that fails leaves its placeholder; the rest still render.
                }
            }
            this.pump();
        }, 0);
    }
}

// ------------------------------------------------------------------- panel

export function createHelpPanel(parent: HTMLElement, host: PanelHost): HelpPanelHandle {
    const root = parent.createDiv({ cls: 'etz-help' });
    /** The tab panel scrolls; the views below swap inside it. */
    const scroller = parent;
    const homeEl = root.createDiv({ cls: 'etz-help-home' });
    const guideEl = root.createDiv({ cls: ['etz-help-page', 'mod-guide', 'tikz-hidden'] });
    const referenceEl = root.createDiv({ cls: ['etz-help-page', 'mod-reference', 'tikz-hidden'] });

    const homeLazy = new LazyJobs(scroller);
    const pageLazy = new LazyJobs(scroller);

    let view: 'home' | 'guide' | 'reference' = 'home';
    let openGuide: Guide | null = null;
    /** Scroll position of the home view and the control that left it, restored by "All guides". */
    let homeScroll = 0;
    let returnFocus: HTMLElement | null = null;
    /** Headings of the reference sections, once the reference is built. */
    let sectionHeadings: Map<string, HTMLElement> | null = null;
    let releaseEscape: (() => void) | null = null;
    let destroyed = false;

    // ---------------------------------------------------------------- views

    /**
     * Scroll the tab panel so `el` sits at its top, below the sticky bar of a
     * page. Not scrollIntoView: that also scrolls every ancestor that can
     * scroll, the editor modal included (its overflow is hidden, so the user
     * could not scroll it back).
     */
    function scrollToTop(el: HTMLElement): void {
        const bar = view === 'home' ? null : (view === 'guide' ? guideEl : referenceEl).querySelector<HTMLElement>('.etz-help-bar');
        const offset = (bar ? bar.offsetHeight : 0) + SCROLL_GAP_PX;
        scroller.scrollTop += el.getBoundingClientRect().top - scroller.getBoundingClientRect().top - offset;
    }

    function show(next: 'home' | 'guide' | 'reference'): void {
        view = next;
        homeEl.toggleClass('tikz-hidden', next !== 'home');
        guideEl.toggleClass('tikz-hidden', next !== 'guide');
        referenceEl.toggleClass('tikz-hidden', next !== 'reference');
        if (next !== 'guide') lastRead = null;
        syncEscape();
    }

    /** Leave the home view for a page, remembering where to come back to. */
    function leaveHome(from: HTMLElement | null): void {
        if (view !== 'home') return;
        homeScroll = scroller.scrollTop;
        returnFocus = from;
    }

    function showHome(): void {
        if (view === 'home') return;
        show('home');
        pageLazy.clear();
        guideEl.empty();
        openGuide = null;
        scroller.scrollTop = homeScroll;
        const target = returnFocus && returnFocus.isConnected ? returnFocus : searchInput;
        returnFocus = null;
        if (root.isShown()) target.focus({ preventScroll: true });
    }

    function showGuide(id: string, step?: number): boolean {
        const guide = guideById(id);
        if (!guide) return false;
        show('guide');
        const steps = buildGuide(guide);
        lastRead = { guide: guide.id, scroll: 0 };
        scroller.scrollTop = 0;
        const stepEl = typeof step === 'number' ? steps[step] : undefined;
        if (stepEl) scrollToTop(stepEl);
        // Opened at a step: the focus goes to that step's heading, so the next Tab continues from
        // there. (On the guide title it would be far above the view, and Tab would scroll back up.)
        const target = (stepEl ? stepEl.querySelector<HTMLElement>('.etz-help-step-title') : null) || guideEl.querySelector<HTMLElement>('.etz-help-title');
        if (target && root.isShown()) target.focus({ preventScroll: true });
        return true;
    }

    function showReference(section?: string): boolean {
        if (!sectionHeadings) sectionHeadings = buildReference();
        const heading = section ? sectionHeadings.get(section) : undefined;
        if (section && !heading) return false;
        show('reference');
        pageLazy.clear();
        guideEl.empty();
        openGuide = null;
        scroller.scrollTop = 0;
        const target = heading || referenceEl.querySelector<HTMLElement>('.etz-help-title');
        if (heading) scrollToTop(heading);
        if (target && root.isShown()) target.focus({ preventScroll: true });
        return true;
    }

    // ----------------------------------------------------------- components

    /** "All guides" bar that stays at the top of a page while it scrolls. */
    function pageBar(page: HTMLElement, crumb: string): void {
        const bar = page.createDiv({ cls: 'etz-help-bar' });
        textButton(bar, { text: 'All guides', icon: 'arrow-left', variant: 'ghost', size: 'sm', cls: 'etz-help-back', onClick: () => showHome() });
        bar.createSpan({ cls: 'etz-help-crumb', text: crumb });
    }

    /** Fixed-aspect thumbnail box; the picture arrives when the box scrolls into view. */
    function thumbnail(card: HTMLElement, guide: Guide, lazy: LazyJobs): void {
        const box = card.createSpan({ cls: 'etz-help-thumb', attr: { 'aria-hidden': 'true' } });
        lazy.add(box, () => {
            if (!box.isConnected) return;
            const thumb = guideThumbnail(guide);
            if (!thumb) {
                box.addClass('is-fallback');
                return;
            }
            box.appendChild(thumb.svg);
            if (thumb.fresh && chartIs3D(guide.chart)) {
                // The cached original keeps the fitted viewBox for later clones.
                const viewBox = fitToContent(thumb.svg, 4);
                const cached = THUMBNAILS.get(thumb.key);
                if (viewBox && cached) cached.setAttribute('viewBox', viewBox);
            }
        });
    }

    /** A guide as a card: thumbnail, title, summary, level and minutes. `hit` names the step a search found. */
    function guideCard(grid: HTMLElement, guide: Guide, lazy: LazyJobs, hit?: number | null): HTMLButtonElement {
        const card = grid.createEl('button', { cls: 'etz-help-card', attr: { type: 'button' } });
        thumbnail(card, guide, lazy);
        const text = card.createSpan({ cls: 'etz-help-card-text' });
        const title = text.createSpan({ cls: 'etz-help-card-title', text: guide.title });
        if (chartIs3D(guide.chart)) title.createSpan({ cls: 'etz-help-badge', text: '3D' });
        text.createSpan({ cls: 'etz-help-card-summary', text: guide.summary });
        const found = typeof hit === 'number' && guide.steps[hit] ? hit : null;
        if (found !== null) text.createSpan({ cls: 'etz-help-card-hit', text: `Step ${found + 1}: ${guide.steps[found].title}` });
        const meta = text.createSpan({ cls: 'etz-help-card-meta' });
        meta.createSpan({ cls: ['etz-help-level', `mod-${guide.level}`], text: GUIDE_LEVEL_LABELS[guide.level] || guide.level });
        meta.createSpan({ text: `${guide.minutes} min` });
        card.addEventListener('click', () => {
            leaveHome(card);
            showGuide(guide.id, found ?? undefined);
        });
        return card;
    }

    /** A chart in a fixed-aspect box, drawn when it scrolls into view. */
    function figure(parent: HTMLElement, chart: ChartData, label: string): HTMLElement {
        const box = parent.createDiv({ cls: 'etz-help-figure', attr: { role: 'img' } });
        const name = visuallyHidden(box, label);
        name.id = uniqueId('help-figure');
        box.setAttr('aria-labelledby', name.id);
        box.setCssProps({ '--etz-help-aspect': String(Math.round(chartAspect(chart) * 1000) / 1000) });
        let shown: SVGSVGElement | null = null;
        const draw = (redraws: number): void => {
            if (!box.isConnected) return;
            const drawn = renderFigure(chart, box.clientWidth, box.clientHeight);
            if (!drawn) {
                // A redraw that fails keeps the picture that is there.
                if (!shown) box.addClass('is-fallback');
                return;
            }
            if (shown) shown.replaceWith(drawn.svg);
            else box.appendChild(drawn.svg);
            shown = drawn.svg;
            if (chartIs3D(chart)) fitToContent(drawn.svg, 8);
            // A new `$...$` label is measured before MathJax has styled it: draw again when it has.
            if (drawn.settled && redraws < MATH_REDRAW_LIMIT) {
                void drawn.settled.then((redraw) => {
                    if (redraw && shown === drawn.svg) draw(redraws + 1);
                });
            }
        };
        pageLazy.add(box, () => draw(0));
        return box;
    }

    /** "Type" rows: where to type, the text, and a Copy button. */
    function typeRows(parent: HTMLElement, rows: NonNullable<GuideStep['type']>): void {
        const list = parent.createDiv({ cls: 'etz-help-type' });
        for (const row of rows) {
            const el = list.createDiv({ cls: 'etz-help-type-row' });
            const main = el.createDiv({ cls: 'etz-help-type-main' });
            main.createDiv({ cls: 'etz-help-type-where', text: row.where });
            const code = main.createEl('code', { cls: 'etz-help-type-text', text: row.text });
            code.id = uniqueId('help-type');
            const button = textButton(el, { text: 'Copy', variant: 'ghost', size: 'sm', cls: 'etz-help-copy' });
            button.el.setAttr('aria-describedby', code.id);
            let timer: number | null = null;
            button.el.addEventListener('click', () => {
                void navigator.clipboard.writeText(row.text).then(
                    () => {
                        button.setText('Copied');
                        if (timer !== null) window.clearTimeout(timer);
                        timer = window.setTimeout(() => {
                            timer = null;
                            button.setText('Copy');
                        }, COPIED_MS);
                    },
                    () => new Notice('Could not copy to the clipboard.')
                );
            });
        }
    }

    // ----------------------------------------------------------------- home

    const search = homeEl.createDiv({ cls: 'etz-help-search' });
    setIcon(search.createSpan({ cls: 'etz-help-search-icon', attr: { 'aria-hidden': 'true' } }), 'search');
    const searchInput = search.createEl('input', {
        cls: ['etz-input', 'etz-help-search-input'],
        type: 'text',
        attr: { autocomplete: 'off', spellcheck: 'false', placeholder: 'Search guides and reference' },
    });
    const searchLabel = visuallyHidden(search, 'Search guides and reference');
    searchLabel.id = uniqueId('help-search');
    searchInput.setAttr('aria-labelledby', searchLabel.id);
    const clearButton = iconButton(search, { icon: 'x', label: 'Clear search', size: 'sm', cls: 'etz-help-search-clear', onClick: () => clearSearch(true) });
    clearButton.el.addClass('tikz-hidden');

    const resultsEl = homeEl.createDiv({ cls: ['etz-help-results', 'tikz-hidden'] });
    const browseEl = homeEl.createDiv({ cls: 'etz-help-browse' });

    /** Escape clears a typed query instead of closing the editor (only while the field has focus and text). */
    function syncEscape(): void {
        const wanted = !destroyed && view === 'home' && searchInput.value !== '' && searchInput.isConnected && activeDocument.activeElement === searchInput;
        if (wanted && !releaseEscape) {
            releaseEscape = trapEscape(host, () => {
                // The editor may have closed without a blur: let go, the key was not ours.
                if (!searchInput.isConnected) syncEscape();
                else clearSearch(true);
            });
        } else if (!wanted && releaseEscape) {
            releaseEscape();
            releaseEscape = null;
        }
    }

    function clearSearch(focus: boolean): void {
        searchInput.value = '';
        runSearch();
        if (focus) searchInput.focus();
        syncEscape();
    }

    /** Buttons of the reference sections: title and one line about each. */
    function topicList(parent: HTMLElement, sections: Section[]): void {
        const list = parent.createDiv({ cls: 'etz-help-topics' });
        for (const section of sections) {
            const button = list.createEl('button', { cls: 'etz-help-topic', attr: { type: 'button' } });
            button.createSpan({ cls: 'etz-help-topic-title', text: section.title });
            button.createSpan({ cls: 'etz-help-topic-about', text: section.about });
            button.addEventListener('click', () => {
                leaveHome(button);
                showReference(section.id);
            });
        }
    }

    function runSearch(): void {
        const query = searchInput.value.trim();
        clearButton.el.toggleClass('tikz-hidden', searchInput.value === '');
        resultsEl.empty();
        resultsEl.toggleClass('tikz-hidden', !query);
        browseEl.toggleClass('tikz-hidden', !!query);
        if (!query) return;
        const guides = searchGuides(query);
        const sections = searchSections(query);
        const count = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
        const status = resultsEl.createDiv({ cls: 'etz-help-status', attr: { role: 'status' } });
        if (!guides.length && !sections.length) {
            status.setText(`Nothing found for "${query}". Try a single word, such as region, slider or tangent.`);
            return;
        }
        const parts: string[] = [];
        if (guides.length) parts.push(count(guides.length, 'guide', 'guides'));
        if (sections.length) parts.push(count(sections.length, 'reference section', 'reference sections'));
        status.setText(parts.join(', '));
        if (guides.length) {
            const grid = resultsEl.createDiv({ cls: 'etz-help-cards' });
            for (const hit of guides) guideCard(grid, hit.guide, homeLazy, hit.step);
        }
        if (sections.length) {
            if (guides.length) resultsEl.createEl('h3', { cls: 'etz-help-h', text: 'Reference' });
            topicList(resultsEl, sections);
        }
    }

    searchInput.addEventListener('input', () => {
        runSearch();
        syncEscape();
    });
    searchInput.addEventListener('focus', syncEscape);
    searchInput.addEventListener('blur', syncEscape);
    searchInput.addEventListener('keydown', (e: KeyboardEvent) => {
        // Mod+Enter belongs to the editor (Insert into note).
        if (e.isComposing || e.metaKey || e.ctrlKey || e.altKey) return;
        const first = resultsEl.querySelector<HTMLElement>('button.etz-help-card, button.etz-help-topic');
        if (!first) return;
        if (e.key === 'Enter') {
            e.preventDefault();
            first.click();
        } else if (e.key === 'ArrowDown') {
            e.preventDefault();
            first.focus();
        }
    });

    // Jump links: the reference is the last category, a long scroll below the guide cards.
    const jump = browseEl.createEl('nav', { cls: 'etz-help-toc' });
    const jumpLabel = visuallyHidden(jump, 'Categories');
    jumpLabel.id = uniqueId('help-jump');
    jump.setAttr('aria-labelledby', jumpLabel.id);
    const jumpList = jump.createDiv({ cls: 'etz-help-toc-list' });

    for (const category of GUIDE_CATEGORIES) {
        const guides = guidesIn(category);
        const reference = category === 'Reference';
        if (!guides.length && !reference) continue;
        const section = browseEl.createEl('section', { cls: 'etz-help-category' });
        const heading = section.createEl('h3', { cls: 'etz-help-h', text: category, attr: { tabindex: '-1' } });
        heading.id = uniqueId('help-category');
        section.setAttr('aria-labelledby', heading.id);
        if (guides.length) {
            const grid = section.createDiv({ cls: 'etz-help-cards' });
            for (const guide of guides) guideCard(grid, guide, homeLazy);
        }
        if (reference) {
            if (guides.length) section.createEl('h4', { cls: 'etz-help-sub', text: 'Reference sections' });
            topicList(section, SECTIONS);
        }
        textButton(jumpList, {
            text: category,
            variant: 'ghost',
            size: 'sm',
            cls: 'etz-help-toc-btn',
            onClick: () => {
                scrollToTop(heading);
                heading.focus({ preventScroll: true });
            },
        });
    }

    // ---------------------------------------------------------------- guide

    /** Build the reader page of a guide; returns its step elements. */
    function buildGuide(guide: Guide): HTMLElement[] {
        pageLazy.clear();
        guideEl.empty();
        openGuide = guide;
        pageBar(guideEl, guide.category);

        const head = guideEl.createEl('header', { cls: 'etz-help-guide-head' });
        head.createEl('h3', { cls: ['etz-help-h', 'etz-help-title'], text: guide.title, attr: { tabindex: '-1' } });
        const meta = head.createDiv({ cls: 'etz-help-meta' });
        meta.createSpan({ cls: ['etz-help-level', `mod-${guide.level}`], text: GUIDE_LEVEL_LABELS[guide.level] || guide.level });
        meta.createSpan({ text: `${guide.minutes} min` });
        meta.createSpan({ text: `${guide.steps.length} steps` });
        head.createEl('p', { cls: 'etz-help-p', text: guide.summary });

        const before = (guide.requires || []).map((id) => guideById(id)).filter((g): g is Guide => !!g);
        if (before.length) {
            const line = head.createEl('p', { cls: ['etz-help-p', 'etz-help-requires'] });
            line.appendText('Read first: ');
            before.forEach((g, i) => {
                if (i > 0) line.appendText(', ');
                textButton(line, { text: g.title, variant: 'link', onClick: () => showGuide(g.id) });
            });
        }

        // What the reader gets: the outcomes beside the finished chart (the picture of the guide's card).
        const lead = guideEl.createDiv({ cls: 'etz-help-lead' });
        const outcomes = lead.createEl('section', { cls: 'etz-help-outcomes' });
        outcomes.createEl('h4', { cls: 'etz-help-sub', text: 'After this guide you can' });
        const ul = outcomes.createEl('ul', { cls: 'etz-help-list' });
        for (const outcome of guide.outcomes || []) rich(ul.createEl('li'), outcome);
        const finished = lead.createDiv({ cls: 'etz-help-finished' });
        thumbnail(finished, guide, pageLazy);
        textButton(finished, { text: 'Open the finished chart', variant: 'link', cls: 'etz-help-open-finished', onClick: () => host.loadChart(cloneData(guide.chart)) });

        const stepEls: HTMLElement[] = [];
        guide.steps.forEach((step, index) => {
            const el = guideEl.createEl('section', { cls: 'etz-help-step' });
            const stepHead = el.createDiv({ cls: 'etz-help-step-head' });
            stepHead.createSpan({ cls: 'etz-help-step-num', text: String(index + 1), attr: { 'aria-hidden': 'true' } });
            const title = stepHead.createEl('h4', { cls: 'etz-help-step-title', attr: { tabindex: '-1' } });
            visuallyHidden(title, `Step ${index + 1}: `);
            title.appendText(step.title);
            title.id = uniqueId('help-step');
            el.setAttr('aria-labelledby', title.id);

            renderBody(el, step.body);
            if (step.type && step.type.length) typeRows(el, step.type);
            if (step.tip) {
                const tip = el.createDiv({ cls: 'etz-help-tip' });
                setIcon(tip.createSpan({ cls: 'etz-help-tip-icon', attr: { 'aria-hidden': 'true' } }), 'lightbulb');
                const text = tip.createDiv({ cls: 'etz-help-tip-text' });
                visuallyHidden(text, 'Tip: ');
                rich(text, step.tip);
            }
            if (step.chart) figure(el, step.chart, `The chart after step ${index + 1}: ${step.title}`);
            // A step without its own chart keeps the previous one: the button still opens the chart of this point of the guide.
            const chart = stepChart(guide, index);
            if (chart) {
                textButton(el, { text: 'Open this step in the editor', size: 'sm', cls: 'etz-help-open', onClick: () => host.loadChart(cloneData(chart)) });
            }
            stepEls.push(el);
        });

        const next = (guide.next || []).map((id) => guideById(id)).filter((g): g is Guide => !!g && g.id !== guide.id);
        if (next.length) {
            const section = guideEl.createEl('section', { cls: 'etz-help-next' });
            section.createEl('h3', { cls: 'etz-help-h', text: 'Next guides' });
            const grid = section.createDiv({ cls: 'etz-help-cards' });
            for (const g of next) guideCard(grid, g, pageLazy);
        }

        const foot = guideEl.createEl('p', { cls: ['etz-help-p', 'etz-help-foot'] });
        const link = foot.createEl('a', { cls: 'external-link', text: 'This guide with screenshots on GitHub', href: guideUrl(guide.id) });
        link.setAttr('target', '_blank');
        link.setAttr('rel', 'noopener');
        return stepEls;
    }

    // ------------------------------------------------------------ reference

    /** Build the reference page once; returns the heading of every section by id. */
    function buildReference(): Map<string, HTMLElement> {
        const headings = new Map<string, HTMLElement>();
        pageBar(referenceEl, 'Reference');
        const intro = referenceEl.createDiv({ cls: 'etz-help-intro' });
        intro.createEl('h3', { cls: ['etz-help-h', 'etz-help-title'], text: 'Easy TikZ reference', attr: { tabindex: '-1' } });
        intro.createEl('p', {
            cls: 'etz-help-p',
            text: 'How to write formulas, build regions, points and sliders, and what the LaTeX export contains.',
        });

        // Contents: buttons that scroll their section into view and move focus to its heading.
        const nav = intro.createEl('nav', { cls: 'etz-help-toc' });
        const navLabel = nav.createDiv({ cls: 'etz-help-toc-label', text: 'Contents' });
        navLabel.id = uniqueId('help-toc');
        nav.setAttr('aria-labelledby', navLabel.id);
        const navList = nav.createDiv({ cls: 'etz-help-toc-list' });

        for (const section of SECTIONS) {
            const el = referenceEl.createEl('section', { cls: 'etz-help-section' });
            const heading = el.createEl('h3', { cls: 'etz-help-h', text: section.title, attr: { tabindex: '-1' } });
            heading.id = uniqueId(`help-${section.id}`);
            el.setAttr('aria-labelledby', heading.id);
            for (const block of section.blocks) renderBlock(el, block, host);
            headings.set(section.id, heading);

            textButton(navList, {
                text: section.title,
                variant: 'ghost',
                size: 'sm',
                cls: 'etz-help-toc-btn',
                onClick: () => {
                    scrollToTop(heading);
                    heading.focus({ preventScroll: true });
                },
            });
        }
        return headings;
    }

    // -------------------------------------------------------------- resume

    // Remember how far the open guide was read, so the next editor (a chart
    // inserted into a note closes this one) opens the Help tab there again.
    scroller.addEventListener(
        'scroll',
        () => {
            if (view === 'guide' && openGuide && lastRead && lastRead.guide === openGuide.id && root.isShown()) lastRead.scroll = scroller.scrollTop;
        },
        { passive: true }
    );
    const resume = lastRead && guideById(lastRead.guide) ? { ...lastRead } : null;
    if (resume) {
        showGuide(resume.guide);
        lastRead = { ...resume };
        // The tab panel is hidden until the Help tab is picked: scroll once it shows.
        homeLazy.add(root, () => {
            if (view === 'guide' && openGuide && openGuide.id === resume.guide) scroller.scrollTop = resume.scroll;
        });
    }

    return {
        el: root,
        showHome,
        showGuide: (id, step) => {
            if (!guideById(id)) return false;
            leaveHome(null);
            return showGuide(id, step);
        },
        showReference: (section) => {
            if (section && !SECTIONS.some((s) => s.id === section)) return false;
            leaveHome(null);
            return showReference(section);
        },
        destroy: () => {
            destroyed = true;
            homeLazy.clear();
            pageLazy.clear();
            syncEscape();
        },
    };
}
