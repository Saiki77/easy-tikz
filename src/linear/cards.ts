/*
 * The Build tab (6.0 D): the cards of the grid, the basis vectors, a
 * transform, eigenvectors, the unit square and a span. They extend the
 * layer cards' ToolCard and register themselves there when this module
 * loads (the Build panel imports it), as src/motion6/cards.ts does.
 */
import type { BasisVectorsTool, EigenvectorsTool, PlaneGridTool, SpanTool, TransformTool, UnitSquareTool } from '../types';
import type { ValidateResult } from '../mathcontext';
import type { PanelHost } from '../ui/host';
import { chip, field, liveSlider } from '../ui/kit';
import { LayerCardActions, LayerItem, ToolCard, percent, registerToolCard, squash } from '../ui/layerCards';
import { ExprError } from '../expr';
import { t } from '../i18n';
import { compileMap, matrixValue } from './maps';
import { compileValue } from '../values/index';

const OK: ValidateResult = { ok: true };

function problemOf(e: unknown): ValidateResult {
    if (e instanceof ExprError) return { ok: false, message: e.message, pos: e.pos };
    return { ok: false, message: e instanceof Error ? e.message : String(e) };
}

/** A check that runs `f` in the chart's context: no problem, or its message. */
function checkWith(f: () => unknown): ValidateResult {
    try {
        f();
        return OK;
    } catch (e) {
        return problemOf(e);
    }
}

const dimOf = (host: PanelHost): 2 | 3 => (host.is3D() ? 3 : 2);

// ------------------------------------------------------------------ grid

class GridCard extends ToolCard<PlaneGridTool> {
    constructor(parent: HTMLElement, item: LayerItem, tool: PlaneGridTool, host: PanelHost, actions: LayerCardActions) {
        super(parent, item, tool, host, actions);
        this.build();
        this.finish();
    }

    private build(): void {
        const tool = this.tool;
        for (const which of ['from', 'to', 'spacing'] as const) {
            const label = t(which === 'from' ? 'linear.card.from' : which === 'to' ? 'linear.card.to' : 'linear.card.spacing');
            const f = field(this.body, { label, layout: 'inline' });
            const v = this.exprField(f.controlEl, {
                id: which,
                label,
                kind: 'value',
                optional: true,
                placeholder: which === 'spacing' ? '1' : t('linear.card.auto'),
                get: () => tool[which],
                set: (s) => {
                    tool[which] = s;
                },
            });
            f.bind(v.h.input);
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
        const tool = this.tool;
        const spacing = squash(tool.spacing) || '1';
        if (tool.from.trim() && tool.to.trim()) return t('linear.card.gridSummary', { from: squash(tool.from), to: squash(tool.to), spacing });
        return t('linear.card.gridAuto', { spacing });
    }
}

// ---------------------------------------------------------- basis vectors

class BasisCard extends ToolCard<BasisVectorsTool> {
    constructor(parent: HTMLElement, item: LayerItem, tool: BasisVectorsTool, host: PanelHost, actions: LayerCardActions) {
        super(parent, item, tool, host, actions);
        this.build();
        this.finish();
    }

    private build(): void {
        const tool = this.tool;
        const line = this.lineRow({
            thickness: () => tool.thickness,
            setThickness: (v) => {
                tool.thickness = v;
            },
            chips: [
                {
                    label: t('linear.card.labels'),
                    get: () => tool.valueLabel,
                    set: (v) => {
                        tool.valueLabel = v;
                    },
                },
            ],
        });
        this.onSync(() => line.thickness.setValue(tool.thickness));
    }

    protected summary(): string {
        return t(this.host.is3D() ? 'linear.card.basisSummary3d' : 'linear.card.basisSummary');
    }
}

// -------------------------------------------------------------- transform

class TransformCard extends ToolCard<TransformTool> {
    constructor(parent: HTMLElement, item: LayerItem, tool: TransformTool, host: PanelHost, actions: LayerCardActions) {
        super(parent, item, tool, host, actions);
        this.build();
        this.finish();
    }

    private build(): void {
        const tool = this.tool;
        const f = field(this.body, { label: t('linear.card.map'), layout: 'inline' });
        const input = this.exprField(f.controlEl, {
            id: 'map',
            label: t('linear.card.map'),
            kind: 'value',
            required: true,
            placeholder: t('linear.card.mapPlaceholder'),
            get: () => tool.map,
            set: (v) => {
                tool.map = v;
            },
            check: (src) => checkWith(() => compileMap(this.host.math(), src, dimOf(this.host))),
        });
        f.bind(input.h.input);
        this.body.createDiv({ cls: 'etz-card-hint', text: t('linear.card.mapHint') });
    }

    protected summary(): string {
        const map = squash(this.tool.map, 40);
        return map ? t('linear.card.mapSummary', { map }) : t('linear.card.mapEmpty');
    }
}

// ------------------------------------------------------------ eigenvectors

class EigenCard extends ToolCard<EigenvectorsTool> {
    constructor(parent: HTMLElement, item: LayerItem, tool: EigenvectorsTool, host: PanelHost, actions: LayerCardActions) {
        super(parent, item, tool, host, actions);
        this.build();
        this.finish();
    }

