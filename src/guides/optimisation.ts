/*
 * Guides of the category "Regions and optimisation": regions, areas between
 * curves, the area between a curve and its tangent, linear and integer
 * programs, level curves and market equilibrium.
 *
 * Every step chart is the state the editor is in after the reader did what
 * the step says, starting from a new chart: the same recipes (+ Add), the
 * same defaults (colours, names, sizes) and the same list order (Find
 * optimum and Mark corners insert right after their region, + Add appends).
 * Charts are built from the defaults in src/migrate.ts so every key is
 * present, and each one is a deep copy: no two steps share an object.
 */
import { SCHEMA_VERSION, defaultFunction, defaultParameter, defaultTool } from '../migrate';
import type { Annotation, CurveTool, FunctionParameters, Parameter, PointsTool, RegionTool, Tool } from '../types';
import type { ChartData, Guide } from './types';

// ------------------------------------------------------------------ builders

/** Label templates the Points card writes for "Coordinates", and Mark corners for its corner points. */
const COORDINATES = '({x:2}, {y:2})';
const CORNER_COORDINATES = '({x}, {y})';

const NO_ITEMS: { is3D: boolean; tools: Tool[]; functions: FunctionParameters[] } = { is3D: false, tools: [], functions: [] };

/** A new chart as the editor creates it (the SettingsManager defaults), with overrides. Always a deep copy. */
function chart(overrides: Record<string, unknown>): ChartData {
    const data: ChartData = {
        v: SCHEMA_VERSION,
        dimension: false,
        documentSetup: true,
        title: '',
        size_x_cm: 10,
        size_y_cm: 10,
        show_axis_label: true,
        axis_label_x: 'x',
        axis_label_y: 'y',
        showAxis: true,
        showLargeGrid: false,
        showSmallGrid: false,
        gridSize: 5,
        majorTickNum: 8,
        xmin: '-0.5',
        xmax: '10',
        ymin: '-0.5',
        ymax: '5',
        zmin: '-5',
        zmax: '5',
        axis_style: 'box',
        coordinateSystem: 'cartesian',
        axis_label_x_polar: '',
        axis_label_y_polar: '',
        axis_label_z: 'z',
        rotationX: 30,
        rotationZ: 45,
        zoom3D: 1,
        boxAspect: 'true',
        previewSize: 760,
        functions: [],
        functions3D: [],
        tools: [],
        annotations: [],
        parameters: [],
        variables: 'x, y',
        equalScale: false,
        showSlidersInNote: true,
        ...overrides,
    };
    return JSON.parse(JSON.stringify(data)) as ChartData;
}

/** A function card as + Add creates it: thin line, no options. The first function is black, the second blue. */
function fn(name: string, expression: string, color: string): FunctionParameters {
    return { ...defaultFunction([]), name, expression, color };
}

/** A region card (blue, filled at 25 %, no outline), one label slot per condition. */
function region(id: string, name: string, conditions: string[], fields: Partial<RegionTool> = {}): RegionTool {
    const base = defaultTool('region', NO_ITEMS) as RegionTool;
    return { ...base, id, name, conditions, conditionLabels: conditions.map(() => ''), ...fields };
}

/** The recipe "Feasible region (inequalities)": a region with its constraint lines switched on. */
function feasibleRegion(id: string, name: string, conditions: string[], fields: Partial<RegionTool> = {}): RegionTool {
    return region(id, name, conditions, { constraintLines: true, ...fields });
}

function curve(id: string, name: string, equation: string, fields: Partial<CurveTool> = {}): CurveTool {
    const base = defaultTool('curve', NO_ITEMS) as CurveTool;
    return { ...base, id, name, equation, ...fields };
}

function points(id: string, name: string, fields: Partial<PointsTool>): PointsTool {
    const base = defaultTool('points', NO_ITEMS) as PointsTool;
    return { ...base, id, name, ...fields };
}

/** What Find optimum on a region card adds (the reader then types the objective). */
function optimum(id: string, name: string, regionName: string, objective: string, fields: Partial<PointsTool> = {}): PointsTool {
    return points(id, name, { source: 'region', regionName, objective, sense: 'max', label: COORDINATES, size: 'large', ...fields });
}

/** The recipe "Intersections of two functions". */
function crossings(id: string, name: string, ref1: string, ref2: string, fields: Partial<PointsTool> = {}): PointsTool {
    return points(id, name, { source: 'intersections', ref1, ref2, label: COORDINATES, ...fields });
}

/** A slider as the "Add slider" fix creates it (1, from -10 to 10, step 0.1), moved to `value`. */
function slider(name: string, value: number): Parameter {
    return { ...defaultParameter([], name), value };
}

function textLabel(x: string, y: string, text: string): Annotation {
    return { x, y, text, color: 'black', size: 'normal', anchor: 'center' };
}

/** The chart of a last step: equal to the finished chart, but its own copy. */
function copyOf(finished: ChartData): ChartData {
    return JSON.parse(JSON.stringify(finished)) as ChartData;
}

// ------------------------------------------------------------------ regions

