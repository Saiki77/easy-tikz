/*
 * The tools of the Easy TikZ AI server, and the Model Context Protocol (MCP)
 * around them. Any AI app that speaks MCP, or any agent that can send an
 * HTTP request, gets the guide, the examples, the plugin's own checks, a
 * picture of the chart, and a way to put the chart into a note.
 *
 * Nothing here touches Obsidian: the vault, the open note, pictures and
 * notices come through a ChartHost (src/ai/vaultHost.ts in the plugin, a
 * fake one in tests/ai.test.ts). The HTTP side is src/ai/server.ts.
 */
import GUIDE from '../../docs/ai.md';
import { Data, Report, blocksOf, check, examples, fenced, minimize, parseJson, tikzOf, withSliders } from './charttool';

export const SERVER_NAME = 'easy-tikz';

/** MCP versions this server speaks, newest first. A client asking for another one gets the newest. */
export const PROTOCOL_VERSIONS = ['2025-06-18', '2025-03-26', '2024-11-05'];

/** What the server tells an AI app when it connects (MCP `instructions`). */
export const INSTRUCTIONS = [
    'Easy TikZ draws charts in Obsidian notes from `easy-tikz` code blocks: one JSON object per chart (function plots, tangents, areas between curves, feasible regions and linear programs, level curves, 3D, live sliders).',
    'Before your first chart, read the guide with get_guide (the sections "Rules that prevent most mistakes" and the field tables at least).',
    'Then: start from get_example, run check_chart until it reports no problems and its computed values match the request, look at it with render_chart, and put it into the note with add_chart (it refuses charts with problems).',
    'Never write easy-tikz blocks into notes by hand while these tools are available. The plugin does not differentiate or integrate: slopes and areas in labels are formulas you work out.',
].join('\n');

export interface NoteInfo {
    path: string;
    headings: string[];
}

/** What the tools need from Obsidian. */
export interface ChartHost {
    /** Plugin version, for serverInfo. */
    version: string;
    /** The Markdown note open in the editor, or null. */
    activeNote(): NoteInfo | null;
    /**
     * A note given as a path or a name: the path of an existing note, or the
     * path a new one gets. Throws (with a message for the AI) for a path
     * outside the vault, a hidden folder or a file that is not Markdown.
     */
    resolveNote(note: string): { path: string; exists: boolean };
    read(path: string): Promise<string>;
    /** Replace a note's text through `update` (old text, '' for a new note); creates the note and its folders when missing. */
    write(path: string, update: (old: string) => string): Promise<void>;
    /** The chart as a PNG (base64), drawn as the note would draw it; null when it cannot be drawn here. */
    renderPng?(chart: Data): Promise<string | null>;
    /** Tell the user what an AI app changed. */
    notify(message: string, path: string): void;
}

export type Content = { type: 'text'; text: string } | { type: 'image'; data: string; mimeType: string };

export interface ToolResult {
    content: Content[];
    isError?: boolean;
}

interface ToolDef {
    name: string;
    title: string;
    description: string;
    inputSchema: Record<string, unknown>;
    annotations?: Record<string, unknown>;
    run(args: Record<string, unknown>, host: ChartHost): Promise<ToolResult>;
}

/** A mistake in the arguments: becomes a tool result with isError, which the AI reads and fixes. */
class ToolError extends Error {}

const text = (t: string, isError = false): ToolResult => ({ content: [{ type: 'text', text: t }], ...(isError ? { isError } : {}) });

const CHART_SCHEMA = {
    type: 'object',
    description: 'The chart: the JSON object of an easy-tikz block, starting with "v": 4 (see get_guide). A JSON string or a fenced block is accepted too.',
};
const SLIDERS_SCHEMA = {
    type: 'object',
    description: 'Optional slider values to use instead of the saved ones, such as {"a": 2}: check the ends of each range.',
    additionalProperties: { type: 'number' },
};
const NOTE_SCHEMA = {
    type: 'string',
    description: 'The note: a vault path such as "Courses/Linear Programming.md", or a note name. Left out: the note open in Obsidian.',
};

