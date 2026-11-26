import type { AxisNumbers, TickAxis } from './ticks';
import type { ChartLook } from './look';

export type FillPattern =
    | 'solid'
    | 'horizontal'
    | 'vertical'
    | 'crosshatch'
    | 'dots'
    | 'north-east'
    | 'north-west';

export type AnnotationAnchor = 'center' | 'above' | 'below' | 'left' | 'right';
export type AnnotationSize = 'small' | 'normal' | 'large';

/**
 * A named slider value usable in every expression field (functions,
 * domains, tool coordinates, region conditions, axis ranges, labels, ...).
 * Dragging the slider re-renders the preview on the next animation frame
 * without recompiling anything: compiled closures read parameter values
 * from their MathContext's scope at call time.
 */
export interface Parameter {
    name: string;
    value: number;
    min: number;
    max: number;
    step: number;
    /**
     * Connect with others (5.0): in a note, moving this slider moves the
     * sliders of the same name in the other charts of the note that are
     * connected too. Text: `slider a from 0 to 2, connected`.
     */
    connected?: boolean;
    // 6.0 G
    /** Written the GeoGebra way, `a = Slider(0, 5)`: printed so while its value is its low end. */
    geogebra?: boolean;
}

export interface FunctionParameters {
    expression: string;
    /**
     * "min:max" (expressions and parameters allowed). Empty means "follow
     * the visible x range" for cartesian functions and `0:2*pi` for
     * parametric / polar ones.
     */
    domain: string;
    showLegend: boolean;
    /**
     * Optional custom legend text. When blank, the legend entry falls
     * back to the function's expression (or, for parametric/polar
     * functions, the auto-generated default label).
     */
    legendLabel?: string;
    /** "Fill to x-axis": shades between the curve and y = 0. */
    fill: boolean;
    fillOpacity: number;
    fillPattern: FillPattern;
    tangent: boolean;
    color: string;
    dashed: boolean;
    /** A number, an expression, or a live keyword: min, max, min2, max3, ... */
    tangentPoint: string;
    extrema: boolean;
    thickness: string;
    /** When true, `expression` is x(t) and `expressionY` is y(t). Domain is t-range. */
    parametric: boolean;
    expressionY: string;
    /**
     * User-readable, referenceable name (`[A-Za-z][A-Za-z0-9_]*`).
     * Materialized on load by `normalizeFunctions` (blank -> f1, f2, ...)
     * and persisted, so references like `y <= f1` survive reordering.
     */
    name?: string;
    /** Hidden functions are not drawn but stay callable by name (and are inlined in export). */
    hidden?: boolean;
    // 6.0 C
    /** The step it arrives in (a `then` line starts the next step, src/motion6/steps.ts); absent or 0: from the start. */
    step?: number;
    // 6.0 ML
    /** The name as the line writes it, when it is LaTeX (`\sigma`, `\mathrm{ReLU}`): its plain form is `name` (src/ml/heads.ts). */
    head?: string;
}

/**
 * Colour maps by height for 3D surfaces (src/colormaps.ts): the colour of a
 * point follows its z value, the same in the preview and the PDF.
 */
export type Colormap = 'viridis' | 'heat' | 'cool' | 'diverging' | 'rainbow' | 'greyscale';

export interface Function3DParameters {
    expression: string;
    xDomain: string;
    yDomain: string;
    color: string;
    wireframe: boolean;
    opacity: number;
    samples: number;
    /**
     * Colours by height through a colour map. Absent: the surface's own
     * colour, light at the bottom of the box to full at the top.
     */
    colormap?: Colormap;
    /**
     * Opacity of the mesh lines on a filled surface, 0..1 (src/opacity.ts:
     * MESH_OPACITY when absent). 0 draws a smooth surface; a wireframe ignores it.
     */
    meshOpacity?: number;
    /** Optional user-readable name. Mirrors `FunctionParameters.name`. */
    name?: string;
    hidden?: boolean;
    // 6.0 C
    /** The step it arrives in (src/motion6/steps.ts). */
    step?: number;
}

export interface Annotation {
    /** Positions accept expressions, parameters and derived names (`P1_x`). */
    x: string;
    y: string;
    z?: string;
    /** Label text; `{expr}` / `{expr:2}` templates are interpolated, `$...$` is math. */
    text: string;
    color: string;
    size: AnnotationSize;
    anchor: AnnotationAnchor;
    hidden?: boolean;
    // 6.0 C
    /** The step it arrives in (src/motion6/steps.ts). */
    step?: number;
}

export type CoordinateSystem = 'cartesian' | 'polar';

export type AxisStyle = 'box' | 'middle' | 'axes';

