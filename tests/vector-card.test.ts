// 6.2.1: the vector card (src/linear/vector.ts), which formula recognition
// opens for the label vector of round 3: one arrow, a sum tip to tail, a
// multiple, both arrows of a product, a list, in 2D and 3D, with the note's
// vectors. Each card is drawn as the hover card draws it: its lines parse,
// and its scene has no problem.
import { test, assert } from './_lib';
import { parseChartText } from '../src/text/parse';
import { printChartText } from '../src/text/print';
import { SettingsManager } from '../src/settings';
import { computeScene2D, computeScene3D, labelMetricsFor, Scene2D, Scene3D } from '../src/scene';
import { vectorHoverCard, vectorValues } from '../src/linear/vector';
import { groupOf } from '../src/notes6/recognize/adapt';
import { smartMark, smartVector } from '../src/notes6/recognize/decide';
import { recognize } from '../src/notes6/recognize';

/** The scene of a card's lines, 2D or 3D as the chart says. */
function sceneOf(lines: string[]): Scene2D | Scene3D {
    const parsed = parseChartText(lines.join('\n'));
    assert.deepEqual(parsed.problems, [], lines.join(' / '));
    const settings = SettingsManager.fromJSON(parsed.data);
    const math = settings.createMathContext({ memo: false });
    const config = settings.toRendererConfig(math);
    if (parsed.data.dimension === true) return computeScene3D({ tools: config.tools, math, view: { xmin: config.xmin, xmax: config.xmax, ymin: config.ymin, ymax: config.ymax, zmin: -5, zmax: 5 } });
    return computeScene2D({
        functions: config.functions,
        tools: config.tools,
        math,
        view: { xmin: config.xmin, xmax: config.xmax, ymin: config.ymin, ymax: config.ymax },
        grid: { nx: 60, ny: 60 },
        axisStyle: config.axisStyle,
        polar: false,
        labelMetrics: labelMetricsFor(8, 5.5),
    });
}

/** The arrows of a 2D scene: from and to of every stroke with an arrowhead. */
function arrows2D(scene: Scene2D): number[][][] {
    return scene.items.flatMap((it) => (it.strokes ?? []).filter((s) => s.arrow === 'forward').map((s) => s.lines[0].map((p) => [p.x, p.y])));
}

function card(tex: string, notes: string[] = []) {
    const c = vectorHoverCard(tex, vectorValues(notes));
    assert.ok(c, `no vector card for ${tex}`);
    const scene = sceneOf(c.lines);
    assert.deepEqual(scene.issues, [], `${tex}: ${c.lines.join(' / ')}`);
    return { card: c, scene };
}

test('vector card: a written vector is one arrow from the origin, with let lines and its own name as the label', () => {
    const { card: c, scene } = card('\\vec v = \\begin{pmatrix} 2 \\\\ 1 \\end{pmatrix}');
    assert.equal(c.shape, 'one');
    assert.equal(c.dim, 2);
    assert.deepEqual(c.lines.slice(2), ['let v = (2, 1)', 'draw v as an arrow in blue, labelled "$\\vec{v}$"']);
    assert.ok(/^show x from -?\d+ to \d+ and y from -?\d+ to \d+$/.test(c.lines[0]) && c.lines[1] === 'equal scale', c.lines.join(' / '));
    assert.deepEqual(arrows2D(scene as Scene2D), [
        [
            [0, 0],
            [2, 1],
        ],
    ]);
    // Insert chart writes the let line and the arrow line back as they are.
    const printed = printChartText(parseChartText(c.lines.join('\n')).data);
    assert.ok(/^let v = \(2, 1\)$/m.test(printed) && /^draw v as an arrow, labelled "\$\\vec\{v\}\$"$/m.test(printed), printed);
});