/** The chart argument as an object: an object, a JSON string, or a fenced easy-tikz block. */
function chartArg(value: unknown): Data {
    if (value && typeof value === 'object' && !Array.isArray(value)) return value as Data;
    if (typeof value === 'string') {
        const blocks = blocksOf(value);
        const source = blocks.length ? blocks[0].text : value;
        const parsed = parseJson(source);
        if (parsed.ok) return parsed.data;
        throw new ToolError(`"chart" is not valid JSON: ${parsed.message}`);
    }
    throw new ToolError('"chart" is required: the JSON object of an easy-tikz block (see get_guide).');
}

function slidersArg(value: unknown): Record<string, number> {
    if (value === undefined || value === null) return {};
    if (typeof value !== 'object' || Array.isArray(value)) throw new ToolError('"sliders" must be an object such as {"a": 2}.');
    const out: Record<string, number> = {};
    for (const [k, v] of Object.entries(value as Data)) out[k] = Number(v);
    return out;
}

function stringArg(args: Record<string, unknown>, key: string): string | undefined {
    const v = args[key];
    if (v === undefined || v === null || v === '') return undefined;
    if (typeof v !== 'string') throw new ToolError(`"${key}" must be a string.`);
    return v;
}

/** The report of check_chart as text: a head line, problems, notes, then what the chart computes. */
export function reportText(r: Report): string {
    const head = r.errors.length ? `${r.errors.length} problem${r.errors.length > 1 ? 's' : ''}: fix them, then check again.` : 'OK: renders without problems.';
    const out = [head];
    for (const e of r.errors) out.push(`PROBLEM ${e}`);
    for (const e of r.infos) out.push(`NOTE ${e}`);
    if (r.lines.length) out.push('', 'What the chart shows:', ...r.lines);
    return out.join('\n');
}

function notePath(host: ChartHost, note: string | undefined): { path: string; exists: boolean } {
    if (note) return host.resolveNote(note);
    const active = host.activeNote();
    if (!active) throw new ToolError('No note is open in Obsidian. Give "note": a path such as "Charts/Demand.md" or a note name.');
    return { path: active.path, exists: true };
}

/**
 * Lines of the note that are code or frontmatter (0-based): `after` and
 * `replace` never match there, so a chart cannot land inside a code block
 * or the note's properties.
 */
