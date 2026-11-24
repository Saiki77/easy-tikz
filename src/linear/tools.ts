/*
 * The tools of linear algebra and complex maps (6.0 D) as data: their
 * defaults, what the migration keeps of a stored one, and their fields for
 * the editor's rename (the pattern of src/motion6/tools.ts). Pure: no DOM,
 * no Obsidian.
 */
import type { BasisVectorsTool, EigenvectorsTool, PlaneGridTool, SpanTool, Tool, TransformTool, UnitSquareTool } from '../types';
import { THICKNESS_MAP } from '../colors';

type Data = Record<string, unknown>;
type Body<T> = Omit<T, 'id' | 'name' | 'hidden'>;
export type LinearBody = Body<PlaneGridTool> | Body<BasisVectorsTool> | Body<TransformTool> | Body<EigenvectorsTool> | Body<UnitSquareTool> | Body<SpanTool>;

/** The tool types of this part. */
export const LINEAR_TYPES: ReadonlySet<string> = new Set(['planeGrid', 'basisVectors', 'transform', 'eigenvectors', 'unitSquare', 'span']);

/** Name prefixes (G1, BV1, T1, EV1, U1, SP1). */
export const LINEAR_PREFIX = { planeGrid: 'G', basisVectors: 'BV', transform: 'T', eigenvectors: 'EV', unitSquare: 'U', span: 'SP' } as const;

const str = (v: unknown, fallback: string): string => (typeof v === 'string' ? v : typeof v === 'number' && Number.isFinite(v) ? String(v) : fallback);
const bool = (v: unknown, fallback: boolean): boolean => (typeof v === 'boolean' ? v : fallback);
const colorOf = (v: unknown, fallback: string): string => (typeof v === 'string' && v.trim() ? v.trim() : fallback);
const thicknessOf = (v: unknown, fallback: string): string => (typeof v === 'string' && Object.prototype.hasOwnProperty.call(THICKNESS_MAP, v) ? v : fallback);
const fraction = (v: unknown, fallback: number): number => (typeof v === 'number' && Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : fallback);

export function planeGridDefaults(): Body<PlaneGridTool> {
    return { type: 'planeGrid', color: 'blue', from: '', to: '', spacing: '', thickness: 'thin' };
}

export function basisVectorsDefaults(): Body<BasisVectorsTool> {
    return { type: 'basisVectors', color: 'green', thickness: 'very thick', valueLabel: true };
}

export function transformDefaults(): Body<TransformTool> {
    return { type: 'transform', color: 'black', map: '' };
}

export function eigenvectorsDefaults(): Body<EigenvectorsTool> {
    return { type: 'eigenvectors', color: 'orange', matrix: '', thickness: 'thick', dashed: false, valueLabel: false };
}

export function unitSquareDefaults(): Body<UnitSquareTool> {
    return { type: 'unitSquare', color: 'purple', image: false, fillOpacity: 0.3, label: '', valueLabel: false };
}

export function spanDefaults(): Body<SpanTool> {
    return { type: 'span', color: 'teal', vectors: '', fillOpacity: 0.15, thickness: 'thick', valueLabel: false };
}

/** The defaults of a type of this part; null for other types. */
export function linearDefaults(type: string): LinearBody | null {
    switch (type) {
        case 'planeGrid':
            return planeGridDefaults();
        case 'basisVectors':
            return basisVectorsDefaults();
        case 'transform':
            return transformDefaults();
        case 'eigenvectors':
            return eigenvectorsDefaults();
        case 'unitSquare':
            return unitSquareDefaults();
        case 'span':
            return spanDefaults();
        default:
            return null;
    }
}

/** A stored tool of this part with every field it needs (unknown values give way to the defaults); null for other types. */
export function completeLinearTool(src: Data): LinearBody | null {
    switch (src.type) {
        case 'planeGrid': {
            const d = planeGridDefaults();
            return {
                type: 'planeGrid',
                color: colorOf(src.color, d.color),
                from: str(src.from, d.from),
                to: str(src.to, d.to),
                spacing: str(src.spacing, d.spacing),
                thickness: thicknessOf(src.thickness, d.thickness),
            };
        }
        case 'basisVectors': {
            const d = basisVectorsDefaults();
            return { type: 'basisVectors', color: colorOf(src.color, d.color), thickness: thicknessOf(src.thickness, d.thickness), valueLabel: bool(src.valueLabel, d.valueLabel) };
        }
        case 'transform': {
            const d = transformDefaults();
            return { type: 'transform', color: colorOf(src.color, d.color), map: str(src.map, d.map) };
        }
        case 'eigenvectors': {
            const d = eigenvectorsDefaults();
            return {
                type: 'eigenvectors',
                color: colorOf(src.color, d.color),
                matrix: str(src.matrix, d.matrix),
                thickness: thicknessOf(src.thickness, d.thickness),
                dashed: bool(src.dashed, d.dashed),
                valueLabel: bool(src.valueLabel, d.valueLabel),
            };
        }
        case 'unitSquare': {
            const d = unitSquareDefaults();
            return {
                type: 'unitSquare',
                color: colorOf(src.color, d.color),
                image: bool(src.image, d.image),
                fillOpacity: fraction(src.fillOpacity, d.fillOpacity),
                label: str(src.label, d.label),
                valueLabel: bool(src.valueLabel, d.valueLabel),
            };
        }
        case 'span': {
            const d = spanDefaults();
            return {
                type: 'span',
                color: colorOf(src.color, d.color),
                vectors: str(src.vectors, d.vectors),
                fillOpacity: fraction(src.fillOpacity, d.fillOpacity),
                thickness: thicknessOf(src.thickness, d.thickness),
                valueLabel: bool(src.valueLabel, d.valueLabel),
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

/** `v; w` with each formula renamed. */
const eachVector = (src: string, r: Renamer) =>
    src
        .split(';')
        .map((v) => r.expr(v.trim()))
        .join('; ');

/** Rewrite the fields of a tool of this part after a rename. */
export function renameInLinearTool(t: Tool, r: Renamer): void {
    switch (t.type) {
        case 'planeGrid':
            t.from = r.expr(t.from);
            t.to = r.expr(t.to);
            t.spacing = r.expr(t.spacing);
            break;
        case 'transform':
            t.map = r.expr(t.map);
            break;
        case 'eigenvectors':
            t.matrix = r.expr(t.matrix);
            break;
        case 'unitSquare':
            t.label = r.tpl(t.label);
            break;
        case 'span':
            t.vectors = eachVector(t.vectors, r);
            break;
    }
}

/** Does a tool of this part read the name (`reads(src)` tests one field)? */
export function linearToolReads(t: Tool, reads: (src: string | undefined, template?: boolean) => boolean): boolean {
    switch (t.type) {
        case 'planeGrid':
            return reads(t.from) || reads(t.to) || reads(t.spacing);
        case 'transform':
            return reads(t.map);
        case 'eigenvectors':
            return reads(t.matrix);
        case 'unitSquare':
            return reads(t.label, true);
        case 'span':
            return reads(t.vectors);
        default:
            return false;
    }
}
