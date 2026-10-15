/*
 * Reading an easy-tikz block the way people and AI assistants write them.
 * The editor always writes plain JSON with "v": 4; blocks typed by hand or
 * pasted from an AI chat often carry comments, trailing commas, or no "v".
 */

const V4_TOOL_TYPES = new Set(['region', 'curve', 'points', 'segment', 'plane3D']);

/**
 * JSON.parse, and on failure once more with // and /* *\/ comments and
 * trailing commas removed (outside strings). The error is the first
 * attempt's, so it points at what is really there.
 */
export function parseLenientJson(text: string): unknown {
    try {
        return JSON.parse(text);
    } catch (first) {
        const cleaned = stripJsonNoise(text);
        if (cleaned === text) throw first;
        try {
            return JSON.parse(cleaned);
        } catch {
            throw first;
        }
    }
}

/** Comments and trailing commas out, strings untouched. */
export function stripJsonNoise(text: string): string {
    let out = '';
    let i = 0;
    while (i < text.length) {
        const c = text[i];
        if (c === '"') {
            let j = i + 1;
            while (j < text.length && text[j] !== '"') j += text[j] === '\\' ? 2 : 1;
            out += text.slice(i, j + 1);
            i = j + 1;
        } else if (c === '/' && text[i + 1] === '/') {
            while (i < text.length && text[i] !== '\n') i++;
        } else if (c === '/' && text[i + 1] === '*') {
            const end = text.indexOf('*/', i + 2);
            i = end < 0 ? text.length : end + 2;
        } else {
            out += c;
            i++;
        }
    }
    return out.replace(/,(\s*[}\]])/g, '$1');
}

/**
 * Whether a block without "v" is a version 4 chart written by hand or by an
 * AI. 3.x saved every chart with all its settings, `documentClose` among
 * them, and its tools had other types; such blocks stay 3.x blocks.
 */
export function impliedV4(data: Record<string, unknown>): boolean {
    if (data.v !== undefined) return false;
    if ('documentClose' in data) return false;
    const tools = Array.isArray(data.tools) ? data.tools : [];
    for (const t of tools) {
        if (t && typeof t === 'object' && !V4_TOOL_TYPES.has(String((t as Record<string, unknown>).type))) return false;
    }
    return true;
}