function regionsGuide(): Guide {
    const start = ['x >= 0', 'y >= 0', ''];
    const triangle = ['x >= 0', 'y >= 0', 'x + 2y <= 8'];
    const band = ['1 <= x <= 6', 'y >= 0', 'x + 2y <= 8'];
    const shape = [...band, 'x <= 3 or y <= 1'];
    const numbers = ['(1)', '(2)', '(3)', '(4)'];
    const finished = chart({
        tools: [feasibleRegion('t0', 'R1', shape, { conditionLabels: numbers, label: 'S', constraintLines: false, outline: 'solid' })],
    });
    return {
        id: 'regions',
        title: 'Shade a region with inequalities',
        summary: 'Shade the set where inequalities hold: one condition per row, chains, alternatives with or, and labels for the rows and the region.',
        category: 'Regions and optimisation',
        level: 'core',
        minutes: 6,
        outcomes: [
            'Shade the set of points where several inequalities hold at once',
            'Write a range as a chain and join alternatives with or',
            'Label the conditions and the region, and choose between constraint lines and an outline',
        ],
        requires: ['first-chart'],
        chart: finished,
        steps: [
            {
                title: 'Add a feasible region',
                body:
                    'Start with a new chart. Click + Add and choose Feasible region (inequalities) in the group Regions.\n\n' +
                    'A card named R1 appears under Shapes and marks. It has two rows, `x >= 0` and `y >= 0`, and an empty third row. ' +
                    'The preview shades every point where both rows hold: everything to the right of the line x = 0 and above the line y = 0.\n\n' +
                    'A region is one card. Each row is one condition, and a point is shaded only when every row holds.',
                chart: chart({ tools: [feasibleRegion('t0', 'R1', start)] }),
                shot: {
                    actions: [{ menu: 'add' }],
                    caption: 'The + Add menu of a new chart lists the recipes by group. Feasible region (inequalities) starts a region with two rows filled in.',
                },
                tip: 'A region is computed inside the visible ranges only. If nothing is shaded, check Chart > Ranges first.',
            },
            {
                title: 'Type a third inequality',
                body:
                    'Click the empty third row and type the condition below.\n\n' +
                    'The shaded set shrinks to the triangle under the line x + 2y = 8. The line itself runs across the whole view, ' +
                    'because the chip Constraint lines is on.\n\n' +
                    'You write a condition the way you would on paper: `2y` means 2 times y, and less than or equal is typed as `<=`.',
                type: [{ where: 'R1, condition 3', text: 'x + 2y <= 8' }],
                chart: chart({ tools: [feasibleRegion('t0', 'R1', triangle)] }),
                shot: {
                    reveal: ['R1'],
                    actions: [{ focus: ['R1', 'condition:2'] }],
                    caption: 'Three rows, one triangle. Every row cuts a piece off the plane.',
                },
                tip: 'Use `<=` and `>=` in a region. A single `=` is not a condition: to draw the line itself, use + Add > Line from an equation.',
            },
            {
                title: 'Write a range as a chain',
                body:
                    'Replace the first row, `x >= 0`, with the chain below.\n\n' +
                    'A chain means that both comparisons hold, so the region is now limited on the left and on the right: ' +
                    'it lies between x = 1 and x = 6. The preview draws two vertical constraint lines for this one row.',
                type: [{ where: 'R1, condition 1', text: '1 <= x <= 6' }],
                chart: chart({ tools: [feasibleRegion('t0', 'R1', band)] }),
                shot: {
                    reveal: ['R1'],
                    actions: [{ focus: ['R1', 'condition:0'] }],
                    caption: 'One row, two bounds: the chain 1 <= x <= 6 replaces two separate rows.',
                },
                tip: 'Both ends of a chain can be formulas, for example `0 <= y <= 4 - x/2`.',
            },
            {
                title: 'Join two alternatives with or',
                body:
                    'Press Enter in the last row (or click Add condition) and type the condition below into the new row.\n\n' +
                    'A row with `or` holds when at least one side holds. The region keeps its tall part to the left of x = 3 and ' +
                    'the low strip under y = 1, and loses the corner above and to the right of both. The result is an L shape: ' +
                    'a dent that straight-line conditions joined with and can never make.',
                type: [{ where: 'R1, condition 4', text: 'x <= 3 or y <= 1' }],
                chart: chart({ tools: [feasibleRegion('t0', 'R1', shape)] }),
                shot: {
                    reveal: ['R1'],
                    actions: [{ focus: ['R1', 'condition:3'] }],
                    caption: 'The fourth row allows either side: left of x = 3 or below y = 1.',
                },
                tip: 'Rows are always joined with and. Write `or` inside one row: two separate rows can never mean or.',
            },
            {
                title: 'Number the conditions',
                body:
                    'Click Number them (1), (2), ... under the rows.\n\n' +
                    'Each row gets its number in the small Label box next to it, and the preview prints the number at the end of the ' +
                    "row's constraint line. Now a text can refer to condition (3) and the reader finds it in the picture.\n\n" +
                    'Instead of a number you can type any text into a Label box, for example `budget`.',
                chart: chart({ tools: [feasibleRegion('t0', 'R1', shape, { conditionLabels: numbers })] }),
                shot: {
                    reveal: ['R1'],
                    actions: [{ focus: ['R1', 'conditionLabel:0'] }],
                    caption: 'Every row has a Label box. Its text is printed on the constraint line of that row.',
                },
                tip: 'The link appears as soon as two rows are filled in. It overwrites the Label boxes, so number first and rename afterwards.',
            },
            {
                title: 'Name the region',
                body:
                    'Type a name into the field Label of the card, below Outline.\n\n' +
                    'The name is printed in bold at the visual centre of the shaded area. It moves with the region whenever a condition changes, ' +
                    'so you never have to place it by hand.',
                type: [{ where: 'R1, Label', text: 'S' }],
                chart: chart({ tools: [feasibleRegion('t0', 'R1', shape, { conditionLabels: numbers, label: 'S' })] }),
                shot: {
                    reveal: ['R1'],
                    actions: [{ focus: ['R1', 'label'] }],
                    caption: 'The region label sits inside the shape and follows it.',
                },
                tip: 'Text between dollar signs is typeset as math: `$S_1$` prints S with a subscript 1.',
            },
            {
                title: 'Swap constraint lines for an outline',
                body:
                    'Click the chip Constraint lines to switch it off, then set Outline to Solid.\n\n' +
                    "The full-length lines disappear and only the region's own boundary is drawn. The numbers move to the edges they belong to.\n\n" +
                    'Use constraint lines when the picture is about the inequalities, as in a linear program. Use an outline when it is about the shape.',
                chart: copyOf(finished),
                shot: {
                    reveal: ['R1'],
                    caption: 'The same region with an outline instead of constraint lines.',
                },
                tip: 'To show the boundary without shading, switch the chip Fill off and keep the outline.',
            },
        ],
        next: ['areas-between', 'linear-program', 'points-labels'],
    };
}

// ------------------------------------------------------------ areas between

