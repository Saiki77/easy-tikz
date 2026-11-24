/*
 * 6.0 P: the Build tab card of a python block: the script in a code area
 * (monospace, line numbers, keeps indentation; Tab puts in 4 spaces,
 * Shift-Tab takes them out, Enter keeps the indent and adds 4 after a
 * colon), its problem with the line under it, and what it gives the chart
 * (the names it sets, the names it reads, how long it ran). It registers
 * itself with the layer cards when this module loads.
 */
import type { PythonTool, Tool } from '../types';
import type { Issue } from '../mathcontext';
import { field } from '../ui/kit';
import { LayerCardActions, LayerItem, ToolCard, registerToolCard, squash } from '../ui/layerCards';
import type { PanelHost } from '../ui/host';
import { t } from '../i18n';
import { chartProgram, inputsOf } from './defs';
import { FRAME_DEF } from './scene';

const INDENT = '    ';
const NAME_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;

class PythonCard extends ToolCard<PythonTool> {
    private area!: HTMLTextAreaElement;
    private gutter!: HTMLElement;
    private problemEl!: HTMLElement;
    private infoEl!: HTMLElement;
    private issue: Issue | null = null;

    constructor(parent: HTMLElement, item: LayerItem, tool: PythonTool, host: PanelHost, actions: LayerCardActions) {
        super(parent, item, tool, host, actions);
        this.build();
        this.finish();
    }

    private build(): void {
        const f = field(this.body, { label: t('python.card.code'), layout: 'stack', hint: t('python.card.hint') });
        const wrap = f.controlEl.createDiv({ cls: 'etz-python-editor' });
        this.gutter = wrap.createDiv({ cls: 'etz-python-gutter' });
        this.gutter.setAttr('aria-hidden', 'true');
        const area = wrap.createEl('textarea', { cls: 'etz-python-code' });
        area.spellcheck = false;
        area.setAttr('autocapitalize', 'off');
        area.setAttr('autocomplete', 'off');
        area.setAttr('wrap', 'off');
        area.setAttr('aria-label', t('python.card.ariaCode'));
        area.value = this.tool.code;
        this.area = area;
        f.bind(area);
        this.problemEl = f.controlEl.createDiv({ cls: 'etz-python-problem tikz-hidden' });
        this.problemEl.setAttr('role', 'alert');
        this.infoEl = f.controlEl.createDiv({ cls: 'etz-python-info' });
        area.addEventListener('input', () => this.edited());
        area.addEventListener('keydown', (e) => this.key(e));
        this.register('code', {
            el: area,
            focus: () => area.focus(),
            validate: () => undefined,
            hasError: () => !!this.issue,
            setIssue: (issue) => {
                this.issue = issue;
                this.showProblem();
            },
        });
        this.onSync(() => {
            if (this.area.value !== this.tool.code && this.area.ownerDocument.activeElement !== this.area) this.area.value = this.tool.code;
            this.fit();
            this.info();
        });
        this.fit();
        this.info();
    }

    private edited(): void {
        this.tool.code = this.area.value;
        this.fit();
        this.changed();
        this.info();
    }

    /** The code area as tall as its lines (no inner scroll), its line numbers beside it. */
    private fit(): void {
        const n = Math.max(3, this.area.value.split('\n').length);
        this.area.rows = n;
        const want = Array.from({ length: n }, (_, i) => String(i + 1)).join('\n');
        if (this.gutter.textContent !== want) this.gutter.setText(want);
    }

