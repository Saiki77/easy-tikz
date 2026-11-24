/*
 * 6.0 A: the fields of the tools of values that hold formulas, templates
 * and names, for the editor's rename (src/beyond/tools.ts pattern) and its
 * check of whether a name is still used. A parameter of a let function is
 * its own name inside the function: a slider or a tool of the same name is
 * renamed everywhere but there. Pure: no DOM, no Obsidian.
 */
import type { Tool } from '../types';
import type { Renamer } from '../beyond/tools';

/** The parameters of a let function, by name. */
function paramsOf(params: string): string[] {
    return params
        .split(',')
        .map((p) => p.trim())
        .filter((p) => p);
}

/** Rewrite the fields of a tool of this module after a rename of `from`; false for other tools. */
export function renameInValueTool(t: Tool, r: Renamer, from: string): boolean {
    switch (t.type) {
        case 'value':
            if (!paramsOf(t.params).includes(from)) t.expression = r.expr(t.expression);
            return true;
        case 'vector':
            t.vectors = r.expr(t.vectors);
            t.from = r.expr(t.from);
            t.label = r.tpl(t.label);
            return true;
        case 'listPoints':
            t.points = r.expr(t.points);
            t.label = r.tpl(t.label);
            return true;
        default:
            return false;
    }
}

/** Does a tool of this module read the name? Null for other tools. */
export function valueToolReads(t: Tool, name: string, reads: (src: string | undefined, template?: boolean) => boolean): boolean | null {
    switch (t.type) {
        case 'value':
            return !paramsOf(t.params).includes(name) && reads(t.expression);
        case 'vector':
            return reads(t.vectors) || reads(t.from) || reads(t.label, true);
        case 'listPoints':
            return reads(t.points) || reads(t.label, true);
        default:
            return null;
    }
}
