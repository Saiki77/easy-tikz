/*
 * Values (6.0 A), the chart language: let lines, vector arrows and points of
 * a list read, printed back the same, in Full LaTeX, and kept when a block
 * is rewritten.
 */
import { test, assert } from './_lib';
import { parseChartText } from '../src/text/parse';
import { printChartText, printFullText, writeChartText } from '../src/text/print';
import { canonical } from '../src/chartdata';

type Data = Record<string, unknown>;

function read(text: string): { data: Data; problems: string[] } {
    const out = parseChartText(text);
    return { data: out.data, problems: out.problems.map((p) => `${p.line}:${p.column} ${p.message}`) };
}

function tools(text: string): Data[] {
    const r = read(text);
    assert.deepEqual(r.problems, [], text);
    return (r.data.tools as Data[]) ?? [];
}

function roundTrip(text: string, expected = text) {
    const { data, problems } = read(text);
    assert.deepEqual(problems, [], text);
    const printed = printChartText(data);
    assert.equal(printed, expected);
    assert.equal(canonical(read(printed).data), canonical(data), 'words read back the same');
    const full = printFullText(data);
    assert.ok(!full.includes('\\raw'), full);
    assert.equal(canonical(read(full).data), canonical(data), `Full LaTeX reads back the same:\n${full}`);
    return full;
}

test('let lines: values and functions, plain and LaTeX', () => {
    const t = tools(
        [
            'let $v = (2, 1)$',
            'let $w = \\begin{pmatrix} -1 \\\\ 2 \\end{pmatrix}$',
            'let A = [[1.5, 1], [0.5, 2]]',
            'let $c = -0.8 + 0.156i$',
            'let $f(x, y) = x^2 + 4y^2$',
            'let $R(\\theta) = \\begin{pmatrix} \\cos\\theta & -\\sin\\theta \\\\ \\sin\\theta & \\cos\\theta \\end{pmatrix}$',
            'let $S = \\{(k, k^2) : k = 1, \\dots, 10\\}$',
        ].join('\n')
    );
    assert.deepEqual(
        t.map((x) => [x.type, x.name, x.params, x.expression]),
        [
            ['value', 'v', '', '(2, 1)'],
            ['value', 'w', '', '\\begin{pmatrix} -1 \\\\ 2 \\end{pmatrix}'],
            ['value', 'A', '', '[[1.5, 1], [0.5, 2]]'],
            ['value', 'c', '', '-0.8 + 0.156i'],
            ['value', 'f', 'x, y', 'x^2 + 4y^2'],
            ['value', 'R', 'theta', '\\begin{pmatrix} \\cos\\theta & -\\sin\\theta \\\\ \\sin\\theta & \\cos\\theta \\end{pmatrix}'],
            ['value', 'S', '', '\\{(k, k^2) : k = 1, \\dots, 10\\}'],
        ]
    );
});

test('let lines print back as written', () => {
    // 6.0 F1: let lines print right after the sliders, before the functions that use them.
    roundTrip('let v = (2, 1)\nlet A = [[1.5, 1], [0.5, 2]]\nlet $f(x, y) = x^2 + 4y^2$\nplot g(x) = f(x, 1)', 'let v = (2, 1)\nlet A = [[1.5, 1], [0.5, 2]]\nlet f(x, y) = x^2 + 4y^2\nplot g(x) = f(x, 1)');
    const full = roundTrip('let $c = -0.8 + 0.156i$\nlet $w = \\begin{pmatrix} -1 \\\\ 2 \\end{pmatrix}$', 'let c = -0.8 + 0.156i\nlet $w = \\begin{pmatrix} -1 \\\\ 2 \\end{pmatrix}$');
    assert.match(full, /\\let\{w = \\begin\{pmatrix\} -1 \\\\ 2 \\end\{pmatrix\}\}/);
});

test('a let name is a name: twice, or like a function, is a problem', () => {
    assert.match(read('let v = (1, 2)\nlet v = (3, 4)').problems.join('\n'), /2:5 .*v/);
    assert.match(read('let f(x) = x\nplot f(x) = x^2').problems.join('\n'), /f/);
    assert.match(read('let v').problems.join('\n'), /Write a definition as let v = \(2, 1\)/);
});

test('vector arrows: the forms of the line', () => {
    const t = tools(['let v = (2, 1)', 'let w = (-1, 2)', 'draw v as an arrow', 'draw v and w as arrows, labelled', 'draw v from (1, 1)', 'draw v + w tip to tail in red', 'draw (1, 3) as an arrow'].join('\n'));
    const arrows = t.filter((x) => x.type === 'vector');
    assert.deepEqual(
        arrows.map((x) => [x.vectors, x.from ?? '', x.tipToTail ?? false, x.valueLabel ?? false]),
        [
            ['v', '', false, false],
            ['v; w', '', false, true],
            ['v', '(1, 1)', false, false],
            ['v + w', '', true, false],
            ['(1, 3)', '', false, false],
        ]
    );
    const lines = ['let v = (2, 1)', 'let w = (-1, 2)', 'draw v as an arrow', 'draw v and w as arrows, labelled', 'draw v as an arrow from (1, 1)', 'draw v + w tip to tail in red, dashed'];
    const full = roundTrip(lines.join('\n'));
    assert.match(full, /\\draw\[vector, from=\{\(1, 1\)\}\]\{v\}/);
    assert.match(full, /\\draw\[vector, tip to tail, red, dashed\]\{v \+ w\}/);
    // `draw v from (1, 1)` reads as the arrow from (1, 1) too.
    assert.equal(canonical(read('let v = (2, 1)\ndraw v from (1, 1)').data), canonical(read('let v = (2, 1)\ndraw v as an arrow from (1, 1)').data));
});

test('points of a list', () => {
    const text = ['slider n from 3 to 12, starting at 6, in steps of 1', 'mark the points $\\{e^{2\\pi i k / n} : k = 0, \\dots, n - 1\\}$, joined, labelled', 'let S = [(1, 2), (3, 1)]', 'mark the points of S in blue, large'].join('\n');
    const t = tools(text);
    assert.deepEqual(
        t.filter((x) => x.type === 'listPoints').map((x) => [x.points, x.joined ?? false, x.valueLabel ?? false]),
        [
            ['\\{e^{2\\pi i k / n} : k = 0, \\dots, n - 1\\}', true, true],
            ['S', false, false],
        ]
    );
    const full = roundTrip(text);
    assert.match(full, /\\mark\[/);
});

test('old lines read as before', () => {
    const t = tools('mark the points (1, 2), (3, 4)\ndraw an arrow from (0, 0) to (1, 1)\ndraw x^2 + y^2 = 4');
    assert.deepEqual(t.map((x) => x.type), ['points', 'segment', 'curve']);
});

test('a rewrite keeps the let lines where they are', () => {
    const text = 'let v = (2, 1)\n% the arrow\ndraw v as an arrow\nplot f(x) = x^2';
    const data = read(text).data;
    (data.functions as Data[])[0].expression = 'x^3';
    assert.equal(writeChartText(text, data), 'let v = (2, 1)\n% the arrow\ndraw v as an arrow\nplot f(x) = x^3');
});
