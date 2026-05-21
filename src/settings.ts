import { TikzSetting, FunctionParameters, Function3DParameters } from './types';
import { MathHelper } from './math';

export const TIKZ_SETTINGS: TikzSetting[] = [
    // Basic Settings
    {
        id: 'dimension',
        name: '3D',
        description: 'Whether the graph is in 2D or 3D',
        category: 'basic',
        type: 'toggle',
        defaultValue: false,
        insertText: () => '',
    },
    {
        id: 'documentSetup',
        name: 'Use pgfplots',
        description: 'Whether to include pgfplots package',
        category: 'basic',
        type: 'toggle',
        defaultValue: true,
        insertText: (value) =>
            value
                ? '\n\\usepackage{pgfplots}\n\\pgfplotsset{compat=1.16}\n\\begin{document}\n\\begin{tikzpicture}\n \n\\begin{axis}['
                : '\n\\begin{document}\n\\begin{tikzpicture}\n ',
    },
    {
        id: 'title',
        name: 'Title',
        description: 'Name displayed above graph',
        category: 'basic',
        type: 'text',
        defaultValue: 'My graph: \\(\\sum\\)',
        insertText: (value) => `\n  title={${value}},`,
    },
    {
        id: 'size_x_cm',
        name: 'Width',
        description: 'The width of the final image in cm',
        category: 'basic',
        type: 'slider',
        defaultValue: 10,
        min: 1,
        max: 20,
        step: 1,
        insertText: (value) => `\n  width={${value}cm},`,
    },
    {
        id: 'size_y_cm',
        name: 'Height',
        description: 'The height of the final image in cm',
        category: 'basic',
        type: 'slider',
        defaultValue: 10,
        min: 1,
        max: 20,
        step: 1,
        insertText: (value) => `\n  height={${value}cm},`,
    },
    {
        id: 'show_axis_label',
        name: 'Show axis labels',
        description: 'Whether to show labels for axes',
        category: 'axis',
        type: 'toggle',
        defaultValue: true,
        insertText: () => '\n',
    },
    {
        id: 'axis_label_x',
        name: 'X-Axis Label',
        description: 'Label for the x-axis',
        category: 'axis',
        type: 'text',
        defaultValue: 'x',
        insertText: (value) => `\n  xlabel={${value}},`,
    },
    {
        id: 'axis_label_y',
        name: 'Y-Axis Label',
        description: 'Label for the y-axis',
        category: 'axis',
        type: 'text',
        defaultValue: 'y',
        insertText: (value) => `\n  ylabel={${value}},`,
    },
    {
        id: 'documentClose',
        name: 'Document Close',
        description: 'Include document closing',
        category: 'basic',
        type: 'toggle',
        defaultValue: true,
        insertText: (value) => (value ? '\n\\end{axis}\n\\end{tikzpicture}\n\\end{document}' : ''),
    },

    // Axis Settings
    {
        id: 'showAxis',
        name: 'Show Axes',
        description: 'Display coordinate axes',
        category: 'axis',
        type: 'toggle',
        defaultValue: true,
        insertText: () => '',
    },

    // Grid Settings
    {
        id: 'showLargeGrid',
        name: 'Show major grid',
        description: 'Display major coordinate grid',
        category: 'grid',
        type: 'toggle',
        defaultValue: false,
        insertText: (value) => (value ? '\n   grid=major,' : '\n'),
    },
    {
        id: 'showSmallGrid',
        name: 'Show minor grid',
        description: 'Display minor coordinate grid',
        category: 'grid',
        type: 'toggle',
        defaultValue: false,
        insertText: (value) => (value ? '\n grid=both,' : ''),
    },
    {
        id: 'gridSize',
        name: 'Grid subdivisions',
        description: 'Number of minor tick subdivisions',
        category: 'grid',
        type: 'slider',
        defaultValue: 5,
        min: 1,
        max: 10,
        step: 1,
        insertText: (value) => `\n  minor tick num=${value},`,
    },
    {
        id: 'xmin',
        name: 'X-Axis Min',
        description: 'Minimum value for x-axis',
        category: 'axis',
        type: 'text',
        defaultValue: '-0.5',
        insertText: (value) => `\n  xmin=${value},`,
    },
    {
        id: 'xmax',
        name: 'X-Axis Max',
        description: 'Maximum value for x-axis',
        category: 'axis',
        type: 'text',
        defaultValue: '10',
        insertText: (value) => `\n  xmax=${value},`,
    },
    {
        id: 'ymin',
        name: 'Y-Axis Min',
        description: 'Minimum value for y-axis',
        category: 'axis',
        type: 'text',
        defaultValue: '-0.5',
        insertText: (value) => `\n  ymin=${value},`,
    },
    {
        id: 'ymax',
        name: 'Y-Axis Max',
        description: 'Maximum value for y-axis',
        category: 'axis',
        type: 'text',
        defaultValue: '5',
        insertText: (value) => `\n  ymax=${value},`,
    },
    {
        id: 'axis_style',
        name: 'Axis style',
        description: 'Box (all around), Middle (crossing at origin), or Axes (L-shape at lower-left)',
        category: 'axis',
        type: 'dropdown',
        defaultValue: 'box',
        options: ['box', 'middle', 'axes'],
        insertText: (value) => {
            switch (value) {
                case 'middle': return ' \n  axis lines = middle,\n]';
                case 'axes': return ' \n  axis lines = left,\n]';
                case 'box':
                default: return '\n]';
            }
        },
    },
    {
        id: 'functions',
        name: 'Functions',
        description: 'Add mathematical functions to plot',
        category: 'function',
        type: 'text',
        defaultValue: [],
        insertText: (values: FunctionParameters[]) => {
            const patternFor = (p?: string): string => {
                switch (p) {
                    case 'horizontal': return 'horizontal lines';
                    case 'vertical': return 'vertical lines';
                    case 'crosshatch': return 'crosshatch';
                    case 'dots': return 'crosshatch dots';
                    case 'north-east': return 'north east lines';
                    case 'north-west': return 'north west lines';
                    default: return '';
                }
            };
            return values
                .map((func) => {
                    let style = [];
                    if (func.dashed) style.push('dashed');
                    if (func.fill) {
                        const opacity = typeof func.fillOpacity === 'number' ? func.fillOpacity : 0.15;
                        const pattern = patternFor(func.fillPattern);
                        if (pattern) {
                            style.push(`fill=${func.color}, fill opacity=${opacity}, pattern=${pattern}, pattern color=${func.color}`);
                        } else {
                            style.push(`fill=${func.color}, fill opacity=${opacity}`);
                        }
                    }
                    style.push(`${func.color}`);
                    style.push(`${func.thickness}`);

                    let code = `\n\\addplot[domain=${func.domain}, ${style.join(',')}, samples=300] {${func.expression}};`;
                    if (func.showLegend) {
                        code += `\n\\addlegendentry{\\(${func.expression}\\)}`;
                    }

                    if (func.tangent && func.tangentPoint) {
                        try {
                            const domain = MathHelper.parseDomain(func.domain);
                            const tangentX = MathHelper.parseTangentPoint(func.tangentPoint, domain);
                            const tangentExpression = MathHelper.calculateTangentLine(func.expression, tangentX);
                            code += `\n\\addplot[${func.color}, dashed, domain=${func.domain}] {${tangentExpression}};`;
                            const ty = MathHelper.evaluateExpression(func.expression, tangentX);
                            code += `\n\\addplot[${func.color}, only marks] coordinates {(${tangentX},${ty})};`;
                        } catch {
                            // Bad tangent input; omit the tangent annotation from the generated code.
                        }
                    }

                    if (func.extrema) {
                        try {
                            const extremaPoints = MathHelper.findExtrema(func.expression, func.domain);
                            if (extremaPoints.length > 0) {
                                const coordinates = extremaPoints.map((point) => `(${point.x},${point.y})`).join(' ');
                                code += `\n\\addplot[${func.color}, only marks, mark=*, mark size=4pt] coordinates {${coordinates}};`;
                                extremaPoints.forEach((point) => {
                                    if (point.type === 'minimum')
                                        code += `\n\\node[below] at (axis cs:${point.x},${point.y - 1}) {${point.type}};`;
                                    if (point.type === 'maximum')
                                        code += `\n\\node[above] at (axis cs:${point.x},${point.y + 1}) {${point.type}};`;
                                });
                            }
                        } catch {
                            // Extrema search failed; omit the annotation.
                        }
                    }
                    return code;
                })
                .join('\n');
        },
    },
];

