/*
 * Connecting AI apps to the local AI server: the token, the lines each app
 * needs (shown with Copy buttons under Settings > AI access), and the
 * section of AGENTS.md / CLAUDE.md that tells agents working in the vault
 * how to make charts. Pure, so tests/ai.test.ts covers it. What a person
 * reads (where each snippet goes) is in their language when it is read;
 * the snippets and the section for agents stay English.
 */
import { t } from '../i18n';

export interface AiApp {
    id: string;
    name: string;
    /** Where the snippet goes, one sentence. */
    where: string;
    snippet(url: string, token: string): string;
}

const json = (value: unknown) => JSON.stringify(value, null, 2);

/** The MCP address of the server. */
export function mcpUrl(port: number): string {
    return `http://127.0.0.1:${port}/mcp`;
}

export const AI_APPS: AiApp[] = [
    {
        id: 'claude-code',
        name: 'Claude Code',
        get where() {
            return t('problems.ai.whereClaudeCode');
        },
        snippet: (url, token) => `claude mcp add --transport http --scope user easy-tikz ${url} --header "Authorization: Bearer ${token}"`,
    },
    {
        id: 'codex',
        name: 'Codex (OpenAI)',
        get where() {
            return t('problems.ai.whereCodex');
        },
        snippet: (url, token) => `codex mcp add easy-tikz --url ${url} --bearer-token-env-var EASY_TIKZ_TOKEN\nexport EASY_TIKZ_TOKEN=${token}`,
    },
    {
        id: 'gemini',
        name: 'Gemini CLI',
        get where() {
            return t('problems.ai.whereGemini');
        },
        snippet: (url, token) => `gemini mcp add --scope user --transport http --header "Authorization: Bearer ${token}" easy-tikz ${url}`,
    },
    {
        id: 'cursor',
        name: 'Cursor',
        get where() {
            return t('problems.ai.whereCursor');
        },
        snippet: (url, token) => json({ mcpServers: { 'easy-tikz': { url: `${url}?token=${token}` } } }),
    },
    {
        id: 'vscode',
        name: 'VS Code (Copilot)',
        get where() {
            return t('problems.ai.whereVsCode');
        },
        snippet: (url, token) => json({ servers: { 'easy-tikz': { type: 'http', url, headers: { Authorization: `Bearer ${token}` } } } }),
    },
    {
        id: 'claude-desktop',
        name: 'Claude Desktop',
        get where() {
            return t('problems.ai.whereClaudeDesktop');
        },
        // mcp-remote below 0.1.16 had a command injection (CVE-2025-6514); the range never takes those.
        snippet: (url, token) => json({ mcpServers: { 'easy-tikz': { command: 'npx', args: ['-y', 'mcp-remote@^0.1.16', `${url}?token=${token}`] } } }),
    },
    {
        id: 'lm-studio',
        name: 'LM Studio',
        get where() {
            return t('problems.ai.whereLmStudio');
        },
        snippet: (url, token) => json({ mcpServers: { 'easy-tikz': { url: `${url}?token=${token}` } } }),
    },
    {
        id: 'shell',
        get name() {
            return t('problems.ai.shellName');
        },
        get where() {
            return t('problems.ai.whereShell');
        },
        // A prompt for the agent: it stays English.
        snippet: (url, token) =>
            `Easy Graphs, Charts & TikZ (an Obsidian plugin) makes charts in my notes. Read its guide first: curl -s "${url.replace(/\/mcp$/, '')}/guide?token=${token}". Then use POST /tools/check_chart and POST /tools/add_chart as the guide describes, with the same ?token=.`,
    },
];

/** A new random token (32 hex characters). */
export function newToken(): string {
    const bytes = new Uint8Array(16);
    crypto.getRandomValues(bytes);
    return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

const START = '<!-- easy-tikz:start -->';
const END = '<!-- easy-tikz:end -->';

/** The token as the settings and the AI tab show it: enough to recognise, not enough to use. Copy buttons copy the real one. */
export function maskToken(token: string): string {
    return token.length > 8 ? `${token.slice(0, 4)}...${token.slice(-4)}` : '...';
}

/** A snippet as shown on screen: the token masked (screenshots and screen shares). */
export function shownSnippet(app: AiApp, url: string, token: string): string {
    return app.snippet(url, token).split(token).join(maskToken(token));
}

/** What agents working in the vault need to know, for AGENTS.md and CLAUDE.md. No token: it stays in the plugin's data file. */
export function agentsSection(configDir: string, port: number, version = 'main'): string {
    const base = `http://127.0.0.1:${port}`;
    return [
        START,
        '## Charts with Easy Graphs, Charts & TikZ',
        '',
        'This vault uses the Easy Graphs, Charts & TikZ plugin: a chart is an `easy-tikz` code block in a note, a few lines of text with one line per object (or one JSON object), and Obsidian draws it.',
        '',
        `- While Obsidian runs with AI access switched on, the plugin's AI server answers at ${base}. Every request needs the token: \`?token=<aiToken>\` or the header \`Authorization: Bearer <aiToken>\`, with aiToken from \`${configDir}/plugins/easy-tikz/data.json\`.`,
        `- Read the guide first: \`GET ${base}/guide\`. Then check every chart with \`POST ${base}/tools/check_chart\` and add it with \`POST ${base}/tools/add_chart\` (JSON body \`{"chart": "<the block's lines>", "note": "..."}\`).`,
        `- When the server does not answer, follow https://github.com/Saiki77/easy-tikz/blob/${version}/docs/ai.md (the guide of the installed version) and write the block into the note yourself.`,
        '- Never change other blocks than the ones you were asked about.',
        END,
    ].join('\n');
}

/** A note's text with the Easy Graphs, Charts & TikZ section put in: replaced where it was, otherwise added at the end. */
export function mergeAgentsSection(old: string, section: string): string {
    const a = old.indexOf(START);
    const b = old.indexOf(END);
    if (a >= 0 && b > a) return old.slice(0, a) + section + old.slice(b + END.length);
    const trimmed = old.replace(/\s+$/, '');
    return (trimmed ? `${trimmed}\n\n` : '') + section + '\n';
}
