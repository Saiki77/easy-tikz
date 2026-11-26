/*
 * 6.2.1: labels that mix words and math (a title 'LP 3: $\max 2x_1 + x_2$
 * - an edge', an axis name 'Price $f_1$') are typeset in one line, the
 * words in the chart's font and the math by MathJax (labelParts), and the
 * sizes of MathJax labels settle after the flush of their own render pass
 * (LabelCache), so a legend frame or a label box is as large as what is
 * drawn. Found in a real note with 15 charts.
 */
import { test, assert } from './_lib';
import { LabelPart, labelDisplayText, labelParts } from '../src/mathcontext';
import { LabelCache } from '../src/labelcache';
import { stripLatex } from '../src/util';

// ------------------------------------------------------------ words and math in one label

test('labelParts: words and math in pieces; none for plain text and for a label that is one formula', () => {
    const parts = (s: string) => labelParts(s, stripLatex);
    const math = (text: string): LabelPart => ({ math: true, text });
    const words = (text: string): LabelPart => ({ math: false, text });
    assert.deepEqual(parts('Case 1: $\\max 2x_1 + x_2$ – an edge'), [words('Case 1: '), math('\\max 2x_1 + x_2'), words(' – an edge')]);
    assert.deepEqual(parts('Price $f_1$'), [words('Price '), math('f_1')]);
    assert.deepEqual(parts('$x^2$ concave'), [math('x^2'), words(' concave')]);
    assert.deepEqual(parts('$a$ and $b$'), [math('a'), words(' and '), math('b')]);
    assert.deepEqual(parts('from \\(t_0\\) on'), [words('from '), math('t_0'), words(' on')]);
    // The words read as the plain-text preview reads them: LaTeX in the text resolved.
    assert.deepEqual(parts('\\textbf{R\\&D} $c$'), [words('R&D '), math('c')]);
    // One formula as a whole is a math label; no math at all, or dollars that open none, is plain text.
    assert.equal(parts(' $x^2$ '), null);
    assert.equal(parts('plain text'), null);
    assert.equal(parts('costs $5 and $10'), null);
    assert.equal(parts(''), null);
    // The plain text a copy (Copy SVG / PNG) writes for it is the fallback's.
    assert.equal(labelDisplayText('Price $f_1$', stripLatex), 'Price f₁');
});

// ------------------------------------------------------------ the sizes of MathJax labels

/** A stand-in for MathJax: a label's width is wrong until its stylesheet is in (`styled`). */
function fakeMathJax() {
    const state = { styled: false, renders: 0 };
    type El = { src: string };
    const cache = new LabelCache<El>(
        (el) => ({ width: state.styled ? el.src.length * 10 : el.src.length * 8, height: 20 }),
        (el) => ({ ...el })
    );
    const render = (src: string) => cache.get(src, () => {
        state.renders++;
        return { src };
    });
    return { state, cache, render };
}

test('LabelCache: a label measured before its glyphs are styled gets its real size after the flush, and the chart draws again', () => {
    const { state, cache, render } = fakeMathJax();
    const first = render('x = 1');
    assert.equal(first.width, 40, 'measured too small before the flush');
    const handed = cache.beginFlush();
    state.styled = true;
    assert.equal(cache.settle(handed), true, 'the size changed: draw again');
    const again = render('x = 1');
    assert.equal(again.width, 50, 'the redraw gets the real size');
    assert.equal(state.renders, 1, 'served from the cache once settled');
    assert.equal(cache.settle(cache.beginFlush()), false, 'nothing new: no more redraws');
});

test('LabelCache: two early measurements do not settle a size; a second chart drawn before the first flush finished draws again too', () => {
    const { state, cache, render } = fakeMathJax();
    render('f(x)');
    const flushA = cache.beginFlush();
    // Another chart draws the same label before the first flush has styled it (6.2.0 kept this size).
    const b = render('f(x)');
    assert.equal(b.width, 32);
    const flushB = cache.beginFlush();
    state.styled = true;
    assert.equal(cache.settle(flushA), true);
    assert.equal(cache.settle(flushB), true, 'the second chart drew the early size too');
    assert.equal(render('f(x)').width, 40);
});

test('LabelCache: a label that was right from the start needs no redraw', () => {
    const { state, cache, render } = fakeMathJax();
    state.styled = true;
    render('y');
    assert.equal(cache.settle(cache.beginFlush()), false);
});
