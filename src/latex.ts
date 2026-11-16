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
]);

/** Commands that are an operator or a relation. */
const SYMBOLS: Record<string, string> = {
    cdot: '*', times: '*', div: '/', ast: '*',
    le: '<=', leq: '<=', leqslant: '<=', ge: '>=', geq: '>=', geqslant: '>=', lt: '<', gt: '>',
    lvert: '|', rvert: '|', vert: '|', mid: '|',
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
    const command = (): string => {
        i++;
        const m = /^[A-Za-z]+/.exec(s.slice(i));
        const name = m ? m[0] : s[i] ?? '';
        i += name.length || 1;
        if (name === 'frac' || name === 'dfrac' || name === 'tfrac') {
            const a = arg();
            const b = arg();
            return `((${a})/(${b}))`;
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
            return n ? `((${a})^(1/(${n})))` : `sqrt(${a})`;
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
        if (TEXT_COMMANDS.has(name)) return arg().replace(/\s+/g, '');
        if (FUNCTIONS.has(name)) {
            spaces();
            // `\sin^2 x` is (sin x)^2.
            if (s[i] === '^') {
                i++;
                const power = arg();
                return `${name}${fnArg() || ''}^(${power})`;
            }
            return name + fnArg();
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

/** Letter runs that stay one name in a formula from a note: functions and the names LaTeX spells out. */
const WORDS = new Set([...FUNCTIONS, 'sqrt', 'abs', 'pi', 'theta', 'alpha', 'beta', 'gamma', 'delta', 'lambda', 'mu', 'sigma', 'omega', 'phi', 'rho', 'tau']);

/**
 * A formula from a note read as LaTeX reads it: `ax^2 + bx` is a·x² + b·x,
 * so a run of letters becomes single letters. A command (`\sin`), the
 * argument of `\mathrm{...}` or `\text{...}`, a name with a digit or `_`
 * (x_1, f1), a known word (sin, theta) and a name right before a bracket
 * (demand(x)) stay as they are.
 */
export function splitLetterRuns(tex: string): string {
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
            if (m && TEXT_COMMANDS.has(m[1]) && tex[i] === '{') {
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
        const keep = word.length === 1 || /[0-9_]/.test(word) || WORDS.has(word) || next === '(';
        out += keep ? word : word.split('').join(' ');
        i += word.length;
    }
    return out;
}

/**
 * A line of chart text with the `$` of its formulas taken out (outside
 * quotes, where labels keep theirs): `plot $f(x) = \frac{1}{2}x^2$ in blue`
 * reads as `plot f(x) = \frac{1}{2}x^2 in blue`.
 */
export function stripMathDollars(line: string): string {
    if (!line.includes('$')) return line;
    let out = '';
    let quoted = false;
    let math = false;
    for (const c of line) {
        if (c === '"' && !math) quoted = !quoted;
        if (c === '$' && !quoted) {
            math = !math;
            continue;
        }
        // A bar in a formula is an absolute value, never the option bar of the 4.4 short form.
        out += math && c === '|' ? '\\vert ' : c;
    }
    // r(\theta) heads a polar curve as r(theta) does (not inside a command run such as \cos\theta).
    return out.replace(/(?<![A-Za-z])\\theta\b/g, 'theta');
}
