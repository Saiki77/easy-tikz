import type { AxisNumbers, TickAxis } from './ticks';

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

/**
 * A probability distribution: the density curve of a normal distribution,
 * or the bars of a binomial one at k = 0..n. Its fields are formulas, so
 * sliders work.
 */
export interface DistributionTool extends ToolBase {
    type: 'distribution';
    kind: 'normal' | 'binomial';
    /** Normal: mean and standard deviation (more than 0). */
    mean: string;
    sd: string;
    /** Binomial: number of trials (a whole number, 0 to 1000) and the probability of a success (0 to 1). */
    n: string;
    p: string;
    /** The density curve. */
    thickness: string;
    dashed: boolean;
    /** The binomial bars. */
    fillOpacity: number;
}

/**
 * A probability shaded: the area under a normal density between the bounds
 * of the event, or the binomial bars in range. Publishes PR1_val (the
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
    | TrajectoryTool;

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
}