function areasBetweenGuide(): Guide {
    // The view the editor fits to the first formula typed into "Start a chart".
    const view = { xmin: '-1.025', xmax: '10.525', ymin: '0.902', ymax: '3.099' };
    const f1 = fn('f1', '2 + sin(x)', 'black');
    const f2 = fn('f2', '2 + cos(x)', 'blue');
    const above = 'f2 <= y <= f1';
    const below = 'f1 <= y <= f2';
    const first = 'P1_x <= x <= P1_x2';
    const second = 'P1_x2 <= x <= P1_x3';
    // Numbered crossings: the coordinate labels the recipe starts with do not fit between the two waves.
    const p1 = crossings('t2', 'P1', 'f1', 'f2', { label: '{i}' });
    const finished = chart({
        ...view,
        functions: [f1, f2],
        tools: [region('t0', 'R1', [above, first], { label: 'A1' }), region('t1', 'R2', [below, second], { color: 'orange', label: 'A2' }), p1],
    });
    return {
        id: 'areas-between',
        title: 'Shade the areas between two curves',
        summary: 'Two curves, the areas between them in two colours, and their crossing points as the limits of the shading.',
        category: 'Regions and optimisation',
        level: 'core',
        minutes: 7,
        outcomes: [
            'Shade the area where one function lies above another',
            'Give each area its own colour and label',
            'Mark the crossing points and use them as limits',
        ],
        requires: ['first-chart'],
        chart: finished,
        steps: [
            {
                title: 'Type the first curve',
                body:
                    'Start with a new chart. The Build tab shows Start a chart. Click its formula field if the cursor is not in it yet, ' +
                    'type the formula below and press Enter.\n\n' +
                    'A card f1 appears under Functions and the preview draws the wave. The ranges fit themselves to the curve, ' +
                    'because they were still the defaults.',
                type: [{ where: 'Start a chart', text: '2 + sin(x)' }],
                chart: chart({ ...view, functions: [f1] }),
                shot: {
                    reveal: ['f1'],
                    caption: 'The first formula becomes the function f1, and the view fits it.',
                },
                tip: 'Functions need brackets: write `sin(x)`, not `sin x`.',
            },
            {
                title: 'Add the second curve',
                body:
                    'Click + Add and choose Function y = f(x). Type the formula below into the new card f2. It gets the next free colour, blue.\n\n' +
                    'The two curves cross several times. Between two crossings one of them is on top, and those are the pieces the next steps shade.',
                type: [{ where: 'f2, y =', text: '2 + cos(x)' }],
                chart: chart({ ...view, functions: [f1, f2] }),
                shot: {
                    reveal: ['f2'],
                    actions: [{ focus: ['f2', 'expression'] }],
                    caption: 'Two functions with the names f1 and f2. The names are what regions refer to.',
                },
                tip: 'Click the name badge on a card to rename a function. Every formula that uses the name is updated.',
            },
            {
                title: 'Shade where f1 is on top',
                body:
                    'Click + Add and choose Area between two functions. The new card R1 already holds the condition `f2 <= y <= f1`, ' +
                    'built from your first two functions.\n\n' +
                    'Read it as: y is at least f2 and at most f1. That is only possible where f1 lies above f2, so the preview shades exactly those pieces. ' +
                    'A function name without brackets stands for its value at the current x.',
                chart: chart({ ...view, functions: [f1, f2], tools: [region('t0', 'R1', [above])] }),
                shot: {
                    reveal: ['R1'],
                    actions: [{ focus: ['R1', 'condition:0'] }],
                    caption: 'One condition shades every piece where the black curve lies above the blue one.',
                },
                tip: 'The order matters: `f2 <= y <= f1` shades nothing where f2 is on top. For both sides at once, write `min(f1, f2) <= y <= max(f1, f2)`.',
            },
            {
                title: 'Shade the other side in orange',
                body:
                    'Add a second Area between two functions in the same way. The card R2 gets the next colour, orange, and the same condition. ' +
                    'Swap the two names so that it reads as below.\n\n' +
                    'Now the pieces where f2 is on top are shaded too, in their own colour. Two regions, one per sign, are the usual way to show ' +
                    'that the areas count with opposite signs in an integral.',
                type: [{ where: 'R2, condition 1', text: below }],
                chart: chart({ ...view, functions: [f1, f2], tools: [region('t0', 'R1', [above]), region('t1', 'R2', [below], { color: 'orange' })] }),
                shot: {
                    reveal: ['R2'],
                    actions: [{ focus: ['R2', 'condition:0'] }],
                    caption: 'A second region with the names swapped shades the remaining pieces.',
                },
                tip: 'New regions take the next free colour by themselves. Click the colour swatch on a card to choose another one.',
            },
            {
                title: 'Mark the crossings',
                body:
                    'Click + Add and choose Intersections of two functions. The card P1 picks f1 and f2 by itself, marks every crossing in the view ' +
                    'and labels it with its coordinates.\n\n' +
                    'The coordinates are long and the waves leave little room, so number the crossings instead: on the card P1 set Label to Custom ' +
                    'and type the text below. `{i}` prints 1 for the first crossing from the left, 2 for the second, and so on.\n\n' +
                    'P1 also publishes what it found under names that every other field can use: `P1_x` and `P1_y` for crossing 1, ' +
                    '`P1_x2` and `P1_y2` for crossing 2, `P1_x3` for crossing 3, and so on.',
                type: [{ where: 'P1, Label', text: '{i}' }],
                chart: chart({ ...view, functions: [f1, f2], tools: [region('t0', 'R1', [above]), region('t1', 'R2', [below], { color: 'orange' }), p1] }),
                shot: {
                    reveal: ['P1'],
                    caption: 'Intersections are computed points, numbered here. Their coordinates are available as P1_x, P1_x2, P1_x3, ...',
                },
                tip: 'No labels at all? Set Label to None on the P1 card. The points and their names stay.',
            },
            {
                title: 'Stop the shading at the crossings',
                body:
                    'Give each region a second row. On the card R1 click Add condition and type the first chain below. Do the same on R2 with the second chain.\n\n' +
                    'R1 now keeps only the piece between the first and the second crossing, and R2 the piece between the second and the third. ' +
                    'The limits are computed, so they stay right when you change one of the formulas.',
                type: [
                    { where: 'R1, condition 2', text: first },
                    { where: 'R2, condition 2', text: second },
                ],
                chart: chart({
                    ...view,
                    functions: [f1, f2],
                    tools: [region('t0', 'R1', [above, first]), region('t1', 'R2', [below, second], { color: 'orange' }), p1],
                }),
                shot: {
                    reveal: ['R1', 'R2'],
                    actions: [{ focus: ['R2', 'condition:1'] }],
                    caption: 'Each region ends at computed crossings instead of typed numbers.',
                },
                tip: 'Plain numbers work as well: `0 <= x <= 2pi` limits a region to one period.',
            },
            {
                title: 'Label the two areas',
                body:
                    'Type a name into the field Label of each region card.\n\n' +
                    'Each name is printed in bold in the middle of its area, in the colour of the region. The chart is ready for Insert into note.',
                type: [
                    { where: 'R1, Label', text: 'A1' },
                    { where: 'R2, Label', text: 'A2' },
                ],
                chart: copyOf(finished),
                shot: {
                    reveal: ['R1', 'R2'],
                    actions: [{ focus: ['R2', 'label'] }],
                    caption: 'Two areas, two colours, two labels.',
                },
                tip: 'A label can show a value: `A1 = {P1_x2 - P1_x:2}` prints the width of the first area with two decimals.',
            },
        ],
        next: ['tangent-area', 'supply-demand', 'points-labels'],
    };
}

// ------------------------------------------------------------- tangent area

