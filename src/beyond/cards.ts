/*
 * The Build tab cards of the tools beyond functions (5.0): data sets and
 * their plots, distributions and shaded probabilities, Riemann sums, slope
 * fields and their solutions. They extend the
 * layer cards' ToolCard (src/ui/layerCards.ts)
 * and register themselves there when this module loads (the Build panel
 * imports it), so layerCards.ts never imports this file.
 */
import type {
    DataPlotStyle,
    DataPlotTool,
    DataTool,
    DistributionKind,
    DistributionTool,
    FillPattern,
    FunctionParameters,
    MarkerSize,
    ProbabilityTool,
    RiemannMethod,
    RiemannTool,
    SlopeFieldTool,
    SolutionTool,
    Tool,
} from '../types';
import type { ValidateResult } from '../mathcontext';
import type { PanelHost } from '../ui/host';
import { DropdownHandle, DropdownOption, LiveSliderHandle, SegmentedHandle, chip, dropdown, field, liveSlider, segmented } from '../ui/kit';
import { FILL_PATTERN_OPTIONS } from '../colors';
import { readEvent } from './event';
import { LayerCardActions, LayerItem, ToolCard, percent, registerToolCard, sizeOptions, squash } from '../ui/layerCards';
import { defaultTool, recipes } from '../migrate';
import { MessageKey, t } from '../i18n';
import { DISTRIBUTION_FIELDS, DISTRIBUTION_KINDS, DistributionField, KIND_FIELDS, isDiscrete, kindOf } from './kinds'; // 6.2.1

const OK: ValidateResult = { ok: true };

/** Sample points for a new data set when the chart has no table to read. */
const SAMPLE_POINTS = '(1, 52); (2, 55); (3, 61); (4, 60); (5, 68)';

/** Points in a list source (`(1, 2); (3, 4)`). */
function countPoints(src: string): number {
    return src.split(';').filter((s) => s.trim()).length;
}

// -------------------------------------------------------------------- data

class DataCard extends ToolCard<DataTool> {
    private sourceSeg!: SegmentedHandle<DataTool['source']>;
    private tableRows: HTMLElement[] = [];
    private listRow!: HTMLElement;

    constructor(parent: HTMLElement, item: LayerItem, tool: DataTool, host: PanelHost, actions: LayerCardActions) {
        super(parent, item, tool, host, actions);
        this.build();
        this.finish();
    }

    private build(): void {
        const tool = this.tool;
        this.sourceSeg = segmented<DataTool['source']>(this.body, {
            label: t('beyond.data.source'),
            value: tool.source,
            fill: true,
            options: [
                { value: 'table', text: t('beyond.data.table') },
                { value: 'list', text: t('beyond.data.list') },
            ],
            onChange: (v) => {
                tool.source = v;
                if (v === 'list' && !tool.points.trim()) {
                    tool.points = SAMPLE_POINTS;
                    this.refresh();
                }
                this.changed();
            },
        });

        for (const which of ['xColumn', 'yColumn'] as const) {
            const label = t(which === 'xColumn' ? 'beyond.data.xColumn' : 'beyond.data.yColumn');
            const f = field(this.body, { label, layout: 'inline', hint: which === 'yColumn' ? t('beyond.data.tableHint') : undefined });
            const input = this.exprField(f.controlEl, {
                id: which,
                label,
                kind: 'value',
                optional: true,
                check: () => OK,
                placeholder: t(which === 'xColumn' ? 'beyond.data.xColumnPlaceholder' : 'beyond.data.yColumnPlaceholder'),
                get: () => tool[which],
                set: (v) => {
                    tool[which] = v;
                },
            });
            f.bind(input.h.input);
            this.tableRows.push(f.el);
        }

        const listField = field(this.body, { label: t('beyond.data.points'), layout: 'inline' });
        this.listRow = listField.el;
        const list = this.exprField(listField.controlEl, {
            id: 'points',
            label: t('beyond.data.points'),
            kind: 'tuples2',
            placeholder: SAMPLE_POINTS,
            get: () => tool.points,
            set: (v) => {
                tool.points = v;
            },
        });
        listField.bind(list.h.input);
        this.onSync(() => this.sourceSeg.setValue(tool.source));
    }

