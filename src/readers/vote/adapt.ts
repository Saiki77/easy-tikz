/*
 * From the internal parse of a design (roles as canonical TeX, internal.ts)
 * to the parses of src/readers/types.ts, best first (6.2.4). A port of the
 * frozen adapt.mjs (hover-ml readers), line by line. This step holds the
 * conventions of the cards (which letter is the variable, which name a
 * function keeps, what a map's domain may be), as reader 0 and the builders
 * have them. It is the same for the three designs: a design decides the
 * roles, this step writes them down.
 *
 * It keeps its own copies of a few rules of src/latex.ts and
 * src/notes6/recognize/adapt.ts (splitRuns, productsOf, plainGreek): the
 * frozen readers were measured with these, and the vote must give the same
 * parses. Pure: no DOM, no Obsidian.
 */
import type { CardParse, ChartParse, ConditionParse, DomainParse, FunctionParse, FunctionPiece, ImplicitParse, IntervalParse, MapParse, PolarParse, ReadContext, RegionParse, SetParse, SumParse, SurfaceParse } from '../types';
import type { FnRead, Internal } from './internal';

const GREEK = 'alpha|beta|gamma|delta|varepsilon|epsilon|zeta|eta|theta|vartheta|kappa|lambda|mu|nu|xi|rho|sigma|tau|varphi|phi|chi|psi|omega|Omega|Theta|Phi';
/** A variable: a letter or a Greek letter, maybe with a subscript. */
const VAR = new RegExp(String.raw`^(?:[A-Za-z]|\\(?:${GREEK}))(?:_(?:\{[A-Za-z0-9]+\}|[A-Za-z0-9]))?$`);
const RESERVED = new Set(['x', 'y', 'z', 't', 'e', 'E', 'i', 'r']);
const clean = (s: string | null | undefined): string => String(s ?? '').replace(/^[\s,;.]+|[\s,;.]+$/g, '');
const esc = (s: string): string => s.replace(/[\\^$.*+?()[\]{}|]/g, '\\$&');

/** What adapt reads around a formula: the note's functions (calls, no products) and sets (a map's domain). */
export type AdaptContext = Pick<ReadContext, 'functions' | 'domains'>;

/** Where a variable stands alone (never inside a command, a longer name or a subscript). */
export function standalone(v: string): RegExp {
    const m = /^(\\?[A-Za-z]+)(?:_(?:\{([A-Za-z0-9]+)\}|([A-Za-z0-9])))?$/.exec(v.trim());
    if (!m) return new RegExp(esc(v), 'g');
    const base = esc(m[1]);
    const sub = m[2] ?? m[3];
    const head = m[1].startsWith('\\') ? base : `(?<![\\\\A-Za-z_]|_\\{)${base}`;
    if (sub === undefined) return new RegExp(`${head}(?![A-Za-z_])`, 'g');
    return new RegExp(`${head}\\s*_\\s*(?:\\{\\s*${sub}\\s*\\}${sub.length === 1 ? `|${sub}(?![0-9])` : ''})`, 'g');
}
const TEXTY = /\\(?:text|operatorname|mathrm|begin|end)\s*\{[^{}]*\}/g;
const WORDS = new Set(['sin', 'cos', 'tan', 'cot', 'ln', 'log', 'exp', 'sqrt', 'abs', 'max', 'min', 'pi', 'theta', 'alpha', 'beta', 'gamma', 'delta', 'lambda', 'mu', 'sigma', 'omega', 'phi', 'rho', 'tau', 'arcsin', 'arccos', 'arctan', 'sinh', 'cosh', 'tanh']);

