/*
 * The local AI server: Easy TikZ's tools (src/ai/mcp.ts) on
 * http://127.0.0.1:<port>, for AI apps (MCP at /mcp) and agents with a shell
 * (plain HTTP: /guide, /tools, /tools/<name>).
 *
 * Safety, in this order:
 *   - it listens on 127.0.0.1 only, so nothing outside this computer reaches it;
 *   - the Host header must name 127.0.0.1 or localhost (no DNS rebinding);
 *   - a request that carries an Origin header comes from a web page and is
 *     refused, and no CORS header is ever sent, so pages cannot read answers;
 *   - every request needs the token from the settings, and a POST must carry
 *     JSON (Content-Type: application/json);
 *   - one tool call runs at a time, bodies are small, connections are capped;
 *   - the tools add easy-tikz blocks to Markdown notes (at the end, below a
 *     heading or in place of a placeholder line) and replace them, never
 *     anything else and never in files with instructions for AI agents, and
 *     the plugin shows a notice for every write.
 */
import * as http from 'http';
import type { IncomingMessage, Server, ServerResponse } from 'http';
import GUIDE from '../../docs/ai.md';
import { ChartHost, SERVER_NAME, callTool, handleMcp, toolList } from './mcp';

/** Default port; the settings can change it. */
export const DEFAULT_AI_PORT = 27150;
/** Largest request body accepted (a chart is a few KB). */
const MAX_BODY = 256 * 1024;
/** Connections served at once; AI apps use one or two. */
const MAX_CONNECTIONS = 16;

export interface RequestHead {
    method: string;
    url: string;
    headers: Record<string, string | string[] | undefined>;
}

export type Gate = { ok: true } | { ok: false; status: number; message: string };

function header(head: RequestHead, name: string): string {
    const v = head.headers[name];
    return Array.isArray(v) ? v.join(',') : v ?? '';
}

/** Constant-time comparison, so the token cannot be guessed from response times. */
function sameSecret(a: string, b: string): boolean {
    if (!a || !b || a.length !== b.length) return false;
    let diff = 0;
    for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
    return diff === 0;
}

/** Whether a request may be served (pure, see tests/ai.test.ts). */
export function gate(head: RequestHead, token: string, port: number): Gate {
    const host = header(head, 'host').toLowerCase();
    const allowedHosts = [`127.0.0.1:${port}`, `localhost:${port}`, `[::1]:${port}`];
    if (!allowedHosts.includes(host)) return { ok: false, status: 421, message: `Host must be 127.0.0.1:${port}` };
    if (header(head, 'origin')) return { ok: false, status: 403, message: 'Requests from web pages are not allowed.' };
    const [, query = ''] = head.url.split('?');
    const auth = header(head, 'authorization');
    const bearer = /^Bearer\s+(.+)$/i.exec(auth.trim());
    // ?token= as well: some apps drop custom headers on tool calls.
    const inUrl = new URLSearchParams(query).get('token') || '';
    const given = bearer ? bearer[1].trim() : inUrl;
    if (!sameSecret(given, token)) {
        return { ok: false, status: 401, message: 'Missing or wrong token. Send "Authorization: Bearer <token>" or add ?token=<token>; the token is in the Easy TikZ settings under AI access.' };
    }
    return { ok: true };
}

export class AiServer {
    private server: Server | null = null;

    constructor(
        private readonly host: ChartHost,
        private readonly opts: { port: number; token: string }
    ) {}

    get port(): number {
        return this.opts.port;
    }

    /** Start listening; rejects with a readable message when the port is taken. */
    start(): Promise<void> {
        // connectionsCheckingInterval (Node 18.4+) enforces the timeouts below every second.
        const options = { connectionsCheckingInterval: 1000 } as unknown as http.ServerOptions;
        const server = http.createServer(options, (req, res) => void this.serve(req, res));
        server.requestTimeout = 10000;
        server.headersTimeout = 5000;
        server.maxConnections = MAX_CONNECTIONS;
        this.server = server;
        return new Promise((resolve, reject) => {
            const fail = (e: NodeJS.ErrnoException) => {
                this.server = null;
                reject(new Error(e.code === 'EADDRINUSE' ? `Port ${this.opts.port} is already in use. Choose another one in the settings.` : e.message));
            };
            server.once('error', fail);
            server.listen(this.opts.port, '127.0.0.1', () => {
                server.off('error', fail);
                // An error after start (too many open files, ...) must never become an uncaught exception in Obsidian.
                server.on('error', () => undefined);
                resolve();
            });
        });
    }