    protected syncState(): void {
        if (!this.listRow) return;
        const table = this.tool.source === 'table';
        for (const row of this.tableRows) row.toggleClass('tikz-hidden', !table);
        this.listRow.toggleClass('tikz-hidden', table);
    }

    protected summary(): string {
        const tool = this.tool;
        if (tool.source === 'list') {
            const count = countPoints(tool.points);
            return count ? t('beyond.data.summaryList', { count }) : t('beyond.data.empty');
        }
        const x = squash(tool.xColumn);
        const y = squash(tool.yColumn);
        return x || y ? t('beyond.data.summaryColumns', { x: x || '?', y: y || '?' }) : t('beyond.data.summaryTable');
    }
}

// --------------------------------------------------------------- data plot

class DataPlotCard extends ToolCard<DataPlotTool> {
    private styleSeg!: SegmentedHandle<DataPlotStyle>;
    private sizeRow!: HTMLElement;
    private lineRowEl!: HTMLElement;
    private barsRow!: HTMLElement;
    private valueRow!: HTMLElement;
    private labelRow!: HTMLElement;
    private dataSelect!: { el: HTMLElement; update(): void };
    private missing!: { el: HTMLElement; setText(text: string): void };
    private opacity!: LiveSliderHandle;

    constructor(parent: HTMLElement, item: LayerItem, tool: DataPlotTool, host: PanelHost, actions: LayerCardActions) {
        super(parent, item, tool, host, actions);
        this.build();
        this.finish();
    }

    private dataSets(): DataTool[] {
        return this.settingsList<Tool>('tools').filter((x): x is DataTool => !!x && x.type === 'data');
    }

    private build(): void {
        const tool = this.tool;
        const body = this.body;

        const dataField = field(body, { label: t('beyond.plot.data'), layout: 'inline' });
        this.dataSelect = this.selectField(dataField.controlEl, {
            id: 'data',
            label: t('beyond.plot.data'),
            options: () => {
                const opts: DropdownOption<string>[] = this.dataSets().map((d) => ({ value: d.name, text: `${d.name}: ${dataText(d)}` }));
                if (!tool.data) opts.unshift({ value: '', text: t('beyond.plot.chooseData') });
                return opts;
            },
            get: () => tool.data,
            set: (v) => {
                tool.data = v;
            },
            check: (v) => {
                if (!v) return null;
                const found = this.settingsList<Tool>('tools').find((x) => x && x.name === v);
                if (!found) return t('build.points.missing', { name: v });
                return found.type === 'data' ? null : t('beyond.problem.notData', { name: v });
            },
        });
        this.missing = this.missingState(dataField.controlEl, t('beyond.plot.noData'), t('beyond.plot.addData'), () => this.addData());

        this.styleSeg = segmented<DataPlotStyle>(body, {
            label: t('beyond.plot.style'),
            value: tool.style,
            fill: true,
            options: [
                { value: 'points', text: t('beyond.plot.points') },
                { value: 'bars', text: t('beyond.plot.bars') },
                { value: 'line', text: t('beyond.plot.line') },
                { value: 'regression', text: t('beyond.plot.regression') },
            ],
            onChange: (v) => {
                tool.style = v;
                // A regression line says its equation unless told otherwise.
                if (v === 'regression' && !tool.label.trim()) tool.valueLabel = true;
                this.refresh();
                this.changed();
            },
        });

        const sizeField = field(body, { label: t('build.card.size'), layout: 'inline' });
        this.sizeRow = sizeField.el;
        const size = segmented<MarkerSize>(sizeField.controlEl, {
            label: t('build.points.markerSize'),
            value: tool.size,
            cls: 'etz-layer-size',
            options: sizeOptions<MarkerSize>('small', 'normal', 'large'),
            onChange: (v) => {
                tool.size = v;
                this.changed();
            },
        });
        sizeField.bind(size.el);

        const line = this.lineRow({
            thickness: () => tool.thickness,
            setThickness: (v) => {
                tool.thickness = v;
            },
            chips: [
                {
                    label: t('common.dashed'),
                    get: () => tool.dashed,
                    set: (v) => {
                        tool.dashed = v;
                    },
                },
            ],
        });
        this.lineRowEl = line.el;

        const bars = field(body, { label: t('build.card.fillOpacity'), layout: 'inline' });
        this.barsRow = bars.el;
        this.opacity = liveSlider(bars.controlEl, {
            min: 0,
            max: 1,
            step: 0.05,
            value: tool.fillOpacity,
            label: t('build.card.fillOpacity'),
            format: percent,
            onInput: (v) => {
                tool.fillOpacity = v;
                this.frame();
            },
        });

        const valueField = field(body, { label: t('beyond.card.show'), layout: 'inline' });
        this.valueRow = valueField.el;
        const value = chip(valueField.controlEl, {
            label: this.valueText(),
            value: tool.valueLabel,
            onChange: (v) => {
                tool.valueLabel = v;
                this.changed();
            },
        });

        const label = this.labelField(t('beyond.plot.pointsLabelPlaceholder'));
        this.labelRow = label.h.el.closest<HTMLElement>('.etz-field') ?? label.h.el;
        this.onSync(() => {
            this.styleSeg.setValue(tool.style);
            size.setValue(tool.size);
            value.setValue(tool.valueLabel);
            value.setLabel(this.valueText());
            this.opacity.setValue(tool.fillOpacity);
            label.h.input.placeholder = t(tool.style === 'regression' ? 'beyond.plot.regressionLabelPlaceholder' : 'beyond.plot.pointsLabelPlaceholder');
        });
    }

