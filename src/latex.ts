/*
 * LaTeX math as formulas (5.0): `\frac{1}{2}x^2 - 2`, `\sqrt{x}\,e^{-x}`,
 * `x + y \le 4`, `\sin x`, `|x|`, Greek letters. latexToPlain turns it into
 * the plugin's own formula syntax, which the parser (src/expr.ts) reads; a
 * formula without a backslash or a brace is the plain syntax already and
 * stays as it is, so 4.x charts read as before. Pure: no DOM, no Obsidian.
 */

/** A backslash, a brace or a single bar (|x|, not the `||` of or): the formula is LaTeX (the plain syntax has none of them). */
export function looksLikeLatex(src: string): boolean {
    return /[\\{}]/.test(src) || /(^|[^|])\|(?!\|)/.test(src);
}

/** Functions LaTeX writes as commands: `\sin x` is sin(x). */
const FUNCTIONS = new Set([
    'sin', 'cos', 'tan', 'cot', 'sec', 'csc', 'arcsin', 'arccos', 'arctan', 'sinh', 'cosh', 'tanh', 'ln', 'log', 'exp', 'min', 'max',
    // 6.0 A: values (src/values/): \arg z, \det A, \Re z, \Im z.
    'arg', 'det', 'Re', 'Im',
]);

/** The arc functions as the formulas name them: `\arcsin x` is asin(x). 6.0 A: \Re z is re(z), \Im z is im(z). */
const ARC: Record<string, string> = { arcsin: 'asin', arccos: 'acos', arctan: 'atan', Re: 're', Im: 'im' };

/** 6.0 A: names in \operatorname{...} that are functions of a value: `\operatorname{tr} A` is tr(A). */
const VALUE_OPERATORS: Record<string, string> = { tr: 'tr', Tr: 'tr', trace: 'tr', det: 'det', Re: 're', Im: 'im', arg: 'arg', Arg: 'arg', conj: 'conj', diag: 'diag', rank: 'rank' };

/** Commands that are an operator or a relation. */
const SYMBOLS: Record<string, string> = {
    // 6.0 A: \times is × (a cross product between two vectors, a product otherwise).
    cdot: '*', times: '×', div: '/', ast: '*',
    le: '<=', leq: '<=', leqslant: '<=', ge: '>=', geq: '>=', geqslant: '>=', lt: '<', gt: '>',
    lvert: '|', rvert: '|', vert: '|', mid: '|', lVert: '|', rVert: '|', Vert: '|',
    quad: ' ', qquad: ' ', ',': ' ', ';': ' ', ':': ' ', '!': '', ' ': ' ',
    '{': '(', '}': ')', '|': '|',
    varphi: 'phi', vartheta: 'theta', varepsilon: 'epsilon',
};

/** Commands whose argument is plain text or a name: `\operatorname{sgn}`, `\mathrm{e}`. */
const TEXT_COMMANDS = new Set(['operatorname', 'mathrm', 'text', 'mathit', 'mathbf', 'textrm', 'mathsf']);

/**
 * The plugin's formula syntax for a LaTeX formula: `\frac{a}{b}` is `((a)/(b))`,
 * `\sqrt[n]{a}` is `((a)^(1/(n)))`, `^{...}` is `^(...)`, `x_{1}` is `x_1`,
 * `\left(` is `(`, `|x|` is `abs(x)`, and `\alpha` is the name alpha.
 */
export function latexToPlain(src: string): string {
    if (!looksLikeLatex(src)) return src;
    return absolute(convert(src));
}

