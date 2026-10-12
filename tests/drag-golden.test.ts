/* eslint-disable @typescript-eslint/no-non-null-assertion */
/*
 * SPEC3 3.8 golden table, end to end: every row is a chart (600 x 480 px plot,
 * equal scale where the example has it), a target picked from the real hit
 * index, a 12-step pointer path through prepareDrag + DragSession, and the
 * exact committed text and slider values. Each row also checks that the last
 * live frame equals the committed state (no jump on release; tidy at release
 * only drops coefficients of 1) and that dragging back to the start restores
 * the text byte for byte. Row 32 calls rewriteUnits directly. Rows 37 to 43
 * add the lead's graph-form decision (coefficients from the function side).
 */
import { test, assert } from './_lib';
import { MathContext } from '../src/mathcontext';
import { compileNumbers, discoverNumbers, parseUnit, rewriteUnits } from '../src/drag/numbers';
import { fieldText, resolveTarget } from '../src/drag/targets';
import { DragSession, prepareDrag } from '../src/drag/session';
import { EXAMPLES } from '../src/migrate';
import type { DragContext, DragFrame, FieldRef, Gesture, Pt } from '../src/drag/types';
import {
    ChartSpec,
    chartJson,
    curveTool,
    drag,
    editText,
    hitByKey,
    implicitDistPx,
    makeChart,
    paramValue,
    pointsTool,
    regionTool,
    segmentTool,
} from './_drag';

interface Row {
    n: number;
    name: string;
    chart: ChartSpec | 'lp';
    key?: string;
    label?: number;
    grab: Pt;
    to: Pt;
    gesture?: Gesture;
    pivot?: Pt;
    path?: Pt[];
    alt?: boolean;
    ref: FieldRef;
    want: string;
    /** Last live text when tidy at release changes it (1x -> x). */
    live?: string;
    params?: Record<string, number>;
    twin?: { ref: FieldRef; want: string };
    implicit?: boolean;
    /** Implicit rows: the committed zero set; the pointer (and the pivot) end within 2 px of it. */
    zero?: (x: number, y: number) => number;
}

const fn = (name = 'f1'): FieldRef => ({ kind: 'function', name, field: 'expression' });
const tool = (id: string, field: 'equation' | 'levels' | 'points' | 'path' | 'objective'): FieldRef => ({ kind: 'tool', id, field });
const cond = (id: string, entry: number): FieldRef => ({ kind: 'tool', id, field: 'condition', entry });

const S1: [number, number, number, number] = [-5, 5, -5, 5];
const S4: [number, number, number, number] = [-1, 5, -3, 5];
const S5: [number, number, number, number] = [-1, 7, -2, 2.5];
const LPV: [number, number, number, number] = [0, 5, 0, 4.5];
const LP_CONDS = ['x + y <= 4', 'x + 3y <= 6', 'x >= 0', 'y >= 0'];
const graph = (expression: string, view = S1, extra: Partial<ChartSpec> = {}): ChartSpec => ({ view, functions: [{ expression }], ...extra });

