/*
 * The front end of the voting readers (6.2.4): one TeX string in, a list of
 * tokens out. A port of the frozen front.mjs (hover-ml readers), line by line.
 *
 *   prenorm(tex)      spelling only: Unicode to TeX, comments, tags, sloppy plain text (sin x, <=, **)
 *   tokenize(s)       tokens {k, v, a, b, sp}: class, canonical value, source span, "a space stood before"
 *   link(tokens)      bars resolved (open, close, separator), mate[] for every bracket, depth[], script spans
 *   print(F, i, j)    the canonical TeX of a token span: the spelling the chart language reads
 *
 * The front end takes no decision about a role. All tables are data
 * (tables.ts). Pure: no DOM, no Obsidian.
 */
import { CMD, FN_PLAIN, OPNAMES, UNI } from './tables';

/**
 * One token. Classes:
 *   let  a Latin letter            grk  a Greek letter (v: \alpha)      num  a number (v: 0.5)        inf  \infty
 *   op   + - \cdot \times / *      rel  = < > \le \ge \ne \approx \in \to \mapsto \subset ... (v: canonical)
 *   sep  , ; : |                   wsp  \quad \qquad                    log  \Rightarrow \iff \land (cut a formula in parts)
 *   open close  ( [ \{ | \langle   lb rb  { }                          sub sup  _ ^
 *   fn   \sin \ln ...              big  \sum \prod \int \lim \min \max  frac sqrt binom acc(\vec \mathbf \hat ...)
 *   bb   \mathbb{R} (v: R)         opn  \operatorname{epi} (v: epi)     text \text{...} (v: the words)
 *   beg end  \begin{env} \end{env} (v: env)   amp &   row \\   prime '   bang !   top \top   dots   sym (anything else)
 */
export interface Tok {
    /** The class. */
    k: string;
    /** The canonical value. */
    v: string;
    /** The source span [a, b) in the prenormed string. */
    a: number;
    b: number;
    /** A space stood before the token. */
    sp: boolean;
    /** An explicit space (~, \,, \ ) stood before it. */
    tsp?: boolean;
    /** A bar's side from a size command or \lvert: l, r, m (or ''). */
    side?: string;
    /** A bar's command as written (\lvert). */
    raw?: string;
    /** A letter's font command (mathrm). */
    font?: string;
    /** A digit of a script or a fraction without braces. */
    one?: boolean;
    /** := */
    def?: boolean;
}

/** The argument of a token: its last token; for a fraction or a binomial, the ends of both arguments; -1: none. */
export type Arg = number | [number, number];

/** A formula's front: the prenormed source, the tokens and their links. */
export interface Front {
    src: string;
    T: Tok[];
    /** The index of the partner of a bracket, a group brace or an environment (-1: none). */
    mate: number[];
    /** The number of open brackets, groups and environments around a token. */
    depth: number[];
    /** For sub, sup, frac, sqrt, acc, binom: the last token of the argument(s) (frac: [e1, e2]). */
    arg: Arg[];
    /** Every bracket has a partner. */
    ok: boolean;
}

/** The end of an argument that is one span (sub, sup, sqrt, acc). */
export const argEnd = (F: Front, q: number): number => F.arg[q] as number;
/** The ends of a fraction's or a binomial's two arguments. */
export const argPair = (F: Front, q: number): [number, number] => F.arg[q] as [number, number];

const UNI_RE = new RegExp('[' + Object.keys(UNI).join('') + ']', 'gu');
const FN_RE = new RegExp('(^|[^\\\\A-Za-z])(' + FN_PLAIN + ')(?![A-Za-z])', 'g');
const GLUED_RE = new RegExp('(^|[^\\\\A-Za-z])([A-Za-z])(arcsin|arccos|arctan|sinh|cosh|tanh|sqrt|sin|cos|tan|exp|log|ln)(?![A-Za-z])', 'g');

/** The group that starts at s[i] === '{': [content, index after the group]. */
function group(s: string, i: number): [string, number] {
    let d = 0;
    for (let j = i; j < s.length; j++) {
        if (s[j] === '\\') {
            j++;
            continue;
        }
        if (s[j] === '{') d++;
        else if (s[j] === '}' && --d === 0) return [s.slice(i + 1, j), j + 1];
    }
    return [s.slice(i + 1), s.length];
}

