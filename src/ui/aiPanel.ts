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
import { blocksOf } from '../ai/charttool';
import { parseChartText } from '../text/parse';
import { impliedV4, parseLenientJson } from '../blockjson';

export interface AiPanelHandle {
    el: HTMLElement;
    /** Re-read the server state (the tab became visible; the settings may have changed it). */
    refresh(): void;
}

/** An example request to give an AI app, ready to copy. */
const EXAMPLE_REQUEST =
    'In this note, add a chart of the feasible region x + y <= 4, x + 3y <= 6, x >= 0, y >= 0, with the line 2x + 3y = c on a slider and the point where 2x + 3y is largest.';

/** The chart of the first easy-tikz block in `text` (or of `text` itself), text or JSON, as a note would read it. */
export function chartFromText(text: string): Record<string, unknown> | string {
    const trimmed = text.trim();
    if (!trimmed) return 'The clipboard is empty.';
    const blocks = blocksOf(trimmed);
    const body = blocks.length ? blocks[0].text : trimmed;
    if (body.trim().startsWith('{')) {
        let data: unknown;
        try {
            data = parseLenientJson(body);
        } catch (e) {
            return `The chart on the clipboard is not valid JSON: ${e instanceof Error ? e.message : String(e)}`;
        }
        if (!data || typeof data !== 'object' || Array.isArray(data)) return 'The chart on the clipboard is not a JSON object.';
        const chart = data as Record<string, unknown>;
        return impliedV4(chart) ? { v: 4, ...chart } : chart;
    }
    // Text: one line per object. Outside a fence only text that reads as a chart counts.
    const parsed = parseChartText(body);
    const objects = ['parameters', 'functions', 'functions3D', 'tools', 'annotations'].some((k) => {
        const items = parsed.data[k];
        return Array.isArray(items) && items.length > 0;
    });
    if (!blocks.length && (parsed.problems.length || !objects)) {
        return 'The clipboard holds no Easy TikZ chart. Copy the whole block the AI wrote, from ```easy-tikz to the closing ```.';
    }
    if (parsed.problems.length) {
        const p = parsed.problems[0];
        const count = parsed.problems.length === 1 ? 'a problem' : `${parsed.problems.length} problems`;
        return `The chart on the clipboard has ${count}. Line ${p.line}, column ${p.column}: ${p.message}`;
    }
    if (!objects) return 'The chart on the clipboard is empty.';
    return parsed.data;
}

