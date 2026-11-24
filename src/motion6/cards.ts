/*
 * The Build tab (6.0): the cards of vector fields, rest points and
 * solutions of systems (the step row of every card: src/motion6/steprow.ts). They
 * extend the layer cards' ToolCard and register themselves there when this
 * module loads (the Build panel imports it), as src/beyond/cards.ts does.
 */
import type { Colormap, RestPointsTool, Tool, TrajectoryTool, VectorFieldTool } from '../types';
import type { ValidateResult } from '../mathcontext';
import type { PanelHost } from '../ui/host';
import { DropdownOption, chip, dropdown, field, liveSlider, segmented } from '../ui/kit';
import { LayerCardActions, LayerItem, ToolCard, registerToolCard, sizeOptions, squash } from '../ui/layerCards';
import { COLORMAPS, colormapName, isColormap } from '../colormaps';
import { defaultTool } from '../migrate';
import { t } from '../i18n';
import { compileTuple } from './maths';

const OK: ValidateResult = { ok: true };

// --------------------------------------------------------------- shared

/** A tuple check for an input: the formulas compile in the chart's context. */
function tupleCheck(host: PanelHost, dim: () => 2 | 3): (src: string) => ValidateResult {
    return (src) => {
        try {
            compileTuple(host.math(), src, dim());
            return OK;
        } catch (e) {
            return { ok: false, message: e instanceof Error ? e.message : String(e) };
        }
    };
}

/** 6.0 F4: a default ramp the chip turns on before any map (a solution's `coloured by time`). */
interface Ramp {
    get(): boolean;
    set(on: boolean): void;
}

/** A chip that turns a colour map on (viridis, or the default ramp) and off, and the map's dropdown while it is on. */
function mapRow(body: HTMLElement, label: string, get: () => Colormap | undefined, set: (m: Colormap | undefined) => void, changed: () => void, ramp?: Ramp): () => void {
    const row = body.createDiv({ cls: 'etz-chip-row' });
    const RAMP = 'ramp';
    const isOn = () => !!get() || !!ramp?.get();
    const on = chip(row, {
        label,
        value: isOn(),
        onChange: (v) => {
            if (ramp) {
                ramp.set(v);
                set(undefined);
            } else set(v ? 'viridis' : undefined);
            changed();
        },
    });
    const options: Array<{ value: string; text: string }> = COLORMAPS.map((m) => ({ value: m, text: colormapName(m) }));
    if (ramp) options.unshift({ value: RAMP, text: t('motion6.card.timeRamp') });
    const current = () => get() ?? (ramp ? RAMP : 'viridis');
    const maps = dropdown<string>(row, {
        label: t('motion6.card.colormap'),
        options,
        value: current(),
        onChange: (v) => {
            if (ramp && v === RAMP) {
                ramp.set(true);
                set(undefined);
            } else if (isColormap(v)) {
                ramp?.set(false);
                set(v);
            }
            changed();
        },
    });
    const sync = () => {
        on.setValue(isOn());
        maps.el.toggleClass('tikz-hidden', !isOn());
        maps.setValue(current());
    };
    sync();
    return sync;
}

// ---------------------------------------------------------- vector field

class VectorFieldCard extends ToolCard<VectorFieldTool> {
    constructor(parent: HTMLElement, item: LayerItem, tool: VectorFieldTool, host: PanelHost, actions: LayerCardActions) {
        super(parent, item, tool, host, actions);
        this.build();
        this.finish();
    }

