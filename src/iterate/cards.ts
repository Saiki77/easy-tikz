/*
 * The Build tab (6.0 E): the cards of orbits, cobwebs, bifurcation
 * diagrams, Newton's method, coloured planes and turning circles. They
 * extend the layer cards' ToolCard and register themselves there when this
 * module loads (the Build panel imports it), as src/motion6/cards.ts does.
 */
import type { BifurcationTool, CobwebTool, FourierCirclesTool, FunctionParameters, NewtonTool, OrbitTool, PlaneColourTool, Tool } from '../types';
import type { ValidateKind, ValidateResult } from '../mathcontext';
import { ExprError } from '../expr';
import { DropdownOption, chip, dropdown, field, liveSlider } from '../ui/kit';
import { LayerCardActions, LayerItem, ToolCard, percent, registerToolCard, squash } from '../ui/layerCards';
import type { PanelHost } from '../ui/host';
import { COLORMAPS, colormapName } from '../colormaps';
import { t } from '../i18n';
import { parseValue, readRecurrence } from '../values';
import { givenParts, isPlaneColormap } from './tools';
import { planeKind } from './forms';
import { recurrenceStep } from './pixels';
import { compileFourier } from './fourier';

const OK: ValidateResult = { ok: true };
const NAME_RE = /^[A-Za-z][A-Za-z0-9_]*$/;

function problemOf(e: unknown): ValidateResult {
    if (e instanceof ExprError) return { ok: false, message: e.message, pos: e.pos };
    return { ok: false, message: e instanceof Error ? e.message : String(e) };
}

/** A recurrence that reads and compiles with the names `given` gives it. */
function recurrenceCheck(host: PanelHost, given: () => string): (src: string) => ValidateResult {
    return (src) => {
        const rec = readRecurrence(src);
        if (!rec) return { ok: false, message: t('iterate.problem.recurrenceTakes') };
        try {
            recurrenceStep(
                host.math(),
                rec,
                givenParts(given()).map((g) => g.name)
            );
            return OK;
        } catch (e) {
            return problemOf(e);
        }
    };
}

/** A formula of values, or the name of a points tool (P). */
function startCheck(host: PanelHost, tools: () => Tool[]): (src: string) => ValidateResult {
    return (src) => {
        const s = src.trim();
        if (NAME_RE.test(s) && tools().some((x) => x.type === 'points' && x.name === s)) return OK;
        try {
            parseValue(s);
            return OK;
        } catch (e) {
            return problemOf(e);
        }
    };
}

/** `c = P; eta = 0.1`: each part a name and a formula. */
function givenCheck(src: string): ValidateResult {
    for (const part of src.split(';')) {
        if (!part.trim()) continue;
        const parts = givenParts(part);
        if (!parts.length) return { ok: false, message: t('iterate.card.givenPlaceholder') };
        try {
            if (!NAME_RE.test(parts[0].value.trim())) parseValue(parts[0].value);
        } catch (e) {
            return problemOf(e);
        }
    }
    return OK;
}

/** A formula row of a card. */
interface RowOptions {
    id: string;
    kind: ValidateKind;
    get(): string;
    set(v: string): void;
    placeholder?: string;
    optional?: boolean;
    required?: boolean;
    check?(src: string): ValidateResult;
    onEdit?(v: string): void;
}

/** The cards of this part: a formula per row. */
abstract class IterateCard<T extends Tool> extends ToolCard<T> {
    protected row(label: string, o: RowOptions): void {
        const f = field(this.body, { label, layout: 'inline' });
        const input = this.exprField(f.controlEl, { label, ...o });
        f.bind(input.h.input);
    }

    protected points(): Tool[] {
        return this.settingsList<Tool>('tools');
    }
}

// ----------------------------------------------------------------- orbit

class OrbitCard extends IterateCard<OrbitTool> {
    constructor(parent: HTMLElement, item: LayerItem, tool: OrbitTool, host: PanelHost, actions: LayerCardActions) {
        super(parent, item, tool, host, actions);
        this.build();
        this.finish();
    }

