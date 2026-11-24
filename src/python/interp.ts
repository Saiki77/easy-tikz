/*
 * 6.0 P: the interpreter of chart scripts. The syntax tree (parser.ts) is
 * compiled once per run into JS closures (no eval, no Function): names are
 * resolved by Python's scope rules when compiling (locals in slots,
 * enclosing functions by depth, module names in cells), so a run walks
 * the tree without looking names up by text. Statements count steps; calls
 * count depth (budget.ts). Errors carry the line and column of the script.
 * Pure: no DOM, no Obsidian.
 */
import type { Arg, CompFor, Expr, FPart, Param, Stmt } from './ast';
import { budget, tick } from './budget';
import { PyError, typeError } from './errors';
import { binop, callValue, compare, delitem, getattr, getitem, raised, setattr, setitem, unary } from './ops';
import { formatSpec } from './format';
import { arrayBinop } from './ndarray';
import { Kwargs, NDArray, PyComplex, PyDict, PyException, PyExceptionType, PyFunction, PyModule, PyRange, PySet, PySlice, PyTuple, PyValue, iterate, repr, str, truthy, typeName } from './values';
import { ELLIPSIS } from './ndarray';

export interface Cell {
    v: PyValue | undefined;
}

interface Frame {
    v: Array<PyValue | undefined>;
    up: Frame | null;
    ret: PyValue;
}

type Code = (f: Frame) => PyValue;
/** 0: go on, 1: break, 2: continue, 3: return (the value is in the frame). */
type Exec = (f: Frame) => number;
type Store = (f: Frame, v: PyValue) => void;

const NEXT = 0;
const BREAK = 1;
const CONTINUE = 2;
const RETURN = 3;

/** What a run needs from its host: the modules it may import, the builtins, print. */
export interface Host {
    builtins: Map<string, PyValue>;
    /** A module by its dotted name, or null when the script may not import it. */
    module(name: string): PyModule | null;
    /** The exception types by name (for except clauses and errors raised by the interpreter). */
    exception(name: string): PyExceptionType;
}

class Scope {
    readonly locals = new Map<string, number>();
    readonly globals = new Set<string>();
    readonly nonlocals = new Set<string>();

    constructor(
        readonly kind: 'module' | 'function',
        readonly parent: Scope | null
    ) {}
}

type Ref = { kind: 'global' } | { kind: 'local'; depth: number; slot: number };

/** Position of a node for problems: block, line and column in one number. */
const posOf = (block: number, line: number, col: number) => block * 16777216 + Math.min(line, 4095) * 4096 + Math.min(col, 4095);

export class Interpreter {
    /** The module's names. */
    readonly globals = new Map<string, Cell>();
    /** Where the run is now (posOf), for problems. */
    at = 0;
    private block = 0;

    constructor(private readonly host: Host) {}

    cell(name: string): Cell {
        let c = this.globals.get(name);
        if (!c) {
            c = { v: undefined };
            this.globals.set(name, c);
        }
        return c;
    }

    /** Run a block's statements in the module scope (block: its index among the chart's blocks). */
    run(stmts: Stmt[], block: number): void {
        this.block = block;
        const scope = new Scope('module', null);
        const code = this.stmts(stmts, scope);
        const frame: Frame = { v: [], up: null, ret: null };
        try {
            code(frame);
        } catch (e) {
            throw this.located(e);
        }
    }

    /** A Python error with its spot filled in; other errors (a stack overflow) become Python errors. */
    located(e: unknown): PyError {
        let err: PyError;
        if (e instanceof PyError) err = e;
        else if (e instanceof RangeError && /call stack/i.test(e.message)) err = new PyError('RecursionError', 'python.budget.depth', { count: budget.maxDepth });
        else err = new PyError('RuntimeError', 'python.internal', { message: e instanceof Error ? e.message : String(e) });
        if (!err.line) {
            const at = this.at;
            err.block = Math.floor(at / 16777216);
            err.line = Math.floor((at % 16777216) / 4096);
            err.col = at % 4096;
        } else if (err.block < 0) err.block = this.block;
        return err;
    }

    private pos(n: { line: number; col: number }): number {
        return posOf(this.block, n.line, n.col);
    }

    // ------------------------------------------------------------ scopes

    private resolve(scope: Scope, name: string): Ref {
        if (scope.kind === 'module' || scope.globals.has(name)) return { kind: 'global' };
        let depth = 0;
        for (let s: Scope | null = scope; s && s.kind === 'function'; s = s.parent) {
            if (s.globals.has(name)) return { kind: 'global' };
            const slot = s.locals.get(name);
            if (slot !== undefined && !(s === scope && s.nonlocals.has(name))) return { kind: 'local', depth, slot };
            depth++;
        }
        return { kind: 'global' };
    }

