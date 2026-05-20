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
 * Compile a math expression of one or two variables into a callable function.
 * Supports `^` as the power operator (rewritten to `**`).
 */
function compile1D(expression: string): (x: number) => number {
    return new Function('x', `return ${expression.replace(/\^/g, '**')}`) as (x: number) => number;
}

function compile2D(expression: string): (x: number, y: number) => number {
    return new Function('x', 'y', `return ${expression.replace(/\^/g, '**')}`) as (x: number, y: number) => number;
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

        for (let x = min + step; x < max - step; x += step) {
            const deriv1 = this.calculateDerivative(expression, x - step);
            const deriv2 = this.calculateDerivative(expression, x);

            if ((deriv1 < 0 && deriv2 > 0) || (deriv1 > 0 && deriv2 < 0)) {
                const secondDeriv =
                    (this.calculateDerivative(expression, x + DERIVATIVE_STEP) -
                        this.calculateDerivative(expression, x)) /
                    DERIVATIVE_STEP;
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
}