export function createAiPanel(parent: HTMLElement, host: PanelHost): AiPanelHandle {
    const el = parent.createDiv({ cls: 'etz-ai-panel' });
    const plugin: PluginHost | null = host.plugin;

    const head = el.createDiv({ cls: 'etz-ai-head' });
    head.createEl('h2', { cls: 'etz-ai-title', text: 'Make charts with AI' });
    head.createEl('p', {
        cls: 'etz-ai-lead',
        text: 'Describe a chart to an AI and it builds it here, checked by Easy TikZ the way the editor checks it. Pick how you use AI.',
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
            button.setText('Copied');
            window.setTimeout(() => button.setText(label), 1500);
        } catch {
            button.setText('Could not copy');
        }
    };

    // ------------------------------------------------ 1. AI apps on this computer
    // Phones and tablets have no AI server: the card says where it is.
    const desktop = Platform.isDesktop;
    const apps = card(
        'bot',
        desktop ? 'AI apps on this computer' : 'AI apps on a computer',
        desktop
            ? 'Claude Code, Codex, Cursor, VS Code, Gemini CLI, Claude Desktop, LM Studio. Switch this on and connect your app once; it then reads the chart guide, checks charts, looks at them and adds them to your notes by itself.'
            : 'Claude Code, Codex, Cursor and other AI apps connect to Obsidian on your computer: switch AI access on there. On this device, use an AI chat below.'
    );
    const serverRow = apps.createDiv({ cls: 'etz-ai-row' });
    const statusEl = apps.createDiv({ cls: 'etz-ai-status', attr: { role: 'status' } });
    const connect = apps.createDiv({ cls: 'etz-ai-connect' });
    let appIndex = 0;

    const toggle =
        desktop && plugin?.setAiServer
        ? chip(serverRow, {
              label: 'Let AI apps make charts',
              value: plugin.aiInfo?.().enabled ?? false,
              onChange: (on) => {
                  void plugin.setAiServer?.(on).then(render);
              },
          })
        : null;
    if (!toggle && desktop) serverRow.createDiv({ cls: 'etz-ai-note', text: 'Not available here: open the editor from Obsidian.' });

    function render() {
        const info = plugin?.aiInfo?.();
        if (!info || !desktop) return;
        toggle?.setValue(info.enabled);
        statusEl.empty();
        statusEl.toggleClass('is-error', info.enabled && !info.running);
        if (!info.enabled) {
            statusEl.setText('Off. Nothing listens until you switch it on. It answers only on this computer, needs a token, and only adds Easy TikZ charts to notes or replaces them; a notice shows each change.');
        } else if (info.running) {
            statusEl.appendText('Running at ');
            statusEl.createEl('code', { text: mcpUrl(info.port) });
            statusEl.appendText('.');
        } else {
            statusEl.setText(`Not running: ${info.message || 'starting...'}`);
        }
        connect.empty();
        connect.toggleClass('tikz-hidden', !info.enabled);
        if (!info.enabled) return;

        const pick = connect.createDiv({ cls: 'etz-ai-row' });
        pick.createSpan({ cls: 'etz-ai-label', text: 'Your app' });
        dropdown(pick, {
            label: 'Your AI app',
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
        const copyBtn = textButton(actions, { text: 'Copy', icon: 'copy', variant: 'cta', size: 'sm', onClick: () => void copy(text(), copyBtn) });
        const tokenBtn = textButton(actions, { text: 'New token', icon: 'refresh-cw', size: 'sm', onClick: () => void plugin?.newAiToken?.().then(render) });
        tokenBtn.el.setAttr('aria-label', 'Make a new token if this one got out, then update your apps');
        const show = () => {
            where.setText(AI_APPS[appIndex].where);
            // The token is masked on screen; Copy copies the real one.
            snippet.setText(shownSnippet(AI_APPS[appIndex], mcpUrl(info.port), info.token));
        };
        show();

        const ask = connect.createDiv({ cls: 'etz-ai-ask' });
        ask.createDiv({ cls: 'etz-ai-label', text: 'Then ask your app, for example:' });
        ask.createEl('blockquote', { cls: 'etz-ai-example', text: EXAMPLE_REQUEST });
        const askBtn = textButton(ask, { text: 'Copy the example', icon: 'copy', size: 'sm', variant: 'link', onClick: () => void copy(EXAMPLE_REQUEST, askBtn) });
    }

    // ------------------------------------------------ 2. AI chats
    const chats = card(
        'message-square',
        'AI chats: ChatGPT, Claude, Gemini',
        'Chats on the web cannot reach this computer, so they get the guide from you once per chat.'
    );
    const steps = chats.createEl('ol', { cls: 'etz-ai-steps' });
    const step1 = steps.createEl('li');
    step1.appendText('Copy the guide and paste it into the chat. ');
    const guideBtn = textButton(step1, {
        text: 'Copy the guide',
        icon: 'copy',
        size: 'sm',
        onClick: () => {
            if (plugin?.aiGuideText) void copy(plugin.aiGuideText(), guideBtn);
        },
    });
    steps.createEl('li', { text: 'Describe the chart you want.' });
    const step3 = steps.createEl('li');
    step3.appendText('Copy the block the AI writes, then paste it here: it opens in the editor, checked. ');
    textButton(step3, { text: 'Paste the chart', icon: 'clipboard-paste', size: 'sm', variant: 'cta', onClick: () => void pasteChart() });
    const pasteNote = note(chats);

    async function pasteChart() {
        let text = '';
        try {
            text = await navigator.clipboard.readText();
        } catch {
            pasteNote('The clipboard could not be read. Paste the block into a note instead: it renders there, and clicking it opens the editor.', true);
            return;
        }
        const chart = chartFromText(text);
        if (typeof chart === 'string') {
            pasteNote(chart, true);
            return;
        }
        pasteNote('');
        // Onto the Build tab once the chart is in: a cancelled Replace keeps the reader here.
        host.loadChart(chart, () => host.showTab('build'));
    }

    // ------------------------------------------------ 3. Agents in this vault
    const agents = card(
        'folder-open',
        'AI agents in this vault',
        'Agents that work in your vault folder (Claude Code, Codex, Cursor, Copilot) read AGENTS.md and CLAUDE.md on their own. A short Easy TikZ section there tells them how to make charts here.'
    );
    const agentRow = agents.createDiv({ cls: 'etz-ai-row' });
    const agentNote = note(agents);
    textButton(agentRow, {
        text: 'Add the section',
        icon: 'file-plus',
        size: 'sm',
        onClick: () => {
            if (!plugin?.writeAgentFiles) return;
            plugin.writeAgentFiles().then(
                (files) => agentNote(`Added to ${files.join(' and ')} at the top of the vault.`),
                (e) => agentNote(`Could not write the files: ${e instanceof Error ? e.message : String(e)}`, true)
            );
        },
    });

    const foot = el.createEl('p', { cls: 'etz-ai-foot' });
    foot.appendText('The full guide for AIs is also on GitHub: ');
    foot.createEl('a', { text: 'docs/ai.md', href: 'https://github.com/Saiki77/easy-tikz/blob/main/docs/ai.md' });
    foot.appendText('.');

    render();
    return { el, refresh: render };
}
