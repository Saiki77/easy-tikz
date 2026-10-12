/*
 * Code tab: the generated TikZ, a "Standalone document" switch and Copy.
 *
 * The textarea is only regenerated while the tab is visible (on show, on a
 * Standalone switch, and a moment after the trailing full-quality render,
 * see TikzModal.scheduleCodeRefresh), and never over hand edits: once the
 * user types into it, `edited` is set and a banner offers Regenerate or
 * Keep edits instead. Copy (here and in the action bar) copies the textarea
 * only while it holds hand edits; otherwise it copies freshly generated
 * code, so a stale textarea never reaches the clipboard.
 */
import { PanelHost } from './host';
import { BannerHandle, ChipHandle, TextButtonHandle, banner, chip, textButton, uniqueId, visuallyHidden } from './kit';

export interface CodePanelOptions {
    /** Fresh TikZ for the current chart (throws when the exporter fails). */
    generate(): string;
    /** True while the Code tab is the visible one. */
    isVisible(): boolean;
    /** Put `text` on the clipboard and give feedback on `button`. */
    copy(text: string, button: TextButtonHandle): void;
}

export interface CodePanelHandle {
    el: HTMLElement;
    /** The tab became visible: regenerate unless edited by hand. */
    onShow(): void;
    /** The chart settled after a full-quality render: regenerate while visible, unless edited by hand. */
    onFullRender(): void;
    /** Text for Copy TikZ: the hand-edited textarea, else freshly generated code. Throws like generate(). */
    copyText(): string;
    /** True while the textarea holds hand edits. */
    isEdited(): boolean;
    /** Re-read settings into the controls (chart loaded). */
    refresh(): void;
}

export function createCodePanel(parent: HTMLElement, host: PanelHost, opts: CodePanelOptions): CodePanelHandle {
    const el = parent.createDiv({ cls: 'etz-code-panel' });

    const toolbar = el.createDiv({ cls: 'etz-code-toolbar' });
    const standalone: ChipHandle = chip(toolbar, {
        label: 'Standalone document',
        value: host.settings.isStandalone(),
        onChange: (on) => {
            host.settings.setValue('documentSetup', on);
            host.requestUpdate();
            // The switch lives in this tab: show its effect now, not after the trailing refresh.
            update();
        },
    });
    toolbar.createDiv({ cls: 'etz-code-hint', text: 'Off: only the tikzpicture, with the packages it needs as comments.' });
    const copyBtn = textButton(toolbar, {
        text: 'Copy',
        icon: 'copy',
        size: 'sm',
        onClick: () => {
            let text: string;
            try {
                text = copyText();
            } catch (e) {
                showError(e);
                return;
            }
            opts.copy(text, copyBtn);
        },
    });

    const bannerSlot = el.createDiv({ cls: 'etz-code-banner' });
    const errorEl = el.createDiv({ cls: ['etz-code-error', 'tikz-hidden'], attr: { role: 'status' } });
    const textarea = el.createEl('textarea', {
        cls: 'etz-code-textarea',
        attr: { spellcheck: 'false', autocomplete: 'off', autocapitalize: 'off', wrap: 'off' },
    });
    const labelEl = visuallyHidden(el, 'TikZ code');
    labelEl.id = uniqueId('code');
    textarea.setAttr('aria-labelledby', labelEl.id);

    /** True once the user typed into the textarea; cleared by every regeneration. */
    let edited = false;
    /** Fresh code at the moment the user chose Keep edits; the banner returns when the chart moves on. */
    let keptFor: string | null = null;
    let bannerHandle: BannerHandle | null = null;

    const showError = (e: unknown) => {
        const message = e instanceof Error ? e.message : String(e);
        errorEl.setText(`Could not generate TikZ: ${message}`);
        errorEl.removeClass('tikz-hidden');
    };
    const clearError = () => {
        errorEl.setText('');
        errorEl.addClass('tikz-hidden');
    };

    /** Fresh code, or null after showing the exporter's error. */
    const tryGenerate = (): string | null => {
        try {
            const code = opts.generate();
            clearError();
            return code;
        } catch (e) {
            showError(e);
            return null;
        }
    };

    const hideBanner = () => {
        if (bannerHandle) bannerHandle.remove();
        bannerHandle = null;
    };

    const regenerate = () => {
        const code = tryGenerate();
        if (code === null) return;
        textarea.value = code;
        edited = false;
        keptFor = null;
        hideBanner();
    };

    const showBanner = () => {
        if (bannerHandle) return;
        bannerHandle = banner(bannerSlot, {
            text: 'Edited by hand. Chart changes are not applied here.',
            note: 'Insert into note saves the chart settings, not this text.',
            tone: 'warning',
            actions: [
                { text: 'Regenerate', cta: true, onClick: () => regenerate() },
                {
                    text: 'Keep edits',
                    onClick: () => {
                        keptFor = tryGenerate();
                        hideBanner();
                        textarea.focus();
                    },
                },
            ],
        });
    };

    const update = () => {
        if (!edited) {
            regenerate();
            return;
        }
        const fresh = tryGenerate();
        if (fresh === null || fresh !== keptFor) showBanner();
    };

    const copyText = (): string => (edited ? textarea.value : opts.generate());

    textarea.addEventListener('input', () => {
        if (edited) return;
        edited = true;
        keptFor = null;
        showBanner();
    });

    return {
        el,
        onShow: update,
        onFullRender: () => {
            if (opts.isVisible()) update();
        },
        copyText,
        isEdited: () => edited,
        refresh: () => {
            standalone.setValue(host.settings.isStandalone());
            if (opts.isVisible()) update();
        },
    };
}
