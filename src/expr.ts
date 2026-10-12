/*
 * Expression language behind every math field: tokenizer, AST parser,
 * closure compiler, affine forms, identifier tools, quick-fix helpers and
 * the pgfmath / LaTeX printers. Pure: no DOM, no Obsidian, and no dynamic
 * code evaluation (expressions compile to trees of closures).
 *
 * Names (axis variables, sliders, derived names, user functions) are
 * resolved through an `Env` supplied by MathContext (src/mathcontext.ts),
 * which also owns all scope state and caching. Other modules should go
 * through MathContext rather than importing this file.
 *
 * Grammar (low to high precedence):
 *   ternary := or ('?' ternary ':' ternary)?
 *   or      := and (('||' | 'or') and)*
 *   and     := cmp (('&&' | 'and') cmp)*
 *   cmp     := add (relop add)*          a chain means AND: a < b < c
 *   add     := mul (('+' | '-') mul)*
 *   mul     := unary (('*' | '/' | '%') unary | IMPLICIT unary)*
 *   unary   := ('-' | '+' | '!') unary | pow
 *   pow     := primary (('^' | '**') unary)?        right-associative
 *   primary := number | name | name '(' args ')' | 'Math' '.' name ['(' args ')'] | '(' ternary ')'
 * Implicit multiplication applies when a number, a name or '(' directly
 * follows a complete operand: 2x, 3(x+1), (x+1)(x-1), 2 pi, x y. `1/2x`
 * therefore means (1/2)*x, and `ax` is ONE name (see the quick fixes).
 * `name(A)` parses as a call; when name is not a function (slider,
 * variable, constant, derived name) it compiles as name * (A), as ONE
 * operand: `1/a(x)` is 1/(a x), `2^a(x)` is 2^(a x), `-a(x)` is -(a x).
 * The one exception is a power on it: `a(x - h)^2` is a * ((x - h)^2), as
 * `2(x - h)^2` is (implicitPowerBase).
 */
import type { Affine, IssueFix } from './mathcontext';

/**
 * Compile-time problem in user math (syntax, unknown name, wrong variable,
 * cycle, ...). src/mathcontext.ts re-exports it; that is its public home.
 */
export class ExprError extends Error {
    pos?: number;
    unknown?: string;
    fix?: IssueFix;
    /** 0-based index of the failing item in list sources (condition entries, values, points). */
    index?: number;
    constructor(message: string, opts?: { pos?: number; unknown?: string; fix?: IssueFix; index?: number }) {
        super(message);
        this.name = 'ExprError';
        if (opts) {
            this.pos = opts.pos;
            this.unknown = opts.unknown;
            this.fix = opts.fix;
            this.index = opts.index;
        }
    }
}

// ------------------------------------------------------------------ tables

interface Builtin {
    fn: (...args: number[]) => number;
    /** Accepted argument counts. */
    min: number;
    max: number;
    /** False for `random`: never constant-folded. */
    pure: boolean;
}

function unary(fn: (v: number) => number): Builtin {
    return { fn, min: 1, max: 1, pure: true };
}

function binary(fn: (a: number, b: number) => number): Builtin {
    return { fn, min: 2, max: 2, pure: true };
}

function variadic(fn: (...args: number[]) => number): Builtin {
    return { fn, min: 1, max: Infinity, pure: true };
}

/**
 * Everything 3.19.6 exposed through `Math.<name>`. Kept separate from the
 * bare names so `Math.ln` stays unknown, as it is in JavaScript.
 */
const MATH_FUNCTIONS: Record<string, Builtin> = {
    sin: unary(Math.sin), cos: unary(Math.cos), tan: unary(Math.tan),
    asin: unary(Math.asin), acos: unary(Math.acos), atan: unary(Math.atan), atan2: binary(Math.atan2),
    sinh: unary(Math.sinh), cosh: unary(Math.cosh), tanh: unary(Math.tanh),
    asinh: unary(Math.asinh), acosh: unary(Math.acosh), atanh: unary(Math.atanh),
    exp: unary(Math.exp), log: unary(Math.log), log2: unary(Math.log2), log10: unary(Math.log10),
    sqrt: unary(Math.sqrt), cbrt: unary(Math.cbrt), pow: binary(Math.pow), abs: unary(Math.abs),
    sign: unary(Math.sign), floor: unary(Math.floor), ceil: unary(Math.ceil), round: unary(Math.round),
    trunc: unary(Math.trunc), min: variadic(Math.min), max: variadic(Math.max), hypot: variadic(Math.hypot),
    log1p: unary(Math.log1p), expm1: unary(Math.expm1), fround: unary(Math.fround),
    random: { fn: Math.random, min: 0, max: 0, pure: false },
};

/** Bare function names: every Math function plus ln, sec, csc, cot. */
const BUILTINS: Record<string, Builtin> = {
    ...MATH_FUNCTIONS,
    ln: unary(Math.log),
    sec: unary((v) => 1 / Math.cos(v)),
    csc: unary((v) => 1 / Math.sin(v)),
    cot: unary((v) => 1 / Math.tan(v)),
};

const MATH_CONSTANTS: Record<string, number> = {
    PI: Math.PI, E: Math.E, LN2: Math.LN2, LN10: Math.LN10,
    LOG2E: Math.LOG2E, LOG10E: Math.LOG10E, SQRT2: Math.SQRT2, SQRT1_2: Math.SQRT1_2,
};

/** Bare constants. `true` / `false` were valid under the old JS-based compiler. */
const CONSTANTS: Record<string, number> = {
    ...MATH_CONSTANTS,
    pi: Math.PI,
    'π': Math.PI,
    e: Math.E,
    true: 1,
    false: 0,
};

/** Greek letter names: never split into products, printed as LaTeX commands. */
const GREEK = new Set([
    'alpha', 'beta', 'gamma', 'delta', 'epsilon', 'varepsilon', 'zeta', 'eta', 'theta', 'vartheta', 'iota',
    'kappa', 'lambda', 'mu', 'nu', 'xi', 'omicron', 'pi', 'rho', 'sigma', 'tau', 'upsilon', 'phi', 'varphi',
    'chi', 'psi', 'omega', 'Gamma', 'Delta', 'Theta', 'Lambda', 'Xi', 'Pi', 'Sigma', 'Upsilon', 'Phi',
    'Psi', 'Omega',
]);

/** Names that are variables in some field (rule 3 of the quick fixes). */
const VARIABLE_NAMES = ['x', 'y', 'z', 't', 'theta', 'θ'];

/**
 * Own-property lookups only: plain-object tables inherit from
 * Object.prototype, so `constructor` or `toString` must never resolve.
 */
function own<T>(table: Record<string, T>, name: string): T | undefined {
    return Object.prototype.hasOwnProperty.call(table, name) ? table[name] : undefined;
}

/** Builtin function names usable without `Math.` (for reserved-name lists and suggestions). */
export const BUILTIN_FUNCTION_NAMES: readonly string[] = Object.keys(BUILTINS);

/** Constant names: pi, π, e, true, false and the Math constants (PI, E, LN2, ...). */
export const CONSTANT_NAMES: readonly string[] = Object.keys(CONSTANTS);

/** True for names that can never be a slider / function / tool name in an expression. */
export function isReservedName(name: string): boolean {
    return (
        own(BUILTINS, name) !== undefined ||
        own(CONSTANTS, name) !== undefined ||
        VARIABLE_NAMES.includes(name) ||
        name === 'Math' ||
        name === 'and' ||
        name === 'or'
    );
}

// --------------------------------------------------------------- tokenizer

export type TokenKind = 'num' | 'id' | 'op' | 'end';

export interface Token {
    kind: TokenKind;
    /** Number source, identifier, or operator (unicode operators normalized, e.g. '≤' -> '<='). */
    text: string;
    value: number;
    /** Source span [pos, end). */
    pos: number;
    end: number;
}

/** Longest first so `===` beats `==` beats `=`, `**` beats `*`, `<=` beats `<`. */
const OPERATORS = [
    '===', '!==', '**', '==', '!=', '<=', '>=', '&&', '||',
    '<', '>', '+', '-', '*', '/', '%', '^', '(', ')', ',', '?', ':', '.', '!', '=', ';',
];

/** Single-character unicode operators people paste from documents. */
const UNICODE_OPERATORS: Record<string, string> = {
    '≤': '<=', '≥': '>=', '≠': '!=', '−': '-', '·': '*', '×': '*',
};

