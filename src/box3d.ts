/*
 * The 3D box as the camera sees it, for the preview (src/renderer3d.ts),
 * drawn the way pgfplots draws it in the PDF: the faces that turn toward the
 * viewer, the edges drawn behind the surfaces (both faces at the back), the
 * outline drawn over them, the three edges at the front corner left out,
 * where the tick numbers go (outside the box, so no surface covers them),
 * and the grid lines on the faces at the back. Pure: no DOM, no Obsidian.
 *
 * Depth: the preview's `depth` of a point is -(toViewer . n) for the point
 * n in the normalized box (-1..1 per axis), so a larger depth is farther
 * from the viewer and the painter draws the largest depth first (farFirst).
 */

export type Vec3 = [number, number, number];

/** The direction toward the viewer for the preview's azimuth and elevation in degrees (the export's camera.toViewer). */
export function toViewer(azimuth: number, elevation: number): Vec3 {
    const a = (azimuth * Math.PI) / 180;
    const e = (elevation * Math.PI) / 180;
    return [-Math.sin(a) * Math.cos(e), -Math.cos(a) * Math.cos(e), Math.sin(e)];
}

/** Box lengths x : y : z: three finite numbers above 0, or null. Accepts an array or a text such as "1 2 0.6" or "1 x 2 x 0.6". */
export function boxRatioOf(value: unknown): Vec3 | null {
    const parts = Array.isArray(value) ? value : typeof value === 'string' ? value.trim().split(/\s*(?:x|×|by|:|,|\s)\s*/i) : null;
    if (!parts || parts.length !== 3) return null;
    const r = parts.map((p) => (typeof p === 'number' ? p : typeof p === 'string' && p.trim() !== '' ? Number(p) : NaN));
    return r.every((v) => Number.isFinite(v) && v > 0) ? [r[0], r[1], r[2]] : null;
}

/** The stored box aspect as the renderer reads it: 'equal' (a cube), 'custom' (the lengths of boxRatio) or 'true' (the ranges). */
export function boxAspectOf(aspect: unknown): 'true' | 'equal' | 'custom' {
    return aspect === 'equal' || aspect === 'custom' ? aspect : 'true';
}

/**
 * Preview units per data unit on each axis, from the ranges (each above 0)
 * and the box aspect. The box is centred on 0 and its longest edge is 2:
 * 'equal' makes every edge 2 (a cube), 'true' gives the edges the
 * proportions of the ranges, 'custom' those of `ratio` (a cube when the
 * ratio is not valid).
 */
export function boxFactors(ranges: Vec3, aspect: string, ratio?: unknown): Vec3 {
    if (aspect === 'true') {
        const largest = Math.max(...ranges);
        return [2 / largest, 2 / largest, 2 / largest];
    }
    const lengths = (aspect === 'custom' && boxRatioOf(ratio)) || [1, 1, 1];
    const longest = Math.max(...lengths);
    return [0, 1, 2].map((k) => (2 * lengths[k]) / longest / ranges[k]) as Vec3;
}

/**
 * Width and height on screen, in preview units, of a box centred on 0 with
 * the half lengths `half`, seen from the azimuth and elevation in degrees
 * (the projection of renderer3d: right = nx cos a - ny sin a, up =
 * (nx sin a + ny cos a) sin e + nz cos e).
 */
export function projectedBox(half: Vec3, azimuth: number, elevation: number): { width: number; height: number } {
    const a = (azimuth * Math.PI) / 180;
    const e = (elevation * Math.PI) / 180;
    const [cosA, sinA, cosE, sinE] = [Math.abs(Math.cos(a)), Math.abs(Math.sin(a)), Math.abs(Math.cos(e)), Math.abs(Math.sin(e))];
    return {
        width: 2 * (half[0] * cosA + half[1] * sinA),
        height: 2 * ((half[0] * sinA + half[1] * cosA) * sinE + half[2] * cosE),
    };
}

