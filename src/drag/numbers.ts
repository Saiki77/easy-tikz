/*
 * Drag to edit: the numbers a dragged object is made of (SPEC3 2.1, 2.2, 3).
 *
 * A UNIT is the part of one settings field a drag target owns (a function
 * body, one clause of a condition entry, one coordinate of a tuple, ...).
 * This module parses units, discovers their free numbers tier by tier
 * (sliders, typed literals, folded fractions, inserted "virtual" numbers),
 * compiles one slotted closure per unit through the expr.compile hook, and
 * writes changed numbers back into the field text while keeping every other
 * character of the user's text. Every rewrite passes a numeric safety net:
 * the new text, compiled plainly, must equal the slotted closure.
 *
 * Pure: no DOM, no Obsidian.
 */
import { BUILTIN_FUNCTION_NAMES, compile, normalizeImplicitCalls, parse, parseList, parseTuples, tokenize } from '../expr';
import type { BinaryNode, CompileHook, Compiled, Env, NameNode, Node, NumNode, Token, UnaryNode } from '../expr';
import { conditionClauseNodes } from '../mathcontext';
import type { FunctionKind, MathContext } from '../mathcontext';
import type { Parameter } from '../types';
import type { DragNumber, FieldRef, NumberRole, UnitSpec, VirtualKind } from './types';

// ------------------------------------------------------------------ public types

export interface TextStyle {
    implicitMul: boolean;
    spacedOps: boolean;
}

export interface ParsedUnit {
    spec: UnitSpec;
    /** Whole field text at drag start. */
    text: string;
    /** normalizeImplicitCalls of the owned subtree (spans index into `text`). */
    owned: Node;
    /** equation and clause units; for clauses `le` is true for '<' and '<='. */
    sides: { lhs: Node; rhs: Node; le: boolean } | null;
    parent: Map<Node, Node | null>;
    frozen: ReadonlySet<Node>;
    /** Alias names per axis that are variables here ([] for value units). */
    vars: string[][];
    env: 'fn1' | 'fn2' | 'value';
    fnKind: FunctionKind;
    style: TextStyle;
}

export interface DiscoverOptions {
    /** Usable sliders (axis-range sliders already removed). */
    sliders: ReadonlyMap<string, Parameter>;
    allowSliders: boolean;
    virtual: readonly VirtualKind[];
}

export interface Evaluator {
    /** One value per number (index = numbers index); the solver writes it, closures read it. */
    readonly values: Float64Array;
    /** One closure per unit: body f(x, NaN); clause g(x, y); equation F(x, y); value units () => v. */
    readonly fns: readonly Compiled[];
    /** Push the slider entries of `values` into the private context (setParamValues). */
    apply(): void;
    /**
     * Optional addition: per unit, the slotted closure of an equation unit's variable side
     * (SPEC3 3.7, the twin check); null for every other unit or when there is no variable side.
     */
    readonly sides?: ReadonlyArray<Compiled | null>;
}

export interface RewrittenField {
    ref: FieldRef;
    text: string;
    /** Spans of written numbers and insertions in `text` (chip highlighting). */
    changed: Array<[number, number]>;
    /** Units whose safety-net check failed in both modes: the caller keeps the previous text. */
    failed: boolean;
    /** Optional addition: the text is the defensive rebuild (every insertion parenthesized, SPEC3 3.6). */
    defensive?: boolean;
}

/** Optional addition (SPEC3 3.7): a points-tool objective edited together with an equation unit. */
export interface TwinInput {
    /** Index into `units` of the curve-tool equation unit the twin mirrors. */
    unit: number;
    ref: FieldRef;
    /** The objective text at drag start. */
    text: string;
}

/** Optional addition: what a hover chip shows for one field (SPEC3 1.8). */
export interface FieldPreview {
    ref: FieldRef;
    text: string;
    /** Spans of numbers that will change (literal tokens, fractions, slider names). */
    numSpans: Array<[number, number]>;
    /** Structure that would be inserted, with the placeholders 'k', 'a', 'h', 's'. */
    ghosts: Array<{ at: number; text: string }>;
    /** Virtual kinds among the previewed numbers, in the order add, factor, shiftVar, scaleVar. */
    virtualKinds: VirtualKind[];
}

// ------------------------------------------------------------------ AST helpers

type Parents = Map<Node, Node | null>;

function children(n: Node): Node[] {
    switch (n.t) {
        case 'call':
            return n.args;
        case 'unary':
            return [n.arg];
        case 'binary':
        case 'logic':
            return [n.left, n.right];
        case 'cmp':
            return n.args;
        case 'ternary':
            return [n.test, n.then, n.else];
        default:
            return [];
    }
}

function collectParents(n: Node, parent: Node | null, out: Parents): void {
    out.set(n, parent);
    for (const c of children(n)) collectParents(c, n, out);
}

/** Binary + / - that is arithmetic (not the top-level `=` of an equation, not a clause root). */
function isAdd(n: Node | null | undefined): n is BinaryNode {
    return !!n && n.t === 'binary' && (n.op === '+' || n.op === '-') && !n.equation;
}

/** Binary *, / or % (explicit or implicit). */
function isMul(n: Node | null | undefined): n is BinaryNode {
    return !!n && n.t === 'binary' && (n.op === '*' || n.op === '/' || n.op === '%');
}

function isFolded(n: Node): boolean {
    return n.t === 'binary' && n.op === '/' && n.left.t === 'num' && n.right.t === 'num';
}

/** Copy-on-write map over the AST: `f` returns a replacement or null to recurse. */
function mapChildren(n: Node, f: (c: Node) => Node): Node {
    switch (n.t) {
        case 'call': {
            const args = n.args.map(f);
            return args.some((a, i) => a !== n.args[i]) ? { ...n, args } : n;
        }
        case 'unary': {
            const arg = f(n.arg);
            return arg !== n.arg ? { ...n, arg } : n;
        }
        case 'binary': {
            const left = f(n.left);
            const right = f(n.right);
            return left !== n.left || right !== n.right ? { ...n, left, right } : n;
        }
        case 'logic': {
            const left = f(n.left);
            const right = f(n.right);
            return left !== n.left || right !== n.right ? { ...n, left, right } : n;
        }
        case 'cmp': {
            const args = n.args.map(f);
            return args.some((a, i) => a !== n.args[i]) ? { ...n, args } : n;
        }
        case 'ternary': {
            const test = f(n.test);
            const then = f(n.then);
            const otherwise = f(n.else);
            return test !== n.test || then !== n.then || otherwise !== n.else ? { ...n, test, then, else: otherwise } : n;
        }
        default:
            return n;
    }
}

/** Synthetic number node for virtual numbers (span -1, never written as text). */
function vnum(value: number): NumNode {
    return { t: 'num', value, raw: '', s: -1, e: -1 };
}

// ------------------------------------------------------------------ per-unit internals

interface Aux {
    /** Tokens of the field text (without the end token). */
    tokens: Token[];
    /** match[i]: index of the ')' matching a '(' at i, else -1. */
    match: Int32Array;
    env: Env;
    hasVar: (n: Node) => boolean;
    /** Structure fingerprint of the field (safety net: the edit must not change it). */
    shape: string;
    /** Equation units: span of the variable side in `text` (twins), else null. */
    varSide: [number, number] | null;
    /** refKey of the unit's field. */
    key: string;
    /**
     * Rewrites of this unit's field per numbers list, by written-number signature (consecutive frames often
     * repeat a text). Keyed by the numbers array so units reused with another list never see stale entries.
     */
    memo: WeakMap<readonly DragNumber[], Map<string, RewrittenField>>;
}

const AUX = new WeakMap<ParsedUnit, Aux>();

function auxOf(u: ParsedUnit): Aux {
    const a = AUX.get(u);
    if (!a) throw new Error('drag/numbers: unit was not created by parseUnit');
    return a;
}

function parenMatch(text: string): Int32Array {
    const out = new Int32Array(text.length).fill(-1);
    const stack: number[] = [];
    for (let i = 0; i < text.length; i++) {
        const c = text.charCodeAt(i);
        if (c === 40) stack.push(i);
        else if (c === 41) {
            const open = stack.pop();
            if (open !== undefined) out[open] = i;
        }
    }
    return out;
}

/** The node's own span is enclosed in a pair of parentheses (`(x)`, `(1/2)`, `(x + 1)`). */
function wrapped(aux: Aux, n: Node): boolean {
    return n.s >= 0 && n.e > n.s && aux.match[n.s] === n.e - 1;
}

interface HasTokens {
    tokens: Token[];
}

/** Index of the first token with pos >= at. */
function tokenIndexAt(aux: HasTokens, at: number): number {
    const t = aux.tokens;
    let lo = 0;
    let hi = t.length;
    while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (t[mid].pos < at) lo = mid + 1;
        else hi = mid;
    }
    return lo;
}

/** First token of `kind` inside [s, e). */
function tokenIn(aux: Aux, s: number, e: number, kind: Token['kind']): Token | null {
    for (let i = tokenIndexAt(aux, s); i < aux.tokens.length; i++) {
        const t = aux.tokens[i];
        if (t.end > e) break;
        if (t.kind === kind) return t;
    }
    return null;
}

function tokenBefore(aux: Aux, at: number): Token | null {
    const i = tokenIndexAt(aux, at) - 1;
    return i >= 0 ? aux.tokens[i] : null;
}

function tokenFrom(aux: Aux, at: number): Token | null {
    const i = tokenIndexAt(aux, at);
    return i < aux.tokens.length ? aux.tokens[i] : null;
}

/** The binary + / - operator token of `p` (between its operands). */
function opToken(aux: HasTokens, p: BinaryNode): Token | null {
    for (let i = tokenIndexAt(aux, p.left.e); i < aux.tokens.length; i++) {
        const t = aux.tokens[i];
        if (t.pos >= p.right.s) break;
        if (t.kind === 'op' && (t.text === '+' || t.text === '-')) return t;
    }
    return null;
}

/** The operator token of a unary node (skipping the node's own parentheses). */
function unaryToken(aux: Aux, n: UnaryNode): Token | null {
    let found: Token | null = null;
    for (let i = tokenIndexAt(aux, n.s); i < aux.tokens.length; i++) {
        const t = aux.tokens[i];
        if (t.pos >= n.arg.s) break;
        if (t.kind === 'op' && t.text === n.op) found = t;
    }
    return found;
}

