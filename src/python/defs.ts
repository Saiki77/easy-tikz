/*
 * 6.0 P: the names a chart's scripts set, as let definitions of the chart
 * (src/values/table.ts NativeValue): every formula can read them (`draw the
 * circles of c`, `plot $g(x) = f(x)$`, `mark the points of P`), and they
 * follow the sliders the script reads. Pure: no DOM, no Obsidian.
 */
import type { NativeValue, ValueDefinition } from '../values/table';
import type { Value } from '../values/types';
import { programOf, toChartValue } from './program';
import type { Program } from './program';
import { pythonTools } from './tools';
import { PyFunction } from './values';

/** The chart names a program reads, now (sliders, P1_x; undefined: no such name). */
export function inputsOf(program: Program, read: (name: string) => number | undefined): Record<string, number> {
    const out: Record<string, number> = {};
    for (const name of program.reads) {
        const v = read(name);
        if (typeof v === 'number') out[name] = v;
    }
    return out;
}

/** The program of a chart's python tools (null when it has none). */
export function chartProgram(tools: unknown): Program | null {
    const blocks = pythonTools(tools).map((t) => t.code);
    return blocks.length ? programOf(blocks) : null;
}

/** The let definitions of the names the chart's scripts set. */
export function pythonDefinitions(tools: unknown): ValueDefinition[] {
    const program = chartProgram(tools);
    if (!program) return [];
    const out: ValueDefinition[] = [];
    for (const d of program.defined) {
        // frame(t) is the script's motion, not a value.
        if (d.name === 'frame' || d.name.startsWith('_')) continue;
        const name = d.name;
        const native: NativeValue = {
            key: program.key,
            value: (read): Value => {
                const r = program.run(inputsOf(program, read));
                const v = r.globals.get(name);
                if (v === undefined || v instanceof PyFunction) return NaN;
                return toChartValue(v) ?? NaN;
            },
        };
        if (d.params && d.params.length) {
            native.call = (args, read) => {
                const r = program.run(inputsOf(program, read));
                const f = r.globals.get(name);
                if (!(f instanceof PyFunction)) return NaN;
                return r.call(f, args);
            };
        }
        out.push({ name, params: d.params ?? [], expression: program.reads.join(', '), native });
    }
    return out;
}
