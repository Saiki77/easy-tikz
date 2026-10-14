/* eslint-env browser */
// Glue for a brand page (a template that is rendered to an image). It runs
// in the page, as a module:
//
//   <body class="page" data-width="1600" data-height="1000">
//     ...
//     <script src="shots/meta.js"></script>
//     <script type="module">
//       import { ready } from '../page.mjs';
//       await ready({ meta: window.BRAND_SHOTS, shots: 'shots/' }, ({ fig, anchor, arrow }) => {
//           arrow({ from: anchor('#note-1', 'left'), to: fig('#editor').point('optimum'), bend: 0.12, gap: 8 });
//       });
//     </script>
//   </body>
//
// ready() sizes the page, waits for the TeX fonts, typesets [data-math],
// fills [data-value], puts text on the grid ([data-baseline]), crops the
// captures into every .shot, calls your function (callouts, the spy link,
// the pointer), mounts the paper and then sets window.brandReady.
// render.mjs waits for that flag.
//
// Text is placed by its baseline, in grid units from the top of the page:
//   <h1 class="title abs" data-baseline="7">Easy TikZ 4</h1>      first baseline on the 7th grid line
//   <p class="caption abs" data-captop="9">...</p>               top of its capitals on the 9th: level
//                                                                with the top edge of a figure there
// Give the block a line-height in grid units (1.5 * var(--u)) and every
// line of it stands on the paper's lines.
//
// A .shot is a crop of a capture:
//   <figure class="fig abs" id="editor" style="left: ...; top: ...; width: ...">
//     <div class="shot" data-shot="lp-editor" data-rect="editor" data-pad="-1"></div>
//   </figure>
//   data-shot     name of a capture in the metadata
//   data-rect     a rectangle recorded with it ('editor', 'stage', ...), 'window',
//                 or 'x,y,width,height' in CSS px of the captured window
//   data-pad      px of the captured window added around it: 'all', 'x,y' or 'left,top,right,bottom' (negative cuts in)
//   data-radius   'modal' (the captured editor) or a name in the capture's `radii`: the figure takes that
//                 element's corner radius, scaled with the crop
//   data-native   the crop is shown pixel for pixel (100 % of the capture): the figure takes the width
//                 of the crop. For an enlarged detail: nothing is resampled, so it is as sharp as the app
//   data-rows     the figure is exactly this many grid units high: the crop is made taller or lower
//                 about its middle (data-rows-anchor="top" | "bottom": from that edge) to fit. With a
//                 left, top and width in whole units all four edges of the figure then lie on grid lines
// Without data-native the figure keeps its CSS width; without data-rows its height follows the crop.
//
// Edges and the grid: an edge of a figure (or a rule) that runs a few px beside a grid line reads as
// a doubled line. ready() reports every edge of a .fig, every .rule, the rule of the running head and
// every [data-edge] box that is neither on a grid line nor at least 0.4 unit away from the next one.
import { callout, spy } from './callout.mjs';
import { equation, math, typesetAll } from './math.mjs';
import { paperSVG } from './paper.mjs';
import { pointer } from './pointer.mjs';

const FAMILIES = [
    ['400', 'normal', 'NewCM'],
    ['400', 'italic', 'NewCM'],
    ['700', 'normal', 'NewCM'],
    ['700', 'italic', 'NewCM'],
    ['400', 'normal', 'NewCM Book'],
    ['400', 'italic', 'NewCM Book'],
    ['400', 'normal', 'NewCM Math'],
    ['400', 'normal', 'NewCM Mono'],
    ['400', 'normal', 'LM Roman 17'],
    ['400', 'normal', 'LM Roman Caps'],
    ['400', 'normal', 'LM Roman Demi'],
];

const problems = [];
const report = (text) => {
    problems.push(text);
    console.error(`brand: ${text}`);
};
window.brandProblems = () => problems.slice();
window.brandReady = false;

function numbers(text, count) {
    const parts = String(text).split(',').map((s) => Number(s.trim()));
    return parts.length === count && parts.every(Number.isFinite) ? parts : null;
}

