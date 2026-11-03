/*
 * Chart tab: view ranges, axes, grid, export size, note display and the 3D
 * camera. Everything here edits chart-level settings; ranges accept
 * expressions (`2*pi`, a slider name) and show the fallback errors that
 * settings.resolveView reports.
 */
import { MathContext, ValidateResult } from '../mathcontext';
import { RANGE_DEFAULTS, RangeKey, SettingsManager } from '../settings';
import { FieldHandle, PanelHost } from './host';
import { MessageKey, t } from '../i18n';
import { GRID_OPACITY, opacityValue } from '../opacity';
import {
    ChipHandle,
    ExprInputHandle,
    LiveSliderHandle,
    SegmentedHandle,
    TextInputHandle,
    chip,
    exprInput,
    field,
    formatDecimals,
    group,
    liveSlider,
    segmented,
    textButton,
    textInput,
} from './kit';

export interface ChartPanelOptions {
    /** Fit the ranges to the functions / surfaces (same as the preview's Fit button). */
    fit(): void;
    /** Back to the default ranges (same as the preview's Reset button). */
    reset(): void;
}

export interface ChartPanelHandle {
    el: HTMLElement;
    /** Rebuild every control from settings (chart loaded, 2D / 3D or polar switch). */
    refresh(): void;
    /** Re-read ranges, grid and camera values without rebuilding (pan, zoom, rotate, fit). */
    syncView(): void;
    /** True while a range field shows an error (tab error dot). */
    hasErrors(): boolean;
}

/** Axis variable names: a letter, then letters, digits and _ (as slider and function names). */
const NAME_RE = /^[A-Za-z][A-Za-z0-9_]*$/;

function str(v: unknown): string {
    if (typeof v === 'string') return v;
    if (typeof v === 'number' && Number.isFinite(v)) return String(v);
    return '';
}

function num(v: unknown, fallback: number): number {
    const n = typeof v === 'number' ? v : typeof v === 'string' ? parseFloat(v) : NaN;
    return Number.isFinite(n) ? n : fallback;
}

const percent = (v: number) => `${Math.round(v * 100)} %`;

/** What a taken name is, as the problem says it ('x1 is already a slider name.'). */
const TAKEN: Readonly<Record<'slider' | 'function' | 'surface' | 'tool', MessageKey>> = {
    slider: 'panels.chart.takenSlider',
    function: 'panels.chart.takenFunction',
    surface: 'panels.chart.takenSurface',
    tool: 'panels.chart.takenTool',
};

/** Names already taken by sliders, functions, surfaces and tools, with what they are. */
function takenNames(settings: SettingsManager): Map<string, keyof typeof TAKEN> {
    const taken = new Map<string, keyof typeof TAKEN>();
    const add = (list: unknown, what: keyof typeof TAKEN) => {
        if (!Array.isArray(list)) return;
        for (const item of list) {
            const name = item && typeof item === 'object' ? (item as { name?: unknown }).name : undefined;
            if (typeof name === 'string' && name && !taken.has(name)) taken.set(name, what);
        }
    };
    add(settings.getValue('parameters'), 'slider');
    add(settings.getValue('functions'), 'function');
    add(settings.getValue('functions3D'), 'surface');
    add(settings.getValue('tools'), 'tool');
    return taken;
}

/** Problem with an axis variables spec ('x1, x2'), or null when it is usable. */
function variablesProblem(spec: string, settings: SettingsManager): string | null {
    const parts = spec.split(/[,;\s]+/).filter((p) => p.length > 0);
    if (parts.length === 0) return null;
    if (parts.length !== 2) return t('panels.chart.variablesTwo');
    if (!parts.every((p) => NAME_RE.test(p))) return t('panels.chart.variablesRule');
    if (parts[0] === parts[1]) return t('panels.chart.variablesDiffer');
    const taken = takenNames(settings);
    for (const p of parts) {
        const what = taken.get(p);
        if (what) return t(TAKEN[what], { name: p });
    }
    return null;
}

