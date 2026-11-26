/*
 * The typed reader interface of the formula hover (6.2.2).
 *
 * The hover works in three steps:
 *
 *   1. recognition   the network (src/notes6/recognize) picks the card kind of a formula
 *   2. reader        a Reader turns the formula's TeX into parses: what the formula says, as named roles
 *   3. builder       buildCard (src/readers/build.ts) turns a parse and the note's definitions into the card
 *
 * This file defines step 2: one parse shape per card kind (19 kinds), and the
 * Reader that produces them. Every parse is plain JSON (strings, arrays,
 * objects, no undefined values when written out), so a reader may be any
 * program that writes these objects. Reader 0 (src/readers/reader0.ts) is the
 * regex readers of 6.2.1; scripts/readers/gap.mjs measures any reader against
 * the gold parses.
 *
 * Conventions for every parse:
 *
 *   Tex       LaTeX math as the chart language reads it inside $...$ (\frac, \sqrt, \sin, \cdot, \le, 0.5
 *             and 0{,}5); no full stop at the end, no \tag or \label. Two parses are the same when their
 *             strings agree up to spaces (parseKey in src/readers/build.ts).
 *   name      a name as the formula writes it (f, g, A, v, x_1, \lambda); a letter, or a letter with a
 *             subscript, or a Greek letter command.
 *   variable  the letter a formula is in, as it writes it (x, t, x_1, \lambda, \theta).
 *
 * The chart kinds (function, surface, polar, implicit, region) write their
 * bodies in the chart's own variables: x for a function, x and y for a
 * surface, a curve and a region, \theta for a polar curve. A formula in
 * another letter is renamed into them (s(t) = 3t^2 is the body 3x^2 with
 * variable t; f(x_1, x_2) = x_1^2 + x_2^2 is the body x^2 + y^2 with axes
 * x_1 and x_2); the variable and the axes only name the axes of the chart.
 * renameVariable (src/readers/build.ts) renames a letter as reader 0 does.
 *
 * Pure types: no code, no DOM, no Obsidian.
 */

/** LaTeX math as the chart language reads it (see the conventions above). */
export type Tex = string;

/** The card kinds: the labels of the recognition network without none. */
export type CardKind =
    | 'function'
    | 'surface'
    | 'polar'
    | 'implicit'
    | 'region'
    | 'set'
    | 'map'
    | 'condition'
    | 'interval'
    | 'jensen'
    | 'epigraph'
    | 'matrix'
    | 'product'
    | 'det'
    | 'eigen'
    | 'recurrence'
    | 'sum'
    | 'domain'
    | 'vector';

/** The names the axes of a chart take from a formula in x_1 and x_2 (written as x and y in the body). */
export interface AxisNames {
    /** The x-axis: x_1. */
    x?: string;
    /** The y-axis: x_2. */
    y?: string;
}

// ------------------------------------------------------------------ charts (src/formula.ts)

/** One function of a function card. */
export interface FunctionPiece {
    /** The formula's own name (g in g(x) = ...); without one the card names it f, g or h. */
    name?: string;
    /** The right side, in x: x^2 - 2x + 1, \sin(x) + a. */
    body: Tex;
}

/**
 * function: the graph y = f(x). f(x) = x^2 - 1, y = 2x + 1, x(t) = x_0 e^{a t}, a_n = 1/n, \frac{1}{1 + x}.
 * JSON: {"kind":"function","functions":[{"name":"f","body":"x^2 - 1"}]}
 *       {"kind":"function","functions":[{"body":"x_0 e^{a x}"}],"variable":"t"}
 */
export interface FunctionParse {
    kind: 'function';
    /** The functions to plot, the main one first; a formula may hold up to three (f(x) = ..., g(x) = ...). */
    functions: FunctionPiece[];
    /** The formula's variable when it is no x (t, n, k, a letter): the x-axis is named after it; n and k draw as a sequence from 0 to 20. */
    variable?: string;
    /** The axis names of a formula in x_1 (and x_2). */
    axes?: AxisNames;
    /** Where the graph is drawn (x from `from` to `to`); without it, everywhere. Reader 0 never gives it. */
    domain?: { from: Tex; to: Tex };
}