    /** The names a function body assigns (its locals), Python's rule. */
    private collectLocals(body: Stmt[], scope: Scope): void {
        const add = (name: string) => {
            if (scope.globals.has(name) || scope.nonlocals.has(name)) return;
            if (!scope.locals.has(name)) scope.locals.set(name, scope.locals.size);
        };
        const target = (e: Expr) => {
            if (e.k === 'name') add(e.id);
            else if (e.k === 'tuple' || e.k === 'list') e.elts.forEach(target);
            else if (e.k === 'starred') target(e.e);
        };
        const walrus = (e: Expr | null) => {
            if (!e) return;
            visitExpr(e, (x) => {
                if (x.k === 'walrus') add(x.id);
            });
        };
        const visit = (list: Stmt[]) => {
            for (const s of list) {
                switch (s.k) {
                    case 'global':
                        s.names.forEach((n) => scope.globals.add(n));
                        break;
                    case 'nonlocal':
                        s.names.forEach((n) => scope.nonlocals.add(n));
                        break;
                }
            }
            for (const s of list) {
                switch (s.k) {
                    case 'assign':
                        s.targets.forEach(target);
                        walrus(s.value);
                        break;
                    case 'aug':
                        target(s.target);
                        break;
                    case 'for':
                        target(s.target);
                        visit(s.body);
                        visit(s.orelse);
                        break;
                    case 'while':
                    case 'if':
                        walrus(s.test);
                        visit(s.body);
                        visit(s.orelse);
                        break;
                    case 'def':
                        add(s.name);
                        break;
                    case 'import':
                        for (const n of s.names) add(n.as ?? n.name.split('.')[0]);
                        break;
                    case 'from':
                        for (const n of s.names) if (n.name !== '*') add(n.as ?? n.name);
                        break;
                    case 'del':
                        s.targets.forEach(target);
                        break;
                    case 'try':
                        visit(s.body);
                        for (const h of s.handlers) {
                            if (h.name) add(h.name);
                            visit(h.body);
                        }
                        visit(s.orelse);
                        visit(s.final);
                        break;
                    case 'expr':
                        walrus(s.e);
                        break;
                    case 'return':
                        walrus(s.e);
                        break;
                }
            }
        };
        visit(body);
    }

    // ------------------------------------------------------------ names

    private load(scope: Scope, name: string, at: number): Code {
        const ref = this.resolve(scope, name);
        if (ref.kind === 'global') {
            const cell = this.cell(name);
            const builtins = this.host.builtins;
            return () => {
                const v = cell.v;
                if (v !== undefined) return v;
                const b = builtins.get(name);
                if (b !== undefined) return b;
                this.at = at;
                throw new PyError('NameError', 'python.name.undefined', { name });
            };
        }
        const { depth, slot } = ref;
        const unbound = () => {
            this.at = at;
            return new PyError('UnboundLocalError', 'python.name.unbound', { name });
        };
        if (depth === 0) {
            return (f) => {
                const v = f.v[slot];
                if (v === undefined) throw unbound();
                return v;
            };
        }
        return (f) => {
            let fr: Frame | null = f;
            for (let d = 0; d < depth && fr; d++) fr = fr.up;
            const v = fr ? fr.v[slot] : undefined;
            if (v === undefined) throw unbound();
            return v;
        };
    }

    private storeName(scope: Scope, name: string): Store {
        const ref = this.resolve(scope, name);
        if (ref.kind === 'global') {
            const cell = this.cell(name);
            return (_f, v) => {
                cell.v = v;
            };
        }
        const { depth, slot } = ref;
        if (depth === 0) {
            return (f, v) => {
                f.v[slot] = v;
            };
        }
        return (f, v) => {
            let fr: Frame | null = f;
            for (let d = 0; d < depth && fr; d++) fr = fr.up;
            if (fr) fr.v[slot] = v;
        };
    }

