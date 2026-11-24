/*
 * 6.0 A: the let definitions of a chart, from its tools (type 'value'), as
 * the MathContext takes them (MathContextInput.values). Pure: no DOM, no
 * Obsidian.
 */
import type { ValueDefinition } from './table';

/** The definitions of the value tools in `tools`, in their order. */
export function valueDefinitions(tools: unknown): ValueDefinition[] {
    if (!Array.isArray(tools)) return [];
    const out: ValueDefinition[] = [];
    for (const t of tools) {
        if (!t || typeof t !== 'object') continue;
        const type: unknown = Reflect.get(t, 'type');
        const name: unknown = Reflect.get(t, 'name');
        if (type !== 'value' || typeof name !== 'string') continue;
        const params: unknown = Reflect.get(t, 'params');
        const expression: unknown = Reflect.get(t, 'expression');
        out.push({
            name,
            params: typeof params === 'string' && params.trim() ? params.split(',').map((p) => p.trim()) : [],
            expression: typeof expression === 'string' ? expression : '',
        });
    }
    return out;
}
