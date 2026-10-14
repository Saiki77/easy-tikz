// Formulas for the brand: plain input as a user types it into Easy TikZ
// (`2x + 3y <= 12`) becomes HTML that is set like TeX math. Pure string
// work, no DOM: the same module runs in the templates and in Node.
//
//   math('2x + 3y <= 12')        -> '<span class="m">...</span>'
//   equation('2x + 3y = c', 1)   -> a display line with the tag (1)
//   mathText('2x + 3y <= 12')    -> '2𝑥 + 3𝑦 ≤ 12' (plain text, for alt texts and tests)
//
// What it knows (the formulas of the media; it is not a TeX parser):
//   numbers            2, 2.5, 10.5                      upright
//   variables          x, y, c ...                       math italic, from the math font's own
//                                                        italic alphabet (never a slanted text font)
//   names with digits  f1, P1, R1                        letter with a subscript digit
//   subscripts         P1_x, P1_val, x_0                 `_` then a name, a number or (...)
//   powers             x^2, 2^(n+1), e^-kx is `e^(-k x)` `^` then a number, a name or (...)
//   functions          sin cos tan exp ln log sqrt min max abs   upright, thin space before a bare argument
//   Greek              pi, alpha ... omega               math italic Greek
//   operators          + - * /  = < > <= >= !=  ->       proper signs: − · ⁄ ≤ ≥ ≠ →, TeX spacing
//   star               x* = (3, 1)                       a raised asterisk right after a name
//   text               "maximise" z = 2x + 3y            words in quotes are set upright as text
//   emphasis           [[2.5]]x + 3y = c                 [[...]] wraps a part in .m-em (the accent colour)
//   two statements     2x + 3y = c,  c = 9               two blanks after a comma: a quad of space
//
//   aligned([['2x + 3y = c', 1], ['2.5x + 3y = c', 2]])      display equations aligned on their
//                                                        relation sign, as TeX's align sets them
//
// Styling lives in brand.css (.m and its parts). The spaces around
// operators are margins there, so the markup holds no blank characters.

const FUNCTIONS = new Set(['sin', 'cos', 'tan', 'cot', 'sec', 'csc', 'asin', 'acos', 'atan', 'sinh', 'cosh', 'tanh', 'exp', 'ln', 'log', 'sqrt', 'min', 'max', 'abs', 'floor', 'ceil', 'sgn', 'mod', 'gcd', 'lim', 'det']);
const GREEK = {
    alpha: 'α', beta: 'β', gamma: 'γ', delta: 'δ', epsilon: 'ε', zeta: 'ζ', eta: 'η', theta: 'θ', iota: 'ι', kappa: 'κ', lambda: 'λ', mu: 'μ', nu: 'ν', xi: 'ξ',
    pi: 'π', rho: 'ρ', sigma: 'σ', tau: 'τ', upsilon: 'υ', phi: 'φ', chi: 'χ', psi: 'ψ', omega: 'ω',
};
const RELATIONS = { '<=': '≤', '>=': '≥', '!=': '≠', '->': '→', '=': '=', '<': '<', '>': '>', '≤': '≤', '≥': '≥', '≠': '≠', '→': '→', '≈': '≈', '∈': '∈' };
const BINARY = { '+': '+', '-': '−', '−': '−', '*': '⋅', '·': '⋅', '⋅': '⋅', '×': '×', '±': '±' };

/** One Latin or Greek letter in the math italic alphabet (U+1D434 ...), as TeX sets a variable. */
export function italic(ch) {
    const c = ch.codePointAt(0);
    if (ch === 'h') return 'ℎ'; // the italic h lives at U+210E (Planck constant)
    if (c >= 0x61 && c <= 0x7a) return String.fromCodePoint(0x1d44e + c - 0x61);
    if (c >= 0x41 && c <= 0x5a) return String.fromCodePoint(0x1d434 + c - 0x41);
    if (c >= 0x3b1 && c <= 0x3c9) return String.fromCodePoint(0x1d6fc + c - 0x3b1);
    return ch;
}

const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/**
 * Split the input into tokens:
 *   { t: 'num' | 'id' | 'rel' | 'bin' | 'open' | 'close' | 'punct' | 'sup' | 'sub' | 'star' | 'slash' | 'bar' | 'text' | 'em+' | 'em-', v }
 */