/** Replace \cmd{A} (or \cmd{A}{B}) by fn(A, B). */
function unwrap(s: string, cmd: string, nargs: number, fn: (...args: string[]) => string): string {
    if (!s.includes('\\' + cmd)) return s;
    const re = new RegExp('\\\\' + cmd + '(?![A-Za-z])\\*?\\s*', 'g');
    for (let guard = 0; guard < 20; guard++) {
        re.lastIndex = 0;
        const m = re.exec(s);
        if (!m) break;
        let j = m.index + m[0].length;
        const args: string[] = [];
        for (let k = 0; k < nargs; k++) {
            while (s[j] === ' ') j++;
            if (s[j] === '{') {
                const [c, e] = group(s, j);
                args.push(c);
                j = e;
            } else if (s[j] === '\\') {
                const mm = /^\\([A-Za-z]+|.)/.exec(s.slice(j)) as RegExpExecArray;
                args.push(mm[0]);
                j += mm[0].length;
            } else {
                args.push(s[j] ?? '');
                j++;
            }
        }
        s = s.slice(0, m.index) + ' ' + fn(...args) + ' ' + s.slice(j);
    }
    return s;
}

/** A decimal comma {,} while a row is cut at its commas: a private-use sign (the frozen front end uses U+0001). */
const COMMA = '\uE00E';
const COMMA_RE = new RegExp(COMMA, 'g');

/** Spelling only: Unicode to TeX, comments, tags, colour boxes, sloppy plain text (sin x, **, <=, e^-x, [[1,2],[3,4]]). */
export function prenorm(texIn: string | null | undefined): string {
    let s = String(texIn ?? '');
    // a transposition sign in a font command: ^\mathsf{T}, ^{\mathrm T}, ^\intercal
    s = s
        .replace(/\^\s*\{?\s*\\(?:mathsf|mathrm|text|operatorname|mathit|textsf|mathtt)\s*\{\s*([Tt])\s*\}\s*\}?/g, '^\\top ')
        .replace(/\^\s*\{\s*\\(?:top|intercal)\s*\}/g, '^\\top ')
        .replace(/\^\s*\\intercal(?![A-Za-z])/g, '^\\top ');
    // a matrix as a plain list of rows: [[1, 2], [3, 4]]
    s = s.replace(/\[\s*(\[[^[\]]*\]\s*(?:[,;]\s*\[[^[\]]*\]\s*)+)\]/g, (m: string, inner: string) => {
        const rows = (inner.match(/\[[^[\]]*\]/g) as RegExpMatchArray).map((r) =>
            r
                .slice(1, -1)
                .replace(/\{,\}/g, COMMA)
                .split(',')
                .map((c) => c.replace(COMMA_RE, '{,}').trim())
        );
        if (rows.some((r) => r.length !== rows[0].length || r.some((c) => !c))) return m;
        return `\\begin{pmatrix} ${rows.map((r) => r.join(' & ')).join(' \\\\ ')} \\end{pmatrix}`;
    });
    // a decimal comma written with spaces: 0 { , } 5
    s = s.replace(/(\d)\s*\{\s*,\s*\}\s*(?=\d)/g, '$1{,}');
    s = s.replace(/([A-Za-z])\s?[⃗⃑]/g, '\\vec{$1}');
    // comments (a % that is not \%), layout and numbering
    s = s.replace(/(^|[^\\])%[^\n]*/g, '$1');
    s = s.replace(/\\(?:tag|label)\s*\*?\s*\{[^}]*\}/g, ' ');
    s = s.replace(/\\(?:hspace|vspace|phantom|hphantom|vphantom|mkern|kern|mspace)\s*\*?\s*(\{[^{}]*\}|-?[0-9.]+\s*(?:mu|em|pt|ex|cm|mm))/g, ' ');
    s = unwrap(s, 'boxed', 1, (a) => a);
    s = unwrap(s, 'fbox', 1, (a) => a);
    s = unwrap(s, 'textcolor', 2, (_c, a) => a);
    s = unwrap(s, 'colorbox', 2, (_c, a) => a);
    s = unwrap(s, 'color', 1, () => '');
    s = unwrap(s, 'overset', 2, (_a, b) => b);
    s = unwrap(s, 'stackrel', 2, (_a, b) => b);
    s = unwrap(s, 'underset', 2, (a, b) => (/^\\?(min|max|argmin|argmax|lim|sup|inf)$/.test(b.trim()) ? `${b}_{${a}}` : b));
    s = unwrap(s, 'mathclap', 1, (a) => a);
    s = unwrap(s, 'substack', 1, (a) => a.replace(/\\\\/g, ','));
    s = unwrap(s, 'underbrace', 1, (a) => (/^\\?(?:arg)?(?:min|max|inf|sup)$/.test(a.trim()) ? `\\${a.trim().replace(/^\\/, '')}` : `{${a}}`));
    s = unwrap(s, 'overbrace', 1, (a) => `{${a}}`);
    s = s.replace(UNI_RE, (c: string) => UNI[c]);
    // sloppy plain-text math
    s = s.replace(/\*\*/g, '^').replace(/(^|[^\\A-Za-z])sqrt\s*\(/g, '$1\\sqrt(');
    for (let pass = 0; pass < 2; pass++) s = s.replace(FN_RE, (m: string, b: string, fn: string, off: number) => (b === '{' && s[off + m.length] === '}' ? m : `${b}\\${fn}`));
    s = s.replace(GLUED_RE, '$1$2\\$3');
    // an exponent or a subscript with a sign and no braces: e^-x, 2^-k, x_-1
    s = s.replace(/\^\s*-\s*([0-9]+(?:[.,][0-9]+)?|[A-Za-z]|\\[A-Za-z]+)/g, '^{-$1}').replace(/_\s*-\s*([0-9]+|[A-Za-z])/g, '_{-$1}');
    // a root written as a call: \sqrt(1 - x^2) is \sqrt{1 - x^2}
    for (let g = 0, at = s.indexOf('\\sqrt('); at >= 0 && g < 8; at = s.indexOf('\\sqrt(', at + 1), g++) {
        let d = 0;
        let e = -1;
        for (let i = at + 5; i < s.length; i++) {
            if (s[i] === '(') d++;
            else if (s[i] === ')' && --d === 0) {
                e = i;
                break;
            }
        }
        if (e > 0) s = `${s.slice(0, at)}\\sqrt{${s.slice(at + 6, e)}}${s.slice(e + 1)}`;
    }
    s = s.replace(/<=/g, '\\le ').replace(/>=/g, '\\ge ').replace(/(^|[^\\])!=/g, '$1\\ne ').replace(/->/g, '\\to ');
    return s;
}

