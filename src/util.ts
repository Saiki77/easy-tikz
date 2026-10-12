import { Grid, Pt, View } from './geometry';

/**
 * Choose a "nice" tick interval (1, 2, or 5 times a power of ten) so that the
 * given range contains roughly `targetTicks` major ticks.
 */
export function niceInterval(range: number, targetTicks: number): number {
    const rough = range / targetTicks;
    const mag = Math.pow(10, Math.floor(Math.log10(rough)));
    const norm = rough / mag;
    let nice: number;
    if (norm <= 1.5) nice = 1;
    else if (norm <= 3) nice = 2;
    else if (norm <= 7) nice = 5;
    else nice = 10;
    return nice * mag;
}

/**
 * Multiples of `step` inside [min, max] (inclusive, with a little slack for
 * rounding), computed as k * step so positions do not drift the way a
 * running `x += step` does. Returns [] for a non-positive or non-finite step
 * and when there would be more than `cap` values.
 */
export function tickValues(min: number, max: number, step: number, cap = 1000): number[] {
    if (!(step > 0) || !Number.isFinite(step) || !Number.isFinite(min) || !Number.isFinite(max) || max < min) return [];
    const slack = step * 1e-9;
    const first = Math.ceil((min - slack) / step);
    const last = Math.floor((max + slack) / step);
    if (last - first + 1 > cap) return [];
    const out: number[] = [];
    // k = 0 maps to 0 itself, never -0.
    for (let k = first; k <= last; k++) out.push(k === 0 ? 0 : k * step);
    return out;
}

/** Samples further than this many view sizes outside the view are not drawn (asymptotes, overflow). */
const CURVE_CLAMP = 10;
/**
 * A step between two samples longer than this fraction of the view (in x or
 * y) is checked for a jump. Bisection keeps steep continuous stretches
 * connected, so the threshold can be small enough to catch the steps of
 * floor(x) or a fixed-charge cost, not only poles.
 */
const JUMP_FRACTION = 0.02;
/** Bisection steps used to locate a jump or the end of a drawable stretch. */
const REFINE_STEPS = 24;

/**
 * Sample the curve `t -> at(t)` at n + 1 evenly spaced parameters on
 * [lo, hi] and return its drawable polylines in math coordinates.
 * - A point is drawable when both coordinates are finite and within
 *   CURVE_CLAMP view sizes of the view; the polyline breaks elsewhere, and
 *   each stretch is extended by bisection to its last drawable point (so
 *   sqrt(x) reaches x = 0 and tan(x) leaves the view instead of stopping
 *   at the last sample).
 * - Jumps: when two neighbouring samples are more than JUMP_FRACTION of the
 *   view apart, the interval is bisected towards the half that moves more.
 *   A continuous steep stretch shrinks below the threshold and stays
 *   connected; a jump (step functions, poles) keeps its size, and the path
 *   breaks there instead of drawing a vertical connector.
 * Cartesian callers pass `t -> (t, f(t))`, polar `theta -> (r cos, r sin)`.
 * Polylines with fewer than two points are dropped.
 */
