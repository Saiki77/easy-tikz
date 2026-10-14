// The clock of a film: pure functions that say what is on the stage at a
// time t. No DOM, no Node: the stage page (stage.mjs) draws what stateAt()
// returns, edit.mjs builds the film these functions read, and
// timeline.test.mjs checks them.
//
// Three coordinate systems:
//   window px   CSS px of the captured Obsidian window (1728 x 1117); the
//               event track of a capture is written in these
//   page px     the notebook page of the output (1920 x 1080) with the
//               figure at its place in the wide shot. The figure is a crop
//               of the window (the editor, as a rule): L.crop
//   screen px   the output frame: screen = page * z + (tx, ty)
// A camera is { z, tx, ty }. z = 1 is the wide shot: the whole figure on
// the page. The camera moves the FIGURE only. The page itself (paper, grid,
// margin rule, running head, cards, the caption band) never moves and never
// changes its scale, so no hairline of the grid can shimmer.

export const clamp = (v, lo = 0, hi = 1) => Math.min(hi, Math.max(lo, v));
export const lerp = (a, b, p) => a + (b - a) * p;
/** 0 before t0, 1 after t0 + dur, linear between. */
export const ramp = (t, t0, dur) => (dur <= 0 ? (t >= t0 ? 1 : 0) : clamp((t - t0) / dur));
export const easeInOutCubic = (p) => (p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2);
export const easeOutCubic = (p) => 1 - Math.pow(1 - p, 3);
export const easeInCubic = (p) => p * p * p;
/** Minimum jerk: how a hand moves a mouse from rest to rest. */
export const minJerk = (p) => p * p * p * (10 + p * (-15 + 6 * p));
export const smoothstep = (a, b, v) => {
    const p = clamp((v - a) / (b - a));
    return p * p * (3 - 2 * p);
};

/**
 * A way through points with its corners rounded (Chaikin's corner cutting, `rounds` times; the first and
 * the last point stay). Each round cuts a corner at a quarter of its two legs, so the way never leaves the
 * hull of its points and passes a corner no further than a quarter of the shorter leg inside it.
 */
export function smoothPath(points, rounds = 3) {
    let pts = points.map((p) => ({ x: p.x, y: p.y }));
    for (let r = 0; r < rounds && pts.length > 2; r++) {
        const out = [pts[0]];
        for (let i = 0; i < pts.length - 1; i++) {
            const a = pts[i];
            const b = pts[i + 1];
            if (i > 0) out.push({ x: 0.75 * a.x + 0.25 * b.x, y: 0.75 * a.y + 0.25 * b.y });
            if (i < pts.length - 2) out.push({ x: 0.25 * a.x + 0.75 * b.x, y: 0.25 * a.y + 0.75 * b.y });
        }
        out.push(pts[pts.length - 1]);
        pts = out;
    }
    return pts;
}

/** The point at `along` px of the way along a polyline (clamped to its ends). */
export function pointAlong(points, along) {
    let rest = Math.max(0, along);
    for (let i = 1; i < points.length; i++) {
        const a = points[i - 1];
        const b = points[i];
        const len = Math.hypot(b.x - a.x, b.y - a.y);
        if (rest <= len || i === points.length - 1) {
            const f = len > 0 ? Math.min(1, rest / len) : 1;
            return { x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f };
        }
        rest -= len;
    }
    return { ...points[points.length - 1] };
}

/** The length of a polyline in px. */
export const pathLength = (points) => points.slice(1).reduce((sum, p, i) => sum + Math.hypot(p.x - points[i].x, p.y - points[i].y), 0);

/** Timings of the stage, in seconds. One place, so the film has one rhythm. */
export const TIMING = {
    captionIn: 0.32,
    captionOut: 0.24,
    captionSlide: 12, // px
    calloutDraw: 0.4,
    calloutOut: 0.3,
    noteIn: 0.26,
    ring: 0.45, // a click ring expands and fades
    keycapIn: 0.16,
    titleOut: 0.3,
    /** The title has begun to leave when the window comes, and the end card is on its way before the window has gone. */
    titleLead: 0.1,
    overlap: 0.15,
    /**
     * The window is put onto the page like a sheet: it slides up from under the lower edge of the frame,
     * opaque all the way (never see-through), slowing down as it lands, and its shadow grows as it does.
     * It is taken off the same way, backwards.
     */
    windowIn: 0.45,
    windowOut: 0.4,
    endIn: 0.42,
    ruleAt: 0.24, // the hairline rule of the end card starts to draw on, seconds after the card sets off
    rule: 0.4,
    figureAt: 0.12, // the figure of the end card follows its text
    highlightAt: 0.4, // the highlighter stroke of the title card starts here
    highlight: 0.5,
};