/**
 * 3D bounding-box aspect ratio.
 * - 'true': box edges scale with the data ranges (xmax-xmin, ymax-ymin,
 *   zmax-zmin). Faithful to the data, but can look stretched if one
 *   axis spans a much wider range than the others. Exported as
 *   pgfplots' `unit vector ratio=1 1 1`.
 * - 'equal': each axis is normalized to a unit length, so the bounding
 *   box is a perfect cube on screen regardless of the data ranges.
 *   Exported as pgfplots' default box (no aspect option).
 * - 'custom': the edges have the lengths of `boxRatio` (x : y : z), such
 *   as 1 : 2 : 0.6 for a long box that still shows its heights (the line
 *   `box 1 x 2 x 0.6`; pgfplots' `plot box ratio`).
 */
export type BoxAspect = 'true' | 'equal' | 'custom';

export type ArrowStyle = 'none' | 'forward' | 'backward' | 'both';

// ---------------------------------------------------------------------------
// Tools (v4): a few general tools instead of many special-purpose ones.
//
//   region   filled set where every condition holds: feasible regions,
//            areas between any number of curves, rectangles, discs,
//            unions via `or` inside one condition
//   curve    implicit equation (`3x + 2y = 12`, `x = 2`, circles) or the
//            level curves of an expression (`levels`)
//   points   explicit points, intersections of two functions/curves,
//            corner points of a region, integer lattice points; an
//            optional objective keeps only the best candidate(s)
//   segment  polyline through 2+ points: line, arrows, brace (2D or 3D)
//   plane3D  plane at constant x, y or z (3D)
//
// Every coordinate / condition / label field is an expression or template
// string, so users can write `pi/2`, a parameter name, or a derived name
// such as `P1_x` (the x coordinate computed by points tool P1).
// Legacy 3.x tool shapes are migrated by `migrateSettings` in src/migrate.ts.
// ---------------------------------------------------------------------------

export type SegmentStyle = 'line' | 'forward' | 'backward' | 'both' | 'brace';
export type OutlineStyle = 'none' | 'solid' | 'dashed';
export type MarkerSize = 'small' | 'normal' | 'large';

export interface ToolBase {
    /** Stable id (UI keys, caches). Random for new tools, `t<index>` for migrated ones. */
    id: string;
    /** User-visible, referenceable name: R1, C1, P1, S1, PL1, ... */
    name: string;
    /** Hidden tools are not drawn, but are still computed when another tool references them. */
    hidden?: boolean;
    color: string;
    // 6.0 C
    /** The step it arrives in (a `then` line starts the next step, src/motion6/steps.ts); absent or 0: from the start. */
    step?: number;
}

export interface RegionTool extends ToolBase {
    type: 'region';
    /**
     * ANDed entries. One entry may hold several clauses separated by
     * `,` `;` `and` `&&`, chained comparisons (`0 <= x <= 4`), and `or` /
     * `||` between clause groups (`and` binds tighter than `or`):
     * `y <= f1`, `2x + 3y <= 12`, `x^2 + y^2 <= r^2`, `x <= 1 or x >= 3`.
     */
    conditions: string[];
    /** Optional label per entry (same index as `conditions`), drawn on its constraint line. */
    conditionLabels: string[];
    fill: boolean;
    fillOpacity: number;
    fillPattern: FillPattern;
    /** Stroke along the region's own boundary. */
    outline: OutlineStyle;
    thickness: string;
    /** Draw every atomic constraint's boundary line g = 0 across the whole view. */
    constraintLines: boolean;
    /** Text drawn at the visual centre of the region ('' = none). Template. */
    label: string;
}

export interface CurveTool extends ToolBase {
    type: 'curve';
    /**
     * `lhs = rhs` (`3x + 2y = 12`, `x = 2`, `x^2 + y^2 = 4`, `y = sin(x)`)
     * or a bare expression F(x, y). The plotted function is F = lhs - rhs.
     */
    equation: string;
    /**
     * Empty: plot F = 0. Otherwise a comma list of values (expressions
     * allowed, e.g. `2, 4, c, P1_val`) and F = level is plotted for each.
     */
    levels: string;
    thickness: string;
    dashed: boolean;
    /** Template drawn near each curve's end; `{level}` is available. '' = none. */
    label: string;
}

export interface PointsTool extends ToolBase {
    type: 'points';
    /** 2 for 2D charts, 3 for 3D charts. Tools of the other dimension are skipped. */
    dim: 2 | 3;
    /**
     * Candidate set:
     *   list           `points` field
     *   intersections  crossings of `ref1` and `ref2` (function or curve tool names)
     *   region         corner points of region `regionName`
     *   lattice        integer points inside `regionName` (or the whole view when empty)
     */
    source: 'list' | 'intersections' | 'region' | 'lattice';
    /** List source: `(1, 2); (3, 4)` in 2D, `(1, 2, 3); (0, 0, 1)` in 3D. */
    points: string;
    ref1: string;
    ref2: string;
    regionName: string;
    /**
     * Optional selection: when non-empty, only the candidate(s) maximising /
     * minimising this objective(x, y) are kept. Region source + objective
     * means the continuous optimum over the region.
     */
    objective: string;
    sense: 'max' | 'min';
    /**
     * Label template per point; `;` separates per-point labels (`A; B; C`).
     * Locals: x, y, z, val (objective value), i (1-based index).
     * '' = no labels. Coordinates preset: `({x:2}, {y:2})`.
     */
    label: string;
    /** Dashed guide lines from each point to the axes (2D only). */
    dropLines: boolean;
    size: MarkerSize;
}