export function sampleCurve(at: (t: number) => Pt, lo: number, hi: number, n: number, view: View): Pt[][] {
    const dx = view.xmax - view.xmin;
    const dy = view.ymax - view.ymin;
    if (!(hi > lo) || !(dx > 0) || !(dy > 0) || !(n >= 1)) return [];
    const minX = view.xmin - CURVE_CLAMP * dx;
    const maxX = view.xmax + CURVE_CLAMP * dx;
    const minY = view.ymin - CURVE_CLAMP * dy;
    const maxY = view.ymax + CURVE_CLAMP * dy;
    // NaN fails every comparison, so non-finite points are never drawable.
    const ok = (p: Pt) => p.x >= minX && p.x <= maxX && p.y >= minY && p.y <= maxY;
    const size = (a: Pt, b: Pt) => Math.max(Math.abs(b.x - a.x) / dx, Math.abs(b.y - a.y) / dy);

    /** Last drawable point walking from parameter `good` (drawable) towards `bad` (not drawable). */
    const edge = (good: number, bad: number): Pt => {
        let g = good;
        let b = bad;
        let p = at(good);
        for (let k = 0; k < REFINE_STEPS; k++) {
            const m = (g + b) / 2;
            const pm = at(m);
            if (ok(pm)) {
                g = m;
                p = pm;
            } else {
                b = m;
            }
        }
        return p;
    };

    /** Null when the curve is continuous between two drawable samples, else [last point before, first after]. */
    const gap = (ta: number, pa: Pt, tb: number, pb: Pt): [Pt, Pt] | null => {
        if (size(pa, pb) <= JUMP_FRACTION) return null;
        let a = ta;
        let b = tb;
        for (let k = 0; k < REFINE_STEPS; k++) {
            const m = (a + b) / 2;
            const pm = at(m);
            if (!ok(pm)) return [edge(a, m), edge(b, m)];
            const left = size(pa, pm);
            const right = size(pm, pb);
            if (left <= JUMP_FRACTION && right <= JUMP_FRACTION) return null;
            if (left >= right) {
                b = m;
                pb = pm;
            } else {
                a = m;
                pa = pm;
            }
        }
        return [pa, pb];
    };

    const lines: Pt[][] = [];
    let line: Pt[] | null = null;
    let prev: Pt = { x: NaN, y: NaN };
    let prevT = lo;
    let prevGood = false;
    for (let i = 0; i <= n; i++) {
        const t = i === n ? hi : lo + ((hi - lo) * i) / n;
        const p = at(t);
        const good = ok(p);
        if (i > 0) {
            if (prevGood && good && line) {
                const br = gap(prevT, prev, t, p);
                if (br) {
                    line.push(br[0]);
                    line = [br[1]];
                    lines.push(line);
                }
            } else if (prevGood && line) {
                line.push(edge(prevT, t));
                line = null;
            } else if (good) {
                line = [edge(t, prevT)];
                lines.push(line);
            }
        }
        if (good) {
            if (!line) {
                line = [];
                lines.push(line);
            }
            line.push(p);
        }
        prev = p;
        prevT = t;
        prevGood = good;
    }
    const out: Pt[][] = [];
    for (const l of lines) {
        const pts: Pt[] = [];
        for (const p of l) {
            const q = pts[pts.length - 1];
            if (!q || q.x !== p.x || q.y !== p.y) pts.push(p);
        }
        if (pts.length >= 2) out.push(pts);
    }
    return out;
}

/**
 * Marching-squares cell size in on-screen CSS px per preview quality, with
 * clamps on the node count per axis: full renders use ~3 px cells, draft
 * frames (slider drags, pans) ~6 px.
 */
const MARCHING_CELLS: Record<'draft' | 'full', { cell: number; min: number; max: number }> = {
    full: { cell: 3, min: 40, max: 300 },
    draft: { cell: 6, min: 24, max: 160 },
};

/**
 * Steps per unit that a pixel scale is rounded to (0.05): a resize by a few
 * px keeps the same grid, so the scene memo stays warm.
 */
const PIXEL_SCALE_STEPS = 20;

/**
 * On-screen CSS px per viewBox unit, rounded to 0.05 and capped at 1. Below
 * 1 (the chart is shown smaller than its viewBox, the usual case) the
 * marching-squares grid gets coarser to match what is actually seen; above
 * 1 the grid keeps one cell per 3 (6) viewBox units, so a large display
 * never costs more than the viewBox alone. Unusable input gives 1.
 */
export function normalizePixelScale(scale: number | null | undefined): number {
    if (typeof scale !== 'number' || !Number.isFinite(scale) || scale <= 0) return 1;
    const stepped = Math.round(scale * PIXEL_SCALE_STEPS) / PIXEL_SCALE_STEPS;
    return Math.max(1 / PIXEL_SCALE_STEPS, Math.min(1, stepped));
}