/**
 * The page and the figure on it, for an output of width x height px.
 *   view     { width, height, dpr } of the captured window
 *   figure   { rect: { x, y, width, height }, radius }: the part of the window that is the figure, in
 *            window px, and the radius of its corners (the editor's modal, as a rule). Left out: the
 *            whole window
 * The unit is the brand's grid unit (24 px on a 1600 px page, whole px). In the wide shot the figure is
 * as large as the page allows under the running head: at most 54 x 32 units, its left and top edge on
 * grid lines. The editor (1440 x 960 px) is exactly 48 x 32 units: all four edges on grid lines.
 */
export function stageLayout({ width = 1920, height = 1080, view, figure = null }) {
    const u = Math.max(4, Math.round((24 * width) / 1600));
    const crop = figure && figure.rect ? { x: figure.rect.x, y: figure.rect.y, width: figure.rect.width, height: figure.rect.height } : { x: 0, y: 0, width: view.width, height: view.height };
    const fit = Math.min((54 * u) / crop.width, (32 * u) / crop.height);
    const fw = Math.round(crop.width * fit);
    const w0 = fw / crop.width; // page px per window px
    const fh = Math.round(crop.height * w0);
    // Centred on grid line 33, the middle of the frame, with its left edge on a grid line.
    const fx = 4 * u + Math.round((33 * u - fw / 2 - 4 * u) / u) * u;
    const fig = { x: fx, y: 3 * u, width: fw, height: fh };
    const safeBottom = Math.round(30.5 * u);
    return {
        width,
        height,
        u,
        view: { width: view.width, height: view.height, dpr: view.dpr || 2 },
        crop,
        radius: figure && figure.radius ? figure.radius : 0,
        fig,
        w0,
        /** The zoom at which one pixel of the capture is one pixel of the output: the camera never goes closer. */
        maxZ: (view.dpr || 2) / w0,
        marginX: 4 * u, // the red margin rule
        left: 5 * u, // where text starts
        right: width - rightEdge(width, u), // the margin left of the right edge
        headRule: 2, // grid line of the running head's rule
        /** The camera frames a focus above this line; below it the paper band holds the caption. */
        safeBottom,
        bandTop: safeBottom,
        bandSolid: safeBottom + u,
        chipBaseline: Math.round(32.75 * u),
        captionBaseline: 35 * u,
    };
}
/** x of the last grid line that leaves 2.5 units of margin (the brand's right margin). */
function rightEdge(width, u) {
    const origin = 4 * u;
    return origin + Math.floor((width - 2.5 * u - origin) / u) * u;
}

/** Window px to page px (the figure at rest, in the wide shot). */
export const toWorld = (L, p) => ({ x: L.fig.x + (p.x - L.crop.x) * L.w0, y: L.fig.y + (p.y - L.crop.y) * L.w0 });
/** Page px to screen px under a camera. */
export const toScreen = (cam, p) => ({ x: p.x * cam.z + cam.tx, y: p.y * cam.z + cam.ty });
/** Window px to screen px. */
export const windowToScreen = (L, cam, p) => toScreen(cam, toWorld(L, p));
/** The figure on the screen under a camera: { x, y, width, height, radius }. */
export const figureOnScreen = (L, cam) => ({ x: L.fig.x * cam.z + cam.tx, y: L.fig.y * cam.z + cam.ty, width: L.fig.width * cam.z, height: L.fig.height * cam.z, radius: L.radius * L.w0 * cam.z });

export const WIDE = { z: 1, tx: 0, ty: 0 };

function alignOf(align) {
    const words = String(align || 'center').split(/[\s-]+/);
    return [words.includes('left') ? 'left' : words.includes('right') ? 'right' : 'center', words.includes('top') ? 'top' : words.includes('bottom') ? 'bottom' : 'center'];
}

