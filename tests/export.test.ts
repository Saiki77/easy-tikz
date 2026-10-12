/*
 * String-level checks of the TikZ export (src/export.ts) and the v4
 * SettingsManager contract (src/settings.ts). Compiling is covered by
 * tests/latex.test.ts.
 */
import { test, assert, near } from './_lib';
import { RANGE_DEFAULTS, SettingsManager } from '../src/settings';
import { EXAMPLES } from '../src/migrate';
import { Function3DParameters, FunctionParameters, RendererConfig, Tool } from '../src/types';

// ----------------------------------------------------------------- helpers

function fn(name: string, expression: string, over: Partial<FunctionParameters> = {}): FunctionParameters {
    return {
        name,
        expression,
        domain: '',
        showLegend: false,
        fill: false,
        fillOpacity: 0.2,
        fillPattern: 'solid',
        tangent: false,
        color: 'blue',
        dashed: false,
        tangentPoint: '',
        extrema: false,
        thickness: 'thick',
        parametric: false,
        expressionY: '',
        ...over,
    };
}

function region(name: string, conditions: string[], over: Record<string, unknown> = {}): Tool {
    return {
        id: name,
        name,
        type: 'region',
        color: 'blue',
        conditions,
        conditionLabels: conditions.map(() => ''),
        fill: true,
        fillOpacity: 0.25,
        fillPattern: 'solid',
        outline: 'none',
        thickness: 'thin',
        constraintLines: false,
        label: '',
        ...over,
    } as Tool;
}

function points(name: string, over: Record<string, unknown>): Tool {
    return {
        id: name,
        name,
        type: 'points',
        color: 'red',
        dim: 2,
        source: 'list',
        points: '',
        ref1: '',
        ref2: '',
        regionName: '',
        objective: '',
        sense: 'max',
        label: '',
        dropLines: false,
        size: 'normal',
        ...over,
    } as Tool;
}

function segment(name: string, path: string, over: Record<string, unknown> = {}): Tool {
    return {
        id: name,
        name,
        type: 'segment',
        color: 'black',
        dim: 2,
        path,
        closed: false,
        style: 'line',
        thickness: 'thin',
        dashed: false,
        label: '',
        ...over,
    } as Tool;
}

function surface(name: string, expression: string, over: Partial<Function3DParameters> = {}): Function3DParameters {
    return { name, expression, xDomain: '', yDomain: '', color: 'blue', wireframe: false, opacity: 0.8, samples: 30, ...over };
}

function plane(name: string, axis: 'x' | 'y' | 'z', value: string): Tool {
    return { id: name, name, type: 'plane3D', color: 'orange', axis, value, fillOpacity: 0.3 } as Tool;
}

function settings(data: Record<string, unknown>): SettingsManager {
    return SettingsManager.fromJSON(JSON.parse(JSON.stringify({ v: 4, ...data })));
}

function exportOf(data: Record<string, unknown>): string {
    return settings(data).generateTikzCode();
}

function example(id: string): Record<string, unknown> {
    const ex = EXAMPLES.find((e) => e.id === id);
    assert.ok(ex, `example ${id}`);
    return JSON.parse(JSON.stringify(ex.data));
}

function lines(code: string): string[] {
    return code.split('\n');
}

/** `\addplot` lines without `forget plot` must be followed by their legend entry, and the other way round. */
function checkLegendAdjacency(code: string, what: string): void {
    const ls = lines(code);
    ls.forEach((l, i) => {
        if (l.startsWith('\\addplot') && !l.startsWith('\\addplot3')) {
            const next = ls[i + 1] || '';
            if (!l.includes('forget plot')) assert.ok(next.startsWith('\\addlegendentry'), `${what}: plot without legend needs forget plot: ${l}`);
        }
        if (l.startsWith('\\addlegendentry')) {
            const prev = ls[i - 1] || '';
            assert.ok(prev.startsWith('\\addplot') && !prev.includes('forget plot'), `${what}: legend entry must follow its plot: ${l}`);
        }
    });
}

/** The 3D axis unit vectors `x={(a cm,b cm)}, ...` as [[ax, ay], [bx, by], [cx, cy]] in cm. */
function unitVectors(code: string): Array<[number, number]> {
    const m = /^ {2}x=\{\(([-\d.]+)cm,([-\d.]+)cm\)\}, y=\{\(([-\d.]+)cm,([-\d.]+)cm\)\}, z=\{\(([-\d.]+)cm,([-\d.]+)cm\)\},$/m.exec(code);
    assert.ok(m, 'unit vectors');
    const v = m.slice(1).map(Number);
    return [
        [v[0], v[1]],
        [v[2], v[3]],
        [v[4], v[5]],
    ];
}

/** Width and height (cm) of the box [0, sx] x [0, sy] x [0, sz] drawn with unit vectors `u`. */
function boxExtent(u: Array<[number, number]>, spans: number[]): [number, number] {
    const xs: number[] = [];
    const ys: number[] = [];
    for (let c = 0; c < 8; c++) {
        let x = 0;
        let y = 0;
        for (let k = 0; k < 3; k++) {
            if (c & (1 << k)) {
                x += u[k][0] * spans[k];
                y += u[k][1] * spans[k];
            }
        }
        xs.push(x);
        ys.push(y);
    }
    return [Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys)];
}

/** `\addplot3[...]` lines of surfaces (surf or mesh) and planes, in order, as 'S' / 'P'. */
function plotOrder(code: string): string {
    return lines(code)
        .filter((l) => l.startsWith('\\addplot3[surf') || l.startsWith('\\addplot3[mesh') || l.includes('fill opacity'))
        .map((l) => (l.includes('fill opacity') ? 'P' : 'S'))
        .join('');
}

/** Every `axis cs:` coordinate as numbers. */
function axisCoords(code: string): Array<[number, number]> {
    const out: Array<[number, number]> = [];
    const re = /\(axis cs:([^,()]+),([^,()]+)\)/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(code))) out.push([Number(m[1]), Number(m[2])]);
    return out;
}