export interface SegmentTool extends ToolBase {
    type: 'segment';
    dim: 2 | 3;
    /**
     * Points separated by `;`: tuples `(x, y)` / `(x, y, z)` (expressions
     * allowed) or the name of a points tool, which splices in its points.
     * Two points make a plain segment.
     */
    path: string;
    /** Close the path back to its first point (polygon outline). */
    closed: boolean;
    /** Arrow styles apply to every leg; brace uses the first two points only. */
    style: SegmentStyle;
    thickness: string;
    dashed: boolean;
    /** Template drawn beside the middle of the path / brace ('' = none). */
    label: string;
}

export interface PlaneTool extends ToolBase {
    type: 'plane3D';
    axis: 'x' | 'y' | 'z';
    value: string;
    fillOpacity: number;
}

// ---------------------------------------------------------------------------
// Beyond functions (5.0): data, probability, Riemann sums and slope fields.
// Each draws with the scene's primitives (src/beyond/scene.ts), 2D only.
// ---------------------------------------------------------------------------

/**
 * A data set: points from the nearest Markdown table above the chart block
 * (read where the chart renders, src/beyond/table.ts, never written into the
 * block) or typed in the chart. Draws nothing itself: data plots draw it.
 * Publishes D1_n and its points (D1_x, D1_y, D1_x2, ...).
 */
export interface DataTool extends ToolBase {
    type: 'data';
    source: 'table' | 'list';
    /** List source: `(1, 52); (2, 55); (3, 61)` (formulas allowed). */
    points: string;
    /** Table source: the columns by header name; empty: the first two numeric columns. */
    xColumn: string;
    yColumn: string;
}

export type DataPlotStyle = 'points' | 'bars' | 'line' | 'regression';

/** A data set drawn: its points, bars from the x-axis, a line through it, or its least-squares line. */
export interface DataPlotTool extends ToolBase {
    type: 'dataPlot';
    /** Name of the data tool. */
    data: string;
    style: DataPlotStyle;
    /** Points: marker size. */
    size: MarkerSize;
    /** Line, regression line and the bars' outlines. */
    thickness: string;
    dashed: boolean;
    /** Bars. */
    fillOpacity: number;
    /**
     * Template. Points and bars: per point, locals x, y, i (`;` gives each
     * its own). Regression line: locals m, b, r2, n. '' = none.
     */
    label: string;
    /**
     * The values as labels (when `label` is empty): each point's coordinates,
     * each bar's value, the regression line's equation and R².
     */
    valueLabel: boolean;
}

/** 6.2.1: the kinds of distribution: densities drawn as a curve, and the binomial and Poisson ones as bars. */
export type DistributionKind = 'normal' | 'binomial' | 'studentT' | 'chiSquare' | 'exponential' | 'uniform' | 'poisson' | 'gamma' | 'beta';

/**
 * A probability distribution: the density curve of a normal (6.2.1: t,
 * chi-square, exponential, uniform, gamma, beta) distribution, or the bars
 * of a binomial one at k = 0..n (6.2.1: or of a Poisson one). Its fields
 * are formulas, so sliders work; each kind reads its own (src/beyond/kinds.ts).
 */
export interface DistributionTool extends ToolBase {
    type: 'distribution';
    kind: DistributionKind;
    /** Normal: mean and standard deviation (more than 0). */
    mean: string;
    sd: string;
    /** Binomial: number of trials (a whole number, 0 to 1000) and the probability of a success (0 to 1). */
    n: string;
    p: string;
    /** 6.2.1: t and chi-square: the degrees of freedom (more than 0). */
    df: string;
    /** 6.2.1: exponential and gamma: the rate (more than 0). */
    rate: string;
    /** 6.2.1: uniform: from a to b (a below b). */
    from: string;
    to: string;
    /** 6.2.1: Poisson: λ, its mean (more than 0, at most 1000). */
    lambda: string;
    /** 6.2.1: gamma: the shape (more than 0). */
    shape: string;
    /** 6.2.1: beta: a and b, its α and β (more than 0). */
    alpha: string;
    beta: string;
    /** The density curve. */
    thickness: string;
    dashed: boolean;
    /** The bars (binomial, Poisson). */
    fillOpacity: number;
}

/**
 * A probability shaded: the area under a density between the bounds of the
 * event, or the bars in range (binomial, Poisson). Publishes PR1_val (the
 * probability).
 */