    private store(target: Expr, scope: Scope): Store {
        const at = this.pos(target);
        switch (target.k) {
            case 'name':
                return this.storeName(scope, target.id);
            case 'attr': {
                const obj = this.expr(target.e, scope);
                const name = target.name;
                return (f, v) => {
                    const o = obj(f);
                    this.at = at;
                    setattr(o, name, v);
                };
            }
            case 'sub': {
                const obj = this.expr(target.e, scope);
                const idx = this.index(target.idx, scope);
                return (f, v) => {
                    const o = obj(f);
                    const i = idx(f);
                    this.at = at;
                    setitem(o, i, v);
                };
            }
            case 'tuple':
            case 'list': {
                const star = target.elts.findIndex((e) => e.k === 'starred');
                const parts = target.elts.map((e) => this.store(e.k === 'starred' ? e.e : e, scope));
                const n = target.elts.length;
                return (f, v) => {
                    this.at = at;
                    const items = unpackable(v);
                    if (star < 0) {
                        if (items.length !== n) throw new PyError('ValueError', items.length > n ? 'python.unpack.tooMany' : 'python.unpack.notEnough', { want: n, got: items.length });
                        for (let i = 0; i < n; i++) parts[i](f, items[i]);
                        return;
                    }
                    const after = n - star - 1;
                    if (items.length < n - 1) throw new PyError('ValueError', 'python.unpack.notEnough', { want: n - 1, got: items.length });
                    for (let i = 0; i < star; i++) parts[i](f, items[i]);
                    parts[star](f, items.slice(star, items.length - after));
                    for (let i = 0; i < after; i++) parts[star + 1 + i](f, items[items.length - after + i]);
                };
            }
            default:
                throw new PyError('SyntaxError', 'python.syntax.badTarget', {}, target.line, target.col);
        }
    }

    // ------------------------------------------------------------ statements

    private stmts(list: Stmt[], scope: Scope): Exec {
        const codes = list.map((s) => this.stmt(s, scope));
        const n = codes.length;
        if (n === 1) return codes[0];
        return (f) => {
            for (let i = 0; i < n; i++) {
                const sig = codes[i](f);
                if (sig !== NEXT) return sig;
            }
            return NEXT;
        };
    }

    private stmt(s: Stmt, scope: Scope): Exec {
        const at = this.pos(s);
        const enter = () => {
            this.at = at;
            tick();
        };
        switch (s.k) {
            case 'expr': {
                const e = this.expr(s.e, scope);
                return (f) => {
                    enter();
                    e(f);
                    return NEXT;
                };
            }
            case 'assign': {
                const value = this.expr(s.value, scope);
                const targets = s.targets.map((t) => this.store(t, scope));
                if (targets.length === 1) {
                    const t = targets[0];
                    return (f) => {
                        enter();
                        t(f, value(f));
                        return NEXT;
                    };
                }
                return (f) => {
                    enter();
                    const v = value(f);
                    for (const t of targets) t(f, v);
                    return NEXT;
                };
            }
            case 'aug':
                return this.augmented(s.target, s.op, s.value, scope, at);
            case 'if': {
                const test = this.expr(s.test, scope);
                const body = this.stmts(s.body, scope);
                const orelse = s.orelse.length ? this.stmts(s.orelse, scope) : null;
                return (f) => {
                    enter();
                    if (truthy(test(f))) return body(f);
                    return orelse ? orelse(f) : NEXT;
                };
            }
            case 'while': {
                const test = this.expr(s.test, scope);
                const body = this.stmts(s.body, scope);
                const orelse = s.orelse.length ? this.stmts(s.orelse, scope) : null;
                return (f) => {
                    enter();
                    for (;;) {
                        this.at = at;
                        tick();
                        if (!truthy(test(f))) break;
                        const sig = body(f);
                        if (sig === BREAK) return NEXT;
                        if (sig === RETURN) return RETURN;
                    }
                    return orelse ? orelse(f) : NEXT;
                };
            }
            case 'for': {
                const iter = this.expr(s.iter, scope);
                const target = this.store(s.target, scope);
                const body = this.stmts(s.body, scope);
                const orelse = s.orelse.length ? this.stmts(s.orelse, scope) : null;
                return (f) => {
                    enter();
                    const it = iter(f);
                    this.at = at;
                    if (it instanceof PyRange) {
                        const n = it.length;
                        for (let i = 0; i < n; i++) {
                            tick();
                            target(f, it.at(i));
                            const sig = body(f);
                            if (sig === BREAK) return NEXT;
                            if (sig === RETURN) return RETURN;
                        }
                    } else {
                        const items = iterate(it);
                        // A list read by index: items appended in the loop are reached too, as in Python.
                        for (let i = 0; i < items.length; i++) {
                            tick();
                            target(f, items[i]);
                            const sig = body(f);
                            if (sig === BREAK) return NEXT;
                            if (sig === RETURN) return RETURN;
                        }
                    }
                    return orelse ? orelse(f) : NEXT;
                };
            }
            case 'break':
                return () => BREAK;
            case 'continue':
                return () => CONTINUE;
            case 'pass':
                return () => {
                    enter();
                    return NEXT;
                };
            case 'return': {
                const e = s.e ? this.expr(s.e, scope) : null;
                return (f) => {
                    enter();
                    f.ret = e ? e(f) : null;
                    return RETURN;
                };
            }
            case 'def': {
                const make = this.function(s.name, s.params, s.body, null, scope);
                const store = this.storeName(scope, s.name);
                return (f) => {
                    enter();
                    store(f, make(f));
                    return NEXT;
                };
            }
            case 'import': {
                const binds = s.names.map((n) => {
                    const top = n.name.split('.')[0];
                    return { n, store: this.storeName(scope, n.as ?? top) };
                });
                return (f) => {
                    enter();
                    for (const { n, store } of binds) {
                        const mod = this.host.module(n.name);
                        if (!mod) throw new PyError('ImportError', 'python.import.none', { name: n.name });
                        if (n.as) store(f, mod);
                        else {
                            // `import matplotlib.pyplot` binds matplotlib, with pyplot on it.
                            const top = n.name.split('.')[0];
                            const topMod = this.host.module(top);
                            if (!topMod) throw new PyError('ImportError', 'python.import.none', { name: top });
                            store(f, topMod);
                        }
                    }
                    return NEXT;
                };
            }
            case 'from': {
                const star = s.names.some((n) => n.name === '*');
                const binds = s.names.filter((n) => n.name !== '*').map((n) => ({ n, store: this.storeName(scope, n.as ?? n.name) }));
                return (f) => {
                    enter();
                    const mod = this.host.module(s.module);
                    if (!mod) throw new PyError('ImportError', 'python.import.none', { name: s.module });
                    if (star) {
                        for (const [k, v] of mod.attrs) if (!k.startsWith('_')) this.storeName(scope, k)(f, v);
                    }
                    for (const { n, store } of binds) {
                        let v = mod.attrs.get(n.name);
                        if (v === undefined) {
                            const sub = this.host.module(`${s.module}.${n.name}`);
                            if (sub) v = sub;
                        }
                        if (v === undefined) throw new PyError('ImportError', 'python.import.nameNone', { name: n.name, module: s.module });
                        store(f, v);
                    }
                    return NEXT;
                };
            }
            case 'global':
            case 'nonlocal':
                return () => NEXT;
            case 'del': {
                const dels = s.targets.map((t) => this.deleter(t, scope));
                return (f) => {
                    enter();
                    for (const d of dels) d(f);
                    return NEXT;
                };
            }
            case 'assert': {
                const test = this.expr(s.test, scope);
                const m = s.msg ? this.expr(s.msg, scope) : null;
                return (f) => {
                    enter();
                    if (!truthy(test(f))) throw new PyError('AssertionError', m ? null : 'python.assert', {}, 0, 0, m ? str(m(f)) : undefined);
                    return NEXT;
                };
            }
            case 'raise': {
                const e = s.e ? this.expr(s.e, scope) : null;
                return (f) => {
                    enter();
                    if (!e) throw new PyError('RuntimeError', 'python.raise.bare');
                    const v = e(f);
                    this.at = at;
                    throw raised(v);
                };
            }
            case 'try':
                return this.tryStmt(s, scope, at);
        }
    }

