import * as fs from 'node:fs';
import * as path from 'node:path';
import { test, assert, near } from './_lib';
import {
    EXAMPLES,
    RESERVED_NAMES,
    SCHEMA_VERSION,
    defaultFunction,
    defaultParameter,
    defaultTool,
    escapeTemplate,
    legacyTexToText,
    migrateSettings,
    newId,
    nextFunctionName,
    nextParameterName,
    nextToolName,
    normalizeFunctions,
    normalizeParameters,
    normalizeTools,
    recipes,
    RecipeContext,
} from '../src/migrate';
import { COLOR_MAP, COLOR_OPTIONS, TIKZ_COLOR_DEFS, mixHex } from '../src/colors';
import { FunctionParameters, Parameter, Tool } from '../src/types';
import { MathContext, texText } from '../src/mathcontext';
import { scanTemplate } from '../src/expr';
import { SettingsManager } from '../src/settings';

// ---------------------------------------------------------------------------
// Fixtures: blocks as 3.19.6 serialized them (SettingsManager.serialize()).
// ---------------------------------------------------------------------------

function legacyFunction(fields: Record<string, unknown>): Record<string, unknown> {
    return {
        expression: '',
        domain: '-10:10',
        showLegend: false,
        fill: false,
        fillOpacity: 0.2,
        fillPattern: 'solid',
        tangent: false,
        dashed: false,
        tangentPoint: '',
        extrema: false,
        color: 'black',
        thickness: 'thin',
        parametric: false,
        expressionY: '',
        ...fields,
    };
}

function legacyBlock(fields: Record<string, unknown>): Record<string, unknown> {
    return {
        dimension: false,
        documentSetup: true,
        title: 'My graph: \\(\\sum\\)',
        size_x_cm: 10,
        size_y_cm: 10,
        show_axis_label: true,
        axis_label_x: 'x',
        axis_label_y: 'y',
        documentClose: true,
        showAxis: true,
        showLargeGrid: false,
        showSmallGrid: false,
        gridSize: 5,
        xmin: '-0.5',
        xmax: '10',
        ymin: '-0.5',
        ymax: '5',
        axis_style: 'box',
        functions: [],
        zmin: '-5',
        zmax: '5',
        axis_label_z: 'z',
        rotationX: 30,
        rotationZ: 45,
        zoom3D: 1,
        boxAspect: 'true',
        functions3D: [],
        majorTickNum: 8,
        previewSize: 760,
        annotations: [],
        tools: [],
        coordinateSystem: 'cartesian',
        axis_label_x_polar: '',
        axis_label_y_polar: '',
        ...fields,
    };
}

/** v4 function state as normalizeFunctions completes it. */
function v4Function(fields: Partial<FunctionParameters>): FunctionParameters {
    return {
        expression: '',
        domain: '-10:10',
        showLegend: false,
        fill: false,
        fillOpacity: 0.2,
        fillPattern: 'solid',
        tangent: false,
        dashed: false,
        tangentPoint: '',
        extrema: false,
        color: 'black',
        thickness: 'thin',
        parametric: false,
        expressionY: '',
        ...fields,
    };
}

function clone<T>(v: T): T {
    return JSON.parse(JSON.stringify(v)) as T;
}

function toolsOf(block: Record<string, unknown>): Tool[] {
    return migrateSettings(block).tools as Tool[];
}

// ---------------------------------------------------------------------------
// Legacy tools, one fixture per type, exact v4 output.
// ---------------------------------------------------------------------------

test('areaBetween -> region with min/max band, renamed refs and wrapped domain', () => {
    const block = legacyBlock({
        functions: [
            legacyFunction({ name: 'left curve', expression: 'x^2', domain: '0:3' }),
            legacyFunction({ name: '', expression: 'sqrt(x)', domain: '0:3', color: 'blue' }),
        ],
        tools: [
            {
                type: 'areaBetween',
                func1Name: 'left curve',
                func2Name: 'f2',
                domain: '-1:a+b',
                color: 'teal',
                fillOpacity: 0.4,
                fillPattern: 'north-east',
            },
        ],
    });
    const out = migrateSettings(block);
    const fns = out.functions as FunctionParameters[];
    assert.deepEqual(fns.map((f) => f.name), ['left_curve', 'f2']);
    assert.deepEqual(out.tools, [
        {
            id: 't0',
            name: 'R1',
            type: 'region',
            color: 'teal',
            conditions: ['min(left_curve, f2) <= y <= max(left_curve, f2)', '(-1) <= x <= (a+b)'],
            conditionLabels: ['', ''],
            fill: true,
            fillOpacity: 0.4,
            fillPattern: 'north-east',
            outline: 'none',
            thickness: 'thin',
            constraintLines: false,
            label: '',
        },
    ]);
});

test('areaBetween without a domain has a single condition; plain numbers stay unwrapped', () => {
    const tools = toolsOf(
        legacyBlock({
            functions: [legacyFunction({ name: 'f', expression: 'x' }), legacyFunction({ name: 'g', expression: '1' })],
            tools: [
                { type: 'areaBetween', func1Name: 'f', func2Name: 'g', domain: '', color: 'blue', fillOpacity: 0.3, fillPattern: 'solid' },
                { type: 'areaBetween', func1Name: 'f', func2Name: 'g', domain: '0:2.5', color: 'blue', fillOpacity: 0.3, fillPattern: 'solid' },
                { type: 'areaBetween', func1Name: 'f', func2Name: 'g', domain: '0:2*pi', color: 'blue', fillOpacity: 0.3, fillPattern: 'solid' },
            ],
        })
    );
    assert.deepEqual(tools[0].type === 'region' && tools[0].conditions, ['min(f, g) <= y <= max(f, g)']);
    assert.deepEqual(tools[1].type === 'region' && tools[1].conditions, ['min(f, g) <= y <= max(f, g)', '0 <= x <= 2.5']);
    assert.deepEqual(tools[2].type === 'region' && tools[2].conditions, ['min(f, g) <= y <= max(f, g)', '0 <= x <= (2*pi)']);
    assert.ok(tools.every((t) => !t.hidden));
});

test('intersection -> points tool; duplicate and reserved function names follow the renames', () => {
    const block = legacyBlock({
        functions: [
            legacyFunction({ name: 'g', expression: 'x', domain: '0:5' }),
            legacyFunction({ name: 'g', expression: '5 - x', domain: '0:5' }),
            legacyFunction({ name: 'sin', expression: '2', domain: '0:5' }),
        ],
        tools: [
            { type: 'intersection', func1Name: 'g', func2Name: 'sin', color: 'red', showLabels: true },
            { type: 'intersection', func1Name: 'g', func2Name: 'sin', color: 'green', showLabels: false },
        ],
    });
    const out = migrateSettings(block);
    assert.deepEqual((out.functions as FunctionParameters[]).map((f) => f.name), ['g', 'g2', 'sin2']);
    assert.deepEqual(out.tools, [
        {
            id: 't0',
            name: 'P1',
            type: 'points',
            color: 'red',
            dim: 2,
            source: 'intersections',
            points: '',
            // 3.x resolved a duplicated name to the LAST function with it.
            ref1: 'g2',
            ref2: 'sin2',
            regionName: '',
            objective: '',
            sense: 'max',
            label: '({x:2}, {y:2})',
            dropLines: false,
            size: 'normal',
        },
        {
            id: 't1',
            name: 'P2',
            type: 'points',
            color: 'green',
            dim: 2,
            source: 'intersections',
            points: '',
            ref1: 'g2',
            ref2: 'sin2',
            regionName: '',
            objective: '',
            sense: 'max',
            label: '',
            dropLines: false,
            size: 'normal',
        },
    ]);
});

test('verticalLine / horizontalLine -> curves; expressions and signed numbers wrapped, labels converted', () => {
    const tools = toolsOf(
        legacyBlock({
            tools: [
                { type: 'verticalLine', x: 'a+b', color: 'blue', thickness: 'thick', dashed: true, label: 'x_{0}' },
                { type: 'horizontalLine', y: '-2', color: 'red', thickness: 'thin', dashed: false, label: '50\\% floor' },
                { type: 'verticalLine', x: '', color: 'blue', thickness: 'thin', dashed: true, label: '' },
            ],
        })
    );
    assert.deepEqual(tools, [
        {
            id: 't0',
            name: 'C1',
            type: 'curve',
            color: 'blue',
            equation: 'x = (a+b)',
            levels: '',
            thickness: 'thick',
            dashed: true,
            // 3.x typeset the raw TeX `x_{0}` (its preview drew a subscript): v4 keeps it as math.
            label: 'x\\(_{0}\\)',
        },
        { id: 't1', name: 'C2', type: 'curve', color: 'red', equation: 'y = (-2)', levels: '', thickness: 'thin', dashed: false, label: '50% floor' },
        { id: 't2', name: 'C3', type: 'curve', color: 'blue', equation: 'x = 0', levels: '', thickness: 'thin', dashed: true, label: '' },
    ]);
});