    private key(e: KeyboardEvent): void {
        const a = this.area;
        const v = a.value;
        const start = a.selectionStart;
        const end = a.selectionEnd;
        const lineStart = v.lastIndexOf('\n', start - 1) + 1;
        if (e.key === 'Tab' && !e.altKey && !e.ctrlKey && !e.metaKey) {
            e.preventDefault();
            if (e.shiftKey) {
                // Take up to 4 spaces off every line of the selection.
                const blockEnd = v.indexOf('\n', end);
                const stop = blockEnd < 0 ? v.length : blockEnd;
                const lines = v.slice(lineStart, stop).split('\n');
                let removedFirst = 0;
                let removed = 0;
                const out = lines.map((l, i) => {
                    const m = /^ {1,4}/.exec(l);
                    const k = m ? m[0].length : 0;
                    if (i === 0) removedFirst = k;
                    removed += k;
                    return l.slice(k);
                });
                this.replace(lineStart, stop, out.join('\n'), Math.max(lineStart, start - removedFirst), Math.max(lineStart, end - removed));
                return;
            }
            if (start !== end && v.slice(start, end).includes('\n')) {
                const blockEnd = v.indexOf('\n', end - 1);
                const stop = blockEnd < 0 ? v.length : blockEnd;
                const lines = v.slice(lineStart, stop).split('\n');
                this.replace(lineStart, stop, lines.map((l) => INDENT + l).join('\n'), start + INDENT.length, end + INDENT.length * lines.length);
                return;
            }
            this.replace(start, end, INDENT, start + INDENT.length, start + INDENT.length);
            return;
        }
        if (e.key === 'Enter' && !e.shiftKey && !e.altKey && !e.ctrlKey && !e.metaKey) {
            const line = v.slice(lineStart, start);
            const lead = /^[ \t]*/.exec(line)?.[0] ?? '';
            const more = /:\s*(#.*)?$/.test(line) ? INDENT : '';
            if (!lead && !more) return;
            e.preventDefault();
            const ins = `\n${lead}${more}`;
            this.replace(start, end, ins, start + ins.length, start + ins.length);
        }
    }

    /** Put text in place of [from, to) and select [a, b); an input event like typing. */
    private replace(from: number, to: number, text: string, a: number, b: number): void {
        const v = this.area.value;
        this.area.value = v.slice(0, from) + text + v.slice(to);
        this.area.setSelectionRange(a, b);
        this.edited();
    }

    private showProblem(): void {
        const text = this.issue ? this.issue.message : '';
        this.problemEl.setText(text);
        this.problemEl.toggleClass('tikz-hidden', !text);
        this.area.toggleClass('is-invalid', !!text);
        // The line the problem is on, in the gutter.
        const m = /(\d+)/.exec(text);
        const line = m ? Number(m[1]) : 0;
        this.gutter.dataset.problemLine = line ? String(line) : '';
        this.gutter.setCssProps({ '--etz-python-problem-line': line ? String(line - 1) : '-10' });
    }

    /** What the script gives the chart: its names, the names it reads, its time. */
    private info(): void {
        const tools = this.settingsList<Tool>('tools');
        const program = chartProgram(tools);
        if (!program) {
            this.infoEl.setText('');
            return;
        }
        const env = this.host.math().envFor('value');
        const result = program.run(inputsOf(program, (name) => (NAME_RE.test(name) ? env.scalar(name)?.read() : undefined)));
        // Only the names the chart gets (x, y, t and the sliders' names stay the chart's).
        const table = this.host.math().valueTable();
        const names = program.defined.filter((d) => table.has(d.name)).map((d) => (d.params ? `${d.name}(${d.params.join(', ')})` : d.name));
        const parts = [`${t('python.card.names')}: ${names.length ? squash(names.join(', '), 80) : t('python.card.noNames')}`];
        if (program.reads.length) parts.push(`${t('python.card.reads')}: ${program.reads.join(', ')}`);
        parts.push(t('python.card.ran', { ms: result.ms }));
        if (FRAME_DEF.test(this.tool.code)) parts.push(t('python.card.moves'));
        this.infoEl.setText(parts.join(' · '));
    }

    protected summary(): string {
        const first = this.tool.code.split('\n').find((l) => l.trim() && !l.trim().startsWith('#') && !/^\s*(?:import|from)\s/.test(l));
        return first ? squash(first.trim(), 40) : t('python.kind.python');
    }
}

registerToolCard('python', (parent, item, tool, host, actions) => new PythonCard(parent, item, tool as PythonTool, host, actions));
