/*
 * AI tab: making charts with AI, three ways, in the order most people meet them.
 *
 *   1. AI apps on this computer (Claude Code, Codex, Cursor, VS Code, ...):
 *      switch on the local AI server (src/ai/server.ts) and copy the one line
 *      the app needs. The app then reads the guide, checks charts and adds
 *      them to notes by itself.
 *   2. AI chats that cannot reach this computer (ChatGPT, claude.ai, Gemini):
 *      copy the guide into the chat, and paste the block the AI writes back
 *      here, where it opens checked.
 *   3. AI agents working in the vault: a short section in AGENTS.md and
 *      CLAUDE.md, the files they read on their own.
 *
 * The switch and the token are the same settings as Settings > AI access.
 */
import { Platform, setIcon } from 'obsidian';
import { PanelHost, PluginHost } from './host';
import { TextButtonHandle, chip, dropdown, textButton, uniqueId } from './kit';
import { AI_APPS, mcpUrl, shownSnippet } from '../ai/connect';
import { chartFromText } from '../text/paste';
import { readClipboardText } from './clipboard';
import { t } from '../i18n';

export interface AiPanelHandle {
    el: HTMLElement;
    /** Re-read the server state (the tab became visible; the settings may have changed it). */
    refresh(): void;
}

/** An example request to give an AI app, ready to copy (in the reader's language: the app reads it as they would write it). */
const exampleRequest = (): string => t('panels.ai.example');

/**
 * Append `text`, a message whose named places are left unfilled, to `el`:
 * its words as text, and each {place} made by its function, so a
 * translation can put a link or code wherever its word order wants it.
 */
function appendWithPlaces(el: HTMLElement, text: string, places: Record<string, (into: HTMLElement) => void>): void {
    text.split(/\{(\w+)\}/).forEach((part, i) => {
        if (i % 2 === 0) {
            if (part) el.appendText(part);
        } else if (places[part]) places[part](el);
        else el.appendText(`{${part}}`);
    });
}

/** Names joined with "and" ('AGENTS.md and CLAUDE.md'). */
function joinAnd(names: string[]): string {
    return names.reduce((all, name) => (all ? t('panels.ai.agents.and', { first: all, second: name }) : name), '');
}

