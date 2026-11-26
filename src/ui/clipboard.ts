/*
 * Reading the clipboard's text (6.2.1): the AI tab's "Paste the chart", the
 * editor's "Paste a chart" and the command "New chart from the clipboard"
 * share it, and its message when the clipboard cannot be read (no
 * permission, some phones).
 */
import { t } from '../i18n';

export type ClipboardText = { ok: true; text: string } | { ok: false; message: string };

/** The clipboard's text, or the message that it could not be read. */
export async function readClipboardText(): Promise<ClipboardText> {
    try {
        return { ok: true, text: await navigator.clipboard.readText() };
    } catch {
        return { ok: false, message: t('panels.ai.chats.unreadable') };
    }
}
