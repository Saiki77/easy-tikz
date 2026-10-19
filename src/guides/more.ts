/*
 * Guides for points and labels, segments and braces, 3D, charts in notes,
 * the LaTeX export, the move from 3.x and the shortcut reference.
 *
 * Every step chart is a complete v4 settings object, built by the small
 * helpers below from the examples and defaults in src/migrate.ts, so no key
 * is missing. Guides that start on an empty editor use newChart(): the view
 * and size a new chart really has, so the pictures match what the reader
 * sees after each step. Charts are built fresh per step (no shared arrays).
 */
import { EXAMPLES, defaultFunction, defaultParameter, defaultTool } from '../migrate';
import {
    Annotation,
    CurveTool,
    Function3DParameters,
    FunctionParameters,
    Parameter,
    PlaneTool,
    PointsTool,
    RegionTool,
    SegmentTool,
    Tool,
} from '../types';
import { ChartData, Guide } from './types';

// ---------------------------------------------------------------------------
// Chart helpers
// ---------------------------------------------------------------------------

/** A deep copy, so no two charts share an array or an item. */
function copy<T>(value: T): T {
    return JSON.parse(JSON.stringify(value)) as T;
}

/** The chart of a starter example (src/migrate.ts), as its own copy. */
function example(id: string): ChartData {
    const found = EXAMPLES.find((e) => e.id === id) ?? EXAMPLES[0];
    return copy(found.data);
}

/**
 * A new chart exactly as the editor creates it (the SettingsManager
 * defaults): every stored key, the default view -0.5..10 by -0.5..5 and a
 * 10 x 10 cm figure.
 */
function newChart(overrides: ChartData = {}): ChartData {
    return {
        ...example('lp'),
        title: '',
        size_x_cm: 10,
        size_y_cm: 10,
        xmin: '-0.5',
        xmax: '10',
        ymin: '-0.5',
        ymax: '5',
        zmin: '-5',
        zmax: '5',
        axis_style: 'box',
        showLargeGrid: false,
        functions: [],
        functions3D: [],
        tools: [],
        annotations: [],
        parameters: [],
        ...overrides,
    };
}

/** Names and items a new tool is checked against: none, the helpers set id and name themselves. */
const NOTHING = { tools: [] as Tool[], functions: [] as FunctionParameters[] };

/** A function card. + Add > Function gives the first function Auto (black) and the second blue. */
function fn(name: string, expression: string, fields: Partial<FunctionParameters> = {}): FunctionParameters {
    return { ...defaultFunction([]), name, expression, ...fields };
}

/** A slider as Add slider creates it (value 1, range -10 to 10, step 0.1) unless fields say otherwise. */
function slider(name: string, value = 1, fields: Partial<Parameter> = {}): Parameter {
    return { ...defaultParameter([], name, value), ...fields };
}

function region(id: string, name: string, conditions: string[], fields: Partial<RegionTool> = {}): RegionTool {
    const tool = defaultTool('region', { is3D: false, ...NOTHING }) as RegionTool;
    return { ...tool, id, name, conditions, conditionLabels: conditions.map(() => ''), ...fields };
}

function curve(id: string, name: string, equation: string, fields: Partial<CurveTool> = {}): CurveTool {
    const tool = defaultTool('curve', { is3D: false, ...NOTHING }) as CurveTool;
    return { ...tool, id, name, equation, ...fields };
}

/** A points card; `dim: 3` in fields makes it a 3D one. */
function points(id: string, name: string, fields: Partial<PointsTool> = {}): PointsTool {
    const tool = defaultTool('points', { is3D: fields.dim === 3, ...NOTHING }) as PointsTool;
    return { ...tool, id, name, ...fields };
}

function segment(id: string, name: string, path: string, fields: Partial<SegmentTool> = {}): SegmentTool {
    const tool = defaultTool('segment', { is3D: fields.dim === 3, ...NOTHING }) as SegmentTool;
    return { ...tool, id, name, path, ...fields };
}

function plane(id: string, name: string, value: string, fields: Partial<PlaneTool> = {}): PlaneTool {
    const tool = defaultTool('plane3D', { is3D: true, ...NOTHING }) as PlaneTool;
    return { ...tool, id, name, value, ...fields };
}

/** A surface card as the Start a chart field creates it (blue, computed on -5:5 by -5:5). */
function surface(name: string, expression: string, fields: Partial<Function3DParameters> = {}): Function3DParameters {
    return { expression, xDomain: '-5:5', yDomain: '-5:5', color: 'blue', wireframe: false, opacity: 0.7, samples: 40, name, ...fields };
}

/** A text label as + Add > Text label creates it (centred on its point) unless fields say otherwise. */
function label(x: string, y: string, text: string, fields: Partial<Annotation> = {}): Annotation {
    return { x, y, text, color: 'black', size: 'normal', anchor: 'center', ...fields };
}

/** Paragraphs of a step body (blank line between them). */
function paragraphs(...parts: string[]): string {
    return parts.join('\n\n');
}

/** A '- ' list inside a step body. */
function list(...items: string[]): string {
    return items.map((item) => `- ${item}`).join('\n');
}

// ---------------------------------------------------------------------------
// Charts, one builder per guide. `step` is the number of the last finished step.
// ---------------------------------------------------------------------------

/** points-labels: a parabola and a line, listed points, their crossings, a slider and a live label. */
function crossingChart(step: number): ChartData {
    const tools: Tool[] = [];
    if (step >= 2) tools.push(points('t0', 'P1', { points: '(4, 1); (0, f2(0))', label: step >= 3 ? 'V; A' : '' }));
    if (step >= 4) {
        tools.push(points('t1', 'P2', { source: 'intersections', ref1: 'f1', ref2: 'f2', label: '({x:2}, {y:2})', dropLines: step >= 5 }));
    }
    return newChart({
        functions: [fn('f1', '0.25(x - 4)^2 + 1'), fn('f2', step >= 6 ? '0.25x + b' : '0.25x + 1.5', { color: 'blue' })],
        tools,
        parameters: step >= 6 ? [slider('b')] : [],
        annotations: step >= 7 ? [label('(P2_x + P2_x2)/2', '0.3', 'width = {P2_x2 - P2_x:2}')] : [],
    });
}

