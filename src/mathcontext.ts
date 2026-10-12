/*
 * MathContext: the single way the rest of the plugin evaluates, validates
 * and translates user math. Built on the AST parser in src/expr.ts.
 *
 * CONTRACT FILE. The exported names, signatures and documented semantics
 * below are fixed; other modules are implemented against them in parallel.
 * Implementations may add private helpers and extra exports, but must not
 * change or remove anything exported here.
 */
import { FunctionParameters, Parameter } from './types';
import {
    AffinePlan,
    BinaryNode,
    CmpOp,
    Compiled,
    Env,
    ExprError,
    FnRef,
    Lru,
    Node,
    Scalar,
    TupleItem,
    compile,
    dollarMath,
    formatFixed,
    formatNumber,
    identifierTokens,
    identifiers,
    isReservedName,
    linearPlan,
    matchingBrace,
    parse,
    parseList,
    parseTuples,
    renameIdentifier as renameIdentifierImpl,
    renameTokens,
    scanTemplate,
    toPgf,
    toTex,
    tokenize,
    topLevelColon,
} from './expr';

export type FunctionKind = 'cartesian' | 'parametric' | 'polar';

/** a*x + b*y + c (x and y are the chart's two axis variables). */
export interface Affine {
    a: number;
    b: number;
    c: number;
}

/** Quick fix offered next to an inline error. */
export interface IssueFix {
    /** Button text, e.g. 'Add slider a' or 'Use a*x'. */
    label: string;
    /** Replace the whole field text with this. */
    rewrite?: string;
    /** Create a parameter with this name. */
    addParameter?: string;
}

export interface Issue {
    /** Short user-facing message, e.g. "Unknown name 'b'". */
    message: string;
    /** First unknown identifier, when that is the problem. */
    unknown?: string;
    /** 0-based character position in the source, when known. */
    pos?: number;
    fix?: IssueFix;
}

export type ValidateResult = { ok: true } | ({ ok: false } & Issue);

/**
 * Field kinds understood by `validate`. Each one runs exactly the same code
 * path as the corresponding evaluator, so validation can never drift.
 *   fn1        function body in one variable (cartesian x / parametric t / polar theta), see `kind` arg
 *   fn2        expression in the two axis variables
 *   value      constant expression (parameters / derived names allowed)
 *   domain     'a:b'
 *   condition  one region condition entry (clauses, chains, and/or)
 *   equation   'lhs = rhs' or bare expression
 *   levels     comma list of values
 *   tuples2 / tuples3   '(x, y); (x, y)' / '(x, y, z); ...'
 *   path2 / path3       like tuples, but entries may also be points-tool names
 *   template   label template ('{expr}', '{expr:2}')
 */
export type ValidateKind =
    | 'fn1'
    | 'fn2'
    | 'value'
    | 'domain'
    | 'condition'
    | 'equation'
    | 'levels'
    | 'tuples2'
    | 'tuples3'
    | 'path2'
    | 'path3'
    | 'template';

/**
 * Compile-time error with an optional position, unknown name and quick fix:
 * `new ExprError(message, { pos, unknown, fix })`. Defined in src/expr.ts
 * (the parser throws it) and re-exported here, its public home. It also
 * carries an optional 0-based `index` naming the failing item of list
 * sources (condition entries, values, points).
 */
export { ExprError };

export interface FunctionInfo {
    name: string;
    /** Position in the functions list. */
    index: number;
    kind: FunctionKind;
    /** Cartesian/polar: f(v). Parametric: x(t). NaN outside `domain`; never throws. */
    fn: (v: number) => number;
    /** Parametric only: y(t). */
    fnY?: (t: number) => number;
    /** Resolved numeric domain, or null when the domain field is empty (= follow the view). */
    domain: [number, number] | null;
    hidden: boolean;
    /** Parse error, unknown name, cycle, or 'depends on f1 (error)'. When set, `fn` returns NaN. */
    error?: string;
    /**
     * Problem with the domain field at the current slider values (malformed,
     * unknown name, min >= max). `domain` is then null and `fn` returns NaN
     * everywhere, so nothing is drawn.
     */
    domainError?: string;
}

/** One atomic constraint g(x, y) <= 0 of a region condition. */
export interface ConditionClause {
    g: (x: number, y: number) => number;
    /** Exact affine form of g when it is linear in x and y (parameters count as numbers). */
    affine: Affine | null;
    /** Source text of this clause, normalized (for labels / errors). */
    text: string;
}

/** One `conditions[]` entry: OR over disjuncts, each disjunct an AND of clauses. */
export interface ConditionEntry {
    entry: number;
    disjuncts: ConditionClause[][];
}

export interface MathContextInput {
    parameters?: Parameter[];
    functions?: FunctionParameters[];
    /** Polar charts: function bodies use theta (aliases theta, θ, x, t). */
    polar?: boolean;
    /** Axis variable names, e.g. 'x, y' (default) or 'x1, x2'. x and y always remain aliases. */
    variables?: string;
    /**
     * Names of tools in the chart. Enables derived names
     * `<Tool>_x`, `_y`, `_z`, `_val`, `_n` and indexed `<Tool>_x2` (2nd point).
     * Values are supplied at render time through `setDerived`; unset -> NaN.
     */
    toolNames?: string[];
}

/** A slider problem, shaped like a SceneIssue (scene.ts) so hosts can list it with the others. */
export interface ParameterIssue {
    source: string;
    message: string;
    severity: 'error';
}

/** Values published by the scene for derived names, e.g. { P1_x: 3, P1_y: 1, P1_val: 9, P1_n: 1 }. */
export type DerivedValues = Record<string, number>;

/** One entry of a segment path: a point, or the name of a tool whose points are spliced in. */
export type PathEntry = { point: number[] } | { name: string };

/**
 * Template locals each kind of label provides, i.e. the keys its caller
 * passes to formatTemplate. Pass the same list to
 * `validate(src, 'template', undefined, locals)`: curve labels get
 * {level}, points labels {x}, {y}, {val}, {i} (3D adds {z}); every other
 * label (title, annotations, region, segment and condition labels) none.
 */
export const LABEL_LOCALS: {
    plain: readonly string[];
    curve: readonly string[];
    points2: readonly string[];
    points3: readonly string[];
} = {
    plain: [],
    curve: ['level'],
    points2: ['i', 'val', 'x', 'y'],
    points3: ['i', 'val', 'x', 'y', 'z'],
};

// ------------------------------------------------------------ internals

type FieldKind = 'fn1' | 'fn2' | 'value';

/** Where each template local is provided (message for a placeholder used in another label). */
const LOCAL_HOMES: Record<string, string> = {
    x: 'point labels',
    y: 'point labels',
    val: 'point labels',
    i: 'point labels',
    z: '3D point labels',
    level: 'curve labels',
};