    private tryStmt(s: Extract<Stmt, { k: 'try' }>, scope: Scope, at: number): Exec {
        const body = this.stmts(s.body, scope);
        const handlers = s.handlers.map((h) => ({
            types: h.types ? this.expr(h.types, scope) : null,
            bind: h.name ? this.storeName(scope, h.name) : null,
            body: this.stmts(h.body, scope),
        }));
        const orelse = s.orelse.length ? this.stmts(s.orelse, scope) : null;
        const final = s.final.length ? this.stmts(s.final, scope) : null;
        return (f) => {
            this.at = at;
            tick();
            try {
                let sig: number;
                try {
                    sig = body(f);
                } catch (e) {
                    const err = e instanceof PyError ? e : this.located(e);
                    if (err.budget) throw err;
                    const type = this.host.exception(err.kind);
                    for (const h of handlers) {
                        if (h.types) {
                            const want = h.types(f);
                            const list = want instanceof PyTuple ? want.items : [want];
                            if (!list.some((w) => w instanceof PyExceptionType && type.isA(w))) continue;
                        }
                        if (h.bind) h.bind(f, new PyException(type, err.message));
                        return h.body(f);
                    }
                    throw err;
                }
                if (sig === NEXT && orelse) return orelse(f);
                return sig;
            } finally {
                if (final) final(f);
            }
        };
    }

    private deleter(t: Expr, scope: Scope): (f: Frame) => void {
        if (t.k === 'sub') {
            const obj = this.expr(t.e, scope);
            const idx = this.index(t.idx, scope);
            return (f) => delitem(obj(f), idx(f));
        }
        if (t.k === 'name') {
            const ref = this.resolve(scope, t.id);
            if (ref.kind === 'global') {
                const cell = this.cell(t.id);
                return () => {
                    cell.v = undefined;
                };
            }
            const store = this.storeName(scope, t.id);
            return (f) => store(f, undefined as unknown as PyValue);
        }
        if (t.k === 'tuple' || t.k === 'list') {
            const parts = t.elts.map((e) => this.deleter(e, scope));
            return (f) => parts.forEach((p) => p(f));
        }
        throw new PyError('SyntaxError', 'python.syntax.badTarget', {}, t.line, t.col);
    }

