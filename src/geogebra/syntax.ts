/*
 * 6.0 G: GeoGebra's way of writing formulas, read as the plugin's plain
 * syntax: list braces {1, 2, 3} are the brackets of a list [1, 2, 3]
 * (and {{1, 2}, {3, 4}} a matrix), ί is the imaginary unit i and ℯ is e.
 * Every change keeps the length of the text, so the positions of problems
 * stay where they were typed. A formula is read the GeoGebra way only when
 * it has no LaTeX (no backslash command, no ^{ or _{) and its braces hold a
 * list (a comma inside) or it calls a GeoGebra command; `{x + 1}^2` and the
 * placeholders of labels read as before. No imports: src/expr.ts and
 * src/latex.ts use it. Pure: no DOM, no Obsidian.
 */

/** The commands that compute a value (src/geogebra/commands.ts), with GeoGebra's names. */
export const VALUE_COMMANDS: ReadonlySet<string> = new Set([
    'Sequence', 'IterationList', 'Iteration', 'KeepIf', 'CountIf', 'Element', 'Zip', 'Sum', 'Product', 'Length',
    'First', 'Last', 'Append', 'Join', 'Reverse', 'Sort', 'Max', 'Min', 'Mean', 'Flatten', 'Take', 'Unique',
    'If', 'Vector', 'UnitVector', 'Dot', 'Cross', 'Determinant', 'Transpose', 'Invert', 'Root', 'Integral',
    'Derivative', 'Midpoint', 'Distance', 'Translate', 'Rotate', 'Dilate', 'Reflect', 'Point',
]);

/** The commands that draw an object of their own (src/geogebra/objects.ts); Vector and the transforms do both. */
export const OBJECT_COMMANDS: ReadonlySet<string> = new Set(['Circle', 'Segment', 'Line', 'Ray', 'Polygon', 'Polyline', 'Curve', 'Text', 'Slider', 'Function']);

/** GeoGebra's functions written in lower case (x(P), conjugate(z), ...): values only, never a list reading of braces. */
export const LOWER_FUNCTIONS: ReadonlySet<string> = new Set(['conjugate', 'real', 'imaginary', 'sgn']);

/** Every GeoGebra command the plugin knows, capitalised as GeoGebra writes them. */
export function isGeoGebraCommand(name: string): boolean {
    return VALUE_COMMANDS.has(name) || OBJECT_COMMANDS.has(name);
}

const CALL_RE = /([A-Za-z][A-Za-z0-9_]*)\s*\(/g;

/** Does the text call one of the GeoGebra commands? */
export function callsGeoGebra(src: string): boolean {
    CALL_RE.lastIndex = 0;
    for (let m = CALL_RE.exec(src); m; m = CALL_RE.exec(src)) {
        const before = m.index > 0 ? src[m.index - 1] : '';
        if (before === '\\' || before === '.') continue;
        if (isGeoGebraCommand(m[1])) return true;
    }
    return false;
}

/** LaTeX markers: a backslash command, or a group after ^ or _ (as src/expr.ts isLatexFormula). */
const LATEX_RE = /\\[A-Za-z]|[\^_]\s*\{/;

/** A brace group that holds a comma of its own depth: {1, 2}, {{1, 2}, {3, 4}}. */
function hasBraceList(src: string): boolean {
    const stack: Array<{ brace: boolean; comma: boolean }> = [];
    let quote = false;
    for (let i = 0; i < src.length; i++) {
        const c = src[i];
        if (quote) {
            if (c === '\\') i++;
            else if (c === '"') quote = false;
            continue;
        }
        if (c === '"') quote = true;
        else if (c === '{' || c === '(' || c === '[') stack.push({ brace: c === '{', comma: false });
        else if (c === '}' || c === ')' || c === ']') {
            const top = stack.pop();
            if (top && top.brace && c === '}' && top.comma) return true;
        } else if (c === ',' && stack.length) stack[stack.length - 1].comma = true;
    }
    return false;
}

/**
 * A formula written the GeoGebra way: braces with no LaTeX around them,
 * holding a list or in a formula that calls a GeoGebra command.
 */
export function isGeoGebraFormula(src: string): boolean {
    if (src.indexOf('{') < 0 || LATEX_RE.test(src)) return false;
    return hasBraceList(src) || callsGeoGebra(src);
}

/**
 * The formula in the plain syntax, as long as it was: {...} lists as
 * [...] (when it is a GeoGebra formula), ί as i, ℯ as e. Anything else
 * stays as it is.
 */
export function geogebraPlain(src: string): string {
    let out = src;
    if (out.indexOf('ί') >= 0) out = out.replace(/ί/g, 'i');
    if (out.indexOf('ℯ') >= 0) out = out.replace(/ℯ/g, 'e');
    if (isGeoGebraFormula(out)) out = out.replace(/[{}]/g, (c) => (c === '{' ? '[' : ']'));
    return out;
}
