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