/** Coordinates in `\fill` / `\draw` commands, per command. */
function pathSizes(code: string): number[] {
    const sizes: number[] = [];
    for (const cmd of code.split(';')) {
        const start = cmd.search(/\\(fill|draw)\[/);
        if (start < 0) continue;
        sizes.push((cmd.slice(start).match(/axis cs:/g) || []).length);
    }
    return sizes;
}

/** Numbers in the code must be fmtNum output: at most 6 significant digits, no JS noise. */
function checkNumbers(code: string, what: string): void {
    for (const bad of ['NaN', 'Infinity', 'undefined', 'null', 'deg(']) {
        assert.ok(!code.includes(bad), `${what}: contains ${bad}`);
    }
    const body = code.replace(/\\definecolor\{[^}]*\}\{HTML\}\{[0-9A-F]+\}/g, '');
    const re = /-?(\d+\.?\d*)(e[-+]?\d+)?/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(body))) {
        const digits = m[1].replace('.', '').replace(/^0+/, '');
        assert.ok(digits.length <= 6, `${what}: number with more than 6 significant digits: ${m[0]}`);
    }
}

// ------------------------------------------------------------- settings

test('new charts start with the v4 defaults', () => {
    const s = new SettingsManager();
    assert.equal(s.getValue('v'), 4);
    assert.equal(s.getValue('title'), '');
    assert.deepEqual(s.getValue('parameters'), []);
    assert.equal(s.getValue('variables'), 'x, y');
    assert.equal(s.getValue('equalScale'), false);
    assert.equal(s.getValue('showSlidersInNote'), true);
    assert.equal(s.getValue('documentSetup'), true);
    assert.equal(s.getValue('documentClose'), undefined);
    assert.equal(s.getValue('xmin'), '-0.5');
    assert.equal(s.getValue('xmax'), '10');
    assert.equal(s.getValue('ymin'), '-0.5');
    assert.equal(s.getValue('ymax'), '5');
    for (const key of Object.keys(RANGE_DEFAULTS) as Array<keyof typeof RANGE_DEFAULTS>) assert.equal(s.getValue(key), RANGE_DEFAULTS[key]);
    assert.ok(s.isStandalone());
    // Defaults are per instance, not shared arrays.
    (s.getValue('functions') as unknown[]).push(1);
    assert.deepEqual(new SettingsManager().getValue('functions'), []);
});

test('serialize writes v 4 and drops documentClose', () => {
    const s = new SettingsManager();
    s.setValue('documentClose', true);
    s.setValue('v', 3);
    const data = s.serialize();
    assert.equal(data.v, 4);
    assert.ok(!('documentClose' in data));
    assert.deepEqual(SettingsManager.fromJSON(data).serialize(), data);
});

test('fromJSON migrates 3.x blocks', () => {
    const s = SettingsManager.fromJSON({
        documentSetup: false,
        documentClose: true,
        xmin: 0,
        title: 'Cost {total}',
        functions: [{ expression: 'x^2', domain: '0:2', color: 'red' }, { expression: 'x', domain: '0:2' }],
        tools: [{ type: 'areaBetween', func1Name: 'f1', func2Name: 'f2', domain: '', color: 'green', fillOpacity: 0.3, fillPattern: 'solid' }],
    });
    assert.equal(s.getValue('v'), 4);
    assert.equal(s.getValue('xmin'), '0');
    assert.equal(s.getValue('documentClose'), undefined);
    assert.equal(s.isStandalone(), false);
    // 3.x pasted the title into TeX: `{total}` was a group, so the braces go.
    assert.equal(s.getValue('title'), 'Cost total');
    const tools = s.getValue<Tool[]>('tools');
    assert.equal(tools[0].type, 'region');
    assert.deepEqual(
        s.getValue<FunctionParameters[]>('functions').map((f) => f.name),
        ['f1', 'f2']
    );
    // Missing keys keep their defaults.
    assert.equal(s.getValue('variables'), 'x, y');
    assert.equal(s.getValue('size_x_cm'), 10);
});

test('resolveView evaluates expressions, allows 0 and reports every fallback', () => {
    const s = settings({
        xmin: '0',
        xmax: 'c',
        ymin: 'b',
        ymax: '2 * c',
        zmin: '3',
        zmax: '1',
        parameters: [{ name: 'c', value: 7, min: 0, max: 10, step: 1 }],
    });
    const { view, errors } = s.resolveView(s.createMathContext());
    assert.equal(view.xmin, 0);
    assert.equal(view.xmax, 7);
    assert.equal(view.ymin, -0.5);
    assert.equal(view.ymax, 14);
    assert.deepEqual([view.zmin, view.zmax], [-5, 5]);
    assert.ok(errors.some((e) => e.startsWith('ymin:') && e.includes("'b'")), errors.join(' | '));
    assert.ok(errors.some((e) => e.startsWith('zmax:')), errors.join(' | '));
    assert.equal(errors.length, 2);

    const t = settings({ xmin: '', xmax: '1e999', ymin: '4', ymax: '4' });
    const r = t.resolveView(t.createMathContext());
    assert.deepEqual([r.view.xmin, r.view.xmax, r.view.ymin, r.view.ymax], [-0.5, 10, -0.5, 5]);
    for (const key of ['xmin', 'xmax', 'ymax']) assert.ok(r.errors.some((e) => e.startsWith(key + ':')), `${key}: ${r.errors.join(' | ')}`);
});