function envKindOf(role: UnitSpec['role']): 'fn1' | 'fn2' | 'value' {
    if (role === 'body') return 'fn1';
    if (role === 'equation' || role === 'clause' || role === 'side') return 'fn2';
    return 'value';
}

function namesFor(ref: FieldRef): boolean {
    return ref.kind === 'tool' && ref.field === 'path';
}

interface Located {
    node: Node;
    sides: { lhs: Node; rhs: Node; le: boolean } | null;
    shape: string;
    /** Spans of chain middles (clause units): frozen. */
    frozenSpans: Array<[number, number]>;
    /** Every root of the whole field (style sniffing). */
    roots: Node[];
}

/**
 * Find the unit's node in `text` (plain parser nodes; the clause root is synthetic). Throws on parse errors.
 * `light` (safety net): no frozen spans and no style roots.
 */
function locate(spec: UnitSpec, text: string, light = false): Located | null {
    switch (spec.role) {
        case 'body':
        case 'value':
        case 'side': {
            const root = parse(text, 'expr');
            return { node: root, sides: null, shape: '', frozenSpans: [], roots: [root] };
        }
        case 'equation': {
            const root = parse(text, 'eq');
            if (root.t === 'cmp' || root.t === 'logic') return null;
            const eq = root.t === 'binary' && root.equation ? root : null;
            return {
                node: root,
                sides: eq ? { lhs: eq.left, rhs: eq.right, le: true } : null,
                shape: eq ? '=' : '',
                frozenSpans: [],
                roots: [root],
            };
        }
        case 'clause': {
            const dnf = conditionClauseNodes(text);
            const c = dnf[spec.disjunct ?? -1]?.[spec.clause ?? -1];
            if (!c) return null;
            const le = c.op === '<' || c.op === '<=';
            // g = lhs - rhs (<, <=) or rhs - lhs (>, >=); flagged like an equation so it is never an additive chain.
            const node: BinaryNode = {
                t: 'binary',
                op: '-',
                equation: true,
                left: le ? c.lhs : c.rhs,
                right: le ? c.rhs : c.lhs,
                s: Math.min(c.lhs.s, c.rhs.s),
                e: Math.max(c.lhs.e, c.rhs.e),
            };
            const shape = dnf.map((d) => d.length).join(',');
            if (light) return { node, sides: { lhs: c.lhs, rhs: c.rhs, le }, shape, frozenSpans: [], roots: [] };
            const ast = parse(text, 'cond');
            const frozenSpans: Array<[number, number]> = [];
            const walk = (n: Node) => {
                if (n.t === 'cmp' && n.ops.length >= 2) {
                    for (let i = 1; i < n.args.length - 1; i++) frozenSpans.push([n.args[i].s, n.args[i].e]);
                }
                children(n).forEach(walk);
            };
            walk(ast);
            return { node, sides: { lhs: c.lhs, rhs: c.rhs, le }, shape, frozenSpans, roots: [ast] };
        }
        case 'levelItem': {
            const items = parseList(text);
            const node = items[spec.item ?? -1];
            if (!node) return null;
            return { node, sides: null, shape: String(items.length), frozenSpans: [], roots: items };
        }
        case 'tupleCoord': {
            const tuples = parseTuples(text, namesFor(spec.ref));
            const t = tuples[spec.item ?? -1];
            if (!t || t.kind !== 'tuple') return null;
            const node = t.items[spec.coord ?? -1];
            if (!node) return null;
            const roots: Node[] = [];
            for (const it of tuples) if (it.kind === 'tuple') roots.push(...it.items);
            return {
                node,
                sides: null,
                shape: tuples.map((it) => (it.kind === 'tuple' ? String(it.items.length) : 'n')).join(','),
                frozenSpans: [],
                roots,
            };
        }
    }
}

function sniffStyle(roots: Node[], aux: HasTokens, text: string, env: Env): TextStyle {
    let implicit = false;
    let explicit = false;
    let ops = 0;
    let spaced = 0;
    const isSpace = (c: string | undefined) => c === ' ' || c === '\t' || c === '\n' || c === '\r' || c === '\u00a0';
    const walk = (n: Node) => {
        if (n.t === 'binary') {
            if (n.op === '*') {
                if (n.implicit) implicit = true;
                else explicit = true;
            }
            if (isAdd(n)) {
                const t = opToken(aux, n);
                if (t) {
                    ops++;
                    if (isSpace(text[t.pos - 1]) && isSpace(text[t.end])) spaced++;
                }
            }
        }
        children(n).forEach(walk);
    };
    for (const r of roots) walk(normalizeImplicitCalls(r, env));
    // No product at all: no evidence of an explicit style, so write coefficients the way people do (1.5x).
    return { implicitMul: implicit || !explicit, spacedOps: ops === 0 || spaced * 2 > ops };
}

/**
 * Null when the text does not parse or the unit spec does not exist in it. Uses the private context's envs.
 */
export function parseUnit(spec: UnitSpec, text: string, math: MathContext): ParsedUnit | null {
    let loc: Located | null;
    const envKind = envKindOf(spec.role);
    const fnKind: FunctionKind = spec.fnKind || 'cartesian';
    try {
        loc = locate(spec, text);
    } catch {
        return null;
    }
    if (!loc) return null;
    const env = math.envFor(envKind, fnKind);
    let owned = normalizeImplicitCalls(loc.node, env);
    let sides: ParsedUnit['sides'] = null;
    if (loc.sides && owned.t === 'binary') {
        if (spec.role === 'clause') {
            const le = loc.sides.le;
            sides = { lhs: le ? owned.left : owned.right, rhs: le ? owned.right : owned.left, le };
        } else {
            sides = { lhs: owned.left, rhs: owned.right, le: true };
        }
    } else if (loc.sides) {
        // Normalization never turns a binary root into something else; be safe anyway.
        owned = loc.node;
        sides = null;
    }
    const parent: Parents = new Map();
    collectParents(owned, null, parent);
    const frozen = new Set<Node>();
    if (sides) {
        for (const side of [sides.lhs, sides.rhs]) {
            if (loc.frozenSpans.some(([s, e]) => s === side.s && e === side.e)) {
                const add = (n: Node) => {
                    frozen.add(n);
                    children(n).forEach(add);
                };
                add(side);
            }
        }
    }
    const vars = env.vars.map((v) => v.slice());
    let tokens: Token[];
    try {
        tokens = tokenize(text).filter((t) => t.kind !== 'end');
    } catch {
        return null;
    }
    const isVar = (name: string) => vars.some((v) => v.includes(name));
    const memo = new Map<Node, boolean>();
    const hasVar = (n: Node): boolean => {
        const hit = memo.get(n);
        if (hit !== undefined) return hit;
        let r: boolean;
        if (n.t === 'num' || n.t === 'member') r = false;
        else if (n.t === 'name') r = isVar(n.name) || (envKind !== 'value' && !env.scalar(n.name) && env.fn(n.name) !== null);
        else r = children(n).some(hasVar);
        memo.set(n, r);
        return r;
    };
    const style = sniffStyle(loc.roots, { tokens }, text, env);
    const unit: ParsedUnit = { spec, text, owned, sides, parent, frozen, vars, env: envKind, fnKind, style };
    let varSide: [number, number] | null = null;
    if (spec.role === 'equation') {
        if (sides) {
            const l = hasVar(sides.lhs);
            const r = hasVar(sides.rhs);
            if (l !== r) varSide = l ? [sides.lhs.s, sides.lhs.e] : [sides.rhs.s, sides.rhs.e];
        } else {
            varSide = [owned.s, owned.e];
        }
    }
    AUX.set(unit, {
        tokens,
        match: parenMatch(text),
        env,
        hasVar,
        shape: loc.shape,
        varSide,
        key: refKey(spec.ref),
        memo: new WeakMap(),
    });
    return unit;
}

/** Optional addition: span of an equation unit's variable side in its text (SPEC3 3.7), or null. */
export function variableSide(u: ParsedUnit): [number, number] | null {
    const s = auxOf(u).varSide;
    return s ? [s[0], s[1]] : null;
}

// ------------------------------------------------------------------ discovery

const CONSTANT_NAMES = new Set(['pi', 'PI', 'π', 'e', 'E']);

/** Summands of an additive chain (unparenthesized + / - only; the summand keeps its unary sign). */
function summands(aux: Aux, n: Node): Node[] {
    if (!isAdd(n)) return [n];
    const left = isAdd(n.left) && !wrapped(aux, n.left) ? summands(aux, n.left) : [n.left];
    return [...left, n.right];
}

/** Factors of a product chain (through *, / and unary signs). */
function factorsOf(n: Node, out: Node[] = []): Node[] {
    if (n.t === 'binary' && (n.op === '*' || n.op === '/')) {
        factorsOf(n.left, out);
        factorsOf(n.right, out);
    } else if (n.t === 'unary' && (n.op === '-' || n.op === '+')) {
        factorsOf(n.arg, out);
    } else {
        out.push(n);
    }
    return out;
}

/** Leftmost leaf of a summand's product chain (through unary signs and left operands of *, /, %). */
function leadingLeaf(n: Node): Node {
    let cur = n;
    for (;;) {
        if (cur.t === 'unary' && (cur.op === '-' || cur.op === '+')) cur = cur.arg;
        else if (isMul(cur) && !isFolded(cur)) cur = cur.left;
        else return cur;
    }
}

interface UnitAnalysis {
    excluded: Set<Node>;
    folded: Set<Node>;
    offsetRoots: Node[];
}

function analyze(u: ParsedUnit, aux: Aux): UnitAnalysis {
    const excluded = new Set<Node>();
    const folded = new Set<Node>();
    const env = aux.env;
    const isVar = (name: string) => u.vars.some((v) => v.includes(name));
    const isParam = (name: string) => !isVar(name) && env.scalar(name)?.kind === 'param';
    const isConstant = (f: Node) =>
        f.t === 'member' || (f.t === 'name' && CONSTANT_NAMES.has(f.name) && !isVar(f.name) && !env.scalar(f.name) && !env.fn(f.name));
    const excludeAll = (n: Node) => {
        if (n.t === 'num') excluded.add(n);
        children(n).forEach(excludeAll);
    };
    const walk = (n: Node) => {
        if (u.frozen.has(n)) return;
        if (n.t === 'binary' && n.op === '^' && !aux.hasVar(n.right)) excludeAll(n.right);
        if (n.t === 'binary' && (n.op === '*' || n.op === '/')) {
            const fs = factorsOf(n);
            if (fs.some((f) => isConstant(f) || (f.t === 'name' && isParam(f.name)))) {
                for (const f of fs) if (f.t === 'num') excluded.add(f);
            }
        }
        if (isFolded(n)) folded.add(n);
        children(n).forEach(walk);
    };
    walk(u.owned);
    const roots: Node[] = [];
    if (u.sides) {
        for (const s of [u.sides.lhs, u.sides.rhs]) if (!u.frozen.has(s)) roots.push(s);
    } else {
        roots.push(u.owned);
    }
    return { excluded, folded, offsetRoots: roots };
}