    private augmented(target: Expr, op: string, valueNode: Expr, scope: Scope, at: number): Exec {
        const value = this.expr(valueNode, scope);
        const apply = (old: PyValue, v: PyValue): PyValue => {
            this.at = at;
            // Lists and arrays change in place, as in Python.
            if (Array.isArray(old) && op === '+') {
                old.push(...iterate(v));
                return old;
            }
            if (old instanceof NDArray) {
                const r = arrayBinop(op, old, v);
                if (r instanceof NDArray && r.shape.length === old.shape.length && r.shape.every((d, i) => d === old.shape[i]) && (r.dtype !== 'complex' || old.dtype === 'complex')) {
                    old.data.set(r.data);
                    if (old.imag && r.imag) old.imag.set(r.imag);
                    if (old.dtype === 'int' && r.dtype === 'float') old.dtype = 'float';
                    return old;
                }
                return r;
            }
            return binop(op, old, v);
        };
        if (target.k === 'name') {
            const load = this.load(scope, target.id, at);
            const store = this.storeName(scope, target.id);
            return (f) => {
                this.at = at;
                tick();
                store(f, apply(load(f), value(f)));
                return NEXT;
            };
        }
        if (target.k === 'sub') {
            const obj = this.expr(target.e, scope);
            const idx = this.index(target.idx, scope);
            return (f) => {
                this.at = at;
                tick();
                const o = obj(f);
                const i = idx(f);
                const old = getitem(o, i);
                const v = value(f);
                this.at = at;
                setitem(o, i, old instanceof NDArray ? arrayBinop(op, old, v) : binop(op, old, v));
                return NEXT;
            };
        }
        if (target.k === 'attr') {
            const obj = this.expr(target.e, scope);
            return (f) => {
                this.at = at;
                tick();
                const o = obj(f);
                setattr(o, target.name, apply(getattr(o, target.name), value(f)));
                return NEXT;
            };
        }
        throw new PyError('SyntaxError', 'python.syntax.badTarget', {}, target.line, target.col);
    }

    // ------------------------------------------------------------ functions

    /** A def or lambda: a maker that, given the frame it is defined in, makes the function value. */
    private function(name: string, params: Param[], body: Stmt[] | null, expr: Expr | null, outer: Scope): (f: Frame) => PyValue {
        const scope = new Scope('function', outer);
        for (const p of params) if (!scope.locals.has(p.name)) scope.locals.set(p.name, scope.locals.size);
        if (body) this.collectLocals(body, scope);
        else if (expr) visitExpr(expr, (x) => {
            if (x.k === 'walrus' && !scope.locals.has(x.id)) scope.locals.set(x.id, scope.locals.size);
        });
        const run: Exec = body ? this.stmts(body, scope) : (() => {
            const e = this.expr(expr as Expr, scope);
            return (f: Frame) => {
                f.ret = e(f);
                return RETURN;
            };
        })();
        const defaults = params.map((p) => (p.def ? this.expr(p.def, outer) : null));
        const slots = params.map((p) => scope.locals.get(p.name) ?? 0);
        const normal = params.filter((p) => p.kind === 'normal').length;
        const starAt = params.findIndex((p) => p.kind === 'star');
        const dstarAt = params.findIndex((p) => p.kind === 'dstar');
        const size = () => scope.locals.size;
        const simple = starAt < 0 && dstarAt < 0 && params.every((p) => p.kind === 'normal');
        return (defFrame) => {
            const dflt = defaults.map((d) => (d ? d(defFrame) : undefined));
            const fn = new PyFunction(name, (args, kw) => {
                if (++budget.depth > budget.maxDepth) {
                    budget.depth--;
                    throw new PyError('RecursionError', 'python.budget.depth', { count: budget.maxDepth });
                }
                try {
                    const fr: Frame = { v: new Array<PyValue | undefined>(size()), up: defFrame, ret: null };
                    if (simple && !kw && args.length === normal) {
                        for (let i = 0; i < normal; i++) fr.v[slots[i]] = args[i];
                    } else this.bind(name, params, slots, dflt, args, kw, fr, normal, starAt, dstarAt);
                    tick();
                    const sig = run(fr);
                    return sig === RETURN ? fr.ret : null;
                } finally {
                    budget.depth--;
                }
            });
            return fn;
        };
    }