test('rectangle -> region; numeric bounds sorted, expression bounds via min/max, outline solid', () => {
    const tools = toolsOf(
        legacyBlock({
            tools: [
                {
                    type: 'rectangle',
                    x1: '3',
                    y1: '-2',
                    x2: '1',
                    y2: '0.5',
                    color: 'orange',
                    thickness: 'thick',
                    fill: true,
                    fillOpacity: 0.5,
                    fillPattern: 'crosshatch',
                },
                { type: 'rectangle', x1: 'a+b', y1: '0', x2: '2', y2: '1', color: 'blue', thickness: 'thin', fill: false, fillOpacity: 0.2, fillPattern: 'solid' },
            ],
        })
    );
    assert.deepEqual(tools[0], {
        id: 't0',
        name: 'R1',
        type: 'region',
        color: 'orange',
        conditions: ['1 <= x <= 3', '(-2) <= y <= 0.5'],
        conditionLabels: ['', ''],
        fill: true,
        fillOpacity: 0.5,
        fillPattern: 'crosshatch',
        outline: 'solid',
        thickness: 'thick',
        constraintLines: false,
        label: '',
    });
    assert.deepEqual(tools[1], {
        id: 't1',
        name: 'R2',
        type: 'region',
        color: 'blue',
        conditions: ['min((a+b), 2) <= x <= max((a+b), 2)', '0 <= y <= 1'],
        conditionLabels: ['', ''],
        fill: false,
        fillOpacity: 0.2,
        fillPattern: 'solid',
        outline: 'solid',
        thickness: 'thin',
        constraintLines: false,
        label: '',
    });
});

test('circle -> region (filled) or curve (outline); centre 0 simplifies, r wrapped, non-positive r hidden', () => {
    const tools = toolsOf(
        legacyBlock({
            tools: [
                { type: 'circle', cx: '0', cy: '-2', r: 'r0', color: 'purple', thickness: 'thin', fill: true, fillOpacity: 0.3, fillPattern: 'dots' },
                { type: 'circle', cx: 'a+b', cy: '1', r: '2', color: 'blue', thickness: 'thick', fill: false, fillOpacity: 0.2, fillPattern: 'solid' },
                { type: 'circle', cx: '1', cy: '1', r: '-2', color: 'blue', thickness: 'thin', fill: false, fillOpacity: 0.2, fillPattern: 'solid' },
            ],
        })
    );
    assert.deepEqual(tools[0], {
        id: 't0',
        name: 'R1',
        type: 'region',
        color: 'purple',
        conditions: ['x^2 + (y - (-2))^2 <= (r0)^2'],
        conditionLabels: [''],
        fill: true,
        fillOpacity: 0.3,
        fillPattern: 'dots',
        outline: 'solid',
        thickness: 'thin',
        constraintLines: false,
        label: '',
    });
    assert.deepEqual(tools[1], {
        id: 't1',
        name: 'C1',
        type: 'curve',
        color: 'blue',
        equation: '(x - (a+b))^2 + (y - 1)^2 = 2^2',
        levels: '',
        thickness: 'thick',
        dashed: false,
        label: '',
    });
    assert.deepEqual(tools[2], {
        id: 't2',
        name: 'C2',
        type: 'curve',
        color: 'blue',
        equation: '(x - 1)^2 + (y - 1)^2 = (-2)^2',
        levels: '',
        thickness: 'thin',
        dashed: false,
        label: '',
        hidden: true,
    });
});

test('legacy segment -> segment path; arrow none -> line; v4 segment (path) is kept', () => {
    const tools = toolsOf(
        legacyBlock({
            tools: [
                { type: 'segment', x1: '0', y1: '-2', x2: 'pi/2', y2: '1', color: 'red', thickness: 'thick', dashed: true, arrow: 'both' },
                { type: 'segment', x1: '1', y1: '1', x2: '2', y2: '2', color: 'blue', thickness: 'thin', dashed: false, arrow: 'none' },
            ],
        })
    );
    assert.deepEqual(tools, [
        {
            id: 't0',
            name: 'S1',
            type: 'segment',
            color: 'red',
            dim: 2,
            path: '(0, (-2)); ((pi/2), 1)',
            closed: false,
            style: 'both',
            thickness: 'thick',
            dashed: true,
            label: '',
        },
        {
            id: 't1',
            name: 'S2',
            type: 'segment',
            color: 'blue',
            dim: 2,
            path: '(1, 1); (2, 2)',
            closed: false,
            style: 'line',
            thickness: 'thin',
            dashed: false,
            label: '',
        },
    ]);
    const v4 = normalizeTools([{ type: 'segment', id: 'abc123', name: 'S7', path: '(0, 0); (1, 1); (2, 0)', style: 'forward' }], {});
    assert.deepEqual(v4, [
        {
            id: 'abc123',
            name: 'S7',
            type: 'segment',
            color: 'black',
            dim: 2,
            path: '(0, 0); (1, 1); (2, 0)',
            closed: false,
            style: 'forward',
            thickness: 'thin',
            dashed: false,
            label: '',
        },
    ]);
});

test('brace -> segment style brace with converted, escaped label', () => {
    const tools = toolsOf(
        legacyBlock({ tools: [{ type: 'brace', x1: '0', y1: '0', x2: '4', y2: '0', color: 'blue', label: '\\textit{width} {w}' }] })
    );
    assert.deepEqual(tools, [
        {
            id: 't0',
            name: 'S1',
            type: 'segment',
            color: 'blue',
            dim: 2,
            path: '(0, 0); (4, 0)',
            closed: false,
            style: 'brace',
            thickness: 'thin',
            dashed: false,
            label: '\\(\\textit{width}\\) w',
        },
    ]);
});

test('3D legacy tools: plane3D kept, point3D -> points dim 3, segment3D -> segment dim 3', () => {
    const tools = toolsOf(
        legacyBlock({
            dimension: true,
            tools: [
                { type: 'plane3D', axis: 'z', value: '1', color: 'blue', fillOpacity: 0.25 },
                { type: 'point3D', x: '1', y: '-1', z: 'a+b', color: 'red', label: 'P' },
                {
                    type: 'segment3D',
                    x1: '0',
                    y1: '0',
                    z1: '0',
                    x2: '1',
                    y2: '2',
                    z2: '-3',
                    color: 'green',
                    thickness: 'thin',
                    dashed: false,
                    arrow: 'forward',
                },
            ],
        })
    );
    assert.deepEqual(tools, [
        { id: 't0', name: 'PL1', type: 'plane3D', color: 'blue', axis: 'z', value: '1', fillOpacity: 0.25 },
        {
            id: 't1',
            name: 'P1',
            type: 'points',
            color: 'red',
            dim: 3,
            source: 'list',
            points: '(1, (-1), (a+b))',
            ref1: '',
            ref2: '',
            regionName: '',
            objective: '',
            sense: 'max',
            label: 'P',
            dropLines: false,
            size: 'normal',
        },
        {
            id: 't2',
            name: 'S1',
            type: 'segment',
            color: 'green',
            dim: 3,
            path: '(0, 0, 0); (1, 2, (-3))',
            closed: false,
            style: 'forward',
            thickness: 'thin',
            dashed: false,
            label: '',
        },
    ]);
});

test('mixed legacy list: names per kind in list order, ids from the raw index, garbage dropped', () => {
    const tools = toolsOf(
        legacyBlock({
            functions: [legacyFunction({ name: 'f', expression: 'x' }), legacyFunction({ name: 'g', expression: '2' })],
            tools: [
                { type: 'areaBetween', func1Name: 'f', func2Name: 'g', domain: '', color: 'blue', fillOpacity: 0.3, fillPattern: 'solid' },
                null,
                'garbage',
                { type: 'unknownTool', x: 1 },
                { type: 'rectangle', x1: '0', y1: '0', x2: '1', y2: '1', color: 'blue', thickness: 'thin', fill: true, fillOpacity: 0.2, fillPattern: 'solid' },
                { type: 'verticalLine', x: '1', color: 'blue', thickness: 'thin', dashed: true, label: '' },
                { type: 'intersection', func1Name: 'f', func2Name: 'g', color: 'red', showLabels: false },
                { type: 'segment', x1: '0', y1: '0', x2: '1', y2: '1', color: 'blue', thickness: 'thin', dashed: false, arrow: 'forward' },
                { type: 'brace', x1: '0', y1: '0', x2: '1', y2: '0', color: 'blue', label: '' },
            ],
        })
    );
    assert.deepEqual(
        tools.map((t) => [t.id, t.name, t.type]),
        [
            ['t0', 'R1', 'region'],
            ['t4', 'R2', 'region'],
            ['t5', 'C1', 'curve'],
            ['t6', 'P1', 'points'],
            ['t7', 'S1', 'segment'],
            ['t8', 'S2', 'segment'],
        ]
    );
});

