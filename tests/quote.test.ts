// Quoted text in chart lines (src/text/quote.ts, 5.2.1): LaTeX commands keep
// one backslash ("$\theta$" is not a tab), other JSON escapes still work,
// and text written before ("$\\theta$") reads the same.
import { test, assert } from './_lib';
import { quote, unquote } from '../src/text/quote';
import { parseChartText } from '../src/text/parse';
import { printChartText } from '../src/text/print';

test('quote: LaTeX commands keep one backslash, in math and outside it', () => {
    const same = ['$\\theta$', '$\\frac{1}{2}$', '$\\nabla f$', '$\\beta + \\rho \\times \\tau$', '$$\\int_0^1 f\\,dx$$', '\\(\\neq\\)', 'Area $\\bar{x}$ here', '$\\text{m/s}$', '\\textbf{A}', '\\alpha + 1', '50\\% cut'];
    for (const body of same) assert.equal(unquote(body), body, body);
});

test('quote: text written before reads the same (doubled backslashes, JSON escapes)', () => {
    assert.equal(unquote('$\\\\theta$'), '$\\theta$');
    assert.equal(unquote('$\\\\frac{1}{2}$'), '$\\frac{1}{2}$');
    assert.equal(unquote('first\\n second'), 'first\n second');
    assert.equal(unquote('a\\t1'), 'a\t1');
    // A JSON escape right before letters reads as a LaTeX command (labels draw no line breaks).
    assert.equal(unquote('first\\nsecond'), 'first\\nsecond');
    assert.equal(unquote('say \\"hi\\"'), 'say "hi"');
    assert.equal(unquote('caf\\u00e9'), 'café');
    // Pairs JSON does not know stay as written (JSON would fail on them).
    assert.equal(unquote('cost \\$5'), 'cost \\$5');
    assert.equal(unquote('$a\\,b$'), '$a\\,b$');
});

test('quote: the writer keeps LaTeX readable and reads back the same', () => {
    assert.equal(quote('$\\theta$'), '"$\\theta$"');
    assert.equal(quote('$\\nabla f$'), '"$\\nabla f$"');
    assert.equal(quote('$a\\,b$'), '"$a\\,b$"');
    assert.equal(quote('first\n second'), '"first\\n second"');
    assert.equal(quote('first\nsecond'), '"first\\u000asecond"');
    assert.equal(quote('\\textbf{A}'), '"\\textbf{A}"');
    assert.equal(quote('say "hi"'), '"say \\"hi\\""');
    // A backslash before one letter or none is doubled.
    assert.equal(quote('a\\b1'), '"a\\\\b1"');
    assert.equal(quote('end\\'), '"end\\\\"');
    assert.equal(unquote(quote('$a\nb$').slice(1, -1)), '$a\nb$');
});

/** A small seeded random source, so a failure repeats. */
function rng(seed: number): () => number {
    let s = seed >>> 0;
    return () => {
        s = (s * 1664525 + 1013904223) >>> 0;
        return s / 2 ** 32;
    };
}
const PIECES = ['$', '$$', '\\', '\\\\', 'a', 'n', 't', 'f', 'b', 'r', 'u', '0', 'e', 'x', '"', ' ', '(', ')', '\\(', '\\)', '{', '}', ',', '/', '\n', '\t', '\u2028', '\u007f', 'abla', 'heta', 'é'];

test('quote: every text reads back the same (5000 random texts)', () => {
    const r = rng(7);
    for (let n = 0; n < 5000; n++) {
        let s = '';
        const len = Math.floor(r() * 10);
        for (let i = 0; i < len; i++) s += PIECES[Math.floor(r() * PIECES.length)];
        assert.equal(unquote(quote(s).slice(1, -1)), s, JSON.stringify(s));
    }
});

test('quote: text JSON wrote before reads the same, when it holds no control characters (5000 random texts)', () => {
    const r = rng(11);
    const plain = PIECES.filter((p) => !/[\n\t\u2028\u007f]/.test(p));
    for (let n = 0; n < 5000; n++) {
        let s = '';
        const len = Math.floor(r() * 10);
        for (let i = 0; i < len; i++) s += plain[Math.floor(r() * plain.length)];
        assert.equal(unquote(JSON.stringify(s).slice(1, -1)), s, JSON.stringify(s));
    }
});

type Labelled = { tools: Array<{ label?: string }>; title?: string };
const labelOf = (text: string): string | undefined => (parseChartText(text).data as Labelled).tools.find((t) => typeof t.label === 'string')?.label;

test('quote: chart lines with a LaTeX label, typed with one backslash or (as before) two', () => {
    const one = 'plot f(x) = x^2\ndraw an arrow from (0, 0) to (1, 1) labelled "$\\theta$"';
    const two = 'plot f(x) = x^2\ndraw an arrow from (0, 0) to (1, 1) labelled "$\\\\theta$"';
    assert.equal(labelOf(one), '$\\theta$');
    assert.equal(labelOf(two), '$\\theta$');
    // The chart is written back with one backslash, and reads back the same.
    const printed = printChartText(parseChartText(two).data);
    assert.ok(printed.includes('labelled "$\\theta$"'), printed);
    assert.equal(labelOf(printed), '$\\theta$');
    // LaTeX outside math too, as the Help's label reference shows it.
    assert.equal(labelOf('draw an arrow from (0, 0) to (1, 1) labelled "\\textbf{A} at 50\\%"'), '\\textbf{A} at 50\\%');
});

test('quote: titles, legends and region labels keep their LaTeX', () => {
    const text = [
        'title "Area $\\frac{1}{2} \\theta r^2$"',
        'plot f(x) = x^2 with the legend "$\\beta x^2$"',
        'shade where 0 <= x <= 1 and 0 <= y <= f(x) "$\\rho$"',
    ].join('\n');
    const r = parseChartText(text);
    assert.deepEqual(r.problems, []);
    const back = parseChartText(printChartText(r.data));
    assert.deepEqual(back.data, r.data);
    assert.equal((r.data as Labelled).title, 'Area $\\frac{1}{2} \\theta r^2$');
});