export interface ProbabilityTool extends ToolBase {
    type: 'probability';
    /** Name of the distribution tool. */
    distribution: string;
    /**
     * The event inside P(...), as written (plain or LaTeX): `-1 <= X <= 1`,
     * `X \le b`, `X > a`, `X = 3`. Its letter stands for the distribution.
     */
    event: string;
    fillOpacity: number;
    fillPattern: FillPattern;
    /** Template; local p (the probability). '' = none. */
    label: string;
    /** The event and its probability as the label (when `label` is empty): $P(-1 \le X \le 1) = 0.683$. */
    valueLabel: boolean;
}

export type RiemannMethod = 'left' | 'right' | 'middle' | 'trapezoid';

/**
 * A Riemann sum (left, right or middle rectangles) or the trapezoid rule of
 * a function y = f(x) of the chart over [from, to] with `parts` equal parts.
 * The bounds and the number of parts are formulas (a slider n is the usual
 * one). Publishes RS1_val (the sum).
 */
export interface RiemannTool extends ToolBase {
    type: 'riemann';
    /** Name of the function (a cartesian function of the chart). */
    function: string;
    method: RiemannMethod;
    from: string;
    to: string;
    parts: string;
    /** The outlines of the parts. */
    thickness: string;
    fillOpacity: number;
    /** Template; locals sum, exact (the integral) and n. '' = none. */
    label: string;
    /** The sum and the integral as the label (when `label` is empty): $L_{6} = 1.921$, $\int_{0}^{2} f(x)\,dx = 2.667$. */
    valueLabel: boolean;
}

/**
 * The slope field of y' = f(x, y): short segments on a grid over the view,
 * each with the slope f(x, y) at its middle, all the same length on screen.
 */
export interface SlopeFieldTool extends ToolBase {
    type: 'slopeField';
    /** f(x, y), the right side of y' = f(x, y). */
    expression: string;
    /** About this many segments across the longer side of the plot (4 to 60). */
    density: number;
    thickness: string;
}

/**
 * The solutions of a slope field's equation through points (RK4, forwards
 * and backwards until they leave the view or blow up). A point is a points
 * tool's name, so dragging the point moves the solution.
 */
export interface SolutionTool extends ToolBase {
    type: 'solution';
    /** Name of the slope field. */
    field: string;
    /** Where the solutions go through, separated by `;`: points tools (`P`) and points (`(1, 2)`). */
    through: string;
    thickness: string;
    dashed: boolean;
}

// 6.0 C ---------------------------------------------------------------------
// Motion (6.0): vector fields with their particles and streamlines, the rest
// points of a field, and the solutions of systems of ODEs in 2D and 3D
// (src/motion6/).
// ---------------------------------------------------------------------------

/**
 * The vector field F(x, y) = (P, Q): short arrows on a grid over the view,
 * all the same length on screen. The tool's name is the field's name (F).
 */
export interface VectorFieldTool extends ToolBase {
    type: 'vectorField';
    /** F as a pair of formulas in x and y: `(y, -sin(x) - 0.25y)` (LaTeX allowed). */
    expression: string;
    /** About this many arrows across the longer side of the plot (4 to 60). */
    density: number;
    thickness: string;
    /** Coloured by length through a colour map; absent: the tool's colour. */
    colormap?: Colormap;
    /** Particles that follow F on the animation clock (the export draws them still). */
    particles: boolean;
    /** Still curves along F through a grid of seeds (the export draws them too). */
    streamlines: boolean;
    // 6.0 F4: the moving particles (absent: the plan's flow, src/motion6/liveprims.ts FLOW).
    /** How fast, times the plan's (`speed 2`). */
    speed?: number;
    /** How many particles (`450 particles`). */
    count?: number;
    /** How long the trails stay: the share of the last frame each frame keeps (`trails 0.9`). */
    trails?: number;
    /** The particles' line width in screen pixels (`width 1.4`). */
    particleWidth?: number;
    /** The opacity the arrow grid is drawn with each frame (`arrows 0.025`); 0: `no arrows`. */
    arrows?: number;
}

/**
 * The rest points of a vector field (its zeros in the view, found
 * numerically): filled when stable, open when not, from the eigenvalues of
 * the Jacobian. Publishes RP1_n and RP1_x, RP1_y, RP1_x2, ...
 */
export interface RestPointsTool extends ToolBase {
    type: 'restPoints';
    /** Name of the vector field. */
    field: string;
    size: MarkerSize;
    /** Each point labelled with its kind (saddle, stable spiral, ...). */
    valueLabel: boolean;
}

/**
 * The solution of a system p' = F(p, t) through a point, for t in [from, to]
 * (RK4): a curve in a 2D chart, a 3D curve in a 3D chart. The start may be a
 * points tool, so dragging it moves the solution.
 */