/**
 * surface: z = f(x, y). f(x, y) = x^2 + y^2, z = x y, 2x_1^2 + x_2^2, u = \sqrt{x y}.
 * JSON: {"kind":"surface","body":"x^2 + y^2"}   {"kind":"surface","body":"2x^2 + y^2","axes":{"x":"x_1","y":"x_2"}}
 */
export interface SurfaceParse {
    kind: 'surface';
    /** The height, in x and y. */
    body: Tex;
    axes?: AxisNames;
}

/**
 * polar: r = f(θ). r = 1 + \cos\theta, r(\theta) = 2\sin(3\theta).
 * JSON: {"kind":"polar","body":"1 + \\cos\\theta"}
 */
export interface PolarParse {
    kind: 'polar';
    /** The radius, in \theta. */
    body: Tex;
}

/**
 * implicit: the curve of one equation in x and y. x^2 + y^2 = 1, xy = 4, \{(x, y) \mid x + y = 1\} (as x + y = 1).
 * JSON: {"kind":"implicit","equation":"x^2 + y^2 = 1"}
 */
export interface ImplicitParse {
    kind: 'implicit';
    /** The equation, in x and y, with one =. */
    equation: Tex;
    axes?: AxisNames;
}

/**
 * region: the part of the plane where inequalities in x and y hold. x + y \le 4, x^2 + y^2 < 1, x_1 + x_2 \le 4.
 * JSON: {"kind":"region","condition":"x + y \\le 4"}
 */
export interface RegionParse {
    kind: 'region';
    /** The inequalities, in x and y (several joined by commas: x + y \le 4, x \ge 0). */
    condition: Tex;
    axes?: AxisNames;
}

// ------------------------------------------------------------------ sets and maps (src/notes6/hover.ts)

/**
 * set: a set builder. \{x \in \mathbb{R}^n \mid g(x) \le 0\}, \{(x, y) \mid x^2 + y^2 \le 1\}, S = \{x \mid x > 0\}.
 * JSON: {"kind":"set","variables":["x"],"condition":"g(x) \\le 0","space":"n"}
 *       {"kind":"set","variables":["x","y"],"condition":"x^2 + y^2 \\le 1"}
 */
export interface SetParse {
    kind: 'set';
    /** The head: one variable (x, x_1, \lambda) or two for a set of pairs ((x, y), (u, v)). */
    variables: string[];
    /** The condition after the separator (\mid, |, :): g(x) \le 0, x^2 + y^2 < 1. */
    condition: Tex;
    /** The power of ℝ the head names (x \in \mathbb{R}^n: n; \mathbb{R}^2: 2); a power other than 1 adds the chart for n = 2. */
    space?: string;
}

/**
 * map: a function's signature. g: \mathbb{R}^n \to \mathbb{R}, f \colon (0, \infty) \to \mathbb{R}.
 * JSON: {"kind":"map","name":"g","domain":"\\mathbb{R}^n","codomain":"\\mathbb{R}"}
 */
export interface MapParse {
    kind: 'map';
    /** The function's name (g, f, \ln: as ln). */
    name: string;
    /** The domain (\mathbb{R}, \mathbb{R}^n, \mathbb{R}^2): a power other than 1 adds the level curves for n = 2. */
    domain: Tex;
    codomain: Tex;
}

/**
 * condition: inequalities in one variable. g(x) \le 0, x > 0, |x - 1| < 2, x_1 \ge 2, 0 \le \lambda \le 1.
 * JSON: {"kind":"condition","variable":"x","condition":"g(x) \\le 0"}
 */
export interface ConditionParse {
    kind: 'condition';
    /** The one variable (x, x_1, \lambda, \alpha_1): the card draws on an axis named after it. */
    variable: string;
    /** The whole condition, in that variable. */
    condition: Tex;
}

/**
 * interval: an interval, or a variable in one. \lambda \in [0, 1], [a, b], (0, \infty), x_1 \in [0, 4].
 * JSON: {"kind":"interval","variable":"\\lambda","left":"[","lower":"0","upper":"1","right":"]"}
 */
export interface IntervalParse {
    kind: 'interval';
    /** The variable (x for an interval alone). */
    variable: string;
    left: '[' | '(';
    /** The ends: numbers, letters (a slider each), \infty, -\infty. */
    lower: Tex;
    upper: Tex;
    right: ']' | ')';
}

