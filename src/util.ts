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

const SYMBOL_MAP: Record<string, string> = {
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

            // Escaped grouping delimiters, e.g. \( \) \{ \}.
            if ('(){}'.includes(text[i + 1] ?? '')) {
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
