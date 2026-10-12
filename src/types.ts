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
}

export interface Function3DParameters {
    expression: string;
    xDomain: string;
    yDomain: string;
    color: string;
    wireframe: boolean;
    opacity: number;
    samples: number;
    /** Optional user-readable name. Mirrors `FunctionParameters.name`. */
    name?: string;
    hidden?: boolean;
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
 */
export type BoxAspect = 'true' | 'equal';

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

export type Tool = RegionTool | CurveTool | PointsTool | SegmentTool | PlaneTool;

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
    /** 3D bounding-box aspect: 'true' (data-proportional) or 'equal' (cube). */
    boxAspect: BoxAspect;
    functions3D: Function3DParameters[];
    /** Paper size of the exported figure in cm (clamped 1..100); the preview typesets its text at this scale. */
    paperWidthCm?: number;
    paperHeightCm?: number;
}
