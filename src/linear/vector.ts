/*
 * 6.2.1: the hover card of a concrete vector (src/ui/formulaHover.ts shows
 * it when formula recognition labels a formula `vector`):
 *
 *   \vec v = \begin{pmatrix} 2 \\ 1 \end{pmatrix}, (3, -1, 2)^\top, (2|1), \binom{2}{1}   the arrow from the origin
 *   \vec a + \vec b, 2\vec a - \vec b, 3\vec e_1 - 2\vec e_2, (2, 1) + (1, 3)          the terms tip to tail, then the sum
 *   3 \cdot (2, 1), \frac{1}{|\vec a|} \vec a                                         the vector and its multiple
 *   (2, 1) \cdot (1, 3) = 5, \vec a \times \vec b                                     both arrows (and a × b for a cross product)
 *   (1, 0), (0, 1)                                                                     every arrow
 *
 * with the plugin's arrows of 6.0 (docs/reference.md, Arrows): `let` lines
 * for the vectors and `draw v as an arrow`, `draw v + w tip to tail`; 3
 * entries draw in 3D. A name the formula uses without writing its value
 * (\vec a) comes from the note's other formulas (vectorValues, as the
 * matrix card takes its matrix); a letter in an entry ((0, -g)) gets a
 * slider. A formula is read in parts (\qquad, a comma before a new
 * statement) and sides (a = b = c): a head (the vector's name), then the
 * first side that is a dot or cross product, a sum, a multiple, or else the
 * last written vector. Pure: no DOM, no Obsidian.
 */
import { MathContext } from '../mathcontext';
import { isReservedName } from '../expr';
import { compileValue } from '../values';

/** What a vector card draws. */
export type VectorShape = 'one' | 'sum' | 'multiple' | 'dot' | 'cross' | 'list';

export interface VectorHoverCard {
    kind: 'vector';
    shape: VectorShape;
    /** The chart, in chart lines. */
    lines: string[];
    /** 2 (the plane) or 3 (space). */
    dim: 2 | 3;
    /** The note's vectors the card uses, as TeX (\vec a = (1, 2, 3)), for the line under the chart. */
    fromNote: string[];
}

/** A vector the note defines: its value in the chart language and its name as the note writes it. */
export interface NoteVector {
    value: string;
    tex: string;
}

/** The slider letter's range, as the formula charts write theirs (src/formula.ts). */
const SLIDER = (name: string) => `slider ${name} from -5 to 5, starting at 1`;
/** The colours of several arrows, in order. */
const COLOURS = ['blue', 'red', 'green', 'orange', 'violet'];
/** Names for vectors the formula writes without one. */
const SPARE = ['u', 'v', 'w', 'p', 'q', 'r', 's'];
/** A decoration that writes a vector's name. */
const DECO = String.raw`\\(?:vec|mathbf|boldsymbol|bm|hat|widehat|overrightarrow|vv|underline|underrightarrow)`;
/** Greek letters that may name a vector (\vec\tau, \mu). */
const GREEK = new Set('alpha beta gamma delta epsilon varepsilon zeta eta theta vartheta iota kappa lambda mu nu xi rho sigma tau upsilon phi varphi chi psi omega Gamma Delta Theta Lambda Xi Pi Sigma Phi Psi Omega'.split(' '));
/** A name in a value: letters, digits, underscores. */
const ID = /^[A-Za-z][A-Za-z0-9_]*$/;

/** The group that starts at s[i] === '{' (or any opening sign): its end, past the closing sign; -1 when it does not close. */
function closeOf(s: string, i: number): number {
    const open = s[i];
    const close = open === '{' ? '}' : open === '(' ? ')' : open === '[' ? ']' : '';
    let d = 0;
    for (let j = i; j < s.length; j++) {
        if (s[j] === '\\') {
            j++;
            continue;
        }
        if (s[j] === open) d++;
        else if (s[j] === close && --d === 0) return j + 1;
    }
    return -1;
}

/** Split at the top level (outside {} () [] and environments) at every sign of `seps`. */
function splitTopLevel(s: string, seps: string[]): string[] {
    const out: string[] = [];
    let depth = 0;
    let from = 0;
    for (let i = 0; i < s.length; i++) {
        const c = s[i];
        if (c === '\\') {
            if (/^\\begin(?![A-Za-z])/.test(s.slice(i, i + 6))) depth++;
            else if (/^\\end(?![A-Za-z])/.test(s.slice(i, i + 4))) depth = Math.max(0, depth - 1);
            if (depth === 0) {
                const sep = seps.find((x) => x.startsWith('\\') && s.startsWith(x, i) && !/[A-Za-z]/.test(s[i + x.length] ?? ''));
                if (sep) {
                    out.push(s.slice(from, i));
                    i += sep.length - 1;
                    from = i + 1;
                    continue;
                }
            }
            i++;
            continue;
        }
        if (c === '{' || c === '(' || c === '[') depth++;
        else if (c === '}' || c === ')' || c === ']') depth = Math.max(0, depth - 1);
        else if (depth === 0 && seps.includes(c)) {
            out.push(s.slice(from, i));
            from = i + 1;
        }
    }
    out.push(s.slice(from));
    return out.map((p) => p.trim());
}