const ROWS: Row[] = [
    { n: 1, name: '2x + 1 move', chart: graph('2x + 1'), key: 'fn:f1#curve', grab: { x: 1, y: 3 }, to: { x: 1.5, y: 3.8 }, ref: fn(), want: '2x + 0.8' },
    {
        n: 2,
        name: '2x + 1 turn about (0, 1) to slope 1',
        chart: graph('2x + 1'),
        key: 'fn:f1#curve',
        grab: { x: 2, y: 5 },
        to: { x: 2, y: 3 },
        gesture: 'pivot',
        pivot: { x: 0, y: 1 },
        ref: fn(),
        want: 'x + 1',
        live: '1x + 1',
    },
    {
        n: 3,
        name: '2x + 1 turn about (1, 3)',
        chart: graph('2x + 1'),
        key: 'fn:f1#curve',
        grab: { x: -1, y: -1 },
        to: { x: -1, y: 0 },
        gesture: 'pivot',
        pivot: { x: 1, y: 3 },
        ref: fn(),
        want: '1.5x + 1.5',
    },
    {
        n: 4,
        name: '2x + 3y = c move',
        chart: { view: LPV, tools: [curveTool('t1', 'C1', '2x + 3y = c')], parameters: [{ name: 'c', value: 9, min: 0, max: 15, step: 0.1 }] },
        key: 't1#level:0',
        grab: { x: 3, y: 1 },
        to: { x: 3.3, y: 1.2 },
        ref: tool('t1', 'equation'),
        want: '2x + 3y = c',
        params: { c: 10.2 },
        implicit: true,
    },
    {
        n: 5,
        name: '2x + 3y = c turn about the optimum (twin objective)',
        chart: 'lp',
        key: 't1#level:0',
        grab: { x: 0, y: 3 },
        to: { x: 0, y: 3.5 },
        gesture: 'pivot',
        pivot: { x: 3, y: 1 },
        ref: tool('t1', 'equation'),
        want: '2.5x + 3y = c',
        params: { c: 10.5 },
        twin: { ref: tool('t3', 'objective'), want: '2.5x + 3y' },
        implicit: true,
    },
    {
        n: 6,
        name: '2x + 3y = 12 turn about (3, 2)',
        chart: { view: [0, 7, 0, 5], tools: [curveTool('t0', 'C1', '2x + 3y = 12')] },
        key: 't0#level:0',
        grab: { x: 0, y: 4 },
        to: { x: 0, y: 4.4 },
        gesture: 'pivot',
        pivot: { x: 3, y: 2 },
        ref: tool('t0', 'equation'),
        want: '2.4x + 3y = 13.2',
        implicit: true,
    },
    {
        n: 7,
        name: 'x + 3y <= 6 move',
        chart: { view: LPV, tools: [regionTool('t0', 'R1', LP_CONDS, { conditionLabels: ['(1)', '(2)', '', ''] })] },
        key: 't0#clause:1:0:0',
        grab: { x: 3, y: 1 },
        to: { x: 3.3, y: 1.1 },
        ref: cond('t0', 1),
        want: 'x + 3y <= 6.6',
        implicit: true,
    },
    {
        n: 8,
        name: 'x + 3y <= 6 turn about corner (3, 1)',
        chart: { view: LPV, tools: [regionTool('t0', 'R1', LP_CONDS, { conditionLabels: ['(1)', '(2)', '', ''] })] },
        key: 't0#clause:1:0:0',
        grab: { x: 0, y: 2 },
        to: { x: 0, y: 2.5 },
        gesture: 'pivot',
        pivot: { x: 3, y: 1 },
        ref: cond('t0', 1),
        // SPEC3 D4: one coefficient plus the offset. No side is a lone variable, so the graph-form rule
        // (rows 37 to 43) leaves this row and row 5 alone.
        want: 'x + 2y <= 5',
        implicit: true,
    },
    {
        n: 9,
        name: 'x + y <= 4 turn about corner (3, 1)',
        chart: { view: LPV, tools: [regionTool('t0', 'R1', LP_CONDS)] },
        key: 't0#clause:0:0:0',
        grab: { x: 1, y: 3 },
        to: { x: 1, y: 3.4 },
        gesture: 'pivot',
        pivot: { x: 3, y: 1 },
        ref: cond('t0', 0),
        want: '1.2x + y <= 4.6',
        implicit: true,
    },
    { n: 10, name: 'x^2 - 3x + 1 move', chart: graph('x^2 - 3x + 1', S4), key: 'fn:f1#curve', grab: { x: 3, y: 1 }, to: { x: 3.5, y: 2 }, ref: fn(), want: 'x^2 - 4x + 3.75' },
    {
        n: 11,
        name: 'x^2 - 3x + 1 stretch about the vertex',
        chart: graph('x^2 - 3x + 1', S4),
        key: 'fn:f1#curve',
        grab: { x: 3, y: 1 },
        to: { x: 3, y: 2 },
        gesture: 'pivot',
        pivot: { x: 1.5, y: -1.25 },
        ref: fn(),
        // SPEC3 3.8 lists 1.433 (prototype sampled 10 % beyond the view). Under the normative 2.4 sampling
        // (view inset 2 %) and 2.7 (roundest value within 2 px), 1.43 is about 1.3 px off the exact stretch,
        // so the rules accept it. The lead accepted 1.43 as the golden value.
        want: '1.43x^2 - 4.3x + 2',
    },
    { n: 12, name: 'sin(x) move', chart: graph('sin(x)', S5), key: 'fn:f1#curve', grab: { x: Math.PI / 2, y: 1 }, to: { x: Math.PI / 2 + 0.5, y: 1.5 }, ref: fn(), want: 'sin(x - 0.5) + 0.5' },
    {
        n: 13,
        name: 'sin(x) stretch about the origin',
        chart: graph('sin(x)', S5),
        key: 'fn:f1#curve',
        grab: { x: Math.PI / 2, y: 1 },
        to: { x: Math.PI / 2, y: 1.5 },
        gesture: 'pivot',
        pivot: { x: 0, y: 0 },
        ref: fn(),
        want: '1.5sin(x)',
    },
    {
        n: 14,
        name: '0.5sin(2x) + 1 move vertical',
        chart: graph('0.5sin(2x) + 1', [-1, 7, -1, 3]),
        key: 'fn:f1#curve',
        grab: { x: Math.PI / 4, y: 1.5 },
        to: { x: Math.PI / 4, y: 1.8 },
        ref: fn(),
        want: '0.5sin(2x) + 1.3',
    },
    {
        n: 14.5,
        name: '0.5sin(2x) + 1 move diagonal',
        chart: graph('0.5sin(2x) + 1', [-1, 7, -1, 3]),
        key: 'fn:f1#curve',
        grab: { x: Math.PI / 4, y: 1.5 },
        to: { x: Math.PI / 4 + 0.3, y: 1.8 },
        ref: fn(),
        want: '0.5sin(2(x - 0.3)) + 1.3',
    },
    { n: 15, name: 'x^2 + 1 move right 1', chart: graph('x^2 + 1', S4), key: 'fn:f1#curve', grab: { x: 1, y: 2 }, to: { x: 2, y: 2 }, ref: fn(), want: '(x - 1)^2 + 1' },
    { n: 16, name: '-x + 4 move down 6', chart: graph('-x + 4'), key: 'fn:f1#curve', grab: { x: 2, y: 2 }, to: { x: 2, y: -4 }, ref: fn(), want: '-x - 2' },
    { n: 17, name: 'e^(0.5x) move', chart: graph('e^(0.5x)'), key: 'fn:f1#curve', grab: { x: 0, y: 1 }, to: { x: 1, y: 2 }, ref: fn(), want: 'e^(0.5(x - 1)) + 1' },
    {
        n: 18,
        name: 'disc move',
        chart: { view: [-1, 7, -1, 5], equal: true, tools: [regionTool('t0', 'R1', ['(x - 3)^2 + (y - 2)^2 <= 2^2'])] },
        key: 't0#clause:0:0:0',
        grab: { x: 5, y: 2 },
        to: { x: 5.5, y: 2.6 },
        ref: cond('t0', 0),
        want: '(x - 3.5)^2 + (y - 2.6)^2 <= 2^2',
        implicit: true,
    },
    {
        n: 19,
        name: 'disc resize about the centre',
        chart: { view: [-1, 7, -1, 5], equal: true, tools: [regionTool('t0', 'R1', ['(x - 3)^2 + (y - 2)^2 <= 2^2'])] },
        key: 't0#clause:0:0:0',
        grab: { x: 5, y: 2 },
        to: { x: 5.5, y: 2 },
        gesture: 'pivot',
        pivot: { x: 3, y: 2 },
        ref: cond('t0', 0),
        want: '(x - 3)^2 + (y - 2)^2 <= 2.5^2',
        implicit: true,
    },
    {
        n: 20,
        name: 'circle move',
        chart: { view: [-4, 4, -4, 4], equal: true, tools: [curveTool('t0', 'C1', 'x^2 + y^2 = 4')] },
        key: 't0#level:0',
        grab: { x: 2, y: 0 },
        to: { x: 2.5, y: 0.7 },
        ref: tool('t0', 'equation'),
        want: '(x - 0.5)^2 + (y - 0.7)^2 = 4',
        implicit: true,
    },
    {
        n: 21,
        name: '2^x stretch about (0, 1)',
        chart: graph('2^x', [-5, 5, -2, 8]),
        key: 'fn:f1#curve',
        grab: { x: 2, y: 4 },
        to: { x: 2, y: 5.5 },
        gesture: 'pivot',
        pivot: { x: 0, y: 1 },
        ref: fn(),
        want: '1.5*2^x - 0.5',
    },
    {
        n: 22,
        name: '-3x + 2 turn about (0, 2) to slope 1.2',
        chart: graph('-3x + 2'),
        key: 'fn:f1#curve',
        grab: { x: 1, y: -1 },
        to: { x: 1, y: 3.2 },
        gesture: 'pivot',
        pivot: { x: 0, y: 2 },
        ref: fn(),
        want: '1.2x + 2',
    },
    {
        n: 23,
        name: 'x*3 turn about the origin to slope -2',
        chart: graph('x*3'),
        key: 'fn:f1#curve',
        grab: { x: 1, y: 3 },
        to: { x: 1, y: -2 },
        gesture: 'pivot',
        pivot: { x: 0, y: 0 },
        ref: fn(),
        want: 'x*(-2)',
    },
    {
        n: 24,
        name: '1/2 x + 1 turn about (0, 1) to slope 1',
        chart: graph('1/2 x + 1'),
        key: 'fn:f1#curve',
        grab: { x: 2, y: 2 },
        to: { x: 2, y: 3 },
        gesture: 'pivot',
        pivot: { x: 0, y: 1 },
        ref: fn(),
        want: 'x + 1',
        live: '1 x + 1',
    },
    {
        n: 25,
        name: '10 - a*x move up 0.5',
        chart: graph('10 - a*x', [0, 12, 0, 11], { parameters: [{ name: 'a', value: 1, min: 0.5, max: 3, step: 0.05 }] }),
        key: 'fn:f1#curve',
        grab: { x: 2, y: 8 },
        to: { x: 2, y: 8.5 },
        ref: fn(),
        want: '10.5 - a*x',
        params: { a: 1 },
    },
    {
        n: 25.5,
        name: '10 - a*x turn about (4, 6)',
        chart: graph('10 - a*x', [0, 12, 0, 11], { parameters: [{ name: 'a', value: 1, min: 0.5, max: 3, step: 0.05 }] }),
        key: 'fn:f1#curve',
        grab: { x: 2, y: 8 },
        to: { x: 2, y: 9 },
        gesture: 'pivot',
        pivot: { x: 4, y: 6 },
        ref: fn(),
        want: '12 - a*x',
        params: { a: 1.5 },
    },
    {
        n: 26,
        name: '(a, 2a) follows along y = 2x',
        chart: { view: [-1, 5, -1, 5], equal: true, tools: [pointsTool('t0', 'P1', { points: '(a, 2a)' })], parameters: [{ name: 'a', value: 1, min: -5, max: 5, step: 0.05 }] },
        key: 't0#point:0',
        grab: { x: 1, y: 2 },
        to: { x: 2, y: 2 },
        ref: tool('t0', 'points'),
        want: '(a, 2a)',
        params: { a: 1.2 },
    },
    {
        n: 27,
        name: 'list point 2 to (3.37, 1.52)',
        chart: { view: [-1, 4, -1, 5], tools: [pointsTool('t0', 'P1', { points: '(1, 1); (3, 2)' })] },
        key: 't0#point:1',
        grab: { x: 3, y: 2 },
        to: { x: 3.37, y: 1.52 },
        ref: tool('t0', 'points'),
        want: '(1, 1); (3.37, 1.5)',
    },
    {
        n: 28,
        name: 'push level 2 of x^2 + y^2',
        chart: { view: [-0.5, 4.5, -0.5, 3.5], equal: true, tools: [curveTool('t0', 'C1', 'x^2 + y^2', '1, 3.2, 6')] },
        key: 't0#level:1',
        grab: { x: Math.sqrt(1.6), y: Math.sqrt(1.6) },
        to: { x: 1.5, y: 1.4 },
        ref: tool('t0', 'levels'),
        want: '1, 4.2, 6',
        implicit: true,
    },
    {
        n: 29,
        name: 'label at P1_x moves right 0.4',
        chart: {
            view: [-1, 5, -1, 5],
            tools: [pointsTool('t0', 'P1', { points: '(2, 1)' })],
            annotations: [{ x: 'P1_x', y: '3', text: 'A', color: 'black', size: 'normal', anchor: 'center' }],
        },
        label: 0,
        grab: { x: 2, y: 3 },
        to: { x: 2.4, y: 3 },
        ref: { kind: 'label', index: 0, field: 'x' },
        want: 'P1_x + 0.4',
    },
    {
        n: 30,
        name: '0 <= x <= 4 (x <= 4) move right 0.5',
        chart: { view: [-1, 6, -1, 4], tools: [regionTool('t0', 'R1', ['0 <= x <= 4', '0 <= y <= 3'])] },
        key: 't0#clause:0:0:1',
        grab: { x: 4, y: 1.5 },
        to: { x: 4.5, y: 1.5 },
        ref: cond('t0', 0),
        want: '0 <= x <= 4.5',
        implicit: true,
    },
    {
        n: 31,
        name: '0 <= x <= 2pi (x <= 2pi) move right 0.3',
        chart: { view: [-1, 8, -1.5, 2], tools: [regionTool('t0', 'R1', ['0 <= x <= 2pi', '-1 <= y <= 1'])] },
        key: 't0#clause:0:0:1',
        grab: { x: 2 * Math.PI, y: 0.5 },
        to: { x: 2 * Math.PI + 0.3, y: 0.5 },
        ref: cond('t0', 0),
        want: '0 <= x <= 2pi + 0.3',
        implicit: true,
    },
    { n: 33, name: 'x(x+1) move right 1', chart: graph('x(x+1)'), key: 'fn:f1#curve', grab: { x: 1, y: 2 }, to: { x: 2, y: 2 }, ref: fn(), want: 'x(x-1)' },
    {
        n: 33.5,
        name: 'x(x^2+1) move right 1',
        chart: graph('x(x^2+1)', [-3, 3, -5, 5]),
        key: 'fn:f1#curve',
        grab: { x: 1, y: 2 },
        to: { x: 2, y: 2 },
        ref: fn(),
        want: '(x-1)((x-1)^2+1)',
    },
    {
        n: 34,
        name: 'segment leg move',
        chart: { view: [-1, 5, -1, 4], tools: [segmentTool('t0', 'S1', '(0, 0); (3, 2)')] },
        key: 't0#leg:0',
        grab: { x: 1.5, y: 1 },
        to: { x: 2, y: 1.5 },
        ref: tool('t0', 'path'),
        want: '(0.5, 0.5); (3.5, 2.5)',
    },
    {
        n: 36,
        name: 'unicode x ≤ 4 − y move right 0.5',
        chart: { view: [-1, 6, -1, 6], tools: [regionTool('t0', 'R1', ['x ≤ 4 − y'])] },
        key: 't0#clause:0:0:0',
        grab: { x: 2, y: 2 },
        to: { x: 2.5, y: 2 },
        ref: cond('t0', 0),
        want: 'x ≤ 4.5 − y',
        implicit: true,
    },
    // Graph form (lead decision on D4): a side that is a lone axis variable, optionally signed, is the output
    // side. Its implicit coefficient is not a number of a pivot gesture, so turns and stretches take their
    // coefficient from the function side: `y <= 2x^2`, never `0.5y <= x^2`.
    {
        n: 37,
        name: 'y <= x^2 stretch about the vertex',
        chart: { view: [-3, 3, -1, 5], tools: [regionTool('t0', 'R1', ['y <= x^2'])] },
        key: 't0#clause:0:0:0',
        grab: { x: 1, y: 1 },
        to: { x: 1, y: 2 },
        gesture: 'pivot',
        pivot: { x: 0, y: 0 },
        ref: cond('t0', 0),
        want: 'y <= 2x^2',
        implicit: true,
        zero: (x, y) => y - 2 * x * x,
    },
    {
        n: 38,
        name: 'y <= 4 - x^2 stretch about its vertex',
        chart: { view: [-3, 3, -1, 5], tools: [regionTool('t0', 'R1', ['y <= 4 - x^2'])] },
        key: 't0#clause:0:0:0',
        grab: { x: 1, y: 3 },
        to: { x: 1, y: 2 },
        gesture: 'pivot',
        pivot: { x: 0, y: 4 },
        ref: cond('t0', 0),
        want: 'y <= 4 - 2x^2',
        implicit: true,
        zero: (x, y) => y - (4 - 2 * x * x),
    },
    {
        n: 39,
        name: 'y = sin(x) curve stretch about the origin',
        chart: { view: S5, tools: [curveTool('t0', 'C1', 'y = sin(x)')] },
        key: 't0#level:0',
        grab: { x: Math.PI / 2, y: 1 },
        to: { x: Math.PI / 2, y: 1.5 },
        gesture: 'pivot',
        pivot: { x: 0, y: 0 },
        ref: tool('t0', 'equation'),
        want: 'y = 1.5sin(x)',
        implicit: true,
        zero: (x, y) => y - 1.5 * Math.sin(x),
    },
    {
        n: 40,
        name: 'x >= y^2 stretch about the vertex, horizontal',
        chart: { view: [-1, 5, -3, 3], tools: [regionTool('t0', 'R1', ['x >= y^2'])] },
        key: 't0#clause:0:0:0',
        grab: { x: 1, y: 1 },
        to: { x: 2, y: 1 },
        gesture: 'pivot',
        pivot: { x: 0, y: 0 },
        ref: cond('t0', 0),
        want: 'x >= 2y^2',
        implicit: true,
        zero: (x, y) => x - 2 * y * y,
    },
    {
        n: 41,
        name: '-y >= x^2 - 4 (signed output side) stretch about its vertex',
        chart: { view: [-3, 3, -1, 5], tools: [regionTool('t0', 'R1', ['-y >= x^2 - 4'])] },
        key: 't0#clause:0:0:0',
        grab: { x: 1, y: 3 },
        to: { x: 1, y: 2 },
        gesture: 'pivot',
        pivot: { x: 0, y: 4 },
        ref: cond('t0', 0),
        want: '-y >= 2x^2 - 4',
        implicit: true,
        zero: (x, y) => -y - (2 * x * x - 4),
    },
    {
        n: 42,
        name: 'x^2 >= y (output side on the right) stretch about the vertex',
        chart: { view: [-3, 3, -1, 5], tools: [regionTool('t0', 'R1', ['x^2 >= y'])] },
        key: 't0#clause:0:0:0',
        grab: { x: 1, y: 1 },
        to: { x: 1, y: 2 },
        gesture: 'pivot',
        pivot: { x: 0, y: 0 },
        ref: cond('t0', 0),
        want: '2x^2 >= y',
        implicit: true,
        zero: (x, y) => 2 * x * x - y,
    },
    {
        n: 43,
        name: 'y <= x turn about the origin to slope 1/2',
        chart: { view: [-3, 3, -3, 3], tools: [regionTool('t0', 'R1', ['y <= x'])] },
        key: 't0#clause:0:0:0',
        grab: { x: 2, y: 2 },
        to: { x: 2, y: 1 },
        gesture: 'pivot',
        pivot: { x: 0, y: 0 },
        ref: cond('t0', 0),
        want: 'y <= 0.5x',
        implicit: true,
        zero: (x, y) => y - 0.5 * x,
    },
];