/**
 * The normalized pixel scale of a `width` x `height` chart (viewBox units)
 * drawn letterboxed (preserveAspectRatio meet) into a `boxW` x `boxH` CSS
 * px box. 1 while the box is not laid out yet (zero or unusable size).
 */
export function fitPixelScale(boxW: number, boxH: number, width: number, height: number): number {
    if (!(boxW > 0 && boxH > 0 && width > 0 && height > 0)) return 1;
    return normalizePixelScale(Math.min(boxW / width, boxH / height));
}

/**
 * Marching-squares resolution for a plot of `plotW` x `plotH` viewBox units
 * shown at `pixelScale` (normalized here, see normalizePixelScale): ~3 px
 * cells for full renders, ~6 px for draft frames, node counts clamped.
 */
export function marchingGrid(plotW: number, plotH: number, pixelScale: number | undefined, quality: 'draft' | 'full'): Grid {
    const g = MARCHING_CELLS[quality];
    const s = normalizePixelScale(pixelScale);
    const nodes = (len: number) => {
        const n = Math.round(((Number.isFinite(len) && len > 0 ? len : 0) * s) / g.cell);
        return Math.max(g.min, Math.min(g.max, n));
    };
    return { nx: nodes(plotW), ny: nodes(plotH) };
}

/**
 * Format an axis tick value as a short readable string. Falls back to
 * scientific notation for very large or very small numbers.
 */
export function formatTick(value: number): string {
    if (Math.abs(value) < 1e-10) return '0';
    if (Math.abs(value) >= 1000 || (Math.abs(value) < 0.01 && value !== 0)) {
        return value.toExponential(1);
    }
    const s = value.toPrecision(4);
    return parseFloat(s).toString();
}