function tangentAreaGuide(): Guide {
    const view = { xmin: '-3', xmax: '3', ymin: '-4', ymax: '4' };
    const cubic = fn('f1', 'x^3 - 3x', 'black');
    const tangent = fn('f2', 'f1(a) + (3a^2 - 3)(x - a)', 'blue');
    const numericTangent = fn('f2', 'f1(a) + (f1(a + 0.001) - f1(a - 0.001)) / 0.002 * (x - a)', 'blue');
    const between = 'min(f1, f2) <= y <= max(f1, f2)';
    const byFormula = 'min(a, -2a) <= x <= max(a, -2a)';
    const byCrossing = 'min(a, P1_x) <= x <= max(a, P1_x)';
    const far = crossings('t1', 'P1', 'f1', 'f2', { objective: 'abs(x - a)' });
    const finished = chart({
        ...view,
        parameters: [slider('a', -0.8)],
        functions: [fn('f1', '2x cos(x)', 'black'), numericTangent],
        tools: [region('t0', 'R1', [between, byCrossing]), far],
    });
    return {
        id: 'tangent-area',
        title: 'Shade between a curve and its tangent',
        summary: 'Write the tangent at a slider point as a function, shade the area it encloses with the curve, and make it work for any curve.',
        category: 'Regions and optimisation',
        level: 'advanced',
        minutes: 10,
        outcomes: [
            'Write the tangent at a slider point as a function of its own',
            'Shade the area between curve and tangent, whichever is on top',
            'End the area at a computed crossing point',
            'Reuse the chart for any curve with a numeric slope',
        ],
        requires: ['areas-between', 'sliders'],
        chart: finished,
        steps: [
            {
                title: 'Set the view',
                body:
                    'Start with a new chart and open the Chart tab. Under Ranges set x from -3 to 3 and y from -4 to 4.\n\n' +
                    'The default view shows x from -0.5 to 10. The curve of this guide has its hill and its valley close to 0 and grows fast outside them, ' +
                    'so the ranges come first: with them in place, the editor leaves the view alone when you type the formula.',
                chart: chart({ ...view }),
                shot: {
                    tab: 'chart',
                    actions: [{ focus: ['chart', 'ymax'] }],
                    caption: 'Chart > Ranges. Each bound is a field of its own and accepts formulas.',
                },
                tip: 'Lost the curve after panning or zooming? The Reset button under the ranges brings the default view back.',
            },
            {
                title: 'Type the curve',
                body:
                    'Go back to the Build tab, type the formula below into Start a chart and press Enter.\n\n' +
                    'The card f1 appears and the preview shows a cubic with a hill at x = -1 and a valley at x = 1.',
                type: [{ where: 'Start a chart', text: 'x^3 - 3x' }],
                chart: chart({ ...view, functions: [cubic] }),
                shot: {
                    reveal: ['f1'],
                    actions: [{ focus: ['f1', 'expression'] }],
                    caption: 'The curve f1. Its name is what the tangent refers to in the next step.',
                },
                tip: '`3x` means 3 times x. Powers bind first, so `-x^2` is the negative of x squared.',
            },
            {
                title: 'Write the tangent as a function',
                body:
                    'Click + Add and choose Function y = f(x). Type the formula below into the new card f2. The name `a` is unknown, ' +
                    'so a button Add slider a appears under the field. Click it.\n\n' +
                    'The formula is the point-slope form of a line: the height of the curve at a, plus the slope there times the distance from a. ' +
                    '`f1(a)` calls the first function by its name, and `3a^2 - 3` is the derivative of `x^3 - 3x` at a. ' +
                    'The slider starts at 1, the bottom of the valley, so the tangent is the horizontal line y = -2.',
                type: [{ where: 'f2, y =', text: 'f1(a) + (3a^2 - 3)(x - a)' }],
                chart: chart({ ...view, parameters: [slider('a', 1)], functions: [cubic, tangent] }),
                shot: {
                    reveal: ['f2'],
                    actions: [{ focus: ['f2', 'expression'] }],
                    caption: 'The tangent at x = a as the function f2. The slider a appears in the Sliders dock under the preview.',
                },
                tip: 'A function card can draw a tangent by itself (Options, Tangent), but that line has no name. A region can only use named functions, which is why the tangent is written out here.',
            },
            {
                title: 'Shade between curve and tangent',
                body:
                    'Click + Add and choose Area between two functions. The card R1 starts with `f2 <= y <= f1`, ' +
                    'which shades only where the curve is above the tangent. Replace it with the condition below.\n\n' +
                    '`min` and `max` pick the lower and the upper of the two at every x, so the area is shaded whichever one is on top. ' +
                    'For now the shading runs across the whole view, also beyond the points where the two lines meet.',
                type: [{ where: 'R1, condition 1', text: between }],
                chart: chart({ ...view, parameters: [slider('a', 1)], functions: [cubic, tangent], tools: [region('t0', 'R1', [between])] }),
                shot: {
                    reveal: ['R1'],
                    actions: [{ focus: ['R1', 'condition:0'] }],
                    caption: 'Everything between curve and tangent is shaded, on both sides of the crossing.',
                },
                tip: 'With `f2 <= y <= f1` the area between the contact points would vanish whenever the tangent lies above the curve there, for example at a = -1.',
            },
            {
                title: 'Keep the part between the contact points',
                body:
                    'Click Add condition on R1 and type the chain below. The shading now ends where tangent and curve meet. ' +
                    'Drag the slider a under the preview and the area follows.\n\n' +
                    'For this curve the tangent at a meets the curve again at x = -2a: curve minus tangent is `(x - a)^2 (x + 2a)`, ' +
                    'which is zero at a and at -2a. Which of the two lies further left depends on the sign of a, so the chain uses `min` and `max` once more.',
                type: [{ where: 'R1, condition 2', text: byFormula }],
                chart: chart({ ...view, parameters: [slider('a', 1)], functions: [cubic, tangent], tools: [region('t0', 'R1', [between, byFormula])] }),
                shot: {
                    reveal: ['R1'],
                    actions: [{ focus: ['R1', 'condition:1'] }],
                    caption: 'The area between the curve and its tangent at a = 1, from x = -2 to x = 1.',
                },
                tip: 'The shaded area is exactly 27a^4/4 here. Put `A = {27a^4/4:2}` into the Label of R1 and the picture prints its own area.',
            },
            {
                title: 'Find the far crossing',
                body:
                    'Most curves have no formula like -2a for the second meeting point, so let the chart find it. ' +
                    'Click + Add and choose Intersections of two functions. The card P1 marks the two points where f1 and f2 meet.\n\n' +
                    'Then type the formula below into the field Objective and leave the switch on Max. ' +
                    'P1 keeps only the point furthest from a, the far crossing, and publishes its position as `P1_x` and `P1_y`.',
                type: [{ where: 'P1, Objective', text: 'abs(x - a)' }],
                chart: chart({ ...view, parameters: [slider('a', 1)], functions: [cubic, tangent], tools: [region('t0', 'R1', [between, byFormula]), far] }),
                shot: {
                    reveal: ['P1'],
                    actions: [{ focus: ['P1', 'objective'] }],
                    caption: 'An objective keeps the best of the crossings: here the one furthest from a.',
                },
                tip: 'Without the objective, P1 holds the contact point too, and which one comes first changes with the sign of a. The objective makes `P1_x` unambiguous.',
            },
            {
                title: 'Use the crossing as the limit',
                body:
                    'In the second row of R1, replace `-2a` by `P1_x` in both places, so that the row reads as below. Then drag the slider a to -0.8 to check.\n\n' +
                    'The tangent now touches the hill, the far crossing sits on the right at x = 1.6, and the shading ends exactly there. ' +
                    'No formula of yours says where the lines cross any more.',
                type: [{ where: 'R1, condition 2', text: byCrossing }],
                chart: chart({ ...view, parameters: [slider('a', -0.8)], functions: [cubic, tangent], tools: [region('t0', 'R1', [between, byCrossing]), far] }),
                shot: {
                    reveal: ['R1'],
                    actions: [{ focus: ['R1', 'condition:1'] }],
                    caption: 'At a = -0.8 the area lies on the other side. The limit P1_x followed by itself.',
                },
                tip: 'When the tangent does not meet the curve a second time inside the view, there is nothing to shade and the status chip on the preview says so.',
            },
            {
                title: 'Swap in another curve',
                body:
                    'One formula still belongs to the cubic: the slope `3a^2 - 3` in f2. Replace it by a difference quotient, as in the first row below. ' +
                    'It measures the slope of f1 at a from two points close to a, so it is right for every formula.\n\n' +
                    'Now change f1 itself to the second row. The tangent, the far crossing and the shaded area all follow, without any calculus from you.',
                type: [
                    { where: 'f2, y =', text: 'f1(a) + (f1(a + 0.001) - f1(a - 0.001)) / 0.002 * (x - a)' },
                    { where: 'f1, y =', text: '2x cos(x)' },
                ],
                chart: copyOf(finished),
                shot: {
                    reveal: ['f1', 'f2'],
                    actions: [{ focus: ['f1', 'expression'] }],
                    caption: 'A different curve, the same chart: slope and crossing are computed.',
                },
                tip: 'Give a a smaller range so the tangent stays in view: click the small numbers at the two ends of the slider and type -1.5 and 1.5.',
            },
        ],
        next: ['tangents-extrema', 'drag-to-edit', 'export-latex'],
    };
}

// ----------------------------------------------------------- linear program

