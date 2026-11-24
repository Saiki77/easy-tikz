/*
 * The tools of part E (6.0) as data: their defaults, what the migration
 * keeps of a stored one, and their fields for the editor's rename (the
 * pattern of src/motion6/tools.ts). Pure: no DOM, no Obsidian.
 */
import { OPTION_RANGE, optionValue } from '../motion6/liveprims'; // 6.0 F4
import type { BifurcationTool, CobwebTool, FourierCirclesTool, NewtonTool, OrbitTool, PlaneColormap, PlaneColourTool, Tool } from '../types';
import { THICKNESS_MAP } from '../colors';
import { isColormap } from '../colormaps';

type Data = Record<string, unknown>;
type Body<T> = Omit<T, 'id' | 'name' | 'hidden'>;
export type IterateBody = Body<OrbitTool> | Body<CobwebTool> | Body<BifurcationTool> | Body<NewtonTool> | Body<PlaneColourTool> | Body<FourierCirclesTool>;

/** Name prefixes: OR1, CW1, BD1, NM1, CP1, FC1. */
export const ITERATE_PREFIX = { orbit: 'OR', cobweb: 'CW', bifurcation: 'BD', newton: 'NM', colourPlane: 'CP', fourierCircles: 'FC' } as const;

/** The tool types of this part. */
export const ITERATE_TYPES: ReadonlySet<string> = new Set(Object.keys(ITERATE_PREFIX));

/** The cyclic map of fractals, besides the six colour maps of surfaces. */
export function isPlaneColormap(v: unknown): v is PlaneColormap {
    return v === 'cyclic' || isColormap(v);
}

const str = (v: unknown, fallback: string): string => (typeof v === 'string' ? v : typeof v === 'number' && Number.isFinite(v) ? String(v) : fallback);
const bool = (v: unknown, fallback: boolean): boolean => (typeof v === 'boolean' ? v : fallback);
const colorOf = (v: unknown, fallback: string): string => (typeof v === 'string' && v.trim() ? v.trim() : fallback);
const thicknessOf = (v: unknown, fallback: string): string => (typeof v === 'string' && Object.prototype.hasOwnProperty.call(THICKNESS_MAP, v) ? v : fallback);
const sizeOf = (v: unknown, fallback: 'small' | 'normal' | 'large'): 'small' | 'normal' | 'large' => (v === 'small' || v === 'normal' || v === 'large' ? v : fallback);
const fraction = (v: unknown, fallback: number): number => (typeof v === 'number' && Number.isFinite(v) ? Math.max(0, Math.min(1, v)) : fallback);

export function orbitDefaults(): Body<OrbitTool> {
    return { type: 'orbit', color: 'red', recurrence: '', start: '0', given: '', steps: '40', path: false, size: 'small', thickness: 'thin', valueLabel: false };
}

export function cobwebDefaults(): Body<CobwebTool> {
    return { type: 'cobweb', color: 'orange', recurrence: '', start: '0.2', steps: '40', thickness: 'thin' };
}

export function bifurcationDefaults(): Body<BifurcationTool> {
    return { type: 'bifurcation', color: 'blue', recurrence: '', parameter: 'r', from: '2.5', to: '4', start: '0.5' };
}

export function newtonDefaults(): Body<NewtonTool> {
    return { type: 'newton', color: 'red', function: '', start: '1', steps: '5', thickness: 'thin', valueLabel: false };
}

export function planeColourDefaults(): Body<PlaneColourTool> {
    return { type: 'colourPlane', color: 'blue', formula: '', start: '', given: '', steps: '200', opacity: 1 };
}

export function fourierCirclesDefaults(): Body<FourierCirclesTool> {
    return { type: 'fourierCircles', color: 'blue', sum: '', wave: false, thickness: 'thick' };
}

/** A new tool of this part with its defaults; null for other types. */
export function iterateDefaults(type: string): IterateBody | null {
    switch (type) {
        case 'orbit':
            return orbitDefaults();
        case 'cobweb':
            return cobwebDefaults();
        case 'bifurcation':
            return bifurcationDefaults();
        case 'newton':
            return newtonDefaults();
        case 'colourPlane':
            return planeColourDefaults();
        case 'fourierCircles':
            return fourierCirclesDefaults();
        default:
            return null;
    }
}