/** Size the page from <body data-width data-height data-zoom> (or ?w=&h=&zoom=) and set the scale variables. */
function sizePage() {
    const params = new URLSearchParams(window.location.search);
    const body = document.body;
    const W = Number(params.get('w')) || Number(body.dataset.width) || 1600;
    const H = Number(params.get('h')) || Number(body.dataset.height) || 1000;
    // data-zoom (or ?zoom=) enlarges everything the kit sizes: for images that are seen small, such as a social preview.
    const zoom = Number(params.get('zoom')) || Number(body.dataset.zoom) || 1;
    const root = document.documentElement;
    root.style.setProperty('--W', String(W));
    root.style.setProperty('--H', String(H));
    root.style.setProperty('--zoom', String(zoom));
    // The grid unit is a whole number of px, so every grid line falls on a pixel.
    const unit = Number(body.dataset.unit) || Math.max(4, Math.round((24 * W * zoom) / 1600));
    root.style.setProperty('--u', `${unit}px`);
    // The right margin ends on a grid line: the last one that leaves 2.5 units (line 64 of a page 66.67
    // units wide). <body data-right="3"> sets another margin, in units.
    const right = body.dataset.right ? Number(body.dataset.right) * unit : W - Math.floor(W / unit - 2.5) * unit;
    root.style.setProperty('--right', `${right}px`);
    return { W, H, unit, zoom, right, k: (W / 1600) * zoom };
}

async function loadFonts() {
    const sample = 'Easy TikZ 4 abg 0123 \u{1d44e}\u{1d454} ≤ −';
    await Promise.all(FAMILIES.map(([weight, style, family]) => document.fonts.load(`${style} ${weight} 24px "${family}"`, sample).catch(() => null)));
    await document.fonts.ready;
    for (const [weight, style, family] of FAMILIES) {
        if (!document.fonts.check(`${style} ${weight} 24px "${family}"`, sample)) report(`font not loaded: ${family} ${weight} ${style} (run the brand build once: it writes fonts.css)`);
    }
}

/** Resolve "turn.after.c" in the metadata. */
function lookup(meta, key) {
    return key.split('.').reduce((o, part) => (o === null || o === undefined ? o : o[part]), meta);
}