export interface TrajectoryTool extends ToolBase {
    type: 'trajectory';
    /** The right side: a tuple of 2 (2D) or 3 (3D) formulas in x, y (and z) and t: `(y, -x)`. */
    expression: string;
    /** Where it is at t = from, separated by `;`: points tools (`P`) and points (`(1, 1, 1)`). */
    through: string;
    from: string;
    to: string;
    dim: 2 | 3;
    thickness: string;
    dashed: boolean;
    /** Coloured by time through a colour map; absent: the tool's colour. */
    colormap?: Colormap;
    // 6.0 F4
    /** Coloured by time in the default ramp, cobalt to amber (`coloured by time`); a colormap wins. */
    byTime?: boolean;
    /** It draws itself over time with a dot at its head, then starts again (the export draws it whole). */
    traced?: boolean;
    /** How fast it draws itself, times the usual (`speed 2`). */
    speed?: number;
}

// 6.0 B: notes and interaction (src/notes6/): sets on an axis and chords, 2D only.

/**
 * The set where a condition in one variable holds, as a bar on an axis
 * (`mark where $g(x) \le 0$ on the x-axis`): filled end dots where the end
 * belongs to the set, open ones where it does not, arrows where it runs off
 * the view, an equation's zeros as dots. Publishes AX1_n (the number of
 * pieces), AX1_x / AX1_y (the first end) and indexed ends.
 */
export interface AxisSetTool extends ToolBase {
    type: 'axisSet';
    /** The condition: `g(x) <= 0`, `|x - 1| < 2`, `x < -1 or x > 2`, `0 <= x <= 1`, `g(x) = 0` (its zeros). */
    condition: string;
    /** The axis the set lies on; the condition is in its variable. */
    axis: 'x' | 'y';
    thickness: string;
    /** Template drawn by the bar ('' = none). */
    label: string;
    /** The set in set notation as the label (when `label` is empty): {x | g(x) ≤ 0} = [-2, 2]. */
    valueLabel: boolean;
}

/**
 * The chord of a function between (a, g(a)) and (b, g(b)); with `at`, the
 * point x = λa + (1 - λ)b on the chord and on the graph and the gap between
 * them (Jensen's inequality). Publishes CH1_x (that x) and CH1_val (the gap,
 * chord minus graph).
 */
export interface ChordTool extends ToolBase {
    type: 'chord';
    /** Name of the function (a cartesian function of the chart). */
    function: string;
    from: string;
    to: string;
    /** λ, a formula (a slider); '' = the chord alone. */
    at: string;
    thickness: string;
    dashed: boolean;
    /** Template at the point on the chord; locals lambda, x, chord, graph, gap. '' = none. */
    label: string;
    /** The two values as labels (when `label` is empty). */
    valueLabel: boolean;
}

// 6.0 A: values (src/values/).

/**
 * A let definition: a name for a value (a number, a complex number, a
 * vector, a matrix or a list) or for a function of one or more variables,
 * usable in every formula field of the chart. Draws nothing; the tool's
 * name is the defined name. Text: `let v = (2, 1)`, `let f(x, y) = x^2 + 4y^2`.
 */
export interface ValueTool extends ToolBase {
    type: 'value';
    /** The parameters of a function, `x, y`; empty for a value. */
    params: string;
    /** The formula after =, plain or LaTeX: `(2, 1)`, `\begin{pmatrix} 1 & 2 \\ 3 & 4 \end{pmatrix}`, `-0.8 + 0.156i`. */
    expression: string;
}

/**
 * Vectors drawn as arrows, from the origin, from a point, or tip to tail
 * (the terms of a sum end to end, then the sum). 2D or 3D as the chart is.
 * Text: `draw v as an arrow`, `draw v and w as arrows, labelled`,
 * `draw v from (1, 1)`, `draw v + w tip to tail`.
 */
export interface VectorTool extends ToolBase {
    type: 'vector';
    /** The vectors, `;` between them: names or formulas (`v; w`, `(2, 1)`, `A v`); tip to tail: one sum. */
    vectors: string;
    /** Where the arrows start: a point (`(1, 1)`, a points tool P); empty for the origin. */
    from: string;
    tipToTail: boolean;
    thickness: string;
    dashed: boolean;
    /** Template, one per arrow with `;`; locals x, y, z (the vector) and i. '' = none. */
    label: string;
    /** Each arrow labelled with its vector in LaTeX (when `label` is empty): $\vec{v}$, $\vec{v} + \vec{w}$. */
    valueLabel: boolean;
}

/**
 * The points of a list: complex numbers or points, such as the n-th roots
 * of unity `\{e^{2\pi i k / n} : k = 0, \dots, n - 1\}`, optionally
 * joined into a closed polygon. Publishes LP1_n, LP1_x, LP1_y, LP1_x2, ...
 */
export interface ListPointsTool extends ToolBase {
    type: 'listPoints';
    /** The list: a formula, or the name of a let list. */
    points: string;
    /** The closed polygon through the points, in their order. */
    joined: boolean;
    size: MarkerSize;
    thickness: string;
    /** Template per point; locals x, y, z and i. '' = none. */
    label: string;
    /** Each point labelled with its value (when `label` is empty): 0.309 + 0.951i, (1, 2). */
    valueLabel: boolean;
}