function roleOf(u: ParsedUnit, aux: Aux, leaf: Node, offsetRoots: readonly Node[]): NumberRole {
    let s: Node = leaf;
    let p = u.parent.get(s) ?? null;
    if (p && p.t === 'unary' && (p.op === '-' || p.op === '+')) {
        s = p;
        p = u.parent.get(s) ?? null;
    }
    if (offsetRoots.includes(s)) return 'offset';
    if (!isAdd(p)) return 'coef';
    let top: BinaryNode = p;
    for (;;) {
        const up = u.parent.get(top) ?? null;
        if (isAdd(up) && up.left === top && !wrapped(aux, top)) top = up;
        else break;
    }
    if (offsetRoots.includes(top)) return 'offset';
    return aux.hasVar(top) ? 'shift' : 'coef';
}

/** Where a virtual factor on summand T is written (SPEC3 3.2): after a leading unary sign, or around T. */
interface FactorAnchor {
    at: number;
    unary: UnaryNode | null;
    wrapT: boolean;
}

function factorAnchor(aux: Aux, T: Node): FactorAnchor {
    if ((T.t === 'cmp' || T.t === 'logic' || T.t === 'ternary') && !wrapped(aux, T)) return { at: T.s, unary: null, wrapT: true };
    let n = T;
    let modulo = false;
    let unary: UnaryNode | null = null;
    for (;;) {
        if (isMul(n) && !wrapped(aux, n)) {
            if (n.op === '%') modulo = true;
            n = n.left;
            continue;
        }
        if (n.t === 'unary' && (n.op === '-' || n.op === '+') && !wrapped(aux, n)) {
            // `--x`: the factor goes after the innermost sign (`--1.5x`), never between two signs.
            unary = n;
            n = n.arg;
            continue;
        }
        break;
    }
    // k * (a % b) is not (k * a) % b: keep the summand whole.
    if (modulo) return { at: T.s, unary: null, wrapT: true };
    if (unary) return { at: unary.arg.s, unary, wrapT: false };
    return { at: T.s, unary: null, wrapT: false };
}

/** The add target of a unit (SPEC3 2.2), or null. */
function addTarget(u: ParsedUnit, aux: Aux): Node | null {
    if (u.spec.role === 'side') return null;
    if (u.sides) {
        const { lhs, rhs } = u.sides;
        const l = aux.hasVar(lhs);
        const r = aux.hasVar(rhs);
        let target: Node = l !== r ? (l ? rhs : lhs) : rhs;
        if (u.frozen.has(target)) {
            const other = target === rhs ? lhs : rhs;
            if (u.frozen.has(other)) return null;
            target = other;
        }
        return target;
    }
    return u.owned;
}

/**
 * Graph form (lead decision on SPEC3 D4): a side that is a lone axis variable, optionally signed (`y <= x^2`,
 * `-y = sin(x)`, `x >= y^2`, `x^2 >= y`), is the output side; the other side is the function side. The lhs
 * wins when both sides are lone variables (`y = x`). Null when neither side is one.
 */
export function outputSide(u: ParsedUnit): { side: Node; other: Node; axis: 0 | 1 } | null {
    if (!u.sides) return null;
    const axisOf = (n: Node): number => {
        // Any number of signs (`--y` is graph form too).
        let m = n;
        while (m.t === 'unary' && (m.op === '-' || m.op === '+')) m = m.arg;
        if (m.t !== 'name') return -1;
        const name = m.name;
        return u.vars.findIndex((v) => v.includes(name));
    };
    const { lhs, rhs } = u.sides;
    const pairs: Array<[Node, Node]> = [
        [lhs, rhs],
        [rhs, lhs],
    ];
    for (const [side, other] of pairs) {
        const axis = axisOf(side);
        if (axis === 0 || axis === 1) return { side, other, axis };
    }
    return null;
}

/** Summands that may take a virtual factor (SPEC3 2.2); graph form: only the function side. */
function factorTargets(u: ParsedUnit, aux: Aux, folded: ReadonlySet<Node>): Node[] {
    let root: Node | null;
    if (u.spec.role === 'body') root = u.owned;
    else if (u.sides) {
        const out = outputSide(u);
        root = out ? out.other : u.sides.lhs;
    } else if (u.spec.role === 'equation') root = u.owned;
    else root = null;
    if (!root || u.frozen.has(root)) return [];
    return summands(aux, root).filter((T) => {
        if (!aux.hasVar(T)) return false;
        const leaf = leadingLeaf(T);
        return leaf.t !== 'num' && !folded.has(leaf) && !isFolded(leaf);
    });
}

/** Occurrences of axis `axis` in the owned, non-frozen nodes (name nodes of its aliases). */
function occurrences(u: ParsedUnit, axis: number): NameNode[] {
    const names = u.vars[axis];
    if (!names) return [];
    const out: NameNode[] = [];
    const walk = (n: Node) => {
        if (u.frozen.has(n)) return;
        if (n.t === 'name' && names.includes(n.name)) out.push(n);
        children(n).forEach(walk);
    };
    walk(u.owned);
    return out;
}

function axesFor(u: ParsedUnit): number[] {
    if (u.spec.role === 'body') return [0];
    if (u.spec.role === 'equation' || u.spec.role === 'clause') return [0, 1];
    return [];
}

/** Pre-order walk of the owned nodes in text order (clauses: lhs before rhs). */
function textOrderRoots(u: ParsedUnit): Node[] {
    return u.sides ? [u.sides.lhs, u.sides.rhs] : [u.owned];
}

/** SPEC3 2.2. Literal / folded / virtual numbers carry `unit`; sliders are deduplicated across units. */
export function discoverNumbers(units: readonly ParsedUnit[], opts: DiscoverOptions): DragNumber[] {
    const out: DragNumber[] = [];
    const seenSliders = new Set<string>();
    const virtualOut: DragNumber[] = [];
    units.forEach((u, ui) => {
        if (u.spec.role === 'side') return;
        const aux = auxOf(u);
        const an = analyze(u, aux);
        const isVar = (name: string) => u.vars.some((v) => v.includes(name));
        const walk = (n: Node) => {
            if (u.frozen.has(n)) return;
            if (an.folded.has(n)) {
                const f = n as BinaryNode;
                if (!an.excluded.has(f.left) && !an.excluded.has(f.right)) {
                    const value = (f.left as NumNode).value / (f.right as NumNode).value;
                    if (Number.isFinite(value)) {
                        out.push({
                            id: `f:${ui}@${f.left.s}`,
                            kind: 'folded',
                            role: roleOf(u, aux, f, an.offsetRoots),
                            tier: 3,
                            unit: ui,
                            value0: value,
                            pos: f.left.s,
                            node: f,
                            // The division itself: parentheses around it stay ('0.5(2./1)' -> '0.5(1)').
                            span: [f.left.s, f.right.e],
                            label: u.text.slice(f.left.s, f.right.e).replace(/\s+/g, ''),
                        });
                    }
                }
                return;
            }
            if (n.t === 'num') {
                if (!an.excluded.has(n) && Number.isFinite(n.value)) {
                    const tok = tokenIn(aux, n.s, n.e, 'num');
                    if (tok) {
                        out.push({
                            id: `l:${ui}@${tok.pos}`,
                            kind: 'literal',
                            role: roleOf(u, aux, n, an.offsetRoots),
                            tier: 2,
                            unit: ui,
                            value0: n.value,
                            pos: tok.pos,
                            node: n,
                            span: [tok.pos, tok.end],
                            label: tok.text,
                        });
                    }
                }
                return;
            }
            if (n.t === 'name' && opts.allowSliders && !isVar(n.name) && !seenSliders.has(n.name)) {
                const p = opts.sliders.get(n.name);
                if (p && aux.env.scalar(n.name)?.kind === 'param') {
                    seenSliders.add(n.name);
                    const tok = tokenIn(aux, n.s, n.e, 'id');
                    out.push({
                        id: `s:${n.name}`,
                        kind: 'slider',
                        role: roleOf(u, aux, n, an.offsetRoots),
                        tier: 1,
                        unit: -1,
                        value0: Number(p.value),
                        pos: tok ? tok.pos : n.s,
                        param: { name: p.name, min: Number(p.min), max: Number(p.max), step: Number(p.step) },
                        label: n.name,
                    });
                }
            }
            children(n).forEach(walk);
        };
        textOrderRoots(u).forEach(walk);

        // Tier 4: inserted structure, only the kinds the target allows.
        const allow = new Set(opts.virtual);
        if (allow.has('add') && u.spec.role !== 'tupleCoord' && u.spec.role !== 'levelItem') {
            const E = addTarget(u, aux);
            if (E) {
                virtualOut.push({
                    id: `v:${ui}:add`,
                    kind: 'virtual',
                    role: 'offset',
                    tier: 4,
                    unit: ui,
                    value0: 0,
                    pos: E.e,
                    virtual: { kind: 'add', target: E },
                    label: 'k',
                });
            }
        }
        if (allow.has('factor')) {
            for (const T of factorTargets(u, aux, an.folded)) {
                virtualOut.push({
                    id: `v:${ui}:factor@${T.s}`,
                    kind: 'virtual',
                    role: 'coef',
                    tier: 4,
                    unit: ui,
                    value0: 1,
                    pos: T.s,
                    virtual: { kind: 'factor', target: T },
                    label: 'a',
                });
            }
        }
        const output = outputSide(u);
        for (const axis of axesFor(u) as Array<0 | 1>) {
            const occ = occurrences(u, axis);
            if (!occ.length) continue;
            const first = tokenIn(aux, occ[0].s, occ[0].e, 'id');
            const pos = first ? first.pos : occ[0].s;
            if (allow.has('shiftVar')) {
                virtualOut.push({
                    id: `v:${ui}:shift:${axis}`,
                    kind: 'virtual',
                    role: 'shift',
                    tier: 4,
                    unit: ui,
                    value0: 0,
                    pos,
                    virtual: { kind: 'shiftVar', axis },
                    label: 'h',
                });
            }
            if (allow.has('scaleVar')) {
                const scale: DragNumber = {
                    id: `v:${ui}:scale:${axis}`,
                    kind: 'virtual',
                    role: 'coef',
                    tier: 4,
                    unit: ui,
                    value0: 1,
                    pos,
                    virtual: { kind: 'scaleVar', axis },
                    label: 's',
                };
                // The lone variable's implicit coefficient (graph form): never a number of a pivot gesture.
                if (output && output.axis === axis) scale.output = true;
                virtualOut.push(scale);
            }
        }
    });
    return out.concat(virtualOut);
}

