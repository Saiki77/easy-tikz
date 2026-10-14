// The drawn pointer. A capture never contains the real mouse pointer, so
// images and videos draw one where the pointer was: an arrow, crisp at any
// size, a little larger than life, optionally with a keycap badge ("Shift")
// and a ring (a click, or a held drag). Pure strings, no DOM.
//
//   overlay.insertAdjacentHTML('beforeend', pointer({ x: 640, y: 380, scale: 1.4, keycap: 'Shift' }));
//
// The keycap is text of the image like any other: its label is at least as
// large as the smallest size the brand allows (see keycapSize), and
// page.mjs checks it.

const f2 = (v) => (Math.round(v * 100) / 100).toString();

/** The arrow in a 16 x 24 box, hot spot at (0, 0). */
export const ARROW = 'M0 0V17.6L4.25 13.7L7.15 20.5L9.95 19.3L7.1 12.6H12.7Z';

/**
 * Size of the keycap for a label, in px: { width, height, font }. A template needs it to find free ground
 * for the badge. The label is set in capitals and small capitals (write 'Shift', not 'shift'); its size is
 * 16.5 px per unit of `scale`, so at the page pointer's 1.3 it is 21.5 design px: above the smallest size
 * the brand allows (19.2), and still a word when the image is shown 800 px wide.
 */
export function keycapSize(label, scale = 1.5) {
    const font = 16.5 * scale;
    let em = 0;
    for (const ch of String(label)) {
        if (ch === ' ') em += 0.33;
        else if (/[IJ]/.test(ch)) em += 0.4;
        else if (/[A-Z]/.test(ch)) em += 0.7;
        else if (/[ijl]/.test(ch)) em += 0.32;
        else if (/[a-z]/.test(ch)) em += 0.57;
        else em += 0.5;
        em += SPACING;
    }
    return { width: em * font + 18 * scale, height: 27 * scale, font };
}
const SPACING = 0.06; // letter-spacing of the keycap label, em

/**
 * SVG markup of the pointer, for an overlay <svg> in page px.
 *   x, y          where the hot spot is
 *   scale         1 = a 16 x 24 px arrow (default 1.5)
 *   keycap        a label such as 'Shift': a keycap badge beside the arrow, as large as keycapSize() says
 *   keycapSide    'right' (default): to the lower right of the arrow; 'left': to the left of the hot spot
 *   keycapOffset  [dx, dy] px added to that place: move the badge to free ground, off lines and labels
 *   ring          0..1: progress of a click ring that expands and fades (null: none)
 *   ringAt        [x, y] where the click happened, when the hand has moved on since (default: the hot spot)
 *   held          true: a steady ring around the hot spot (a drag in progress)
 *   accent        colour of the rings (default the brand's plot blue)
 *   font          font-family of the keycap label
 *   opacity       0..1 for the whole pointer
 */
export function pointer({ x, y, scale = 1.5, keycap = '', keycapSide = 'right', keycapOffset = [0, 0], ring = null, ringAt = null, held = false, accent = '#1F6FD1', ink = '#14171C', paper = '#FBFCFD', font = '"LM Roman Caps", "NewCM", serif', opacity = 1 } = {}) {
    const parts = [];
    if (ring !== null && ring >= 0 && ring <= 1) {
        const r = (6 + 22 * ring) * scale;
        const [cx, cy] = ringAt || [x, y];
        parts.push(`<circle class="pointer-ring" cx="${f2(cx)}" cy="${f2(cy)}" r="${f2(r)}" fill="none" stroke="${accent}" stroke-width="${f2(2 * scale * (1 - ring * 0.5))}" opacity="${f2(1 - ring)}"/>`);
    }
    if (held) {
        parts.push(`<circle class="pointer-held" cx="${f2(x)}" cy="${f2(y)}" r="${f2(13 * scale)}" fill="${accent}" fill-opacity="0.10" stroke="${accent}" stroke-width="${f2(1.5 * scale)}"/>`);
    }
    // White edge first, then the ink arrow: the pointer reads on light and on dark ground.
    parts.push(
        `<g class="pointer-arrow" transform="translate(${f2(x)} ${f2(y)}) scale(${f2(scale)})">` +
            `<path d="${ARROW}" fill="${ink}" fill-opacity="0.18" transform="translate(0.7 1.5)"/>` +
            `<path d="${ARROW}" fill="${ink}" stroke="#fff" stroke-width="1.5" stroke-linejoin="round" paint-order="stroke"/>` +
            '</g>'
    );
    if (keycap) {
        const { width: w, height: h, font: size } = keycapSize(keycap, scale);
        const kx = (keycapSide === 'left' ? x - w - 6 * scale : x + 15 * scale) + keycapOffset[0];
        const ky = y + (keycapSide === 'left' ? -h / 2 : 19 * scale) + keycapOffset[1];
        const r = 5 * scale;
        // The key: a darker foot under a paper-coloured top, as a keycap is drawn. Text sits on the optical
        // middle of capitals and small capitals.
        parts.push(
            `<g class="pointer-keycap">` +
                `<rect x="${f2(kx)}" y="${f2(ky + 2 * scale)}" width="${f2(w)}" height="${f2(h)}" rx="${f2(r)}" fill="${ink}" fill-opacity="0.85"/>` +
                `<rect x="${f2(kx)}" y="${f2(ky)}" width="${f2(w)}" height="${f2(h)}" rx="${f2(r)}" fill="${paper}" stroke="${ink}" stroke-width="${f2(1 * scale)}"/>` +
                `<text x="${f2(kx + w / 2 + (SPACING * size) / 2)}" y="${f2(ky + h / 2 + size * 0.3)}" text-anchor="middle" font-family='${font}' font-size="${f2(size)}" letter-spacing="${f2(SPACING * size)}" fill="${ink}">${keycap}</text>` +
                '</g>'
        );
    }
    return `<g class="pointer"${opacity < 1 ? ` opacity="${f2(opacity)}"` : ''}>${parts.join('')}</g>`;
}