    /** What the value chip shows for the style: the coordinates, the values, or the equation and R². */
    private valueText(): string {
        const style = this.tool.style;
        return t(style === 'points' ? 'beyond.plot.valueLabelPoints' : style === 'bars' ? 'beyond.plot.valueLabelBars' : 'beyond.plot.valueLabel');
    }

    private addData(): void {
        const data = defaultTool('data', this.toolOptions());
        if (data.type === 'data' && this.host.settings.noteTable === undefined) {
            data.source = 'list';
            data.points = SAMPLE_POINTS;
        }
        this.insertTool(data, 'before');
        this.tool.data = data.name;
        this.structuralAdd(data);
    }

    protected syncState(): void {
        if (!this.labelRow) return;
        const style = this.tool.style;
        const none = this.dataSets().length === 0 && !this.tool.data;
        this.missing.el.toggleClass('tikz-hidden', !none);
        this.dataSelect.el.toggleClass('tikz-hidden', none);
        this.sizeRow.toggleClass('tikz-hidden', style !== 'points');
        this.lineRowEl.toggleClass('tikz-hidden', style !== 'line' && style !== 'regression');
        this.barsRow.toggleClass('tikz-hidden', style !== 'bars');
        this.valueRow.toggleClass('tikz-hidden', style === 'line');
        this.labelRow.toggleClass('tikz-hidden', style === 'line');
    }

    protected summary(): string {
        const data = this.tool.data || '?';
        switch (this.tool.style) {
            case 'bars':
                return t('beyond.plot.summaryBars', { data });
            case 'line':
                return t('beyond.plot.summaryLine', { data });
            case 'regression':
                return t('beyond.plot.summaryRegression', { data });
            default:
                return t('beyond.plot.summaryPoints', { data });
        }
    }
}

/** A data set in a few words, for dropdowns. */
function dataText(d: DataTool): string {
    if (d.source === 'list') return t('beyond.data.summaryList', { count: countPoints(d.points) });
    return d.xColumn || d.yColumn ? t('beyond.data.summaryColumns', { x: d.xColumn || '?', y: d.yColumn || '?' }) : t('beyond.data.summaryTable');
}

// ------------------------------------------------------------ distribution

class DistributionCard extends ToolCard<DistributionTool> {
    private kindSelect!: DropdownHandle<DistributionKind>;
    /** 6.2.1: the rows of each field (shown for the kinds that read it), the line row (densities) and the bars row. */
    private fieldRows = new Map<DistributionField, HTMLElement>();
    private lineRows: HTMLElement[] = [];
    private barRows: HTMLElement[] = [];

    constructor(parent: HTMLElement, item: LayerItem, tool: DistributionTool, host: PanelHost, actions: LayerCardActions) {
        super(parent, item, tool, host, actions);
        this.build();
        this.finish();
    }

