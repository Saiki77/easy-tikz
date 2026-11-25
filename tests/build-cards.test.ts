/*
 * The Build tab has a card for every object of a chart (6.0). The panel
 * itself needs Obsidian's DOM, so this checks the two layers under it:
 *   - which tools of a chart get a card: toolInChart (src/scene.ts), the
 *     filter of the Build tab (src/ui/buildPanel.ts), for one chart per
 *     tool type in 2D, and in 3D for every type a 3D chart draws;
 *   - that a card exists for every tool type: a case in createLayerCard or a
 *     registerToolCard call in a cards file the Build tab imports.
 * The bug this guards against: a 3D chart of version 6 (the Lorenz
 * butterfly, a transform of space) drew its objects, while the Build tab
 * said "No surfaces yet" and listed no card.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { test, assert } from './_lib';
import { TOOL_PREFIX, parseChartText } from '../src/text/parse';
import { NO_WORDS } from '../src/text/words';
import { SettingsManager } from '../src/settings';
import { computeScene3D, toolInChart } from '../src/scene';
import { GUIDES, V6_EXAMPLES } from '../src/guides';
import { Tool } from '../src/types';

const py = (...lines: string[]) => ['python:', ...lines.map((l) => `    ${l}`)].join('\n');

/** One chart per tool type in 2D: the lines before it, then the line of that type (last). */
const CHARTS_2D: Record<string, string> = {
    region: 'plot g(x) = x^2 - 4\nplot h(x) = 2 - x\nshade between g and h from x = -3 to 2',
    curve: 'draw 2x + 3y = 6',
    points: 'mark (1, 2)',
    segment: 'draw an arrow from (0, 0) to (1, 2)',
    data: 'data (1, 52), (2, 55), (3, 61)',
    dataPlot: 'data (1, 52), (2, 55), (3, 61)\nmark the data of D1',
    distribution: 'plot the binomial distribution with n = 10 and p = 0.5',
    probability: 'plot the binomial distribution with n = 10 and p = 0.5\nshade $P(4 \\le X \\le 6)$ of X1',
    riemann: 'plot f(x) = x^2\ndraw the middle Riemann sum of f from 0 to 1 with 4 parts',
    slopeField: "draw the slope field of y' = -x/y",
    solution: "draw the slope field of y' = -x/y\ndraw the solution of SF1 through (1, 1)",
    vectorField: 'draw the vector field $F(x, y) = (y, -x)$',
    restPoints: 'draw the vector field $F(x, y) = (y, -x)$\nmark the rest points of F',
    trajectory: 'draw the solution of $\\dot{p} = (y, -x)$ through (1, 0) for t from 0 to 10',
    axisSet: 'plot g(x) = x^2 - 4\nmark where $g(x) \\le 0$ on the x-axis',
    chord: 'slider lambda from 0 to 1, starting at 0.3\nplot g(x) = x^2 - 4\ndraw the chord of g from -1 to 3 at $\\lambda$',
    value: 'let v = (2, 1)',
    vector: 'let v = (2, 1)\ndraw v as an arrow',
    listPoints: 'mark the points of [(1, 0), (0, 1)], joined',
    planeGrid: 'draw the grid',
    basisVectors: 'draw the basis vectors',
    transform: 'let A = [[1, 1], [0, 1]]\ndraw the grid\ntransform the plane by A',
    eigenvectors: 'let A = [[2, 1], [1, 2]]\ndraw the eigenvectors of A',
    unitSquare: 'shade the unit square',
    span: 'let v = (1, 2)\ndraw the span of v',
    orbit: 'draw the orbit of $z_{n+1} = z_n^2 + c$, $z_0 = 0$, $c = -1$, 20 steps',
    cobweb: 'plot f(x) = 3.2 x (1 - x)\ndraw the cobweb of $x_{n+1} = f(x_n)$ from 0.2, 50 steps',
    bifurcation: 'draw the bifurcation diagram of $x_{n+1} = r x_n (1 - x_n)$ for r from 2.5 to 4',
    newton: 'plot g(x) = x^2 - 2\ndraw Newton\'s method for g from 2.5, 4 steps',
    colourPlane: 'colour the plane by $f(z) = z^2$',
    fourierCircles: 'draw the circles of $\\sum_{k=1}^{5} \\frac{4}{\\pi (2k - 1)} e^{i(2k - 1)t}$, with its wave',
    geogebra: 'c = Circle((0, 0), 1)',
    python: py('import numpy as np', 'k = 2'),
};

