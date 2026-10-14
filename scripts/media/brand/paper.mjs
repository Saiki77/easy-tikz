// The paper: cool near-white with a graph grid and one red margin rule.
// Drawn as one SVG that is exactly as large as the canvas: every line is a
// whole number of device pixels, and its ink follows the size of the page. Pure strings, no DOM in paperSVG(): the same
// function serves the templates, the video stage and Node.
//
//   document.body.insertAdjacentHTML('afterbegin', paperSVG({ width: 1600, height: 1000 }));
//
// Where text or a figure would have to fight the lines, the grid fades out
// softly: `fades` are rectangles that are blurred into the grid's mask.
// It is a mask, never a box: nothing with an edge is painted.

export const PAPER = { paper: '#FBFCFD', minor: '#DCE5F0', major: '#C3D2E4', rule: '#E3A6A0' };

const f2 = (v) => (Math.round(v * 100) / 100).toString();
let serial = 0;

/**
 * Weight and ink of the grid for a unit of `unit` px. A line is a whole number of device pixels, so it
 * is crisp at every page size (a 1.5 px line smears over two pixels). The reference is the 2400 px
 * title page: unit 36, one pixel, the full colour. On a smaller page one pixel is a larger part of the
 * page, so the line carries less ink (unit / 36): shown at the same width (800 px in a README), the
 * paper of a 1600 px feature page and of the title page then have the same tone.
 */
export function lineOf(unit) {
    const line = Math.max(1, Math.round(unit / 36));
    return { line, ink: Math.min(1, unit / 36 / line) };
}

/**
 * The grid as an SVG string.
 *   width, height   canvas in px
 *   unit            px between two minor lines (default: 24 at 1600 px width, scaled with the canvas, whole px)
 *   line            line weight in px, a whole number: one device pixel up to a unit of 54 px (default, see lineOf).
 *                   The same for minor and major lines
 *   ink             0..1: how much of their colour the lines carry (default, see lineOf: 1 at a unit of 36 px,
 *                   the 2400 px title page; less on a smaller page, where one pixel is a larger part of the page)
 *   every           a major line every `every` units (default 5)
 *   origin          [x, y] of a point where two major lines cross (default: the margin rule and y = 0)
 *   margin          x of the red margin rule in px, or null for none (default 4 units)
 *   fades           [{ x, y, width, height, strength, feather, radius }]: the grid keeps `strength`
 *                   (0 = gone, default 0.25) of its ink inside the rectangle and returns over `feather` px
 *                   (default 2 units)
 *   background      true (default): the SVG also paints the paper colour
 */
export function paperSVG({ width, height, unit = null, line = null, ink = null, every = 5, origin = null, margin = undefined, fades = [], background = true, colors = PAPER, id = null } = {}) {
    if (!width || !height) throw new Error('paperSVG: width and height are required');
    const u = unit || Math.max(4, Math.round((24 * width) / 1600));
    const auto = lineOf(u);
    const w = line ? Math.max(1, Math.round(line)) : auto.line;
    const a = ink === null ? (line ? 1 : auto.ink) : Math.max(0, Math.min(1, ink));
    const mx = margin === undefined ? u * 4 : margin;
    const [ox, oy] = origin || [mx === null ? 0 : mx, 0];
    const key = id || `paper${++serial}`;
    // Every line starts on a whole pixel (its centre is half its weight further): the line of grid
    // position v covers the pixels v to v + w, so all lines look alike and each is crisp.
    const snap = (v) => Math.round(v - w / 2) + w / 2;
    const minor = [];
    const major = [];
    const first = (o) => Math.ceil(-o / u);
    for (let n = first(ox); ox + n * u <= width; n++) {
        const x = snap(ox + n * u);
        if (mx !== null && Math.abs(ox + n * u - mx) < 0.01) continue; // the margin rule takes this line's place
        (n % every === 0 ? major : minor).push(`M${f2(x)} 0V${height}`);
    }
    for (let n = first(oy); oy + n * u <= height; n++) {
        const y = snap(oy + n * u);
        (n % every === 0 ? major : minor).push(`M0 ${f2(y)}H${width}`);
    }
    const blurs = [];
    const holes = [];
    fades.forEach((fade, n) => {
        const strength = fade.strength === undefined ? 0.25 : fade.strength;
        const feather = fade.feather === undefined ? u * 2 : fade.feather;
        const dev = Math.max(0.01, feather / 2);
        blurs.push(`<filter id="${key}-b${n}" filterUnits="userSpaceOnUse" x="0" y="0" width="${width}" height="${height}"><feGaussianBlur stdDeviation="${f2(dev)}"/></filter>`);
        holes.push(
            `<rect x="${f2(fade.x)}" y="${f2(fade.y)}" width="${f2(fade.width)}" height="${f2(fade.height)}" rx="${f2(fade.radius === undefined ? u : fade.radius)}" fill="#000" opacity="${f2(1 - strength)}" filter="url(#${key}-b${n})"/>`
        );
    });
    const mask = holes.length ? `<defs>${blurs.join('')}<mask id="${key}-m" maskUnits="userSpaceOnUse" x="0" y="0" width="${width}" height="${height}"><rect width="${width}" height="${height}" fill="#fff"/>${holes.join('')}</mask></defs>` : '';
    const alpha = a < 1 ? ` stroke-opacity="${f2(a)}"` : '';
    const rule = mx === null ? '' : `<path d="M${f2(snap(mx))} 0V${height}" stroke="${colors.rule}" stroke-width="${f2(w)}"${alpha} fill="none"/>`;
    return (
        `<svg class="paper-grid" xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" aria-hidden="true">` +
        mask +
        (background ? `<rect width="${width}" height="${height}" fill="${colors.paper}"/>` : '') +
        `<g${holes.length ? ` mask="url(#${key}-m)"` : ''} fill="none" stroke-width="${f2(w)}"${alpha}>` +
        `<path d="${minor.join('')}" stroke="${colors.minor}"/>` +
        `<path d="${major.join('')}" stroke="${colors.major}"/>` +
        '</g>' +
        rule +
        '</svg>'
    );
}
