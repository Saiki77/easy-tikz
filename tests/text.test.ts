/*
 * Charts as text (src/text): every built-in chart (the examples and the
 * charts of every guide) reads back as the same chart after printing, the
 * text examples parse without problems, problems point at their line and
 * column, and rewriting a block keeps the lines of objects that did not
 * change (comments included).
 */
import { test, assert } from './_lib';
import { EXAMPLES } from '../src/migrate';
import { GUIDES } from '../src/guides';
import { canonical } from '../src/chartdata';
import { isChartText, parseChartText } from '../src/text/parse';
import { printChartText, writeChartText } from '../src/text/print';

type Data = Record<string, unknown>;

function builtInCharts(): Array<{ id: string; data: Data }> {
    const out: Array<{ id: string; data: Data }> = EXAMPLES.map((e) => ({ id: `example ${e.id}`, data: e.data as Data }));
    for (const g of GUIDES) {
        out.push({ id: `guide ${g.id}`, data: g.chart as unknown as Data });
        g.steps.forEach((s, i) => {
            if (s.chart) out.push({ id: `guide ${g.id} step ${i + 1}`, data: s.chart as unknown as Data });
        });
    }
    return out;
}

const TANGENT = [
    'view x -3..3, y -4..4',
    'axes middle',
    'title slope at x = {a}: {3a^2 - 3:2}',
    'slider a = 0.8 in -1.1..1.1 step 0.05',
    'f(x) = x^3 - 3x | blue, thick, tangent at a, extrema',
    'g(x) = f(a) + (3a^2 - 3)(x - a) | hidden',
    'shade between f and g for min(a, -2a) <= x <= max(a, -2a) | orange',
].join('\n');

const LP = [
    '% A linear program',
    'view x 0..5, y 0..4.5',
    'axes edges',
    'slider c = 6 in 0..15',
    'R1: shade x + y <= 4, x + 3y <= 6, x >= 0, y >= 0 | constraint lines, numbered',
    '',
    'line 2x + 3y = c | red, dashed, label "z = {c}"',
    'corners of R1 | blue, label "({x}, {y})"',
    'P1: max 2x + 3y over R1 | red, large, label "x* = ({x:2}, {y:2})"',
].join('\n');

const TEXTS: Record<string, string> = {
    tangent: TANGENT,
    lp: LP,
    market: [
        'view x 0..25, y 0..25',
        'xlabel quantity',
        'ylabel price',
        'slider s = 0 in -6..6',
        'demand(x) = 20 + s - x | blue, thick',
        'supply(x) = 2 + 0.5x | orange, thick',
        'eq: crossings of demand and supply | black, drop lines, label "({x:1}, {y:1})"',
        'shade eq_y <= y <= demand for 0 <= x <= eq_x | blue, label "CS"',
    ].join('\n'),
    circle: ['view x -4.5..4.5, y -4.5..4.5', 'equal scale', 'circle: x^2 + y^2 = 9 | blue', 'l(x) = x + 1 | orange', 'crossings of circle and l | red, coordinates'].join('\n'),
    rose: ['polar', 'view x -2.5..2.5, y -2.5..2.5', 'slider k = 4 in 1..8 step 1', 'r(theta) = 2cos(k theta) | purple, thick'].join('\n'),
    surface: ['3d', 'view x -2..2, y -2..2, z 0..8', 'slider h = 3 in 0..8', 'z = x^2 + y^2 | blue, x -2..2, y -2..2, opacity 0.7', 'plane z = h | orange'].join('\n'),
    shapes: [
        'view x -1..6, y -1..5',
        'arrow (0, 0) -> (3, 2) | red',
        'segment (0, 4) -- (2, 4) -- (2, 3) | dashed',
        'polygon (4, 0), (5, 0), (5, 1) | teal',
        'brace (0, -0.5) to (3, -0.5) | label "3"',
        'text "start" at (0, 0) | below, small',
        'levels x^2 + y^2 at 1, 4 | gray',
        'points (1, 1), (2, 2) | small',
        'integer points in R1',
        'R1: shade x + y <= 3, x >= 0, y >= 0 | no fill, outline',
    ].join('\n'),
};