    private bind(name: string, params: Param[], slots: number[], dflt: Array<PyValue | undefined>, args: PyValue[], kw: Kwargs | null, fr: Frame, normal: number, starAt: number, dstarAt: number): void {
        const positional = params.map((p, i) => ({ p, i })).filter((x) => x.p.kind === 'normal');
        if (args.length > normal && starAt < 0) throw typeError('python.call.tooMany', { name, count: normal, got: args.length });
        for (let k = 0; k < positional.length && k < args.length; k++) fr.v[slots[positional[k].i]] = args[k];
        if (starAt >= 0) fr.v[slots[starAt]] = new PyTuple(args.slice(normal));
        const extra = new PyDict();
        if (kw) {
            for (const [k, v] of kw) {
                const i = params.findIndex((p) => p.name === k && (p.kind === 'normal' || p.kind === 'kwonly'));
                if (i < 0) {
                    if (dstarAt < 0) throw typeError('python.call.badKeyword', { name, keyword: k });
                    extra.set(k, v);
                    continue;
                }
                if (fr.v[slots[i]] !== undefined) throw typeError('python.call.twice', { name, keyword: k });
                fr.v[slots[i]] = v;
            }
        }
        if (dstarAt >= 0) fr.v[slots[dstarAt]] = extra;
        params.forEach((p, i) => {
            if (p.kind !== 'normal' && p.kind !== 'kwonly') return;
            if (fr.v[slots[i]] !== undefined) return;
            const d = dflt[i];
            if (d === undefined) throw typeError('python.call.missing', { name, param: p.name });
            fr.v[slots[i]] = d;
        });
    }

    // ------------------------------------------------------------ expressions

    expr(e: Expr, scope: Scope): Code {
        const at = this.pos(e);
        switch (e.k) {
            case 'num': {
                const v: PyValue = e.imag ? new PyComplex(0, e.v) : e.v;
                return () => v;
            }
            case 'str': {
                const v = e.v;
                return () => v;
            }
            case 'const': {
                const v = e.v;
                return () => v;
            }
            case 'ellipsis':
                return () => ELLIPSIS;
            case 'fstr':
                return this.fstring(e.parts, scope);
            case 'name':
                return this.load(scope, e.id, at);
            case 'list': {
                const items = this.items(e.elts, scope);
                return (f) => items(f);
            }
            case 'tuple': {
                const items = this.items(e.elts, scope);
                return (f) => new PyTuple(items(f));
            }
            case 'set': {
                const items = this.items(e.elts, scope);
                return (f) => new PySet(items(f));
            }
            case 'dict': {
                const keys = e.keys.map((k) => (k ? this.expr(k, scope) : null));
                const vals = e.vals.map((v) => this.expr(v, scope));
                return (f) => {
                    const d = new PyDict();
                    for (let i = 0; i < vals.length; i++) {
                        const k = keys[i];
                        const v = vals[i](f);
                        this.at = at;
                        if (k) d.set(k(f), v);
                        else if (v instanceof PyDict) for (const [kk, vv] of v.map.values()) d.set(kk, vv);
                        else throw typeError('python.type.notMapping', { type: typeName(v) });
                    }
                    return d;
                };
            }
            case 'comp':
                return this.comprehension(e, scope);
            case 'bin': {
                const l = this.expr(e.l, scope);
                const r = this.expr(e.r, scope);
                const op = e.op;
                if (op === '+') {
                    return (f) => {
                        const a = l(f);
                        const b = r(f);
                        if (typeof a === 'number' && typeof b === 'number') return a + b;
                        this.at = at;
                        return binop(op, a, b);
                    };
                }
                if (op === '*') {
                    return (f) => {
                        const a = l(f);
                        const b = r(f);
                        if (typeof a === 'number' && typeof b === 'number') return a * b;
                        this.at = at;
                        return binop(op, a, b);
                    };
                }
                if (op === '-') {
                    return (f) => {
                        const a = l(f);
                        const b = r(f);
                        if (typeof a === 'number' && typeof b === 'number') return a - b;
                        this.at = at;
                        return binop(op, a, b);
                    };
                }
                return (f) => {
                    const a = l(f);
                    const b = r(f);
                    this.at = at;
                    return binop(op, a, b);
                };
            }
            case 'unary': {
                const x = this.expr(e.e, scope);
                const op = e.op;
                if (op === 'not') return (f) => !truthy(x(f));
                return (f) => {
                    const v = x(f);
                    if (op === '-' && typeof v === 'number') return -v;
                    this.at = at;
                    return unary(op, v);
                };
            }
            case 'bool': {
                const vals = e.vals.map((v) => this.expr(v, scope));
                if (e.op === 'and') {
                    return (f) => {
                        let v: PyValue = true;
                        for (const c of vals) {
                            v = c(f);
                            if (!truthy(v)) return v;
                        }
                        return v;
                    };
                }
                return (f) => {
                    let v: PyValue = false;
                    for (const c of vals) {
                        v = c(f);
                        if (truthy(v)) return v;
                    }
                    return v;
                };
            }
            case 'cmp': {
                const l = this.expr(e.l, scope);
                const rs = e.rs.map((r) => this.expr(r, scope));
                const ops = e.ops;
                if (ops.length === 1) {
                    const op = ops[0];
                    const r = rs[0];
                    return (f) => {
                        const a = l(f);
                        const b = r(f);
                        this.at = at;
                        return compare(op, a, b);
                    };
                }
                return (f) => {
                    let a = l(f);
                    let out: PyValue = true;
                    for (let i = 0; i < ops.length; i++) {
                        const b = rs[i](f);
                        this.at = at;
                        out = compare(ops[i], a, b);
                        if (!truthy(out)) return out;
                        a = b;
                    }
                    return out;
                };
            }
            case 'ifexp': {
                const test = this.expr(e.test, scope);
                const body = this.expr(e.body, scope);
                const orelse = this.expr(e.orelse, scope);
                return (f) => (truthy(test(f)) ? body(f) : orelse(f));
            }
            case 'lambda':
                return this.function('<lambda>', e.params, null, e.body, scope);
            case 'walrus': {
                const v = this.expr(e.e, scope);
                const store = this.storeName(scope, e.id);
                return (f) => {
                    const x = v(f);
                    store(f, x);
                    return x;
                };
            }
            case 'call':
                return this.call(e.f, e.args, scope, at);
            case 'attr': {
                const obj = this.expr(e.e, scope);
                const name = e.name;
                return (f) => {
                    const o = obj(f);
                    this.at = at;
                    return getattr(o, name);
                };
            }
            case 'sub': {
                const obj = this.expr(e.e, scope);
                const idx = this.index(e.idx, scope);
                return (f) => {
                    const o = obj(f);
                    const i = idx(f);
                    this.at = at;
                    return getitem(o, i);
                };
            }
            case 'slice':
                return this.index(e, scope);
            case 'starred':
                throw new PyError('SyntaxError', 'python.syntax.starHere', {}, e.line, e.col);
        }
    }

