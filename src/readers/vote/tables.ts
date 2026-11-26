/*
 * Tables of the readers' front end (6.2.4): data only. A port of the frozen
 * tables.mjs (hover-ml readers). Plain objects on purpose: the front end
 * looks names up as the frozen code does.
 */

/** Unicode signs and their TeX. */
export const UNI: Record<string, string> = {
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

/** Plain-text function names that get their backslash. */
export const FN_PLAIN = 'arcsin|arccos|arctan|sinh|cosh|tanh|sqrt|sin|cos|tan|cot|exp|log|ln|lim|max|min|det|sup|inf';

/** A command's token: its class, maybe its canonical value, maybe a side (l, r, m) or a font kind. */
export type CmdDef = [string, string?, string?];

const C: Record<string, CmdDef> = {};
const put = (names: string, k: string, v?: string, x?: string) => {
    for (const n of names.split(' ')) C[n] = v === undefined ? [k] : x === undefined ? [k, v === '=' ? '\\' + n : v] : [k, v, x];
};
// dropped: layout without meaning
put('displaystyle textstyle scriptstyle scriptscriptstyle limits nolimits nonumber notag allowbreak nobreak newline hfill strut mathstrut centering enspace enskip thinspace medspace thickspace space nobreakspace negthinspace hline cline toprule midrule bottomrule', 'drop');
// sizes: the bracket after them is the bracket
put('left bigl Bigl biggl Biggl', 'size', 'l');
put('right bigr Bigr biggr Biggr', 'size', 'r');
put('middle bigm Bigm biggm Biggm', 'size', 'm');
put('big Big bigg Bigg', 'size', '');
put('quad qquad', 'wsp', '\\quad');
// relations, each with one canonical spelling
put('le leq leqslant leqq', 'rel', '\\le');
put('ge geq geqslant geqq', 'rel', '\\ge');
put('lt', 'rel', '<');
put('gt', 'rel', '>');
put('ne neq', 'rel', '\\ne');
put('approx simeq cong approxeq doteq', 'rel', '\\approx');
put('equiv', 'rel', '\\equiv');
put('sim', 'rel', '\\sim');
put('propto', 'rel', '\\propto');
put('ll', 'rel', '\\ll');
put('gg', 'rel', '\\gg');
put('coloneqq coloneq', 'rel', '=');
put('in', 'rel', '\\in');
put('notin', 'rel', '\\notin');
put('ni', 'rel', '\\ni');
put('subset subseteq subsetneq', 'rel', '\\subseteq');
put('supset supseteq', 'rel', '\\supseteq');
put('to rightarrow longrightarrow', 'rel', '\\to');
put('mapsto longmapsto', 'rel', '\\mapsto');
put('leftarrow gets', 'rel', '\\leftarrow');
// logic signs cut a formula in parts
put('Rightarrow Longrightarrow implies therefore leadsto rightsquigarrow', 'log', '\\Rightarrow');
put('iff Leftrightarrow Longleftrightarrow leftrightarrow', 'log', '\\iff');
put('Leftarrow Longleftarrow impliedby because', 'log', '\\Leftarrow');
put('land wedge', 'log', '\\land');
put('lor vee', 'log', '\\lor');
put('forall', 'sym', '\\forall');
put('exists', 'sym', '\\exists');
put('neg lnot', 'sym', '\\neg');
// operators
put('cdot ast', 'op', '\\cdot');
put('times', 'op', '\\times');
put('div', 'op', '/');
put('pm', 'op', '\\pm');
put('mp', 'op', '\\mp');
put('circ', 'op', '\\circ');
put('bullet', 'op', '\\cdot');
put('cup', 'op', '\\cup');
put('cap', 'op', '\\cap');
put('setminus smallsetminus', 'op', '\\setminus');
put('oplus', 'op', '\\oplus');
put('otimes', 'op', '\\otimes');
// separators and bars
put('mid', 'bar', '|', 'm');
put('colon', 'sep', ':');
put('vert', 'bar', '|');
put('lvert', 'bar', '|', 'l');
put('rvert', 'bar', '|', 'r');
put('Vert', 'bar', '\\|');
put('lVert', 'bar', '\\|', 'l');
put('rVert', 'bar', '\\|', 'r');
put('lbrace', 'open', '\\{');
put('rbrace', 'close', '\\}');
put('langle', 'open', '\\langle');
put('rangle', 'close', '\\rangle');
put('lfloor', 'open', '\\lfloor');
put('rfloor', 'close', '\\rfloor');
put('lceil', 'open', '\\lceil');
put('rceil', 'close', '\\rceil');
put('lbrack', 'open', '[');
put('rbrack', 'close', ']');
// functions
put('sin cos tan cot sec csc arcsin arccos arctan sinh cosh tanh ln log lg exp arg sgn sign deg gcd', 'fn', '=');
put('sum prod int iint iiint oint lim limsup liminf max min sup inf argmax argmin bigcup bigcap', 'big', '=');
put('det', 'det', '\\det');
put('dim ker rank tr span', 'fn', '=');
put('frac dfrac tfrac cfrac', 'frac', '\\frac');
put('binom dbinom tbinom', 'binom', '\\binom');
put('sqrt', 'sqrt', '\\sqrt');
put('vec overrightarrow', 'acc', '\\vec');
put('mathbf boldsymbol bm mathbfit symbf pmb', 'acc', '\\mathbf');
put('hat widehat', 'acc', '\\hat');
put('bar overline', 'acc', '\\bar');
put('tilde widetilde', 'acc', '\\tilde');
put('dot', 'acc', '\\dot');
put('ddot', 'acc', '\\ddot');
put('underline', 'acc', '\\underline');
put('mathcal mathscr mathfrak mathit mathsf mathtt', 'acc', '=');
put('mathbb mathds Bbb mathbbm', 'bb');
put('text textrm textbf textit textsf texttt mbox textnormal', 'font', 'text');
put('mathrm', 'font', 'rm');
put('operatorname', 'font', 'op');
put('begin', 'beg');
put('end', 'end');
put('infty', 'inf', '\\infty');
put('top intercal', 'top', '\\top');
put('dots ldots cdots vdots ddots dotsc dotsb', 'dots', '\\dots');
put('partial', 'sym', '\\partial');
put('nabla', 'sym', '\\nabla');
put('emptyset varnothing', 'sym', '\\emptyset');
put('ell', 'let', '\\ell');
put('prime', 'prime', "'");
put('alpha beta gamma delta epsilon zeta eta theta iota kappa lambda mu nu xi pi rho sigma tau upsilon phi chi psi omega Gamma Delta Theta Lambda Xi Pi Sigma Upsilon Phi Psi Omega varepsilon vartheta varphi varrho varsigma', 'grk', '=');
put('R N Z Q C', 'bbl');
put('RR IR', 'bbl', 'R');

/** The commands the front end knows: name (without the backslash) to its token. */
export const CMD = C;

/** Names inside \operatorname{...}, \mathrm{...}, \text{...} that are a command of their own. */
export const OPNAMES: Record<string, [string, string]> = {
    sin: ['fn', '\\sin'],
    cos: ['fn', '\\cos'],
    tan: ['fn', '\\tan'],
    ln: ['fn', '\\ln'],
    log: ['fn', '\\log'],
    exp: ['fn', '\\exp'],
    arctan: ['fn', '\\arctan'],
    min: ['big', '\\min'],
    max: ['big', '\\max'],
    argmin: ['big', '\\argmin'],
    argmax: ['big', '\\argmax'],
    sup: ['big', '\\sup'],
    inf: ['big', '\\inf'],
    lim: ['big', '\\lim'],
    det: ['det', '\\det'],
};
