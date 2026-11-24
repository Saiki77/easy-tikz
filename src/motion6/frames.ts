/*
 * Frames (6.0): a chart with steps and the chart line `frames` exports every
 * step side by side, one small tikzpicture per step in a row (each a normal
 * pgfplots axis, so nothing new is needed in the preamble). Without `frames`
 * the export shows the last step: the whole chart. Pure: no DOM.
 */
import { atStep, lastStep } from './steps';

type Data = Record<string, unknown>;

/** A frame is this share of the chart's size, and never narrower than MIN_FRAME_CM. */
const FRAME_SCALE = 0.5;
const MIN_FRAME_CM = 3;
/** The gap between two frames. */
const FRAME_GAP = '\\hspace{4mm}';

/** The chart exports its steps as frames: `frames` and more than one step. */
export function exportsFrames(data: Data): boolean {
    return data.frames === true && lastStep(data) > 0;
}

const num = (v: unknown, fallback: number): number => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : fallback);

/**
 * The pgfplots code of every step in a row. `picture` makes the code of one
 * chart (the plugin's export); each step is exported as a snippet at a
 * smaller size, and the frames share one preamble (a standalone document
 * when the chart is one, else the `% Needs:` lines).
 */
export function framesTikz(data: Data, picture: (step: Data) => string): string {
    const last = lastStep(data);
    const standalone = data.documentSetup !== false;
    const w = num(data.size_x_cm, 10);
    const h = num(data.size_y_cm, 10);
    const scale = Math.max(FRAME_SCALE, MIN_FRAME_CM / Math.min(w, h));
    const size = (v: number) => Number((v * Math.min(1, scale)).toFixed(2));
    const needs: string[] = [];
    const frames: string[][] = [];
    for (let k = 0; k <= last; k++) {
        const step: Data = { ...atStep(data, k), documentSetup: false, frames: false, size_x_cm: size(w), size_y_cm: size(h) };
        const body: string[] = [];
        for (const line of picture(step).split('\n')) {
            if (line.startsWith('% Needs: ')) {
                if (!needs.includes(line)) needs.push(line);
            } else body.push(line);
        }
        frames.push([`% Step ${k + 1} of ${last + 1}`, ...body]);
    }
    const row: string[] = [];
    frames.forEach((f, i) => {
        if (i) row.push(`${FRAME_GAP}%`);
        // A % after \end{tikzpicture} keeps the line break from adding a space between frames.
        row.push(...f.map((l) => (l === '\\end{tikzpicture}' ? '\\end{tikzpicture}%' : l)));
    });
    if (!standalone) return [...needs, ...row].join('\n');
    const preamble = needs.map((l) => l.slice('% Needs: '.length));
    return ['\\documentclass[border=5pt]{standalone}', ...preamble, '\\begin{document}', ...row, '\\end{document}'].join('\n');
}