const tok = (k: string, v: string, a: number, b: number, sp: boolean): Tok => ({ k, v, a, b, sp });

/** The class of a sign that is a token by itself. */
const ONE: Record<string, string> = { '+': 'op', '-': 'op', '*': 'op', '/': 'op', '=': 'rel', '<': 'rel', '>': 'rel', ',': 'sep', ';': 'sep', ':': 'sep', '(': 'open', '[': 'open', ')': 'close', ']': 'close', '{': 'lb', '}': 'rb', _: 'sub', '^': 'sup', '&': 'amp', "'": 'prime', '!': 'bang', '|': 'bar' };

/** The tokens of a prenormed string (classes: see Tok). */
export function tokenize(s: string): Tok[] {
    const T: Tok[] = [];
    let sp = false;
    let tsp = false;
    const n = s.length;
    const push = (k: string, v: string, a: number, b: number) => {
        T.push(tok(k, v, a, b, sp));
        if (tsp) T[T.length - 1].tsp = true;
        sp = false;
        tsp = false;
    };
    const braced = (i: number): [string, number] => {
        // the group or the single sign after a font command: [content, end]
        while (s[i] === ' ') i++;
        if (s[i] === '{') return group(s, i);
        if (s[i] === '\\') {
            const m = /^\\([A-Za-z]+|.)/.exec(s.slice(i)) as RegExpExecArray;
            return [m[0], i + m[0].length];
        }
        return [s[i] ?? '', i + 1];
    };
    for (let i = 0; i < n; ) {
        const c = s[i];
        if (c === ' ' || c === '\n' || c === '\t' || c === '\r') {
            sp = true;
            i++;
            continue;
        }
        if (c === '~') {
            sp = true;
            tsp = true;
            i++;
            continue;
        }
        if (c === '\\') {
            if (s[i + 1] === '\\') {
                // a row break, maybe with a length: \\[2pt]
                let j = i + 2;
                const len = /^\s*\[[^\]]*(?:pt|em|ex|mm|cm)\s*\]/.exec(s.slice(j));
                if (len) j += len[0].length;
                push('row', '\\\\', i, j);
                i = j;
                continue;
            }
            const m = /^\\([A-Za-z]+)\*?/.exec(s.slice(i, i + 40));
            if (!m) {
                const d = s[i + 1] ?? '';
                if (d === '{') push('open', '\\{', i, i + 2);
                else if (d === '}') push('close', '\\}', i, i + 2);
                else if (d === '|') push('bar', '\\|', i, i + 2);
                else if (d === ',' || d === ';' || d === ':' || d === ' ' || d === '>') {
                    sp = true;
                    tsp = true;
                } else if (d === '!') sp = true;
                else if (d === '%' || d === '$' || d === '&' || d === '#' || d === '_') push('sym', '\\' + d, i, i + 2);
                else sp = true;
                i += 2;
                continue;
            }
            const name = m[1];
            let j = i + m[0].length;
            const def = CMD[name];
            if (!def) {
                push('sym', '\\' + name, i, j);
                i = j;
                continue;
            }
            const [k, v] = def;
            if (k === 'drop') {
                sp = true;
                i = j;
                continue;
            }
            if (k === 'size') {
                // \left. and \right. are no brackets
                const r = /^\s*\./.exec(s.slice(j));
                if (r) j += r[0].length;
                else {
                    // the bar after a size command: its side is known
                    const bar = /^\s*(\||\\[lr]?[vV]ert(?![A-Za-z])|\\\|)/.exec(s.slice(j));
                    if (bar) {
                        push('bar', bar[1] === '|' || (/vert/.test(bar[1]) && !/Vert/.test(bar[1])) ? '|' : '\\|', i, j + bar[0].length);
                        T[T.length - 1].side = v;
                        j += bar[0].length;
                    }
                }
                i = j;
                continue;
            }
            if (k === 'font') {
                // \mathrm{...}, \text{...}, \operatorname{...}: an operator name, a letter, a number, or words
                const [body, e] = braced(j);
                const w = body.replace(/\\[,;:! ]|~/g, ' ').trim();
                const bare = w.replace(/\s+/g, '');
                if (OPNAMES[bare]) {
                    const [k2, v2] = OPNAMES[bare];
                    push(k2, v2, i, e);
                } else if (v === 'op' && /^[A-Za-z]+$/.test(bare)) push('opn', bare, i, e);
                else if (v !== 'text' && /^[A-Za-z]$/.test(bare)) {
                    push('let', bare, i, e);
                    T[T.length - 1].font = name;
                } else if (v !== 'text' && /^[A-Z]{2,4}$/.test(bare)) push('opn', bare, i, e);
                else if (/^-?[0-9]+(?:[.,][0-9]+)?$/.test(bare)) push('num', bare.replace(',', '.'), i, e);
                else if (v !== 'text' && /^\\[A-Za-z]+$/.test(bare) && CMD[bare.slice(1)]) {
                    const [k2, v2] = CMD[bare.slice(1)];
                    push(k2 === 'grk' || k2 === 'fn' || k2 === 'big' ? k2 : 'sym', v2 ?? bare, i, e);
                } else push('text', w, i, e);
                i = e;
                continue;
            }
            if (k === 'bbl') {
                push('bb', v ?? name, i, j);
                i = j;
                continue;
            }
            if (k === 'bb') {
                const [body, e] = braced(j);
                push('bb', body.trim(), i, e);
                i = e;
                continue;
            }
            if (k === 'beg' || k === 'end') {
                const [body, e0] = braced(j);
                let e = e0;
                const env = body.trim().replace(/\*$/, '');
                // the column spec of an array
                if (k === 'beg' && /^(array|alignat|tabular)$/.test(env)) {
                    let q = e;
                    while (s[q] === ' ') q++;
                    if (s[q] === '{') e = group(s, q)[1];
                }
                push(k, env, i, e);
                i = e;
                continue;
            }
            if (k === 'bar') {
                push('bar', v as string, i, j);
                if (def[2]) T[T.length - 1].side = def[2];
                if (name !== 'mid') T[T.length - 1].raw = '\\' + name;
                i = j;
                continue;
            }
            push(k, v ?? '\\' + name, i, j);
            i = j;
            continue;
        }
        if ((c >= '0' && c <= '9') || (c === '.' && /[0-9]/.test(s[i + 1] ?? '') && !/[0-9]/.test(s[i - 1] ?? ''))) {
            const prev = T[T.length - 1];
            // a script or a fraction without braces takes one digit: x^12 is x^1 2, \frac12 is 1 over 2
            const p2 = T[T.length - 2];
            const one = prev && !sp && (prev.k === 'sub' || prev.k === 'sup' || prev.k === 'frac' || prev.k === 'binom' || (p2 && (p2.k === 'frac' || p2.k === 'binom') && prev.k === 'num' && prev.one));
            if (one) {
                push('num', c, i, i + 1);
                T[T.length - 1].one = true;
                i++;
                continue;
            }
            // digits, a decimal point, a decimal comma in braces, thousands with a thin space
            const m = /^(?:[0-9]+(?:\\,[0-9]{3}(?![0-9]))*(?:(?:\.|\{,\})[0-9]+)?|\.[0-9]+)/.exec(s.slice(i)) as RegExpExecArray;
            push('num', m[0].replace(/\\,/g, '').replace('{,}', '.'), i, i + m[0].length);
            i += m[0].length;
            continue;
        }
        if ((c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z')) {
            push('let', c, i, i + 1);
            i++;
            continue;
        }
        const one = ONE[c];
        if (one) {
            if (c === ':' && s[i + 1] === '=') {
                push('rel', '=', i, i + 2);
                T[T.length - 1].def = true;
                i += 2;
                continue;
            }
            push(one, c === '*' ? '\\cdot' : c, i, i + 1);
            i++;
            continue;
        }
        push('sym', c, i, i + 1);
        i++;
    }
    return T;
}

