/*
 * The AI server's view of Obsidian (ChartHost of src/ai/mcp.ts): which note
 * is open, where a note named by an AI app lives, writing chart blocks into
 * notes (with a notice that offers Undo), and drawing a chart as a PNG the
 * way a note draws it.
 */
import { App, Notice, TFile, normalizePath } from 'obsidian';
import type { ChartHost, NoteInfo } from './mcp';
import type { Data } from './charttool';
import { SettingsManager } from '../settings';
import { SVGRenderer } from '../renderer';
import { SVG3DRenderer } from '../renderer3d';
import { MATH_REDRAW_LIMIT } from '../mathlabel';
import { exportableSvg, svgToPng } from '../svgExport';

/** How long the notice about a change by an AI app stays (ms). */
const NOTICE_MS = 10000;

export class VaultChartHost implements ChartHost {
    /** The last write, for the notice's Undo. */
    private last: { path: string; before: string | null; after: string } | null = null;

    constructor(
        private readonly app: App,
        readonly version: string
    ) {}

    activeNote(): NoteInfo | null {
        const file = this.app.workspace.getActiveFile();
        if (!file || file.extension !== 'md') return null;
        const headings = this.app.metadataCache.getFileCache(file)?.headings ?? [];
        return { path: file.path, headings: headings.map((h) => `${'#'.repeat(h.level)} ${h.heading}`) };
    }

    resolveNote(note: string): { path: string; exists: boolean } {
        let p = note.trim().replace(/\\/g, '/').replace(/^\/+/, '');
        if (!p) throw new Error('"note" is empty.');
        // Control and direction marks could make the notice show another path; ":" could reach outside the vault.
        if (Array.from(p).some(unsafeChar)) throw new Error('"note" has characters a note name cannot have here (control or direction marks, or ":").');
        p = normalizePath(p);
        if (p.split('/').some((seg) => seg === '..' || seg.startsWith('.'))) {
            throw new Error(`"${note}": notes in hidden folders, and paths with "..", cannot be written.`);
        }
        if (!/\.md$/i.test(p)) {
            if (/\.[A-Za-z0-9]{1,8}$/.test(p.split('/').pop() || '')) throw new Error(`"${note}" is not a Markdown note (.md).`);
            // A name such as "Linear Programming": the note a [[link]] to it would open.
            const linked = this.app.metadataCache.getFirstLinkpathDest(p, '');
            if (linked && linked.extension === 'md') return { path: linked.path, exists: true };
            p = `${p}.md`;
        }
        const file = this.app.vault.getAbstractFileByPath(p);
        if (file instanceof TFile) return { path: file.path, exists: true };
        if (file) throw new Error(`"${p}" is a folder.`);
        return { path: p, exists: false };
    }

    async read(path: string): Promise<string> {
        const file = this.app.vault.getAbstractFileByPath(path);
        if (!(file instanceof TFile)) throw new Error(`There is no note ${path}.`);
        return this.app.vault.read(file);
    }

    async write(path: string, update: (old: string) => string): Promise<void> {
        const file = this.app.vault.getAbstractFileByPath(path);
        if (file instanceof TFile) {
            let before = '';
            let after = '';
            // process() is atomic: the note cannot change between reading and writing.
            await this.app.vault.process(file, (old) => {
                before = old;
                after = update(old);
                return after;
            });
            this.last = { path, before, after };
            return;
        }
        const text = update('');
        const dir = path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '';
        if (dir && !this.app.vault.getAbstractFileByPath(dir)) await this.app.vault.createFolder(dir);
        await this.app.vault.create(path, text);
        this.last = { path, before: null, after: text };
    }

    notify(message: string, path: string): void {
        const last = this.last && this.last.path === path ? this.last : null;
        const fragment = createFragment((f) => {
            f.appendText(`Easy TikZ: ${message} to ${path}. `);
            const open = f.createEl('a', { text: 'Open', href: '#' });
            open.addEventListener('click', (e) => {
                e.preventDefault();
                void this.app.workspace.openLinkText(path, '', false);
            });
            if (last && last.before !== null) {
                f.appendText(' · ');
                const undo = f.createEl('a', { text: 'Undo', href: '#' });
                undo.addEventListener('click', (e) => {
                    e.preventDefault();
                    void this.undo(last);
                });
            }
        });
        new Notice(fragment, NOTICE_MS);
    }

    /** Put a note back as it was before the AI app's write, unless it has changed since. */
    private async undo(change: { path: string; before: string | null; after: string }): Promise<void> {
        const file = this.app.vault.getAbstractFileByPath(change.path);
        if (!(file instanceof TFile) || change.before === null) return;
        let undone = false;
        await this.app.vault.process(file, (now) => {
            if (now !== change.after) return now;
            undone = true;
            return change.before as string;
        });
        new Notice(undone ? `Easy TikZ: undone in ${change.path}.` : `Easy TikZ: ${change.path} has changed since, so nothing was undone.`);
    }

    async renderPng(chart: Data): Promise<string | null> {
        const settings = SettingsManager.fromJSON(JSON.parse(JSON.stringify(chart)) as Data);
        const math = settings.createMathContext({ memo: false });
        const config = settings.toRendererConfig(math);
        const doc = activeDocument;
        // Off screen, but in the page: labels are measured with the page's fonts.
        const stage = doc.body.createDiv({ cls: 'etz-ai-render' });
        try {
            let svg: SVGElement | null = null;
            if (config.is3D) {
                const renderer = new SVG3DRenderer();
                stage.appendChild(renderer.getElement());
                renderer.renderSvg(config, { math });
                svg = renderer.getElement().querySelector<SVGElement>(':scope > svg');
            } else {
                for (let pass = 0; pass <= MATH_REDRAW_LIMIT; pass++) {
                    const renderer = new SVGRenderer(config, { math, quality: 'full' });
                    const drawn = renderer.render();
                    stage.empty();
                    stage.appendChild(drawn);
                    svg = drawn;
                    // A `$...$` label is measured before MathJax has styled it: draw once more when it has.
                    if (!renderer.mathSettled || !(await renderer.mathSettled)) break;
                }
            }
            if (!svg) return null;
            const background = getComputedStyle(doc.body).getPropertyValue('--background-primary').trim() || '#ffffff';
            const png = await svgToPng(exportableSvg(svg, doc), 2, background);
            return arrayBufferToBase64(await png.arrayBuffer());
        } finally {
            stage.remove();
        }
    }
}

function arrayBufferToBase64(buffer: ArrayBuffer): string {
    const bytes = new Uint8Array(buffer);
    let binary = '';
    const CHUNK = 0x8000;
    for (let i = 0; i < bytes.length; i += CHUNK) binary += String.fromCharCode(...Array.from(bytes.subarray(i, i + CHUNK)));
    return btoa(binary);
}

/** Control characters, direction marks (which can make a path read differently) and ":" (a drive or URL scheme). */
function unsafeChar(ch: string): boolean {
    const c = ch.charCodeAt(0);
    return c < 0x20 || c === 0x7f || c === 0x200e || c === 0x200f || (c >= 0x202a && c <= 0x202e) || (c >= 0x2066 && c <= 0x2069) || ch === ':';
}