export function tokenize(input) {
    const src = String(input);
    const out = [];
    let i = 0;
    while (i < src.length) {
        const ch = src[i];
        const two = src.slice(i, i + 2);
        if (/\s/.test(ch)) {
            i++;
            continue;
        }
        if (two === '[[') {
            out.push({ t: 'em+' });
            i += 2;
            continue;
        }
        if (two === ']]') {
            out.push({ t: 'em-' });
            i += 2;
            continue;
        }
        if (ch === '"') {
            const end = src.indexOf('"', i + 1);
            const stop = end < 0 ? src.length : end;
            out.push({ t: 'text', v: src.slice(i + 1, stop) });
            i = stop + 1;
            continue;
        }
        const num = /^(\d+(\.\d+)?|\.\d+)/.exec(src.slice(i));
        if (num) {
            out.push({ t: 'num', v: num[0] });
            i += num[0].length;
            continue;
        }
        const word = /^[A-Za-zα-ω]+/.exec(src.slice(i));
        if (word) {
            // A name may carry digits (f1, P1): they become a subscript.
            const digits = /^\d+/.exec(src.slice(i + word[0].length));
            out.push({ t: 'id', v: word[0], digits: digits ? digits[0] : '' });
            i += word[0].length + (digits ? digits[0].length : 0);
            continue;
        }
        if (RELATIONS[two]) {
            out.push({ t: 'rel', v: RELATIONS[two] });
            i += 2;
            continue;
        }
        if (ch === '*') {
            // A star that closes a name (x* = ...) is an ornament; between two factors it multiplies.
            const prev = out[out.length - 1];
            const rest = src.slice(i + 1);
            if (prev && (prev.t === 'id' || prev.t === 'close') && src[i - 1] !== ' ' && /^(\s*$|\s*[=,)<>]|\s+[^\s])/.test(rest) && !/^\s*[\dA-Za-z(]/.test(rest)) {
                out.push({ t: 'star' });
                i++;
                continue;
            }
        }
        if (RELATIONS[ch]) out.push({ t: 'rel', v: RELATIONS[ch] });
        else if (BINARY[ch]) out.push({ t: 'bin', v: BINARY[ch] });
        else if (ch === '(' || ch === '[' || ch === '{') out.push({ t: 'open', v: ch });
        else if (ch === ')' || ch === ']' || ch === '}') out.push({ t: 'close', v: ch });
        else if (ch === ',' || ch === ';' || ch === ':') {
            out.push({ t: 'punct', v: ch });
            // Two blanks after a comma separate two statements: `2x + 3y = c,  c = 9` gets TeX's \quad.
            if (/^\s{2,}\S/.test(src.slice(i + 1))) out.push({ t: 'quad' });
        }
        else if (ch === '^') out.push({ t: 'sup' });
        else if (ch === '_') out.push({ t: 'sub' });
        else if (ch === '/') out.push({ t: 'slash' });
        else if (ch === '|') out.push({ t: 'bar' });
        else out.push({ t: 'sym', v: ch });
        i++;
    }
    return out;
}

/**
 * Tokens to atoms { kind, html, text, sub, sup }. `kind` drives the spacing:
 * 'ord' | 'op' (function name) | 'rel' | 'bin' | 'unary' | 'open' | 'close' | 'punct' | 'slash' | 'text'.
 * Scripts are collected on their base (P1_x has the subscript "1, x").
 */