const OPERAND_END = new Set(['let', 'grk', 'num', 'inf', 'close', 'rb', 'bb', 'prime', 'bang', 'top', 'opn', 'dots', 'end']);

/** Resolve bars, match brackets, give depths and script spans (the fields of Front after T). */
export function link(T: Tok[]): Pick<Front, 'mate' | 'depth' | 'arg' | 'ok'> {
    const n = T.length;
    // bars: a bar after an operand closes an open bar of its level; without one it separates; else it opens
    const pend: boolean[][] = [[]];
    for (let i = 0; i < n; i++) {
        const t = T[i];
        if (t.k === 'open' || t.k === 'lb' || t.k === 'beg') pend.push([]);
        else if (t.k === 'close' || t.k === 'rb' || t.k === 'end') {
            if (pend.length > 1) pend.pop();
        } else if (t.k === 'amp' || t.k === 'row') pend[pend.length - 1].length = 0;
        else if (t.k === 'bar') {
            const top = pend[pend.length - 1];
            const prev = T[i - 1];
            const afterOperand = !!prev && OPERAND_END.has(prev.k);
            const norm = t.v === '\\|';
            let as: string;
            if (t.side === 'l') as = 'open';
            else if (t.side === 'r') as = top.length ? 'close' : 'sep';
            else if (t.side === 'm') as = 'sep';
            else if (afterOperand && top.length && top[top.length - 1] === norm) as = 'close';
            else if (afterOperand) as = 'sep';
            else as = 'open';
            // a bar that would open at the very end of its level separates nothing and opens nothing: it closes
            if (as === 'open') {
                const next = T[i + 1];
                if (!next || next.k === 'close' || next.k === 'rb') as = top.length ? 'close' : 'sep';
            }
            t.k = as;
            t.v = as === 'sep' ? '|' : norm ? '\\|' : '|';
            if (as === 'open') top.push(norm);
            else if (as === 'close') top.pop();
        }
    }
    const mate: number[] = new Array<number>(n).fill(-1);
    const depth: number[] = new Array<number>(n).fill(0);
    const st: number[] = [];
    let ok = true;
    for (let i = 0; i < n; i++) {
        const k = T[i].k;
        if (k === 'open' || k === 'lb' || k === 'beg') {
            depth[i] = st.length;
            st.push(i);
        } else if (k === 'close' || k === 'rb' || k === 'end') {
            // partner of the same family: brackets with brackets, groups with groups, environments with environments
            const fam = k === 'close' ? 'open' : k === 'rb' ? 'lb' : 'beg';
            let q = st.length - 1;
            while (q >= 0 && T[st[q]].k !== fam) q--;
            if (q < 0) {
                ok = false;
                depth[i] = st.length;
                continue;
            }
            if (q !== st.length - 1) ok = false;
            st.length = q + 1;
            const o = st.pop() as number;
            mate[o] = i;
            mate[i] = o;
            depth[i] = st.length;
        } else depth[i] = st.length;
    }
    if (st.length) ok = false;
    // arguments: a group, or one token (with the arguments of that token when it is a command)
    const arg: Arg[] = new Array<Arg>(n).fill(-1);
    const endOf = (i: number): number => {
        // the last token of the operand that starts at i
        if (i >= n) return n - 1;
        const k = T[i].k;
        if (k === 'lb' || k === 'open') return mate[i] >= 0 ? mate[i] : i;
        if (k === 'frac' || k === 'binom') {
            const e1 = endOf(i + 1);
            return endOf(e1 + 1);
        }
        if (k === 'sqrt') {
            let j = i + 1;
            if (T[j] && T[j].k === 'open' && T[j].v === '[' && mate[j] > 0) j = mate[j] + 1;
            return endOf(j);
        }
        if (k === 'acc') return endOf(i + 1);
        return i;
    };
    for (let i = n - 1; i >= 0; i--) {
        const k = T[i].k;
        if (k === 'sub' || k === 'sup' || k === 'acc') arg[i] = Math.min(n - 1, endOf(i + 1));
        else if (k === 'frac' || k === 'binom') {
            const e1 = endOf(i + 1);
            arg[i] = [Math.min(n - 1, e1), Math.min(n - 1, endOf(e1 + 1))];
        } else if (k === 'sqrt') arg[i] = Math.min(n - 1, endOf(i));
    }
    return { mate, depth, arg, ok };
}