function shieldedLines(lines: string[]): Set<number> {
    const out = new Set<number>();
    let i = 0;
    if (lines.length && lines[0].trim() === '---') {
        const close = lines.findIndex((l, k) => k > 0 && (l.trim() === '---' || l.trim() === '...'));
        const last = close < 0 ? lines.length - 1 : close;
        for (let k = 0; k <= last; k++) out.add(k);
        i = last + 1;
    }
    let fence: string | null = null;
    for (; i < lines.length; i++) {
        const m = /^\s*(?:>\s*)*(`{3,}|~{3,})/.exec(lines[i]);
        if (fence) {
            out.add(i);
            if (m && m[1][0] === fence[0] && m[1].length >= fence.length) fence = null;
        } else if (m) {
            fence = m[1];
            out.add(i);
        }
    }
    return out;
}

/**
 * A note's text with a chart block put in: in place of a placeholder line
 * (`replace`: the whole line, once), right below a line (`after`: the whole
 * line, or a heading's text without its #), or at the end. Only whole lines
 * outside code blocks and frontmatter match, and the answer names line
 * numbers, never the text of the note.
 */
export function insertBlock(old: string, block: string, opts: { after?: string; replace?: string }): { text: string; line: number; below?: number } {
    const lines = old.length ? old.split('\n') : [];
    const shielded = shieldedLines(lines);
    const free = (k: number) => !shielded.has(k);
    if (opts.replace !== undefined) {
        const want = opts.replace.trim();
        if (!want || want.includes('\n') || want.length > 200) throw new ToolError('"replace" takes one placeholder line of the note, such as "(chart goes here)", at most 200 characters.');
        const hits = lines.map((l, k) => (free(k) && l.trim() === want ? k : -1)).filter((k) => k >= 0);
        if (hits.length !== 1) throw new ToolError(`"replace": the note needs exactly one line that is just ${JSON.stringify(want)} (outside code blocks and frontmatter). Use "after" with a heading instead, or leave both out to add the chart at the end.`);
        const k = hits[0];
        const indent = /^\s*/.exec(lines[k])?.[0] ?? '';
        const out = [...lines.slice(0, k), ...block.split('\n').map((l) => indent + l), ...lines.slice(k + 1)];
        return { text: out.join('\n'), line: k + 1 };
    }
    if (opts.after !== undefined) {
        const want = opts.after.trim();
        const heading = (l: string) => /^#{1,6}\s+(.*?)\s*#*\s*$/.exec(l.trim())?.[1] ?? null;
        let i = lines.findIndex((l, k) => free(k) && want !== '' && l.trim() === want);
        if (i < 0) i = lines.findIndex((l, k) => free(k) && want !== '' && heading(l)?.toLowerCase() === want.replace(/^#+\s*/, '').toLowerCase());
        if (i < 0) throw new ToolError(`"after": no heading and no whole line of the note is ${JSON.stringify(want)} (outside code blocks and frontmatter). active_note lists the headings.`);
        const before = lines.slice(0, i + 1);
        const rest = lines.slice(i + 1);
        // Right below that line, with a blank line on both sides of the block.
        const out = [...before, '', ...block.split('\n'), ...(rest.length && rest[0].trim() !== '' ? [''] : []), ...rest];
        return { text: out.join('\n'), line: i + 3, below: i + 1 };
    }
    while (lines.length && lines[lines.length - 1].trim() === '') lines.pop();
    const out = lines.length ? [...lines, '', ...block.split('\n'), ''] : [...block.split('\n'), ''];
    return { text: out.join('\n'), line: lines.length ? lines.length + 2 : 1 };
}

/** Files AI agents read as instructions: a chart never goes there, whatever the note argument says. */
const INSTRUCTION_FILES = new Set(['agents.md', 'claude.md', 'claude.local.md', 'gemini.md', 'codex.md', 'copilot-instructions.md', 'cursor.md', 'warp.md', 'conventions.md']);

function writable(path: string): void {
    const base = (path.split('/').pop() || '').toLowerCase();
    if (INSTRUCTION_FILES.has(base)) throw new ToolError(`${path} holds instructions for AI agents; Easy TikZ does not write charts there. Choose another note.`);
}

/** Check a chart and refuse it when the check reports problems. */
function checked(chart: Data): Report {
    const r = check(chart);
    if (r.errors.length) throw new ToolError(`Not written: the chart has problems.\n\n${reportText(r)}`);
    return r;
}

function chartsIn(textOfNote: string) {
    return blocksOf(textOfNote).filter((b) => b.line > 0);
}

const TOOLS: ToolDef[] = [
    {
        name: 'get_guide',
        title: 'Read the Easy TikZ guide',
        description: 'How Easy TikZ charts are written: the workflow, the rules that prevent most mistakes, every field, formulas, labels and recipes. Read it before the first chart. Give "section" (a heading, such as "Rules" or "points") for one part.',
        inputSchema: { type: 'object', properties: { section: { type: 'string', description: 'Optional: words from a heading of the guide.' } } },
        annotations: { readOnlyHint: true },
        async run(args) {
            const section = stringArg(args, 'section');
            if (!section) return text(GUIDE);
            const parts = GUIDE.split(/\n(?=#{2,3} )/);
            const want = section.toLowerCase();
            const hit = parts.filter((p) => (p.split('\n')[0] || '').toLowerCase().includes(want));
            if (!hit.length) {
                const heads = parts.map((p) => p.split('\n')[0]).filter((h) => h.startsWith('#'));
                throw new ToolError(`No section matches "${section}". Sections: ${heads.map((h) => h.replace(/^#+ /, '')).join('; ')}`);
            }
            return text(hit.join('\n\n'));
        },
    },
    {
        name: 'list_examples',
        title: 'List example charts',
        description: 'Ready-made charts to start from: id, title and what each shows (linear program, areas between curves, tangent, level curves, market surplus, 3D, and the finished chart of every guide).',
        inputSchema: { type: 'object', properties: {} },
        annotations: { readOnlyHint: true },
        async run() {
            return text(examples().map((e) => `${e.id}: ${e.title}. ${e.about}`).join('\n'));
        },
    },
    {
        name: 'get_example',
        title: 'Get an example chart',
        description: 'One example chart as an easy-tikz block (default fields left out), to adapt.',
        inputSchema: { type: 'object', properties: { id: { type: 'string', description: 'An id from list_examples, such as "lp" or "tangent".' } }, required: ['id'] },
        annotations: { readOnlyHint: true },
        async run(args) {
            const id = stringArg(args, 'id');
            const e = examples().find((x) => x.id === id);
            if (!e) throw new ToolError(`No example "${id ?? ''}". Ids: ${examples().map((x) => x.id).join(', ')}`);
            return text(`${e.title}: ${e.about}\n\n${fenced(minimize(JSON.parse(JSON.stringify(e.data)) as Data))}`);
        },
    },
    {
        name: 'check_chart',
        title: 'Check a chart',
        description: "Check a chart with the plugin's own code. Lists problems (including fields the plugin would ignore) and what the chart computes: where regions are shaded, where curves are drawn, computed points and values, the final text and place of every label. Use \"sliders\" to check other slider values.",
        inputSchema: { type: 'object', properties: { chart: CHART_SCHEMA, sliders: SLIDERS_SCHEMA }, required: ['chart'] },
        annotations: { readOnlyHint: true },
        async run(args) {
            return text(reportText(check(chartArg(args.chart), slidersArg(args.sliders))));
        },
    },
    {
        name: 'render_chart',
        title: 'Show a chart',
        description: 'A picture of the chart (PNG), drawn by the plugin as the note will show it. Look at it before you add the chart: overlapping labels, a view that cuts things off, colours.',
        inputSchema: { type: 'object', properties: { chart: CHART_SCHEMA, sliders: SLIDERS_SCHEMA }, required: ['chart'] },
        annotations: { readOnlyHint: true },
        async run(args, host) {
            const chart = withSliders(chartArg(args.chart), slidersArg(args.sliders));
            const r = check(chart);
            if (r.errors.some((e) => e.startsWith('too large'))) return text(`Not drawn: the chart is over the limits.\n\n${reportText(r)}`, true);
            if (!host.renderPng) return text(`Pictures are not available here.\n\n${reportText(r)}`, true);
            const png = await host.renderPng(chart);
            if (!png) return text(`The chart could not be drawn.\n\n${reportText(r)}`, true);
            const summary = r.errors.length ? `${r.errors.length} problem(s): run check_chart.` : 'Renders without problems.';
            return { content: [{ type: 'image', data: png, mimeType: 'image/png' }, { type: 'text', text: summary }] };
        },
    },
    {
        name: 'add_chart',
        title: 'Add a chart to a note',
        description:
            'Check the chart and write it into a note as an easy-tikz block; Obsidian shows it at once. Refused while the check reports problems. Without "note" it goes into the note open in Obsidian. A note that does not exist is only made with "create": true. Put the chart right below a heading or line with "after" (the whole line, or the text of a heading such as "Results") or in place of a placeholder line with "replace"; otherwise it goes at the end. Lines in code blocks and frontmatter never match, and notes with instructions for AI agents (AGENTS.md, CLAUDE.md, ...) are never written.',
        inputSchema: {
            type: 'object',
            properties: {
                chart: CHART_SCHEMA,
                note: NOTE_SCHEMA,
                after: { type: 'string', description: 'Optional: a heading or whole line of the note to put the chart right below, such as "## Graphical solution" or just "Graphical solution". An error when none matches.' },
                replace: { type: 'string', description: 'Optional: a placeholder line to replace with the chart, such as "(chart goes here)": the whole line, exactly once in the note, at most 200 characters.' },
                create: { type: 'boolean', description: 'Optional: true to make the note when it does not exist yet. Without it a missing note is an error, so a misspelt name never makes a stray note.' },
            },
            required: ['chart'],
        },
        annotations: { destructiveHint: true, idempotentHint: false },
        async run(args, host) {
            const chart = chartArg(args.chart);
            const r = checked(chart);
            const { path, exists } = notePath(host, stringArg(args, 'note'));
            writable(path);
            if (!exists && args.create !== true) {
                throw new ToolError(`There is no note ${path}. Check the name (active_note shows the open note), or pass "create": true to make it.`);
            }
            const block = fenced(chart);
            let where = '';
            const replace = stringArg(args, 'replace');
            await host.write(path, (old) => {
                const done = insertBlock(old, block, { after: stringArg(args, 'after'), replace });
                where = replace !== undefined ? ` in place of line ${done.line}` : done.below ? ` below line ${done.below}; the chart starts at line ${done.line}` : ` at line ${done.line}`;
                return done.text;
            });
            host.notify(exists ? 'An AI app added a chart' : 'An AI app made a new note with a chart', path);
            return text(`${exists ? `Added to ${path}${where}` : `Made the note ${path}`}.\n\n${reportText(r)}`);
        },
    },
    {
        name: 'list_charts',
        title: 'List the charts in a note',
        description: 'The easy-tikz charts in a note, numbered, each with its JSON and whether it has problems. Use it before update_chart.',
        inputSchema: { type: 'object', properties: { note: NOTE_SCHEMA } },
        annotations: { readOnlyHint: true },
        async run(args, host) {
            const { path, exists } = notePath(host, stringArg(args, 'note'));
            if (!exists) throw new ToolError(`There is no note ${path}.`);
            const blocks = chartsIn(await host.read(path));
            if (!blocks.length) return text(`${path} has no easy-tikz charts.`);
            const out = [`${path}: ${blocks.length} chart${blocks.length > 1 ? 's' : ''}.`];
            blocks.forEach((b, i) => {
                const parsed = parseJson(b.text);
                const state = parsed.ok ? (check(parsed.data).errors.length ? 'has problems' : 'ok') : `not valid JSON: ${parsed.message}`;
                out.push('', `Chart ${i + 1} (line ${b.line}, ${state}):`, b.text.trim());
            });
            return text(out.join('\n'));
        },
    },
    {
        name: 'update_chart',
        title: 'Replace a chart in a note',
        description: 'Check the chart and put it in place of chart number "index" (from list_charts) of the note. Refused while the check reports problems.',
        inputSchema: {
            type: 'object',
            properties: { index: { type: 'integer', minimum: 1, description: 'Which chart of the note, counting from 1.' }, chart: CHART_SCHEMA, note: NOTE_SCHEMA },
            required: ['index', 'chart'],
        },
        annotations: { destructiveHint: true, idempotentHint: true },
        async run(args, host) {
            const chart = chartArg(args.chart);
            const index = Number(args.index);
            const r = checked(chart);
            const { path, exists } = notePath(host, stringArg(args, 'note'));
            writable(path);
            if (!exists) throw new ToolError(`There is no note ${path}. Use add_chart for a new one.`);
            await host.write(path, (old) => {
                const blocks = chartsIn(old);
                if (!Number.isInteger(index) || index < 1 || index > blocks.length) {
                    throw new ToolError(`"index" must be 1..${blocks.length}: the note has ${blocks.length} chart${blocks.length === 1 ? '' : 's'}.`);
                }
                const b = blocks[index - 1];
                if (!b.end) throw new ToolError(`Chart ${index} has no closing fence; fix the note first.`);
                const lines = old.split('\n');
                const json = fenced(chart).split('\n').slice(1, -1);
                lines.splice(b.line, b.end - b.line - 1, ...json.map((l) => b.prefix + l));
                return lines.join('\n');
            });
            host.notify(`An AI app changed chart ${index}`, path);
            return text(`Chart ${index} of ${path} replaced.\n\n${reportText(r)}`);
        },
    },
    {
        name: 'export_latex',
        title: 'Export a chart as LaTeX',
        description: 'The pgfplots code the plugin exports (it compiles with pdflatex). Sliders are written with their current values. "standalone" false gives only the tikzpicture.',
        inputSchema: { type: 'object', properties: { chart: CHART_SCHEMA, standalone: { type: 'boolean', description: 'Default true: a complete document.' } }, required: ['chart'] },
        annotations: { readOnlyHint: true },
        async run(args) {
            return text(tikzOf(chartArg(args.chart), args.standalone !== false));
        },
    },
    {
        name: 'active_note',
        title: 'The open note',
        description: 'The note open in Obsidian: its path, headings and how many charts it has.',
        inputSchema: { type: 'object', properties: {} },
        annotations: { readOnlyHint: true },
        async run(_args, host) {
            const active = host.activeNote();
            if (!active) return text('No Markdown note is open in Obsidian.');
            const count = chartsIn(await host.read(active.path)).length;
            const heads = active.headings.length ? `\nHeadings:\n${active.headings.join('\n')}` : '\nNo headings.';
            return text(`${active.path} (${count} chart${count === 1 ? '' : 's'})${heads}`);
        },
    },
];

export function toolList(): Array<Pick<ToolDef, 'name' | 'title' | 'description' | 'inputSchema' | 'annotations'>> {
    return TOOLS.map(({ name, title, description, inputSchema, annotations }) => ({ name, title, description, inputSchema, ...(annotations ? { annotations } : {}) }));
}

/** Run a tool. Mistakes in the arguments come back as a result with isError, so the AI can fix them. */
export async function callTool(name: string, args: unknown, host: ChartHost): Promise<ToolResult> {
    const tool = TOOLS.find((t) => t.name === name);
    if (!tool) return text(`Unknown tool "${name}". Tools: ${TOOLS.map((t) => t.name).join(', ')}`, true);
    try {
        return await tool.run(args && typeof args === 'object' && !Array.isArray(args) ? (args as Record<string, unknown>) : {}, host);
    } catch (e) {
        if (e instanceof ToolError) return text(e.message, true);
        return text(`The tool failed: ${e instanceof Error ? e.message : String(e)}`, true);
    }
}

// ------------------------------------------------------------- JSON-RPC

interface RpcRequest {
    jsonrpc?: string;
    id?: string | number | null;
    method?: string;
    params?: Record<string, unknown>;
}

type RpcResponse = { jsonrpc: '2.0'; id: string | number | null; result: unknown } | { jsonrpc: '2.0'; id: string | number | null; error: { code: number; message: string } };

const rpcError = (id: RpcRequest['id'], code: number, message: string): RpcResponse => ({ jsonrpc: '2.0', id: id ?? null, error: { code, message } });

/**
 * Answer one MCP message (or a batch). Returns null when nothing is owed:
 * for notifications and responses, which the HTTP side answers with 202.
 */
export async function handleMcp(message: unknown, host: ChartHost): Promise<RpcResponse | RpcResponse[] | null> {
    // MCP 2025-06-18 has no batches; one message per request also keeps one chart computing at a time.
    if (Array.isArray(message)) return rpcError(null, -32600, 'Batches are not supported: send one JSON-RPC message per request.');
    if (!message || typeof message !== 'object') return rpcError(null, -32600, 'Invalid request');
    const msg = message as RpcRequest;
    try {
        return await handleOne(msg, host);
    } catch (e) {
        return msg.id === undefined ? null : rpcError(msg.id, -32603, `Internal error: ${e instanceof Error ? e.message : String(e)}`);
    }
}

async function handleOne(msg: RpcRequest, host: ChartHost): Promise<RpcResponse | null> {
    if (typeof msg.method !== 'string') {
        // A response from the client has a result or an error; anything else is not a message.
        const reply = msg as { result?: unknown; error?: unknown };
        return 'result' in reply || 'error' in reply ? null : rpcError(msg.id ?? null, -32600, 'Invalid request: no method');
    }
    const isNotification = msg.id === undefined;
    const ok = (result: unknown): RpcResponse | null => (isNotification ? null : { jsonrpc: '2.0', id: msg.id ?? null, result });
    const params: Record<string, unknown> = msg.params && typeof msg.params === 'object' && !Array.isArray(msg.params) ? msg.params : {};
    switch (msg.method) {
        case 'initialize': {
            const asked = typeof params.protocolVersion === 'string' ? params.protocolVersion : '';
            return ok({
                protocolVersion: PROTOCOL_VERSIONS.includes(asked) ? asked : PROTOCOL_VERSIONS[0],
                capabilities: { tools: { listChanged: false }, resources: { listChanged: false }, prompts: { listChanged: false } },
                serverInfo: { name: SERVER_NAME, title: 'Easy TikZ', version: host.version },
                instructions: INSTRUCTIONS,
            });
        }
        case 'ping':
            return ok({});
        case 'tools/list':
            return ok({ tools: toolList() });
        case 'tools/call': {
            const name = typeof params.name === 'string' ? params.name : '';
            return ok(await callTool(name, params.arguments, host));
        }
        case 'resources/list':
            return ok({ resources: [{ uri: 'easy-tikz://guide', name: 'guide', title: 'Easy TikZ guide for AI assistants', mimeType: 'text/markdown' }] });
        case 'resources/read':
            if (params.uri !== 'easy-tikz://guide') return isNotification ? null : rpcError(msg.id, -32002, `Unknown resource ${typeof params.uri === 'string' ? params.uri : ''}`);
            return ok({ contents: [{ uri: 'easy-tikz://guide', mimeType: 'text/markdown', text: GUIDE }] });
        case 'resources/templates/list':
            return ok({ resourceTemplates: [] });
        case 'prompts/list':
            return ok({
                prompts: [
                    {
                        name: 'make_chart',
                        title: 'Make an Easy TikZ chart',
                        description: 'Describe a chart; the AI builds it with the Easy TikZ tools and puts it into the open note.',
                        arguments: [{ name: 'description', description: 'What to draw', required: true }],
                    },
                ],
            });
        case 'prompts/get': {
            if (params.name !== 'make_chart') return isNotification ? null : rpcError(msg.id, -32602, `Unknown prompt ${typeof params.name === 'string' ? params.name : ''}`);
            const args = (params.arguments && typeof params.arguments === 'object' ? params.arguments : {}) as Record<string, unknown>;
            const description = typeof args.description === 'string' ? args.description : '';
            return ok({
                messages: [
                    {
                        role: 'user',
                        content: {
                            type: 'text',
                            text: `Make this chart with the Easy TikZ tools and put it into the note open in Obsidian: ${description}\n\nRead get_guide first if you have not, start from get_example, run check_chart until it is clean, look at render_chart, then add_chart.`,
                        },
                    },
                ],
            });
        }
        default:
            if (msg.method.startsWith('notifications/')) return null;
            return isNotification ? null : rpcError(msg.id, -32601, `Method not found: ${msg.method}`);
    }
}