/**
 * jensen: Jensen's inequality g(λx + (1 - λ)y) \le λ g(x) + (1 - λ) g(y).
 * JSON: {"kind":"jensen","name":"g","weight":"\\lambda"}
 */
export interface JensenParse {
    kind: 'jensen';
    /** The function (g). */
    name: string;
    /** The weight (\lambda, \theta, \alpha, \mu, t). */
    weight: string;
}

/**
 * epigraph: \operatorname{epi} g, \{(x, t) \mid g(x) \le t\}.
 * JSON: {"kind":"epigraph","name":"g"}
 */
export interface EpigraphParse {
    kind: 'epigraph';
    /** The function (g). */
    name: string;
}

// ------------------------------------------------------------------ linear algebra (src/linear/hover.ts)

/**
 * matrix: a written 2 x 2 or 3 x 3 matrix, maybe named. A = \begin{pmatrix} 2 & 1 \\ 0 & 1 \end{pmatrix}.
 * JSON: {"kind":"matrix","name":"A","entries":[["2","1"],["0","1"]]}
 */
export interface MatrixParse {
    kind: 'matrix';
    /** Its name (A); without one, A. */
    name?: string;
    /** The entries, row by row: square, 2 x 2 or 3 x 3. */
    entries: Tex[][];
}

/**
 * product: a matrix applied to a vector, by name. A v, A\vec{v}, A \cdot x.
 * JSON: {"kind":"product","matrix":"A","vector":"v"}
 */
export interface ProductParse {
    kind: 'product';
    /** The matrix's name (a capital letter); its value comes from the note (else an example). */
    matrix: string;
    /** The vector's name (a small letter, no arrow); its value comes from the note (else an example). */
    vector: string;
}

/**
 * det: a determinant. \det A, \det(A), |\det A|, \det\begin{pmatrix} 1 & 2 \\ 3 & 4 \end{pmatrix}.
 * JSON: {"kind":"det","matrix":"A"}   {"kind":"det","entries":[["1","2"],["3","4"]]}
 */
export interface DetParse {
    kind: 'det';
    /** The matrix's name (A), when the formula names it. */
    matrix?: string;
    /** The written matrix, when the formula writes it (then it wins over the name). */
    entries?: Tex[][];
}

/**
 * eigen: an eigenvector equation. A v = \lambda v, (A - \lambda I) v = 0.
 * JSON: {"kind":"eigen","matrix":"A","vector":"v"}
 */
export interface EigenParse {
    kind: 'eigen';
    matrix: string;
    vector: string;
}

// ------------------------------------------------------------------ iteration (src/iterate/hover.ts)

/**
 * recurrence: one step of a sequence. x_{n+1} = r x_n (1 - x_n), z_{n+1} = z_n^2 + c.
 * JSON: {"kind":"recurrence","state":"x","index":"n","step":"r x_n (1 - x_n)"}
 */
export interface RecurrenceParse {
    kind: 'recurrence';
    /** The state's name as written (x, z, \theta); z, w and \zeta are complex (the orbit card), the rest real (the cobweb). */
    state: string;
    /** The index (n). */
    index: string;
    /** The next state from the current one: the right side, in state_index (x_n). */
    step: Tex;
}

/**
 * sum: a finite sum. \sum_{k=1}^{n} k^2, \sum^n_{k=0} q^k = \frac{1 - q^{n+1}}{1 - q}, s_n = \sum_{k=1}^{n} \frac{1}{k}.
 * JSON: {"kind":"sum","index":"k","lower":"1","upper":"n","body":"k^2"}
 */
export interface SumParse {
    kind: 'sum';
    /** The index (k). */
    index: string;
    lower: Tex;
    upper: Tex;
    /** The summand, in the index (and maybe x: the card then plots the partial sum as a function). */
    body: Tex;
    /** The right side after = (a closed form), when the formula gives one; the card does not draw it. */
    value?: Tex;
}

/**
 * domain: a function of a complex variable. f(z) = \frac{z^2 - 1}{z^2 + 1}, z^3 - 1, H(s) = \frac{1}{s + 1} (as z).
 * JSON: {"kind":"domain","name":"f","body":"\\frac{z^2 - 1}{z^2 + 1}"}
 */