/** arrows-braces: a slope triangle on the line 0.5x, with braces and an arrow. */
function slopeChart(step: number): ChartData {
    const tools: Tool[] = [];
    if (step >= 2) {
        tools.push(segment('t0', 'S1', step >= 3 ? '(2, 1); (8, 1); (8, 4)' : '(2, 1); (8, 1)', { dashed: step >= 3 }));
    }
    if (step >= 4) tools.push(segment('t1', 'S2', '(8, 1); (2, 1)', { style: 'brace', label: 'run = 6' }));
    if (step >= 5) tools.push(segment('t2', 'S3', '(8, 4); (8, 1)', { style: 'brace', label: 'rise = {f1(8) - f1(2)}' }));
    if (step >= 6) {
        const tail = step >= 7 ? '(2, 4.5)' : '(2.5, 4)';
        tools.push(segment('t3', 'S4', `${tail}; (4.4, 2.35)`, { style: 'forward', label: 'slope = {(f1(8) - f1(2))/6}' }));
    }
    return newChart({ functions: [fn('f1', '0.5x', { color: 'blue' })], tools });
}

/** surfaces-3d: the saddle x^2 - y^2 with a plane on a slider, a point and a label. */
function saddleChart(step: number): ChartData {
    const tools: Tool[] = [];
    if (step >= 5) tools.push(plane('t0', 'PL1', 'h'));
    if (step >= 6) tools.push(points('t1', 'P1', { dim: 3, points: '(0, 0, 0)', label: 'saddle point' }));
    return newChart({
        dimension: true,
        // The ranges the editor writes when the first surface is typed into Start a chart.
        xmin: '-5.5',
        xmax: '5.5',
        ymin: '-5.5',
        ymax: '5.5',
        zmin: '-27.011',
        zmax: '27.011',
        boxAspect: step >= 2 ? 'equal' : 'true',
        rotationX: step >= 3 ? 20 : 30,
        rotationZ: step >= 3 ? 60 : 45,
        functions3D: [surface('f1', 'x^2 - y^2', step >= 4 ? { opacity: 0.5, samples: 24 } : {})],
        tools,
        parameters: step >= 5 ? [slider('h')] : [],
        annotations: step >= 7 ? [label('5.5', '-5.5', 'z = {h}', { z: 'h' })] : [],
    });
}

/** charts-in-notes: the Tangent explorer example with the display settings a note adds. */
function noteChart(step: number): ChartData {
    const chart = example('tangent');
    if (step >= 4) {
        chart.displayWidth = 420;
        chart.displayAlign = 'left';
    }
    if (step >= 5) chart.parameters = [slider('a', 1.5, { min: -2, max: 2, step: 0.05 })];
    if (step >= 6) chart.showSlidersInNote = false;
    return chart;
}

/** export-latex: the Areas between two curves example, as a snippet, resized, relabelled and with a slider. */
function exportChart(step: number): ChartData {
    const chart = example('areas');
    const functions = chart.functions as FunctionParameters[];
    const tools = chart.tools as Tool[];
    if (step === 3) chart.documentSetup = false;
    if (step >= 4) {
        chart.size_x_cm = 8;
        chart.size_y_cm = 6;
    }
    if (step >= 5) {
        for (const tool of tools) {
            if (tool.type === 'region') tool.label = tool.name === 'R1' ? '$A_1$' : '$A_2$';
        }
    }
    if (step >= 6) {
        functions[0].expression = 'a sin(x)';
        chart.parameters = [slider('a', 1.5)];
    }
    return chart;
}

/** from-3x: a typical 3.x chart after migration, then with its skipped function shown and a slider. */
function migratedChart(step: number): ChartData {
    const shown: Partial<FunctionParameters> = step >= 4 ? {} : { hidden: true };
    return newChart({
        title: 'Area between two curves',
        xmax: '6',
        ymax: '5.5',
        functions: [
            fn('f1', 'x^2/4', { domain: '0:5', color: 'blue', thickness: 'thick' }),
            fn('f2', '2*sqrt(x)', { domain: '0:5', color: 'red', thickness: 'thick' }),
            // 3.x did not draw a function with an empty domain, so migration hides it.
            fn('f3', 'x', { color: 'gray', dashed: true, ...shown }),
        ],
        tools: [
            region('t0', 'R1', ['min(f1, f2) <= y <= max(f1, f2)', step >= 5 ? '0 <= x <= a' : '0 <= x <= 4'], { fillOpacity: 0.3 }),
            points('t1', 'P1', { source: 'intersections', ref1: 'f1', ref2: 'f2', label: '({x:2}, {y:2})' }),
            curve('t2', 'C1', 'x = 4', { color: 'gray', dashed: true }),
            curve('t3', 'C2', 'y = 4', { color: 'gray', dashed: true }),
            curve('t4', 'C3', '(x - 4)^2 + (y - 4)^2 = 0.4^2', { color: 'orange' }),
            region('t5', 'R2', ['0 <= x <= 4', '0 <= y <= 4'], { color: 'gray', fill: false, fillOpacity: 0.2, outline: 'solid' }),
            segment('t6', 'S1', '(2.6, 4.8); (2.2, 2.4)', { style: 'forward' }),
            segment('t7', 'S2', '(4, 0); (0, 0)', { style: 'brace', label: 'width 4' }),
        ],
        annotations: [label('2.6', '4.8', 'A = 16/3, 33% of the square', { anchor: 'above' })],
        parameters: step >= 5 ? [slider('a', 3)] : [],
    });
}

/** shortcuts: the Linear program example after the gesture each step describes. */
function lpChart(step: number): ChartData {
    const chart = example('lp');
    const r1 = (chart.tools as Tool[]).find((tool): tool is RegionTool => tool.type === 'region');
    if (step === 2 && r1) r1.conditions[1] = 'x + 2y <= 5';
    if (step === 3) {
        chart.xmin = '2';
        chart.xmax = '4.5';
        chart.ymin = '0';
        chart.ymax = '2.25';
    }
    if (step === 4) chart.parameters = [slider('c', 6, { min: 0, max: 15 })];
    if (step === 5 && r1) r1.conditions[0] = 'x + y <= 3';
    return chart;
}

// ---------------------------------------------------------------------------
// Guides
// ---------------------------------------------------------------------------