test('toRendererConfig carries the v4 fields', () => {
    const s = settings({
        coordinateSystem: 'polar',
        axis_label_x_polar: 'r',
        xmin: '-2',
        parameters: [{ name: 'a', value: 2, min: 0, max: 5, step: 0.1 }],
        variables: 'q, p',
        equalScale: true,
        tools: [region('R1', ['q + p <= a'])],
        size_x_cm: 10,
        size_y_cm: 5,
    });
    const math = s.createMathContext();
    const c = s.toRendererConfig(math);
    assert.equal(c.coordinateSystem, 'polar');
    assert.equal(c.xmin, -2);
    assert.equal(c.xLabel, 'r');
    assert.equal(c.yLabel, '');
    assert.equal(c.parameters[0].name, 'a');
    assert.equal(c.variables, 'q, p');
    assert.equal(c.equalScale, true);
    assert.equal(c.tools[0].type, 'region');
    assert.equal(c.height, Math.round(c.width / 2));
    const paper = c as RendererConfig & { paperWidthCm?: number; paperHeightCm?: number };
    assert.deepEqual([paper.paperWidthCm, paper.paperHeightCm], [10, 5]);
    // The context knows the axis variables and the tool names.
    assert.ok(math.validate('q + p', 'fn2').ok);
    const withPoints = settings({ tools: [points('P1', { points: '(1, 2)' })] });
    assert.ok(withPoints.createMathContext().validate('P1_x + 1', 'value').ok);
});

test('the preview canvas has the paper aspect, previewSize on the long side', () => {
    const canvas = (over: Record<string, unknown>) => {
        const c = settings(over).toRendererConfig();
        return [c.width, c.height];
    };
    assert.deepEqual(canvas({}), [760, 760]);
    assert.deepEqual(canvas({ size_x_cm: 10, size_y_cm: 8 }), [760, 608]);
    // Wide and tall charts keep their shape (3.x clamped the ratio to 0.35..1.8).
    assert.deepEqual(canvas({ size_x_cm: 16, size_y_cm: 4 }), [760, 190]);
    assert.deepEqual(canvas({ size_x_cm: 4, size_y_cm: 12 }), [253, 760]);
    // No side below 140 px: the renderer would draw a thumbnail (no ticks, labels or legend).
    assert.deepEqual(canvas({ size_x_cm: 30, size_y_cm: 3 }), [760, 140]);
    assert.deepEqual(canvas({ size_x_cm: 16, size_y_cm: 4, previewSize: 320 }), [320, 140]);
    assert.deepEqual(canvas({ previewSize: 5000 }), [1600, 1600]);
    // Paper sizes are clamped like the export's.
    assert.deepEqual(settings({ size_x_cm: 0.2, size_y_cm: 250 }).paperSize(), { w: 1, h: 100 });
    assert.deepEqual(settings({ size_x_cm: 'oops' }).paperSize(), { w: 10, h: 10 });
});

// ----------------------------------------------------------- 2D export

test('standalone document vs snippet', () => {
    const data = { functions: [fn('f1', 'x^2')], tools: [segment('S1', '(1, 1); (4, 1)', { style: 'brace', label: 'w' })] };
    const full = lines(exportOf(data));
    assert.deepEqual(full.slice(0, 3), ['\\documentclass[border=5pt]{standalone}', '\\usepackage{pgfplots}', '\\pgfplotsset{compat=1.16}']);
    assert.ok(full.includes('\\usetikzlibrary{decorations.pathreplacing}'));
    assert.ok(!full.includes('\\usetikzlibrary{patterns}'));
    assert.ok(full.indexOf('\\begin{document}') < full.indexOf('\\begin{tikzpicture}'));
    assert.equal(full[full.length - 1], '\\end{document}');

    const snip = lines(exportOf({ ...data, documentSetup: false }));
    assert.equal(snip[0], '% Needs: \\usepackage{pgfplots}');
    assert.equal(snip[1], '% Needs: \\pgfplotsset{compat=1.16}');
    assert.equal(snip[2], '% Needs: \\usetikzlibrary{decorations.pathreplacing}');
    assert.equal(snip[3], '\\begin{tikzpicture}');
    assert.equal(snip[snip.length - 1], '\\end{tikzpicture}');
    assert.ok(!snip.some((l) => l.startsWith('\\documentclass') || l.startsWith('\\begin{document}')));
});

test('LP example matches the golden export rules', () => {
    const code = exportOf(example('lp'));
    const ls = lines(code);
    // Palette colours defined inside the picture, only the used ones.
    assert.ok(ls.includes('\\definecolor{etBlue}{HTML}{3498DB}'));
    assert.ok(ls.includes('\\definecolor{etRed}{HTML}{E74C3C}'));
    assert.ok(!code.includes('etGreen'));
    assert.ok(ls.indexOf('\\definecolor{etBlue}{HTML}{3498DB}') > ls.indexOf('\\begin{tikzpicture}'));
    assert.ok(ls.indexOf('\\definecolor{etBlue}{HTML}{3498DB}') < ls.indexOf('\\begin{axis}['));
    // Axis options.
    for (const opt of [
        '  width=10cm, height=9cm,',
        '  xmin=0, xmax=5, ymin=0, ymax=4.5,',
        '  axis lines=left,',
        '  grid=major,',
        '  trig format plots=rad,',
        '  unbounded coords=jump,',
        '  restrict x to domain=-50:55, restrict y to domain=-45:49.5,',
        '  clip mode=individual,',
        '  set layers,',
    ]) {
        assert.ok(ls.includes(opt), `missing option ${opt}`);
    }
    assert.ok(!code.includes('axis equal'));
    // Region fill on the background layer, exact corners.
    assert.ok(ls.includes('\\fill[etBlue, fill opacity=0.25, even odd rule] (axis cs:0,0) -- (axis cs:4,0) -- (axis cs:3,1) -- (axis cs:0,2) -- cycle;'));
    assert.ok(ls.indexOf('\\begin{pgfonlayer}{axis background}') < ls.findIndex((l) => l.startsWith('\\fill')));
    // Objective line clipped to the view, exact 2-point stroke.
    assert.ok(ls.includes('\\draw[etRed, thick, dashed] (axis cs:0,3) -- (axis cs:4.5,0);'));
    // Markers: corners and the optimum, forget plot.
    assert.ok(ls.some((l) => l.startsWith('\\addplot[only marks, mark=*, mark size=2pt, etBlue,') && l.endsWith('forget plot] coordinates {(0,0) (4,0) (3,1) (0,2)};')));
    assert.ok(ls.some((l) => l.startsWith('\\addplot[only marks, mark=*, mark size=2.8pt, etRed,') && l.endsWith('coordinates {(3,1)};')));
    // Labels: templates interpolated, corner (0, 0) kept (clip mode=individual).
    assert.ok(ls.some((l) => l.includes('at (axis cs:3,1) {x* = (3, 1)};')));
    assert.ok(ls.some((l) => l.includes('at (axis cs:0,0) {(0, 0)};')));
    assert.ok(ls.some((l) => l.endsWith('{z = 9};')));
    // Layer order: fills, strokes, markers, texts.
    const first = (p: (l: string) => boolean) => ls.findIndex(p);
    const fill = first((l) => l.startsWith('\\fill'));
    const draw = first((l) => l.startsWith('\\draw'));
    const mark = first((l) => l.startsWith('\\addplot[only marks'));
    const node = first((l) => l.startsWith('\\node'));
    assert.ok(fill < draw && draw < mark && mark < node, `${fill} ${draw} ${mark} ${node}`);
    checkNumbers(code, 'lp');
});

