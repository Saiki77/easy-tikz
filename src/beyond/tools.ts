/*
 * The fields of the tools beyond functions (5.0) that hold formulas,
 * templates and names, for the editor's rename (a rename rewrites every
 * field that uses the old name) and its check of whether a name is still
 * used. Pure: no DOM, no Obsidian.
 */
import type { Tool } from '../types';
import { DISTRIBUTION_FIELDS } from './kinds'; // 6.2.1

export interface Renamer {
    /** A formula field with the name replaced. */
    expr(src: string): string;
    /** A label template with the name replaced. */
    tpl(src: string): string;
    /** A field that is a name: the new name when it is the old one. */
    ref(name: string): string;
    /** What is renamed. */
    kind: 'function' | 'parameter' | 'tool';
}

/** Rewrite the fields of a tool of this module after a rename. */
export function renameInBeyondTool(t: Tool, r: Renamer): void {
    switch (t.type) {
        case 'data':
            t.points = r.expr(t.points);
            break;
        case 'dataPlot':
            if (r.kind === 'tool') t.data = r.ref(t.data);
            t.label = r.tpl(t.label);
            break;
        case 'distribution':
            // 6.2.1: every kind's fields (a field another kind reads keeps its name too).
            for (const f of DISTRIBUTION_FIELDS) if (typeof t[f] === 'string') t[f] = r.expr(t[f]);
            break;
        case 'probability':
            if (r.kind === 'tool') t.distribution = r.ref(t.distribution);
            t.event = r.expr(t.event);
            t.label = r.tpl(t.label);
            break;
        case 'riemann':
            if (r.kind === 'function') t.function = r.ref(t.function);
            t.from = r.expr(t.from);
            t.to = r.expr(t.to);
            t.parts = r.expr(t.parts);
            t.label = r.tpl(t.label);
            break;
        case 'slopeField':
            t.expression = r.expr(t.expression);
            break;
        case 'solution':
            if (r.kind === 'tool') t.field = r.ref(t.field);
            t.through = r.expr(t.through);
            break;
    }
}

/** Does a tool of this module read the name (`reads(src, template)` tests one field)? */
export function beyondToolReads(t: Tool, reads: (src: string | undefined, template?: boolean) => boolean): boolean {
    switch (t.type) {
        case 'data':
            return reads(t.points);
        case 'dataPlot':
            return reads(t.label, true);
        case 'distribution':
            return DISTRIBUTION_FIELDS.some((f) => reads(t[f]));
        case 'probability':
            return reads(t.event) || reads(t.label, true);
        case 'riemann':
            return reads(t.function) || reads(t.from) || reads(t.to) || reads(t.parts) || reads(t.label, true);
        case 'slopeField':
            return reads(t.expression);
        case 'solution':
            return reads(t.through);
        default:
            return false;
    }
}
