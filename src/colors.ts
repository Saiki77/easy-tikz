import type { FillPattern } from './types';

/**
 * Shared color palette for the plugin.
 *
 * The "black" entry resolves to Obsidian's `--text-normal` so that it adapts
 * to light and dark themes (and exports as plain black). The other entries
 * are deliberately fixed hex values so they look consistent regardless of
 * theme. Use `resolveCssColor` before passing a value into any function that
 * needs to do RGB math (e.g. surface shading).
 *
 * Key order is the swatch order (a 5 x 2 grid in the editor).
 */
export const COLOR_MAP: Record<string, string> = {
    black: 'var(--text-normal)',
    gray: '#7f8c8d',
    red: '#e74c3c',
    orange: '#e67e22',
    brown: '#a0522d',
    green: '#2ecc71',
    teal: '#1abc9c',
    blue: '#3498db',
    purple: '#9b59b6',
    magenta: '#d63384',
};

export const COLOR_OPTIONS: Record<string, string> = {
    black: 'Auto (text colour, exports black)',
    gray: 'Gray',
    red: 'Red',
    orange: 'Orange',
    brown: 'Brown',
    green: 'Green',
    teal: 'Teal',
    blue: 'Blue',
    purple: 'Purple',
    magenta: 'Magenta',
};

/**
 * TikZ colour per palette key. xcolor's own `red`, `green`, `teal`, ... are
 * very different from the preview hex values, so the exporter emits
 * `\definecolor{<name>}{HTML}{<hex>}` inside the tikzpicture for every
 * colour it uses and references `<name>`; the exported figure then matches
 * the preview. 'black' needs no definition.
 */
export const TIKZ_COLOR_DEFS: Record<string, { name: string; hex: string }> = {
    black: { name: 'black', hex: '000000' },
    gray: { name: 'etGray', hex: '7F8C8D' },
    red: { name: 'etRed', hex: 'E74C3C' },
    orange: { name: 'etOrange', hex: 'E67E22' },
    brown: { name: 'etBrown', hex: 'A0522D' },
    green: { name: 'etGreen', hex: '2ECC71' },
    teal: { name: 'etTeal', hex: '1ABC9C' },
    blue: { name: 'etBlue', hex: '3498DB' },
    purple: { name: 'etPurple', hex: '9B59B6' },
    magenta: { name: 'etMagenta', hex: 'D63384' },
};

export const THICKNESS_OPTIONS: Record<string, string> = {
    'very thin': 'Very Thin',
    thin: 'Thin',
    thick: 'Thick',
    'very thick': 'Very Thick',
};

/** Fill pattern choices, shared by the function and region cards. */
export const FILL_PATTERN_OPTIONS: { value: FillPattern; text: string }[] = [
    { value: 'solid', text: 'Solid' },
    { value: 'horizontal', text: 'Horizontal lines' },
    { value: 'vertical', text: 'Vertical lines' },
    { value: 'crosshatch', text: 'Crosshatch' },
    { value: 'dots', text: 'Dots' },
    { value: 'north-east', text: 'Diagonal lines /' },
    { value: 'north-west', text: 'Diagonal lines \\' },
];

export const THICKNESS_MAP: Record<string, number> = {
    'very thin': 1,
    thin: 1.5,
    thick: 2.5,
    'very thick': 3.5,
};

/**
 * Resolve a CSS color value to a concrete `rgb(...)` or hex string.
 * If the input is `var(--name)`, looks up the computed value on `<body>`.
 * Falls back to the input string when nothing matches.
 */
export function resolveCssColor(cssValue: string): string {
    if (!cssValue) return cssValue;
    if (cssValue.startsWith('#') || cssValue.startsWith('rgb')) return cssValue;
    const match = cssValue.match(/var\((--[^,)]+)/);
    if (!match) return cssValue;
    const resolved = getComputedStyle(activeDocument.body).getPropertyValue(match[1]).trim();
    return resolved || cssValue;
}

/** `#rgb`, `#rrggbb` or `rgb(r, g, b)` as 0..255 channels, else null. */
function parseColor(c: string): [number, number, number] | null {
    const s = String(c ?? '').trim();
    const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(s);
    if (hex) {
        const h = hex[1].length === 3 ? hex[1].replace(/./g, (d) => d + d) : hex[1];
        return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
    }
    const rgb = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)/i.exec(s);
    return rgb ? [Number(rgb[1]), Number(rgb[2]), Number(rgb[3])] : null;
}

/**
 * `a` mixed with `b` (t = 0 gives a, 1 gives b), channel by channel in
 * sRGB, as `#rrggbb`. Accepts hex or rgb() (resolveCssColor output);
 * returns `a` unchanged when either colour cannot be read.
 */
export function mixHex(a: string, b: string, t: number): string {
    const ca = parseColor(a);
    const cb = parseColor(b);
    if (!ca || !cb) return a;
    const k = Number.isFinite(t) ? Math.max(0, Math.min(1, t)) : 0;
    const ch = (i: number) =>
        Math.round(ca[i] + (cb[i] - ca[i]) * k)
            .toString(16)
            .padStart(2, '0');
    return `#${ch(0)}${ch(1)}${ch(2)}`;
}