export interface DomainParse {
    kind: 'domain';
    /** The function's name, when the formula has a head f(z) =. */
    name?: string;
    /** The function, in z. */
    body: Tex;
}

// ------------------------------------------------------------------ vectors (src/linear/vector.ts)

/** One side of a vector statement. */
export interface VectorSide {
    /**
     * The side as a value of the chart language: tuples (2, 1) and (1, 0, 2), the names of the statement's
     * `names` (a, F_ges, e_x), numbers, + - \cdot \times, \frac, |a|; a column \begin{pmatrix} 2 \\ 1 \end{pmatrix}
     * is the tuple (2, 1), \vec a is a, i, j and k are e_x, e_y and e_z.
     */
    value: string;
    /** The side as written (sizes and spacing out), for the labels. */
    tex: Tex;
}

/** One statement of a vector formula: a name and its sides (\vec a = (1, 2) = ...), or sides alone ((1, 0), (0, 1)). */
export interface VectorStatement {
    /** The vector's name before the first = as a chart name (a, F_ges, AB, e_1, Delta_r), and as written (\vec F_{ges}). */
    name?: string;
    nameTex?: Tex;
    /** The sides after the name (a = b = c: b and c), in order. */
    sides: VectorSide[];
    /** The vector names the sides use: chart name to the TeX the formula writes it with ({"a": "\\vec a"}). */
    names: Record<string, Tex>;
}

/**
 * vector: concrete vectors as arrows. \vec v = (2, 1), \vec a + \vec b, 3 \cdot (2, 1), (2, 1) \cdot (1, 3) = 5, (1, 0), (0, 1).
 * The card takes the first statement (of the first four) that draws: a dot or cross product, a sum,
 * a multiple, else the last side that is a vector.
 * JSON: {"kind":"vector","statements":[{"name":"v","nameTex":"\\vec v","sides":[{"value":"(2, 1)","tex":"(2, 1)"}],"names":{}}]}
 */
export interface VectorParse {
    kind: 'vector';
    statements: VectorStatement[];
}

// ------------------------------------------------------------------ all of them

/** The parse of a chart card. */
export type ChartParse = FunctionParse | SurfaceParse | PolarParse | ImplicitParse | RegionParse;
/** The parse of a card of src/notes6/hover.ts. */
export type Notes6Parse = SetParse | MapParse | ConditionParse | IntervalParse | JensenParse | EpigraphParse;
/** The parse of a card of src/linear/hover.ts. */
export type LinearParse = MatrixParse | ProductParse | DetParse | EigenParse;
/** The parse of a card of src/iterate/hover.ts. */
export type IterateParse = RecurrenceParse | SumParse | DomainParse;

/** Any parse: its `kind` says which. */
export type CardParse = ChartParse | Notes6Parse | LinearParse | IterateParse | VectorParse;

/** What a reader may read around a formula (all optional). */
export interface ReadContext {
    /** The whole block, when the formula is one row of an aligned block, and the row's index. */
    block?: Tex;
    row?: number;
    /** The functions the note defines (g(x) = ...): a letter before a bracket that is one is a call, not a product. */
    functions?: ReadonlySet<string>;
    /** The sets the note names (D = [0, 1] is \mathbb{R}, D \subseteq \mathbb{R}^2 is \mathbb{R}^2): a map's domain letter. */
    domains?: ReadonlyMap<string, string>;
    /** What the recognition network reads: the words around the formula ("Modell [F] mit Bias"), the note's id, its defining formulas. */
    context?: string;
    note?: string | null;
    defs?: readonly string[];
}

/**
 * A reader: the parses of a formula for the card kind the network chose, best
 * first. The hover builds them in order: the first whose card is of that kind
 * wins; without one, the first card that builds (of another kind of the same
 * builder: a function label may show a surface). An empty list: no card from
 * the reader (the hover then falls back to the rules of 6.1).
 *
 * A reader may return parses of other kinds of the same builder (chart:
 * function, surface, polar, implicit, region; notes6: set, map, condition,
 * interval, jensen, epigraph; linear: matrix, product, det, eigen; iterate:
 * recurrence, sum, domain; vector). It must be pure and fast (it runs on
 * every formula of a note when the note is drawn).
 */
export interface Reader {
    read(tex: Tex, kind: CardKind, ctx?: ReadContext): CardParse[];
}
