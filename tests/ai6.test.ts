/*
 * 6.0 AI: the AI tools know version 6. check_chart reports what the new
 * objects compute (values, sets, rest points, solutions, orbits,
 * eigenvalues, GeoGebra objects, scripts, steps, the clock, pictures) and
 * accepts every field the editor writes; get_guide returns the new
 * sections; export_latex says where a picture goes; the examples and the
 * texts for AI apps name version 6.
 */
import { test, assert } from './_lib';
import { check, examples, canonical, LIMITS } from '../src/ai/charttool';
import { ChartHost, INSTRUCTIONS, NoteInfo, callTool, toolList } from '../src/ai/mcp';
import { agentsSection } from '../src/ai/connect';
import { parseChartText } from '../src/text/parse';
import { printChartText } from '../src/text/print';
import { wordsToFull } from '../src/text/full';
import { readBlock } from '../src/blockjson';
import { V6_EXAMPLES, GUIDES } from '../src/guides';

/** The chart of a block text; throws with the first problem. */
function chart(text: string): Record<string, unknown> {
    const parsed = parseChartText(text);
    if (parsed.problems.length) throw new Error(`line ${parsed.problems[0].line}: ${parsed.problems[0].message}`);
    return parsed.data;
}

/** The report of a chart: no problems, and its lines as one text. */
function report(text: string): string {
    const r = check(chart(text));
    assert.deepEqual(r.errors, [], text);
    return r.lines.join('\n');
}

class Host implements ChartHost {
    version = '6.0.0';
    activeNote(): NoteInfo | null {
        return null;
    }
    resolveNote(note: string) {
        return { path: `${note}.md`, exists: false };
    }
    async read(): Promise<string> {
        return '';
    }
    async write() {}
    notify() {}
}
const textOf = (r: { content: Array<{ type: string; text?: string }> }) => r.content.map((c) => c.text || '').join('\n');