/** The exponent is consumed only when digits follow: `2e` is 2*e and `2e-x` is 2*e - x. */
const NUM_RE = /(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?/y;
const IDENT_RE = /[A-Za-z_$][A-Za-z0-9_$]*/y;
const IDENT_FULL_RE = /^[A-Za-z_$][A-Za-z0-9_$]*$/;

export function tokenize(src: string): Token[] {
    const tokens: Token[] = [];
    const n = src.length;
    let i = 0;
    while (i < n) {
        const code = src.charCodeAt(i);
        if (code === 32 || code === 9 || code === 10 || code === 13 || code === 0xa0) {
            i++;
            continue;
        }
        NUM_RE.lastIndex = i;
        const num = NUM_RE.exec(src);
        if (num) {
            tokens.push({ kind: 'num', text: num[0], value: Number(num[0]), pos: i, end: NUM_RE.lastIndex });
            i = NUM_RE.lastIndex;
            continue;
        }
        IDENT_RE.lastIndex = i;
        const ident = IDENT_RE.exec(src);
        if (ident) {
            tokens.push({ kind: 'id', text: ident[0], value: 0, pos: i, end: IDENT_RE.lastIndex });
            i = IDENT_RE.lastIndex;
            continue;
        }
        const ch = src[i];
        if (ch === 'π' || ch === 'θ') {
            tokens.push({ kind: 'id', text: ch, value: 0, pos: i, end: i + 1 });
            i++;
            continue;
        }
        const uni = own(UNICODE_OPERATORS, ch);
        if (uni !== undefined) {
            tokens.push({ kind: 'op', text: uni, value: 0, pos: i, end: i + 1 });
            i++;
            continue;
        }
        const op = OPERATORS.find((p) => src.startsWith(p, i));
        if (!op) {
            throw new ExprError(`Unexpected character '${ch}'`, { pos: i });
        }
        tokens.push({ kind: 'op', text: op, value: 0, pos: i, end: i + op.length });
        i += op.length;
    }
    tokens.push({ kind: 'end', text: '', value: 0, pos: n, end: n });
    return tokens;
}

// --------------------------------------------------------------------- AST

export type CmpOp = '<' | '<=' | '>' | '>=' | '==' | '!=';
export type ArithOp = '+' | '-' | '*' | '/' | '%' | '^';

/** Source span [s, e) of a node (parentheses around it included). */
interface Span {
    s: number;
    e: number;
}

export interface NumNode extends Span {
    t: 'num';
    value: number;
    raw: string;
}

export interface NameNode extends Span {
    t: 'name';
    name: string;
}

/** `Math.PI` and friends (a `Math.` member that is not called). */
export interface MemberNode extends Span {
    t: 'member';
    name: string;
}

/**
 * `name(args)`. Whether this is a call or an implicit multiplication
 * (`a(x + 1)` with a slider a) is decided at compile time from the Env.
 */
export interface CallNode extends Span {
    t: 'call';
    name: string;
    /** Written as `Math.name(...)`. */
    math: boolean;
    args: Node[];
    /** Span of the name itself (for rename / quick-fix rewrites). */
    ns: number;
    ne: number;
    /** Position of the '(' that opens the argument list (set by the parser). */
    open?: number;
}

export interface UnaryNode extends Span {
    t: 'unary';
    op: '-' | '+' | '!';
    arg: Node;
}

export interface BinaryNode extends Span {
    t: 'binary';
    op: ArithOp;
    left: Node;
    right: Node;
    /** Multiplication written by juxtaposition (2x). */
    implicit?: boolean;
    /** Top-level `lhs = rhs` of an equation, stored as lhs - rhs. */
    equation?: boolean;
}

/** Comparison chain: args[0] ops[0] args[1] ops[1] args[2] ... (AND of the pairs). */
export interface CmpNode extends Span {
    t: 'cmp';
    ops: CmpOp[];
    args: Node[];
}

export interface LogicNode extends Span {
    t: 'logic';
    op: '&&' | '||';
    left: Node;
    right: Node;
}

export interface TernaryNode extends Span {
    t: 'ternary';
    test: Node;
    then: Node;
    else: Node;
}

export type Node = NumNode | NameNode | MemberNode | CallNode | UnaryNode | BinaryNode | CmpNode | LogicNode | TernaryNode;

/** One entry of a points list: a parenthesised tuple, or (paths only) a points-tool name. */
export type TupleItem =
    | { kind: 'tuple'; items: Node[]; s: number; e: number }
    | { kind: 'name'; name: string; s: number; e: number };

/**
 * 'expr': one expression. 'cond': region condition entry, where top-level
 * `,` and `;` also mean AND and bind loosest (`x <= 1 or x >= 3, y >= 0`
 * is `(x <= 1 or x >= 3) and y >= 0`). 'eq': optional single `lhs = rhs`.
 */
export type ParseMode = 'expr' | 'cond' | 'eq';

// ------------------------------------------------------------------ parser

const CMP_OPS: Record<string, CmpOp> = {
    '<': '<', '<=': '<=', '>': '>', '>=': '>=', '==': '==', '===': '==', '!=': '!=', '!==': '!=',
};

class Parser {
    private i = 0;

    constructor(private toks: Token[], private mode: ParseMode) {}

    private peek(): Token {
        return this.toks[this.i];
    }

    private next(): Token {
        return this.toks[this.i++];
    }

    private isOp(text: string): boolean {
        const t = this.toks[this.i];
        return t.kind === 'op' && t.text === text;
    }

    private isWord(word: string): boolean {
        const t = this.toks[this.i];
        return t.kind === 'id' && t.text === word;
    }

    private eatOp(text: string): boolean {
        if (this.isOp(text)) {
            this.i++;
            return true;
        }
        return false;
    }

    atEnd(): boolean {
        return this.peek().kind === 'end';
    }

    /** Throw a positioned error for the token at hand. */
    fail(t: Token = this.peek()): never {
        if (t.kind === 'end') throw new ExprError('Unexpected end of expression', { pos: t.pos });
        if (t.kind === 'op' && t.text === '=') {
            if (this.mode === 'cond') {
                throw new ExprError('Use <= or >= in a condition, not =', { pos: t.pos });
            }
            if (this.mode === 'eq') {
                throw new ExprError('An equation has only one =', { pos: t.pos });
            }
            throw new ExprError('Use == to compare (= is only for equations)', { pos: t.pos });
        }
        throw new ExprError(`Unexpected '${t.text}'`, { pos: t.pos });
    }

    private expectClose(open: Token): Token {
        const t = this.peek();
        if (t.kind === 'op' && t.text === ')') {
            this.i++;
            return t;
        }
        if (t.kind === 'end') throw new ExprError("Missing ')'", { pos: open.pos });
        return this.fail(t);
    }

    /** Whole source in the parser's mode. */
    parseTop(): Node {
        if (this.atEnd()) throw new ExprError('Enter an expression', { pos: 0 });
        let node: Node;
        if (this.mode === 'cond') {
            node = this.ternary();
            while (this.eatOp(',') || this.eatOp(';')) {
                // A trailing separator ('x >= 0,') is harmless.
                if (this.atEnd()) break;
                const right = this.ternary();
                node = { t: 'logic', op: '&&', left: node, right, s: node.s, e: right.e };
            }
        } else if (this.mode === 'eq') {
            const left = this.ternary();
            if (this.eatOp('=')) {
                const right = this.ternary();
                node = { t: 'binary', op: '-', left, right, equation: true, s: left.s, e: right.e };
            } else if (left.t === 'cmp' && left.ops.length === 1 && left.ops[0] === '==') {
                // `x^2 + y^2 == 4` reads as an equation too.
                node = { t: 'binary', op: '-', left: left.args[0], right: left.args[1], equation: true, s: left.s, e: left.e };
            } else {
                node = left;
            }
        } else {
            node = this.ternary();
        }
        if (!this.atEnd()) this.fail();
        return node;
    }

    /** Comma list (values / levels). Empty source -> []. */
    parseList(): Node[] {
        const out: Node[] = [];
        if (this.atEnd()) return out;
        for (;;) {
            out.push(this.ternary());
            if (this.eatOp(',')) continue;
            if (this.atEnd()) return out;
            this.fail();
        }
    }

    /** `(x, y); (x, y)` (and bare names when `names`). Empty items are skipped. */
    parseTuples(names: boolean): TupleItem[] {
        const out: TupleItem[] = [];
        for (;;) {
            while (this.eatOp(';'));
            if (this.atEnd()) return out;
            const index = out.length;
            const t = this.peek();
            try {
                if (t.kind === 'op' && t.text === '(') {
                    this.i++;
                    const items: Node[] = [this.ternary()];
                    while (this.eatOp(',')) items.push(this.ternary());
                    const close = this.expectClose(t);
                    out.push({ kind: 'tuple', items, s: t.pos, e: close.end });
                } else if (names && t.kind === 'id' && this.isEntryEnd(1)) {
                    this.i++;
                    out.push({ kind: 'name', name: t.text, s: t.pos, e: t.end });
                } else {
                    throw new ExprError(names ? 'Write a point as (x, y) or a points tool name' : 'Write a point as (x, y)', {
                        pos: t.pos,
                    });
                }
                if (!this.atEnd() && !this.isOp(';')) {
                    throw new ExprError('Separate points with ;', { pos: this.peek().pos });
                }
            } catch (e) {
                if (e instanceof ExprError && e.index === undefined) e.index = index;
                throw e;
            }
        }
    }

    private isEntryEnd(ahead: number): boolean {
        const t = this.toks[this.i + ahead];
        return !t || t.kind === 'end' || (t.kind === 'op' && t.text === ';');
    }

    ternary(): Node {
        const test = this.or();
        if (!this.eatOp('?')) return test;
        const then = this.ternary();
        if (!this.eatOp(':')) {
            const t = this.peek();
            if (t.kind === 'end') throw new ExprError("Missing ':' in a ? b : c", { pos: t.pos });
            this.fail(t);
        }
        const otherwise = this.ternary();
        return { t: 'ternary', test, then, else: otherwise, s: test.s, e: otherwise.e };
    }

    private or(): Node {
        let left = this.and();
        while (this.eatOp('||') || this.eatWord('or')) {
            const right = this.and();
            left = { t: 'logic', op: '||', left, right, s: left.s, e: right.e };
        }
        return left;
    }

    private and(): Node {
        let left = this.cmp();
        while (this.eatOp('&&') || this.eatWord('and')) {
            const right = this.cmp();
            left = { t: 'logic', op: '&&', left, right, s: left.s, e: right.e };
        }
        return left;
    }

    private eatWord(word: string): boolean {
        if (this.isWord(word)) {
            this.i++;
            return true;
        }
        return false;
    }

    private cmp(): Node {
        const first = this.add();
        let ops: CmpOp[] | null = null;
        let args: Node[] | null = null;
        for (;;) {
            const t = this.peek();
            const op = t.kind === 'op' ? own(CMP_OPS, t.text) : undefined;
            if (op === undefined) break;
            this.i++;
            if (!ops || !args) {
                ops = [];
                args = [first];
            }
            ops.push(op);
            args.push(this.add());
        }
        if (!ops || !args) return first;
        return { t: 'cmp', ops, args, s: first.s, e: args[args.length - 1].e };
    }

    private add(): Node {
        let left = this.mul();
        for (;;) {
            const t = this.peek();
            if (t.kind !== 'op' || (t.text !== '+' && t.text !== '-')) return left;
            this.i++;
            const right = this.mul();
            left = { t: 'binary', op: t.text, left, right, s: left.s, e: right.e };
        }
    }

    private mul(): Node {
        let left = this.unary();
        for (;;) {
            const t = this.peek();
            if (t.kind === 'op' && (t.text === '*' || t.text === '/' || t.text === '%')) {
                this.i++;
                const right = this.unary();
                left = { t: 'binary', op: t.text, left, right, s: left.s, e: right.e };
            } else if (startsPrimary(t)) {
                // `1..5`, `1.2.3`, `x.5`, `f(x).5`: a '.'-led number glued to the
                // previous operand is a typo, not a product (`3 .5` still is one).
                const prev = this.toks[this.i - 1];
                if (t.kind === 'num' && t.text[0] === '.' && prev && prev.end === t.pos) {
                    throw new ExprError("Unexpected '.': write one decimal point per number, or * to multiply", { pos: t.pos });
                }
                const right = this.unary();
                left = { t: 'binary', op: '*', left, right, implicit: true, s: left.s, e: right.e };
            } else {
                return left;
            }
        }
    }

    private unary(): Node {
        const t = this.peek();
        if (t.kind === 'op' && (t.text === '-' || t.text === '+' || t.text === '!')) {
            this.i++;
            const arg = this.unary();
            return { t: 'unary', op: t.text, arg, s: t.pos, e: arg.e };
        }
        return this.pow();
    }

    private pow(): Node {
        const base = this.primary();
        if (this.eatOp('^') || this.eatOp('**')) {
            // Right-associative; unary on the right allows `2^-x`.
            const exponent = this.unary();
            return { t: 'binary', op: '^', left: base, right: exponent, s: base.s, e: exponent.e };
        }
        return base;
    }

    private args(open: Token): Node[] {
        const args: Node[] = [];
        if (this.isOp(')')) {
            this.i++;
            return args;
        }
        args.push(this.ternary());
        while (this.eatOp(',')) args.push(this.ternary());
        this.expectClose(open);
        return args;
    }

    private primary(): Node {
        const t = this.next();
        if (t.kind === 'num') {
            return { t: 'num', value: t.value, raw: t.text, s: t.pos, e: t.end };
        }
        if (t.kind === 'op' && t.text === '(') {
            const inner = this.ternary();
            const close = this.expectClose(t);
            // Widen the span so source slices keep the parentheses.
            return { ...inner, s: t.pos, e: close.end };
        }
        if (t.kind === 'id') {
            if (t.text === 'and' || t.text === 'or') this.fail(t);
            if (t.text === 'Math' && this.isOp('.')) {
                this.i++;
                const member = this.next();
                if (member.kind !== 'id') {
                    throw new ExprError("Expected a name after 'Math.'", { pos: member.pos });
                }
                if (this.isOp('(')) {
                    const open = this.next();
                    const args = this.args(open);
                    return {
                        t: 'call', name: member.text, math: true, args,
                        ns: t.pos, ne: member.end, open: open.pos, s: t.pos, e: this.toks[this.i - 1].end,
                    };
                }
                return { t: 'member', name: member.text, s: t.pos, e: member.end };
            }
            if (this.isOp('(')) {
                const open = this.next();
                const args = this.args(open);
                return {
                    t: 'call', name: t.text, math: false, args,
                    ns: t.pos, ne: t.end, open: open.pos, s: t.pos, e: this.toks[this.i - 1].end,
                };
            }
            return { t: 'name', name: t.text, s: t.pos, e: t.end };
        }
        if (t.kind === 'op' && t.text === ')') {
            throw new ExprError("Unexpected ')'", { pos: t.pos });
        }
        return this.fail(t);
    }
}

function startsPrimary(t: Token): boolean {
    if (t.kind === 'num') return true;
    if (t.kind === 'id') return t.text !== 'and' && t.text !== 'or';
    return t.kind === 'op' && t.text === '(';
}

// ------------------------------------------------------------- LRU caches

/** Tiny LRU on top of Map insertion order. */
export class Lru<K, V> {
    private map = new Map<K, V>();

    constructor(private max: number) {}

    get(key: K): V | undefined {
        const v = this.map.get(key);
        if (v !== undefined) {
            this.map.delete(key);
            this.map.set(key, v);
        }
        return v;
    }

    set(key: K, value: V): void {
        this.map.delete(key);
        this.map.set(key, value);
        while (this.map.size > this.max) {
            const oldest = this.map.keys().next();
            if (oldest.done) break;
            this.map.delete(oldest.value);
        }
    }

    get size(): number {
        return this.map.size;
    }

    clear(): void {
        this.map.clear();
    }
}

type Parsed = Node | Node[] | TupleItem[] | ExprError;

/** Module-level cache of parse results keyed by mode + source (scope-free, safe to share). */
const PARSE_CACHE = new Lru<string, Parsed>(1024);

function cachedParse<T extends Parsed>(key: string, run: () => T): T {
    const hit = PARSE_CACHE.get(key);
    if (hit !== undefined) {
        if (hit instanceof ExprError) throw hit;
        return hit as T;
    }
    try {
        const out = run();
        PARSE_CACHE.set(key, out);
        return out;
    } catch (e) {
        if (e instanceof ExprError) PARSE_CACHE.set(key, e);
        throw e;
    }
}

/** Parse one source. Cached; throws ExprError (the cached instance: copy before changing it). */
export function parse(src: string, mode: ParseMode = 'expr'): Node {
    return cachedParse(mode + '\u0000' + src, () => new Parser(tokenize(src), mode).parseTop());
}

/** Comma-separated list of expressions ('' -> []). */
export function parseList(src: string): Node[] {
    return cachedParse('list\u0000' + src, () => new Parser(tokenize(src), 'expr').parseList());
}

/** `;`-separated tuples; with `names`, bare identifiers (points tool names) are entries too. */
export function parseTuples(src: string, names: boolean): TupleItem[] {
    return cachedParse((names ? 'path' : 'tuples') + '\u0000' + src, () =>
        new Parser(tokenize(src), 'expr').parseTuples(names)
    );
}

/**
 * Index of the depth-0 ':' that is not part of a ternary (`a:b`,
 * `x > 0 ? 1 : 2 : 5`), or -1. Null when `src` does not tokenize.
 */
export function topLevelColon(src: string): number | null {
    let tokens: Token[];
    try {
        tokens = tokenize(src);
    } catch {
        return null;
    }
    let depth = 0;
    let pending = 0;
    for (const t of tokens) {
        if (t.kind !== 'op') continue;
        if (t.text === '(') depth++;
        else if (t.text === ')') depth--;
        else if (depth === 0 && t.text === '?') pending++;
        else if (depth === 0 && t.text === ':') {
            if (pending > 0) pending--;
            else return t.pos;
        }
    }
    return -1;
}

/**
 * Split 'a:b' at the depth-0 ':' that does not close a ternary, on the raw
 * text (it need not tokenize). Null unless there is exactly one such ':'
 * with text on both sides. Shared by the 3.x migration and the function
 * cards' domain summary; MathContext reads domains with topLevelColon.
 */
export function splitDomain(src: string): [string, string] | null {
    let depth = 0;
    let ternaries = 0;
    let at = -1;
    for (let i = 0; i < src.length; i++) {
        const c = src[i];
        if (c === '(') depth++;
        else if (c === ')') depth--;
        else if (depth === 0 && c === '?') ternaries++;
        else if (depth === 0 && c === ':') {
            if (ternaries > 0) {
                ternaries--;
            } else if (at >= 0) {
                return null;
            } else {
                at = i;
            }
        }
    }
    if (at < 0) return null;
    const lo = src.slice(0, at).trim();
    const hi = src.slice(at + 1).trim();
    return lo && hi ? [lo, hi] : null;
}

// ---------------------------------------------------------------- templates

export type TemplatePart =
    | { kind: 'text'; text: string }
    /** `{expr}` or `{expr:n}`; `offset` = index of expr in the template. */
    | { kind: 'expr'; expr: string; offset: number; decimals: number | null };

export interface ScannedTemplate {
    parts: TemplatePart[];
    /** First structural problem (unclosed '{'), reported by validation; rendering degrades gracefully. */
    error?: { message: string; pos: number };
}

const TEMPLATE_CACHE = new Lru<string, ScannedTemplate>(256);

/**
 * Math opened by the `$` at `src[i]`, read the way Pandoc and Obsidian do:
 * `$$...$$`, or `$...$` where the opening `$` is not followed by
 * whitespace and the closing one is not preceded by whitespace, so prices
 * ('$5 and $10', 'Revenue ($)') stay text. A span that starts with a digit
 * does not close right before another digit either ('$5-$10'); other spans
 * may (`$\$$5`, the dollar sign migrated 3.x labels use).
 * `\x` pairs never open or close math (`\$` is an escaped dollar sign).
 * Returns the index of the closing delimiter and the index just past it,
 * or null when this `$` is a literal dollar sign. Shared by the template
 * scanner and the label escaping in src/mathcontext.ts.
 */
export function dollarMath(src: string, i: number): { close: number; end: number } | null {
    if (src[i] !== '$') return null;
    if (src[i + 1] === '$') {
        for (let j = i + 2; j < src.length; j++) {
            if (src[j] === '\\') {
                j++;
                continue;
            }
            if (src[j] === '$' && src[j + 1] === '$') return j > i + 2 ? { close: j, end: j + 2 } : null;
        }
        return null;
    }
    const first = src[i + 1];
    if (first === undefined || /\s/.test(first)) return null;
    for (let j = i + 1; j < src.length; j++) {
        const ch = src[j];
        if (ch === '\\') {
            j++;
            continue;
        }
        if (ch !== '$' || /\s/.test(src[j - 1])) continue;
        if (/\d/.test(first) && /\d/.test(src[j + 1] ?? '')) continue;
        return { close: j, end: j + 1 };
    }
    return null;
}

/**
 * Split a label template into text and placeholders. `{{` / `}}` are
 * literal braces. Inside `$...$` / `\(...\)` math (see dollarMath), a
 * brace group that belongs to LaTeX is kept verbatim: one right after
 * `^`, `_`, `]`, a LaTeX group's `}`, or a `\command` that takes an
 * argument (`x^{2}`, `\frac{a}{b}`, `\mathbf{x}`). Outside math only the
 * last two count (`\textbf{A}`, `\textcolor{red}{x}`). Any other `{...}`
 * is a placeholder, so `$z = {c}$`, `${w}{h}$`, `$A = {w}\cdot{h}$` and
 * `x_{a}` still interpolate. A value cannot go inside a LaTeX group
 * (`x^{{a}}` stays verbatim).
 */
export function scanTemplate(src: string): ScannedTemplate {
    const hit = TEMPLATE_CACHE.get(src);
    if (hit) return hit;
    const parts: TemplatePart[] = [];
    let error: ScannedTemplate['error'];
    let text = '';
    let math: '' | '$' | '(' = '';
    /** While math === '$': where the closing `$` / `$$` starts and ends. */
    let mathClose = -1;
    let mathEnd = -1;
    /** Index just past the last placeholder's `}` (that brace is not a LaTeX group). */
    let placeholderEnd = -1;
    /** Index just past the last LaTeX group kept verbatim (a group may follow it: `\textcolor{red}{x}`). */
    let groupEnd = -1;
    const n = src.length;
    let i = 0;
    const flush = () => {
        if (text) parts.push({ kind: 'text', text });
        text = '';
    };
    while (i < n) {
        if (math === '$' && i >= mathClose) {
            if (i === mathClose) {
                text += src.slice(i, mathEnd);
                i = mathEnd;
            }
            math = '';
            continue;
        }
        const ch = src[i];
        if (ch === '\\' && i + 1 < n) {
            const nx = src[i + 1];
            if (!math && nx === '(') math = '(';
            else if (math === '(' && nx === ')') math = '';
            text += ch + nx;
            i += 2;
            continue;
        }
        if (ch === '$' && !math) {
            const m = dollarMath(src, i);
            const open = m && src[i + 1] === '$' ? 2 : 1;
            if (m) {
                math = '$';
                mathClose = m.close;
                mathEnd = m.end;
            }
            text += src.slice(i, i + open);
            i += open;
            continue;
        }
        if (ch === '{') {
            if (src[i + 1] === '{' && !math) {
                text += '{';
                i += 2;
                continue;
            }
            if (math ? isLatexGroup(src, i, placeholderEnd) : i === groupEnd || isCommandArgument(src, i)) {
                const close = matchingBrace(src, i);
                const end = close < 0 ? n : close + 1;
                text += src.slice(i, end);
                i = end;
                groupEnd = end;
                continue;
            }
            const close = src.indexOf('}', i + 1);
            if (close < 0) {
                if (!error) error = { message: "Missing '}' in the label", pos: i };
                text += src.slice(i);
                break;
            }
            flush();
            const inner = src.slice(i + 1, close);
            const colon = topLevelColon(inner);
            let expr = inner;
            let decimals: number | null = null;
            if (colon !== null && colon >= 0) {
                const digits = inner.slice(colon + 1).trim();
                if (/^\d+$/.test(digits)) {
                    expr = inner.slice(0, colon);
                    decimals = Math.min(12, Number(digits));
                }
            }
            parts.push({ kind: 'expr', expr, offset: i + 1, decimals });
            i = close + 1;
            placeholderEnd = i;
            continue;
        }
        if (ch === '}' && src[i + 1] === '}' && !math) {
            text += '}';
            i += 2;
            continue;
        }
        text += ch;
        i++;
    }
    flush();
    const out: ScannedTemplate = { parts, error };
    TEMPLATE_CACHE.set(src, out);
    return out;
}

/**
 * Common LaTeX commands that take no argument: a brace right after them
 * (`\cdot{h}`, `\approx{v}`) is a placeholder, not their argument. Any
 * other command (`\frac`, `\mathbf`, `\mathcal`, user macros) is assumed
 * to take the group that follows it.
 */
const NO_ARG_COMMANDS = new Set([
    // operators and relations
    'cdot', 'times', 'div', 'pm', 'mp', 'ast', 'star', 'approx', 'sim', 'simeq', 'equiv', 'cong', 'propto',
    'le', 'leq', 'ge', 'geq', 'ne', 'neq', 'll', 'gg',
    // arrows
    'to', 'rightarrow', 'leftarrow', 'Rightarrow', 'Leftarrow', 'leftrightarrow', 'Leftrightarrow',
    'implies', 'iff', 'mapsto', 'uparrow', 'downarrow',
    // sets and logic
    'in', 'notin', 'subset', 'subseteq', 'supset', 'supseteq', 'cup', 'cap', 'setminus', 'emptyset',
    'forall', 'exists', 'neg', 'land', 'lor', 'wedge', 'vee',
    // dots and spacing
    'infty', 'cdots', 'ldots', 'dots', 'vdots', 'ddots', 'quad', 'qquad', 'colon', 'mid',
    // other symbols
    'parallel', 'perp', 'angle', 'circ', 'bullet', 'partial', 'nabla', 'prime',
    // big operators and function names
    'sum', 'prod', 'int', 'oint', 'lim', 'max', 'min', 'sup', 'inf', 'arg',
    'sin', 'cos', 'tan', 'cot', 'sec', 'csc', 'arcsin', 'arccos', 'arctan', 'sinh', 'cosh', 'tanh',
    'log', 'ln', 'exp', 'det', 'deg', 'gcd',
    // Greek letters
    ...Array.from(GREEK),
]);

/** The `{` at `src[i]` (inside math) starts a LaTeX group rather than a placeholder. */
function isLatexGroup(src: string, i: number, placeholderEnd: number): boolean {
    // `${w}{h}$`: the brace before this one closed a placeholder.
    if (i === placeholderEnd) return false;
    const prev = src[i - 1];
    if (prev === '^' || prev === '_' || prev === '}' || prev === ']') return true;
    return isCommandArgument(src, i);
}

/** The `{` at `src[i]` directly follows a `\command` that takes an argument (`\textbf{`, `\frac{`). */
function isCommandArgument(src: string, i: number): boolean {
    let j = i - 1;
    while (j >= 0 && /[A-Za-z]/.test(src[j])) j--;
    return j < i - 1 && j >= 0 && src[j] === '\\' && !NO_ARG_COMMANDS.has(src.slice(j + 1, i));
}

/** Index of the `}` matching the `{` at `src[open]` (`\x` pairs skipped), or -1. */
export function matchingBrace(src: string, open: number): number {
    let depth = 0;
    for (let i = open; i < src.length; i++) {
        const ch = src[i];
        if (ch === '\\') {
            i++;
            continue;
        }
        if (ch === '{') depth++;
        else if (ch === '}') {
            depth--;
            if (depth === 0) return i;
        }
    }
    return -1;
}

// --------------------------------------------------------------- environment

export type Compiled = (a: number, b: number) => number;

/** A value read at call time: slider, derived name (P1_x) or template local. */
export interface Scalar {
    read: () => number;
    kind: 'param' | 'derived' | 'local';
}

/** A user function as seen by expressions that call it. */
export interface FnRef {
    name: string;
    kind: 'cartesian' | 'parametric' | 'polar';
    /** Compile-time problem (parse error, unknown name, cycle, ...); callers then fail with 'depends on'. */
    error?: string;
    /** Domain-checked evaluation; NaN outside the domain; never throws. */
    call: (u: number) => number;
    /** Body AST and the Env it resolves in (inlining for pgf, affine forms). */
    body: Node | null;
    env: Env | null;
    /** The domain field is empty (follow the view). */
    domainEmpty: boolean;
    /** Current numeric domain: null = none, 'invalid' = the domain does not resolve. */
    domain(): [number, number] | null | 'invalid';
}

/** Name resolution for one kind of field. Built and cached by MathContext. */
export interface Env {
    /** vars[i]: names that mean argument i of the compiled closure. */
    vars: ReadonlyArray<ReadonlyArray<string>>;
    scalar(name: string): Scalar | null;
    fn(name: string): FnRef | null;
    /** Message when a bare user-function name is not allowed here; null = it means f(vars[0][0]). */
    bareFnError(name: string): string | null;
    /** Message for names that exist but cannot be used here (rule 3, tool names), else null. */
    notHere(name: string): string | null;
    /** Names that must never get an 'Add slider' offer (beyond reserved names). */
    noSlider(name: string): boolean;
    /** Axis variables are still the default x, y (quick-fix rule 4). */
    defaultVars: boolean;
    /** Names usable as parts when splitting an unknown name ('ax' -> a*x). */
    knownNames(): string[];
    /** Callable user-function names (suggestions). */
    fnNames(): string[];
}

type Resolution =
    | { k: 'var'; index: number }
    | { k: 'scalar'; s: Scalar }
    | { k: 'const'; value: number }
    | { k: 'fn'; ref: FnRef };

function resolveName(name: string, env: Env): Resolution | null {
    for (let i = 0; i < env.vars.length; i++) {
        if (env.vars[i].includes(name)) return { k: 'var', index: i };
    }
    const s = env.scalar(name);
    if (s) return { k: 'scalar', s };
    const ref = env.fn(name);
    if (ref) return { k: 'fn', ref };
    const c = own(CONSTANTS, name);
    if (c !== undefined) return { k: 'const', value: c };
    return null;
}

/** What `name(args)` means in `env`. */
type CallTarget =
    | { k: 'builtin'; b: Builtin; name: string }
    | { k: 'fn'; ref: FnRef }
    | { k: 'mul'; res: Resolution };

function resolveCall(node: CallNode, env: Env, src: string): CallTarget {
    if (node.math) {
        const b = own(MATH_FUNCTIONS, node.name);
        if (!b) throw unknownFunction(node, env, src);
        return { k: 'builtin', b, name: node.name };
    }
    const b = own(BUILTINS, node.name);
    if (b) return { k: 'builtin', b, name: node.name };
    const res = resolveName(node.name, env);
    if (res && res.k === 'fn') return { k: 'fn', ref: res.ref };
    if (res) {
        if (node.args.length !== 1) {
            throw new ExprError(`'${node.name}' is not a function`, { pos: node.ns });
        }
        return { k: 'mul', res };
    }
    throw unknownFunction(node, env, src);
}

/**
 * `node` is written like a call but compiles as implicit multiplication in
 * `env` (`a(x + 1)` with a slider, variable, constant or derived name a).
 * Same decision as resolveCall, without throwing: unknown names, builtins,
 * user functions and calls with more than one argument are not products.
 */
function isImplicitCall(node: CallNode, env: Env): boolean {
    if (node.math || node.args.length !== 1 || own(BUILTINS, node.name) !== undefined) return false;
    const res = resolveName(node.name, env);
    return !!res && res.k !== 'fn';
}

/**
 * Phase 0 precedence fix. `name(A)^E` written without parentheses around
 * `name(A)`, where the call is an implicit multiplication, means
 * name * (A^E), exactly like `2(x - 1)^2` = 2 * ((x - 1)^2): the power binds
 * tighter than the juxtaposition (`a(x - h)^2` is a parabola, not
 * a^2 (x - h)^2). `(a(x - h))^2` keeps squaring the product. Returns the
 * call when the rule applies to the power node `n`, else null. A is
 * parenthesized by the call, so A^E never splits again (`a(b(x))^2` is
 * a * (b x)^2). Used by the compiler, the affine planner, the pgf printer
 * and normalizeImplicitCalls, so all of them agree.
 */
function implicitPowerBase(n: BinaryNode, env: Env): CallNode | null {
    const base = n.left;
    if (n.op !== '^' || base.t !== 'call' || base.s !== base.ns || !isImplicitCall(base, env)) return null;
    return base;
}

function checkArity(name: string, b: Builtin, count: number, pos: number): void {
    if (count >= b.min && count <= b.max) return;
    let need: string;
    if (b.min === b.max) need = b.min === 1 ? '1 argument' : `${b.min} arguments`;
    else need = `at least ${b.min} argument${b.min === 1 ? '' : 's'}`;
    throw new ExprError(`${name} takes ${need}`, { pos });
}

/** The callee may be called from here (not parametric, no error). */
function checkCallable(ref: FnRef, pos: number): void {
    if (ref.kind === 'parametric') {
        throw new ExprError(`${ref.name} is parametric and cannot be called`, { pos });
    }
    if (ref.error) {
        throw new ExprError(`depends on ${ref.name} (error)`, { pos });
    }
}

// ------------------------------------------------------------- quick fixes

/** Optimal-string-alignment distance (Levenshtein plus adjacent transpositions). */
export function editDistance(a: string, b: string): number {
    const m = a.length;
    const n = b.length;
    if (!m) return n;
    if (!n) return m;
    const d: number[][] = [];
    for (let i = 0; i <= m; i++) {
        d.push(new Array<number>(n + 1).fill(0));
        d[i][0] = i;
    }
    for (let j = 0; j <= n; j++) d[0][j] = j;
    for (let i = 1; i <= m; i++) {
        for (let j = 1; j <= n; j++) {
            const cost = a[i - 1] === b[j - 1] ? 0 : 1;
            let v = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost);
            if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
                v = Math.min(v, d[i - 2][j - 2] + 1);
            }
            d[i][j] = v;
        }
    }
    return d[m][n];
}

