/*
 * 6.0 F1 (polish): let lines print right after the sliders; every line,
 * phrase and option of version 6 takes a person's own chart words and reads
 * the same in theirs and in the built-in ones. Ask the curve on orbits and
 * coloured planes; the legend entry of a function a transform moves; room
 * for the labels of a list of points.
 */
import { test, assert } from './_lib';
import { canonical } from '../src/chartdata';
import { parseChartText } from '../src/text/parse';
import { printChartText, writeChartText } from '../src/text/print';
import { rewordNote } from '../src/text/reword';
import { ChartWords, NO_WORDS, PIECES, clean, setChartWords, wordProblem, wordsFromText, wordsToText } from '../src/text/words';
import { insertTool, letLines } from '../src/values/order';
import { EN } from '../src/i18n/en';
import { JA } from '../src/i18n/ja';
import { SettingsManager } from '../src/settings';
import { computeScene2D, computeScene3D, labelMetricsFor } from '../src/scene';
import { stripMathDollars } from '../src/latex';
import { generateTikz2D } from '../src/export';
import { fitSettings } from '../src/fit';
import { AskTarget, answerPresent, applyAnswer, askContext, askQuestions, pickTarget, removeAnswer } from '../src/notes6/ask';
import '../src/iterate/askOrbit';
import { labelRoom } from '../src/values/scene';
import type { Parameter } from '../src/types';

type Data = Record<string, unknown>;

function withWords<T>(w: ChartWords, fn: () => T): T {
    setChartWords(w);
    try {
        return fn();
    } finally {
        setChartWords(NO_WORDS);
    }
}

function read(text: string): Data {
    const r = parseChartText(text);
    assert.deepEqual(r.problems, [], text);
    return r.data;
}

// ------------------------------------------------------------ print order

test('polish: let lines print right after the sliders, before the functions and tools that use them', () => {
    const text = ['show x from -3 to 3 and y from -3 to 3', 'slider a from 0 to 2', 'plot f(x) = a x', 'let v = (2, 1)', 'let A = [[0, -1], [1, 0]]', 'draw v as an arrow', 'draw A v as an arrow'].join('\n');
    const data = read(text);
    const printed = printChartText(data);
    assert.deepEqual(printed.split('\n'), ['show x from -3 to 3 and y from -3 to 3', 'slider a from 0 to 2', 'let v = (2, 1)', 'let A = [[0, -1], [1, 0]]', 'plot f(x) = a x', 'draw v as an arrow', 'draw A v as an arrow']);
    assert.equal(canonical(read(printed)), canonical(data));
    // Printed again: the same text (a stable round trip).
    assert.equal(printChartText(read(printed)), printed);
});

test('polish: a chart without let lines prints as before; a let line after another tool keeps its place', () => {
    const plain = ['show x from -3 to 3 and y from -3 to 3', 'slider a from 0 to 2', 'plot f(x) = a x', 'mark (1, 1)'].join('\n');
    assert.equal(printChartText(read(plain)), plain);
    // The tools keep the order of their lines, so a let below a tool stays below it (the text reads back the same).
    const late = ['plot f(x) = x', 'draw v as an arrow', 'let v = (2, 1)'].join('\n');
    assert.equal(printChartText(read(late)), late);
});

test('polish: with steps, a step keeps its let lines first and its meaning', () => {
    const text = ['slider a from 0 to 2', 'let v = (2, 1)', 'plot f(x) = a x', 'draw v as an arrow', 'then let w = (1, 1)', 'draw w as an arrow', 'then plot g(x) = -x'].join('\n');
    const data = read(text);
    assert.equal(printChartText(data), text);
    const steps = (data.tools as Data[]).map((t) => [t.name, t.step ?? 0]);
    assert.deepEqual(steps, [['v', 0], ['V1', 0], ['w', 1], ['V2', 1]]);
});

