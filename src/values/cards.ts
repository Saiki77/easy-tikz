/*
 * 6.0 A: the Build tab cards of values: a let definition (its name on the
 * card's head, its parameters, its formula and its value now), vector
 * arrows and the points of a list. They extend the layer cards' ToolCard
 * (src/ui/layerCards.ts) and register themselves there when this module
 * loads (the Build panel imports it).
 */
import type { ListPointsTool, Tool, ValueTool, VectorTool } from '../types';
import type { ValidateResult } from '../mathcontext';
import type { PanelHost } from '../ui/host';
import { chip, field } from '../ui/kit';
import { LayerCardActions, LayerItem, ToolCard, registerToolCard, squash } from '../ui/layerCards';
import { t } from '../i18n';
import { ExprError } from '../expr';
import { parseValue } from './parse';
import { formatValue } from './format';

const OK: ValidateResult = { ok: true };
const NAME_RE = /^[A-Za-z][A-Za-z0-9_]*$/;

function problemOf(e: unknown): ValidateResult {
    if (e instanceof ExprError) return { ok: false, message: e.message, pos: e.pos };
    return { ok: false, message: e instanceof Error ? e.message : String(e) };
}

/** A formula of a value field: it reads, and (with the chart's names) compiles. */
function checkValue(host: PanelHost, src: string): ValidateResult {
    const math = host.math();
    try {
        math.valueTable().compileField(src, math.envFor('value'));
        return OK;
    } catch (e) {
        return problemOf(e);
    }
}

// --------------------------------------------------------------- definition

class ValueCard extends ToolCard<ValueTool> {
    private valueEl!: HTMLElement;

    constructor(parent: HTMLElement, item: LayerItem, tool: ValueTool, host: PanelHost, actions: LayerCardActions) {
        super(parent, item, tool, host, actions);
        this.build();
        this.finish();
    }

    private build(): void {
        const tool = this.tool;
        const formula = field(this.body, { label: t('values.card.formula'), layout: 'inline' });
        const input = this.exprField(formula.controlEl, {
            id: 'expression',
            label: t('values.card.formula'),
            kind: 'value',
            required: true,
            placeholder: t('values.card.formulaPlaceholder'),
            get: () => tool.expression,
            set: (v) => {
                tool.expression = v;
            },
            check: (src) => {
                try {
                    parseValue(src);
                } catch (e) {
                    return problemOf(e);
                }
                // The chart's own check once the context has the new formula.
                const table = this.host.math().valueTable();
                if (table.source(tool.name) !== src) return OK;
                const problem = table.problem(tool.name);
                return problem ? { ok: false, message: problem } : OK;
            },
        });
        formula.bind(input.h.input);
        const params = field(this.body, { label: t('values.card.params'), layout: 'inline', hint: t('values.card.paramsHint') });
        const paramInput = this.exprField(params.controlEl, {
            id: 'params',
            label: t('values.card.params'),
            kind: 'value',
            optional: true,
            placeholder: 'x, y',
            get: () => tool.params,
            set: (v) => {
                tool.params = v;
            },
            check: (src) => {
                const bad = src
                    .split(',')
                    .map((p) => p.trim())
                    .find((p) => !NAME_RE.test(p));
                return bad === undefined ? OK : { ok: false, message: t('values.problem.badParameter', { name: bad }) };
            },
        });
        params.bind(paramInput.h.input);
        const now = field(this.body, { label: t('values.card.value'), layout: 'inline' });
        this.valueEl = now.controlEl.createDiv({ cls: 'etz-field-hint' });
        this.onSync(() => this.showValue());
        this.showValue();
    }

    private showValue(): void {
        const tool = this.tool;
        if (tool.params.trim()) {
            this.valueEl.setText(`${tool.name}(${tool.params})`);
            return;
        }
        const table = this.host.math().valueTable();
        const problem = table.problem(tool.name);
        this.valueEl.setText(problem ? '' : formatValue(table.value(tool.name), 3));
    }

    protected summary(): string {
        const formula = squash(this.tool.expression, 40);
        if (!formula) return t('values.card.empty');
        const name = this.tool.params.trim() ? `${this.tool.name}(${this.tool.params})` : this.tool.name;
        return t('values.card.summary', { name, formula });
    }
}

// ------------------------------------------------------------------ arrows

class VectorCard extends ToolCard<VectorTool> {
    constructor(parent: HTMLElement, item: LayerItem, tool: VectorTool, host: PanelHost, actions: LayerCardActions) {
        super(parent, item, tool, host, actions);
        this.build();
        this.finish();
    }