/** Closest candidate within edit distance 2 (1 for names of 1 or 2 characters), or null. */
export function closestName(name: string, candidates: Iterable<string>): string | null {
    const limit = name.length <= 2 ? 1 : 2;
    let best: string | null = null;
    let bestD = limit + 1;
    for (const c of candidates) {
        if (c === name) continue;
        const dist = editDistance(name.toLowerCase(), c.toLowerCase());
        if (dist < bestD) {
            best = c;
            bestD = dist;
        }
    }
    return best;
}

/**
 * Split an unknown identifier into known names and single letters
 * ('ax' -> ['a', 'x'] when x is a variable, 'pix' -> ['pi', 'x']). With
 * `lastIsFn` the last part must be a function name ('xsin' -> x, sin).
 * Accepted when every part is known, or when one new single letter is
 * paired with known parts ('ax' with only x known), or for two-letter
 * names ('ab'). Greek letter names are never split.
 */
export function splitName(
    name: string,
    known: readonly string[],
    isFn: (part: string) => boolean,
    lastIsFn: boolean
): string[] | null {
    if (name.length < 2 || GREEK.has(name) || !/^[A-Za-z][A-Za-z0-9]*$/.test(name)) return null;
    const knownSet = new Set(known.filter((k) => /^[A-Za-z][A-Za-z0-9]*$/.test(k) || k === 'π'));
    // best[i]: best split of name.slice(0, i) as [unknownLetters, parts, list].
    const n = name.length;
    const best: Array<{ unknown: number; strong: number; parts: string[] } | null> = Array.from({ length: n + 1 }, () => null);
    best[0] = { unknown: 0, strong: 0, parts: [] };
    for (let i = 0; i < n; i++) {
        const cur = best[i];
        if (!cur) continue;
        const consider = (part: string, isKnown: boolean) => {
            const j = i + part.length;
            if (j > n) return;
            if (lastIsFn && j === n && !isFn(part)) return;
            if (j < n && isFn(part) && !isKnownValue(part)) return;
            const strongPart = isKnown && part !== 'e' && part !== 'E';
            const cand = {
                unknown: cur.unknown + (isKnown ? 0 : 1),
                strong: cur.strong + (strongPart ? 1 : 0),
                parts: cur.parts.concat(part),
            };
            const old = best[j];
            if (
                !old ||
                cand.unknown < old.unknown ||
                (cand.unknown === old.unknown && cand.parts.length < old.parts.length)
            ) {
                best[j] = cand;
            }
        };
        for (const k of knownSet) {
            if (name.startsWith(k, i)) consider(k, true);
        }
        for (const f of BUILTIN_FUNCTION_NAMES) {
            if (lastIsFn && name.startsWith(f, i) && i + f.length === n) consider(f, true);
        }
        const ch = name[i];
        if (/[A-Za-z]/.test(ch) && !knownSet.has(ch)) consider(ch, false);
    }
    const res = best[n];
    if (!res || res.parts.length < 2) return null;
    function isKnownValue(part: string): boolean {
        return knownSet.has(part) && !isFn(part);
    }
    if (res.unknown === 0) return res.parts;
    if (lastIsFn) return null;
    if (res.unknown === 1 && res.strong >= 1) return res.parts;
    if (n === 2 && res.unknown === 2) return res.parts;
    return null;
}