test('legacy tools referencing missing or domain-less functions are hidden (3.x drew nothing)', () => {
    const out = migrateSettings(
        legacyBlock({
            functions: [
                legacyFunction({ name: 'f', expression: 'x', domain: '0:4' }),
                legacyFunction({ name: 'g', expression: 'x^2', domain: '' }),
            ],
            tools: [
                { type: 'areaBetween', func1Name: 'f', func2Name: 'g', domain: '', color: 'blue', fillOpacity: 0.3, fillPattern: 'solid' },
                { type: 'intersection', func1Name: 'f', func2Name: 'nope', color: 'red', showLabels: true },
                { type: 'areaBetween', func1Name: 'f', func2Name: '', domain: '', color: 'blue', fillOpacity: 0.3, fillPattern: 'solid' },
                { type: 'areaBetween', func1Name: 'f', func2Name: 'f', domain: '1:2:3', color: 'blue', fillOpacity: 0.3, fillPattern: 'solid' },
                { type: 'intersection', func1Name: 'f', func2Name: 'f', color: 'red', showLabels: false },
                // 3.x parseDomain rejected bounds out of order.
                { type: 'areaBetween', func1Name: 'f', func2Name: 'f', domain: '4:1', color: 'blue', fillOpacity: 0.3, fillPattern: 'solid' },
                { type: 'areaBetween', func1Name: 'f', func2Name: 'f', domain: '2:2', color: 'blue', fillOpacity: 0.3, fillPattern: 'solid' },
                { type: 'areaBetween', func1Name: 'f', func2Name: 'f', domain: '1:2', color: 'blue', fillOpacity: 0.3, fillPattern: 'solid' },
            ],
        })
    );
    const tools = out.tools as Tool[];
    assert.deepEqual(tools.map((t) => t.hidden === true), [true, true, true, true, false, true, true, false]);
    assert.deepEqual(tools[2].type === 'region' && tools[2].conditions, ['min(f, 0) <= y <= max(f, 0)']);
    const fns = out.functions as FunctionParameters[];
    assert.equal(fns[1].hidden, true);
});

test('legacy annotations, title and labels are converted and escaped; v4 blocks are untouched', () => {
    const legacy = migrateSettings(
        legacyBlock({
            title: 'Area \\(\\frac{1}{2}\\)',
            annotations: [
                { x: 1, y: '2', text: '$x_{1}$ at \\{p\\}', color: 'red', size: 'large', anchor: 'left' },
                { x: '0', y: '0', z: 3, text: 'peak', color: 'blue', size: 'normal', anchor: 'above' },
                null,
                { text: 'bare' },
            ],
        })
    );
    // Inside math the scanner keeps LaTeX groups verbatim, so math text is not escaped.
    assert.equal(legacy.title, 'Area \\(\\frac{1}{2}\\)');
    assert.deepEqual(legacy.annotations, [
        { x: '1', y: '2', text: '$x_{1}$ at \\(\\{\\)p\\(\\}\\)', color: 'red', size: 'large', anchor: 'left' },
        { x: '0', y: '0', z: '3', text: 'peak', color: 'blue', size: 'normal', anchor: 'above' },
        { x: '0', y: '0', text: 'bare', color: 'black', size: 'normal', anchor: 'above' },
    ]);
    const v4 = migrateSettings({ v: 4, title: 'z = {c}', annotations: [{ x: 'P1_x', y: 'P1_y', text: '{P1_val:2}', color: 'red', size: 'normal', anchor: 'right', hidden: true }] });
    assert.equal(v4.title, 'z = {c}');
    assert.deepEqual(v4.annotations, [{ x: 'P1_x', y: 'P1_y', text: '{P1_val:2}', color: 'red', size: 'normal', anchor: 'right', hidden: true }]);
    assert.equal(escapeTemplate('{a}}'), '{{a}}}}');
    // Dollar signs pair the way the template scanner pairs them: a price opens no math.
    assert.equal(escapeTemplate('costs $5 and {x}'), 'costs $5 and {{x}}');
    assert.equal(escapeTemplate('$z = {c}$ and {d}'), '$z = {c}$ and {{d}}');
});

test('escapeTemplate round-trips legacy text through the v4 template scanner', () => {
    const samples = [
        'plain text',
        'width {w}',
        'a } b { c',
        '{a}}',
        'x_{0}',
        'set \\{1, 2\\}',
        '$x_{1}$',
        '$\\frac{a}{b} + x^{2}$ and {braces}',
        'Area \\(\\frac{1}{2}\\) of {R}',
        '$\\{1, 2\\}$',
        '$\\mathbf{v}_{i}$',
        'cost 5$ only',
    ];
    for (const s of samples) {
        const scanned = scanTemplate(escapeTemplate(s));
        assert.equal(scanned.error, undefined, s);
        assert.ok(scanned.parts.every((p) => p.kind === 'text'), `${s}: no placeholders`);
        assert.equal(scanned.parts.map((p) => (p.kind === 'text' ? p.text : '')).join(''), s);
    }
});

// ---------------------------------------------------------------------------
// Legacy free text: 3.19.6 exported it as raw TeX.
// ---------------------------------------------------------------------------

/** 3.x label text -> v4 label text; the v4 export then typesets what 3.19.6 did. */
const LEGACY_TEXT_CASES: [string, string][] = [
    ['plain text', 'plain text'],
    ['50\\% Marke', '50% Marke'],
    ['R\\&D \\# 1 a\\_b', 'R&D # 1 a_b'],
    ['set \\{1, 2\\}', 'set \\(\\{\\)1, 2\\(\\}\\)'],
    ['Profit in \\textbf{EUR}', 'Profit in \\(\\textbf{EUR}\\)'],
    ['\\emph{note}', '\\(\\textit{note}\\)'],
    ['\\textbf {x} and \\textcolor{red}{y}', '\\(\\textbf{x}\\) and \\(\\textcolor{red}{y}\\)'],
    ['{\\bf Profit} in EUR', '\\(\\textbf{Profit}\\) in EUR'],
    ['\\itshape all of it', '\\(\\textit{all of it}\\)'],
    ['{\\color{red} hot} stuff', '\\(\\textcolor{red}{hot}\\) stuff'],
    ['{\\small small} print\\noindent', 'small print'],
    ['\\LaTeX{} rocks', '\\(\\mbox{\\LaTeX}\\) rocks'],
    ['Kosten \\& Erl\\"ose', 'Kosten & Erlöse'],
    ['Erl\\"{o}se, \\\'{e}t\\\'e, \\c{c}a, \\v c, \\\'\\i', 'Erlöse, été, ça, č, í'],
    ['Stra\\ss e, Stra\\ss{}e', 'Straße, Straße'],
    ['\\d{e}', '\\(\\mbox{\\d{e}}\\)'],
    ['cost \\$5', 'cost \\(\\$\\)5'],
    ['costs 5$ only, $5 and $10', 'costs 5$ only, $5 and $10'],
    ['a~b\\,c\\\\d\\-e', 'a b c de'],
    ['\\textbackslash{} and \\^{}', '\\(\\backslash\\) and ^'],
    ['x_{0} and R_1, x^2', 'x\\(_{0}\\) and R\\(_1\\), x\\(^2\\)'],
    ['\\alpha\\beta and \\alpha$x$', '\\(\\alpha \\beta\\) and \\(\\alpha\\)$x$'],
    ['\\textbf{costs $5$}\\textit{a \\(x\\)} and \\textit{a} {b}', '\\(\\textbf{costs $5$} \\textit{a $x$}\\) and \\(\\textit{a}\\) b'],
    ['width {w} and 1{,}5', 'width w and 1,5'],
    ['$x_{1}$ at \\(\\frac{a}{b}\\) and $$y$$', '$x_{1}$ at \\(\\frac{a}{b}\\) and $$y$$'],
];

test('legacyTexToText: TeX escapes, accents, commands and font switches become v4 label text', () => {
    for (const [raw, expected] of LEGACY_TEXT_CASES) assert.equal(legacyTexToText(raw), expected, raw);
});

