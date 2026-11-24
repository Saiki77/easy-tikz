/*
 * 6.0 P: the python blocks of a chart as one program. The blocks run in
 * order and share one module scope; a run is cached by the values of the
 * chart names it reads (sliders, P1_x, ...), so a script runs again only
 * when they change. What it knows before it runs: the names it defines
 * (they become let values of the chart) and the names it reads. After a
 * run: its names, what it drew (pyplot.ts), what it printed, its problem,
 * and `frame(t)` for motion. Pure: no DOM, no Obsidian.
 */
import type { Expr, Stmt } from './ast';
import { parseScript } from './parser';
import { Host, Interpreter, visitExpr } from './interp';
import { PyError } from './errors';
import { LIMITS, withBudget } from './budget';
import { Rng, cmathModule, exceptionTypes, makeBuiltins, mathModule, randomModule } from './builtins';
import { numpyModules } from './numpy';
import { Figure, newFigure, patchesOf, pyplotModule } from './pyplot';
import { callValue } from './ops';
import { NDArray, PyBuiltin, PyComplex, PyExceptionType, PyFunction, PyModule, PyTuple, PyValue, isNum } from './values';
import { fromComplex, fromNumbers, toArray } from './ndarray';
import type { Value } from '../values/types';
import { complex, list, mat, vec } from '../values/types';

/** A parsed block: its statements, or the problem that stopped the parse. */
interface Parsed {
    stmts: Stmt[];
    error: PyError | null;
}

const PARSED = new Map<string, Parsed>();

function parseBlock(code: string): Parsed {
    const hit = PARSED.get(code);
    if (hit) return hit;
    let out: Parsed;
    try {
        out = { stmts: parseScript(code), error: null };
    } catch (e) {
        out = { stmts: [], error: e instanceof PyError ? e : new PyError('SyntaxError', 'python.syntax.invalid') };
    }
    if (PARSED.size > 64) PARSED.delete(PARSED.keys().next().value as string);
    PARSED.set(code, out);
    return out;
}

/** The modules a script may import. */
export const MODULES = ['numpy', 'numpy.linalg', 'numpy.fft', 'numpy.random', 'math', 'cmath', 'random', 'matplotlib', 'matplotlib.pyplot', 'matplotlib.patches'];

/** A name the script defines at the top: a value, or a function with its parameters. */
export interface ScriptName {
    name: string;
    params: string[] | null;
}

export interface RunResult {
    /** The first problem (the run stopped there), with its block. */
    error: PyError | null;
    /** What print() wrote, with the block it ran in. */
    printed: Array<{ block: number; text: string }>;
    figure: Figure;
    globals: Map<string, PyValue>;
    /** `def frame(t)`, when the script has one. */
    frame: PyFunction | null;
    /** Milliseconds the run took. */
    ms: number;
    /** Draw frame(t) into a new figure (the moving part); null after a problem (in `error` of the result). */
    frameAt(t: number): { figure: Figure; error: PyError | null };
    /** Call a function of the script with chart values (a let function of the chart). */
    call(fn: PyValue, args: Value[]): Value;
}