/** One 3D chart per tool type a 3D chart draws (and python, whose names a 3D chart reads). */
const CHARTS_3D: Record<string, string> = {
    points: 'mark (1, 1, 1)',
    segment: 'draw an arrow from (0, 0, 0) to (1, 1, 1)',
    plane3D: 'draw the plane z = 1',
    trajectory: 'draw the solution of $\\dot{p} = (10(y - x), x(28 - z) - y, xy - \\frac{8}{3}z)$ through (1, 1, 1) for t from 0 to 10',
    value: 'let u = (1, 2, 2)',
    vector: 'let u = (1, 2, 2)\ndraw u as an arrow',
    listPoints: 'mark the points of [(1, 0, 0), (0, 1, 0)], joined',
    planeGrid: 'draw the grid from -1 to 1',
    basisVectors: 'draw the basis vectors',
    transform: 'let B = [[2, 0, 0], [0, 1, 1], [0, 0, 1.5]]\ndraw the basis vectors\ntransform space by B',
    eigenvectors: 'let B = [[2, 0, 0], [0, 1, 0], [0, 0, 3]]\ndraw the eigenvectors of B',
    unitSquare: 'shade the unit cube',
    span: 'let u = (1, 2, 2)\ndraw the span of u',
    geogebra: 'A = (1, 2, 3)',
    python: `${py('k = 2')}\nplot f(x, y) = k x`,
};

/** Tool types of version 4 that a 3D chart keeps for the switch back to 2D, without drawing them or a card. */
const KEPT_FOR_2D = new Set(['region', 'curve']);

function read(lines: string, is3D: boolean): { data: Record<string, unknown>; tools: Tool[] } {
    const r = parseChartText(`${is3D ? '3d\n' : ''}${lines}`, { words: NO_WORDS });
    assert.deepEqual(
        r.problems.map((p) => p.message),
        [],
        lines
    );
    return { data: r.data, tools: (r.data.tools as Tool[]) ?? [] };
}

/** The last tool of a type: the one the chart was written for. */
function toolOf(tools: Tool[], type: string): Tool {
    const tool = [...tools].reverse().find((t) => t.type === type);
    assert.ok(tool, `a ${type} tool`);
    return tool;
}

const TYPES = Object.keys(TOOL_PREFIX);

test('every tool type has a 2D chart here, and plane3D is the only 3D-only type', () => {
    for (const type of TYPES) if (type !== 'plane3D') assert.ok(CHARTS_2D[type], `a 2D chart of ${type}`);
});

test('2D: every tool of every type has a card in the Build tab', () => {
    for (const [type, lines] of Object.entries(CHARTS_2D)) {
        const { tools } = read(lines, false);
        for (const tool of tools) assert.ok(toolInChart(tool, false), `${tool.type} (${tool.name}) in the 2D chart of ${type}`);
        toolOf(tools, type);
    }
});

test('3D: every tool a 3D chart draws has a card, and draws without a "2D only" problem', () => {
    for (const [type, lines] of Object.entries(CHARTS_3D)) {
        const { data, tools } = read(lines, true);
        assert.equal(data.dimension, true, type);
        const tool = toolOf(tools, type);
        for (const t of tools) assert.ok(toolInChart(t, true), `${t.type} (${t.name}) in the 3D chart of ${type}`);
        const settings = SettingsManager.fromJSON(data);
        const math = settings.createMathContext();
        const config = settings.toRendererConfig(math);
        const scene = computeScene3D({ tools: config.tools, math, view: { xmin: -5, xmax: 5, ymin: -5, ymax: 5, zmin: -5, zmax: 5 } });
        const errors = scene.issues.filter((i) => i.severity === 'error');
        assert.deepEqual(errors, [], `the 3D chart of ${type}`);
        if (type !== 'value' && type !== 'python') {
            const drawn = scene.points.length + scene.segments.length + scene.planes.length;
            assert.ok(drawn > 0, `the 3D chart of ${type} draws something (${tool.name})`);
        }
    }
});