const POINTS_LABELS: Guide = {
    id: 'points-labels',
    title: 'Points, intersections and live labels',
    summary: 'Mark points from a list, find where two curves cross, and print values that update when a slider moves.',
    category: 'Points, lines and labels',
    level: 'core',
    minutes: 10,
    outcomes: [
        'Mark and name points from a list',
        'Find the crossings of two functions and show their coordinates',
        'Use computed values such as P2_x in positions and labels',
    ],
    requires: ['first-chart'],
    chart: crossingChart(7),
    steps: [
        {
            title: 'Start with two curves',
            body: paragraphs(
                'Open the editor from the ribbon icon or with the command `Easy TikZ: Open editor`. Click + Add and choose Function y = f(x). A card f1 appears. Type the parabola into its `y =` field.',
                'Add a second function the same way and type the line. The preview shows a parabola and a line that cross twice.'
            ),
            type: [
                { where: 'f1, y =', text: '0.25(x - 4)^2 + 1' },
                { where: 'f2, y =', text: '0.25x + 1.5' },
            ],
            chart: crossingChart(1),
            shot: { reveal: ['f1', 'f2'], caption: 'Two function cards and their curves: a parabola and a line.' },
            tip: 'If you type the first formula into Start a chart instead, the view is fitted to that curve. Reset ranges (the round arrow in the action pill of the preview) brings back the default view this guide uses.',
        },
        {
            title: 'Mark points from a list',
            body: paragraphs(
                'Click + Add and choose Points from a list. The card P1 starts with three sample points. Replace them with your own: a point is written `(x, y)`, and points are separated by `;`.',
                'The first point is the vertex of the parabola. The second uses a formula: `f2(0)` is the value of the line at x = 0, so this point stays on the line when the line changes. Two red markers appear.'
            ),
            type: [{ where: 'P1, Points', text: '(4, 1); (0, f2(0))' }],
            chart: crossingChart(2),
            shot: { reveal: ['P1'], actions: [{ focus: ['P1', 'points'] }], caption: 'P1 marks the vertex and the point where the line meets the y-axis.' },
            tip: 'A comma between two points is the usual slip. The message under the field then asks you to separate points with `;`.',
        },
        {
            title: 'Name each point',
            body: 'In the Label row of P1, click Custom and type one label per point, separated by `;`. The names appear next to the markers: V at the vertex, A on the y-axis.',
            type: [{ where: 'P1, Label text', text: 'V; A' }],
            chart: crossingChart(3),
            shot: { reveal: ['P1'], actions: [{ focus: ['P1', 'label'] }], caption: 'Label set to Custom, with one name per point.' },
            tip: 'A label without `;` is used for every point. `{i}` is the number of the point, so `Q{i}` gives Q1, Q2 and so on.',
        },
        {
            title: 'Mark where the curves cross',
            body: paragraphs(
                'Click + Add and choose Intersections of two functions. In the new card P2, Intersections is selected in the row at the top (List, Intersections, Region, Integers), and the card has picked the first two functions: Of f1 and f2. A marker sits on each crossing, labelled with its coordinates: (2, 2) and (7, 3.25).',
                'These points are computed. Change either formula and they move on their own.'
            ),
            chart: crossingChart(4),
            shot: {
                reveal: ['P2'],
                actions: [{ hover: [7, 3.25] }],
                caption: 'P2 marks both crossings. Resting the pointer on one shows that it is computed.',
            },
            tip: 'A computed point is not moved by itself. Rest the pointer on a crossing and the tip in the corner of the preview names the curve under it and adds "P2 is computed: dragging here moves f2". Drag f1 or f2 and the crossing follows.',
        },
        {
            title: 'Add drop lines to the axes',
            body: 'On the P2 card, switch on Drop lines in the Size row. Dashed guides run from each crossing down to the x-axis and across to the y-axis, so the coordinates can be read off the axes.',
            chart: crossingChart(5),
            shot: { reveal: ['P2'], caption: 'Drop lines from both crossings to the axes.' },
            tip: 'Drop lines belong to the whole card. To get them for one point only, give that point a card of its own.',
        },
        {
            title: 'Move the line with a slider',
            body: paragraphs(
                'In the f2 card, replace `1.5` with the name `b`. The chart does not know `b` yet, so a button Add slider b appears under the field. Click it. The slider b = 1 appears in the Sliders dock under the preview.',
                'Drag b. The line moves up and down, the crossings and their drop lines follow, and point A stays on the line because its position is `f2(0)`.'
            ),
            type: [{ where: 'f2, y =', text: '0.25x + b' }],
            chart: crossingChart(6),
            shot: { reveal: ['f2'], caption: 'The line now uses the slider b. The crossings follow when b moves.' },
            tip: 'At b = -0.1 and below, the line no longer meets the parabola. The markers disappear, and the status chip on the preview says that f1 and f2 do not cross in the view.',
        },
        {
            title: 'Show a live value in a label',
            body: paragraphs(
                'Click + Add and choose Text label. In the new card Label 1, type the text and the two position formulas below.',
                '`P2_x` and `P2_x2` are the x-coordinates of the first and the second crossing, published by the card P2. `{...}` prints the value of a formula, and `:2` limits it to two decimals. The label sits halfway between the drop lines and reads width = 4.12. Drag b: the number and the position both update.'
            ),
            type: [
                { where: 'Label 1, Text', text: 'width = {P2_x2 - P2_x:2}' },
                { where: 'Label 1, Position x', text: '(P2_x + P2_x2)/2' },
                { where: 'Label 1, Position y', text: '0.3' },
            ],
            chart: crossingChart(7),
            shot: { reveal: ['label:0'], caption: 'A text label between the drop lines shows the distance between the crossings.' },
            tip: 'Every points card publishes its results: `P2_x`, `P2_y` for the first point, `P2_x2`, `P2_y2` for the second, and `P2_n` for the number of points. Any field can use them.',
        },
    ],
    next: ['computed-values', 'arrows-braces', 'areas-between', 'supply-demand'],
};

