/*
 * What the auto-fit (src/fit.ts) holds of the motion tools (6.0): a vector
 * field covers the whole view and never sets it (it is unbounded, as a slope
 * field), rest points are points, and a solution of a system is its curve
 * (in 3D its legs, which the 3D fit reads from the scene). Pure.
 */
import type { Tool } from '../types';
import type { SceneItem2D } from '../scene';
import type { FitShapes } from '../beyond/fit';

/** The tool as the fit computes it: no labels, no particles (they never set the ranges). */
export function fitMotionTool(t: Tool): Tool {
    if (t.type === 'restPoints') return { ...t, valueLabel: false };
    if (t.type === 'vectorField') return { ...t, particles: false, streamlines: false };
    return t;
}

/** What a scene item of a motion tool adds to the fit; null for other tools. */
export function motionFitShapes(tool: Tool, item: SceneItem2D): FitShapes | null {
    switch (tool.type) {
        case 'vectorField':
            return { points: [], lines: [], unbounded: true };
        case 'restPoints':
            // Zeros found in the view: the view they were found in holds them already.
            return { points: [], lines: [] };
        case 'trajectory':
            return { points: [], lines: item.strokes.flatMap((s) => s.lines.map((pts) => ({ pts, closed: false }))) };
        default:
            return null;
    }
}