export function createAiPanel(parent: HTMLElement, host: PanelHost): AiPanelHandle {
    const el = parent.createDiv({ cls: 'etz-ai-panel' });
    const plugin: PluginHost | null = host.plugin;

    const head = el.createDiv({ cls: 'etz-ai-head' });
    head.createEl('h2', { cls: 'etz-ai-title', text: t('panels.ai.title') });
    head.createEl('p', {
        cls: 'etz-ai-lead',
        text: t('panels.ai.lead'),
    });

    const card = (icon: string, title: string, lead: string) => {
        const section = el.createEl('section', { cls: 'etz-ai-card' });
        const h = section.createDiv({ cls: 'etz-ai-card-head' });
        setIcon(h.createSpan({ cls: 'etz-ai-card-icon' }), icon);
        const heading = h.createEl('h3', { cls: 'etz-ai-card-title', text: title });
        heading.id = uniqueId('ai-card');
        section.setAttr('aria-labelledby', heading.id);
        section.createEl('p', { cls: 'etz-ai-card-lead', text: lead });
        return section;
    };

    /** A status line under a button: what happened, or what went wrong. */
    const note = (parent: HTMLElement) => {
        const line = parent.createDiv({ cls: ['etz-ai-note', 'tikz-hidden'], attr: { role: 'status' } });
        return (text: string, bad = false) => {
            line.setText(text);
            line.toggleClass('tikz-hidden', !text);
            line.toggleClass('is-error', bad);
        };
    };

    const copy = async (text: string, button: TextButtonHandle) => {
        try {
            await navigator.clipboard.writeText(text);
            const label = button.el.textContent || '';
            button.setText(t('common.copied'));
            window.setTimeout(() => button.setText(label), 1500);
        } catch {
            button.setText(t('panels.ai.copyFailed'));
        }
    };

    // ------------------------------------------------ 1. AI apps on this computer
    // Phones and tablets have no AI server: the card says where it is.
    const desktop = Platform.isDesktop;
    const apps = card(
        'bot',
        desktop ? t('panels.ai.apps.title') : t('panels.ai.apps.titleMobile'),
        desktop ? t('panels.ai.apps.lead') : t('panels.ai.apps.leadMobile')
    );
    const serverRow = apps.createDiv({ cls: 'etz-ai-row' });
    const statusEl = apps.createDiv({ cls: 'etz-ai-status', attr: { role: 'status' } });
    const connect = apps.createDiv({ cls: 'etz-ai-connect' });
    let appIndex = 0;

    const toggle =
        desktop && plugin?.setAiServer
        ? chip(serverRow, {
              label: t('panels.ai.apps.toggle'),
              value: plugin.aiInfo?.().enabled ?? false,
              onChange: (on) => {
                  void plugin.setAiServer?.(on).then(render);
              },
          })
        : null;
    if (!toggle && desktop) serverRow.createDiv({ cls: 'etz-ai-note', text: t('panels.ai.apps.unavailable') });

    function render() {
        const info = plugin?.aiInfo?.();
        if (!info || !desktop) return;
        toggle?.setValue(info.enabled);
        statusEl.empty();
        statusEl.toggleClass('is-error', info.enabled && !info.running);
        if (!info.enabled) {
            statusEl.setText(t('panels.ai.apps.off'));
        } else if (info.running) {
            appendWithPlaces(statusEl, t('panels.ai.apps.running'), { url: (into) => into.createEl('code', { text: mcpUrl(info.port) }) });
        } else {
            statusEl.setText(t('panels.ai.apps.notRunning', { message: info.message || t('panels.ai.apps.starting') }));
        }
        connect.empty();
        connect.toggleClass('tikz-hidden', !info.enabled);
        if (!info.enabled) return;

        const pick = connect.createDiv({ cls: 'etz-ai-row' });
        pick.createSpan({ cls: 'etz-ai-label', text: t('panels.ai.apps.yourApp') });
        dropdown(pick, {
            label: t('panels.ai.apps.yourAiApp'),
            options: AI_APPS.map((a, i) => ({ value: String(i), text: a.name })),
            value: String(appIndex),
            onChange: (v) => {
                appIndex = Number(v) || 0;
                show();
            },
        });
        const where = connect.createEl('p', { cls: 'etz-ai-where' });
        const snippet = connect.createEl('pre', { cls: 'etz-ai-snippet' });
        const actions = connect.createDiv({ cls: 'etz-ai-row' });
        const text = () => AI_APPS[appIndex].snippet(mcpUrl(info.port), info.token);
        const copyBtn = textButton(actions, { text: t('common.copy'), icon: 'copy', variant: 'cta', size: 'sm', onClick: () => void copy(text(), copyBtn) });
        const tokenBtn = textButton(actions, { text: t('panels.ai.apps.newToken'), icon: 'refresh-cw', size: 'sm', onClick: () => void plugin?.newAiToken?.().then(render) });
        tokenBtn.el.setAttr('aria-label', t('panels.ai.apps.newTokenHint'));
        const show = () => {
            where.setText(AI_APPS[appIndex].where);
            // The token is masked on screen; Copy copies the real one.
            snippet.setText(shownSnippet(AI_APPS[appIndex], mcpUrl(info.port), info.token));
        };
        show();

        const ask = connect.createDiv({ cls: 'etz-ai-ask' });
        ask.createDiv({ cls: 'etz-ai-label', text: t('panels.ai.apps.ask') });
        const example = exampleRequest();
        ask.createEl('blockquote', { cls: 'etz-ai-example', text: example });
        const askBtn = textButton(ask, { text: t('panels.ai.apps.copyExample'), icon: 'copy', size: 'sm', variant: 'link', onClick: () => void copy(example, askBtn) });
    }

    // ------------------------------------------------ 2. AI chats
    const chats = card('message-square', t('panels.ai.chats.title'), t('panels.ai.chats.lead'));
    const steps = chats.createEl('ol', { cls: 'etz-ai-steps' });
    const step1 = steps.createEl('li');
    step1.appendText(t('panels.ai.chats.step1') + ' ');
    const guideBtn = textButton(step1, {
        text: t('panels.ai.chats.copyGuide'),
        icon: 'copy',
        size: 'sm',
        onClick: () => {
            if (plugin?.aiGuideText) void copy(plugin.aiGuideText(), guideBtn);
        },
    });
    steps.createEl('li', { text: t('panels.ai.chats.step2') });
    const step3 = steps.createEl('li');
    step3.appendText(t('panels.ai.chats.step3') + ' ');
    textButton(step3, { text: t('panels.ai.chats.paste'), icon: 'clipboard-paste', size: 'sm', variant: 'cta', onClick: () => void pasteChart() });
    const pasteNote = note(chats);

    async function pasteChart() {
        // 6.2.1: the clipboard is read as the editor's Paste a chart reads it (src/ui/clipboard.ts).
        const read = await readClipboardText();
        if (!read.ok) {
            pasteNote(read.message, true);
            return;
        }
        const chart = chartFromText(read.text);
        if (typeof chart === 'string') {
            pasteNote(chart, true);
            return;
        }
        pasteNote('');
        // Onto the Build tab once the chart is in: a cancelled Replace keeps the reader here.
        host.loadChart(chart, () => host.showTab('build'));
    }

    // ------------------------------------------------ 3. Agents in this vault
    const agents = card('folder-open', t('panels.ai.agents.title'), t('panels.ai.agents.lead'));
    const agentRow = agents.createDiv({ cls: 'etz-ai-row' });
    const agentNote = note(agents);
    textButton(agentRow, {
        text: t('panels.ai.agents.add'),
        icon: 'file-plus',
        size: 'sm',
        onClick: () => {
            if (!plugin?.writeAgentFiles) return;
            plugin.writeAgentFiles().then(
                (files) => agentNote(t('panels.ai.agents.added', { files: joinAnd(files) })),
                (e) => agentNote(t('panels.ai.agents.failed', { message: e instanceof Error ? e.message : String(e) }), true)
            );
        },
    });

    const foot = el.createEl('p', { cls: 'etz-ai-foot' });
    appendWithPlaces(foot, t('panels.ai.foot'), {
        link: (into) => into.createEl('a', { text: 'docs/ai.md', href: 'https://github.com/Saiki77/easy-tikz/blob/main/docs/ai.md' }),
    });

    render();
    return { el, refresh: render };
}