    private build(): void {
        const tool = this.tool;
        this.row(t('iterate.card.recurrence'), {
            id: 'recurrence',
            kind: 'value',
            required: true,
            placeholder: t('iterate.card.recurrencePlaceholder'),
            check: recurrenceCheck(this.host, () => tool.given),
            get: () => tool.recurrence,
            set: (v) => {
                tool.recurrence = v;
            },
        });
        this.row(t('iterate.card.start'), {
            id: 'start',
            kind: 'value',
            required: true,
            placeholder: t('iterate.card.startPlaceholder'),
            check: startCheck(this.host, () => this.points()),
            get: () => tool.start,
            set: (v) => {
                tool.start = v;
            },
        });
        this.row(t('iterate.card.given'), {
            id: 'given',
            kind: 'value',
            optional: true,
            placeholder: t('iterate.card.givenPlaceholder'),
            check: givenCheck,
            get: () => tool.given,
            set: (v) => {
                tool.given = v;
            },
        });
        this.row(t('iterate.card.steps'), {
            id: 'steps',
            kind: 'value',
            required: true,
            get: () => tool.steps,
            set: (v) => {
                tool.steps = v;
            },
        });
        const line = this.lineRow({
            thickness: () => tool.thickness,
            setThickness: (v) => {
                tool.thickness = v;
            },
            chips: [
                {
                    label: t('iterate.card.path'),
                    get: () => tool.path,
                    set: (v) => {
                        tool.path = v;
                    },
                },
                {
                    label: t('iterate.card.labels'),
                    get: () => tool.valueLabel,
                    set: (v) => {
                        tool.valueLabel = v;
                    },
                },
            ],
        });
        this.onSync(() => {
            line.thickness.setValue(tool.thickness);
            line.chips[0]?.setValue(tool.path);
            line.chips[1]?.setValue(tool.valueLabel);
        });
    }

    protected summary(): string {
        const formula = squash(this.tool.recurrence, 40);
        return formula ? t('iterate.card.summary', { formula }) : t('iterate.card.empty');
    }
}

// ---------------------------------------------------------------- cobweb

class CobwebCard extends IterateCard<CobwebTool> {
    constructor(parent: HTMLElement, item: LayerItem, tool: CobwebTool, host: PanelHost, actions: LayerCardActions) {
        super(parent, item, tool, host, actions);
        this.build();
        this.finish();
    }

    private build(): void {
        const tool = this.tool;
        this.row(t('iterate.card.recurrence'), {
            id: 'recurrence',
            kind: 'value',
            required: true,
            placeholder: 'x_{n+1} = f(x_n)',
            check: recurrenceCheck(this.host, () => ''),
            get: () => tool.recurrence,
            set: (v) => {
                tool.recurrence = v;
            },
        });
        for (const id of ['start', 'steps'] as const) {
            this.row(t(id === 'start' ? 'iterate.card.start' : 'iterate.card.steps'), {
                id,
                kind: 'value',
                required: true,
                get: () => tool[id],
                set: (v) => {
                    tool[id] = v;
                },
            });
        }
        const line = this.lineRow({
            thickness: () => tool.thickness,
            setThickness: (v) => {
                tool.thickness = v;
            },
            chips: [],
        });
        this.onSync(() => line.thickness.setValue(tool.thickness));
    }

    protected summary(): string {
        const formula = squash(this.tool.recurrence, 40);
        return formula ? t('iterate.card.summary', { formula }) : t('iterate.card.empty');
    }
}

// ----------------------------------------------------------- bifurcation

class BifurcationCard extends IterateCard<BifurcationTool> {
    constructor(parent: HTMLElement, item: LayerItem, tool: BifurcationTool, host: PanelHost, actions: LayerCardActions) {
        super(parent, item, tool, host, actions);
        this.build();
        this.finish();
    }

    private build(): void {
        const tool = this.tool;
        this.row(t('iterate.card.recurrence'), {
            id: 'recurrence',
            kind: 'value',
            required: true,
            placeholder: 'x_{n+1} = r x_n (1 - x_n)',
            check: (src) => {
                const rec = readRecurrence(src);
                if (!rec) return { ok: false, message: t('iterate.problem.recurrenceTakes') };
                try {
                    recurrenceStep(this.host.math(), rec, [tool.parameter || 'r']);
                    return OK;
                } catch (e) {
                    return problemOf(e);
                }
            },
            get: () => tool.recurrence,
            set: (v) => {
                tool.recurrence = v;
            },
        });
        this.row(t('iterate.card.parameter'), {
            id: 'parameter',
            kind: 'value',
            required: true,
            check: (src) => (NAME_RE.test(src.trim()) ? OK : { ok: false, message: t('values.problem.badParameter', { name: src.trim() }) }),
            get: () => tool.parameter,
            set: (v) => {
                tool.parameter = v.trim();
            },
        });
        for (const id of ['from', 'to', 'start'] as const) {
            this.row(t(id === 'from' ? 'iterate.card.from' : id === 'to' ? 'iterate.card.to' : 'iterate.card.start'), {
                id,
                kind: 'value',
                required: true,
                get: () => tool[id],
                set: (v) => {
                    tool[id] = v;
                },
            });
        }
    }