/** A stored tool of this part with every field it needs (unknown values give way to the defaults); null for other types. */
/** 6.0 F4: the options of moving things a stored tool keeps (numbers in their range). */
function kept(src: Data, keys: Array<keyof typeof OPTION_RANGE>): Data {
    const out: Data = {};
    for (const k of keys) {
        const v = optionValue(k, src[k]);
        if (v !== undefined) out[k] = v;
    }
    return out;
}

export function completeIterateTool(src: Data): IterateBody | null {
    switch (src.type) {
        case 'orbit': {
            const d = orbitDefaults();
            return {
                type: 'orbit',
                color: colorOf(src.color, d.color),
                recurrence: str(src.recurrence, d.recurrence),
                start: str(src.start, d.start),
                given: str(src.given, d.given),
                steps: str(src.steps, d.steps),
                path: bool(src.path, d.path),
                size: sizeOf(src.size, d.size),
                thickness: thicknessOf(src.thickness, d.thickness),
                valueLabel: bool(src.valueLabel, d.valueLabel),
                ...(src.traced === true ? { traced: true } : {}), // 6.0 F4
                ...kept(src, ['speed']), // 6.0 F4
            };
        }
        case 'cobweb': {
            const d = cobwebDefaults();
            return {
                type: 'cobweb',
                color: colorOf(src.color, d.color),
                recurrence: str(src.recurrence, d.recurrence),
                start: str(src.start, d.start),
                steps: str(src.steps, d.steps),
                thickness: thicknessOf(src.thickness, d.thickness),
            };
        }
        case 'bifurcation': {
            const d = bifurcationDefaults();
            return {
                type: 'bifurcation',
                color: colorOf(src.color, d.color),
                recurrence: str(src.recurrence, d.recurrence),
                parameter: str(src.parameter, d.parameter).trim() || d.parameter,
                from: str(src.from, d.from),
                to: str(src.to, d.to),
                start: str(src.start, d.start),
            };
        }
        case 'newton': {
            const d = newtonDefaults();
            return {
                type: 'newton',
                color: colorOf(src.color, d.color),
                function: str(src.function, d.function).trim(),
                start: str(src.start, d.start),
                steps: str(src.steps, d.steps),
                thickness: thicknessOf(src.thickness, d.thickness),
                valueLabel: bool(src.valueLabel, d.valueLabel),
            };
        }
        case 'colourPlane': {
            const d = planeColourDefaults();
            const out: Body<PlaneColourTool> = {
                type: 'colourPlane',
                color: colorOf(src.color, d.color),
                formula: str(src.formula, d.formula),
                start: str(src.start, d.start),
                given: str(src.given, d.given),
                steps: str(src.steps, d.steps),
                opacity: fraction(src.opacity, d.opacity),
            };
            if (isPlaneColormap(src.colormap)) out.colormap = src.colormap;
            return out;
        }
        case 'fourierCircles': {
            const d = fourierCirclesDefaults();
            return {
                type: 'fourierCircles',
                color: colorOf(src.color, d.color),
                sum: str(src.sum, d.sum),
                wave: bool(src.wave, d.wave),
                thickness: thicknessOf(src.thickness, d.thickness),
                ...kept(src, ['speed']), // 6.0 F4
                // 6.0 P
                ...(typeof src.count === 'string' && src.count.trim() ? { count: src.count.trim() } : typeof src.count === 'number' && Number.isFinite(src.count) ? { count: String(src.count) } : {}),
                ...(src.path === true ? { path: true } : {}),
            };
        }
        default:
            return null;
    }
}

export interface Renamer {
    expr(src: string): string;
    tpl(src: string): string;
    ref(name: string): string;
    kind: 'function' | 'parameter' | 'tool';
}

/** The parts of a `given` field: `c = P; eta = 0.1` is [c, P], [eta, 0.1]. */
export function givenParts(given: string): Array<{ name: string; value: string }> {
    const out: Array<{ name: string; value: string }> = [];
    for (const part of String(given ?? '').split(';')) {
        const m = /^\s*\\?([A-Za-z][A-Za-z0-9_]*)\s*=(?!=)\s*([\s\S]*?)\s*$/.exec(part);
        if (m && m[2]) out.push({ name: m[1], value: m[2] });
    }
    return out;
}