test('vector card: every spelling of round 3 reads (transposed, bars, \\binom, angle brackets, bold, units, arrays in brackets)', () => {
    const cases: Array<[string, number[]]> = [
        ['\\mathbf{u} = (3, -1, 2)^\\top', [3, -1, 2]],
        ['[2, 1]^T', [2, 1]],
        ['\\vec u = (2|1)', [2, 1]],
        ['\\binom{2}{1}', [2, 1]],
        ['\\langle 2, 1 \\rangle', [2, 1]],
        ['\\left(\\begin{array}{c} 1 \\\\ 4 \\end{array}\\right)', [1, 4]],
        ['\\vec F_1 = (3, 4)\\ \\mathrm{N}', [3, 4]],
        ['\\vec F_G = \\begin{pmatrix} 0 \\\\ -19{,}62 \\end{pmatrix}\\mathrm{N}', [0, -19.62]],
        ['\\hat e = (0{,}894;\\ 0{,}447)', [0.894, 0.447]],
        ['\\overrightarrow{AB} = B - A = (3, 4)', [3, 4]],
        ['(\\tfrac{1}{\\sqrt2}, \\tfrac{1}{\\sqrt2})', [Math.SQRT1_2, Math.SQRT1_2]],
    ];
    for (const [tex, want] of cases) {
        const { card: c } = card(tex);
        assert.equal(c.shape, 'one', tex);
        assert.equal(c.dim, want.length, tex);
        const lets = c.lines.filter((l) => l.startsWith('let '));
        assert.equal(lets.length, 1, `${tex}: ${c.lines.join(' / ')}`);
    }
    // A label as the formula writes the name.
    assert.ok(card('\\overrightarrow{AB} = (3, 4)').card.lines.includes('draw AB as an arrow in blue, labelled "$\\overrightarrow{AB}$"'));
    assert.ok(card('\\vec F_{\\mathrm{ges}} = (2, 6)').card.lines.some((l) => /^let F_ges = \(2, 6\)$/.test(l)));
});

test('vector card: three entries draw in 3D, in a box of one length on every axis', () => {
    const { card: c, scene } = card('\\vec a = \\begin{pmatrix} 1 \\\\ 2 \\\\ 3 \\end{pmatrix}');
    assert.equal(c.dim, 3);
    assert.equal(c.lines[0], '3d');
    assert.equal(c.lines[1], 'show x from -4 to 4 and y from -4 to 4 and z from -4 to 4');
    const segs = (scene as Scene3D).segments;
    assert.equal(segs.length, 1);
    assert.deepEqual([segs[0].a, segs[0].b], [
        [0, 0, 0],
        [1, 2, 3],
    ]);
});

test('vector card: a sum or difference draws the terms tip to tail and the sum, with the note\'s vectors', () => {
    const note = ['\\vec a = (1, 2)', '\\vec b = (3, -1)'];
    const { card: c, scene } = card('\\vec a + \\vec b = (4, 1)', note);
    assert.equal(c.shape, 'sum');
    assert.deepEqual(c.lines.slice(2), ['let a = (1, 2)', 'let b = (3, -1)', 'draw a + b tip to tail in red, labelled']);
    assert.deepEqual(c.fromNote, ['\\vec a = (1, 2)', '\\vec b = (3, -1)']);
    const lines = arrows2D(scene as Scene2D);
    assert.deepEqual(lines, [
        [
            [0, 0],
            [1, 2],
        ],
        [
            [1, 2],
            [4, 1],
        ],
        [
            [0, 0],
            [4, 1],
        ],
    ]);
    // 2a - b, and written vectors (they get names of their own); the basis vectors e_1, e_2 and i, j.
    assert.ok(card('2\\vec a - \\vec b = \\begin{pmatrix} -1 \\\\ 5 \\end{pmatrix}', note).card.lines.includes('draw 2 a - b tip to tail in red, labelled'));
    assert.ok(card('(2, 1) + (1, 3) = (3, 4)').card.lines.includes('draw u + v tip to tail in red, labelled'));
    assert.ok(card('\\vec a = 3\\vec e_1 - 2\\vec e_2 = (3, -2)').card.lines.includes('draw 3 e_1 - 2 e_2 tip to tail in red, labelled'));
    assert.ok(card('v = 2i + 3j').card.lines.includes('draw 2 e_x + 3 e_y tip to tail in red, labelled'));
    assert.ok(card('\\vec F_1 = 3\\,\\mathrm{N}\\,\\vec e_x + 4\\,\\mathrm{N}\\,\\vec e_y').card.lines.includes('draw 3 e_x + 4 e_y tip to tail in red, labelled'));
});

test('vector card: a name the note gives another value does not draw a wrong sum (the written result wins)', () => {
    // a and b are vectors in space in the note; the formula's own result is in the plane.
    const { card: c } = card('\\vec a + \\vec b = (4, 1)', ['\\vec a = (1, 2, 3)', '\\vec b = (4, -5, 6)']);
    assert.equal(c.shape, 'one');
    assert.deepEqual(c.lines.slice(2), ['let u = (4, 1)', 'draw u as an arrow in blue, labelled "$\\vec{a} + \\vec{b}$"']);
    assert.deepEqual(c.fromNote, []);
});

