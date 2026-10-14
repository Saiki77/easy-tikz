// Callouts for the brand: a thin, gently curved ink arrow with a stealth
// tip, as TikZ would draw `\draw[-{Stealth}] (note) to[bend left] (spot);`.
// Pure geometry and strings, no DOM: runs in the templates and in Node.
//
//   const a = callout({ from: [1280, 300], to: [1010, 420], out: 180, in: 20 });
//   svg.insertAdjacentHTML('beforeend', a.svg);
//
// The house style: an arrow leaves its note horizontally at the note's left
// (or right) end, `out: 180` (or 0), and arrives with a slight curve.
//
// All coordinates are px of the page (y down). Angles are degrees as in
// TikZ: 0 points right, 90 up, 180 left, 270 down.

/**
 * The cubic Bezier [p0, p1, p2, p3] of a callout.
 *   from, to     [x, y]
 *   bend         sag as a fraction of the distance, default 0.16. Positive bends to the left of the
 *                direction of travel as seen on screen (a path going left bulges downwards), negative to the right
 *   out, in      instead of `bend`: the direction in which the path leaves `from`, and the side of `to`
 *                it arrives from (TikZ: to[out=.., in=..]). One of them may be left out
 *   looseness    how far the control points reach (default 1), with out / in. A pair [out, in] sets the
 *                two ends apart: a longer first handle spreads the bend of an arrow that leaves sideways
 *                and then has a long way down, so it does not turn all at once like the crook of a cane
 */
export function curve({ from, to, bend = 0.16, out = null, in: inAngle = null, looseness = 1 }) {
    const [x0, y0] = from;
    const [x3, y3] = to;
    const dx = x3 - x0;
    const dy = y3 - y0;
    const dist = Math.hypot(dx, dy) || 1;
    if (out === null && inAngle === null) {
        // A circular-looking arc: both control points pushed sideways by the same amount.
        const nx = dy / dist; // left of travel on screen (y down)
        const ny = -dx / dist;
        const sag = (bend * dist * 4) / 3;
        return [
            [x0, y0],
            [x0 + dx / 3 + nx * sag, y0 + dy / 3 + ny * sag],
            [x0 + (2 * dx) / 3 + nx * sag, y0 + (2 * dy) / 3 + ny * sag],
            [x3, y3],
        ];
    }
    const [looseOut, looseIn] = Array.isArray(looseness) ? looseness : [looseness, looseness];
    const reach = dist * 0.3915;
    const dir = (deg) => [Math.cos((deg * Math.PI) / 180), -Math.sin((deg * Math.PI) / 180)];
    const chord = (Math.atan2(-dy, dx) * 180) / Math.PI;
    const o = dir(out === null ? chord : out);
    const i = dir(inAngle === null ? chord + 180 : inAngle);
    return [
        [x0, y0],
        [x0 + o[0] * reach * looseOut, y0 + o[1] * reach * looseOut],
        [x3 + i[0] * reach * looseIn, y3 + i[1] * reach * looseIn],
        [x3, y3],
    ];
}

const lerp = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];

/** Point of the cubic at t. */
export function pointAt(c, t) {
    const a = lerp(c[0], c[1], t);
    const b = lerp(c[1], c[2], t);
    const d = lerp(c[2], c[3], t);
    return lerp(lerp(a, b, t), lerp(b, d, t), t);
}

/** Unit tangent of the cubic at t (direction of travel). */
export function tangentAt(c, t) {
    const e = 1e-4;
    const p = pointAt(c, Math.max(0, t - e));
    const q = pointAt(c, Math.min(1, t + e));
    const len = Math.hypot(q[0] - p[0], q[1] - p[1]) || 1;
    return [(q[0] - p[0]) / len, (q[1] - p[1]) / len];
}

/** The part of the cubic between t0 and t1, as a cubic. */
export function part(c, t0, t1) {
    const splitLeft = (k, t) => {
        const a = lerp(k[0], k[1], t);
        const b = lerp(k[1], k[2], t);
        const d = lerp(k[2], k[3], t);
        const ab = lerp(a, b, t);
        const bd = lerp(b, d, t);
        return [k[0], a, ab, lerp(ab, bd, t)];
    };
    const splitRight = (k, t) => {
        const a = lerp(k[0], k[1], t);
        const b = lerp(k[1], k[2], t);
        const d = lerp(k[2], k[3], t);
        const ab = lerp(a, b, t);
        const bd = lerp(b, d, t);
        return [lerp(ab, bd, t), bd, d, k[3]];
    };
    const right = t0 > 0 ? splitRight(c, t0) : c;
    return t1 < 1 ? splitLeft(right, (t1 - t0) / (1 - t0 || 1)) : right;
}