function chartOf(row: Row) {
    if (row.chart === 'lp') {
        const ex = EXAMPLES.find((e) => e.id === 'lp');
        if (!ex) throw new Error('no lp example');
        return makeChart(JSON.parse(JSON.stringify(ex.data)) as Record<string, unknown>);
    }
    return makeChart(chartJson(row.chart), { equal: !!row.chart.equal });
}

function targetFor(row: Row, ctx: DragContext) {
    if (row.label !== undefined) return resolveTarget({ label: row.label, at: row.grab }, ctx);
    return resolveTarget(hitByKey(ctx, row.key as string, row.grab), ctx);
}

/** Every edit of a frame parses and validates in its field kind. */
function framesValid(frames: DragFrame[], ctx: DragContext): void {
    const math = new MathContext(ctx.mathInput);
    for (const f of frames) {
        for (const e of f.edits) {
            const r = e.ref;
            const kind =
                r.kind === 'function'
                    ? r.field === 'expression'
                        ? 'fn1'
                        : 'value'
                    : r.kind === 'label'
                    ? 'value'
                    : r.field === 'condition'
                    ? 'condition'
                    : r.field === 'equation'
                    ? 'equation'
                    : r.field === 'levels'
                    ? 'levels'
                    : r.field === 'objective'
                    ? 'fn2'
                    : r.field === 'path'
                    ? 'path2'
                    : 'tuples2';
            const v = math.validate(e.text, kind);
            // Derived names (P1_x) have no value in a fresh context: only syntax and names are checked there.
            assert.ok(v.ok || /not a finite number/.test(v.message), `${e.text}: ${v.ok ? '' : v.message}`);
        }
    }
}

