// LaTeX math as formulas (src/latex.ts, 5.0): LaTeX becomes the plain syntax
// with the same values; plain formulas stay as they are; chart text reads
// formulas in $...$ and keeps the dollars of labels.
import { test, assert } from './_lib';
import { latexToPlain, looksLikeLatex, stripMathDollars } from '../src/latex';
import { identifierTokens, renameIdentifier } from '../src/expr';
import { SettingsManager } from '../src/settings';
import { parseChartText } from '../src/text/parse';

const ctx = SettingsManager.fromJSON({ v: 4 }).createMathContext({ memo: false });
/** The value of a formula in x at x, through the plugin's own parser (which reads LaTeX itself). */
function at(src: string, x: number): number {
    return ctx.fn1(src)(x);
}
const close = (a: number, b: number) => Math.abs(a - b) < 1e-9 * Math.max(1, Math.abs(b));

test('latex: plain formulas stay exactly as they are', () => {
    for (const s of ['x^2/2 - 2', 'sqrt(x) e^(-x)', 'f1(x - 1)', '2x + 3y <= 12', 'abs(x)', 'P1_x']) {
        assert.equal(looksLikeLatex(s), false, s);
        assert.equal(latexToPlain(s), s);
    }
});

test('latex: fractions, roots, powers and functions have the same values', () => {
    const cases: Array<[string, (x: number) => number]> = [
        ['\\frac{1}{2}x^2 - 2', (x) => x * x / 2 - 2],
        ['\\dfrac{x+1}{x-2}', (x) => (x + 1) / (x - 2)],
        ['\\sqrt{x}\\,e^{-x}', (x) => Math.sqrt(x) * Math.exp(-x)],
        ['\\sqrt[3]{x}', (x) => Math.cbrt(x)],
        ['e^{-x/4}\\sin(2x)', (x) => Math.exp(-x / 4) * Math.sin(2 * x)],
        ['\\sin x + \\cos{x}', (x) => Math.sin(x) + Math.cos(x)],
        ['\\sin 2x', (x) => Math.sin(2 * x)],
        ['\\sin^2 x', (x) => Math.sin(x) ** 2],
        ['2\\pi x', (x) => 2 * Math.PI * x],
        ['\\left(1 - \\frac{x}{3}\\right)x', (x) => (1 - x / 3) * x],
        ['x \\cdot 3', (x) => x * 3],
        ['|x - 2|', (x) => Math.abs(x - 2)],
        ['\\ln|x|', (x) => Math.log(Math.abs(x))],
        ['\\left|x\\right| + 1', (x) => Math.abs(x) + 1],
        ['x^{2}+2x', (x) => x * x + 2 * x],
    ];
    for (const [src, f] of cases) {
        for (const x of [0.7, 1.9, 2.6]) {
            const got = at(latexToPlain(src), x);
            assert.ok(close(got, f(x)), `${src} at ${x}: ${got} (plain: ${latexToPlain(src)}), expected ${f(x)}`);
        }
    }
});

test('latex: relations, Greek letters and subscripts', () => {
    assert.equal(latexToPlain('x + y \\le 4').replace(/\s+/g, ' '), 'x + y <= 4');
    assert.equal(latexToPlain('x \\geq 0').replace(/\s+/g, ' '), 'x >= 0');
    assert.match(latexToPlain('2\\cos(\\theta)'), /^2\s*cos\(\s*theta\s*\)$/);
    assert.equal(latexToPlain('x_{1} + a_{max}'), 'x_1 + a_max');
    assert.equal(latexToPlain('\\operatorname{sgn}(x)'), 'sgn(x)');
});

test('latex: the parser reads LaTeX directly, in every field', () => {
    assert.ok(close(at('\\frac{1}{2}x^2 - 2', 2), 0));
    assert.ok(close(ctx.value('\\frac{\\pi}{2}'), Math.PI / 2));
});

test('latex: chart text reads formulas in $...$ and keeps the dollars of labels', () => {
    assert.equal(stripMathDollars('plot $f(x) = \\frac{1}{2}x^2$ in blue, labelled "$f$"'), 'plot f(x) = \\frac{1}{2}x^2 in blue, labelled "$f$"');
    const r = parseChartText('show x from -4 to 4 and y from -3 to 4\nplot $f(x) = \\frac{1}{2}x^2 - 2$ in blue, thick\nshade where $x + y \\le 4$ and $x \\ge 0$\ndraw $x^2 + y^2 = 9$ in red');
    assert.deepEqual(r.problems, []);
    const d = r.data as { functions: Array<{ expression: string; color: string }>; tools: Array<{ type: string; conditions?: string[]; equation?: string }> };
    assert.equal(d.functions[0].expression, '\\frac{1}{2}x^2 - 2');
    assert.equal(d.functions[0].color, 'blue');
    assert.deepEqual(d.tools.find((t) => t.type === 'region')?.conditions, ['x + y \\le 4', 'x \\ge 0']);
    assert.equal(d.tools.find((t) => t.type === 'curve')?.equation, 'x^2 + y^2 = 9');
});