test('every example: legend adjacency, numbers, braces of the document', () => {
    for (const ex of EXAMPLES) {
        const code = exportOf(JSON.parse(JSON.stringify(ex.data)));
        checkLegendAdjacency(code, ex.id);
        checkNumbers(code, ex.id);
        assert.equal((code.match(/\{/g) || []).length, (code.match(/\}/g) || []).length, `${ex.id}: unbalanced braces`);
        assert.ok(code.includes('trig format plots=rad'), ex.id);
    }
});

test('functions: domains, variable renaming, legends, hidden and broken functions', () => {
    const code = exportOf({
        xmin: '-2',
        xmax: '6',
        ymin: '-3',
        ymax: '3',
        parameters: [{ name: 'a', value: 1 / 3, min: 0, max: 1, step: 0.01 }],
        functions: [
            fn('f1', 'sin(x)', { showLegend: true }),
            fn('f2', 'a x^2', { domain: '0:2', dashed: true }),
            fn('f3', 'x + 1', { hidden: true }),
            fn('f4', 'sin(', { showLegend: true }),
            fn('f5', 'f3(x) * 2', { showLegend: true, legendLabel: '50% of x_1 & $x^*$' }),
            fn('f6', '1000 + x', { showLegend: true }),
        ],
    });
    const plots = lines(code).filter((l) => l.startsWith('\\addplot'));
    assert.equal(plots.length, 3, plots.join('\n'));
    assert.ok(plots[0].includes('domain=-2:6') && plots[0].includes('{sin(x)}'), plots[0]);
    // Parameter substituted as a number, own domain kept, style options.
    assert.ok(plots[1].includes('domain=0:2') && plots[1].includes('dashed') && plots[1].includes('0.333333'), plots[1]);
    // The hidden function is inlined, not plotted.
    assert.ok(plots[2].includes('(x+1)') || plots[2].includes('((x)+1)'), plots[2]);
    assert.ok(code.includes('\\addlegendentry{\\(\\sin(x)\\)}'));
    assert.ok(code.includes('\\addlegendentry{50\\% of x\\_1 \\& $x^*$}'));
    // f4 (syntax error) and f6 (nothing drawable: its legend would label the next plot) are left out.
    assert.equal((code.match(/addlegendentry/g) || []).length, 2);
    checkLegendAdjacency(code, 'functions');
});

test('a call into a function with a domain is guarded with nan', () => {
    const code = exportOf({
        xmin: '-1',
        xmax: '3',
        ymin: '-1',
        ymax: '5',
        functions: [fn('f1', 'x^2', { domain: '0:2', hidden: true }), fn('f2', 'f1(x) + 1')],
    });
    const plot = lines(code).find((l) => l.startsWith('\\addplot'));
    assert.ok(plot && plot.includes('nan') && plot.includes('>=(0)') && plot.includes('<=(2)'), plot);
    // The preview draws f2 only on [0, 2]: so does the export.
    assert.ok(plot && /domain=-?0(\.0*\d+)?(e-\d+)?:2,/.test(plot), plot);
});

test('parametric and polar curves use x as the pgfplots variable', () => {
    const param = exportOf({ functions: [fn('f1', 'cos(3t)', { parametric: true, expressionY: 'sin(2t)', showLegend: true })] });
    const p = lines(param).find((l) => l.startsWith('\\addplot'));
    assert.ok(p && p.includes('domain=0:6.28319') && p.includes('] ({cos(3*x)}, {sin(2*x)});'), p);
    assert.ok(param.includes('\\addlegendentry{\\(\\left('));

    const polar = exportOf({ coordinateSystem: 'polar', xmin: '-3', xmax: '3', ymin: '-3', ymax: '3', functions: [fn('f1', '2cos(3theta)')] });
    const q = lines(polar).find((l) => l.startsWith('\\addplot'));
    assert.ok(q && q.includes('*cos(x)}') && q.includes('*sin(x)}') && !/\bt\b|theta/.test(q.slice(q.indexOf(']'))), q);
    assert.ok(polar.includes('  axis equal image,'));
    assert.ok(exportOf({ equalScale: true, functions: [fn('f1', 'x')] }).includes('  axis equal image,'));
});

test('curves break where the preview breaks them', () => {
    const code = exportOf({
        xmin: '-10',
        xmax: '10',
        ymin: '-10',
        ymax: '10',
        functions: [fn('f1', 'tan(x)', { showLegend: true }), fn('f2', 'floor(x)', { showLegend: true }), fn('f3', 'x^3', { showLegend: true })],
    });
    checkLegendAdjacency(code, 'breaks');
    const ls = lines(code);
    const pieces = (body: string) =>
        ls
            .filter((l) => l.startsWith('\\addplot') && l.endsWith(body))
            .map((l) => {
                const m = /domain=([^:]+):([^,]+),/.exec(l);
                assert.ok(m, l);
                return [Number(m[1]), Number(m[2])];
            });
    const tan = pieces('{tan(x)};');
    assert.ok(tan.length >= 6, `tan pieces: ${tan.length}`);
    for (const [lo, hi] of tan) {
        // No piece spans a pole (pi/2 + k pi).
        const k = Math.floor((lo - Math.PI / 2) / Math.PI);
        assert.ok(hi < Math.PI / 2 + (k + 1) * Math.PI, `tan piece ${lo}:${hi}`);
    }
    const floor = pieces('{floor(x)};');
    assert.equal(floor.length, 20);
    for (const [lo, hi] of floor) assert.equal(Math.floor(lo), Math.floor(hi), `floor piece ${lo}:${hi}`);
    // x^3 is plotted only where it stays within 10 view heights: no 'Dimension too large'.
    const cube = pieces('{x^3};');
    assert.equal(cube.length, 1);
    near(cube[0][1], Math.cbrt(210), 1e-3);
});

