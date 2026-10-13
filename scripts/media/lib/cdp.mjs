/* eslint-env node */
/* global WebSocket */
// Minimal Chrome DevTools Protocol client. No dependencies: Node 22+ ships
// global fetch and WebSocket. Used for the isolated Obsidian (lib/obsidian.mjs)
// and for headless Chromium page renders (promo cards).
//
//   const cdp = await connect({ port: 9341 });
//   await cdp.send('Page.enable');
//   const title = await cdp.evaluate('document.title');
//   const n = await cdp.call((a, b) => a + b, 2, 3);     // runs in the page
//   cdp.close();
import fs from 'node:fs';
import path from 'node:path';

export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Poll `probe` until it returns something truthy; throws `message` after `timeout` ms. */
export async function waitFor(probe, { timeout = 10000, interval = 50, message = 'condition' } = {}) {
    const start = Date.now();
    let lastError = null;
    for (;;) {
        try {
            const value = await probe();
            if (value) return value;
        } catch (e) {
            lastError = e;
        }
        if (Date.now() - start > timeout) {
            const detail = lastError ? ` (last error: ${lastError.message})` : '';
            throw new Error(`Timed out after ${timeout} ms waiting for ${message}${detail}`);
        }
        await sleep(interval);
    }
}

/** The page targets a debugging port offers, or null while nothing listens there. */
export async function listTargets(port, host = '127.0.0.1') {
    try {
        const res = await fetch(`http://${host}:${port}/json/list`, { signal: AbortSignal.timeout(2000) });
        return await res.json();
    } catch {
        return null;
    }
}

const isObsidianPage = (t) => t.type === 'page' && typeof t.url === 'string' && t.url.startsWith('app://obsidian.md');

/**
 * Connect to a page target.
 *   port      debugging port (required)
 *   match     picks the target from /json/list (default: the Obsidian app page)
 *   timeout   how long to wait for the target to appear (ms)
 */
export async function connect({ port, host = '127.0.0.1', match = isObsidianPage, timeout = 30000 } = {}) {
    if (!port) throw new Error('connect: a port is required');
    const target = await waitFor(
        async () => {
            const list = await listTargets(port, host);
            return list ? list.find(match) : null;
        },
        { timeout, interval: 200, message: `a page target on port ${port}` }
    );

    const ws = new WebSocket(target.webSocketDebuggerUrl);
    await new Promise((resolve, reject) => {
        ws.onopen = resolve;
        ws.onerror = (e) => reject(new Error(`WebSocket to ${target.webSocketDebuggerUrl} failed: ${e.message || e.type}`));
    });

    let nextId = 0;
    let closed = false;
    const pending = new Map();
    const listeners = new Set();

    ws.onmessage = (ev) => {
        const msg = JSON.parse(ev.data);
        if (msg.id && pending.has(msg.id)) {
            const { resolve, reject, method, timer } = pending.get(msg.id);
            pending.delete(msg.id);
            clearTimeout(timer);
            if (msg.error) reject(new Error(`${method}: ${msg.error.message}${msg.error.data ? ` (${msg.error.data})` : ''}`));
            else resolve(msg.result);
            return;
        }
        if (msg.method) for (const l of listeners) l(msg.method, msg.params || {});
    };
    ws.onclose = () => {
        closed = true;
        for (const { reject, method, timer } of pending.values()) {
            clearTimeout(timer);
            reject(new Error(`${method}: connection closed`));
        }
        pending.clear();
    };

    /** Send one protocol command. `timeout` (ms) guards calls that can hang (screenshots of an occluded window). */
    function send(method, params = {}, { timeout: ms = 30000 } = {}) {
        if (closed) return Promise.reject(new Error(`${method}: connection closed`));
        return new Promise((resolve, reject) => {
            const id = ++nextId;
            const timer = setTimeout(() => {
                if (!pending.has(id)) return;
                pending.delete(id);
                reject(new Error(`${method}: no answer after ${ms} ms`));
            }, ms);
            pending.set(id, { resolve, reject, method, timer });
            ws.send(JSON.stringify({ id, method, params }));
        });
    }

    function describeException(details) {
        const ex = details.exception;
        return (ex && (ex.description || ex.value)) || details.text || 'evaluation failed';
    }

    /** Evaluate an expression in the page; promises are awaited, the value comes back as JSON. */
    async function evaluate(expression, { timeout: ms = 30000 } = {}) {
        const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true, userGesture: true }, { timeout: ms });
        if (r.exceptionDetails) throw new Error(`page: ${describeException(r.exceptionDetails)}`);
        return r.result.value;
    }

    /**
     * Run a function in the page with JSON arguments: `call((a, b) => a + b, 1, 2)`.
     * The function is sent as source text, so it cannot use anything from the
     * calling module's scope.
     */
    function call(fn, ...args) {
        return evaluate(`(${fn.toString()})(...${JSON.stringify(args)})`);
    }

    /** PNG screenshot; `params` go to Page.captureScreenshot (clip, format, ...). */
    async function screenshot(file, params = {}) {
        const r = await send('Page.captureScreenshot', { format: 'png', ...params }, { timeout: 20000 });
        const buffer = Buffer.from(r.data, 'base64');
        if (file) {
            fs.mkdirSync(path.dirname(path.resolve(file)), { recursive: true });
            fs.writeFileSync(file, buffer);
        }
        return buffer;
    }

    return {
        target,
        send,
        evaluate,
        call,
        screenshot,
        /** Listen to protocol events: `on((method, params) => ...)`; returns an unsubscribe function. */
        on(listener) {
            listeners.add(listener);
            return () => listeners.delete(listener);
        },
        get closed() {
            return closed;
        },
        close() {
            if (!closed) ws.close();
            closed = true;
        },
    };
}