function rewrite(src: string, s: number, e: number, text: string): string {
    return src.slice(0, s) + text + src.slice(e);
}

/** One-argument builtins, longest first so `sinh` beats `sin` and `log10` beats `log`. */
const CALL_SPLIT_FUNCTIONS = BUILTIN_FUNCTION_NAMES.filter((f) => {
    const b = own(BUILTINS, f);
    return b !== undefined && b.min === 1 && b.max === 1;
}).sort((a, b) => b.length - a.length);

/** Longest name splitCall tries (keeps the search cheap on pasted junk). */
const MAX_CALL_SPLIT = 24;

/**
 * Read an unknown name as one-argument builtins written without
 * parentheses: 'sinx' -> 'sin(x)', 'sin2x' -> 'sin(2*x)', 'sinax' ->
 * 'sin(a*x)', 'xsinx' -> 'x*sin(x)', 'sinxcosx' -> 'sin(x)*cos(x)'. Every
 * other part must be a known value (a variable usable here, a slider, a
 * constant) or a product of those; otherwise null, so 'cost' without t,
 * 'minx' and 'sinq' stay slider candidates.
 */
function splitCall(name: string, known: readonly string[], isFn: (part: string) => boolean): string | null {
    if (name.length > MAX_CALL_SPLIT || GREEK.has(name) || !/^[A-Za-z][A-Za-z0-9]*$/.test(name)) return null;
    const value = (part: string): string | null => {
        if (!part) return null;
        if (known.includes(part) && !isFn(part)) return part;
        const parts = splitName(part, known, isFn, false);
        return parts && parts.every((p) => known.includes(p) && !isFn(p)) ? parts.join('*') : null;
    };
    // An argument is an optional leading number times a value ('2x' -> 2*x).
    const arg = (part: string): string | null => {
        const digits = /^\d*/.exec(part)?.[0] ?? '';
        const v = value(part.slice(digits.length));
        if (v === null) return null;
        return digits ? `${digits}*${v}` : v;
    };
    const walk = (s: string): string | null => {
        for (let i = 0; i < s.length; i++) {
            const head = i > 0 ? value(s.slice(0, i)) : '';
            if (head === null) continue;
            for (const f of CALL_SPLIT_FUNCTIONS) {
                if (!s.startsWith(f, i)) continue;
                const tail = s.slice(i + f.length);
                // Longest argument first: 'sinax' is sin(a*x), not sin(a)*x.
                for (let j = tail.length; j > 0; j--) {
                    const a = arg(tail.slice(0, j));
                    if (a === null) continue;
                    const rest = j < tail.length ? walk(tail.slice(j)) : '';
                    if (rest === null) continue;
                    return [head, `${f}(${a})`, rest].filter((p) => p !== '').join('*');
                }
            }
        }
        return null;
    };
    return walk(name);
}

/**
 * `ax(x + 1)` with slider a and variable x: the callee splits into values,
 * so the call is a product (`a*x(x + 1)`, which resolveCall reads as
 * multiplication). Null when the name does not split that way, or when a
 * part is not usable in this field. `byVar`: the last part is an axis
 * variable, which makes the product the likely intent even when a builtin
 * is one edit away ('ax' vs 'max').
 */
function valueSplit(
    node: CallNode,
    env: Env,
    src: string,
    message: string,
    isFn: (part: string) => boolean,
    fnNames: string[]
): { err: ExprError; byVar: boolean } | null {
    // A product takes exactly one argument (the 'mul' call target).
    if (node.args.length !== 1) return null;
    const known = env.knownNames();
    const parts = splitName(node.name, known.concat(fnNames), isFn, false);
    // `ex(` stays exp(...) and `xsin(` stays x*sin(...).
    if (!parts || parts.some((p) => p === 'e' || p === 'E' || isFn(p) || env.notHere(p) !== null)) return null;
    const last = parts[parts.length - 1];
    // The last part is the callee: if it were unknown too, `a*b(x)` would still be an unknown call.
    if (!known.includes(last)) return null;
    const fresh = parts.filter((p) => !known.includes(p));
    if (fresh.length > 1) return null;
    const joined = parts.join('*');
    const fix: IssueFix = { label: `Use ${joined}`, rewrite: rewrite(src, node.ns, node.ne, joined) };
    const letter = fresh.length === 1 ? fresh[0] : null;
    if (letter && !isReservedName(letter) && !env.noSlider(letter)) {
        fix.label = `Use ${joined}, add slider ${letter}`;
        fix.addParameter = letter;
    }
    return {
        err: new ExprError(`${message}. Did you mean ${joined}?`, { pos: node.ns, fix }),
        byVar: env.vars.some((v) => v.includes(last)),
    };
}

function unknownFunction(node: CallNode, env: Env, src: string): ExprError {
    const label = node.math ? `Math.${node.name}` : node.name;
    const pos = node.ns;
    const message = `Unknown function '${label}'`;
    if (node.math) {
        const sug = closestName(node.name, Object.keys(MATH_FUNCTIONS));
        if (!sug) return new ExprError(message, { pos });
        return new ExprError(message, {
            pos,
            fix: { label: `Use Math.${sug}`, rewrite: rewrite(src, node.ns, node.ne, `Math.${sug}`) },
        });
    }
    const notHere = env.notHere(node.name);
    if (notHere) return new ExprError(notHere, { pos });
    const fnNames = env.fnNames();
    const isFn = (p: string) => own(BUILTINS, p) !== undefined || fnNames.includes(p);
    const parts = splitName(node.name, env.knownNames().concat(fnNames), isFn, true);
    if (parts) {
        const joined = parts.join('*');
        return new ExprError(`${message}. Did you mean ${joined}?`, {
            pos,
            fix: { label: `Use ${joined}`, rewrite: rewrite(src, node.ns, node.ne, joined) },
        });
    }
    // 'ax(x - 2)' is a factored parabola, not max(x - 2).
    const product = valueSplit(node, env, src, message, isFn, fnNames);
    if (product && product.byVar) return product.err;
    const sug = closestName(node.name, BUILTIN_FUNCTION_NAMES.concat(fnNames));
    if (sug) {
        return new ExprError(message, {
            pos,
            fix: { label: `Use ${sug}`, rewrite: rewrite(src, node.ns, node.ne, sug) },
        });
    }
    if (product) return product.err;
    return new ExprError(message, { pos });
}

