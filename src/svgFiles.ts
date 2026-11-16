/*
 * Charts as SVG files (5.0): with the setting on, every chart of a note
 * also lives as an SVG file in the attachment folder, named after the note
 * (`Week 3 · chart 1.svg`), with a white background and the light theme's
 * colours, so Obsidian Publish, GitHub and other Markdown apps can show it
 * where the plugin does not run. The files follow the note: a save writes
 * the files whose picture changed, a short time after the last change.
 * The sliders draw at their saved values. Only the plugin's own files are
 * written; nothing is ever deleted.
 */
import { App, TFile, normalizePath } from 'obsidian';
import { readBlock } from './blockjson';
import { normalizeParameters } from './migrate';
import { SettingsManager } from './settings';
import { SVGRenderer } from './renderer';
import { SVG3DRenderer } from './renderer3d';
import { exportableSvg, stableSvgIds } from './svgExport';
import { chartFences, svgFileName } from './text/fences';
import { NoteTable, tableAbove } from './beyond/table';
import { noteLines, readsTable } from './beyond/note';
import { cloneData } from './util';

/**
 * A chart block's picture as SVG text (white background, light colours), or
 * null when it cannot be drawn. `table` gives the table above the block, for
 * a chart that reads it (`use the table above`).
 */
export function chartSvgText(body: string, doc: Document, table: () => NoteTable | null = () => null): string | null {
    const block = readBlock(body);
    if (typeof block === 'string') return null;
    const clean = chartSvgElement(block.data, doc, readsTable(block.data) ? table() : null);
    return clean ? `<?xml version="1.0" encoding="UTF-8"?>\n${stableSvgIds(new XMLSerializer().serializeToString(clean))}\n` : null;
}

/** A chart's picture as its SVG file shows it (white background, light colours, the sliders at their values), or null. */
export function chartSvgElement(data: Record<string, unknown>, doc: Document, table: NoteTable | null = null): SVGElement | null {
    try {
        const manager = SettingsManager.fromJSON(cloneData(data));
        if (table) manager.noteTable = table;
        const math = manager.createMathContext({ memo: false });
        const params = normalizeParameters(manager.getValue('parameters'));
        math.setParams(params);
        const config = manager.toRendererConfig(math);
        config.parameters = params;
        let svg: SVGElement | null = null;
        if (config.is3D) {
            const renderer = new SVG3DRenderer();
            renderer.renderSvg(config, { math });
            svg = renderer.getElement().querySelector<SVGElement>(':scope > svg');
        } else {
            svg = new SVGRenderer(config, { math }).render();
        }
        return svg ? exportableSvg(svg, doc, { white: true }) : null;
    } catch {
        return null;
    }
}

/** How long after the last change of a note its files are written. */
const WRITE_DELAY_MS = 1500;

export class SvgFiles {
    private readonly timers = new Map<string, number>();

    constructor(
        private readonly app: App,
        private readonly tags: () => ReadonlySet<string>
    ) {}

    /** A note changed: write its files after a short pause (a new change starts the pause again). */
    schedule(file: TFile): void {
        if (file.extension !== 'md') return;
        const old = this.timers.get(file.path);
        if (old !== undefined) window.clearTimeout(old);
        this.timers.set(
            file.path,
            window.setTimeout(() => {
                this.timers.delete(file.path);
                void this.write(file);
            }, WRITE_DELAY_MS)
        );
    }

    /** Stop the waiting writes (the plugin unloads or the setting went off). */
    cancel(): void {
        for (const id of this.timers.values()) window.clearTimeout(id);
        this.timers.clear();
    }

    /** Write the SVG files of a note's charts now. Returns how many files were written (unchanged ones are not). */
    async write(file: TFile): Promise<number> {
        if (!(this.app.vault.getAbstractFileByPath(file.path) instanceof TFile)) return 0;
        const lines = noteLines(await this.app.vault.cachedRead(file));
        const fences = chartFences(lines.length, (n) => lines[n - 1] ?? '', this.tags());
        let written = 0;
        let folder: string | null = null;
        for (let i = 0; i < fences.length; i++) {
            const fence = fences[i];
            const svg = chartSvgText(fence.body, activeDocument, () => tableAbove(lines, fence.first));
            if (svg === null) continue;
            const name = svgFileName(file.basename, i);
            if (folder === null) folder = await this.folderFor(name, file.path);
            const path = normalizePath(folder ? `${folder}/${name}` : name);
            const existing = this.app.vault.getAbstractFileByPath(path);
            if (existing instanceof TFile) {
                if ((await this.app.vault.read(existing)) === svg) continue;
                await this.app.vault.modify(existing, svg);
            } else if (!existing) {
                await this.app.vault.create(path, svg);
            } else continue;
            written++;
        }
        return written;
    }

    /** The attachment folder for the note (made when it is missing). */
    private async folderFor(name: string, notePath: string): Promise<string> {
        const free = await this.app.fileManager.getAvailablePathForAttachment(name, notePath);
        const cut = free.lastIndexOf('/');
        const folder = cut < 0 ? '' : free.slice(0, cut);
        if (folder && !this.app.vault.getAbstractFileByPath(folder)) {
            try {
                await this.app.vault.createFolder(folder);
            } catch {
                // Made in the meantime: fine.
            }
        }
        return folder;
    }
}
