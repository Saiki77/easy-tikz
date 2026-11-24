/*
 * The step of an object on its card (6.0): a row with a dropdown of the
 * steps (1 is the start), shown while the chart has steps, and the card
 * menu's item that puts the object in a new step. Shared by the layer cards
 * and the function cards (it imports neither).
 */
import type { Menu } from 'obsidian';
import { DropdownOption, dropdown, field } from '../ui/kit';
import { t } from '../i18n';
import { MAX_STEP, lastStep, stepOf } from './steps';

export interface StepRowOptions {
    get(): number;
    set(step: number): void;
    /** The chart's last step now. */
    last(): number;
    changed(): void;
}

/** The step row of a card: a dropdown of the steps (1 is the start), shown while the chart has steps. */
export function stepRow(parent: HTMLElement, o: StepRowOptions): { el: HTMLElement; sync(): void } {
    const f = field(parent, { label: t('motion6.step.label'), layout: 'inline', hint: t('motion6.step.hint'), cls: 'etz-motion6-steprow' });
    const options = (): DropdownOption<string>[] => {
        const top = Math.min(MAX_STEP, Math.max(o.last(), o.get()) + 1);
        const out: DropdownOption<string>[] = [];
        for (let k = 0; k <= top; k++) out.push({ value: String(k), text: String(k + 1) });
        return out;
    };
    const dd = dropdown<string>(f.controlEl, {
        label: t('motion6.step.label'),
        options: options(),
        value: String(o.get()),
        onChange: (v) => {
            o.set(Number(v));
            o.changed();
        },
    });
    const sync = () => {
        const shown = o.last() > 0 || o.get() > 0;
        f.el.toggleClass('tikz-hidden', !shown);
        if (!shown) return;
        dd.setOptions(options());
        dd.setValue(String(o.get()));
    };
    sync();
    return { el: f.el, sync };
}

/** Set an object's step (0 removes it). */
export function setStep(obj: { step?: number }, step: number): void {
    if (step > 0) obj.step = Math.min(MAX_STEP, Math.round(step));
    else delete obj.step;
}

/** The card menu's item that puts the object in a new step after the chart's last one. */
export function stepMenu(menu: Menu, obj: { step?: number }, chart: Record<string, unknown>, changed: () => void): void {
    const next = lastStep(chart) + 1;
    if (stepOf(obj) >= next - 1 && stepOf(obj) > 0) return;
    menu.addItem((i) =>
        i
            .setTitle(t('motion6.step.newStep', { step: next + 1 }))
            .setIcon('skip-forward')
            .onClick(() => {
                setStep(obj, next);
                changed();
            })
    );
}

