/**
 * Function templates: pre-baked expressions, domains, and color hints that
 * the user can drop into a function card with one click. Plus a small
 * persistence layer for user-defined templates.
 */

export interface Template2D {
    name: string;
    expression: string;
    domain: string;
    color?: string;
}

export interface Template3D {
    name: string;
    expression: string;
    xDomain: string;
    yDomain: string;
    color?: string;
}

export const BUILT_IN_2D: Template2D[] = [
    { name: 'Parabola', expression: 'x^2', domain: '-3:3', color: 'black' },
    { name: 'Cubic', expression: 'x^3 - 3*x', domain: '-2:2', color: 'blue' },
    { name: 'Sine wave', expression: 'sin(x)', domain: '0:2*PI', color: 'blue' },
    { name: 'Cosine', expression: 'cos(x)', domain: '0:2*PI', color: 'teal' },
    { name: 'Damped oscillation', expression: 'sin(x) * exp(-x/5)', domain: '0:20', color: 'purple' },
    { name: 'Gaussian', expression: 'exp(-x^2)', domain: '-3:3', color: 'green' },
    { name: 'Logistic', expression: '1 / (1 + exp(-x))', domain: '-6:6', color: 'teal' },
    { name: 'Hyperbola', expression: '1 / x', domain: '0.1:5', color: 'orange' },
    { name: 'Tangent (clipped)', expression: 'tan(x)', domain: '-1.5:1.5', color: 'red' },
    { name: 'Upper half-circle', expression: 'sqrt(1 - x^2)', domain: '-1:1', color: 'teal' },
];

export const BUILT_IN_3D: Template3D[] = [
    { name: 'Ripple', expression: 'sin(sqrt(x^2 + y^2))', xDomain: '-6:6', yDomain: '-6:6', color: 'blue' },
    { name: 'Paraboloid', expression: 'x^2 + y^2', xDomain: '-3:3', yDomain: '-3:3', color: 'teal' },
    { name: 'Saddle', expression: 'x*y', xDomain: '-3:3', yDomain: '-3:3', color: 'orange' },
    { name: 'Gaussian bump', expression: 'exp(-(x^2 + y^2) / 4)', xDomain: '-3:3', yDomain: '-3:3', color: 'green' },
    { name: 'Wave interference', expression: 'cos(x) + sin(y)', xDomain: '-6:6', yDomain: '-6:6', color: 'purple' },
    { name: 'Pringle', expression: 'x^2 - y^2', xDomain: '-3:3', yDomain: '-3:3', color: 'red' },
];

export interface UserTemplate {
    name: string;
    is3D: boolean;
    expression: string;
    domain?: string;
    xDomain?: string;
    yDomain?: string;
    color?: string;
}

export interface PluginData {
    userTemplates: UserTemplate[];
    /**
     * When true, vertical drag in the 3D preview is inverted: dragging
     * down tilts the camera DOWN (lowers elevation), dragging up tilts
     * the camera UP (raises elevation). When false (default), it's the
     * trackball convention: drag down tilts the scene up (raises
     * elevation).
     */
    invertDrag3D: boolean;
    /**
     * Upper bound of the Samples slider on each 3D surface card.
     * Default 80. Higher values let you draw smoother surfaces but
     * each step doubles the grid cells, so the preview will slow.
     */
    maxSamples3D: number;
    /**
     * When true, the plugin also renders blocks tagged plain `tikz`
     * (not just `easy-tikz`). Off by default to avoid conflicting
     * with `obsidian-tikzjax` and other plugins that claim the same
     * code-block language.
     */
    renderTikzBlocks: boolean;
    /**
     * Multiplier on the 2D drag-pan rate. 1.0 (default) is direct
     * manipulation - moving the mouse by N pixels pans the chart by
     * exactly N chart pixels. Lower values dampen the drag for finer
     * control (e.g. 0.5 = half-step panning); higher values overshoot.
     * The pan amount also scales with the current axis range so the
     * multiplier feels consistent regardless of zoom level.
     */
    dragSensitivity2D: number;
}

export const DEFAULT_PLUGIN_DATA: PluginData = {
    userTemplates: [],
    invertDrag3D: false,
    maxSamples3D: 80,
    renderTikzBlocks: false,
    dragSensitivity2D: 1.0,
};