/** A run of letters as LaTeX reads it: ax is a x (splitLetterRuns of src/latex.ts). Commands, text groups and names with a digit or _ stay. */
export function splitRuns(tex: string): string {
    let out = '';
    for (let i = 0; i < tex.length; ) {
        const c = tex[i];
        if (c === '\\') {
            const m = /^\\([A-Za-z]+|.)/.exec(tex.slice(i));
            const cmd = m ? m[0] : c;
            out += cmd;
            i += cmd.length;
            if (m && /^(?:operatorname|mathrm|text|mathit|mathbf|textrm|mathsf|vec|boldsymbol|overrightarrow|begin|end)$/.test(m[1]) && tex[i] === '{') {
                const e = tex.indexOf('}', i);
                const stop = e < 0 ? tex.length : e + 1;
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
        const w = run[0];
        // a name with a subscript after a run of letters: ax_1 is a x_1
        const us = /^([A-Za-z]+)([A-Za-z]_[A-Za-z0-9_]*)$/.exec(w);
        if (us && us[1].length <= 3 && !/[0-9]/.test(us[1])) {
            out += us[1].split('').join(' ') + ' ' + us[2];
            i += w.length;
            continue;
        }
        const whole = w.length === 1 || /[0-9_]/.test(w) || WORDS.has(w) || tex[i + w.length] === '(';
        out += whole ? w : w.split('').join(' ');
        i += w.length;
    }
    return out;
}
/** Does the formula use the variable v where it stands alone (as LaTeX reads its runs of letters)? */
export const uses = (tex: string, v: string): boolean => standalone(v).test(splitRuns(tex.replace(TEXTY, ' ')));
/** Replace where re matches; a letter put right after a command gets a space before it (\lvert x, not \lvertx). */
const spaced = (tex: string, re: RegExp, to: string): string =>
    tex.replace(re, (_m: string, ...r: unknown[]) => {
        const at = r[r.length - 2] as number;
        return (/\\[A-Za-z]+$/.test(tex.slice(0, at)) && /^[A-Za-z]/.test(to) ? ' ' : '') + to;
    });
const rename = (tex: string, v: string, to: string): string => (v === to ? tex : spaced(splitRuns(tex), standalone(v), to));
/** The single letters of a formula as LaTeX reads them (ax is a and x), without commands, subscripts, e and i. */
function lettersOf(tex: string): string[] {
    const out: string[] = [];
    const t = tex
        .replace(TEXTY, ' ')
        .replace(/_\s*(?:\{[^{}]*\}|[A-Za-z0-9])/g, ' ')
        .replace(/\\[A-Za-z]+/g, ' ');
    for (const m of t.matchAll(/[A-Za-z]/g)) if (!out.includes(m[0]) && m[0] !== 'e' && m[0] !== 'i') out.push(m[0]);
    return out;
}
const freshName = (tex: string): string => ['f', 'g', 'h', 'p', 'q', 'u'].find((n) => !uses(tex, n)) ?? 'f';
const subOf = (v: string): string | null => {
    const m = /_(?:\{([^{}]*)\}|(.))$/.exec(v);
    return m ? m[1] ?? m[2] : null;
};

/** Is there a relation at the top level of a TeX string (outside brackets)? Its index, or -1. */
function topRel(tex: string, re = /^(?:=|<|>|\\le(?![A-Za-z])|\\ge(?![A-Za-z])|\\in(?![A-Za-z])|\\ne(?![A-Za-z])|\\approx|\\to(?![A-Za-z])|\\mapsto|\\subseteq)/): number {
    let d = 0;
    for (let i = 0; i < tex.length; i++) {
        const c = tex[i];
        if (c === '\\' && (tex[i + 1] === '{' || tex[i + 1] === '}')) {
            d += tex[i + 1] === '{' ? 1 : -1;
            i++;
            continue;
        }
        if (c === '(' || c === '[' || c === '{') d++;
        else if (c === ')' || c === ']' || c === '}') d = Math.max(0, d - 1);
        else if (d === 0 && re.test(tex.slice(i, i + 12))) return i;
    }
    return -1;
}
/** Split at the top level at commas. */
function topCommas(tex: string): string[] {
    const out: string[] = [];
    let d = 0;
    let from = 0;
    for (let i = 0; i < tex.length; i++) {
        const c = tex[i];
        if (c === '\\') {
            if (tex[i + 1] === '{') d++;
            else if (tex[i + 1] === '}') d = Math.max(0, d - 1);
            i++;
            continue;
        }
        if (c === '(' || c === '[' || c === '{') d++;
        else if (c === ')' || c === ']' || c === '}') d = Math.max(0, d - 1);
        else if (c === ',' && d === 0) {
            out.push(tex.slice(from, i).trim());
            from = i + 1;
        }
    }
    out.push(tex.slice(from).trim());
    return out;
}

/** An objective without its operator and its goal: \min_x f, \max f, f \to \min. A min that is called stays. */
export function stripObjective(tex: string | null | undefined): string {
    let s = clean(tex);
    s = s.replace(/\s*\\to\s*\\?(?:min|max)(?:_\{[^{}]*\})?\s*!?$/, '');
    for (let g = 0; g < 2; g++) s = s.replace(/^\\(?:arg)?(?:min|max|inf|sup)(?![A-Za-z])\s*(?:_\s*(?:\{(?:[^{}]|\{[^{}]*\})*\}|[A-Za-z0-9]))?\s*(?!\s*[({]|\s*\\\{)/, '');
    // min{a, b} as min(a, b): a set brace the chart reads as a call
    s = s.replace(/\\(min|max)\s*\\\{([^{}]*)\\\}/g, '\\$1($2)');
    return clean(s);
}

const X1 = /x_\s*(?:\{\s*1\s*\}|1(?![0-9]))/;
const X2 = /x_\s*(?:\{\s*2\s*\}|2(?![0-9]))/;
const X3 = /x_\s*\{?\s*[3-9]/;
/** The two variables of a body in the plane: x_1 and x_2, or x and y (the default: null); undefined in more than two. */
function planeVars(tex: string): string[] | null | undefined {
    if (X3.test(tex)) return undefined;
    if (X1.test(tex) || X2.test(tex)) return ['x_1', 'x_2'];
    return null;
}

// ---------------------------------------------------------------- the chart kinds

/** One function as the function card takes it: its variable, body and name. */
interface FnOf {
    v: string;
    body: string;
    name: string | undefined;
}

/** One function of a fnlike parse as the function card takes it: its variable, body and name; null when it is none. */
function functionOf(f: FnRead, wantVar?: string): FnOf | null {
    const body = stripObjective(f.body);
    if (!body || topRel(body) >= 0) return null;
    // a list is no body: x^1, x^2
    if (topCommas(body).length > 1) return null;
    // a set is no body (its curve comes from the set reader)
    if (/\\\{.*(?:\\mid|:|\|)/.test(body)) return null;
    if (f.args.length > 1) return null;
    const head = f.name ? f.name.replace(/\s+/g, '') : null;
    let v: string | null = null;
    if (f.args.length === 1) {
        v = f.args[0].replace(/\s+/g, '');
        if (!VAR.test(v)) return null;
    } else if (wantVar && uses(body, wantVar)) v = wantVar;
    else if (uses(body, 'x')) v = 'x';
    else if (X1.test(body) && !X2.test(body)) v = 'x_1';
    else {
        const idx = head ? subOf(head) : null;
        const ls = lettersOf(body);
        if (idx && /^[tnk]$/.test(idx) && uses(body, idx)) v = idx;
        else v = ['n', 't', 'k'].find((l) => uses(body, l)) ?? (ls.length === 1 ? ls[0] : null);
        // one Greek letter alone: \omega, \Omega
        if (!v && !ls.length) {
            const g = [...new Set(body.replace(TEXTY, ' ').match(new RegExp(String.raw`\\(?:${GREEK})(?![A-Za-z])`, 'g')) ?? [])].filter((x) => x !== '\\pi');
            if (g.length === 1) v = g[0];
        }
    }
    // a head that says y = ... keeps x (a constant function: y = -2)
    if (!v && head === 'y') v = 'x';
    if (!v) return null;
    // a body in x under another variable has two meanings: no function
    if (v !== 'x' && v !== 'x_1' && uses(body, 'x') && f.args.length === 1) return null;
    if (v === 'x' && !uses(body, 'x') && X1.test(body) && !X2.test(body)) v = 'x_1';
    // the name the card keeps: a plain name called on x (g(x)), or on the letter the chart takes for x by itself
    // (n, t or k, else the formula's only letter); a sequence a_n. Any other head is read through f(x) = ...
    let name: string | undefined;
    let spelled = false;
    const whole = `${head ?? ''} ${f.args.join(' ')} ${body}`;
    const own = !uses(whole, 'x') && !uses(whole, 'y') && !uses(whole, '\\theta') ? ['n', 't', 'k'].find((l) => uses(whole, l)) ?? (lettersOf(whole.replace(/[A-Za-z]+_/g, '_')).filter((l) => l !== 'r').length === 1 ? lettersOf(whole.replace(/[A-Za-z]+_/g, '_')).filter((l) => l !== 'r')[0] : null) : null;
    if (head && f.args.length === 1) {
        const plain = /^[A-Za-z][A-Za-z0-9_]*$/.test(head);
        if (plain && (v === 'x' || v === own)) {
            if (!RESERVED.has(head)) name = head;
        } else if (/^[A-Za-z][A-Za-z0-9_]*(?:\^\{-1\})?'*$/.test(head) && (v === 'x' || v === own)) name = undefined;
        else {
            name = freshName(splitRuns(body));
            spelled = true;
        }
    } else if (head && head !== 'y') {
        const seq = new RegExp(`^([A-Za-z])_\\{?${esc(v)}\\}?$`).exec(head);
        if (seq && v === own) {
            if (!RESERVED.has(seq[1])) name = seq[1];
        } else {
            name = freshName(splitRuns(body));
            spelled = true;
        }
    }
    // a head read through f(x) = ...: its body with plain spacing (\tfrac12 as \frac{1}{2})
    const out = spelled ? body.replace(/\\[dt]?frac\s*([0-9])\s*([0-9A-Za-z])/g, '\\frac{$1}{$2}') : body;
    return { v, body: out, name };
}

/** A Greek letter with a subscript as the letter alone, when the formula has no other such letter (the chart reads no \omega_0). */
function plainGreek(tex: string): string {
    const re = new RegExp(String.raw`\\(${GREEK})\s*_\s*(\{[^{}]*\}|[A-Za-z0-9])`, 'g');
    const subs = new Map<string, Set<string>>();
    for (const m of tex.matchAll(re)) {
        const set = subs.get(m[1]) ?? new Set<string>();
        set.add(m[2].replace(/[{}\s]/g, ''));
        subs.set(m[1], set);
    }
    let out = tex;
    for (const [name, set] of subs) {
        if (set.size !== 1 || new RegExp(`\\\\${name}(?![A-Za-z_\\s]*_)(?![A-Za-z])`).test(tex.replace(re, ''))) continue;
        out = out.replace(new RegExp(`\\\\${name}\\s*_\\s*(?:\\{[^{}]*\\}|[A-Za-z0-9])`, 'g'), `\\${name} `);
    }
    return out;
}

/** A side of a chain that is no formula to draw: a derivative, an integral, a limit, a transposed product, a determinant. */
const NO_BODY = /\\(?:partial|int|lim|det|nabla|begin)(?![A-Za-z])|\^\s*\{?\s*(?:\\top|T)\b|\\frac\s*\{\s*d[^{}]*\}\s*\{\s*d[^{}]*\}|[A-Za-z]'+\s*\(|[A-Za-z](?:_(?:\{[^{}]*\}|\w))?\s*\((?:[a-z]|\\[a-z]+)\)/;
/** The sides of a chain in the order to try: the first, then the last, the sides that are no formula to draw last. */
function chainOrder(f: FnRead): string[] {
    const sides = [f.body, ...(f.more ?? [])].map((b) => stripObjective(b)).filter((b) => b && topRel(b) < 0);
    if (sides.length <= 1) return sides;
    const pick = [sides[0], sides[sides.length - 1], ...sides.slice(1, -1)];
    return [...pick.filter((b) => !NO_BODY.test(b)), ...pick.filter((b) => NO_BODY.test(b))];
}

function functionParses(P: Internal): FunctionParse[] {
    const out: FunctionParse[] = [];
    const fns = P.fns ?? [];
    const piece = (g: FnOf): FunctionPiece => ({ ...(g.name ? { name: g.name } : {}), body: g.body });
    for (let q = 0; q < fns.length && out.length < 6; q++) {
        // the sides of a chain a = b = c, each as the function's body
        const sides = chainOrder(fns[q])
            .map((b) => functionOf({ ...fns[q], body: b }))
            .filter((x): x is FnOf => !!x);
        if (!sides.length) continue;
        const main = sides[0];
        const vars = (g: FnOf): { variables?: string[] } => (g.v === 'x' ? {} : { variables: g.v === 'x_1' && fns[q].name && /^x_\{?2\}?$/.test((fns[q].name as string).replace(/\s+/g, '')) ? ['x_1', 'x_2'] : [g.v] });
        // the functions that join it: the next ones after a comma or a logic sign, in the same variable
        const joined = [main];
        for (let r = q + 1; r < fns.length && joined.length < 3; r++) {
            if (fns[r].sep !== 'comma' && fns[r].sep !== 'log') break;
            const g = chainOrder(fns[r])
                .map((b) => functionOf({ ...fns[r], body: b }, main.v))
                .find((x) => x && x.v === main.v);
            if (g) joined.push(g);
        }
        out.push({ kind: 'function', functions: joined.map(piece), ...vars(main) });
        // the same with a Greek letter's subscript out (\omega_0 as \omega), for a chart that cannot read it
        {
            const g = joined.map((j) => ({ ...j, body: plainGreek(j.body) }));
            if (g.some((j, i) => j.body !== joined[i].body)) out.push({ kind: 'function', functions: g.map(piece), ...vars(main) });
        }
        if (joined.length > 1) out.push({ kind: 'function', functions: [piece(main)], ...vars(main) });
        for (const sd of sides.slice(1, 3)) {
            out.push({ kind: 'function', functions: [piece(sd)], ...vars(sd) });
            const g = plainGreek(sd.body);
            if (g !== sd.body) out.push({ kind: 'function', functions: [piece({ ...sd, body: g })], ...vars(sd) });
        }
    }
    return out;
}

function surfaceParses(P: Internal): SurfaceParse[] {
    const out: SurfaceParse[] = [];
    for (const f of P.fns ?? []) {
        const sides = chainOrder(f);
        if (!sides.length) continue;
        const head = f.name ? f.name.replace(/\s+/g, '') : null;
        if (f.args.length === 2) {
            const [a, b] = f.args.map((x) => x.replace(/\s+/g, ''));
            if (!VAR.test(a) || !VAR.test(b)) continue;
            out.push({ kind: 'surface', body: sides[0], ...(a === 'x' && b === 'y' ? {} : { variables: [a, b] }) });
            if (sides.length > 1) out.push({ kind: 'surface', body: sides[1], ...(a === 'x' && b === 'y' ? {} : { variables: [a, b] }) });
            continue;
        }
        // without two arguments: the side in x_1 and x_2, or in x and y, or in its two letters
        for (const body of sides) {
            const pv = planeVars(body);
            if (pv === undefined) continue;
            if (pv) {
                out.push({ kind: 'surface', body, variables: pv });
                continue;
            }
            if (uses(body, 'x') || uses(body, 'y')) {
                out.push({ kind: 'surface', body });
                continue;
            }
            const ls = lettersOf(body).filter((l) => l !== 'd');
            if (ls.length === 2 && f.args.length === 0) out.push({ kind: 'surface', body, variables: ls });
            else if (f.args.length === 0 && head && /^[A-Za-z]/.test(head)) out.push({ kind: 'surface', body });
        }
    }
    return out;
}

function polarParses(P: Internal): PolarParse[] {
    const out: PolarParse[] = [];
    for (const f of P.fns ?? []) {
        const head = f.name ? f.name.replace(/\s+/g, '') : null;
        const body0 = stripObjective(f.body);
        if (!body0 || topRel(body0) >= 0) continue;
        if (head && !/^r(?:\^\{?2\}?)?$/.test(head)) continue;
        const v = f.args[0] ?? ['\\theta', '\\varphi', '\\phi', 't'].find((l) => uses(body0, l));
        if (!v) continue;
        const body = rename(body0, v, '\\theta');
        const squared = head && /\^/.test(head);
        // as written first
        if (!squared) out.push({ kind: 'polar', body });
        // then as the chart reads it: \sin 3\theta as \sin(3\theta), a(1 + ...) as a \cdot (1 + ...), r^2 = ... as a root
        let s = body.replace(/\\(sin|cos|tan)\s*([0-9.]*\s*\\theta)(?![A-Za-z])/g, '\\$1($2)');
        s = s.replace(/(^|[^\\A-Za-z])([a-qs-z])\s*\(/g, '$1$2 \\cdot (');
        if (squared) s = `\\sqrt{${s}}`;
        if (s !== body || squared) out.push({ kind: 'polar', body: s });
    }
    return out;
}

function domainParses(P: Internal): DomainParse[] {
    const out: DomainParse[] = [];
    for (const f of P.fns ?? []) {
        const head = f.name ? f.name.replace(/\s+/g, '') : null;
        if (f.args.length > 1) continue;
        const sides = chainOrder(f);
        if (!sides.length) continue;
        for (const b of sides.slice(0, 2)) {
            const v = f.args[0] ? f.args[0].replace(/\s+/g, '') : uses(b, 'z') ? 'z' : uses(b, 's') ? 's' : uses(b, 'w') ? 'w' : null;
            if (!v || !VAR.test(v)) continue;
            const body = b;
            if (!uses(body, v) || (v !== 'x' && uses(body, 'x')) || uses(body, 'y')) continue;
            let name: string | undefined;
            if (head && f.args.length === 1) name = /^[A-Za-z][A-Za-z0-9_]*$/.test(head) ? head : freshName(body);
            else if (head) name = freshName(body);
            else if (!/\\frac|\^|[*/]|(?<![A-Za-z\\])i(?![A-Za-z])/.test(body)) name = freshName(body);
            out.push({ kind: 'domain', ...(name ? { name } : {}), body, ...(v !== 'z' ? { variable: v } : {}) });
        }
    }
    return out;
}

function implicitParses(P: Internal): ImplicitParse[] {
    if (!P.equation) return [];
    // a label before the equation: "g: 2x + 3y = 6"
    const eq = clean(P.equation).replace(/^[A-Za-z](?:_[0-9a-z])?\s*:\s*/, '');
    // a set is no equation (its curve comes from the set reader)
    if (/\\\{|\\begin/.test(eq)) return [];
    const pv = planeVars(eq);
    if (pv === undefined) return [];
    if (pv) return [{ kind: 'implicit', equation: eq, variables: pv }];
    if (uses(eq, 'x') || uses(eq, 'y')) return [{ kind: 'implicit', equation: eq }];
    return [];
}

/** "x_1, x_2 \ge 0" as "x_1 \ge 0, x_2 \ge 0": every listed variable takes the relation. */
function spreadList(c: string): string {
    const parts = topCommas(c);
    if (parts.length < 2) return c;
    const last = parts[parts.length - 1];
    const at = topRel(last);
    if (at <= 0) return c;
    const v0 = last.slice(0, at).trim();
    const rest = last.slice(at);
    const names = parts.slice(0, -1);
    if (!VAR.test(v0.replace(/\s+/g, '')) || !names.every((n) => VAR.test(n.replace(/\s+/g, '')))) return c;
    return [...names, v0].map((n) => `${n} ${rest}`).join(', ');
}
function regionParses(P: Internal): RegionParse[] {
    let conds = (P.conditions ?? []).map((c) => stripObjective(c).replace(/^\((.*)\)$/, '$1')).filter((c) => c);
    if (!conds.length) return [];
    // x \ge 0 for the vector x of a program in x_1 and x_2: both coordinates
    if (conds.some((c) => X1.test(c) || X2.test(c))) conds = conds.map((c) => c.replace(/^x\s*(\\ge|\\le|>|<)\s*0$/, 'x_1 $1 0, x_2 $1 0'));
    const out: RegionParse[] = [];
    const make = (list: string[]) => {
        const condition = list.join(', ');
        const pv = planeVars(condition);
        if (pv === undefined) return;
        out.push({ kind: 'region', condition, ...(pv ? { variables: pv } : {}) });
    };
    make(conds);
    const spread = conds.map(spreadList);
    if (spread.join() !== conds.join()) make(spread);
    if (conds.length > 1) make([conds[0]]);
    return out;
}

// ---------------------------------------------------------------- sets, maps, conditions, intervals

const REALS = /^\\mathbb\s*\{?\s*R\s*\}?(?:\s*\^\s*(?:\{\s*([A-Za-z0-9]+)\s*\}|([A-Za-z0-9])))?$/;
const canonVar = (v: string): string => v.replace(/\s+/g, '').replace(/_\{([A-Za-z0-9])\}$/, '_$1');

function setParses(P: Internal): SetParse[] {
    let cond = clean(P.condition);
    if (!cond) return [];
    let vars = (P.variables ?? []).map((v) => canonVar(String(v)));
    let space = P.space ? P.space.trim() : null;
    // x \mid x \in \mathbb{R}^n, g(x) \le 0: the membership belongs to the head
    if (vars.length === 1 && !space) {
        const m = new RegExp(`^${esc(vars[0])}\\s*\\\\in\\s*(\\\\mathbb\\s*\\{?\\s*R\\s*\\}?(?:\\s*\\^\\s*(?:\\{[^{}]*\\}|[A-Za-z0-9]))?)\\s*,\\s*([\\s\\S]+)$`).exec(cond);
        if (m) {
            space = m[1];
            cond = m[2];
        }
    }
    // a set given by its condition only: its head from the letters
    if (!vars.length) {
        if (X1.test(cond) && X2.test(cond)) vars = ['x_1', 'x_2'];
        else if (uses(cond, 'x') && uses(cond, 'y')) vars = ['x', 'y'];
        else if (uses(cond, 'x') || X1.test(cond)) vars = ['x'];
        else return [];
    }
    if (!vars.every((v) => VAR.test(v))) return [];
    // x (or x \in \mathbb{R}^2) with x_1 and x_2 in the condition: a set of pairs
    if (vars.length === 1 && new RegExp(String.raw`^(?:[A-Za-z]|\\(?:${GREEK}))$`).test(vars[0])) {
        const b = esc(vars[0]);
        const sp = space ? REALS.exec(space) : null;
        if (new RegExp(`${b}\\s*_\\s*\\{?\\s*1`).test(cond) && new RegExp(`${b}\\s*_\\s*\\{?\\s*2`).test(cond) && (!space || (sp && (sp[1] ?? sp[2]) === '2') || (sp && /^[a-z]$/.test(sp[1] ?? sp[2] ?? '')))) {
            // x \ge 0 for the vector: both coordinates
            cond = cond.replace(new RegExp(`(?<![A-Za-z\\\\])${b}\\s*(\\\\ge|\\\\le|>|<)\\s*0(?![0-9.])`, 'g'), `${vars[0]}_1 $1 0, ${vars[0]}_2 $1 0`);
            vars = [`${vars[0]}_1`, `${vars[0]}_2`];
            space = null;
        }
    }
    if (vars.length === 2) {
        const [a, b] = vars;
        // the coordinates as x and y (through stand-ins, so a coordinate named y does not meet the new y)
        if (!(a === 'x' && b === 'y') && (subOf(a) !== null || subOf(b) !== null)) {
            const xy = spaced(spaced(cond.replace(standalone(a), '').replace(standalone(b), ''), //g, 'x'), //g, 'y');
            // as written first (the card renames the coordinates itself), then as x and y
            return [
                { kind: 'set', variables: [a, b], condition: cond },
                { kind: 'set', variables: ['x', 'y'], condition: xy },
            ];
        }
        return [{ kind: 'set', variables: [a, b], condition: cond }];
    }
    if (vars.length !== 1) return [];
    const sp = space ? REALS.exec(space) : null;
    const power = sp ? sp[1] ?? sp[2] : undefined;
    return [{ kind: 'set', variables: vars, condition: cond, ...(power ? { space: power } : {}) }];
}

function mapParses(P: Internal, ctx: AdaptContext | undefined): MapParse[] {
    if (!P.name || !P.domain || !P.codomain) return [];
    const name = P.name.replace(/\s+/g, '').replace(/^\\/, '');
    if (!/^[A-Za-z][A-Za-z0-9_]*$/.test(name.replace(/[{}]/g, ''))) return [];
    // a domain or codomain that is no \mathbb{R}^n: the set the note names, else \mathbb{R}
    const space = (x: string) => {
        const t = clean(x);
        return REALS.test(t) ? t : ctx?.domains?.get(t) ?? '\\mathbb{R}';
    };
    return [{ kind: 'map', name: name.replace(/_\{([A-Za-z0-9])\}/, '_$1'), domain: space(P.domain), codomain: space(P.codomain) }];
}

function conditionParses(P: Internal): ConditionParse[] {
    // a value after \approx at the end is no part of the condition: 3 < r < 1 + \sqrt6 \approx 3.449
    let condition = clean(P.condition);
    {
        const at = topRel(condition, /^\\approx/);
        if (at > 0 && topRel(condition.slice(at + 7)) < 0) condition = clean(condition.slice(0, at));
    }
    if (!condition || !P.variable) return [];
    const v = canonVar(P.variable);
    if (!VAR.test(v)) return [];
    return [{ kind: 'condition', variable: v, condition }];
}

function intervalParses(P: Internal): IntervalParse[] {
    if (!P.lo || !P.hi) return [];
    const left = P.left === '[' ? '[' : P.left === '(' ? '(' : null;
    const right = P.right === ']' ? ']' : P.right === ')' ? ')' : null;
    if (!left || !right) return [];
    const v = P.variable ? canonVar(P.variable) : 'x';
    // a pair of equal or reversed numbers alone is a point, no interval: (1, 1), (2, 1)
    const num = (t: string) => (/^[+-]?\s*(?:\d+(?:\.\d+)?|\.\d+)$/.test(t.trim()) ? Number(t.replace(/\s+/g, '')) : NaN);
    const a = num(clean(P.lo));
    const b = num(clean(P.hi));
    if (!P.variable && Number.isFinite(a) && Number.isFinite(b) && (left === '(' || right === ')' ? a >= b : a > b)) return [];
    return [{ kind: 'interval', variable: VAR.test(v) ? v : 'x', left, lower: clean(P.lo), upper: clean(P.hi), right }];
}

// ---------------------------------------------------------------- linear algebra, iteration

function matrixParses(P: Internal): CardParse[] {
    const e = (P.entries ?? []).filter((r) => r.some((c) => c));
    const n = e.length;
    if ((n !== 2 && n !== 3) || e.some((r) => r.length !== n || r.some((c) => !c))) return [];
    return [{ kind: 'matrix', ...(P.name && /^[A-Z]$/.test(P.name) ? { name: P.name } : {}), entries: e }];
}
function detParses(P: Internal): CardParse[] {
    if (P.entries) {
        const m = matrixParses({ entries: P.entries });
        // the determinant of a written matrix: the matrix's card (as reader 0 gives it), then the same as a det parse
        const entries = m.length && m[0].kind === 'matrix' ? m[0].entries : null;
        return entries
            ? [
                  { kind: 'matrix', entries },
                  { kind: 'det', entries },
              ]
            : [];
    }
    return P.name && /^[A-Z]$/.test(P.name) ? [{ kind: 'det', matrix: P.name }] : [];
}
const pair =
    (kind: 'product' | 'eigen') =>
    (P: Internal): CardParse[] =>
        P.matrix && P.vector && /^[A-Z]$/.test(P.matrix) && /^[a-z]$/.test(P.vector) ? [{ kind, matrix: P.matrix, vector: P.vector }] : [];

function recurrenceParses(P: Internal): CardParse[] {
    if (!P.state || !P.index || !P.step) return [];
    const state = P.state;
    const n = P.index;
    const sub = (P.headSub ?? '').replace(/[\s{}()]/g, '');
    const step = clean(P.step);
    if (sub === `${n}+1`) return [{ kind: 'recurrence', state, index: n, step }];
    if (sub !== n) return [];
    // X_n = ... X_{n-1} ...: the step forward
    const prev = new RegExp(`${esc(state)}\\s*_\\s*\\{\\s*${n}\\s*-\\s*1\\s*\\}`, 'g');
    const now = new RegExp(`${esc(state)}\\s*_\\s*\\{?\\s*${n}\\s*\\}?(?![A-Za-z0-9+-])`);
    if (!prev.test(step) || now.test(step.replace(prev, ' '))) return [];
    prev.lastIndex = 0;
    return [{ kind: 'recurrence', state, index: n, step: step.replace(prev, `${state}_${n}`) }];
}
function sumParses(P: Internal): SumParse[] {
    if (!P.index || !P.lo || !P.hi || !P.body) return [];
    if (!/^[A-Za-z]$/.test(P.index)) return [];
    return [{ kind: 'sum', index: P.index, lower: clean(P.lo), upper: clean(P.hi), body: clean(P.body), ...(P.rhs ? { value: clean(P.rhs) } : {}) }];
}

/** A set of pairs given by one equation is the curve of that equation (implicit), or the graph y = f(x) (function). */
export function setCurve(kind: string, S: Internal): ChartParse[] {
    const set = setParses(S)[0];
    if (!set || set.variables.length !== 2) return [];
    const cond = set.condition;
    if (topCommas(cond).length > 1 || topRel(cond, /^(?:<|>|\\le(?![A-Za-z])|\\ge(?![A-Za-z])|\\ne(?![A-Za-z])|\\in(?![A-Za-z]))/) >= 0) return [];
    const at = topRel(cond, /^=/);
    if (at <= 0 || topRel(cond.slice(at + 1), /^=/) >= 0) return [];
    const [a, b] = set.variables;
    const vars = a === 'x' && b === 'y' ? {} : { variables: [a, b] };
    if (kind === 'implicit') return [{ kind: 'implicit', equation: splitRuns(cond), ...vars }];
    const left = cond.slice(0, at).trim();
    const right = cond.slice(at + 1).trim();
    if (left === b && !uses(right, b)) return [{ kind: 'function', functions: [{ body: splitRuns(right) }], ...(a === 'x' ? {} : { variables: [a] }) }];
    return [];
}

type Adapter = (P: Internal, ctx: AdaptContext | undefined) => CardParse[];

// A plain object on purpose: a kind is looked up as the frozen code looks it up.
const ADAPT: Record<string, Adapter> = {
    function: functionParses,
    surface: surfaceParses,
    polar: polarParses,
    domain: domainParses,
    implicit: implicitParses,
    region: regionParses,
    set: setParses,
    map: mapParses,
    condition: conditionParses,
    interval: intervalParses,
    jensen: (P) => (P.fn && P.weight ? [{ kind: 'jensen', name: P.fn, weight: P.weight }] : []),
    epigraph: (P) => (P.fn ? [{ kind: 'epigraph', name: P.fn }] : []),
    matrix: matrixParses,
    det: detParses,
    product: pair('product'),
    eigen: pair('eigen'),
    recurrence: recurrenceParses,
    sum: sumParses,
};

/** A bracket of names alone, as a call writes its arguments: (x), (t), (K, L), (x_1, x_2), (\lambda). */
const ARGUMENTS = /^\s*(?:\\?[A-Za-z]+(?:\s*_\s*(?:\{[A-Za-z0-9]+\}|[A-Za-z0-9]))?\s*,\s*)*\\?[A-Za-z]+(?:\s*_\s*(?:\{[A-Za-z0-9]+\}|[A-Za-z0-9]))?\s*$/;
/**
 * A letter (also with a subscript) before a bracket that is no function, as a product: a(x - 1) is a \cdot (x - 1),
 * K_0(1 + p) is K_0 \cdot (1 + p). A call stays: a function of the note, f, g and h, a bracket of names alone.
 */
export function productsOf(tex: string, functions: ReadonlySet<string> | undefined): string {
    let out = '';
    let from = 0;
    for (const m of tex.matchAll(/(?<![\\A-Za-z_^{])([A-Za-z])((?:_(?:\{[A-Za-z0-9]+\}|[A-Za-z0-9]))?)\s*\(/g)) {
        const at = m.index;
        const open = at + m[0].length - 1;
        let d = 0;
        let close = -1;
        for (let i = open; i < tex.length; i++) {
            if (tex[i] === '(') d++;
            else if (tex[i] === ')' && --d === 0) {
                close = i;
                break;
            }
        }
        if (close < 0 || (functions && functions.has(m[1])) || (!m[2] && /^[fgh]$/.test(m[1])) || ARGUMENTS.test(tex.slice(open + 1, close))) continue;
        out += `${tex.slice(from, at)}${m[1]}${m[2]} \\cdot (`;
        from = open + 1;
    }
    return from === 0 ? tex : out + tex.slice(from);
}
const CHART = new Set(['function', 'surface', 'polar', 'implicit', 'region']);

/** The TeX a chart parse draws, for a body-wide rewrite. */
function chartMap(p: ChartParse, w: (t: string) => string): ChartParse {
    if (p.kind === 'function') return { ...p, functions: p.functions.map((f) => ({ ...f, body: w(f.body) })) };
    if (p.kind === 'implicit') return { ...p, equation: w(p.equation) };
    if (p.kind === 'region') return { ...p, condition: w(p.condition) };
    return { ...p, body: w(p.body) };
}
/** The texts of a chart parse that the chart reads. */
function chartTexts(p: ChartParse): string[] {
    if (p.kind === 'function') return p.functions.map((f) => f.body);
    if (p.kind === 'implicit') return [p.equation];
    if (p.kind === 'region') return [p.condition];
    return [p.body];
}

/** The parses of src/readers/types.ts for an internal parse, best first. */
export function adapt(kind: string, P: Internal | null, ctx: AdaptContext | undefined): CardParse[] {
    if (!P || !ADAPT[kind]) return [];
    try {
        const out = ADAPT[kind](P, ctx) ?? [];
        if (!CHART.has(kind)) return out;
        // A chart body as the chart reads it: a product of letters split (ax is a x).
        const split = (out as ChartParse[]).map((p) => chartMap(p, (b) => productsOf(splitRuns(b), ctx?.functions)));
        // the chart keeps r for polar curves: a parameter r is written R (or \rho) in a parse of its own, after the others
        const more: ChartParse[] = [];
        if (kind !== 'polar')
            for (const p of split.slice(0, 2)) {
                const texts = chartTexts(p);
                if ((('variables' in p ? p.variables : undefined) ?? []).includes('r') || !texts.some((t) => uses(t, 'r'))) continue;
                const to = texts.some((t) => uses(t, 'R')) ? '\\rho' : 'R';
                more.push(chartMap(p, (t) => t.replace(standalone('r'), to)));
            }
        return [...split, ...more];
    } catch {
        return [];
    }
}
