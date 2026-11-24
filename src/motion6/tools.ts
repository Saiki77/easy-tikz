/*
 * The motion tools (6.0) as data: their defaults, what the migration keeps
 * of a stored one, and their fields for the editor's rename (the pattern of
 * src/beyond/tools.ts). Pure: no DOM, no Obsidian.
 */
import type { Colormap, RestPointsTool, Tool, TrajectoryTool, VectorFieldTool } from '../types';
import { THICKNESS_MAP } from '../colors';
import { isColormap } from '../colormaps';
import { stepOf } from './steps';

type Data = Record<string, unknown>;
type Body<T> = Omit<T, 'id' | 'name' | 'hidden'>;
export type MotionBody = Body<VectorFieldTool> | Body<RestPointsTool> | Body<TrajectoryTool>;

/** Name prefixes of the motion tools (VF1, RP1, TR1). */
export const MOTION_PREFIX = { vectorField: 'VF', restPoints: 'RP', trajectory: 'TR' } as const;

const str = (v: unknown, fallback: string): string => (typeof v === 'string' ? v : typeof v === 'number' && Number.isFinite(v) ? String(v) : fallback);
const bool = (v: unknown, fallback: boolean): boolean => (typeof v === 'boolean' ? v : fallback);
const colorOf = (v: unknown, fallback: string): string => (typeof v === 'string' && v.trim() ? v.trim() : fallback);
const thicknessOf = (v: unknown, fallback: string): string => (typeof v === 'string' && Object.prototype.hasOwnProperty.call(THICKNESS_MAP, v) ? v : fallback);

export function vectorFieldDefaults(): Body<VectorFieldTool> {
    return { type: 'vectorField', color: 'blue', expression: '', density: 20, thickness: 'thin', particles: false, streamlines: false };
}

export function restPointsDefaults(): Body<RestPointsTool> {
    return { type: 'restPoints', color: 'red', field: '', size: 'normal', valueLabel: false };
}

export function trajectoryDefaults(dim: 2 | 3): Body<TrajectoryTool> {
    return { type: 'trajectory', color: 'red', expression: '', through: '', from: '0', to: '10', dim, thickness: 'thick', dashed: false };
}

/** A stored motion tool with every field it needs (unknown values give way to the defaults); null for other types. */
export function completeMotionTool(src: Data, dim: 2 | 3): MotionBody | null {
    const map = (v: unknown): Colormap | undefined => (isColormap(v) ? v : undefined);
    switch (src.type) {
        case 'vectorField': {
            const d = vectorFieldDefaults();
            const density = typeof src.density === 'number' && Number.isFinite(src.density) ? Math.round(Math.min(60, Math.max(4, src.density))) : d.density;
            const out: Body<VectorFieldTool> = {
                type: 'vectorField',
                color: colorOf(src.color, d.color),
                expression: str(src.expression, d.expression),
                density,
                thickness: thicknessOf(src.thickness, d.thickness),
                particles: bool(src.particles, d.particles),
                streamlines: bool(src.streamlines, d.streamlines),
            };
            const m = map(src.colormap);
            if (m) out.colormap = m;
            return out;
        }
        case 'restPoints': {
            const d = restPointsDefaults();
            const size = src.size === 'small' || src.size === 'large' || src.size === 'normal' ? src.size : d.size;
            return {
                type: 'restPoints',
                color: colorOf(src.color, d.color),
                field: str(src.field, d.field).trim(),
                size,
                valueLabel: bool(src.valueLabel, d.valueLabel),
            };
        }
        case 'trajectory': {
            const d = trajectoryDefaults(src.dim === 3 ? 3 : src.dim === 2 ? 2 : dim);
            const out: Body<TrajectoryTool> = {
                type: 'trajectory',
                color: colorOf(src.color, d.color),
                expression: str(src.expression, d.expression),
                through: str(src.through, d.through),
                from: str(src.from, d.from),
                to: str(src.to, d.to),
                dim: d.dim,
                thickness: thicknessOf(src.thickness, d.thickness),
                dashed: bool(src.dashed, d.dashed),
            };
            const m = map(src.colormap);
            if (m) out.colormap = m;
            return out;
        }
        default:
            return null;
    }
}

/** The step a stored object keeps through the migration (steps.ts); undefined for none. */
export function keptStep(src: Data): number | undefined {
    const s = stepOf(src);
    return s > 0 ? s : undefined;
}

export interface Renamer {
    expr(src: string): string;
    tpl(src: string): string;
    ref(name: string): string;
    kind: 'function' | 'parameter' | 'tool';
}

/** Rewrite the fields of a motion tool after a rename. */
export function renameInMotionTool(t: Tool, r: Renamer): void {
    switch (t.type) {
        case 'vectorField':
            t.expression = r.expr(t.expression);
            break;
        case 'restPoints':
            if (r.kind === 'tool') t.field = r.ref(t.field);
            break;
        case 'trajectory':
            t.expression = r.expr(t.expression);
            t.through = r.expr(t.through);
            t.from = r.expr(t.from);
            t.to = r.expr(t.to);
            break;
    }
}

/** Does a motion tool read the name (`reads(src)` tests one field)? */
export function motionToolReads(t: Tool, reads: (src: string | undefined, template?: boolean) => boolean): boolean {
    switch (t.type) {
        case 'vectorField':
            return reads(t.expression);
        case 'trajectory':
            return reads(t.expression) || reads(t.through) || reads(t.from) || reads(t.to);
        default:
            return false;
    }
}