test('legacyTexToText for templates: TeX groups in math that would interpolate become \\mathord', () => {
    assert.equal(legacyTexToText('$p = 1{,}5$ and \\(\\frac {a}{b}\\)', true), '$p = 1\\mathord{,}5$ and \\(\\frac{a}{b}\\)');
    assert.equal(legacyTexToText('$x^ {2} + {}^{14}C$', true), '$x^{2} + \\mathord{}^{14}C$');
    // Plain-text fields (axis labels, legend entries) are no templates: their math stays as typed.
    assert.equal(legacyTexToText('$p = 1{,}5$'), '$p = 1{,}5$');
    const scanned = scanTemplate(escapeTemplate(legacyTexToText('Preis $p = 1{,}5$', true)));
    assert.ok(scanned.parts.every((p) => p.kind === 'text'), 'no placeholders');
});

test('legacyTexToText output is a placeholder-free template whose export has no stray backslashes', () => {
    for (const [raw] of LEGACY_TEXT_CASES) {
        const text = legacyTexToText(raw, true);
        const scanned = scanTemplate(escapeTemplate(text));
        assert.equal(scanned.error, undefined, raw);
        assert.ok(scanned.parts.every((p) => p.kind === 'text'), `${raw}: no placeholders`);
        assert.equal(scanned.parts.map((p) => (p.kind === 'text' ? p.text : '')).join(''), text, raw);
        if (!raw.includes('textbackslash')) assert.ok(!texText(text).includes('\\textbackslash'), `${raw}: ${texText(text)}`);
    }
});

test('3.x free text is converted: title, axis labels, legend entries, annotations, tool labels; v4 blocks are untouched', () => {
    const fields = {
        title: 'Profit in \\textbf{EUR}',
        axis_label_x: 'Anteil in \\%',
        axis_label_y: 'Preis~in \\$',
        axis_label_z: 'H\\"ohe',
        axis_label_x_polar: '$\\theta$ \\& r',
        axis_label_y_polar: '',
        functions: [legacyFunction({ name: 'f', expression: 'x', domain: '0:5', showLegend: true, legendLabel: 'Kosten \\& Erl\\"ose' })],
        annotations: [{ x: '1', y: '1', text: 'R\\&D share', color: 'black', size: 'normal', anchor: 'center' }],
        tools: [
            { type: 'horizontalLine', y: '2', color: 'blue', thickness: 'thin', dashed: false, label: '50\\% Marke' },
            { type: 'brace', x1: '0', y1: '0', x2: '4', y2: '0', color: 'blue', label: '\\textit{width}' },
            { type: 'point3D', x: '0', y: '0', z: '0', color: 'red', label: 'Gipfel \\{max\\}' },
        ],
    };
    const out = migrateSettings(legacyBlock(clone(fields)));
    assert.equal(out.title, 'Profit in \\(\\textbf{EUR}\\)');
    assert.equal(out.axis_label_x, 'Anteil in %');
    assert.equal(out.axis_label_y, 'Preis in \\(\\$\\)');
    assert.equal(out.axis_label_z, 'Höhe');
    assert.equal(out.axis_label_x_polar, '$\\theta$ & r');
    assert.equal(out.axis_label_y_polar, '');
    assert.equal((out.functions as FunctionParameters[])[0].legendLabel, 'Kosten & Erlöse');
    assert.equal((out.annotations as { text: string }[])[0].text, 'R&D share');
    assert.deepEqual(
        (out.tools as Tool[]).map((t) => ('label' in t ? t.label : '')),
        ['50% Marke', '\\(\\textit{width}\\)', 'Gipfel \\(\\{\\)max\\(\\}\\)']
    );

    const v4 = migrateSettings({ v: 4, ...clone(fields), functions: [{ name: 'f', expression: 'x', domain: '0:5', legendLabel: 'R\\&D' }] });
    assert.equal(v4.title, fields.title);
    assert.equal(v4.axis_label_x, fields.axis_label_x);
    assert.equal(v4.axis_label_y, fields.axis_label_y);
    assert.equal((v4.functions as FunctionParameters[])[0].legendLabel, 'R\\&D');
    assert.equal((v4.annotations as { text: string }[])[0].text, 'R\\&D share');
});

test('3.x TeX labels export the way 3.19.6 typeset them', () => {
    const code = SettingsManager.fromJSON(
        legacyBlock({
            title: 'Profit in \\textbf{EUR}',
            axis_label_x: 'Anteil in \\%',
            xmin: '0',
            ymin: '0',
            functions: [legacyFunction({ name: 'f', expression: 'x/2', domain: '0:9', showLegend: true, legendLabel: 'Kosten \\& Erl\\"ose' })],
            annotations: [
                { x: '6', y: '4', text: 'R\\&D share', color: 'black', size: 'normal', anchor: 'center' },
                { x: '6', y: '3', text: '\\textit{note}', color: 'black', size: 'normal', anchor: 'center' },
            ],
            tools: [{ type: 'horizontalLine', y: '2', color: 'blue', thickness: 'thin', dashed: false, label: '50\\% Marke' }],
        })
    ).generateTikzCode();
    for (const expected of [
        'title={Profit in \\(\\textbf{EUR}\\)}',
        'xlabel={Anteil in \\%}',
        '\\addlegendentry{Kosten \\& Erlöse}',
        '{R\\&D share}',
        '{\\(\\textit{note}\\)}',
        '{50\\% Marke}',
    ]) {
        assert.ok(code.includes(expected), `${expected} in\n${code}`);
    }
    assert.ok(!code.includes('\\textbackslash'), code);
});

test('3.x blocks: blank range fields fall back to the defaults without an error; v4 keeps them', () => {
    const out = migrateSettings(legacyBlock({ xmin: '', ymax: '  ', zmin: '-2' }));
    assert.equal('xmin' in out, false);
    assert.equal('ymax' in out, false);
    assert.equal(out.zmin, '-2');

    const legacy = SettingsManager.fromJSON(
        legacyBlock({ xmin: '', xmax: '10', functions: [legacyFunction({ expression: 'sqrt(x)', domain: '0:9' })] })
    );
    assert.equal(legacy.getValue('xmin'), '-0.5');
    const { view, errors } = legacy.resolveView(legacy.createMathContext());
    assert.equal(view.xmin, -0.5);
    assert.deepEqual(errors, []);

    // A v4 block was written by the v4 editor, which reports a blank bound.
    assert.equal(migrateSettings({ v: 4, xmin: '' }).xmin, '');
});

// ---------------------------------------------------------------------------
// Whole-block rules
// ---------------------------------------------------------------------------

test('migrate is idempotent on legacy blocks of every tool type', () => {
    const block = legacyBlock({
        title: 'Plot {1}',
        functions: [
            legacyFunction({ name: 'left curve', expression: 'x^2', domain: '0:3' }),
            legacyFunction({ name: '', expression: 'sqrt(x)', domain: '' }),
            legacyFunction({ name: 'x', expression: '1', domain: '0:1' }),
            legacyFunction({ name: 'x', expression: '2', domain: '0:1' }),
        ],
        annotations: [{ x: '1', y: '1', text: '{a}', color: 'black', size: 'normal', anchor: 'above' }],
        tools: [
            { type: 'areaBetween', func1Name: 'left curve', func2Name: 'f2', domain: '0:1', color: 'blue', fillOpacity: 0.3, fillPattern: 'solid' },
            { type: 'intersection', func1Name: 'x', func2Name: 'left curve', color: 'red', showLabels: true },
            { type: 'verticalLine', x: '-1', color: 'blue', thickness: 'thin', dashed: true, label: '{l}' },
            { type: 'horizontalLine', y: 'a+b', color: 'blue', thickness: 'thin', dashed: true, label: '' },
            { type: 'rectangle', x1: 'a', y1: '0', x2: '1', y2: '2', color: 'blue', thickness: 'thin', fill: true, fillOpacity: 0.2, fillPattern: 'solid' },
            { type: 'circle', cx: '1', cy: '1', r: '1', color: 'blue', thickness: 'thin', fill: true, fillOpacity: 0.2, fillPattern: 'solid' },
            { type: 'segment', x1: '0', y1: '0', x2: '1', y2: '1', color: 'blue', thickness: 'thin', dashed: false, arrow: 'backward' },
            { type: 'brace', x1: '0', y1: '0', x2: '1', y2: '0', color: 'blue', label: 'b' },
            { type: 'plane3D', axis: 'y', value: '2', color: 'blue', fillOpacity: 0.25 },
            { type: 'point3D', x: '0', y: '0', z: '0', color: 'red', label: '' },
            { type: 'segment3D', x1: '0', y1: '0', z1: '0', x2: '1', y2: '1', z2: '1', color: 'blue', thickness: 'thin', dashed: false, arrow: 'none' },
        ],
    });
    const once = migrateSettings(clone(block));
    const twice = migrateSettings(clone(once));
    assert.deepEqual(twice, once);
    // Deterministic: a second, independent migration gives the same ids and names.
    assert.deepEqual(migrateSettings(clone(block)), once);
    assert.equal(once.v, SCHEMA_VERSION);
    assert.equal('documentClose' in once, false);
    assert.deepEqual((once.functions as FunctionParameters[]).map((f) => f.name), ['left_curve', 'f2', 'x2', 'x3']);
});