/**
 * The camera that frames a rectangle of the window.
 *   focus   { x, y, width, height } in window px; null is the wide shot
 *   pad     px of the output kept free around the focus (default 40): a number, [x, y] or
 *           [left, top, right, bottom]. The lower edge is that of the area above the caption band
 *   zoom    use this zoom instead of the largest that fits (still capped at 100 % of the capture)
 *   minZoom the camera goes at least this close (the focus then has more air around it)
 *   align   where the focus lies in the area above the band: 'center' (default), or 'left', 'right',
 *           'top', 'bottom' and pairs such as 'right bottom': that edge of the focus lies on that edge of
 *           the area. With it a frame edge lands on an edge of the UI (the divider between the panel and
 *           the preview), and the paper beside the figure becomes the margin for a note
 * A centred focus is kept on the figure (no sliver of paper beside a figure that is larger than the
 * frame). The translation is rounded so that the figure's corner lies on a whole pixel: during a hold
 * nothing is resampled between pixels.
 */
export function solveCamera(L, focus, { pad = 40, zoom = null, minZoom = null, align = 'center' } = {}) {
    if (!focus) return { ...WIDE };
    const at = toWorld(L, focus);
    const r = { x: at.x, y: at.y, width: Math.max(1, focus.width * L.w0), height: Math.max(1, focus.height * L.w0) };
    const [padLeft, padTop, padRight, padBottom] = Array.isArray(pad) ? (pad.length === 2 ? [pad[0], pad[1], pad[0], pad[1]] : pad) : [pad, pad, pad, pad];
    const area = { x0: padLeft, x1: L.width - padRight, y0: padTop, y1: L.safeBottom - padBottom };
    let z = Math.min((area.x1 - area.x0) / r.width, (area.y1 - area.y0) / r.height);
    if (minZoom) z = Math.max(z, minZoom);
    if (zoom) z = zoom;
    z = Math.min(L.maxZ, Math.max(1, z));
    const [ax, ay] = alignOf(align);
    let tx = ax === 'left' ? area.x0 - r.x * z : ax === 'right' ? area.x1 - (r.x + r.width) * z : (area.x0 + area.x1) / 2 - (r.x + r.width / 2) * z;
    let ty = ay === 'top' ? area.y0 - r.y * z : ay === 'bottom' ? area.y1 - (r.y + r.height) * z : (area.y0 + area.y1) / 2 - (r.y + r.height / 2) * z;
    const fig = L.fig;
    if (ax === 'center' && fig.width * z >= L.width) tx = clamp(tx, L.width - (fig.x + fig.width) * z, -fig.x * z);
    if (ay === 'center' && fig.height * z >= L.safeBottom) ty = clamp(ty, L.safeBottom - (fig.y + fig.height) * z, -fig.y * z);
    tx = Math.round(fig.x * z + tx) - fig.x * z;
    ty = Math.round(fig.y * z + ty) - fig.y * z;
    return { z, tx, ty };
}

/**
 * Between two cameras: a pure zoom about the one point of the page that both show at the same place
 * of the frame (so nothing drifts sideways while the picture grows), or a straight pan when the zoom
 * is the same. `p` is the eased progress 0..1. The zoom is interpolated geometrically: it looks even.
 */
export function mixCamera(a, b, p) {
    if (p <= 0) return { z: a.z, tx: a.tx, ty: a.ty };
    if (p >= 1) return { z: b.z, tx: b.tx, ty: b.ty };
    if (Math.abs(b.z - a.z) < 1e-6) return { z: b.z, tx: lerp(a.tx, b.tx, p), ty: lerp(a.ty, b.ty, p) };
    const z = Math.exp(lerp(Math.log(a.z), Math.log(b.z), p));
    const q = (z - a.z) / (b.z - a.z);
    return { z, tx: lerp(a.tx, b.tx, q), ty: lerp(a.ty, b.ty, q) };
}

/** Seconds a camera move takes: 0.6 for a small one, up to 0.9 for the longest (the full zoom, or a pan across the frame). */
export function moveSeconds(a, b, L) {
    const zoom = Math.abs(Math.log(b.z / a.z)) / Math.log(L.maxZ);
    const ca = { x: (L.width / 2 - a.tx) / a.z, y: (L.height / 2 - a.ty) / a.z };
    const cb = { x: (L.width / 2 - b.tx) / b.z, y: (L.height / 2 - b.ty) / b.z };
    const pan = Math.hypot(cb.x - ca.x, cb.y - ca.y) / L.fig.width;
    return Math.round((0.6 + 0.3 * clamp(zoom + pan)) * 100) / 100;
}