test('text: every built-in chart reads back as the same chart', () => {
    const failures: string[] = [];
    for (const { id, data } of builtInCharts()) {
        const text = printChartText(data);
        const back = parseChartText(text);
        if (back.problems.length) failures.push(`${id}: ${back.problems.map((p) => `${p.line}:${p.column} ${p.message}`).join('; ')}\n${text}`);
        else if (canonical(back.data) !== canonical(data)) failures.push(`${id}: not the same chart\n${text}`);
    }
    assert.ok(builtInCharts().length >= 30, 'fewer built-in charts than expected');
    assert.deepEqual(failures, []);
});

test('text: printed charts use the words, not raw lines', () => {
    const raws: string[] = [];
    for (const { id, data } of builtInCharts()) {
        for (const line of printChartText(data).split('\n')) if (line.startsWith('raw ')) raws.push(`${id}: ${line}`);
    }
    assert.deepEqual(raws, []);
});

test('text: the examples parse without problems and read back after printing', () => {
    for (const [id, text] of Object.entries(TEXTS)) {
        const parsed = parseChartText(text);
        assert.deepEqual(parsed.problems, [], id);
        const again = parseChartText(printChartText(parsed.data));
        assert.deepEqual(again.problems, [], `${id} printed`);
        assert.equal(canonical(again.data), canonical(parsed.data), id);
    }
});

test('text: a block is text unless it is a JSON object', () => {
    assert.equal(isChartText('{ "v": 4 }'), false);
    assert.equal(isChartText('  \n{"v":4}'), false);
    assert.equal(isChartText('f(x) = x^2'), true);
    assert.equal(isChartText(''), true);
});

test('text: problems name their line and column', () => {
    const r = parseChartText('view x 0..5, y 0..4\nf(x) = x^2 | blue, sparkly\nslider a = big');
    assert.equal(r.problems.length, 2);
    assert.deepEqual([r.problems[0].line, r.problems[0].column], [2, 20]);
    assert.match(r.problems[0].message, /unknown option "sparkly"/);
    assert.equal(r.problems[1].line, 3);
    assert.match(r.problems[1].message, /must be a number/);
});

test('text: a function may be called like a keyword', () => {
    const r = parseChartText('line(x) = 2x + 1\nsize(x) = x^2 | red\ntext(t) = (cos(t), sin(t))\ntitle(x) = x');
    assert.deepEqual(r.problems, []);
    const fns = r.data.functions as Data[];
    assert.deepEqual(
        fns.map((f) => f.name),
        ['line', 'size', 'text', 'title']
    );
    assert.equal(fns[2].parametric, true);
});

test('text: names are claimed once, built-in names are refused, automatic names skip given ones', () => {
    const r = parseChartText('R1: shade x >= 0\nshade y >= 0\nshade x <= 3\nR1: shade y <= 1');
    assert.equal(r.problems.length, 1);
    assert.match(r.problems[0].message, /R1 is used twice/);
    // The second R1 still draws, under the next free name.
    assert.deepEqual(
        (r.data.tools as Data[]).map((t) => t.name),
        ['R1', 'R2', 'R3', 'R4']
    );
    const e = parseChartText('E: crossings of f and g');
    assert.match(e.problems[0].message, /built-in name/);
});

test('text: raw lines hold any object exactly', () => {
    const tool = { type: 'curve', name: 'C7', equation: 'x = 1', color: 'red', futureField: [1, 2] };
    const r = parseChartText(`raw tool ${JSON.stringify(tool)}\nraw label {"text": "A | B", "x": "1", "y": "2"}`);
    assert.deepEqual(r.problems, []);
    assert.deepEqual((r.data.tools as Data[])[0], tool);
    assert.equal((r.data.annotations as Data[])[0].text, 'A | B');
    assert.equal(r.data.dimension, undefined, 'a raw line never makes the chart 3D');
});

