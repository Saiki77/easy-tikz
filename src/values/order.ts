/*
 * 6.0 F1: where let lines go in a printed chart. A let line (a tool of type
 * `value`) prints right after the sliders, before the functions and tools
 * that use it, so a chart reads top to bottom. The parser keeps the tools in
 * the order of their lines, so the printer moves let lines up only when the
 * values come first among the tools of their step already: the text then
 * reads back as the same chart. The editor puts a new value there
 * (insertTool). Pure: no DOM, no Obsidian.
 */

type Data = Record<string, unknown>;

const isValue = (t: unknown): boolean => !!t && typeof t === 'object' && (t as Data).type === 'value';

/**
 * Per tool, whether it is a let line that prints right after the sliders;
 * null when no tool is a value, or when a value follows another tool of its
 * step (the tools then print in their order, as before 6.0 F1).
 */
export function letLines(tools: readonly Data[], steps?: readonly number[]): boolean[] | null {
    const others = new Set<number>();
    let any = false;
    for (let i = 0; i < tools.length; i++) {
        const step = steps?.[i] ?? 0;
        if (isValue(tools[i])) {
            if (others.has(step)) return null;
            any = true;
        } else others.add(step);
    }
    return any ? tools.map(isValue) : null;
}

/** Put a new tool into a chart's tools: a value after the values that lead the list, any other tool at the end. */
export function insertTool<T>(tools: T[], tool: T): void {
    if (!isValue(tool)) {
        tools.push(tool);
        return;
    }
    let at = 0;
    while (at < tools.length && isValue(tools[at])) at++;
    tools.splice(at, 0, tool);
}