/**
 * `sin x`: a builtin used as a value. When a simple operand follows ('x',
 * '2x', 'pi', '3') and nothing binds tighter after it, offer `sin(x)`.
 */
function builtinAsName(name: string, s: number, e: number, src: string): ExprError {
    const message = `${name} is a function: write ${name}(...)`;
    const m = /^(\s+)((?:\d+(?:\.\d+)?)?[A-Za-zπθ][A-Za-z0-9_]*|\d+(?:\.\d+)?)(?=\s*(?:$|[-+),;<>=!&|?:]))/.exec(src.slice(e));
    const operand = m ? m[2] : '';
    const word = /[A-Za-zπθ][A-Za-z0-9_]*$/.exec(operand)?.[0] ?? '';
    if (!m || word === 'and' || word === 'or' || own(BUILTINS, word) !== undefined) return new ExprError(message, { pos: s });
    const call = `${name}(${operand})`;
    return new ExprError(message, {
        pos: s,
        fix: { label: `Use ${call}`, rewrite: rewrite(src, s, e + m[1].length + operand.length, call) },
    });
}

function unknownName(name: string, s: number, e: number, env: Env, src: string): ExprError {
    // The span of a parenthesised name includes its parentheses: rewrite only the name ('(ax)^2').
    const at = src.indexOf(name, s);
    if (at >= 0 && at + name.length <= e) {
        s = at;
        e = at + name.length;
    }
    if (own(BUILTINS, name)) return builtinAsName(name, s, e, src);
    if (name === 'Math') return new ExprError("Write Math.name, e.g. Math.PI", { pos: s });
    const notHere = env.notHere(name);
    if (notHere) return new ExprError(notHere, { pos: s });
    const message = `Unknown name '${name}'`;
    const fnNames = env.fnNames();
    const known = env.knownNames();
    const isFnPart = (p: string) => own(BUILTINS, p) !== undefined || fnNames.includes(p);
    // 'sinx', '2sinx', 'sin2x': a builtin without parentheses, never a slider name.
    const call = splitCall(name, known, isFnPart);
    if (call) {
        return new ExprError(`${message}. Did you mean ${call}?`, {
            pos: s,
            fix: { label: `Use ${call}`, rewrite: rewrite(src, s, e, call) },
        });
    }
    const parts = splitName(name, known, isFnPart, false);
    if (parts) {
        // A split that needs a variable this field does not have ('xy' in f(x)) only trades one error for another.
        const blocked = parts.map((p) => env.notHere(p)).find((m) => m !== null);
        if (blocked) return new ExprError(`${message}. ${blocked}`, { pos: s });
        const joined = parts.join('*');
        const fix: IssueFix = { label: `Use ${joined}`, rewrite: rewrite(src, s, e, joined) };
        // One new letter ('cx' with only x known): create its slider in the same step.
        const fresh = parts.filter((p) => !known.includes(p));
        const letter = fresh.length === 1 ? fresh[0] : null;
        if (letter && !isReservedName(letter) && !env.noSlider(letter)) {
            fix.label = `Use ${joined}, add slider ${letter}`;
            fix.addParameter = letter;
        }
        return new ExprError(`${message}. Did you mean ${joined}?`, { pos: s, fix });
    }
    // LP-style x1, x2 while the axes are still x, y; only in fields that use variables
    // (x0, y0, x3 and value fields fall through to 'Add slider').
    const indexed = /^([xy])[12]$/.exec(name);
    if (indexed && env.defaultVars && env.vars.length > 0) {
        const letter = indexed[1];
        return new ExprError(`${message}. Set axis variables to ${letter}1, ${letter}2 in Chart > Axes?`, { pos: s });
    }
    if (isReservedName(name) || env.noSlider(name) || !IDENT_FULL_RE.test(name)) {
        return new ExprError(message, { pos: s });
    }
    return new ExprError(message, { pos: s, unknown: name, fix: { label: `Add slider ${name}`, addParameter: name } });
}

// ---------------------------------------------------------------- compiler

/** Compiled node: a closure plus what the compiler knows about it (for folding / fast paths). */
interface CNode {
    f: Compiled;
    /** 'k' = constant (value in v), 'x' = argument 0, 'y' = argument 1, 'd' = anything else. */
    k: 'k' | 'x' | 'y' | 'd';
    v: number;
}

const ARG0: Compiled = (a) => a;
const ARG1: Compiled = (_a, b) => b;

function konst(v: number): CNode {
    return { f: () => v, k: 'k', v };
}

function dyn(f: Compiled): CNode {
    return { f, k: 'd', v: NaN };
}

function applyArith(op: ArithOp, l: number, r: number): number {
    switch (op) {
        case '+':
            return l + r;
        case '-':
            return l - r;
        case '*':
            return l * r;
        case '/':
            return l / r;
        case '%':
            return l % r;
        default:
            return Math.pow(l, r);
    }
}

function compare(op: CmpOp, l: number, r: number): boolean {
    switch (op) {
        case '<':
            return l < r;
        case '<=':
            return l <= r;
        case '>':
            return l > r;
        case '>=':
            return l >= r;
        case '==':
            return l === r;
        default:
            return l !== r;
    }
}

/**
 * Arithmetic with fast paths for the shapes that dominate real input
 * (`x op k`, `k op x`, `f op k`, `k op f`). Values are bit-identical to the
 * generic path; only the number of closure hops changes.
 */
function arith(op: ArithOp, L: CNode, R: CNode): CNode {
    if (L.k === 'k' && R.k === 'k') return konst(applyArith(op, L.v, R.v));
    const l = L.f;
    const r = R.f;
    if (R.k === 'k') {
        const k = R.v;
        if (L.k === 'x') {
            switch (op) {
                case '+':
                    return dyn((a) => a + k);
                case '-':
                    return dyn((a) => a - k);
                case '*':
                    return dyn((a) => a * k);
                case '/':
                    return dyn((a) => a / k);
                case '%':
                    return dyn((a) => a % k);
                default:
                    return dyn((a) => Math.pow(a, k));
            }
        }
        switch (op) {
            case '+':
                return dyn((a, b) => l(a, b) + k);
            case '-':
                return dyn((a, b) => l(a, b) - k);
            case '*':
                return dyn((a, b) => l(a, b) * k);
            case '/':
                return dyn((a, b) => l(a, b) / k);
            case '%':
                return dyn((a, b) => l(a, b) % k);
            default:
                return dyn((a, b) => Math.pow(l(a, b), k));
        }
    }
    if (L.k === 'k') {
        const k = L.v;
        if (R.k === 'x') {
            switch (op) {
                case '+':
                    return dyn((a) => k + a);
                case '-':
                    return dyn((a) => k - a);
                case '*':
                    return dyn((a) => k * a);
                case '/':
                    return dyn((a) => k / a);
                case '%':
                    return dyn((a) => k % a);
                default:
                    return dyn((a) => Math.pow(k, a));
            }
        }
        switch (op) {
            case '+':
                return dyn((a, b) => k + r(a, b));
            case '-':
                return dyn((a, b) => k - r(a, b));
            case '*':
                return dyn((a, b) => k * r(a, b));
            case '/':
                return dyn((a, b) => k / r(a, b));
            case '%':
                return dyn((a, b) => k % r(a, b));
            default:
                return dyn((a, b) => Math.pow(k, r(a, b)));
        }
    }
    switch (op) {
        case '+':
            return dyn((a, b) => l(a, b) + r(a, b));
        case '-':
            return dyn((a, b) => l(a, b) - r(a, b));
        case '*':
            return dyn((a, b) => l(a, b) * r(a, b));
        case '/':
            return dyn((a, b) => l(a, b) / r(a, b));
        case '%':
            return dyn((a, b) => l(a, b) % r(a, b));
        default:
            return dyn((a, b) => Math.pow(l(a, b), r(a, b)));
    }
}

function comparison(op: CmpOp, L: CNode, R: CNode): CNode {
    if (L.k === 'k' && R.k === 'k') return konst(compare(op, L.v, R.v) ? 1 : 0);
    const l = L.f;
    const r = R.f;
    switch (op) {
        case '<':
            return dyn((a, b) => (l(a, b) < r(a, b) ? 1 : 0));
        case '<=':
            return dyn((a, b) => (l(a, b) <= r(a, b) ? 1 : 0));
        case '>':
            return dyn((a, b) => (l(a, b) > r(a, b) ? 1 : 0));
        case '>=':
            return dyn((a, b) => (l(a, b) >= r(a, b) ? 1 : 0));
        case '==':
            return dyn((a, b) => (l(a, b) === r(a, b) ? 1 : 0));
        default:
            return dyn((a, b) => (l(a, b) !== r(a, b) ? 1 : 0));
    }
}

function callBuiltin(b: Builtin, args: CNode[]): CNode {
    const fn = b.fn;
    if (b.pure && args.every((a) => a.k === 'k')) {
        return konst(fn(...args.map((a) => a.v)));
    }
    if (args.length === 0) return dyn(() => fn());
    if (args.length === 1) {
        const g = args[0].f;
        if (args[0].k === 'x') return dyn((a) => fn(a));
        return dyn((a, b) => fn(g(a, b)));
    }
    if (args.length === 2) {
        const g = args[0].f;
        const h = args[1].f;
        return dyn((a, b) => fn(g(a, b), h(a, b)));
    }
    const fs = args.map((a) => a.f);
    return dyn((a, b) => fn(...fs.map((g) => g(a, b))));
}

/**
 * Per-node override for compile: return a closure to use instead of
 * compiling `n` (never constant-folded), or null to compile `n` normally.
 * The drag engine maps number literals to slots it writes while solving.
 */
export type CompileHook = (n: Node) => Compiled | null;

class Compiler {
    constructor(private env: Env, private src: string, private hook: CompileHook | null = null) {}

    node(n: Node): CNode {
        const h = this.hook && this.hook(n);
        if (h) return dyn(h);
        switch (n.t) {
            case 'num':
                return konst(n.value);
            case 'member': {
                const v = own(MATH_CONSTANTS, n.name);
                if (v === undefined) throw new ExprError(`Unknown name 'Math.${n.name}'`, { pos: n.s });
                return konst(v);
            }
            case 'name':
                return this.name(n);
            case 'call':
                return this.call(n);
            case 'unary': {
                const A = this.node(n.arg);
                if (n.op === '+') return A;
                const g = A.f;
                if (n.op === '-') {
                    if (A.k === 'k') return konst(-A.v);
                    if (A.k === 'x') return dyn((a) => -a);
                    return dyn((a, b) => -g(a, b));
                }
                if (A.k === 'k') return konst(A.v ? 0 : 1);
                return dyn((a, b) => (g(a, b) ? 0 : 1));
            }
            case 'binary': {
                const call = implicitPowerBase(n, this.env);
                const res = call && resolveName(call.name, this.env);
                if (call && res) {
                    // name * (A^E); the hook still sees A and E themselves.
                    const power = arith('^', this.node(call.args[0]), this.node(n.right));
                    return arith('*', this.resolved(res, call.name, call.ns), power);
                }
                return arith(n.op, this.node(n.left), this.node(n.right));
            }
            case 'cmp': {
                const args = n.args.map((a) => this.node(a));
                if (n.ops.length === 1) return comparison(n.ops[0], args[0], args[1]);
                if (args.every((a) => a.k === 'k')) {
                    for (let i = 0; i < n.ops.length; i++) {
                        if (!compare(n.ops[i], args[i].v, args[i + 1].v)) return konst(0);
                    }
                    return konst(1);
                }
                // Chain = AND of neighbouring pairs; each operand is evaluated once.
                const fs = args.map((a) => a.f);
                const ops = n.ops.slice();
                return dyn((a, b) => {
                    let prev = fs[0](a, b);
                    for (let i = 0; i < ops.length; i++) {
                        const cur = fs[i + 1](a, b);
                        if (!compare(ops[i], prev, cur)) return 0;
                        prev = cur;
                    }
                    return 1;
                });
            }
            case 'logic': {
                // JavaScript semantics (the value of the deciding operand), as in 3.19.6.
                const L = this.node(n.left);
                const R = this.node(n.right);
                const l = L.f;
                const r = R.f;
                if (L.k === 'k' && R.k === 'k') {
                    return konst(n.op === '&&' ? (L.v ? R.v : L.v) : L.v ? L.v : R.v);
                }
                if (n.op === '&&') {
                    return dyn((a, b) => {
                        const v = l(a, b);
                        return v ? r(a, b) : v;
                    });
                }
                return dyn((a, b) => {
                    const v = l(a, b);
                    return v ? v : r(a, b);
                });
            }
            case 'ternary': {
                const T = this.node(n.test);
                const A = this.node(n.then);
                const B = this.node(n.else);
                if (T.k === 'k') return T.v ? A : B;
                const t = T.f;
                const x = A.f;
                const y = B.f;
                return dyn((a, b) => (t(a, b) ? x(a, b) : y(a, b)));
            }
        }
    }

    private name(n: NameNode): CNode {
        const res = resolveName(n.name, this.env);
        if (!res) throw unknownName(n.name, n.s, n.e, this.env, this.src);
        return this.resolved(res, n.name, n.s);
    }

