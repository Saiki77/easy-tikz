// Pure helpers in src/util.ts: the pixel-scaled marching-squares grid,
// the stripLatex plain-text fallback and the shared small helpers.
import { test, assert } from './_lib';
import { cloneData, errorText, fitPixelScale, marchingGrid, normalizePixelScale, stripLatex } from '../src/util';

test('normalizePixelScale rounds to 0.05, caps at 1, falls back to 1', () => {
    assert.equal(normalizePixelScale(0.703), 0.7);
    assert.equal(normalizePixelScale(0.724), 0.7);
    assert.equal(normalizePixelScale(0.726), 0.75);
    assert.equal(normalizePixelScale(1.8), 1);
    assert.equal(normalizePixelScale(0.001), 0.05);
    for (const bad of [0, -1, NaN, Infinity, undefined, null]) assert.equal(normalizePixelScale(bad as number), 1, String(bad));
});

test('fitPixelScale letterboxes like preserveAspectRatio meet', () => {
    // 1440x900 modal, square 760 chart drawn into a 762x534 box.
    assert.equal(fitPixelScale(762, 534, 760, 760), 0.7);
    assert.equal(fitPixelScale(534, 762, 760, 760), 0.7);
    assert.equal(fitPixelScale(380, 240, 760, 480), 0.5);
    assert.equal(fitPixelScale(0, 534, 760, 760), 1, 'not laid out yet');
    assert.equal(fitPixelScale(762, 534, 0, 760), 1, 'unusable config size');
});

test('marchingGrid: scale 1 keeps the viewBox-based grid (3.x / spec formula)', () => {
    assert.deepEqual(marchingGrid(675, 670, undefined, 'full'), { nx: 225, ny: 223 });
    assert.deepEqual(marchingGrid(675, 670, 1, 'draft'), { nx: 113, ny: 112 });
    assert.deepEqual(marchingGrid(1315, 1315, 1, 'full'), { nx: 300, ny: 300 });
    assert.deepEqual(marchingGrid(1315, 1315, 1, 'draft'), { nx: 160, ny: 160 });
});

test('marchingGrid: half the on-screen size gives half the nodes per axis', () => {
    const full = marchingGrid(600, 480, 1, 'full');
    const half = marchingGrid(600, 480, 0.5, 'full');
    assert.deepEqual(full, { nx: 200, ny: 160 });
    assert.deepEqual(half, { nx: 100, ny: 80 });
    assert.deepEqual(marchingGrid(600, 480, 0.5, 'draft'), { nx: 50, ny: 40 });
});

test('marchingGrid: heavySquare at 1440x900 (s = 0.7), cells ~3 / ~6 on-screen px', () => {
    const full = marchingGrid(675, 670, 0.703, 'full');
    const draft = marchingGrid(675, 670, 0.703, 'draft');
    assert.deepEqual(full, { nx: 157, ny: 156 });
    assert.deepEqual(draft, { nx: 79, ny: 78 });
    // previewSize 1400 shown at the same 534 px: same on-screen grid, not 300 / 160.
    const s1400 = fitPixelScale(762, 534, 1400, 1400);
    assert.equal(s1400, 0.4);
    assert.deepEqual(marchingGrid(1315, 1315, s1400, 'full'), { nx: 175, ny: 175 });
    assert.deepEqual(marchingGrid(1315, 1315, s1400, 'draft'), { nx: 88, ny: 88 });
});

test('marchingGrid: clamps and bad sizes', () => {
    assert.deepEqual(marchingGrid(100, 100, 0.05, 'full'), { nx: 40, ny: 40 });
    assert.deepEqual(marchingGrid(100, 100, 0.05, 'draft'), { nx: 24, ny: 24 });
    assert.deepEqual(marchingGrid(5000, 5000, 3, 'full'), { nx: 300, ny: 300 });
    assert.deepEqual(marchingGrid(NaN, -5, 1, 'full'), { nx: 40, ny: 40 });
});

test('stripLatex shows styled text, escaped specials and backslashes', () => {
    assert.equal(stripLatex('Profit in \\textbf{EUR}'), 'Profit in EUR');
    assert.equal(stripLatex('\\textit{note} \\text{and} \\mathrm{d}x'), 'note and dx');
    assert.equal(stripLatex('\\textcolor{red}{hot}'), 'hot');
    assert.equal(stripLatex('50\\% \\& \\$5 \\#1 a\\_b \\{x\\}'), '50% & $5 #1 a_b {x}');
    assert.equal(stripLatex('a \\backslash b'), 'a \\ b');
    assert.equal(stripLatex('x^2 + \\alpha'), 'x² + α');
    assert.equal(stripLatex('x^2\\,dx \\! y'), 'x² dx  y');
});

test('errorText and cloneData', () => {
    assert.equal(errorText(new Error('boom')), 'boom');
    assert.equal(errorText('plain'), 'plain');
    const data = { a: [1, { b: 2 }] };
    const copy = cloneData(data);
    assert.deepEqual(copy, data);
    assert.ok(copy.a !== data.a);
});