    protected summary(): string {
        const formula = squash(this.tool.recurrence, 40);
        return formula ? t('iterate.card.summary', { formula }) : t('iterate.card.empty');
    }
}

// ---------------------------------------------------------------- Newton

class NewtonCard extends IterateCard<NewtonTool> {
    constructor(parent: HTMLElement, item: LayerItem, tool: NewtonTool, host: PanelHost, actions: LayerCardActions) {
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
        const fnField = field(this.body, { label: t('iterate.card.function'), layout: 'inline' });
        this.selectField(fnField.controlEl, {
            id: 'function',
            label: t('iterate.card.function'),
            options: () => {
                const opts: DropdownOption<string>[] = this.functions().map((f) => ({ value: f.name as string, text: f.expression.trim() ? `${f.name}: ${squash(f.expression, 28)}` : (f.name as string) }));
                if (!tool.function) opts.unshift({ value: '', text: t('iterate.card.chooseFunction') });
                return opts;
            },
            get: () => tool.function,
            set: (v) => {
                tool.function = v;
            },
            check: (v) => (!v || this.functions().some((f) => f.name === v) ? null : t('build.points.missing', { name: v })),
        });
        for (const id of ['start', 'steps'] as const) {
            this.row(t(id === 'start' ? 'iterate.card.start' : 'iterate.card.steps'), {
                id,
                kind: 'value',
                required: true,
                get: () => tool[id],
                set: (v) => {
                    tool[id] = v;
                },
            });
        }
        const line = this.lineRow({
            thickness: () => tool.thickness,
            setThickness: (v) => {
                tool.thickness = v;
            },
            chips: [
                {
                    label: t('iterate.card.labelsX'),
                    get: () => tool.valueLabel,
                    set: (v) => {
                        tool.valueLabel = v;
                    },
                },
            ],
        });
        this.onSync(() => {
            line.thickness.setValue(tool.thickness);
            line.chips[0]?.setValue(tool.valueLabel);
        });
    }

    protected summary(): string {
        return t('iterate.card.newtonSummary', { name: this.tool.function || '?', start: squash(this.tool.start) || '?' });
    }
}

// ------------------------------------------------------- coloured plane

class PlaneCard extends IterateCard<PlaneColourTool> {
    private recurrenceRows: HTMLElement[] = [];
    private mapRow!: HTMLElement;

    constructor(parent: HTMLElement, item: LayerItem, tool: PlaneColourTool, host: PanelHost, actions: LayerCardActions) {
        super(parent, item, tool, host, actions);
        this.build();
        this.finish();
    }