/** Sizes, spacing, styles, decimal commas, \tfrac12 and units out: the formula as a value reads it. */
function plain(tex: string): string {
    return (
        tex
            .replace(/\\(?:left|right|middle|bigl?|bigr?|Bigl?|Bigr?|biggl?|biggr?|Biggl?|Biggr?)(?![A-Za-z])\s*/g, '')
            .replace(/\\(?:displaystyle|textstyle)(?![A-Za-z])/g, ' ')
            .replace(/(\d)\s*\{,\}\s*(\d)/g, '$1.$2')
            .replace(/\\[dt]frac\s*([0-9])\s*([0-9])/g, '\\frac{$1}{$2}')
            .replace(/\\[dt]frac(?![A-Za-z])/g, '\\frac')
            // a subscript written upright is a name's part: \vec F_{\mathrm{ges}}
            .replace(/_\s*\{\s*\\(?:mathrm|text|textrm|operatorname)\s*\{([^{}]*)\}\s*\}/g, '_{$1}')
            .replace(/_\s*\\(?:mathrm|text|textrm)\s*\{([^{}]*)\}/g, '_{$1}')
            // a unit is a label: (3, 4)\ \mathrm{N}, 3\,\mathrm{N}\,\vec e_x, \mathrm{kg\,m/s}
            .replace(/\\(?:mathrm|text|textrm)\s*\{[^{}]*\}/g, ' ')
            .replace(/\\mathrm\s+[A-Za-z]+/g, ' ')
            // a row break \\ stays; \, \; \: \! and "\ " are spaces
            .replace(/\\\\|\\[,;:! ]|~/g, (m: string) => (m === '\\\\' ? m : ' '))
            .replace(/\\q?quad(?![A-Za-z])/g, ' \\qquad ')
            .replace(/\\(?:lVert|rVert|Vert)(?![A-Za-z])|\\\|/g, '|')
            .replace(/\\(?:lvert|rvert|vert)(?![A-Za-z])/g, '|')
            .replace(/\\(?:imath)(?![A-Za-z])/g, 'i')
            .replace(/\\(?:jmath)(?![A-Za-z])/g, 'j')
            .replace(/\s+/g, ' ')
            .trim()
    );
}

