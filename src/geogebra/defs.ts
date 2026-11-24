/*
 * 6.0 G: what a GeoGebra line is, from its text: an object of its own
 * (Circle, Segment, ..., a transform of one), a function of x (f = x^2,
 * Derivative(f)) or a value (a point, a number, a list, a matrix). A named
 * value or function is a definition of the chart, usable by name in every
 * formula as a let name is (src/values/defs.ts takes these). Pure: no DOM,
 * no Obsidian.
 */
import type { ValueDefinition } from '../values/table';
import { VNode, children, parseValue } from '../values/parse';
import { OBJECT_COMMANDS } from './syntax';
import { wholeCall } from './text';

export type GeoGebraKind = 'object' | 'function' | 'value';

const TRANSFORMS = new Set(['Translate', 'Rotate', 'Dilate', 'Reflect']);

/** The commands whose first argument is a formula in x when it is no function's name. */
const OF_X = new Set(['Root', 'Integral', 'Derivative', 'Function']);

/** The tree of a command, or null when it does not read (Text("...") holds a string). */
export function commandTree(command: string): VNode | null {
    try {
        return parseValue(command);
    } catch {
        return null;
    }
}

/** The names a formula reads that no command of it binds (Sequence's k, KeepIf's x, Curve's t, ...). */
export function unboundNames(n: VNode, bound: ReadonlySet<string> = new Set(), out: Set<string> = new Set()): Set<string> {
    const inner = (node: VNode, names: string[]) => unboundNames(node, new Set([...bound, ...names]), out);
    const name = (a: VNode | undefined) => (a && a.t === 'name' ? [a.name] : []);
    switch (n.t) {
        case 'name':
            if (!bound.has(n.name)) out.add(n.name);
            return out;
        case 'comp':
            unboundNames(n.lo, bound, out);
            unboundNames(n.hi, bound, out);
            inner(n.body, [n.index]);
            return out;
        case 'call': {
            const a = n.args;
            const rest = (from: number, to = a.length) => a.slice(from, to).forEach((x) => unboundNames(x, bound, out));
            if ((n.name === 'Sequence' && a.length >= 4) || ((n.name === 'Sum' || n.name === 'Product' || n.name === 'sum' || n.name === 'prod') && a.length === 4)) {
                inner(a[0], name(a[1]));
                rest(2);
            } else if ((n.name === 'IterationList' || n.name === 'Iteration') && a.length >= 4) {
                inner(a[0], a.slice(1, a.length - 2).flatMap(name));
                rest(a.length - 2);
            } else if ((n.name === 'KeepIf' || n.name === 'CountIf') && (a.length === 2 || a.length === 3)) {
                inner(a[0], a.length === 3 ? name(a[1]) : ['x']);
                unboundNames(a[a.length - 1], bound, out);
            } else if (n.name === 'Zip' && a.length >= 3) {
                inner(a[0], a.filter((_, i) => i % 2 === 1).flatMap(name));
                a.forEach((x, i) => {
                    if (i > 0 && i % 2 === 0) unboundNames(x, bound, out);
                });
            } else if (n.name === 'Curve' && a.length >= 5) {
                const v = name(a[a.length - 3]);
                a.slice(0, a.length - 3).forEach((x) => inner(x, v));
                rest(a.length - 2);
            } else if ((OF_X.has(n.name) || ((n.name === 'IterationList' || n.name === 'Iteration') && a.length === 3)) && a.length) {
                if (a[0].t !== 'name') inner(a[0], ['x']);
                rest(1);
            } else a.forEach((x) => unboundNames(x, bound, out));
            return out;
        }
        default:
            for (const c of children(n)) unboundNames(c, bound, out);
            return out;
    }
}

/** What a GeoGebra line is; `objects` are the names of the lines that are objects. */
export function geogebraKind(command: string, objects: ReadonlySet<string>): GeoGebraKind {
    const top = wholeCall(command.trim());
    if (top && OBJECT_COMMANDS.has(top)) return 'object';
    const tree = commandTree(command);
    if (!tree) return 'value';
    if (top && TRANSFORMS.has(top) && tree.t === 'call' && tree.args.some((a) => a.t === 'name' && objects.has(a.name))) return 'object';
    if (top === 'Derivative') return 'function';
    return unboundNames(tree).has('x') ? 'function' : 'value';
}

interface Line {
    name: string;
    command: string;
    named: boolean;
}

function linesOf(tools: unknown): Line[] {
    if (!Array.isArray(tools)) return [];
    const out: Line[] = [];
    for (const t of tools) {
        if (!t || typeof t !== 'object') continue;
        if (Reflect.get(t, 'type') !== 'geogebra') continue;
        const name: unknown = Reflect.get(t, 'name');
        const command: unknown = Reflect.get(t, 'command');
        if (typeof name !== 'string' || typeof command !== 'string') continue;
        out.push({ name, command, named: Reflect.get(t, 'named') !== false });
    }
    return out;
}

/** The names of the GeoGebra lines that are objects (a transform of an object is one too). */
export function objectNames(tools: unknown): Set<string> {
    const lines = linesOf(tools);
    const out = new Set<string>();
    for (;;) {
        let grew = false;
        for (const l of lines) {
            if (out.has(l.name) || geogebraKind(l.command, out) !== 'object') continue;
            out.add(l.name);
            grew = true;
        }
        if (!grew) return out;
    }
}

/** The named GeoGebra lines that are values or functions of x, as definitions of the chart. */
export function geogebraDefinitions(tools: unknown): ValueDefinition[] {
    const objects = objectNames(tools);
    const out: ValueDefinition[] = [];
    for (const l of linesOf(tools)) {
        if (!l.named || objects.has(l.name)) continue;
        const kind = geogebraKind(l.command, objects);
        out.push({ name: l.name, params: kind === 'function' ? ['x'] : [], expression: l.command });
    }
    return out;
}
