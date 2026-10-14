/* eslint-env node */
// node scripts/media/brand/kit.test.mjs
// The parts of the kit that are pure functions: the paper's lines, the callout curve, the pointer's
// keycap. Exits with code 1 on a failure.
import assert from 'node:assert/strict';
import { callout, curve } from './callout.mjs';
import { lineOf, paperSVG } from './paper.mjs';
import { keycapSize, pointer } from './pointer.mjs';

// ---- paper: a line is a whole number of device pixels, and its ink follows the unit.
assert.deepEqual(lineOf(36), { line: 1, ink: 1 }, 'the title page is the reference: one pixel, the full colour');
assert.equal(lineOf(24).line, 1);
assert.ok(Math.abs(lineOf(24).ink - 2 / 3) < 1e-9, 'a 1600 px page carries two thirds of the ink');
assert.ok(Math.abs(lineOf(29).ink - 29 / 36) < 1e-9, 'the 1920 px video stage');
assert.deepEqual(lineOf(72), { line: 2, ink: 1 }, 'twice the title page: two pixels');
for (const unit of [16, 21, 24, 25, 29, 36, 45, 54, 72]) {
    const { line, ink } = lineOf(unit);
    assert.ok(Number.isInteger(line) && line >= 1, `unit ${unit}: a whole number of pixels`);
    assert.ok(ink > 0 && ink <= 1, `unit ${unit}: ink within 0..1`);
    // The same share of the paper is inked at every size (up to the cap at full colour).
    if (ink < 1) assert.ok(Math.abs((line * ink) / unit - 1 / 36) < 1e-9, `unit ${unit}: ink per unit of paper`);
}
const card = paperSVG({ width: 1600, height: 1000 });
assert.match(card, /stroke-width="1" stroke-opacity="0\.67"/, 'feature page: 1 px lines at two thirds');
assert.match(card, /M24\.5 0V1000/, 'the line of x = 24 covers the pixel 24 to 25');
assert.match(card, /M0 72\.5H1600/, 'the line of y = 72 covers the pixel row 72');
assert.match(card, /<path d="M96\.5 0V1000" stroke="#E3A6A0"/, 'the margin rule, 4 units from the left');
assert.equal(card.split('M96.5 0V1000').length - 1, 1, 'the margin rule takes the place of the grid line at x = 96');
const hero = paperSVG({ width: 2400, height: 1350 });
assert.match(hero, /stroke-width="1">/, 'title page: 1 px lines at full colour');
assert.match(hero, /M36\.5 0V1350/);
assert.match(paperSVG({ width: 1600, height: 1000, line: 2 }), /stroke-width="2">/, 'an explicit weight is taken as given, at full ink');

// ---- callout: one looseness, or one for each end.
const ends = { from: [400, 100], to: [100, 400], out: 180, in: 90 };
const even = curve({ ...ends, looseness: 1 });
const pair = curve({ ...ends, looseness: [1.5, 0.5] });
const reach = Math.hypot(300, 300) * 0.3915;
assert.ok(Math.abs(even[1][0] - (400 - reach)) < 1e-6 && Math.abs(even[1][1] - 100) < 1e-6, 'the first handle leaves to the left');
assert.ok(Math.abs(even[2][1] - (400 - reach)) < 1e-6 && Math.abs(even[2][0] - 100) < 1e-6, 'the second handle arrives from above');
assert.ok(Math.abs(pair[1][0] - (400 - reach * 1.5)) < 1e-6, 'a pair: the first number is for the start');
assert.ok(Math.abs(pair[2][1] - (400 - reach * 0.5)) < 1e-6, 'a pair: the second number is for the end');
assert.deepEqual(curve({ ...ends, looseness: [1, 1] }), even);
const drawn = callout({ ...ends, gap: 8 });
assert.ok(drawn.svg.includes('callout-line') && drawn.svg.includes('callout-tip'));
assert.ok(Math.hypot(drawn.tip.x - 100, drawn.tip.y - 400) > 7 && Math.hypot(drawn.tip.x - 100, drawn.tip.y - 400) < 9, 'the tip stops `gap` px before its target');
assert.ok(!callout({ ...ends, progress: 0 }).svg.includes('callout-line'), 'nothing is drawn at progress 0');
assert.ok(callout({ ...ends, casing: 2 }).svg.includes('callout-casing'));

// ---- pointer: the keycap is text of the image, never under the smallest size of the brand.
const key = keycapSize('Shift', 1.3);
assert.ok(key.font >= 19.2, `keycap label at the page pointer's scale: ${key.font} px, the floor is 19.2`);
assert.ok(key.width > key.font * 3 && key.width < key.font * 5 && key.height > key.font * 1.4, 'a key a little wider than its word');
assert.ok(keycapSize('Shift', 1.6).font >= 1920 * 0.012, 'on the 1920 px stage at scale 1.6 the label is above 1.2 % of the width');
const p = pointer({ x: 500, y: 300, scale: 1.3, keycap: 'Shift' });
assert.match(p, />Shift<\/text>/, 'the label keeps its capital: capitals and small capitals');
assert.match(p, new RegExp(`font-size="${Math.round(key.font * 100) / 100}"`));
const rectX = (svg) => Number(/<rect x="([\d.-]+)"/.exec(svg)[1]);
assert.ok(rectX(p) > 500, 'by default the keycap sits to the right of the hot spot');
const left = pointer({ x: 500, y: 300, scale: 1.3, keycap: 'Shift', keycapSide: 'left' });
assert.ok(rectX(left) + key.width < 500, 'keycapSide left: wholly to the left of the hot spot');
const moved = pointer({ x: 500, y: 300, scale: 1.3, keycap: 'Shift', keycapSide: 'left', keycapOffset: [-40, 12] });
assert.ok(Math.abs(rectX(moved) - (rectX(left) - 40)) < 0.011, 'keycapOffset moves the badge');
assert.ok(!pointer({ x: 1, y: 1 }).includes('pointer-keycap') && pointer({ x: 1, y: 1, ring: 0.5, held: true }).includes('pointer-ring'));

console.log('kit.mjs: paper, callout and pointer ok');