function convert(s: string): string {
    let i = 0;
    let out = '';
    const spaces = () => {
        while (i < s.length && /\s/.test(s[i])) i++;
    };
    /** The braced group at i (after its `{`), converted, with i after its `}`. */
    const group = (): string => {
        i++;
        const start = i;
        let depth = 1;
        while (i < s.length) {
            if (s[i] === '\\') {
                i += 2;
                continue;
            }
            if (s[i] === '{') depth++;
            else if (s[i] === '}' && --depth === 0) break;
            i++;
        }
        const inner = s.slice(start, Math.min(i, s.length));
        if (s[i] === '}') i++;
        return convert(inner);
    };
    /** One argument: a braced group, a command, or one character. */
    const arg = (): string => {
        spaces();
        if (s[i] === '{') return group();
        if (s[i] === '\\') return command();
        return s[i++] ?? '';
    };
    /** The argument of `\sin x`: a bracket or a group as it is, else the next number and name (`2x`). */
    const fnArg = (): string => {
        spaces();
        if (s[i] === '(') return '';
        if (s[i] === '{') return `(${group()})`;
        // `\ln|x|`: the bars are the argument.
        if (s[i] === '|') {
            const end = s.indexOf('|', i + 1);
            const bars = s.slice(i, end < 0 ? s.length : end + 1);
            i += bars.length;
            return `(${convert(bars)})`;
        }
        const m = /^[0-9.]*(?:\\[A-Za-z]+|[A-Za-z](?:_[A-Za-z0-9]+)?)?/.exec(s.slice(i));
        const atom = m ? m[0] : '';
        i += atom.length;
        return `(${convert(atom)})`;
    };
    /** `(...)` after a function with a power (`\cos^2(x)`): its argument, read to the matching bracket. */
    const parenArg = (): string => {
        spaces();
        if (s[i] !== '(') return '';
        let depth = 0;
        let j = i;
        for (; j < s.length; j++) {
            if (s[j] === '(') depth++;
            else if (s[j] === ')' && --depth === 0) break;
        }
        const inner = s.slice(i + 1, j);
        i = Math.min(s.length, j + 1);
        return `(${convert(inner)})`;
    };
    /** The raw text of the next argument (a braced group without its braces, a command, or one character), with i after it. */
    const rawArg = (): string => {
        spaces();
        if (s[i] === '{') {
            const start = i + 1;
            let depth = 0;
            for (; i < s.length; i++) {
                if (s[i] === '\\') {
                    i++;
                    continue;
                }
                if (s[i] === '{') depth++;
                else if (s[i] === '}' && --depth === 0) break;
            }
            const inner = s.slice(start, Math.min(i, s.length));
            if (s[i] === '}') i++;
            return inner;
        }
        if (s[i] === '\\') {
            const m = /^\\(?:[A-Za-z]+|.)/.exec(s.slice(i));
            const cmd = m ? m[0] : '\\';
            i += cmd.length;
            return cmd;
        }
        return s[i++] ?? '';
    };
    /**
     * 6.0 A: the summand of `\sum_{k=1}^{n}`, read the way it is meant: up to
     * a `+` or `-` (a sign at its start belongs to it), a relation, a comma
     * or the bracket that closes around the sum, whichever comes first.
     */
    const summand = (): string => {
        spaces();
        const start = i;
        let depth = 0;
        let bars = 0;
        let first = true;
        let j = i;
        while (j < s.length) {
            const c = s[j];
            if (c === '\\') {
                const m = /^\\([A-Za-z]+|.)/.exec(s.slice(j));
                const cmd = m ? m[1] : '';
                if (depth === 0 && bars === 0 && (SUMMAND_ENDS.has(cmd) || cmd === '}' || cmd === '\\')) break;
                j += m ? m[0].length : 1;
                first = false;
                continue;
            }
            if (c === '{' || c === '(' || c === '[') depth++;
            else if (c === '}' || c === ')' || c === ']') {
                if (depth === 0) break;
                depth--;
            } else if (c === '|' && depth === 0) bars = bars ? 0 : 1;
            else if (depth === 0 && bars === 0 && !first && (c === '+' || c === '-')) break;
            else if (depth === 0 && bars === 0 && /[=<>,;:&]/.test(c)) break;
            if (!/\s/.test(c)) first = false;
            j++;
        }
        i = j;
        return s.slice(start, j);
    };
    /** 6.0 A: the LaTeX of values as the plain syntax (src/values/): null for any other command. */
    const valueCommand = (name: string): string | null => {
        if (name === 'begin') {
            const m = /^\s*\{\s*([A-Za-z]+\*?)\s*\}/.exec(s.slice(i));
            if (!m || !MATRIX_ENVS.has(m[1])) return null;
            i += m[0].length;
            const end = new RegExp(String.raw`\\end\s*\{\s*${m[1].replace('*', '\\*')}\s*\}`, 'g');
            end.lastIndex = i;
            const close = end.exec(s);
            const body = s.slice(i, close ? close.index : s.length);
            i = close ? close.index + close[0].length : s.length;
            const text = matrixText(body, convert);
            return m[1] === 'vmatrix' || m[1] === 'Vmatrix' ? ` det(${text})` : ` ${text}`;
        }
        if (name === 'sum' || name === 'prod') {
            let index = '';
            let lo = '';
            let hi = '';
            for (let k = 0; k < 2; k++) {
                spaces();
                if (s[i] === '_') {
                    i++;
                    const sub = rawArg();
                    const eq = sub.indexOf('=');
                    if (eq > 0) {
                        index = convert(sub.slice(0, eq)).replace(/\s+/g, '');
                        lo = convert(sub.slice(eq + 1));
                    }
                } else if (s[i] === '^') {
                    i++;
                    hi = convert(rawArg());
                }
            }
            if (!/^[A-Za-z][A-Za-z0-9_]*$/.test(index) || !lo.trim() || !hi.trim()) return ` ${name} `;
            return ` ${name}((${convert(summand())}), ${index}, (${lo}), (${hi})) `;
        }
        if (name === 'binom' || name === 'dbinom' || name === 'tbinom') {
            const n = arg();
            const k = arg();
            return ` binom((${n}), (${k}))`;
        }
        if (name === 'bar' || name === 'overline') return ` conj(${arg()})`;
        if (name === 'nabla') {
            spaces();
            const m = /^(?:\\([A-Za-z]+)|([A-Za-z](?:_\{?[A-Za-z0-9]+\}?)?))/.exec(s.slice(i));
            if (!m) return ' nabla ';
            i += m[0].length;
            const fn = m[1] ?? m[2].replace(/[{}]/g, '');
            const at = parenArg();
            return at ? ` grad(${fn}, ${at.slice(1, -1)})` : ` grad(${fn})`;
        }
        if (name === '{') {
            let depth = 0;
            let j = i;
            for (; j < s.length; j++) {
                if (s[j] !== '\\') continue;
                if (s[j + 1] === '{') depth++;
                else if (s[j + 1] === '}') {
                    if (depth === 0) break;
                    depth--;
                }
                j++;
            }
            if (j >= s.length) return null;
            const text = setText(s.slice(i, j), convert);
            if (text === null) return null;
            i = j + 2;
            return ` ${text}`;
        }
        return null;
    };
    const command = (): string => {
        i++;
        const m = /^[A-Za-z]+/.exec(s.slice(i));
        const name = m ? m[0] : s[i] ?? '';
        i += name.length || 1;
        // 6.0 A: matrices, sums and products, binomials, conjugates, gradients and lists (src/values/).
        const value = valueCommand(name);
        if (value !== null) return value;
        if (name === 'frac' || name === 'dfrac' || name === 'tfrac') {
            const a = arg();
            const b = arg();
            // A new word: `a\frac{1}{2}` is a times a half (the spaces go at the end).
            return ` ((${a})/(${b}))`;
        }
        if (name === 'sqrt') {
            spaces();
            let n = '';
            if (s[i] === '[') {
                const end = s.indexOf(']', i);
                n = convert(s.slice(i + 1, end < 0 ? s.length : end));
                i = end < 0 ? s.length : end + 1;
            }
            const a = arg();
            return n ? ` ((${a})^(1/(${n})))` : ` sqrt(${a})`;
        }
        if (name === 'left' || name === 'right' || name === 'bigl' || name === 'bigr' || name === 'Bigl' || name === 'Bigr') {
            spaces();
            if (s[i] === '.') {
                i++;
                return '';
            }
            if (s[i] === '\\') return command();
            return s[i++] ?? '';
        }
        if (TEXT_COMMANDS.has(name)) {
            // 6.0 A: \operatorname{tr} A is tr(A).
            const text = arg().replace(/\s+/g, '');
            const op = (name === 'operatorname' || name === 'mathrm') && Object.prototype.hasOwnProperty.call(VALUE_OPERATORS, text) ? VALUE_OPERATORS[text] : undefined;
            return op ? ` ${op}${fnArg() || parenArg()}` : ` ${text}`;
        }
        if (FUNCTIONS.has(name)) {
            spaces();
            const fn = ARC[name] ?? name;
            // `\sin^2 x` and `\cos^2(x)` are (sin x)^2 and (cos x)^2.
            if (s[i] === '^') {
                i++;
                const power = arg();
                return ` ${fn}${fnArg() || parenArg()}^(${power})`;
            }
            // A new word: `a\sin x` is a times sin x, never asin (the arcsine).
            return ` ${fn}${fnArg()}`;
        }
        if (name in SYMBOLS) return SYMBOLS[name];
        // Greek letters and other names: \alpha is alpha, \pi is pi, \theta is theta.
        return /^[A-Za-z]+$/.test(name) ? ` ${name} ` : '';
    };
    while (i < s.length) {
        const c = s[i];
        if (c === '\\') out += command();
        else if (c === '{') out += `(${group()})`;
        else if (c === '}') {
            out += ')';
            i++;
        } else if (c === '^') {
            i++;
            spaces();
            out += s[i] === '{' ? `^(${group()})` : '^';
        } else if (c === '_') {
            i++;
            spaces();
            // A subscript is part of the name: x_{1} is x_1, a_{max} is a_max.
            out += '_' + (s[i] === '{' ? group() : s[i++] ?? '').replace(/[^A-Za-z0-9]+/g, '');
        } else {
            out += c;
            i++;
        }
    }
    return out.replace(/ {2,}/g, ' ').trim();
}