    private index(e: Expr, scope: Scope): Code {
        if (e.k === 'slice') {
            const lo = e.lo ? this.expr(e.lo, scope) : null;
            const hi = e.hi ? this.expr(e.hi, scope) : null;
            const step = e.step ? this.expr(e.step, scope) : null;
            return (f) => new PySlice(lo ? lo(f) : null, hi ? hi(f) : null, step ? step(f) : null);
        }
        if (e.k === 'tuple' && e.elts.some((x) => x.k === 'slice')) {
            const parts = e.elts.map((x) => this.index(x, scope));
            return (f) => new PyTuple(parts.map((p) => p(f)));
        }
        return this.expr(e, scope);
    }

    /** The items of a list or tuple display, *starred ones spread. */
    private items(elts: Expr[], scope: Scope): (f: Frame) => PyValue[] {
        const parts = elts.map((x) => (x.k === 'starred' ? { star: true, c: this.expr(x.e, scope) } : { star: false, c: this.expr(x, scope) }));
        if (parts.every((p) => !p.star)) {
            const cs = parts.map((p) => p.c);
            return (f) => cs.map((c) => c(f));
        }
        return (f) => {
            const out: PyValue[] = [];
            for (const p of parts) {
                if (p.star) out.push(...iterate(p.c(f)));
                else out.push(p.c(f));
            }
            return out;
        };
    }

    private call(fnNode: Expr, args: Arg[], scope: Scope, at: number): Code {
        const fn = this.expr(fnNode, scope);
        const simple = args.every((a) => a.star === 0 && a.kw === null);
        if (simple) {
            const cs = args.map((a) => this.expr(a.e, scope));
            const n = cs.length;
            return (f) => {
                const callee = fn(f);
                const vals = new Array<PyValue>(n);
                for (let i = 0; i < n; i++) vals[i] = cs[i](f);
                this.at = at;
                return callValue(callee, vals, null);
            };
        }
        const parts = args.map((a) => ({ star: a.star, kw: a.kw, c: this.expr(a.e, scope) }));
        return (f) => {
            const callee = fn(f);
            const vals: PyValue[] = [];
            let kw: Kwargs | null = null;
            for (const p of parts) {
                const v = p.c(f);
                if (p.kw !== null) (kw ??= new Map()).set(p.kw, v);
                else if (p.star === 1) vals.push(...iterate(v));
                else if (p.star === 2) {
                    if (!(v instanceof PyDict)) throw typeError('python.type.notMapping', { type: typeName(v) });
                    kw ??= new Map();
                    for (const [k, x] of v.map.values()) kw.set(str(k), x);
                } else vals.push(v);
            }
            this.at = at;
            return callValue(callee, vals, kw);
        };
    }