const SPACED_OPS = new Set(['+', '-', '\\cdot', '\\times', '\\cup', '\\cap', '\\setminus', '\\pm', '\\mp', '\\circ']);

/**
 * The canonical TeX of the tokens i..j (inclusive) of a front F: sizes and layout are gone, relations, arrows, bars
 * and Unicode signs have one spelling, a big operator has its lower bound first and its bounds in braces
 * (\sum^n_{k=1} is \sum_{k=1}^{n}). Arguments keep their braces as written (\tfrac12 is \frac12).
 */
export function print(F: Front, i: number, j: number): string {
    const { T, mate, arg } = F;
    let out = '';
    let force = false;
    const inner = (a: number, b: number) => (T[a] && T[a].k === 'lb' && mate[a] === b ? print(F, a + 1, b - 1) : print(F, a, b));
    const emit = (v: string, q: number, k?: string) => {
        if (!out) {
            out = v;
            return;
        }
        const prev = T[q - 1];
        const t = T[q];
        const glue = /\\[A-Za-z]+$/.test(out) && /^[A-Za-z]/.test(v);
        const kk = k ?? t.k;
        const wide =
            kk === 'rel' ||
            prev.k === 'rel' ||
            kk === 'log' ||
            prev.k === 'log' ||
            kk === 'wsp' ||
            prev.k === 'wsp' ||
            kk === 'amp' ||
            prev.k === 'amp' ||
            kk === 'row' ||
            prev.k === 'row' ||
            kk === 'text' ||
            prev.k === 'text' ||
            prev.k === 'sep' ||
            (kk === 'sep' && (t.v === '|' || t.v === ':') && !(t.v === ':' && prev.k !== 'bb' && q - i <= 3)) ||
            (kk === 'op' && SPACED_OPS.has(t.v) && binary(T, q, i)) ||
            (prev.k === 'op' && SPACED_OPS.has(prev.v) && binary(T, q - 1, i)) ||
            prev.k === 'beg' ||
            kk === 'end';
        // a space of the source between two factors stays (a x_1 is not ax_1; K_0 (1 + p) is not a call)
        const kept = t.sp && /[A-Za-z0-9})]$/.test(out) && /^[A-Za-z0-9\\(]/.test(v) && prev.k !== 'sub' && prev.k !== 'sup';
        out += (glue || wide || force || kept ? ' ' : '') + v;
        force = false;
    };
    for (let q = Math.max(0, i); q <= j && q < T.length; q++) {
        const t = T[q];
        switch (t.k) {
            case 'bb':
                emit(`\\mathbb{${t.v}}`, q);
                break;
            case 'text':
                emit(`\\text{${t.v}}`, q);
                break;
            case 'opn':
                emit(`\\operatorname{${t.v}}`, q);
                break;
            case 'beg':
                emit(`\\begin{${t.v}}`, q);
                break;
            case 'end':
                emit(`\\end{${t.v}}`, q);
                break;
            case 'big': {
                // the scripts of a big operator in braces, the lower one first: \sum^n_{k=1} is \sum_{k=1}^{n}
                let sub = '';
                let sup = '';
                let e = q;
                for (let g = 0; g < 2; g++) {
                    const s1 = T[e + 1];
                    if (!s1 || (s1.k !== 'sub' && s1.k !== 'sup') || (arg[e + 1] as number) > j) break;
                    const body = `{${inner(e + 2, arg[e + 1] as number)}}`;
                    if (s1.k === 'sub' && !sub) sub = '_' + body;
                    else if (s1.k === 'sup' && !sup) sup = '^' + body;
                    else break;
                    e = arg[e + 1] as number;
                }
                emit(t.v + sub + sup, q);
                if (e > q) force = true;
                q = e;
                break;
            }
            case 'let':
                emit(t.font ? `\\${t.font}{${t.v}}` : t.v, q);
                break;
            case 'sep':
                emit(t.v === '|' ? '\\mid' : t.v, q);
                break;
            // a bar of an absolute value keeps its spelling (\lvert x \rvert), as the cards read both
            case 'open':
            case 'close':
                emit(t.raw ?? t.v, q);
                break;
            default:
                emit(t.v, q);
        }
    }
    return out;
}

