export interface FunctionParameters {
    expression: string;
    domain: string;
    showLegend: boolean;
    fill: boolean;
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
    is3D: boolean;
    zmin: number;
    zmax: number;
    zLabel: string;
    rotationX: number;
    rotationZ: number;
    functions3D: Function3DParameters[];
}