    private build(): void {
        const tool = this.tool;
        const vectors = field(this.body, { label: t('values.card.vectors'), layout: 'inline' });
        const input = this.exprField(vectors.controlEl, {
            id: 'vectors',
            label: t('values.card.vectors'),
            kind: 'value',
            required: true,
            placeholder: t('values.card.vectorsPlaceholder'),
            get: () => tool.vectors,
            set: (v) => {
                tool.vectors = v;
            },
            check: (src) => {
                for (const piece of src.split(';').filter((p) => p.trim())) {
                    const r = checkValue(this.host, piece);
                    if (!r.ok) return r;
                }
                return OK;
            },
        });
        vectors.bind(input.h.input);
        const from = field(this.body, { label: t('values.card.from'), layout: 'inline' });
        const fromInput = this.exprField(from.controlEl, {
            id: 'from',
            label: t('values.card.from'),
            kind: 'value',
            optional: true,
            placeholder: t('values.card.fromPlaceholder'),
            get: () => tool.from,
            set: (v) => {
                tool.from = v;
            },
            check: (src) => (this.settingsList<Tool>('tools').some((x) => x && x.name === src.trim()) ? OK : checkValue(this.host, src)),
        });
        from.bind(fromInput.h.input);
        const show = field(this.body, { label: t('beyond.card.show'), layout: 'inline' });
        const tip = chip(show.controlEl, {
            label: t('values.card.tipToTail'),
            value: tool.tipToTail,
            onChange: (v) => {
                tool.tipToTail = v;
                this.changed();
            },
        });
        const labels = chip(show.controlEl, {
            label: t('values.card.labels'),
            value: tool.valueLabel,
            onChange: (v) => {
                tool.valueLabel = v;
                this.changed();
            },
        });
        this.labelField('{x}, {y}', ['i', 'x', 'y', 'z']);
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
        this.onSync(() => {
            tip.setValue(tool.tipToTail);
            labels.setValue(tool.valueLabel);
            line.thickness.setValue(tool.thickness);
        });
    }

    protected summary(): string {
        const vectors = squash(this.tool.vectors.split(';').join(','), 40);
        return vectors || t('values.card.empty');
    }
}

// ------------------------------------------------------------- list points

class ListPointsCard extends ToolCard<ListPointsTool> {
    constructor(parent: HTMLElement, item: LayerItem, tool: ListPointsTool, host: PanelHost, actions: LayerCardActions) {
        super(parent, item, tool, host, actions);
        this.build();
        this.finish();
    }

    private build(): void {
        const tool = this.tool;
        const points = field(this.body, { label: t('values.card.list'), layout: 'inline' });
        const input = this.exprField(points.controlEl, {
            id: 'points',
            label: t('values.card.list'),
            kind: 'value',
            required: true,
            placeholder: t('values.card.listPlaceholder'),
            get: () => tool.points,
            set: (v) => {
                tool.points = v;
            },
            check: (src) => checkValue(this.host, src),
        });
        points.bind(input.h.input);
        const show = field(this.body, { label: t('beyond.card.show'), layout: 'inline' });
        const labels = chip(show.controlEl, {
            label: t('values.card.labels'),
            value: tool.valueLabel,
            onChange: (v) => {
                tool.valueLabel = v;
                this.changed();
            },
        });
        this.labelField('{i}', ['i', 'x', 'y', 'z']);
        const line = this.lineRow({
            thickness: () => tool.thickness,
            setThickness: (v) => {
                tool.thickness = v;
            },
            chips: [
                {
                    label: t('values.card.joined'),
                    get: () => tool.joined,
                    set: (v) => {
                        tool.joined = v;
                    },
                },
            ],
        });
        this.onSync(() => {
            labels.setValue(tool.valueLabel);
            line.thickness.setValue(tool.thickness);
        });
    }

    protected summary(): string {
        const math = this.host.math();
        const value = math.valueTable().evaluate(this.tool.points, math.envFor('value'));
        const count = value !== null && typeof value !== 'number' && value.kind === 'list' ? value.items.length : 0;
        return count ? t('values.card.pointsSummary', { count }) : squash(this.tool.points, 40) || t('values.card.empty');
    }
}

registerToolCard('value', (parent, item, tool, host, actions) => new ValueCard(parent, item, tool as ValueTool, host, actions));
registerToolCard('vector', (parent, item, tool, host, actions) => new VectorCard(parent, item, tool as VectorTool, host, actions));
registerToolCard('listPoints', (parent, item, tool, host, actions) => new ListPointsCard(parent, item, tool as ListPointsTool, host, actions));
