/**
 * Numerical differentiation step. Small enough for tangent precision on
 * typical functions, large enough to stay above double-precision noise.
 */
const DERIVATIVE_STEP = 0.0001;

/**
 * Number of samples used when scanning a domain for extrema. 100 is a
 * compromise between accuracy and responsiveness for the live preview.
 */
const EXTREMA_SAMPLES = 100;

/*
 * Safe expression compiler.
 *
 * Expressions are parsed with a hand-written recursive-descent parser and
 * compiled into a tree of closures - no `eval`, no `new Function`, so the
 * plugin never executes dynamically generated code. The accepted language
 * is a faithful subset of what the old `new Function` compiler allowed:
 *
 *   - numbers: `1`, `.5`, `2.75`, `1e-3`
 *   - variables: `x` (1D) or `x` and `y` (2D)
 *   - operators: `+ - * / % ^ **` with standard precedence; `^`/`**` are
 *     right-associative and bind tighter than unary minus, so `-x^2`
 *     means `-(x^2)` and `2^-x` works
 *   - piecewise support: `< <= > >= == != === !== && || !` and the
 *     ternary `cond ? a : b` (comparisons evaluate to 1/0)
 *   - calls: `sin(x)`, `atan2(y, x)`, `min(x, y, 0)`, ... - every name
 *     the old Math prelude exposed, plus `Math.foo(...)` member access
 *
 * Unknown names compile to a closure that throws when evaluated, matching
 * the old compiler's ReferenceError-at-call-time behavior that the
 * renderers' try/catch sampling loops already handle.
 */

type NumFn2 = (x: number, y: number) => number;

/** Bare names available without a `Math.` prefix (the old destructured prelude). */
const BARE_FUNCTIONS: Record<string, (...args: number[]) => number> = {
    sin: Math.sin, cos: Math.cos, tan: Math.tan,
    asin: Math.asin, acos: Math.acos, atan: Math.atan, atan2: Math.atan2,
    sinh: Math.sinh, cosh: Math.cosh, tanh: Math.tanh,
    asinh: Math.asinh, acosh: Math.acosh, atanh: Math.atanh,
    exp: Math.exp, log: Math.log, log2: Math.log2, log10: Math.log10,
    sqrt: Math.sqrt, cbrt: Math.cbrt, pow: Math.pow, abs: Math.abs, sign: Math.sign,
    floor: Math.floor, ceil: Math.ceil, round: Math.round, trunc: Math.trunc,
    min: Math.min, max: Math.max, hypot: Math.hypot,
};

const BARE_CONSTANTS: Record<string, number> = {
    PI: Math.PI, E: Math.E, LN2: Math.LN2, LN10: Math.LN10,
    LOG2E: Math.LOG2E, LOG10E: Math.LOG10E, SQRT2: Math.SQRT2,
};

/** Everything reachable via `Math.<name>` (the whole object used to be in scope). */
const MATH_MEMBER_FUNCTIONS: Record<string, (...args: number[]) => number> = {
    ...BARE_FUNCTIONS,
    log1p: Math.log1p, expm1: Math.expm1, fround: Math.fround, random: Math.random,
};

const MATH_MEMBER_CONSTANTS: Record<string, number> = {
    ...BARE_CONSTANTS,
    SQRT1_2: Math.SQRT1_2,
};

/**
 * Own-property lookups. Plain-object tables inherit from Object.prototype,
 * so a bare `[name]` index would resolve names like `constructor` or
 * `toString` to functions that are not part of the expression language.
 */
function ownFunction(
    table: Record<string, (...args: number[]) => number>,
    name: string
): ((...args: number[]) => number) | undefined {
    return Object.prototype.hasOwnProperty.call(table, name) ? table[name] : undefined;
}

function ownConstant(table: Record<string, number>, name: string): number | undefined {
    return Object.prototype.hasOwnProperty.call(table, name) ? table[name] : undefined;
}

interface Token {
    kind: 'num' | 'ident' | 'punct' | 'end';
    text: string;
    value: number;
    pos: number;
}

/** Longest-first so `===`/`!==` win over `==`/`!=`/`!`, `**` over `*`, `<=` over `<`. */
const PUNCTUATORS = [
    '===', '!==', '**', '==', '!=', '<=', '>=', '&&', '||',
    '<', '>', '+', '-', '*', '/', '%', '^', '(', ')', ',', '?', ':', '.', '!',
];

