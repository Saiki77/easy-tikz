/*
 * 6.0 ML: function names as machine learning notes write them. A
 * definition may start with a Greek letter (`\sigma(x) = ...`) or a name in
 * a text command (`\mathrm{ReLU}(x)`, `\operatorname{softplus}(x)`,
 * `\text{relu}(x)`): the function is named by the plain name (sigma, ReLU,
 * softplus, relu), so other formulas call it (`\sigma(2x)` reads as
 * sigma(2x)), and the head is kept as written for the printed line.
 * Also here: when `t` may name a function (`t(x) = ...`, a function of x;
 * t stays the parameter of parametric curves). Pure: no DOM, no Obsidian.
 */

/** Greek letters a function may be named by (pi and theta are a constant and the polar variable). */
const GREEK_HEADS: ReadonlySet<string> = new Set([
    'alpha', 'beta', 'gamma', 'delta', 'epsilon', 'varepsilon', 'zeta', 'eta', 'vartheta', 'iota', 'kappa', 'lambda',
    'mu', 'nu', 'xi', 'rho', 'sigma', 'tau', 'upsilon', 'phi', 'varphi', 'chi', 'psi', 'omega',
    'Gamma', 'Delta', 'Lambda', 'Xi', 'Pi', 'Sigma', 'Upsilon', 'Phi', 'Psi', 'Omega',
]);

/** Text commands whose argument may name a function. */
const TEXT_HEAD = /^\\(mathrm|operatorname|text|textrm|textit|mathit|mathsf|mathbf)\s*\{\s*([A-Za-z][A-Za-z0-9_]*)\s*\}/;
const GREEK_HEAD = /^\\([A-Za-z]+)(?![A-Za-z])/;

export interface TexHead {
    /** The plain name the function has (sigma, ReLU). */
    name: string;
    /** The head as the line writes it (\sigma, \mathrm{ReLU}). */
    head: string;
    /** The text with the head written as the plain name (sigma(x) = ...). */
    rest: string;
}

/** A head at the start of `text` followed by `(`, or null. */
export function readTexHead(text: string): TexHead | null {
    const t = text.trimStart();
    let name: string;
    let head: string;
    let len: number;
    const named = TEXT_HEAD.exec(t);
    if (named) {
        name = named[2];
        head = `\\${named[1]}{${named[2]}}`;
        len = named[0].length;
    } else {
        const greek = GREEK_HEAD.exec(t);
        if (!greek || !GREEK_HEADS.has(greek[1])) return null;
        name = greek[1];
        head = `\\${greek[1]}`;
        len = greek[0].length;
    }
    const after = t.slice(len);
    if (!/^\s*\(/.test(after)) return null;
    return { name, head, rest: name + after };
}

/** The plain name of a head (\mathrm{ReLU} is ReLU, \sigma is sigma), or null when it is no head. */
export function headName(head: string): string | null {
    const r = readTexHead(`${head}(x)`);
    return r && r.head === head ? r.name : null;
}

/** Whether `t` names a function here: a function of x (one variable), so the parameter t of parametric curves stays as it is. */
export function tNamesFunction(name: string, variable: string, second: string | undefined): boolean {
    return name === 't' && variable === 'x' && !second;
}
