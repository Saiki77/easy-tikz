/*
 * Numeric helpers for scalar functions: extrema of a sampled f(x)
 * (findExtrema1D, used by the scene for function extrema). Expressions
 * are compiled by MathContext (src/mathcontext.ts); this file only works
 * on plain number -> number callables.
 */

/** Default sample count when scanning an interval for extrema. */
const EXTREMA_SAMPLES = 200;

/** Golden-section iterations: shrinks the bracket by 0.618^80 (about 1e-17). */
const GOLDEN_ITERATIONS = 80;

const INV_PHI = (Math.sqrt(5) - 1) / 2;

/** Argmin of `g` on [a, b] by golden-section search (g unimodal on the bracket). */
function goldenMin(g: (x: number) => number, a: number, b: number): number {
    let c = b - INV_PHI * (b - a);
    let d = a + INV_PHI * (b - a);
    let gc = g(c);
    let gd = g(d);
    for (let k = 0; k < GOLDEN_ITERATIONS && b - a > 0; k++) {
        if (gc < gd || (Number.isNaN(gd) && !Number.isNaN(gc))) {
            b = d;
            d = c;
            gd = gc;
            c = b - INV_PHI * (b - a);
            gc = g(c);
        } else {
            a = c;
            c = d;
            gc = gd;
            d = a + INV_PHI * (b - a);
            gd = g(d);
        }
    }
    return (a + b) / 2;
}

/**
 * Local minima and maxima of `f` strictly inside [lo, hi]. Samples
 * `samples` intervals (default 200), finds sign changes of the slope
 * (flat runs are skipped, so plateaus bracket correctly), refines each
 * bracket with golden-section search and dedupes near-identical results.
 * Brackets touching a non-finite sample are skipped, and so are brackets
 * whose refinement runs into a pole or jump (tan, 1/x, x % 1): those are
 * not extrema. Endpoints are never reported.
 */
export function findExtrema1D(
    f: (x: number) => number,
    lo: number,
    hi: number,
    samples?: number
): Array<{ x: number; y: number; type: 'minimum' | 'maximum' }> {
    const out: Array<{ x: number; y: number; type: 'minimum' | 'maximum' }> = [];
    if (!Number.isFinite(lo) || !Number.isFinite(hi) || !(hi > lo)) return out;
    const n = Math.max(3, Math.floor(samples !== undefined && Number.isFinite(samples) ? samples : EXTREMA_SAMPLES));
    const step = (hi - lo) / n;
    const xs: number[] = [];
    const ys: number[] = [];
    let ymin = Infinity;
    let ymax = -Infinity;
    for (let i = 0; i <= n; i++) {
        const x = i === n ? hi : lo + i * step;
        const y = f(x);
        xs.push(x);
        ys.push(y);
        if (Number.isFinite(y)) {
            ymin = Math.min(ymin, y);
            ymax = Math.max(ymax, y);
        }
    }
    const dedupeTol = (hi - lo) * 1e-6;
    // Continuity probe: next to a real extremum f barely moves over `probe`;
    // next to a pole or a jump it leaps by a sizeable part of the sampled range.
    const probe = (hi - lo) * 1e-7;
    const jumpTol = (ymax - ymin) * 1e-2;
    const continuousAt = (x: number, y: number): boolean => {
        const left = f(Math.max(lo, x - probe));
        const right = f(Math.min(hi, x + probe));
        return Math.abs(left - y) <= jumpTol && Math.abs(right - y) <= jumpTol;
    };
    // Sign of the last non-flat slope and the index of the sample where it started.
    let lastSign = 0;
    let lastIdx = -1;
    for (let i = 0; i < n; i++) {
        const y0 = ys[i];
        const y1 = ys[i + 1];
        if (!Number.isFinite(y0) || !Number.isFinite(y1)) {
            lastSign = 0;
            continue;
        }
        const sign = y1 > y0 ? 1 : y1 < y0 ? -1 : 0;
        if (sign === 0) continue;
        if (lastSign !== 0 && sign !== lastSign) {
            const type = lastSign > 0 ? 'maximum' : 'minimum';
            const g = type === 'minimum' ? f : (x: number) => -f(x);
            const x = goldenMin(g, xs[lastIdx], xs[i + 1]);
            const y = f(x);
            if (Number.isFinite(y) && continuousAt(x, y)) {
                // Best sample inside the bracket: fallback when the refinement wanders.
                let bestX = xs[i];
                let bestY = ys[i];
                for (let j = lastIdx + 1; j <= i; j++) {
                    if (type === 'maximum' ? ys[j] > bestY : ys[j] < bestY) {
                        bestX = xs[j];
                        bestY = ys[j];
                    }
                }
                const better = type === 'maximum' ? y >= bestY : y <= bestY;
                const px = better ? x : bestX;
                const py = better ? y : bestY;
                const prev = out[out.length - 1];
                if (!prev || prev.type !== type || Math.abs(prev.x - px) > dedupeTol) {
                    out.push({ x: px, y: py, type });
                }
            }
        }
        lastSign = sign;
        lastIdx = i;
    }
    return out;
}