test('text: writing the same chart back changes nothing, comments and blank lines included', () => {
    for (const [id, text] of Object.entries(TEXTS)) {
        const data = parseChartText(text).data;
        assert.equal(writeChartText(text, data), text, id);
    }
});

test('text: a changed object gets a new line in place; the others stay as written', () => {
    const data = parseChartText(LP).data;
    const tools = data.tools as Data[];
    tools[1] = { ...tools[1], color: 'green' };
    const out = writeChartText(LP, data).split('\n');
    const before = LP.split('\n');
    assert.equal(out.length, before.length);
    const changed = out.map((l, i) => (l === before[i] ? null : i + 1)).filter((x) => x !== null);
    assert.deepEqual(changed, [7], out.join('\n'));
    assert.match(out[6], /green/);
    assert.equal(out[0], '% A linear program');
});

test('text: new objects join their kind, deleted ones leave, new chart fields go on top', () => {
    const data = parseChartText(LP).data;
    data.title = 'Production plan';
    (data.functions as Data[] | undefined) ?? (data.functions = []);
    (data.functions as Data[]).push({ name: 'h', expression: '4 - x', color: 'blue' });
    (data.parameters as Data[]).push({ name: 'k', value: 2, min: 0, max: 5, step: 0.5 });
    data.tools = (data.tools as Data[]).filter((t) => t.name !== 'P1');
    const out = writeChartText(LP, data);
    const lines = out.split('\n');
    assert.equal(lines[0], '% A linear program', 'the comment stays (no full reprint)');
    // The corners line had its name from the lines around it (P2 while P1 existed): it now spells it out.
    assert.ok(lines.includes('P2: corners of R1 | blue, label "({x}, {y})"'), out);
    assert.ok(lines.includes('title Production plan'), out);
    assert.ok(lines.indexOf('title Production plan') < lines.findIndex((l) => l.startsWith('slider')), out);
    assert.equal(lines.indexOf('slider k = 2 in 0..5 step 0.5'), lines.indexOf('slider c = 6 in 0..15') + 1, out);
    assert.ok(lines.includes('h(x) = 4 - x | blue'), out);
    assert.ok(!lines.some((l) => l.startsWith('P1:')), out);
    assert.equal(canonical(parseChartText(out).data), canonical(data));
});

test('text: a changed view rewrites the view line only', () => {
    const data = parseChartText(TANGENT).data;
    data.xmax = '4';
    const out = writeChartText(TANGENT, data).split('\n');
    assert.equal(out[0], 'view x -3..4, y -4..4');
    assert.deepEqual(out.slice(1), TANGENT.split('\n').slice(1));
});

test('text: display width and alignment are written as set lines', () => {
    const data = { ...parseChartText(TANGENT).data, displayWidth: 420, displayAlign: 'left' };
    const out = writeChartText(TANGENT, data);
    assert.match(out, /^set displayWidth = 420$/m);
    assert.match(out, /^set displayAlign = "left"$/m);
    const again = writeChartText(out, { ...data, displayWidth: 500 });
    assert.match(again, /^set displayWidth = 500$/m);
    assert.doesNotMatch(again, /displayWidth = 420/);
});

test('text: recolouring any object of any built-in chart rewrites that one line', () => {
    const failures: string[] = [];
    for (const { id, data } of builtInCharts()) {
        const text = printChartText(data);
        const parsed = parseChartText(text).data;
        for (const key of ['functions', 'tools'] as const) {
            const items = (parsed[key] as Data[] | undefined) ?? [];
            items.forEach((item, i) => {
                const next = JSON.parse(JSON.stringify(parsed)) as Data;
                const color = item.color === 'green' ? 'purple' : 'green';
                (next[key] as Data[])[i] = { ...item, color };
                const out = writeChartText(text, next);
                if (canonical(parseChartText(out).data) !== canonical(next)) {
                    failures.push(`${id} ${key}[${i}]: not the same chart`);
                    return;
                }
                const a = text.split('\n');
                const b = out.split('\n');
                const changed = b.filter((l, j) => l !== a[j]).length;
                if (a.length !== b.length || changed !== 1) failures.push(`${id} ${key}[${i}]: ${changed} lines changed\n${out}`);
            });
        }
    }
    assert.deepEqual(failures, []);
});