/** The given field again from its parts. */
export function givenText(parts: Array<{ name: string; value: string }>): string {
    return parts.map((p) => `${p.name} = ${p.value}`).join('; ');
}

/** The right side of a recurrence `z_{n+1} = F` (F), or the text itself when it has no left side. */
function rightOf(src: string): { head: string; body: string } {
    const eq = topEquals(src);
    return eq < 0 ? { head: '', body: src } : { head: src.slice(0, eq + 1), body: src.slice(eq + 1) };
}

/** The first `=` that is no part of ==, <=, >=, != (outside brackets), or -1. */
export function topEquals(s: string): number {
    let depth = 0;
    for (let i = 0; i < s.length; i++) {
        const c = s[i];
        if (c === '(' || c === '[' || c === '{') depth++;
        else if (c === ')' || c === ']' || c === '}') depth = Math.max(0, depth - 1);
        else if (c === '=' && depth === 0 && !/[=<>!\\]/.test(s[i - 1] ?? '') && s[i + 1] !== '=') return i;
    }
    return -1;
}

/** A formula with a left side (`z_{n+1} = ...`, `f(z) = ...`) renamed on its right side only. */
function renameRight(src: string, r: Renamer): string {
    const { head, body } = rightOf(src);
    if (!head) return r.expr(src);
    const lead = body.length - body.trimStart().length;
    return head + body.slice(0, lead) + r.expr(body.slice(lead));
}

function renameGiven(given: string, r: Renamer): string {
    const parts = givenParts(given);
    if (!parts.length) return given;
    return givenText(parts.map((p) => ({ name: p.name, value: r.expr(p.value) })));
}

/** Rewrite the fields of a tool of this part after a rename. */
export function renameInIterateTool(t: Tool, r: Renamer): void {
    switch (t.type) {
        case 'orbit':
            t.recurrence = renameRight(t.recurrence, r);
            t.start = r.expr(t.start);
            t.given = renameGiven(t.given, r);
            t.steps = r.expr(t.steps);
            break;
        case 'cobweb':
            t.recurrence = renameRight(t.recurrence, r);
            t.start = r.expr(t.start);
            t.steps = r.expr(t.steps);
            break;
        case 'bifurcation':
            t.recurrence = renameRight(t.recurrence, r);
            t.from = r.expr(t.from);
            t.to = r.expr(t.to);
            t.start = r.expr(t.start);
            break;
        case 'newton':
            if (r.kind === 'function') t.function = r.ref(t.function);
            t.start = r.expr(t.start);
            t.steps = r.expr(t.steps);
            break;
        case 'colourPlane':
            t.formula = renameRight(t.formula, r);
            t.start = r.expr(t.start);
            t.given = renameGiven(t.given, r);
            t.steps = r.expr(t.steps);
            break;
        case 'fourierCircles':
            t.sum = r.expr(t.sum);
            break;
    }
}

/** Does a tool of this part read the name (`reads(src)` tests one field)? */
export function iterateToolReads(t: Tool, reads: (src: string | undefined, template?: boolean) => boolean): boolean {
    const given = (g: string) => givenParts(g).some((p) => reads(p.value));
    switch (t.type) {
        case 'orbit':
            return reads(rightOf(t.recurrence).body) || reads(t.start) || given(t.given) || reads(t.steps);
        case 'cobweb':
            return reads(rightOf(t.recurrence).body) || reads(t.start) || reads(t.steps);
        case 'bifurcation':
            return reads(rightOf(t.recurrence).body) || reads(t.from) || reads(t.to) || reads(t.start);
        case 'newton':
            return reads(t.function) || reads(t.start) || reads(t.steps);
        case 'colourPlane':
            return reads(rightOf(t.formula).body) || reads(t.start) || given(t.given) || reads(t.steps);
        case 'fourierCircles':
            return reads(t.sum);
        default:
            return false;
    }
}