const SYMBOL_MAP: Record<string, string> = {
    '\\backslash': '\\',
    '\\textbackslash': '\\',
    '\\sum': '∑',
    '\\prod': '∏',
    '\\int': '∫',
    '\\oint': '∮',
    '\\infty': '∞',
    '\\partial': '∂',
    '\\nabla': '∇',
    '\\pm': '±',
    '\\mp': '∓',
    '\\times': '×',
    '\\div': '÷',
    '\\cdot': '·',
    '\\ast': '∗',
    '\\circ': '∘',
    '\\bullet': '•',
    '\\leq': '≤',
    '\\le': '≤',
    '\\geq': '≥',
    '\\ge': '≥',
    '\\neq': '≠',
    '\\ne': '≠',
    '\\approx': '≈',
    '\\equiv': '≡',
    '\\sim': '∼',
    '\\simeq': '≃',
    '\\cong': '≅',
    '\\propto': '∝',
    '\\ll': '≪',
    '\\gg': '≫',
    '\\forall': '∀',
    '\\exists': '∃',
    '\\nexists': '∄',
    '\\in': '∈',
    '\\notin': '∉',
    '\\ni': '∋',
    '\\subset': '⊂',
    '\\subseteq': '⊆',
    '\\supset': '⊃',
    '\\supseteq': '⊇',
    '\\cup': '∪',
    '\\cap': '∩',
    '\\setminus': '∖',
    '\\emptyset': '∅',
    '\\varnothing': '∅',
    '\\wedge': '∧',
    '\\land': '∧',
    '\\vee': '∨',
    '\\lor': '∨',
    '\\neg': '¬',
    '\\lnot': '¬',
    '\\oplus': '⊕',
    '\\otimes': '⊗',
    '\\perp': '⊥',
    '\\parallel': '∥',
    '\\angle': '∠',
    '\\degree': '°',
    '\\to': '→',
    '\\rightarrow': '→',
    '\\longrightarrow': '⟶',
    '\\Rightarrow': '⇒',
    '\\Longrightarrow': '⟹',
    '\\leftarrow': '←',
    '\\longleftarrow': '⟵',
    '\\Leftarrow': '⇐',
    '\\leftrightarrow': '↔',
    '\\Leftrightarrow': '⇔',
    '\\mapsto': '↦',
    '\\cdots': '⋯',
    '\\ldots': '…',
    '\\dots': '…',
    '\\vdots': '⋮',
    '\\ddots': '⋱',
    '\\prime': '′',
    '\\hbar': 'ℏ',
    '\\ell': 'ℓ',
    '\\Re': 'ℜ',
    '\\Im': 'ℑ',
    '\\aleph': 'ℵ',
    '\\wp': '℘',
    // Greek (lowercase)
    '\\alpha': 'α',
    '\\beta': 'β',
    '\\gamma': 'γ',
    '\\delta': 'δ',
    '\\epsilon': 'ε',
    '\\varepsilon': 'ε',
    '\\zeta': 'ζ',
    '\\eta': 'η',
    '\\theta': 'θ',
    '\\vartheta': 'ϑ',
    '\\iota': 'ι',
    '\\kappa': 'κ',
    '\\lambda': 'λ',
    '\\mu': 'μ',
    '\\nu': 'ν',
    '\\xi': 'ξ',
    '\\pi': 'π',
    '\\varpi': 'ϖ',
    '\\rho': 'ρ',
    '\\varrho': 'ϱ',
    '\\sigma': 'σ',
    '\\varsigma': 'ς',
    '\\tau': 'τ',
    '\\upsilon': 'υ',
    '\\phi': 'φ',
    '\\varphi': 'ϕ',
    '\\chi': 'χ',
    '\\psi': 'ψ',
    '\\omega': 'ω',
    // Greek (uppercase)
    '\\Gamma': 'Γ',
    '\\Delta': 'Δ',
    '\\Theta': 'Θ',
    '\\Lambda': 'Λ',
    '\\Xi': 'Ξ',
    '\\Pi': 'Π',
    '\\Sigma': 'Σ',
    '\\Upsilon': 'Υ',
    '\\Phi': 'Φ',
    '\\Psi': 'Ψ',
    '\\Omega': 'Ω',
};

// Unicode has no superscript/subscript form for every character; entries are
// limited to what's actually available so lookups can fail and fall back.
const SUPERSCRIPT_MAP: Record<string, string> = {
    '0': '⁰', '1': '¹', '2': '²', '3': '³', '4': '⁴', '5': '⁵', '6': '⁶', '7': '⁷', '8': '⁸', '9': '⁹',
    '+': '⁺', '-': '⁻', '−': '⁻', '=': '⁼', '(': '⁽', ')': '⁾',
    a: 'ᵃ', b: 'ᵇ', c: 'ᶜ', d: 'ᵈ', e: 'ᵉ', f: 'ᶠ', g: 'ᵍ', h: 'ʰ', i: 'ⁱ', j: 'ʲ', k: 'ᵏ', l: 'ˡ',
    m: 'ᵐ', n: 'ⁿ', o: 'ᵒ', p: 'ᵖ', r: 'ʳ', s: 'ˢ', t: 'ᵗ', u: 'ᵘ', v: 'ᵛ', w: 'ʷ', x: 'ˣ', y: 'ʸ', z: 'ᶻ',
};

const SUBSCRIPT_MAP: Record<string, string> = {
    '0': '₀', '1': '₁', '2': '₂', '3': '₃', '4': '₄', '5': '₅', '6': '₆', '7': '₇', '8': '₈', '9': '₉',
    '+': '₊', '-': '₋', '−': '₋', '=': '₌', '(': '₍', ')': '₎',
    a: 'ₐ', e: 'ₑ', h: 'ₕ', i: 'ᵢ', j: 'ⱼ', k: 'ₖ', l: 'ₗ', m: 'ₘ', n: 'ₙ', o: 'ₒ', p: 'ₚ', r: 'ᵣ',
    s: 'ₛ', t: 'ₜ', u: 'ᵤ', v: 'ᵥ', x: 'ₓ',
};