function atoms(tokens, inScript) {
    const list = [];
    let i = 0;
    const emStack = [];

    /** The balanced group that starts at tokens[i] (an 'open'), rendered without its outer brackets. */
    function group() {
        let depth = 0;
        const start = i;
        for (; i < tokens.length; i++) {
            if (tokens[i].t === 'open') depth++;
            else if (tokens[i].t === 'close' && --depth === 0) {
                i++;
                break;
            }
        }
        const inner = tokens.slice(start, i);
        return render(inner.length >= 2 ? inner.slice(1, -1) : inner, true);
    }
    /** What follows `^` or `_`: a group, or one (signed) number or name. */
    function script() {
        const tok = tokens[i];
        if (!tok) return { html: '', text: '' };
        if (tok.t === 'open') return group();
        if (tok.t === 'bin' && tokens[i + 1]) {
            i += 2;
            return render([tok, tokens[i - 1]], true);
        }
        i++;
        return render([tok], true);
    }
    function ident(tok) {
        const name = tok.v;
        const atom = { kind: 'ord', html: '', text: '', sub: null, sup: null };
        if (FUNCTIONS.has(name)) {
            atom.html = `<span class="mop">${name}</span>`;
            atom.text = name;
            atom.kind = 'op';
        } else if (GREEK[name]) {
            atom.text = italic(GREEK[name]);
            atom.html = `<span class="mi">${atom.text}</span>`;
        } else if (inScript && name.length > 1) {
            // A word in a subscript is a label, not a product of variables: P1_val.
            atom.html = `<span class="mrm">${name}</span>`;
            atom.text = name;
        } else {
            // Every letter is a variable of its own: `kx` is k times x.
            atom.text = Array.from(name).map(italic).join('');
            atom.html = `<span class="mi">${atom.text}</span>`;
        }
        if (tok.digits) atom.sub = { html: `<span class="mn">${tok.digits}</span>`, text: tok.digits };
        return atom;
    }

    while (i < tokens.length) {
        const tok = tokens[i];
        const prev = list[list.length - 1];
        if (tok.t === 'em+') {
            emStack.push(list.length);
            i++;
            continue;
        }
        if (tok.t === 'em-') {
            const from = emStack.pop();
            if (from !== undefined && from < list.length) {
                list[from].emOpen = (list[from].emOpen || 0) + 1;
                list[list.length - 1].emClose = (list[list.length - 1].emClose || 0) + 1;
            }
            i++;
            continue;
        }
        if (tok.t === 'sup' || tok.t === 'sub') {
            i++;
            const s = script();
            if (!prev) continue;
            const key = tok.t;
            if (prev[key]) prev[key] = { html: `${prev[key].html}<span class="mo mpunct">,</span>${s.html}`, text: `${prev[key].text}, ${s.text}` };
            else prev[key] = s;
            continue;
        }
        if (tok.t === 'star') {
            if (prev) prev.sup = { html: `${prev.sup ? prev.sup.html : ''}<span class="mstar">∗</span>`, text: `${prev.sup ? prev.sup.text : ''}*`, star: true };
            i++;
            continue;
        }
        i++;
        if (tok.t === 'num') list.push({ kind: 'ord', html: `<span class="mn">${tok.v}</span>`, text: tok.v });
        else if (tok.t === 'id') list.push(ident(tok));
        else if (tok.t === 'text') list.push({ kind: 'text', html: `<span class="mtext">${esc(tok.v)}</span>`, text: tok.v });
        else if (tok.t === 'rel') list.push({ kind: 'rel', html: esc(tok.v), text: tok.v });
        else if (tok.t === 'bin') {
            // A sign with nothing to its left to act on is unary: no space after it.
            const unary = !prev || ['rel', 'bin', 'open', 'punct', 'unary', 'text', 'slash'].includes(prev.kind);
            list.push({ kind: unary ? 'unary' : 'bin', html: tok.v, text: tok.v });
        } else if (tok.t === 'open') list.push({ kind: 'open', html: tok.v, text: tok.v });
        else if (tok.t === 'close') list.push({ kind: 'close', html: tok.v, text: tok.v });
        else if (tok.t === 'punct') list.push({ kind: 'punct', html: tok.v, text: tok.v });
        else if (tok.t === 'slash') list.push({ kind: 'slash', html: '/', text: '/' });
        else if (tok.t === 'quad') list.push({ kind: 'open', html: '<span class="mquad"></span>', text: ' ', raw: true });
        else if (tok.t === 'bar') list.push({ kind: 'ord', html: '|', text: '|' });
        else list.push({ kind: 'ord', html: esc(tok.v), text: tok.v });
    }
    return list;
}

const CLASS = { rel: 'mo mrel', bin: 'mo mbin', unary: 'mo', open: 'mo', close: 'mo', punct: 'mo mpunct', slash: 'mo' };

const simple = (text) => Array.from(text).length === 1 || /^[\w.]+$/.test(text);

function render(tokens, inScript = false) {
    const list = atoms(tokens, inScript);
    let html = '';
    let text = '';
    list.forEach((a, n) => {
        const prev = list[n - 1];
        let piece = CLASS[a.kind] && !a.raw ? `<span class="${CLASS[a.kind]}">${a.html}</span>` : a.html;
        let plain = a.text;
        if (a.sub && a.sup) {
            piece += `<span class="mscripts"><span class="msup">${a.sup.html}</span><span class="msub">${a.sub.html}</span></span>`;
        } else if (a.sub) {
            piece += `<span class="msub">${a.sub.html}</span>`;
        } else if (a.sup) {
            piece += `<span class="msup">${a.sup.html}</span>`;
        }
        if (a.sub) plain += simple(a.sub.text) ? `_${a.sub.text}` : `_(${a.sub.text})`;
        if (a.sup) plain += a.sup.star ? a.sup.text : simple(a.sup.text) ? `^${a.sup.text}` : `^(${a.sup.text})`;
        // TeX's thin space: between a letter, number or closing bracket and a function name (2 sin x),
        // and after a function name unless a bracket follows (sin x, but sin(x)).
        const afterOp = prev && prev.kind === 'op' && (a.kind === 'ord' || a.kind === 'op');
        const beforeOp = a.kind === 'op' && prev && (prev.kind === 'ord' || prev.kind === 'close');
        if (afterOp || beforeOp) piece = `<span class="mthin"></span>${piece}`;
        if (a.emOpen) piece = '<span class="m-em">'.repeat(a.emOpen) + piece;
        if (a.emClose) piece += '</span>'.repeat(a.emClose);
        html += piece;
        // Plain text: blanks around relations and binary operators, after punctuation, around words.
        if (a.kind === 'rel' || a.kind === 'bin') text += ` ${plain} `;
        else if (a.kind === 'punct') text += `${plain} `;
        else if (a.kind === 'text') text += ` ${plain} `;
        else if (afterOp || beforeOp) text += ` ${plain}`;
        else text += plain;
    });
    return { html, text: text.replace(/\s+/g, ' ').trim() };
}

