/*
 * 6.0 G: the Build tab card of a GeoGebra line: its command or value as
 * written (the name on the card's head renames it everywhere), what it is
 * now, its line and whether its name shows. It extends the layer cards'
 * ToolCard (src/ui/layerCards.ts) and registers itself there when this
 * module loads (the Build panel imports it).
 */
import type { GeoGebraTool } from '../types';
import type { ValidateResult } from '../mathcontext';
import type { PanelHost } from '../ui/host';
import { chip, field } from '../ui/kit';
import { LayerCardActions, LayerItem, ToolCard, registerToolCard, squash } from '../ui/layerCards';
import { t } from '../i18n';
import { ExprError } from '../expr';
import { parseValue } from '../values/parse';
import { formatValue } from '../values/format';
import { wholeCall } from './text';

const OK: ValidateResult = { ok: true };

class GeoGebraCard extends ToolCard<GeoGebraTool> {
    private valueEl!: HTMLElement;

    constructor(parent: HTMLElement, item: LayerItem, tool: GeoGebraTool, host: PanelHost, actions: LayerCardActions) {
        super(parent, item, tool, host, actions);
        this.build();
        this.finish();
    }

    private build(): void {
        const tool = this.tool;
        const command = field(this.body, { label: t('geogebra.card.command'), layout: 'inline' });
        const input = this.exprField(command.controlEl, {
            id: 'command',
            label: t('geogebra.card.command'),
            kind: 'value',
            required: true,
            placeholder: t('geogebra.card.commandPlaceholder'),
            get: () => tool.command,
            set: (v) => {
                tool.command = v;
            },
            check: (src) => {
                if (wholeCall(src.trim()) === 'Text') return OK;
                try {
                    parseValue(src);
                    return OK;
                } catch (e) {
                    return e instanceof ExprError ? { ok: false, message: e.message, pos: e.pos } : { ok: false, message: String(e) };
                }
            },
        });
        command.bind(input.h.input);
        const now = field(this.body, { label: t('geogebra.card.value'), layout: 'inline' });
        this.valueEl = now.controlEl.createDiv({ cls: 'etz-field-hint' });
        const show = field(this.body, { label: t('beyond.card.show'), layout: 'inline' });
        const name = chip(show.controlEl, {
            label: t('geogebra.card.nameLabel'),
            value: tool.nameLabel !== 'hidden',
            onChange: (v) => {
                tool.nameLabel = v ? 'shown' : 'hidden';
                this.changed();
            },
        });
        const line = this.lineRow({
            thickness: () => tool.thickness || 'thick',
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
            name.setValue(tool.nameLabel !== 'hidden');
            line.thickness.setValue(tool.thickness || 'thick');
            this.showValue();
        });
        this.showValue();
    }

    /** The value of a named value now (a point, a number, a list's length); nothing for an object. */
    private showValue(): void {
        const tool = this.tool;
        const table = this.host.math().valueTable();
        if (!tool.named || !table.has(tool.name) || table.isFunction(tool.name) || table.problem(tool.name)) {
            this.valueEl.setText(table.has(tool.name) && table.isFunction(tool.name) ? `${tool.name}(x)` : '');
            return;
        }
        const v = table.value(tool.name);
        const text = typeof v !== 'number' && v.kind === 'list' ? t('geogebra.card.listValue', { count: v.items.length }) : formatValue(v, 3);
        this.valueEl.setText(text);
    }

    protected summary(): string {
        const command = squash(this.tool.command, 40);
        if (!command) return t('geogebra.card.empty');
        return this.tool.named ? `${this.tool.name} = ${command}` : command;
    }
}

registerToolCard('geogebra', (parent, item, tool, host, actions) => new GeoGebraCard(parent, item, tool as GeoGebraTool, host, actions));