test('documentSetup folding: standalone = documentSetup !== false, documentClose dropped', () => {
    const cases: [unknown, unknown, boolean][] = [
        [true, true, true],
        [true, false, true],
        [false, true, false],
        [false, false, false],
        [undefined, undefined, true],
    ];
    for (const [setup, close, expected] of cases) {
        const block: Record<string, unknown> = {};
        if (setup !== undefined) block.documentSetup = setup;
        if (close !== undefined) block.documentClose = close;
        const out = migrateSettings(block);
        assert.equal(out.documentSetup, expected, `documentSetup=${String(setup)}, documentClose=${String(close)}`);
        assert.equal('documentClose' in out, false);
    }
});

test('hidden for expression-with-empty-domain functions only in blocks without v', () => {
    const fns = [
        legacyFunction({ name: 'a1', expression: 'x', domain: '' }),
        legacyFunction({ name: 'a2', expression: '', domain: '' }),
        legacyFunction({ name: 'a3', expression: 'x', domain: '   ' }),
        legacyFunction({ name: 'a4', expression: 'x', domain: '0:1' }),
    ];
    const legacy = migrateSettings(legacyBlock({ functions: clone(fns) })).functions as FunctionParameters[];
    assert.deepEqual(legacy.map((f) => f.hidden === true), [true, false, true, false]);
    const v4 = migrateSettings({ v: 4, functions: clone(fns) }).functions as FunctionParameters[];
    assert.deepEqual(v4.map((f) => f.hidden === true), [false, false, false, false]);
    // An explicit hidden flag survives in v4 blocks.
    const kept = migrateSettings({ v: 4, functions: [{ name: 'h', expression: 'x', domain: '', hidden: true }] }).functions as FunctionParameters[];
    assert.equal(kept[0].hidden, true);
});

test('new keys get defaults; ranges become strings; existing v4 values are kept', () => {
    const out = migrateSettings(legacyBlock({ xmin: 0, xmax: 5, ymin: null, ymax: '4.5' }));
    assert.equal(out.v, 4);
    assert.deepEqual(out.parameters, []);
    assert.equal(out.variables, 'x, y');
    assert.equal(out.equalScale, false);
    assert.equal(out.showSlidersInNote, true);
    assert.equal(out.xmin, '0');
    assert.equal(out.xmax, '5');
    assert.equal('ymin' in out, false);
    assert.equal(out.ymax, '4.5');
    assert.equal(out.previewSize, 760);
    const v4 = migrateSettings({ v: 4, variables: 'q, p', equalScale: true, showSlidersInNote: false });
    assert.equal(v4.variables, 'q, p');
    assert.equal(v4.equalScale, true);
    assert.equal(v4.showSlidersInNote, false);
});

test('migrateSettings never throws on garbage', () => {
    const inputs: unknown[] = [
        null,
        undefined,
        42,
        'text',
        [],
        { functions: 'x^2', tools: {}, parameters: 7, annotations: 'a' },
        { functions: [null, 1, 'x', [], { expression: 5, domain: 3, name: 7, fillOpacity: '0.5' }] },
        { tools: [{ type: 'region', conditions: 'x <= 1', conditionLabels: [1, 2, 3] }, { type: 'points', dim: 7, source: 'magic' }] },
    ];
    for (const input of inputs) {
        const out = migrateSettings(input as Record<string, unknown>);
        assert.equal(out.v, 4);
        assert.deepEqual(migrateSettings(clone(out)), out);
    }
    const coerced = migrateSettings({ v: 4, functions: [{ expression: 5, domain: 3, name: 7, fillOpacity: '0.5' }] }).functions as FunctionParameters[];
    assert.deepEqual(coerced, [v4Function({ expression: '5', domain: '3', name: 'f_7', fillOpacity: 0.5 })]);
    const regions = migrateSettings({ v: 4, tools: [{ type: 'region', conditions: 'x <= 1', conditionLabels: [1, 2, 3] }] }).tools as Tool[];
    assert.ok(regions[0].type === 'region');
    if (regions[0].type === 'region') {
        assert.deepEqual(regions[0].conditions, ['x <= 1']);
        assert.deepEqual(regions[0].conditionLabels, ['1']);
    }
});

// ---------------------------------------------------------------------------
// normalizeFunctions
// ---------------------------------------------------------------------------

test('normalizeFunctions: spaces, duplicates, reserved, blank, leading digits', () => {
    const { functions, renames } = normalizeFunctions([
        { name: 'left curve', expression: 'x' },
        { name: 'g', expression: 'x' },
        { name: 'g', expression: 'x' },
        { name: 'sin', expression: 'x' },
        { name: 'e', expression: 'x' },
        { name: '', expression: 'x' },
        { name: '2nd', expression: 'x' },
        { name: '  h  ', expression: 'x' },
        { name: '_u', expression: 'x' },
    ]);
    assert.deepEqual(
        functions.map((f) => f.name),
        ['left_curve', 'g', 'g2', 'sin2', 'e2', 'f6', 'f_2nd', 'h', 'f_u']
    );
    assert.deepEqual(
        [...renames.entries()].sort(),
        [
            ['2nd', 'f_2nd'],
            ['_u', 'f_u'],
            ['e', 'e2'],
            ['g', 'g2'],
            ['left curve', 'left_curve'],
            ['sin', 'sin2'],
        ]
    );
});

test('normalizeFunctions: explicit names keep their spot, blanks move aside; renames follow 3.x lookups', () => {
    // [blank, 'f1']: 3.x resolved 'f1' to the explicit (later) one, which keeps it.
    let r = normalizeFunctions([{ name: '' }, { name: 'f1' }]);
    assert.deepEqual(r.functions.map((f) => f.name), ['f2', 'f1']);
    assert.equal(r.renames.size, 0);
    // ['f2', blank]: 3.x resolved 'f2' to the blank second function (implicit f2, later).
    r = normalizeFunctions([{ name: 'f2' }, { name: '' }]);
    assert.deepEqual(r.functions.map((f) => f.name), ['f2', 'f1']);
    assert.deepEqual([...r.renames.entries()], [['f2', 'f1']]);
    // Name ending in a digit gets an underscore before the counter.
    r = normalizeFunctions([{ name: 'f1' }, { name: 'f1' }]);
    assert.deepEqual(r.functions.map((f) => f.name), ['f1', 'f1_2']);
    // Garbage entries are dropped; implicit names use the raw index.
    r = normalizeFunctions([null, { expression: 'x' }, 'x']);
    assert.deepEqual(r.functions.map((f) => f.name), ['f2']);
    assert.equal(r.renames.size, 0);
    assert.deepEqual(normalizeFunctions('nope').functions, []);
});

test('normalizeFunctions completes missing fields and keeps optional ones', () => {
    const { functions } = normalizeFunctions([
        { expression: 'x^2', name: 'f1', legendLabel: 'Parabola', hidden: true, thickness: 'ultra thick', fillPattern: 'stars', fillOpacity: 3 },
    ]);
    assert.deepEqual(functions, [
        {
            ...v4Function({ expression: 'x^2', name: 'f1', domain: '', fillOpacity: 1 }),
            legendLabel: 'Parabola',
            hidden: true,
        },
    ]);
});

// ---------------------------------------------------------------------------
// normalizeTools (v4 shapes)
// ---------------------------------------------------------------------------

test('normalizeTools completes v4 tools and keeps valid ids / names', () => {
    const tools = normalizeTools(
        [
            { type: 'region', id: 'abc', name: 'Feasible', conditions: ['x >= 0', 'y >= 0'] },
            { type: 'curve', equation: '2x + 3y = 12' },
            { type: 'points', name: 'P9', source: 'region', regionName: ' Feasible ', objective: '2x + 3y', sense: 'min' },
            { type: 'plane3D', axis: 'w', value: 2 },
        ],
        { is3D: true }
    );
    assert.deepEqual(tools, [
        {
            id: 'abc',
            name: 'Feasible',
            type: 'region',
            color: 'blue',
            conditions: ['x >= 0', 'y >= 0'],
            conditionLabels: ['', ''],
            fill: true,
            fillOpacity: 0.25,
            fillPattern: 'solid',
            outline: 'none',
            thickness: 'thin',
            constraintLines: false,
            label: '',
        },
        { id: 't1', name: 'C1', type: 'curve', color: 'black', equation: '2x + 3y = 12', levels: '', thickness: 'thin', dashed: false, label: '' },
        {
            id: 't2',
            name: 'P9',
            type: 'points',
            color: 'red',
            dim: 3,
            source: 'region',
            points: '',
            ref1: '',
            ref2: '',
            regionName: 'Feasible',
            objective: '2x + 3y',
            sense: 'min',
            label: '',
            dropLines: false,
            size: 'normal',
        },
        { id: 't3', name: 'PL1', type: 'plane3D', color: 'orange', axis: 'z', value: '2', fillOpacity: 0.25 },
    ]);
});