test('label text is escaped outside math', () => {
    const code = exportOf({
        title: 'x_1 & 50% #1 {a}',
        axis_label_x: 'x_1',
        axis_label_y: '$x_2$',
        parameters: [{ name: 'a', value: 2, min: 0, max: 5, step: 1 }],
        tools: [region('R1', ['x + y <= 4', 'x >= 0', 'y >= 0'], { label: '50% cut' })],
        annotations: [{ x: '1', y: '1', text: '$x^*$ and x_1', color: 'red', size: 'large', anchor: 'above' }],
    });
    assert.ok(code.includes('  title={x\\_1 \\& 50\\% \\#1 2},'), code);
    assert.ok(code.includes('xlabel={x\\_1}, ylabel={$x_2$}'));
    assert.ok(code.includes('{50\\% cut};'));
    assert.ok(code.includes('\\node[etRed, anchor=south, font=\\large, fill=white'));
    assert.ok(code.includes('{$x^*$ and x\\_1};'));
});

test('patterns: tint plus hatch over the same rings, library loaded', () => {
    const code = exportOf({
        xmin: '-4',
        xmax: '4',
        ymin: '-4',
        ymax: '4',
        tools: [region('R1', ['x^2 + y^2 <= 9', 'x^2 + y^2 >= 1'], { fillPattern: 'north-east', color: 'green' })],
    });
    assert.ok(code.includes('\\usetikzlibrary{patterns}'));
    const ls = lines(code);
    const tint = ls.findIndex((l) => l.startsWith('\\fill[etGreen, fill opacity=0.25, even odd rule]'));
    const hatch = ls.findIndex((l) => l.startsWith('\\fill[pattern=north east lines, pattern color=etGreen, even odd rule]'));
    assert.ok(tint >= 0 && hatch > tint, `${tint} ${hatch}`);
    const body = (from: number) => {
        const out: string[] = [];
        for (let i = from + 1; i < ls.length && ls[i].startsWith('  '); i++) out.push(ls[i]);
        return out.join('\n');
    };
    assert.equal(body(hatch), body(tint));
    // Two rings: outer and hole.
    assert.equal((body(tint).match(/cycle/g) || []).length, 2);
});

test('coordinates are clipped to the view, numbers are finite, lines are short', () => {
    const code = exportOf({
        xmin: '0',
        xmax: '10',
        ymin: '0',
        ymax: '8',
        tools: [
            segment('S1', '(0, 0); (1000, 4)', { style: 'both' }),
            segment('S2', '(-5, -5); (5, 5); (15, -5)', { closed: true }),
            points('P1', { points: '(1, 1); (100, 100)', label: 'P{i}' }),
            region('R1', ['y <= 4 + 3sin(3x)', 'y >= 1 + cos(5x)'], { outline: 'solid' }),
        ],
        annotations: [{ x: '50', y: '1', text: 'far', color: 'black', size: 'normal', anchor: 'center' }],
    });
    for (const [x, y] of axisCoords(code)) {
        assert.ok(x >= -0.5 && x <= 10.5 && y >= -0.4 && y <= 8.4, `outside the view: ${x},${y}`);
    }
    checkNumbers(code, 'clipped');
    // The far end of S1 was cut: only the start keeps its arrow tip.
    assert.ok(code.includes('\\draw[black, thin, <-] (axis cs:0,0) -- (axis cs:10,0.04);'), code);
    // The point at (100, 100) is dropped, as is the far label.
    assert.ok(code.includes('coordinates {(1,1)};'));
    assert.ok(!code.includes('{far}'));
    assert.ok(code.includes('{P1};') && !code.includes('{P2};'));
    for (const l of lines(code)) assert.ok((l.match(/axis cs:/g) || []).length <= 6, `long line: ${l.slice(0, 80)}`);
});

test('budgets: at most 3000 points per path and 15000 per picture', () => {
    const tools: Tool[] = [];
    for (let i = 0; i < 12; i++) {
        tools.push(region(`R${i + 1}`, [`y <= ${i % 3} + sin(${8 + i}x) + 0.5cos(${13 + i}y)`, `y >= -4 + cos(${7 + i}x)`], { outline: 'solid' }));
    }
    const code = exportOf({ xmin: '-5', xmax: '5', ymin: '-5', ymax: '5', tools });
    const sizes = pathSizes(code);
    assert.ok(sizes.length >= 12, `paths: ${sizes.length}`);
    for (const n of sizes) assert.ok(n <= 3000, `path with ${n} points`);
    const total = sizes.reduce((a, b) => a + b, 0);
    assert.ok(total <= 15000, `picture with ${total} points`);
});

test('braces bulge left of from -> to with the label beyond the tip', () => {
    const up = exportOf({ tools: [segment('S1', '(1, 1); (4, 1)', { style: 'brace', label: 'width', color: 'blue' })] });
    assert.ok(
        up.includes('\\draw[decorate, decoration={brace, amplitude=5pt, raise=2pt}, etBlue, thick] (axis cs:1,1) -- (axis cs:4,1) node[midway, anchor=south, xshift=0pt, yshift=9pt, etBlue, font=\\small] {width};'),
        up
    );
    assert.ok(!up.includes('mirror'));
    const down = exportOf({ tools: [segment('S1', '(4, 1); (1, 1)', { style: 'brace', label: 'w' })] });
    assert.ok(down.includes('anchor=north, xshift=0pt, yshift=-9pt'), down);
});

