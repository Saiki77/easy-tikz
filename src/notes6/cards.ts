/*
 * The Build tab cards of 6.0 B: a set on an axis and a chord. They extend
 * the layer cards' ToolCard (src/ui/layerCards.ts) and register themselves
 * there when this module loads (the Build panel imports it), as the cards
 * of src/beyond/cards.ts do.
 */
import type { AxisSetTool, ChordTool, FunctionParameters } from '../types';
import type { ValidateResult } from '../mathcontext';
import type { PanelHost } from '../ui/host';
import { DropdownOption, SegmentedHandle, chip, field, segmented } from '../ui/kit';
import { LayerCardActions, LayerItem, ToolCard, registerToolCard, squash } from '../ui/layerCards';
import { recipes } from '../migrate';
import { t } from '../i18n';
import { errorText } from '../util';
import { compileCondition } from './sets';

// ----------------------------------------------------------- set on an axis

class AxisSetCard extends ToolCard<AxisSetTool> {
    private axisSeg!: SegmentedHandle<'x' | 'y'>;

    constructor(parent: HTMLElement, item: LayerItem, tool: AxisSetTool, host: PanelHost, actions: LayerCardActions) {
        super(parent, item, tool, host, actions);
        this.build();
        this.finish();
    }

    private build(): void {
        const tool = this.tool;
        const body = this.body;
        const row = field(body, { label: t('notes6.axisSet.condition'), layout: 'inline' });
        const input = this.exprField(row.controlEl, {
            id: 'condition',
            label: t('notes6.axisSet.condition'),
            kind: 'condition',
            required: true,
            placeholder: t('notes6.axisSet.conditionPlaceholder'),
            get: () => tool.condition,
            set: (v) => {
                tool.condition = v;
            },
            // Equations too (their zeros), which a region condition does not take.
            check: (src): ValidateResult => {
                if (!src.trim()) return { ok: true };
                try {
                    compileCondition(this.host.math(), src, tool.axis === 'y' ? 'y' : 'x');
                    return { ok: true };
                } catch (e) {
                    return { ok: false, message: errorText(e) };
                }
            },
        });
        row.bind(input.h.input);

        this.axisSeg = segmented<'x' | 'y'>(body, {
            label: t('notes6.axisSet.axis'),
            value: tool.axis,
            fill: true,
            options: [
                { value: 'x', text: t('notes6.axisSet.xAxis') },
                { value: 'y', text: t('notes6.axisSet.yAxis') },
            ],
            onChange: (v) => {
                tool.axis = v;
                this.changed();
            },
        });

        const showField = field(body, { label: t('beyond.card.show'), layout: 'inline' });
        const value = chip(showField.controlEl, {
            label: t('notes6.axisSet.valueLabel'),
            value: tool.valueLabel,
            onChange: (v) => {
                tool.valueLabel = v;
                this.changed();
            },
        });
        this.labelField(t('notes6.axisSet.labelPlaceholder'));
        const line = this.lineRow({
            thickness: () => tool.thickness,
            setThickness: (v) => {
                tool.thickness = v;
            },
            chips: [],
        });
        this.onSync(() => {
            this.axisSeg.setValue(tool.axis);
            value.setValue(tool.valueLabel);
            line.thickness.setValue(tool.thickness);
        });
    }

    protected summary(): string {
        const cond = squash(this.tool.condition);
        if (!cond) return t('notes6.axisSet.empty');
        return t('notes6.axisSet.summary', { condition: cond, axis: t(this.tool.axis === 'y' ? 'notes6.axisSet.yAxis' : 'notes6.axisSet.xAxis') });
    }
}

// ------------------------------------------------------------------ chord

class ChordCard extends ToolCard<ChordTool> {
    private fnSelect!: { el: HTMLElement; update(): void };
    private missing!: { el: HTMLElement; setText(text: string): void };

    constructor(parent: HTMLElement, item: LayerItem, tool: ChordTool, host: PanelHost, actions: LayerCardActions) {
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
        const fnField = field(body, { label: t('notes6.chord.function'), layout: 'inline' });
        this.fnSelect = this.selectField(fnField.controlEl, {
            id: 'function',
            label: t('notes6.chord.function'),
            options: () => {
                const opts: DropdownOption<string>[] = this.functions().map((f) => ({ value: f.name as string, text: f.expression.trim() ? `${f.name}: ${squash(f.expression, 28)}` : (f.name as string) }));
                if (!tool.function) opts.unshift({ value: '', text: t('notes6.chord.chooseFunction') });
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
        this.missing = this.missingState(fnField.controlEl, t('notes6.chord.noFunction'), t('build.add.function'), () => this.addFunction());

        for (const id of ['from', 'to', 'at'] as const) {
            const label = t(id === 'from' ? 'notes6.chord.from' : id === 'to' ? 'notes6.chord.to' : 'notes6.chord.at');
            const row = field(body, { label, layout: 'inline' });
            const input = this.exprField(row.controlEl, {
                id,
                label,
                kind: 'value',
                required: id !== 'at',
                optional: id === 'at',
                placeholder: id === 'at' ? t('notes6.chord.atPlaceholder') : undefined,
                get: () => tool[id],
                set: (v) => {
                    tool[id] = v;
                },
            });
            row.bind(input.h.input);
        }

        const showField = field(body, { label: t('beyond.card.show'), layout: 'inline' });
        const value = chip(showField.controlEl, {
            label: t('notes6.chord.valueLabel'),
            value: tool.valueLabel,
            onChange: (v) => {
                tool.valueLabel = v;
                this.changed();
            },
        });
        this.labelField(t('notes6.chord.labelPlaceholder'), ['chord', 'gap', 'graph', 'lambda', 'x']);
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
            value.setValue(tool.valueLabel);
            line.thickness.setValue(tool.thickness);
            line.chips[0]?.setValue(tool.dashed);
        });
    }

    private addFunction(): void {
        const recipe = recipes(false).find((r) => r.id === 'function');
        const ctx = this.recipeContext();
        const built = recipe && recipe.available(ctx) ? recipe.build(ctx) : null;
        if (!built || built.kind !== 'function') return;
        built.fn.expression = 'x^2 / 2 - 1';
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
        const values = { function: tool.function || '?', from: squash(tool.from) || '?', to: squash(tool.to) || '?', at: squash(tool.at) };
        return values.at ? t('notes6.chord.summaryAt', values) : t('notes6.chord.summary', values);
    }
}

registerToolCard('axisSet', (parent, item, tool, host, actions) => new AxisSetCard(parent, item, tool as AxisSetTool, host, actions));
registerToolCard('chord', (parent, item, tool, host, actions) => new ChordCard(parent, item, tool as ChordTool, host, actions));