/** Graph rows: the grabbed point ends within 2 px of the pointer (after quantization), the pivot stays on the curve. */
function followsPointer(row: Row, text: string, ctx: DragContext): void {
    if (row.ref.kind !== 'function') return;
    const math = new MathContext(ctx.mathInput);
    math.setParamValues(row.params || {});
    const f = math.fn1(text);
    const dist = (p: Pt) => {
        const h = 1e-6;
        const s = ((f(p.x + h) - f(p.x - h)) / (2 * h)) * (ctx.map.ky / ctx.map.kx);
        return (Math.abs(f(p.x) - p.y) * ctx.map.ky) / Math.sqrt(1 + s * s);
    };
    assert.ok(dist(row.to) <= 2, `pointer ${dist(row.to).toFixed(2)} px from ${text}`);
    if (row.pivot) assert.ok(dist(row.pivot) <= 2, `pivot ${dist(row.pivot).toFixed(2)} px from ${text}`);
}

for (const row of ROWS) {
    test(`row ${row.n}: ${row.name}`, () => {
        const chart = chartOf(row);
        const ctx = chart.ctx;
        const t = targetFor(row, ctx);
        assert.equal(t.lock, null, t.lock ? t.lock.title : '');
        if (row.label === undefined) {
            // The grab is where the object is drawn: a press there hits it (a row whose view leaves the grab off
            // the plot would only pass because drag() takes the math grab as given).
            const v = ctx.map.view;
            assert.ok(row.grab.x >= v.xmin && row.grab.x <= v.xmax && row.grab.y >= v.ymin && row.grab.y <= v.ymax, 'grab inside the view');
            assert.ok(ctx.hits.pick(row.grab, { line: 6, point: 9 }, ctx.map), 'a press at the grab hits something');
        }
        const run = drag(ctx, t, row.grab, row.to, { gesture: row.gesture, pivot: row.pivot, mods: { alt: !!row.alt } });
        const last = run.frames[run.frames.length - 1];
        assert.ok(!last.stuck, `last frame stuck: ${last.chip.detail}`);
        assert.ok(run.commit, 'a commit');
        const commit = run.commit!;
        const patch = commit.fields.find((f) => JSON.stringify(f.ref) === JSON.stringify(row.ref));
        const committed = patch ? patch.after : fieldText(row.ref, chart.data);
        assert.equal(committed, row.want);
        assert.equal(editText(last, row.ref), row.live ?? row.want, 'live text = committed text (no jump on release)');
        for (const [name, v] of Object.entries(row.params || {})) {
            const p = commit.params.find((q) => q.name === name);
            const after = p ? p.after : chart.data.parameters.find((q) => q.name === name)?.value;
            assert.equal(after, v, `slider ${name}`);
            assert.equal(paramValue(last, name) ?? after, v, `live slider ${name}`);
        }
        if (row.twin) {
            const tp = commit.fields.find((f) => JSON.stringify(f.ref) === JSON.stringify(row.twin!.ref));
            assert.ok(tp, 'twin patched');
            assert.equal(tp!.after, row.twin.want);
            assert.equal(editText(last, row.twin.ref), row.twin.want);
        }
        framesValid(run.frames, ctx);
        followsPointer(row, row.want, ctx);
        if (row.zero) {
            const d = implicitDistPx(row.zero, row.to, ctx);
            assert.ok(d <= 2, `pointer ${d.toFixed(2)} px from ${row.want}`);
            if (row.pivot) {
                const dp = implicitDistPx(row.zero, row.pivot, ctx);
                assert.ok(dp <= 2, `pivot ${dp.toFixed(2)} px from ${row.want}`);
            }
        }
    });

    test(`row ${row.n}: dragging back to the start restores the text`, () => {
        const chart = chartOf(row);
        const ctx = chart.ctx;
        const t = targetFor(row, ctx);
        const start = new Map<string, string>();
        const startParams = new Map(chart.data.parameters.map((p) => [p.name, p.value] as [string, number]));
        const gesture = row.gesture || 'move';
        const prep = prepareDrag(t, row.grab, gesture, ctx, row.pivot ? { pivot: row.pivot } : undefined);
        if ('lock' in prep) throw new Error(prep.lock.title);
        const mods = { shift: gesture === 'pivot', alt: !!row.alt };
        const s = DragSession.start(prep, mods, ctx);
        const out: Pt[] = [];
        for (let k = 1; k <= 12; k++) out.push({ x: row.grab.x + ((row.to.x - row.grab.x) * k) / 12, y: row.grab.y + ((row.to.y - row.grab.y) * k) / 12 });
        const back = out.slice(0, -1).reverse().concat([row.grab]);
        let f: DragFrame | null = null;
        for (const p of out.concat(back)) {
            f = s.update(p, mods);
            for (const e of f.edits) {
                const key = JSON.stringify(e.ref);
                if (!start.has(key)) start.set(key, fieldText(e.ref, chart.data) as string);
            }
        }
        assert.ok(f);
        for (const e of f!.edits) assert.equal(e.text, start.get(JSON.stringify(e.ref)), 'byte-identical after dragging back');
        for (const p of f!.params) assert.equal(p.value, startParams.get(p.name), `slider ${p.name} back at its start value`);
        assert.equal(s.commit(), null, 'nothing changed: no history entry');
    });
}

