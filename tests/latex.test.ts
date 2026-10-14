/*
 * Compiles exported TikZ with pdflatex: every example, the finished chart of every guide, one 3.x block per
 * legacy tool type, and stress cases (steep functions, awkward label text,
 * a patterned region with a hole, parametric, polar, 3D surfaces at the
 * memory budget, surfaces cut at planes, turned cameras, extreme 3D
 * ranges, CSS colour names, snippet mode).
 * Skipped with a message when pdflatex is not on PATH.
 *
 * ETZ_LATEX_KEEP=<dir> keeps the .tex / .pdf / .log files in <dir>.
 */
import { spawn, spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { test, assert } from './_lib';
import { SettingsManager } from '../src/settings';
import { EXAMPLES } from '../src/migrate';
import { GUIDES } from '../src/guides';
import { Function3DParameters, FunctionParameters } from '../src/types';

const TIMEOUT_MS = 30000;
const PARALLEL = 4;

// ------------------------------------------------------------- fixtures

/** A 3.19.6 block as SettingsManager.serialize() wrote it (no version field). */
function legacyBlock(over: Record<string, unknown>): Record<string, unknown> {
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
        ...over,
    };
}

function legacyFn(expression: string, domain: string, over: Record<string, unknown> = {}): Record<string, unknown> {
    return {
        expression,
        domain,
        showLegend: true,
        fill: false,
        fillOpacity: 0.15,
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

function surface3(name: string, expression: string, color: string, over: Partial<Function3DParameters> = {}): Function3DParameters {
    return { name, expression, xDomain: '', yDomain: '', color, wireframe: false, opacity: 0.8, samples: 30, ...over };
}

/** A v4 chart: every key at its default (SettingsManager.fromJSON fills the rest). */
function chart(over: Record<string, unknown>): Record<string, unknown> {
    return { v: 4, ...over };
}

const LEGACY_2D: Record<string, Record<string, unknown>> = {
    areaBetween: legacyBlock({
        functions: [legacyFn('x^2/4', '0:4', { name: 'f1' }), legacyFn('x', '0:4', { name: 'f2', color: 'red' })],
        tools: [{ type: 'areaBetween', func1Name: 'f1', func2Name: 'f2', domain: '0:4', color: 'green', fillOpacity: 0.3, fillPattern: 'north-east' }],
    }),
    intersection: legacyBlock({
        functions: [legacyFn('sin(x) + 2', '0:10'), legacyFn('2 + 0.1*x', '0:10', { color: 'red' })],
        tools: [{ type: 'intersection', func1Name: 'f1', func2Name: 'f2', color: 'black', showLabels: true }],
    }),
    verticalLine: legacyBlock({ tools: [{ type: 'verticalLine', x: '2', color: 'red', thickness: 'thick', dashed: true, label: 'x = 2' }] }),
    horizontalLine: legacyBlock({ tools: [{ type: 'horizontalLine', y: '3', color: 'teal', thickness: 'thin', dashed: false, label: 'y_max' }] }),
    rectangle: legacyBlock({
        tools: [{ type: 'rectangle', x1: '1', y1: '1', x2: '3', y2: '2.5', color: 'purple', thickness: 'thin', fill: true, fillOpacity: 0.2, fillPattern: 'crosshatch' }],
    }),
    circle: legacyBlock({
        tools: [{ type: 'circle', cx: '5', cy: '2', r: '1.5', color: 'orange', thickness: 'thick', fill: true, fillOpacity: 0.3, fillPattern: 'dots' }],
    }),
    segment: legacyBlock({
        tools: [{ type: 'segment', x1: '0', y1: '0', x2: '4', y2: '4', color: 'black', thickness: 'thick', dashed: false, arrow: 'forward' }],
    }),
    brace: legacyBlock({ tools: [{ type: 'brace', x1: '1', y1: '0', x2: '6', y2: '0', color: 'blue', label: 'width' }] }),
};

const LEGACY_3D: Record<string, Record<string, unknown>> = {
    plane3D: legacyBlock({
        dimension: true,
        functions3D: [{ expression: 'sin(x)*cos(y)', xDomain: '-3:3', yDomain: '-3:3', color: 'blue', wireframe: false, opacity: 0.7, samples: 25 }],
        tools: [{ type: 'plane3D', axis: 'z', value: '0.5', color: 'orange', fillOpacity: 0.3 }],
    }),
    point3D: legacyBlock({ dimension: true, tools: [{ type: 'point3D', x: '1', y: '1', z: '2', color: 'red', label: 'P_1' }] }),
    segment3D: legacyBlock({
        dimension: true,
        tools: [{ type: 'segment3D', x1: '0', y1: '0', z1: '0', x2: '2', y2: '2', z2: '3', color: 'green', thickness: 'thick', dashed: true, arrow: 'both' }],
    }),
};

const AWKWARD = ['x_1', '50% cut', '$x^*$', 'x + y <= 4 | "q"', 'costs $5 and $10'];

const STRESS: Record<string, Record<string, unknown>> = {
    steep: chart({
        xmin: '-10',
        xmax: '10',
        ymin: '-10',
        ymax: '10',
        size_x_cm: 20,
        size_y_cm: 20,
        functions: [
            fn('f1', 'x^3', { showLegend: true }),
            fn('f2', 'tan(x)', { color: 'red', showLegend: true }),
            fn('f3', 'exp(x)', { color: 'green', showLegend: true }),
            fn('f4', 'floor(x)', { color: 'gray' }),
            fn('f5', '1/x', { color: 'purple', dashed: true }),
        ],
    }),
    labels: chart({
        title: AWKWARD.join(' / '),
        axis_label_x: 'x_1 (50%)',
        axis_label_y: '$x_2$',
        functions: [fn('f1', 'x/2', { showLegend: true, legendLabel: '50% cut' }), fn('f2', 'x/3 + 1', { showLegend: true, legendLabel: '$x^*$' })],
        tools: [
            {
                id: 'a', name: 'R1', type: 'region', color: 'blue', conditions: ['x + y <= 4', 'x >= 0', 'y >= 0'],
                conditionLabels: ['x_1 & co', '', ''], fill: true, fillOpacity: 0.25, fillPattern: 'solid', outline: 'solid',
                thickness: 'thin', constraintLines: true, label: '50% cut',
            },
            {
                id: 'b', name: 'P1', type: 'points', color: 'red', dim: 2, source: 'region', points: '', ref1: '', ref2: '',
                regionName: 'R1', objective: 'x + 2y', sense: 'max', label: '$x^*$ = ({x}, {y}) #1', dropLines: true, size: 'large',
            },
        ],
        annotations: AWKWARD.map((text, i) => ({ x: String(1 + 3 * i), y: '4.5', text, color: 'black', size: 'normal', anchor: 'center' })),
    }),
    hole: chart({
        xmin: '-4',
        xmax: '4',
        ymin: '-4',
        ymax: '4',
        equalScale: true,
        tools: [
            {
                id: 'a', name: 'R1', type: 'region', color: 'green', conditions: ['x^2 + y^2 <= 9', 'x^2 + y^2 >= 1 or x >= 2'],
                conditionLabels: ['', ''], fill: true, fillOpacity: 0.3, fillPattern: 'north-east', outline: 'dashed',
                thickness: 'thick', constraintLines: false, label: 'ring',
            },
        ],
    }),
    parametric: chart({
        xmin: '-1.5',
        xmax: '1.5',
        ymin: '-1.5',
        ymax: '1.5',
        functions: [fn('f1', 'cos(3t)', { parametric: true, expressionY: 'sin(2t)', showLegend: true })],
    }),
    polar: chart({
        coordinateSystem: 'polar',
        xmin: '-2.5',
        xmax: '2.5',
        ymin: '-2.5',
        ymax: '2.5',
        functions: [fn('f1', '2cos(3theta)', { showLegend: true }), fn('f2', '1 + 0.5sin(theta)', { color: 'red', domain: '0:pi' })],
    }),
    pgfmath: chart({
        xmin: '-3',
        xmax: '3',
        ymin: '-3',
        ymax: '3',
        parameters: [{ name: 'a', value: -1.5, min: -3, max: 3, step: 0.1 }],
        functions: [
            fn('f1', 'x^2', { domain: '0:2', hidden: true }),
            fn('f2', 'f1(x) - 1', { showLegend: true }),
            fn('f3', 'x < 0 ? -1 : x < 1 ? 0 : 1', { color: 'red', showLegend: true }),
            fn('f4', 'hypot(x, 1, 1) + round(x) % 2 + a', { color: 'green', showLegend: true }),
            fn('f5', 'asinh(x) + csc(x + 4) / 10 + log(x + 4) - 2^-x^2', { color: 'purple', showLegend: true }),
            fn('f6', 'x^2 - 2', { color: 'orange', fill: true, fillPattern: 'crosshatch', tangent: true, tangentPoint: 'a', extrema: true }),
        ],
        tools: [
            { id: 's', name: 'S1', type: 'segment', color: 'black', dim: 2, path: '(0, 0); (1000, 4)', closed: false, style: 'both', thickness: 'thin', dashed: false, label: 'far' },
            { id: 'b', name: 'S2', type: 'segment', color: 'teal', dim: 2, path: '(-2, -2); (2, -2)', closed: false, style: 'brace', thickness: 'thin', dashed: false, label: 'base' },
            { id: 'p', name: 'P1', type: 'points', color: 'black', dim: 2, source: 'list', points: '(1, 1); (100, 100)', ref1: '', ref2: '', regionName: '', objective: '', sense: 'max', label: '{i}', dropLines: false, size: 'small' },
        ],
    }),
    // Twelve wiggly regions with outlines: the point budget must keep TeX within its memory.
    budget: chart({
        xmin: '-5',
        xmax: '5',
        ymin: '-5',
        ymax: '5',
        tools: Array.from({ length: 12 }, (_, i) => ({
            id: `r${i}`, name: `R${i + 1}`, type: 'region', color: 'blue',
            conditions: [`y <= ${i % 3} + sin(${8 + i}x) + 0.5cos(${13 + i}y)`, `y >= -4 + cos(${7 + i}x)`],
            conditionLabels: ['', ''], fill: true, fillOpacity: 0.25, fillPattern: 'solid', outline: 'solid',
            thickness: 'thin', constraintLines: false, label: '',
        })),
    }),
    surface3d: chart({
        dimension: true,
        xmin: '-3',
        xmax: '3',
        ymin: '-3',
        ymax: '3',
        zmin: '-2',
        zmax: '2',
        functions3D: [
            { expression: 'sin(x)*cos(y)', xDomain: '', yDomain: '', color: 'teal', wireframe: false, opacity: 0.8, samples: 200, name: 'f1' },
            { expression: 'exp(x + y)', xDomain: '-3:3', yDomain: '-3:3', color: 'red', wireframe: true, opacity: 1, samples: 20, name: 'f2' },
        ],
        tools: [
            { id: 'a', name: 'PL1', type: 'plane3D', color: 'orange', axis: 'x', value: '1', fillOpacity: 0.3 },
            { id: 'b', name: 'P1', type: 'points', color: 'red', dim: 3, source: 'list', points: '(0, 0, 1); (1, 1, 1)', ref1: '', ref2: '', regionName: '', objective: '', sense: 'max', label: 'x_1; 50%', dropLines: false, size: 'normal' },
            { id: 'c', name: 'S1', type: 'segment', color: 'black', dim: 3, path: '(0, 0, 0); (0, 0, 10)', closed: false, style: 'forward', thickness: 'thick', dashed: false, label: '' },
        ],
        annotations: [{ x: '0', y: '0', z: '1.5', text: '$z = \\sin x \\cos y$', color: 'black', size: 'large', anchor: 'above' }],
    }),
    // Three dense surfaces: 3 x 60 samples exceed TeX's main memory without the surface budget.
    heavy3d: chart({
        dimension: true,
        xmin: '-3',
        xmax: '3',
        ymin: '-3',
        ymax: '3',
        zmin: '-2',
        zmax: '2',
        functions3D: [
            surface3('f1', 'sin(x)*cos(y)', 'teal', { samples: 80 }),
            surface3('f2', 'x^2/5 - y^2/5', 'red', { samples: 80 }),
            surface3('f3', '2exp(-(x^2+y^2))', 'blue', { samples: 80, wireframe: true }),
        ],
    }),
    // Surfaces cut at a z plane (pieces with restrict z), at two y planes (split domains).
    planesZ: chart({
        dimension: true,
        xmin: '-2',
        xmax: '2',
        ymin: '-2',
        ymax: '2',
        zmin: '-1',
        zmax: '1',
        functions3D: [surface3('f1', 'sin(2x)*cos(y)', 'teal', { samples: 60 }), surface3('f2', 'x*y/4', 'red', { samples: 60, wireframe: true })],
        tools: [{ id: 'a', name: 'PL1', type: 'plane3D', color: 'orange', axis: 'z', value: '0.2', fillOpacity: 0.35 }],
    }),
    planesY: chart({
        dimension: true,
        rotationZ: 120,
        xmin: '-3',
        xmax: '3',
        ymin: '-3',
        ymax: '3',
        zmin: '-2',
        zmax: '2',
        functions3D: [surface3('f1', 'sin(x)*cos(y)', 'teal', { samples: 40 })],
        tools: [
            { id: 'a', name: 'PL1', type: 'plane3D', color: 'orange', axis: 'y', value: '-1', fillOpacity: 0.35 },
            { id: 'b', name: 'PL2', type: 'plane3D', color: 'purple', axis: 'y', value: '1.5', fillOpacity: 0.35 },
        ],
    }),
    // A turned, low camera, data proportions, labels at the box corners (clip mode=individual).
    camera3d: chart({
        dimension: true,
        title: 'Turned camera',
        rotationZ: 200,
        rotationX: 10,
        boxAspect: 'true',
        size_x_cm: 12,
        size_y_cm: 6,
        xmin: '0',
        xmax: '2000',
        ymin: '0',
        ymax: '1000',
        zmin: '0',
        zmax: '500',
        functions3D: [surface3('f1', 'x/8 + y/8', 'blue', { samples: 20 })],
        tools: [
            { id: 'p', name: 'P1', type: 'points', color: 'red', dim: 3, source: 'list', points: '(2000, 0, 0); (0, 1000, 500)', ref1: '', ref2: '', regionName: '', objective: '', sense: 'max', label: 'corner A; corner B', dropLines: false, size: 'normal' },
        ],
    }),
    // Ranges TeX cannot hold as unit vectors: pgfplots' own fit.
    tiny3d: chart({
        dimension: true,
        boxAspect: 'equal',
        xmin: '-2',
        xmax: '2',
        ymin: '-2',
        ymax: '2',
        zmin: '0',
        zmax: '0.001',
        functions3D: [surface3('f1', '0.0005 + 0.0001*x*y', 'green', { samples: 20 })],
    }),
    // LaTeX commands in labels (texLabel): styled text, escapes and math-only commands outside $...$.
    latexLabels: chart({
        title: '\\textbf{Revenue} in \\%',
        axis_label_y: 'Preis in \\textit{EUR}',
        parameters: [{ name: 'omicron', value: 1, min: 0, max: 2, step: 0.1 }],
        functions: [
            fn('f1', '09*x + 010', { showLegend: true, legendLabel: '\\textit{Nachfrage}' }),
            fn('f2', 'omicron*x', { color: 'red', showLegend: true }),
        ],
        annotations: [
            { x: '2', y: '3', text: '\\textbf{A}', color: 'black', size: 'normal', anchor: 'center' },
            { x: '5', y: '2', text: 'level \\alpha = 0.05', color: 'blue', size: 'small', anchor: 'right' },
        ],
    }),
    // CSS colour names, middle axes with labels beyond the tips, a legend.
    colors: chart({
        axis_style: 'middle',
        xmin: '-2',
        xmax: '2',
        ymin: '-2',
        ymax: '4',
        functions: ['lime', 'Navy', 'darkgray', 'violet', '#ff8800', 'white', 'nope'].map((color, i) =>
            fn(`f${i + 1}`, `x / 2 + ${i / 2}`, { color, showLegend: i < 3 })
        ),
    }),
};

// --------------------------------------------------------------- compile

/** The block's export as a complete document. Snippets are wrapped using their own `% Needs:` lines. */
function documentFor(data: Record<string, unknown>): string {
    const code = SettingsManager.fromJSON(JSON.parse(JSON.stringify(data))).generateTikzCode();
    if (code.startsWith('\\documentclass')) return code;
    const needs = code
        .split('\n')
        .filter((l) => l.startsWith('% Needs: '))
        .map((l) => l.slice('% Needs: '.length));
    assert.ok(needs.length >= 2, 'a snippet lists what it needs');
    return ['\\documentclass{article}', ...needs, '\\begin{document}', code, '\\end{document}'].join('\n');
}

/** First error of a pdflatex log with the lines that explain it. */
function logExcerpt(log: string): string {
    const lines = log.split('\n');
    const at = lines.findIndex((l) => l.startsWith('!'));
    if (at < 0) return lines.slice(-25).join('\n');
    return lines.slice(Math.max(0, at - 2), at + 12).join('\n');
}

function compile(dir: string, name: string, tex: string): Promise<void> {
    fs.writeFileSync(path.join(dir, `${name}.tex`), tex);
    return new Promise((resolve, reject) => {
        const child = spawn('pdflatex', ['-interaction=nonstopmode', '-halt-on-error', `${name}.tex`], {
            cwd: dir,
            stdio: 'ignore',
            timeout: TIMEOUT_MS,
        });
        child.on('error', reject);
        child.on('close', (code, signal) => {
            if (code === 0 && fs.existsSync(path.join(dir, `${name}.pdf`))) {
                resolve();
                return;
            }
            const logFile = path.join(dir, `${name}.log`);
            const log = fs.existsSync(logFile) ? fs.readFileSync(logFile, 'utf8') : '(no log)';
            const why = signal ? `timed out after ${TIMEOUT_MS / 1000} s` : `exit code ${code}`;
            reject(new Error(`pdflatex failed on ${name}.tex (${why}):\n${logExcerpt(log)}`));
        });
    });
}

/** Runs compile jobs PARALLEL at a time; each test awaits its own job. */
function pool(jobs: Array<{ name: string; run: () => Promise<void> }>): Map<string, Promise<void>> {
    const out = new Map<string, Promise<void>>();
    const queue: Array<() => void> = [];
    let active = 0;
    const acquire = () =>
        new Promise<void>((resolve) => {
            const go = () => {
                active++;
                resolve();
            };
            if (active < PARALLEL) go();
            else queue.push(go);
        });
    const release = () => {
        active--;
        const next = queue.shift();
        if (next) next();
    };
    for (const job of jobs) {
        const p = acquire().then(() => job.run().finally(release));
        // The test awaiting this job reports its failure.
        p.catch(() => undefined);
        out.set(job.name, p);
    }
    return out;
}

const hasLatex = spawnSync('pdflatex', ['--version'], { stdio: 'ignore' }).status === 0;

if (!hasLatex) {
    test('latex compile tests (skipped: pdflatex is not on PATH)', () => undefined);
} else {
    const keep = process.env.ETZ_LATEX_KEEP;
    const dir = keep ? path.resolve(keep) : fs.mkdtempSync(path.join(os.tmpdir(), 'etz-latex-'));
    fs.mkdirSync(dir, { recursive: true });

    const cases: Array<{ name: string; data: Record<string, unknown> }> = [];
    for (const ex of EXAMPLES) cases.push({ name: `example-${ex.id}`, data: ex.data });
    // The finished chart of every guide: the block its page on GitHub offers to paste.
    for (const guide of GUIDES) cases.push({ name: `guide-${guide.id}`, data: guide.chart });
    for (const [k, data] of Object.entries(LEGACY_2D)) cases.push({ name: `legacy-${k}`, data });
    for (const [k, data] of Object.entries(LEGACY_3D)) cases.push({ name: `legacy-${k}`, data });
    for (const [k, data] of Object.entries(STRESS)) cases.push({ name: `stress-${k}`, data });
    // Snippet mode for a 2D picture with patterns and braces, and for a 3D one.
    cases.push({ name: 'snippet-2d', data: { ...STRESS.pgfmath, documentSetup: false, tools: [...(STRESS.pgfmath.tools as unknown[]), ...(STRESS.hole.tools as unknown[])] } });
    cases.push({ name: 'snippet-3d', data: { ...STRESS.surface3d, documentSetup: false } });

    const jobs = pool(
        cases.map((c) => ({
            name: c.name,
            run: () => {
                const tex = documentFor(c.data);
                // Labels keep their LaTeX: nothing typed is printed as a literal backslash.
                assert.ok(!tex.includes('\\textbackslash'), `${c.name} prints a literal backslash`);
                return compile(dir, c.name, tex);
            },
        }))
    );
    for (const c of cases) {
        test(`pdflatex compiles ${c.name}`, async () => {
            await jobs.get(c.name);
        });
    }
    test('cleanup', async () => {
        await Promise.allSettled(Array.from(jobs.values()));
        if (!keep) fs.rmSync(dir, { recursive: true, force: true });
        else console.log(`  kept the LaTeX files in ${dir}`);
    });
}