    private build(): void {
        const tool = this.tool;
        const f = field(this.body, { label: t('linear.card.matrix'), layout: 'inline' });
        const input = this.exprField(f.controlEl, {
            id: 'matrix',
            label: t('linear.card.matrix'),
            kind: 'value',
            required: true,
            placeholder: t('linear.card.matrixPlaceholder'),
            get: () => tool.matrix,
            set: (v) => {
                tool.matrix = v;
            },
            check: (src) => checkWith(() => matrixValue(this.host.math(), src, dimOf(this.host))),
        });
        f.bind(input.h.input);
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
                {
                    label: t('linear.card.labels'),
                    get: () => tool.valueLabel,
                    set: (v) => {
                        tool.valueLabel = v;
                    },
                },
            ],
        });
        this.onSync(() => line.thickness.setValue(tool.thickness));
    }

    protected summary(): string {
        const matrix = squash(this.tool.matrix, 40);
        return matrix ? t('linear.card.eigenSummary', { matrix }) : t('linear.card.empty');
    }
}

// ------------------------------------------------------------ unit square

class UnitSquareCard extends ToolCard<UnitSquareTool> {
    constructor(parent: HTMLElement, item: LayerItem, tool: UnitSquareTool, host: PanelHost, actions: LayerCardActions) {
        super(parent, item, tool, host, actions);
        this.build();
        this.finish();
    }

    private build(): void {
        const tool = this.tool;
        const show = field(this.body, { label: t('beyond.card.show'), layout: 'inline' });
        const image = chip(show.controlEl, {
            label: t('linear.card.image'),
            value: tool.image,
            onChange: (v) => {
                tool.image = v;
                this.changed();
            },
        });
        const labels = chip(show.controlEl, {
            label: t('linear.card.labels'),
            value: tool.valueLabel,
            onChange: (v) => {
                tool.valueLabel = v;
                this.changed();
            },
        });
        this.labelField('det A = {det(A)}', ['area', 'det']);
        const opField = field(this.body, { label: t('build.card.opacity'), layout: 'inline' });
        const opacity = liveSlider(opField.controlEl, {
            min: 0,
            max: 1,
            step: 0.05,
            value: tool.fillOpacity,
            label: t('build.card.opacity'),
            format: percent,
            onInput: (v) => {
                tool.fillOpacity = v;
                this.frame();
            },
        });
        opField.bind(opacity.input);
        this.onSync(() => {
            image.setValue(tool.image);
            labels.setValue(tool.valueLabel);
            opacity.setValue(tool.fillOpacity);
        });
    }

    protected summary(): string {
        return t(this.tool.image ? 'linear.card.imageSummary' : 'linear.card.squareSummary');
    }
}

// ------------------------------------------------------------------ span

class SpanCard extends ToolCard<SpanTool> {
    constructor(parent: HTMLElement, item: LayerItem, tool: SpanTool, host: PanelHost, actions: LayerCardActions) {
        super(parent, item, tool, host, actions);
        this.build();
        this.finish();
    }

    private build(): void {
        const tool = this.tool;
        const f = field(this.body, { label: t('linear.card.vectors'), layout: 'inline' });
        const input = this.exprField(f.controlEl, {
            id: 'vectors',
            label: t('linear.card.vectors'),
            kind: 'value',
            required: true,
            placeholder: t('linear.card.vectorsPlaceholder'),
            get: () => tool.vectors,
            set: (v) => {
                tool.vectors = v;
            },
            check: (src) => {
                for (const piece of src.split(';').filter((p) => p.trim())) {
                    const r = checkWith(() => compileValue(this.host.math(), piece));
                    if (!r.ok) return r;
                }
                return OK;
            },
        });
        f.bind(input.h.input);
        const opField = field(this.body, { label: t('build.card.opacity'), layout: 'inline' });
        const opacity = liveSlider(opField.controlEl, {
            min: 0,
            max: 1,
            step: 0.05,
            value: tool.fillOpacity,
            label: t('build.card.opacity'),
            format: percent,
            onInput: (v) => {
                tool.fillOpacity = v;
                this.frame();
            },
        });
        opField.bind(opacity.input);
        const line = this.lineRow({
            thickness: () => tool.thickness,
            setThickness: (v) => {
                tool.thickness = v;
            },
            chips: [
                {
                    label: t('linear.card.labels'),
                    get: () => tool.valueLabel,
                    set: (v) => {
                        tool.valueLabel = v;
                    },
                },
            ],
        });
        this.onSync(() => {
            opacity.setValue(tool.fillOpacity);
            line.thickness.setValue(tool.thickness);
        });
    }

    protected summary(): string {
        const vectors = squash(this.tool.vectors.split(';').join(','), 40);
        return vectors ? t('linear.card.spanSummary', { vectors }) : t('linear.card.empty');
    }
}

registerToolCard('planeGrid', (parent, item, tool, host, actions) => new GridCard(parent, item, tool as PlaneGridTool, host, actions));
registerToolCard('basisVectors', (parent, item, tool, host, actions) => new BasisCard(parent, item, tool as BasisVectorsTool, host, actions));
registerToolCard('transform', (parent, item, tool, host, actions) => new TransformCard(parent, item, tool as TransformTool, host, actions));
registerToolCard('eigenvectors', (parent, item, tool, host, actions) => new EigenCard(parent, item, tool as EigenvectorsTool, host, actions));
registerToolCard('unitSquare', (parent, item, tool, host, actions) => new UnitSquareCard(parent, item, tool as UnitSquareTool, host, actions));
registerToolCard('span', (parent, item, tool, host, actions) => new SpanCard(parent, item, tool as SpanTool, host, actions));
