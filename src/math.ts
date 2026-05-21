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

/**
 * Bare names from Math made available inside expressions so users can write
 * `tan(x)` instead of `Math.tan(x)`. Constants `PI` and `E` are exposed too.
 * The full `Math` object is still accessible for anything not listed here.
 */
const MATH_PRELUDE =
    'const {' +
    'sin,cos,tan,asin,acos,atan,atan2,' +
    'sinh,cosh,tanh,asinh,acosh,atanh,' +
    'exp,log,log2,log10,' +
    'sqrt,cbrt,pow,abs,sign,' +
    'floor,ceil,round,trunc,' +
    'min,max,hypot,' +
    'PI,E,LN2,LN10,LOG2E,LOG10E,SQRT2' +
    '}=Math;';

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
 * Compile a one-variable math expression into a callable. Cached on the
 * expression string so 500-sample render loops only call `new Function`
 * once per unique expression, not once per sample.
 */
function compile1D(expression: string): (x: number) => number {
    const cached = COMPILE_CACHE_1D.get(expression);
    if (cached) return cached;
    const body = expression.replace(/\^/g, '**');
    const fn = new Function('x', `${MATH_PRELUDE}return (${body});`) as (x: number) => number;
    COMPILE_CACHE_1D.set(expression, fn);
    pruneCache(COMPILE_CACHE_1D);
    return fn;
}

function compile2D(expression: string): (x: number, y: number) => number {
    const cached = COMPILE_CACHE_2D.get(expression);
    if (cached) return cached;
    const body = expression.replace(/\^/g, '**');
    const fn = new Function('x', 'y', `${MATH_PRELUDE}return (${body});`) as (x: number, y: number) => number;
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
        const min = Number(parts[0]);
        const max = Number(parts[1]);
        if (!isFinite(min) || !isFinite(max)) {
            throw new Error('Domain bounds must be finite numbers');
        }
        if (min >= max) {
            throw new Error('Domain min must be less than max');
        }
        return [min, max];
    }

    /**
     * Parse a tangent-point string and verify it lies inside the given domain.
     */
    static parseTangentPoint(point: string, domain: [number, number]): number {
        const x = Number(point);
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