// ------------------------------------------------------------------ slotted compile

interface Virtualized {
    root: Node;
    /** Equation units: the virtualized variable side (twins). */
    side: Node | null;
}

function virtualize(u: ParsedUnit, ui: number, numbers: readonly DragNumber[], slots: Map<Node, number>): Virtualized {
    const shift: number[] = [-1, -1];
    const scale: number[] = [-1, -1];
    const factorOf = new Map<Node, number>();
    let addIdx = -1;
    let addNode: Node | null = null;
    numbers.forEach((d, i) => {
        if (d.unit !== ui || d.kind !== 'virtual' || !d.virtual) return;
        const v = d.virtual;
        if (v.kind === 'shiftVar' && v.axis !== undefined) shift[v.axis] = i;
        else if (v.kind === 'scaleVar' && v.axis !== undefined) scale[v.axis] = i;
        else if (v.kind === 'factor' && v.target) factorOf.set(v.target, i);
        else if (v.kind === 'add' && v.target) {
            addIdx = i;
            addNode = v.target;
        }
    });
    const axisOf = (name: string) => u.vars.findIndex((v) => v.includes(name));
    const mapped = new Map<Node, Node>();
    const rec = (n: Node): Node => {
        if (u.frozen.has(n)) return n;
        let out: Node;
        const axis = n.t === 'name' ? axisOf(n.name) : -1;
        if (axis >= 0 && (shift[axis] >= 0 || scale[axis] >= 0)) {
            out = n;
            if (shift[axis] >= 0) {
                const h = vnum(0);
                slots.set(h, shift[axis]);
                out = { t: 'binary', op: '-', left: out, right: h, s: n.s, e: n.e };
            }
            if (scale[axis] >= 0) {
                const s = vnum(1);
                slots.set(s, scale[axis]);
                out = { t: 'binary', op: '*', left: s, right: out, s: n.s, e: n.e };
            }
        } else {
            out = mapChildren(n, rec);
        }
        const fi = factorOf.get(n);
        if (fi !== undefined) {
            const k = vnum(1);
            slots.set(k, fi);
            out = { t: 'binary', op: '*', left: k, right: out, s: n.s, e: n.e };
        }
        if (n === addNode && addIdx >= 0) {
            const k = vnum(0);
            slots.set(k, addIdx);
            out = { t: 'binary', op: '+', left: out, right: k, s: n.s, e: n.e };
        }
        mapped.set(n, out);
        return out;
    };
    const root = rec(u.owned);
    let side: Node | null = null;
    const vs = AUX.get(u)?.varSide;
    if (u.spec.role === 'equation' && vs) {
        if (!u.sides) side = root;
        else side = (vs[0] === u.sides.lhs.s ? mapped.get(u.sides.lhs) : mapped.get(u.sides.rhs)) ?? null;
    }
    return { root, side };
}

/**
 * Virtualize every unit (copy-on-write: V3 / V4 on occurrences first, then V2 on summands, then V1) and
 * compile once with expr.compile(ast, math.envFor(env, fnKind), text, hook). The hook maps literal NumNodes,
 * folded '/' nodes and synthetic virtual NumNodes (span -1) to () => values[i]. `math` is the PRIVATE context.
 * Throws ExprError when a unit does not compile (the caller locks the target).
 */
export function compileNumbers(units: readonly ParsedUnit[], numbers: readonly DragNumber[], math: MathContext): Evaluator {
    const values = new Float64Array(numbers.length);
    numbers.forEach((d, i) => {
        values[i] = d.value0;
    });
    const fns: Compiled[] = [];
    const sides: Array<Compiled | null> = [];
    units.forEach((u, ui) => {
        const slots = new Map<Node, number>();
        numbers.forEach((d, i) => {
            if (d.unit === ui && (d.kind === 'literal' || d.kind === 'folded') && d.node) slots.set(d.node, i);
        });
        const v = virtualize(u, ui, numbers, slots);
        const hook: CompileHook = (n) => {
            const i = slots.get(n);
            return i === undefined ? null : () => values[i];
        };
        const env = math.envFor(u.env, u.fnKind);
        fns.push(compile(v.root, env, u.text, hook));
        sides.push(v.side ? compile(v.side, env, u.text, hook) : null);
    });
    const sliders: Array<{ i: number; name: string }> = [];
    numbers.forEach((d, i) => {
        if (d.kind === 'slider' && d.param) sliders.push({ i, name: d.param.name });
    });
    return {
        values,
        fns,
        sides,
        apply(): void {
            if (!sliders.length) return;
            const rec: Record<string, number> = {};
            for (const s of sliders) rec[s.name] = values[s.i];
            math.setParamValues(rec);
        },
    };
}

// ------------------------------------------------------------------ number text

function decimalsFor(step: number): number {
    if (!(step > 0) || !Number.isFinite(step)) return 12;
    return Math.max(0, Math.min(12, -Math.floor(Math.log10(step) + 1e-9)));
}

function trimFixed(s: string): string {
    if (s.indexOf('.') < 0) return s;
    return s.replace(/0+$/, '').replace(/\.$/, '');
}

/** |v| as text (SPEC3 3.1): never exponent notation unless the raw literal had one; '0' for zero. */
function formatMagnitude(a: number, step: number, raw: string | null): string {
    if (!Number.isFinite(a)) return 'NaN';
    if (step > 0 && a < step / 2) return '0';
    const d = decimalsFor(step);
    const exp = raw ? /[eE]([+-]?\d+)$/.exec(raw) : null;
    if (exp && raw) {
        const E = parseInt(exp[1], 10);
        const mant = a / Math.pow(10, E);
        const t = trimFixed(mant.toFixed(Math.max(0, Math.min(20, d + E))));
        if (Number(t) === 0) return '0';
        return t + raw.slice(exp.index);
    }
    const t = trimFixed(a.toFixed(d));
    return Number(t) === 0 ? '0' : t;
}

/**
 * SPEC3 3.1: `v` with d = clamp(-floor(log10(step)), 0, 12) decimals, trailing zeros and a trailing '.'
 * trimmed, never '-0', never exponent notation (a raw literal written with an exponent, `1e3`, keeps it).
 */
export function formatValue(v: number, step: number, raw: string | null): string {
    const mag = formatMagnitude(Math.abs(v), step, raw);
    return v < 0 && mag !== '0' ? `-${mag}` : mag;
}

// ------------------------------------------------------------------ edits

interface Part {
    text: string;
    hl: boolean;
}

/** Ranks order edits at one position, left to right: closings (inner first), openings (outer first), the replacement. */
const R_CLOSE_GUARD = 5;
const R_CLOSE_INNER = 10;
const R_CLOSE_OUTER = 20;
const R_OPEN_OUTER = 30;
const R_OPEN_INNER = 40;
const R_OPEN_GUARD = 45;
const R_REPLACE = 50;

interface Edit {
    s: number;
    e: number;
    rank: number;
    /** `before`: original text left of s; `after`: already edited text right of e. */
    build: (before: string, after: string) => Part[];
}

function fixed(s: number, e: number, rank: number, parts: Part[]): Edit {
    return { s, e, rank, build: () => parts };
}

function hl(text: string): Part {
    return { text, hl: true };
}

function plain(text: string): Part {
    return { text, hl: false };
}

function applyEdits(text: string, edits: Edit[]): { text: string; changed: Array<[number, number]> } | null {
    const order = edits.slice().sort((a, b) => a.s - b.s || a.rank - b.rank);
    let reach = 0;
    for (const ed of order) {
        if (ed.s < reach || ed.e < ed.s) return null;
        reach = Math.max(reach, ed.e);
    }
    const decided = new Array<Part[]>(order.length);
    let cur = text;
    for (let k = order.length - 1; k >= 0; k--) {
        const ed = order[k];
        const parts = ed.build(cur.slice(0, ed.s), cur.slice(ed.e));
        decided[k] = parts;
        cur = cur.slice(0, ed.s) + parts.map((p) => p.text).join('') + cur.slice(ed.e);
    }
    let out = '';
    let pos = 0;
    const changed: Array<[number, number]> = [];
    order.forEach((ed, k) => {
        out += text.slice(pos, ed.s);
        for (const p of decided[k]) {
            if (p.hl && p.text) {
                const last = changed[changed.length - 1];
                if (last && last[1] === out.length) last[1] = out.length + p.text.length;
                else changed.push([out.length, out.length + p.text.length]);
            }
            out += p.text;
        }
        pos = ed.e;
    });
    out += text.slice(pos);
    return { text: out, changed };
}

const IDENT_TAIL_RE = /[A-Za-z0-9_$πθ]+$/;

/** True when `name(` would be a call that is not a product (builtin or user function). */
function isFunctionName(env: Env, vars: string[][], name: string): boolean {
    if (BUILTIN_FUNCTION_NAMES.includes(name)) return true;
    if (vars.some((v) => v.includes(name)) || env.scalar(name)) return false;
    return env.fn(name) !== null;
}

/** '*' when text starting with '(' would turn the identifier before it into a function call. */
function callGuard(env: Env, vars: string[][], before: string, first: string): string {
    if (first !== '(') return '';
    const m = IDENT_TAIL_RE.exec(before.replace(/\s+$/, ''));
    if (!m || /^\d/.test(m[0])) return '';
    const name = /[A-Za-z_$πθ][A-Za-z0-9_$πθ]*$/.exec(m[0]);
    return name && isFunctionName(env, vars, name[0]) ? '*' : '';
}

interface WrittenNumber {
    /** Value the text represents (written number, or the identity / start value when nothing is written). */
    value: number;
    /** Text is written for this number. */
    written: boolean;
    mag: string;
    neg: boolean;
}