/** Where the first baseline of an element's text is, and how tall its capitals are (page px). */
function firstBaseline(el) {
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    let node = walker.nextNode();
    while (node && !node.nodeValue.trim()) node = walker.nextNode();
    if (!node) return null;
    // An empty inline-block stands with its bottom edge on the baseline of its line.
    const probe = document.createElement('span');
    probe.style.cssText = 'display:inline-block;width:0;height:0;margin:0;padding:0;border:0;vertical-align:baseline';
    node.parentNode.insertBefore(probe, node);
    const y = probe.getBoundingClientRect().bottom;
    probe.remove();
    const cs = getComputedStyle(node.parentNode);
    const ctx = document.createElement('canvas').getContext('2d');
    ctx.font = `${cs.fontStyle} ${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
    return { y, cap: ctx.measureText('H').actualBoundingBoxAscent };
}

/** Put every [data-baseline] and [data-captop] element on its grid line (units from the top of the page). */
function placeOnGrid(unit) {
    const origin = document.body.getBoundingClientRect();
    for (const el of document.querySelectorAll('[data-baseline], [data-captop]')) {
        const byCap = el.hasAttribute('data-captop');
        const target = Number(byCap ? el.dataset.captop : el.dataset.baseline) * unit;
        const line = Number.isFinite(target) ? firstBaseline(el) : null;
        if (!line) {
            report(`cannot place "${(el.textContent || '').trim().slice(0, 30)}" on the grid: it needs a number of grid units and some text`);
            continue;
        }
        if (getComputedStyle(el).position !== 'absolute') {
            report(`data-baseline needs an absolutely placed block (.abs): "${(el.textContent || '').trim().slice(0, 30)}"`);
            continue;
        }
        const top = el.getBoundingClientRect().top - origin.top;
        const now = line.y - origin.top - (byCap ? line.cap : 0);
        el.style.top = `${Math.round((top + target - now) * 100) / 100}px`;
    }
}

/** Crop the captures into the .shot elements. Returns the registry used by fig() and by render.mjs. */
function placeShots(meta, base, unit) {
    const dpr = window.devicePixelRatio || 1;
    const placed = [];
    document.querySelectorAll('.shot[data-shot]').forEach((el, index) => {
        const name = el.dataset.shot;
        const shot = meta && meta.shots ? meta.shots[name] : null;
        if (!shot) return report(`no capture "${name}" in the metadata`);
        let r = null;
        const spec = el.dataset.rect || 'window';
        if (spec === 'window') r = { x: 0, y: 0, width: shot.width, height: shot.height };
        else if (shot.rects && shot.rects[spec]) r = { ...shot.rects[spec] };
        else {
            const n = numbers(spec, 4);
            if (n) r = { x: n[0], y: n[1], width: n[2], height: n[3] };
        }
        if (!r) return report(`capture "${name}" has no rectangle "${spec}"`);
        if (el.dataset.pad) {
            const one = numbers(el.dataset.pad, 1);
            const two = numbers(el.dataset.pad, 2);
            const four = numbers(el.dataset.pad, 4);
            const [l, t, rr, b] = four || (two ? [two[0], two[1], two[0], two[1]] : one ? [one[0], one[0], one[0], one[0]] : [0, 0, 0, 0]);
            r = { x: r.x - l, y: r.y - t, width: r.width + l + rr, height: r.height + t + b };
        }
        // Whole pixels of the capture, and a box of whole device pixels: render.mjs can then hand in
        // a crop that was resampled once, with a good filter, to exactly the pixels it covers.
        const src = (meta.view && meta.view.scale) || 2;
        const host = el.closest('.fig') || el;
        const rows = el.dataset.rows ? Number(el.dataset.rows) : 0;
        if (rows > 0 && !el.hasAttribute('data-native')) {
            // A figure of exactly `rows` grid units: the crop takes the height that fills it.
            const want = (rows * unit * r.width) / host.getBoundingClientRect().width;
            const anchor = el.dataset.rowsAnchor || 'middle';
            const y = anchor === 'top' ? r.y : anchor === 'bottom' ? r.y + r.height - want : r.y + (r.height - want) / 2;
            r = { x: r.x, y, width: r.width, height: want };
            if (r.y < 0 || r.y + r.height > shot.height) report(`capture "${name}" (${spec}): ${rows} rows need a crop from y = ${r.y.toFixed(1)} to ${(r.y + r.height).toFixed(1)}, outside the capture`);
        }
        const crop = { x: Math.round(r.x * src), y: Math.round(r.y * src), width: Math.round(r.width * src), height: Math.round(r.height * src) };
        r = { x: crop.x / src, y: crop.y / src, width: crop.width / src, height: crop.height / src };
        const widthPx = el.hasAttribute('data-native') ? crop.width / dpr : Math.round(host.getBoundingClientRect().width * dpr) / dpr;
        const s = widthPx / r.width; // page px per px of the captured window
        const heightPx = rows > 0 && !el.hasAttribute('data-native') ? rows * unit : Math.round(r.height * s * dpr) / dpr;
        host.style.width = `${widthPx}px`;
        el.style.height = `${heightPx}px`;
        // The figure takes the corner radius of the captured element ('modal': the editor), scaled.
        const radii = { modal: shot.radius, ...(shot.radii || {}) };
        if (el.dataset.radius && radii[el.dataset.radius]) host.style.setProperty('--fig-radius', `${Math.max(0, radii[el.dataset.radius] * s - 0.5)}px`);
        else if (el.dataset.radius) report(`capture "${name}" records no corner radius "${el.dataset.radius}"`);
        const img = document.createElement('img');
        img.alt = '';
        img.src = base + shot.file;
        img.style.left = `${-r.x * s}px`;
        img.style.top = `${-r.y * s}px`;
        img.style.width = `${shot.width * s}px`;
        el.replaceChildren(img);
        const id = el.id || `shot-${index}`;
        el.dataset.shotId = id;
        const box = { width: Math.round(widthPx * dpr), height: Math.round(heightPx * dpr) };
        if (box.width > crop.width + 1) report(`capture "${name}" (${spec}) is enlarged: ${crop.width} px of the capture are shown on ${box.width} px. Crop less or make the figure smaller.`);
        placed.push({ id, name, file: shot.file, crop, box, scale: s, rect: r, el, host, shot });
    });
    return placed;
}

/**
 * Edges and the grid. An edge of a figure, or a rule, that runs a few px beside a grid line reads as a
 * doubled line. So an edge is either ON a grid line (the line then lies under the figure or under its
 * hairline) or at least 0.4 unit away from the next line outside it. Checked for every .fig, every
 * [data-edge] box, every .rule, the rule of the running head and the short rule of .footrule.
 */
function checkEdges(page, origin, pageRect) {
    const u = page.unit;
    const least = 0.4 * u;
    const hair = Math.max(1, page.k); // the hairline around a figure, outside its box
    const say = (el, what, d, line) => {
        const name = el.id ? `#${el.id}` : `.${String(el.className).trim().split(/\s+/).join('.')}`;
        report(`${name}: its ${what} runs ${d.toFixed(1)} px beside grid line ${line} (${(d / u).toFixed(2)} unit). Put it on the line or at least 0.4 unit (${least.toFixed(1)} px) away`);
    };
    // The nearest line outside an edge at `at`: before it (dir -1) or after it (dir 1). Returns [distance, line number].
    const outside = (at, o, dir) => {
        // A line covers the pixel from g to g + 1. Before the box it is hidden when it lies under the box or
        // its hairline (g >= at - hair); after the box when it lies under the hairline (g + 1 <= at + hair).
        const n = dir < 0 ? Math.floor((at + 0.5 - o) / u) : Math.ceil((at - 0.5 - o) / u);
        const g = o + n * u;
        const hidden = dir < 0 ? g >= at - hair - 0.5 : g + 1 <= at + hair + 0.5;
        return [hidden ? 0 : dir < 0 ? at - g : g - at, Math.round(g / u)];
    };
    for (const el of document.querySelectorAll('.fig, [data-edge]')) {
        const b = pageRect(el);
        if (!b.width || !b.height) continue;
        const sides = [
            ['left edge', outside(b.x, origin[0], -1), 'x'],
            ['right edge', outside(b.x + b.width, origin[0], 1), 'x'],
            ['top edge', outside(b.y, origin[1], -1), 'y'],
            ['bottom edge', outside(b.y + b.height, origin[1], 1), 'y'],
        ];
        for (const [what, [d, n], axis] of sides) {
            if (d > 0 && d < least - 0.01) say(el, what, d, `${axis} = ${n}`);
        }
    }
    const rules = [];
    for (const el of document.querySelectorAll('.running-head')) {
        const b = pageRect(el);
        rules.push([el, b.y + b.height - (parseFloat(getComputedStyle(el).borderBottomWidth) || 0)]);
    }
    for (const el of document.querySelectorAll('body > .rule, body > .footrule')) rules.push([el, pageRect(el).y]);
    for (const [el, y] of rules) {
        const g = origin[1] + Math.round((y - origin[1]) / u) * u;
        const d = Math.abs(y - g);
        if (d > 0.5 && d < least - 0.01) say(el, 'rule', d, `y = ${Math.round(g / u)}`);
    }
}