test('normalizeTools: duplicate / reserved / taken names and duplicate / existing ids are reassigned', () => {
    const tools = normalizeTools(
        [
            { type: 'curve', id: 'dup', name: 'C1' },
            { type: 'curve', id: 'dup', name: 'C1' },
            { type: 'curve', id: 'taken', name: 'sin' },
            { type: 'curve', id: 'has space', name: 'f1' },
            { type: 'curve', id: 't0', name: 'k' },
        ],
        {
            existingIds: new Set(['taken']),
            functions: [v4Function({ name: 'f1' })],
            takenNames: ['k'],
        }
    );
    assert.deepEqual(
        tools.map((t) => [t.id, t.name]),
        [
            ['dup', 'C1'],
            ['t1', 'C2'],
            ['t2', 'C3'],
            ['t3', 'C4'],
            ['t0', 'C5'],
        ]
    );
    // A migrated id that clashes with a kept one gets a suffix.
    const clash = normalizeTools([{ type: 'curve' }, { type: 'curve', id: 't0' }], {});
    assert.deepEqual(clash.map((t) => t.id), ['t0_2', 't0']);
});

test('normalizeTools applies function renames to v4 points references', () => {
    const tools = normalizeTools([{ type: 'points', source: 'intersections', ref1: 'left curve', ref2: 'C1' }], {
        renames: new Map([['left curve', 'left_curve']]),
    });
    assert.ok(tools[0].type === 'points');
    if (tools[0].type === 'points') {
        assert.equal(tools[0].ref1, 'left_curve');
        assert.equal(tools[0].ref2, 'C1');
        assert.equal(tools[0].dim, 2);
    }
});

// ---------------------------------------------------------------------------
// Parameters
// ---------------------------------------------------------------------------

test('normalizeParameters edge cases', () => {
    const params = normalizeParameters([
        { name: 'a', value: '2', min: '0', max: '5', step: '0.5' },
        { name: 'b', value: 1, min: 5, max: -5, step: 0.1 },
        { name: 'c', value: 0, min: 0, max: 1, step: 0 },
        { name: 'd', value: 20, min: 0, max: 10, step: 1 },
        { name: 'k', min: 2, max: 3 },
        { name: 'm', value: 3, min: 3, max: 3, step: 1 },
        { name: ' n ', value: 'abc' },
        { name: 'x', value: 1 },
        { name: 'sin', value: 1 },
        { name: '2a', value: 1 },
        { name: '', value: 1 },
        { name: 'a', value: 9 },
        { name: 'a b', value: 1 },
        null,
        'p',
    ]);
    assert.deepEqual(params, [
        { name: 'a', value: 2, min: 0, max: 5, step: 0.5 },
        { name: 'b', value: 1, min: -5, max: 5, step: 0.1 },
        { name: 'c', value: 0, min: 0, max: 1, step: 0.01 },
        { name: 'd', value: 20, min: 0, max: 20, step: 1 },
        { name: 'k', value: 2, min: 2, max: 3, step: 0.01 },
        { name: 'm', value: 3, min: 2, max: 4, step: 1 },
        { name: 'n', value: 1, min: -10, max: 10, step: 0.1 },
    ]);
    assert.deepEqual(normalizeParameters(undefined), []);
    assert.deepEqual(normalizeParameters(params), params);
});

test('defaultParameter: defaults, clamping, name choice', () => {
    assert.deepEqual(defaultParameter([]), { name: 'a', value: 1, min: -10, max: 10, step: 0.1 });
    assert.deepEqual(defaultParameter(['a'], 'k', 50), { name: 'k', value: 10, min: -10, max: 10, step: 0.1 });
    assert.equal(defaultParameter(['a'], 'a').name, 'b');
    assert.equal(defaultParameter([], 'pi').name, 'a');
    assert.equal(defaultParameter([], undefined, Number.NaN).value, 1);
});

// ---------------------------------------------------------------------------
// Names, ids, defaults
// ---------------------------------------------------------------------------

test('nextParameterName / nextFunctionName / nextToolName', () => {
    const letters = ['a', 'b', 'c', 'd', 'k', 'm', 'n', 'p', 'q', 'r', 's', 'u', 'v', 'w'];
    assert.equal(nextParameterName([]), 'a');
    assert.equal(nextParameterName(['a', 'b', 'c', 'd']), 'k');
    assert.equal(nextParameterName(letters), 'a2');
    assert.equal(nextParameterName([...letters, 'a2']), 'b2');
    assert.equal(nextParameterName(new Set(['a'])), 'b');
    assert.ok(letters.every((l) => !RESERVED_NAMES.has(l)));

    assert.equal(nextFunctionName([]), 'f1');
    assert.equal(nextFunctionName(['f1', 'f3']), 'f2');
    assert.equal(nextFunctionName(['f1', 'f2']), 'f3');

    assert.equal(nextToolName('region', []), 'R1');
    assert.equal(nextToolName('region', ['R1', 'R2']), 'R3');
    assert.equal(nextToolName('curve', ['R1']), 'C1');
    assert.equal(nextToolName('points', ['PL1']), 'P1');
    assert.equal(nextToolName('segment', ['S2']), 'S1');
    assert.equal(nextToolName('plane3D', ['P1']), 'PL1');
});

test('newId is short, random-looking and never looks like a migrated id', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 500; i++) {
        const id = newId();
        assert.match(id, /^[a-z][a-z0-9]{5}$/);
        assert.notEqual(id[0], 't');
        seen.add(id);
    }
    assert.ok(seen.size > 490);
});

test('RESERVED_NAMES covers variables, constants, builtins and keywords', () => {
    for (const name of ['x', 'y', 'z', 't', 'theta', 'pi', 'PI', 'e', 'E', 'true', 'false', 'SQRT1_2', 'LN10']) {
        assert.ok(RESERVED_NAMES.has(name), name);
    }
    for (const name of ['sin', 'atan2', 'log1p', 'expm1', 'fround', 'random', 'ln', 'sec', 'csc', 'cot', 'hypot', 'Math', 'and', 'or']) {
        assert.ok(RESERVED_NAMES.has(name), name);
    }
    for (const name of ['a', 'f1', 'R1', 'c', 'k']) assert.ok(!RESERVED_NAMES.has(name), name);
});

test('defaultTool: regions cycle through the palette at opacity 0.25', () => {
    const tools: Tool[] = [];
    const colors: string[] = [];
    for (let i = 0; i < 11; i++) {
        const t = defaultTool('region', { is3D: false, tools, functions: [] });
        assert.ok(t.type === 'region');
        if (t.type === 'region') assert.equal(t.fillOpacity, 0.25);
        colors.push(t.color);
        tools.push(t);
    }
    assert.deepEqual(colors.slice(0, 9), ['blue', 'orange', 'green', 'purple', 'red', 'teal', 'magenta', 'brown', 'gray']);
    assert.equal(new Set(colors.slice(0, 9)).size, 9);
    assert.deepEqual(tools.map((t) => t.name).slice(0, 3), ['R1', 'R2', 'R3']);
    assert.equal(new Set(tools.map((t) => t.id)).size, tools.length);
    // A freed colour is reused first.
    const reuse = defaultTool('region', { is3D: false, tools: tools.slice(1, 4), functions: [] });
    assert.equal(reuse.color, 'blue');
});

test('defaultTool: names avoid functions, dims follow the chart', () => {
    const fns = [v4Function({ name: 'C1' })];
    const curve = defaultTool('curve', { is3D: false, tools: [], functions: fns });
    assert.equal(curve.name, 'C2');
    const p3 = defaultTool('points', { is3D: true, tools: [], functions: [] });
    assert.ok(p3.type === 'points' && p3.dim === 3);
    const s2 = defaultTool('segment', { is3D: false, tools: [], functions: [] });
    assert.ok(s2.type === 'segment' && s2.dim === 2);
    const plane = defaultTool('plane3D', { is3D: true, tools: [], functions: [] });
    assert.ok(plane.type === 'plane3D' && plane.name === 'PL1');
    for (const t of [curve, p3, s2, plane]) {
        assert.deepEqual(normalizeTools([t], {}), [t]);
    }
});