    private resolved(res: Resolution, name: string, pos: number): CNode {
        switch (res.k) {
            case 'var':
                return res.index === 0 ? { f: ARG0, k: 'x', v: NaN } : { f: ARG1, k: 'y', v: NaN };
            case 'scalar':
                return dyn(res.s.read);
            case 'const':
                return konst(res.value);
            case 'fn': {
                const err = this.env.bareFnError(name);
                if (err) throw new ExprError(err, { pos });
                checkCallable(res.ref, pos);
                const call = res.ref.call;
                return dyn((a) => call(a));
            }
        }
    }

    private call(n: CallNode): CNode {
        const target = resolveCall(n, this.env, this.src);
        if (target.k === 'builtin') {
            checkArity(n.math ? `Math.${n.name}` : n.name, target.b, n.args.length, n.ns);
            return callBuiltin(target.b, n.args.map((a) => this.node(a)));
        }
        if (target.k === 'fn') {
            checkCallable(target.ref, n.ns);
            if (n.args.length !== 1) {
                throw new ExprError(`${n.name} takes 1 argument`, { pos: n.ns });
            }
            const A = this.node(n.args[0]);
            const call = target.ref.call;
            const g = A.f;
            if (A.k === 'k') {
                // Domains can depend on sliders, so constant calls stay dynamic.
                const v = A.v;
                return dyn(() => call(v));
            }
            if (A.k === 'x') return dyn((a) => call(a));
            return dyn((a, b) => call(g(a, b)));
        }
        // `a(x + 1)` with a slider / variable / constant a: implicit multiplication.
        return arith('*', this.resolved(target.res, n.name, n.ns), this.node(n.args[0]));
    }
}

/**
 * Compile an AST to a closure `(a, b) => number` (a, b = the Env's
 * variables). Throws ExprError for unknown names and other compile-time
 * problems; `src` is the full field text used for quick-fix rewrites.
 * The closure never throws. `hook` (optional) overrides single nodes,
 * see CompileHook; without it the result is unchanged.
 */
export function compile(ast: Node, env: Env, src: string, hook?: CompileHook): Compiled {
    return new Compiler(env, src, hook || null).node(ast).f;
}

/**
 * Copy of `ast` where every call that compiles as implicit multiplication
 * in `env` becomes `{ t: 'binary', op: '*', implicit: true, left: name,
 * right: arg }` with the call's span (the name node spans the name token),
 * and `name(A)^E` (unparenthesized) becomes name * (A^E) with the '^'
 * node's span (the power spans from the '(' to the end). Compiles to the
 * same values as `ast`. Unknown names are left as calls. Never throws.
 * Untouched subtrees are the same objects (spans preserved).
 */
export function normalizeImplicitCalls(ast: Node, env: Env): Node {
    try {
        return normalizeNode(ast, env);
    } catch {
        return ast;
    }
}

function normalizeNode(n: Node, env: Env): Node {
    switch (n.t) {
        case 'num':
        case 'name':
        case 'member':
            return n;
        case 'call': {
            const args = normalizeList(n.args, env);
            if (isImplicitCall(n, env)) {
                const name: NameNode = { t: 'name', name: n.name, s: n.ns, e: n.ne };
                return { t: 'binary', op: '*', implicit: true, left: name, right: args[0], s: n.s, e: n.e };
            }
            return args === n.args ? n : { ...n, args };
        }
        case 'unary': {
            const arg = normalizeNode(n.arg, env);
            return arg === n.arg ? n : { ...n, arg };
        }
        case 'binary': {
            const base = n.left;
            if (n.op === '^' && base.t === 'call' && base.s === base.ns && isImplicitCall(base, env)) {
                const name: NameNode = { t: 'name', name: base.name, s: base.ns, e: base.ne };
                const arg = normalizeNode(base.args[0], env);
                const power: BinaryNode = {
                    t: 'binary', op: '^', left: arg, right: normalizeNode(n.right, env), s: base.open ?? arg.s, e: n.e,
                };
                return { t: 'binary', op: '*', implicit: true, left: name, right: power, s: n.s, e: n.e };
            }
            const left = normalizeNode(n.left, env);
            const right = normalizeNode(n.right, env);
            return left === n.left && right === n.right ? n : { ...n, left, right };
        }
        case 'cmp': {
            const args = normalizeList(n.args, env);
            return args === n.args ? n : { ...n, args };
        }
        case 'logic': {
            const left = normalizeNode(n.left, env);
            const right = normalizeNode(n.right, env);
            return left === n.left && right === n.right ? n : { ...n, left, right };
        }
        case 'ternary': {
            const test = normalizeNode(n.test, env);
            const then = normalizeNode(n.then, env);
            const otherwise = normalizeNode(n.else, env);
            return test === n.test && then === n.then && otherwise === n.else ? n : { ...n, test, then, else: otherwise };
        }
    }
}

/** normalizeNode over a list; the same array when nothing changed. */
function normalizeList(list: Node[], env: Env): Node[] {
    const out = list.map((a) => normalizeNode(a, env));
    return out.every((b, i) => b === list[i]) ? list : out;
}

// ------------------------------------------------------------ affine forms

/** Lazily evaluated affine form: re-reads sliders on every call; null when not affine at those values. */
export type AffinePlan = () => Affine | null;

/** True when the node never reads a variable (directly or through a bare function name). */
function variableFree(n: Node, env: Env): boolean {
    switch (n.t) {
        case 'num':
        case 'member':
            return true;
        case 'name': {
            const res = resolveName(n.name, env);
            return !!res && res.k !== 'var' && res.k !== 'fn';
        }
        case 'call': {
            const res = n.math || own(BUILTINS, n.name) ? null : resolveName(n.name, env);
            if (res && res.k === 'var') return false;
            return n.args.every((a) => variableFree(a, env));
        }
        case 'unary':
            return variableFree(n.arg, env);
        case 'binary':
        case 'logic':
            return variableFree(n.left, env) && variableFree(n.right, env);
        case 'cmp':
            return n.args.every((a) => variableFree(a, env));
        case 'ternary':
            return variableFree(n.test, env) && variableFree(n.then, env) && variableFree(n.else, env);
    }
}

function scale(f: Affine, k: number): Affine {
    return { a: f.a * k, b: f.b * k, c: f.c * k };
}

class Linearizer {
    constructor(private env: Env, private src: string) {}

    plan(n: Node): AffinePlan | null {
        const env = this.env;
        if (variableFree(n, env)) {
            const f = compile(n, env, this.src);
            return () => ({ a: 0, b: 0, c: f(NaN, NaN) });
        }
        switch (n.t) {
            case 'name': {
                const res = resolveName(n.name, env);
                if (!res) return null;
                if (res.k === 'var') {
                    const unit: Affine = res.index === 0 ? { a: 1, b: 0, c: 0 } : { a: 0, b: 1, c: 0 };
                    return () => unit;
                }
                if (res.k === 'fn') {
                    if (env.bareFnError(n.name)) return null;
                    const x: AffinePlan = () => ({ a: 1, b: 0, c: 0 });
                    return this.callPlan(res.ref, x);
                }
                return null;
            }
            case 'unary': {
                const p = this.plan(n.arg);
                if (!p || n.op === '!') return null;
                if (n.op === '+') return p;
                return () => {
                    const f = p();
                    return f && scale(f, -1);
                };
            }
            case 'binary': {
                const call = implicitPowerBase(n, env);
                if (call) {
                    // name * (A^E): affine when name is a number and A^E is affine.
                    const res = resolveName(call.name, env);
                    if (!res || (res.k !== 'scalar' && res.k !== 'const')) return null;
                    const fake: NameNode = { t: 'name', name: call.name, s: call.ns, e: call.ne };
                    return this.times(this.power(call.args[0], n.right), fake, false);
                }
                if (n.op === '+' || n.op === '-') {
                    const l = this.plan(n.left);
                    const r = this.plan(n.right);
                    if (!l || !r) return null;
                    const sign = n.op === '+' ? 1 : -1;
                    return () => {
                        const f = l();
                        const g = r();
                        if (!f || !g) return null;
                        return { a: f.a + sign * g.a, b: f.b + sign * g.b, c: f.c + sign * g.c };
                    };
                }
                if (n.op === '*') {
                    if (variableFree(n.left, env)) return this.scaled(n.right, n.left, false);
                    if (variableFree(n.right, env)) return this.scaled(n.left, n.right, false);
                    return null;
                }
                if (n.op === '/') {
                    if (!variableFree(n.right, env)) return null;
                    return this.scaled(n.left, n.right, true);
                }
                if (n.op === '^') return this.power(n.left, n.right);
                return null;
            }
            case 'call': {
                if (n.math || own(BUILTINS, n.name) || n.args.length !== 1) return null;
                const res = resolveName(n.name, env);
                if (!res) return null;
                if (res.k === 'fn') {
                    const arg = this.plan(n.args[0]);
                    return arg && this.callPlan(res.ref, arg);
                }
                // Implicit multiplication a(x + 1).
                if (res.k === 'scalar' || res.k === 'const') {
                    const fake: NameNode = { t: 'name', name: n.name, s: n.ns, e: n.ne };
                    return this.scaled(n.args[0], fake, false);
                }
                return null;
            }
            default:
                return null;
        }
    }

    /** base^exponent: affine only for a variable-free exponent of 1 (or 0) at the current slider values. */
    private power(base: Node, exponent: Node): AffinePlan | null {
        if (!variableFree(exponent, this.env)) return null;
        const b = this.plan(base);
        if (!b) return null;
        const e = compile(exponent, this.env, this.src);
        return () => {
            const k = e(NaN, NaN);
            if (k === 1) return b();
            if (k === 0) return { a: 0, b: 0, c: 1 };
            return null;
        };
    }

    /** plan(node) times (or divided by) the variable-free `factor`. */
    private scaled(node: Node, factor: Node, divide: boolean): AffinePlan | null {
        return this.times(this.plan(node), factor, divide);
    }

    /** An affine plan times (or divided by) the variable-free `factor`. */
    private times(p: AffinePlan | null, factor: Node, divide: boolean): AffinePlan | null {
        if (!p) return null;
        const k = compile(factor, this.env, this.src);
        return () => {
            const f = p();
            if (!f) return null;
            const v = k(NaN, NaN);
            return scale(f, divide ? 1 / v : v);
        };
    }

    /** f(u) for an affine u: only cartesian callees with an empty domain and an affine body. */
    private callPlan(ref: FnRef, arg: AffinePlan): AffinePlan | null {
        if (ref.kind !== 'cartesian' || !ref.domainEmpty || ref.error || !ref.body || !ref.env) return null;
        const inner = new Linearizer(ref.env, '').plan(ref.body);
        if (!inner) return null;
        return () => {
            const f = inner();
            const u = arg();
            if (!f || !u) return null;
            return { a: f.a * u.a, b: f.a * u.b, c: f.a * u.c + f.c };
        };
    }
}

/**
 * Affine plan of `ast` in the Env's variables: null when the expression
 * is structurally not affine (x*y, min, abs, comparisons, ternaries with
 * variables). Sliders, derived names and constant subexpressions count as
 * numbers. Coefficients are re-evaluated on every call of the plan.
 */
export function linearPlan(ast: Node, env: Env): AffinePlan | null {
    try {
        const p = new Linearizer(env, '').plan(ast);
        if (!p) return null;
        return () => {
            const f = p();
            if (!f || !Number.isFinite(f.a) || !Number.isFinite(f.b) || !Number.isFinite(f.c)) return null;
            return f;
        };
    } catch {
        return null;
    }
}

/** linearPlan evaluated once: the affine form of `ast` at the current slider values, or null. */
export function linearForm(ast: Node, env: Env): Affine | null {
    const plan = linearPlan(ast, env);
    return plan ? plan() : null;
}

// ------------------------------------------------------------ text edits

/**
 * Span [start, end) of the number token of a literal in `src`, the text it
 * was parsed from. A NumNode's own span includes parentheses written around
 * it (`(2)`, `( 2.5 )`); the token is the literal alone.
 */
export function numberTokenSpan(src: string, n: NumNode): [number, number] {
    const at = src.indexOf(n.raw, n.s);
    return at >= 0 && at + n.raw.length <= n.e ? [at, at + n.raw.length] : [n.s, n.e];
}

/** A text edit: replace [s, e) with `text` (s === e inserts). */
export interface TextEdit {
    s: number;
    e: number;
    text: string;
}

/**
 * Apply non-overlapping edits to `src`, right to left by start position.
 * At equal starts the replacement (longer span) is applied before the
 * insertion, so text inserted there ends up in front of the replaced text
 * (`x^2` with x -> `(x - 1)` and `1.5` inserted at 0 gives `1.5(x - 1)^2`).
 * Several insertions at one position appear in the order given.
 */
export function applyEdits(src: string, edits: readonly TextEdit[]): string {
    const order = edits.map((ed, i) => ({ ed, i })).sort((a, b) => b.ed.s - a.ed.s || b.ed.e - a.ed.e || b.i - a.i);
    let out = src;
    for (const { ed } of order) out = out.slice(0, ed.s) + ed.text + out.slice(ed.e);
    return out;
}