/** The free names of a script: read but never set, not built-in (the chart's sliders and computed names). */
function namesOf(blocks: Stmt[][]): { defined: ScriptName[]; reads: string[] } {
    const stored = new Set<string>();
    const loaded = new Set<string>();
    const defined = new Map<string, ScriptName>();
    const expr = (e: Expr | null) => {
        if (!e) return;
        visitExpr(e, (x) => {
            if (x.k === 'name') loaded.add(x.id);
            else if (x.k === 'walrus') stored.add(x.id);
            else if (x.k === 'lambda') {
                for (const p of x.params) stored.add(p.name);
                expr(x.body);
            } else if (x.k === 'comp') for (const g of x.gens) target(g.target, false);
        });
    };
    const target = (e: Expr, top: boolean, params: string[] | null = null) => {
        if (e.k === 'name') {
            stored.add(e.id);
            if (top) defined.set(e.id, { name: e.id, params });
        } else if (e.k === 'tuple' || e.k === 'list') e.elts.forEach((x) => target(x, top));
        else if (e.k === 'starred') target(e.e, top);
        else expr(e);
    };
    const stmts = (list: Stmt[], top: boolean) => {
        for (const s of list) {
            switch (s.k) {
                case 'expr':
                    expr(s.e);
                    break;
                case 'assign': {
                    expr(s.value);
                    const lam = s.value.k === 'lambda' && s.value.params.every((p) => p.kind === 'normal') ? s.value.params.map((p) => p.name) : null;
                    for (const t of s.targets) target(t, top, lam);
                    break;
                }
                case 'aug':
                    expr(s.value);
                    target(s.target, top);
                    if (s.target.k === 'name') loaded.add(s.target.id);
                    break;
                case 'if':
                case 'while':
                    expr(s.test);
                    stmts(s.body, top);
                    stmts(s.orelse, top);
                    break;
                case 'for':
                    expr(s.iter);
                    target(s.target, top);
                    stmts(s.body, top);
                    stmts(s.orelse, top);
                    break;
                case 'def':
                    stored.add(s.name);
                    for (const p of s.params) {
                        stored.add(p.name);
                        expr(p.def);
                    }
                    if (top) defined.set(s.name, { name: s.name, params: s.params.every((p) => p.kind === 'normal') ? s.params.map((p) => p.name) : null });
                    stmts(s.body, false);
                    break;
                case 'return':
                    expr(s.e);
                    break;
                case 'import':
                    for (const n of s.names) stored.add(n.as ?? n.name.split('.')[0]);
                    break;
                case 'from':
                    for (const n of s.names) stored.add(n.as ?? n.name);
                    break;
                case 'global':
                case 'nonlocal':
                    for (const n of s.names) stored.add(n);
                    break;
                case 'del':
                    s.targets.forEach((t) => expr(t));
                    break;
                case 'assert':
                    expr(s.test);
                    expr(s.msg);
                    break;
                case 'raise':
                    expr(s.e);
                    break;
                case 'try':
                    stmts(s.body, top);
                    for (const h of s.handlers) {
                        expr(h.types);
                        if (h.name) stored.add(h.name);
                        stmts(h.body, top);
                    }
                    stmts(s.orelse, top);
                    stmts(s.final, top);
                    break;
            }
        }
    };
    for (const b of blocks) stmts(b, true);
    const builtins = BUILTIN_NAMES;
    const reads = Array.from(loaded).filter((n) => !stored.has(n) && !builtins.has(n)).sort();
    return { defined: Array.from(defined.values()), reads };
}

const BUILTIN_NAMES: ReadonlySet<string> = new Set(makeBuiltins(() => undefined, exceptionTypes()).keys());

