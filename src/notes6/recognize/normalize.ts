/*
 * The front end of formula recognition (a port of the frozen normalize.mjs,
 * hover-ml designed2; the logic is the same line by line): one TeX string
 * in, one canonical TeX string out, plus flags. It changes spelling only
 * (Unicode to TeX, sloppy plain-text math to TeX, layout commands removed)
 * and takes no decision about a card. The flags are inputs of the network:
 *
 *   prose       the span reads like normal text (a false span between two money dollar signs)
 *   unreadable  a spelling the plugin cannot draw (sin x without a backslash, \sqrt(x), √, 0,5x)
 *   rowCont     the row starts with a relation (a continued derivation row: "&= ...")
 *   hadCases    the span holds a cases block
 *
 * Pure: no DOM, no Obsidian.
 */
import type { RecognizeContext } from './features';

const UNI: Record<string, string> = {
    '²': '^2', '³': '^3', '¹': '^1', '⁰': '^0', '⁴': '^4', '⁵': '^5', '⁶': '^6', '⁷': '^7', '⁸': '^8', '⁹': '^9', 'ⁿ': '^n', '⁻': '^-',
    '₀': '_0', '₁': '_1', '₂': '_2', '₃': '_3', '₄': '_4', 'ₙ': '_n', 'ₖ': '_k', 'ᵢ': '_i',
    'ℝ': '\\mathbb{R}', 'ℕ': '\\mathbb{N}', 'ℤ': '\\mathbb{Z}', 'ℚ': '\\mathbb{Q}', 'ℂ': '\\mathbb{C}', '𝔼': '\\mathbb{E}', 'ℙ': '\\mathbb{P}',
    '≤': '\\le ', '≥': '\\ge ', '≠': '\\ne ', '≈': '\\approx ', '≡': '\\equiv ', '∼': '\\sim ', '∝': '\\propto ', '≪': '\\ll ', '≫': '\\gg ',
    '−': '-', '–': '-', '·': '\\cdot ', '⋅': '\\cdot ', '×': '\\times ', '÷': '/', '∗': '*', '±': '\\pm ', '∓': '\\mp ',
    '∈': '\\in ', '∉': '\\notin ', '⊂': '\\subset ', '⊆': '\\subseteq ', '∪': '\\cup ', '∩': '\\cap ', '∅': '\\emptyset ', '∖': '\\setminus ',
    '→': '\\to ', '⟶': '\\to ', '↦': '\\mapsto ', '⇒': '\\Rightarrow ', '⟹': '\\Rightarrow ', '⇔': '\\iff ', '⟺': '\\iff ', '⇐': '\\Leftarrow ', '←': '\\leftarrow ',
    '∞': '\\infty ', '√': '\\sqrt ', '∑': '\\sum ', '∏': '\\prod ', '∫': '\\int ', '∂': '\\partial ', '∇': '\\nabla ', '∀': '\\forall ', '∃': '\\exists ',
    '∧': '\\wedge ', '∨': '\\vee ', '¬': '\\neg ', '∣': '\\mid ', '‖': '\\|', '⟨': '\\langle ', '⟩': '\\rangle ', '…': '\\dots ', '⋯': '\\dots ', '°': '^\\circ ',
    '′': "'", '″': "''", '⊤': '\\top ', '∘': '\\circ ', '½': '\\frac{1}{2}', '¼': '\\frac{1}{4}', '⌊': '\\lfloor ', '⌋': '\\rfloor ', '⌈': '\\lceil ', '⌉': '\\rceil ',
    'α': '\\alpha ', 'β': '\\beta ', 'γ': '\\gamma ', 'δ': '\\delta ', 'ε': '\\varepsilon ', 'ϵ': '\\varepsilon ', 'ζ': '\\zeta ', 'η': '\\eta ', 'θ': '\\theta ', 'ϑ': '\\theta ',
    'κ': '\\kappa ', 'λ': '\\lambda ', 'μ': '\\mu ', 'µ': '\\mu ', 'ν': '\\nu ', 'ξ': '\\xi ', 'π': '\\pi ', 'ρ': '\\rho ', 'σ': '\\sigma ', 'τ': '\\tau ', 'φ': '\\varphi ', 'ϕ': '\\varphi ',
    'χ': '\\chi ', 'ψ': '\\psi ', 'ω': '\\omega ', 'Γ': '\\Gamma ', 'Δ': '\\Delta ', 'Θ': '\\Theta ', 'Λ': '\\Lambda ', 'Σ': '\\sum ', 'Φ': '\\Phi ', 'Ψ': '\\Psi ', 'Ω': '\\Omega ', 'Π': '\\Pi ',
};
const UNI_RE = new RegExp('[' + Object.keys(UNI).join('') + ']', 'gu');