const STEPS = 96;
/** Cumulative lengths at STEPS + 1 samples. */
function lengths(c) {
    const acc = [0];
    let prev = c[0];
    for (let n = 1; n <= STEPS; n++) {
        const p = pointAt(c, n / STEPS);
        acc.push(acc[n - 1] + Math.hypot(p[0] - prev[0], p[1] - prev[1]));
        prev = p;
    }
    return acc;
}
/** Length of the cubic in px. */
export function lengthOf(c) {
    return lengths(c)[STEPS];
}
/** The parameter t at which the cubic has run `s` px. */
export function tAtLength(c, s) {
    const acc = lengths(c);
    if (s <= 0) return 0;
    if (s >= acc[STEPS]) return 1;
    let n = 1;
    while (acc[n] < s) n++;
    const f = (s - acc[n - 1]) / (acc[n] - acc[n - 1] || 1);
    return (n - 1 + f) / STEPS;
}

const f2 = (v) => (Math.round(v * 100) / 100).toString();
const pathOf = (c) => `M${f2(c[0][0])} ${f2(c[0][1])}C${f2(c[1][0])} ${f2(c[1][1])} ${f2(c[2][0])} ${f2(c[2][1])} ${f2(c[3][0])} ${f2(c[3][1])}`;

/**
 * The stealth tip as a path, pointing along `dir` with its point at `at`.
 *   length, width, inset   px; inset is how far the back is drawn in (TikZ Stealth: about 0.3 of the length)
 */
export function stealth(at, dir, { length, width, inset }) {
    const [ux, uy] = dir;
    const [nx, ny] = [-uy, ux];
    const p = (along, across) => `${f2(at[0] - ux * along + nx * across)} ${f2(at[1] - uy * along + ny * across)}`;
    return `M${p(0, 0)}L${p(length, width / 2)}L${p(length - inset, 0)}L${p(length, -width / 2)}Z`;
}

let serial = 0;

/**
 * One callout arrow.
 *   from, to, bend, out, in, looseness   see curve()
 *   width       stroke in px (default 1.75: the weight for a 1600 px page; scale it with the page)
 *   color       ink (default the brand's #14171C)
 *   tip         { length, width, inset } in px; default grows with the stroke
 *   gap         px kept free before `to`, so the tip does not touch what it points at (default 0)
 *   startGap    px left out at the start, next to the note (default 0)
 *   casing      px of under-stroke on each side of the line and around the tip, in the colour of the
 *               surface: where the arrow crosses the lines of a chart it then reads as lying on top of
 *               them, as a road on a map (default 0: none; 2 px on a 1600 px page is the brand's value)
 *   casingColor default white, the ground of a chart
 *   casingClip  { x, y, width, height, radius }: draw the casing only inside this rectangle (the figure),
 *               so that it does not wipe the grid of the paper beside it
 *   halo, haloColor   the same under-stroke everywhere, in the paper colour #FBFCFD (for an arrow over
 *               busy ground in a video); `casing` wins when both are given
 *   progress    0..1: how much of the arrow is drawn (for a draw-on animation; the tip rides at the front)
 *   opacity     0..1
 *   cls         extra class on the <g>
 * Returns { svg, d, tip: { x, y, angle }, length, bezier }.
 */
export function callout(options) {
    const { width = 1.75, color = '#14171C', gap = 0, startGap = 0, halo = 0, haloColor = '#FBFCFD', casing = 0, casingColor = '#FFFFFF', casingClip = null, progress = 1, opacity = 1, cls = '' } = options;
    const tip = { length: width * 7.4, width: width * 5, inset: width * 2.3, ...(options.tip || {}) };
    const full = curve(options);
    const total = lengthOf(full);
    const shown = Math.max(0, Math.min(1, progress));
    // The visible part ends `gap` before the target; while drawing on, it ends where the pen is.
    const endS = startGap + (total - gap - startGap) * shown;
    const t0 = tAtLength(full, startGap);
    const tEnd = tAtLength(full, endS);
    const at = pointAt(full, tEnd);
    const dir = tangentAt(full, tEnd);
    // The line stops inside the tip, so its square end never shows beside the point.
    const grow = Math.min(1, shown / 0.18); // the tip grows in at the start of a draw-on
    const back = Math.max(0, tip.length - tip.inset) * grow * 0.92;
    const tLine = tAtLength(full, Math.max(startGap, endS - back));
    const bezier = part(full, t0, Math.max(t0, tLine));
    const d = pathOf(bezier);
    const tipPath = stealth(at, dir, { length: tip.length * grow, width: tip.width * grow, inset: tip.inset * grow });
    const parts = [];
    if (shown > 0) {
        const under = casing > 0 ? casing : halo;
        if (under > 0) {
            const fill = casing > 0 ? casingColor : haloColor;
            let clip = '';
            if (casing > 0 && casingClip) {
                const id = `callout-clip-${++serial}`;
                const r = casingClip.radius || 0;
                parts.push(`<clipPath id="${id}"><rect x="${f2(casingClip.x)}" y="${f2(casingClip.y)}" width="${f2(casingClip.width)}" height="${f2(casingClip.height)}" rx="${f2(r)}"/></clipPath>`);
                clip = ` clip-path="url(#${id})"`;
            }
            parts.push(
                `<g class="callout-casing"${clip}>` +
                    `<path d="${d}" fill="none" stroke="${fill}" stroke-width="${f2(width + under * 2)}" stroke-linecap="butt"/>` +
                    `<path d="${tipPath}" fill="${fill}" stroke="${fill}" stroke-width="${f2(under * 2)}" stroke-linejoin="round"/>` +
                    '</g>'
            );
        }
        parts.push(`<path class="callout-line" d="${d}" fill="none" stroke="${color}" stroke-width="${f2(width)}" stroke-linecap="round"/>`);
        parts.push(`<path class="callout-tip" d="${tipPath}" fill="${color}"/>`);
    }
    const svg = `<g class="callout${cls ? ` ${cls}` : ''}"${opacity < 1 ? ` opacity="${f2(opacity)}"` : ''}>${parts.join('')}</g>`;
    return { svg, d, tip: { x: at[0], y: at[1], angle: (Math.atan2(-dir[1], dir[0]) * 180) / Math.PI }, length: total, bezier: full };
}