    private build(): void {
        const tool = this.tool;
        const eq = field(this.body, { label: t('motion6.field.expression'), layout: 'inline' });
        const input = this.exprField(eq.controlEl, {
            id: 'expression',
            label: t('motion6.field.expression'),
            kind: 'fn2',
            required: true,
            check: tupleCheck(this.host, () => 2),
            placeholder: t('motion6.field.expressionPlaceholder'),
            get: () => tool.expression,
            set: (v) => {
                tool.expression = v;
            },
        });
        eq.bind(input.h.input);
        const dens = field(this.body, { label: t('motion6.field.density'), layout: 'inline' });
        const density = liveSlider(dens.controlEl, {
            min: 4,
            max: 60,
            step: 1,
            value: tool.density,
            label: t('motion6.field.density'),
            fixedRange: true,
            format: (v) => String(Math.round(v)),
            onInput: (v) => {
                tool.density = Math.round(v);
                this.frame();
            },
        });
        const syncMap = mapRow(
            this.body,
            t('motion6.field.byLength'),
            () => tool.colormap,
            (m) => {
                if (m) tool.colormap = m;
                else delete tool.colormap;
            },
            () => this.changed()
        );
        const line = this.lineRow({
            thickness: () => tool.thickness,
            setThickness: (v) => {
                tool.thickness = v;
            },
            chips: [
                {
                    label: t('motion6.field.particles'),
                    get: () => tool.particles,
                    set: (v) => {
                        tool.particles = v;
                    },
                },
                {
                    label: t('motion6.field.streamlines'),
                    get: () => tool.streamlines,
                    set: (v) => {
                        tool.streamlines = v;
                    },
                },
            ],
        });
        this.onSync(() => {
            density.setValue(tool.density);
            line.thickness.setValue(tool.thickness);
            syncMap();
        });
    }

    protected summary(): string {
        const expression = squash(this.tool.expression);
        return expression ? t('motion6.field.summary', { expression }) : t('motion6.field.empty');
    }
}

// ----------------------------------------------------------- rest points

class RestPointsCard extends ToolCard<RestPointsTool> {
    private fieldSelect!: { el: HTMLElement; update(): void };
    private missing!: { el: HTMLElement; setText(text: string): void };

    constructor(parent: HTMLElement, item: LayerItem, tool: RestPointsTool, host: PanelHost, actions: LayerCardActions) {
        super(parent, item, tool, host, actions);
        this.build();
        this.finish();
    }

    private vectorFields(): VectorFieldTool[] {
        return this.settingsList<Tool>('tools').filter((x): x is VectorFieldTool => !!x && x.type === 'vectorField');
    }

    private build(): void {
        const tool = this.tool;
        const row = field(this.body, { label: t('motion6.rest.field'), layout: 'inline' });
        this.fieldSelect = this.selectField(row.controlEl, {
            id: 'field',
            label: t('motion6.rest.field'),
            options: () => {
                const opts: DropdownOption<string>[] = this.vectorFields().map((f) => ({ value: f.name, text: f.expression.trim() ? `${f.name} = ${squash(f.expression, 28)}` : f.name }));
                if (!tool.field) opts.unshift({ value: '', text: t('motion6.rest.chooseField') });
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
                return found.type === 'vectorField' ? null : t('motion6.problem.notField', { name: v });
            },
        });
        this.missing = this.missingState(row.controlEl, t('motion6.rest.noField'), t('motion6.rest.addField'), () => this.addField());
        const size = segmented(this.body, {
            label: t('build.card.size'),
            value: tool.size,
            options: sizeOptions('small', 'normal', 'large'),
            onChange: (v) => {
                tool.size = v;
                this.changed();
            },
        });
        const chips = this.body.createDiv({ cls: 'etz-chip-row' });
        const kinds = chip(chips, {
            label: t('motion6.rest.kinds'),
            value: tool.valueLabel,
            onChange: (v) => {
                tool.valueLabel = v;
                this.changed();
            },
        });
        this.onSync(() => {
            size.setValue(tool.size);
            kinds.setValue(tool.valueLabel);
        });
    }

    private addField(): void {
        const vf = defaultTool('vectorField', this.toolOptions());
        if (vf.type === 'vectorField') vf.expression = '(y, -sin(x) - 0.25y)';
        this.insertTool(vf, 'before');
        this.tool.field = vf.name;
        this.structuralAdd(vf);
    }