const ARROWS_BRACES: Guide = {
    id: 'arrows-braces',
    title: 'Segments, arrows and braces',
    summary: 'Draw a slope triangle on a line: a polyline for run and rise, two braces with labels and an arrow that points at the line.',
    category: 'Points, lines and labels',
    level: 'core',
    minutes: 10,
    outcomes: [
        'Draw segments and polylines through points you type',
        'Add braces with labels and flip them to the other side',
        'Point at things with arrows and adjust their ends by dragging',
    ],
    requires: ['first-chart'],
    chart: slopeChart(7),
    steps: [
        {
            title: 'Start with a line',
            body: paragraphs(
                'Open the editor on an empty chart. Click + Add and choose Function y = f(x), then type the formula into the `y =` field of the card f1.',
                'Click the round colour swatch at the left of the card and pick Blue. The annotations you add next are black, so the line stays easy to tell apart.'
            ),
            type: [{ where: 'f1, y =', text: '0.5x' }],
            chart: slopeChart(1),
            shot: { reveal: ['f1'], caption: 'The line y = 0.5x in the default view.' },
            tip: 'Typing the first formula into Start a chart also fits the view to it. Reset ranges (the round arrow in the action pill of the preview) brings back the default view this guide uses.',
        },
        {
            title: 'Draw a line segment',
            body: paragraphs(
                'Click + Add and choose Line segment. The card S1 starts with a sample path. Replace it with the path below.',
                'A path is a list of points separated by `;`. Two points make a straight segment: here the horizontal run from x = 2 to x = 8, starting on the line.'
            ),
            type: [{ where: 'S1, Path', text: '(2, 1); (8, 1)' }],
            chart: slopeChart(2),
            shot: { reveal: ['S1'], actions: [{ focus: ['S1', 'path'] }], caption: 'S1 is a segment between two typed points.' },
            tip: 'Coordinates are formulas, not just numbers. `(2, f1(2)); (8, f1(2))` draws the same segment and keeps it on the line when you change f1.',
        },
        {
            title: 'Extend it to a polyline',
            body: 'Add a third point to the path, then switch on Dashed in the Line row. The path now turns the corner and climbs back to the line: first the run, then the rise. The summary on the card changes to Path through 3 points.',
            type: [{ where: 'S1, Path', text: '(2, 1); (8, 1); (8, 4)' }],
            chart: slopeChart(3),
            shot: { reveal: ['S1'], caption: 'Three points make a polyline: run, then rise.' },
            tip: 'Closed (next to Dashed) joins the last point back to the first and turns the path into a polygon outline.',
        },
        {
            title: 'Label the run with a brace',
            body: paragraphs(
                'Click + Add and choose Brace with label. In the card S2, type the path and the label below.',
                'A brace spans the first two points of its path and carries its label at its tip.'
            ),
            type: [
                { where: 'S2, Path', text: '(8, 1); (2, 1)' },
                { where: 'S2, Label', text: 'run = 6' },
            ],
            chart: slopeChart(4),
            shot: { reveal: ['S2'], caption: 'A brace under the run. Its path is written from right to left.' },
            tip: 'A brace bulges to the left of the direction from its first point to its second. Written from right to left, as here, it hangs below the segment. Swap the two points to flip it.',
        },
        {
            title: 'Label the rise with a live value',
            body: paragraphs(
                'Add a second brace: + Add, then Brace with label. This one runs from top to bottom, so it bulges to the right, away from the triangle.',
                'Its label is a template. The part in braces is computed: `f1(8) - f1(2)` is how far the line rises over the run, so the label reads rise = 3 and stays correct when you change the formula of f1.'
            ),
            type: [
                { where: 'S3, Path', text: '(8, 4); (8, 1)' },
                { where: 'S3, Label', text: 'rise = {f1(8) - f1(2)}' },
            ],
            chart: slopeChart(5),
            shot: { reveal: ['S3'], caption: 'The second brace prints a value computed from the line.' },
            tip: 'A number after a colon limits the decimals: `{f1(8) - f1(2):1}` prints at most one. Without it, a value prints with up to three decimals.',
        },
        {
            title: 'Point at the line with an arrow',
            body: paragraphs(
                'Click + Add and choose Arrow. In the card S4, type the path and the label below. The arrow starts in the empty space above the line and ends just above it.',
                'In the Style row, the button with the head at the end is selected. The buttons next to it put the head at the start or at both ends.'
            ),
            type: [
                { where: 'S4, Path', text: '(2.5, 4); (4.4, 2.35)' },
                { where: 'S4, Label', text: 'slope = {(f1(8) - f1(2))/6}' },
            ],
            chart: slopeChart(6),
            shot: { reveal: ['S4'], caption: 'An arrow with a computed label points at the line.' },
            tip: 'With an arrow style, a path through more than two points gets a head on every leg.',
        },
        {
            title: 'Drag an end to fine-tune',
            body: paragraphs(
                'In the preview, grab the tail of the arrow and drag it up and to the left, to about (2, 4.5). The numbers of that point in Path follow the pointer, rounded to what the screen can show (hundredths at this zoom), so yours may read (2.05, 4.47). Close to a grid point the end snaps onto it.',
                'Grab the arrow by its shaft instead and the whole arrow moves.'
            ),
            chart: slopeChart(7),
            shot: { reveal: ['S4'], actions: [{ hover: [2, 4.5] }], caption: 'The tail of the arrow after the drag. The Path field shows the new numbers.' },
            tip: 'Hold Shift while you drag an end and it moves straight: horizontally, vertically or diagonally.',
        },
    ],
    next: ['points-labels', 'drag-to-edit', 'tangents-extrema'],
};