test('polish: letLines and insertTool', () => {
    const v = { type: 'value' };
    const c = { type: 'curve' };
    assert.deepEqual(letLines([v, v, c]), [true, true, false]);
    assert.equal(letLines([c, v]), null);
    assert.equal(letLines([c]), null);
    // A value of a later step may follow the tools of an earlier one.
    assert.deepEqual(letLines([v, c, v, c], [0, 0, 1, 1]), [true, false, true, false]);
    assert.equal(letLines([v, c, c, v], [0, 0, 1, 1]), null);
    const tools: Data[] = [{ type: 'value', name: 'v' }, { type: 'curve', name: 'C1' }];
    insertTool(tools, { type: 'value', name: 'A' });
    insertTool(tools, { type: 'planeGrid', name: 'G1' });
    assert.deepEqual(tools.map((t) => t.name), ['v', 'A', 'C1', 'G1']);
});

test('polish: a let definition added in the editor goes after the sliders in the block', () => {
    const text = ['% my chart', 'slider a from 0 to 2', 'plot f(x) = a x', 'draw the grid'].join('\n');
    const data = JSON.parse(JSON.stringify(read(text))) as Data;
    insertTool(data.tools as Data[], { type: 'value', name: 'A', params: '', expression: '[[1, 2], [3, 4]]', color: 'black' });
    const out = writeChartText(text, data);
    assert.deepEqual(out.split('\n'), ['% my chart', 'slider a from 0 to 2', 'let A = [[1, 2], [3, 4]]', 'plot f(x) = a x', 'draw the grid']);
    assert.equal(canonical(read(out)), canonical(data));
});

// ------------------------------------------------------------ chart words

/** German words for every piece of version 6 (made here; the plugin ships only English). */
const V6_WORDS: Record<string, string> = {
    let: 'sei',
    then: 'dann',
    frames: 'Einzelbilder',
    'transform-the-plane-by': 'bilde die Ebene ab mit',
    'transform-space-by': 'bilde den Raum ab mit',
    'colour-the-plane-by': 'färbe die Ebene nach',
    'as-an-arrow': 'als Pfeil',
    'as-arrows': 'als Pfeile',
    'the-points-of': 'die Punkte von',
    'the-points': 'die Punkte',
    'on-the-x-axis': 'auf der x-Achse',
    'on-the-y-axis': 'auf der y-Achse',
    'the-chord-of': 'die Sehne von',
    'the-vector-field': 'das Vektorfeld',
    'the-rest-points-of': 'die Ruhepunkte von',
    'the-solution-of': 'die Lösung von',
    through: 'durch',
    'the-grid': 'das Gitter',
    'the-basis-vectors': 'die Basisvektoren',
    'the-eigenvectors-of': 'die Eigenvektoren von',
    'the-image-of': 'das Bild von',
    'the-unit-square': 'das Einheitsquadrat',
    'the-unit-cube': 'den Einheitswürfel',
    'the-span-of': 'den Spann von',
    'the-orbit-of': 'den Orbit von',
    'the-cobweb-of': 'das Spinnennetz von',
    'the-bifurcation-diagram-of': 'das Bifurkationsdiagramm von',
    'newtons-method-for': 'das Newtonverfahren für',
    'the-circles-of': 'die Kreise von',
    steps: 'Schritte',
    'tip-to-tail': 'aneinander',
    joined: 'verbunden',
    'with-moving-particles': 'mit Teilchen',
    'with-streamlines': 'mit Stromlinien',
    'coloured-by-length': 'gefärbt nach Länge',
    'coloured-by-time': 'gefärbt nach Zeit',
    'as-a-path': 'als Pfad',
    'with-its-wave': 'mit Welle',
};

const GERMAN6: ChartWords = clean({
    words: {
        ...Object.fromEntries(Object.entries(V6_WORDS).map(([k, v]) => [k, [v]])),
        show: ['zeige'],
        slider: ['Regler'],
        plot: ['plotte'],
        shade: ['schattiere'],
        draw: ['zeichne'],
        mark: ['markiere'],
        from: ['von'],
        to: ['bis'],
        and: ['und'],
        where: ['wo'],
        at: ['bei'],
        labelled: ['beschriftet'],
        'starting-at': ['beginnend bei'],
        'in-steps-of': ['in Schritten von'],
        red: ['rot'],
    },
    bundles: [],
    write: 'yours',
});