function linearProgramGuide(): Guide {
    const start = ['x >= 0', 'y >= 0', ''];
    const model = ['x >= 0', 'y >= 0', 'x + y <= 5', 'x + 3y <= 9'];
    const relaxed = ['x >= 0', 'y >= 0', 'x + y <= 6', 'x + 3y <= 9'];
    const labels = ['', '', '(1)', '(2)'];
    const r1 = feasibleRegion('t0', 'R1', model, { conditionLabels: labels });
    const line = curve('t1', 'C1', 'x + 2y = c', { dashed: true, label: 'z = {c}' });
    const best = optimum('t2', 'P1', 'R1', 'x + 2y');
    const bestValue = optimum('t2', 'P1', 'R1', 'x + 2y', { label: 'z* = {val}' });
    const corners = points('t3', 'P2', { source: 'region', regionName: 'R1', label: CORNER_COORDINATES });
    // The last step also gives the labels at the lower border room: y from -1.5 instead of the default -0.5.
    const finished = chart({
        ymin: '-1.5',
        parameters: [slider('c', 7.5)],
        tools: [feasibleRegion('t0', 'R1', relaxed, { conditionLabels: labels }), corners, bestValue, line],
    });
    return {
        id: 'linear-program',
        title: 'Solve a linear program in a picture',
        summary: 'Feasible region, labelled constraint lines, an objective line on a slider, the optimum, the corners, and a sensitivity test by dragging.',
        category: 'Regions and optimisation',
        level: 'core',
        minutes: 10,
        outcomes: [
            'Draw the feasible region of a linear program with labelled constraint lines',
            'Move the objective line with a slider and let the chart find the optimum',
            'Mark every corner with its coordinates',
            'Drag a constraint to see how the optimum reacts',
        ],
        requires: ['regions', 'sliders'],
        chart: finished,
        steps: [
            {
                title: 'Add a feasible region',
                body:
                    'This guide solves: maximise z = x + 2y subject to x + y <= 5, x + 3y <= 9 and x, y >= 0.\n\n' +
                    'Start with a new chart. Click + Add and choose Feasible region (inequalities). The card R1 arrives with the two sign conditions ' +
                    '`x >= 0` and `y >= 0` filled in, an empty third row, and the chip Constraint lines switched on.',
                chart: chart({ tools: [feasibleRegion('t0', 'R1', start)] }),
                shot: {
                    reveal: ['R1'],
                    caption: 'The recipe starts with the two sign conditions. The shading shows where both hold.',
                },
                tip: 'This model fits the default view. For larger numbers set Chart > Ranges first: a region is only computed inside the view.',
            },
            {
                title: 'Type and label the constraints',
                body:
                    'Type the first constraint into the empty third row and `(1)` into the small Label box next to it. Click Add condition ' +
                    '(or press Enter in the condition field) for a fourth row and enter the second constraint with the label `(2)`.\n\n' +
                    'The region shrinks to a quadrilateral. Each constraint line runs across the whole view and carries its number at one end.',
                type: [
                    { where: 'R1, condition 3', text: 'x + y <= 5' },
                    { where: 'R1, Label box of row 3', text: '(1)' },
                    { where: 'R1, condition 4', text: 'x + 3y <= 9' },
                    { where: 'R1, Label box of row 4', text: '(2)' },
                ],
                chart: chart({ tools: [r1] }),
                shot: {
                    reveal: ['R1'],
                    actions: [{ focus: ['R1', 'conditionLabel:3'] }],
                    caption: 'One row per constraint, with its label in the box on the right.',
                },
                tip: 'The link Number them (1), (2), ... labels every row at once, the sign conditions included.',
            },
            {
                title: 'Add the objective line',
                body:
                    'Click + Add and choose Line from an equation. Replace the equation of the new card C1 with the first row below. ' +
                    'The name `c` is unknown, so a button Add slider c appears under the field. Click it. ' +
                    'Then fill in the field Label and switch on the chip Dashed, so the line does not look like a constraint.\n\n' +
                    'The line shows every point with the same objective value z = c. The slider starts at 1, so the line sits near the origin, ' +
                    'and its label prints the current value.',
                type: [
                    { where: 'C1, Equation', text: 'x + 2y = c' },
                    { where: 'C1, Label', text: 'z = {c}' },
                ],
                chart: chart({ parameters: [slider('c', 1)], tools: [r1, line] }),
                shot: {
                    reveal: ['C1'],
                    actions: [{ focus: ['C1', 'label'] }],
                    caption: 'The objective line x + 2y = c. Braces in a label print a value: z = {c} shows z = 1.',
                },
                tip: 'A new slider runs from -10 to 10. Type a value outside that range into its value field and the range widens.',
            },
            {
                title: 'Slide the line across the region',
                body:
                    'Drag the slider c in the Sliders dock under the preview to the right, or press its play button.\n\n' +
                    'The line moves parallel to itself, and z grows as it moves up. Stop at the last position where it still touches the region: c = 7. ' +
                    'There the line meets the region in a single corner. That corner is the optimum, and 7 is the largest value z can take.',
                chart: chart({ parameters: [slider('c', 7)], tools: [r1, line] }),
                shot: {
                    reveal: ['C1'],
                    caption: 'At c = 7 the objective line touches the region in one corner only.',
                },
                tip: 'You can also drag the line itself in the preview. Easy TikZ changes sliders first, so c follows the pointer.',
            },
            {
                title: 'Let the chart find the optimum',
                body:
                    'On the card R1 click Find optimum. A points card P1 is added right below R1, with the cursor in its field Objective. ' +
                    'The field holds the sample `2x + 3y`, already selected: type the objective of this model over it and leave the switch on Max.\n\n' +
                    'A large marker appears at (3, 2), exactly where the line touches the region. P1 searches the whole region, ' +
                    'so you get the optimum without sliding anything.',
                type: [{ where: 'P1, Objective', text: 'x + 2y' }],
                chart: chart({ parameters: [slider('c', 7)], tools: [r1, best, line] }),
                shot: {
                    reveal: ['P1'],
                    actions: [{ focus: ['P1', 'objective'] }],
                    caption: 'Find optimum adds a points card that keeps the best point of R1.',
                },
                tip: 'Set the switch to Min for a minimisation. If the objective can grow without limit inside the view, the status chip says it is unbounded.',
            },
            {
                title: 'Show the optimal value',
                body:
                    'On the card P1 set Label to Custom and replace the text with the template below.\n\n' +
                    'Inside a points label, `{val}` is the objective value at the point, and `{x}` and `{y}` are its coordinates. ' +
                    'The marker now reads z* = 7. The same number is available to every other field as `P1_val`.',
                type: [{ where: 'P1, Label', text: 'z* = {val}' }],
                chart: chart({ parameters: [slider('c', 7)], tools: [r1, bestValue, line] }),
                shot: {
                    reveal: ['P1'],
                    actions: [{ focus: ['P1', 'label'] }],
                    caption: 'A custom label prints the objective value at the optimum.',
                },
                tip: 'Write the objective line as `x + 2y = P1_val` and it follows the optimum by itself, without a slider.',
            },
            {
                title: 'Mark the corners',
                body:
                    'Back on the card R1, click Mark corners. A second points card P2 is added. It has no objective, ' +
                    'so it marks every corner of the region and labels each with its coordinates.\n\n' +
                    'The picture now holds the complete graphical solution: the region, its four corners, the objective line and the optimum.',
                chart: chart({ parameters: [slider('c', 7)], tools: [r1, corners, bestValue, line] }),
                shot: {
                    reveal: ['P2'],
                    caption: 'Mark corners lists every corner point of the feasible region.',
                },
                tip: 'Corners and optimum are computed, so they cannot be dragged. Drag the lines that define them instead.',
            },
            {
                title: 'Drag a constraint to test it',
                body:
                    'In the preview, drag line (1) to the right until its row on the card reads `x + y <= 6`. ' +
                    'Rest the pointer on the line first: a tip shows which number will change.\n\n' +
                    'The region grows, the corners move, and the optimum jumps to (4.5, 1.5) with z* = 7.5. The objective line stays behind at z = 7, ' +
                    'so slide c to 7.5 to bring it back. One more unit of constraint (1) raised z by 0.5: that is what a unit of this constraint is worth.\n\n' +
                    'The label z = 7.5 now sits on the lower border of the chart. Give the labels room: open the Chart tab and, under Ranges, let y start at -1.5.',
                type: [{ where: 'Chart > Ranges, y from', text: '-1.5' }],
                chart: copyOf(finished),
                shot: {
                    reveal: ['R1'],
                    actions: [{ hover: [2, 4] }],
                    caption: 'After the drag, condition (1) reads x + y <= 6 and the optimum has moved to (4.5, 1.5).',
                },
                tip: 'The bar that appears after the drag offers Undo and Make slider. Make slider turns the 6 into a slider, so you can play the constraint.',
            },
        ],
        next: ['integer-program', 'level-curves', 'drag-to-edit'],
    };
}

