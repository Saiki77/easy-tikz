/* 6.2.2: the formula field of the editor: one line, the bracket pair at the caret, when the typeset preview shows, and its LaTeX. */
import { test, assert } from './_lib';
import { bracketDepth, bracketPair, oneLine, wantsPreview } from '../src/ui/exprText';
import { MathContext } from '../src/mathcontext';
import { parse, toTex } from '../src/expr';

const STUDENT_T = '(gamma((df + 1) / 2) / (sqrt(df * pi) * gamma(df / 2))) * (1 + x^2 / df)^(-(df + 1) / 2)';

test('oneLine: line breaks become spaces, nothing else changes', () => {
    assert.equal(oneLine('x^2'), 'x^2');
    assert.equal(oneLine('a\nb'), 'a b');
    assert.equal(oneLine('a\r\nb\rc'), 'a b c');
});

test('bracketPair: the bracket before the caret wins, then the one after it', () => {
    const s = 'f(g(x), [1, 2])';
    // Caret after the first '(' (index 1): it pairs with the last ')'.
    assert.deepEqual(bracketPair(s, 2), [1, 14]);
    // Caret after 'g' (index 3): no bracket before it, so the '(' after it.
    assert.deepEqual(bracketPair(s, 3), [3, 5]);
    // After ')' of g(x).
    assert.deepEqual(bracketPair(s, 6), [3, 5]);
    // Square brackets.
    assert.deepEqual(bracketPair(s, 9), [8, 13]);
    // No bracket next to the caret.
    assert.equal(bracketPair('x + 1', 2), null);
    assert.equal(bracketPair('', 0), null);
});

test('bracketPair: a bracket still being typed, or of another kind, has no pair', () => {
    assert.equal(bracketPair('sin(', 4), null);
    assert.equal(bracketPair('(x]', 1), null);
    assert.equal(bracketPair('x)', 2), null);
});

test('bracketPair: the Student t formula', () => {
    // Caret after 'gamma(' (index 7): the '(' at 6 and the ')' after '/ 2'.
    const pair = bracketPair(STUDENT_T, 7);
    assert.ok(pair);
    assert.equal(pair![0], 6);
    assert.equal(STUDENT_T.slice(pair![0], pair![1] + 1), '((df + 1) / 2)');
    // At the very end: the last ')' pairs with the '(' of the exponent.
    const end = bracketPair(STUDENT_T, STUDENT_T.length);
    assert.ok(end);
    assert.equal(STUDENT_T.slice(end![0], end![1] + 1), '(-(df + 1) / 2)');
});

test('bracketDepth and wantsPreview: long or nested formulas get the preview, short ones not', () => {
    assert.equal(bracketDepth('x^2'), 0);
    assert.equal(bracketDepth('sin(x)'), 1);
    assert.equal(bracketDepth('sqrt(1 - (x/2)^2)'), 2);
    assert.equal(bracketDepth(STUDENT_T), 3);
    assert.equal(wantsPreview(''), false);
    assert.equal(wantsPreview('sin(x)'), false);
    assert.equal(wantsPreview('a*x^2 + b*x + c'), false);
    assert.equal(wantsPreview('f(g(x))'), false);
    assert.equal(wantsPreview('sqrt(1 - (x/2)^2)'), true);
    assert.equal(wantsPreview('x^3 - 3*x^2 + 2*x - 7 + 1'), true);
    assert.equal(wantsPreview(STUDENT_T), true);
});

test('previewTex: stacked fractions, growing brackets and thin spaces for the Student t formula', () => {
    const ctx = new MathContext({ parameters: [{ name: 'df', value: 5, min: 1, max: 30, step: 1 }] });
    assert.equal(
        ctx.previewTex(STUDENT_T),
        '\\frac{\\Gamma\\left(\\frac{\\mathit{df} + 1}{2}\\right)}{\\sqrt{\\mathit{df}\\,\\pi}\\,\\Gamma\\left(\\frac{\\mathit{df}}{2}\\right)}\\,\\left(1 + \\frac{x^{2}}{\\mathit{df}}\\right)^{-\\frac{\\mathit{df} + 1}{2}}'
    );
    // Half typed: null (the field keeps its last preview).
    assert.equal(ctx.previewTex('sin('), null);
    assert.equal(ctx.previewTex('   '), null);
    // Equations and conditions.
    assert.equal(ctx.previewTex('x^2 + y^2 = 4'), 'x^{2} + y^{2} = 4');
    assert.equal(ctx.previewTex('y <= 2*x + 1'), 'y \\le 2 x + 1');
});

test('toTex: legends and the export keep their slashes (display mode is the preview only)', () => {
    const taken = (n: string) => n === 'df';
    assert.equal(
        toTex(parse(STUDENT_T, 'eq'), taken),
        '\\frac{\\Gamma((\\mathit{df} + 1) / 2)}{\\sqrt{\\mathit{df} \\pi} \\Gamma(\\frac{\\mathit{df}}{2})} (1 + \\frac{x^{2}}{\\mathit{df}})^{-(\\mathit{df} + 1) / 2}'
    );
    assert.equal(toTex(parse('2*(x + 1)/3', 'eq')), '2 (x + 1) / 3');
    assert.equal(toTex(parse('2*(x + 1)/3', 'eq'), undefined, true), '\\frac{2 (x + 1)}{3}');
    // Simple products keep their look in display mode.
    assert.equal(toTex(parse('a*x^2 + b*x + c', 'eq'), undefined, true), 'a x^{2} + b x + c');
    assert.equal(toTex(parse('2*pi*x', 'eq'), undefined, true), '2 \\pi x');
});