const SURFACES_3D: Guide = {
    id: 'surfaces-3d',
    title: 'Surfaces, planes and points in 3D',
    summary: 'Plot a surface z = f(x, y), fix the shape of the box, turn the view, and cut the surface with a plane on a slider.',
    category: '3D',
    level: 'core',
    minutes: 10,
    outcomes: [
        'Plot a surface and give its box a sensible shape',
        'Rotate, zoom and style a 3D chart',
        'Add a plane on a slider, a labelled point and a label that moves with the slider',
    ],
    requires: ['first-chart', 'sliders'],
    chart: saddleChart(7),
    steps: [
        {
            title: 'Switch to 3D and type a surface',
            body: paragraphs(
                'Open the editor on an empty chart and click 3D in the header. Type the formula into the Start a chart field and press Enter.',
                'The surface appears as a tall, narrow sail. That is correct: the editor fitted the box to the surface, z runs from about -27 to 27 while x and y only run from -5.5 to 5.5, and the box is drawn in true proportions.'
            ),
            type: [{ where: 'Start a chart', text: 'x^2 - y^2' }],
            chart: saddleChart(1),
            shot: { reveal: ['f1'], caption: 'The surface in a box with true proportions: tall and narrow.' },
            tip: 'A surface has its own x range and y range on its card (here `-5:5`). They say where the surface is computed. The box around it is set in the Chart tab under Ranges.',
        },
        {
            title: 'Make the box a cube',
            body: 'Open the Chart tab. Under 3D view, set Box to Cube. Every axis now has the same length on screen, and the saddle shows: the surface rises along x and falls along y.',
            chart: saddleChart(2),
            shot: { tab: 'chart', caption: 'Box set to Cube under 3D view in the Chart tab.' },
            tip: 'Proportional suits charts whose three ranges are similar, such as a sphere. Cube suits charts where z is on a different scale than x and y.',
        },
        {
            title: 'Turn the view',
            body: paragraphs(
                'Drag in the preview to rotate the chart. When the preview has the focus, the arrow keys turn it in steps of 5 degrees. The last three buttons of the action pill, in the corner of the preview, zoom in, zoom out and reset the zoom.',
                'For exact angles, use Elevation and Azimuth under 3D view in the Chart tab. This step uses an elevation of 20 and an azimuth of 60 degrees.'
            ),
            chart: saddleChart(3),
            shot: { frame: 'preview', caption: 'The same surface seen from elevation 20 and azimuth 60.' },
            tip: 'If dragging up and down feels the wrong way round, switch on Invert vertical drag in 3D in the plugin settings (Settings, Community plugins, Easy TikZ).',
        },
        {
            title: 'Style the surface',
            body: 'Go back to the Build tab. On the card f1, drag Opacity down to 50 % and Samples down to 24. The surface becomes more transparent and its mesh coarser, which leaves room for the things you add next. Wireframe in the Style row removes the faces and keeps only the mesh.',
            chart: saddleChart(4),
            shot: { reveal: ['f1'], caption: 'Opacity 50 % and 24 samples per axis on the surface card.' },
            tip: 'The exported LaTeX uses at most 60 samples per axis, because pdflatex runs out of memory above that. The hint under Samples says the same.',
        },
        {
            title: 'Cut it with a plane',
            body: paragraphs(
                'Click + Add and choose Plane. The card PL1 reads Plane z = 0. Replace the value with the name `h` and click Add slider h under the field.',
                'A horizontal plane cuts the saddle at z = 1. Drag h in the Sliders dock, or press its play button, and the plane moves up and down through the surface.'
            ),
            type: [{ where: 'PL1, Plane value', text: 'h' }],
            chart: saddleChart(5),
            shot: { reveal: ['PL1'], caption: 'The plane z = h, with h on a slider.' },
            tip: 'The x, y and z buttons on the card choose which coordinate the plane holds constant: x = h and y = h give vertical planes.',
        },
        {
            title: 'Mark a point and name it',
            body: 'Click + Add and choose Point. In the card P1, replace the sample point with the one below: three coordinates, `(x, y, z)`. Then click Custom in the Label row and type the name. A red marker sits on the saddle point, where the surface is flat.',
            type: [
                { where: 'P1, Points', text: '(0, 0, 0)' },
                { where: 'P1, Label text', text: 'saddle point' },
            ],
            chart: saddleChart(6),
            shot: { reveal: ['P1'], caption: 'A labelled point at the origin, the saddle point of the surface.' },
            tip: '+ Add also has Segment and Arrow for 3D. Their paths take `(x, y, z)` points too, for example `(0, 0, 0); (0, 0, 20)`.',
        },
        {
            title: 'Let a label ride on the plane',
            body: paragraphs(
                'Click + Add and choose Text label. In the card Label 1, type the text and the three positions below. In 3D a label has a z position as well.',
                'The x and y positions are a corner of the box, and the z position is the slider itself. So the label sits on a corner of the plane and shows its height. Drag h: the plane, the label and its number move together.'
            ),
            type: [
                { where: 'Label 1, Text', text: 'z = {h}' },
                { where: 'Label 1, Position x', text: '5.5' },
                { where: 'Label 1, Position y', text: '-5.5' },
                { where: 'Label 1, Position z', text: 'h' },
            ],
            chart: saddleChart(7),
            shot: { reveal: ['label:0'], caption: 'The label uses the slider h as its z position and in its text.' },
            tip: 'In 3D, dragging in the preview always rotates the view. Labels and shapes are moved by typing their coordinates.',
        },
    ],
    next: ['charts-in-notes', 'export-latex', 'level-curves'],
};

const CHARTS_IN_NOTES: Guide = {
    id: 'charts-in-notes',
    title: 'Charts in your notes',
    summary: 'Insert a chart into a note, play with its sliders there, set its width and alignment, and open it again to change it.',
    category: 'Notes and export',
    level: 'start',
    minutes: 8,
    outcomes: [
        'Insert a chart and open it again from the note',
        'Use the slider strip under a chart without changing the note',
        'Set the width and alignment of a chart in the note',
    ],
    requires: ['first-chart'],
    chart: noteChart(5),
    steps: [
        {
            title: 'Open a chart to insert',
            body: paragraphs(
                'Put the cursor in your note where the chart should go. Open the editor from the ribbon icon or with the command `Easy TikZ: Open editor`.',
                'Any chart works. This guide uses the example Tangent explorer, because it has a slider: click its tile under Or open an example.'
            ),
            chart: noteChart(1),
            shot: { caption: 'The Tangent explorer example in the editor, with its slider a in the Sliders dock.' },
            tip: 'Insert into note writes at the cursor of the active note. If no note is open, a notice says "No active note to insert into".',
        },
        {
            title: 'Insert it into the note',
            body: paragraphs(
                'Click Insert into note at the bottom right, or press Cmd+Enter (Ctrl+Enter on Windows and Linux). The editor closes and the chart appears in the note, with its slider underneath.',
                'In the file, the chart is a code block with the language `easy-tikz`: a few lines of text, one line per object, in words, such as `plot f1(x) = x^3 - 3x in blue, thick, with its tangent at a`. Put the cursor in the block to see them: the chart then sits right under the lines. Change a number there, and the chart glides to it.'
            ),
            shot: { frame: 'note', caption: 'The chart in the note, drawn by the plugin, with the slider strip under it.' },
            tip: 'The picture is drawn by the plugin itself. You need no LaTeX installation to see charts in your notes.',
        },
        {
            title: 'Move the slider in the note',
            body: paragraphs(
                'Drag the slider a under the chart, or type a value into the box next to it. The tangent slides along the curve and the title above the chart shows its slope.',
                'This changes the picture for the current session only. Nothing is written to the note. The round arrow at the end of the strip (Reset sliders to the saved values) goes back to what the note stores.'
            ),
            shot: { frame: 'note', actions: [{ slider: ['a', -1.2] }], caption: 'The slider strip under the chart. Moving a slides the tangent along the curve.' },
            tip: 'A chart with more than three sliders shows three rows and a link Show 2 more (or however many are left).',
        },
        {
            title: 'Resize and align the chart',
            body: 'Move the pointer over the chart. Three buttons appear at its left edge (Align left, Center, Align right) and a width slider at the bottom. Drag the width slider to the left to make the chart narrower, then click Align left.',
            chart: noteChart(4),
            shot: { frame: 'note', actions: [{ hover: [0, 0] }], caption: 'The chart at 420 px, aligned left. The controls show while the pointer is over the chart.' },
            tip: 'Width and alignment are the only things these controls write into the note (as the lines `set displayWidth = 420` and `set displayAlign = "left"` of the block). In a callout or a `~~~` fence the block cannot be found, and a notice says the change was not saved.',
        },
        {
            title: 'Click the chart to edit it',
            body: paragraphs(
                'Click the chart, or move the focus to it and press Enter. The editor opens with every setting filled in, and the button at the bottom right now reads Save changes.',
                'In the Sliders dock, drag a to 1.5 and click Save changes. The block in the note is replaced. From now on 1.5 is the value the chart starts with and the value the reset button returns to.'
            ),
            chart: noteChart(5),
            shot: { frame: 'note', caption: 'After Save changes the note shows the tangent at the new saved value a = 1.5.' },
            tip: 'Closed the editor by accident? The chart is kept as a draft. Open the editor from the same chart again and it offers Unsaved changes with Restore and Discard.',
        },
        {
            title: 'Choose what the note shows',
            body: paragraphs(
                'Open the chart again and go to the Chart tab. In the group In your note, switch off Show sliders in note and click Save changes. The chart stays, the slider strip is gone.',
                'Preview size in the same group sets how large the chart is drawn, as its longest side in pixels. A width you set in the note takes over from it.'
            ),
            chart: noteChart(6),
            shot: { frame: 'note', caption: 'The same chart without the slider strip.' },
            tip: 'If part of a chart cannot be drawn, a muted line under it names the problem. The rest of the chart still shows.',
        },
        {
            title: 'Copy a chart to another note',
            body: 'A chart is its code block and nothing else. In source mode, select the whole block, from the line that opens the `easy-tikz` block to the three backticks that close it, copy it and paste it into any note. Each copy is a chart of its own.',
            shot: { frame: 'none' },
            tip: 'You can edit the lines by hand. A mistake shows under the chart with its line and column, such as Line 4, column 9: unknown option, and the rest of the chart still draws.',
        },
    ],
    next: ['export-latex', 'sliders', 'shortcuts'],
};