/**
 * The camera at time t.
 *   keys   [{ t, dur, z, tx, ty }] in order: at t the camera starts to ease (cubic in and out) to
 *          that state and reaches it at t + dur. A key that starts before the last move has ended
 *          takes over from where the camera is.
 * Returns { z, tx, ty, moving }.
 */
export function cameraAt(keys, t) {
    let cam = { z: keys[0].z, tx: keys[0].tx, ty: keys[0].ty };
    let moving = false;
    for (let i = 1; i < keys.length; i++) {
        const k = keys[i];
        if (t <= k.t) break;
        const next = keys[i + 1];
        const until = next ? Math.min(t, next.t) : t;
        let p = k.dur > 0 ? clamp((until - k.t) / k.dur) : 1;
        if (p > 1 - 1e-9) p = 1; // 2.8 - 2 is not quite 0.8 in floating point: the move has ended all the same
        cam = mixCamera(cam, k, easeInOutCubic(p));
        moving = p < 1 && until === t;
    }
    return { ...cam, moving };
}

/** Linear interpolation in a list of { t, ... } samples sorted by t; `fields` are the numbers to mix. */
export function sampleAt(samples, t, fields = ['x', 'y']) {
    if (!samples.length) return null;
    if (t <= samples[0].t) return samples[0];
    const last = samples[samples.length - 1];
    if (t >= last.t) return last;
    let lo = 0;
    let hi = samples.length - 1;
    while (hi - lo > 1) {
        const mid = (lo + hi) >> 1;
        if (samples[mid].t <= t) lo = mid;
        else hi = mid;
    }
    const a = samples[lo];
    const b = samples[hi];
    const p = b.t > a.t ? (t - a.t) / (b.t - a.t) : 1;
    const out = { t };
    for (const f of fields) out[f] = lerp(a[f], b[f], p);
    return out;
}

/**
 * The picture of the capture that is on screen at t: the last one whose time has come. The times of a
 * film lie exactly on the ticks of its capture (edit.mjs snaps them), so a tolerance far below one frame
 * is enough: a picture stream of 30 per second lands on 60 frames per second as 2, 2, 2, ... frames each.
 */
export function frameAt(frames, t) {
    if (!frames.length) return null;
    let lo = 0;
    let hi = frames.length - 1;
    if (t < frames[0].t) return frames[0];
    while (lo < hi) {
        const mid = (lo + hi + 1) >> 1;
        if (frames[mid].t <= t + 1e-6) lo = mid;
        else hi = mid - 1;
    }
    return frames[lo];
}

/** The tick of the capture that is on screen at t, as a film time: t0 + n / fps for the last tick n that has come. */
export function tickTime(t, t0, fps) {
    return t0 + Math.floor((t - t0) * fps + 1e-6) / fps;
}

const r2 = (v) => Math.round(v * 100) / 100;
const r3 = (v) => Math.round(v * 1000) / 1000;

/**
 * The parts of a film: the stretches of the capture between its cards, as [{ t0, t1 }] in film seconds.
 * A film without section cards has one part, its body.
 */
export const partsOf = (film) => film.parts || [{ t0: film.body.t0, t1: film.body.t1 }];

/** Index of the part that is on (or has just left) at t: the last one that has begun, else the first. */
export function partAt(film, t) {
    const parts = partsOf(film);
    let k = 0;
    for (let i = 1; i < parts.length; i++) if (t >= parts[i].t0 - 1e-9) k = i;
    return k;
}

/**
 * Everything the stage shows at time t, as plain numbers.
 *   film   the object edit.mjs makes (see there)
 * Values are rounded, so two times at which the stage looks the same give the same state: the
 * composite pass then reuses the frame instead of drawing it again (and a hold cannot jitter).
 */