function writtenNumbers(numbers: readonly DragNumber[], values: Float64Array, steps: Float64Array): WrittenNumber[] {
    return numbers.map((d, i) => {
        const v = values[i];
        const step = steps[i];
        if (d.kind === 'slider') return { value: v, written: false, mag: '', neg: false };
        if (d.kind === 'literal' || d.kind === 'folded') {
            const changed = Math.abs(v - d.value0) > 1e-12 * Math.max(1, Math.abs(d.value0));
            if (!changed || !Number.isFinite(v)) return { value: d.value0, written: false, mag: '', neg: false };
            const mag = formatMagnitude(Math.abs(v), step, d.kind === 'literal' ? d.label : null);
            const neg = v < 0 && mag !== '0';
            return { value: (neg ? -1 : 1) * Number(mag), written: true, mag, neg };
        }
        const kind = d.virtual ? d.virtual.kind : 'add';
        const identity = kind === 'factor' || kind === 'scaleVar' ? 1 : 0;
        if (!Number.isFinite(v)) return { value: identity, written: false, mag: '', neg: false };
        const mag = formatMagnitude(Math.abs(v), step, null);
        const neg = v < 0 && mag !== '0';
        const value = (neg ? -1 : 1) * Number(mag);
        if (value === identity) return { value: identity, written: false, mag, neg };
        return { value, written: true, mag, neg };
    });
}

interface Pass {
    u: ParsedUnit;
    aux: Aux;
    ui: number;
    defensive: boolean;
    tidy: boolean;
    edits: Edit[];
    numbers: readonly DragNumber[];
    w: WrittenNumber[];
}

/** Climb from a literal (or fraction) through LEFT operands of *, /, % to its term (SPEC3 3.1). */
function climbTerm(u: ParsedUnit, n: Node): Node {
    let term = n;
    for (;;) {
        const p = u.parent.get(term) ?? null;
        if (isMul(p) && p.left === term) term = p;
        else return term;
    }
}

type SignAnchor =
    | { kind: 'flip'; tok: Token }
    | { kind: 'unary'; tok: Token; next: number }
    | { kind: 'uplus'; tok: Token }
    | { kind: 'paren' }
    | { kind: 'lead' };

/** How a negative value written in `term` is absorbed (SPEC3 3.1 a to d). */
function signAnchor(P: Pass, term: Node): SignAnchor {
    const p = P.u.parent.get(term) ?? null;
    if (isAdd(p) && p.right === term) {
        const tok = opToken(P.aux, p);
        if (tok) return { kind: 'flip', tok };
    }
    if (p && p.t === 'unary' && (p.op === '-' || p.op === '+')) {
        const tok = unaryToken(P.aux, p);
        if (tok) {
            if (p.op === '+') return { kind: 'uplus', tok };
            const next = tokenFrom(P.aux, tok.end);
            return { kind: 'unary', tok, next: next ? next.pos : tok.end };
        }
    }
    if (p && p.t === 'binary' && ((p.op === '^' && p.left === term) || (isMul(p) && p.right === term))) return { kind: 'paren' };
    return { kind: 'lead' };
}

function flipText(tok: Token): string {
    return tok.text === '+' ? '-' : '+';
}

/** The implicit product whose left operand is `n` (or `n` under a unary sign: `-3x` is (-3) * x), else null. */
function isImplicitLeft(u: ParsedUnit, n: Node): BinaryNode | null {
    let c = n;
    let p = u.parent.get(c) ?? null;
    if (p && p.t === 'unary' && (p.op === '-' || p.op === '+')) {
        c = p;
        p = u.parent.get(c) ?? null;
    }
    return p && p.t === 'binary' && p.op === '*' && p.implicit && p.left === c ? p : null;
}

function literalEdits(P: Pass, i: number): void {
    const d = P.numbers[i];
    const w = P.w[i];
    if (!w.written || !d.node || !d.span) return;
    const node = d.node;
    const [s0, e0] = d.span;
    const { u, aux } = P;
    if (P.defensive) {
        P.edits.push({
            s: s0,
            e: e0,
            rank: R_REPLACE,
            build: (before) => {
                const t = `(${w.neg ? '-' : ''}${w.mag})`;
                return [hl(callGuard(aux.env, u.vars, before, '(') + t)];
            },
        });
        return;
    }
    const term = climbTerm(u, node);
    const implicit = isImplicitLeft(u, node);
    const removeCoef = P.tidy && Number(w.mag) === 1 && implicit !== null;
    const anchor: SignAnchor = w.neg ? signAnchor(P, term) : { kind: 'lead' };
    // Replacement span: the token (or fraction), or [coefficient start, right operand start) when tidied away.
    const rs = removeCoef ? node.s : s0;
    const re = removeCoef && implicit ? implicit.right.s : e0;
    if (!w.neg) {
        if (w.mag === '0') {
            // A written 0 also deletes a unary minus: 0x, never -0x.
            const p = u.parent.get(term) ?? null;
            if (p && p.t === 'unary' && p.op === '-') {
                const tok = unaryToken(aux, p);
                const next = tok ? tokenFrom(aux, tok.end) : null;
                if (tok) P.edits.push(fixed(tok.pos, next ? next.pos : tok.end, R_REPLACE, []));
            }
        }
        P.edits.push(fixed(rs, re, R_REPLACE, removeCoef ? [] : [hl(w.mag)]));
        return;
    }
    switch (anchor.kind) {
        case 'flip':
            P.edits.push(fixed(anchor.tok.pos, anchor.tok.end, R_REPLACE, [plain(flipText(anchor.tok))]));
            P.edits.push(fixed(rs, re, R_REPLACE, removeCoef ? [] : [hl(w.mag)]));
            return;
        case 'unary':
            P.edits.push(fixed(anchor.tok.pos, anchor.next, R_REPLACE, []));
            P.edits.push(fixed(rs, re, R_REPLACE, removeCoef ? [] : [hl(w.mag)]));
            return;
        case 'uplus':
            P.edits.push(fixed(anchor.tok.pos, anchor.tok.end, R_REPLACE, [plain('-')]));
            P.edits.push(fixed(rs, re, R_REPLACE, removeCoef ? [] : [hl(w.mag)]));
            return;
        case 'paren': {
            // A bare sign is safe only inside the literal's own parentheses ('(3)' -> '(-2)') or as the first
            // factor of a parenthesized product term ('x*(2y)' -> 'x*(-2y)'), never on a '^' base.
            const prev = tokenBefore(aux, s0);
            const ownParens = wrapped(aux, node);
            const termParens = term !== node && wrapped(aux, term) && prev !== null && prev.pos === term.s;
            if (ownParens || termParens) {
                P.edits.push(fixed(rs, re, R_REPLACE, removeCoef ? [plain('-')] : [plain('-'), hl(w.mag)]));
            } else {
                P.edits.push({
                    s: s0,
                    e: e0,
                    rank: R_REPLACE,
                    build: (before) => [hl(callGuard(aux.env, u.vars, before, '(') + `(-${w.mag})`)],
                });
            }
            return;
        }
        case 'lead':
            // The sign is a unary minus in the new text; the highlighted token is the number itself.
            P.edits.push(fixed(rs, re, R_REPLACE, removeCoef ? [plain('-')] : [plain('-'), hl(w.mag)]));
            return;
    }
}

/** Positions where a substituted occurrence needs no parentheses (SPEC3 3.2). */
function occurrenceFree(P: Pass, o: NameNode, tok: Token): boolean {
    const { u, aux } = P;
    const p = u.parent.get(o) ?? null;
    if (o === u.owned) return true;
    if (p && p.t === 'call') return true;
    if (p && p.t === 'cmp') return true;
    if (p && p.t === 'binary' && p.equation) return true;
    if (isAdd(p) && !(p.op === '-' && p.right === o)) return true;
    const prev = tokenBefore(aux, tok.pos);
    const next = tokenFrom(aux, tok.end);
    return !!prev && !!next && prev.kind === 'op' && prev.text === '(' && next.kind === 'op' && next.text === ')';
}

/**
 * `x(x + 1)` is ONE primary (a call that compiles as a product). Substituting its name splits it into two
 * juxtaposed operands, which a '/', '%' or '^' on its left would no longer take as a whole
 * (`a/x(x)` -> `a/(x - 1)(x - 1)`). Returns the normalized product to parenthesize, or null.
 */
function callFormToGuard(u: ParsedUnit, aux: Aux, o: NameNode, tok: Token): BinaryNode | null {
    const p = u.parent.get(o) ?? null;
    if (!p || p.t !== 'binary' || p.op !== '*' || !p.implicit || p.left !== o) return null;
    const next = tokenFrom(aux, tok.end);
    if (!next || next.kind !== 'op' || next.text !== '(') return null;
    if (wrapped(aux, p)) return null;
    const pp = u.parent.get(p) ?? null;
    if (!pp || pp.t !== 'binary' || pp.right !== p) return null;
    return pp.op === '/' || pp.op === '%' || pp.op === '^' ? p : null;
}

function isLeftOfMul(u: ParsedUnit, o: Node): boolean {
    const p = u.parent.get(o) ?? null;
    return isMul(p) && p.left === o;
}