/**
 * Holds the live setting values for the modal and generates TikZ/pgfplots
 * code from them. Wraps a `Map<string, unknown>` so both 2D and 3D modes can
 * share storage without a sprawling typed schema.
 */
export class SettingsManager {
    private values: Map<string, unknown>;

    constructor() {
        this.values = new Map();
        TIKZ_SETTINGS.forEach((setting) => {
            this.values.set(setting.id, setting.defaultValue);
        });
        // 3D-specific defaults (the 3D UI is built directly in the modal rather than driven by TIKZ_SETTINGS).
        this.values.set('zmin', '-5');
        this.values.set('zmax', '5');
        this.values.set('axis_label_z', 'z');
        this.values.set('rotationX', 30);
        this.values.set('rotationZ', 45);
        this.values.set('zoom3D', 1);
        this.values.set('functions3D', []);
        // Grid density (live preview only; pgfplots picks its own ticks unless told otherwise).
        this.values.set('majorTickNum', 8);
        // Live preview width in pixels. Height follows the size_y_cm / size_x_cm ratio.
        this.values.set('previewSize', 760);
        // Annotations: text labels at arbitrary (x, y[, z]) coordinates.
        this.values.set('annotations', []);
        // Coordinate system for 2D plots. Polar treats the expression as r(theta).
        this.values.set('coordinateSystem', 'cartesian');
        // Separate axis labels for polar mode so toggling Cartesian <-> Polar
        // doesn't trample the user's customised cartesian labels.
        this.values.set('axis_label_x_polar', '');
        this.values.set('axis_label_y_polar', '');
    }