test('row 35: 0.123456x + 1.98765 dragged away and back is byte-identical', () => {
    const chart = makeChart(chartJson(graph('0.123456x + 1.98765')));
    const ctx = chart.ctx;
    const g0 = { x: 1, y: 0.123456 + 1.98765 };
    const t = resolveTarget(hitByKey(ctx, 'fn:f1#curve', g0), ctx);
    const path = [
        { x: 1.2, y: 2.5 },
        { x: 1.5, y: 3 },
        { x: 1.2, y: 2.4 },
        { x: 1, y: g0.y },
    ];
    const run = drag(ctx, t, g0, g0, { path });
    assert.notEqual(editText(run.frames[1], fn()), '0.123456x + 1.98765', 'the drag changed the text on the way');
    assert.equal(editText(run.frames[run.frames.length - 1], fn()), '0.123456x + 1.98765');
    assert.equal(run.commit, null);
});

test('row 32: rewrite of x + sin(x) with a factor and a shift', () => {
    const math = new MathContext({ functions: [] });
    const spec = { ref: fn(), role: 'body' as const, fnKind: 'cartesian' as const };
    const text = 'x + sin(x)';
    const u = parseUnit(spec, text, math);
    assert.ok(u);
    const numbers = discoverNumbers([u!], { sliders: new Map(), allowSliders: true, virtual: ['factor', 'shiftVar'] });
    const ev = compileNumbers([u!], numbers, math);
    const values = Float64Array.from(numbers.map((n) => n.value0));
    const steps = new Float64Array(numbers.length).fill(0.1);
    const factor = numbers.findIndex((n) => n.virtual && n.virtual.kind === 'factor' && n.pos === 0);
    const shift = numbers.findIndex((n) => n.virtual && n.virtual.kind === 'shiftVar');
    assert.ok(factor >= 0 && shift >= 0, JSON.stringify(numbers.map((n) => n.id)));
    values[factor] = 1.5;
    values[shift] = 1;
    ev.values.set(values);
    ev.apply();
    const samples = [[0.3, 1.1, 2.7, -1.4].map((x) => ({ x, y: 0 }))];
    const out = rewriteUnits([u!], numbers, values, steps, ev, math, { tidy: false, samples });
    assert.equal(out.length, 1);
    assert.equal(out[0].failed, false);
    assert.equal(out[0].text, '1.5(x - 1) + sin(x - 1)');
});