/** Is the operator at q binary (an operand stands before it)? */
function binary(T: Tok[], q: number, from: number): boolean {
    const p = T[q - 1];
    return q > from && !!p && OPERAND_END.has(p.k);
}

/** prenorm + tokenize + link in one call. */
export function front(tex: string): Front {
    const src = prenorm(tex);
    const T = tokenize(src);
    // a full stop, a comma or a semicolon at the end is the sentence's
    while (T.length && ((T[T.length - 1].k === 'sym' && T[T.length - 1].v === '.') || (T[T.length - 1].k === 'sep' && (T[T.length - 1].v === ',' || T[T.length - 1].v === ';')) || T[T.length - 1].k === 'wsp')) T.pop();
    // the alignment sign of a row of an aligned block is layout (outside an environment)
    if (!T.some((t) => t.k === 'beg'))
        for (let i = T.length - 1; i >= 0; i--)
            if (T[i].k === 'amp') {
                if (T[i + 1]) T[i + 1].sp = true;
                T.splice(i, 1);
            }
    let L = link(T);
    // one group around everything is layout: {y = x^2}, \color{blue}{...}
    for (let g = 0; g < 3 && T.length > 2 && T[0].k === 'lb' && L.mate[0] === T.length - 1; g++) {
        T.pop();
        T.shift();
        L = link(T);
    }
    // a comma before an explicit space at the top level starts a new part (", \ x > 0"), as \quad does;
    // not before a new definition (", \ g(x) = ..."): that is a list of functions
    let cut = false;
    for (let i = T.length - 2; i > 0; i--) {
        const t = T[i];
        const nx = T[i + 1];
        if (t.k === 'sep' && (t.v === ',' || t.v === ';') && L.depth[i] === 0 && nx.tsp && !((nx.k === 'let' || nx.k === 'grk') && T[i + 2] && T[i + 2].k === 'open' && T[i + 2].v === '(')) {
            T.splice(i + 1, 0, tok('wsp', '\\quad', nx.a, nx.a, true));
            cut = true;
        }
    }
    if (cut) L = link(T);
    return { src, T, ...L };
}

/** The canonical TeX of a whole formula. */
export function canon(tex: string): string {
    const F = front(tex);
    return print(F, 0, F.T.length - 1);
}