    /** Look up the value for a setting id. Returns `undefined` if absent. */
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    getValue<T = any>(id: string): T {
        return this.values.get(id) as T;
    }

    /** Store a value for a setting id. Callers are responsible for type safety. */
    setValue(id: string, value: unknown) {
        this.values.set(id, value);
    }

    generateTikzCode(): string {
        const isPolar = this.getValue('coordinateSystem') === 'polar';
        let code = '';

        const setupSetting = TIKZ_SETTINGS.find((s) => s.id === 'documentSetup');
        if (setupSetting && this.getValue('documentSetup')) {
            code += setupSetting.insertText(true);
        }

        TIKZ_SETTINGS.forEach((setting) => {
            if (setting.id === 'documentSetup' || setting.id === 'documentClose') return;
            if (setting.id === 'gridSize' && !this.getValue('showSmallGrid')) return;
            if ((setting.id === 'axis_label_x' || setting.id === 'axis_label_y') && !this.getValue('show_axis_label'))
                return;
            // In polar mode, swap the X/Y label values for the polar-specific
            // ones so the user's cartesian labels stay untouched.
            if (setting.id === 'axis_label_x' && isPolar) {
                code += setting.insertText(this.getValue('axis_label_x_polar') ?? '');
                return;
            }
            if (setting.id === 'axis_label_y' && isPolar) {
                code += setting.insertText(this.getValue('axis_label_y_polar') ?? '');
                return;
            }
            // Functions are emitted by our own per-function method so polar and
            // parametric branches stay in one place.
            if (setting.id === 'functions') {
                code += this.generate2DFunctionsCode(isPolar);
                return;
            }
            // Inject `axis equal,` so the polar plot stays circular. Only
            // matters when at least one function is non-parametric (polar
            // coordinate system applies). Parametric plots already fix their
            // own coordinates so it does no harm.
            if (setting.id === 'axis_style' && isPolar) {
                code += '\n  axis equal,';
            }
            code += setting.insertText(this.getValue(setting.id));
        });

        // Annotations live inside the axis environment, after functions.
        code += this.generateAnnotationsCode(false);

        const closeSetting = TIKZ_SETTINGS.find((s) => s.id === 'documentClose');
        if (closeSetting && this.getValue('documentClose')) {
            code += closeSetting.insertText(true);
        }

        return code;
    }

