/*
 * Iterate and colour the plane (6.0 E), the export: the PNG encoder (zlib
 * that inflates, a PNG of the right size, base64), a coloured plane as
 * \addplot graphics over the view with its PNG handed to the collector
 * (also per frame), orbits, cobwebs, Newton's method and still circles as
 * numeric coordinates.
 */
import { test, assert } from './_lib';
import * as zlibNode from 'node:zlib';
import { parseChartText } from '../src/text/parse';
import { SettingsManager } from '../src/settings';
import { base64, contentHash, encodePng, zlib } from '../src/iterate/png';
import { ExportFile, collectExportFiles, pictureSize } from '../src/iterate/export';

function exported(text: string): { code: string; files: ExportFile[] } {
    const r = parseChartText(text);
    assert.deepEqual(r.problems, [], text);
    const settings = SettingsManager.fromJSON(r.data);
    const made = collectExportFiles(() => settings.generateTikzCode());
    return { code: made.result, files: made.files };
}

/** Width and height of a PNG, from its IHDR. */
function pngSize(png: Uint8Array): [number, number] {
    const v = new DataView(png.buffer, png.byteOffset, png.byteLength);
    return [v.getUint32(16), v.getUint32(20)];
}

/** Inflate with Node's zlib. */
function inflate(bytes: Uint8Array): Uint8Array {
    return new Uint8Array(zlibNode.inflateSync(bytes));
}

function same(a: Uint8Array, b: Uint8Array): boolean {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
    return true;
}

test('zlib streams inflate to what went in', () => {
    for (const n of [0, 1, 5, 300, 70000]) {
        const data = new Uint8Array(n);
        for (let i = 0; i < n; i++) data[i] = (i % 11 === 0 ? (i * 37) & 255 : (i >> 4) & 255);
        assert.ok(same(inflate(zlib(data)), data), `n = ${n}`);
    }
    const noise = new Uint8Array(20000);
    let seed = 7;
    for (let i = 0; i < noise.length; i++) noise[i] = (seed = (seed * 1103515245 + 12345) & 0x7fffffff) & 255;
    assert.ok(same(inflate(zlib(noise)), noise));
});

test('a PNG: signature, size, its rows inflate to the picture', () => {
    const w = 20;
    const h = 10;
    const rgba = new Uint8ClampedArray(w * h * 4);
    for (let k = 0; k < w * h; k++) rgba.set([k & 255, (k * 3) & 255, 200, k % 3 ? 255 : 0], 4 * k);
    const png = encodePng(rgba, w, h);
    assert.deepEqual(Array.from(png.slice(0, 8)), [137, 80, 78, 71, 13, 10, 26, 10]);
    assert.deepEqual(pngSize(png), [w, h]);
    // IDAT: inflate and undo the filters row by row.
    const len = new DataView(png.buffer).getUint32(33);
    const raw = inflate(png.slice(41, 41 + len));
    assert.equal(raw.length, h * (w * 4 + 1));
    const out = new Uint8Array(w * h * 4);
    for (let y = 0; y < h; y++) {
        const f = raw[y * (w * 4 + 1)];
        for (let i = 0; i < w * 4; i++) {
            const x = raw[y * (w * 4 + 1) + 1 + i];
            const a = i >= 4 ? out[y * w * 4 + i - 4] : 0;
            const b = y > 0 ? out[(y - 1) * w * 4 + i] : 0;
            const c = i >= 4 && y > 0 ? out[(y - 1) * w * 4 + i - 4] : 0;
            const p = a + b - c;
            const pr = Math.abs(p - a) <= Math.abs(p - b) && Math.abs(p - a) <= Math.abs(p - c) ? a : Math.abs(p - b) <= Math.abs(p - c) ? b : c;
            out[y * w * 4 + i] = (x + [0, a, b, (a + b) >> 1, pr][f]) & 255;
        }
    }
    assert.deepEqual(Array.from(out), Array.from(rgba));
});

