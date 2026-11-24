/*
 * 6.0 A: the let definitions of a chart (`let v = (2, 1)`, `let f(x, y) =
 * x^2 + 4y^2`) as the MathContext holds them: compiled when first used, in
 * the order they need each other, a value cached until a slider or a
 * computed name changes, a function compiled once for each set of argument
 * shapes it is called with. A definition that refers to itself, directly
 * or through others, is an error. Pure: no DOM, no Obsidian.
 */
import { Env, ExprError, Lru, builtinFunction, isReservedName } from '../expr';
import { t as msg } from '../i18n';
import { Cell, DefRef, Definitions, Locals, Part, ValueCompiler } from './compile';
import { VNode, parseValue } from './parse';
import { ANY, Shape, Value } from './types';

/** One let line: `let v = (2, 1)` is { name: 'v', params: [], expression: '(2, 1)' }. */
export interface ValueDefinition {
    name: string;
    /** The parameters of a function (`let f(x, y) = ...`); empty for a value. */
    params: string[];
    /** The formula after `=`, plain or LaTeX. */
    expression: string;
}

/** What the table needs of its MathContext. */
export interface TableHost {
    /** The Env of value fields: sliders, computed names, the chart's functions. */
    env(): Env;
    /** Bumped when a slider or a computed name changes (cached values are read again). */
    version(): number;
    /** Why a name cannot be a definition here (a slider, a function or an axis variable has it), or null. */
    conflict(name: string): string | null;
}

const NAME_RE = /^[A-Za-z][A-Za-z0-9_]*$/;

interface Rec {
    def: ValueDefinition;
    /** 0 = new, 1 = compiling, 2 = done. */
    state: 0 | 1 | 2;
    error?: string;
    ast: VNode | null;
    /** A value: its compiled part and the value cached for a version. */
    part: Part | null;
    version: number;
    cached: Value;
    /** A function: its bodies by the shapes of the arguments. */
    instances: Map<string, { cells: Cell[]; body: Part } | ExprError>;
    building: Set<string>;
}

function shapeKey(s: Shape): string {
    switch (s.k) {
        case 'vec':
            return `v${s.n}`;
        case 'mat':
            return `m${s.r}x${s.c}`;
        case 'list':
            return `l(${shapeKey(s.of)})`;
        default:
            return s.k;
    }
}

export class ValueTable implements Definitions {
    private readonly recs = new Map<string, Rec>();
    private readonly order: Rec[] = [];
    /** Definitions being compiled now, innermost last (for the message of a cycle). */
    private readonly stack: Rec[] = [];
    /** Formulas of value fields compiled by evaluate(), by their text. */
    private readonly parts = new Lru<string, Part | ExprError>(128);

    constructor(
        defs: readonly ValueDefinition[],
        private readonly host: TableHost
    ) {
        for (const raw of Array.isArray(defs) ? defs : []) {
            if (!raw || typeof raw.name !== 'string') continue;
            const def: ValueDefinition = {
                name: raw.name,
                params: Array.isArray(raw.params) ? raw.params.filter((p: unknown): p is string => typeof p === 'string') : [],
                expression: typeof raw.expression === 'string' ? raw.expression : '',
            };
            const rec: Rec = { def, state: 0, ast: null, part: null, version: -1, cached: NaN, instances: new Map(), building: new Set() };
            this.order.push(rec);
            if (!NAME_RE.test(def.name)) {
                rec.error = msg('values.problem.badName', { name: def.name });
                continue;
            }
            if (this.recs.has(def.name)) {
                rec.error = msg('values.problem.duplicate', { name: def.name });
                continue;
            }
            this.recs.set(def.name, rec);
        }
    }

    has(name: string): boolean {
        return this.recs.has(name);
    }

    names(): string[] {
        return Array.from(this.recs.keys());
    }

    /** The definitions in the order they were given. */
    definitions(): ValueDefinition[] {
        return this.order.map((r) => r.def);
    }

    isFunction(name: string): boolean {
        const rec = this.recs.get(name);
        return !!rec && rec.def.params.length > 0;
    }

    /**
     * The value of a formula of a value field (no axis variables) now; null
     * when it has a problem. Compiled once per text.
     */
    evaluate(src: string, env: Env): Value | null {
        let part = this.parts.get(src);
        if (!part) {
            try {
                part = new ValueCompiler({ env, defs: this, locals: null, src }).node(parseValue(src));
            } catch (e) {
                part = e instanceof ExprError ? e : new ExprError(String(e));
            }
            this.parts.set(src, part);
        }
        return part instanceof ExprError ? null : part.f();
    }

    /** Like evaluate(), with the problem: a compiled part, or the ExprError. */
    compileField(src: string, env: Env): Part {
        const hit = this.parts.get(src);
        if (hit instanceof ExprError) throw hit;
        if (hit) return hit;
        try {
            const part = new ValueCompiler({ env, defs: this, locals: null, src }).node(parseValue(src));
            this.parts.set(src, part);
            return part;
        } catch (e) {
            const err = e instanceof ExprError ? e : new ExprError(String(e));
            this.parts.set(src, err);
            throw err;
        }
    }

    /** A read formula (or a part of one) compiled for a value field; throws ExprError. Not cached. */
    compileNode(node: VNode, env: Env, src: string): Part {
        return new ValueCompiler({ env, defs: this, locals: null, src }).node(node);
    }