/** Charts that use every line, phrase and option of version 6, in the built-in words. */
const V6_CHARTS: string[][] = [
    ['show x from -3 to 3 and y from -3 to 3', 'equal scale', 'let v = (2, 1)', 'let w = (-1, 1.5)', 'let A = [[0, -1], [1, 0]]', 'draw v and w as arrows, labelled', 'draw v + w tip to tail in red, labelled', 'draw A v as an arrow in green', 'draw v as an arrow from (1, 1)'],
    ['slider n from 3 to 12, starting at 6, in steps of 1', 'let S = [(1, 2), (2, 3)]', 'mark the points $\\{e^{2\\pi i k / n} : k = 0, \\dots, n - 1\\}$, joined, labelled', 'mark the points of S'],
    ['show x from -5 to 5', 'slider lambda from 0 to 1, starting at 0.5', 'plot $g(x) = x^2 - 4$ in blue, thick', 'mark where $g(x) \\le 0$ on the x-axis, labelled', 'mark where y > 1 on the y-axis', 'draw the chord of g from -1 to 3 at $\\lambda$, labelled'],
    ['frames', 'show x from -4 to 4 and y from -3 to 3', 'plot f(x) = sin(x) in blue', 'then draw the vector field $F(x, y) = (y, -\\sin x - 0.25y)$, coloured by length, with moving particles', 'mark the rest points of F, labelled', 'draw the vector field $G(x, y) = (x, y)$, with streamlines', 'P: mark (1, 0)', 'then draw the solution of $\\dot{p} = (y, -x)$ through P for t from 0 to 10, coloured by time'],
    ['3d', 'show x from -25 to 25, y from -30 to 30 and z from 0 to 50', 'draw the solution of $\\dot{p} = (10(y - x), x(28 - z) - y, x y - \\frac{8}{3}z)$ through (1, 1, 1) for t from 0 to 72, coloured by time'],
    ['show x from -4.5 to 4.5 and y from -3 to 3', 'equal scale', 'let $A = \\begin{pmatrix} 1.5 & 1 \\\\ 0.5 & 2 \\end{pmatrix}$', 'let v = (1, 2)', 'draw the grid', 'draw the basis vectors', 'shade the unit square, labelled', 'draw the span of v', 'then transform the plane by A', 'then draw the eigenvectors of A, labelled', 'shade the image of the unit square'],
    ['3d', 'let B = [[1, 0.5, 0], [0, 1, 0], [0, 0.5, 1.5]]', 'draw the grid', 'shade the unit cube', 'transform space by B'],
    ['slider r from 2.5 to 4, starting at 3.7', 'plot f(x) = r x (1 - x) in blue, thick', 'P: mark (-0.12, 0.75)', 'draw the orbit of $z_{n+1} = z_n^2 + c$, $z_0 = 0$, $c = P$, 40 steps, as a path', 'draw the cobweb of $x_{n+1} = f(x_n)$ from 0.2, 80 steps', "draw Newton's method for f from 2.5, 5 steps, labelled"],
    ['show x from 2.5 to 4 and y from 0 to 1', 'draw the bifurcation diagram of $x_{n+1} = r x_n (1 - x_n)$ for r from 2.5 to 4'],
    ['slider n from 1 to 20, starting at 5, in steps of 1', 'colour the plane by $z_{n+1} = z_n^2 + c$, $z_0 = 0$, $c = x + i y$, 200 steps', 'draw the circles of $\\sum_{k=1}^{n} \\frac{4}{\\pi (2k - 1)} e^{i(2k - 1)t}$, with its wave'],
];

const V6_PIECES = Object.keys(V6_WORDS);

test('polish: every line, phrase and option of version 6 is a piece with a description in English and Japanese', () => {
    const ids = new Set(PIECES.map((p) => p.id));
    for (const id of V6_PIECES) assert.ok(ids.has(id), id);
    const en = EN as Record<string, string>;
    const ja = JA as Record<string, string>;
    for (const p of PIECES.filter((x) => V6_PIECES.includes(x.id))) {
        assert.ok(en[p.what], `${p.id}: no English description`);
        assert.ok(ja[p.what] && ja[p.what] !== en[p.what], `${p.id}: no Japanese description`);
    }
});