test('defaultFunction is a complete, stable blank card', () => {
    const fn = defaultFunction(['f1', 'f2']);
    assert.equal(fn.name, 'f3');
    assert.equal(fn.domain, '');
    assert.equal(fn.color, 'black');
    assert.equal(defaultFunction([], 'red').color, 'red');
    assert.deepEqual(normalizeFunctions([fn]).functions, [fn]);
});

// ---------------------------------------------------------------------------
// Recipes
// ---------------------------------------------------------------------------

function ctxOf(fields: Partial<RecipeContext>): RecipeContext {
    return { is3D: false, functions: [], tools: [], parameters: [], ...fields };
}

function assertStructurallyValid(ctx: RecipeContext, id: string): void {
    const recipe = recipes(ctx.is3D).find((r) => r.id === id);
    assert.ok(recipe, id);
    if (!recipe) return;
    const res = recipe.build(ctx);
    const names = new Set([...ctx.functions.map((f) => f.name), ...ctx.tools.map((t) => t.name), ...ctx.parameters.map((p) => p.name)]);
    switch (res.kind) {
        case 'function':
            assert.deepEqual(normalizeFunctions([res.fn]).functions, [res.fn], id);
            assert.ok(!names.has(res.fn.name), `${id}: name clash`);
            if (res.surface) {
                const out = migrateSettings({ v: 4, functions3D: [res.surface] });
                assert.deepEqual(out.functions3D, [res.surface], id);
            }
            break;
        case 'tool': {
            const normalized = normalizeTools([res.tool], { is3D: ctx.is3D });
            assert.deepEqual(normalized, [res.tool], id);
            assert.ok(!names.has(res.tool.name), `${id}: name clash`);
            assert.ok(!ctx.tools.some((t) => t.id === res.tool.id), `${id}: id clash`);
            if (res.tool.type === 'points' || res.tool.type === 'segment') assert.equal(res.tool.dim, ctx.is3D ? 3 : 2, id);
            break;
        }
        case 'parameter':
            assert.deepEqual(normalizeParameters([res.parameter]), [res.parameter], id);
            assert.ok(!names.has(res.parameter.name), `${id}: name clash`);
            break;
        case 'label':
            break;
    }
}

test('recipes: the documented lists, unique ids, sections and plain-language text', () => {
    const sections = ['Functions', 'Regions', 'Curves and lines', 'Points', 'Segments and arrows', 'Labels', 'Sliders', '3D'];
    for (const is3D of [false, true]) {
        const list = recipes(is3D);
        assert.equal(new Set(list.map((r) => r.id)).size, list.length);
        for (const r of list) {
            assert.ok(sections.includes(r.section), r.id);
            assert.ok(r.label.length > 2 && r.hint.length > 10, r.id);
            assert.ok(!/\u2014/.test(r.label + r.hint), r.id);
            assert.ok(r.available(ctxOf({ is3D })), r.id);
            assert.ok(!r.available(ctxOf({ is3D: !is3D })), r.id);
        }
    }
    assert.deepEqual(
        recipes(false).map((r) => r.id),
        [
            'function', 'parametric', 'area-between', 'area-under', 'feasible-region', 'rectangle', 'disk',
            'vertical-line', 'horizontal-line', 'line-equation', 'circle', 'level-curves',
            'points-list', 'intersections', 'corner-points', 'optimum', 'lattice',
            'segment', 'arrow', 'polyline', 'brace', 'label', 'slider',
        ]
    );
    assert.deepEqual(recipes(true).map((r) => r.id), ['surface', 'plane', 'point', 'segment', 'arrow', 'label', 'slider']);
});

test('recipes build structurally valid items on an empty and on a populated chart', () => {
    const populated = ctxOf({
        functions: [v4Function({ name: 'f1', expression: 'x^2', domain: '' }), v4Function({ name: 'f2', expression: 'x', domain: '' })],
        tools: [
            { id: 'r1', name: 'R1', type: 'region', color: 'blue', conditions: ['x >= 0'], conditionLabels: [''], fill: true, fillOpacity: 0.25, fillPattern: 'solid', outline: 'none', thickness: 'thin', constraintLines: false, label: '' },
        ],
        parameters: [{ name: 'a', value: 1, min: 0, max: 2, step: 0.1 }],
    });
    for (const ctx of [ctxOf({}), populated, ctxOf({ is3D: true }), ctxOf({ is3D: true, parameters: populated.parameters })]) {
        for (const r of recipes(ctx.is3D)) assertStructurallyValid(ctx, r.id);
    }
});

test('recipes reuse the first two functions and the first region', () => {
    const ctx = ctxOf({
        functions: [
            v4Function({ name: 'p', expression: 'cos(t)', parametric: true, expressionY: 'sin(t)' }),
            v4Function({ name: 'demand', expression: '10 - x', domain: '' }),
            v4Function({ name: 'supply', expression: '2 + x', domain: '' }),
        ],
        tools: [
            { id: 'c1', name: 'C1', type: 'curve', color: 'black', equation: 'x = 1', levels: '', thickness: 'thin', dashed: false, label: '' },
            { id: 'r9', name: 'Feasible', type: 'region', color: 'blue', conditions: ['x >= 0'], conditionLabels: [''], fill: true, fillOpacity: 0.25, fillPattern: 'solid', outline: 'none', thickness: 'thin', constraintLines: false, label: '' },
        ],
    });
    const build = (id: string) => {
        const r = recipes(false).find((x) => x.id === id);
        if (!r) throw new Error(id);
        return r.build(ctx);
    };
    const area = build('area-between');
    assert.ok(area.kind === 'tool' && area.tool.type === 'region');
    if (area.kind === 'tool' && area.tool.type === 'region') {
        assert.deepEqual(area.tool.conditions, ['supply <= y <= demand']);
        assert.equal(area.tool.name, 'R1');
        assert.equal(area.tool.color, 'orange');
    }
    const under = build('area-under');
    if (under.kind === 'tool' && under.tool.type === 'region') {
        assert.deepEqual(under.tool.conditions, ['min(0, demand) <= y <= max(0, demand)', '1 <= x <= 4']);
    } else assert.fail('area-under');
    const inter = build('intersections');
    if (inter.kind === 'tool' && inter.tool.type === 'points') {
        assert.equal(inter.tool.ref1, 'demand');
        assert.equal(inter.tool.ref2, 'supply');
        assert.equal(inter.tool.source, 'intersections');
    } else assert.fail('intersections');
    for (const id of ['corner-points', 'optimum', 'lattice']) {
        const res = build(id);
        if (res.kind === 'tool' && res.tool.type === 'points') assert.equal(res.tool.regionName, 'Feasible', id);
        else assert.fail(id);
    }
    const line = build('vertical-line');
    if (line.kind === 'tool') assert.equal(line.tool.name, 'C2');
    // One function plus a curve: the curve fills the second intersection slot.
    const one = recipes(false).find((x) => x.id === 'intersections');
    const res = one && one.build(ctxOf({ functions: [ctx.functions[1]], tools: [ctx.tools[0]] }));
    if (res && res.kind === 'tool' && res.tool.type === 'points') assert.deepEqual([res.tool.ref1, res.tool.ref2], ['demand', 'C1']);
    else assert.fail('intersections with a curve');
});

test('recipes without functions or regions fall back to self-contained formulas', () => {
    const ctx = ctxOf({});
    for (const id of ['area-between', 'area-under']) {
        const res = recipes(false).find((x) => x.id === id)?.build(ctx);
        if (res && res.kind === 'tool' && res.tool.type === 'region') {
            assert.ok(res.tool.conditions.every((c) => !/\bf\d/.test(c)), id);
            assert.ok(res.tool.conditions[0].length > 0, id);
        } else assert.fail(id);
    }
    const one = ctxOf({ functions: [v4Function({ name: 'f1', expression: 'x', domain: '' })] });
    const res = recipes(false).find((x) => x.id === 'area-between')?.build(one);
    if (res && res.kind === 'tool' && res.tool.type === 'region') assert.deepEqual(res.tool.conditions, ['min(f1, 0) <= y <= max(f1, 0)']);
    else assert.fail('area-between with one function');
    // Polar charts: function bodies are r(theta), so no y = f(x) references.
    const polar = recipes(false).find((x) => x.id === 'area-between')?.build({ ...one, polar: true });
    if (polar && polar.kind === 'tool' && polar.tool.type === 'region') assert.ok(!/\bf1\b/.test(polar.tool.conditions[0]));
    else assert.fail('area-between in polar');
    const slider = recipes(false).find((x) => x.id === 'slider')?.build(ctxOf({ functions: [v4Function({ name: 'a' })] }));
    if (slider && slider.kind === 'parameter') assert.equal(slider.parameter.name, 'b');
    else assert.fail('slider');
});

// ---------------------------------------------------------------------------
// Examples
// ---------------------------------------------------------------------------