// ------------------------------------------------------------- identifiers

/** Every identifier the AST reads (names, callee names), excluding `Math.` members. */
export function identifiers(ast: Node | Node[], out: Set<string> = new Set()): Set<string> {
    if (Array.isArray(ast)) {
        for (const n of ast) identifiers(n, out);
        return out;
    }
    switch (ast.t) {
        case 'name':
            out.add(ast.name);
            break;
        case 'call':
            if (!ast.math) out.add(ast.name);
            identifiers(ast.args, out);
            break;
        case 'unary':
            identifiers(ast.arg, out);
            break;
        case 'binary':
        case 'logic':
            identifiers(ast.left, out);
            identifiers(ast.right, out);
            break;
        case 'cmp':
            identifiers(ast.args, out);
            break;
        case 'ternary':
            identifiers(ast.test, out);
            identifiers(ast.then, out);
            identifiers(ast.else, out);
            break;
        default:
            break;
    }
    return out;
}

/**
 * Identifier tokens of any field text (expressions, conditions, equations,
 * domains, value lists, tuples, templates), excluding `Math.` members.
 * Text with braces is read as a label template (only placeholders hold
 * names; math fields never contain braces); `template` forces that reading
 * for labels without placeholders. Null when the text does not tokenize.
 */
export function identifierTokens(src: string, template = false): Token[] | null {
    if (template || src.indexOf('{') >= 0 || src.indexOf('}') >= 0) {
        const out: Token[] = [];
        for (const part of scanTemplate(src).parts) {
            if (part.kind !== 'expr') continue;
            const inner = identifierTokens(part.expr);
            if (!inner) continue;
            for (const t of inner) out.push({ ...t, pos: t.pos + part.offset, end: t.end + part.offset });
        }
        return out;
    }
    let tokens: Token[];
    try {
        tokens = tokenize(src);
    } catch {
        return null;
    }
    const out: Token[] = [];
    for (let i = 0; i < tokens.length; i++) {
        const t = tokens[i];
        if (t.kind !== 'id') continue;
        const prev = tokens[i - 1];
        const prev2 = tokens[i - 2];
        if (prev && prev.kind === 'op' && prev.text === '.' && prev2 && prev2.kind === 'id' && prev2.text === 'Math') continue;
        if (t.text === 'Math' || t.text === 'and' || t.text === 'or') continue;
        out.push(t);
    }
    return out;
}

/**
 * Replace identifier tokens for which `map` returns a new name. Never
 * touches `Math.` members, numbers or parts of other identifiers (nor the
 * text of a label template outside its placeholders). Returns `src`
 * unchanged when it does not tokenize.
 */
export function renameTokens(src: string, map: (name: string) => string | null, template = false): string {
    const tokens = identifierTokens(src, template);
    if (!tokens) return src;
    let out = src;
    for (let i = tokens.length - 1; i >= 0; i--) {
        const t = tokens[i];
        const to = map(t.text);
        if (to === null || to === t.text) continue;
        // Tokens are replaced right to left, so `before` is still the original prefix.
        const before = out.slice(0, t.pos);
        // `2k` renamed to e1 must not turn into the number 2e1 (= 20): keep a space.
        const glue = /[\d.]$/.test(before) && /^[eE]\d/.test(to) ? ' ' : '';
        out = before + glue + to + out.slice(t.end);
    }
    return out;
}

/** Rename identifier `from` to `to` in any field text (`template`: see identifierTokens). */
export function renameIdentifier(src: string, from: string, to: string, template = false): string {
    if (!from || from === to) return src;
    return renameTokens(src, (name) => (name === from ? to : null), template);
}

// ---------------------------------------------------------------- numbers

/**
 * At most 6 significant digits, no exponent for |n| in [1e-4, 1e6),
 * trailing zeros trimmed, -0 -> '0', non-finite -> 'nan'.
 */
export function formatNumber(n: number): string {
    if (!Number.isFinite(n)) return 'nan';
    if (n === 0) return '0';
    const abs = Math.abs(n);
    if (abs >= 1e-4 && abs < 1e6) {
        const s = n.toPrecision(6);
        // toPrecision switches to exponent form when rounding reaches 1e6.
        if (s.indexOf('e') < 0) return trimZeros(s);
    }
    // '1.5e6', not '1.5e+6' (both parse in pgfplots; the short form reads better in labels).
    const [mant, exp] = n.toExponential(5).split('e');
    return `${trimZeros(mant)}e${exp.replace('+', '')}`;
}

function trimZeros(s: string): string {
    if (s.indexOf('.') < 0) return s;
    const t = s.replace(/0+$/, '').replace(/\.$/, '');
    return t === '-0' ? '0' : t;
}

/** `n` with `decimals` decimals, trailing zeros trimmed, -0 -> '0'. */
export function formatFixed(n: number, decimals: number): string {
    const s = trimZeros(n.toFixed(Math.max(0, Math.min(20, Math.floor(decimals)))));
    return s === '-0' ? '0' : s;
}

/** Number literal as pgf / LaTeX text ('.5' -> '0.5', '2.' -> '2', '1e3' -> '1000', '010' -> '10'). */
function literalText(n: NumNode): string {
    // pgfmath reads a leading 0 as an octal prefix ('010' is 8, '09' aborts the document).
    const raw = n.raw.replace(/^0+(?=\d)/, '');
    if (/^\d+$/.test(raw)) return raw;
    if (/^\d+\.\d+$/.test(raw)) return raw;
    if (/^\d+\.$/.test(raw)) return raw.slice(0, -1);
    if (/^\.\d+$/.test(raw)) return '0' + raw;
    return String(n.value);
}

// ------------------------------------------------------------ pgf printer

interface Printed {
    s: string;
    /** Safe to use as an operand without parentheses. */
    atom: boolean;
}

function atom(s: string): Printed {
    return { s, atom: true };
}

function compound(s: string): Printed {
    return { s, atom: false };
}

function wrap(p: Printed): string {
    return p.atom ? p.s : `(${p.s})`;
}

/** Value of printed pgf text that is a plain number ('3', '(-1.5)', 'pi'), else null. */
function pgfConstant(s: string): number | null {
    const t = s.replace(/^\((.*)\)$/, '$1');
    if (t === 'pi') return Math.PI;
    if (t === 'e') return Math.E;
    return /^-?(?:\d+(?:\.\d*)?|\.\d+)(?:e-?\d+)?$/.test(t) ? Number(t) : null;
}

/**
 * The node always evaluates to 0 or 1 (never NaN): comparisons, `!`,
 * true / false and logic or ternaries over those. pgfmath handles these
 * natively; other operands of `!`, `&&`, `||` and `?:` need JS semantics
 * spelled out (pgfmath returns 0 / 1 from && and ||, aborts on `!nan` and
 * `nan && 1`, and treats nan as true in `?:`).
 */
function isBoolean(n: Node): boolean {
    switch (n.t) {
        case 'cmp':
            return true;
        case 'unary':
            return n.op === '!' || (n.op === '+' && isBoolean(n.arg));
        case 'num':
            return n.value === 0 || n.value === 1;
        case 'name':
            return n.name === 'true' || n.name === 'false';
        case 'logic':
            return isBoolean(n.left) && isBoolean(n.right);
        case 'ternary':
            return isBoolean(n.then) && isBoolean(n.else);
        default:
            return false;
    }
}

/** Simple pgfmath renames (same arguments). */
const PGF_SAME: Record<string, string> = {
    sin: 'sin', cos: 'cos', tan: 'tan', atan: 'atan', atan2: 'atan2',
    sinh: 'sinh', cosh: 'cosh', tanh: 'tanh', exp: 'exp', log: 'ln', ln: 'ln', log2: 'log2', log10: 'log10',
    sqrt: 'sqrt', abs: 'abs', sign: 'sign', floor: 'floor', ceil: 'ceil', sec: 'sec', cot: 'cot',
    csc: 'cosec', min: 'min', max: 'max', pow: 'pow', trunc: 'int',
};

class PgfPrinter {
    constructor(
        private env: Env,
        /** Text for each variable index (already safe as an operand). */
        private varText: string[],
        private fmt: (n: number) => string
    ) {}

    private num(v: number): Printed {
        const s = this.fmt(v);
        return s.startsWith('-') ? atom(`(${s})`) : atom(s);
    }

    print(n: Node): Printed {
        switch (n.t) {
            case 'num':
                return atom(literalText(n));
            case 'member':
                return this.constant(n.name, own(MATH_CONSTANTS, n.name) ?? NaN);
            case 'name':
                return this.name(n.name);
            case 'call':
                return this.call(n);
            case 'unary': {
                const a = this.print(n.arg);
                if (n.op === '+') return a;
                if (n.op === '!') {
                    if (isBoolean(n.arg)) return compound(`!(${a.s})`);
                    // !u is 1 for 0 and NaN, as in JavaScript (pgfmath aborts on !nan).
                    const u = wrap(a);
                    return compound(`(${u}==0) || (${u}!=${u})`);
                }
                return compound(`-${wrap(a)}`);
            }
            case 'binary': {
                const call = implicitPowerBase(n, this.env);
                if (call) {
                    // name * (A^E), as compiled.
                    const power = compound(`${wrap(this.print(call.args[0]))}^${wrap(this.print(n.right))}`);
                    return compound(`${wrap(this.name(call.name))}*${wrap(power)}`);
                }
                const l = this.print(n.left);
                const r = this.print(n.right);
                if (n.op === '%') return this.remainder(l, r);
                return compound(`${wrap(l)}${n.op}${wrap(r)}`);
            }
            case 'cmp': {
                const args = n.args.map((a) => wrap(this.print(a)));
                const pairs = n.ops.map((op, i) => `${args[i]}${op}${args[i + 1]}`);
                if (pairs.length === 1) return compound(pairs[0]);
                return compound(pairs.map((p) => `(${p})`).join(' && '));
            }
            case 'logic': {
                const l = wrap(this.print(n.left));
                const r = wrap(this.print(n.right));
                if (isBoolean(n.left) && isBoolean(n.right)) return compound(`${l} ${n.op} ${r}`);
                // JavaScript value semantics: a && b is a when a is falsy, else b; a || b the reverse.
                const test = this.truthy(n.left);
                return compound(n.op === '&&' ? `${test} ? ${r} : ${l}` : `${test} ? ${l} : ${r}`);
            }
            case 'ternary':
                return compound(`${this.truthy(n.test)} ? ${wrap(this.print(n.then))} : ${wrap(this.print(n.else))}`);
        }
    }

    /** Ternary test text: NaN is falsy as in JavaScript (pgfmath treats nan as true). */
    private truthy(n: Node): string {
        const t = wrap(this.print(n));
        return isBoolean(n) ? t : `((${t}!=0) && (${t}==${t}))`;
    }

    /**
     * JavaScript a % b (sign of a) as a - b*int(a/b). pgfmath's mod() aborts
     * the whole document for b = 0, NaN operands or quotients beyond about
     * 16000, so it is never used. A divisor that is not a nonzero number is
     * guarded so b = 0 gives nan like JavaScript.
     */
    private remainder(l: Printed, r: Printed): Printed {
        const a = wrap(l);
        const b = wrap(r);
        const rem = `${a}-(${b}*int(${a}/${b}))`;
        const k = pgfConstant(r.s);
        if (k !== null && k !== 0) return compound(rem);
        return compound(`(${b}==0) ? nan : (${rem})`);
    }

    private constant(name: string, value: number): Printed {
        if (name === 'pi' || name === 'PI' || name === 'π') return atom('pi');
        if (name === 'e' || name === 'E') return atom('e');
        if (name === 'true') return atom('1');
        if (name === 'false') return atom('0');
        return this.num(value);
    }

    private name(name: string): Printed {
        const res = resolveName(name, this.env);
        if (!res) throw new ExprError(`Unknown name '${name}'`);
        switch (res.k) {
            case 'var':
                return atom(this.varText[res.index]);
            case 'scalar':
                return this.num(res.s.read());
            case 'const':
                return this.constant(name, res.value);
            case 'fn':
                return this.inline(res.ref, atom(this.varText[0]));
        }
    }

    /** User function call inlined with its argument; guarded when the callee has a domain. */
    private inline(ref: FnRef, arg: Printed): Printed {
        if (!ref.body || !ref.env) return atom('nan');
        const dom = ref.domain();
        if (dom === 'invalid') return atom('nan');
        const body = new PgfPrinter(ref.env, [wrap(arg)], this.fmt).print(ref.body);
        if (!dom) return body;
        const u = arg.s;
        const lo = this.fmt(dom[0]);
        const hi = this.fmt(dom[1]);
        return compound(`(((${u})>=(${lo})) && ((${u})<=(${hi}))) ? (${body.s}) : nan`);
    }