/**
 * Prepare the page. `setup(tools)` runs once the layout is final:
 *   tools.fig(selector)      a placed figure: { point(nameOrXY), rect(nameOrRect), box, scale }
 *                            in page px; names are the points and rectangles recorded with the capture
 *   tools.anchor(el, side, { dx, dy, line })   a point on the edge of a text block ('left', 'right',
 *                            'top', 'bottom', or corners 'top-left' ...); `line`: 'first' | 'last' picks one line of the text
 *   tools.arrow(options)     a callout arrow (callout.mjs); `width` defaults to 1.75 design px.
 *                            `over: '#figure'` cases the arrow in white inside that figure: use it when the
 *                            arrow crosses lines of the chart
 *   tools.spy(options)       a detail link (callout.mjs spy); 1.25 design px
 *   tools.pointer(options)   the drawn pointer (pointer.mjs), 1.3 times life size; `keycapOffset: [dx, dy]`
 *                            moves its keycap to free ground
 *   tools.baseline(el)       y of the first baseline of a text block, page px
 *   tools.draw(svgMarkup)    anything else, into the overlay
 *   tools.k, tools.unit, tools.W, tools.H, tools.right (the right margin in px), tools.zoom, tools.meta
 * Options:
 *   meta      the capture metadata ({ shots: { name: { file, width, height, rects, points } } })
 *   shots     URL prefix of the capture files (default 'shots/')
 *   paper     false for no grid, or options for paperSVG() (margin, origin, ...)
 */
