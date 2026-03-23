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
        id: 'axis_allaround',
        name: 'Axis all around',
        description: 'Whether to have the axis go all around the graph',
        category: 'axis',
        type: 'toggle',
        defaultValue: true,
        insertText: (value) => (value ? '\n]' : ' \n  axis lines = middle,\n]'),
    },
    {
        id: 'functions',
        name: 'Functions',
        description: 'Add mathematical functions to plot',
        category: 'function',
        type: 'text',
        defaultValue: [],
        insertText: (values: FunctionParameters[]) => {
            return values
                .map((func) => {
                    let style = [];
                    if (func.dashed) style.push('dashed');
                    if (func.fill) style.push(`\nfill=${func.color}!20,\nfill opacity=0.3`);
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
                            const f = new Function('x', `return ${func.expression.replace(/\^/g, '**')}`);
                            code += `\n\\addplot[${func.color}, only marks] coordinates {(${tangentX},${f(tangentX)})};`;
                        } catch (error) {
                            console.error('Error calculating tangent:', error);
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
                        } catch (error) {
                            console.error('Error calculating extrema:', error);
                        }
                    }
                    return code;
                })
                .join('\n');
        },
    },
];

export class SettingsManager {
    private values: Map<string, any>;

    constructor() {
        this.values = new Map();
        TIKZ_SETTINGS.forEach((setting) => {
            this.values.set(setting.id, setting.defaultValue);
        });
        // 3D-specific defaults (not in TIKZ_SETTINGS since they have custom UI)
        this.values.set('zmin', '-5');
        this.values.set('zmax', '5');
        this.values.set('axis_label_z', 'z');
        this.values.set('rotationX', 30);
        this.values.set('rotationZ', 45);
        this.values.set('functions3D', []);
    }

    getValue(id: string): any {
        return this.values.get(id);
    }

    setValue(id: string, value: any) {
        this.values.set(id, value);
    }

    generateTikzCode(): string {
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
            code += setting.insertText(this.getValue(setting.id));
        });

        const closeSetting = TIKZ_SETTINGS.find((s) => s.id === 'documentClose');
        if (closeSetting && this.getValue('documentClose')) {
            code += closeSetting.insertText(true);
        }

        return code;
    }

    toRendererConfig(): import('./types').RendererConfig {
        return {
            width: 550,
            height: 400,
            xmin: parseFloat(this.getValue('xmin')) || -0.5,
            xmax: parseFloat(this.getValue('xmax')) || 10,
            ymin: parseFloat(this.getValue('ymin')) || -0.5,
            ymax: parseFloat(this.getValue('ymax')) || 5,
            title: this.getValue('title') || '',
            xLabel: this.getValue('axis_label_x') || 'x',
            yLabel: this.getValue('axis_label_y') || 'y',
            showAxisLabels: this.getValue('show_axis_label') ?? true,
            axisMiddle: !(this.getValue('axis_allaround') ?? true),
            gridMajor: this.getValue('showLargeGrid') ?? false,
            gridMinor: this.getValue('showSmallGrid') ?? false,
            minorTickNum: this.getValue('gridSize') ?? 5,
            functions: this.getValue('functions') || [],
            is3D: this.getValue('dimension') ?? false,
            zmin: parseFloat(this.getValue('zmin')) || -5,
            zmax: parseFloat(this.getValue('zmax')) || 5,
            zLabel: this.getValue('axis_label_z') || 'z',
            rotationX: this.getValue('rotationX') ?? 30,
            rotationZ: this.getValue('rotationZ') ?? 45,
            functions3D: this.getValue('functions3D') || [],
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
            code += `\n\\addplot3[${surfType}, domain=${func.xDomain}, y domain=${func.yDomain}, ${func.color}${opacity}, samples=30] {${func.expression}};`;
        }

        code += '\n\\end{axis}';
        code += '\n\\end{tikzpicture}';
        code += '\n\\end{document}';
        return code;
    }
}