    /**
     * Emit each 2D function with the right code path:
     *  - parametric → `\addplot[parametric, domain=...] ({x(t)}, {y(t)})`
     *  - polar mode (non-parametric) → `\addplot[...] ({r*cos(deg(\t))}, {r*sin(deg(\t))})`
     *  - otherwise → reuse the original cartesian code (with tangent/extrema).
     * Parametric beats polar at the per-function level.
     */
    private generate2DFunctionsCode(isPolar: boolean): string {
        const funcs: FunctionParameters[] = this.getValue('functions') || [];
        let out = '';
        for (const func of funcs) {
            if (!func.expression || !func.domain) continue;
            if (func.parametric) {
                if (!func.expressionY) continue;
                const styleParts: string[] = [];
                if (func.dashed) styleParts.push('dashed');
                styleParts.push(func.color);
                styleParts.push(func.thickness);
                out += `\n\\addplot[parametric, domain=${func.domain}, ${styleParts.join(',')}, samples=300] ({${func.expression}}, {${func.expressionY}});`;
                if (func.showLegend) {
                    out += `\n\\addlegendentry{\\((${func.expression},\\ ${func.expressionY})\\)}`;
                }
            } else if (isPolar) {
                const expr = func.expression.replace(/\b(?:theta|x)\b/g, '\\t');
                const styleParts: string[] = [];
                if (func.dashed) styleParts.push('dashed');
                styleParts.push(func.color);
                styleParts.push(func.thickness);
                out += `\n\\addplot[domain=${func.domain}, variable=\\t, ${styleParts.join(',')}, samples=300] ({(${expr})*cos(deg(\\t))}, {(${expr})*sin(deg(\\t))});`;
                if (func.showLegend) {
                    out += `\n\\addlegendentry{\\(r = ${func.expression}\\)}`;
                }
            } else {
                // Cartesian non-parametric: reuse the original code path (which
                // also adds tangent and extrema annotations).
                const setting = TIKZ_SETTINGS.find((s) => s.id === 'functions');
                if (setting) out += setting.insertText([func]);
            }
        }
        return out;
    }

    toRendererConfig(): import('./types').RendererConfig {
        const previewSize = (this.getValue('previewSize') as number) || 760;
        const width = Math.max(320, Math.min(1600, Math.round(previewSize)));
        // Match the live preview aspect ratio to the configured cm dimensions
        // so the SVG roughly matches what pgfplots will render.
        const cmX = Math.max(1, parseFloat(this.getValue('size_x_cm')) || 10);
        const cmY = Math.max(1, parseFloat(this.getValue('size_y_cm')) || 10);
        const ratio = Math.max(0.35, Math.min(1.8, cmY / cmX));
        const height = Math.round(width * ratio);
        const isPolar = this.getValue('coordinateSystem') === 'polar';
        const xLabel = isPolar
            ? (this.getValue('axis_label_x_polar') ?? '')
            : (this.getValue('axis_label_x') || 'x');
        const yLabel = isPolar
            ? (this.getValue('axis_label_y_polar') ?? '')
            : (this.getValue('axis_label_y') || 'y');
        return {
            width,
            height,
            xmin: parseFloat(this.getValue('xmin')) || -0.5,
            xmax: parseFloat(this.getValue('xmax')) || 10,
            ymin: parseFloat(this.getValue('ymin')) || -0.5,
            ymax: parseFloat(this.getValue('ymax')) || 5,
            title: this.getValue('title') || '',
            xLabel,
            yLabel,
            showAxisLabels: this.getValue('show_axis_label') ?? true,
            axisStyle: (this.getValue('axis_style') as import('./types').AxisStyle) || 'box',
            gridMajor: this.getValue('showLargeGrid') ?? false,
            gridMinor: this.getValue('showSmallGrid') ?? false,
            minorTickNum: this.getValue('gridSize') ?? 5,
            majorTickNum: this.getValue('majorTickNum') ?? 8,
            functions: this.getValue('functions') || [],
            is3D: this.getValue('dimension') ?? false,
            zmin: parseFloat(this.getValue('zmin')) || -5,
            zmax: parseFloat(this.getValue('zmax')) || 5,
            zLabel: this.getValue('axis_label_z') || 'z',
            rotationX: this.getValue('rotationX') ?? 30,
            rotationZ: this.getValue('rotationZ') ?? 45,
            zoom3D: this.getValue('zoom3D') ?? 1,
            functions3D: this.getValue('functions3D') || [],
            annotations: this.getValue('annotations') || [],
            coordinateSystem: (this.getValue('coordinateSystem') as 'cartesian' | 'polar') || 'cartesian',
        };
    }