    private build(): void {
        const tool = this.tool;
        // 6.2.1: nine kinds: a dropdown instead of the two segments of 5.0.
        const kindRow = field(this.body, { label: t('beyond.dist.kind'), layout: 'inline' });
        this.kindSelect = dropdown<DistributionKind>(kindRow.controlEl, {
            label: t('beyond.dist.kind'),
            options: DISTRIBUTION_KINDS.map((k) => ({ value: k, text: t(KIND_LABELS[k]) })),
            value: kindOf(tool.kind),
            onChange: (v) => {
                tool.kind = v;
                this.changed();
            },
        });
        for (const f of DISTRIBUTION_FIELDS) {
            const label = t(FIELD_LABELS[f]);
            const row = field(this.body, { label, layout: 'inline' });
            const input = this.exprField(row.controlEl, {
                id: f,
                label,
                kind: 'value',
                required: true,
                get: () => tool[f],
                set: (v) => {
                    tool[f] = v;
                },
            });
            row.bind(input.h.input);
            this.fieldRows.set(f, row.el);
        }
        const line = this.lineRow({
            thickness: () => tool.thickness,
            setThickness: (v) => {
                tool.thickness = v;
            },
            chips: [
                {
                    label: t('common.dashed'),
                    get: () => tool.dashed,
                    set: (v) => {
                        tool.dashed = v;
                    },
                },
            ],
        });
        this.lineRows.push(line.el);
        const bars = field(this.body, { label: t('build.card.fillOpacity'), layout: 'inline' });
        const opacity = liveSlider(bars.controlEl, {
            min: 0,
            max: 1,
            step: 0.05,
            value: tool.fillOpacity,
            label: t('build.card.fillOpacity'),
            format: percent,
            onInput: (v) => {
                tool.fillOpacity = v;
                this.frame();
            },
        });
        this.barRows.push(bars.el);
        this.onSync(() => {
            this.kindSelect.setValue(kindOf(tool.kind));
            opacity.setValue(tool.fillOpacity);
        });
    }

    protected syncState(): void {
        const kind = kindOf(this.tool.kind);
        const own = KIND_FIELDS[kind];
        this.fieldRows.forEach((row, f) => row.toggleClass('tikz-hidden', !own.includes(f)));
        const discrete = isDiscrete(kind);
        for (const row of this.lineRows) row.toggleClass('tikz-hidden', discrete);
        for (const row of this.barRows) row.toggleClass('tikz-hidden', !discrete);
    }

    protected summary(): string {
        return distributionSummary(this.tool, (v) => squash(v) || '?');
    }
}

/** 6.2.1: the name of each kind in the card's dropdown. */
const KIND_LABELS: Record<DistributionKind, MessageKey> = {
    normal: 'beyond.dist.normal',
    binomial: 'beyond.dist.binomial',
    studentT: 'beyond.dist.studentT',
    chiSquare: 'beyond.dist.chiSquare',
    exponential: 'beyond.dist.exponential',
    uniform: 'beyond.dist.uniform',
    poisson: 'beyond.dist.poisson',
    gamma: 'beyond.dist.gamma',
    beta: 'beyond.dist.beta',
};

/** 6.2.1: the label of each field's row. */
const FIELD_LABELS: Record<DistributionField, MessageKey> = {
    mean: 'beyond.dist.mean',
    sd: 'beyond.dist.sd',
    n: 'beyond.dist.n',
    p: 'beyond.dist.p',
    df: 'beyond.dist.df',
    rate: 'beyond.dist.rate',
    from: 'beyond.dist.from',
    to: 'beyond.dist.to',
    lambda: 'beyond.dist.lambda',
    shape: 'beyond.dist.shape',
    alpha: 'beyond.dist.a',
    beta: 'beyond.dist.b',
};

/** A distribution in a few words (its card's summary, the probability card's dropdown), its fields shown by `show`. */
function distributionSummary(d: DistributionTool, show: (v: string) => string): string {
    switch (kindOf(d.kind)) {
        case 'binomial':
            return t('beyond.dist.summaryBinomial', { n: show(d.n), p: show(d.p) });
        case 'studentT':
            return t('beyond.dist.summaryStudentT', { df: show(d.df) });
        case 'chiSquare':
            return t('beyond.dist.summaryChiSquare', { df: show(d.df) });
        case 'exponential':
            return t('beyond.dist.summaryExponential', { rate: show(d.rate) });
        case 'uniform':
            return t('beyond.dist.summaryUniform', { from: show(d.from), to: show(d.to) });
        case 'poisson':
            return t('beyond.dist.summaryPoisson', { lambda: show(d.lambda) });
        case 'gamma':
            return t('beyond.dist.summaryGamma', { shape: show(d.shape), rate: show(d.rate) });
        case 'beta':
            return t('beyond.dist.summaryBeta', { a: show(d.alpha), b: show(d.beta) });
        default:
            return t('beyond.dist.summaryNormal', { mean: show(d.mean), sd: show(d.sd) });
    }
}