export function stateAt(film, t) {
    const L = film.layout;
    const T = TIMING;
    const body = film.body;
    const parts = partsOf(film);
    const k = partAt(film, t);
    const part = parts[k];
    const cam = cameraAt(film.camera, t);

    // The window. It slides onto the page from under the lower edge of the frame and off it again: opaque
    // all the way, so the page is never seen through it and is never empty between a card and the window.
    // `drop` is how far below its place it is, `lift` how far it has come off the page (its shadow).
    // A film without a title card begins with the window in its place. Between two parts a section card
    // stands on the page: the window leaves as at the end and comes back as at the start.
    const carded = body.t0 > 0;
    const travel = L.height - L.fig.y + 2 * L.u; // its upper edge and its shadow are under the frame
    const rise = carded || k > 0 ? easeOutCubic(ramp(t, part.t0, T.windowIn)) : 1;
    const leave = easeInCubic(ramp(t, part.t1, T.windowOut));
    const on = t >= part.t0 && t < part.t1 + T.windowOut;
    const window = { opacity: on ? 1 : 0, drop: r2((1 - rise + leave) * travel), lift: r3(rise * (1 - leave)) };
    const frame = frameAt(film.frames, t);

    // Title card: there from the first frame; the highlighter stroke draws on. It leaves, upwards, while
    // the window slides over it.
    const tOut = easeInOutCubic(ramp(t, body.t0 - T.titleLead, T.titleOut));
    const title = { opacity: carded ? r3(1 - tOut) : 0, dy: r2(-16 * tOut), highlight: r3(easeInOutCubic(ramp(t, T.highlightAt, T.highlight))) };
    // A section card: comes in as the end card does (before the window has gone, its figure following),
    // its highlighter stroke draws on once its text is there, and it leaves as the title card does, upwards,
    // while the window slides over it. `figureDy` is the figure's offset relative to the card's text.
    let section = null;
    (film.sections || []).forEach((s, i) => {
        const after = parts[i + 1];
        if (!after) return;
        const at = parts[i].t1 + T.windowOut - T.overlap;
        const gone = after.t0 - T.titleLead + T.titleOut;
        if (t < at || t >= gone) return;
        const sIn = easeOutCubic(ramp(t, at, T.endIn));
        const fIn = easeOutCubic(ramp(t, at + T.figureAt, T.endIn));
        const sOut = easeInOutCubic(ramp(t, after.t0 - T.titleLead, T.titleOut));
        section = {
            index: i,
            opacity: r3(sIn * (1 - sOut)),
            dy: r2((1 - sIn) * 16 - 16 * sOut),
            highlight: r3(easeInOutCubic(ramp(t, at + T.endIn, T.highlight))),
            figure: r3(fIn),
            figureDy: r2((1 - fIn) * 24 - (1 - sIn) * 16),
        };
    });
    // End card: on its way before the window has gone; its rule draws on, its figure follows.
    const endAt = body.t1 + T.windowOut - T.overlap;
    const eIn = easeOutCubic(ramp(t, endAt, T.endIn));
    const fIn = easeOutCubic(ramp(t, endAt + T.figureAt, T.endIn));
    const end = { opacity: r3(eIn), dy: r2((1 - eIn) * 16), rule: r3(easeInOutCubic(ramp(t, endAt + T.ruleAt, T.rule))), figure: r3(fIn), figureDy: r2((1 - fIn) * 24) };
    // The running head belongs to the page: it goes when the figure grows over it, and the end card
    // brings its own (two lines of small capitals must not cross-fade through each other).
    const away = smoothstep(1.005, 1.05, cam.z);
    const head = { main: r3((1 - ramp(t, endAt - 0.05, 0.2)) * (1 - away)), end: r3(ramp(t, endAt + 0.15, 0.3)) };

    // The paper band under the picture: only once the figure has grown past it. With it comes the chip:
    // the film's title in small capitals over the caption.
    const band = on ? r3(smoothstep(1.03, 1.2, cam.z)) : 0;
    // What is written on the band waits until the band has all but covered the figure under it.
    const ground = r3(smoothstep(0.6, 1, band));

    // Caption: one at a time, and never without the band under it.
    let caption = null;
    film.captions.forEach((c, index) => {
        const a = Math.min(ramp(t, c.t0, T.captionIn), 1 - ramp(t, c.t1 - T.captionOut, T.captionOut));
        if (a <= 0) return;
        const entering = t < c.t0 + T.captionIn;
        const slide = entering ? (1 - easeOutCubic(ramp(t, c.t0, T.captionIn))) * T.captionSlide : -easeInCubic(ramp(t, c.t1 - T.captionOut, T.captionOut)) * T.captionSlide;
        const opacity = r3(Math.min(entering ? easeOutCubic(a) : a, ground));
        if (opacity > 0) caption = { index, opacity, dy: r2(slide) };
    });

    // Callout: an arrow that draws on, with its note.
    let callout = null;
    film.callouts.forEach((c, index) => {
        if (t < c.t0 || t >= c.t1 || !on) return;
        const out = 1 - ramp(t, c.t1 - T.calloutOut, T.calloutOut);
        const to = windowToScreen(L, cam, c.to);
        callout = { index, progress: r3(easeInOutCubic(ramp(t, c.t0 + 0.1, T.calloutDraw))), opacity: r3(out), note: r3(easeOutCubic(ramp(t, c.t0, T.noteIn)) * out), x: r2(to.x), y: r2(to.y) };
    });

    // Pointer.
    let pointer = null;
    if (film.pointer.samples.length && on) {
        let ring = null;
        let ringAt = null;
        let held = false;
        for (const press of film.pointer.presses) {
            if (t >= press.t0 && t < press.t1) held = true;
            for (const edge of [press.t0, press.t1]) {
                const age = (t - edge) / T.ring;
                if (age >= 0 && age <= 1) {
                    ring = r3(age);
                    // The ring stays where the button went down (or up): a hand that moves on leaves it behind,
                    // so a release does not read as a drag still held.
                    ringAt = edge === press.t0 && typeof press.x === 'number' ? { x: press.x, y: press.y } : sampleAt(film.pointer.samples, edge);
                }
            }
        }
        // While the button is down the hand is where it was when the picture on screen was taken: the line it
        // holds and the hand stay locked. A free glide is drawn for every frame of the output. While the
        // window leaves, the hand stays where its part ended.
        const at = sampleAt(film.pointer.samples, held ? tickTime(t, part.t0, film.source.fps) : clamp(t, part.t0, part.t1));
        const p = windowToScreen(L, cam, at);
        let keycap = null;
        for (const key of film.pointer.keys) {
            if (t >= key.t0 && t < key.t1) keycap = { label: key.label, side: key.side, offset: key.offset, opacity: r3(Math.min(easeOutCubic(ramp(t, key.t0, T.keycapIn)), 1 - ramp(t, key.t1 - 0.1, 0.1))) };
        }
        // A little larger than life, and larger when the camera is close (the square root keeps it from taking over).
        // It lies on the window: it comes and goes with it.
        pointer = { x: r2(p.x), y: r2(p.y + window.drop), scale: r3(film.pointer.scale * Math.sqrt(cam.z * L.w0)), opacity: window.opacity, ring, held, keycap };
        if (ringAt) {
            const q = windowToScreen(L, cam, ringAt);
            pointer.ringX = r2(q.x);
            pointer.ringY = r2(q.y + window.drop);
        }
    }

    // The chip carries the title of the part that is on: a film with sections has one per part.
    const chips = film.chips || [film.chip];
    return {
        cam: { z: cam.z, tx: cam.tx, ty: cam.ty, moving: cam.moving },
        frame: frame ? frame.src : null,
        window,
        title,
        section,
        end,
        head,
        band,
        chip: chips[k] ? ground : 0,
        chipIndex: k,
        caption,
        callout,
        pointer,
    };
}

/** A caption or a note: text with formulas between dollar signs, split into [{ text }, { math }] parts. */
export function splitMath(text) {
    const parts = [];
    const re = /\$([^$]+)\$/g;
    let at = 0;
    let m;
    while ((m = re.exec(text))) {
        if (m.index > at) parts.push({ text: text.slice(at, m.index) });
        parts.push({ math: m[1] });
        at = m.index + m[0].length;
    }
    if (at < text.length) parts.push({ text: text.slice(at) });
    return parts;
}

/** Words of a caption; a formula counts as one. */
export function wordCount(text) {
    return splitMath(text).reduce((n, part) => n + (part.math ? 1 : part.text.split(/\s+/).filter((w) => /[A-Za-z0-9]/.test(w)).length), 0);
}