// ------------------------------------------------------------- 6.0 A values

/** Matrix environments: their rows are vectors (one column) or matrices. */
const MATRIX_ENVS = new Set(['pmatrix', 'bmatrix', 'Bmatrix', 'matrix', 'vmatrix', 'Vmatrix', 'smallmatrix', 'pmatrix*', 'bmatrix*']);

/** Commands that end the summand of a sum: relations, and the right half of \left ... \right. */
const SUMMAND_ENDS = new Set(['le', 'leq', 'leqslant', 'ge', 'geq', 'geqslant', 'lt', 'gt', 'ne', 'neq', 'mid', 'right', 'quad', 'qquad', 'to', 'mapsto']);

/** Pieces of `src` split at `sep` (one character, or `\\`), outside braces, brackets and \left ... \right. */
function splitLatex(src: string, sep: string): string[] {
    const out: string[] = [];
    let depth = 0;
    let start = 0;
    for (let i = 0; i < src.length; i++) {
        const c = src[i];
        if (c === '\\') {
            if (sep === '\\\\' && src[i + 1] === '\\' && depth === 0) {
                out.push(src.slice(start, i));
                start = i + 2;
            }
            i++;
            continue;
        }
        if (c === '{' || c === '(' || c === '[') depth++;
        else if (c === '}' || c === ')' || c === ']') depth = Math.max(0, depth - 1);
        else if (depth === 0 && c === sep) {
            out.push(src.slice(start, i));
            start = i + 1;
        }
    }
    out.push(src.slice(start));
    return out;
}