const EXPORT_LATEX: Guide = {
    id: 'export-latex',
    title: 'Export to LaTeX',
    summary: 'Get pgfplots code that compiles with pdflatex: as a standalone document or as a snippet, at the size you need, in the colours of the preview.',
    category: 'Notes and export',
    level: 'core',
    minutes: 10,
    outcomes: [
        'Copy a complete document or a snippet for your own preamble',
        'Set the size of the figure and understand the size of its text',
        'Know which parts are formulas and which are frozen coordinates',
    ],
    requires: ['first-chart'],
    chart: exportChart(6),
    steps: [
        {
            title: 'Open the Code tab',
            body: paragraphs(
                'Open the editor and load the example Areas between two curves: click its tile under Or open an example, or pick it from the ... menu in the header. Then click the Code tab.',
                'The tab shows the LaTeX for the chart as a complete document. It starts with `\\documentclass[border=5pt]{standalone}`, loads `pgfplots`, and ends with `\\end{document}`.'
            ),
            chart: exportChart(1),
            shot: { tab: 'code', caption: 'The Code tab with Standalone document switched on: a complete LaTeX file.' },
            tip: 'The Code tab always shows fresh code for the chart as it is now. The one exception is code you typed in yourself (see the last step).',
        },
        {
            title: 'Copy and compile it',
            body: paragraphs(
                'Click Copy in the Code tab. Copy TikZ in the bar at the bottom does the same from any tab. Paste the code into a new file, for example `chart.tex`, and run `pdflatex chart.tex`.',
                'The result is a PDF that is cropped to the picture, with a border of 5 pt. Include it in other documents with `\\includegraphics`.'
            ),
            shot: { frame: 'none' },
            tip: 'Compiling needs a TeX installation with pgfplots (TeX Live and MiKTeX include it). Charts in your notes do not need one.',
        },
        {
            title: 'Switch to a snippet',
            body: paragraphs(
                'To put the figure straight into your own document, switch off Standalone document in the Code tab. The code is now only the `tikzpicture`.',
                'Its first lines start with `% Needs:` and list what your preamble must load: `\\usepackage{pgfplots}` and `\\pgfplotsset{compat=1.16}`.'
            ),
            chart: exportChart(3),
            shot: { tab: 'code', caption: 'Standalone document off: only the tikzpicture, with the needed packages as comments.' },
            tip: 'A patterned fill or a brace needs a TikZ library as well (`patterns`, `decorations.pathreplacing`). It is listed in the same `% Needs:` lines, so copy all of them into your preamble.',
        },
        {
            title: 'Set the size on paper',
            body: paragraphs(
                'Switch Standalone document back on, then open the Chart tab. Under Export size, drag Width from 12 cm to 8 cm. Height stays at 6 cm. The two set the width and height of the figure in the PDF.',
                'The preview takes the same shape, and its text is drawn at the size it has in the PDF, so you can judge the result before you compile.'
            ),
            chart: exportChart(4),
            shot: { tab: 'chart', caption: 'Export size set to 8 by 6 cm. The preview follows the new proportions.' },
            tip: 'Text keeps its size in points when the figure shrinks, so a small figure has relatively large labels. If labels crowd each other, make the figure larger.',
        },
        {
            title: 'Check colours and label text',
            body: paragraphs(
                'Colours: every palette colour the chart uses is defined inside the picture, for example `\\definecolor{etBlue}{HTML}{3498DB}`, so the PDF shows the blue of the preview and not the blue of xcolor. The first swatch, Auto, follows your theme in Obsidian and exports as black.',
                'Text: labels are escaped for LaTeX, so `50%` or `x_1` print as typed, and text between dollar signs is math. Try it in the Build tab: open R1 and R2 and change their labels as below. The sizes S, M and L of a text label are `\\footnotesize`, `\\small` and `\\large`.'
            ),
            type: [
                { where: 'R1, Label', text: '$A_1$' },
                { where: 'R2, Label', text: '$A_2$' },
            ],
            chart: exportChart(5),
            shot: { reveal: ['R1'], caption: 'Region labels written as math between dollar signs.' },
            tip: 'In a label, `{` and `}` mark a placeholder such as `{a}`. Braces right after `^`, `_` or a LaTeX command stay LaTeX, as in `$x^{2}$`. For any other LaTeX brace, type `{{` and `}}`.',
        },
        {
            title: 'See what is frozen',
            body: paragraphs(
                'In the card f1, change the formula as below and click Add slider a. Drag a to 1.5 and look at the Code tab again.',
                'Functions are exported as formulas, with the current value of every slider written in: the line for f1 now plots `1.5*sin(x)`. Regions, curves from equations, points, segments and braces are computed by the plugin and exported as coordinates. They match the preview exactly, but they do not recompute when you edit the LaTeX.'
            ),
            type: [{ where: 'f1, y =', text: 'a sin(x)' }],
            chart: exportChart(6),
            shot: { tab: 'code', caption: 'The value of the slider is written into the code.' },
            tip: 'The LaTeX is a snapshot. After you move a slider or change a formula, copy the code again. The legend still shows the formula as typed, with the letter a.',
        },
        {
            title: 'Edit by hand or regenerate',
            body: paragraphs(
                'You can type in the Code tab. A banner then says "Edited by hand. Chart changes are not applied here." Copy now copies your edited text.',
                'Regenerate throws your edits away and writes fresh code. Keep edits hides the banner and keeps your text. Insert into note always saves the chart settings, never this text.'
            ),
            shot: { frame: 'none' },
            tip: 'Keep lasting hand edits in your `.tex` file, not in the editor. They are gone as soon as you press Regenerate.',
        },
    ],
    next: ['charts-in-notes', 'from-3x', 'shortcuts'],
};