test('latex: a slider in a LaTeX formula is a dependency, and a rename reaches it', () => {
    const settings = SettingsManager.fromJSON({ v: 4, parameters: [{ name: 'a', value: 1, min: -1, max: 2, step: 0.05 }], functions: [{ name: 'f', expression: '\\frac{x^3}{3} - a x' }] });
    const math = settings.createMathContext({ memo: false });
    assert.deepEqual(math.deps('f').params, ['a']);
    assert.deepEqual(math.deps('\\frac{x^3}{3} - a x').params, ['a']);
    // Its braces group: a label template keeps its placeholders.
    assert.deepEqual((identifierTokens('z = {a}') || []).map((t) => t.text), ['a']);
    assert.equal(renameIdentifier('\\frac{x^3}{3} - a x', 'a', 'k'), '\\frac{x^3}{3} - k x');
    assert.equal(renameIdentifier('\\sqrt{a}\\,e^{-a x}', 'a', 'k'), '\\sqrt{k}\\,e^{-k x}');
    assert.equal(renameIdentifier('\\sin(\\theta) + a', 'theta', 'phi'), '\\sin(\\theta) + a');
    assert.equal(renameIdentifier('a x^2', 'a', 'k'), 'k x^2');
});

test('latex: a letter before a function or a fraction multiplies it (a\\sin x is never asin)', () => {
    const cases: Array<[string, (x: number) => number]> = [
        ['x\\sin x', (x) => x * Math.sin(x)],
        ['x\\cos(2x)', (x) => x * Math.cos(2 * x)],
        ['x\\ln x', (x) => x * Math.log(x)],
        ['x\\sqrt{x}', (x) => x * Math.sqrt(x)],
        ['x\\frac{1}{2}', (x) => x / 2],
        ['3x\\sin^2 x', (x) => 3 * x * Math.sin(x) ** 2],
    ];
    for (const [src, f] of cases) for (const x of [0.5, 1.3, 2.2]) assert.ok(close(at(src, x), f(x)), `${src} at ${x}: ${at(src, x)} vs ${f(x)}`);
    assert.equal(latexToPlain('a\\sin(b x)'), 'a sin(b x)');
    assert.equal(latexToPlain('a\\cos\\theta'), 'a cos(theta)');
    // x_{\\text{max}} stays one name.
    assert.equal(latexToPlain('x_{\\text{max}}'), 'x_max');
});

test('latex: letters side by side multiply when each is known (a\\sin(bx) is a sin(b x)); arc functions and powers', () => {
    const chart = parseChartText(['slider a from 0.5 to 2.5, starting at 2', 'slider b from 0.5 to 3, starting at 1.5', 'plot $f(x) = a\\sin(bx)$'].join('\n'));
    const settings = SettingsManager.fromJSON(chart.data);
    const math = settings.createMathContext({ memo: false });
    const params = settings.getValue('parameters');
    math.setParams(Array.isArray(params) ? params : []);
    assert.deepEqual(math.functions().map((f) => f.error ?? 'ok'), ['ok']);
    // The formula follows both sliders.
    assert.deepEqual(math.deps('a\\sin(bx)').params.sort(), ['a', 'b']);
    // \arcsin is asin, \cos^2(x) is (cos x)^2.
    assert.ok(Math.abs(at('\\arcsin(x)', 0.5) - Math.asin(0.5)) < 1e-12);
    assert.ok(Math.abs(at('\\cos^2(x)', 0.7) - Math.cos(0.7) ** 2) < 1e-12);
});

test('latex: inside $...$ letters side by side multiply; the chart own names stay whole; without dollars ax is one name', () => {
    const errors = (lines: string[]) => {
        const chart = parseChartText(lines.join('\n'));
        const settings = SettingsManager.fromJSON(chart.data);
        const math = settings.createMathContext({ memo: false });
        const params = settings.getValue('parameters');
        math.setParams(Array.isArray(params) ? params : []);
        return [...chart.problems.map((p) => p.message), ...math.functions().filter((f) => f.error).map((f) => String(f.error))];
    };
    assert.deepEqual(errors(['slider k from 1 to 3', 'plot $f(x) = kx^2$']), []);
    assert.deepEqual(errors(['slider speed from 1 to 3', 'plot $f(x) = speed \\cdot x$']), []);
    assert.deepEqual(errors(['slider k from 1 to 3', 'plot f(x) = kx^2']), ["Unknown name 'kx'. Did you mean k*x?"]);
    const region = parseChartText(['slider a from 1 to 3', 'slider b from 1 to 3', 'shade where $ax + by \\le 4$'].join('\n')).data.tools as Array<{ conditions: string[] }>;
    assert.deepEqual(region[0].conditions, ['a x + b y \\le 4']);
});