test('polish: every version 6 chart printed in a person\'s own words uses them and reads back as the same chart', () => {
    withWords(GERMAN6, () => {
        const used = new Set<string>();
        for (const lines of V6_CHARTS) {
            const builtin = parseChartText(lines.join('\n'), { words: NO_WORDS });
            assert.deepEqual(builtin.problems, [], lines.join('\n'));
            const text = printChartText(builtin.data);
            const back = parseChartText(text);
            assert.deepEqual(back.problems, [], text);
            assert.equal(canonical(back.data), canonical(builtin.data), text);
            // The built-in words still read the same beside theirs.
            assert.equal(canonical(parseChartText(lines.join('\n')).data), canonical(builtin.data));
            for (const [id, word] of Object.entries(V6_WORDS)) if (new RegExp(`(^|[^\\p{L}])${word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}($|[^\\p{L}])`, 'u').test(text)) used.add(id);
        }
        // `with streamlines` after `with moving particles` prints as `and streamlines`: the chart with G has it alone.
        assert.deepEqual(V6_PIECES.filter((id) => !used.has(id)), []);
    });
});

test('polish: a block typed in a person\'s own words is the chart of the same block in the built-in words', () => {
    const de = ['Regler n von 3 bis 12, beginnend bei 6', 'sei v = (2, 1)', 'zeichne v als Pfeil', 'dann zeichne das Gitter', 'dann bilde die Ebene ab mit [[1, 1], [0, 1]]', 'markiere die Punkte $\\{e^{2\\pi i k / n} : k = 0, \\dots, n - 1\\}$, verbunden'].join('\n');
    const en = ['slider n from 3 to 12, starting at 6', 'let v = (2, 1)', 'draw v as an arrow', 'then draw the grid', 'then transform the plane by [[1, 1], [0, 1]]', 'mark the points $\\{e^{2\\pi i k / n} : k = 0, \\dots, n - 1\\}$, joined'].join('\n');
    withWords(GERMAN6, () => {
        const r = parseChartText(de);
        assert.deepEqual(r.problems, []);
        assert.equal(canonical(r.data), canonical(parseChartText(en, { words: NO_WORDS }).data));
        // A problem points at what was typed.
        const wrong = parseChartText('sei v = (2, 1)\nzeichne v als Pfeil, funkelnd');
        assert.equal(wrong.problems.length, 1);
        assert.equal(wrong.problems[0].column, 'zeichne v als Pfeil, '.length + 1);
    });
});

test('polish: an edited line in a later step keeps its step in the person\'s word for then', () => {
    withWords(GERMAN6, () => {
        const text = ['zeichne das Gitter', 'dann bilde die Ebene ab mit [[1, 1], [0, 1]]', 'dann zeichne die Basisvektoren'].join('\n');
        const data = JSON.parse(JSON.stringify(parseChartText(text).data)) as Data;
        const tools = data.tools as Data[];
        tools[2] = { ...tools[2], color: 'red' };
        const out = writeChartText(text, data).split('\n');
        assert.deepEqual(out, ['zeichne das Gitter', 'dann bilde die Ebene ab mit [[1, 1], [0, 1]]', 'dann zeichne die Basisvektoren in rot']);
        assert.equal(canonical(parseChartText(out.join('\n')).data), canonical(data));
    });
});