test('vector card: a dot product of written vectors draws both arrows, a cross product both and their product', () => {
    const dot = card('(2, 1) \\cdot (1, 3) = 5').card;
    assert.equal(dot.shape, 'dot');
    assert.deepEqual(dot.lines.slice(2), ['let u = (2, 1)', 'let v = (1, 3)', 'draw u as an arrow in blue, labelled "$(2, 1)$"', 'draw v as an arrow in green, labelled "$(1, 3)$"']);
    assert.equal(card('\\begin{pmatrix} 1 \\\\ 2 \\\\ 3 \\end{pmatrix} \\circ \\begin{pmatrix} 3 \\\\ 0 \\\\ -1 \\end{pmatrix} = 0').card.shape, 'dot');
    assert.equal(card('\\langle(1,-1),(1,1)\\rangle=1-1=0').card.shape, 'dot');
    const { card: cross, scene } = card('\\vec a \\times \\vec b = \\begin{pmatrix} -2 \\\\ 10 \\\\ -6 \\end{pmatrix}', ['\\vec a = (1, 2, 3)', '\\vec b = \\begin{pmatrix} 3 \\\\ 0 \\\\ -1 \\end{pmatrix}']);
    assert.equal(cross.shape, 'cross');
    // In space the labels are the letters (a 3D label shows an arrow over a letter badly).
    assert.ok(cross.lines.includes('draw a as an arrow in blue, labelled "$a$"') && cross.lines.includes('draw $a \\times b$ as an arrow in red, labelled "$a \\times b$"'), cross.lines.join(' / '));
    assert.equal((scene as Scene3D).segments.length, 3);
});

test('vector card: a multiple draws the vector and its multiple; a list draws every arrow; a letter in an entry is a slider', () => {
    const m = card('3 \\cdot (2, 1) = (6, 3)').card;
    assert.equal(m.shape, 'multiple');
    assert.deepEqual(m.lines.slice(2), ['let u = (2, 1)', 'let v = 3 u', 'draw u as an arrow in blue, labelled "$(2, 1)$"', 'draw v as an arrow in red, labelled "$3 (2, 1)$"']);
    assert.equal(card('\\vec a_0 = \\dfrac{1}{|\\vec a|} \\vec a', ['\\vec a = (1, 2, 2)']).card.shape, 'multiple');
    const list = card('(1, 0), (0, 1)').card;
    assert.equal(list.shape, 'list');
    assert.equal(list.lines.filter((l) => l.startsWith('draw ')).length, 2);
    const g = card('\\vec a = (0, -g)').card;
    assert.ok(g.lines.includes('slider g from -5 to 5, starting at 1') && g.lines.includes('let a = (0, -g)'), g.lines.join(' / '));
});

test('vector card: no card for what draws no arrow (the zero vector, a generic vector, a name without a value, 4 entries)', () => {
    for (const tex of ['\\vec 0 = (0, 0)', '(x_1, \\dots, x_n)', '\\vec v + \\vec w', '(1, 2, 3, 4)', '\\vec v', 'x \\in \\mathbb{R}^n']) assert.equal(vectorHoverCard(tex, new Map()), null, tex);
});

test('vector card: the note\'s vectors in every spelling, also a vector the note defines by others', () => {
    const v = vectorValues(['\\vec{AB} = (-2|4|0)', '\\vec{AC} = (-2|0|4)', '\\vec n = \\vec{AB} \\times \\vec{AC}', 'P = (1, 2)', '\\mathbf{w} = (2, -1)^\\top', 'f(x) = x^2']);
    assert.deepEqual([...v.keys()], ['AB', 'AC', 'n', 'P', 'w']);
    assert.equal(v.get('n')?.value, 'AB \\times AC');
    assert.equal(v.get('AB')?.value, '(-2, 4, 0)');
    assert.equal(v.get('n')?.tex, '\\vec n');
});

test('Smart: vector is a card of its own (no Rules card), with its dotted mark from the note\'s vectors', () => {
    assert.equal(groupOf('vector'), 'vector');
    const tex = '\\vec v = \\begin{pmatrix} 2 \\\\ 1 \\end{pmatrix}';
    assert.equal(recognize(tex, { context: 'Der Vektor [F] zeigt nach rechts oben.' }), 'vector');
    assert.equal(smartVector(tex, new Map())?.shape, 'one');
    assert.equal(smartMark(tex, undefined, tex, 'vector'), true);
    // \vec a + \vec b has a card only when the note gives a and b.
    const sum = '\\vec a + \\vec b';
    assert.equal(smartMark(sum, undefined, sum, 'vector', undefined, () => new Map()), false);
    assert.equal(smartMark(sum, undefined, sum, 'vector', undefined, () => vectorValues(['\\vec a = (1, 2)', '\\vec b = (3, -1)'])), true);
});
