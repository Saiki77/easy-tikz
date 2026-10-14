/* eslint-env node */
// node scripts/media/brand/math.test.mjs
// The formatter on the formulas the media use. Exits with code 1 on a failure.
import assert from 'node:assert/strict';
import { aligned, equation, italic, math, mathText, tokenize } from './math.mjs';

const x = italic('x');
const y = italic('y');
const c = italic('c');
const a = italic('a');
const k = italic('k');
const cases = [
    // input, plain text
    ['2x + 3y <= 12', `2${x} + 3${y} ≤ 12`],
    ['2x + 3y = c', `2${x} + 3${y} = ${c}`],
    ['2.5x + 3y = c', `2.5${x} + 3${y} = ${c}`],
    ['c = 10.5', `${c} = 10.5`],
    ['x + y <= 4', `${x} + ${y} ≤ 4`],
    ['x + 3y <= 6', `${x} + 3${y} ≤ 6`],
    ['x >= 0', `${x} ≥ 0`],
    ['0 <= x <= 4', `0 ≤ ${x} ≤ 4`],
    ['z = 9', `${italic('z')} = 9`],
    ['x* = (3, 1)', `${x}* = (3, 1)`],
    ['-x - 2', `−${x} − 2`],
    ['-x + 4', `−${x} + 4`],
    ['a x^2 - 3x', `${a}${x}^2 − 3${x}`],
    ['sin(x)', `sin(${x})`],
    ['1.5sin(x)', `1.5 sin(${x})`],
    ['sin(x - 0.5) + 0.5', `sin(${x} − 0.5) + 0.5`],
    ['a exp(-k x) cos(w x)', `${a} exp(−${k}${x}) cos(${italic('w')}${x})`],
    ['min(f1, f2) <= y <= max(f1, f2)', `min(${italic('f')}_1, ${italic('f')}_2) ≤ ${y} ≤ max(${italic('f')}_1, ${italic('f')}_2)`],
    ['P1_x', `${italic('P')}_(1, ${x})`],
    ['P1_val', `${italic('P')}_(1, val)`],
    ['(x - 3)^2 + (y - 2)^2 <= 2^2', `(${x} − 3)^2 + (${y} − 2)^2 ≤ 2^2`],
    ['(x - 3)^2 + (y - 2)^2 <= 2.5^2', `(${x} − 3)^2 + (${y} − 2)^2 ≤ 2.5^2`],
    ['f1(a) + (3a^2 - 3)(x - a)', `${italic('f')}_1(${a}) + (3${a}^2 − 3)(${x} − ${a})`],
    ['2*x', `2 ⋅ ${x}`],
    ['a*b', `${a} ⋅ ${italic('b')}`],
    ['c: 9 -> 10.5', `${c}: 9 → 10.5`],
    ['"maximise" z = 2x + 3y', `maximise ${italic('z')} = 2${x} + 3${y}`],
    ['2 pi r', `2${italic('π')}${italic('r')}`],
    ['slope = -5/6', `${italic('s')}${italic('l')}${italic('o')}${italic('p')}${italic('e')} = −5/6`],
    ['h = 1', 'ℎ = 1'],
    ['2x + 3y = c,  c = 9', `2${x} + 3${y} = ${c}, ${c} = 9`],
];
let failed = 0;
for (const [input, expected] of cases) {
    try {
        assert.equal(mathText(input), expected);
        const html = math(input);
        assert.ok(html.startsWith('<span class="m"') && html.endsWith('</span>'), 'markup is one span');
        assert.ok(!/<=|>=|!=|->/.test(html.replace(/<[^>]+>/g, '')), 'no raw two-character operator is left');
        assert.ok(!html.includes(String.fromCharCode(0x2014)), 'no em dash');
        const open = (html.match(/<span/g) || []).length;
        const close = (html.match(/<\/span>/g) || []).length;
        assert.equal(open, close, 'balanced spans');
    } catch (e) {
        failed++;
        console.error(`FAIL  ${input}\n      ${e.message}`);
    }
}
try {
    // Variables are math italic letters of their own, numbers and function names stay upright.
    const html = math('2x + 3y <= 12');
    assert.ok(html.includes(`<span class="mn">2</span><span class="mi">${x}</span><span class="mo mbin">+</span>`), html);
    assert.ok(html.includes('<span class="mo mrel">≤</span><span class="mn">12</span>'), html);
    assert.ok(math('sin(x)').includes('<span class="mop">sin</span><span class="mo">(</span>'));
    // A leading minus is a sign, not a subtraction: no operator spacing.
    assert.ok(math('-x - 2').includes(`<span class="mo">−</span><span class="mi">${x}</span><span class="mo mbin">−</span>`));
    // Emphasis wraps exactly the marked part.
    assert.ok(math('[[2.5]]x + 3y = c').includes(`<span class="m-em"><span class="mn">2.5</span></span><span class="mi">${x}</span>`));
    // The star of x* is raised, not a multiplication.
    assert.ok(math('x* = (3, 1)').includes('<span class="msup"><span class="mstar">∗</span></span>'));
    assert.ok(!math('x* = (3, 1)').includes('⋅'));
    // Powers.
    assert.ok(math('x^2').includes(`<span class="mi">${x}</span><span class="msup"><span class="mn">2</span></span>`));
    // Display equations carry their tag.
    const eq = equation('2x + 3y = c', 1);
    assert.ok(eq.startsWith('<div class="eq">') && eq.includes('<span class="eq-tag">(1)</span>'));
    assert.ok(math('2x + 3y = c,  c = 9').includes('<span class="mo mpunct">,</span><span class="mquad"></span>'));
    assert.ok(!math('(3, 1)').includes('mquad'));
    assert.equal(tokenize('x<=4').map((t) => t.t).join(' '), 'id rel num');
    // Aligned equations split at the first relation sign outside brackets; emphasis stays inside its side.
    const al = aligned([['2x + 3y = c,  c = 9', 1], { inter: '<i>then</i>' }, ['[[2.5]]x + 3y = c,  c = [[10.5]]', 2], ['f(x = 1) <= 2']]);
    assert.ok(al.startsWith('<div class="eq-align">') && al.endsWith('</div>'));
    assert.equal((al.match(/class="eq-row"/g) || []).length, 3);
    assert.ok(al.includes(`<span class="eq-l m m-display"><span class="mn">2</span><span class="mi">${x}</span><span class="mo mbin">+</span><span class="mn">3</span><span class="mi">${y}</span></span><span class="eq-r m m-display"><span class="mo mrel">=</span>`), al);
    assert.ok(al.includes(`<span class="eq-l m m-display"><span class="m-em"><span class="mn">2.5</span></span><span class="mi">${x}</span>`), al);
    assert.ok(al.includes('<span class="eq-tag">(2)</span>') && al.includes('<div class="eq-inter"><i>then</i></div>'));
    assert.ok(al.includes('<span class="eq-r m m-display"><span class="mo mrel">≤</span><span class="mn">2</span></span><span class="eq-tag"></span>'), 'the relation inside the brackets is not the split point');
    assert.equal((al.match(/<span/g) || []).length, (al.match(/<\/span>/g) || []).length, 'balanced spans');
} catch (e) {
    failed++;
    console.error(`FAIL  markup\n      ${e.message}`);
}
if (failed) {
    console.error(`${failed} failed`);
    process.exit(1);
}
console.log(`math.mjs: ${cases.length} formulas ok`);
