/*
 * Help tab: the v4 reference with live "Open example" buttons.
 *
 * The text is data (SECTIONS below) rendered by a few small block types.
 * Inline `backticks` in any text become <code>. Example blocks name an
 * entry of EXAMPLES (src/migrate.ts) and load it through host.loadChart,
 * which asks before replacing a non-empty chart. Everything here describes
 * v4 behaviour; keep it in sync with mathcontext.ts, migrate.ts recipes
 * and the editor panels when they change.
 */
import { Platform } from 'obsidian';
import { EXAMPLES } from '../migrate';
import { PanelHost } from './host';
import { textButton, uniqueId } from './kit';
import { cloneData } from '../util';

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
    blocks: Block[];
}

const MOD = Platform.isMacOS ? 'Cmd' : 'Ctrl';

const SECTIONS: Section[] = [
    {
        id: 'start',
        title: 'Quick start',
        blocks: [
            'Type a formula such as `2 + sin(x)` in the Build tab and press Enter. From then on the preview redraws as you type. Use **+ Add** for everything else: more functions, shaded regions, lines and curves, points, arrows, text labels and sliders.',
            {
                list: [
                    'A name the chart does not know yet (`k` in `k x^2`) gets an **Add slider k** button under the field. Drag the slider under the preview and the picture follows.',
                    'Chart holds ranges, axes, grid and export size; Code shows the LaTeX; this tab is the reference.',
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

/** Paragraph-level text: `code` spans and **bold** runs. */
function rich(parent: HTMLElement, text: string): void {
    const parts = text.split(/(`[^`]+`|\*\*.+?\*\*)/);
    for (const part of parts) {
        if (!part) continue;
        if (part.startsWith('`') && part.endsWith('`') && part.length > 1) {
            parent.createEl('code', { cls: 'etz-help-code-inline', text: part.slice(1, -1) });
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
        const dl = parent.createEl('dl', { cls: 'etz-help-terms mod-keys' });
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

export function createHelpPanel(parent: HTMLElement, host: PanelHost): void {
    const root = parent.createDiv({ cls: 'etz-help' });
    const intro = root.createDiv({ cls: 'etz-help-intro' });
    intro.createEl('h3', { cls: 'etz-help-h', text: 'Easy TikZ reference' });
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
        const el = root.createEl('section', { cls: 'etz-help-section' });
        const heading = el.createEl('h3', { cls: 'etz-help-h', text: section.title, attr: { tabindex: '-1' } });
        heading.id = uniqueId(`help-${section.id}`);
        el.setAttr('aria-labelledby', heading.id);
        for (const block of section.blocks) renderBlock(el, block, host);

        textButton(navList, {
            text: section.title,
            variant: 'ghost',
            size: 'sm',
            cls: 'etz-help-toc-btn',
            onClick: () => {
                heading.scrollIntoView({ block: 'start' });
                heading.focus({ preventScroll: true });
            },
        });
    }
}
