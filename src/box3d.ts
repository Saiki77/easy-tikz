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