    generate3DTikzCode(): string {
        const funcs: Function3DParameters[] = this.getValue('functions3D') || [];
        let code = '';

        code += '\n\\usepackage{pgfplots}';
        code += '\n\\pgfplotsset{compat=1.16}';
        code += '\n\\begin{document}';
        code += '\n\\begin{tikzpicture}';
        code += '\n\\begin{axis}[';
        code += `\n  title={${this.getValue('title') || ''}},`;
        code += `\n  width={${this.getValue('size_x_cm') || 10}cm},`;
        code += `\n  height={${this.getValue('size_y_cm') || 10}cm},`;
        if (this.getValue('show_axis_label')) {
            code += `\n  xlabel={${this.getValue('axis_label_x') || 'x'}},`;
            code += `\n  ylabel={${this.getValue('axis_label_y') || 'y'}},`;
            code += `\n  zlabel={${this.getValue('axis_label_z') || 'z'}},`;
        }
        code += `\n  xmin=${this.getValue('xmin')}, xmax=${this.getValue('xmax')},`;
        code += `\n  ymin=${this.getValue('ymin')}, ymax=${this.getValue('ymax')},`;
        code += `\n  zmin=${this.getValue('zmin')}, zmax=${this.getValue('zmax')},`;
        code += '\n  view={' + (this.getValue('rotationZ') || 45) + '}{' + (this.getValue('rotationX') || 30) + '},';
        code += '\n]';

        for (const func of funcs) {
            if (!func.expression) continue;
            const surfType = func.wireframe ? 'mesh' : 'surf';
            const opacity = func.wireframe ? '' : `, opacity=${func.opacity}`;
            const samples = typeof func.samples === 'number' && func.samples > 0 ? func.samples : 30;
            code += `\n\\addplot3[${surfType}, domain=${func.xDomain}, y domain=${func.yDomain}, ${func.color}${opacity}, samples=${samples}] {${func.expression}};`;
        }

        code += this.generateAnnotationsCode(true);

        code += '\n\\end{axis}';
        code += '\n\\end{tikzpicture}';
        code += '\n\\end{document}';
        return code;
    }

    /**
     * Append `\node` commands for each annotation. Used by both the 2D and 3D
     * code generators. `is3D` controls whether the z coordinate is emitted.
     */
    generateAnnotationsCode(is3D: boolean): string {
        const annotations = (this.getValue('annotations') as import('./types').Annotation[]) || [];
        if (!annotations.length) return '';
        const anchorFor = (a: string): string => {
            switch (a) {
                case 'above': return 'south';
                case 'below': return 'north';
                case 'left': return 'east';
                case 'right': return 'west';
                default: return 'center';
            }
        };
        const sizeFor = (s: string): string => {
            switch (s) {
                case 'small': return 'font=\\footnotesize';
                case 'large': return 'font=\\large';
                default: return '';
            }
        };
        let out = '';
        for (const a of annotations) {
            if (!a.text) continue;
            const styles = [a.color, `anchor=${anchorFor(a.anchor)}`];
            const fontStyle = sizeFor(a.size);
            if (fontStyle) styles.push(fontStyle);
            const coord = is3D
                ? `(axis cs:${a.x},${a.y},${a.z ?? 0})`
                : `(axis cs:${a.x},${a.y})`;
            out += `\n\\node[${styles.join(', ')}] at ${coord} {${a.text}};`;
        }
        return out;
    }
}
