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

export interface FunctionParameters {
    expression: string;
    domain: string;
    showLegend: boolean;
    fill: boolean;
    fillOpacity: number;
    fillPattern: FillPattern;
    tangent: boolean;
    color: string;
    dashed: boolean;
    tangentPoint: string;
    extrema: boolean;
    thickness: string;
    /** When true, `expression` is x(t) and `expressionY` is y(t). Domain is t-range. */
    parametric: boolean;
    expressionY: string;
    /**
     * Optional user-readable name (e.g. "f", "g", "left curve"). Tools
     * reference functions by name. Auto-defaulted in the modal to
     * "f1", "f2", … when blank.
     */
    name?: string;
}

export interface TikzSetting {
    id: string;
    name: string;
    description: string;
    category: 'basic' | 'axis' | 'function' | 'shapes' | 'grid' | 'style' | 'other';
    type: 'toggle' | 'text' | 'slider' | 'dropdown' | 'color';
    defaultValue: any;
    options?: string[];
    min?: number;
    max?: number;
    step?: number;
    insertText: (value: any) => string;
}

export interface DynamicFunctionSetting extends TikzSetting {
    values: FunctionParameters[];
}

export interface DynamicTikzSetting extends TikzSetting {
    values?: string[];
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
}

export interface Annotation {
    x: string;
    y: string;
    z?: string;
    text: string;
    color: string;
    size: AnnotationSize;
    anchor: AnnotationAnchor;
}

export type CoordinateSystem = 'cartesian' | 'polar';

export type AxisStyle = 'box' | 'middle' | 'axes';

/**
 * 3D bounding-box aspect ratio.
 * - 'true': box edges scale with the data ranges (xmax-xmin, ymax-ymin,
 *   zmax-zmin). Faithful to the data, but can look stretched if one
 *   axis spans a much wider range than the others.
 * - 'equal': each axis is normalized to a unit length, so the bounding
 *   box is a perfect cube on screen regardless of the data ranges.
 *   Equivalent to pgfplots' `axis equal image`.
 */
export type BoxAspect = 'true' | 'equal';

export type ArrowStyle = 'none' | 'forward' | 'backward' | 'both';

/**
 * Discriminated union of "tools" - overlays that either reference
 * existing functions by name (areaBetween, intersection) or stand
 * alone (reference lines, free shapes, 3D plane / point / segment).
 *
 * Coordinate fields are kept as strings (matching xmin/xmax /
 * annotations) so users can write expressions like `pi/2` or
 * `2*sqrt(3)` and have them parsed at render time.
 */
export type Tool =
    | {
          type: 'areaBetween';
          func1Name: string;
          func2Name: string;
          domain: string;
          color: string;
          fillOpacity: number;
          fillPattern: FillPattern;
      }
    | {
          type: 'intersection';
          func1Name: string;
          func2Name: string;
          color: string;
          showLabels: boolean;
      }
    | {
          type: 'verticalLine';
          x: string;
          color: string;
          thickness: string;
          dashed: boolean;
          label: string;
      }
    | {
          type: 'horizontalLine';
          y: string;
          color: string;
          thickness: string;
          dashed: boolean;
          label: string;
      }
    | {
          type: 'rectangle';
          x1: string;
          y1: string;
          x2: string;
          y2: string;
          color: string;
          thickness: string;
          fill: boolean;
          fillOpacity: number;
          fillPattern: FillPattern;
      }
    | {
          type: 'circle';
          cx: string;
          cy: string;
          r: string;
          color: string;
          thickness: string;
          fill: boolean;
          fillOpacity: number;
          fillPattern: FillPattern;
      }
    | {
          type: 'segment';
          x1: string;
          y1: string;
          x2: string;
          y2: string;
          color: string;
          thickness: string;
          dashed: boolean;
          arrow: ArrowStyle;
      }
    | {
          type: 'brace';
          x1: string;
          y1: string;
          x2: string;
          y2: string;
          color: string;
          label: string;
      }
    | {
          type: 'plane3D';
          axis: 'x' | 'y' | 'z';
          value: string;
          color: string;
          fillOpacity: number;
      }
    | {
          type: 'point3D';
          x: string;
          y: string;
          z: string;
          color: string;
          label: string;
      }
    | {
          type: 'segment3D';
          x1: string;
          y1: string;
          z1: string;
          x2: string;
          y2: string;
          z2: string;
          color: string;
          thickness: string;
          dashed: boolean;
          arrow: ArrowStyle;
      };

export type ToolType = Tool['type'];

export interface RendererConfig {
    width: number;
    height: number;
    coordinateSystem: CoordinateSystem;
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
    tools: Tool[];
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
}