// 6.0 D: linear algebra and complex maps (src/linear/). 2D and 3D, as the chart is.

/**
 * The grid that transforms move: the lines x = k·step and y = k·step (in 3D
 * the lines of a grid cube) from `from` to `to`. Text: `draw the grid`,
 * `draw the grid from -2 to 2 in steps of 0.5`.
 */
export interface PlaneGridTool extends ToolBase {
    type: 'planeGrid';
    /** Where the lines start and end on every axis (formulas); both '' = beyond the view. */
    from: string;
    to: string;
    /** Between two lines (a formula); '' = 1. */
    spacing: string;
    thickness: string;
}

/**
 * The basis vectors î and ĵ (k̂ in 3D) as arrows from the origin. In the
 * colour green they are green, red and blue; any other colour draws all of
 * them in it. Text: `draw the basis vectors`.
 */
export interface BasisVectorsTool extends ToolBase {
    type: 'basisVectors';
    thickness: string;
    /** î, ĵ, k̂ beside the tips. */
    valueLabel: boolean;
}

/**
 * Moves every object drawn before it (not the axes) by a matrix or a map;
 * in a step (`then`) it moves while the step comes in: (1 - t)I + tA, or
 * (1 - t)z + t f(z). Text: `transform the plane by A`, `transform space by B`,
 * `transform the plane by $z \mapsto z^2$`.
 */
export interface TransformTool extends ToolBase {
    type: 'transform';
    /** A matrix (a let name, `[[1, 1], [0, 1]]`, `\begin{pmatrix} 1 & 1 \\ 0 & 1 \end{pmatrix}`) or a map: `z \mapsto z^2`, `(x, y) \mapsto (x + y, y)`. */
    map: string;
}

/** The lines through 0 along the real eigenvectors of a matrix, with λ as labels. Text: `draw the eigenvectors of A, labelled`. */
export interface EigenvectorsTool extends ToolBase {
    type: 'eigenvectors';
    /** The matrix: a let name or a formula. */
    matrix: string;
    thickness: string;
    dashed: boolean;
    /** λ = ... beside each line. */
    valueLabel: boolean;
}

/**
 * The unit square (in 3D the unit cube), shaded: transforms after it move
 * it, and its label follows. `image`: the image of the unit square under
 * the transforms before it. Text: `shade the unit square, labelled "det A = {det(A)}"`,
 * `shade the image of the unit square, labelled`.
 */
export interface UnitSquareTool extends ToolBase {
    type: 'unitSquare';
    image: boolean;
    fillOpacity: number;
    /** Template at its middle; locals area (signed) and det. '' = none. */
    label: string;
    /** Its area (volume) now as the label (when `label` is empty). */
    valueLabel: boolean;
}

/** The span of vectors: a line through 0, the whole plane (shaded) or 0. Text: `draw the span of v and w`. */
export interface SpanTool extends ToolBase {
    type: 'span';
    /** The vectors, `;` between them: names or formulas. */
    vectors: string;
    fillOpacity: number;
    thickness: string;
    /** span(v, w) as the label. */
    valueLabel: boolean;
}

// 6.0 E: iterate and colour the plane (src/iterate/).

/**
 * The orbit of a recurrence z_{n+1} = F(z_n), from z_0, as its points
 * joined by lines: complex numbers and 2D vectors in the plane, numbers as
 * (n, x_n). The start and the names F reads (`c = P`) may be points tools,
 * so dragging P moves the orbit. Publishes OR1_n and OR1_x, OR1_y (the last
 * point).
 */
export interface OrbitTool extends ToolBase {
    type: 'orbit';
    /** The recurrence: `z_{n+1} = z_n^2 + c`, `p_{n+1} = p_n - \eta \nabla f(p_n)` (LaTeX allowed). */
    recurrence: string;
    /** z_0: a formula, a point `(1, 2)` or a points tool `P`. */
    start: string;
    /** The names F reads, `c = P; eta = 0.1` (a formula, a point or a points tool each). */
    given: string;
    /** How many steps (a formula; at most 2000). */
    steps: string;
    /** Lines only, no dots. */
    path: boolean;
    size: MarkerSize;
    thickness: string;
    /** The first points labelled z_0, z_1, ... */
    valueLabel: boolean;
    // 6.0 F4
    /** It draws itself step by step with a dot at its head, then starts again (the export draws it whole). */
    traced?: boolean;
    /** How fast it draws itself, times the usual (`speed 2`). */
    speed?: number;
}

/**
 * The cobweb of x_{n+1} = f(x_n) from x_0: the line y = x, the graph of the
 * map, and the path (x_0, 0), (x_0, x_1), (x_1, x_1), (x_1, x_2), ...
 * Publishes CW1_x (the last x_n).
 */