/** A matrix environment with one column (or one row before a transposition sign): its entries as a tuple; else as it is. */
function columns(s: string): string {
    const re = /\\begin\s*\{\s*([pbBvV]?matrix|smallmatrix|array)\s*\}/g;
    let out = '';
    let from = 0;
    for (let m = re.exec(s); m; m = re.exec(s)) {
        const env = m[1];
        let bodyAt = m.index + m[0].length;
        // an array's column spec: {c}, {r}
        if (env === 'array' && s[bodyAt] === '{') bodyAt = closeOf(s, bodyAt);
        const endRe = new RegExp(String.raw`\\end\s*\{\s*${env}\s*\}`, 'g');
        endRe.lastIndex = bodyAt;
        const e = bodyAt < 0 ? null : endRe.exec(s);
        if (!e) return s;
        const body = s.slice(bodyAt, e.index);
        const rows = body
            .split(/\\\\/)
            .map((r) => r.trim())
            .filter((r) => r);
        const cells = rows.map((r) => r.split('&').map((c) => c.trim()));
        const after = s.slice(e.index + e[0].length);
        const top = /^\s*\^\s*(?:\{\s*(?:\\top|T|\\intercal)\s*\}|\\top|T|\\intercal)/.exec(after);
        let tuple: string | null = null;
        if (cells.length >= 2 && cells.every((c) => c.length === 1)) tuple = `(${cells.map((c) => c[0]).join(', ')})`;
        else if (cells.length === 1 && cells[0].length >= 2 && top) tuple = `(${cells[0].join(', ')})`;
        let end = e.index + e[0].length;
        if (tuple === null || env === 'vmatrix' || env === 'Vmatrix') {
            out += s.slice(from, end);
        } else {
            // a bare environment in its own brackets is the column: ( matrix ), [ array ]
            let lead = s.slice(from, m.index);
            const close = /^\s*[)\]]/.exec(after);
            const bare = env === 'matrix' || env === 'smallmatrix' || env === 'array';
            if (bare && close && /[([]\s*$/.test(lead)) {
                lead = lead.replace(/[([]\s*$/, '');
                end += close[0].length;
            } else if (top && cells.length === 1) end += top[0].length;
            out += lead + tuple;
        }
        from = end;
        re.lastIndex = end;
    }
    return out + s.slice(from);
}

/** \binom{a}{b} as (a, b); (a, b)^\top and [a, b]^T as (a, b); (a|b|c) and (a; b) as (a, b, c); \langle a, b \rangle as (a, b) or a dot product. */
function tuples(sIn: string): string {
    let s = sIn.replace(/\\[dt]?binom\s*\{([^{}]*)\}\s*\{([^{}]*)\}/g, '($1, $2)').replace(/\\[dt]?binom\s*([0-9])\s*([0-9])/g, '($1, $2)');
    // a transposition sign after a bracket: the bracket is a column
    s = s.replace(/\]\s*\^\s*(?:\{\s*(?:\\top|T|\\intercal)\s*\}|\\top|T|\\intercal)/g, ']\u0001').replace(/\)\s*\^\s*(?:\{\s*(?:\\top|T|\\intercal)\s*\}|\\top|T|\\intercal)/g, ')');
    // [a, b] with its sign: (a, b)
    let out = '';
    for (let i = 0; i < s.length; i++) {
        if (s[i] === '[') {
            const e = closeOf(s, i);
            if (e > 0 && s[e] === '\u0001') {
                out += `(${s.slice(i + 1, e - 1)})`;
                i = e;
                continue;
            }
        }
        if (s[i] !== '\u0001') out += s[i];
    }
    s = out;
    // ( a | b ) and ( a ; b ): the entries of a point or a vector
    out = '';
    for (let i = 0; i < s.length; i++) {
        if (s[i] === '(') {
            const e = closeOf(s, i);
            if (e > 0) {
                const inner = s.slice(i + 1, e - 1);
                const bars = splitTopLevel(inner, ['|']);
                const semis = splitTopLevel(inner, [';']);
                const pieces = bars.length >= 2 && !inner.includes(',') ? bars : semis.length >= 2 && !inner.includes(',') ? semis : null;
                if (pieces && pieces.length <= 3 && pieces.every((p) => p && !/[|]/.test(p))) {
                    out += `(${pieces.map((p) => tuples(p)).join(', ')})`;
                    i = e - 1;
                    continue;
                }
            }
        }
        out += s[i];
    }
    s = out;
    // \langle u, v \rangle: two vectors (their dot product) or the entries of one
    s = s.replace(/\\langle\s*([\s\S]*?)\s*\\rangle/g, (m: string, inner: string) => {
        const parts = splitTopLevel(inner, [',']);
        if (parts.length === 2 && parts.every((p) => /^\(.*\)$/.test(p) || ID.test(p) || new RegExp(`^${DECO}`).test(p))) return `${parts[0]} \\cdot ${parts[1]}`;
        return `(${inner})`;
    });
    return s;
}

/** A name of the formula (\vec F_{ges}, \overrightarrow{AB}, \mathbf{e}_1, \hat n, v_1, \tau) as a chart name, or null. */
function nameId(raw: string): string | null {
    let s = raw.trim();
    let delta = '';
    const d = /^\\Delta\s*/.exec(s);
    if (d) {
        delta = 'Delta_';
        s = s.slice(d[0].length);
    }
    const deco = new RegExp(`^${DECO}\\s*`).exec(s);
    if (deco) s = s.slice(deco[0].length);
    let base = '';
    let sub = '';
    if (s[0] === '{') {
        const e = closeOf(s, 0);
        if (e < 0) return null;
        const inner = s.slice(1, e - 1).trim();
        s = s.slice(e).trim();
        const m = /^(\\[A-Za-z]+|[A-Za-z]{1,3})(?:\s*_\s*(\{[^{}]*\}|[A-Za-z0-9]))?$/.exec(inner);
        if (!m) return null;
        base = m[1];
        if (m[2]) sub = m[2];
    } else {
        const m = /^(\\[A-Za-z]+|[A-Za-z])/.exec(s);
        if (!m) return null;
        base = m[1];
        s = s.slice(m[0].length).trim();
    }
    const sm = /^_\s*(\{[^{}]*\}|[A-Za-z0-9])/.exec(s);
    if (sm) {
        if (sub) return null;
        sub = sm[1];
        s = s.slice(sm[0].length).trim();
    }
    if (s) return null;
    // a command is a Greek letter (\tau), never another command (\frac, \sin)
    if (base.startsWith('\\')) {
        base = base.slice(1);
        if (!GREEK.has(base)) return null;
    }
    if (!/^[A-Za-z]+$/.test(base)) return null;
    sub = sub.replace(/^\{|\}$/g, '').replace(/\s+/g, '');
    if (sub && !/^[A-Za-z0-9]+$/.test(sub)) return null;
    return `${delta}${base}${sub ? `_${sub}` : ''}`;
}

