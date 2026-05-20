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

const GREEK_MAP: Record<string, string> = {
    '\\sum': '∑',
    '\\int': '∫',
    '\\infty': '∞',
    '\\pi': 'π',
    '\\alpha': 'α',
    '\\beta': 'β',
    '\\gamma': 'γ',
    '\\delta': 'δ',
    '\\theta': 'θ',
    '\\lambda': 'λ',
    '\\mu': 'μ',
    '\\sigma': 'σ',
    '\\phi': 'φ',
    '\\omega': 'ω',
};

/**
 * Strip simple LaTeX markup for SVG display. Replaces common Greek-letter
 * macros with their Unicode equivalents and drops grouping braces.
 */
export function stripLatex(text: string): string {
    return text
        .replace(/\\[({]/g, '')
        .replace(/\\[)}]/g, '')
        .replace(/\\\\/g, '')
        .replace(/\\[a-zA-Z]+/g, (m) => GREEK_MAP[m] || m.replace('\\', ''));
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