    private build(): void {
        const tool = this.tool;
        this.row(t('iterate.card.formula'), {
            id: 'formula',
            kind: 'value',
            required: true,
            placeholder: t('iterate.card.formulaPlaceholder'),
            check: (src) => {
                if (readRecurrence(src)) return recurrenceCheck(this.host, () => tool.given)(src);
                try {
                    parseValue(src.includes('=') ? src.slice(src.indexOf('=') + 1) : src);
                    return OK;
                } catch (e) {
                    return problemOf(e);
                }
            },
            onEdit: () => this.syncState(),
            get: () => tool.formula,
            set: (v) => {
                tool.formula = v;
            },
        });
        const before = this.body.children.length;
        this.row(t('iterate.card.start'), {
            id: 'start',
            kind: 'value',
            optional: true,
            placeholder: '0, or x + iy',
            check: startCheck(this.host, () => this.points()),
            get: () => tool.start,
            set: (v) => {
                tool.start = v;
            },
        });
        this.row(t('iterate.card.given'), {
            id: 'given',
            kind: 'value',
            optional: true,
            placeholder: 'c = x + iy',
            check: givenCheck,
            get: () => tool.given,
            set: (v) => {
                tool.given = v;
            },
        });
        this.row(t('iterate.card.steps'), {
            id: 'steps',
            kind: 'value',
            required: true,
            get: () => tool.steps,
            set: (v) => {
                tool.steps = v;
            },
        });
        this.recurrenceRows = Array.from(this.body.children).slice(before) as HTMLElement[];
        const maps = field(this.body, { label: t('iterate.card.colormap'), layout: 'inline' });
        this.mapRow = maps.el;
        const fallback = () => (planeKind(tool.formula) === 'escape' ? 'cyclic' : 'viridis');
        const select = dropdown<string>(maps.controlEl, {
            label: t('iterate.card.colormap'),
            options: [{ value: 'cyclic', text: t('iterate.card.cyclic') }, ...COLORMAPS.map((m) => ({ value: m, text: colormapName(m) }))],
            value: tool.colormap ?? fallback(),
            onChange: (v) => {
                if (isPlaneColormap(v)) tool.colormap = v;
                this.changed();
            },
        });
        const op = field(this.body, { label: t('iterate.card.opacity'), layout: 'inline' });
        const opacity = liveSlider(op.controlEl, {
            min: 0,
            max: 1,
            step: 0.05,
            value: tool.opacity,
            label: t('iterate.card.opacity'),
            fixedRange: true,
            format: (v) => percent(v),
            onInput: (v) => {
                tool.opacity = v;
                this.frame();
            },
        });
        this.onSync(() => {
            select.setValue(tool.colormap ?? fallback());
            opacity.setValue(tool.opacity);
        });
    }

    protected syncState(): void {
        if (!this.mapRow) return;
        const kind = planeKind(this.tool.formula);
        for (const r of this.recurrenceRows) r.toggleClass('tikz-hidden', kind !== 'escape');
        // Domain colouring has colours of its own.
        this.mapRow.toggleClass('tikz-hidden', kind === 'domain');
    }

    protected summary(): string {
        const formula = squash(this.tool.formula, 40);
        return formula ? t('iterate.card.summary', { formula }) : t('iterate.card.empty');
    }
}

// ------------------------------------------------------- turning circles

class CirclesCard extends IterateCard<FourierCirclesTool> {
    constructor(parent: HTMLElement, item: LayerItem, tool: FourierCirclesTool, host: PanelHost, actions: LayerCardActions) {
        super(parent, item, tool, host, actions);
        this.build();
        this.finish();
    }

    private build(): void {
        const tool = this.tool;
        this.row(t('iterate.card.sum'), {
            id: 'sum',
            kind: 'value',
            required: true,
            placeholder: t('iterate.card.sumPlaceholder'),
            check: (src) => {
                try {
                    compileFourier(this.host.math(), src, 1);
                    return OK;
                } catch (e) {
                    return problemOf(e);
                }
            },
            get: () => tool.sum,
            set: (v) => {
                tool.sum = v;
            },
        });
        const showField = field(this.body, { label: t('beyond.card.show'), layout: 'inline' });
        const wave = chip(showField.controlEl, {
            label: t('iterate.card.wave'),
            value: tool.wave,
            onChange: (v) => {
                tool.wave = v;
                this.changed();
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
            wave.setValue(tool.wave);
            line.thickness.setValue(tool.thickness);
        });
    }

    protected summary(): string {
        const formula = squash(this.tool.sum, 40);
        return formula ? t('iterate.card.summary', { formula }) : t('iterate.card.empty');
    }
}

registerToolCard('orbit', (parent, item, tool, host, actions) => new OrbitCard(parent, item, tool as OrbitTool, host, actions));
registerToolCard('cobweb', (parent, item, tool, host, actions) => new CobwebCard(parent, item, tool as CobwebTool, host, actions));
registerToolCard('bifurcation', (parent, item, tool, host, actions) => new BifurcationCard(parent, item, tool as BifurcationTool, host, actions));
registerToolCard('newton', (parent, item, tool, host, actions) => new NewtonCard(parent, item, tool as NewtonTool, host, actions));
registerToolCard('colourPlane', (parent, item, tool, host, actions) => new PlaneCard(parent, item, tool as PlaneColourTool, host, actions));
registerToolCard('fourierCircles', (parent, item, tool, host, actions) => new CirclesCard(parent, item, tool as FourierCirclesTool, host, actions));