/** `1 & 2 \\ 3 & 4` as [[1, 2], [3, 4]]; one column is a vector, (1, 2). */
function matrixText(body: string, convert: (s: string) => string): string {
    const rows = splitLatex(body, '\\\\')
        .map((r) => splitLatex(r, '&').map((c) => convert(c)))
        .filter((r) => r.some((c) => c.trim()));
    if (!rows.length) return '()';
    if (rows.every((r) => r.length === 1)) return `(${rows.map((r) => r[0]).join(', ')})`;
    return `[${rows.map((r) => `[${r.join(', ')}]`).join(', ')}]`;
}

/** A piece of a list that only says "and so on": \dots, \ldots, \cdots, ... */
const DOTS = /^\s*(?:\\(?:dots|ldots|cdots|dotsc|dotsb)|\.\.\.)\s*$/;

/**
 * The inside of `\{ ... \}` as a list: `(k, k^2) : k = 1, \dots, 10` is
 * [(k, k^2) : k = 1..10] (also with \mid, and k \in \{1, \dots, 10\}),
 * `1, 2, 3` is [1, 2, 3]. Null when it is neither (the braces then group).
 */
function setText(inner: string, convert: (s: string) => string): string | null {
    let at = -1;
    let len = 0;
    let depth = 0;
    for (let i = 0; i < inner.length && at < 0; i++) {
        const c = inner[i];
        if (c === '\\') {
            if (depth === 0 && /^\\mid(?![A-Za-z])/.test(inner.slice(i))) {
                at = i;
                len = 4;
            }
            i++;
            continue;
        }
        if (c === '{' || c === '(' || c === '[') depth++;
        else if (c === '}' || c === ')' || c === ']') depth = Math.max(0, depth - 1);
        else if (depth === 0 && c === ':') {
            at = i;
            len = 1;
        }
    }
    if (at < 0) {
        const items = splitLatex(inner, ',');
        return items.length > 1 ? `[${items.map((p) => convert(p)).join(', ')}]` : null;
    }
    const body = inner.slice(0, at);
    const spec = /^\s*(\\[A-Za-z]+|[A-Za-z](?:_\{?[A-Za-z0-9]+\}?)?)\s*(?:=|\\in(?![A-Za-z]))\s*([\s\S]*)$/.exec(inner.slice(at + len));
    if (!spec) return null;
    const index = convert(spec[1]).replace(/[\s{}]+/g, '');
    let range = spec[2].trim();
    const braced = /^\\\{([\s\S]*)\\\}$/.exec(range);
    if (braced) range = braced[1];
    let items = splitLatex(range, ',').filter((p) => p.trim() && !DOTS.test(p));
    if (items.length === 1 && items[0].includes('..')) items = items[0].split('..');
    if (items.length < 2 || !/^[A-Za-z][A-Za-z0-9_]*$/.test(index)) return null;
    return `[(${convert(body)}) : ${index} = (${convert(items[0])})..(${convert(items[items.length - 1])})]`;
}

