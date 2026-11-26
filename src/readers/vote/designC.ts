/*
 * Design C of the voting readers (6.2.4): the canonical-form route, a
 * strong symbolic baseline. A port of the frozen designC.mjs (hover-ml
 * readers), line by line:
 *
 *   1. canon(tex): the canonical TeX of front.ts (one spelling per sign, no layout).
 *   2. mask(s): the same string with everything inside brackets blanked (□), so a template sees the top level only.
 *   3. A few role templates per kind (regular expressions on the mask); a match gives positions, the roles are cut
 *      from the canonical string at these positions.
 *
 * It works on strings only: it does not use the token roles of design A or
 * the tree of design B. Pure: no DOM, no Obsidian.
 */
import { Front, canon, print } from './front';
import type { FnRead, Internal } from './internal';

const BOX = '□';

/** The string with the inside of every bracket pair blanked: ( ) [ ] { } \{ \} \begin \end, any mix of round and square. */
export function mask(s: string): string {
    let out = '';
    let d = 0;
    for (let i = 0; i < s.length; i++) {
        const c = s[i];
        if (c === '\\') {
            const two = s.slice(i, i + 2);
            if (two === '\\{' || two === '\\}') {
                if (two === '\\}') d = Math.max(0, d - 1);
                out += d === 0 ? two : BOX + BOX;
                if (two === '\\{') d++;
                i++;
                continue;
            }
            const m = /^\\(begin|end)\{[^}]*\}/.exec(s.slice(i, i + 30));
            if (m) {
                if (m[1] === 'end') d = Math.max(0, d - 1);
                out += d === 0 ? m[0] : BOX.repeat(m[0].length);
                if (m[1] === 'begin') d++;
                i += m[0].length - 1;
                continue;
            }
            const w = /^\\(?:[A-Za-z]+|.)/.exec(s.slice(i, i + 30));
            const len = w ? w[0].length : 1;
            out += d === 0 ? s.slice(i, i + len) : BOX.repeat(len);
            i += len - 1;
            continue;
        }
        if (c === '(' || c === '[' || c === '{') {
            out += d === 0 ? c : BOX;
            d++;
            continue;
        }
        if (c === ')' || c === ']' || c === '}') {
            d = Math.max(0, d - 1);
            out += d === 0 ? c : BOX;
            continue;
        }
        out += d === 0 ? c : BOX;
    }
    return out;
}

/** Split s where re matches on its mask: the pieces (trimmed) and the separators. */
function split(s: string, re: RegExp, m: string = mask(s)): { pieces: string[]; seps: string[] } {
    const pieces: string[] = [];
    const seps: string[] = [];
    let from = 0;
    const g = new RegExp(re.source, 'g');
    for (let x = g.exec(m); x; x = g.exec(m)) {
        if (!x[0].length) {
            g.lastIndex++;
            continue;
        }
        pieces.push(s.slice(from, x.index).trim());
        seps.push(s.slice(x.index, x.index + x[0].length).trim());
        from = x.index + x[0].length;
    }
    pieces.push(s.slice(from).trim());
    return { pieces, seps };
}

/** A match with its indices (the d flag): [start, end] of the match and of each group, undefined for a group that did not take part. */
type Indexed = RegExpExecArray & { indices: Array<[number, number] | undefined> };

/** A template on the mask of s: the groups of the match cut from s itself. */
function match(s: string, re: RegExp, m: string = mask(s)): Array<string | undefined> | null {
    const x = new RegExp(re.source, re.flags.includes('d') ? re.flags : re.flags + 'd').exec(m) as Indexed | null;
    if (!x) return null;
    return x.indices.map((r) => (r ? s.slice(r[0], r[1]) : undefined));
}