export interface CobwebTool extends ToolBase {
    type: 'cobweb';
    recurrence: string;
    start: string;
    steps: string;
    thickness: string;
}

/**
 * The bifurcation diagram of x_{n+1} = F(x_n, r) for r from a to b: for
 * each r on the x-axis, where the orbit of x_0 settles (after a run-in), as
 * a pixel picture.
 */
export interface BifurcationTool extends ToolBase {
    type: 'bifurcation';
    recurrence: string;
    /** The name of the parameter on the x-axis: r. */
    parameter: string;
    from: string;
    to: string;
    /** x_0 (0.5 by default). */
    start: string;
}

/**
 * Newton's method for a function f of the chart from x_0: each tangent
 * down to the x-axis, the lines up to the graph, the points x_0, x_1, ...
 * Publishes NM1_x (the last x_k) and NM1_val (f there).
 */
export interface NewtonTool extends ToolBase {
    type: 'newton';
    /** Name of the function (a cartesian function of the chart). */
    function: string;
    start: string;
    steps: string;
    thickness: string;
    /** The points labelled x_0, x_1, ... */
    valueLabel: boolean;
}

/** The colour maps of a coloured plane: the six of surfaces and one that goes round (for fractals). */
export type PlaneColormap = Colormap | 'cyclic';

/**
 * The plane coloured pixel by pixel: by the orbit of a recurrence (escape
 * time; orbits that settle take the colour of the point they reach), by a
 * function of z (domain colouring: hue = arg, bands = log |f|) or by a real
 * function of x and y (a heat map through a colour map).
 */
export interface PlaneColourTool extends ToolBase {
    type: 'colourPlane';
    /** `z_{n+1} = z_n^2 + c`, `f(z) = \frac{z^2 - 1}{z^2 + 1}`, `f(x, y) = x^2 - y^2` (LaTeX allowed). */
    formula: string;
    /** z_0 of a recurrence ('' = 0). */
    start: string;
    /** The names the recurrence reads, `c = x + iy`. */
    given: string;
    /** Steps of a recurrence (a formula; at most 1000). */
    steps: string;
    /** The colour map (absent: cyclic for a recurrence, viridis for a heat map; domain colouring has none). */
    colormap?: PlaneColormap;
    opacity: number;
}

/**
 * The turning circles of a sum of rotations, \sum_{k=1}^{n} c_k e^{i w_k t}:
 * each term a circle on the tip of the one before, turning on the animation
 * clock, the curve the last tip draws, and (with its wave) the imaginary
 * part over time to the right. The export draws a still frame.
 */
export interface FourierCirclesTool extends ToolBase {
    type: 'fourierCircles';
    /** A sum in t: `\sum_{k=1}^{n} \frac{4}{\pi (2k - 1)} e^{i(2k - 1)t}`. */
    sum: string;
    wave: boolean;
    thickness: string;
    // 6.0 F4
    /** How fast the circles turn, times the usual (`speed 2`). */
    speed?: number;
    // 6.0 P
    /** How many circles of a list of coefficients (a formula: a slider n); absent: all of them (at most 400). */
    count?: string;
    /** The path the tip draws, in the colour of the circles (`with its path`). */
    path?: boolean;
}

// 6.0 P
/**
 * A Python script (src/python/): `python:` and its indented lines. The
 * names it sets are values of the chart (as let lines); its matplotlib
 * calls draw; `def frame(t)` draws on the clock. Several blocks run in
 * order and share one scope.
 */
export interface PythonTool extends ToolBase {
    type: 'python';
    /** The script, without the indent of the block (lines joined by \n). */
    code: string;
}

// 6.0 G: GeoGebra input lines (src/geogebra/).

/**
 * A GeoGebra input line as a chart object: `A = (1, 2)`, `c = Circle(A, 3)`,
 * `L = Sequence((k, k^2), k, 1, 10)`, a bare `Polygon(A, B, C)`. What its
 * command or value is decides what it draws, in GeoGebra's default look
 * (src/geogebra/objects.ts); the line prints back as written. A named
 * value (a point, a number, a list, a matrix, a function of x) is usable
 * by name in every formula of the chart, as a let name is.
 */
export interface GeoGebraTool extends ToolBase {
    type: 'geogebra';
    /** The text after `name =` (or the bare command), as written: `Circle(A, 3)`, `(1, 2)`, `{{1, 2}, {3, 4}}`. */
    command: string;
    /** Written with its name (`A = ...`); false for a bare command (named G1, G2, ...). */
    named: boolean;
    /** '' = GeoGebra's colour for what it draws (free points blue, polygons brown, the rest black). */
    color: string;
    /** '' = GeoGebra's ('thick'). */
    thickness: string;
    dashed: boolean;
    /** '' = GeoGebra's ('normal'; 'small' for lists of more than 100 points). */
    size: MarkerSize | '';
    /** Fill of a polygon or a circle, 0..1; -1 = GeoGebra's (0.1 for polygons, none for circles). */
    fillOpacity: number;
    /** Its name as a label: 'auto' = GeoGebra's (named points), 'shown', 'hidden'. */
    nameLabel: 'auto' | 'shown' | 'hidden';
    /** A label template instead of the name ('' = none). */
    label: string;
}

