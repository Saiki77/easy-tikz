/*
 * 6.2.1: symbols the preview shows from plain text (an arrow, a relation, a
 * Greek letter, a letter with a combining accent) are written so pdflatex
 * prints them; it stopped on them before (texLabel).
 */
import { test, assert } from './_lib';
import { texLabel } from '../src/mathcontext';

// ------------------------------------------------------------ symbols the preview shows and pdflatex did not know

test('texLabel: arrows, relations, Greek letters and accented letters typed as Unicode print in LaTeX', () => {
    assert.equal(texLabel('P1: unzulässig → schließen'), 'P1: unzulässig \\ensuremath{\\rightarrow} schließen');
    assert.equal(texLabel('x ≤ -2 + 6(1 - y), x ≥ 2'), 'x \\ensuremath{\\le} -2 + 6(1 - y), x \\ensuremath{\\ge} 2');
    assert.equal(texLabel('Deckel α'), 'Deckel \\ensuremath{\\alpha}');
    assert.equal(texLabel('v̂ = 4.875'), '\\^{v} = 4.875', 'v with a combining hat');
    assert.equal(texLabel('ṽ = 4.75'), '\\~{v} = 4.75', 'precomposed v with tilde');
    // Inside math the symbols become commands; Latin-1 letters stay as typed.
    assert.equal(texLabel('$x ≤ 2$ and ä'), '$x \\le  2$ and ä');
    assert.equal(texLabel('$v̂$'), '$\\hat{v}$');
});