/** A negative product may follow these characters without parentheses. */
const LEADING_SAFE = /(^|[(,<>=?:&|])\s*$/;

function occurrenceEdits(P: Pass, axis: number, factorAts: ReadonlySet<number>): void {
    const { u, aux, numbers, w } = P;
    let hi = -1;
    let si = -1;
    numbers.forEach((d, i) => {
        if (d.unit !== P.ui || !d.virtual || d.virtual.axis !== axis) return;
        if (d.virtual.kind === 'shiftVar') hi = i;
        if (d.virtual.kind === 'scaleVar') si = i;
    });
    const h = hi >= 0 && w[hi].written ? w[hi] : null;
    const sc = si >= 0 && w[si].written ? w[si] : null;
    if (!h && !sc) return;
    const spaced = u.style.spacedOps;
    const implicitMul = u.style.implicitMul;
    const shiftOp = h ? (h.neg ? '+' : '-') : '';
    const shiftText = h ? (spaced ? ` ${shiftOp} ${h.mag}` : `${shiftOp}${h.mag}`) : '';
    // Tidy: a scale of exactly -1 is written as a bare sign.
    const scaleNum = sc ? (P.tidy && !P.defensive && Number(sc.mag) === 1 && sc.neg ? '-' : `${sc.neg ? '-' : ''}${sc.mag}`) : '';
    for (const o of occurrences(u, axis)) {
        const tok = tokenIn(aux, o.s, o.e, 'id');
        if (!tok) continue;
        const name = u.text.slice(tok.pos, tok.end);
        const guard = callFormToGuard(u, aux, o, tok);
        if (guard) {
            P.edits.push(fixed(guard.s, guard.s, R_OPEN_GUARD, [hl('(')]));
            P.edits.push(fixed(guard.e, guard.e, R_CLOSE_GUARD, [hl(')')]));
        }
        if (P.defensive) {
            const inner = h ? `(${name}${spaced ? ` ${shiftOp} ` : shiftOp}${h.mag})` : name;
            const R = sc ? `(${sc.neg ? '-' : ''}${sc.mag}*${inner})` : inner;
            P.edits.push({
                s: tok.pos,
                e: tok.end,
                rank: R_REPLACE,
                build: (before) => [hl(callGuard(aux.env, u.vars, before, '(') + R)],
            });
            continue;
        }
        let parts: Part[];
        const product = !!sc;
        if (!sc) {
            parts = [plain(name), hl(shiftText)];
        } else if (!h) {
            // 1.77x; 1.77*x without implicit style or before e1-like names (1.77e1 would be a number).
            const coef = scaleNum === '-' ? '-' : scaleNum + (!implicitMul || /^[eE]\d/.test(name) ? '*' : '');
            parts = [hl(coef), plain(name)];
        } else {
            const coef = scaleNum === '-' ? '-' : scaleNum + (implicitMul ? '' : '*');
            parts = [hl(`${coef}(`), plain(name), hl(`${shiftText})`)];
        }
        const coefInFront = factorAts.has(tok.pos);
        const negProduct = product && !!sc && sc.neg;
        const free = occurrenceFree(P, o, tok);
        const leftOfMul = isLeftOfMul(u, o);
        let bare = false;
        if (!coefInFront) {
            if (!product) bare = free;
            else bare = free || leftOfMul;
        }
        const finalParts = parts;
        P.edits.push({
            s: tok.pos,
            e: tok.end,
            rank: R_REPLACE,
            build: (before) => {
                let wrap = !bare;
                if (!wrap && negProduct && !LEADING_SAFE.test(before)) wrap = true;
                if (!wrap) return finalParts;
                return [hl(callGuard(aux.env, u.vars, before, '(') + '('), ...finalParts, hl(')')];
            },
        });
    }
}

function factorEdits(P: Pass, i: number): number | null {
    const d = P.numbers[i];
    const w = P.w[i];
    const T = d.virtual?.target;
    if (!w.written || !T) return null;
    const { u, aux } = P;
    const signed = `${w.neg ? '-' : ''}${w.mag}`;
    if (P.defensive) {
        P.edits.push(fixed(T.s, T.s, R_OPEN_INNER, [hl(`(${signed})*(`)]));
        P.edits.push(fixed(T.e, T.e, R_CLOSE_INNER, [hl(')')]));
        return T.s;
    }
    const anchor = factorAnchor(aux, T);
    const removeOne = P.tidy && Number(w.mag) === 1;
    let sign = '';
    if (w.neg) {
        const p = u.parent.get(T) ?? null;
        if (!anchor.wrapT && anchor.unary) {
            const tok = unaryToken(aux, anchor.unary);
            if (tok && anchor.unary.op === '-') P.edits.push(fixed(tok.pos, anchor.at, R_REPLACE, []));
            else if (tok) P.edits.push(fixed(tok.pos, tok.end, R_REPLACE, [plain('-')]));
            else sign = '-';
        } else if (isAdd(p) && p.right === T) {
            const tok = opToken(aux, p);
            if (tok) P.edits.push(fixed(tok.pos, tok.end, R_REPLACE, [plain(flipText(tok))]));
            else sign = '-';
        } else {
            sign = '-';
        }
    }
    const num = removeOne ? '' : w.mag;
    const implicitMul = u.style.implicitMul;
    if (anchor.wrapT) {
        const open = `${sign}${num}${num && !implicitMul ? '*' : ''}(`;
        P.edits.push(fixed(anchor.at, anchor.at, R_OPEN_INNER, [hl(open)]));
        P.edits.push(fixed(T.e, T.e, R_CLOSE_INNER, [hl(')')]));
        return anchor.at;
    }
    P.edits.push({
        s: anchor.at,
        e: anchor.at,
        rank: R_OPEN_INNER,
        build: (_before, after) => {
            if (!num) return sign ? [hl(sign)] : [];
            const star = !implicitMul || /^(\d|\.|[eE]\d)/.test(after);
            return [hl(`${sign}${num}${star ? '*' : ''}`)];
        },
    });
    return anchor.at;
}

function addEdits(P: Pass, i: number): void {
    const d = P.numbers[i];
    const w = P.w[i];
    const E = d.virtual?.target;
    if (!w.written || !E) return;
    const { u, aux } = P;
    if (P.defensive) {
        P.edits.push(fixed(E.s, E.s, R_OPEN_OUTER, [hl('(')]));
        P.edits.push(fixed(E.e, E.e, R_CLOSE_OUTER, [hl(`) + (${w.neg ? '-' : ''}${w.mag})`)]));
        return;
    }
    const low = (E.t === 'cmp' || E.t === 'logic' || E.t === 'ternary') && !wrapped(aux, E);
    const op = w.neg ? '-' : '+';
    const text = u.style.spacedOps ? ` ${op} ${w.mag}` : `${op}${w.mag}`;
    if (low) P.edits.push(fixed(E.s, E.s, R_OPEN_OUTER, [hl('(')]));
    P.edits.push(fixed(E.e, E.e, R_CLOSE_OUTER, [hl(low ? `)${text}` : text)]));
}

function buildUnitEdits(P: Pass): void {
    const { numbers, ui } = P;
    numbers.forEach((d, i) => {
        if (d.unit === ui && (d.kind === 'literal' || d.kind === 'folded')) literalEdits(P, i);
    });
    const factorAts = new Set<number>();
    numbers.forEach((d, i) => {
        if (d.unit === ui && d.virtual && d.virtual.kind === 'factor') {
            const at = factorEdits(P, i);
            if (at !== null) factorAts.add(at);
        }
    });
    for (const axis of axesFor(P.u)) occurrenceEdits(P, axis, factorAts);
    numbers.forEach((d, i) => {
        if (d.unit === ui && d.virtual && d.virtual.kind === 'add') addEdits(P, i);
    });
}

// ------------------------------------------------------------------ safety net

function refKey(ref: FieldRef): string {
    if (ref.kind === 'function') return `f|${ref.name}|${ref.field}`;
    if (ref.kind === 'label') return `l|${ref.index}|${ref.field}`;
    if (ref.field === 'condition') return `t|${ref.id}|condition|${ref.entry}`;
    return `t|${ref.id}|${ref.field}`;
}

/** Equal within 1e-9 relative to the unit's scale (absolute 1e-12), finiteness equal. */
function sameValue(a: number, b: number, scale: number): boolean {
    const fa = Number.isFinite(a);
    const fb = Number.isFinite(b);
    if (fa !== fb) return false;
    if (!fa) return Number.isNaN(a) ? Number.isNaN(b) : a === b;
    return Math.abs(a - b) <= 1e-12 + 1e-9 * Math.max(Math.abs(a), Math.abs(b), scale);
}

/** Up to 6 of the unit's samples plus seeded points in their bounding box: 8 points. */
function checkPoints(own: ReadonlyArray<{ x: number; y: number }>, all: ReadonlyArray<ReadonlyArray<{ x: number; y: number }>>): Array<[number, number]> {
    const pts: Array<[number, number]> = [];
    const finite = own.filter((p) => Number.isFinite(p.x) && Number.isFinite(p.y));
    const take = Math.min(6, finite.length);
    for (let k = 0; k < take; k++) {
        const p = finite[Math.floor((k * finite.length) / take)];
        pts.push([p.x, p.y]);
    }
    let x0 = Infinity;
    let x1 = -Infinity;
    let y0 = Infinity;
    let y1 = -Infinity;
    for (const list of all) {
        for (const p of list) {
            if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) continue;
            x0 = Math.min(x0, p.x);
            x1 = Math.max(x1, p.x);
            y0 = Math.min(y0, p.y);
            y1 = Math.max(y1, p.y);
        }
    }
    if (!(x1 >= x0)) {
        x0 = -5;
        x1 = 5;
    }
    if (!(y1 >= y0)) {
        y0 = -5;
        y1 = 5;
    }
    const wx = Math.max(x1 - x0, 1);
    const wy = Math.max(y1 - y0, 1);
    let seed = 0x2545f491;
    const rnd = () => {
        seed = (Math.imul(seed, 1103515245) + 12345) >>> 0;
        return seed / 4294967296;
    };
    while (pts.length < 8) pts.push([x0 - 0.25 * wx + rnd() * 1.5 * wx, y0 - 0.25 * wy + rnd() * 1.5 * wy]);
    return pts;
}

/** Plain closure of the unit's node in `text`, or null when it is gone or the field's structure changed. */
function plainClosure(u: ParsedUnit, aux: Aux, text: string, math: MathContext): Compiled | null {
    try {
        const loc = locate(u.spec, text, true);
        if (!loc || loc.shape !== aux.shape) return null;
        if (u.spec.role === 'equation' && !!loc.sides !== !!u.sides) return null;
        return compile(loc.node, math.envFor(u.env, u.fnKind), text);
    } catch {
        return null;
    }
}

function compareClosures(
    a: Compiled,
    b: Compiled,
    env: ParsedUnit['env'],
    pts: Array<[number, number]>
): boolean {
    if (env === 'value') return sameValue(a(NaN, NaN), b(NaN, NaN), 0);
    const va: number[] = [];
    const vb: number[] = [];
    let scale = 0;
    for (const [x, y] of pts) {
        const yy = env === 'fn1' ? NaN : y;
        const p = a(x, yy);
        const q = b(x, yy);
        va.push(p);
        vb.push(q);
        if (Number.isFinite(p)) scale = Math.max(scale, Math.abs(p));
        if (Number.isFinite(q)) scale = Math.max(scale, Math.abs(q));
    }
    for (let k = 0; k < va.length; k++) if (!sameValue(va[k], vb[k], scale)) return false;
    return true;
}