const NUMERIC_LITERAL_RE = /^\s*[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?\s*$/;
const NAME_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;
const DERIVED_RE = /^(.+)_(x|y|z|val|n)(\d*)$/;
const VARIABLE_NAMES = ['x', 'y', 'z', 't', 'theta', 'θ'];
const PARAMETRIC_VARS = ['t', 'x'];
const POLAR_VARS = ['theta', 'θ', 'x', 't'];
const EMPTY_LOCALS: Record<string, number> = Object.freeze({});

/** Non-finite value where a number is required (validation may accept it for unset derived names). */
class NonFiniteError extends ExprError {}

function str(src: unknown): string {
    if (typeof src === 'string') return src;
    // Numbers and booleans from hand-edited blocks read as their text; objects are not expressions.
    return typeof src === 'number' || typeof src === 'boolean' || typeof src === 'bigint' ? String(src) : '';
}

function asExprError(e: unknown): ExprError {
    if (e instanceof ExprError) return e;
    return new ExprError(e instanceof Error ? e.message : String(e));
}

/** Copy of `e` with `prefix` added to its message (cached errors are shared, never mutate them). */
function prefixed(e: unknown, prefix: string, index: number): ExprError {
    const err = asExprError(e);
    const Ctor = err instanceof NonFiniteError ? NonFiniteError : ExprError;
    return new Ctor(`${prefix}: ${err.message}`, { pos: err.pos, unknown: err.unknown, fix: err.fix, index });
}

/** Error raised on a slice `full[offset, offset + len)`, re-based onto the full field text. */
function relocate(e: unknown, full: string, offset: number, len: number): ExprError {
    const err = asExprError(e);
    let fix = err.fix;
    if (fix && fix.rewrite !== undefined) {
        fix = { ...fix, rewrite: full.slice(0, offset) + fix.rewrite + full.slice(offset + len) };
    }
    const Ctor = err instanceof NonFiniteError ? NonFiniteError : ExprError;
    return new Ctor(err.message, {
        pos: err.pos === undefined ? undefined : err.pos + offset,
        unknown: err.unknown,
        fix,
        index: err.index,
    });
}

function issueOf(e: unknown): { ok: false } & Issue {
    const err = asExprError(e);
    const out: { ok: false } & Issue = { ok: false, message: err.message };
    if (err.pos !== undefined) out.pos = err.pos;
    if (err.unknown !== undefined) out.unknown = err.unknown;
    if (err.fix) out.fix = err.fix;
    return out;
}

function shortText(s: string): string {
    const t = s.replace(/\s+/g, ' ').trim();
    return t.length > 24 ? t.slice(0, 23) + '…' : t;
}

/** Whitespace-collapsed source slice with unicode operators spelled in ASCII. */
function sliceText(src: string, n: Node): string {
    return src
        .slice(n.s, n.e)
        .replace(/≤/g, '<=')
        .replace(/≥/g, '>=')
        .replace(/≠/g, '!=')
        .replace(/\s+/g, ' ')
        .trim();
}

function parseVariables(spec: unknown): [string, string] {
    const parts = str(spec)
        .split(/[,;\s]+/)
        .filter((p) => p.length > 0);
    const v1 = parts[0] && NAME_RE.test(parts[0]) ? parts[0] : 'x';
    const v2 = parts[1] && NAME_RE.test(parts[1]) ? parts[1] : 'y';
    return v1 === v2 ? ['x', 'y'] : [v1, v2];
}

/** One atomic clause of a condition after DNF conversion: lhs op rhs. */
interface RawClause {
    lhs: Node;
    rhs: Node;
    op: '<' | '<=' | '>' | '>=';
}

const NEGATED: Record<RawClause['op'], RawClause['op']> = { '<': '>=', '<=': '>', '>': '<=', '>=': '<' };
const MAX_DISJUNCTS = 64;

interface CompiledClause {
    g: Compiled;
    plan: AffinePlan | null;
    text: string;
}

interface FnRec {
    name: string;
    index: number;
    kind: FunctionKind;
    hidden: boolean;
    expression: string;
    expressionY: string;
    domainSrc: string;
    ast: Node | null;
    astY: Node | null;
    body: Compiled | null;
    bodyY: Compiled | null;
    error?: string;
    /** Names of user functions this one reads (body and domain). */
    deps: string[];
    /** 0 = new, 1 = compiling, 2 = done. */
    state: number;
    domVersion: number;
    dom: [number, number] | null;
    domTol: number;
    domBad: boolean;
    domError?: string;
    ref: FnRef;
    info: FunctionInfo;
}

interface DepSets {
    params: Set<string>;
    functions: Set<string>;
    derived: Set<string>;
    tools: Set<string>;
}

/** Module-level memo of contexts by structure key (values are applied in place). */
const CONTEXT_CACHE = new Lru<string, MathContext>(16);

export class MathContext {
    private readonly paramNames: string[] = [];
    private readonly paramIndex = new Map<string, number>();
    /** Slider values by slot; compiled closures read this array at call time. */
    private readonly vals: number[] = [];
    /** Derived values; replaced in place by setDerived so closures keep their reference. */
    private readonly derived = new Map<string, number>();
    /** Template locals for the formatTemplate call in progress. */
    private locals: Record<string, number> = EMPTY_LOCALS;
    private readonly polar: boolean;
    private readonly vars: [string, string];
    private readonly aliases: [string[], string[]];
    private readonly allVariableNames: Set<string>;
    /** Sliders that cannot work (named like an axis variable), as chart issues. */
    private readonly paramProblems: ParameterIssue[] = [];
    private readonly toolSet: Set<string>;
    private readonly recs: FnRec[] = [];
    private readonly byName = new Map<string, FnRec>();
    private readonly envs = new Map<string, Env>();
    private readonly closures = new Lru<string, Compiled | ExprError>(512);
    private readonly condMemo = new Lru<string, CompiledClause[][] | ExprError>(256);
    private readonly eqMemo = new Lru<string, { F: Compiled; plan: AffinePlan | null } | ExprError>(128);
    private readonly listMemo = new Lru<string, Compiled[] | ExprError>(128);
    private readonly tupleMemo = new Lru<string, Array<Compiled[] | string> | ExprError>(128);
    private readonly depsMemo = new Lru<string, DepSets>(512);
    private _version = 0;
    private _paramsKey: string | null = null;
    private _callable: string[] | null = null;

    /**
     * Create (or reuse) a context. Memoized on a structure key built from
     * parameter NAMES, function name/expression/expressionY/domain/kind/
     * hidden, polar, variables and toolNames. Parameter VALUES are not part
     * of the key: a memo hit gets `setParams(input.parameters)` applied.
     * Callers with the same structure share one instance (LRU of 16), so
     * call setParams before every evaluation. Use new MathContext(input)
     * for a private context.
     * Optional v4 addition: `opts.memo === false` builds a fresh context
     * without reading or writing the memo (no LRU churn while a drag
     * rewrites function texts every frame). Default true (unchanged).
     */
    static create(input: MathContextInput, opts?: { memo?: boolean }): MathContext {
        const inp = input || {};
        if (opts && opts.memo === false) return new MathContext(inp);
        const key = structureKey(inp);
        const hit = CONTEXT_CACHE.get(key);
        if (hit) {
            hit.setParams(Array.isArray(inp.parameters) ? inp.parameters : []);
            return hit;
        }
        const ctx = new MathContext(inp);
        CONTEXT_CACHE.set(key, ctx);
        return ctx;
    }

    /** True when `src` is a plain finite numeric literal like '3', '-0.5', '1e3' (not '1e400'). */
    static isNumericLiteral(src: unknown): boolean {
        if (typeof src === 'number') return Number.isFinite(src);
        return typeof src === 'string' && NUMERIC_LITERAL_RE.test(src) && Number.isFinite(Number(src));
    }

    /** Prefer `MathContext.create`, which memoizes contexts by structure. */
    constructor(input: MathContextInput = {}) {
        this.polar = !!input.polar;
        this.vars = parseVariables(input.variables);
        const [v1, v2] = this.vars;
        // Explicit names win: with variables 'y, x' the name x means the second axis.
        const first = ['x', v1].filter((n, i, all) => all.indexOf(n) === i && !(n === 'x' && v2 === 'x'));
        const second = ['y', v2].filter((n, i, all) => all.indexOf(n) === i && !(n === 'y' && v1 === 'y'));
        this.aliases = [first, second];
        this.allVariableNames = new Set([...VARIABLE_NAMES, ...first, ...second]);
        const axisNames = new Set([...first, ...second]);
        for (const p of Array.isArray(input.parameters) ? input.parameters : []) {
            if (!p || typeof p.name !== 'string' || !NAME_RE.test(p.name) || this.paramIndex.has(p.name)) continue;
            if (axisNames.has(p.name)) {
                // The name means the axis everywhere; the slider is reported instead of shadowing it.
                if (!this.paramProblems.some((i) => i.source === p.name)) {
                    this.paramProblems.push({ source: p.name, message: `${p.name} is an axis variable: rename the slider or the axis`, severity: 'error' });
                }
                continue;
            }
            this.paramIndex.set(p.name, this.vals.length);
            this.paramNames.push(p.name);
            this.vals.push(Number(p.value));
        }
        this.toolSet = new Set((Array.isArray(input.toolNames) ? input.toolNames : []).filter((t) => typeof t === 'string'));
        this.buildFunctions(Array.isArray(input.functions) ? input.functions : []);
    }

    /** Monotonic counter bumped by setParams / setDerived. */
    get version(): number {
        return this._version;
    }

    /** 'a=1.5|b=2' style key of the current parameter values (cheap, for caches). */
    get paramsKey(): string {
        if (this._paramsKey === null) {
            this._paramsKey = this.paramNames.map((n, i) => `${n}=${this.vals[i]}`).join('|');
        }
        return this._paramsKey;
    }

    /**
     * Problems of the sliders themselves (structural, so they never change
     * with values): a slider named like an axis variable is left out and
     * reported here, source = its name. Hosts add these to the chart's issues.
     */
    parameterIssues(): ParameterIssue[] {
        return this.paramProblems.map((i) => ({ ...i }));
    }

    /** Aliases accepted for the first and second axis variable, e.g. [['x', 'x1'], ['y', 'x2']]. */
    get axisAliases(): [string[], string[]] {
        return [this.aliases[0].slice(), this.aliases[1].slice()];
    }

    /** Update parameter values in place (no recompilation). Unknown names are ignored. */
    setParams(params: Parameter[]): void {
        let changed = false;
        for (const p of Array.isArray(params) ? params : []) {
            if (!p || typeof p.name !== 'string') continue;
            const slot = this.paramIndex.get(p.name);
            if (slot === undefined) continue;
            const v = Number(p.value);
            if (!Object.is(this.vals[slot], v)) {
                this.vals[slot] = v;
                changed = true;
            }
        }
        if (changed) {
            this._version++;
            this._paramsKey = null;
        }
    }

    /**
     * Optional v4 addition: set slider values by name in place (unknown
     * names ignored); bumps `version` when something changed. Same effect as
     * setParams with partial Parameter objects.
     */
    setParamValues(values: Record<string, number>): void {
        let changed = false;
        for (const [name, value] of Object.entries(values || {})) {
            const slot = this.paramIndex.get(name);
            if (slot === undefined) continue;
            const v = Number(value);
            if (!Object.is(this.vals[slot], v)) {
                this.vals[slot] = v;
                changed = true;
            }
        }
        if (changed) {
            this._version++;
            this._paramsKey = null;
        }
    }

    /** Optional v4 addition: copy of the current derived values (P1_x, ...), e.g. to freeze them in a private context. */
    derivedValues(): DerivedValues {
        const out: DerivedValues = {};
        this.derived.forEach((v, k) => {
            out[k] = v;
        });
        return out;
    }

    /**
     * Optional v4 addition: the Env a field kind compiles against (public
     * wrapper of the private env()), for callers that compile ASTs
     * themselves with expr.compile (the drag engine). `fnKind` only matters
     * for 'fn1' (default cartesian).
     */
    envFor(field: 'fn1' | 'fn2' | 'value', fnKind?: FunctionKind): Env {
        return this.env(field, fnKind || 'cartesian', null);
    }

    /** Replace all derived values (scene calls this before evaluating dependents). */
    setDerived(values: DerivedValues): void {
        const next: Array<[string, number]> = [];
        for (const [k, v] of Object.entries(values || {})) {
            if (typeof v === 'number') next.push([k, v]);
        }
        let changed = next.length !== this.derived.size;
        if (!changed) {
            for (const [k, v] of next) {
                const old = this.derived.get(k);
                if (old === undefined || !Object.is(old, v)) {
                    changed = true;
                    break;
                }
            }
        }
        if (!changed) return;
        this.derived.clear();
        for (const [k, v] of next) this.derived.set(k, v);
        this._version++;
    }

    // ------------------------------------------------------------ compile
    // Compile-time problems (syntax, unknown names, wrong variable, calling a
    // parametric function, cycles) throw ExprError synchronously. The
    // returned callables never throw: runtime failures yield NaN.

    /**
     * One-variable function body. `kind` picks the variable aliases:
     * cartesian = first axis alias list, parametric = ['t', 'x'],
     * polar = ['theta', 'θ', 'x', 't'].
     */
    fn1(src: string, kind?: FunctionKind): (v: number) => number {
        // The closure takes (a, b); one-variable bodies never read b.
        return this.compileField('fn1', kind || 'cartesian', str(src), null) as unknown as (v: number) => number;
    }

    /** Expression in the two axis variables. Bare user-function names mean f(x). */
    fn2(src: string): (x: number, y: number) => number {
        return this.compileField('fn2', 'cartesian', str(src), null);
    }

    /**
     * Region condition entries -> constraint structure. `a <= b` becomes
     * g = a - b, `a >= b` becomes g = b - a (strictness ignored). Chains
     * split into clauses; `,` `;` `and` `&&` AND clauses; `or` `||` separate
     * disjuncts (and binds tighter). `=` is an error ("use <= or >=").
     * Empty / whitespace-only entries are skipped. Errors name the entry:
     * "condition 2: Unknown name 'b'".
     */
    conditions(entries: string[]): ConditionEntry[] {
        const out: ConditionEntry[] = [];
        (Array.isArray(entries) ? entries : []).forEach((raw, i) => {
            const src = str(raw);
            if (!src.trim()) return;
            let structure: CompiledClause[][];
            try {
                structure = this.conditionStructure(src);
            } catch (e) {
                throw prefixed(e, `condition ${i + 1}`, i);
            }
            out.push({
                entry: i,
                disjuncts: structure.map((clauses) =>
                    clauses.map((c) => ({ g: c.g, affine: c.plan ? c.plan() : null, text: c.text }))
                ),
            });
        });
        return out;
    }

    /** 'lhs = rhs' -> F = lhs - rhs; bare expression -> F. */
    equation(src: string): { F: (x: number, y: number) => number; affine: Affine | null } {
        const s = str(src);
        let hit = this.eqMemo.get(s);
        if (!hit) {
            try {
                if (!s.trim()) throw new ExprError('Enter an equation, e.g. 2x + 3y = 12', { pos: 0 });
                const ast = parse(s, 'eq');
                if (ast.t === 'cmp' || ast.t === 'logic') {
                    throw new ExprError('Use = in an equation (inequalities belong in a region)', { pos: ast.s });
                }
                const env = this.env('fn2', 'cartesian', null);
                hit = { F: compile(ast, env, s), plan: linearPlan(ast, env) };
            } catch (e) {
                hit = asExprError(e);
            }
            this.eqMemo.set(s, hit);
        }
        if (hit instanceof ExprError) throw hit;
        return { F: hit.F, affine: hit.plan ? hit.plan() : null };
    }

    // ----------------------------------------------------------- evaluate

    /** Constant expression. Never throws: returns `fallback` (default NaN) on any problem. Numbers pass through. */
    value(src: string | number | null | undefined, fallback?: number): number {
        const fb = fallback === undefined ? NaN : fallback;
        if (typeof src === 'number') return Number.isFinite(src) ? src : fb;
        const s = str(src);
        if (!s.trim()) return fb;
        if (NUMERIC_LITERAL_RE.test(s)) {
            // '1e400' overflows to Infinity: as much a problem as '1/0'.
            const n = Number(s);
            return Number.isFinite(n) ? n : fb;
        }
        try {
            const v = this.compileField('value', 'cartesian', s, null)(NaN, NaN);
            return Number.isFinite(v) ? v : fb;
        } catch {
            return fb;
        }
    }

    /** Like value(), but reports the problem. Non-finite results are an error ("is not a finite number"). */
    tryValue(src: string | number | null | undefined): { ok: true; value: number } | ({ ok: false } & Issue) {
        try {
            return { ok: true, value: this.strictValue(src) };
        } catch (e) {
            return issueOf(e);
        }
    }

    /** Comma-separated values ('2, 4, c'). Throws ExprError naming the item. Empty string -> []. */
    values(src: string): number[] {
        const s = str(src);
        if (!s.trim()) return [];
        let fs = this.listMemo.get(s);
        if (!fs) {
            try {
                const items = parseList(s);
                const env = this.env('value', 'cartesian', null);
                fs = items.map((node, i) => {
                    try {
                        return compile(node, env, s);
                    } catch (e) {
                        throw prefixed(e, `value ${i + 1}`, i);
                    }
                });
            } catch (e) {
                fs = asExprError(e);
            }
            this.listMemo.set(s, fs);
        }
        if (fs instanceof ExprError) throw fs;
        return fs.map((f, i) => {
            const v = f(NaN, NaN);
            if (!Number.isFinite(v)) throw new NonFiniteError(`value ${i + 1} is not a finite number`, { index: i });
            return v;
        });
    }

    /**
     * 'a:b' split at the depth-0 ':' that is not part of a ternary. Throws
     * ExprError when malformed / non-finite / a >= b, unless `fallback` is
     * given, in which case the fallback is returned instead.
     */
    domain(src: string | null | undefined, fallback?: [number, number]): [number, number] {
        try {
            return this.strictDomain(str(src));
        } catch (e) {
            if (fallback) return fallback;
            throw e;
        }
    }

    /**
     * '(1, 2); (3, max(4, 5))' -> [[1, 2], [3, 5]]. Split at depth-0 ';',
     * each item must be one parenthesised tuple of exactly `dim` values.
     * Throws ExprError naming the 1-based item index.
     */
    tuples(src: string, dim: 2 | 3): number[][] {
        return this.pointList(str(src), dim, false).map((e) => {
            if ('name' in e) throw new ExprError('Write a point as (x, y)');
            return e.point;
        });
    }

    /**
     * Segment path: like `tuples`, but an entry may also be the name of a
     * tool in `toolNames` (whose points the scene splices in). Throws
     * ExprError naming the 1-based entry. Optional v4 addition.
     */
    path(src: string, dim: 2 | 3): PathEntry[] {
        return this.pointList(str(src), dim, true);
    }

    /**
     * Interpolate `{expr}` (up to 3 decimals, trailing zeros trimmed) and
     * `{expr:n}` (n decimals, trimmed) in a label template. `locals` adds
     * names visible only inside the braces (x, y, val, i, level, ...).
     * Text outside braces is returned unchanged ('$...$' math stays as is).
     * A failing placeholder renders as '?'. `{{` and `}}` are literal braces.
     */
    formatTemplate(template: string, locals?: Record<string, number>): string {
        const t = str(template);
        if (t.indexOf('{') < 0 && t.indexOf('}') < 0) return t;
        const names = locals ? Object.keys(locals).sort() : null;
        const prev = this.locals;
        this.locals = locals || EMPTY_LOCALS;
        try {
            let out = '';
            for (const part of scanTemplate(t).parts) {
                if (part.kind === 'text') {
                    out += part.text;
                    continue;
                }
                let v = NaN;
                try {
                    v = this.compileField('value', 'cartesian', part.expr, names)(NaN, NaN);
                } catch {
                    v = NaN;
                }
                out += Number.isFinite(v) ? formatFixed(v, part.decimals === null ? 3 : part.decimals) : '?';
            }
            return out;
        } finally {
            this.locals = prev;
        }
    }

    // --------------------------------------------------------------- info

    /** Info for a function by name (any kind), or null. */
    functionInfo(name: string): FunctionInfo | null {
        const rec = this.byName.get(name);
        return rec ? rec.info : null;
    }

    /** All functions in list order (including hidden ones and ones with errors). */
    functions(): FunctionInfo[] {
        return this.recs.map((r) => r.info);
    }

    /** Names usable as f(u) in expressions (cartesian + polar, not parametric, no error). */
    callableNames(): string[] {
        if (!this._callable) {
            this._callable = this.recs
                .filter((r) => r.kind !== 'parametric' && !r.error && this.byName.get(r.name) === r)
                .map((r) => r.name);
        }
        return this._callable.slice();
    }

    /**
     * Identifiers `src` depends on, transitively through user functions.
     * Unparseable source -> all empty.
     */
    deps(src: string): { params: string[]; functions: string[]; derived: string[]; tools: string[] } {
        const d = this.depSets(str(src));
        return {
            params: Array.from(d.params),
            functions: Array.from(d.functions),
            derived: Array.from(d.derived),
            tools: Array.from(d.tools),
        };
    }

    /**
     * Cache key for results computed from `srcs`: current values of the
     * referenced parameters and derived names plus the source/domain of the
     * referenced functions. Equal keys guarantee equal evaluation results.
     */
    depsKey(srcs: string[]): string {
        const params = new Set<string>();
        const derived = new Set<string>();
        const fns = new Set<string>();
        for (const src of Array.isArray(srcs) ? srcs : []) {
            const d = this.depSets(str(src));
            d.params.forEach((p) => params.add(p));
            d.derived.forEach((p) => derived.add(p));
            d.functions.forEach((p) => fns.add(p));
        }
        // Variables and polar change how every source resolves, so they are always part of the key.
        const parts: string[] = [`v=${this.vars.join(',')}${this.polar ? ':polar' : ''}`];
        for (const p of Array.from(params).sort()) {
            const slot = this.paramIndex.get(p);
            parts.push(`${p}=${slot === undefined ? 'NaN' : this.vals[slot]}`);
        }
        for (const d of Array.from(derived).sort()) {
            const s = this.derivedScalar(d);
            parts.push(`${d}=${s ? s.read() : NaN}`);
        }
        for (const f of Array.from(fns).sort()) {
            const rec = this.byName.get(f);
            if (rec) parts.push(`${f}:${rec.kind}:${rec.expression}|${rec.expressionY}|${rec.domainSrc}|${rec.hidden ? 1 : 0}`);
        }
        return parts.join(';');
    }

    /**
     * Validate a field; see ValidateKind. Includes quick-fix suggestions.
     * For 'template', `locals` are the names the label's caller passes to
     * formatTemplate (see LABEL_LOCALS); none when omitted, exactly like
     * formatTemplate without locals.
     */
    validate(src: string, kind: ValidateKind, fnKind?: FunctionKind, locals?: readonly string[]): ValidateResult {
        const s = str(src);
        try {
            switch (kind) {
                case 'fn1':
                    this.fn1(s, fnKind);
                    break;
                case 'fn2':
                    this.fn2(s);
                    break;
                case 'value':
                    this.strictValue(s);
                    break;
                case 'domain':
                    if (s.trim()) this.strictDomain(s);
                    break;
                case 'condition':
                    if (s.trim()) this.conditionStructure(s);
                    break;
                case 'equation':
                    this.equation(s);
                    break;
                case 'levels':
                    this.values(s);
                    break;
                case 'tuples2':
                case 'tuples3':
                    this.tuples(s, kind === 'tuples2' ? 2 : 3);
                    break;
                case 'path2':
                case 'path3':
                    this.path(s, kind === 'path2' ? 2 : 3);
                    break;
                case 'template':
                    // The sorted key formatTemplate compiles with: one code path, one cache entry.
                    this.checkTemplate(s, locals ? Array.from(locals).sort() : null);
                    break;
            }
            return { ok: true };
        } catch (e) {
            // A number that is only missing because a derived name (P1_x) has
            // not been computed yet is not the user's mistake.
            if (e instanceof NonFiniteError && this.depSets(s).derived.size > 0) return { ok: true };
            return issueOf(e);
        }
    }

    // ---------------------------------------------------------- translate

    /**
     * pgfmath text for export. Parameters and derived names are substituted
     * as numbers (via fmtNum, parenthesised when negative); user-function
     * calls are inlined with their argument substituted and, when the callee
     * has a domain [a, b], guarded as `(((u)>=(a)) && ((u)<=(b))) ? (body) : nan`;
     * every binary and ternary subexpression is parenthesised (pgfmath groups
     * `^` and `?:` left-to-right and gives && and || equal precedence);
     * builtins mapped per the table in SPEC.md section 2.4; the variable(s)
     * renamed to `outVars` (default ['x', 'y']). Where pgfmath would abort
     * the document or disagree with the preview (`a % b`, asin / acos
     * outside [-1, 1], `!` / `&&` / `||` / `?:` on non-boolean values), the
     * output spells out the JavaScript semantics instead.
     * Throws ExprError like the compile functions.
     */
    pgf(src: string, kind: 'fn1' | 'fn2' | 'value', opts?: { fnKind?: FunctionKind; outVars?: [string, string] }): string {
        const s = str(src);
        const fnKind = (opts && opts.fnKind) || 'cartesian';
        const outVars = (opts && opts.outVars) || ['x', 'y'];
        // Same compile path as evaluation, so errors (and quick fixes) match.
        this.compileField(kind, kind === 'fn1' ? fnKind : 'cartesian', s, null);
        const env = this.env(kind, kind === 'fn1' ? fnKind : 'cartesian', null);
        return toPgf(parse(s), env, kind === 'fn1' ? [outVars[0]] : [outVars[0], outVars[1]], fmtNum);
    }

    /** LaTeX math source (no delimiters) for a legend entry: '2x^2 + \\sin(x)', '\\le', '\\cdot', '\\sqrt{u}', 'a_{1}'. */
    tex(src: string): string {
        const s = str(src);
        try {
            return toTex(parse(s, 'eq'));
        } catch {
            return `\\mbox{${texText(s)}}`;
        }
    }

    // ----------------------------------------------------------- private

    private compileField(field: FieldKind, fnKind: FunctionKind, src: string, locals: string[] | null): Compiled {
        const key = `${field}|${fnKind}|${locals ? locals.join(',') : ''}|${src}`;
        const hit = this.closures.get(key);
        if (hit) {
            if (hit instanceof ExprError) throw hit;
            return hit;
        }
        try {
            const f = compile(parse(src), this.env(field, fnKind, locals), src);
            this.closures.set(key, f);
            return f;
        } catch (e) {
            const err = asExprError(e);
            this.closures.set(key, err);
            throw err;
        }
    }

    private strictValue(src: string | number | null | undefined): number {
        if (typeof src === 'number') {
            if (!Number.isFinite(src)) throw new NonFiniteError('Not a finite number');
            return src;
        }
        const s = str(src);
        if (!s.trim()) throw new ExprError('Enter a value', { pos: 0 });
        if (NUMERIC_LITERAL_RE.test(s)) {
            const n = Number(s);
            if (!Number.isFinite(n)) throw new NonFiniteError(`${shortText(s)} is not a finite number`, { pos: 0 });
            return n;
        }
        const v = this.compileField('value', 'cartesian', s, null)(NaN, NaN);
        if (!Number.isFinite(v)) throw new NonFiniteError(`${shortText(s)} is not a finite number`, { pos: 0 });
        return v;
    }

    private strictDomain(s: string): [number, number] {
        if (!s.trim()) throw new ExprError('Domain is empty', { pos: 0 });
        const colon = topLevelColon(s);
        if (colon === null) {
            tokenize(s);
            throw new ExprError('Write the domain as min:max, e.g. -5:5', { pos: 0 });
        }
        if (colon < 0) throw new ExprError('Write the domain as min:max, e.g. -5:5', { pos: 0 });
        const lo = this.bound(s, 0, colon, 'min');
        const hi = this.bound(s, colon + 1, s.length, 'max');
        if (!(lo < hi)) throw new ExprError('Domain min must be less than max', { pos: 0 });
        return [lo, hi];
    }

    private bound(full: string, start: number, end: number, which: 'min' | 'max'): number {
        const part = full.slice(start, end);
        if (!part.trim()) throw new ExprError(`Domain ${which} is missing`, { pos: start });
        if (NUMERIC_LITERAL_RE.test(part)) {
            const n = Number(part);
            if (!Number.isFinite(n)) throw new NonFiniteError(`Domain ${which} is not a finite number`, { pos: start });
            return n;
        }
        let f: Compiled;
        try {
            f = this.compileField('value', 'cartesian', part, null);
        } catch (e) {
            throw relocate(e, full, start, part.length);
        }
        const v = f(NaN, NaN);
        if (!Number.isFinite(v)) throw new NonFiniteError(`Domain ${which} is not a finite number`, { pos: start });
        return v;
    }

    private pointList(s: string, dim: 2 | 3, names: boolean): PathEntry[] {
        if (!s.trim()) return [];
        const key = `${dim}|${names ? 1 : 0}|${s}`;
        let st = this.tupleMemo.get(key);
        if (!st) {
            try {
                const env = this.env('value', 'cartesian', null);
                st = parseTuples(s, names).map((item: TupleItem, i) => {
                    if (item.kind === 'name') {
                        if (!this.toolSet.has(item.name)) {
                            throw new ExprError(`point ${i + 1}: '${item.name}' is not a points tool`, { pos: item.s, index: i });
                        }
                        return item.name;
                    }
                    if (item.items.length !== dim) {
                        const shape = dim === 2 ? '(x, y)' : '(x, y, z)';
                        throw new ExprError(`point ${i + 1}: write it as ${shape}`, { pos: item.s, index: i });
                    }
                    return item.items.map((node) => {
                        try {
                            return compile(node, env, s);
                        } catch (e) {
                            throw prefixed(e, `point ${i + 1}`, i);
                        }
                    });
                });
            } catch (e) {
                const err = asExprError(e);
                st = err.index !== undefined && !/^point \d+:/.test(err.message) ? prefixed(err, `point ${err.index + 1}`, err.index) : err;
            }
            this.tupleMemo.set(key, st);
        }
        if (st instanceof ExprError) throw st;
        return st.map((entry, i) => {
            if (typeof entry === 'string') return { name: entry };
            return {
                point: entry.map((f, j) => {
                    const v = f(NaN, NaN);
                    if (!Number.isFinite(v)) {
                        throw new NonFiniteError(`point ${i + 1}: coordinate ${j + 1} is not a finite number`, { index: i });
                    }
                    return v;
                }),
            };
        });
    }

    private checkTemplate(t: string, names: string[] | null): void {
        const scanned = scanTemplate(t);
        if (scanned.error) throw new ExprError(scanned.error.message, { pos: scanned.error.pos });
        for (const part of scanned.parts) {
            if (part.kind !== 'expr') continue;
            if (!part.expr.trim()) throw new ExprError('Empty {} in the label', { pos: part.offset - 1 });
            try {
                this.compileField('value', 'cartesian', part.expr, names);
            } catch (e) {
                throw relocate(this.localElsewhere(e, part.expr, names), t, part.offset, part.expr.length);
            }
        }
    }

    /**
     * `{val}` in a title, `{level}` in a points label: the failing name is a
     * template local of another kind of label. Say so instead of offering a
     * slider that would silently take the local's place.
     */
    private localElsewhere(e: unknown, expr: string, names: string[] | null): unknown {
        const err = asExprError(e);
        const token = (identifierTokens(expr) || []).find((t) => t.pos === err.pos);
        if (!token || !Object.prototype.hasOwnProperty.call(LOCAL_HOMES, token.text)) return e;
        if ((names && names.includes(token.text)) || this.paramIndex.has(token.text)) return e;
        return new ExprError(`{${token.text}} is only available in ${LOCAL_HOMES[token.text]}`, { pos: token.pos });
    }

    private conditionStructure(src: string): CompiledClause[][] {
        let hit = this.condMemo.get(src);
        if (!hit) {
            try {
                const ast = parse(src, 'cond');
                const env = this.env('fn2', 'cartesian', null);
                hit = toDnf(ast, false, src).map((clauses) =>
                    clauses.map((c) => {
                        // g <= 0 inside: a <= b -> a - b, a >= b -> b - a.
                        const le = c.op === '<' || c.op === '<=';
                        const node: BinaryNode = {
                            t: 'binary',
                            op: '-',
                            left: le ? c.lhs : c.rhs,
                            right: le ? c.rhs : c.lhs,
                            s: c.lhs.s,
                            e: c.rhs.e,
                        };
                        return {
                            g: compile(node, env, src),
                            plan: linearPlan(node, env),
                            text: `${sliceText(src, c.lhs)} ${c.op} ${sliceText(src, c.rhs)}`,
                        };
                    })
                );
            } catch (e) {
                hit = asExprError(e);
            }
            this.condMemo.set(src, hit);
        }
        if (hit instanceof ExprError) throw hit;
        return hit;
    }

    private depSets(src: string): DepSets {
        const hit = this.depsMemo.get(src);
        if (hit) return hit;
        const out: DepSets = { params: new Set(), functions: new Set(), derived: new Set(), tools: new Set() };
        const collect = (text: string) => {
            const tokens = identifierTokens(text);
            if (!tokens) return;
            for (const t of tokens) {
                const name = t.text;
                if (this.paramIndex.has(name)) {
                    out.params.add(name);
                } else if (this.byName.has(name)) {
                    if (out.functions.has(name)) continue;
                    out.functions.add(name);
                    const rec = this.byName.get(name);
                    if (rec) {
                        collect(rec.expression);
                        collect(rec.expressionY);
                        collect(rec.domainSrc);
                    }
                } else if (this.toolSet.has(name)) {
                    out.tools.add(name);
                } else {
                    const m = this.derivedMatch(name);
                    if (m) {
                        out.derived.add(name);
                        out.tools.add(m.tool);
                    }
                }
            }
        };
        if (identifierTokens(src)) collect(src);
        this.depsMemo.set(src, out);
        return out;
    }

    /** `P1_x2` -> { tool: 'P1', key: 'P1_x2', alt: null }; `P1_x` / `P1_x1` read each other. */
    private derivedMatch(name: string): { tool: string; key: string; alt: string | null } | null {
        const m = DERIVED_RE.exec(name);
        if (!m || !this.toolSet.has(m[1])) return null;
        const [, tool, field, digits] = m;
        if (digits) {
            if (field !== 'x' && field !== 'y' && field !== 'z') return null;
            const k = Number(digits);
            if (!(k >= 1) || digits[0] === '0') return null;
            return { tool, key: name, alt: k === 1 ? `${tool}_${field}` : null };
        }
        return { tool, key: name, alt: field === 'x' || field === 'y' || field === 'z' ? `${name}1` : null };
    }

    private derivedScalar(name: string): Scalar | null {
        const m = this.derivedMatch(name);
        if (!m) return null;
        const map = this.derived;
        const { key, alt } = m;
        return {
            kind: 'derived',
            read: () => {
                let v = map.get(key);
                if (v === undefined && alt !== null) v = map.get(alt);
                return v === undefined ? NaN : v;
            },
        };
    }

    private env(field: FieldKind, fnKind: FunctionKind, locals: string[] | null): Env {
        const key = `${field}|${field === 'fn1' ? fnKind : ''}|${locals ? locals.join(',') : ''}`;
        let env = this.envs.get(key);
        if (!env) {
            env = this.makeEnv(field, fnKind, locals);
            this.envs.set(key, env);
        }
        return env;
    }

    private makeEnv(field: FieldKind, fnKind: FunctionKind, locals: string[] | null): Env {
        let vars: string[][];
        if (field === 'value') vars = [];
        else if (field === 'fn2') vars = [this.aliases[0], this.aliases[1]];
        else if (fnKind === 'parametric') vars = [PARAMETRIC_VARS];
        else if (fnKind === 'polar') vars = [POLAR_VARS];
        else vars = [this.aliases[0]];
        const usable = new Set(vars.flat());
        const localSet = new Set(locals || []);
        const scalars = new Map<string, Scalar | null>();
        const [v1, v2] = this.vars;
        let hint: string;
        if (field === 'value') hint = 'this field takes a number';
        else if (field === 'fn2') hint = `use ${v1} and ${v2}`;
        else if (fnKind === 'parametric') hint = 'x(t) and y(t) use t only';
        else if (fnKind === 'polar') hint = 'r(theta) uses theta only';
        else hint = `f(${v1}) uses ${v1} only`;
        /** `P1_q`: the tool part names an existing tool. */
        const toolPart = (name: string): string | null => {
            const m = /^(.+)_[A-Za-z0-9]+$/.exec(name);
            return m && this.toolSet.has(m[1]) ? m[1] : null;
        };
        const readLocal = (name: string): number => {
            const v = Object.prototype.hasOwnProperty.call(this.locals, name) ? this.locals[name] : undefined;
            return typeof v === 'number' ? v : NaN;
        };
        return {
            vars,
            scalar: (name: string): Scalar | null => {
                const cached = scalars.get(name);
                if (cached !== undefined) return cached;
                let s: Scalar | null = null;
                if (localSet.has(name)) {
                    s = { kind: 'local', read: () => readLocal(name) };
                } else {
                    const slot = this.paramIndex.get(name);
                    if (slot !== undefined) {
                        const vals = this.vals;
                        s = { kind: 'param', read: () => vals[slot] };
                    } else {
                        s = this.derivedScalar(name);
                    }
                }
                scalars.set(name, s);
                return s;
            },
            fn: (name: string): FnRef | null => {
                const rec = this.byName.get(name);
                return rec ? rec.ref : null;
            },
            bareFnError: (name: string): string | null => {
                if (field === 'value') return `${name} needs an argument here, e.g. ${name}(1)`;
                if (field === 'fn2' && this.polar) return `${name} needs an argument here, e.g. ${name}(theta)`;
                return null;
            },
            notHere: (name: string): string | null => {
                if (this.allVariableNames.has(name) && !usable.has(name)) return `${name} is not available here: ${hint}`;
                if (this.toolSet.has(name)) return `'${name}' is a tool: use ${name}_x, ${name}_y or ${name}_val`;
                const tool = toolPart(name);
                if (tool) return `Unknown name '${name}' (${tool} provides ${tool}_x, ${tool}_y, ${tool}_z, ${tool}_val, ${tool}_n)`;
                return null;
            },
            noSlider: (name: string): boolean => this.toolSet.has(name) || toolPart(name) !== null,
            defaultVars: v1 === 'x' && v2 === 'y',
            knownNames: (): string[] => [...usable, ...this.paramNames, ...localSet, 'pi', 'e'],
            fnNames: (): string[] => this.callableNames(),
        };
    }

    private buildFunctions(list: FunctionParameters[]): void {
        list.forEach((raw, index) => {
            const f = (raw && typeof raw === 'object' ? raw : {}) as Partial<FunctionParameters>;
            const name = typeof f.name === 'string' && NAME_RE.test(f.name) ? f.name : `f${index + 1}`;
            const kind: FunctionKind = f.parametric ? 'parametric' : this.polar ? 'polar' : 'cartesian';
            const rec = this.makeRec(name, index, kind, f);
            this.recs.push(rec);
            // Variables, sliders and builtins resolve before functions, so a clash would silently lose.
            if (isReservedName(name) || this.allVariableNames.has(name)) rec.error = `${name} is a reserved name`;
            else if (this.paramIndex.has(name)) rec.error = `${name} is also a slider name`;
            else if (!this.byName.has(name)) this.byName.set(name, rec);
            else rec.error = `Another function is already named ${name}`;
        });
        // Parse and collect references (bodies and domains).
        for (const rec of this.recs) {
            const refs = new Set<string>();
            try {
                if (!rec.expression.trim()) {
                    throw new ExprError(rec.kind === 'parametric' ? 'Enter x(t)' : 'Enter an expression');
                }
                rec.ast = parse(rec.expression);
                identifiers(rec.ast, refs);
                if (rec.kind === 'parametric') {
                    if (!rec.expressionY.trim()) throw new ExprError('Enter y(t)');
                    rec.astY = parse(rec.expressionY);
                    identifiers(rec.astY, refs);
                }
            } catch (e) {
                if (!rec.error) rec.error = asExprError(e).message;
            }
            for (const t of identifierTokens(rec.domainSrc) || []) refs.add(t.text);
            rec.deps = Array.from(refs).filter((n) => this.byName.has(n));
        }
        this.markCycles();
        for (const rec of this.recs) this.compileRec(rec);
        this._callable = null;
    }

    private makeRec(name: string, index: number, kind: FunctionKind, f: Partial<FunctionParameters>): FnRec {
        const domainSrc = str(f.domain);
        const rec: FnRec = {
            name,
            index,
            kind,
            hidden: !!f.hidden,
            expression: str(f.expression),
            expressionY: str(f.expressionY),
            domainSrc,
            ast: null,
            astY: null,
            body: null,
            bodyY: null,
            deps: [],
            state: 0,
            domVersion: -1,
            dom: null,
            domTol: 0,
            domBad: false,
            ref: null as unknown as FnRef,
            info: null as unknown as FunctionInfo,
        };
        const resolve = () => this.resolveDomain(rec);
        const guarded = (body: () => Compiled | null) => (u: number): number => {
            if (rec.domVersion !== this._version) resolve();
            if (rec.domBad) return NaN;
            const d = rec.dom;
            if (d !== null && !(u >= d[0] - rec.domTol && u <= d[1] + rec.domTol)) return NaN;
            const b = body();
            return b === null ? NaN : b(u, 0);
        };
        const call = guarded(() => rec.body);
        const callY = guarded(() => rec.bodyY);
        rec.ref = {
            name,
            kind,
            get error() {
                return rec.error;
            },
            call,
            get body() {
                return kind === 'parametric' ? null : rec.ast;
            },
            env: this.env('fn1', kind, null),
            domainEmpty: !domainSrc.trim(),
            domain: () => {
                resolve();
                return rec.domBad ? 'invalid' : rec.dom;
            },
        };
        rec.info = {
            name,
            index,
            kind,
            fn: call,
            fnY: kind === 'parametric' ? callY : undefined,
            get domain(): [number, number] | null {
                resolve();
                return rec.dom ? [rec.dom[0], rec.dom[1]] : null;
            },
            hidden: rec.hidden,
            get error() {
                return rec.error;
            },
            get domainError() {
                resolve();
                return rec.domError;
            },
        };
        return rec;
    }

    private resolveDomain(rec: FnRec): void {
        if (rec.domVersion === this._version) return;
        rec.domVersion = this._version;
        rec.dom = null;
        rec.domTol = 0;
        rec.domBad = false;
        rec.domError = undefined;
        if (!rec.domainSrc.trim()) return;
        try {
            const d = this.strictDomain(rec.domainSrc);
            rec.dom = d;
            // Sample loops computing lo + i * (hi - lo) / n may overshoot hi by an ulp.
            rec.domTol = 1e-9 * (d[1] - d[0]);
        } catch (e) {
            rec.domBad = true;
            rec.domError = asExprError(e).message;
        }
    }

    /** Functions on a reference cycle (bodies or domains) get an error naming the cycle. */
    private markCycles(): void {
        const recs = this.recs.filter((r) => this.byName.get(r.name) === r);
        // Tarjan's strongly connected components.
        const index = new Map<FnRec, number>();
        const low = new Map<FnRec, number>();
        const onStack = new Set<FnRec>();
        const stack: FnRec[] = [];
        let counter = 0;
        const sccs: FnRec[][] = [];
        const visit = (v: FnRec) => {
            index.set(v, counter);
            low.set(v, counter);
            counter++;
            stack.push(v);
            onStack.add(v);
            for (const name of v.deps) {
                const w = this.byName.get(name);
                if (!w) continue;
                if (!index.has(w)) {
                    visit(w);
                    low.set(v, Math.min(low.get(v) as number, low.get(w) as number));
                } else if (onStack.has(w)) {
                    low.set(v, Math.min(low.get(v) as number, index.get(w) as number));
                }
            }
            if (low.get(v) === index.get(v)) {
                const comp: FnRec[] = [];
                let w: FnRec | undefined;
                do {
                    w = stack.pop();
                    if (!w) break;
                    onStack.delete(w);
                    comp.push(w);
                } while (w !== v);
                sccs.push(comp);
            }
        };
        for (const r of recs) if (!index.has(r)) visit(r);
        for (const comp of sccs) {
            const members = new Set(comp);
            for (const rec of comp) {
                if (comp.length === 1 && !rec.deps.includes(rec.name)) continue;
                if (rec.error) continue;
                const through = cyclePath(rec, members, this.byName);
                rec.error = through.length ? `${rec.name} refers to itself through ${through.join(', ')}` : `${rec.name} refers to itself`;
            }
        }
    }

    /** Compile a function after everything it references (dependency order). */
    private compileRec(rec: FnRec): void {
        if (rec.state !== 0) return;
        rec.state = 1;
        for (const name of rec.deps) {
            const dep = this.byName.get(name);
            if (dep) this.compileRec(dep);
        }
        if (!rec.error && rec.ast) {
            try {
                const env = this.env('fn1', rec.kind, null);
                rec.body = compile(rec.ast, env, rec.expression);
                if (rec.kind === 'parametric' && rec.astY) rec.bodyY = compile(rec.astY, env, rec.expressionY);
            } catch (e) {
                rec.error = asExprError(e).message;
                rec.body = null;
                rec.bodyY = null;
            }
        }
        rec.state = 2;
    }
}

/** Shortest path rec -> ... -> rec inside one strongly connected component (intermediate names). */
function cyclePath(start: FnRec, members: Set<FnRec>, byName: Map<string, FnRec>): string[] {
    const prev = new Map<FnRec, FnRec>();
    const queue: FnRec[] = [start];
    const seen = new Set<FnRec>();
    while (queue.length) {
        const v = queue.shift() as FnRec;
        for (const name of v.deps) {
            const w = byName.get(name);
            if (!w || !members.has(w)) continue;
            if (w === start) {
                const path: string[] = [];
                let cur: FnRec | undefined = v;
                while (cur && cur !== start) {
                    path.unshift(cur.name);
                    cur = prev.get(cur);
                }
                return path;
            }
            if (seen.has(w)) continue;
            seen.add(w);
            prev.set(w, v);
            queue.push(w);
        }
    }
    return [];
}

/** Condition AST -> disjunctive normal form of atomic comparisons (negation pushed inwards). */
function toDnf(n: Node, neg: boolean, src: string): RawClause[][] {
    switch (n.t) {
        case 'logic': {
            const isAnd = (n.op === '&&') !== neg;
            const l = toDnf(n.left, neg, src);
            const r = toDnf(n.right, neg, src);
            let out: RawClause[][];
            if (isAnd) {
                out = [];
                for (const a of l) for (const b of r) out.push(a.concat(b));
            } else {
                out = l.concat(r);
            }
            if (out.length > MAX_DISJUNCTS) throw new ExprError('This condition is too complex', { pos: n.s });
            return out;
        }
        case 'unary':
            if (n.op === '!') return toDnf(n.arg, !neg, src);
            break;
        case 'cmp': {
            const pairs = n.ops.map((op, i) => clause(n.args[i], op, n.args[i + 1], neg, n.s));
            return neg ? pairs.map((p) => [p]) : [pairs];
        }
        default:
            break;
    }
    throw new ExprError(`'${shortText(src.slice(n.s, n.e))}' is not a condition: use <= or >=`, { pos: n.s });
}

function clause(lhs: Node, op: CmpOp, rhs: Node, neg: boolean, pos: number): RawClause {
    if (op === '==' || op === '!=') throw new ExprError('Use <= or >= in a condition, not == or !=', { pos });
    return { lhs, rhs, op: neg ? NEGATED[op] : op };
}

/** One atomic clause of a condition entry: `lhs op rhs` (g = lhs - rhs for < and <=, rhs - lhs for > and >=). */
export interface ClauseNodes {
    lhs: Node;
    rhs: Node;
    op: '<' | '<=' | '>' | '>=';
}

/**
 * Optional v4 addition: the DNF of one condition entry exactly as
 * conditions() builds it (same disjunct and clause order, negation pushed
 * into `op`). The nodes are the parser's (cached, shared: never mutate
 * them); spans index into `src`. Throws ExprError (no entry prefix) for
 * empty or malformed entries.
 */
export function conditionClauseNodes(src: string): ClauseNodes[][] {
    const s = str(src);
    return toDnf(parse(s, 'cond'), false, s).map((clauses) => clauses.map((c) => ({ lhs: c.lhs, rhs: c.rhs, op: c.op })));
}

function structureKey(input: MathContextInput): string {
    const fns = (Array.isArray(input.functions) ? input.functions : []).map((f, i) => {
        if (!f || typeof f !== 'object') return null;
        return [f.name || `f${i + 1}`, str(f.expression), str(f.expressionY), str(f.domain), !!f.parametric, !!f.hidden];
    });
    return JSON.stringify([
        (Array.isArray(input.parameters) ? input.parameters : []).map((p) => (p ? p.name : null)),
        fns,
        !!input.polar,
        str(input.variables),
        Array.isArray(input.toolNames) ? input.toolNames : [],
    ]);
}

/**
 * Shared number formatting for labels, pgf substitution and TikZ
 * coordinates: at most 6 significant digits, no exponent for |n| in
 * [1e-4, 1e6), trailing zeros trimmed, -0 -> '0'. Non-finite -> 'nan'.
 */
export function fmtNum(n: number): string {
    return formatNumber(n);
}

// ------------------------------------------------------------ label text
// One reading of label text, shared by the export (texLabel), the preview
// (labelDisplayText, labelMathSource) and expression fallbacks (texText),
// so the PDF and the preview agree on what is math, LaTeX and plain text.

function ownValue<T>(table: Record<string, T>, key: string): T | undefined {
    return Object.prototype.hasOwnProperty.call(table, key) ? table[key] : undefined;
}

const TEX_ESCAPES: Record<string, string> = {
    '\\': '\\textbackslash{}',
    '%': '\\%',
    '&': '\\&',
    '#': '\\#',
    _: '\\_',
    '{': '\\{',
    '}': '\\}',
    '~': '\\textasciitilde{}',
    '^': '\\textasciicircum{}',
    // The default OT1 font encoding prints <, > and | as ¡, ¿ and a dash; these work in any encoding.
    '<': '\\textless{}',
    '>': '\\textgreater{}',
    '|': '\\textbar{}',
    // A plain quote that babel shorthands (ngerman, spanish) cannot grab. Not \textquotedbl: OT1 lacks it.
    '"': '\\string"',
};

/** One character of text, printed as typed (a dollar sign that opens no math is \$). */
function escapeChar(ch: string): string {
    if (ch === '$') return '\\$';
    return ownValue(TEX_ESCAPES, ch) ?? ch;
}

/** A stretch of label text: math (`raw` with its delimiters, `src` without) or plain text. */
interface LabelSegment {
    math: boolean;
    raw: string;
    src: string;
}

/**
 * Split label text into math and text: `$...$` / `$$...$$` (paired the
 * way Pandoc and Obsidian do, see dollarMath in src/expr.ts, so
 * '$5 and $10' is text) and `\(...\)`. Backslash pairs stay together in
 * text, so `\$` never opens math.
 */
function labelSegments(text: string): LabelSegment[] {
    const out: LabelSegment[] = [];
    let plain = '';
    const flush = () => {
        if (plain) out.push({ math: false, raw: plain, src: plain });
        plain = '';
    };
    let i = 0;
    while (i < text.length) {
        const ch = text[i];
        if (ch === '$') {
            const m = dollarMath(text, i);
            if (m) {
                flush();
                const open = text[i + 1] === '$' ? 2 : 1;
                out.push({ math: true, raw: text.slice(i, m.end), src: text.slice(i + open, m.close) });
                i = m.end;
                continue;
            }
        } else if (ch === '\\') {
            const close = text[i + 1] === '(' ? text.indexOf('\\)', i + 2) : -1;
            if (close >= 0) {
                flush();
                out.push({ math: true, raw: text.slice(i, close + 2), src: text.slice(i + 2, close) });
                i = close + 2;
                continue;
            }
            plain += text.slice(i, i + 2);
            i += 2;
            continue;
        }
        plain += ch;
        i++;
    }
    flush();
    return out;
}

/** Commands that only work in math mode: outside $...$ texLabel wraps them (and their arguments) in \ensuremath. */
const MATH_ONLY_COMMANDS = new Set([
    // Greek letters
    'alpha', 'beta', 'gamma', 'delta', 'epsilon', 'varepsilon', 'zeta', 'eta', 'theta', 'vartheta', 'iota',
    'kappa', 'lambda', 'mu', 'nu', 'xi', 'pi', 'varpi', 'rho', 'varrho', 'sigma', 'varsigma', 'tau', 'upsilon',
    'phi', 'varphi', 'chi', 'psi', 'omega', 'Gamma', 'Delta', 'Theta', 'Lambda', 'Xi', 'Pi', 'Sigma',
    'Upsilon', 'Phi', 'Psi', 'Omega',
    // operators and relations
    'pm', 'mp', 'times', 'div', 'cdot', 'ast', 'star', 'circ', 'bullet', 'oplus', 'otimes',
    'le', 'leq', 'ge', 'geq', 'ne', 'neq', 'approx', 'sim', 'simeq', 'equiv', 'cong', 'propto', 'll', 'gg',
    // sets and logic
    'in', 'notin', 'ni', 'subset', 'subseteq', 'supset', 'supseteq', 'cup', 'cap', 'setminus', 'emptyset',
    'varnothing', 'forall', 'exists', 'neg', 'lnot', 'land', 'lor', 'wedge', 'vee',
    // arrows
    'to', 'rightarrow', 'leftarrow', 'Rightarrow', 'Leftarrow', 'leftrightarrow', 'Leftrightarrow',
    'longrightarrow', 'mapsto', 'implies', 'iff', 'uparrow', 'downarrow',
    // other symbols
    'infty', 'partial', 'nabla', 'prime', 'angle', 'perp', 'parallel', 'mid', 'cdots', 'vdots', 'ddots',
    // big operators and function names
    'sum', 'prod', 'int', 'oint', 'lim', 'max', 'min', 'sup', 'inf', 'arg', 'sin', 'cos', 'tan', 'cot',
    'sec', 'csc', 'arcsin', 'arccos', 'arctan', 'sinh', 'cosh', 'tanh', 'log', 'ln', 'exp', 'det', 'deg', 'gcd',
    // commands with arguments
    'frac', 'dfrac', 'tfrac', 'sqrt', 'binom', 'mathbf', 'mathrm', 'mathit', 'mathcal', 'mathbb', 'mathsf',
    'mathtt', 'mathfrak', 'boldsymbol', 'operatorname', 'hat', 'bar', 'vec', 'dot', 'ddot', 'tilde',
    'widehat', 'widetilde', 'overline', 'overrightarrow',
]);

/**
 * Control symbols that are LaTeX in text mode (`\%`, `\$`, `\,`, accents
 * such as `\"a`). Not `\\`: a line break aborts a TikZ node without `align`.
 */
const CONTROL_SYMBOLS = new Set(['%', '$', '&', '#', '_', '{', '}', ',', ' ', "'", '`', '^', '~', '"', '=', '.', '-', '/', '@']);

/** Label text read as LaTeX: math, characters printed as typed, groups, control symbols and control words. */
type LabelToken =
    | { k: 'math'; raw: string; src: string }
    | { k: 'char'; ch: string }
    | { k: 'open' }
    | { k: 'close' }
    | { k: 'symbol'; ch: string }
    /** `raw` includes the arguments of a math-only command (\frac{a}{b}). */
    | { k: 'word'; name: string; raw: string; math: boolean };

function labelTokens(text: string): LabelToken[] {
    const out: LabelToken[] = [];
    for (const seg of labelSegments(text)) {
        if (seg.math) {
            out.push({ k: 'math', raw: seg.raw, src: seg.src });
            continue;
        }
        const t = seg.raw;
        let i = 0;
        while (i < t.length) {
            const ch = t[i];
            if (ch !== '\\') {
                out.push({ k: 'char', ch });
                i++;
                continue;
            }
            const word = /^[A-Za-z]+\*?/.exec(t.slice(i + 1));
            if (word) {
                const name = word[0].replace(/\*$/, '');
                const math = MATH_ONLY_COMMANDS.has(name);
                let end = i + 1 + word[0].length;
                // A math-only command takes its arguments along: \frac{a}{b}, \sqrt[3]{x}.
                while (math) {
                    const close = t[end] === '{' ? matchingBrace(t, end) : t[end] === '[' ? t.indexOf(']', end) : -1;
                    if (close < 0) break;
                    end = close + 1;
                }
                out.push({ k: 'word', name, raw: t.slice(i, end), math });
                i = end;
                continue;
            }
            if (i + 1 < t.length && CONTROL_SYMBOLS.has(t[i + 1])) {
                out.push({ k: 'symbol', ch: t[i + 1] });
                i += 2;
                continue;
            }
            // A backslash at the end, before a digit, `(` or another backslash: printed as typed.
            const pair = t[i + 1] === '\\' ? 2 : 1;
            for (let k = 0; k < pair; k++) out.push({ k: 'char', ch });
            i += pair;
        }
    }
    // Braces that pair up are LaTeX groups (\textbf{A}); the others print as typed ('a { b').
    const open: number[] = [];
    out.forEach((tok, j) => {
        if (tok.k !== 'char') return;
        if (tok.ch === '{') open.push(j);
        else if (tok.ch === '}' && open.length) {
            out[open.pop() as number] = { k: 'open' };
            out[j] = { k: 'close' };
        }
    });
    return out;
}

/** Characters whose LaTeX escape (`\$`, `\%`, ...) even texText prints as the character itself. */
const ESCAPED_SPECIALS = '$%&#_{}';

/**
 * Escape text for TikZ so that it prints exactly as typed. Math segments
 * (`$...$`, `$$...$$`, `\(...\)`) pass through; outside them
 * \ % & # _ { } ~ ^ < > | " and a dollar sign that opens no math are
 * escaped, while an escaped special (`\$`, `\%`, `\&`, `\#`, `\_`, `\{`,
 * `\}`) prints as its character. Used for expression source (the fallback
 * of MathContext.tex); label text goes through texLabel.
 */
export function texText(s: string): string {
    let out = '';
    for (const seg of labelSegments(str(s))) {
        if (seg.math) {
            out += seg.raw;
            continue;
        }
        const t = seg.raw;
        for (let i = 0; i < t.length; i++) {
            if (t[i] === '\\' && i + 1 < t.length && ESCAPED_SPECIALS.includes(t[i + 1])) {
                out += '\\' + t[i + 1];
                i++;
            } else {
                out += escapeChar(t[i]);
            }
        }
    }
    return out;
}

/**
 * LaTeX for label text: titles, axis labels, legend entries, annotations
 * and tool labels. Math segments pass through (see texText). Outside
 * math a backslash starts LaTeX: control words (`\textbf`, `\euro`) and
 * control symbols (`\%`, `\$`, `\&`, `\"a`) are copied, and math-only
 * commands (`\alpha`, `\le`, `\frac{a}{b}`) are wrapped in \ensuremath so
 * they work outside $...$ too. Braces that pair up are LaTeX groups.
 * Everything else prints as typed: % & # _ ^ ~ < > | " and unpaired braces
 * are escaped ('50% cut', 'x_1', 'x + y <= 4'), and a dollar sign that
 * opens no math becomes \$ ('costs $5').
 */
export function texLabel(s: string): string {
    let out = '';
    for (const tok of labelTokens(str(s))) {
        switch (tok.k) {
            case 'math':
                out += tok.raw;
                break;
            case 'char':
                out += escapeChar(tok.ch);
                break;
            case 'open':
                out += '{';
                break;
            case 'close':
                out += '}';
                break;
            case 'symbol':
                out += '\\' + tok.ch;
                break;
            case 'word':
                out += tok.math ? `\\ensuremath{${tok.raw}}` : tok.raw;
                break;
        }
    }
    return out;
}

/** Text-mode commands the preview shows as a character. */
const TEXT_SYMBOLS: Record<string, string> = {
    euro: '€', texteuro: '€', EUR: '€', pounds: '£', textsterling: '£', textyen: '¥', textdollar: '$',
    S: '§', P: '¶', dag: '†', ddag: '‡', copyright: '©', textcopyright: '©', textregistered: '®',
    texttrademark: '™', ldots: '…', dots: '…', textellipsis: '…', textdegree: '°', textperthousand: '‰',
    textbullet: '•', textendash: '–', textbackslash: '\\', textasciitilde: '~', textasciicircum: '^',
    textless: '<', textgreater: '>', textbar: '|', textquotedbl: '"', textunderscore: '_', LaTeX: 'LaTeX',
    TeX: 'TeX', ss: 'ß', o: 'ø', O: 'Ø', aa: 'å', AA: 'Å', ae: 'æ', AE: 'Æ', oe: 'œ', OE: 'Œ',
    quad: ' ', qquad: ' ', newline: ' ', linebreak: ' ', par: ' ',
};

/** Style and size commands: the preview shows only the text they style. */
const TEXT_STYLE_COMMANDS = new Set([
    'textbf', 'textit', 'textsl', 'textsc', 'textup', 'textrm', 'textsf', 'texttt', 'textmd', 'textnormal',
    'emph', 'text', 'mbox', 'fbox', 'underline', 'bfseries', 'itshape', 'slshape', 'scshape', 'upshape',
    'mdseries', 'rmfamily', 'sffamily', 'ttfamily', 'normalfont', 'em', 'bf', 'it', 'rm', 'sf', 'tt', 'sl',
    'sc', 'tiny', 'scriptsize', 'footnotesize', 'small', 'normalsize', 'large', 'Large', 'LARGE', 'huge',
    'Huge', 'selectfont', 'strut', 'protect', 'relax',
]);

/** Commands whose first groups are settings, not text: \color{red}, \textcolor{red}{x}, \hspace{1em}. */
const SETTING_GROUPS: Record<string, number> = {
    color: 1, textcolor: 1, colorbox: 1, hspace: 1, vspace: 1, phantom: 1, hphantom: 1, vphantom: 1,
    raisebox: 1, rule: 2, fontsize: 2,
};

/** Combining marks for the text accents \" \' \` \^ \~ \= \. */
const ACCENTS: Record<string, string> = {
    '"': '̈', "'": '́', '`': '̀', '^': '̂', '~': '̃', '=': '̄', '.': '̇',
};

/** Index after `count` groups starting at `from` (fewer when they are not there). */
function skipGroups(toks: LabelToken[], from: number, count: number): number {
    let k = from;
    for (let g = 0; g < count && k < toks.length && toks[k].k === 'open'; g++) {
        let depth = 0;
        for (; k < toks.length; k++) {
            const t = toks[k];
            if (t.k === 'open') depth++;
            else if (t.k === 'close' && --depth === 0) {
                k++;
                break;
            }
        }
    }
    return k;
}

/**
 * Preview text for a label, read exactly as texLabel reads it: math
 * segments and math-only commands go through `mathText` (the renderer's
 * stripLatex, which receives LaTeX source without delimiters); text shows
 * as typed ('x_1' stays 'x_1', '50%' stays '50%'), with LaTeX groups,
 * style commands and control symbols resolved ('\textbf{R\&D}' shows
 * 'R&D', '\"a' shows 'ä').
 */
export function labelDisplayText(s: string, mathText: (src: string) => string): string {
    const toks = labelTokens(str(s));
    let out = '';
    for (let j = 0; j < toks.length; j++) {
        const tok = toks[j];
        switch (tok.k) {
            case 'math':
                out += mathText(tok.src);
                break;
            case 'char':
                out += tok.ch;
                break;
            case 'open':
            case 'close':
                break;
            case 'symbol': {
                const mark = ownValue(ACCENTS, tok.ch);
                const next = toks[j + 1];
                const inner = toks[j + 2];
                if (mark && next && next.k === 'char' && /[A-Za-z]/.test(next.ch)) {
                    out += (next.ch + mark).normalize('NFC');
                    j += 1;
                } else if (mark && next && next.k === 'open' && inner && inner.k === 'char' && toks[j + 3]?.k === 'close') {
                    out += (inner.ch + mark).normalize('NFC');
                    j += 3;
                } else if (tok.ch === ' ' || tok.ch === ',') {
                    out += ' ';
                } else if (tok.ch !== '-' && tok.ch !== '/' && tok.ch !== '@') {
                    out += tok.ch;
                }
                break;
            }
            case 'word': {
                if (tok.math) {
                    out += mathText(tok.raw);
                    break;
                }
                const settings = ownValue(SETTING_GROUPS, tok.name);
                if (settings !== undefined) {
                    j = skipGroups(toks, j + 1, settings) - 1;
                    break;
                }
                if (TEXT_STYLE_COMMANDS.has(tok.name)) break;
                out += ownValue(TEXT_SYMBOLS, tok.name) ?? mathText(tok.raw);
                break;
            }
        }
    }
    return out;
}

/**
 * LaTeX source of a label that is one math segment as a whole ('$x^2$',
 * ' \(y_1\) '), else null. The preview hands such labels to MathJax.
 */
export function labelMathSource(s: string): string | null {
    const segs = labelSegments(str(s).trim());
    return segs.length === 1 && segs[0].math ? segs[0].src : null;
}

/**
 * Rename identifier `from` to `to` in `src` using token positions (never
 * inside `Math.` members, numbers or other identifiers). Returns `src`
 * unchanged when it does not tokenize.
 * Text with `{...}` placeholders is treated as a label template: only the
 * placeholders change. Optional v4 addition: pass `template = true` for
 * label fields so a label without placeholders ('Optimum at a') keeps its
 * plain text.
 */
export function renameIdentifier(src: string, from: string, to: string, template?: boolean): string {
    return renameIdentifierImpl(str(src), from, to, !!template);
}

/**
 * Rename a tool everywhere it can be referenced from math: the bare name
 * (path entries) and its derived names (`P1_x` -> `P3_x`, `P1_val`,
 * `P1_x2`, ...). Optional v4 helper for PanelHost.rename; `template` as in
 * renameIdentifier.
 */
export function renameToolReferences(src: string, from: string, to: string, template?: boolean): string {
    const s = str(src);
    if (!from || from === to) return s;
    return renameTokens(
        s,
        (name) => {
            if (name === from) return to;
            if (name.startsWith(from + '_')) {
                const m = DERIVED_RE.exec(name);
                if (m && m[1] === from) return to + name.slice(from.length);
            }
            return null;
        },
        !!template
    );
}