const CUTS = /\\quad|\\Rightarrow|\\iff|\\Leftarrow|\\text\{□*\}|\\\\/;
const REL = /=|<|>|\\le|\\ge|\\ne|\\approx|\\in|\\subseteq|\\to|\\mapsto|\\equiv|\\sim|\\notin/;
const EQ = / = /;
const INEQ = /(?:<|>|\\le|\\ge)(?![A-Za-z])/;
const NAME = String.raw`(?:\\(?:vec|mathbf|hat|bar|tilde|mathcal|dot)\s*(?:\{□+\}|[A-Za-z])|\\operatorname\{□+\}|\\[A-Za-z]+|[A-Za-z]{1,4})(?:_(?:\{□+\}|[A-Za-z0-9]|\\[a-z]+))?`;
const VARL = String.raw`(?:\\[a-z]+|[A-Za-z])(?:_(?:\{□+\}|[A-Za-z0-9]))?`;
const strip = (s: string) => s.replace(/^[\s,;.]+|[\s,;.]+$/g, '');
const unbrace = (s: string) => {
    const t = s.trim();
    return /^\{[^{}]*\}$/.test(t) ? t.slice(1, -1).trim() : t;
};
const hasRel = (s: string) => REL.test(mask(s));
const GREEK = new Set('alpha beta gamma delta epsilon varepsilon zeta eta theta vartheta kappa lambda mu nu xi rho sigma tau phi varphi chi psi omega'.split(' '));
/** The single letters and Greek letters a string uses as symbols (commands such as \sin are none). */
function letters(s: string): string[] {
    const out: string[] = [];
    const t = s.replace(/\\(?:text|operatorname|begin|end)\{[^}]*\}/g, ' ');
    for (const x of t.matchAll(/\\([A-Za-z]+)|([A-Za-z])/g)) {
        const v = x[2] ?? (GREEK.has(x[1]) ? '\\' + x[1] : null);
        if (v && !out.includes(v)) out.push(v);
    }
    return out;
}

/** One part of a formula: its TeX, the cut before it, and what stands before it (log, text, row, wsp, comma, or null). */
interface Part {
    tex: string;
    lead: string;
    sep: string | null;
}