/** Run `fn` with the evaluator's values set to what the text says (written numbers, identities, start values). */
function withWritten<T>(ev: Evaluator, numbers: readonly DragNumber[], w: WrittenNumber[], fn: () => T): T {
    const saved = Float64Array.from(ev.values);
    numbers.forEach((d, i) => {
        if (d.kind !== 'slider') ev.values[i] = w[i].value;
    });
    try {
        return fn();
    } finally {
        ev.values.set(saved);
    }
}

// ------------------------------------------------------------------ rewrite

/**
 * SPEC3 3.1 to 3.6 for every field of `units` (units sharing a field are merged). Every field of the units
 * is returned, also unchanged ones (text = start text, changed = []), so dragging back restores the start
 * text byte for byte. With `opts.twins` the mirrored, checked objective texts are appended (SPEC3 3.7).
 * When a field fails the safety net in both modes, its entry has `failed` and the START text: keep the
 * previous frame's text.
 */
export function rewriteUnits(
    units: readonly ParsedUnit[],
    numbers: readonly DragNumber[],
    values: Float64Array,
    steps: Float64Array,
    ev: Evaluator,
    math: MathContext,
    opts: {
        tidy: boolean;
        samples: ReadonlyArray<ReadonlyArray<{ x: number; y: number }>>;
        /** Optional addition: mirrored, checked objective texts are appended (SPEC3 3.7). */
        twins?: readonly TwinInput[];
        /** Optional addition (tests): skip the normal mode and write the defensive text directly. */
        defensiveOnly?: boolean;
    }
): RewrittenField[] {
    const w = writtenNumbers(numbers, values, steps);
    const groups = new Map<string, number[]>();
    units.forEach((u, ui) => {
        if (u.spec.role === 'side') return;
        const key = auxOf(u).key;
        const g = groups.get(key);
        if (g) g.push(ui);
        else groups.set(key, [ui]);
    });
    const out: RewrittenField[] = [];
    const byUnit = new Map<number, RewrittenField>();
    withWritten(ev, numbers, w, () => {
        groups.forEach((members) => {
            const first = units[members[0]];
            const text = first.text;
            // Same written numbers, same text and verdict: skip the edits and the net.
            const memos = auxOf(first).memo;
            let memo = memos.get(numbers);
            if (!memo) {
                memo = new Map();
                memos.set(numbers, memo);
            }
            const inGroup = new Set(members);
            let sig = `${opts.tidy ? 1 : 0}${opts.defensiveOnly ? 1 : 0}|${members.join(',')}|`;
            numbers.forEach((d, i) => {
                if (d.kind !== 'slider' && inGroup.has(d.unit)) sig += w[i].written ? `${i}${w[i].neg ? '-' : '+'}${w[i].mag};` : '';
            });
            const hit = memo.get(sig);
            if (hit) {
                const copy: RewrittenField = { ...hit, changed: hit.changed.map((c) => [c[0], c[1]] as [number, number]) };
                out.push(copy);
                for (const ui of members) byUnit.set(ui, copy);
                return;
            }
            let result: { text: string; changed: Array<[number, number]> } | null = null;
            let usedDefensive = false;
            for (const defensive of opts.defensiveOnly ? [true] : [false, true]) {
                usedDefensive = defensive;
                const edits: Edit[] = [];
                for (const ui of members) {
                    const u = units[ui];
                    buildUnitEdits({ u, aux: auxOf(u), ui, defensive, tidy: opts.tidy, edits, numbers, w });
                }
                if (!edits.length) {
                    result = { text, changed: [] };
                    break;
                }
                const applied = applyEdits(text, edits);
                if (!applied) continue;
                const ok = members.every((ui) => {
                    const u = units[ui];
                    const aux = auxOf(u);
                    const plainFn = plainClosure(u, aux, applied.text, math);
                    if (!plainFn) return false;
                    const pts = checkPoints(opts.samples[ui] || [], opts.samples);
                    return compareClosures(ev.fns[ui], plainFn, u.env, pts);
                });
                if (ok) {
                    result = applied;
                    break;
                }
            }
            const field: RewrittenField = result
                ? { ref: first.spec.ref, text: result.text, changed: result.changed, failed: false, defensive: usedDefensive }
                : { ref: first.spec.ref, text, changed: [], failed: true };
            out.push(field);
            for (const ui of members) byUnit.set(ui, field);
            if (memo.size >= 256) memo.clear();
            memo.set(sig, { ...field, changed: field.changed.map((c) => [c[0], c[1]] as [number, number]) });
        });
        for (const twin of opts.twins || []) {
            out.push(rewriteTwinChecked(units, twin, byUnit.get(twin.unit) || null, ev, math, opts.samples));
        }
    });
    return out;
}

function rewriteTwinChecked(
    units: readonly ParsedUnit[],
    twin: TwinInput,
    field: RewrittenField | null,
    ev: Evaluator,
    math: MathContext,
    samples: ReadonlyArray<ReadonlyArray<{ x: number; y: number }>>
): RewrittenField {
    const failed: RewrittenField = { ref: twin.ref, text: twin.text, changed: [], failed: true };
    const u = units[twin.unit];
    if (!u || !field || field.failed) return failed;
    const aux = auxOf(u);
    const side = aux.varSide;
    const sideFn = ev.sides ? ev.sides[twin.unit] : null;
    if (!side || !sideFn) return failed;
    let twinSide: [number, number];
    try {
        const root = parse(twin.text, 'expr');
        twinSide = [root.s, root.e];
    } catch {
        return failed;
    }
    const mirrored = mirrorWithSpans(u.text, side, field.text, twin.text, twinSide);
    if (!mirrored) return failed;
    let plainFn: Compiled;
    try {
        plainFn = compile(parse(mirrored.text, 'expr'), math.envFor('fn2'), mirrored.text);
    } catch {
        return failed;
    }
    const pts = checkPoints(samples[twin.unit] || [], samples);
    if (!compareClosures(sideFn, plainFn, 'fn2', pts)) return failed;
    return { ref: twin.ref, text: mirrored.text, changed: mirrored.changed, failed: false };
}

// ------------------------------------------------------------------ twins

function sigTokens(text: string): Token[] | null {
    try {
        return tokenize(text).filter((t) => t.kind !== 'end');
    } catch {
        return null;
    }
}

/** Optional addition: the normalized token text of `span` in `text` (SPEC3 3.7), or null when it does not tokenize. */
export function normalizedTokens(text: string, span?: [number, number]): string | null {
    const toks = sigTokens(text);
    if (!toks) return null;
    const [s, e] = span || [0, text.length];
    return toks
        .filter((t) => t.pos >= s && t.end <= e)
        .map((t) => t.text)
        .join(' ');
}

function mirrorWithSpans(
    fromOld: string,
    fromSide: [number, number],
    fromNew: string,
    twinText: string,
    twinSide: [number, number]
): { text: string; changed: Array<[number, number]> } | null {
    const oldT = sigTokens(fromOld);
    const newT = sigTokens(fromNew);
    const twT = sigTokens(twinText);
    if (!oldT || !newT || !twT) return null;
    const i0 = oldT.findIndex((t) => t.pos >= fromSide[0]);
    let i1 = i0;
    while (i1 >= 0 && i1 < oldT.length && oldT[i1].end <= fromSide[1]) i1++;
    if (i0 < 0 || i1 <= i0) return null;
    const tw = twT.filter((t) => t.pos >= twinSide[0] && t.end <= twinSide[1]);
    if (tw.length !== i1 - i0) return null;
    for (let k = 0; k < tw.length; k++) if (tw[k].text !== oldT[i0 + k].text) return null;
    // LCS over token texts (suffix table).
    const n = oldT.length;
    const m = newT.length;
    const L = new Int32Array((n + 1) * (m + 1));
    const at = (i: number, j: number) => i * (m + 1) + j;
    for (let i = n - 1; i >= 0; i--) {
        for (let j = m - 1; j >= 0; j--) {
            L[at(i, j)] = oldT[i].text === newT[j].text ? L[at(i + 1, j + 1)] + 1 : Math.max(L[at(i + 1, j)], L[at(i, j + 1)]);
        }
    }
    // Hunks: maximal runs of unmatched tokens, [a, b) old and [c, d) new.
    const hunks: Array<{ a: number; b: number; c: number; d: number }> = [];
    let i = 0;
    let j = 0;
    let open: { a: number; c: number } | null = null;
    const close = () => {
        if (open && (i > open.a || j > open.c)) hunks.push({ a: open.a, b: i, c: open.c, d: j });
        open = null;
    };
    while (i < n || j < m) {
        if (i < n && j < m && oldT[i].text === newT[j].text && L[at(i, j)] === L[at(i + 1, j + 1)] + 1) {
            close();
            i++;
            j++;
            continue;
        }
        if (!open) open = { a: i, c: j };
        if (j >= m || (i < n && L[at(i + 1, j)] >= L[at(i, j + 1)])) i++;
        else j++;
    }
    close();
    type Repl = { s: number; e: number; text: string };
    const repl: Repl[] = [];
    const isWs = (c: string) => /\s/.test(c);
    for (const h of hunks) {
        const inside = h.a >= i0 && h.b <= i1;
        if (h.b > h.a) {
            if (h.b <= i0 || h.a >= i1) continue;
            if (!inside) return null;
        } else if (h.a < i0 || h.a > i1) {
            continue;
        }
        if (h.b - h.a === h.d - h.c) {
            for (let k = 0; k < h.b - h.a; k++) {
                const t = tw[h.a - i0 + k];
                const nt = newT[h.c + k];
                repl.push({ s: t.pos, e: t.end, text: fromNew.slice(nt.pos, nt.end) });
            }
            continue;
        }
        // Gap replacement: from the previous matched token to the next one, clipped to the side.
        const twS = h.a > i0 ? tw[h.a - i0 - 1].end : twinSide[0];
        const twE = h.b < i1 ? tw[h.b - i0].pos : twinSide[1];
        let ns = h.c > 0 ? newT[h.c - 1].end : 0;
        let ne = h.d < m ? newT[h.d].pos : fromNew.length;
        if (h.a <= i0) while (ns < ne && isWs(fromNew[ns])) ns++;
        if (h.b >= i1) while (ne > ns && isWs(fromNew[ne - 1])) ne--;
        repl.push({ s: twS, e: twE, text: fromNew.slice(ns, ne) });
    }
    repl.sort((x, y) => x.s - y.s || x.e - y.e);
    let out = '';
    let pos = 0;
    const changed: Array<[number, number]> = [];
    for (const r of repl) {
        if (r.s < pos) return null;
        out += twinText.slice(pos, r.s);
        const trimmed = r.text.replace(/^\s+/, '');
        const lead = r.text.length - trimmed.length;
        if (trimmed) changed.push([out.length + lead, out.length + r.text.length]);
        out += r.text;
        pos = r.e;
    }
    out += twinText.slice(pos);
    return { text: out, changed };
}