// plain-text function names that get their backslash
const FNS = 'arcsin|arccos|arctan|sinh|cosh|tanh|sqrt|sin|cos|tan|cot|exp|log|ln|lim|max|min|det|sup|inf';
const FN_RE = new RegExp('(^|[^\\\\A-Za-z])(' + FNS + ')(?![A-Za-z])', 'g');
const GLUED_RE = new RegExp('(^|[^\\\\A-Za-z])([A-Za-z])(arcsin|arccos|arctan|sinh|cosh|tanh|sqrt|sin|cos|tan|exp|log|ln)(?![A-Za-z])', 'g');
// short words that are never a product of letters when they stand alone between spaces
const STOP = new Set('und and or oder the der die das for pro per mit von bis ist is to if of auf bei als wenn then dann also are was hat has sei let'.split(' '));
const FNSET = new Set(FNS.split('|').concat(['arg', 'mod', 'gcd', 'ggT', 'dim', 'ker', 'deg', 'sgn', 'sign', 'abs', 'erf', 'sinc', 'cot', 'sec', 'csc', 'argmax', 'argmin', 'const', 'epi', 'dom', 'diag', 'rank', 'span', 'grad', 'div', 'rot', 'var', 'cov', 'tr']));

/** The group that starts at s[i] === '{': [content, index after the group]. */
function group(s: string, i: number): [string, number] {
    let d = 0;
    for (let j = i; j < s.length; j++) {
        if (s[j] === '\\') {
            j++;
            continue;
        }
        if (s[j] === '{') d++;
        else if (s[j] === '}' && --d === 0) return [s.slice(i + 1, j), j + 1];
    }
    return [s.slice(i + 1), s.length];
}

/** Replace \cmd{A} (or \cmd{A}{B}) by fn(A, B). */
function unwrap(sIn: string, cmd: string, nargs: number, fn: (...args: string[]) => string): string {
    let s = sIn;
    const re = new RegExp('\\\\' + cmd + '(?![A-Za-z])\\*?\\s*', 'g');
    for (let guard = 0; guard < 20; guard++) {
        re.lastIndex = 0;
        const m = re.exec(s);
        if (!m) break;
        let j = m.index + m[0].length;
        const args: string[] = [];
        for (let k = 0; k < nargs; k++) {
            while (s[j] === ' ') j++;
            if (s[j] === '{') {
                const [c, e] = group(s, j);
                args.push(c);
                j = e;
            } else if (s[j] === '\\') {
                const mm = /^\\([A-Za-z]+|.)/.exec(s.slice(j));
                // A backslash at the very end: the formula cannot be read (the frozen code fails here too).
                if (!mm) throw new Error('a backslash at the end');
                args.push(mm[0]);
                j += mm[0].length;
            } else {
                args.push(s[j] ?? '');
                j++;
            }
        }
        s = s.slice(0, m.index) + ' ' + fn(...args) + ' ' + s.slice(j);
    }
    return s;
}

/** Words written without \text in a math span, with their positions (outside commands and outside \text groups). */
function bareWords(s: string): Array<{ w: string; i: number; call: boolean }> {
    // blank out commands and the groups of text commands
    let t = s.replace(/\\(?:text|mathrm|textbf|textit|textrm|mathit|mathsf|operatorname|mathbf|mathcal|mathbb|begin|end|label|tag|color|textcolor)\s*\*?\s*\{[^{}]*\}/g, (m) => ' '.repeat(m.length));
    t = t.replace(/\\[A-Za-z]+/g, (m) => ' '.repeat(m.length));
    const out: Array<{ w: string; i: number; call: boolean }> = [];
    for (const m of t.matchAll(/[A-Za-zÄÖÜäöüß]+/g)) {
        const w = m[0];
        const at = m.index ?? 0;
        if (FNSET.has(w)) continue;
        const before = t[at - 1] ?? ' ';
        const after = t[at + w.length] ?? ' ';
        const spaced = /[\s,.;:!?]/.test(before) && /[\s,.;:!?]/.test(after);
        const call = after === '(';
        const isWord = (/[äöüßÄÖÜ]/.test(w) && w.length >= 3) || (/^[a-z]{4,}$/.test(w) && /[aeiou]/.test(w)) || /^[A-Z][a-z]{3,}$/.test(w) || (spaced && STOP.has(w[0].toLowerCase() + w.slice(1)));
        if (isWord) out.push({ w, i: at, call });
    }
    return out;
}

/** The canonical TeX of a formula, and the flags of the front end. */
export interface Normalized {
    tex: string;
    unreadable: boolean;
    prose: boolean;
    rowCont: boolean;
    hadCases: boolean;
}