// ------------------------------------------------------------- probability

class ProbabilityCard extends ToolCard<ProbabilityTool> {
    private distSelect!: { el: HTMLElement; update(): void };
    private missing!: { el: HTMLElement; setText(text: string): void };

    constructor(parent: HTMLElement, item: LayerItem, tool: ProbabilityTool, host: PanelHost, actions: LayerCardActions) {
        super(parent, item, tool, host, actions);
        this.build();
        this.finish();
    }

    private distributions(): DistributionTool[] {
        return this.settingsList<Tool>('tools').filter((x): x is DistributionTool => !!x && x.type === 'distribution');
    }

    /** The event: one of the forms P(...) takes, its bounds formulas the chart can compute. */
    private checkEvent(src: string): ValidateResult {
        const math = this.host.math();
        const dist = this.tool.distribution;
        const e = readEvent(src, (name) => name === dist || !math.tryValue(name).ok);
        if (!e) return { ok: false, message: t('beyond.problem.eventTakes') };
        for (let k = 0; k < e.parts.length; k++) {
            if (k === e.variable) continue;
            const v = math.validate(e.parts[k], 'value');
            if (!v.ok) return v;
        }
        return OK;
    }

    private build(): void {
        const tool = this.tool;
        const body = this.body;
        const distField = field(body, { label: t('beyond.prob.distribution'), layout: 'inline' });
        this.distSelect = this.selectField(distField.controlEl, {
            id: 'distribution',
            label: t('beyond.prob.distribution'),
            options: () => {
                const opts: DropdownOption<string>[] = this.distributions().map((d) => ({
                    value: d.name,
                    text: `${d.name}: ${distributionSummary(d, (v) => v)}`,
                }));
                if (!tool.distribution) opts.unshift({ value: '', text: t('beyond.prob.chooseDistribution') });
                return opts;
            },
            get: () => tool.distribution,
            set: (v) => {
                tool.distribution = v;
            },
            check: (v) => {
                if (!v) return null;
                const found = this.settingsList<Tool>('tools').find((x) => x && x.name === v);
                if (!found) return t('build.points.missing', { name: v });
                return found.type === 'distribution' ? null : t('beyond.problem.notDistribution', { name: v });
            },
        });
        this.missing = this.missingState(distField.controlEl, t('beyond.prob.noDistribution'), t('beyond.prob.addDistribution'), () => this.addDistribution());

        const eventField = field(body, { label: t('beyond.prob.event'), layout: 'inline' });
        const event = this.exprField(eventField.controlEl, {
            id: 'event',
            label: t('beyond.prob.event'),
            kind: 'value',
            required: true,
            check: (src) => this.checkEvent(src),
            placeholder: t('beyond.prob.eventPlaceholder'),
            get: () => tool.event,
            set: (v) => {
                tool.event = v;
            },
        });
        eventField.bind(event.h.input);

        const showField = field(body, { label: t('beyond.card.show'), layout: 'inline' });
        const value = chip(showField.controlEl, {
            label: t('beyond.prob.valueLabel'),
            value: tool.valueLabel,
            onChange: (v) => {
                tool.valueLabel = v;
                this.changed();
            },
        });
        this.labelField(t('beyond.prob.labelPlaceholder'), ['p']);

        const shading = field(body, { label: t('build.region.shading'), layout: 'inline' });
        const pattern = dropdown<FillPattern>(shading.controlEl, {
            label: t('build.card.fillPattern'),
            options: FILL_PATTERN_OPTIONS,
            value: tool.fillPattern,
            onChange: (v) => {
                tool.fillPattern = v;
                this.changed();
            },
        });
        const opacity = liveSlider(shading.controlEl, {
            min: 0,
            max: 1,
            step: 0.05,
            value: tool.fillOpacity,
            label: t('build.card.fillOpacity'),
            format: percent,
            onInput: (v) => {
                tool.fillOpacity = v;
                this.frame();
            },
        });
        this.onSync(() => {
            value.setValue(tool.valueLabel);
            pattern.setValue(tool.fillPattern);
            opacity.setValue(tool.fillOpacity);
        });
    }