/** Script values as values of the chart (src/values/): numbers, complex numbers, vectors, matrices, lists. Null for anything else. */
export function toChartValue(v: PyValue): Value | null {
    if (typeof v === 'number') return v;
    if (typeof v === 'boolean') return v ? 1 : 0;
    if (v instanceof PyComplex) return complex(v.re, v.im);
    if (v instanceof NDArray) {
        if (v.ndim === 0) return v.imag ? complex(v.data[0], v.imag[0]) : v.data[0];
        if (v.ndim === 1) {
            if (v.dtype === 'complex') {
                const im = v.imag ?? new Float64Array(v.size);
                return list(Array.from(v.data, (re, i) => complex(re, im[i])));
            }
            if (v.size === 2 || v.size === 3) return vec(Array.from(v.data));
            return list(Array.from(v.data));
        }
        if (v.ndim === 2 && v.dtype !== 'complex') {
            const [r, c] = v.shape;
            // Rows of points (n x 2 or n x 3, n not c): a list of points; square and other shapes: a matrix.
            if ((c === 2 || c === 3) && r !== c) {
                const out: Value[] = [];
                for (let i = 0; i < r; i++) out.push(vec(Array.from(v.data.subarray(i * c, (i + 1) * c))));
                return list(out);
            }
            return mat(r, c, Array.from(v.data));
        }
        return null;
    }
    if (v instanceof PyTuple) {
        if ((v.items.length === 2 || v.items.length === 3) && v.items.every((x) => isNum(x))) return vec(v.items.map((x) => Number(x)));
        const items = v.items.map(toChartValue);
        return items.every((x): x is Value => x !== null) ? list(items) : null;
    }
    if (Array.isArray(v)) {
        if (v.length && v.every((row) => Array.isArray(row) && row.length === (v[0] as PyValue[]).length && row.every((x) => isNum(x)))) {
            const rows = v as PyValue[][];
            const c = rows[0].length;
            if (c > 1 && rows.length === c) return mat(c, c, rows.flat().map((x) => Number(x)));
        }
        const items = v.map(toChartValue);
        return items.every((x): x is Value => x !== null) ? list(items) : null;
    }
    return null;
}

/** A chart value as a script value (the arguments of a script function). */
export function fromChartValue(v: Value): PyValue {
    if (typeof v === 'number') return v;
    switch (v.kind) {
        case 'complex':
            return new PyComplex(v.re, v.im);
        case 'vec':
            return fromNumbers(v.v);
        case 'mat':
            return new NDArray([v.rows, v.cols], Float64Array.from(v.a), 'float');
        case 'list':
            if (v.items.every((x) => typeof x === 'number')) return fromNumbers(v.items as number[]);
            if (v.items.every((x) => typeof x === 'number' || x.kind === 'complex')) {
                const re = Float64Array.from(v.items, (x) => (typeof x === 'number' ? x : x.kind === 'complex' ? x.re : NaN));
                const im = Float64Array.from(v.items, (x) => (typeof x !== 'number' && x.kind === 'complex' ? x.im : 0));
                return fromComplex(re, im);
            }
            return v.items.map(fromChartValue);
    }
}

let runs = 0;

/** A program of a chart's python blocks (in order). */
export class Program {
    readonly parsed: Parsed[];
    readonly defined: ScriptName[];
    readonly reads: string[];
    readonly key: string;
    private readonly cache = new Map<string, RunResult>();

    constructor(readonly blocks: readonly string[]) {
        this.parsed = blocks.map(parseBlock);
        const ok: Stmt[][] = [];
        for (const p of this.parsed) {
            if (p.error) break;
            ok.push(p.stmts);
        }
        const names = namesOf(ok);
        this.defined = names.defined;
        this.reads = names.reads;
        this.key = hashText(blocks.join('\u0000'));
    }

    /** Run with the chart names it reads (cached by them). */
    run(inputs: Record<string, number>): RunResult {
        const key = this.reads.map((n) => `${n}=${inputs[n] ?? ''}`).join('|');
        const hit = this.cache.get(key);
        if (hit) return hit;
        const result = this.runNow(inputs);
        if (this.cache.size >= 12) this.cache.delete(this.cache.keys().next().value as string);
        this.cache.set(key, result);
        return result;
    }