/**
 * A detail link in the manner of TikZ's spy library: it ties a small part of a figure to its enlarged
 * copy. The copy is a figure of its own (.fig.detail has the hairline); this draws what joins the two.
 *   on, to      { x, y, width, height } of the part and of the enlarged copy, page px
 *   link        'line' (default): one straight line between the facing edges. It is exactly horizontal
 *               (or vertical) whenever the two boxes overlap on the other axis, and then runs through
 *               the middle of the part.
 *               'zoom': two projection lines between the facing corners, as a magnifier is drawn
 *   frame       true: a hairline frame around the part, `pad` px off it. Leave it out (default) when the
 *               part has an edge of its own, such as a hover tip: two outlines side by side read as a mistake
 *   pad         px the frame stands off (default 6)
 *   inset       px the ends of the zoom lines keep from the corners (default: the corner radius)
 *   width       stroke px (default 1.25), color (default the secondary ink #4A5261)
 *   radius      corner radius of the part (and of its frame); toRadius: of the copy
 * Returns { svg, from, to } with the end points of the (first) line.
 */
export function spy({ on, to, link = 'line', frame = false, width = 1.25, color = '#4A5261', radius = 4, pad = 6, toRadius = null, inset = null }) {
    const a = frame ? { x: on.x - pad, y: on.y - pad, width: on.width + pad * 2, height: on.height + pad * 2 } : { ...on };
    const b = to;
    const rb = toRadius === null ? radius : toRadius;
    const ra = frame ? radius + pad : radius;
    const lines = [];
    // Which edges face each other.
    const horizontal = b.x + b.width <= a.x || a.x + a.width <= b.x;
    const copyFirst = horizontal ? b.x + b.width <= a.x : b.y + b.height <= a.y;
    if (link === 'zoom') {
        const ia = inset === null ? ra : inset;
        const ib = inset === null ? rb : inset;
        if (horizontal) {
            const xa = copyFirst ? a.x : a.x + a.width;
            const xb = copyFirst ? b.x + b.width : b.x;
            lines.push([[xb, b.y + ib], [xa, a.y + ia]], [[xb, b.y + b.height - ib], [xa, a.y + a.height - ia]]);
        } else {
            const ya = copyFirst ? a.y : a.y + a.height;
            const yb = copyFirst ? b.y + b.height : b.y;
            lines.push([[b.x + ib, yb], [a.x + ia, ya]], [[b.x + b.width - ib, yb], [a.x + a.width - ia, ya]]);
        }
    } else if (horizontal) {
        const xa = copyFirst ? a.x : a.x + a.width;
        const xb = copyFirst ? b.x + b.width : b.x;
        // Through the middle of the part when the copy reaches that height, else between the two middles.
        const ya = a.y + a.height / 2;
        const inside = ya >= b.y + rb && ya <= b.y + b.height - rb;
        lines.push([[xb, inside ? ya : b.y + b.height / 2], [xa, ya]]);
    } else {
        const ya = copyFirst ? a.y : a.y + a.height;
        const yb = copyFirst ? b.y + b.height : b.y;
        const xa = a.x + a.width / 2;
        const inside = xa >= b.x + rb && xa <= b.x + b.width - rb;
        lines.push([[inside ? xa : b.x + b.width / 2, yb], [xa, ya]]);
    }
    const rect = frame ? `<rect x="${f2(a.x)}" y="${f2(a.y)}" width="${f2(a.width)}" height="${f2(a.height)}" rx="${f2(ra)}" fill="none" stroke="${color}" stroke-width="${f2(width)}"/>` : '';
    const paths = lines.map(([p, q]) => `<path d="M${f2(p[0])} ${f2(p[1])}L${f2(q[0])} ${f2(q[1])}" fill="none" stroke="${color}" stroke-width="${f2(width)}" stroke-linecap="butt"/>`).join('');
    return { svg: `<g class="spy">${rect}${paths}</g>`, from: lines[0][0], to: lines[0][1] };
}