    private comprehension(e: Extract<Expr, { k: 'comp' }>, outer: Scope): Code {
        const scope = new Scope('function', outer);
        const addTargets = (t: Expr) => {
            if (t.k === 'name') {
                if (!scope.locals.has(t.id)) scope.locals.set(t.id, scope.locals.size);
            } else if (t.k === 'tuple' || t.k === 'list') t.elts.forEach(addTargets);
            else if (t.k === 'starred') addTargets(t.e);
        };
        for (const g of e.gens) addTargets(g.target);
        // The first iterable is read in the scope around the comprehension (Python's rule).
        const first = this.expr(e.gens[0].iter, outer);
        const gens = e.gens.map((g: CompFor, i) => ({
            iter: i === 0 ? null : this.expr(g.iter, scope),
            target: this.store(g.target, scope),
            ifs: g.ifs.map((x) => this.expr(x, scope)),
        }));
        const elt = this.expr(e.elt, scope);
        const val = e.val ? this.expr(e.val, scope) : null;
        const size = () => scope.locals.size;
        const kind = e.kind;
        return (f) => {
            const fr: Frame = { v: new Array<PyValue | undefined>(size()), up: f, ret: null };
            const list: PyValue[] = [];
            const dict = kind === 'dict' ? new PyDict() : null;
            const loop = (k: number, items: PyValue[]) => {
                const g = gens[k];
                for (let i = 0; i < items.length; i++) {
                    tick();
                    g.target(fr, items[i]);
                    let ok = true;
                    for (const c of g.ifs) {
                        if (!truthy(c(fr))) {
                            ok = false;
                            break;
                        }
                    }
                    if (!ok) continue;
                    if (k + 1 < gens.length) {
                        const next = gens[k + 1].iter;
                        if (next) loop(k + 1, iterate(next(fr)));
                    } else if (dict && val) dict.set(elt(fr), val(fr));
                    else list.push(elt(fr));
                }
            };
            loop(0, iterate(first(f)));
            if (dict) return dict;
            if (kind === 'set') return new PySet(list);
            return list;
        };
    }

    private fstring(parts: FPart[], scope: Scope): Code {
        const cs = parts.map((p) => {
            if (typeof p === 'string') return () => p;
            const e = this.expr(p.e, scope);
            const spec = p.spec ? this.fstring(p.spec, scope) : null;
            const conv = p.conv;
            const debug = p.debug;
            return (f: Frame) => {
                const v = e(f);
                const s = spec ? str(spec(f)) : '';
                let text: string;
                if (conv === 'r' || conv === 'a' || (debug !== null && !conv && !s)) text = repr(v);
                else if (conv === 's') text = str(v);
                else text = formatSpec(v, s);
                if (conv && s) text = formatSpec(text, s);
                return debug !== null ? debug + text : text;
            };
        });
        return (f) => cs.map((c) => c(f)).join('');
    }
}

/** The items of a value that is unpacked into names (a, b = ...). */
function unpackable(v: PyValue): PyValue[] {
    return iterate(v);
}

/** Every expression node below e (not into lambdas). */
function visitExpr(e: Expr, fn: (x: Expr) => void): void {
    fn(e);
    switch (e.k) {
        case 'list':
        case 'tuple':
        case 'set':
            e.elts.forEach((x) => visitExpr(x, fn));
            break;
        case 'dict':
            e.keys.forEach((x) => x && visitExpr(x, fn));
            e.vals.forEach((x) => visitExpr(x, fn));
            break;
        case 'bin':
            visitExpr(e.l, fn);
            visitExpr(e.r, fn);
            break;
        case 'unary':
        case 'starred':
            visitExpr(e.e, fn);
            break;
        case 'bool':
            e.vals.forEach((x) => visitExpr(x, fn));
            break;
        case 'cmp':
            visitExpr(e.l, fn);
            e.rs.forEach((x) => visitExpr(x, fn));
            break;
        case 'ifexp':
            visitExpr(e.test, fn);
            visitExpr(e.body, fn);
            visitExpr(e.orelse, fn);
            break;
        case 'call':
            visitExpr(e.f, fn);
            e.args.forEach((a) => visitExpr(a.e, fn));
            break;
        case 'attr':
            visitExpr(e.e, fn);
            break;
        case 'sub':
            visitExpr(e.e, fn);
            visitExpr(e.idx, fn);
            break;
        case 'slice':
            if (e.lo) visitExpr(e.lo, fn);
            if (e.hi) visitExpr(e.hi, fn);
            if (e.step) visitExpr(e.step, fn);
            break;
        case 'walrus':
            visitExpr(e.e, fn);
            break;
    }
}

export { visitExpr };
