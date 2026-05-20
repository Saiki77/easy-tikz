/**
 * Shared color palette for the plugin.
 *
 * The "black" entry resolves to Obsidian's `--text-normal` so that it adapts
 * to light and dark themes. The other entries are deliberately fixed hex
 * values so they look consistent regardless of theme. Use `resolveCssColor`
 * before passing a value into any function that needs to do RGB math
 * (e.g. surface shading).
 */
export const COLOR_MAP: Record<string, string> = {
    black: 'var(--text-normal)',
    red: '#e74c3c',
    blue: '#3498db',
    teal: '#1abc9c',
    orange: '#e67e22',
    green: '#2ecc71',
    purple: '#9b59b6',
};

export const COLOR_OPTIONS: Record<string, string> = {
    black: 'Black',
    red: 'Red',
    blue: 'Blue',
    teal: 'Teal',
    orange: 'Orange',
    green: 'Green',
    purple: 'Purple',
};

export const THICKNESS_OPTIONS: Record<string, string> = {
    'very thin': 'Very Thin',
    thin: 'Thin',
    thick: 'Thick',
    'very thick': 'Very Thick',
};

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
    const resolved = getComputedStyle(document.body).getPropertyValue(match[1]).trim();
    return resolved || cssValue;
}