// ---------------------------------------------------------- integer program

function integerProgramGuide(): Guide {
    const model = ['x >= 0', 'y >= 0', 'x + 2y <= 8', '3x + 2y <= 18'];
    const r1 = feasibleRegion('t0', 'R1', model);
    const relaxation = optimum('t1', 'P1', 'R1', '3x + 4y');
    const lattice = points('t2', 'P2', { source: 'lattice', regionName: 'R1', size: 'small' });
    const integerBest = optimum('t3', 'P3', 'R1', '3x + 4y', { source: 'lattice', color: 'green' });
    const lines = curve('t4', 'C1', '3x + 4y', { levels: 'P1_val, P3_val', dashed: true, label: '{level}', color: 'purple' });
    const finished = chart({
        tools: [r1, relaxation, integerBest, lattice, lines],
        annotations: [textLabel('8', '4', 'gap = {P1_val - P3_val}')],
    });
    return {
        id: 'integer-program',
        title: 'Compare an integer program with its relaxation',
        summary: 'Integer points inside a feasible region, the best integer point, and how far it is from the optimum of the relaxed linear program.',
        category: 'Regions and optimisation',
        level: 'advanced',
        minutes: 8,
        outcomes: [
            'Mark every integer point inside a region',
            'Find the best integer point for an objective',
            'Show the optimum of the relaxation next to it, with both objective lines and the gap',
        ],
        requires: ['linear-program'],
        chart: finished,
        steps: [
            {
                title: 'Draw the feasible region',
                body:
                    'This guide solves: maximise z = 3x + 4y subject to x + 2y <= 8, 3x + 2y <= 18 and x, y >= 0, once with any numbers and once with whole numbers only.\n\n' +
                    'Start with a new chart. Click + Add and choose Feasible region (inequalities). Type the first constraint into the empty third row, ' +
                    'press Enter and type the second one.',
                type: [
                    { where: 'R1, condition 3', text: 'x + 2y <= 8' },
                    { where: 'R1, condition 4', text: '3x + 2y <= 18' },
                ],
                chart: chart({ tools: [r1] }),
                shot: {
                    reveal: ['R1'],
                    actions: [{ focus: ['R1', 'condition:3'] }],
                    caption: 'The feasible region of the relaxation: every point that satisfies the four conditions.',
                },
                tip: 'Enter in the last row adds the next one, so a whole model can be typed without touching the mouse.',
            },
            {
                title: 'Solve the relaxation',
                body:
                    'On the card R1 click Find optimum. The field Objective of the new card P1 holds the sample `2x + 3y`, already selected: type the objective below over it.\n\n' +
                    'The marker lands on the corner (5, 1.5). That is the best point when fractions are allowed, the optimum of the relaxed linear program. ' +
                    'Its y is not a whole number, so it is not a solution of the integer program.',
                type: [{ where: 'P1, Objective', text: '3x + 4y' }],
                chart: chart({ tools: [r1, relaxation] }),
                shot: {
                    reveal: ['P1'],
                    actions: [{ focus: ['P1', 'objective'] }],
                    caption: 'The optimum of the relaxation sits on a corner with a fractional coordinate.',
                },
                tip: 'With the source Region and an objective, a points card searches the whole region, its edges and its inside, not only the corners.',
            },
            {
                title: 'Show the integer points',
                body:
                    'Click + Add and choose Integer points in a region. The card P2 marks every point of R1 whose coordinates are both whole numbers, as small dots.\n\n' +
                    'These 22 dots are the feasible set of the integer program. The optimum of the relaxation is not one of them.',
                chart: chart({ tools: [r1, relaxation, lattice] }),
                shot: {
                    reveal: ['P2'],
                    caption: 'Source Integers: every point with whole-number coordinates inside R1.',
                },
                tip: 'With Region set to Whole view, the same card marks the integer points of the entire view.',
            },
            {
                title: 'Keep the best integer point',
                body:
                    'Open the ... menu on the card P1 and choose Duplicate. On the copy, P3, switch the source at the top of the card ' +
                    'from Region to Integers, then click its colour swatch and pick green.\n\n' +
                    'P3 keeps the objective of P1, but now searches the integer points only. Its marker lands on (4, 2). ' +
                    'Rounding the relaxed optimum would not have found it: (5, 2) is infeasible, and (5, 1) is worse.',
                chart: chart({ tools: [r1, relaxation, integerBest, lattice] }),
                shot: {
                    reveal: ['P3'],
                    caption: 'The same objective over the integer points: the best one is (4, 2).',
                },
                tip: 'If several integer points share the best value, all of them are marked.',
            },
            {
                title: 'Draw both objective lines',
                body:
                    'Click + Add and choose Level curves of F(x, y). On the new card C1, replace Equation and Levels with the rows below ' +
                    'and switch on the chip Dashed.\n\n' +
                    'A curve with levels draws F = value once per value. Here the values are computed: `P1_val` is the objective at the relaxed optimum ' +
                    'and `P3_val` at the best integer point. You get two parallel lines, each through its own optimum. ' +
                    'The label `{level}`, which the recipe filled in, prints the value on each line: 21 and 20.',
                type: [
                    { where: 'C1, Equation', text: '3x + 4y' },
                    { where: 'C1, Levels', text: 'P1_val, P3_val' },
                ],
                chart: chart({ tools: [r1, relaxation, integerBest, lattice, lines] }),
                shot: {
                    reveal: ['C1'],
                    actions: [{ focus: ['C1', 'levels'] }],
                    caption: 'Two levels of the objective, taken from the two optima.',
                },
                tip: 'In a curve label, `{level}` is the value of the line it sits on. Write `z = {level}` for a longer label.',
            },
            {
                title: 'Print the gap',
                body:
                    'Click + Add and choose Text label. Replace its text with the template below, then drag the label in the preview ' +
                    'to the free corner at the top right. Close to a grid point it snaps: let go on (8, 4).\n\n' +
                    'The label reads gap = 1: insisting on whole numbers costs one unit of z in this model. ' +
                    'Change a constraint and both optima, both lines and the gap are computed again.',
                type: [{ where: 'Label 1, Text', text: 'gap = {P1_val - P3_val}' }],
                chart: copyOf(finished),
                shot: {
                    reveal: ['label:0'],
                    actions: [{ focus: ['label:0', 'text'] }],
                    caption: 'A text label with a template prints the difference of the two optimal values.',
                },
                tip: 'Anything inside braces is a formula, so a label can do arithmetic with computed values.',
            },
        ],
        next: ['level-curves', 'points-labels', 'export-latex'],
    };
}