/** The decorated and plain names of a side as chart names (`names` collects name to TeX); i, j, k as the basis e_x, e_y, e_z. */
function namesOf(sIn: string, names: Map<string, string>): string {
    const deco = new RegExp(String.raw`(?:\\Delta\s*)?${DECO}\s*(?:\{[^{}]*\}|\\[A-Za-z]+|[A-Za-z0-9])(?:\s*_\s*(?:\{[^{}]*\}|[A-Za-z0-9]))?`, 'g');
    let s = sIn.replace(deco, (m: string) => {
        const id = nameId(m);
        if (!id) return m;
        const basis = /^([ijk])$/.exec(id);
        const out = basis ? `e_${'xyz'['ijk'.indexOf(basis[1])]}` : id;
        if (!names.has(out)) names.set(out, m.trim());
        return ` ${out} `;
    });
    // plain i, j, k standing alone: the basis vectors
    s = s.replace(/(?<![\\A-Za-z_{])([ijk])(?![A-Za-z_}])/g, (_m: string, l: string) => ` e_${'xyz'['ijk'.indexOf(l)]} `);
    // a name with a subscript in braces: v_{1}, F_{ges}
    s = s.replace(/(?<![\\A-Za-z])([A-Za-z])\s*_\s*\{\s*([A-Za-z0-9]+)\s*\}/g, '$1_$2');
    // \circ between vectors is the dot product (German school notation)
    s = s.replace(/\\circ(?![A-Za-z])/g, '\\cdot');
    return s.replace(/\s+/g, ' ').trim();
}

/** One side of a formula as a value of the chart language, with the names it uses. */
function valueOf(side: string, names: Map<string, string>): string {
    return namesOf(tuples(columns(side)), names);
}

/** A remark after a vector: \in \mathbb{R}^2. */
const IN_SPACE = /\s*\\in\s*\\mathbb\s*\{?\s*R\s*\}?\s*(?:\^\s*\{?\s*[0-9n]\s*\}?)?\s*$/;

/** The parts of a formula: \qquad, a comma or semicolon before a statement (a = ..., b = ...). */
function partsOf(tex: string): string[] {
    const big = plain(tex).split(/\\qquad/);
    const out: string[] = [];
    for (const p of big) {
        const pieces = splitTopLevel(p, [',', ';']);
        // a list of statements: every piece holds a relation; else the part as it is (a list of vectors)
        if (pieces.length > 1 && pieces.every((q) => /(?<![<>!\\])=/.test(q))) out.push(...pieces);
        else out.push(p);
    }
    return out.map((p) => p.trim().replace(/[.,;]$/, '').trim()).filter((p) => p);
}

/** The lets a card needs: name to value (the note's, the basis, the formula's own). */
type Lets = Map<string, string>;

interface Evaluated {
    kind: 'vec' | 'num' | 'other';
    v: number[];
}

/** A chart name that is no name the chart reserves (x, y, z, t, e, pi, i, sin ...). */
function safeName(id: string, taken: ReadonlySet<string>): string {
    if (!isReservedName(id) && ID.test(id)) return id;
    let k = 0;
    let n = `${id}_v`;
    while (taken.has(n) || isReservedName(n)) n = `${id}_v${++k}`;
    return n;
}

const BASIS: Record<string, string> = { e_x: '(1, 0)', e_y: '(0, 1)', e_1: '(1, 0)', e_2: '(0, 1)' };
const BASIS3: Record<string, string> = { e_x: '(1, 0, 0)', e_y: '(0, 1, 0)', e_z: '(0, 0, 1)', e_1: '(1, 0, 0)', e_2: '(0, 1, 0)', e_3: '(0, 0, 1)' };

/** The identifiers a value uses (not the commands of its LaTeX). */
function identifiersOf(value: string): string[] {
    const out: string[] = [];
    for (const m of value.matchAll(/(?<![\\A-Za-z0-9_])([A-Za-z][A-Za-z0-9_]*)/g)) if (!out.includes(m[1])) out.push(m[1]);
    return out;
}

/** The free letters of a value that are no let and nothing reserved: its parameters. */
function freeLetters(value: string, lets: Lets): string[] {
    return identifiersOf(value).filter((n) => !lets.has(n) && !isReservedName(n) && /^[A-Za-z](?:_[A-Za-z0-9]+)?$/.test(n));
}