    private addDistribution(): void {
        const dist = defaultTool('distribution', this.toolOptions());
        this.insertTool(dist, 'before');
        this.tool.distribution = dist.name;
        this.structuralAdd(dist);
    }

    protected syncState(): void {
        if (!this.missing) return;
        const none = this.distributions().length === 0 && !this.tool.distribution;
        this.missing.el.toggleClass('tikz-hidden', !none);
        this.distSelect.el.toggleClass('tikz-hidden', none);
    }

    protected summary(): string {
        const event = squash(this.tool.event);
        return event ? t('beyond.prob.summary', { event }) : t('beyond.prob.empty');
    }
}

// ------------------------------------------------------------- Riemann sum

class RiemannCard extends ToolCard<RiemannTool> {
    private methodSeg!: SegmentedHandle<RiemannMethod>;
    private fnSelect!: { el: HTMLElement; update(): void };
    private missing!: { el: HTMLElement; setText(text: string): void };

    constructor(parent: HTMLElement, item: LayerItem, tool: RiemannTool, host: PanelHost, actions: LayerCardActions) {
        super(parent, item, tool, host, actions);
        this.build();
        this.finish();
    }

    /** Functions y = f(x) of the chart: named, not parametric (none in a polar chart). */
    private functions(): FunctionParameters[] {
        if (this.host.isPolar()) return [];
        return this.settingsList<FunctionParameters>('functions').filter((f) => !!f && !!f.name && !f.parametric);
    }

    private build(): void {
        const tool = this.tool;
        const body = this.body;
        const fnField = field(body, { label: t('beyond.riemann.function'), layout: 'inline' });
        this.fnSelect = this.selectField(fnField.controlEl, {
            id: 'function',
            label: t('beyond.riemann.function'),
            options: () => {
                const opts: DropdownOption<string>[] = this.functions().map((f) => ({ value: f.name as string, text: f.expression.trim() ? `${f.name}: ${squash(f.expression, 28)}` : (f.name as string) }));
                if (!tool.function) opts.unshift({ value: '', text: t('beyond.riemann.chooseFunction') });
                return opts;
            },
            get: () => tool.function,
            set: (v) => {
                tool.function = v;
            },
            check: (v) => {
                if (!v || this.functions().some((f) => f.name === v)) return null;
                return this.settingsList<FunctionParameters>('functions').some((f) => f && f.name === v)
                    ? t('beyond.problem.notCartesian', { name: v })
                    : t('build.points.missing', { name: v });
            },
        });
        this.missing = this.missingState(fnField.controlEl, t('beyond.riemann.noFunction'), t('build.add.function'), () => this.addFunction());

        this.methodSeg = segmented<RiemannMethod>(body, {
            label: t('beyond.riemann.method'),
            value: tool.method,
            fill: true,
            options: [
                { value: 'left', text: t('beyond.riemann.left') },
                { value: 'right', text: t('beyond.riemann.right') },
                { value: 'middle', text: t('beyond.riemann.middle') },
                { value: 'trapezoid', text: t('beyond.riemann.trapezoid') },
            ],
            onChange: (v) => {
                tool.method = v;
                this.changed();
            },
        });

        for (const id of ['from', 'to', 'parts'] as const) {
            const label = t(id === 'from' ? 'beyond.riemann.from' : id === 'to' ? 'beyond.riemann.to' : 'beyond.riemann.parts');
            const row = field(body, { label, layout: 'inline' });
            const input = this.exprField(row.controlEl, {
                id,
                label,
                kind: 'value',
                required: true,
                get: () => tool[id],
                set: (v) => {
                    tool[id] = v;
                },
            });
            row.bind(input.h.input);
        }

        const showField = field(body, { label: t('beyond.card.show'), layout: 'inline' });
        const value = chip(showField.controlEl, {
            label: t('beyond.riemann.valueLabel'),
            value: tool.valueLabel,
            onChange: (v) => {
                tool.valueLabel = v;
                this.changed();
            },
        });
        this.labelField(t('beyond.riemann.labelPlaceholder'), ['exact', 'n', 'sum']);

        const look = field(body, { label: t('build.card.fillOpacity'), layout: 'inline' });
        const opacity = liveSlider(look.controlEl, {
            min: 0,
            max: 1,
            step: 0.05,
            value: tool.fillOpacity,
            label: t('build.card.fillOpacity'),
            format: percent,
            onInput: (v) => {
                tool.fillOpacity = v;
                this.frame();
            },
        });
        const line = this.lineRow({
            thickness: () => tool.thickness,
            setThickness: (v) => {
                tool.thickness = v;
            },
            chips: [],
        });
        this.onSync(() => {
            this.methodSeg.setValue(tool.method);
            value.setValue(tool.valueLabel);
            opacity.setValue(tool.fillOpacity);
            line.thickness.setValue(tool.thickness);
        });
    }