test('base64 and the content hash', () => {
    const b = new Uint8Array(301).map((_, i) => (i * 7919) & 255);
    for (const n of [0, 1, 2, 3, 300, 301]) assert.equal(base64(b.subarray(0, n)), Buffer.from(Array.from(b.subarray(0, n))).toString('base64'));
    assert.equal(contentHash(new Uint8Array([1, 2, 3])), contentHash(new Uint8Array([1, 2, 3])));
    assert.notEqual(contentHash(new Uint8Array([1, 2, 3])), contentHash(new Uint8Array([1, 2, 4])));
    assert.match(contentHash(b), /^[0-9a-f]{8}$/);
});

test('picture sizes follow the plot at 150 dpi, within the caps', () => {
    assert.deepEqual(pictureSize(72.27, 72.27), { w: 150, h: 150 });
    const big = pictureSize(2000, 1000);
    assert.ok(big.w <= 900 && big.w * big.h <= 600000);
});

test('a coloured plane exports as \\addplot graphics over the view, its PNG handed to the collector', () => {
    const { code, files } = exported('show x from -2.5 to 1 and y from -1.25 to 1.25\ngrid\ncolour the plane by $z_{n+1} = z_n^2 + c$, $z_0 = 0$, $c = x + iy$, 60 steps\nplot f(x) = x^2 - 1 in red, with a legend');
    assert.equal(files.length, 1);
    const name = files[0].name;
    assert.match(name, /^plane-[0-9a-f]{8}\.png$/);
    assert.ok(code.includes(`\\addplot[on layer=axis background, forget plot] graphics[xmin=-2.5, xmax=1, ymin=-1.25, ymax=1.25] {${name}};`), code);
    assert.ok(code.includes('set layers'));
    const [w, h] = pngSize(files[0].bytes);
    assert.ok(w > 300 && h > 200, `${w} x ${h}`);
    // The axes, labels and curves stay vector.
    assert.match(code, /\\addplot\[etRed/);
    // The same chart, the same file.
    assert.equal(exported('show x from -2.5 to 1 and y from -1.25 to 1.25\ngrid\ncolour the plane by $z_{n+1} = z_n^2 + c$, $z_0 = 0$, $c = x + iy$, 60 steps\nplot f(x) = x^2 - 1 in red, with a legend').files[0].name, name);
    // Without a collector, the code is the same.
    const plain = SettingsManager.fromJSON(parseChartText('show x from -2.5 to 1 and y from -1.25 to 1.25\ngrid\ncolour the plane by $z_{n+1} = z_n^2 + c$, $z_0 = 0$, $c = x + iy$, 60 steps\nplot f(x) = x^2 - 1 in red, with a legend').data).generateTikzCode();
    assert.equal(plain, code);
});

test('every step of a chart with frames hands its pictures over', () => {
    const { code, files } = exported('frames\nshow x from -2 to 2 and y from -2 to 2\ncolour the plane by $f(z) = z^2$\nthen colour the plane by $f(z) = z^3$, opacity 0.5');
    assert.equal(files.length, 2);
    for (const f of files) assert.ok(code.includes(f.name));
});

test('orbits, cobwebs, Newton and the still circles export as coordinates', () => {
    const orbit = exported('show x from -2 to 2 and y from -2 to 2\nmark P at (-1, 0)\ndraw the orbit of $z_{n+1} = z_n^2 + c$, $z_0 = 0$, $c = P$, 3 steps, labelled').code;
    assert.match(orbit, /\(axis cs:0,0\) -- \(axis cs:-1,0\)/);
    assert.match(orbit, /\$z_\{1\}\$/);
    const cobweb = exported('show x from 0 to 1 and y from 0 to 1\ndraw the cobweb of $x_{n+1} = 2.5 x_n (1 - x_n)$ from 0.2, 5 steps').code;
    assert.match(cobweb, /opacity=0\.3/);
    const newton = exported("show x from -1 to 3 and y from -3 to 6\nplot f(x) = x^2 - 2\ndraw Newton's method for f from 2.5, 3 steps, labelled").code;
    assert.match(newton, /\(axis cs:2\.5,4\.25\) -- \(axis cs:1\.65,0\)/);
    assert.match(newton, /dashed/);
    const circles = exported('show x from -3 to 9 and y from -2 to 2\ndraw the circles of $\\sum_{k=1}^{3} \\frac{4}{\\pi (2k - 1)} e^{i(2k - 1)t}$, with its wave').code;
    assert.ok(!circles.includes('graphics'));
    assert.match(circles, /\\draw/);
});