// ------------------------------------------------------------- level curves

function levelCurvesGuide(): Guide {
    const levels = curve('t0', 'C1', 'x*y', { levels: '2, 4, 8', label: '{level}', color: 'purple' });
    const through = curve('t0', 'C1', 'x*y', { levels: '2, 4, 8, P1_val', label: '{level}', color: 'purple' });
    const budget = feasibleRegion('t1', 'R1', ['x >= 0', 'y >= 0', 'x + 2y <= 7']);
    const sliderBudget = feasibleRegion('t1', 'R1', ['x >= 0', 'y >= 0', 'x + 2y <= b']);
    const best = optimum('t2', 'P1', 'R1', 'x*y');
    const bestValue = optimum('t2', 'P1', 'R1', 'x*y', { label: 'u* = {val:2}' });
    const finished = chart({ parameters: [slider('b', 9)], tools: [through, sliderBudget, bestValue] });
    return {
        id: 'level-curves',
        title: 'Find a nonlinear optimum with level curves',
        summary: 'Level curves of an objective, a constraint region, the best point on its edge, and the level curve that touches it there.',
        category: 'Regions and optimisation',
        level: 'advanced',
        minutes: 8,
        outcomes: [
            'Draw the level curves of a formula in x and y',
            'Find the optimum of a nonlinear objective over a region',
            'Draw the level curve through the optimum with a computed value',
            'Watch the solution follow a slider',
        ],
        requires: ['linear-program'],
        chart: finished,
        steps: [
            {
                title: 'Add level curves',
                body:
                    'Start with a new chart. Click + Add and choose Level curves of F(x, y).\n\n' +
                    'The card C1 holds the formula `x*y` in Equation and the list `2, 4, 8` in Levels. The preview draws one curve per level: ' +
                    'all points where x times y equals 2, 4 or 8. Its Label, `{level}`, prints the value on each curve.\n\n' +
                    'Read `x*y` as the objective of this guide, for example the utility of a bundle of two goods. Curves further out are better.',
                chart: chart({ tools: [levels] }),
                shot: {
                    reveal: ['C1'],
                    actions: [{ focus: ['C1', 'levels'] }],
                    caption: 'One curve per entry of Levels. Without levels, the same card draws the single curve F = 0.',
                },
                tip: 'Write `x*y` or `x y`. Without the star or the space, `xy` is read as one name.',
            },
            {
                title: 'Add the constraint',
                body:
                    'Click + Add and choose Feasible region (inequalities). Type the condition below into the empty third row of the card R1.\n\n' +
                    'The shaded triangle is the budget set: all bundles that cost at most 7 when x costs 1 and y costs 2. ' +
                    'The curve 2 and the curve 4 pass through it. The curve 8 lies outside, out of reach.',
                type: [{ where: 'R1, condition 3', text: 'x + 2y <= 7' }],
                chart: chart({ tools: [levels, budget] }),
                shot: {
                    reveal: ['R1'],
                    actions: [{ focus: ['R1', 'condition:2'] }],
                    caption: 'The budget set and three level curves of the objective.',
                },
                tip: 'Fills always sit below lines and points, so the order of the cards does not hide the curves.',
            },
            {
                title: 'Find the best point',
                body:
                    'On the card R1 click Find optimum. The field Objective of the new card P1 holds the sample `2x + 3y`, already selected: type the formula below over it. Leave the switch on Max.\n\n' +
                    'The marker lands at (3.5, 1.75), in the middle of the sloping edge. It is not a corner: ' +
                    'for a nonlinear objective the best point can lie anywhere on the boundary or inside, and the points card searches all of it.',
                type: [{ where: 'P1, Objective', text: 'x*y' }],
                chart: chart({ tools: [levels, budget, best] }),
                shot: {
                    reveal: ['P1'],
                    actions: [{ focus: ['P1', 'objective'] }],
                    caption: 'The maximum of x*y over the budget set lies on the edge, between the corners.',
                },
                tip: 'The hint under Objective says what is searched: the best point anywhere in R1, inside, on an edge or at a corner.',
            },
            {
                title: 'Draw the curve through the optimum',
                body:
                    'On the card C1, add `P1_val` to the list in Levels so that it reads as below.\n\n' +
                    '`P1_val` is the objective value at the point P1 found, here 6.125. The new curve touches the budget line in exactly that point ' +
                    'and stays outside the region everywhere else. That tangency is the picture of an optimum under a constraint.',
                type: [{ where: 'C1, Levels', text: '2, 4, 8, P1_val' }],
                chart: chart({ tools: [through, budget, best] }),
                shot: {
                    reveal: ['C1'],
                    actions: [{ focus: ['C1', 'levels'] }],
                    caption: 'The level P1_val is the curve that just touches the budget line.',
                },
                tip: 'Levels can mix numbers, sliders and computed values, separated by commas.',
            },
            {
                title: 'Print the optimal value',
                body:
                    'On the card P1 set Label to Custom and replace the text with the template below.\n\n' +
                    'The marker now shows the value of the objective instead of its coordinates: u* = 6.13. The `:2` limits the number to two decimals.',
                type: [{ where: 'P1, Label', text: 'u* = {val:2}' }],
                chart: chart({ tools: [through, budget, bestValue] }),
                shot: {
                    reveal: ['P1'],
                    actions: [{ focus: ['P1', 'label'] }],
                    caption: 'A custom point label with the objective value.',
                },
                tip: 'To print both, write `({x}, {y}): u* = {val:2}`.',
            },
            {
                title: 'Put the budget on a slider',
                body:
                    'In the third row of R1, replace the 7 by the name `b`, so that the row reads as below. Click Add slider b under the field, ' +
                    'then drag the new slider from 1 up to 9.\n\n' +
                    'The triangle grows, the optimum slides outwards, and the touching level curve follows it. ' +
                    'At b = 9 the best value is about 10.13, beyond the curve 8.',
                type: [{ where: 'R1, condition 3', text: 'x + 2y <= b' }],
                chart: copyOf(finished),
                shot: {
                    reveal: ['R1'],
                    actions: [{ focus: ['R1', 'condition:2'] }],
                    caption: 'With the budget on a slider, region, optimum and level curve are recomputed while you drag.',
                },
                tip: 'Before you press play on b, click the small number at the left end of the slider and type 1: a budget of 0 or less leaves nothing to shade.',
            },
        ],
        next: ['supply-demand', 'integer-program', 'charts-in-notes'],
    };
}

// ------------------------------------------------------------ supply demand