/** Find the `}` matching the `{` at `text[start]`, honoring nesting. */
function readBraceGroup(text: string, start: number): [content: string, end: number] {
    let depth = 0;
    for (let i = start; i < text.length; i++) {
        if (text[i] === '{') depth++;
        else if (text[i] === '}') {
            depth--;
            if (depth === 0) return [text.slice(start + 1, i), i + 1];
        }
    }
    return [text.slice(start + 1), text.length];
}

/** Read a single superscript/subscript argument: a brace group or one atom. */
function readScriptArg(text: string, i: number): [content: string, end: number] {
    if (text[i] === '{') return readBraceGroup(text, i);
    if (text[i] === '\\') {
        const m = /^\\[a-zA-Z]+/.exec(text.slice(i));
        if (m) return [m[0], i + m[0].length];
    }
    return [text[i] ?? '', i + 1];
}

/** Map every character of `content` through `map`, or return null if any character has no mapping. */
function toScriptUnicode(content: string, map: Record<string, string>): string | null {
    let out = '';
    for (const ch of content) {
        const mapped = map[ch];
        if (!mapped) return null;
        out += mapped;
    }
    return out;
}

/** Wrap an expression in parens if it contains an operator, so `\frac` output stays unambiguous. */
function wrapIfCompound(s: string): string {
    return /[+\-×÷/ ]/.test(s) ? `(${s})` : s;
}

/** Commands whose one argument group is plain text to show (\textcolor takes a colour group first). */
const STYLED_GROUP_RE = /^\\(textbf|textit|textrm|texttt|textsf|textsc|textsl|textup|textnormal|text|mbox|underline|emph|mathord|mathrm|mathbf|mathit|mathsf|mathtt|operatorname|textcolor)(?![a-zA-Z])\s*/;