export function createChartPanel(parent: HTMLElement, host: PanelHost, opts: ChartPanelOptions): ChartPanelHandle {
    const el = parent.createDiv({ cls: 'etz-chart-panel' });
    const settings = host.settings;

    let unregister: Array<() => void> = [];
    const ranges = new Map<RangeKey, ExprInputHandle>();
    let gridMajor: ChipHandle | null = null;
    let gridMinor: ChipHandle | null = null;
    let gridOpacity: LiveSliderHandle | null = null;
    let elevation: LiveSliderHandle | null = null;
    let azimuth: LiveSliderHandle | null = null;
    let axisStyle: SegmentedHandle<string> | null = null;

    const isPolar = () => settings.getValue('coordinateSystem') === 'polar';
    const xLabelKey = () => (isPolar() ? 'axis_label_x_polar' : 'axis_label_x');
    const yLabelKey = () => (isPolar() ? 'axis_label_y_polar' : 'axis_label_y');

    /** Validation of one bound: the expression itself, then the fallback resolveView reports for it. */
    const validateBound = (key: RangeKey, src: string): ValidateResult => {
        if (!src.trim()) return { ok: true };
        let math: MathContext;
        try {
            math = host.math();
        } catch (e) {
            return { ok: false, message: e instanceof Error ? e.message : String(e) };
        }
        const result = math.validate(src, 'value');
        if (!result.ok) return result;
        try {
            const hit = settings.resolveView(math).errors.find((e) => e.startsWith(key + ':'));
            if (hit) return { ok: false, message: hit.slice(key.length + 1).trim() };
        } catch {
            // resolveView problems surface in the status chip; the field text itself is valid.
        }
        return { ok: true };
    };

    const partnerOf = (key: RangeKey): RangeKey => (key.endsWith('min') ? (key.replace('min', 'max') as RangeKey) : (key.replace('max', 'min') as RangeKey));

    const rangeInput = (row: HTMLElement, key: RangeKey, label: string) => {
        const handle = exprInput(row, {
            value: str(settings.getValue(key)),
            label,
            placeholder: RANGE_DEFAULTS[key],
            cls: 'etz-range-input',
            validate: (src) => validateBound(key, src),
            onInput: (value) => {
                settings.setValue(key, value);
                host.requestUpdate();
                // min >= max is reported on either bound, so the partner may change state too.
                ranges.get(partnerOf(key))?.validate();
            },
            onAddParameter: (name) => {
                host.addParameter(name);
            },
        });
        ranges.set(key, handle);
        const fieldHandle: FieldHandle = {
            source: 'chart',
            field: key,
            validate: () => handle.validate(),
            focus: (selectText) => {
                host.showTab('chart');
                handle.input.scrollIntoView({ block: 'nearest' });
                handle.focus(selectText);
            },
        };
        unregister.push(host.registerField(fieldHandle));
    };

    const buildRanges = () => {
        const g = group(el, t('panels.chart.ranges'));
        const vars = String(settings.getValue('variables') ?? '')
            .split(/[,;\s]+/)
            .filter((p) => NAME_RE.test(p));
        const names = !host.is3D() && !isPolar() && vars.length === 2 && vars[0] !== vars[1] ? vars : ['x', 'y'];
        const axes: Array<{ axis: string; min: RangeKey; max: RangeKey }> = [
            { axis: names[0], min: 'xmin', max: 'xmax' },
            { axis: names[1], min: 'ymin', max: 'ymax' },
        ];
        if (host.is3D()) axes.push({ axis: 'z', min: 'zmin', max: 'zmax' });
        for (const a of axes) {
            const row = g.body.createDiv({ cls: 'etz-range-row' });
            row.createSpan({ cls: 'etz-range-axis', text: a.axis, attr: { 'aria-hidden': 'true' } });
            rangeInput(row, a.min, t('panels.chart.from', { axis: a.axis }));
            row.createSpan({ cls: 'etz-range-sep', text: t('panels.chart.rangeTo'), attr: { 'aria-hidden': 'true' } });
            rangeInput(row, a.max, t('panels.chart.to', { axis: a.axis }));
        }
        const hint = g.body.createDiv({ cls: 'etz-chart-hint' });
        hint.setText(t('panels.chart.rangesHint'));
        const buttons = g.body.createDiv({ cls: 'etz-chart-buttons' });
        textButton(buttons, { text: t('panels.chart.autoFit'), icon: 'maximize-2', size: 'sm', onClick: () => opts.fit() });
        textButton(buttons, { text: t('common.reset'), icon: 'rotate-ccw', size: 'sm', onClick: () => opts.reset() });
    };

    const labelInput = (parent: HTMLElement, label: string, key: () => string, placeholder?: string): TextInputHandle => {
        const f = field(parent, { label, layout: 'inline' });
        const input = textInput(f.controlEl, {
            value: str(settings.getValue(key())),
            placeholder,
            onInput: (value) => {
                settings.setValue(key(), value);
                host.requestUpdate();
            },
        });
        f.bind(input.el);
        return input;
    };

    const buildAxes = () => {
        const g = group(el, t('panels.chart.axes'));
        if (!host.is3D()) {
            const styleField = field(g.body, { label: t('panels.chart.style'), layout: 'inline' });
            axisStyle = segmented(styleField.controlEl, {
                label: t('panels.chart.axisStyle'),
                value: str(settings.getValue('axis_style')) || 'box',
                options: [
                    { value: 'box', text: t('panels.chart.styleBox') },
                    { value: 'middle', text: t('panels.chart.styleMiddle') },
                    { value: 'axes', text: t('panels.chart.styleAxes') },
                ],
                onChange: (value) => {
                    settings.setValue('axis_style', value);
                    host.requestUpdate();
                },
            });
            styleField.bind(axisStyle.el);
        }

        const chips = g.body.createDiv({ cls: 'etz-chip-row' });
        chip(chips, {
            label: t('panels.chart.axisLabels'),
            value: settings.getValue('show_axis_label') !== false,
            onChange: (on) => {
                settings.setValue('show_axis_label', on);
                host.requestUpdate();
            },
        });
        if (!host.is3D()) {
            const equal = chip(chips, {
                label: isPolar() ? t('panels.chart.equalScalePolar') : t('panels.chart.equalScale'),
                value: isPolar() || settings.getValue('equalScale') === true,
                onChange: (on) => {
                    settings.setValue('equalScale', on);
                    host.requestUpdate();
                },
            });
            equal.setDisabled(isPolar());
        }

        labelInput(g.body, t('panels.chart.axisLabel', { axis: 'x' }), xLabelKey, isPolar() ? t('panels.chart.noLabel') : 'x');
        labelInput(g.body, t('panels.chart.axisLabel', { axis: 'y' }), yLabelKey, isPolar() ? t('panels.chart.noLabel') : 'y');
        if (host.is3D()) labelInput(g.body, t('panels.chart.axisLabel', { axis: 'z' }), () => 'axis_label_z', 'z');
        const title = labelInput(g.body, t('panels.chart.title'), () => 'title', t('panels.chart.noTitle'));
        title.el.addClass('etz-title-input');

        const defaultHint = t('panels.chart.variablesHint');
        const varsField = field(g.body, { label: t('panels.chart.variables'), layout: 'inline', hint: defaultHint });
        const vars = textInput(varsField.controlEl, {
            value: str(settings.getValue('variables')) || 'x, y',
            placeholder: 'x, y',
            monospace: true,
            onInput: (value) => {
                const problem = variablesProblem(value, settings);
                varsField.setHint(problem ?? defaultHint);
                varsField.el.toggleClass('is-error', !!problem);
                vars.el.toggleClass('is-error', !!problem);
                if (problem) return;
                settings.setValue('variables', value.trim() || 'x, y');
                host.requestUpdate();
            },
            // New variable names change what every field may use: re-validate all of them.
            onCommit: () => host.commit(),
        });
        varsField.bind(vars.el);
    };

    const sliderField = (
        parent: HTMLElement,
        label: string,
        key: string,
        range: { min: number; max: number; step: number; fallback: number; fixed?: boolean; value?: number },
        format?: (v: number) => string,
        hint?: string
    ): LiveSliderHandle => {
        const f = field(parent, { label, layout: 'inline', hint });
        const slider = liveSlider(f.controlEl, {
            min: range.min,
            max: range.max,
            step: range.step,
            value: range.value ?? num(settings.getValue(key), range.fallback),
            label,
            format,
            fixedRange: range.fixed,
            onInput: (value) => {
                settings.setValue(key, value);
                host.requestFrame();
            },
        });
        f.bind(slider.input);
        return slider;
    };

    const buildGrid = () => {
        const g = group(el, t('panels.chart.grid'));
        const chips = g.body.createDiv({ cls: 'etz-chip-row' });
        gridMajor = chip(chips, {
            label: t('panels.chart.majorGrid'),
            value: settings.getValue('showLargeGrid') === true,
            onChange: (on) => {
                settings.setValue('showLargeGrid', on);
                host.requestUpdate();
            },
        });
        gridMinor = chip(chips, {
            label: t('panels.chart.minorGrid'),
            value: settings.getValue('showSmallGrid') === true,
            onChange: (on) => {
                settings.setValue('showSmallGrid', on);
                host.requestUpdate();
            },
        });
        sliderField(g.body, t('panels.chart.majorDivisions'), 'majorTickNum', { min: 2, max: 20, step: 1, fallback: 8 });
        sliderField(g.body, t('panels.chart.minorLines'), 'gridSize', { min: 1, max: 10, step: 1, fallback: 5 });
        // Major lines at this opacity, minor lines at half; 2D and 3D, the preview and the PDF.
        const opacity = opacityValue(settings.getValue('gridOpacity'), GRID_OPACITY);
        gridOpacity = sliderField(
            g.body,
            t('panels.chart.gridOpacity'),
            'gridOpacity',
            { min: 0, max: 1, step: 0.05, fallback: GRID_OPACITY, fixed: true, value: opacity },
            percent,
            t('panels.chart.gridOpacityHint')
        );
    };

    const buildExportSize = () => {
        const g = group(el, t('panels.chart.exportSize'));
        const cm = (v: number) => `${formatDecimals(v, 1)} cm`;
        sliderField(g.body, t('panels.chart.width'), 'size_x_cm', { min: 2, max: 30, step: 0.5, fallback: 10 }, cm);
        sliderField(g.body, t('panels.chart.height'), 'size_y_cm', { min: 2, max: 30, step: 0.5, fallback: 8 }, cm);
    };

    const buildNote = () => {
        const g = group(el, t('panels.chart.inNote'));
        sliderField(
            g.body,
            t('panels.chart.previewSize'),
            'previewSize',
            { min: 320, max: 1400, step: 20, fallback: 760 },
            (v) => `${formatDecimals(v, 0)} px`,
            t('panels.chart.previewSizeHint')
        );
        const chips = g.body.createDiv({ cls: 'etz-chip-row' });
        chip(chips, {
            label: t('panels.chart.showSliders'),
            value: settings.getValue('showSlidersInNote') !== false,
            onChange: (on) => {
                settings.setValue('showSlidersInNote', on);
                host.requestUpdate();
            },
        });
    };

    const buildCamera = () => {
        const g = group(el, t('panels.chart.view3D'));
        const deg = (v: number) => `${formatDecimals(v, 0)}°`;
        elevation = sliderField(g.body, t('panels.chart.elevation'), 'rotationX', { min: 0, max: 90, step: 1, fallback: 30 }, deg);
        azimuth = sliderField(g.body, t('panels.chart.azimuth'), 'rotationZ', { min: 0, max: 360, step: 1, fallback: 45 }, deg);
        const aspectField = field(g.body, {
            label: t('panels.chart.box'),
            layout: 'inline',
            hint: t('panels.chart.boxHint'),
        });
        const aspect = segmented(aspectField.controlEl, {
            label: t('panels.chart.boxAspect'),
            value: settings.getValue('boxAspect') === 'equal' ? 'equal' : 'true',
            options: [
                { value: 'equal', text: t('panels.chart.cube') },
                { value: 'true', text: t('panels.chart.proportional') },
            ],
            onChange: (value) => {
                settings.setValue('boxAspect', value);
                host.requestUpdate();
            },
        });
        aspectField.bind(aspect.el);
    };

    const build = () => {
        for (const off of unregister) off();
        unregister = [];
        ranges.forEach((h) => h.destroy());
        ranges.clear();
        gridMajor = gridMinor = elevation = azimuth = gridOpacity = null;
        axisStyle = null;
        el.empty();
        buildRanges();
        if (host.is3D()) buildCamera();
        buildAxes();
        buildGrid();
        buildExportSize();
        buildNote();
    };

    build();

    return {
        el,
        refresh: build,
        syncView: () => {
            const active = el.ownerDocument.activeElement;
            ranges.forEach((handle, key) => {
                const value = str(settings.getValue(key));
                if (handle.input !== active && handle.getValue() !== value) handle.setValue(value);
            });
            gridMajor?.setValue(settings.getValue('showLargeGrid') === true);
            gridMinor?.setValue(settings.getValue('showSmallGrid') === true);
            gridOpacity?.setValue(opacityValue(settings.getValue('gridOpacity'), GRID_OPACITY));
            elevation?.setValue(num(settings.getValue('rotationX'), 30));
            azimuth?.setValue(num(settings.getValue('rotationZ'), 45));
            axisStyle?.setValue(str(settings.getValue('axis_style')) || 'box');
        },
        hasErrors: () => Array.from(ranges.values()).some((h) => h.hasError()),
    };
}