    protected syncState(): void {
        if (!this.missing) return;
        const none = this.vectorFields().length === 0 && !this.tool.field;
        this.missing.el.toggleClass('tikz-hidden', !none);
        this.fieldSelect.el.toggleClass('tikz-hidden', none);
    }

    protected summary(): string {
        return t('motion6.rest.summary', { field: this.tool.field || '?' });
    }
}

// -------------------------------------------------------------- solution

class TrajectoryCard extends ToolCard<TrajectoryTool> {
    constructor(parent: HTMLElement, item: LayerItem, tool: TrajectoryTool, host: PanelHost, actions: LayerCardActions) {
        super(parent, item, tool, host, actions);
        this.build();
        this.finish();
    }

    private build(): void {
        const tool = this.tool;
        const dim = () => (tool.dim === 3 ? 3 : 2);
        const eq = field(this.body, { label: t('motion6.trajectory.expression'), layout: 'inline' });
        const input = this.exprField(eq.controlEl, {
            id: 'expression',
            label: t('motion6.trajectory.expression'),
            kind: 'fn2',
            required: true,
            check: tupleCheck(this.host, dim),
            placeholder: t(dim() === 3 ? 'motion6.trajectory.expressionPlaceholder3d' : 'motion6.trajectory.expressionPlaceholder'),
            get: () => tool.expression,
            set: (v) => {
                tool.expression = v;
            },
        });
        eq.bind(input.h.input);
        const through = field(this.body, { label: t('motion6.trajectory.through'), layout: 'inline' });
        const at = this.exprField(through.controlEl, {
            id: 'through',
            label: t('motion6.trajectory.through'),
            kind: () => (dim() === 3 ? 'path3' : 'path2'),
            required: true,
            placeholder: dim() === 3 ? '(1, 1, 1)' : t('motion6.trajectory.throughPlaceholder'),
            get: () => tool.through,
            set: (v) => {
                tool.through = v;
            },
        });
        through.bind(at.h.input);
        for (const which of ['from', 'to'] as const) {
            const label = t(which === 'from' ? 'motion6.trajectory.from' : 'motion6.trajectory.to');
            const f = field(this.body, { label, layout: 'inline' });
            const v = this.exprField(f.controlEl, {
                id: which,
                label,
                kind: 'value',
                required: true,
                get: () => tool[which],
                set: (s) => {
                    tool[which] = s;
                },
            });
            f.bind(v.h.input);
        }
        const syncMap = mapRow(
            this.body,
            t('motion6.trajectory.byTime'),
            () => tool.colormap,
            (m) => {
                if (m) tool.colormap = m;
                else delete tool.colormap;
            },
            () => this.changed(),
            // 6.0 F4: `coloured by time` alone is the cobalt to amber ramp.
            {
                get: () => tool.byTime === true,
                set: (on) => {
                    if (on) tool.byTime = true;
                    else delete tool.byTime;
                },
            }
        );
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
                // 6.0 F4
                {
                    label: t('motion6.trajectory.traced'),
                    get: () => tool.traced === true,
                    set: (v) => {
                        if (v) tool.traced = true;
                        else delete tool.traced;
                    },
                },
            ],
        });
        this.onSync(() => {
            line.thickness.setValue(tool.thickness);
            line.chips[1]?.setValue(tool.traced === true); // 6.0 F4
            syncMap();
        });
    }

    protected summary(): string {
        const expression = squash(this.tool.expression);
        return expression ? t('motion6.trajectory.summary', { expression, through: squash(this.tool.through) || '?' }) : t('motion6.trajectory.empty');
    }
}

registerToolCard('vectorField', (parent, item, tool, host, actions) => new VectorFieldCard(parent, item, tool as VectorFieldTool, host, actions));
registerToolCard('restPoints', (parent, item, tool, host, actions) => new RestPointsCard(parent, item, tool as RestPointsTool, host, actions));
registerToolCard('trajectory', (parent, item, tool, host, actions) => new TrajectoryCard(parent, item, tool as TrajectoryTool, host, actions));
