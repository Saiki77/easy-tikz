/*
 * Compiles exported TikZ with pdflatex: every example, the finished chart
 * of every guide, the chart of the What's new popup, one 3.x block per
 * legacy tool type, and stress cases (steep functions, awkward label text,
 * a patterned region with a hole, parametric, polar, 3D surfaces at the
 * memory budget, surfaces cut at planes, every colour map by height,
 * mesh lines off and at full strength, a faint grid in 2D and 3D, turned
 * cameras, extreme 3D ranges, CSS colour names, snippet mode), and the
 * clean look of 6.1 (the default, so every case above is in it too).
 * Skipped with a message when pdflatex is not on PATH.
 *
 * ETZ_LATEX_KEEP=<dir> keeps the .tex / .pdf / .log files in <dir>.
 */
import { spawn, spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { test, assert } from './_lib';
import { SettingsManager } from '../src/settings';
import { EXAMPLES } from '../src/migrate';
import { whatsNewChart } from '../src/whatsnew';
import { GUIDES } from '../src/guides';
import { Function3DParameters, FunctionParameters } from '../src/types';
import { COLORMAPS } from '../src/colormaps';
import { parseChartText } from '../src/text/parse';
import type { NoteTable } from '../src/beyond/table';
import { collectExportFiles } from '../src/iterate/export'; // 6.0 E
import { AS_THE_LOOK, AxisSettings, ChartLook, setAxisSettings, setChartLook } from '../src/look'; // 6.2.1

const TIMEOUT_MS = 30000;
const PARALLEL = 4;

// ------------------------------------------------------------- fixtures

/** A 3.19.6 block as SettingsManager.serialize() wrote it (no version field). */
function legacyBlock(over: Record<string, unknown>): Record<string, unknown> {
    return {
        dimension: false,
        documentSetup: true,
        title: 'My graph: \\(\\sum\\)',
        size_x_cm: 10,
        size_y_cm: 10,
        show_axis_label: true,
        axis_label_x: 'x',
        axis_label_y: 'y',
        documentClose: true,
        showAxis: true,
        showLargeGrid: false,
        showSmallGrid: false,
        gridSize: 5,
        xmin: '-0.5',
        xmax: '10',
        ymin: '-0.5',
        ymax: '5',
        axis_style: 'box',
        functions: [],
        zmin: '-5',
        zmax: '5',
        axis_label_z: 'z',
        rotationX: 30,
        rotationZ: 45,
        zoom3D: 1,
        boxAspect: 'true',
        functions3D: [],
        majorTickNum: 8,
        previewSize: 760,
        annotations: [],
        tools: [],
        coordinateSystem: 'cartesian',
        axis_label_x_polar: '',
        axis_label_y_polar: '',
        ...over,
    };
}

function legacyFn(expression: string, domain: string, over: Record<string, unknown> = {}): Record<string, unknown> {
    return {
        expression,
        domain,
        showLegend: true,
        fill: false,
        fillOpacity: 0.15,
        fillPattern: 'solid',
        tangent: false,
        color: 'blue',
        dashed: false,
        tangentPoint: '',
        extrema: false,
        thickness: 'thick',
        parametric: false,
        expressionY: '',
        ...over,
    };
}

function fn(name: string, expression: string, over: Partial<FunctionParameters> = {}): FunctionParameters {
    return {
        name,
        expression,
        domain: '',
        showLegend: false,
        fill: false,
        fillOpacity: 0.2,
        fillPattern: 'solid',
        tangent: false,
        color: 'blue',
        dashed: false,
        tangentPoint: '',
        extrema: false,
        thickness: 'thick',
        parametric: false,
        expressionY: '',
        ...over,
    };
}

function surface3(name: string, expression: string, color: string, over: Partial<Function3DParameters> = {}): Function3DParameters {
    return { name, expression, xDomain: '', yDomain: '', color, wireframe: false, opacity: 0.8, samples: 30, ...over };
}

/** A v4 chart: every key at its default (SettingsManager.fromJSON fills the rest). */
function chart(over: Record<string, unknown>): Record<string, unknown> {
    return { v: 4, ...over };
}

const LEGACY_2D: Record<string, Record<string, unknown>> = {
    areaBetween: legacyBlock({
        functions: [legacyFn('x^2/4', '0:4', { name: 'f1' }), legacyFn('x', '0:4', { name: 'f2', color: 'red' })],
        tools: [{ type: 'areaBetween', func1Name: 'f1', func2Name: 'f2', domain: '0:4', color: 'green', fillOpacity: 0.3, fillPattern: 'north-east' }],
    }),
    intersection: legacyBlock({
        functions: [legacyFn('sin(x) + 2', '0:10'), legacyFn('2 + 0.1*x', '0:10', { color: 'red' })],
        tools: [{ type: 'intersection', func1Name: 'f1', func2Name: 'f2', color: 'black', showLabels: true }],
    }),
    verticalLine: legacyBlock({ tools: [{ type: 'verticalLine', x: '2', color: 'red', thickness: 'thick', dashed: true, label: 'x = 2' }] }),
    horizontalLine: legacyBlock({ tools: [{ type: 'horizontalLine', y: '3', color: 'teal', thickness: 'thin', dashed: false, label: 'y_max' }] }),
    rectangle: legacyBlock({
        tools: [{ type: 'rectangle', x1: '1', y1: '1', x2: '3', y2: '2.5', color: 'purple', thickness: 'thin', fill: true, fillOpacity: 0.2, fillPattern: 'crosshatch' }],
    }),
    circle: legacyBlock({
        tools: [{ type: 'circle', cx: '5', cy: '2', r: '1.5', color: 'orange', thickness: 'thick', fill: true, fillOpacity: 0.3, fillPattern: 'dots' }],
    }),
    segment: legacyBlock({
        tools: [{ type: 'segment', x1: '0', y1: '0', x2: '4', y2: '4', color: 'black', thickness: 'thick', dashed: false, arrow: 'forward' }],
    }),
    brace: legacyBlock({ tools: [{ type: 'brace', x1: '1', y1: '0', x2: '6', y2: '0', color: 'blue', label: 'width' }] }),
};

const LEGACY_3D: Record<string, Record<string, unknown>> = {
    plane3D: legacyBlock({
        dimension: true,
        functions3D: [{ expression: 'sin(x)*cos(y)', xDomain: '-3:3', yDomain: '-3:3', color: 'blue', wireframe: false, opacity: 0.7, samples: 25 }],
        tools: [{ type: 'plane3D', axis: 'z', value: '0.5', color: 'orange', fillOpacity: 0.3 }],
    }),
    point3D: legacyBlock({ dimension: true, tools: [{ type: 'point3D', x: '1', y: '1', z: '2', color: 'red', label: 'P_1' }] }),
    segment3D: legacyBlock({
        dimension: true,
        tools: [{ type: 'segment3D', x1: '0', y1: '0', z1: '0', x2: '2', y2: '2', z2: '3', color: 'green', thickness: 'thick', dashed: true, arrow: 'both' }],
    }),
};

const AWKWARD = ['x_1', '50% cut', '$x^*$', 'x + y <= 4 | "q"', 'costs $5 and $10'];

const STRESS: Record<string, Record<string, unknown>> = {
    steep: chart({
        xmin: '-10',
        xmax: '10',
        ymin: '-10',
        ymax: '10',
        size_x_cm: 20,
        size_y_cm: 20,
        functions: [
            fn('f1', 'x^3', { showLegend: true }),
            fn('f2', 'tan(x)', { color: 'red', showLegend: true }),
            fn('f3', 'exp(x)', { color: 'green', showLegend: true }),
            fn('f4', 'floor(x)', { color: 'gray' }),
            fn('f5', '1/x', { color: 'purple', dashed: true }),
        ],
    }),
    labels: chart({
        title: AWKWARD.join(' / '),
        axis_label_x: 'x_1 (50%)',
        axis_label_y: '$x_2$',
        functions: [fn('f1', 'x/2', { showLegend: true, legendLabel: '50% cut' }), fn('f2', 'x/3 + 1', { showLegend: true, legendLabel: '$x^*$' })],
        tools: [
            {
                id: 'a', name: 'R1', type: 'region', color: 'blue', conditions: ['x + y <= 4', 'x >= 0', 'y >= 0'],
                conditionLabels: ['x_1 & co', '', ''], fill: true, fillOpacity: 0.25, fillPattern: 'solid', outline: 'solid',
                thickness: 'thin', constraintLines: true, label: '50% cut',
            },
            {
                id: 'b', name: 'P1', type: 'points', color: 'red', dim: 2, source: 'region', points: '', ref1: '', ref2: '',
                regionName: 'R1', objective: 'x + 2y', sense: 'max', label: '$x^*$ = ({x}, {y}) #1', dropLines: true, size: 'large',
            },
        ],
        annotations: AWKWARD.map((text, i) => ({ x: String(1 + 3 * i), y: '4.5', text, color: 'black', size: 'normal', anchor: 'center' })),
    }),
    hole: chart({
        xmin: '-4',
        xmax: '4',
        ymin: '-4',
        ymax: '4',
        equalScale: true,
        tools: [
            {
                id: 'a', name: 'R1', type: 'region', color: 'green', conditions: ['x^2 + y^2 <= 9', 'x^2 + y^2 >= 1 or x >= 2'],
                conditionLabels: ['', ''], fill: true, fillOpacity: 0.3, fillPattern: 'north-east', outline: 'dashed',
                thickness: 'thick', constraintLines: false, label: 'ring',
            },
        ],
    }),
    parametric: chart({
        xmin: '-1.5',
        xmax: '1.5',
        ymin: '-1.5',
        ymax: '1.5',
        functions: [fn('f1', 'cos(3t)', { parametric: true, expressionY: 'sin(2t)', showLegend: true })],
    }),
    polar: chart({
        coordinateSystem: 'polar',
        xmin: '-2.5',
        xmax: '2.5',
        ymin: '-2.5',
        ymax: '2.5',
        functions: [fn('f1', '2cos(3theta)', { showLegend: true }), fn('f2', '1 + 0.5sin(theta)', { color: 'red', domain: '0:pi' })],
    }),
    pgfmath: chart({
        xmin: '-3',
        xmax: '3',
        ymin: '-3',
        ymax: '3',
        parameters: [{ name: 'a', value: -1.5, min: -3, max: 3, step: 0.1 }],
        functions: [
            fn('f1', 'x^2', { domain: '0:2', hidden: true }),
            fn('f2', 'f1(x) - 1', { showLegend: true }),
            fn('f3', 'x < 0 ? -1 : x < 1 ? 0 : 1', { color: 'red', showLegend: true }),
            fn('f4', 'hypot(x, 1, 1) + round(x) % 2 + a', { color: 'green', showLegend: true }),
            fn('f5', 'asinh(x) + csc(x + 4) / 10 + log(x + 4) - 2^-x^2', { color: 'purple', showLegend: true }),
            fn('f6', 'x^2 - 2', { color: 'orange', fill: true, fillPattern: 'crosshatch', tangent: true, tangentPoint: 'a', extrema: true }),
        ],
        tools: [
            { id: 's', name: 'S1', type: 'segment', color: 'black', dim: 2, path: '(0, 0); (1000, 4)', closed: false, style: 'both', thickness: 'thin', dashed: false, label: 'far' },
            { id: 'b', name: 'S2', type: 'segment', color: 'teal', dim: 2, path: '(-2, -2); (2, -2)', closed: false, style: 'brace', thickness: 'thin', dashed: false, label: 'base' },
            { id: 'p', name: 'P1', type: 'points', color: 'black', dim: 2, source: 'list', points: '(1, 1); (100, 100)', ref1: '', ref2: '', regionName: '', objective: '', sense: 'max', label: '{i}', dropLines: false, size: 'small' },
        ],
    }),
    // Twelve wiggly regions with outlines: the point budget must keep TeX within its memory.
    budget: chart({
        xmin: '-5',
        xmax: '5',
        ymin: '-5',
        ymax: '5',
        tools: Array.from({ length: 12 }, (_, i) => ({
            id: `r${i}`, name: `R${i + 1}`, type: 'region', color: 'blue',
            conditions: [`y <= ${i % 3} + sin(${8 + i}x) + 0.5cos(${13 + i}y)`, `y >= -4 + cos(${7 + i}x)`],
            conditionLabels: ['', ''], fill: true, fillOpacity: 0.25, fillPattern: 'solid', outline: 'solid',
            thickness: 'thin', constraintLines: false, label: '',
        })),
    }),
    surface3d: chart({
        dimension: true,
        xmin: '-3',
        xmax: '3',
        ymin: '-3',
        ymax: '3',
        zmin: '-2',
        zmax: '2',
        functions3D: [
            { expression: 'sin(x)*cos(y)', xDomain: '', yDomain: '', color: 'teal', wireframe: false, opacity: 0.8, samples: 200, name: 'f1' },
            { expression: 'exp(x + y)', xDomain: '-3:3', yDomain: '-3:3', color: 'red', wireframe: true, opacity: 1, samples: 20, name: 'f2' },
        ],
        tools: [
            { id: 'a', name: 'PL1', type: 'plane3D', color: 'orange', axis: 'x', value: '1', fillOpacity: 0.3 },
            { id: 'b', name: 'P1', type: 'points', color: 'red', dim: 3, source: 'list', points: '(0, 0, 1); (1, 1, 1)', ref1: '', ref2: '', regionName: '', objective: '', sense: 'max', label: 'x_1; 50%', dropLines: false, size: 'normal' },
            { id: 'c', name: 'S1', type: 'segment', color: 'black', dim: 3, path: '(0, 0, 0); (0, 0, 10)', closed: false, style: 'forward', thickness: 'thick', dashed: false, label: '' },
        ],
        annotations: [{ x: '0', y: '0', z: '1.5', text: '$z = \\sin x \\cos y$', color: 'black', size: 'large', anchor: 'above' }],
    }),
    // Three dense surfaces: 3 x 60 samples exceed TeX's main memory without the surface budget.
    heavy3d: chart({
        dimension: true,
        xmin: '-3',
        xmax: '3',
        ymin: '-3',
        ymax: '3',
        zmin: '-2',
        zmax: '2',
        functions3D: [
            surface3('f1', 'sin(x)*cos(y)', 'teal', { samples: 80 }),
            surface3('f2', 'x^2/5 - y^2/5', 'red', { samples: 80 }),
            surface3('f3', '2exp(-(x^2+y^2))', 'blue', { samples: 80, wireframe: true }),
        ],
    }),
    // Surfaces cut at a z plane (pieces with restrict z), at two y planes (split domains).
    planesZ: chart({
        dimension: true,
        xmin: '-2',
        xmax: '2',
        ymin: '-2',
        ymax: '2',
        zmin: '-1',
        zmax: '1',
        functions3D: [surface3('f1', 'sin(2x)*cos(y)', 'teal', { samples: 60 }), surface3('f2', 'x*y/4', 'red', { samples: 60, wireframe: true })],
        tools: [{ id: 'a', name: 'PL1', type: 'plane3D', color: 'orange', axis: 'z', value: '0.2', fillOpacity: 0.35 }],
    }),
    planesY: chart({
        dimension: true,
        rotationZ: 120,
        xmin: '-3',
        xmax: '3',
        ymin: '-3',
        ymax: '3',
        zmin: '-2',
        zmax: '2',
        functions3D: [surface3('f1', 'sin(x)*cos(y)', 'teal', { samples: 40 })],
        tools: [
            { id: 'a', name: 'PL1', type: 'plane3D', color: 'orange', axis: 'y', value: '-1', fillOpacity: 0.35 },
            { id: 'b', name: 'PL2', type: 'plane3D', color: 'purple', axis: 'y', value: '1.5', fillOpacity: 0.35 },
        ],
    }),
    // A turned, low camera, data proportions, labels at the box corners (clip mode=individual).
    camera3d: chart({
        dimension: true,
        title: 'Turned camera',
        rotationZ: 200,
        rotationX: 10,
        boxAspect: 'true',
        size_x_cm: 12,
        size_y_cm: 6,
        xmin: '0',
        xmax: '2000',
        ymin: '0',
        ymax: '1000',
        zmin: '0',
        zmax: '500',
        functions3D: [surface3('f1', 'x/8 + y/8', 'blue', { samples: 20 })],
        tools: [
            { id: 'p', name: 'P1', type: 'points', color: 'red', dim: 3, source: 'list', points: '(2000, 0, 0); (0, 1000, 500)', ref1: '', ref2: '', regionName: '', objective: '', sense: 'max', label: 'corner A; corner B', dropLines: false, size: 'normal' },
        ],
    }),
    // Every colour map by height, side by side, a wireframe in one, a z range that is not symmetric
    // (diverging spreads over -3..3), a cube box and a z plane that cuts the surfaces into pieces.
    colormaps: chart({
        dimension: true,
        boxAspect: 'equal',
        xmin: '-3',
        xmax: '3',
        ymin: '-3',
        ymax: '3',
        zmin: '-1',
        zmax: '3',
        functions3D: [
            ...COLORMAPS.map((colormap, i) =>
                surface3(`f${i + 1}`, `1 + sin(2x + ${i})*cos(y)`, 'blue', {
                    colormap,
                    samples: 16,
                    xDomain: `${-3 + (i % 3) * 2}:${-1 + (i % 3) * 2}`,
                    yDomain: i < 3 ? '-3:0' : '0:3',
                })
            ),
            surface3('f7', '2 - x*y/4', 'red', { colormap: 'rainbow', wireframe: true, samples: 12 }),
        ],
        tools: [{ id: 'a', name: 'PL1', type: 'plane3D', color: 'orange', axis: 'z', value: '1', fillOpacity: 0.3 }],
    }),
    // A faint grid with minor lines (4.9): grid style and minor grid style, in 2D over fills and on the back planes in 3D.
    gridOpacity2d: chart({
        xmin: '0',
        xmax: '5',
        ymin: '0',
        ymax: '4',
        showLargeGrid: true,
        showSmallGrid: true,
        gridSize: 4,
        gridOpacity: 0.2,
        functions: [fn('f1', '3 - x/2', { fill: true, fillOpacity: 0.3 })],
        tools: [
            {
                id: 'a', name: 'R1', type: 'region', color: 'orange', conditions: ['x + y <= 4', 'x >= 0', 'y >= 0'],
                conditionLabels: ['', '', ''], fill: true, fillOpacity: 0.4, fillPattern: 'solid', outline: 'none',
                thickness: 'thin', constraintLines: false, label: '',
            },
        ],
    }),
    gridOpacity3d: chart({
        dimension: true,
        showLargeGrid: true,
        showSmallGrid: true,
        gridOpacity: 0.2,
        xmin: '-2',
        xmax: '2',
        ymin: '-2',
        ymax: '2',
        zmin: '0',
        zmax: '4',
        functions3D: [surface3('f1', 'x^2/2 + y^2/2', 'blue', { samples: 20 })],
    }),
    // Mesh lines off (pgfplots' smooth shading) and at full strength (4.9), in a colour and in colour maps,
    // solid and translucent, cut into pieces at a z plane, and with holes where a surface is not defined.
    mesh: chart({
        dimension: true,
        boxAspect: 'equal',
        xmin: '-3',
        xmax: '3',
        ymin: '-3',
        ymax: '3',
        zmin: '-1',
        zmax: '3',
        functions3D: [
            surface3('f1', '1 + sin(2x)*cos(y)', 'blue', { meshOpacity: 0, opacity: 1, samples: 16, xDomain: '-3:-1', yDomain: '-3:0' }),
            surface3('f2', '1 + sin(2x + 1)*cos(y)', 'red', { meshOpacity: 0, opacity: 0.6, colormap: 'viridis', samples: 16, xDomain: '-1:1', yDomain: '-3:0' }),
            surface3('f3', '1 + sin(2x + 2)*cos(y)', 'green', { meshOpacity: 1, opacity: 1, samples: 16, xDomain: '1:3', yDomain: '-3:0' }),
            surface3('f4', '1 + sin(2x + 3)*cos(y)', 'teal', { meshOpacity: 1, opacity: 0.6, colormap: 'diverging', samples: 16, xDomain: '-3:-1', yDomain: '0:3' }),
            surface3('f5', 'sqrt(4 - x^2 - y^2)', 'purple', { meshOpacity: 0, opacity: 0.7, samples: 20 }),
        ],
        tools: [{ id: 'a', name: 'PL1', type: 'plane3D', color: 'orange', axis: 'z', value: '1', fillOpacity: 0.3 }],
    }),
    // Ranges TeX cannot hold as unit vectors: pgfplots' own fit.
    // Axis numbers (src/ticks.ts): steps in π, chosen values with labels that need escaping, Off with a grid, in 2D and 3D.
    numbers2d: chart({
        xmin: '-0.3',
        xmax: '6.6',
        ymin: '-2.6',
        ymax: '2.6',
        showLargeGrid: true,
        showSmallGrid: true,
        numbers_x: 'every',
        numbers_step_x: 'pi/2',
        numbers_y: 'at',
        numbers_at_y: '-2 "$-a$", 0, 2 "top & 50%"',
        functions: [fn('f1', '2sin(x)')],
    }),
    numbers2dOff: chart({ showLargeGrid: true, numbers_x: 'off', numbers_y: 'every', numbers_step_y: '0.5', axis_style: 'middle', functions: [fn('f1', 'x^2/8')] }),
    numbers3d: chart({
        dimension: true,
        boxAspect: 'equal',
        showLargeGrid: true,
        xmin: '-2',
        xmax: '2',
        ymin: '-2',
        ymax: '2',
        zmin: '0',
        zmax: '8',
        numbers_x: 'off',
        numbers_y: 'every',
        numbers_step_y: '1',
        numbers_z: 'at',
        numbers_at_z: '0 "ground", 8 "$z_{max}$"',
        functions3D: [surface3('f1', 'x^2 + y^2', 'blue')],
    }),
    // 6.2.1: `no axes` in 3D: hide axis; with a grid, invisible axes that keep the grid on the back planes.
    noAxes3d: chart({ dimension: true, showAxis: false, xmin: '-2', xmax: '2', ymin: '-2', ymax: '2', zmin: '0', zmax: '8', functions3D: [surface3('f1', 'x^2 + y^2', 'blue', { colormap: 'viridis' })] }),
    noAxesGrid3d: chart({
        dimension: true,
        showAxis: false,
        showLargeGrid: true,
        showSmallGrid: true,
        numbers_z: 'every',
        numbers_step_z: '2',
        xmin: '-2',
        xmax: '2',
        ymin: '-2',
        ymax: '2',
        zmin: '0',
        zmax: '8',
        functions3D: [surface3('f1', 'x^2 + y^2', 'blue')],
    }),
    tiny3d: chart({
        dimension: true,
        boxAspect: 'equal',
        xmin: '-2',
        xmax: '2',
        ymin: '-2',
        ymax: '2',
        zmin: '0',
        zmax: '0.001',
        functions3D: [surface3('f1', '0.0005 + 0.0001*x*y', 'green', { samples: 20 })],
    }),
    // LaTeX commands in labels (texLabel): styled text, escapes and math-only commands outside $...$.
    latexLabels: chart({
        title: '\\textbf{Revenue} in \\%',
        axis_label_y: 'Preis in \\textit{EUR}',
        parameters: [{ name: 'omicron', value: 1, min: 0, max: 2, step: 0.1 }],
        functions: [
            fn('f1', '09*x + 010', { showLegend: true, legendLabel: '\\textit{Nachfrage}' }),
            fn('f2', 'omicron*x', { color: 'red', showLegend: true }),
        ],
        annotations: [
            { x: '2', y: '3', text: '\\textbf{A}', color: 'black', size: 'normal', anchor: 'center' },
            { x: '5', y: '2', text: 'level \\alpha = 0.05', color: 'blue', size: 'small', anchor: 'right' },
        ],
    }),
    // CSS colour names, middle axes with labels beyond the tips, a legend.
    colors: chart({
        axis_style: 'middle',
        xmin: '-2',
        xmax: '2',
        ymin: '-2',
        ymax: '4',
        functions: ['lime', 'Navy', 'darkgray', 'violet', '#ff8800', 'white', 'nope'].map((color, i) =>
            fn(`f${i + 1}`, `x / 2 + ${i / 2}`, { color, showLegend: i < 3 })
        ),
    }),
};

// ------------------------------------------------- beyond functions (5.0)

/** A table above a block, as the note holds it: a header with a %, a typeset minus, a row that is no number. */
const SCORES: NoteTable = {
    headers: ['Hours studied', 'Score (%)'],
    rows: [['1', '52'], ['2', '55'], ['3', '61'], ['4', '\u221260'], ['5', '68'], ['6', 'n/a']],
};

/** Charts of data, probability, Riemann sums and slope fields, written as text, with the note's table where they read one. */
// 6.0 C: motion: a vector field coloured by length with still particles, streamlines and labelled rest points;
// every step as a frame (a coloured solution among them); the Lorenz system in 3D coloured by time; frames as a snippet.
const MOTION6: Record<string, string> = {
    field: 'show x from -4 to 4 and y from -3 to 3\ndraw the vector field $F(x, y) = (y, -\\sin x - 0.25y)$, coloured by length, with moving particles and streamlines\nmark the rest points of F, labelled',
    frames: 'frames\nshow x from -4 to 4 and y from -3 to 3\nmark P at (1, 0)\nplot f(x) = sin(x)\nthen draw the solution of $\\dot{p} = (y, -x)$ through P for t from 0 to 6, coloured by time\nthen draw the vector field (y, -x), with streamlines',
    lorenz: '3d\nshow x from -25 to 25 and y from -30 to 30 and z from 0 to 50\ndraw the solution of $\\dot{p} = (10(y - x), x(28 - z) - y, xy - \\frac{8}{3}z)$ through (1, 1, 1) for t from 0 to 72, coloured by time',
    framesSnippet: 'snippet\nframes\nplot f(x) = x^2\nthen shade between f and 0 from x = 0 to 1 pattern dots',
};

// 6.0 E: iterate and colour the plane: the Mandelbrot set (\addplot graphics) with an orbit, a grid and a legend; a Julia set
// and domain colouring as frames (a PNG per step); a heat map under gradient descent; a cobweb, a bifurcation diagram
// (a picture too), Newton's method and still turning circles with their wave; a plane in a snippet.
const ITERATE: Record<string, string> = {
    mandelbrot: 'show x from -2.5 to 1 and y from -1.25 to 1.25\ngrid\nplot f(x) = x^2 - 1 in red, with a legend\nmark P at (-0.12, 0.75)\ncolour the plane by $z_{n+1} = z_n^2 + c$, $z_0 = 0$, $c = x + iy$, 150 steps\ndraw the orbit of $z_{n+1} = z_n^2 + c$, $z_0 = 0$, $c = P$, 40 steps, labelled',
    frames: 'frames\nshow x from -2 to 2 and y from -1.5 to 1.5\nslider a from -1 to 1, starting at -0.8\ncolour the plane by $z_{n+1} = z_n^2 + c$, $z_0 = x + iy$, $c = a + 0.156i$, 200 steps\nthen colour the plane by $f(z) = \\frac{z^2 - 1}{z^2 + 1}$, opacity 0.6',
    gradient: 'show x from -3 to 3 and y from -2 to 2\nslider eta from 0 to 0.5, starting at 0.1\nlet $f(x, y) = x^2 + 4y^2$\nmark P at (2.5, 1.5)\ncolour the plane by $f(x, y)$, in viridis, opacity 0.5\ndraw the orbit of $p_{n+1} = p_n - \\eta \\nabla f(p_n)$, $p_0 = P$, 25 steps, labelled',
    lines: 'show x from 0 to 1 and y from 0 to 1\nslider r from 2.5 to 4, starting at 3.7\nplot $f(x) = r x (1 - x)$ in blue, thick\ndraw the cobweb of $x_{n+1} = f(x_n)$ from 0.2, 80 steps',
    bifurcation: 'show x from 2.5 to 4 and y from 0 to 1\ndraw the bifurcation diagram of $x_{n+1} = r x_n (1 - x_n)$ for r from 2.5 to 4\nplot g(x) = 0.5 in orange, dashed',
    newton: "show x from -1 to 3 and y from -3 to 6\nplot f(x) = x^2 - 2\ndraw Newton's method for f from 2.5, 5 steps, labelled",
    circles: 'show x from -3 to 9 and y from -2 to 2\nequal scale\nslider n from 1 to 20, starting at 5, in steps of 1\ndraw the circles of $\\sum_{k=1}^{n} \\frac{4}{\\pi (2k - 1)} e^{i(2k - 1)t}$, with its wave',
    snippet: 'snippet\naxes in the middle\nshow x from -2 to 2 and y from -2 to 2\ncolour the plane by $f(z) = z^3 - 1$',
};

// 6.0 G: GeoGebra lines: a pasted construction (points, a circle, a polygon, a list, a curve, a text, transforms) and the screenshot's point set.
const GEOGEBRA: Record<string, string> = {
    construction: [
        'show x from -2 to 7 and y from -2 to 6',
        'equal scale',
        'a = Slider(1, 3)',
        'A = (1, 1)',
        'B = (5, 1)',
        'C = (2.5, a + 1)',
        'p = Polygon(A, B, C)',
        'c = Circle(A, B, C), dashed',
        'L = Sequence((k, k^2 / 8), k, 0, 6)',
        'K = Curve(cos(t), sin(2t), t, 0, 2pi) in red',
        'l = Line(A, C)',
        'v = Vector(A, Midpoint(B, C))',
        'm = Reflect(p, l)',
        'T = Text("|AB| = " + Distance(A, B), (-1, 5))',
        'f = x^2 / 4 - 1',
    ].join('\n'),
    // 6.0 AI: y to 1.45, so the Newton orbit from Z_0 fits (its third point is (-1.99, 1.302)).
    screenshot: [
        'show x from -2.2 to 0.8 and y from -1.45 to 1.45',
        'equal scale',
        'P = Flatten(Sequence(Sequence(a + b ί, a, -2.2, 0.8, 0.04), b, -1.3, 1.3, 0.04)), hidden',
        'M = KeepIf(abs(Element(IterationList(z^2 + c, z, {0 + 0ί}, 20), 21)) <= 2, c, P)',
        'c = -0.12 + 0.75ί',
        'IterationList(z^2 + c, z, {0 + 0ί}, 30), in red',
        'Z_0 = (0.3, 0.9)',
        'IterationList(z - (z^3 - 1) / (3z^2), z, {Z_0}, 30), in blue',
    ].join('\n'),
};

// 6.0 P: Python blocks: the Fourier heart (a list of coefficients, its path), a matplotlib-style plot with a
// legend, a fill, texts with $ math $, a contour and an imshow picture, and a script with frame(t) (its still frame).
const PYTHON: Record<string, string> = {
    heart: 'show x from -20 to 20 and y from -15 to 15\nequal scale\nslider n from 1 to 120, starting at 40, in steps of 1\npython:\n    import numpy as np\n    t = np.linspace(0, 2*np.pi, 256, endpoint=False)\n    heart = 16*np.sin(t)**3 + 1j*(13*np.cos(t) - 5*np.cos(2*t) - 2*np.cos(3*t) - np.cos(4*t))\n    c = np.fft.fft(heart) / len(heart)\ndraw the circles of c, using n circles, with its path',
    plot: 'show x from -3.5 to 3.5 and y from -1.5 to 1.5\nslider a from -3 to 3, starting at 0.5\npython:\n    import numpy as np\n    import matplotlib.pyplot as plt\n    x = np.linspace(-np.pi, np.pi, 200)\n    for k in range(1, 4):\n        plt.plot(x, np.sin(k * x + a) / k, label=f"$k = {k}$")\n    plt.fill_between(x, 0, np.sin(x + a), alpha=0.2)\n    plt.scatter([0, 1], [0, 0.5], c="C3")\n    plt.text(1.5, 1, "50% of $x^2$")\n    plt.axhline(0.5, color="k", linestyle="--")\n    plt.title("Waves")\n    plt.legend()',
    picture: 'show x from -2 to 2 and y from -2 to 2\npython:\n    import numpy as np\n    import matplotlib.pyplot as plt\n    X, Y = np.meshgrid(np.linspace(-2, 2, 40), np.linspace(-2, 2, 40))\n    Z = np.exp(-(X**2 + Y**2))\n    plt.imshow(Z, extent=[-2, 2, -2, 2], origin="lower", cmap="viridis")\n    plt.contour(X, Y, Z, levels=[0.2, 0.5, 0.8], colors="white")',
    frame: 'show x from 0 to 7 and y from -1.5 to 1.5\npython:\n    import numpy as np\n    import matplotlib.pyplot as plt\n    x = np.linspace(0, 2 * np.pi, 120)\n    def frame(t):\n        plt.plot(x, np.sin(x - t), color="C0")\n        plt.arrow(1, 0, 1, np.cos(t))',
};

const BEYOND: Record<string, { text: string; table?: NoteTable | null }> = {
    // The table's points with labels, bars, a line and the regression line with its equation; the headers name the axes.
    dataTable: {
        text: [
            'show x from 0 to 7 and y from -70 to 80',
            'axes in the middle',
            'use the table above',
            'draw the data as bars in orange, opacity 0.4',
            'draw the data as a line, dashed',
            'mark the data, labelled "({x}, {y})"',
            'draw its regression line in red, thick, labelled',
        ].join('\n'),
        table: SCORES,
    },
    // Typed data, a second set, a regression label of its own; a chart in a note without a table draws the rest.
    dataTyped: {
        text: [
            'show x from 0 to 6 and y from 0 to 80',
            'title slope {D1_y2 - D1_y:1}',
            'data (1, 52), (2, 55), (3, 61), (4, 60), (5, 68)',
            'mine: data (0.5, 10), (1.5, 30), (2.5, 20)',
            'mark the data of D1, large',
            'draw the data of mine as bars, opacity 1',
            'draw the regression line of D1, labelled "$m = {m:2}$, 50% fit {r2:2}"',
            'use the table above',
        ].join('\n'),
        table: null,
    },
    // A normal density on sliders with a LaTeX event, a patterned tail, a narrow second density.
    normal: {
        text: [
            'show x from -4 to 4 and y from 0 to 0.9',
            'axes in the middle',
            'slider m from -2 to 2, starting at 0.5',
            'slider s from 0.5 to 2, starting at 1',
            'plot the normal distribution with mean m and sd s, thick',
            'shade $P(m - s \\le X \\le m + s)$, labelled',
            'shade P(X >= 2.5) in red, pattern north-east, labelled',
            'N: plot the normal distribution with mean -2 and sd 0.5 in green, dashed',
            'shade P(X < -2.5) of N in green, labelled "tail {p:3}"',
        ].join('\n'),
    },
    // Riemann sums on a slider, every method, a function with a pole left out, a label of its own.
    riemann: {
        text: [
            'show x from -0.5 to 4.5 and y from -1.5 to 5.5',
            'slider n from 1 to 40, starting at 12, in steps of 1',
            'plot f(x) = x^2/4 + 1, thick',
            'plot g(x) = 1/(x - 3), hidden',
            'draw the left Riemann sum of f from 0 to 4 with n parts, labelled',
            'draw the right Riemann sum of f from 0 to 2 with 3 parts in red, opacity 0.2',
            'draw the middle Riemann sum of f from 2 to 4 with 4 parts in green, labelled "50% {sum:1}"',
            'draw the trapezoid rule of g from 2.5 to 4 with 6 parts in purple, labelled',
        ].join('\n'),
    },
    // A slope field with solutions through a named point and through points, at a wide size.
    slopeField: {
        text: [
            'show x from -3 to 3 and y from -3 to 3',
            'size 12 x 8',
            'axes in the middle',
            "draw the slope field of $y' = x - y$",
            'mark P at (-2, 1), large',
            'draw the solution through P',
            'draw the solutions through (0, -2) and (1, 2.5) in blue, dashed',
        ].join('\n'),
    },
    // Equal scale, a field with a singular line (y = 0) and a solution that ends where it turns vertical.
    slopeFieldEqual: {
        text: [
            'show x from -4 to 4 and y from -2 to 2',
            'equal scale',
            'slider r from 0.5 to 2, starting at 1',
            'draw the slope field of dy/dx = -x/y, thick, density=30',
            'draw the solution through (0, r) in green',
        ].join('\n'),
    },
    // Binomial bars, strict bounds, one value, a tiny probability as a power of ten.
    binomial: {
        text: [
            'show x from -1 to 21 and y from 0 to 0.25',
            'plot the binomial distribution with n = 20 and p = 0.3',
            'shade P(3 < X <= 8), labelled',
            'shade P(X = 12) in red, labelled',
            'shade P(X >= 17) in purple, labelled',
        ].join('\n'),
    },
};

// 6.0 B: sets on an axis (open and filled dots, arrows, unions, R with amssymb, points) and chords at a slider.
const NOTES6: Record<string, string> = {
    sets: [
        'show x from -5 to 5',
        'slider c from 0 to 9, starting at 4',
        'plot $g(x) = x^2 - c$',
        'mark where $g(x) \\le 0$ on the x-axis, labelled',
        'mark where $g(x) > 0$ on the x-axis in red, labelled',
        'mark where $g(x) = 0$ on the x-axis in blue, labelled',
        'mark where $y^2 < 4$ on the y-axis in purple, labelled',
    ].join('\n'),
    everything: ['show x from -3 to 3 and y from -1 to 3', 'mark where $x^2 \\ge -1$ on the x-axis, labelled'].join('\n'),
    snippet: ['snippet', 'show x from -3 to 3 and y from -1 to 3', 'mark where $x^2 \\ge -1$ on the x-axis, labelled'].join('\n'),
    chord: [
        'show x from -3 to 4 and y from -2 to 6',
        'slider lambda from 0 to 1, starting at 0.3',
        'plot $g(x) = x^2/2 - 1$ in blue',
        'draw the chord of g from -1 to 3 at $\\lambda$, labelled',
        'draw the chord of g from -2 to 0 in green, dashed',
    ].join('\n'),
};

// ------------------------------------------------------------- values (6.0 A)

/** Charts of values: sums written out, let functions, complex numbers, vector arrows and the points of a list, 2D and 3D. */
const VALUES: Record<string, string> = {
    // Taylor and Fourier sums on sliders, a let function in a plot, the modulus of a complex function.
    sums: [
        'show x from -6 to 6 and y from -2.5 to 2.5',
        'slider n from 0 to 12, starting at 5, in steps of 1',
        'plot $T(x) = \\sum_{k=0}^{n} \\frac{(-1)^k x^{2k+1}}{(2k+1)!}$, thick',
        'plot $S(x) = \\sum_{k=1}^{n} \\frac{\\sin((2k - 1)x)}{2k - 1}$ in red',
        'let $f(x, y) = x^2 / 8 + y^2$',
        'plot g(x) = f(x, 1) - 2 in green',
        'let $c = -0.8 + 0.156i$',
        'plot $h(x) = |e^{ix} + c|$ in purple, dashed',
        'write "${5 \\choose 2} = {binom(5, 2)}$, $|c| = {|c|:3}$" at (-4, 2)',
    ].join('\n'),
    // Arrows of vectors (labelled with arrows on the names), tip to tail, from a point; the roots of unity.
    arrows: [
        'show x from -3 to 3 and y from -3 to 3',
        'equal scale',
        'slider n from 3 to 12, starting at 7, in steps of 1',
        'let v = (2, 1)',
        'let $w = \\begin{pmatrix} -1 \\\\ 1.5 \\end{pmatrix}$',
        'let A = [[0, -1], [1, 0]]',
        'draw v and w as arrows, labelled',
        'draw v + w tip to tail in red, labelled',
        'draw A v as an arrow from (-1, -2) in green, labelled',
        'draw (1, -2) as an arrow in orange, labelled',
        'mark the points $\\{e^{2\\pi i k / n} : k = 0, \\dots, n - 1\\}$, joined, labelled',
    ].join('\n'),
    // In space: arrows end to end with labels at their tips, and a joined list of points.
    arrows3d: [
        '3d',
        'show x from -1 to 3 and y from -1 to 3',
        'let u = (1, 2, 1)',
        'let v = (1, 0, 1.5)',
        'draw u + v tip to tail, labelled',
        'draw u \\times v as an arrow in red, labelled',
        'mark the points of [(1, 0, 0), (0, 1, 0), (0, 0, 1)], joined',
    ].join('\n'),
};

/** 6.0 D: linear algebra and complex maps. */
const LINEAR: Record<string, string> = {
    // A grid, î and ĵ, the unit square with det, a function, eigenvectors and a span, moved by A in a step.
    matrix: [
        'show x from -4.5 to 4.5 and y from -3 to 3',
        'equal scale',
        'let $A = \\begin{pmatrix} 1.5 & 1 \\\\ 0.5 & 2 \\end{pmatrix}$',
        'plot f(x) = x^2/4 in purple',
        'draw the grid',
        'draw the basis vectors',
        'shade the unit square, labelled "det A = {det(A)}"',
        'then transform the plane by A',
        'then draw the eigenvectors of A, labelled',
        'draw the span of (1, 0), labelled',
    ].join('\n'),
    // Every step side by side, a rotation without real eigenvectors.
    frames: ['frames', 'show x from -3 to 3 and y from -3 to 3', 'let R = [[0, -1], [1, 0]]', 'draw the grid from -2 to 2', 'draw the basis vectors', 'then transform the plane by R', 'draw the eigenvectors of R, labelled'].join('\n'),
    // z ↦ z² bends a small grid; the plane spanned by two vectors.
    complex: ['show x from -3 to 3 and y from -2 to 2', 'draw the grid from -1.5 to 1.5 in steps of 0.25', 'transform the plane by $z \\mapsto z^2$', 'draw the span of (1, 2) and (2, 1), labelled'].join('\n'),
    // In space: the grid cube, î ĵ k̂ and the unit cube with its volume.
    space: ['3d', 'show x from -3 to 3 and y from -3 to 3', 'let B = [[1, 0.5, 0], [0, 1, 0], [0, 0.5, 1.5]]', 'draw the grid from -1 to 1', 'draw the basis vectors', 'shade the unit cube, labelled', 'transform space by B', 'draw the eigenvectors of B, labelled'].join('\n'),
};

// ------------------------------------------------------------- clean look (6.1)

/**
 * The clean look (the default): axes through 0 or at the near edge with
 * their numbers, the light grid, numbers left empty where they would sit on
 * a dot or a curve, value pills, named axes with a title, explicit numbers.
 * Every other case above compiles in the clean look too (it is the default).
 */
const CLEAN: Record<string, { text: string; table?: NoteTable | null }> = {
    parabola: { text: ['show x from -4 to 4 and y from -5 to 5', 'slider a from 0.5 to 2, starting at 1', 'plot f(x) = a x^2 - 4 in blue, with its extrema', 'mark where $f(x) = 0$ on the x-axis, labelled'].join('\n') },
    tableData: { text: ['show x from 0.5 to 6.5 and y from 40 to 75', 'use the table above', 'mark the data', 'draw its regression line in red, labelled'].join('\n'), table: SCORES },
    tangentArea: {
        text: ['show x from -3 to 3 and y from -4 to 4', 'slider a from -1.1 to 1.1, starting at 1', 'plot f(x) = x^3 - 3x in blue', 'plot g(x) = f(a) + (3a^2 - 3)(x - a) in red', 'P: mark where f and g cross, with coordinates', 'shade between f and g from x = P_x to P_x2 in orange'].join('\n'),
    },
    negative: { text: ['show x from -9 to -1 and y from -8 to -2', 'title Below and left of 0', 'xlabel time', 'ylabel height', 'plot f(x) = x/2 - 3, thin', 'x numbers every 2', 'with a minor grid'].join('\n') },
    noGrid: { text: ['show x from -2 to 2 and y from -1 to 3', 'no grid', 'axes on the edges', 'plot $f(x) = e^x$, thick', 'y numbers at 1 "one", 2'].join('\n') },
    // 6.2.1: numbers moved off large dots (\raisebox, \kern), a legend entry with \to in the corner the label leaves free,
    // a title of words and math, and a text written at the edge moved back in (xshift).
    movedNumbers: {
        text: ['show x from -1 to 4 and y from -1 to 3', 'title Case 1: $\\max 2x_1 + x_2$ – an edge', 'mark (1, 0), (2, 0) and (0, 2) in red, large', 'write "a text written at the right edge" at (3.5, 1), right'].join('\n'),
    },
    unicodeText: {
        text: ['show x from -4.5 to 4.5 and y from -1 to 3', 'axes in a box', 'write "P0: v\u0302 = 4.875 \u2192 branch, \u1e7d = 4.75" at (0, 2.25), above', 'write "y = 1: x \u2264 -2 + 6(1 - y), x \u2265 2, \u03b1 \u2208 [0, 1]" at (0, 1), above', 'title Cut $x_2 \u2264 2$'].join('\n'),
    },
    arrowLegend: {
        text: ['show x from -1.5 to 3.5 and y from -6.5 to 6.5', 'plot f(x) = (x - 1)^2 + 2 in blue, with the legend "$f(x) = (x-1)^2 + 2 \\to \\min$"', 'plot g(x) = -(x - 1)^2 - 2 in red, with the legend "$-f(x) \\to \\max$"', 'draw x = 1 in gray, dashed, labelled "$x^* = 1$"'].join('\n'),
    },
};

// ------------------------------------------------------- the axes, one by one (6.2.1)

/**
 * The settings under Chart look: Clean with thick axes, arrowheads and the
 * names x and y (axes through the middle, the names beyond their ends), and
 * Classic with small numbers; and a 3D box in thin lines with small numbers.
 */
const TANGENT = ['show x from -3 to 3 and y from -1 to 5', 'axes in the middle', 'plot f(x) = x^2 in blue', 'plot t(x) = 2x - 1 in red, dashed', 'P: mark (1, 1), labelled "P"'].join('\n');
const AXES: Record<string, { text: string; look: ChartLook; axes: Partial<AxisSettings> }> = {
    cleanThickArrowsNames: { text: TANGENT, look: 'clean', axes: { line: 'thick', arrows: 'on', names: 'always' } },
    classicSmallNumbers: { text: TANGENT, look: 'classic', axes: { numbers: 'small' } },
    classicThinNoArrows: { text: ['show x from 0 to 6 and y from 0 to 4', 'axes on the edges', 'plot f(x) = sqrt(x)'].join('\n'), look: 'classic', axes: { line: 'thin', arrows: 'off' } },
    cleanLargeEdges: { text: ['show x from 1 to 9 and y from 2 to 8', 'plot f(x) = x - 1', 'xlabel time'].join('\n'), look: 'clean', axes: { numbers: 'large', arrows: 'on' } },
    surfaceThinSmall: { text: ['3d', 'show x from -2 to 2 and y from -2 to 2', 'plot z = x^2 - y^2'].join('\n'), look: 'clean', axes: { line: 'thin', numbers: 'small', names: 'named' } },
};

// --------------------------------------------------------------- compile

/** The block's export as a complete document. Snippets are wrapped using their own `% Needs:` lines. */
function documentFor(data: Record<string, unknown>, table?: NoteTable | null, filesDir?: string): string {
    const settings = SettingsManager.fromJSON(JSON.parse(JSON.stringify(data)));
    if (table !== undefined) settings.noteTable = table;
    // 6.0 E: the pictures of coloured planes go beside the .tex file.
    const { result: code, files } = collectExportFiles(() => settings.generateTikzCode());
    if (filesDir) for (const f of files) fs.writeFileSync(path.join(filesDir, f.name), f.bytes);
    if (code.startsWith('\\documentclass')) return code;
    const needs = code
        .split('\n')
        .filter((l) => l.startsWith('% Needs: '))
        .map((l) => l.slice('% Needs: '.length));
    assert.ok(needs.length >= 2, 'a snippet lists what it needs');
    return ['\\documentclass{article}', ...needs, '\\begin{document}', code, '\\end{document}'].join('\n');
}

/** First error of a pdflatex log with the lines that explain it. */
function logExcerpt(log: string): string {
    const lines = log.split('\n');
    const at = lines.findIndex((l) => l.startsWith('!'));
    if (at < 0) return lines.slice(-25).join('\n');
    return lines.slice(Math.max(0, at - 2), at + 12).join('\n');
}

function compile(dir: string, name: string, tex: string): Promise<void> {
    fs.writeFileSync(path.join(dir, `${name}.tex`), tex);
    return new Promise((resolve, reject) => {
        const child = spawn('pdflatex', ['-interaction=nonstopmode', '-halt-on-error', `${name}.tex`], {
            cwd: dir,
            stdio: 'ignore',
            timeout: TIMEOUT_MS,
        });
        child.on('error', reject);
        child.on('close', (code, signal) => {
            if (code === 0 && fs.existsSync(path.join(dir, `${name}.pdf`))) {
                resolve();
                return;
            }
            const logFile = path.join(dir, `${name}.log`);
            const log = fs.existsSync(logFile) ? fs.readFileSync(logFile, 'utf8') : '(no log)';
            const why = signal ? `timed out after ${TIMEOUT_MS / 1000} s` : `exit code ${code}`;
            reject(new Error(`pdflatex failed on ${name}.tex (${why}):\n${logExcerpt(log)}`));
        });
    });
}

/** Runs compile jobs PARALLEL at a time; each test awaits its own job. */
function pool(jobs: Array<{ name: string; run: () => Promise<void> }>): Map<string, Promise<void>> {
    const out = new Map<string, Promise<void>>();
    const queue: Array<() => void> = [];
    let active = 0;
    const acquire = () =>
        new Promise<void>((resolve) => {
            const go = () => {
                active++;
                resolve();
            };
            if (active < PARALLEL) go();
            else queue.push(go);
        });
    const release = () => {
        active--;
        const next = queue.shift();
        if (next) next();
    };
    for (const job of jobs) {
        const p = acquire().then(() => job.run().finally(release));
        // The test awaiting this job reports its failure.
        p.catch(() => undefined);
        out.set(job.name, p);
    }
    return out;
}

const hasLatex = spawnSync('pdflatex', ['--version'], { stdio: 'ignore' }).status === 0;

if (!hasLatex) {
    test('latex compile tests (skipped: pdflatex is not on PATH)', () => undefined);
} else {
    const keep = process.env.ETZ_LATEX_KEEP;
    const dir = keep ? path.resolve(keep) : fs.mkdtempSync(path.join(os.tmpdir(), 'etz-latex-'));
    fs.mkdirSync(dir, { recursive: true });

    const cases: Array<{ name: string; data: Record<string, unknown>; table?: NoteTable | null; look?: ChartLook; axes?: Partial<AxisSettings> }> = [];
    for (const ex of EXAMPLES) cases.push({ name: `example-${ex.id}`, data: ex.data });
    // The live chart of the "What's new" popup, which Try an example opens in the editor.
    cases.push({ name: 'whats-new', data: whatsNewChart() });
    // The finished chart of every guide: the block its page on GitHub offers to paste.
    for (const guide of GUIDES) cases.push({ name: `guide-${guide.id}`, data: guide.chart });
    for (const [k, data] of Object.entries(LEGACY_2D)) cases.push({ name: `legacy-${k}`, data });
    for (const [k, data] of Object.entries(LEGACY_3D)) cases.push({ name: `legacy-${k}`, data });
    for (const [k, data] of Object.entries(STRESS)) cases.push({ name: `stress-${k}`, data });
    // Snippet mode for a 2D picture with patterns and braces, and for a 3D one.
    cases.push({ name: 'snippet-2d', data: { ...STRESS.pgfmath, documentSetup: false, tools: [...(STRESS.pgfmath.tools as unknown[]), ...(STRESS.hole.tools as unknown[])] } });
    cases.push({ name: 'snippet-3d', data: { ...STRESS.surface3d, documentSetup: false } });
    for (const [k, c] of Object.entries(BEYOND)) cases.push({ name: `beyond-${k}`, data: parseChartText(c.text).data, table: c.table });
    for (const [k, text] of Object.entries(MOTION6)) cases.push({ name: `motion6-${k}`, data: parseChartText(text).data }); // 6.0 C
    for (const [k, text] of Object.entries(NOTES6)) cases.push({ name: `notes6-${k}`, data: parseChartText(text).data }); // 6.0 B
    // 6.0 A
    for (const [k, text] of Object.entries(VALUES)) cases.push({ name: `values-${k}`, data: parseChartText(text).data });
    // 6.0 D
    for (const [k, text] of Object.entries(LINEAR)) cases.push({ name: `linear-${k}`, data: parseChartText(text).data });
    for (const [k, text] of Object.entries(ITERATE)) cases.push({ name: `iterate-${k}`, data: parseChartText(text).data }); // 6.0 E
    for (const [k, text] of Object.entries(GEOGEBRA)) cases.push({ name: `geogebra-${k}`, data: parseChartText(text).data }); // 6.0 G
    for (const [k, text] of Object.entries(PYTHON)) cases.push({ name: `python-${k}`, data: parseChartText(text).data }); // 6.0 P
    for (const [k, c] of Object.entries(CLEAN)) cases.push({ name: `clean-${k}`, data: parseChartText(c.text).data, table: c.table }); // 6.1
    for (const [k, c] of Object.entries(AXES)) cases.push({ name: `axes-${k}`, data: parseChartText(c.text).data, look: c.look, axes: c.axes }); // 6.2.1

    const jobs = pool(
        cases.map((c) => ({
            name: c.name,
            run: () => {
                // 6.2.1: the settings under Chart look, set for this export only (it runs at once, nothing else in between).
                if (c.look) setChartLook(c.look);
                if (c.axes) setAxisSettings({ ...AS_THE_LOOK, ...c.axes });
                let tex: string;
                try {
                    tex = documentFor(c.data, c.table, dir);
                } finally {
                    setChartLook('clean');
                    setAxisSettings(AS_THE_LOOK);
                }
                // Labels keep their LaTeX: nothing typed is printed as a literal backslash.
                assert.ok(!tex.includes('\\textbackslash'), `${c.name} prints a literal backslash`);
                return compile(dir, c.name, tex);
            },
        }))
    );
    for (const c of cases) {
        test(`pdflatex compiles ${c.name}`, async () => {
            await jobs.get(c.name);
        });
    }
    test('cleanup', async () => {
        await Promise.allSettled(Array.from(jobs.values()));
        if (!keep) fs.rmSync(dir, { recursive: true, force: true });
        else console.log(`  kept the LaTeX files in ${dir}`);
    });
}
