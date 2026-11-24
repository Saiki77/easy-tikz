/*
 * The pictures of coloured planes beside the note (6.0 E): Copy LaTeX in
 * the editor saves the PNGs its code reads (`\addplot graphics {plane-....png}`)
 * in the note's attachment folder, as the SVG files of 5.0 are saved
 * (src/svgFiles.ts). A name is the picture's hash, so a file that is there
 * already holds the same picture and is left as it is. Nothing is deleted.
 */
import { App, TFile, normalizePath } from 'obsidian';
import type { ExportFile } from './export';

/** Save the files the code needs (those it names); returns the paths it holds them at. */
export async function savePictures(app: App, files: ExportFile[], code: string, notePath: string | null): Promise<string[]> {
    const wanted = files.filter((f) => code.includes(f.name));
    const paths: string[] = [];
    for (const f of wanted) {
        const free = await app.fileManager.getAvailablePathForAttachment(f.name, notePath ?? '');
        const cut = free.lastIndexOf('/');
        const folder = cut < 0 ? '' : free.slice(0, cut);
        if (folder && !app.vault.getAbstractFileByPath(folder)) {
            try {
                await app.vault.createFolder(folder);
            } catch {
                // Made in the meantime: fine.
            }
        }
        const path = normalizePath(folder ? `${folder}/${f.name}` : f.name);
        const existing = app.vault.getAbstractFileByPath(path);
        if (!(existing instanceof TFile)) {
            const bytes = f.bytes;
            await app.vault.createBinary(path, bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer);
        }
        paths.push(path);
    }
    return paths;
}