function stripLatexInner(text: string): string {
    let out = '';
    let i = 0;
    while (i < text.length) {
        const ch = text[i];

        if (ch === '\\') {
            const rest = text.slice(i);

            // \left( ... \right) etc: drop the sizing macro, keep the delimiter.
            const leftRight = /^\\(left|right)/.exec(rest);
            if (leftRight) {
                i += leftRight[0].length;
                if (text[i] === '.') i += 1; // invisible delimiter
                continue;
            }

            // \frac{num}{den}
            if (rest.startsWith('\\frac')) {
                i += 5;
                if (text[i] === '{') {
                    const [num, afterNum] = readBraceGroup(text, i);
                    i = afterNum;
                    if (text[i] === '{') {
                        const [den, afterDen] = readBraceGroup(text, i);
                        i = afterDen;
                        out += `${wrapIfCompound(stripLatexInner(num))}/${wrapIfCompound(stripLatexInner(den))}`;
                        continue;
                    }
                    out += stripLatexInner(num);
                    continue;
                }
                out += 'frac';
                continue;
            }

            // \sqrt{x} or \sqrt[n]{x}
            if (rest.startsWith('\\sqrt')) {
                i += 5;
                let index = '';
                if (text[i] === '[') {
                    const close = text.indexOf(']', i);
                    if (close !== -1) {
                        index = text.slice(i + 1, close);
                        i = close + 1;
                    }
                }
                if (text[i] === '{') {
                    const [content, afterContent] = readBraceGroup(text, i);
                    i = afterContent;
                    const inner = stripLatexInner(content);
                    if (index === '3') out += `∛(${inner})`;
                    else if (index === '4') out += `∜(${inner})`;
                    else if (index && index !== '2') out += `${index}√(${inner})`;
                    else out += `√(${inner})`;
                    continue;
                }
                out += '√';
                continue;
            }

            // Text styling around one group (\textbf{EUR}, \mathrm{d}x): show the group's text.
            const styled = STYLED_GROUP_RE.exec(rest);
            if (styled) {
                i += styled[0].length;
                // \textcolor{c}{X}: skip the colour group first.
                if (styled[1] === 'textcolor' && text[i] === '{') i = readBraceGroup(text, i)[1];
                if (text[i] === '{') {
                    const [content, after] = readBraceGroup(text, i);
                    out += stripLatexInner(content);
                    i = after;
                }
                continue;
            }

            // Named symbol macros, e.g. \times, \alpha.
            const macroMatch = /^\\[a-zA-Z]+/.exec(rest);
            if (macroMatch) {
                const macro = macroMatch[0];
                out += SYMBOL_MAP[macro] || macro.slice(1);
                i += macro.length;
                continue;
            }

            // Line break.
            if (rest.startsWith('\\\\')) {
                i += 2;
                continue;
            }

            // Math spacing: \, \: \; and '\ ' are spaces, \! a negative space.
            if (',:; !'.includes(text[i + 1] ?? '')) {
                if (text[i + 1] !== '!') out += ' ';
                i += 2;
                continue;
            }

            // Escaped specials print as the character (\{ \} \$ \% \& \# \_).
            if ('{}$%&#_'.includes(text[i + 1] ?? '')) {
                out += text[i + 1];
                i += 2;
                continue;
            }

            // Math delimiters \( \) \[ \].
            if ('()[]'.includes(text[i + 1] ?? '')) {
                i += 2;
                continue;
            }

            // Unknown escape: drop the backslash and keep going.
            i += 1;
            continue;
        }

        if ((ch === '^' || ch === '_') && i + 1 < text.length) {
            const map = ch === '^' ? SUPERSCRIPT_MAP : SUBSCRIPT_MAP;
            const [arg, next] = readScriptArg(text, i + 1);
            const stripped = stripLatexInner(arg);
            if (ch === '^' && stripped === '∘') {
                // e.g. 90^\circ -- render as a degree sign rather than a superscript circle.
                out += '°';
                i = next;
                continue;
            }
            const converted = toScriptUnicode(stripped, map);
            out += converted !== null ? converted : ch + (stripped.length > 1 ? `(${stripped})` : stripped);
            i = next;
            continue;
        }

        if (ch === '$' || ch === '{' || ch === '}') {
            i += 1;
            continue;
        }

        out += ch;
        i += 1;
    }
    return out;
}

/**
 * Strip LaTeX markup for SVG display. Replaces common macros (Greek letters,
 * operators, arrows, ...) with their Unicode equivalents, converts `^`/`_`
 * scripts to Unicode super/subscripts where possible, expands `\frac{}{}`
 * and `\sqrt{}`, and drops `\left`/`\right` sizing and grouping braces.
 */
export function stripLatex(text: string): string {
    return stripLatexInner(text);
}

/**
 * Parse a hex color of the form `#rrggbb` into its components, or return null
 * if the input is not a valid hex color.
 */
export function hexToRgb(hex: string): { r: number; g: number; b: number } | null {
    const m = hex.match(/^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i);
    if (!m) return null;
    return { r: parseInt(m[1], 16), g: parseInt(m[2], 16), b: parseInt(m[3], 16) };
}

/**
 * Parse a CSS `rgb(r, g, b)` or `rgba(r, g, b, a)` string. Returns null for
 * anything that does not match.
 */
export function rgbStringToRgb(rgb: string): { r: number; g: number; b: number } | null {
    const m = rgb.match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/);
    if (!m) return null;
    return { r: parseInt(m[1], 10), g: parseInt(m[2], 10), b: parseInt(m[3], 10) };
}

/** Message of a thrown value. */
export function errorText(e: unknown): string {
    return e instanceof Error ? e.message : String(e);
}

/** Deep copy of plain JSON data (chart settings, examples, drafts). */
export function cloneData(data: Record<string, unknown>): Record<string, unknown> {
    return JSON.parse(JSON.stringify(data ?? {})) as Record<string, unknown>;
}