/**
 * Typeset a formula. Returns the markup of an inline <span class="m">.
 *   display   true: adds .m-display (larger, for a line of its own)
 *   cls       extra class names
 */
export function math(input, { display = false, cls = '' } = {}) {
    const { html, text } = render(tokenize(input));
    const classes = ['m', display ? 'm-display' : '', cls].filter(Boolean).join(' ');
    return `<span class="${classes}" role="math" aria-label="${esc(text).replace(/"/g, '&quot;')}">${html}</span>`;
}

/** The formula as plain Unicode text: '2𝑥 + 3𝑦 ≤ 12'. */
export function mathText(input) {
    return render(tokenize(input)).text;
}

/**
 * A display equation with its tag on the right, as in a paper:
 *   equation('2x + 3y = c', 1)            ->   2x + 3y = c            (1)
 *   equation('c = 9', '2a', { lead: 'before' })   a short upright word in front of the formula
 */
export function equation(input, tag = '', { lead = '', cls = '' } = {}) {
    const t = tag === '' || tag === null || tag === undefined ? '' : `<span class="eq-tag">(${esc(String(tag))})</span>`;
    const l = lead ? `<span class="eq-lead">${esc(lead)}</span>` : '';
    return `<div class="eq${cls ? ` ${cls}` : ''}">${l}<span class="eq-body">${math(input, { display: true })}</span>${t}</div>`;
}

/**
 * Display equations aligned on their first relation sign, with their tags at the right edge, as
 * TeX's align environment sets them:
 *
 *     2x + 3y = c,   c = 9        (1)
 *   2.5x + 3y = c,   c = 10.5     (2)
 *
 *   rows   [input, tag] pairs. The input is split at its first relation sign outside brackets
 *          (a row without one is set flush left in the right-hand column). A row given as
 *          { inter: '<html>' } is a line of text between two equations (TeX: \intertext); it spans the box.
 *   cls    extra class names on the box
 * Styling: .eq-align in brand.css (a grid: left sides, right sides, tags).
 */
export function aligned(rows, { cls = '' } = {}) {
    const out = [];
    for (const row of rows) {
        if (row && !Array.isArray(row) && typeof row === 'object') {
            out.push(`<div class="eq-inter">${row.inter || ''}</div>`);
            continue;
        }
        const [input, tag = ''] = Array.isArray(row) ? row : [row];
        const tokens = tokenize(input);
        let depth = 0;
        let at = -1;
        for (let n = 0; n < tokens.length && at < 0; n++) {
            if (tokens[n].t === 'open') depth++;
            else if (tokens[n].t === 'close') depth--;
            else if (tokens[n].t === 'rel' && depth === 0) at = n;
        }
        const left = at < 0 ? { html: '', text: '' } : render(tokens.slice(0, at));
        const right = render(at < 0 ? tokens : tokens.slice(at));
        const label = esc(render(tokens).text).replace(/"/g, '&quot;');
        const t = tag === '' || tag === null || tag === undefined ? '<span class="eq-tag"></span>' : `<span class="eq-tag">(${esc(String(tag))})</span>`;
        out.push(`<div class="eq-row" role="math" aria-label="${label}"><span class="eq-l m m-display">${left.html}</span><span class="eq-r m m-display">${right.html}</span>${t}</div>`);
    }
    return `<div class="eq-align${cls ? ` ${cls}` : ''}">${out.join('')}</div>`;
}

/**
 * In a page: typeset every element that carries data-math. The formula is
 * the attribute's value, or the element's text when the attribute is empty:
 *   <span data-math>2x + 3y <= 12</span>     <div data-math="x* = (3, 1)" data-tag="2"></div>
 */
export function typesetAll(root) {
    for (const el of root.querySelectorAll('[data-math]')) {
        const src = el.getAttribute('data-math') || el.textContent || '';
        if (el.hasAttribute('data-tag')) el.innerHTML = equation(src, el.getAttribute('data-tag'), { lead: el.getAttribute('data-lead') || '' });
        else el.innerHTML = math(src, { display: el.hasAttribute('data-display') });
        el.removeAttribute('data-math');
        el.setAttribute('data-math-source', src);
    }
}