/** Evaluate a value with the lets and the sliders (each at 1). */
function evaluate(value: string, lets: Lets, sliders: readonly string[]): Evaluated {
    try {
        const ctx = new MathContext({
            parameters: sliders.map((name) => ({ name, value: 1, min: -5, max: 5, step: 0.1 })),
            values: [...lets].map(([name, expression]) => ({ name, params: [], expression })),
        });
        const v = compileValue(ctx, value).run();
        if (typeof v === 'number') return Number.isFinite(v) ? { kind: 'num', v: [v] } : { kind: 'other', v: [] };
        if (v.kind === 'vec' && (v.v.length === 2 || v.v.length === 3) && v.v.every((x) => typeof x === 'number' && Number.isFinite(x))) return { kind: 'vec', v: v.v as number[] };
        return { kind: 'other', v: [] };
    } catch {
        return { kind: 'other', v: [] };
    }
}

/** Split a value into its terms at the top level + and - (signs kept): `2 a - b` is `2 a` and `-b`. */
function termsOf(value: string): string[] {
    const out: string[] = [];
    let depth = 0;
    let from = 0;
    let bars = 0;
    for (let i = 0; i < value.length; i++) {
        const c = value[i];
        if (c === '\\') {
            const m = /^\\[A-Za-z]+/.exec(value.slice(i));
            if (m) i += m[0].length - 1;
            continue;
        }
        if (c === '{' || c === '(' || c === '[') depth++;
        else if (c === '}' || c === ')' || c === ']') depth--;
        else if (c === '|') bars = bars ? 0 : 1;
        else if ((c === '+' || c === '-') && depth === 0 && !bars) {
            const before = value.slice(from, i).trim();
            // a sign after an operator or at the start is no new term
            if (!before || /[*/^_(,]$|\\cdot$|\\times$/.test(value.slice(0, i).trim())) continue;
            out.push(before);
            from = i;
        }
    }
    out.push(value.slice(from).trim());
    return out.filter((t) => t);
}

/** A product of two factors at the top level (\cdot or \times), or null. */
function productOf(value: string): { a: string; b: string; cross: boolean } | null {
    const dots = splitTopLevel(value, ['\\cdot']);
    const crosses = splitTopLevel(value, ['\\times']);
    if (dots.length === 2 && crosses.length === 1) return { a: dots[0], b: dots[1], cross: false };
    if (crosses.length === 2 && dots.length === 1) return { a: crosses[0], b: crosses[1], cross: true };
    return null;
}

/** A number times a vector: the vector (a bracket or a name at the end, or the factor after \cdot) and its factor, or null. */
function multipleOf(value: string, lets: Lets, sliders: readonly string[]): { k: string; v: string } | null {
    const p = productOf(value);
    if (p && !p.cross) {
        if (evaluate(p.a, lets, sliders).kind === 'num' && evaluate(p.b, lets, sliders).kind === 'vec') return { k: p.a, v: p.b };
        if (evaluate(p.b, lets, sliders).kind === 'num' && evaluate(p.a, lets, sliders).kind === 'vec') return { k: p.b, v: p.a };
        return null;
    }
    const t = value.trim();
    let v = '';
    if (t.endsWith(')')) {
        let d = 0;
        for (let i = t.length - 1; i >= 0; i--) {
            if (t[i] === ')') d++;
            else if (t[i] === '(' && --d === 0) {
                v = t.slice(i);
                break;
            }
        }
    } else v = /[A-Za-z][A-Za-z0-9_]*$/.exec(t)?.[0] ?? '';
    const k = t.slice(0, t.length - v.length).trim();
    if (!v || !k || /[+-]$/.test(k) || k.endsWith('\\')) return null;
    return evaluate(k, lets, sliders).kind === 'num' && evaluate(v, lets, sliders).kind === 'vec' ? { k, v } : null;
}

/** A value as the chart line writes it: in $...$ when it is LaTeX. */
const inMath = (v: string) => (/[\\{}|]/.test(v) ? `$${v}$` : v);

/** A label with the formula's own TeX for a name, or the written vector. */
const labelOf = (tex: string) => `labelled "$${braced(tex.replace(/"/g, ''))}$"`;

/** A decoration over one letter in braces (\vec n is \vec{n}): the labels of a 3D chart read only that form (as \vec{n}, n with an arrow). */
const braced = (tex: string) => tex.replace(/\\(vec|hat|bar|tilde|dot|mathbf|boldsymbol|bm)\s*(?![{\s])(\\[A-Za-z]+|[A-Za-z0-9])/g, '\\$1{$2}');

/** The view around the points (with the origin): 2D with equal scale, 3D as a box. */
function viewLines(points: number[][], dim: 2 | 3): string[] {
    const axes = dim === 3 ? ['x', 'y', 'z'] : ['x', 'y'];
    const ranges = axes.map((_a, k) => {
        const vals = [0, ...points.map((p) => p[k] ?? 0)];
        let lo = Math.min(...vals);
        let hi = Math.max(...vals);
        const pad = Math.max(0.6, 0.15 * (hi - lo));
        lo = Math.floor(lo - pad);
        hi = Math.ceil(hi + pad);
        return [lo, hi];
    });
    if (dim === 2) {
        const [[x0, x1], [y0, y1]] = ranges;
        return [`show x from ${x0} to ${x1} and y from ${y0} to ${y1}`, 'equal scale'];
    }
    // space: one length on every axis, so the arrows keep their angles
    const m = Math.max(...ranges.map(([a, b]) => Math.max(-a, b)));
    return ['3d', `show x from -${m} to ${m} and y from -${m} to ${m} and z from -${m} to ${m}`];
}

/** Read one part: its head (a name) and the sides after it, as values. */
function readPart(part: string): { head: string | null; headTex: string | null; sides: string[]; raw: string[]; names: Map<string, string> } | null {
    const names = new Map<string, string>();
    let p = part.replace(IN_SPACE, '');
    // a label before the vector: g: ..., "Ortsvektor:"
    p = p.replace(/^[A-Za-z]\s*:(?!=)\s*/, '');
    const raw = splitTopLevel(p, ['=', '\\approx']).filter((s) => s && s !== '\\dots' && s !== '\\cdots' && s !== '\\ldots');
    if (!raw.length) return null;
    let head: string | null = null;
    let headTex: string | null = null;
    let rest = raw;
    if (raw.length >= 2) {
        const id = nameId(raw[0]);
        if (id) {
            head = id;
            headTex = raw[0];
            rest = raw.slice(1);
        }
    }
    return { head, headTex, sides: rest.map((s) => valueOf(s, names)), raw: rest, names };
}

/** The vectors a note's formulas define (\vec a = (1, 2, 3), v = \begin{pmatrix} 2 \\ 1 \end{pmatrix}, \vec{AB} = (-2|4|0)): name to value and TeX. */
export function vectorValues(formulas: readonly string[]): Map<string, NoteVector> {
    const out = new Map<string, NoteVector>();
    const lets: Lets = new Map();
    // twice: a vector defined by others (\vec n = \vec{AB} \times \vec{AC}) after those
    for (let pass = 0; pass < 2; pass++) {
        for (const f of formulas) {
            let parts: string[];
            try {
                parts = partsOf(f);
            } catch {
                continue;
            }
            for (const part of parts) {
                const r = readPart(part);
                if (!r || !r.head || !r.headTex || out.has(r.head)) continue;
                // the last side that is a vector of numbers (or of the note's vectors)
                for (let k = r.sides.length - 1; k >= 0; k--) {
                    const side = r.sides[k];
                    if (freeLetters(side, lets).length) continue;
                    const e = evaluate(side, lets, []);
                    if (e.kind !== 'vec') continue;
                    out.set(r.head, { value: side, tex: r.headTex });
                    lets.set(r.head, side);
                    break;
                }
            }
        }
    }
    return out;
}

/** Is this a formula the vector card can draw (the quick check of the dotted mark)? */
export function vectorHoverKind(tex: string, values: ReadonlyMap<string, NoteVector> = new Map()): 'vector' | null {
    return vectorHoverCard(tex, values) ? 'vector' : null;
}

/** The chart of a concrete vector, a sum, a multiple, a product or a list of vectors; null when the formula holds none. */
export function vectorHoverCard(tex: string, values: ReadonlyMap<string, NoteVector> = new Map()): VectorHoverCard | null {
    let parts: string[];
    try {
        parts = partsOf(tex);
    } catch {
        return null;
    }
    for (const part of parts.slice(0, 4)) {
        try {
            const card = cardOfPart(part, values);
            if (card) return card;
        } catch {
            // a part the reader cannot take: the next one
        }
    }
    return null;
}

function cardOfPart(part: string, values: ReadonlyMap<string, NoteVector>): VectorHoverCard | null {
    const r = readPart(part);
    if (!r) return null;
    const { head, headTex, sides, raw, names } = r;
    // A list of vectors: (1, 0), (0, 1).
    if (!head && sides.length === 1) {
        const items = splitTopLevel(sides[0], [',']);
        if (items.length >= 2 && items.length <= 5 && items.every((x) => /^\(.*\)$/.test(x))) return listCard(items);
    }
    // The lets: the note's vectors the sides use, then the basis.
    const used = new Set(sides.flatMap(identifiersOf));
    const lets: Lets = new Map();
    const fromNote = new Map<string, string>();
    const take = (id: string, seen: Set<string>) => {
        const nv = values.get(id);
        if (!nv || lets.has(id) || seen.has(id)) return;
        seen.add(id);
        for (const dep of identifiersOf(nv.value)) take(dep, seen);
        lets.set(id, nv.value);
        fromNote.set(id, `${nv.tex} = ${texOfValue(nv.value)}`);
    };
    for (const id of used) take(id, new Set());
    const dimGuess = sides.some((s) => /\(\s*[^(),]+,\s*[^(),]+,\s*[^(),]+\)/.test(s)) || [...lets.values()].some((v) => /\(\s*[^(),]+,\s*[^(),]+,\s*[^(),]+\)/.test(v)) || used.has('e_z') || used.has('e_3') ? 3 : 2;
    for (const id of used) {
        const b = (dimGuess === 3 ? BASIS3 : BASIS)[id];
        if (b && !lets.has(id)) lets.set(id, b);
    }
    // The parameters: one letter at most, as a slider (sides with other letters do not read).
    const free = new Set(sides.flatMap((s) => freeLetters(s, lets)));
    if (head) free.delete(head);
    const sliders = free.size === 1 ? [...free] : [];
    const readable = (s: string) => freeLetters(s, lets).every((n) => sliders.includes(n));
    const ev = (s: string) => (readable(s) ? evaluate(s, lets, sliders) : { kind: 'other' as const, v: [] });
    const vecSides = sides.filter((s) => ev(s).kind === 'vec');
    // The values the formula writes out (no names in them): a calculation must give them (else a name means another vector).
    const written = sides.filter((s) => !identifiersOf(s).length).map((s) => ev(s)).filter((e) => e.kind !== 'other');
    const agrees = (e: Evaluated) => written.every((w) => w.kind !== e.kind || (w.v.length === e.v.length && w.v.every((c, k) => Math.abs(c - e.v[k]) <= 0.01 * (1 + Math.abs(c)))));
    const taken = new Set<string>([...lets.keys(), ...sliders, ...(head ? [head] : [])]);
    const spare = () => {
        const n = SPARE.find((x) => !taken.has(x)) ?? `v_${taken.size}`;
        taken.add(n);
        return n;
    };
    const texName = (id: string) => names.get(id) ?? null;

    // 1. A dot or cross product of two vectors.
    for (const s of sides) {
        const p = productOf(s);
        if (!p) continue;
        const a = ev(p.a);
        const b = ev(p.b);
        if (a.kind !== 'vec' || b.kind !== 'vec' || a.v.length !== b.v.length) continue;
        if (p.cross && a.v.length !== 3) continue;
        const dim = a.v.length as 2 | 3;
        const arrow = (src: string, colour: string): { line: string; name: string; tex: string } => {
            if (ID.test(src) && lets.has(src)) {
                const tex = texName(src) ?? `\\vec{${src}}`;
                return { line: `draw ${src} as an arrow in ${colour}, ${labelOf(tex)}`, name: src, tex };
            }
            const n = spare();
            lets.set(n, src);
            return { line: `draw ${n} as an arrow in ${colour}, ${labelOf(texOfValue(src))}`, name: n, tex: texOfValue(src) };
        };
        if (!p.cross && !agrees(evaluate(`${p.a} \\cdot ${p.b}`, lets, sliders))) continue;
        if (p.cross && !agrees(evaluate(`${p.a} \\times ${p.b}`, lets, sliders))) continue;
        const A = arrow(p.a, 'blue');
        const B = arrow(p.b, 'green');
        const points = [a.v, b.v];
        const draws = [A.line, B.line];
        if (p.cross) {
            const c = evaluate(`${A.name} \\times ${B.name}`, lets, sliders);
            if (c.kind === 'vec') {
                points.push(c.v);
                draws.push(`draw $${A.name} \\times ${B.name}$ as an arrow in red, ${labelOf(`${A.tex} \\times ${B.tex}`)}`);
            }
        }
        return finish(p.cross ? 'cross' : 'dot', dim, points, lets, sliders, draws, fromNote);
    }
    // 2. A sum or difference of two or more vectors: tip to tail.
    for (const s of sides) {
        const terms = termsOf(s);
        if (terms.length < 2 || terms.length > 5) continue;
        const vals = terms.map((t) => ev(t.replace(/^\+/, '')));
        if (vals.some((v) => v.kind !== 'vec') || vals.some((v) => v.v.length !== vals[0].v.length)) continue;
        const dim = vals[0].v.length as 2 | 3;
        // written vectors in the terms get a name of their own
        let expr = '';
        terms.forEach((t, i) => {
            const sign = t.startsWith('-') ? '-' : '+';
            const body = t.replace(/^[+-]\s*/, '');
            const named = body.replace(/\((?:[^()]|\([^()]*\))*\)/g, (m: string) => {
                if (evaluate(m, lets, sliders).kind !== 'vec') return m;
                const n = spare();
                lets.set(n, m);
                return ` ${n} `;
            });
            expr += `${i === 0 ? (sign === '-' ? '-' : '') : ` ${sign} `}${named.replace(/\s+/g, ' ').trim()}`;
        });
        const total = evaluate(expr, lets, sliders);
        if (total.kind !== 'vec' || !agrees(total)) continue;
        const points: number[][] = [];
        let at = vals[0].v.map(() => 0);
        for (const v of vals) {
            at = at.map((c, k) => c + v.v[k]);
            points.push(v.v, at.slice());
        }
        return finish('sum', dim, points, lets, sliders, [`draw ${inMath(expr)} tip to tail in red, labelled`], fromNote);
    }
    // 3. A multiple of a vector: the vector and the multiple.
    for (const s of sides) {
        const m = multipleOf(s, lets, sliders);
        if (!m) continue;
        const v = ev(m.v);
        const total = ev(s);
        if (v.kind !== 'vec' || total.kind !== 'vec' || !agrees(total)) continue;
        const dim = v.v.length as 2 | 3;
        let base = m.v;
        let baseLabel = texName(base) ?? `\\vec{${base}}`;
        if (!(ID.test(base) && lets.has(base))) {
            const n = spare();
            lets.set(n, base);
            baseLabel = texOfValue(base);
            base = n;
        }
        const name = head ? safeName(head, taken) : spare();
        lets.set(name, `${m.k} ${base}`);
        const draws = [`draw ${base} as an arrow in blue, ${labelOf(baseLabel)}`, `draw ${name} as an arrow in red, ${labelOf(headTex ?? `${m.k} ${baseLabel}`)}`];
        return finish('multiple', dim, [v.v, total.v], lets, sliders, draws, fromNote);
    }
    // 4. The vector: the last side that is one, named and labelled as the formula names it (its head, or the
    // calculation before it: \vec a + \vec b = (4, 1)).
    const at = sides.lastIndexOf(vecSides[vecSides.length - 1]);
    if (at < 0) return null;
    const last = sides[at];
    const e = ev(last);
    const dim = e.v.length as 2 | 3;
    const own = head && !identifiersOf(last).includes(head) ? safeName(head, taken) : null;
    const name = own ?? spare();
    lets.set(name, last);
    const label = headTex ?? (at > 0 ? raw[0] : texOfValue(last));
    return finish('one', dim, [e.v], lets, sliders, [`draw ${name} as an arrow in blue, ${labelOf(label)}`], fromNote);
}

/** A list of written vectors: one arrow each. */
function listCard(items: string[]): VectorHoverCard | null {
    const lets: Lets = new Map();
    const vals = items.map((x) => evaluate(x, lets, []));
    if (vals.some((v) => v.kind !== 'vec') || vals.some((v) => v.v.length !== vals[0].v.length)) return null;
    const dim = vals[0].v.length as 2 | 3;
    const draws: string[] = [];
    items.forEach((x, i) => {
        const n = `v_${i + 1}`;
        lets.set(n, x);
        draws.push(`draw ${n} as an arrow in ${COLOURS[i % COLOURS.length]}, ${labelOf(texOfValue(x))}`);
    });
    return finish(
        'list',
        dim,
        vals.map((v) => v.v),
        lets,
        [],
        draws,
        new Map()
    );
}

/** A value as TeX for a label: (2, 1) stays, the rest as it reads. */
function texOfValue(v: string): string {
    return v.replace(/\s+/g, ' ').trim();
}

/**
 * The card's lines: the view, the sliders and lets the arrows use (a let
 * of the note no arrow needs stays out, so does its line under the chart),
 * the arrows. Null for the zero vector (no arrow) and mixed dimensions.
 */
function finish(shape: VectorShape, dim: 2 | 3, points: number[][], lets: Lets, sliders: readonly string[], draws: string[], fromNote: ReadonlyMap<string, string>): VectorHoverCard | null {
    if (points.some((p) => p.length !== dim) || points.every((p) => p.every((c) => c === 0))) return null;
    const need = new Set<string>();
    const visit = (src: string) => {
        for (const n of identifiersOf(src.replace(/"[^"]*"/g, ''))) {
            if (need.has(n)) continue;
            need.add(n);
            const v = lets.get(n);
            if (v !== undefined) visit(v);
        }
    };
    for (const d of draws) visit(d);
    const letLines = [...lets].filter(([n]) => need.has(n)).map(([n, v]) => `let ${n} = ${inMath(v)}`);
    const sliderLines = sliders.filter((n) => need.has(n)).map(SLIDER);
    const from = [...fromNote].filter(([n]) => need.has(n)).map(([, line]) => line);
    // In space the labels are text: an arrow over a letter (a combining sign) shows badly there, the letter alone well.
    const drawLines = dim === 3 ? draws.map((d) => d.replace(/labelled "([^"]*)"/, (_m: string, l: string) => `labelled "${l.replace(/\\(?:vec|overrightarrow|mathbf|boldsymbol|bm)\s*\{([^{}]*)\}/g, '$1')}"`)) : draws;
    return { kind: 'vector', shape, lines: [...viewLines(points, dim), ...sliderLines, ...letLines, ...drawLines], dim, fromNote: from };
}