/**
 * The share of the space inside the padding that the box itself may fill,
 * across and up; the rest is for the tick numbers and axis labels around it.
 * Set so a cube seen from the default view (azimuth 45°, elevation 30°)
 * keeps the size it had before 5.2.5 (0.28 of the shorter side per unit).
 */
export const BOX_FILL_ACROSS = 0.792;
export const BOX_FILL_UP = 0.881;

/**
 * Pixels per preview unit so the box, as seen from this view, fills the
 * space `availW` x `availH` (less the room for its labels) as far as it
 * can: a long box fills a wide chart, a tall one a narrow chart.
 */
export function boxFitScale(half: Vec3, azimuth: number, elevation: number, availW: number, availH: number): number {
    const seen = projectedBox(half, azimuth, elevation);
    const across = seen.width > 1e-9 ? (BOX_FILL_ACROSS * availW) / seen.width : Infinity;
    const up = seen.height > 1e-9 ? (BOX_FILL_UP * availH) / seen.height : Infinity;
    const scale = Math.min(across, up);
    return Number.isFinite(scale) && scale > 0 ? scale : 0.28 * Math.min(availW, availH);
}

/** Painter's order: farther first, so what is nearer covers it. */
export function farFirst(a: { depth: number }, b: { depth: number }): number {
    return b.depth - a.depth;
}

/** Corners by bits: bit 0 is x at its max, bit 1 is y, bit 2 is z. */
export const BOX_EDGES: ReadonlyArray<readonly [number, number]> = [
    // Floor (z min), top (z max), then the vertical edges.
    [0, 1], [1, 3], [3, 2], [2, 0],
    [4, 5], [5, 7], [7, 6], [6, 4],
    [0, 4], [1, 5], [2, 6], [3, 7],
];

/** A face: the axis it is normal to (0, 1, 2 for x, y, z) and its side (0 at the min, 1 at the max). */
export interface Face {
    axis: 0 | 1 | 2;
    side: 0 | 1;
}

/** Below this a face is seen edge-on and counts as a back face. */
const EDGE_ON = 1e-9;

/** True when the face turns toward the viewer. */
export function faceFront(view: Vec3, face: Face): boolean {
    return (face.side ? view[face.axis] : -view[face.axis]) > EDGE_ON;
}

/** True when the face turns away from the viewer (not edge-on). */
export function faceBack(view: Vec3, face: Face): boolean {
    return (face.side ? view[face.axis] : -view[face.axis]) < -EDGE_ON;
}

/** The two faces an edge between corners i and j lies on: the axes where both corners agree. */
export function edgeFaces(i: number, j: number): [Face, Face] {
    const faces: Face[] = [];
    for (const axis of [0, 1, 2] as const) {
        const bit = 1 << axis;
        if ((i & bit) === (j & bit)) faces.push({ axis, side: i & bit ? 1 : 0 });
    }
    return [faces[0], faces[1]];
}

/**
 * How an edge is drawn: `back` (both faces turn away: behind everything,
 * drawn before the surfaces), `outline` (one face each way: the box's
 * outline, drawn after them) or `hidden` (both faces turn toward the
 * viewer: the edges at the front corner, which pgfplots leaves out).
 */
export type EdgeKind = 'back' | 'outline' | 'hidden';

export function edgeKind(view: Vec3, i: number, j: number): EdgeKind {
    const [f, g] = edgeFaces(i, j);
    const a = faceFront(view, f);
    const b = faceFront(view, g);
    return a && b ? 'hidden' : a || b ? 'outline' : 'back';
}

/**
 * Where the tick numbers go, as the side (0 min, 1 max) of the coordinates
 * that stay fixed along each tick edge: x and y on the floor edges at the
 * faces that turn toward the viewer (the top edges when the floor itself
 * does, seen from below), z on the vertical outline edge further left on
 * screen. `cornerX` is the screen x of each corner (bits as BOX_EDGES).
 */