test('frame and prepare times stay within 3x of the SPEC3 2.8 budgets', () => {
    // Warm runs (the first rows paid the JIT): re-run a line, a graph and an implicit row and time them.
    const pick = (n: number) => ROWS.find((r) => r.n === n) as Row;
    const budget = (rows: Row[], frameMs: number, prepMs: number) => {
        const frameTimes: number[] = [];
        const prepTimes: number[] = [];
        for (let rep = 0; rep < 3; rep++) {
            for (const row of rows) {
                const chart = chartOf(row);
                const t = targetFor(row, chart.ctx);
                const run = drag(chart.ctx, t, row.grab, row.to, { gesture: row.gesture, pivot: row.pivot });
                if (rep === 0) continue;
                prepTimes.push(run.prepareMs);
                // SPEC3 2.8 budgets the p95 of per-event times, so every event counts (not each drag's max).
                frameTimes.push(...run.frameMs);
            }
        }
        frameTimes.sort((a, b) => a - b);
        prepTimes.sort((a, b) => a - b);
        const p95 = frameTimes[Math.min(frameTimes.length - 1, Math.floor(frameTimes.length * 0.95))];
        const prep = prepTimes[Math.floor(prepTimes.length / 2)];
        assert.ok(p95 <= 3 * frameMs, `frame p95 ${p95.toFixed(2)} ms > ${3 * frameMs} ms`);
        assert.ok(prep <= 3 * prepMs, `prepare median ${prep.toFixed(2)} ms > ${3 * prepMs} ms`);
    };
    budget([pick(1), pick(10), pick(12), pick(16)], 3, 3);
    budget([pick(7), pick(18), pick(20)], 5, 5);
});