const FROM_3X: Guide = {
    id: 'from-3x',
    title: 'Coming from 3.x',
    summary: 'What happens to your old charts, where the eight tabs went, and which new tool replaces each old one.',
    category: 'Reference',
    level: 'core',
    minutes: 8,
    outcomes: [
        'Open and save 3.x charts without surprises',
        'Find every old tab and tool in the new editor',
        'Know the breaking changes before you save',
    ],
    chart: migratedChart(5),
    steps: [
        {
            title: 'Open an old chart',
            body: paragraphs(
                'Click a chart you made with 3.x. It opens in the new editor and looks as it did before. The conversion happens in memory: the note is not touched until you click Save changes.',
                'The chart of this guide is a typical 3.x picture after conversion: two functions with the area between them, their intersections, a vertical and a horizontal line, a circle, a rectangle, an arrow, a brace and a text label.'
            ),
            chart: migratedChart(1),
            shot: { caption: 'A 3.x chart in the version 4 editor. Every old tool is a card in the Build tab.' },
            tip: 'Charts you only look at are never rewritten. A chart saved with version 4 carries `"v": 4`, and 3.19 can no longer draw it.',
        },
        {
            title: 'Find your old tabs',
            body: paragraphs(
                'The eight tabs of 3.x are now four: Build, Chart, Code and Help.',
                list(
                    'Functions, Tools and Annotations are the cards of the Build tab. An annotation is now called a text label.',
                    'Axis and Grid are groups of the Chart tab: Ranges, Axes and Grid.',
                    'Graph is split up. Title, width and height, preview size and the 3D angles are in the Chart tab. 3D mode and the coordinate system are the two switches in the header.',
                    'Code is still Code. The old Use pgfplots switch is now Standalone document in that tab.',
                    'Reference is now Help.'
                )
            ),
            shot: { tab: 'chart', caption: 'The Chart tab holds what the Graph, Axis and Grid tabs held in 3.x.' },
            tip: 'Sliders are new and have their own place: the Sliders dock. It appears under the preview as soon as a chart has a slider and stays there in every tab.',
        },
        {
            title: 'Read the converted tools',
            body: paragraphs(
                'Eleven special tools became five general ones. Each old tool is now a card with a formula you can read and change. The rows below are what the tools of this chart turned into.',
                list(
                    'Area between two curves is a Region. The interval is a second condition.',
                    'Intersection points is a Points card with Intersections selected.',
                    'Vertical line and Horizontal line are Curves with the equations `x = c` and `y = c`.',
                    'Circle is a Curve. A filled circle is a Region with `<=` in place of `=`.',
                    'Rectangle is a Region with one condition for x and one for y.',
                    'Line segment and Brace with label are Segments with a Path. In 3D, the point marker is a Points card and the plane is still a Plane.'
                )
            ),
            type: [
                { where: 'R1, condition 1', text: 'min(f1, f2) <= y <= max(f1, f2)' },
                { where: 'R1, condition 2', text: '0 <= x <= 4' },
                { where: 'C1, Equation', text: 'x = 4' },
                { where: 'C3, Equation', text: '(x - 4)^2 + (y - 4)^2 = 0.4^2' },
                { where: 'R2, condition 1', text: '0 <= x <= 4' },
                { where: 'S1, Path', text: '(2.6, 4.8); (2.2, 2.4)' },
            ],
            shot: { reveal: ['R1'], caption: 'The old area between two curves is the region R1 with two conditions.' },
            tip: 'You rarely pick a tool by name. + Add lists the old tools in plain words (Area between two functions, Vertical line x = c, Circle, Rectangle, Brace with label) and fills in the card for you.',
        },
        {
            title: 'Show the functions 3.x skipped',
            body: paragraphs(
                'Version 3 did not draw a function whose Domain was empty. Version 4 reads an empty domain as the visible x range, so such a function would suddenly appear in your picture. To prevent that, it is converted as hidden: the card f3 is dimmed and its eye is crossed out.',
                'Click the eye on f3 to show it. The dashed line y = x appears, the mirror line between the two curves.'
            ),
            chart: migratedChart(4),
            shot: { reveal: ['f3'], caption: 'The function f3 was hidden by the conversion. Its eye button shows it.' },
            tip: 'A hidden function still works by name. Other formulas can use `f3(2)` or `y <= f3` whether it is drawn or not.',
        },
        {
            title: 'Trade a number for a slider',
            body: paragraphs(
                'This is what the general tools are for. On the card R1, change the second condition from `0 <= x <= 4` to the one below, click Add slider a under the field and drag a to 3.',
                'The shaded area now ends at x = a and grows and shrinks with the slider. Any number in any field can become a slider in the same way.'
            ),
            type: [{ where: 'R1, condition 2', text: '0 <= x <= a' }],
            chart: migratedChart(5),
            shot: { reveal: ['R1'], caption: 'The right end of the area is now the slider a.' },
            tip: 'You can also drag shapes in the preview now. Drag the dashed line at x = 4 and the number in its equation follows.',
        },
        {
            title: 'Know what Save changes does',
            body: paragraphs(
                'Save changes writes the block in the version 4 format. Before you save an old chart, know what is different:',
                list(
                    'Version 3 cannot read the saved block. Keep 3.x charts unsaved if you still open the vault with 3.x somewhere.',
                    'Label text is a template: `{` and `}` mark placeholders such as `{a}`. Converted labels are escaped for you. In new labels type `{{` and `}}` for a LaTeX group.',
                    '`ax` is one name. Write `a x` or `a*x` for a product. `1/2x` means `(1/2)*x`.',
                    'The exported LaTeX has a different shape: a complete standalone document, trigonometry in radians, shapes as coordinates and colours named `etBlue`, `etRed` and so on.'
                )
            ),
            shot: { frame: 'none' },
            tip: 'If you post-process exported code with your own scripts or macros, compile one chart again and compare before you rely on it.',
        },
    ],
    next: ['first-chart', 'regions', 'export-latex'],
};