    private addFunction(): void {
        const recipe = recipes(false).find((r) => r.id === 'function');
        const ctx = this.recipeContext();
        const built = recipe && recipe.available(ctx) ? recipe.build(ctx) : null;
        if (!built || built.kind !== 'function') return;
        built.fn.expression = 'x^2 / 4 + 1';
        let functions = this.host.settings.getValue<FunctionParameters[] | undefined>('functions');
        if (!Array.isArray(functions)) {
            functions = [];
            this.host.settings.setValue('functions', functions);
        }
        functions.push(built.fn);
        this.tool.function = built.fn.name || '';
        this.structuralAdd(built.fn);
    }

    protected syncState(): void {
        if (!this.missing) return;
        const none = this.functions().length === 0 && !this.tool.function;
        this.missing.el.toggleClass('tikz-hidden', !none);
        this.fnSelect.el.toggleClass('tikz-hidden', none);
    }

    protected summary(): string {
        const tool = this.tool;
        const values = { function: tool.function || '?', from: squash(tool.from) || '?', to: squash(tool.to) || '?', parts: squash(tool.parts) || '?' };
        switch (tool.method) {
            case 'right':
                return t('beyond.riemann.summaryRight', values);
            case 'middle':
                return t('beyond.riemann.summaryMiddle', values);
            case 'trapezoid':
                return t('beyond.riemann.summaryTrapezoid', values);
            default:
                return t('beyond.riemann.summaryLeft', values);
        }
    }
}

// ------------------------------------------------------------- slope field

class SlopeFieldCard extends ToolCard<SlopeFieldTool> {
    constructor(parent: HTMLElement, item: LayerItem, tool: SlopeFieldTool, host: PanelHost, actions: LayerCardActions) {
        super(parent, item, tool, host, actions);
        this.build();
        this.finish();
    }

    private build(): void {
        const tool = this.tool;
        const eq = field(this.body, { label: t('beyond.field.expression'), layout: 'inline' });
        const input = this.exprField(eq.controlEl, {
            id: 'expression',
            label: t('beyond.field.expression'),
            kind: 'fn2',
            required: true,
            placeholder: t('beyond.field.expressionPlaceholder'),
            get: () => tool.expression,
            set: (v) => {
                tool.expression = v;
            },
        });
        eq.bind(input.h.input);
        const dens = field(this.body, { label: t('beyond.field.density'), layout: 'inline' });
        const density = liveSlider(dens.controlEl, {
            min: 4,
            max: 60,
            step: 1,
            value: tool.density,
            label: t('beyond.field.density'),
            fixedRange: true,
            format: (v) => String(Math.round(v)),
            onInput: (v) => {
                tool.density = Math.round(v);
                this.frame();
            },
        });
        const line = this.lineRow({
            thickness: () => tool.thickness,
            setThickness: (v) => {
                tool.thickness = v;
            },
            chips: [],
        });
        this.onSync(() => {
            density.setValue(tool.density);
            line.thickness.setValue(tool.thickness);
        });
    }

    protected summary(): string {
        const expression = squash(this.tool.expression);
        return expression ? t('beyond.field.summary', { expression }) : t('beyond.field.empty');
    }
}