    bodyOf(name: string): VNode | null {
        const rec = this.recs.get(name);
        if (!rec) return null;
        if (rec.state === 0) this.compile(rec);
        return rec.error ? null : rec.ast;
    }

    /** The formula of a definition (for the names a formula depends on), or null. */
    source(name: string): string | null {
        const rec = this.recs.get(name);
        return rec ? rec.def.expression : null;
    }

    /** The problem of the definition at `index` (in the order given), or undefined. */
    problemAt(index: number): string | undefined {
        const rec = this.order[index];
        if (!rec) return undefined;
        if (rec.state === 0 && !rec.error) this.compile(rec);
        return rec.error;
    }

    /** The problem of a definition by name, or undefined. */
    problem(name: string): string | undefined {
        const rec = this.recs.get(name);
        if (!rec) return undefined;
        if (rec.state === 0 && !rec.error) this.compile(rec);
        return rec.error;
    }

    /** The shape of a value definition (ANY for a function or after a problem). */
    shape(name: string): Shape {
        const rec = this.recs.get(name);
        if (!rec || rec.def.params.length) return ANY;
        if (rec.state === 0) this.compile(rec);
        return rec.part ? rec.part.shape : ANY;
    }

    /** The value of a definition now (NaN for a function or after a problem). */
    value(name: string): Value {
        const rec = this.recs.get(name);
        if (!rec || rec.def.params.length) return NaN;
        if (rec.state === 0) this.compile(rec);
        return rec.part ? this.read(rec, rec.part) : NaN;
    }

    ref(name: string): DefRef | null {
        const rec = this.recs.get(name);
        if (!rec) return null;
        if (rec.state === 1) {
            // A cycle: every definition on it gets the message.
            const at = this.stack.indexOf(rec);
            for (const r of this.stack.slice(at < 0 ? 0 : at)) r.error = r.error ?? msg('problems.math.selfReference', { name: r.def.name });
            throw new ExprError(msg('problems.math.selfReference', { name }));
        }
        if (rec.state === 0) this.compile(rec);
        if (rec.error) throw new ExprError(msg('problems.expr.dependsOnError', { name }));
        if (!rec.def.params.length) {
            const part = rec.part;
            if (!part) throw new ExprError(msg('problems.expr.dependsOnError', { name }));
            return { name, value: { shape: part.shape, read: () => this.read(rec, part) } };
        }
        return { name, fn: { params: rec.def.params, instance: (shapes) => this.instance(rec, shapes) } };
    }

    private read(rec: Rec, part: Part): Value {
        const v = this.host.version();
        if (rec.version !== v) {
            // Set first: a value that reads itself through a chart function gets NaN, not a loop.
            rec.version = v;
            rec.cached = NaN;
            rec.cached = part.f();
        }
        return rec.cached;
    }

    private compile(rec: Rec): void {
        if (rec.state !== 0) return;
        rec.state = 1;
        this.stack.push(rec);
        try {
            if (rec.error) return;
            const { name, params, expression } = rec.def;
            const conflict = this.host.conflict(name);
            if (conflict) {
                rec.error = conflict;
                return;
            }
            const seen = new Set<string>();
            for (const p of params) {
                if (!NAME_RE.test(p) || builtinFunction(p) || p === 'Math' || (isReservedName(p) && !/^[xyzt]$|^theta$/.test(p))) {
                    rec.error = msg('values.problem.badParameter', { name: p });
                    return;
                }
                if (seen.has(p)) {
                    rec.error = msg('values.problem.parameterTwice', { name: p });
                    return;
                }
                seen.add(p);
            }
            if (!expression.trim()) {
                rec.error = msg('problems.expr.enterExpression');
                return;
            }
            rec.ast = parseValue(expression);
            if (params.length) {
                // A function is checked with arguments of any shape: only names and syntax can be wrong here.
                this.instance(rec, params.map(() => ANY));
            } else {
                rec.part = new ValueCompiler({ env: this.host.env(), defs: this, locals: null, src: expression }).node(rec.ast);
            }
        } catch (e) {
            rec.error = rec.error ?? (e instanceof Error ? e.message : String(e));
            rec.part = null;
        } finally {
            this.stack.pop();
            rec.state = 2;
        }
    }

    private instance(rec: Rec, shapes: Shape[]): { cells: Cell[]; body: Part } {
        const key = shapes.map(shapeKey).join('|');
        const hit = rec.instances.get(key);
        if (hit instanceof ExprError) throw hit;
        if (hit) return hit;
        if (rec.building.has(key) || !rec.ast) throw new ExprError(msg('problems.math.selfReference', { name: rec.def.name }));
        rec.building.add(key);
        try {
            const cells: Cell[] = shapes.map(() => ({ v: NaN }));
            let locals: Locals | null = null;
            rec.def.params.forEach((p, i) => {
                locals = new Locals(locals, p, cells[i], shapes[i]);
            });
            const body = new ValueCompiler({ env: this.host.env(), defs: this, locals, src: rec.def.expression }).node(rec.ast);
            const out = { cells, body };
            rec.instances.set(key, out);
            return out;
        } catch (e) {
            const err = e instanceof ExprError ? e : new ExprError(String(e));
            rec.instances.set(key, err);
            throw err;
        } finally {
            rec.building.delete(key);
        }
    }
}