export async function ready({ meta = null, shots = 'shots/', paper = {} } = {}, setup = null) {
    try {
        const page = sizePage();
        const body = document.body;
        await loadFonts();
        typesetAll(body);
        for (const el of body.querySelectorAll('[data-value]')) {
            const v = lookup(meta || {}, el.dataset.value);
            if (v === undefined || v === null) report(`no value "${el.dataset.value}" in the metadata`);
            else el.textContent = String(v);
        }
        placeOnGrid(page.unit);
        const placed = placeShots(meta, shots, page.unit);
        await Promise.all(Array.from(document.images).map((img) => (img.complete && img.naturalWidth ? null : img.decode().catch(() => report(`image did not load: ${img.getAttribute('src')}`)))));

        const overlay = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        overlay.setAttribute('class', 'overlay');
        overlay.setAttribute('width', String(page.W));
        overlay.setAttribute('height', String(page.H));
        overlay.setAttribute('viewBox', `0 0 ${page.W} ${page.H}`);
        body.appendChild(overlay);
        const origin = body.getBoundingClientRect();
        const pageRect = (el) => {
            const b = el.getBoundingClientRect();
            return { x: b.left - origin.left, y: b.top - origin.top, width: b.width, height: b.height };
        };
        const find = (target) => (typeof target === 'string' ? document.querySelector(target) : target);
        let arrows = 0;

        const tools = {
            ...page,
            meta,
            math,
            equation,
            fig(selector) {
                const el = find(selector);
                const entry = placed.find((p) => p.host === el || p.el === el || (el && el.contains(p.el)));
                if (!entry) {
                    report(`fig: no placed capture in ${selector}`);
                    return null;
                }
                const box = pageRect(entry.el);
                const toPage = (x, y) => [box.x + (x - entry.rect.x) * entry.scale, box.y + (y - entry.rect.y) * entry.scale];
                return {
                    box,
                    scale: entry.scale,
                    shot: entry.shot,
                    /** A recorded point by name, or { x, y } / [x, y] in CSS px of the captured window. `d` shifts it in page px. */
                    point(at, d = [0, 0]) {
                        let p = at;
                        if (typeof at === 'string') p = entry.shot.points && entry.shot.points[at];
                        if (Array.isArray(p)) p = { x: p[0], y: p[1] };
                        if (!p) {
                            report(`fig: capture "${entry.name}" has no point "${at}"`);
                            return [box.x, box.y];
                        }
                        const q = toPage(p.x, p.y);
                        return [q[0] + d[0], q[1] + d[1]];
                    },
                    /** A recorded rectangle by name ('hint', 'pivot', a text of the chart with 'text:z = 9'), in page px. */
                    rect(which) {
                        let r = which;
                        if (typeof which === 'string') {
                            if (which === 'pivot') r = entry.shot.pivot;
                            else if (which.startsWith('text:')) r = ((entry.shot.texts || []).find((t) => t.text === which.slice(5)) || {}).rect;
                            else r = entry.shot.rects && entry.shot.rects[which];
                        }
                        if (!r) {
                            report(`fig: capture "${entry.name}" has no rectangle "${which}"`);
                            return { x: box.x, y: box.y, width: 0, height: 0 };
                        }
                        const [x, y] = toPage(r.x, r.y);
                        return { x, y, width: r.width * entry.scale, height: r.height * entry.scale };
                    },
                };
            },
            rect(target) {
                return pageRect(find(target));
            },
            anchor(target, side = 'left', { dx = 0, dy = 0, line = null } = {}) {
                const el = find(target);
                if (!el) {
                    report(`anchor: nothing matches ${target}`);
                    return [0, 0];
                }
                let b = pageRect(el);
                if (line) {
                    // One line of the text: the arrow starts beside the words, not beside the block.
                    const range = document.createRange();
                    range.selectNodeContents(el);
                    const rects = Array.from(range.getClientRects()).filter((r) => r.width > 1);
                    if (rects.length) {
                        const pick = line === 'last' ? rects[rects.length - 1] : rects[0];
                        const same = rects.filter((r) => Math.abs(r.top - pick.top) < pick.height * 0.5);
                        const l = Math.min(...same.map((r) => r.left));
                        const rr = Math.max(...same.map((r) => r.right));
                        b = { x: l - origin.left, y: pick.top - origin.top, width: rr - l, height: pick.height };
                    }
                }
                // Optical middle of a line of text: the middle of the x-height, a little under the box's middle.
                const midY = b.y + b.height * 0.56;
                const x = side.includes('left') ? b.x : side.includes('right') ? b.x + b.width : b.x + b.width / 2;
                const y = side.startsWith('top') ? b.y : side.startsWith('bottom') ? b.y + b.height : midY;
                return [x + dx, y + dy];
            },
            arrow({ over = null, ...options }) {
                arrows++;
                const extra = {};
                if (over) {
                    // The arrow crosses lines of the chart in this figure: a white casing under it, inside the figure only.
                    const host = find(over);
                    const shot = host && (host.matches('.shot') ? host : host.querySelector('.shot'));
                    if (!shot) report(`arrow: over: no figure matches ${over}`);
                    else {
                        const b = pageRect(shot);
                        extra.casing = 2 * page.k;
                        extra.casingClip = { ...b, radius: parseFloat(getComputedStyle(shot).borderTopLeftRadius) || 0 };
                    }
                }
                const a = callout({ width: 1.75 * page.k, color: '#14171C', ...extra, ...options });
                overlay.insertAdjacentHTML('beforeend', a.svg);
                return a;
            },
            spy(options) {
                const s = spy({ width: 1.25 * page.k, pad: 6 * page.k, ...options });
                overlay.insertAdjacentHTML('beforeend', s.svg);
                return s;
            },
            pointer(options) {
                overlay.insertAdjacentHTML('beforeend', pointer({ scale: 1.3 * page.k, ...options }));
            },
            baseline(target) {
                const line = firstBaseline(find(target));
                return line ? line.y - origin.top : 0;
            },
            draw(markup) {
                overlay.insertAdjacentHTML('beforeend', markup);
            },
        };
        if (setup) await setup(tools);

        // The paper last: its fades follow the final layout.
        if (paper !== false) {
            const fades = [];
            for (const el of body.querySelectorAll('[data-fade]')) {
                const b = pageRect(el);
                const pad = (el.dataset.fadePad ? Number(el.dataset.fadePad) : 0.75) * page.unit;
                fades.push({
                    x: b.x - pad,
                    y: b.y - pad,
                    width: b.width + pad * 2,
                    height: b.height + pad * 2,
                    strength: el.dataset.fade === '' ? 0.3 : Number(el.dataset.fade),
                    feather: (el.dataset.fadeFeather ? Number(el.dataset.fadeFeather) : 2) * page.unit,
                });
            }
            const cs = getComputedStyle(document.documentElement);
            const marginX = paper.margin === undefined ? parseFloat(cs.getPropertyValue('--margin-x')) || page.unit * 4 : paper.margin;
            const probe = document.createElement('div');
            probe.style.cssText = 'position:absolute;left:0;top:0;width:var(--margin-x);height:0';
            body.appendChild(probe);
            const measured = probe.getBoundingClientRect().width;
            probe.remove();
            const options = { width: page.W, height: page.H, unit: page.unit, fades, ...paper, margin: paper.margin === undefined ? measured || marginX : paper.margin };
            body.insertAdjacentHTML('afterbegin', paperSVG(options));
            const gridOrigin = options.origin || [options.margin === null ? 0 : options.margin, 0];
            checkEdges(page, gridOrigin, pageRect);
        }

        // House rules that can be checked here.
        if (arrows > 3) report(`${arrows} callout arrows: an image carries at most three`);
        const marked = body.querySelectorAll('.hl').length;
        if (marked > 1) report(`${marked} highlighted phrases: an image carries at most one`);
        if ((body.textContent || '').includes(String.fromCharCode(0x2014))) report('the page contains an em dash');
        // Nothing meaningful is set smaller than 1.2 % of the page width (9.6 px when the image is shown 800 px
        // wide). Scripts of formulas and the numbered circles are parts of larger text and do not count.
        // Text drawn on the overlay counts like any other: the label of the pointer's keycap, or what a
        // template writes with draw().
        const least = (body.dataset.minText === undefined ? 1.2 : Number(body.dataset.minText)) / 100;
        const small = new Map();
        const texts = document.createTreeWalker(body, NodeFilter.SHOW_TEXT);
        for (let node = texts.nextNode(); node; node = texts.nextNode()) {
            const host = node.parentElement;
            if (!node.nodeValue.trim() || !host || host.closest('script, style, .msup, .msub, .mscripts, .num, [data-fine]')) continue;
            const size = parseFloat(getComputedStyle(host).fontSize);
            if (size < page.W * least - 0.05) {
                const block = host.closest('p, h1, h2, h3, div, figure, g.pointer-keycap') || host;
                if (!small.has(block)) small.set(block, size);
            }
        }
        for (const [block, size] of small) report(`text smaller than ${(least * 100).toFixed(2)} % of the page width (${size.toFixed(1)} px of ${page.W}): "${(block.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 40)}"`);
        for (const el of body.querySelectorAll('.title, .heading, .lead, .body, .note, .caption, .smallprint, .eq, .running-head, [data-check]')) {
            const b = pageRect(el);
            if (b.width && (b.x < -0.5 || b.y < -0.5 || b.x + b.width > page.W + 0.5 || b.y + b.height > page.H + 0.5)) report(`text leaves the page: "${(el.textContent || '').trim().slice(0, 40)}"`);
            if (el.scrollWidth > el.clientWidth + 1 && getComputedStyle(el).overflow !== 'visible') report(`text is clipped: "${(el.textContent || '').trim().slice(0, 40)}"`);
        }
        window.brandShots = () => placed.map((p) => ({ id: p.id, name: p.name, file: p.file, crop: p.crop, box: p.box }));
        /** render.mjs hands in crops resampled to the exact pixels: { id: url }. */
        window.brandSwap = async (map) => {
            await Promise.all(
                placed.map(async (p) => {
                    const url = map[p.id];
                    if (!url) return;
                    const img = document.createElement('img');
                    img.alt = '';
                    img.src = url;
                    img.style.left = '0';
                    img.style.top = '0';
                    img.style.width = '100%';
                    img.style.height = '100%';
                    await img.decode();
                    p.el.replaceChildren(img);
                })
            );
            await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
            return true;
        };
    } catch (e) {
        report(`page setup failed: ${e && e.stack ? e.stack : e}`);
    } finally {
        await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
        window.brandReady = true;
    }
}