// ---------------------------------------------------------------- solution

class SolutionCard extends ToolCard<SolutionTool> {
    private fieldSelect!: { el: HTMLElement; update(): void };
    private missing!: { el: HTMLElement; setText(text: string): void };

    constructor(parent: HTMLElement, item: LayerItem, tool: SolutionTool, host: PanelHost, actions: LayerCardActions) {
        super(parent, item, tool, host, actions);
        this.build();
        this.finish();
    }

    private slopeFields(): SlopeFieldTool[] {
        return this.settingsList<Tool>('tools').filter((x): x is SlopeFieldTool => !!x && x.type === 'slopeField');
    }

    private build(): void {
        const tool = this.tool;
        const body = this.body;
        const fieldRow = field(body, { label: t('beyond.solution.field'), layout: 'inline' });
        this.fieldSelect = this.selectField(fieldRow.controlEl, {
            id: 'field',
            label: t('beyond.solution.field'),
            options: () => {
                const opts: DropdownOption<string>[] = this.slopeFields().map((f) => ({ value: f.name, text: f.expression.trim() ? `${f.name}: y' = ${squash(f.expression, 28)}` : f.name }));
                if (!tool.field) opts.unshift({ value: '', text: t('beyond.solution.chooseField') });
                return opts;
            },
            get: () => tool.field,
            set: (v) => {
                tool.field = v;
            },
            check: (v) => {
                if (!v) return null;
                const found = this.settingsList<Tool>('tools').find((x) => x && x.name === v);
                if (!found) return t('build.points.missing', { name: v });
                return found.type === 'slopeField' ? null : t('beyond.problem.notField', { name: v });
            },
        });
        this.missing = this.missingState(fieldRow.controlEl, t('beyond.solution.noField'), t('beyond.solution.addField'), () => this.addField());

        const through = field(body, { label: t('beyond.solution.through'), layout: 'inline' });
        const input = this.exprField(through.controlEl, {
            id: 'through',
            label: t('beyond.solution.through'),
            kind: 'path2',
            required: true,
            placeholder: t('beyond.solution.throughPlaceholder'),
            get: () => tool.through,
            set: (v) => {
                tool.through = v;
            },
        });
        through.bind(input.h.input);

        this.lineRow({
            thickness: () => tool.thickness,
            setThickness: (v) => {
                tool.thickness = v;
            },
            chips: [
                {
                    label: t('common.dashed'),
                    get: () => tool.dashed,
                    set: (v) => {
                        tool.dashed = v;
                    },
                },
            ],
        });
    }

    private addField(): void {
        const sf = defaultTool('slopeField', this.toolOptions());
        if (sf.type === 'slopeField') sf.expression = 'x - y';
        this.insertTool(sf, 'before');
        this.tool.field = sf.name;
        this.structuralAdd(sf);
    }

    protected syncState(): void {
        if (!this.missing) return;
        const none = this.slopeFields().length === 0 && !this.tool.field;
        this.missing.el.toggleClass('tikz-hidden', !none);
        this.fieldSelect.el.toggleClass('tikz-hidden', none);
    }

    protected summary(): string {
        const through = squash(this.tool.through);
        return through ? t('beyond.solution.summary', { field: this.tool.field || '?', through }) : t('beyond.solution.empty');
    }
}

registerToolCard('data', (parent, item, tool, host, actions) => new DataCard(parent, item, tool as DataTool, host, actions));
registerToolCard('dataPlot', (parent, item, tool, host, actions) => new DataPlotCard(parent, item, tool as DataPlotTool, host, actions));
registerToolCard('distribution', (parent, item, tool, host, actions) => new DistributionCard(parent, item, tool as DistributionTool, host, actions));
registerToolCard('probability', (parent, item, tool, host, actions) => new ProbabilityCard(parent, item, tool as ProbabilityTool, host, actions));
registerToolCard('riemann', (parent, item, tool, host, actions) => new RiemannCard(parent, item, tool as RiemannTool, host, actions));
registerToolCard('slopeField', (parent, item, tool, host, actions) => new SlopeFieldCard(parent, item, tool as SlopeFieldTool, host, actions));
registerToolCard('solution', (parent, item, tool, host, actions) => new SolutionCard(parent, item, tool as SolutionTool, host, actions));