/** The parts of a formula: cut at wide spaces, logic signs, words and row breaks. sep: what stands before the part. */
function partsOf(s: string): Part[] {
    const { pieces, seps } = split(s, CUTS);
    const out: Part[] = [];
    let sep: string | null = null;
    pieces.forEach((p, i) => {
        if (i) {
            const l = seps[i - 1];
            const k = /Rightarrow|iff|Leftarrow/.test(l) ? 'log' : /text/.test(l) ? 'text' : /\\\\/.test(l) ? 'row' : 'wsp';
            sep = k === 'log' || sep === 'log' ? 'log' : sep ?? k;
            if (sep !== 'log' && /[,;]\s*$/.test(pieces[i - 1]) && pieces[i - 1].trim().length > 1) sep = 'comma';
        }
        const tex = strip(p);
        if (tex) {
            out.push({ tex, lead: i ? seps[i - 1] : '', sep });
            sep = null;
        }
    });
    return out;
}
/** A program's goal and prefix out: \min_x f, f \to \min, \max ... */
function objective(p: string): string {
    let s = p.replace(/\s*\\to\s*\\(?:min|max)(?:_\{[^{}]*\})?\s*$/, '');
    s = s.replace(/^\\(?:arg)?(?:min|max|inf|sup)(?:_(?:\{(?:[^{}]|\{[^{}]*\})*\}|[A-Za-z0-9]))?\s*(?![(\\{]|\\{)/, '');
    return s.trim();
}

// ---------------------------------------------------------------- the head = body family

/** A head: its name, its arguments and its decoration (an inverse, primes). */
interface Head {
    name: string;
    args: string[];
    deco: string;
}

function headOf(head: string): Head | null {
    // name(args) with primes and an inverse; or a plain name
    const m = mask(head);
    const call = match(head, new RegExp(String.raw`^(${NAME})((?:\^\{□+\})?'*)\((□+)\)$`), m);
    if (call) return { name: call[1] as string, args: split(call[3] as string, /,/).pieces, deco: call[2] as string };
    if (new RegExp(String.raw`^${NAME}$`).test(m) || /^\\operatorname\{□+\}$/.test(m)) return { name: head, args: [], deco: '' };
    return null;
}

/** One "head = body" statement: its name, arguments, body and the later sides of its chain; null when it is none. */
function fnOf(p0: string): FnRead | null {
    // a label before the formula: "g: y = 2x + 1"
    const p = p0.replace(/^[A-Za-z](?:_[0-9a-z])?\s*:\s*(?=.*(?:=|\\mapsto))/, '');
    // v \mapsto body
    const mt = split(p, / \\mapsto /);
    if (mt.pieces.length === 2) return { name: null, args: [mt.pieces[0]], body: mt.pieces[1], more: [] };
    const m = mask(p);
    const sides = split(p, / (?:=|\\approx) /, m).pieces;
    if (sides.length < 2 || sides.some((x) => !x)) return null;
    // the body ends at another relation: f''(x) = 2 + e^{-x} > 0
    const cutRel = (x: string) => split(x, / (?:<|>|\\le|\\ge|\\in|\\ne|\\to|\\subseteq) /).pieces[0];
    const head = headOf(sides[0]);
    const body = cutRel(sides[1]);
    const more = body === sides[1] ? sides.slice(2).map(cutRel) : [];
    if (!head) return { name: sides[0], args: [], body, more };
    return { name: head.name + head.deco, args: head.args, body, more };
}
function functionLike(s: string): Internal | null {
    const all = partsOf(s);
    const fns: FnRead[] = [];
    const conditions: string[] = [];
    for (let q = 0; q < all.length; q++) {
        // a list of definitions: f(x) = ..., g(x) = ...
        const defs = split(all[q].tex, new RegExp(String.raw`, (?=${NAME}'*\(□+\) = )`)).pieces;
        let any = false;
        defs.forEach((d, k) => {
            const f = fnOf(objective(d));
            if (f) {
                fns.push({ ...f, sep: k > 0 ? 'comma' : q > 0 ? all[q].sep : null });
                any = true;
            }
        });
        if (any) continue;
        // a later part with an inequality or a membership is a condition
        const c = all[q].tex.replace(/^\((.*)\)$/, '$1');
        const cm = mask(c);
        if (q > 0 && (INEQ.test(cm) || / \\in /.test(cm)) && all[q].sep !== 'log') conditions.push(c);
    }
    if (!fns.length) {
        // no definition: the first part is the body (an objective without its goal)
        if (!all.length) return null;
        const p = objective(all[0].tex);
        const m = mask(p);
        if (!p || / (?:=|\\approx) /.test(m)) return null;
        fns.push({ name: null, args: [], body: split(p, / (?:<|>|\\le|\\ge|\\in|\\ne|\\to|\\subseteq) /).pieces[0], more: [], sep: null });
    }
    return { fns, conditions };
}

function implicit(s: string): Internal | null {
    for (const part of partsOf(s)) {
        const p = part.tex.replace(/^[A-Za-z](?:_[0-9a-z])?:\s*/, '');
        const m = mask(p);
        if (INEQ.test(m)) continue;
        const sides = split(p, EQ, m).pieces;
        if (sides.length < 2 || sides.some((x) => !x)) continue;
        return { equation: `${sides[0]} = ${sides[1]}` };
    }
    return null;
}

/** The statements with an inequality: of every part, cut at commas. x_1, x_2 \ge 0 stays one statement. */
function inequalities(s: string): string[] {
    const out: string[] = [];
    for (const part of partsOf(s)) {
        const p = objective(part.tex).replace(/^\((.*)\)$/, '$1');
        const { pieces } = split(p, /, /);
        let carry = '';
        for (const piece of pieces) {
            const st = carry ? `${carry}, ${piece}` : piece;
            const m = mask(st);
            if (INEQ.test(m)) {
                out.push(strip(st));
                carry = '';
            } else if (new RegExp(`^${VARL}(?:, ${VARL})*$`).test(mask(st))) carry = st;
            else carry = '';
        }
    }
    return out;
}
function region(s: string): Internal | null {
    const conditions = inequalities(s);
    return conditions.length ? { conditions } : null;
}
function condition(s: string): Internal | null {
    const parts = partsOf(s);
    for (const part of parts) {
        const p = part.tex.replace(/^\((.*)\)$/, '$1');
        const m = mask(p);
        if (!INEQ.test(m) || /, /.test(m)) continue;
        // the variable: the one letter (with its subscript); x before others
        const ls = letters(p.replace(/_(?:\{[^{}]*\}|[A-Za-z0-9])/g, '')).filter((l) => !/^(e|\\pi)$/.test(l) && !new RegExp(`${l.replace(/\\/g, '\\\\')}\\(`).test(p));
        const v = ls.includes('x') ? 'x' : ls[0] ?? null;
        const sub = v ? new RegExp(`${v.replace(/\\/g, '\\\\')}_(\\{[^{}]*\\}|[A-Za-z0-9])`).exec(p) : null;
        return { condition: p, variable: v && sub ? `${v}_${unbrace(sub[1]).length === 1 ? unbrace(sub[1]) : `{${unbrace(sub[1])}}`}` : v };
    }
    return null;
}

function interval(s: string): Internal | null {
    for (const part of partsOf(s)) {
        const p = part.tex.replace(/^(?:=|\\approx)\s*/, '');
        const m = mask(p);
        // the last side that is a bracket pair with two ends
        const sides = split(p, / (?:=|\\in|\\subseteq|\\approx) /, m);
        for (let q = 0; q < sides.pieces.length; q++) {
            const x = /^([[(])(.*)([\])])$/.exec(sides.pieces[q]);
            if (!x) continue;
            const ends = split(x[2], /[,;] /).pieces;
            if (ends.length !== 2 || !ends[0] || !ends[1]) continue;
            const before = q > 0 ? sides.pieces[q - 1] : '';
            const variable = q > 0 && sides.seps[q - 1] === '\\in' && new RegExp(`^${VARL}$`).test(mask(before)) ? before : null;
            return { variable, left: x[1], lo: ends[0], hi: ends[1], right: x[3] };
        }
    }
    return null;
}

/** A set builder as design C reads it: its variables, its space (\in ...), its condition. */
interface SetRead {
    variables: string[];
    space: string | null;
    condition: string;
}

const SETSEP = / \\mid |: |; | \\text\{□*\} /;
function setBuilder(s: string): SetRead | null {
    // the first set brace at the top level that holds a builder
    const m = mask(s);
    const re = /\\\{(□*)\\\}/g;
    for (let x = re.exec(m); x; x = re.exec(m)) {
        const inner = s.slice(x.index + 2, x.index + x[0].length - 2).trim();
        const im = mask(inner);
        const cut = new RegExp(SETSEP.source).exec(im);
        if (cut) {
            const head = inner.slice(0, cut.index).trim();
            const cond = inner.slice(cut.index + cut[0].length).trim();
            const hx = / \\in /.exec(mask(head));
            const vars = hx ? head.slice(0, hx.index).trim() : head;
            const space = hx ? head.slice(hx.index + 5).trim() : null;
            const tuple = /^\((.*)\)$/.exec(vars);
            const variables = tuple ? split(tuple[1], /, /).pieces : [vars];
            if (!variables.every((v) => new RegExp(`^${VARL}$`).test(mask(v)))) continue;
            return { variables, space, condition: strip(cond) };
        }
        if ((REL.test(im) && INEQ.test(im)) || / = /.test(im)) {
            // a set given by its conditions only
            return { variables: [], space: null, condition: strip(inner) };
        }
    }
    return null;
}
function epigraph(s: string): Internal | null {
    const e = /\\operatorname\{epi\}\s*\(?\s*([A-Za-z](?:_[A-Za-z0-9])?)/.exec(s) ?? /(?<![A-Za-z\\])epi\s*\(?\s*([A-Za-z])/.exec(s);
    if (e) return { fn: e[1] };
    const sb = setBuilder(s);
    if (!sb || sb.variables.length !== 2) return null;
    const x = /(?<![A-Za-z\\])([A-Za-z](?:_[A-Za-z0-9])?)\(/.exec(sb.condition);
    return x ? { fn: x[1] } : null;
}
function jensen(s: string): Internal | null {
    const w = /1 - (\\[a-z]+|[a-z])(?:_[a-z0-9])?\)/.exec(s);
    const calls = [...s.matchAll(/(?<![A-Za-z\\])([A-Za-z])\(/g)].map((x) => x[1]);
    const fn = calls.find((c) => calls.filter((d) => d === c).length >= 3);
    if (!w || !fn || !INEQ.test(mask(s))) return null;
    return { fn, weight: w[1] };
}
function map(s: string): Internal | null {
    for (const part of partsOf(s)) {
        const x = match(part.tex, new RegExp(String.raw`^(${NAME}|\\(?:ln|sin|cos|tan|exp|log))\s*: (.+?) \\to (.+?)(?:, .*)?$`));
        if (x) return { name: x[1] as string, domain: strip(x[2] as string), codomain: strip(x[3] as string) };
    }
    return null;
}

// ---------------------------------------------------------------- linear algebra

/** A written matrix: its environment, its rows of cells, where it stands in the string. */
interface Env {
    env: string;
    rows: string[][];
    start: number;
    end: number;
}

const ENV = /\\begin\{([pbBvV]?matrix|smallmatrix|array)\}(□*)\\end\{\1\}/;
/** A matrix environment at position x of the mask: rows of cells. */
function cellsOf(body: string): string[][] {
    return split(body, /\\\\/)
        .pieces.filter((r) => r)
        .map((r) => split(r, /&/).pieces);
}
/** The first written matrix of a string (at its top level, or inside one round or square bracket pair): its rows, where it is. */
function findEnv(s: string, from = 0): Env | null {
    const m = mask(s);
    const x = new RegExp(ENV.source, 'g');
    x.lastIndex = from;
    const hit = x.exec(m);
    if (hit) {
        const full = s.slice(hit.index, hit.index + hit[0].length);
        const body = full.replace(/^\\begin\{[^}]*\}/, '').replace(/\\end\{[^}]*\}$/, '');
        return { env: hit[1], rows: cellsOf(body), start: hit.index, end: hit.index + hit[0].length };
    }
    // ( \begin{array} ... \end{array} )
    const y = /[([](□*)[)\]]/g;
    y.lastIndex = from;
    for (let b = y.exec(m); b; b = y.exec(m)) {
        const inner = s.slice(b.index + 1, b.index + b[0].length - 1).trim();
        if (/^\\begin\{(?:matrix|array|smallmatrix)\}/.test(inner) && /\\end\{[a-z]*\}$/.test(inner)) {
            const body = inner.replace(/^\\begin\{[^}]*\}/, '').replace(/\\end\{[^}]*\}$/, '');
            return { env: 'pmatrix', rows: cellsOf(body), start: b.index, end: b.index + b[0].length };
        }
    }
    return null;
}
const square = (rows: string[][]) => rows.length >= 2 && rows.every((r) => r.length === rows.length);
const column = (rows: string[][]) => rows.length >= 2 && rows.every((r) => r.length === 1);

function matrix(s: string): Internal | null {
    for (const part of partsOf(s)) {
        const p = part.tex;
        const sides = split(p, EQ).pieces;
        for (let q = 0; q < sides.length; q++) {
            const e = findEnv(sides[q]);
            if (!e || e.start !== 0 || e.end !== sides[q].length || /^[vV]matrix$/.test(e.env) || !square(e.rows)) continue;
            const name = q >= 1 && /^[A-Z]$/.test(sides[0]) ? sides[0] : null;
            return { name, entries: e.rows };
        }
    }
    return null;
}
function det(s: string): Internal | null {
    for (const part of partsOf(s)) {
        const first = split(part.tex, EQ).pieces[0];
        const x = /^\|?\\det\s*\(?\s*([A-Z](?:_[A-Za-z0-9])?)\s*\)?\|?$/.exec(first);
        if (x) return { name: x[1], entries: null };
        const e = findEnv(first);
        if (e && square(e.rows) && (/^\\det/.test(first) || /^[vV]matrix$/.test(e.env))) return { name: null, entries: e.rows };
    }
    return null;
}

/** A written vector at the start of a string: its entries, its length in the string, written as a column, transposed. */
interface VectorAt {
    entries: string[];
    len: number;
    top?: boolean;
    col: boolean;
}

/** A written vector at the start of a string: (a, b)^T, (a | b), a column; its entries and its length in the string. */
function vectorAt(s: string): VectorAt | null {
    const m = mask(s);
    const t = /^([([])(□*)([)\]])(\^(?:\\top|T|\{\\top\}|\{T\}))?/.exec(m);
    if (t) {
        const inner = s.slice(1, t[0].length - 1 - (t[4] ? t[4].length : 0));
        if (/^\\begin/.test(inner.trim())) {
            const e = findEnv(s);
            if (e && e.start === 0) return { entries: e.rows.map((r) => r[0]), len: e.end, col: column(e.rows) };
        }
        let ents = split(inner, /, /).pieces;
        if (ents.length < 2) ents = split(inner, /; /).pieces;
        if (ents.length < 2) ents = split(inner, / \\mid /).pieces;
        if (ents.length >= 2 && ents.length <= 3 && ents.every((e) => e && !hasRel(e))) return { entries: ents, len: t[0].length, top: !!t[4], col: true };
        return null;
    }
    const e = findEnv(s);
    if (e && e.start === 0 && column(e.rows)) return { entries: e.rows.map((r) => r[0]), len: e.end, col: true };
    const b = /^\\binom\{([^{}]*)\}\{([^{}]*)\}/.exec(s);
    if (b) return { entries: [b[1], b[2]], len: b[0].length, col: true };
    return null;
}
const VECNAME = String.raw`(?:\\(?:vec|mathbf|hat)\{[^{}]*\}|[a-z]|\\[a-z]+)(?:_(?:\{[^{}]*\}|[A-Za-z0-9]))?`;
const MATNAME = String.raw`(?:\\mathbf\{[A-Z]\}|[A-Z]|\\[A-Z][a-z]+)(?:_(?:\{[^{}]*\}|[A-Za-z0-9]))?(?:\^(?:\{[^{}]*\}|[A-Za-z0-9]|\\top))?(?:\([^()]*\))?`;

/** A matrix times a vector, each by name or as written. */
interface ProductAt {
    matrix: { name: string | null; entries: string[][] | null };
    vector: { name: string | null; entries: string[] | null };
}

/** matrix times vector at the start of a side: both as a name or as written. */
function productAt(side: string): ProductAt | null {
    let mat: ProductAt['matrix'] | null = null;
    let rest = side;
    const e = findEnv(side);
    if (e && e.start === 0 && !column(e.rows)) {
        mat = { name: null, entries: e.rows };
        rest = side.slice(e.end);
    } else {
        const x = new RegExp(`^((?:${MATNAME})+?)\\s*(?:\\\\cdot\\s*)?(?=${VECNAME}$|[(\\[]|\\\\begin|\\\\binom)`).exec(side);
        if (!x) return null;
        mat = { name: x[1].trim(), entries: null };
        rest = side.slice(x[0].length);
    }
    rest = rest.replace(/^\s*\\cdot\s*/, '').trim();
    if (new RegExp(`^${VECNAME}$`).test(rest)) return { matrix: mat, vector: { name: rest, entries: null } };
    const v = vectorAt(rest);
    if (v && v.len === rest.length) return { matrix: mat, vector: { name: null, entries: v.entries } };
    return null;
}
/** A vector's or a matrix's name as the cards take it: the letter, without arrow, bold or subscript. */
const bareName = (n: string | null | undefined): string | null => {
    const m = /^(?:\\(?:vec|mathbf|hat)\{([A-Za-z])\}|([A-Za-z]))/.exec(n ?? '');
    return m ? m[1] ?? m[2] : null;
};
function product(s: string): Internal | null {
    for (const part of partsOf(s)) {
        const sides = split(part.tex, / (?:=|\\approx|\\mapsto) /).pieces;
        for (const side of sides) {
            const p = productAt(side);
            if (p && p.matrix.name && p.vector.name && /^[A-Z]$/.test(p.matrix.name) && bareName(p.vector.name)) return { matrix: p.matrix.name, vector: bareName(p.vector.name) };
        }
    }
    return null;
}
function eigen(s: string): Internal | null {
    for (const part of partsOf(s)) {
        const p = part.tex;
        const sides = split(p, EQ).pieces;
        if (sides.length < 2) continue;
        // (A - \lambda I) v = 0
        const sh = new RegExp(`^\\(([A-Z])(?:\\^(?:T|\\\\top))? - (.*?)\\s*(?:I|E|\\\\mathbb\\{1\\})?\\)\\s*(${VECNAME})$`).exec(sides[0]);
        if (sh && /^(?:0|\\vec\{0\}|\\mathbf\{0\})$/.test(sides[sides.length - 1]) && bareName(sh[3])) return { matrix: sh[1], vector: bareName(sh[3]) };
        const left = productAt(sides[0]);
        if (!left || !left.matrix.name || !left.vector.name || !/^[A-Z]$/.test(left.matrix.name)) continue;
        const last = sides[sides.length - 1];
        const esc = left.vector.name.replace(/[\\{}^]/g, '\\$&');
        if (new RegExp(`^(.*?)\\s*(?:\\\\cdot\\s*)?${esc}$`).test(last) && bareName(left.vector.name)) return { matrix: left.matrix.name, vector: bareName(left.vector.name) };
    }
    return null;
}

/** A written vector as design C reads it (kind vector): its name, its entries, a factor before it. */
export interface VectorReadC {
    name: string | null;
    entries: string[];
    factor: string | null;
}

function vector(s: string): VectorReadC | null {
    for (const part of partsOf(s)) {
        // a unit after the value is a label
        const p = part.tex.replace(/\s*\\mathrm\{[^{}]*\}$/, '');
        const sides = split(p, / (?:=|\\approx) /).pieces;
        const name = sides.length >= 2 && new RegExp(`^(?:${VECNAME}|[A-Z]|\\\\vec\\{[A-Z]+\\})$`).test(sides[0]) ? sides[0] : null;
        for (let q = sides.length - 1; q >= 0; q--) {
            const side = sides[q];
            // a factor before the vector: \frac{1}{\sqrt{2}}(1, 1)
            for (let cut = 0; cut < side.length; cut++) {
                const c = side[cut];
                if (cut > 0 && !/[([\\]/.test(c)) continue;
                const v = vectorAt(side.slice(cut));
                if (v && cut + v.len === side.length) {
                    const factor = side.slice(0, cut).replace(/\\cdot\s*$/, '').trim();
                    if (factor && hasRel(factor)) break;
                    return { name, entries: v.entries, factor: factor || null };
                }
            }
        }
    }
    return null;
}

// ---------------------------------------------------------------- iterate

function sum(s: string): Internal | null {
    for (const part of partsOf(s)) {
        const p = part.tex;
        const sides = split(p, / (?:=|\\approx|\\in|\\le|<|\\ge|>) /).pieces;
        const at = sides.findIndex((x) => /^\\sum(?![A-Za-z])/.test(x));
        if (at < 0) continue;
        const x = match(sides[at], /^\\sum_\{(□+)\}\^\{(□+)\}\s*(.+)$/);
        if (!x) continue;
        const lo = /^([A-Za-z]|\\[a-z]+) = (.+)$/.exec(x[1] as string);
        if (!lo) continue;
        return { index: lo[1], lo: lo[2], hi: x[2] as string, body: (x[3] as string).trim(), rhs: sides[at + 1] ?? null };
    }
    return null;
}
function recurrence(s: string): Internal | null {
    const parts = partsOf(s);
    for (let q = 0; q < parts.length; q++) {
        const p = parts[q].tex;
        const sides = split(p, EQ).pieces;
        if (sides.length < 2) continue;
        const h = /^(\\[A-Za-z]+|[A-Za-z])_\{([a-z]) \+ 1\}$/.exec(sides[0]) ?? /^(\\[A-Za-z]+|[A-Za-z])_\{?([a-z])\}?$/.exec(sides[0]);
        if (!h) continue;
        const forward = /\+ 1\}$/.test(sides[0]);
        const esc = h[1].replace(/\\/g, '\\\\');
        const ref = forward ? new RegExp(`${esc}_\\{?${h[2]}\\}?(?![A-Za-z0-9+-])`) : new RegExp(`${esc}_\\{${h[2]} - 1\\}`);
        if (!ref.test(sides[1])) continue;
        return { state: h[1], index: h[2], headSub: forward ? `${h[2]}+1` : h[2], step: sides[1] };
    }
    return null;
}

/** The reader of each kind (a plain object, looked up by the kind's name). */
const READERS: Record<string, (s: string) => Internal | VectorReadC | null> = {
    function: functionLike,
    surface: functionLike,
    polar: functionLike,
    domain: functionLike,
    implicit,
    region,
    condition,
    interval,
    set: setBuilder,
    epigraph,
    jensen,
    map,
    matrix,
    det,
    product,
    eigen,
    vector,
    sum,
    recurrence,
};

/**
 * The internal parse of a formula for a kind, or null. With a front F0, its
 * canonical TeX. The kind vector gives a VectorReadC (the vote reads vectors
 * with the plugin's value reader, not with this).
 */
export function readC(tex: string, kind: 'vector', F0?: Front): VectorReadC | null;
export function readC(tex: string, kind: string, F0?: Front): Internal | null;
export function readC(tex: string, kind: string, F0?: Front): Internal | VectorReadC | null {
    const fn = READERS[kind];
    if (!fn) return null;
    try {
        const s = strip(F0 ? print(F0, 0, F0.T.length - 1) : canon(tex));
        return s ? fn(s) : null;
    } catch {
        return null;
    }
}