test('EXAMPLES: the six documented ids, complete and migrateSettings-stable', () => {
    assert.deepEqual(EXAMPLES.map((e) => e.id), ['lp', 'areas', 'tangent', 'levels', 'surplus', 'plane3d']);
    const required = [
        'v', 'dimension', 'documentSetup', 'title', 'size_x_cm', 'size_y_cm', 'show_axis_label', 'axis_label_x',
        'axis_label_y', 'showAxis', 'showLargeGrid', 'showSmallGrid', 'gridSize', 'xmin', 'xmax', 'ymin', 'ymax',
        'zmin', 'zmax', 'axis_style', 'functions', 'functions3D', 'tools', 'annotations', 'parameters', 'variables',
        'equalScale', 'showSlidersInNote', 'coordinateSystem', 'previewSize', 'majorTickNum',
    ];
    for (const ex of EXAMPLES) {
        for (const key of required) assert.ok(key in ex.data, `${ex.id}: ${key}`);
        assert.equal(ex.data.dimension, ex.is3D, ex.id);
        assert.ok(ex.title && ex.description, ex.id);
        assert.ok(!/\u2014/.test(JSON.stringify(ex)), ex.id);
        for (const axis of ['x', 'y', 'z']) {
            const lo = ex.data[`${axis}min`];
            const hi = ex.data[`${axis}max`];
            assert.ok(typeof lo === 'string' && typeof hi === 'string', `${ex.id}: ${axis} range is text`);
            assert.ok(Number(lo) < Number(hi), `${ex.id}: ${axis} range is ordered`);
        }
        assert.deepEqual(migrateSettings(clone(ex.data)), ex.data, ex.id);
        const tools = ex.data.tools as Tool[];
        assert.equal(new Set(tools.map((t) => t.id)).size, tools.length, ex.id);
        assert.equal(new Set(tools.map((t) => t.name)).size, tools.length, ex.id);
    }
});

test('EXAMPLES: hand-checked optimisation math', () => {
    // LP: corners of x + y <= 4, x + 3y <= 6, x, y >= 0 and the max of 2x + 3y.
    const lp = EXAMPLES[0].data;
    const c = (lp.parameters as Parameter[])[0];
    const corners = [[0, 0], [4, 0], [3, 1], [0, 2]];
    for (const [x, y] of corners) assert.ok(x + y <= 4 + 1e-12 && x + 3 * y <= 6 + 1e-12);
    const values = corners.map(([x, y]) => 2 * x + 3 * y);
    assert.equal(Math.max(...values), 9);
    assert.deepEqual(corners[values.indexOf(9)], [3, 1]);
    assert.equal(c.name, 'c');
    assert.equal(c.value, 9);
    assert.ok(Number(lp.xmax) >= 4.5 && Number(lp.ymax) >= 3, 'objective line c = 9 is visible');

    // Levels: closest point of x + 2y = 4 to the origin is 4/5 * (1, 2).
    const t = 4 / 5;
    near(t * 1, 0.8);
    near(t * 2, 1.6);
    near(0.8 * 0.8 + 1.6 * 1.6, 3.2, 1e-12);
    const levels = EXAMPLES[3].data.tools as Tool[];
    const c1 = levels.find((x) => x.name === 'C1');
    assert.ok(c1 && c1.type === 'curve' && c1.levels.split(',').map(Number).includes(3.2));

    // Surplus: equilibrium (8 / (1 + a), 10 - 8a / (1 + a)) stays inside the view for every a.
    const surplus = EXAMPLES[4].data;
    const a = (surplus.parameters as Parameter[])[0];
    for (const av of [a.min, a.value, a.max]) {
        const q = 8 / (1 + av);
        const p = 2 + q;
        assert.ok(q > Number(surplus.xmin) && q < Number(surplus.xmax), `q at a=${av}`);
        assert.ok(p > Number(surplus.ymin) && p < Number(surplus.ymax), `p at a=${av}`);
    }
});

/** Expression fields of an example, with the validate kind for each. */
function exampleFields(data: Record<string, unknown>): [string, Parameters<MathContext['validate']>[1]][] {
    const out: [string, Parameters<MathContext['validate']>[1]][] = [];
    for (const f of data.functions as FunctionParameters[]) {
        out.push([f.expression, 'fn1']);
        if (f.domain) out.push([f.domain, 'domain']);
        if (f.tangentPoint && !/^(min|max)\d*$/.test(f.tangentPoint)) out.push([f.tangentPoint, 'value']);
    }
    for (const t of data.tools as Tool[]) {
        if (t.type === 'region') {
            for (const c of t.conditions) out.push([c, 'condition']);
            out.push([t.label, 'template']);
        } else if (t.type === 'curve') {
            out.push([t.equation, 'equation']);
            if (t.levels) out.push([t.levels, 'levels']);
        } else if (t.type === 'points') {
            if (t.objective) out.push([t.objective, 'fn2']);
            if (t.points) out.push([t.points, t.dim === 3 ? 'tuples3' : 'tuples2']);
        } else if (t.type === 'plane3D') {
            out.push([t.value, 'value']);
        }
    }
    for (const a of data.annotations as { x: string; y: string; z?: string }[]) {
        out.push([a.x, 'value'], [a.y, 'value']);
        if (a.z !== undefined) out.push([a.z, 'value']);
    }
    return out;
}

function contextFor(data: Record<string, unknown>): MathContext {
    return MathContext.create({
        parameters: data.parameters as Parameter[],
        functions: data.functions as FunctionParameters[],
        variables: data.variables as string,
        toolNames: (data.tools as Tool[]).map((t) => t.name),
    });
}

test('EXAMPLES and recipe formulas validate with the expression engine', () => {
    let checked = 0;
    for (const ex of EXAMPLES) {
        const math = contextFor(ex.data);
        for (const [src, kind] of exampleFields(ex.data)) {
            const res = math.validate(src, kind);
            assert.ok(res.ok, `${ex.id}: ${kind} '${src}': ${res.ok ? '' : res.message}`);
            checked++;
        }
    }
    const math = contextFor({ parameters: [], functions: [], variables: 'x, y', tools: [] });
    for (const r of recipes(false)) {
        const res = r.build(ctxOf({}));
        if (res.kind !== 'tool') continue;
        const data = { functions: [], tools: [res.tool], annotations: [] };
        for (const [src, kind] of exampleFields(data)) {
            if (!src) continue;
            const v = math.validate(src, kind);
            assert.ok(v.ok, `${r.id}: ${kind} '${src}': ${v.ok ? '' : v.message}`);
            checked++;
        }
    }
    assert.ok(checked > 20);
});

// ---------------------------------------------------------------------------
// Palette
// ---------------------------------------------------------------------------

test('palette: preview colours, labels and TikZ definitions agree', () => {
    const keys = ['black', 'gray', 'red', 'orange', 'brown', 'green', 'teal', 'blue', 'purple', 'magenta'];
    assert.deepEqual(Object.keys(COLOR_MAP), keys);
    assert.deepEqual(Object.keys(COLOR_OPTIONS), keys);
    assert.deepEqual(Object.keys(TIKZ_COLOR_DEFS), keys);
    assert.equal(COLOR_MAP.black, 'var(--text-normal)');
    assert.equal(COLOR_OPTIONS.black, 'Auto (text colour, exports black)');
    assert.deepEqual(TIKZ_COLOR_DEFS.black, { name: 'black', hex: '000000' });
    assert.deepEqual(TIKZ_COLOR_DEFS.red, { name: 'etRed', hex: 'E74C3C' });
    // Preview colours are variables (the theme's colours by default) whose fallback is the export colour,
    // and the setting "As in the LaTeX export" (body.etz-export-colours in styles.css) sets exactly those.
    const css = fs.readFileSync(path.join(process.cwd(), 'src', 'styles.css'), 'utf8');
    const exportBlock = /body\.etz-export-colours\s*\{([^}]*)\}/.exec(css)?.[1] ?? '';
    for (const key of keys.slice(1)) {
        const hex = `#${TIKZ_COLOR_DEFS[key].hex.toLowerCase()}`;
        assert.equal(COLOR_MAP[key], `var(--etz-${key}, ${hex})`, key);
        assert.match(exportBlock, new RegExp(`--etz-${key}:\\s*${hex};`), `export colour of ${key}`);
        assert.match(TIKZ_COLOR_DEFS[key].name, /^et[A-Z][a-z]+$/);
    }
    assert.equal(mixHex('#000000', '#ffffff', 0.5), '#808080');
    assert.equal(mixHex('#e74c3c', 'rgb(0, 0, 0)', 0), '#e74c3c');
    assert.equal(mixHex('#f00', '#00f', 1), '#0000ff');
    assert.equal(mixHex('var(--x)', '#000000', 0.5), 'var(--x)');
});