test('derived names are available to functions and labels', () => {
    const data = example('lp');
    data.functions = [fn('f1', 'P1_y + 0 * x', { showLegend: true })];
    data.annotations = [{ x: 'P1_x', y: 'P1_y', text: 'best: {P1_val}', color: 'black', size: 'normal', anchor: 'below' }];
    const code = exportOf(data);
    const plot = lines(code).find((l) => l.startsWith('\\addplot[etBlue'));
    assert.ok(plot && plot.includes('{1+(0*x)}'), plot);
    assert.ok(code.includes('\\node[black, anchor=north, font=\\small] at (axis cs:3,1) {best: 9};'), code);
});

test('legend entries with an alignment go through a save box', () => {
    const code = exportOf({ functions: [fn('f1', 'x < 1 ? 0 : 1', { showLegend: true }), fn('f2', 'x', { showLegend: true })] });
    const ls = lines(code);
    const box = ls.findIndex((l) => l.startsWith('\\sbox{\\etzLegendA}'));
    assert.ok(ls.includes('\\ifdefined\\etzLegendA\\else\\newsavebox{\\etzLegendA}\\fi'));
    assert.ok(box > 0 && box < ls.indexOf('\\begin{axis}['), code);
    assert.ok(ls.includes('\\addlegendentry{\\raisebox{\\depth}{\\usebox{\\etzLegendA}}}'));
    assert.ok(ls.includes('\\addlegendentry{\\(x\\)}'));
    checkLegendAdjacency(code, 'boxes');
});

test('colours: palette names, hex values, CSS names (their CSS values), unknown names', () => {
    const names = ['purple', '#ff8800', 'cyan', 'nope', 'lime', 'Lime', '#00ff00', 'violet', 'darkgray', 'navy', 'white', 'BLACK'];
    const code = exportOf({
        xmin: '0',
        xmax: '1',
        ymin: '-1',
        ymax: '20',
        functions: names.map((color, i) => fn(`f${i + 1}`, `x + ${i}`, { color })),
    });
    const ls = lines(code);
    const plotColor = (i: number) => {
        const l = ls[ls.indexOf(`% f${i + 1}`) + 1] || '';
        assert.ok(l.startsWith('\\addplot['), `plot of f${i + 1}: ${l}`);
        return l.slice('\\addplot['.length, l.indexOf(','));
    };
    assert.ok(ls.includes('\\definecolor{etPurple}{HTML}{9B59B6}'));
    assert.equal(plotColor(0), 'etPurple');
    assert.ok(ls.includes('\\definecolor{etHexFF8800}{HTML}{FF8800}'));
    // xcolor's own cyan, lime, violet, darkgray differ from CSS: the CSS value is defined.
    assert.ok(ls.includes('\\definecolor{etHex00FFFF}{HTML}{00FFFF}'));
    assert.equal(plotColor(2), 'etHex00FFFF');
    assert.equal(plotColor(3), 'black');
    assert.ok(!code.includes('nope'));
    // lime, Lime (CSS names ignore case) and #00ff00 share one definition.
    for (const i of [4, 5, 6]) assert.equal(plotColor(i), 'etHex00FF00');
    assert.equal(ls.filter((l) => l.startsWith('\\definecolor{etHex00FF00}{HTML}{00FF00}')).length, 1);
    assert.ok(ls.includes('\\definecolor{etHexEE82EE}{HTML}{EE82EE}'));
    assert.ok(ls.includes('\\definecolor{etHexA9A9A9}{HTML}{A9A9A9}'));
    assert.ok(ls.includes('\\definecolor{etHex000080}{HTML}{000080}'));
    // White and black are xcolor's own (the same values).
    assert.equal(plotColor(10), 'white');
    assert.equal(plotColor(11), 'black');
});

test('middle axes put their labels beyond the arrow tips', () => {
    const code = exportOf({ axis_style: 'middle', xmin: '-2', xmax: '2', ymin: '-2', ymax: '2', functions: [fn('f1', 'x')] });
    assert.ok(lines(code).includes('  axis lines=middle, xlabel style={anchor=west}, ylabel style={anchor=south},'), code);
    assert.ok(!exportOf({ axis_style: 'box', functions: [fn('f1', 'x')] }).includes('label style'));
});

test('legend and its save boxes use \\footnotesize', () => {
    const code = exportOf({ functions: [fn('f1', 'x < 1 ? 0 : 1', { showLegend: true }), fn('f2', 'x', { showLegend: true })] });
    assert.ok(lines(code).includes('  legend pos=north east, legend cell align=left, legend style={font=\\footnotesize},'), code);
    assert.ok(lines(code).some((l) => l.startsWith('\\sbox{\\etzLegendA}{\\footnotesize ')));
});

test('fill patterns map to TikZ patterns (crosshatch is the diagonal one)', () => {
    const expected: Record<string, string> = {
        horizontal: 'horizontal lines',
        vertical: 'vertical lines',
        crosshatch: 'crosshatch',
        dots: 'crosshatch dots',
        'north-east': 'north east lines',
        'north-west': 'north west lines',
    };
    for (const [key, tikz] of Object.entries(expected)) {
        const code = exportOf({ tools: [region('R1', ['x + y <= 4', 'x >= 0', 'y >= 0'], { fillPattern: key })] });
        assert.ok(code.includes(`\\fill[pattern=${tikz}, pattern color=etBlue, even odd rule]`), `${key}: ${code}`);
    }
    assert.ok(!exportOf({ tools: [region('R1', ['x + y <= 4', 'x >= 0', 'y >= 0'])] }).includes('pattern='));
});

// ----------------------------------------------------------- 3D export