export function normalize(texIn: string, ctx?: RecognizeContext): Normalized {
    let s = String(texIn ?? '');
    const flags = { unreadable: false, prose: false, rowCont: false, hadCases: /\\begin\s*\{cases\}/.test(s) };
    // comments (a % that is not \%)
    s = s.replace(/(^|[^\\])%[^\n]*/g, '$1');
    // layout and numbering
    s = s.replace(/\\(?:tag|label)\s*\*?\s*\{[^}]*\}/g, ' ').replace(/\\(?:nonumber|notag|displaystyle|textstyle|scriptstyle|limits|nolimits|allowbreak|nobreak|newline|hfill|strut|mathstrut|centering)(?![A-Za-z])/g, ' ');
    s = s.replace(/\\(?:hspace|vspace|phantom|hphantom|vphantom|mkern|kern|mspace)\s*\*?\s*(\{[^{}]*\}|-?[0-9.]+\s*(?:mu|em|pt|ex|cm|mm))/g, ' ');
    // (The frozen front end writes this as '\;' in a JavaScript string, which is a semicolon: kept as it reads.)
    s = s.replace(/\\(?:enspace|enskip|thinspace|medspace|thickspace|space|nobreakspace)(?![A-Za-z])/g, ';');
    s = unwrap(s, 'boxed', 1, (a) => a);
    s = unwrap(s, 'fbox', 1, (a) => a);
    s = unwrap(s, 'textcolor', 2, (_c, a) => a);
    s = unwrap(s, 'colorbox', 2, (_c, a) => a);
    s = unwrap(s, 'color', 1, () => '');
    s = unwrap(s, 'overset', 2, (_a, b) => b);
    s = unwrap(s, 'stackrel', 2, (_a, b) => b);
    s = unwrap(s, 'underset', 2, (a, b) => (/^\\(min|max|argmin|argmax|lim|sup|inf)$/.test(b.trim()) ? `${b}_{${a}}` : b));
    s = unwrap(s, 'mathclap', 1, (a) => a);
    s = unwrap(s, 'substack', 1, (a) => a.replace(/\\\\/g, ','));
    s = s.replace(/\\(?:quad|qquad)\s*\\text\s*\{\s*\(?[0-9IVXa-c.]{1,5}\)\s*\}\s*$/, ' ').replace(/\\(?:quad|qquad)\s*\(\s*[0-9.]{1,5}\s*\)\s*$/, ' ');
    // spellings the plugin cannot read at all (rubric_hard.md 5): the card would be broken, so the network gets a flag
    if (/[⁰¹⁴-⁹ⁿ⁻₀-₉ₙₖᵢ√]/u.test(s) || /\\sqrt\s*\(/.test(s)) flags.unreadable = true;
    if (new RegExp('(^|[^\\\\A-Za-z{])(sin|cos|tan|ln|log|exp|sqrt)\\s*(?![A-Za-z(\\s]|\\s*\\()', '').test(s) || new RegExp('(^|[^\\\\A-Za-z{])(sin|cos|tan|ln|log|exp)\\s+[A-Za-z0-9\\\\]').test(s)) flags.unreadable = true;
    {
        let d = 0;
        for (let i = 0; i < s.length; i++) {
            const ch = s[i];
            if (ch === '(' || ch === '[') d++;
            else if (ch === ')' || ch === ']') d = Math.max(0, d - 1);
            else if (ch === ',' && d === 0 && /[0-9]/.test(s[i - 1] ?? '') && /[0-9]/.test(s[i + 1] ?? '') && /[A-Za-z\\^]/.test(s.slice(i + 1).replace(/^[0-9]+\s*/, '')[0] ?? '')) flags.unreadable = true;
        }
    }
    // a unit after a formula is a label (rubric_hard.md 6): x(t) = 0,2 cos(7,854 t) \ \mathrm{m}
    const before = s;
    s = s.replace(/(?:\\[ ,;:]|~|\s)+\\(?:mathrm|text)\s*\{\s*[a-zA-Zµ°€%][a-zA-Zµ°/^0-9{}\-\\, ]{0,9}\}\s*[.,]?\s*$/, (m: string, off: number) => (/[=\\]in\b|=/.test(before.slice(0, off)) && /[\])0-9}]\s*$/.test(before.slice(0, off)) ? ' ' : m));
    // a label before an equation: "g: y = 2x + 1"
    s = s.replace(/^\s*[a-zA-Z](?:_[0-9a-z])?\s*(?::|\\colon)\s*(?=[^:]*=)(?![^=]*\\(?:to|mapsto|rightarrow)\b)/, '');
    // Unicode
    s = s.replace(UNI_RE, (c) => UNI[c]);
    s = s.replace(/\^-(?=\^)/g, '^-').replace(/\^-\^([0-9])/g, '^{-$1}');
    // a table cell writes a bar as \|
    const c = String(ctx?.context ?? '').trim();
    const inTable = c.startsWith('|') && c.endsWith('|');
    const bars = (s.match(/\\\|/g) ?? []).length;
    if (bars && (inTable || bars % 2 === 1)) s = /\\\{/.test(s) && bars === 1 ? s.replace(/\\\|/g, '\\mid ') : s.replace(/\\\|/g, '|');
    // sloppy plain-text math
    s = s.replace(/\*\*/g, '^').replace(/(^|[^\\A-Za-z])sqrt\s*\(/g, '$1\\sqrt(');
    for (let pass = 0; pass < 2; pass++) {
        const cur = s;
        s = cur.replace(FN_RE, (m: string, b: string, fn: string, off: number) => (b === '{' && cur[off + m.length] === '}' ? m : `${b}\\${fn}`));
    }
    // a letter glued to a function name: xcos(xy), Asin kx
    s = s.replace(GLUED_RE, '$1$2\\$3');
    s = s.replace(/\\(?:therefore|because|leadsto|rightsquigarrow|hookrightarrow)(?![A-Za-z])/g, '\\Rightarrow ');
    s = s.replace(/\^\s*-\s*([0-9]+(?:[.,][0-9]+)?|[A-Za-z]|\\[A-Za-z]+)/g, '^{-$1}');
    s = s.replace(/_\s*-\s*([0-9]+|[A-Za-z])/g, '_{-$1}');
    s = s.replace(/<=/g, '\\le ').replace(/>=/g, '\\ge ').replace(/(^|[^\\])!=/g, '$1\\ne ').replace(/->/g, '\\to ');
    // prose: words without \text
    const words = bareWords(s);
    const plain = words.filter((w) => !w.call);
    const mathy = /[=<>^_]|\\(?:le|ge|frac|in|sqrt|sum|int)(?![A-Za-z])/.test(s);
    const raw = String(texIn ?? '');
    const lop = /^\s/.test(raw) !== /\s$/.test(raw);
    flags.prose = plain.length >= 2 || (plain.length === 1 && (!mathy || lop)) || (lop && /^\s*[,.;]?\s*$|^\s*[0-9][0-9.,]*\s*$/.test(raw));
    // a single word becomes a \text word (it then cuts the formula like one), a word before ( becomes a name
    if (!flags.prose) {
        for (const w of [...words].reverse()) s = s.slice(0, w.i) + (w.call ? `\\mathrm{${w.w}}` : `\\text{${w.w}}`) + s.slice(w.i + w.w.length);
    }
    // a row of an aligned block: & is layout; a row that starts with a relation continues the row above
    if (!/\\begin/.test(s)) s = s.replace(/(^|[^\\])&/g, '$1 ');
    s = s.replace(/\s+/g, ' ').trim();
    // spaces inside a text group are part of the word list: mark them (the tokenizer drops plain spaces)
    s = s.replace(/\\(?:text|textbf|textit|textrm|mathrm|textsf|texttt|mbox)\s*\{([^{}]*)\}/g, (m: string, body: string) => m.replace(body, body.replace(/ /g, '␣')));
    // a decimal comma without braces: 0,5 (only outside brackets)
    {
        let d = 0;
        let o = '';
        for (let i = 0; i < s.length; i++) {
            const ch = s[i];
            if (ch === '(' || ch === '[') d++;
            else if (ch === ')' || ch === ']') d = Math.max(0, d - 1);
            if (ch === ',' && d === 0 && /[0-9]/.test(s[i - 1] ?? '') && /[0-9]/.test(s[i + 1] ?? '')) o += '{,}';
            else o += ch;
        }
        s = o;
    }
    // one group around everything: {y = x^2}
    for (let g = 0; g < 3 && s[0] === '{'; g++) {
        const [inner, e] = group(s, 0);
        if (e === s.length) s = inner.trim();
        else break;
    }
    // a head of two or three capitals: MC(q) = ..., AC(x) = ...
    s = s.replace(/(^|[\s,;])([A-Z]{2,3})(?=\s*\(\s*(?:[a-zA-Z]|\\[a-z]+)\s*\)\s*(?::?=|\\approx))/g, '$1\\mathrm{$2}');
    flags.rowCont = /^(=|<|>|\\le(?![A-Za-z])|\\ge(?![A-Za-z])|\\leq|\\geq|\\ne(?![A-Za-z]))/.test(s);
    return { tex: s, ...flags };
}