export interface TickSides {
    x: { y: 0 | 1; z: 0 | 1 };
    y: { x: 0 | 1; z: 0 | 1 };
    z: { x: 0 | 1; y: 0 | 1 };
}

export function tickSides(view: Vec3, cornerX: readonly number[]): TickSides {
    const xs: 0 | 1 = faceFront(view, { axis: 0, side: 1 }) ? 1 : 0;
    const ys: 0 | 1 = faceFront(view, { axis: 1, side: 1 }) ? 1 : 0;
    const zs: 0 | 1 = faceFront(view, { axis: 2, side: 0 }) ? 1 : 0;
    const verticals = [0, 1, 2, 3];
    const outline = verticals.filter((c) => edgeKind(view, c, c | 4) === 'outline');
    const pool = outline.length ? outline : verticals;
    const left = pool.reduce((best, c) => (cornerX[c] < cornerX[best] ? c : best));
    return {
        x: { y: ys, z: zs },
        y: { x: xs, z: zs },
        z: { x: left & 1 ? 1 : 0, y: left & 2 ? 1 : 0 },
    };
}

export interface Box3 {
    xmin: number;
    xmax: number;
    ymin: number;
    ymax: number;
    zmin: number;
    zmax: number;
}

/** One grid line in data coordinates. */
export interface GridLine {
    from: Vec3;
    to: Vec3;
    minor: boolean;
}

/**
 * Grid lines on the faces that turn away from the viewer (the floor and
 * the back walls, as pgfplots draws its 3D grid): on each such face, one
 * line across it at every value of its two axes that lies inside the box.
 * `major` and `minor` hold the values per axis (x, y, z); a minor value
 * that is also a major one is drawn once, as major.
 */
export function gridLines(view: Vec3, box: Box3, major: readonly number[][], minor: readonly number[][]): GridLine[] {
    const lo: Vec3 = [box.xmin, box.ymin, box.zmin];
    const hi: Vec3 = [box.xmax, box.ymax, box.zmax];
    const lines: GridLine[] = [];
    const inside = (axis: number, v: number) => {
        const tol = 1e-9 * Math.max(1, Math.abs(hi[axis] - lo[axis]));
        return v > lo[axis] + tol && v < hi[axis] - tol;
    };
    for (const axis of [0, 1, 2] as const) {
        for (const side of [0, 1] as const) {
            if (!faceBack(view, { axis, side })) continue;
            const fixed = side ? hi[axis] : lo[axis];
            const others = [0, 1, 2].filter((k) => k !== axis);
            for (const along of others) {
                const across = others.find((k) => k !== along) as number;
                const majors = (major[along] || []).filter((v) => inside(along, v));
                const minors = (minor[along] || []).filter((v) => inside(along, v) && !majors.some((m) => Math.abs(m - v) < 1e-9 * Math.max(1, Math.abs(v))));
                for (const [values, isMinor] of [[minors, true], [majors, false]] as const) {
                    for (const v of values) {
                        const from: Vec3 = [0, 0, 0];
                        const to: Vec3 = [0, 0, 0];
                        from[axis] = fixed;
                        to[axis] = fixed;
                        from[along] = v;
                        to[along] = v;
                        from[across] = lo[across];
                        to[across] = hi[across];
                        lines.push({ from, to, minor: isMinor });
                    }
                }
            }
        }
    }
    return lines;
}

/** The values from lo to hi on a step (rounded onto it), for ticks and grid lines. */
export function stepValues(lo: number, hi: number, step: number): number[] {
    if (!(step > 0) || !Number.isFinite(lo) || !Number.isFinite(hi) || hi < lo) return [];
    const out: number[] = [];
    const first = Math.ceil(lo / step - 1e-9);
    for (let k = first; k * step <= hi + step * 1e-6 && out.length < 1000; k++) {
        const v = Number((k * step).toPrecision(12));
        out.push(Math.abs(v) < step * 1e-9 ? 0 : v);
    }
    return out;
}