export type Tool =
    | RegionTool
    | CurveTool
    | PointsTool
    | SegmentTool
    | PlaneTool
    | DataTool
    | DataPlotTool
    | DistributionTool
    | ProbabilityTool
    | RiemannTool
    | SlopeFieldTool
    | SolutionTool
    // 6.0 C
    | VectorFieldTool
    | RestPointsTool
    | TrajectoryTool
    // 6.0 B
    | AxisSetTool
    | ChordTool
    // 6.0 A
    | ValueTool
    | VectorTool
    | ListPointsTool
    // 6.0 D
    | PlaneGridTool
    | BasisVectorsTool
    | TransformTool
    | EigenvectorsTool
    | UnitSquareTool
    | SpanTool
    // 6.0 E
    | OrbitTool
    | CobwebTool
    | BifurcationTool
    | NewtonTool
    | PlaneColourTool
    | FourierCirclesTool
    // 6.0 G
    | GeoGebraTool
    // 6.0 P
    | PythonTool;

export type ToolType = Tool['type'];

export interface RendererConfig {
    width: number;
    height: number;
    coordinateSystem: CoordinateSystem;
    /** Resolved numeric view (see `resolveView` in settings.ts). */
    xmin: number;
    xmax: number;
    ymin: number;
    ymax: number;
    title: string;
    xLabel: string;
    yLabel: string;
    showAxisLabels: boolean;
    /** Draw the axes, their numbers and names (chart field showAxis; `no axes` sets false). Absent: true. */
    showAxis?: boolean;
    axisStyle: AxisStyle;
    gridMajor: boolean;
    gridMinor: boolean;
    /** Opacity of the major grid lines, 0..1 (minor lines draw at half); chart field `gridOpacity`. */
    gridOpacity: number;
    /** The numbers on each axis (src/ticks.ts): Auto, Every a step, At chosen values, or Off. */
    numbers: Record<TickAxis, AxisNumbers>;
    minorTickNum: number;
    majorTickNum: number;
    functions: FunctionParameters[];
    annotations: Annotation[];
    /** Already migrated (v4 shapes only). */
    tools: Tool[];
    parameters: Parameter[];
    /** Axis variable names, e.g. 'x, y' (default) or 'x1, x2'. */
    variables: string;
    /** Same units on both axes (letterboxed plot area). Always on in polar mode. */
    equalScale: boolean;
    is3D: boolean;
    zmin: number;
    zmax: number;
    zLabel: string;
    rotationX: number;
    rotationZ: number;
    /** Multiplier on the 3D camera scale. 1.0 is the default fit-to-viewport. */
    zoom3D: number;
    /** 3D bounding-box aspect: 'true' (data-proportional), 'equal' (cube) or 'custom' (the lengths of boxRatio). */
    boxAspect: BoxAspect;
    /** With boxAspect 'custom': the lengths of the box edges, x : y : z. */
    boxRatio?: number[];
    functions3D: Function3DParameters[];
    /** Paper size of the exported figure in cm (clamped 1..100); the preview typesets its text at this scale. */
    paperWidthCm?: number;
    paperHeightCm?: number;
    // 6.0 C
    /** The animation clock and the step shown (src/motion6/clock.ts); absent: the still frame of the export. */
    motion?: MotionFrame;
    // 6.0 F4
    /** Degrees the 3D view has turned by itself (chart line `turning`), added to rotationZ in notes and the editor; absent: 0. */
    turn?: number;
    // 6.1
    /** The look it is drawn in (src/look.ts); absent: Classic. axisStyle and gridMajor are already the look's where the chart leaves them open. */
    look?: ChartLook;
}

// 6.0 C
/**
 * What moves in one frame of a chart (src/motion6/clock.ts): the clock's
 * time, the step shown and how far it has come in. Scene code reads it
 * through stepProgress and clockTime; the export always draws the still frame.
 */
export interface MotionFrame {
    /** Seconds on the animation clock (the still frame: the chart's stillTime, else 0). */
    time: number;
    /** The step shown: objects of later steps are hidden. Infinity: every step (the last one). */
    step: number;
    /** How far the shown step has come in, 0..1 (1: settled). */
    progress: number;
    // 6.0 entrances (src/motion6/entrances.ts, timeline.ts)
    /** The number of the step shown, also when it is the last one (`step` is Infinity there); absent: the still frame. */
    index?: number;
    /** ms since the step shown started to come in, while its objects enter; absent: they stand. */
    enter?: number;
    /** Previous: how far the objects of the step shown have faded out, 0..1; absent: not leaving. */
    leave?: number;
}