/** `|x|` pairs as abs(x): a bar opens where a value cannot end, and closes otherwise. */
function absolute(s: string): string {
    if (!s.includes('|')) return s;
    let out = '';
    let open = 0;
    for (let i = 0; i < s.length; i++) {
        if (s[i] !== '|') {
            out += s[i];
            continue;
        }
        // `||` is or, not two bars.
        if (s[i + 1] === '|') {
            out += '||';
            i++;
            continue;
        }
        const before = out.replace(/\s+$/, '');
        const opens = open === 0 || /(^|[(+\-*/^,=<>])$/.test(before);
        if (opens) {
            out += 'abs(';
            open++;
        } else {
            out += ')';
            open--;
        }
    }
    return out + ')'.repeat(Math.max(0, open));
}

/** Letter runs that stay one name in a formula from a note: functions, the names LaTeX spells out, and and/or/not. */
const WORDS = new Set([...FUNCTIONS, 'sqrt', 'abs', 'pi', 'theta', 'alpha', 'beta', 'gamma', 'delta', 'lambda', 'mu', 'sigma', 'omega', 'phi', 'rho', 'tau', 'and', 'or', 'not']);

/**
 * A formula from a note read as LaTeX reads it: `ax^2 + bx` is a·x² + b·x,
 * so a run of letters becomes single letters. A command (`\sin`), the
 * argument of `\mathrm{...}` or `\text{...}`, a name with a digit or `_`
 * (x_1, f1), a known word (sin, theta) and a name right before a bracket
 * (demand(x)) stay as they are.
 */
export function splitLetterRuns(tex: string, keep: ReadonlySet<string> = new Set()): string {
    let out = '';
    let i = 0;
    while (i < tex.length) {
        const c = tex[i];
        if (c === '\\') {
            const m = /^\\([A-Za-z]+|.)/.exec(tex.slice(i));
            const cmd = m ? m[0] : c;
            out += cmd;
            i += cmd.length;
            // The argument of a text command is a name: keep it whole.
            // 6.0 A: so is the name of an environment (\begin{pmatrix}).
            if (m && (TEXT_COMMANDS.has(m[1]) || m[1] === 'begin' || m[1] === 'end') && tex[i] === '{') {
                const end = tex.indexOf('}', i);
                const stop = end < 0 ? tex.length : end + 1;
                out += tex.slice(i, stop);
                i = stop;
            }
            continue;
        }
        const run = /^[A-Za-z]+(?:[0-9_][A-Za-z0-9_]*)?/.exec(tex.slice(i));
        if (!run) {
            out += c;
            i++;
            continue;
        }
        const word = run[0];
        const next = tex[i + word.length];
        const whole = word.length === 1 || /[0-9_]/.test(word) || WORDS.has(word) || keep.has(word) || next === '(';
        out += whole ? word : word.split('').join(' ');
        i += word.length;
    }
    return out;
}

/**
 * A line of chart text with the `$` of its formulas taken out (outside
 * quotes, where labels keep theirs): `plot $f(x) = \frac{1}{2}x^2$ in blue`
 * reads as `plot f(x) = \frac{1}{2}x^2 in blue`.
 */
export function stripMathDollars(line: string, names?: ReadonlySet<string>): string {
    if (!line.includes('$')) return line;
    let out = '';
    let quoted = false;
    let escaped = false;
    let math = false;
    let formula = '';
    for (const c of line) {
        // A "quoted" text (a label, a title) stays exactly as written, \" included.
        if (quoted) {
            out += c;
            if (escaped) escaped = false;
            else if (c === '\\') escaped = true;
            else if (c === '"') quoted = false;
            continue;
        }
        if (c === '"' && !math) quoted = true;
        if (c === '$' && !quoted) {
            // Inside $...$ letters side by side multiply, as in LaTeX (`$ax^2 + bx$` is a x^2 + b x);
            // the chart's own names (a slider called speed) stay whole. Without `names` the formula stays as written.
            if (math) out += names ? splitLetterRuns(formula, names) : formula;
            formula = '';
            math = !math;
            continue;
        }
        // A bar in a formula is an absolute value, never the option bar of the 4.4 short form.
        if (math) formula += c === '|' ? '\\vert ' : c;
        else out += c;
    }
    if (math) out += formula;
    // r(\theta) heads a polar curve as r(theta) does (not inside a command run such as \cos\theta), outside
    // quoted text: a label "$\theta$" keeps its LaTeX (5.2.1).
    return out.replace(/("(?:[^"\\]|\\.)*")|[^"]+/g, (part: string, q?: string) => (q ? part : part.replace(/(?<![A-Za-z])\\theta\b/g, 'theta')));
}