test('polish: version 6 words clash with the built-in ones, share as text, and a changed word rewrites the note', () => {
    assert.match(wordProblem('then', 'plot', GERMAN6), /built-in word for "then"/);
    assert.match(wordProblem('joined', 'plot', GERMAN6), /built-in word for "joined"/);
    assert.match(wordProblem("Newton's method for", 'plot', GERMAN6), /Newton's method for/);
    assert.equal(wordProblem("newton's method for", 'newtons-method-for', GERMAN6), '');
    assert.match(wordProblem('dann', 'plot', GERMAN6), /already your word for "then"/);
    const text = wordsToText(GERMAN6);
    assert.match(text, /^Newton's method for = das Newtonverfahren für$/m);
    assert.match(text, /^let = sei$/m);
    const back = wordsFromText(text);
    assert.deepEqual(back.problems, []);
    assert.deepEqual(back.words, GERMAN6);
    const after = clean({ ...GERMAN6, words: { ...GERMAN6.words, let: ['setze'] } });
    const note = ['```easy-tikz', 'sei v = (2, 1)', 'zeichne v als Pfeil', '```'].join('\n');
    const r = rewordNote(note, GERMAN6, after);
    assert.equal(r.changed, 1);
    assert.ok(r.text.split('\n').includes('setze v = (2, 1)'), r.text);
});

// ------------------------------------------------------------ Ask the curve

function askOf(text: string, target: AskTarget) {
    const parsed = parseChartText(text);
    assert.deepEqual(parsed.problems, [], text);
    const settings = SettingsManager.fromJSON(parsed.data);
    const data = settings.serialize();
    const math = settings.createMathContext({ memo: false });
    math.setParams((data.parameters as Parameter[]) ?? []);
    const view = settings.resolveView(math).view;
    return { data, ctx: askContext(target, data, view, math), settings, math, view };
}

function sceneOf(settings: SettingsManager, math: ReturnType<SettingsManager['createMathContext']>, view: { xmin: number; xmax: number; ymin: number; ymax: number }) {
    const config = settings.toRendererConfig(math);
    return computeScene2D({ functions: config.functions, tools: config.tools, math, view, grid: { nx: 60, ny: 60 }, axisStyle: 'box', polar: false, labelMetrics: labelMetricsFor(10, 10) });
}

const ORBIT = 'show x from -2 to 1 and y from -1.5 to 1.5\nmark P at (-0.12, 0.75)\ndraw the orbit of $z_{n+1} = z_n^2 + c$, $z_0 = 0$, $c = P$, 40 steps';
const MANDELBROT = 'show x from -2 to 1 and y from -1.5 to 1.5\ncolour the plane by $z_{n+1} = z_n^2 + c$, $z_0 = 0$, $c = x + iy$, 200 steps';

test('polish: a click on an orbit or on a coloured plane asks about it', () => {
    const o = askOf(ORBIT, { kind: 'orbit', name: 'OR1', x: 0, y: 0 });
    const scene = sceneOf(o.settings, o.math, o.view);
    const tools = o.data.tools as never;
    // z_1 = c = P: the point P is asked about first.
    const onDot = pickTarget({ items: scene.items, curves: [] }, tools, { x: -0.12, y: 0.75 }, 100, 100, 10);
    assert.equal(onDot?.kind, 'point');
    const z2 = { x: -0.12 * -0.12 - 0.75 * 0.75 - 0.12, y: 2 * -0.12 * 0.75 + 0.75 };
    const onOrbit = pickTarget({ items: scene.items, curves: [] }, tools, z2, 100, 100, 10);
    assert.deepEqual(onOrbit && [onOrbit.kind, onOrbit.name], ['orbit', 'OR1']);
    const m = askOf(MANDELBROT, { kind: 'plane', name: 'CP1', x: 0, y: 0 });
    const plane = sceneOf(m.settings, m.math, m.view);
    const hit = pickTarget({ items: plane.items, curves: [] }, m.data.tools as never, { x: -0.5, y: 0.4 }, 100, 100, 10);
    assert.deepEqual(hit && [hit.kind, hit.name, hit.x, hit.y], ['plane', 'CP1', -0.5, 0.4]);
});

test('polish: the questions of an orbit: more steps, fewer steps, its points labelled', () => {
    const { data, ctx } = askOf(ORBIT, { kind: 'orbit', name: 'OR1', x: 0, y: 0 });
    const qs = askQuestions(ctx);
    assert.deepEqual(
        qs.map((q) => [q.id, q.label]),
        [
            ['orbit-more', 'More steps (80)'],
            ['orbit-fewer', 'Fewer steps (20)'],
            ['orbit-labels', 'Label its points'],
        ]
    );
    for (const q of qs) {
        const next = applyAnswer(data, q.answer);
        assert.ok(next, q.id);
        assert.ok(answerPresent(next, q.answer), q.id);
        assert.equal(answerPresent(removeAnswer(next, q.answer), q.answer), false, q.id);
    }
    const more = applyAnswer(data, qs[0].answer);
    assert.ok(more);
    assert.match(printChartText(more), /draw the orbit of \$z_\{n\+1\} = z_n\^2 \+ c\$, \$z_0 = 0\$, \$c = P\$, 80 steps/);
    const labels = applyAnswer(data, qs[2].answer);
    assert.ok(labels);
    assert.match(printChartText(labels), /40 steps, labelled/);
    // Steps from a slider: only the labels.
    const slid = askOf('slider k from 1 to 50, starting at 10\nmark P at (0.3, 0.5)\ndraw the orbit of $z_{n+1} = z_n^2 + c$, $z_0 = 0$, $c = P$, k steps', { kind: 'orbit', name: 'OR1', x: 0, y: 0 });
    assert.deepEqual(
        askQuestions(slid.ctx).map((q) => q.id),
        ['orbit-labels']
    );
});

test('polish: on the Mandelbrot set, "The orbit of this point" adds P at the click and its orbit', () => {
    const { data, ctx } = askOf(MANDELBROT, { kind: 'plane', name: 'CP1', x: -0.5, y: 0.4 });
    const qs = askQuestions(ctx);
    assert.deepEqual(
        qs.map((q) => q.label),
        ['The orbit of this point']
    );
    assert.deepEqual(qs[0].answer.lines, ['mark P at (-0.5, 0.4)', 'draw the orbit of $z_{n+1} = z_n^2 + c$, $z_0 = 0$, $c = P$, 40 steps']);
    const next = applyAnswer(data, qs[0].answer);
    assert.ok(next);
    const tools = next.tools as Data[];
    assert.deepEqual(
        tools.map((x) => x.type),
        ['colourPlane', 'points', 'orbit']
    );
    assert.equal(tools[2].given, 'c = P');
    // Asked again, the next click adds another point and its orbit.
    const again = askContext({ kind: 'plane', name: 'CP1', x: 0.2, y: 0.1 }, next, ctx.view, ctx.math);
    assert.equal(askQuestions(again)[0].answer.lines?.[0], 'mark P2 at (0.2, 0.1)');
    // A Julia set: the start is the point of the plane.
    const julia = askOf('show x from -2 to 2 and y from -1.5 to 1.5\nslider a from -1 to 1, starting at -0.8\nslider b from -1 to 1, starting at 0.156\ncolour the plane by $z_{n+1} = z_n^2 + c$, $z_0 = x + iy$, $c = a + bi$, 300 steps', { kind: 'plane', name: 'CP1', x: 0.25, y: -0.5 });
    const jq = askQuestions(julia.ctx);
    assert.deepEqual(jq[0].answer.lines, ['mark P at (0.25, -0.5)', 'draw the orbit of $z_{n+1} = z_n^2 + c$, $z_0 = P$, $c = a + b i$, 40 steps']);
    assert.ok(applyAnswer(julia.data, jq[0].answer));
    // A P of the chart already: the new point gets another name. A heat map asks nothing.
    const taken = askOf(`mark P at (1, 1)\n${MANDELBROT}`, { kind: 'plane', name: 'CP1', x: -1, y: 0 });
    assert.equal(askQuestions(taken.ctx)[0].answer.lines?.[0], 'mark P2 at (-1, 0)');
    assert.deepEqual(askQuestions(askOf('colour the plane by $f(x, y) = \\sin x \\cos y$', { kind: 'plane', name: 'CP1', x: 0, y: 0 }).ctx), []);
});

// ------------------------------------------------------------ legend of a moved function

test('polish: a function a transform moves keeps its legend entry in the export', () => {
    const settings = SettingsManager.fromJSON(read('show x from -3 to 3 and y from -3 to 3\nplot f(x) = x^2/4 in blue, with a legend\nplot g(x) = 1 in red, with a legend\ntransform the plane by [[1, 1], [0, 1]]'));
    const math = settings.createMathContext();
    const tex = generateTikz2D(settings, math);
    const entries = tex.match(/\\addlegendentry\{/g) ?? [];
    assert.equal(entries.length, 2, tex);
    assert.match(tex, /\\addlegendimage\{[^}]*\}\s*\n\s*\\addlegendentry/, tex);
    // The transform draws the curves: no plot of the functions themselves.
    assert.doesNotMatch(tex, /samples=\d+\] \{/, tex);
});

// ------------------------------------------------------------ labels

test('polish: the fit leaves room for the labels of a list of points', () => {
    const fit = (text: string) => {
        const settings = SettingsManager.fromJSON(read(text));
        const math = settings.createMathContext();
        math.setParams((settings.serialize().parameters as Parameter[]) ?? []);
        const f = fitSettings(settings, math);
        assert.ok(f.x && f.y);
        return { x: f.x, y: f.y };
    };
    const roots = (n: number, opts: string) => `slider n from 3 to 12, starting at ${n}, in steps of 1\nmark the points $\\{e^{2\\pi i k / n} : k = 0, \\dots, n - 1\\}$${opts}`;
    const plain = fit(roots(6, ', joined'));
    const labelled = fit(roots(6, ', joined, labelled'));
    assert.ok(labelled.x.max > plain.x.max && labelled.x.min < plain.x.min, JSON.stringify([plain, labelled]));
    assert.ok(labelled.y.max > plain.y.max, JSON.stringify([plain, labelled]));
    // Long labels on the left of 7 points (-0.901 + 0.434i), a short one on the right (1).
    const seven = fit(roots(7, ', joined, labelled'));
    assert.ok(-seven.x.min > seven.x.max, JSON.stringify(seven));
    const room = labelRoom([
        { x: 1, y: 0 },
        { x: -1, y: 0 },
    ]);
    assert.ok(room[0].x > 1 && room[1].x < -1);
});

// ------------------------------------------------------------ small fixes

test('polish: a label placeholder may hold a vector, a matrix or a complex number', () => {
    const settings = SettingsManager.fromJSON(read('let v = (2, 1)\nlet A = [[1, 2], [3, 4]]\nlet c = -0.8 + 0.156i\nwrite "v = {v}, A^-1 = {A^(-1)}, c = {c}" at (1, 2)'));
    const math = settings.createMathContext();
    const label = 'v = {v}, A^-1 = {A^(-1)}, c = {c}';
    assert.deepEqual(math.validate(label, 'template'), { ok: true });
    assert.equal(math.formatTemplate(label), 'v = (2, 1), A^-1 = [[-2, 1], [1.5, -0.5]], c = -0.8 + 0.156i');
    // A name nobody defined is still a problem.
    const wrong = math.validate('{w}', 'template');
    assert.equal(wrong.ok, false);
});

test('polish: the LaTeX norm \\|v\\| and \\lVert v \\rVert read as the length of v', () => {
    const data = read('let v = (3, 4)\nlet $n = \\|v\\|$\nlet $m = \\lVert v \\rVert$\nplot $f(x) = \\|v\\| x$');
    const math = SettingsManager.fromJSON(data).createMathContext();
    assert.equal(math.value('n', NaN), 5);
    assert.equal(math.value('m', NaN), 5);
    assert.equal(math.functionInfo('f')?.fn(2), 10);
    // A plain bar is still an absolute value; the text reads back the same.
    assert.equal(stripMathDollars('let $k = |x - 1|$'), 'let k = \\vert x - 1\\vert ');
    assert.equal(canonical(read(printChartText(data))), canonical(data));
});

test('polish: in a 3D chart, the lines of part E are named as 2D only', () => {
    const settings = SettingsManager.fromJSON(read('3d\ncolour the plane by $z_{n+1} = z_n^2 + c$, $z_0 = 0$, $c = x + iy$, 200 steps\nP: mark (0.1, 0.2, 0)\ndraw the orbit of $z_{n+1} = z_n^2 + c$, $z_0 = 0$, $c = 0.3$, 10 steps'));
    const math = settings.createMathContext();
    const scene = computeScene3D({ tools: settings.toRendererConfig(math).tools, math, view: { xmin: -1, xmax: 1, ymin: -1, ymax: 1, zmin: -1, zmax: 1 } });
    assert.deepEqual(
        scene.issues.map((i) => i.message),
        ['CP1 is drawn in 2D charts only', 'OR1 is drawn in 2D charts only']
    );
});