// ------------------------------------------------- review of 4.4.0

test('text: a line break in any text is quoted, so printed text never ends the code block', () => {
    const evil = 'Revenue\n```\n```dataviewjs\ndv.paragraph("injected")\n```\n```easy-tikz';
    const data: Data = {
        v: 4,
        title: evil,
        axis_label_x: 'q\r```',
        functions: [{ name: 'f', expression: 'x^2', legendLabel: evil, showLegend: true }],
        tools: [{ type: 'region', name: 'R1', conditions: ['x >= 0'], label: evil }],
        annotations: [{ x: '1', y: '1', text: evil }],
    };
    const text = printChartText(data);
    for (const line of text.split(/\r\n?|\n/)) assert.ok(!/^\s*(`{3,}|~{3,})/.test(line), `a fence line: ${line}`);
    assert.ok(!/\r/.test(text), 'a bare carriage return');
    assert.equal(canonical(parseChartText(text).data), canonical(data));
});

test('text: a JSON block that starts with a comment is JSON', () => {
    assert.equal(isChartText('// Feasible region\n{ "v": 4 }'), false);
    assert.equal(isChartText('/* note */\n{ "v": 4 }'), false);
    assert.equal(isChartText('// a text chart\nf(x) = x^2'), true);
});

test('text: width and alignment change only their lines, wherever they are', () => {
    const text = ['% my chart', 'view x 0..5, y 0..5', 'f(x) = x | blue, thick', 'set displayWidth = 480', '% TODO'].join('\n');
    const data = { ...parseChartText(text).data, displayAlign: 'left' };
    const out = writeChartText(text, data).split('\n');
    assert.deepEqual(out.slice(0, 4), text.split('\n').slice(0, 4));
    assert.ok(out.includes('% TODO') && out.includes('set displayAlign = "left"'), out.join('\n'));
});

test('text: renames, moves and deleted lines keep the comments', () => {
    const two = ['% two lines', 'y = x^2 | blue', '% the line', 'y = 2x + 1 | red'].join('\n');
    const deleted = parseChartText(two).data;
    deleted.functions = (deleted.functions as Data[]).slice(1);
    const a = writeChartText(two, deleted);
    assert.ok(a.includes('% two lines') && a.includes('% the line'), a);
    assert.equal(canonical(parseChartText(a).data), canonical(deleted));

    const renamed = parseChartText(LP).data;
    (renamed.tools as Data[])[0].name = 'F';
    for (const t of renamed.tools as Data[]) if (t.regionName === 'R1') t.regionName = 'F';
    const b = writeChartText(LP, renamed);
    assert.ok(b.startsWith('% A linear program\n'), b);
    assert.equal(canonical(parseChartText(b).data), canonical(renamed));

    const moved = parseChartText(LP).data;
    const tools = moved.tools as Data[];
    moved.tools = [tools[1], tools[0], ...tools.slice(2)];
    const c = writeChartText(LP, moved);
    assert.ok(c.startsWith('% A linear program\n') && c.includes('\n\n'), c);
    assert.equal(canonical(parseChartText(c).data), canonical(moved));
});

test('text: a setting split over two lines is written once', () => {
    const text = ['view x 0..5', 'view y 0..20', 'grid', 'grid minor', 'f(x) = x'].join('\n');
    const data = parseChartText(text).data;
    data.ymax = '25';
    data.showSmallGrid = false;
    const out = writeChartText(text, data).split('\n');
    assert.equal(out.filter((l) => l.startsWith('view')).length, 1, out.join('\n'));
    assert.equal(out.filter((l) => l.startsWith('grid')).length, 1, out.join('\n'));
});

test('text: fields the words do not cover still come back', () => {
    const data: Data = {
        v: 4,
        dimension: true,
        functions: [
            { name: 'f', expression: 'x^2', expressionY: 'sin(t)' },
            { name: 'g', expression: 'x', showLegend: true, legendLabel: '' },
        ],
        tools: [
            { type: 'points', name: 'P1', source: 'region', regionName: 'R1', sense: 'min' },
            { type: 'region', name: 'R1', conditions: ['x >= 0', 'y >= 0', ''], conditionLabels: ['', '', 'labour'] },
            { type: 'region', name: 'title', conditions: ['x <= 1'] },
        ],
        annotations: [{ x: '1', y: '1', z: '', text: 'A' }],
        title: ': starts with a colon',
    };
    const back = parseChartText(printChartText(data));
    assert.deepEqual(back.problems, []);
    assert.equal(canonical(back.data), canonical(data));
});

test('text: built-in calls start formulas, and chart lines report what they ignore', () => {
    const r = parseChartText('max(x, y) = 1\nmin(f, g) <= y <= max(f, g)\nf(x) = x\ng(x) = 1');
    assert.equal(r.data.dimension, undefined, 'max(x, y) = 1 is not a surface');
    assert.deepEqual(
        (r.data.tools as Data[]).map((t) => t.type),
        ['curve', 'region']
    );
    const t = parseChartText('title Area |x| < 1\nslider a = 1 in 0..5 | hidden\npolar coordinates');
    assert.equal(t.data.title, 'Area |x| < 1');
    assert.equal(t.problems.length, 2, JSON.stringify(t.problems));
});

test('text: a surface line further down still makes the points above 3D', () => {
    const r = parseChartText('point (1, 1)\nz = x^2 + y^2');
    assert.equal((r.data.tools as Data[])[0].dim, 3);
});

test('text: random editor edits on every built-in chart keep every comment and give the right chart', () => {
    let seed = 7;
    const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
    const pick = <T>(a: T[]): T => a[Math.floor(rnd() * a.length)];
    const charts = builtInCharts().map((c) => c.data);
    const failures: string[] = [];
    for (let round = 0; round < 300; round++) {
        const lines = printChartText(pick(charts)).split('\n');
        const text = lines.flatMap((l, i) => (i % 2 === 0 ? [`% note ${i}`, l] : [l])).join('\n');
        const data = JSON.parse(JSON.stringify(parseChartText(text).data)) as Data;
        const fns = (data.functions as Data[] | undefined) ?? [];
        const tools = (data.tools as Data[] | undefined) ?? [];
        const kind = pick(['recolour', 'move tool', 'move function', 'rename tool', 'add function', 'view']);
        if (kind === 'recolour' && fns.length + tools.length) pick([...fns, ...tools]).color = 'green';
        if (kind === 'move tool' && tools.length > 1) tools.reverse();
        if (kind === 'move function' && fns.length > 1) fns.reverse();
        if (kind === 'rename tool' && tools.length) {
            const t = pick(tools);
            const old = String(t.name);
            data.tools = JSON.parse(JSON.stringify(tools).replace(new RegExp(`\\b${old}\\b`, 'g'), 'Zed')) as Data[];
        }
        if (kind === 'add function') data.functions = [...fns, { name: 'added', expression: 'x/2', color: 'red' }];
        if (kind === 'view') data.xmax = '11';
        const out = writeChartText(text, data);
        if (canonical(parseChartText(out).data) !== canonical(data)) failures.push(`${kind}: not the same chart\n${out}`);
        const notes = (t: string) => t.split('\n').filter((l) => l.startsWith('% note')).length;
        if (notes(out) < notes(text)) failures.push(`${kind}: comments lost\n${out}`);
    }
    assert.deepEqual(failures.slice(0, 3), []);
});