    private call(n: CallNode): Printed {
        const target = resolveCall(n, this.env, '');
        if (target.k === 'fn') return this.inline(target.ref, this.print(n.args[0]));
        if (target.k === 'mul') {
            const left = n.name;
            const l = this.name(left);
            return compound(`${wrap(l)}*${wrap(this.print(n.args[0]))}`);
        }
        const args = n.args.map((a) => this.print(a));
        const raw = args.map((a) => a.s);
        const w = args.map(wrap);
        const name = target.name;
        switch (name) {
            case 'round':
                return atom(`floor(${w[0]}+0.5)`);
            case 'cbrt':
                return compound(`sign(${raw[0]})*(abs(${raw[0]})^(1/3))`);
            case 'hypot': {
                if (!raw.length) return atom('0');
                if (raw.length === 1) return atom(`abs(${raw[0]})`);
                let acc = `veclen(${raw[0]},${raw[1]})`;
                for (let i = 2; i < raw.length; i++) acc = `veclen(${acc},${raw[i]})`;
                return atom(acc);
            }
            case 'asin':
            case 'acos': {
                // pgfmath aborts on asin(2) or asin(nan) and evaluates both branches of ?:,
                // so the argument is clamped and the test (nan-safe) picks nan outside [-1, 1].
                const u = raw[0];
                return compound(`((abs(${u})<1) || (abs(${u})==1)) ? ${name}(max(-1,min(1,${u}))) : nan`);
            }
            case 'asinh':
                return compound(`sign(${raw[0]})*ln(abs(${raw[0]})+sqrt((${raw[0]})^2+1))`);
            case 'acosh':
                return atom(`ln((${raw[0]})+sqrt((${raw[0]})^2-1))`);
            case 'atanh':
                return compound(`0.5*ln((1+(${raw[0]}))/(1-(${raw[0]})))`);
            case 'log1p':
                return atom(`ln(1+(${raw[0]}))`);
            case 'expm1':
                return atom(`(exp(${raw[0]})-1)`);
            case 'fround':
                return atom(`(${raw[0]})`);
            case 'random':
                return atom('rnd');
            case 'min':
            case 'max':
                if (raw.length === 1) return args[0];
                return atom(`${name}(${raw.join(',')})`);
            default: {
                const mapped = own(PGF_SAME, name) ?? name;
                return atom(`${mapped}(${raw.join(',')})`);
            }
        }
    }
}

/**
 * pgfmath text for `ast`. Every binary / ternary subexpression is
 * parenthesised (pgfmath groups `^` and `?:` left to right and gives `&&`
 * and `||` equal precedence); sliders and derived names become numbers;
 * user functions are inlined (domain-guarded); variable i prints as
 * `outVars[i]`. The caller compiles `ast` first so unknown names are
 * reported as ExprError with quick fixes.
 */
export function toPgf(ast: Node, env: Env, outVars: string[], fmt: (n: number) => string): string {
    return new PgfPrinter(env, outVars, fmt).print(ast).s;
}

// ------------------------------------------------------------ LaTeX printer

const TEX_FUNCTIONS: Record<string, string> = {
    sin: '\\sin', cos: '\\cos', tan: '\\tan', sec: '\\sec', csc: '\\csc', cot: '\\cot',
    asin: '\\arcsin', acos: '\\arccos', atan: '\\arctan', sinh: '\\sinh', cosh: '\\cosh', tanh: '\\tanh',
    log: '\\ln', ln: '\\ln', log10: '\\log_{10}', log2: '\\log_{2}', min: '\\min', max: '\\max',
};

const TEX_CONSTANTS: Record<string, string> = {
    pi: '\\pi', PI: '\\pi', 'π': '\\pi', e: 'e', E: 'e', LN2: '\\ln 2', LN10: '\\ln 10',
    LOG2E: '\\log_{2} e', LOG10E: '\\log_{10} e', SQRT2: '\\sqrt{2}', SQRT1_2: '\\sqrt{1/2}', true: '1', false: '0',
};

/** Precedence levels for the LaTeX printer (higher binds tighter). */
const P_TERN = 1;
const P_OR = 2;
const P_AND = 3;
const P_CMP = 4;
const P_ADD = 5;
const P_MUL = 6;
const P_UNARY = 7;
const P_POW = 8;
const P_ATOM = 9;

interface Tex {
    s: string;
    p: number;
    /** First character class, to decide between juxtaposition and \cdot. */
    digitStart?: boolean;
    unaryStart?: boolean;
}

/** LaTeX for a Greek letter name; omicron has no command in LaTeX (it is a Latin o). */
function greekTex(name: string): string {
    return name === 'omicron' ? 'o' : '\\' + name;
}

/** LaTeX for an identifier: x1 -> x_{1}, alpha -> \alpha, a_b -> a_{b}, rate -> \mathit{rate}. */
export function texName(name: string): string {
    // `$` is a legal identifier character but ends math mode in LaTeX.
    if (name.indexOf('$') >= 0) return `\\mathit{${name.replace(/\$/g, '\\$')}}`;
    if (name === 'θ' || name === 'theta') return '\\theta';
    if (name === 'π' || name === 'pi') return '\\pi';
    if (GREEK.has(name)) return greekTex(name);
    const us = name.indexOf('_');
    if (us > 0 && us < name.length - 1) {
        const base = name.slice(0, us);
        const sub = name.slice(us + 1).replace(/_/g, '\\_');
        const baseTex = GREEK.has(base) ? greekTex(base) : base.length === 1 || /^[A-Za-z]\d+$/.test(base) ? base : `\\mathit{${base}}`;
        return `${baseTex}_{${sub}}`;
    }
    const idx = /^([A-Za-z])(\d+)$/.exec(name);
    if (idx) return `${idx[1]}_{${idx[2]}}`;
    if (name.length === 1) return name;
    return `\\mathit{${name.replace(/_/g, '\\_')}}`;
}

function texNumber(n: NumNode): Tex {
    const text = literalText(n);
    const m = /^(-?[\d.]+)e([+-]?)(\d+)$/.exec(text);
    if (m) {
        const exp = (m[2] === '-' ? '-' : '') + m[3];
        return { s: `${m[1]} \\cdot 10^{${exp}}`, p: P_MUL, digitStart: true };
    }
    return { s: text, p: P_ATOM, digitStart: true };
}

const TEX_CMP: Record<CmpOp, string> = { '<': '<', '<=': '\\le', '>': '>', '>=': '\\ge', '==': '=', '!=': '\\ne' };

function paren(t: Tex, min: number): string {
    return t.p >= min ? t.s : `(${t.s})`;
}

/** Simple enough for \frac: atoms, powers, products of those, and their negation. */
function fracSimple(n: Node): boolean {
    switch (n.t) {
        case 'num':
        case 'name':
        case 'member':
        case 'call':
            return true;
        case 'unary':
            return n.op === '-' && fracSimple(n.arg);
        case 'binary':
            if (n.op === '^') return true;
            if (n.op === '*') return fracSimple(n.left) && fracSimple(n.right);
            return false;
        default:
            return false;
    }
}

/** The call is a builtin (printed as a function); anything else prints as `name(args)`. */
function texBuiltin(n: CallNode): boolean {
    return (n.math ? own(MATH_FUNCTIONS, n.name) : own(BUILTINS, n.name)) !== undefined;
}

class TexPrinter {
    print(n: Node): Tex {
        switch (n.t) {
            case 'num':
                return texNumber(n);
            case 'name': {
                const c = own(TEX_CONSTANTS, n.name);
                if (c !== undefined) return { s: c, p: P_ATOM };
                return { s: texName(n.name), p: P_ATOM };
            }
            case 'member':
                return { s: own(TEX_CONSTANTS, n.name) ?? `\\mathrm{${n.name}}`, p: P_ATOM };
            case 'call':
                return this.call(n);
            case 'unary': {
                const a = this.print(n.arg);
                if (n.op === '+') return a;
                if (n.op === '!') return { s: `\\lnot ${paren(a, P_UNARY)}`, p: P_UNARY, unaryStart: true };
                return { s: `-${paren(a, P_UNARY)}`, p: P_UNARY, unaryStart: true };
            }
            case 'binary':
                return this.binary(n);
            case 'cmp': {
                const parts: string[] = [paren(this.print(n.args[0]), P_ADD)];
                n.ops.forEach((op, i) => parts.push(TEX_CMP[op], paren(this.print(n.args[i + 1]), P_ADD)));
                return { s: parts.join(' '), p: P_CMP };
            }
            case 'logic': {
                const p = n.op === '&&' ? P_AND : P_OR;
                const l = this.print(n.left);
                const r = this.print(n.right);
                return { s: `${paren(l, p)} ${n.op === '&&' ? '\\land' : '\\lor'} ${paren(r, p + 1)}`, p };
            }
            case 'ternary': {
                // Flatten nested else-branches into one cases-style array (kernel LaTeX only).
                const rows: string[] = [];
                let cur: Node = n;
                while (cur.t === 'ternary') {
                    rows.push(`${this.print(cur.then).s} & ${this.print(cur.test).s}`);
                    cur = cur.else;
                }
                rows.push(`${this.print(cur).s} & \\mathrm{otherwise}`);
                return { s: `\\left\\{\\begin{array}{ll} ${rows.join(' \\\\ ')} \\end{array}\\right.`, p: P_ATOM };
            }
        }
    }

    private binary(n: BinaryNode): Tex {
        const l = this.print(n.left);
        const r = this.print(n.right);
        if (n.equation) return { s: `${l.s} = ${r.s}`, p: P_TERN };
        switch (n.op) {
            case '+':
            case '-': {
                const right = r.unaryStart ? `(${r.s})` : paren(r, n.op === '-' ? P_MUL : P_ADD);
                return { s: `${paren(l, P_ADD)} ${n.op} ${right}`, p: P_ADD, digitStart: l.digitStart, unaryStart: l.unaryStart };
            }
            case '*': {
                const left = paren(l, P_MUL);
                const right = r.unaryStart ? `(${r.s})` : paren(r, P_MUL);
                const rightParen = right.startsWith('(');
                const cdot = !rightParen && (r.digitStart || /^\d/.test(right));
                return {
                    s: cdot ? `${left} \\cdot ${right}` : `${left} ${right}`,
                    p: P_MUL,
                    digitStart: l.digitStart,
                    unaryStart: l.unaryStart,
                };
            }
            case '/':
                if (fracSimple(n.left) && fracSimple(n.right)) {
                    const num = n.left.t === 'unary' && n.left.op === '-' ? this.print(n.left.arg).s : l.s;
                    const frac = `\\frac{${num}}{${r.s}}`;
                    if (n.left.t === 'unary' && n.left.op === '-') return { s: `-${frac}`, p: P_UNARY, unaryStart: true };
                    return { s: frac, p: P_ATOM };
                }
                return {
                    s: `${paren(l, P_MUL)} / ${r.unaryStart ? `(${r.s})` : paren(r, P_UNARY)}`,
                    p: P_MUL,
                    digitStart: l.digitStart,
                };
            case '%':
                return { s: `${paren(l, P_MUL)} \\bmod ${paren(r, P_UNARY)}`, p: P_MUL, digitStart: l.digitStart };
            default: {
                // `a(x - h)^2` reads as a (x - h)^2 in print as in the compiler; a call the user put in
                // parentheses keeps them, so `(a(x - h))^2` does not print as the same text.
                const base = n.left;
                const wrapped = base.t === 'call' && base.s !== base.ns && !texBuiltin(base);
                return { s: `${wrapped ? `(${l.s})` : paren(l, P_ATOM)}^{${r.s}}`, p: P_POW, digitStart: l.digitStart };
            }
        }
    }

    private call(n: CallNode): Tex {
        const args = n.args.map((a) => this.print(a).s);
        if (!texBuiltin(n)) {
            return { s: `${texName(n.name)}(${args.join(', ')})`, p: P_ATOM };
        }
        const a0 = args[0] ?? '';
        switch (n.name) {
            case 'sqrt':
                return { s: `\\sqrt{${a0}}`, p: P_ATOM };
            case 'cbrt':
                return { s: `\\sqrt[3]{${a0}}`, p: P_ATOM };
            case 'abs':
                return { s: `\\left|${a0}\\right|`, p: P_ATOM };
            case 'floor':
                return { s: `\\lfloor ${a0}\\rfloor`, p: P_ATOM };
            case 'ceil':
                return { s: `\\lceil ${a0}\\rceil`, p: P_ATOM };
            case 'exp':
                return { s: `e^{${a0}}`, p: P_POW };
            case 'expm1':
                return { s: `(e^{${a0}} - 1)`, p: P_ATOM };
            case 'log1p':
                return { s: `\\ln(1 + ${a0})`, p: P_ATOM };
            case 'pow': {
                const base = this.print(n.args[0]);
                return { s: `${paren(base, P_ATOM)}^{${args[1] ?? ''}}`, p: P_POW };
            }
            case 'hypot':
                return { s: `\\sqrt{${n.args.map((a) => `${paren(this.print(a), P_ATOM)}^{2}`).join(' + ')}}`, p: P_ATOM };
            default: {
                const fn = own(TEX_FUNCTIONS, n.name) ?? `\\mathop{\\mathrm{${n.name}}}`;
                return { s: `${fn}(${args.join(', ')})`, p: P_ATOM };
            }
        }
    }
}

/**
 * LaTeX math source (no delimiters) for `ast`. Uses kernel LaTeX only
 * (no amsmath), so legend entries compile in a bare pgfplots document.
 */
export function toTex(ast: Node): string {
    return new TexPrinter().print(ast).s;
}
