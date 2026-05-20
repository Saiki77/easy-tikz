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

export interface RendererConfig {
    width: number;
    height: number;
    xmin: number;
    xmax: number;
    ymin: number;
    ymax: number;
    title: string;
    xLabel: string;
    yLabel: string;
    showAxisLabels: boolean;
    axisMiddle: boolean;
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
    functions3D: Function3DParameters[];
}