const NUM_RE = /(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?/y;
const IDENT_RE = /[A-Za-z_$][A-Za-z0-9_$]*/y;

function tokenize(src: string): Token[] {
    const tokens: Token[] = [];
    let i = 0;
    while (i < src.length) {
        const code = src.charCodeAt(i);
        if (code === 32 || code === 9 || code === 10 || code === 13) {
            i++;
            continue;
        }
        NUM_RE.lastIndex = i;
        const num = NUM_RE.exec(src);
        if (num) {
            tokens.push({ kind: 'num', text: num[0], value: Number(num[0]), pos: i });
            i = NUM_RE.lastIndex;
            continue;
        }
        IDENT_RE.lastIndex = i;
        const ident = IDENT_RE.exec(src);
        if (ident) {
            tokens.push({ kind: 'ident', text: ident[0], value: 0, pos: i });
            i = IDENT_RE.lastIndex;
            continue;
        }
        const punct = PUNCTUATORS.find((p) => src.startsWith(p, i));
        if (!punct) {
            throw new Error(`Unexpected character '${src[i]}' at position ${i}`);
        }
        tokens.push({ kind: 'punct', text: punct, value: 0, pos: i });
        i += punct.length;
    }
    tokens.push({ kind: 'end', text: '', value: 0, pos: src.length });
    return tokens;
}

class ExprParser {
    private tokens: Token[];
    private i = 0;
    private vars: readonly string[];

    constructor(src: string, vars: readonly string[]) {
        this.tokens = tokenize(src);
        this.vars = vars;
    }

    compile(): NumFn2 {
        const fn = this.parseTernary();
        const t = this.peek();
        if (t.kind !== 'end') {
            throw new Error(`Unexpected '${t.text}' at position ${t.pos}`);
        }
        return fn;
    }

    private peek(): Token {
        return this.tokens[this.i];
    }

    private next(): Token {
        return this.tokens[this.i++];
    }

    private at(text: string): boolean {
        const t = this.tokens[this.i];
        return t.kind === 'punct' && t.text === text;
    }

    private eat(text: string): boolean {
        if (this.at(text)) {
            this.i++;
            return true;
        }
        return false;
    }

    private expect(text: string): void {
        if (!this.eat(text)) {
            const t = this.peek();
            const found = t.kind === 'end' ? 'end of expression' : `'${t.text}'`;
            throw new Error(`Expected '${text}' but found ${found} at position ${t.pos}`);
        }
    }

    private parseTernary(): NumFn2 {
        const cond = this.parseOr();
        if (!this.eat('?')) return cond;
        const whenTrue = this.parseTernary();
        this.expect(':');
        const whenFalse = this.parseTernary();
        return (x, y) => (cond(x, y) ? whenTrue(x, y) : whenFalse(x, y));
    }

    private parseOr(): NumFn2 {
        let left = this.parseAnd();
        while (this.eat('||')) {
            const l = left;
            const r = this.parseAnd();
            left = (x, y) => {
                const v = l(x, y);
                return v ? v : r(x, y);
            };
        }
        return left;
    }

    private parseAnd(): NumFn2 {
        let left = this.parseEquality();
        while (this.eat('&&')) {
            const l = left;
            const r = this.parseEquality();
            left = (x, y) => {
                const v = l(x, y);
                return v ? r(x, y) : v;
            };
        }
        return left;
    }

    private parseEquality(): NumFn2 {
        let left = this.parseRelational();
        for (;;) {
            const eq = this.eat('==') || this.eat('===');
            const ne = !eq && (this.eat('!=') || this.eat('!=='));
            if (!eq && !ne) return left;
            const l = left;
            const r = this.parseRelational();
            left = eq
                ? (x, y) => (l(x, y) === r(x, y) ? 1 : 0)
                : (x, y) => (l(x, y) !== r(x, y) ? 1 : 0);
        }
    }

    private parseRelational(): NumFn2 {
        let left = this.parseAdditive();
        for (;;) {
            const l = left;
            if (this.eat('<=')) {
                const r = this.parseAdditive();
                left = (x, y) => (l(x, y) <= r(x, y) ? 1 : 0);
            } else if (this.eat('>=')) {
                const r = this.parseAdditive();
                left = (x, y) => (l(x, y) >= r(x, y) ? 1 : 0);
            } else if (this.eat('<')) {
                const r = this.parseAdditive();
                left = (x, y) => (l(x, y) < r(x, y) ? 1 : 0);
            } else if (this.eat('>')) {
                const r = this.parseAdditive();
                left = (x, y) => (l(x, y) > r(x, y) ? 1 : 0);
            } else {
                return left;
            }
        }
    }

    private parseAdditive(): NumFn2 {
        let left = this.parseMultiplicative();
        for (;;) {
            const l = left;
            if (this.eat('+')) {
                const r = this.parseMultiplicative();
                left = (x, y) => l(x, y) + r(x, y);
            } else if (this.eat('-')) {
                const r = this.parseMultiplicative();
                left = (x, y) => l(x, y) - r(x, y);
            } else {
                return left;
            }
        }
    }

    private parseMultiplicative(): NumFn2 {
        let left = this.parseUnary();
        for (;;) {
            const l = left;
            if (this.eat('*')) {
                const r = this.parseUnary();
                left = (x, y) => l(x, y) * r(x, y);
            } else if (this.eat('/')) {
                const r = this.parseUnary();
                left = (x, y) => l(x, y) / r(x, y);
            } else if (this.eat('%')) {
                const r = this.parseUnary();
                left = (x, y) => l(x, y) % r(x, y);
            } else {
                return left;
            }
        }
    }

    private parseUnary(): NumFn2 {
        if (this.eat('-')) {
            const operand = this.parseUnary();
            return (x, y) => -operand(x, y);
        }
        if (this.eat('+')) {
            return this.parseUnary();
        }
        if (this.eat('!')) {
            const operand = this.parseUnary();
            return (x, y) => (operand(x, y) ? 0 : 1);
        }
        return this.parsePower();
    }

    private parsePower(): NumFn2 {
        const base = this.parsePrimary();
        if (this.eat('^') || this.eat('**')) {
            // Right-associative; parseUnary on the right allows `2^-x`.
            const exponent = this.parseUnary();
            return (x, y) => Math.pow(base(x, y), exponent(x, y));
        }
        return base;
    }

    private parsePrimary(): NumFn2 {
        const t = this.next();
        if (t.kind === 'num') {
            const v = t.value;
            return () => v;
        }
        if (t.kind === 'punct' && t.text === '(') {
            const inner = this.parseTernary();
            this.expect(')');
            return inner;
        }
        if (t.kind === 'ident') {
            return this.resolveName(t);
        }
        const found = t.kind === 'end' ? 'end of expression' : `'${t.text}'`;
        throw new Error(`Unexpected ${found} at position ${t.pos}`);
    }

    private parseArgs(): NumFn2[] {
        this.expect('(');
        const args: NumFn2[] = [];
        if (this.eat(')')) return args;
        do {
            args.push(this.parseTernary());
        } while (this.eat(','));
        this.expect(')');
        return args;
    }

    private callClosure(fn: (...args: number[]) => number, args: NumFn2[]): NumFn2 {
        // Fixed-arity fast paths cover nearly every real expression.
        if (args.length === 1) {
            const a = args[0];
            return (x, y) => fn(a(x, y));
        }
        if (args.length === 2) {
            const a = args[0];
            const b = args[1];
            return (x, y) => fn(a(x, y), b(x, y));
        }
        if (args.length === 0) return () => fn();
        return (x, y) => fn(...args.map((a) => a(x, y)));
    }

    private unknownName(name: string): NumFn2 {
        return () => {
            throw new Error(`Unknown name '${name}' in expression`);
        };
    }

    private resolveName(t: Token): NumFn2 {
        const name = t.text;
        if (name === 'Math' && this.eat('.')) {
            const member = this.next();
            if (member.kind !== 'ident') {
                throw new Error(`Expected a Math member name at position ${member.pos}`);
            }
            if (this.at('(')) {
                const args = this.parseArgs();
                const fn = ownFunction(MATH_MEMBER_FUNCTIONS, member.text);
                return fn ? this.callClosure(fn, args) : this.unknownName(`Math.${member.text}`);
            }
            const constant = ownConstant(MATH_MEMBER_CONSTANTS, member.text);
            if (constant !== undefined) return () => constant;
            return this.unknownName(`Math.${member.text}`);
        }
        if (this.at('(')) {
            const args = this.parseArgs();
            const fn = ownFunction(BARE_FUNCTIONS, name);
            return fn ? this.callClosure(fn, args) : this.unknownName(name);
        }
        if (name === this.vars[0]) return (x) => x;
        if (name === this.vars[1]) return (_x, y) => y;
        const constant = ownConstant(BARE_CONSTANTS, name);
        if (constant !== undefined) return () => constant;
        // `true` and `false` were valid under the old JS-based compiler.
        if (name === 'true') return () => 1;
        if (name === 'false') return () => 0;
        return this.unknownName(name);
    }
}

const VARS_1D: readonly string[] = ['x'];
const VARS_2D: readonly string[] = ['x', 'y'];

/**
 * Cap on cached compiled functions. The Map's insertion order doubles as a
 * cheap LRU, so the oldest entry is evicted when the cap is hit.
 */
const COMPILE_CACHE_MAX = 128;

const COMPILE_CACHE_1D = new Map<string, (x: number) => number>();
const COMPILE_CACHE_2D = new Map<string, (x: number, y: number) => number>();

function pruneCache<K, V>(cache: Map<K, V>) {
    while (cache.size > COMPILE_CACHE_MAX) {
        const oldest = cache.keys().next().value;
        if (oldest === undefined) break;
        cache.delete(oldest);
    }
}

/**
 * Parse a single domain bound or tangent-point value. Accepts plain
 * numbers ("3", "-0.5", "1e3") and any expression that evaluates to a
 * finite scalar ("PI", "2*PI", "sqrt(3)", "log(10)"). The expression
 * path runs through the same MATH_PRELUDE as plotted functions, so
 * the exact same syntax works everywhere.
 *
 * Returns NaN for unparseable input; the caller decides whether that
 * is fatal.
 */
function parseBound(text: string): number {
    if (text === undefined || text === null) return NaN;
    const s = String(text).trim();
    if (s === '') return NaN;
    // Plain-number fast path. Avoids the parse cost for the
    // overwhelming-majority case where the user typed a literal like
    // `-10` or `3.14`.
    const direct = Number(s);
    if (Number.isFinite(direct)) return direct;
    try {
        // Reuse the 1D compile cache: the expression is independent of
        // x, so any value for x works; we pass 0.
        const value = compile1D(s)(0);
        return Number.isFinite(value) ? value : NaN;
    } catch {
        return NaN;
    }
}

/**
 * Compile a one-variable math expression into a callable. Cached on the
 * expression string so 500-sample render loops only parse each unique
 * expression once, not once per sample.
 */
function compile1D(expression: string): (x: number) => number {
    const cached = COMPILE_CACHE_1D.get(expression);
    if (cached) return cached;
    const compiled = new ExprParser(expression, VARS_1D).compile();
    const fn = (x: number) => compiled(x, 0);
    COMPILE_CACHE_1D.set(expression, fn);
    pruneCache(COMPILE_CACHE_1D);
    return fn;
}

function compile2D(expression: string): (x: number, y: number) => number {
    const cached = COMPILE_CACHE_2D.get(expression);
    if (cached) return cached;
    const compiled = new ExprParser(expression, VARS_2D).compile();
    const fn = (x: number, y: number) => compiled(x, y);
    COMPILE_CACHE_2D.set(expression, fn);
    pruneCache(COMPILE_CACHE_2D);
    return fn;
}

export class MathHelper {
    /**
     * Parse a domain string of the form "min:max" into two finite numbers.
     * Throws a descriptive Error on malformed input.
     */
    static parseDomain(domain: string): [number, number] {
        if (!domain || typeof domain !== 'string') {
            throw new Error('Domain is empty');
        }
        const parts = domain.split(':');
        if (parts.length !== 2) {
            throw new Error('Domain must look like "min:max", e.g. -10:10');
        }
        const min = parseBound(parts[0]);
        const max = parseBound(parts[1]);
        if (!isFinite(min) || !isFinite(max)) {
            throw new Error('Domain bounds must be finite numbers (or finite-valued expressions like 2*PI, sqrt(3))');
        }
        if (min >= max) {
            throw new Error('Domain min must be less than max');
        }
        return [min, max];
    }

    /**
     * Parse a tangent-point string and verify it lies inside the given domain.
     * Accepts plain numbers or expressions that evaluate to one (e.g. `PI/2`).
     */
    static parseTangentPoint(point: string, domain: [number, number]): number {
        const x = parseBound(point);
        if (!isFinite(x)) {
            throw new Error('Tangent point must be a number');
        }
        const [min, max] = domain;
        if (x < min || x > max) {
            throw new Error(`Tangent point ${x} is outside the domain [${min}, ${max}]`);
        }
        return x;
    }

    /**
     * Return the cached compiled function for a one-variable expression.
     * Throws on syntax errors. Renderers should call this once per render
     * and then invoke the returned function in tight loops.
     */
    static compile1D(expression: string): (x: number) => number {
        return compile1D(expression);
    }

    /** Same as compile1D but for two-variable expressions. */
    static compile2D(expression: string): (x: number, y: number) => number {
        return compile2D(expression);
    }

    /** Forward-difference numerical derivative of `expression` at `x`. */
    static calculateDerivative(expression: string, x: number): number {
        const f = compile1D(expression);
        return (f(x + DERIVATIVE_STEP) - f(x)) / DERIVATIVE_STEP;
    }

    /**
     * Scan the domain for sign changes in the first derivative and return the
     * minima and maxima found. Resolution is set by `EXTREMA_SAMPLES`.
     */
    static findExtrema(expression: string, domain: string): { x: number; y: number; type: string }[] {
        const [min, max] = this.parseDomain(domain);
        const step = (max - min) / EXTREMA_SAMPLES;
        const extrema: { x: number; y: number; type: string }[] = [];
        const f = compile1D(expression);
        const deriv = (x: number) => (f(x + DERIVATIVE_STEP) - f(x)) / DERIVATIVE_STEP;

        for (let x = min + step; x < max - step; x += step) {
            const deriv1 = deriv(x - step);
            const deriv2 = deriv(x);

            if ((deriv1 < 0 && deriv2 > 0) || (deriv1 > 0 && deriv2 < 0)) {
                const secondDeriv = (deriv(x + DERIVATIVE_STEP) - deriv(x)) / DERIVATIVE_STEP;
                const type = secondDeriv > 0 ? 'minimum' : 'maximum';
                extrema.push({
                    x: Number(x.toFixed(3)),
                    y: Number(f(x).toFixed(3)),
                    type,
                });
            }
        }

        return extrema;
    }

    /** Return the equation of the tangent line to `expression` at `x0`. */
    static calculateTangentLine(expression: string, x0: number): string {
        const f = compile1D(expression);
        const y0 = f(x0);
        const slope = this.calculateDerivative(expression, x0);
        return `${slope}*x + ${y0 - slope * x0}`;
    }

    /** Evaluate a one-variable expression at `x`. */
    static evaluateExpression(expression: string, x: number): number {
        return compile1D(expression)(x);
    }

    /** Evaluate a two-variable expression at `(x, y)`. */
    static evaluateExpression2D(expression: string, x: number, y: number): number {
        return compile2D(expression)(x, y);
    }

    /**
     * Find all `x` values on `[domMin, domMax]` where `f(x) = g(x)`.
     * Coarse-scans the domain in `INTERSECTION_SAMPLES` steps looking for
     * sign changes in `f - g`; each sign-change interval is then refined
     * with 40 iterations of bisection. Returns the resulting `(x, y)`
     * pairs where `y = f(x)`. Intervals where either function is
     * non-finite are skipped so vertical asymptotes do not produce
     * spurious roots.
     */
    static findIntersections(
        expr1: string,
        expr2: string,
        domain: [number, number]
    ): { x: number; y: number }[] {
        const f = compile1D(expr1);
        const g = compile1D(expr2);
        const [domMin, domMax] = domain;
        const N = 200;
        const step = (domMax - domMin) / N;
        const roots: { x: number; y: number }[] = [];

        const diff = (x: number): number => f(x) - g(x);

        let prevX = domMin;
        let prevD = diff(prevX);
        for (let i = 1; i <= N; i++) {
            const x = domMin + i * step;
            const d = diff(x);
            if (!isFinite(prevD) || !isFinite(d)) {
                prevX = x;
                prevD = d;
                continue;
            }
            if (prevD === 0) {
                roots.push({ x: Number(prevX.toFixed(5)), y: Number(f(prevX).toFixed(5)) });
            } else if (prevD * d < 0) {
                // Bisect between prevX and x.
                let lo = prevX;
                let hi = x;
                let dLo = prevD;
                for (let k = 0; k < 40; k++) {
                    const mid = (lo + hi) / 2;
                    const dMid = diff(mid);
                    if (!isFinite(dMid)) break;
                    if (dLo * dMid <= 0) {
                        hi = mid;
                    } else {
                        lo = mid;
                        dLo = dMid;
                    }
                }
                const root = (lo + hi) / 2;
                if (isFinite(root)) {
                    const y = f(root);
                    if (isFinite(y)) {
                        roots.push({ x: Number(root.toFixed(5)), y: Number(y.toFixed(5)) });
                    }
                }
            }
            prevX = x;
            prevD = d;
        }

        // De-duplicate near-coincident roots (e.g. tangent intersections found twice).
        const TOL = (domMax - domMin) * 1e-4;
        const deduped: { x: number; y: number }[] = [];
        for (const r of roots) {
            if (!deduped.some((d) => Math.abs(d.x - r.x) < TOL)) {
                deduped.push(r);
            }
        }
        return deduped;
    }
}