test('3D: surfaces, planes, points, segments and axis options', () => {
    const data = example('plane3d');
    const code = exportOf(data);
    const ls = lines(code);
    for (const opt of ['  trig format plots=rad,', '  unbounded coords=jump,', '  restrict z to domain=-80:88,', '  clip mode=individual,']) {
        assert.ok(ls.includes(opt), `missing option ${opt}`);
    }
    // Explicit unit vectors set camera, shape and size: no view, width, height or unit vector ratio.
    assert.ok(!ls.some((l) => l.startsWith('  view=') || l.startsWith('  width=')), code);
    assert.ok(!code.includes('unit vector ratio'));
    assert.ok(ls.includes('% Camera as in the preview: azimuth 45, elevation 30 (pgfplots view={-45}{30})'), code);
    unitVectors(code);
    // The z = 3 plane cuts the paraboloid: the part behind it, the plane, the part in front.
    assert.equal(plotOrder(code), 'SPS');
    const surfs = ls.filter((l) => l.startsWith('\\addplot3[surf'));
    for (const surf of surfs) {
        assert.ok(surf.includes('domain=-2:2, y domain=-2:2, samples=30') && surf.endsWith('{(x^2)+(y^2)};'), surf);
        assert.ok(surf.includes('colormap={etSurface1}{color=(etBlue!30!white) color=(etBlue)}'), surf);
    }
    const back = /restrict z to domain=-80:([\d.]+),/.exec(surfs[0]);
    assert.ok(back && Number(back[1]) > 3 && Number(back[1]) < 4, surfs[0]);
    assert.ok(surfs[1].includes('restrict z to domain=3:88,'), surfs[1]);
    assert.ok(ls.includes('% f1, behind z = 3') && ls.includes('% f1, in front of z = 3'), code);
    assert.ok(ls.includes('\\addplot3[etOrange, fill=etOrange, fill opacity=0.35, draw opacity=0.65, forget plot] coordinates {(-2,-2,3) (2,-2,3) (2,2,3) (-2,2,3) (-2,-2,3)};'));
    assert.ok(ls.some((l) => l.includes('at (axis cs:2,-2,3) {z = 3};')));
    checkNumbers(code, 'plane3d');
});

test('3D: the preview camera, box shape and paper fit', () => {
    const chart = (over: Record<string, unknown>) =>
        exportOf({
            dimension: true,
            xmin: '-2',
            xmax: '2',
            ymin: '-2',
            ymax: '2',
            zmin: '-4',
            zmax: '4',
            size_x_cm: 10,
            size_y_cm: 8,
            functions3D: [surface('f1', 'x*y')],
            ...over,
        });
    const deg = Math.PI / 180;
    for (const [az, el] of [
        [45, 30],
        [120, 30],
        [200, 10],
        [0, 90],
    ]) {
        const code = chart({ rotationZ: az, rotationX: el, boxAspect: 'equal' });
        const [x, y, z] = unitVectors(code);
        // renderer3d project(): x -> (cos az, sin az sin el), y -> (-sin az, cos az sin el), z -> (0, cos el), each times 2 / range.
        const k = x[0] !== 0 ? x[0] / (Math.cos(az * deg) * 0.5) : x[1] / (Math.sin(az * deg) * Math.sin(el * deg) * 0.5);
        assert.ok(k > 0, `${az}/${el}: scale ${k}`);
        near(x[0], Math.cos(az * deg) * 0.5 * k, 1e-4, `${az}/${el} x right`);
        near(x[1], Math.sin(az * deg) * Math.sin(el * deg) * 0.5 * k, 1e-4, `${az}/${el} x up`);
        near(y[0], -Math.sin(az * deg) * 0.5 * k, 1e-4, `${az}/${el} y right`);
        near(y[1], Math.cos(az * deg) * Math.sin(el * deg) * 0.5 * k, 1e-4, `${az}/${el} y up`);
        near(z[0], 0, 0, `${az}/${el} z right`);
        near(z[1], Math.cos(el * deg) * 0.25 * k, 1e-4, `${az}/${el} z up`);
        // The box fills the paper less the label margins (1.6 cm across, 1.2 cm down) in one direction.
        const [w, h] = boxExtent([x, y, z], [4, 4, 8]);
        assert.ok(w <= 8.4 + 1e-3 && h <= 6.8 + 1e-3 && (Math.abs(w - 8.4) < 1e-3 || Math.abs(h - 6.8) < 1e-3), `${az}/${el}: ${w} x ${h}`);
    }
    // 'equal' is a cube whatever the ranges; 'true' keeps the data proportions.
    const cube = unitVectors(chart({ boxAspect: 'equal' }));
    near(Math.hypot(...cube[0]) * 4, Math.hypot(...cube[1]) * 4, 1e-4, 'cube x / y edges');
    near((cube[2][1] * 8) / (cube[0][0] * 4), Math.cos(30 * deg) / Math.cos(45 * deg), 1e-3, 'cube height / x edge across');
    const prop = unitVectors(chart({ boxAspect: 'true' }));
    const across = Math.hypot(Math.cos(45 * deg), Math.sin(45 * deg) * Math.sin(30 * deg));
    near(Math.hypot(...prop[0]) / across, Math.hypot(...prop[2]) / Math.cos(30 * deg), 1e-3, 'equal units on x and z');
    // With equal ranges both aspects draw the same box.
    assert.deepEqual(unitVectors(chart({ boxAspect: 'true', zmin: '-2', zmax: '2' })), unitVectors(chart({ boxAspect: 'equal', zmin: '-2', zmax: '2' })));
    // Ranges whose units TeX cannot hold fall back to pgfplots' own fit, seen from the same side.
    const tiny = chart({ boxAspect: 'equal', zmin: '0', zmax: '0.001', functions3D: [surface('f1', '0.0005')] });
    assert.ok(lines(tiny).includes('  width=10cm, height=8cm,') && lines(tiny).includes('  view={-45}{30},'), tiny);
    checkNumbers(tiny, 'tiny');
});