function supplyDemandGuide(): Guide {
    const axes = { xmin: '0', xmax: '12', ymin: '0', ymax: '11', axis_label_x: 'Quantity', axis_label_y: 'Price' };
    const demand = fn('f1', '10 - x', 'black');
    const sliderDemand = fn('f1', '10 - a*x', 'black');
    const supply = fn('f2', '2 + x', 'blue');
    const between = 'f2 <= y <= f1';
    const withDropLines = crossings('t0', 'P1', 'f1', 'f2', { dropLines: true });
    const total = region('t1', 'R1', [between]);
    const consumer = region('t1', 'R1', [between, 'y >= P1_y'], { label: 'CS' });
    const producer = region('t2', 'R2', [between, 'y <= P1_y'], { color: 'orange', label: 'PS' });
    const finished = chart({ ...axes, parameters: [slider('a', 0.6)], functions: [sliderDemand, supply], tools: [withDropLines, consumer, producer] });
    return {
        id: 'supply-demand',
        title: 'Draw a market with surplus areas',
        summary: 'Demand and supply, their equilibrium with guide lines, and consumer and producer surplus that follow a slider.',
        category: 'Regions and optimisation',
        level: 'core',
        minutes: 9,
        outcomes: [
            'Mark the equilibrium of two curves with dashed guides to the axes',
            'Shade consumer and producer surplus with limits taken from the equilibrium',
            'Change the slope of demand with a slider and watch everything follow',
        ],
        requires: ['areas-between', 'sliders'],
        chart: finished,
        steps: [
            {
                title: 'Set up the axes',
                body:
                    'Start with a new chart and open the Chart tab. Under Ranges set x from 0 to 12 and y from 0 to 11. ' +
                    'Under Axes type Quantity into x label and Price into y label.\n\n' +
                    'Quantities and prices are not negative, so both axes start at 0. Setting the ranges first also keeps the editor from ' +
                    'fitting the view to the first curve you type.',
                chart: chart({ ...axes }),
                shot: {
                    tab: 'chart',
                    actions: [{ focus: ['chart', 'ymax'] }],
                    caption: 'Chart tab: the ranges on top, axis labels under Axes.',
                },
                tip: 'A range may start at exactly 0. Regions and lines are then cut off at the axis.',
            },
            {
                title: 'Type the demand curve',
                body:
                    'Go back to the Build tab, type the formula below into Start a chart and press Enter.\n\n' +
                    'The card f1 is the demand curve: at a price of 10 nobody buys, and every drop of the price by 1 sells one more unit.',
                type: [{ where: 'Start a chart', text: '10 - x' }],
                chart: chart({ ...axes, functions: [demand] }),
                shot: {
                    reveal: ['f1'],
                    actions: [{ focus: ['f1', 'expression'] }],
                    caption: 'Demand as the function f1. The horizontal axis is the quantity x.',
                },
                tip: 'Economists put the price on the vertical axis, so write the price as a function of the quantity x.',
            },
            {
                title: 'Add the supply curve',
                body:
                    'Click + Add and choose Function y = f(x). Type the formula below into the new card f2.\n\n' +
                    'Supply rises with the price. The two lines cross where the quantity supplied equals the quantity demanded.',
                type: [{ where: 'f2, y =', text: '2 + x' }],
                chart: chart({ ...axes, functions: [demand, supply] }),
                shot: {
                    reveal: ['f2'],
                    actions: [{ focus: ['f2', 'expression'] }],
                    caption: 'Supply as the function f2, in the next free colour.',
                },
                tip: 'To name the curves in a legend, open Options on a function card, switch on Legend and type Demand or Supply.',
            },
            {
                title: 'Mark the equilibrium',
                body:
                    'Click + Add and choose Intersections of two functions. On the new card P1, switch on the chip Drop lines.\n\n' +
                    'The marker sits at the equilibrium (4, 6), and dashed guides run from it to both axes: quantity 4 at price 6. ' +
                    'P1 publishes these numbers as `P1_x` and `P1_y`.',
                chart: chart({ ...axes, functions: [demand, supply], tools: [withDropLines] }),
                shot: {
                    reveal: ['P1'],
                    caption: 'The equilibrium with drop lines to the quantity and the price axis.',
                },
                tip: 'The names follow the card: rename P1 to Eq by clicking its name badge and the values become `Eq_x` and `Eq_y`.',
            },
            {
                title: 'Shade the total surplus',
                body:
                    'Click + Add and choose Area between two functions. The card R1 holds the condition `f2 <= y <= f1`.\n\n' +
                    'The preview shades the triangle between supply and demand, left of the equilibrium. It ends there by itself, ' +
                    'because to the right of the crossing supply lies above demand and the condition cannot hold. This triangle is the total surplus of the market.',
                chart: chart({ ...axes, functions: [demand, supply], tools: [withDropLines, total] }),
                shot: {
                    reveal: ['R1'],
                    actions: [{ focus: ['R1', 'condition:0'] }],
                    caption: 'Between supply and demand: the total surplus.',
                },
                tip: 'The left edge is the border of the view at x = 0. If your x axis starts below 0, add the row `x >= 0`.',
            },
            {
                title: 'Keep the consumer surplus',
                body:
                    'On the card R1 click Add condition and type the first row below. Then type CS into the field Label.\n\n' +
                    'The new row cuts the triangle at the equilibrium price. What remains lies above the price and below demand: ' +
                    'the consumer surplus, what buyers were willing to pay beyond the price.',
                type: [
                    { where: 'R1, condition 2', text: 'y >= P1_y' },
                    { where: 'R1, Label', text: 'CS' },
                ],
                chart: chart({ ...axes, functions: [demand, supply], tools: [withDropLines, consumer] }),
                shot: {
                    reveal: ['R1'],
                    actions: [{ focus: ['R1', 'condition:1'] }],
                    caption: 'One more row: above the equilibrium price P1_y.',
                },
                tip: 'A computed value in a condition needs no brackets or braces: write `P1_y` like any other name.',
            },
            {
                title: 'Add the producer surplus',
                body:
                    'Add a second Area between two functions. On the card R2, which is orange, click Add condition and type the first row below. ' +
                    'Then type PS into its field Label.\n\n' +
                    'R2 is the part of the triangle below the price and above supply: the producer surplus. Together the two regions fill the triangle from the step before.',
                type: [
                    { where: 'R2, condition 2', text: 'y <= P1_y' },
                    { where: 'R2, Label', text: 'PS' },
                ],
                chart: chart({ ...axes, functions: [demand, supply], tools: [withDropLines, consumer, producer] }),
                shot: {
                    reveal: ['R2'],
                    actions: [{ focus: ['R2', 'condition:1'] }],
                    caption: 'Consumer and producer surplus, split at the equilibrium price.',
                },
                tip: 'Both regions use the same first row. Only the second row decides which side of the price they keep.',
            },
            {
                title: 'Put demand on a slider',
                body:
                    'On the card f1 change the formula to the row below and click Add slider a under the field. Then drag the slider a down to 0.6.\n\n' +
                    'Demand becomes flatter. The equilibrium moves to (5, 7), the guides follow, and both surplus areas are recomputed while you drag, ' +
                    'because every limit in this chart is a computed value.',
                type: [{ where: 'f1, y =', text: '10 - a*x' }],
                chart: copyOf(finished),
                shot: {
                    reveal: ['f1'],
                    actions: [{ focus: ['f1', 'expression'] }],
                    caption: 'At a = 0.6 demand is flatter and the equilibrium has moved to quantity 5 and price 7.',
                },
                tip: 'Limit a to slopes that make sense: click the small numbers at the two ends of the slider and type 0.5 and 3. At 0 or below, demand no longer falls.',
            },
        ],
        next: ['charts-in-notes', 'export-latex', 'level-curves'],
    };
}

/** Guides of this group (see the list in docs/guides/README.md). */
export const OPTIMISATION_GUIDES: Guide[] = [
    regionsGuide(),
    areasBetweenGuide(),
    tangentAreaGuide(),
    linearProgramGuide(),
    integerProgramGuide(),
    levelCurvesGuide(),
    supplyDemandGuide(),
];