test('3D: a tool without a card is one the chart reports as 2D only, or a 2D tool kept for the switch back', () => {
    for (const [type, lines] of Object.entries(CHARTS_2D)) {
        if (CHARTS_3D[type]) continue;
        const flat = read(lines, false);
        const data = { ...flat.data, dimension: true };
        const settings = SettingsManager.fromJSON(data);
        const math = settings.createMathContext();
        const config = settings.toRendererConfig(math);
        const scene = computeScene3D({ tools: config.tools, math, view: { xmin: -5, xmax: 5, ymin: -5, ymax: 5, zmin: -5, zmax: 5 } });
        const tool = toolOf(flat.tools, type);
        if (toolInChart(tool, true)) continue;
        const said = scene.issues.some((i) => i.source === tool.name && /2D/.test(i.message));
        assert.ok(said || KEPT_FOR_2D.has(type) || (type === 'points' || type === 'segment'), `${type} in a 3D chart: no card and no "2D only" problem`);
    }
});

test('3D: the Lorenz butterfly and every 3D chart of the guides and examples list a card for each tool', () => {
    const charts: Array<[string, Record<string, unknown>]> = [];
    for (const g of GUIDES) {
        charts.push([g.id, g.chart]);
        g.steps.forEach((s, i) => s.chart && charts.push([`${g.id} step ${i + 1}`, s.chart]));
    }
    for (const e of V6_EXAMPLES) charts.push([e.id, e.data]);
    let seen = 0;
    for (const [id, chart] of charts) {
        if (chart.dimension !== true) continue;
        for (const tool of (chart.tools as Tool[]) ?? []) {
            assert.ok(toolInChart(tool, true), `${tool.type} (${tool.name}) of ${id}`);
            seen++;
        }
    }
    assert.ok(seen > 5, `${seen} tools in 3D charts`);
    const lorenz = GUIDES.find((g) => g.id === 'lorenz-butterfly');
    assert.ok(lorenz);
    const paths = ((lorenz.chart.tools as Tool[]) ?? []).filter((t) => t.type === 'trajectory' && toolInChart(t, true));
    assert.equal(paths.length, 2, 'both Lorenz paths have a card');
});

test('a card exists for every tool type, and the Build tab loads the file that registers it', () => {
    const root = process.cwd();
    const files: string[] = [];
    const walk = (dir: string) => {
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
            const p = path.join(dir, entry.name);
            if (entry.isDirectory()) walk(p);
            else if (entry.name.endsWith('.ts')) files.push(p);
        }
    };
    walk(path.join(root, 'src'));
    const layer = fs.readFileSync(path.join(root, 'src/ui/layerCards.ts'), 'utf8');
    const switchBody = layer.slice(layer.indexOf('export function createLayerCard'), layer.indexOf('export type ToolCardFactory'));
    const builtIn = new Set(Array.from(switchBody.matchAll(/case '([A-Za-z0-9]+)':/g), (m) => m[1]));
    const panel = fs.readFileSync(path.join(root, 'src/ui/buildPanel.ts'), 'utf8');
    // The Build tab filters its tools with toolInChart, the function the tests above check.
    assert.match(panel, /function inDimension\(tool: Tool, is3D: boolean\): boolean \{\s*return toolInChart\(tool, is3D\);/);
    const registered = new Map<string, string>();
    for (const file of files) {
        const src = fs.readFileSync(file, 'utf8');
        for (const m of src.matchAll(/registerToolCard\('([A-Za-z0-9]+)'/g)) registered.set(m[1], file);
    }
    for (const type of TYPES) {
        if (builtIn.has(type)) continue;
        const file = registered.get(type);
        assert.ok(file, `a card for ${type}`);
        const rel = path.relative(path.join(root, 'src'), file).replace(/\.ts$/, '');
        assert.ok(panel.includes(`import '../${rel}'`), `src/ui/buildPanel.ts imports ${rel}`);
    }
});