test('3D: the surface budget keeps pgfplots within TeX memory', () => {
    const squares = (code: string) =>
        lines(code)
            .filter((l) => l.startsWith('\\addplot3[surf') || l.startsWith('\\addplot3[mesh'))
            .reduce((sum, l) => {
                const nx = Number((/samples=(\d+)/.exec(l) || [])[1]);
                const ny = Number((/samples y=(\d+)/.exec(l) || [])[1] || nx);
                return sum + nx * ny;
            }, 0);
    const heavy = exportOf({
        dimension: true,
        functions3D: [surface('f1', 'sin(x)*cos(y)', { samples: 80 }), surface('f2', 'x^2/5 - y^2/5', { samples: 80 }), surface('f3', '2exp(-(x^2+y^2))', { samples: 80, wireframe: true })],
    });
    assert.ok(squares(heavy) <= 6000 && squares(heavy) > 5000, `heavy: ${squares(heavy)}`);
    const six = exportOf({ dimension: true, functions3D: Array.from({ length: 6 }, (_, i) => surface(`f${i + 1}`, `x / ${i + 1}`, { samples: 40 })) });
    assert.ok(squares(six) <= 6000, `six: ${squares(six)}`);
    // A surface cut at a plane counts once per piece.
    const cut = exportOf({
        dimension: true,
        zmin: '-1',
        zmax: '1',
        functions3D: [surface('f1', 'sin(x)*cos(y)', { samples: 60 }), surface('f2', 'x*y/10', { samples: 60 })],
        tools: [plane('PL1', 'z', '0.2')],
    });
    assert.equal(plotOrder(cut), 'SSPSS');
    assert.ok(squares(cut) <= 6000, `cut: ${squares(cut)}`);
    // One surface at the cap is left alone.
    assert.ok(exportOf({ dimension: true, functions3D: [surface('f1', 'x', { samples: 60 })] }).includes('samples=60]'));
});

test('3D: planes in painter order with the surfaces', () => {
    const base = { dimension: true, xmin: '-3', xmax: '3', ymin: '-3', ymax: '3', zmin: '-2', zmax: '2', functions3D: [surface('f1', 'sin(x)*cos(y)', { samples: 40 })] };
    // Azimuth 45: larger x is farther away, so the piece x >= 1 comes first.
    const x = exportOf({ ...base, tools: [plane('PL1', 'x', '1')] });
    assert.equal(plotOrder(x), 'SPS');
    const xs = lines(x).filter((l) => l.startsWith('\\addplot3[surf'));
    assert.ok(xs[0].includes('domain=1:3, y domain=-3:3, samples=14, samples y=40'), xs[0]);
    assert.ok(xs[1].includes('domain=-3:1, y domain=-3:3, samples=27, samples y=40'), xs[1]);
    assert.ok(!x.includes('restrict z to domain=-2') && !xs.some((l) => l.includes('restrict')), x);
    // Seen from azimuth 225 the order turns round.
    const x2 = lines(exportOf({ ...base, rotationZ: 225, tools: [plane('PL1', 'x', '1')] })).filter((l) => l.startsWith('\\addplot3[surf'));
    assert.ok(xs.length === 2 && x2[0].includes('domain=-3:1,') && x2[1].includes('domain=1:3,'), x2.join('\n'));
    // Two y planes: three pieces, far to near (azimuth 45: larger y is farther, too).
    const y = exportOf({ ...base, tools: [plane('PL1', 'y', '-1'), plane('PL2', 'y', '1.5')] });
    assert.equal(plotOrder(y), 'SPSPS');
    const ys = lines(y).filter((l) => l.startsWith('\\addplot3[surf'));
    assert.ok(ys[0].includes('y domain=1.5:3,') && ys[1].includes('y domain=-1:1.5,') && ys[2].includes('y domain=-3:-1,'), ys.join('\n'));
    assert.ok(['% f1, behind y = 1.5', '% plane y = 1.5', '% f1, between y = 1.5 and y = -1', '% plane y = -1', '% f1, in front of y = -1'].every((c) => lines(y).includes(c)), y);
    // A surface on one side of the plane is one plot on that side.
    assert.equal(plotOrder(exportOf({ ...base, functions3D: [surface('f1', '-1.5')], tools: [plane('PL1', 'z', '1')] })), 'SP');
    assert.equal(plotOrder(exportOf({ ...base, functions3D: [surface('f1', '1.5')], tools: [plane('PL1', 'z', '1')] })), 'PS');
    // Planes on mixed axes, or seen edge-on, keep surfaces first.
    const mixed = exportOf({ ...base, tools: [plane('PL1', 'z', '0.5'), plane('PL2', 'x', '-1')] });
    assert.equal(plotOrder(mixed), 'SPP');
    assert.ok(lines(mixed).includes('% planes'));
    assert.equal(plotOrder(exportOf({ ...base, rotationX: 0, tools: [plane('PL1', 'z', '0.5')] })), 'SP');
});

test('3D: samples clamped, segments clipped to the box, outside points dropped', () => {
    const code = exportOf({
        dimension: true,
        xmin: '-1',
        xmax: '1',
        ymin: '-1',
        ymax: '1',
        zmin: '-1',
        zmax: '1',
        functions3D: [{ expression: 'x*y', xDomain: '', yDomain: '', color: 'red', wireframe: true, opacity: 1, samples: 200, name: 'f1' }],
        tools: [
            segment('S1', '(0, 0, 0); (0, 0, 10)', { dim: 3, style: 'both' }),
            points('P1', { dim: 3, points: '(0, 0, 0.5); (5, 5, 5)', label: 'A; B' }),
        ],
    });
    assert.ok(code.includes('\\addplot3[mesh, colormap={etSurface1}{color=(etRed) color=(etRed)}, domain=-1:1, y domain=-1:1, samples=60] {x*y};'), code);
    assert.ok(code.includes('\\addplot3[black, thin, <-, forget plot] coordinates {(0,0,0) (0,0,1)};'), code);
    assert.ok(code.includes('coordinates {(0,0,0.5)};') && !code.includes('(5,5,5)'));
    assert.ok(code.includes('{A};') && !code.includes('{B};'));
    // generateTikzCode dispatches on the dimension; generate3DTikzCode is the same output.
    const s = settings({ dimension: true, functions3D: [{ expression: 'x', xDomain: '', yDomain: '', color: 'blue', wireframe: false, opacity: 0.5, samples: 10 }] });
    assert.equal(s.generateTikzCode(), s.generate3DTikzCode());
});