    private runNow(inputs: Record<string, number>): RunResult {
        runs++;
        const started = Date.now();
        const figure = newFigure();
        const printed: Array<{ block: number; text: string }> = [];
        let block = 0;
        const exceptions = exceptionTypes();
        const print = (line: string) => {
            if (printed.length < 50) printed.push({ block, text: line.length > 400 ? `${line.slice(0, 400)}...` : line });
        };
        const builtins = makeBuiltins(print, exceptions);
        const rng = new Rng(0);
        const np = numpyModules(rng);
        const holder = { fig: figure };
        // plt draws into holder.fig: the run's figure, or a frame's.
        const proxy: Figure = new Proxy(figure, {
            get: (_t, p) => Reflect.get(holder.fig, p),
            set: (_t, p, v) => Reflect.set(holder.fig, p, v),
        });
        const { plt, matplotlib } = pyplotModule(proxy, () => block);
        const modules = new Map<string, PyModule>([
            ['numpy', np.np],
            ['numpy.linalg', np.linalg],
            ['numpy.fft', np.fft],
            ['numpy.random', np.random],
            ['math', mathModule()],
            ['cmath', cmathModule()],
            ['random', randomModule(new Rng(0))],
            ['matplotlib', matplotlib],
            ['matplotlib.pyplot', plt],
        ]);
        const patches = patchesOf(matplotlib);
        if (patches) modules.set('matplotlib.patches', patches);
        const fallback = exceptions.get('Exception') as PyExceptionType;
        const host: Host = {
            builtins,
            module: (name) => modules.get(name) ?? null,
            exception: (name) => exceptions.get(name) ?? fallback,
        };
        const interp = new Interpreter(host);
        for (const [name, v] of Object.entries(inputs)) if (Number.isFinite(v) || Number.isNaN(v)) interp.cell(name).v = v;
        let error: PyError | null = null;
        withBudget(() => {
            for (let i = 0; i < this.parsed.length; i++) {
                block = i;
                const p = this.parsed[i];
                if (p.error) {
                    error = p.error;
                    error.block = i;
                    break;
                }
                try {
                    interp.run(p.stmts, i);
                } catch (e) {
                    error = interp.located(e);
                    break;
                }
            }
        });
        const globals = new Map<string, PyValue>();
        for (const [name, cell] of interp.globals) if (cell.v !== undefined) globals.set(name, cell.v);
        const frameFn = globals.get('frame');
        const frame = frameFn instanceof PyFunction ? frameFn : null;
        const ms = Date.now() - started;
        return {
            error,
            printed,
            figure,
            globals,
            frame,
            ms,
            frameAt: (t) => {
                const own = newFigure();
                if (!frame) return { figure: own, error: null };
                holder.fig = own;
                let err: PyError | null = null;
                try {
                    withBudget(() => {
                        try {
                            callValue(frame, [t]);
                        } catch (e) {
                            err = interp.located(e);
                        }
                    }, { steps: LIMITS.steps / 4, ms: 250 });
                } finally {
                    holder.fig = figure;
                }
                return { figure: own, error: err };
            },
            call: (fn, args) => {
                let out: Value = NaN;
                withBudget(() => {
                    try {
                        const v = callValue(fn, args.map(fromChartValue));
                        out = toChartValue(v) ?? NaN;
                    } catch {
                        out = NaN;
                    }
                }, { steps: 200_000, ms: 200 });
                return out;
            },
        };
    }
}

/** How many runs there were (tests and the speed numbers read it). */
export function runCount(): number {
    return runs;
}

/** A short hash of a text (FNV-1a), for keys. */
export function hashText(s: string): string {
    let h = 0x811c9dc5;
    for (let i = 0; i < s.length; i++) {
        h ^= s.charCodeAt(i);
        h = Math.imul(h, 0x01000193);
    }
    return (h >>> 0).toString(36);
}

const PROGRAMS = new Map<string, Program>();

/** The program of these blocks (shared while the blocks stay the same). */
export function programOf(blocks: readonly string[]): Program {
    const key = blocks.join('\u0000');
    let p = PROGRAMS.get(key);
    if (!p) {
        p = new Program(blocks);
        if (PROGRAMS.size > 24) PROGRAMS.delete(PROGRAMS.keys().next().value as string);
        PROGRAMS.set(key, p);
    } else {
        // Most recently used last.
        PROGRAMS.delete(key);
        PROGRAMS.set(key, p);
    }
    return p;
}

export { toArray, PyBuiltin };