    /** Tool calls run one after another: each may compute a chart on Obsidian's main thread. */
    private queue: Promise<unknown> = Promise.resolve();

    private serial<T>(run: () => Promise<T>): Promise<T> {
        const next = this.queue.then(run, run);
        this.queue = next.catch(() => undefined);
        return next;
    }

    stop(): Promise<void> {
        const server = this.server;
        this.server = null;
        if (!server) return Promise.resolve();
        return new Promise((resolve) => {
            server.close(() => resolve());
            // Keep-alive connections of AI apps would hold close() open (Node 18.2+).
            (server as Server & { closeAllConnections?: () => void }).closeAllConnections?.();
        });
    }

    private async serve(req: IncomingMessage, res: ServerResponse): Promise<void> {
        const head: RequestHead = { method: req.method || 'GET', url: req.url || '/', headers: req.headers };
        const g = gate(head, this.opts.token, this.opts.port);
        if (!g.ok) return send(res, g.status, { error: g.message });
        const path = head.url.split('?')[0].replace(/\/+$/, '') || '/';
        if (head.method === 'POST' && !/^application\/json\b/i.test(String(req.headers['content-type'] || ''))) {
            return send(res, 415, { error: 'Send the body as JSON, with the header Content-Type: application/json.' });
        }
        try {
            if (head.method === 'GET' && path === '/') {
                return send(res, 200, { name: SERVER_NAME, mcp: '/mcp', guide: '/guide', tools: '/tools', call: 'POST /tools/<name> with the arguments as JSON' });
            }
            if (head.method === 'GET' && path === '/guide') return sendText(res, 200, GUIDE, 'text/markdown; charset=utf-8');
            if (head.method === 'GET' && path === '/tools') return send(res, 200, { tools: toolList() });
            if (path === '/mcp') {
                if (head.method !== 'POST') {
                    res.setHeader('Allow', 'POST');
                    return send(res, 405, { error: 'This server answers MCP over POST only (no event stream).' });
                }
                const body = await readJson(req);
                const answer = await this.serial(() => handleMcp(body, this.host));
                if (answer === null) {
                    res.writeHead(202);
                    res.end();
                    return;
                }
                return send(res, 200, answer);
            }
            const call = /^\/tools\/([A-Za-z_]+)$/.exec(path);
            if (call && head.method === 'POST') {
                const args = await readJson(req, true);
                const result = await this.serial(() => callTool(call[1], args, this.host));
                const textOut = result.content.filter((c): c is { type: 'text'; text: string } => c.type === 'text').map((c) => c.text).join('\n');
                const image = result.content.find((c): c is { type: 'image'; data: string; mimeType: string } => c.type === 'image');
                return send(res, 200, { ok: !result.isError, text: textOut, ...(image ? { image: { mimeType: image.mimeType, base64: image.data } } : {}) });
            }
            return send(res, 404, { error: `Nothing at ${head.method} ${path}. Try GET /guide, GET /tools or POST /tools/<name>.` });
        } catch (e) {
            return send(res, 400, { error: e instanceof Error ? e.message : String(e) });
        }
    }
}

function send(res: ServerResponse, status: number, body: unknown): void {
    sendText(res, status, JSON.stringify(body), 'application/json; charset=utf-8');
}

function sendText(res: ServerResponse, status: number, body: string, type: string): void {
    res.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
    res.end(body);
}

function readJson(req: IncomingMessage, emptyIsObject = false): Promise<unknown> {
    return new Promise((resolve, reject) => {
        let raw = '';
        req.setEncoding('utf8');
        req.on('data', (chunk: string) => {
            raw += chunk;
            if (raw.length > MAX_BODY) {
                reject(new Error('The request body is too large.'));
                req.destroy();
            }
        });
        req.on('end', () => {
            const body = raw.trim();
            if (!body) return emptyIsObject ? resolve({}) : reject(new Error('The request body is empty.'));
            try {
                resolve(JSON.parse(body));
            } catch (e) {
                reject(new Error(`The request body is not valid JSON: ${e instanceof Error ? e.message : String(e)}`));
            }
        });
        req.on('error', reject);
    });
}