/** SPEC3 3.7: twin text for a rewritten side, or null when the token sequences no longer match. */
export function mirrorEdits(fromOld: string, fromSide: [number, number], fromNew: string, twinText: string, twinSide: [number, number]): string | null {
    const r = mirrorWithSpans(fromOld, fromSide, fromNew, twinText, twinSide);
    return r ? r.text : null;
}

// ------------------------------------------------------------------ make slider

/** SPEC3 1.11: replace `span` of `text` with `name`, adding '*' where juxtaposition would merge or call. */
export function makeSliderEdit(text: string, span: [number, number], name: string): string {
    const [s, e] = span;
    const before = text.slice(0, s);
    const after = text.slice(e);
    let pre = '';
    const prevTrim = before.replace(/\s+$/, '');
    const prev = prevTrim.slice(-1);
    if (prev && /[A-Za-z0-9_$.)πθ]/.test(prev)) {
        const word = /[A-Za-z_$πθ][A-Za-z0-9_$πθ]*$/.exec(prevTrim);
        if (!(word && (word[0] === 'and' || word[0] === 'or') && /[A-Za-z0-9_$πθ]/.test(prev))) pre = '*';
    }
    let post = '';
    const next = after.slice(0, 1);
    if (next && /[A-Za-z0-9_$.(πθ]/.test(next)) post = '*';
    else if (/^\s*\(/.test(after)) post = '*';
    return before + pre + name + post + after;
}

// ------------------------------------------------------------------ hover preview

/**
 * Optional addition (SPEC3 1.8 hover chip): per field, the spans of the numbers in `which` (indices into
 * `numbers`) and the structure their virtual numbers would insert, with the placeholders 'k' (add),
 * 'a' (factor), 'h' (shiftVar) and 's' (scaleVar); the second axis of a unit that shifts or scales both
 * writes 'h2' / 's2'. The ghosts are what the rewriter itself inserts for those placeholders (SPEC3 3.2
 * parenthesization: `x^3 - 3x` previews as `(x - h)^3 - 3(x - h) + k`), so the preview always matches the
 * written structure.
 */
export function previewFields(units: readonly ParsedUnit[], numbers: readonly DragNumber[], which: readonly number[]): FieldPreview[] {
    const out = new Map<string, FieldPreview>();
    const fieldOf = (u: ParsedUnit): FieldPreview => {
        const key = refKey(u.spec.ref);
        let f = out.get(key);
        if (!f) {
            f = { ref: u.spec.ref, text: u.text, numSpans: [], ghosts: [], virtualKinds: [] };
            out.set(key, f);
        }
        return f;
    };
    units.forEach((u) => {
        if (u.spec.role !== 'side') fieldOf(u);
    });
    const kinds = new Map<string, Set<VirtualKind>>();
    const virtualIdx: number[] = [];
    for (const i of which) {
        const d = numbers[i];
        if (!d) continue;
        if (d.kind === 'slider') {
            units.forEach((u) => {
                if (u.spec.role === 'side') return;
                const aux = auxOf(u);
                const f = fieldOf(u);
                const walk = (n: Node) => {
                    if (u.frozen.has(n)) return;
                    if (n.t === 'name' && n.name === d.label) {
                        const tok = tokenIn(aux, n.s, n.e, 'id');
                        if (tok) f.numSpans.push([tok.pos, tok.end]);
                    }
                    children(n).forEach(walk);
                };
                textOrderRoots(u).forEach(walk);
            });
            continue;
        }
        const u = units[d.unit];
        if (!u) continue;
        const f = fieldOf(u);
        if ((d.kind === 'literal' || d.kind === 'folded') && d.span) {
            f.numSpans.push([d.span[0], d.span[1]]);
            continue;
        }
        const v = d.virtual;
        if (!v) continue;
        const key = refKey(u.spec.ref);
        const ks = kinds.get(key) || new Set<VirtualKind>();
        ks.add(v.kind);
        kinds.set(key, ks);
        virtualIdx.push(i);
    }
    if (virtualIdx.length) {
        // Ghosts: the rewriter's own insertions for placeholder numbers, per field (units sharing a field
        // together, as rewriteUnits edits them).
        const w = placeholderNumbers(numbers, virtualIdx);
        const groups = new Map<string, number[]>();
        units.forEach((u, ui) => {
            if (u.spec.role === 'side') return;
            const key = refKey(u.spec.ref);
            const g = groups.get(key);
            if (g) g.push(ui);
            else groups.set(key, [ui]);
        });
        groups.forEach((members, key) => {
            const f = out.get(key);
            if (!f) return;
            const inGroup = new Set(members);
            if (!virtualIdx.some((i) => inGroup.has(numbers[i].unit))) return;
            const edits: Edit[] = [];
            for (const ui of members) buildUnitEdits({ u: units[ui], aux: auxOf(units[ui]), ui, defensive: false, tidy: false, edits, numbers, w });
            const ins = insertionsOf(f.text, edits);
            if (ins) f.ghosts.push(...ins);
            else for (const i of virtualIdx) if (inGroup.has(numbers[i].unit)) simpleGhosts(units[numbers[i].unit], numbers[i], f);
        });
    }
    const order: VirtualKind[] = ['add', 'factor', 'shiftVar', 'scaleVar'];
    const list = Array.from(out.values());
    for (const f of list) {
        f.numSpans.sort((a, b) => a[0] - b[0]);
        f.ghosts.sort((a, b) => a.at - b.at);
        const ks = kinds.get(refKey(f.ref));
        f.virtualKinds = ks ? order.filter((k) => ks.has(k)) : [];
    }
    return list;
}

/** Placeholder of an inserted number in the hover preview (SPEC3 1.8). */
const PLACEHOLDER: Record<VirtualKind, string> = { add: 'k', factor: 'a', shiftVar: 'h', scaleVar: 's' };

/**
 * Written numbers for the preview: the virtual numbers in `idx` written as their placeholders ('h2' / 's2'
 * on axis 1 when the unit also shifts or scales axis 0), everything else unwritten.
 */
function placeholderNumbers(numbers: readonly DragNumber[], idx: readonly number[]): WrittenNumber[] {
    const set = new Set(idx);
    const axis0 = new Set<string>();
    for (const i of idx) {
        const v = numbers[i].virtual;
        if (v && v.axis === 0) axis0.add(`${numbers[i].unit}:${v.kind}`);
    }
    return numbers.map((d, i) => {
        const v = d.virtual;
        if (!set.has(i) || d.kind !== 'virtual' || !v) return { value: d.value0, written: false, mag: '', neg: false };
        const mag = PLACEHOLDER[v.kind] + (v.axis === 1 && axis0.has(`${d.unit}:${v.kind}`) ? '2' : '');
        return { value: NaN, written: true, mag, neg: false };
    });
}

/**
 * The edits as insertions into `text` (at original positions); null when an edit replaces or removes
 * original text (then the preview cannot show it as ghosts).
 */
function insertionsOf(text: string, edits: Edit[]): Array<{ at: number; text: string }> | null {
    const order = edits.slice().sort((a, b) => a.s - b.s || a.rank - b.rank);
    let reach = 0;
    for (const ed of order) {
        if (ed.s < reach || ed.e < ed.s) return null;
        reach = Math.max(reach, ed.e);
    }
    const decided = new Array<Part[]>(order.length);
    let cur = text;
    for (let k = order.length - 1; k >= 0; k--) {
        const ed = order[k];
        const parts = ed.build(cur.slice(0, ed.s), cur.slice(ed.e));
        decided[k] = parts;
        cur = cur.slice(0, ed.s) + parts.map((p) => p.text).join('') + cur.slice(ed.e);
    }
    const out: Array<{ at: number; text: string }> = [];
    let ok = true;
    order.forEach((ed, k) => {
        let pos = ed.s;
        for (const p of decided[k]) {
            if (!p.text) continue;
            if (p.hl) {
                const last = out[out.length - 1];
                if (last && last.at === pos) last.text += p.text;
                else out.push({ at: pos, text: p.text });
            } else {
                if (text.slice(pos, pos + p.text.length) !== p.text) ok = false;
                pos += p.text.length;
            }
        }
        if (pos !== ed.e) ok = false;
    });
    return ok ? out : null;
}

/** Fallback ghosts of one virtual number (insertion points only, no parenthesization). */
function simpleGhosts(u: ParsedUnit, d: DragNumber, f: FieldPreview): void {
    const v = d.virtual;
    if (!v) return;
    const aux = auxOf(u);
    const spaced = u.style.spacedOps;
    if (v.kind === 'add' && v.target) {
        const E = v.target;
        const low = (E.t === 'cmp' || E.t === 'logic' || E.t === 'ternary') && !wrapped(aux, E);
        if (low) f.ghosts.push({ at: E.s, text: '(' });
        f.ghosts.push({ at: E.e, text: `${low ? ')' : ''}${spaced ? ' + k' : '+k'}` });
    } else if (v.kind === 'factor' && v.target) {
        const a = factorAnchor(aux, v.target);
        const after = u.text.slice(a.at);
        const star = !u.style.implicitMul || /^(\d|\.|[eE]\d)/.test(after);
        f.ghosts.push({ at: a.at, text: a.wrapT ? 'a(' : star ? 'a*' : 'a' });
        if (a.wrapT) f.ghosts.push({ at: v.target.e, text: ')' });
    } else if (v.axis !== undefined) {
        for (const o of occurrences(u, v.axis)) {
            const tok = tokenIn(aux, o.s, o.e, 'id');
            if (!tok) continue;
            if (v.kind === 'shiftVar') f.ghosts.push({ at: tok.end, text: spaced ? ' - h' : '-h' });
            else f.ghosts.push({ at: tok.pos, text: u.style.implicitMul ? 's' : 's*' });
        }
    }
}