test('ai6: a let matrix reports its determinant, eigenvalues and eigenvectors; the transform and the eigenvectors theirs', () => {
    const all = report(['show x from -4.5 to 4.5 and y from -3 to 3', 'let A = [[2, 1], [1, 2]]', 'draw the grid', 'draw the basis vectors', 'shade the unit square, labelled', 'then transform the plane by A', 'then draw the eigenvectors of A, labelled'].join('\n'));
    assert.match(all, /^A: let A = \[\[2, 1\], \[1, 2\]\] = \[\[2, 1\], \[1, 2\]\] \(det 3, trace 4, eigenvalues 3, 1/m);
    assert.match(all, /^T1 transform by A = .*det 3.*while step 2 comes in/m);
    assert.match(all, /^EV1 eigenvectors of A: lambda1 = 3 along \(0\.707, 0\.707\), lambda2 = 1 along \(0\.707, -0\.707\)/m);
    assert.match(all, /^BV1 basis vectors: tips at \(2, 1\), \(1, 2\)/m);
    assert.match(all, /^U1 unit square: corners \(0, 0\) \(2, 1\) \(3, 3\) \(1, 2\) \| label "\$\\det A = 3\$"/m);
    assert.match(all, /^Steps: 3 \(step 1: A, G1, BV1, U1; step 2: T1; step 3: EV1\)/m);
});

test('ai6: a set on the x-axis as intervals, a chord with its gap, a point list and arrows', () => {
    const all = report(
        [
            'show x from -5 to 5 and y from -5 to 5',
            'slider lambda from 0 to 1, starting at 0.5',
            'plot g(x) = x^2 - 4',
            'mark where $g(x) \\le 0$ on the x-axis, labelled',
            'mark where $g(x) > 0$ on the x-axis',
            'draw the chord of g from -1 to 3 at $\\lambda$',
            'let v = (2, 1)',
            'draw v as an arrow from (1, 1)',
            'mark the points [(1, 1), (2, 2)], joined',
        ].join('\n')
    );
    assert.match(all, /^AX1 set on the x-axis where g\(x\) \\le 0: \[-2, 2\]/m);
    assert.match(all, /^AX2 set on the x-axis where g\(x\) > 0: \(-inf, -2\) u \(2, inf\)/m);
    assert.match(all, /^CH1 chord of g from -1 to 3: at \\lambda: x = 1, chord 1, gap \(chord minus graph\) 4/m);
    assert.match(all, /^V1 arrows from \(1, 1\): v = \(2, 1\)/m);
    assert.match(all, /^LP1 points of \[\(1, 1\), \(2, 2\)\]: 2 points \(1, 1\) \(2, 2\), joined/m);
});

test('ai6: rest points with their kinds, where a solution ends, and what moves on the clock', () => {
    const all = report(['show x from -4 to 4 and y from -3 to 3', 'draw the vector field $F(x, y) = (y, -\\sin x - 0.25y)$, with moving particles, speed 2, 300 particles', 'mark the rest points of F', 'mark P at (1, 0)', 'draw the solution of $\\dot{p} = (y, -x)$ through P for t from 0 to 3.14159, traced'].join('\n'));
    assert.match(all, /^RP1 rest points of F: \(-3\.142, 0\) saddle, \(0, 0\) stable spiral, \(3\.142, 0\) saddle/m);
    assert.match(all, /^TR1 solution of .*from \(1, 0\) at t = 0 to \(-1, 0\) at t = 3\.142/m);
    assert.match(all, /^Moves on the clock: F \(moving particles\), TR1 \(traced, draws itself\)\..*still frame at t = 0 s/m);
});

test('ai6: orbits, cobwebs, Newton and coloured planes report what they reach; pictures are named', () => {
    const all = report(
        [
            'show x from -2.4 to 1 and y from -1.2 to 1.2',
            'colour the plane by $z_{n+1} = z_n^2 + c$, $z_0 = 0$, $c = x + iy$, 200 steps',
            'mark P at (-1, 0)',
            'draw the orbit of $z_{n+1} = z_n^2 + c$, $z_0 = 0$, $c = P$, 10 steps',
            'plot f(x) = x^2 - 0.5',
            "draw Newton's method for f from 0.9, 5 steps",
        ].join('\n')
    );
    assert.match(all, /^CP1 coloured plane: escape time of z_\{n\+1\} = z_n\^2 \+ c, start 0, c = x \+ i ?y, 200 steps, colours cyclic, a picture/m);
    assert.match(all, /^OR1 orbit of z_\{n\+1\} = z_n\^2 \+ c: 11 points from \(0, 0\), last \(0, 0\)/m);
    assert.match(all, /^NM1 Newton's method for f from 0\.9: x_k 0\.9, .*last x 0\.707/m);
    assert.match(all, /^Pictures: CP1 is a pixel layer\..*PNG/m);
});

test('ai6: GeoGebra lines report their objects in numbers', () => {
    const all = report(['show x from -1 to 6 and y from -1 to 6', 'A = (1, 1)', 'B = (4, 1)', 'C = (1, 5)', 'c = Circle(A, 2)', 's = Segment(B, C)', 'p = Polygon(A, B, C)', 'L = {1, 2, 3}', 'T = Text("n = " + Length(L), (0, 5))'].join('\n'));
    assert.match(all, /^A GeoGebra A = \(1, 1\): \(1, 1\)/m);
    assert.match(all, /^c GeoGebra c = Circle\(A, 2\): circle, centre \(1, 1\), radius 2/m);
    assert.match(all, /^s GeoGebra s = Segment\(B, C\): segment \(4, 1\) to \(1, 5\), length 5/m);
    assert.match(all, /^p GeoGebra p = Polygon\(A, B, C\): polygon of 3 points/m);
    assert.match(all, /^L GeoGebra L = \{1, 2, 3\}: a list of 3 numbers: 1, 2, 3/m);
    assert.match(all, /^T GeoGebra .*text "n = 3/m);
});

test('ai6: a script reports what it gives the chart, reads and draws; its problems name the line', () => {
    const all = report(
        [
            'show x from -3 to 3 and y from -2 to 2',
            'slider a from 0.5 to 3, starting at 1',
            'python:',
            '    import numpy as np',
            '    import matplotlib.pyplot as plt',
            '    x = np.linspace(-3, 3, 50)',
            '    k = 2 * a',
            '    plt.plot(x, np.sin(a * x))',
            '    plt.scatter([0, 1], [0, 0.5])',
        ].join('\n')
    );
    assert.match(all, /^PY1 python script \(6 lines\): ran in [\d.]+ ms; gives the chart k \(their values are in the Values line\); reads a; draws 1 line, 1 set of dots; where x -3\.\.3/m);
    assert.match(all, /^Values: .*k = 2/m);
    const broken = check(chart(['show x from -3 to 3 and y from -2 to 2', 'python:', '    import numpy as np', '    y = nq.sin(1)'].join('\n')));
    assert.ok(broken.errors.some((e) => /Line 2 of the script: name 'nq' is not defined/.test(e)), broken.errors.join('\n'));
    const moving = report(['show x from 0 to 7 and y from -1.5 to 1.5', 'python:', '    import numpy as np', '    import matplotlib.pyplot as plt', '    def frame(t):', '        plt.plot([0, 1], [0, np.sin(t)])'].join('\n'));
    assert.match(moving, /frame\(t\) moves on the clock/);
    assert.match(moving, /^Moves on the clock: PY1 \(frame\(t\) of the script\)/m);
});

test('ai6: a 3D chart reports each tool: the Lorenz solution turning, a grid cube, eigenvectors of a 3 x 3 matrix', () => {
    const lorenz = report(['3d', 'turning, speed 2', 'show x from -20 to 20, y from -30 to 30 and z from 0 to 50', 'draw the solution of $\\dot{p} = (10(y - x), x(28 - z) - y, xy - \\frac{8}{3}z)$ through (1, 1, 1) for t from 0 to 10, coloured by time, traced'].join('\n'));
    assert.match(lorenz, /^TR1 solution: \d+ segments where x .*; from \(1, 1, 1\) at t = 0 to \(.*\) at t = 10/m);
    assert.match(lorenz, /^Turns by itself in notes \(turning, 2 x the usual speed\)/m);
    const space = report(['3d', 'show x from -2 to 2, y from -2 to 2 and z from -2 to 2', 'let B = [[2, 0, 0], [0, 1, 0], [0, 0, 3]]', 'draw the grid', 'draw the eigenvectors of B', 'then transform space by B'].join('\n'));
    assert.match(space, /^G1 grid cube: \d+ segments/m);
    assert.match(space, /^EV1 eigenvectors: .*lambda1 = 3 along \(0, 0, 1\)/m);
    assert.match(space, /^B: let B = .* = \[\[2, 0, 0\], \[0, 1, 0\], \[0, 0, 3\]\] \(det 6, trace 6/m);
});

test('ai6: check_chart takes every field the editor writes for moving things', () => {
    const r = check(chart(['3d', 'turning, speed 2', 'show x from -2 to 2, y from -2 to 2 and z from -2 to 2', 'draw the solution of $\\dot{p} = (y, -x, 0)$ through (1, 0, 0), traced, speed 2'].join('\n')));
    assert.deepEqual(r.errors, []);
    const flow = check(chart(['show x from -3 to 3 and y from -3 to 3', 'draw the vector field $F(x, y) = (y, -x)$, with moving particles, speed 2, 300 particles, trails 0.9, width 1.4, arrows 0.025', 'mark P at (1, 1)', 'draw the orbit of $z_{n+1} = 0.9 z_n$, $z_0 = P$, 20 steps, traced, speed 3', 'draw the circles of $\\sum_{k=1}^{3} \\frac{1}{k} e^{ikt}$, speed 2'].join('\n')));
    assert.deepEqual(flow.errors, []);
});

test('ai6: a JSON block without "v" that holds GeoGebra or Python lines is a version 4 chart', () => {
    const block = readBlock('{"tools": [{"type": "geogebra", "name": "A", "command": "(1, 2)"}, {"type": "python", "name": "PY1", "code": "k = 2"}]}');
    assert.ok(typeof block !== 'string' && block.data.v === 4);
});

test('ai6: a long script is checked (the limits of AI charts give scripts room); a far too long one is refused', () => {
    const lines = Array.from({ length: 150 }, (_, i) => `    v${i} = ${i} * 2 + 1  # a line of the script`);
    const long = check(chart(['show x from 0 to 1 and y from 0 to 1', 'python:', ...lines].join('\n')));
    assert.deepEqual(long.errors, []);
    const huge = check({ v: 4, tools: [{ type: 'python', name: 'PY1', code: 'x = 1\n'.repeat(LIMITS.script / 5) }] });
    assert.ok(huge.errors.some((e) => /too large to check/.test(e)));
});

test('ai6: a label placeholder named like a function calls it: the unit square labelled "det A = {det(A)}"', () => {
    const all = report(['show x from -3 to 3 and y from -3 to 3', 'let A = [[2, 1], [1, 2]]', 'shade the unit square, labelled "det A = {det(A)}, area {area}"', 'transform the plane by A'].join('\n'));
    assert.match(all, /label "det A = 3, area 3"/);
});

test('ai6: Full LaTeX writes the speed of an orbit as an option, not as a raw line', () => {
    const words = 'show x from -2 to 2 and y from -2 to 2\ndraw the orbit of $z_{n+1} = z_n^2 + c$, $z_0 = 0$, $c = 0.3$, 40 steps, traced, speed 2';
    const full = wordsToFull(words);
    assert.match(full, /\\orbit\[z_0=0, c=0\.3, steps=40, traced, speed=2\]\{z_\{n\+1\} = z_n\^2 \+ c\}/);
    assert.equal(canonical(chart(full)), canonical(chart(words)));
});

test('ai6: get_guide returns the sections of version 6, and a main section with its subsections', async () => {
    const host = new Host();
    const python = textOf(await callTool('get_guide', { section: 'Python' }, host));
    assert.match(python, /^### Python scripts/m);
    assert.match(python, /import matplotlib\.pyplot as plt/);
    assert.ok(!/^### Limits/m.test(python), 'one subsection only');
    for (const [section, want] of [
        ['GeoGebra', /Positions count from 1/],
        ['Linear algebra', /transform the plane by A/],
        ['Steps and moving', /then/],
        ['Vector fields', /mark the rest points of F/],
        ['Iterate', /colour the plane by/],
        ['Sets on an axis', /on the x-axis/],
        ['Values: let', /tip to tail/],
        ['Limits', /Steps of an orbit/],
    ] as Array<[string, RegExp]>) {
        assert.match(textOf(await callTool('get_guide', { section }, host)), want, section);
    }
    const syntax = textOf(await callTool('get_guide', { section: 'The text syntax' }, host));
    assert.match(syntax, /^## The text syntax/m);
    assert.match(syntax, /^### Python scripts/m);
    assert.ok(!/^## Full LaTeX/m.test(syntax), 'only the section and its subsections');
    const recipes = textOf(await callTool('get_guide', { section: 'Recipes' }, host));
    for (const want of [/### A fractal with an orbit/, /### A matrix that plays/, /### The Lorenz attractor, turning and traced/, /### A pendulum as a flow/, /### A GeoGebra paste/]) assert.match(recipes, want);
});

test('ai6: export_latex says which picture a coloured plane needs and where it goes', async () => {
    const r = await callTool('export_latex', { chart: 'show x from -2 to 1 and y from -1 to 1\ncolour the plane by $z_{n+1} = z_n^2 + c$, $z_0 = 0$, $c = x + iy$, 50 steps' }, new Host());
    const out = textOf(r);
    assert.match(out, /\\addplot\[[^\]]*\] graphics/);
    assert.match(out, /The code draws plane-[0-9a-z]+\.png with \\addplot graphics: put that PNG file beside the \.tex file/);
    assert.ok(!/beside the \.tex file\. This tool/.test(textOf(await callTool('export_latex', { chart: 'show x from 0 to 1 and y from 0 to 1\nplot f(x) = x' }, new Host()))));
});

test('ai6: the instructions, the tool descriptions and the AGENTS.md section name version 6', () => {
    assert.match(INSTRUCTIONS, /Version 6 adds:.*GeoGebra.*Python/);
    const desc = (name: string) => toolList().find((t) => t.name === name)?.description ?? '';
    assert.match(desc('check_chart'), /eigenvalues.*rest points.*Python script/);
    assert.match(desc('render_chart'), /still frame/);
    assert.match(desc('export_latex'), /PNG/);
    assert.match(desc('get_guide'), /Python/);
    assert.match(agentsSection('.obsidian', 27150, '6.0.0'), /Since version 6 .*GeoGebra input lines and a `python:` block/);
});

test('ai6: list_examples and get_example hand out every 6.0 example and every guide and Showcase page', async () => {
    const host = new Host();
    const listed = textOf(await callTool('list_examples', {}, host));
    for (const id of [...V6_EXAMPLES.map((e) => e.id), ...GUIDES.map((g) => g.id)]) assert.match(listed, new RegExp(`^${id}: `, 'm'), id);
    for (const id of ['python-heart', 'lorenz-butterfly', 'pendulum-field', 'geogebra-mandelbrot', 'matrix-grid', 'mandelbrot-orbit']) {
        const got = textOf(await callTool('get_example', { id }, host));
        const body = /```easy-tikz\n([\s\S]*?)\n```/.exec(got)?.[1] ?? '';
        const want = examples().find((e) => e.id === id);
        assert.ok(want && canonical(chart(body)) === canonical(JSON.parse(JSON.stringify(want.data))), id);
        assert.deepEqual(check(chart(body)).errors, [], id);
    }
    // Every example prints as text that reads back as the same chart, without problems.
    for (const e of examples()) assert.equal(canonical(chart(printChartText(JSON.parse(JSON.stringify(e.data))))), canonical(JSON.parse(JSON.stringify(e.data))), e.id);
});