const SHORTCUTS: Guide = {
    id: 'shortcuts',
    title: 'Keyboard, mouse and troubleshooting',
    summary: 'Every shortcut of the editor, what the mouse does in the preview, and fixes for the usual problems.',
    category: 'Reference',
    level: 'start',
    minutes: 7,
    outcomes: [
        'Insert, undo and move around without the mouse',
        'Pan, zoom and edit shapes in the preview on purpose',
        'Recognise and fix the most common problems',
    ],
    chart: lpChart(1),
    steps: [
        {
            title: 'Insert, save and close',
            body: paragraphs(
                'These work anywhere in the editor. The pictures of this guide use the example Linear program.',
                list(
                    'Cmd+Enter (Ctrl+Enter on Windows and Linux): Insert into note, or Save changes for a chart you opened from a note.',
                    'Escape: cancel a drag in the preview or clear the selection, close an open menu or popover, otherwise close the editor.',
                    'A chart you close without inserting is kept as a draft. The next time the editor opens, it offers Unsaved chart with Restore and Discard. Drafts older than 7 days are ignored.'
                )
            ),
            chart: lpChart(1),
            shot: { caption: 'The editor with the Linear program example: cards on the left, preview and Sliders dock on the right.' },
            tip: 'The button at the bottom right shows which of the two the shortcut does: Insert into note for a new chart, Save changes for a chart opened from a note.',
        },
        {
            title: 'Undo and redo',
            body: paragraphs(
                list(
                    'Cmd+Z (Ctrl+Z) undoes the last drag, arrow-key move, slider change or deleted card. Cmd+Shift+Z (Ctrl+Shift+Z) redoes a drag, a move or a slider change. The editor remembers up to 50 steps while the chart stays open.',
                    'Inside a text field the same keys undo your typing.',
                    'After a drag or a delete, a bar at the bottom of the editor names the step and offers Undo for 6 seconds.'
                ),
                'Example: hold Shift and drag constraint line (2) upwards at the y-axis, from (0, 2) to (0, 2.5). It turns around the corner (3, 1), its condition becomes `x + 2y <= 5`, and the bar reads Turned R1 (2). Cmd or Ctrl+Z puts `x + 3y <= 6` back.'
            ),
            chart: lpChart(2),
            shot: { reveal: ['R1'], caption: 'Constraint (2) after the Shift-drag: its condition now reads x + 2y <= 5.' },
            tip: 'An undo never overwrites a later edit. It restores what still holds the dragged value and says what it left alone.',
        },
        {
            title: 'Pan and zoom the preview',
            body: list(
                'Drag empty space to pan. Scroll, or pinch on a trackpad, to zoom around the pointer.',
                'With the preview focused and nothing selected, the arrow keys pan by a twentieth of the view.',
                'The action pill at the bottom of the preview has Fit ranges to the functions, Reset ranges, Major grid and Lock pan and zoom.',
                'A range written as a formula, such as `2a`, is left alone by pan and zoom. Change it in the Chart tab under Ranges.'
            ),
            chart: lpChart(3),
            shot: { frame: 'preview', caption: 'Zoomed in on the optimum of the linear program.' },
            tip: 'Lost the picture? Reset ranges goes back to the default view, x from -0.5 to 10 and y from -0.5 to 5.',
        },
        {
            title: 'Move a shape with the arrow keys',
            body: paragraphs(
                list(
                    'Click a shape in the preview to select it. Its card flashes in the Build tab.',
                    'The arrow keys move it by about a tenth of a grid step. Hold Shift for ten times as far, Alt (Option on macOS) for a tenth.',
                    'Enter, or a double-click on the shape, opens its field with the first number a move would change selected.',
                    'Escape clears the selection.'
                ),
                'Example: click the red objective line, hold Shift and press the Down arrow twice. The line slides towards the origin, and because its equation is `2x + 3y = c`, it is the slider c that changes: from 9 down to 6. Without Shift a press moves c by about 0.15.'
            ),
            chart: lpChart(4),
            shot: { actions: [{ hover: [1.5, 1] }], caption: 'The objective line moved down with the arrow keys. The slider c reads 6.' },
            tip: 'Presses within one second count as one undo step.',
        },
        {
            title: 'Drag with Shift, Alt and Space',
            body: paragraphs(
                list(
                    'Drag a line, curve, point or label: it moves, and its numbers follow.',
                    'Shift-drag: a line turns, a curve stretches and a circle resizes around the mark ⊕. Points and labels move straight.',
                    'Alt (Option on macOS): fine control, without snapping and without rounding to round numbers.',
                    'Space held, or the middle mouse button: pan, even when the pointer is on a shape.',
                    'Escape during a drag cancels it and puts every number back.'
                ),
                'Example: drag constraint line (1) towards the origin until its condition reads `x + y <= 3`. The region, its corners and the optimum follow.'
            ),
            chart: lpChart(5),
            shot: {
                actions: [{ hover: [3.6, 0.8], shift: true }],
                caption: 'Shift held over constraint (2): the tip shows which numbers would change, and ⊕ marks the point the line would turn around.',
            },
            tip: 'The pointer button Edit shapes by dragging in the action pill switches all of this off. The preview then pans wherever you drag, and only text labels still move.',
        },
        {
            title: 'Move through tabs, cards and fields',
            body: list(
                'Tab bar focused: Left and Right switch tabs, Home and End jump to the first and last tab.',
                'Alt+Up and Alt+Down move the card that has the focus up or down in its list (with the focus outside a text field).',
                'Number field: Up and Down change the value by one step, with Shift by ten steps, with Alt by a tenth.',
                'Focused slider: the arrow keys move it by one step, Home and End jump to its ends.',
                'Enter applies a name or a number you typed. In the last condition of a region, Enter starts the next row.',
                '3D preview focused: the arrow keys rotate the view by 5 degrees.'
            ),
            shot: { tab: 'chart', caption: 'The Chart tab. Left and Right on the tab bar switch between Build, Chart, Code and Help.' },
            tip: 'Tab and Shift+Tab reach every control. Enter or Space on the summary line of a card folds or unfolds it.',
        },
        {
            title: 'Fix the usual problems',
            body: list(
                'Unknown name ax: `ax` is one name. Click the fix under the field (Use a*x), or type `a x`.',
                'A dot on a tab, or a chip at the top left of the preview: something is wrong. Click the chip to jump to the field. The rest of the chart still draws.',
                'The picture is empty or cut off: click Reset ranges or Fit ranges to the functions in the action pill, and check the Domain of the function.',
                'A drag pans when it should move a shape: switch on Edit shapes by dragging in the action pill. A drag moves a shape when it should pan: hold Space.',
                'A point will not move: it is computed (an optimum, a corner, an intersection). Drag the lines that define it.',
                'A chart in a note does not keep its width: it sits in a callout or a `~~~` fence, where the block cannot be found.'
            ),
            shot: { frame: 'none' },
            tip: 'A problem appears under its field after a short pause, often with a button that fixes it in one click: Add slider k, Use a*x, Use sin.',
        },
    ],
    next: ['drag-to-edit', 'formulas', 'from-3x'],
};

/** Guides of this group (see the list in docs/guides/README.md). */
export const MORE_GUIDES: Guide[] = [POINTS_LABELS, ARROWS_BRACES, SURFACES_3D, CHARTS_IN_NOTES, EXPORT_LATEX, FROM_3X, SHORTCUTS];
