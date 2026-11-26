/*
 * 6.2.1: gamma(x) in formulas (issue #10: a Student t density written out
 * with gamma() drew nothing, "Unknown function 'gamma'"): its values, a
 * slider or function called gamma that keeps its meaning, the LaTeX of a
 * legend, and the export (a number, or the curve as coordinates).
 */
import { test, assert, near } from './_lib';
import { MathContext } from '../src/mathcontext';
import { Parameter } from '../src/types';
import { parseChartText } from '../src/text/parse';
import { SettingsManager } from '../src/settings';
import { lnGamma, gamma } from '../src/values/special';

function slider(name: string, value: number): Parameter {
    return { name, value, min: 0, max: 30, step: 1 };
}

const fn = (name: string, expression: string) => ({ name, expression, domain: '', showLegend: false, fill: false, fillOpacity: 0.3, fillPattern: 'solid' as const, tangent: false, color: 'blue', dashed: false, tangentPoint: '', extrema: false, thickness: 'thin', parametric: false, expressionY: '' });

/** The issue's density of the t distribution with df degrees of freedom. */
const T_DENSITY = '(gamma((df + 1) / 2) / (sqrt(df * pi) * gamma(df / 2))) * (1 + x^2 / df)^(-(df + 1) / 2)';

test('gamma: gamma(x) and Gamma(x) are the gamma function, \\Gamma(x) in LaTeX too', () => {
    const ctx = new MathContext({ parameters: [] });
    assert.equal(ctx.value('gamma(5)'), 24);
    near(ctx.value('gamma(0.5)'), Math.sqrt(Math.PI), 1e-14);
    near(ctx.value('Gamma(2.5)'), 1.329340388179137, 1e-14);
    near(ctx.value('\\Gamma(3.5)'), 3.323350970447843, 1e-13);
    assert.ok(Number.isNaN(ctx.value('gamma(0)')) && Number.isNaN(ctx.value('gamma(-2)')));
    near(lnGamma(100), 359.1342053695754, 1e-12);
    near(lnGamma(0.25), Math.log(gamma(0.25)), 1e-13);
    assert.ok(Number.isNaN(lnGamma(0)));
});

test('gamma: the issue\'s t density draws, with its slider df', () => {
    const ctx = new MathContext({ parameters: [slider('df', 5)], functions: [fn('f', T_DENSITY)] });
    const info = ctx.functionInfo('f');
    assert.ok(info && !info.error, info?.error);
    near(info ? info.fn(0) : NaN, 0.3796066898224944, 1e-14);
    near(info ? info.fn(2) : NaN, 0.06509031032621647, 1e-14);
    ctx.setParamValues({ df: 1 });
    // df = 1 is the Cauchy density 1 / (pi (1 + x^2)).
    near(ctx.functionInfo('f')?.fn(1) ?? NaN, 1 / (2 * Math.PI), 1e-14);
});

test('gamma: a slider or a function called gamma keeps its meaning', () => {
    const slid = new MathContext({ parameters: [slider('gamma', 2)], functions: [fn('f', 'gamma(x + 1)'), fn('g', 'gamma*x')] });
    // A product, as before 6.2.1.
    assert.equal(slid.functionInfo('f')?.fn(1), 4);
    assert.equal(slid.functionInfo('g')?.fn(3), 6);
    const own = new MathContext({ parameters: [], functions: [fn('gamma', 'x^2'), fn('h', 'gamma(3)')] });
    assert.equal(own.functionInfo('h')?.fn(0), 9);
    // gamma never becomes a reserved name: a slider may still be called gamma.
    assert.deepEqual(parseChartText('slider gamma from 0 to 1\nplot f(x) = gamma*x').problems, []);
});

test('gamma: legends print \\Gamma, and a slider gamma stays \\gamma', () => {
    assert.equal(new MathContext({ parameters: [] }).tex('gamma(x + 1)'), '\\Gamma(x + 1)');
    assert.equal(new MathContext({ parameters: [slider('gamma', 2)] }).tex('gamma(x + 1)'), '\\gamma(x + 1)');
});

test('gamma: the export writes gamma of numbers as a number, and a curve of gamma(x) as coordinates', () => {
    const tex = (text: string) => {
        const s = SettingsManager.fromJSON(parseChartText(text).data);
        return s.generateTikzCode(s.createMathContext());
    };
    const issue = tex(`show x from -5 to 5 and y from -0.05 to 0.45\nslider df from 1 to 30, starting at 5, in steps of 1\nplot f(x) = ${T_DENSITY} in blue, thick`);
    assert.match(issue, /\\addplot\[etBlue, thick, [^\]]*\] \{\(2\/\(sqrt\(5\*pi\)\*1\.32934\)\)\*/);
    assert.ok(!/gamma/.test(issue), 'pgfmath has no gamma function');
    const curve = tex('show x from 0.5 to 4 and y from 0 to 7\nplot f(x) = gamma(x)');
    assert.match(curve, /\\addplot\[[^\]]*\] coordinates \{/);
});
