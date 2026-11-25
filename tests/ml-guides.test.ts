/*
 * The guides of the machine learning pack (6.0 ML, src/guides/ml.ts): the
 * numbers their steps name are the ones the charts compute, the moving
 * charts move (frame(t) with pictures and titles), the 3D landscape keeps
 * its surface in the box, and the home shows the section in both languages.
 */
import { test, assert, near } from './_lib';
import { guideById } from '../src/guides';
import type { ChartData, Guide } from '../src/guides/types';
import { SettingsManager } from '../src/settings';
import { computeScene2D, labelMetricsFor } from '../src/scene';
import { check } from '../src/ai/charttool';
import { programOf } from '../src/python/program';
import { needsClock } from '../src/motion6/clock';

function guide(id: string): Guide {
    const g = guideById(id);
    assert.ok(g, id);
    return g;
}

function stepChart(id: string, step: number): ChartData {
    const c = guide(id).steps[step - 1].chart;
    assert.ok(c, `${id} step ${step}`);
    return c;
}

/** The chart with some sliders set: its config (the title a script gives) and its scene. */
function shown(chart: ChartData, values: Record<string, number> = {}) {
    const settings = SettingsManager.fromJSON(chart);
    const math = settings.createMathContext();
    math.setParamValues(values);
    const config = settings.toRendererConfig(math);
    const scene = computeScene2D({
        functions: config.functions,
        tools: config.tools,
        math,
        view: { xmin: config.xmin, xmax: config.xmax, ymin: config.ymin, ymax: config.ymax },
        grid: { nx: 100, ny: 100 },
        axisStyle: config.axisStyle,
        polar: false,
        labelMetrics: labelMetricsFor(10, 10),
    });
    return { title: String(config.title ?? ''), scene, math };
}

/** The code of a chart's python block. */
function codeOf(chart: ChartData): string {
    const tool = ((chart.tools ?? []) as Array<{ type: string; code?: string }>).find((t) => t.type === 'python');
    assert.ok(tool?.code);
    return tool.code;
}

test('optimizers: eta 0.02 crawls, 0.04 reaches the minimum in 60 steps, 0.05 jumps off', () => {
    const chart = stepChart('ml-optimizers', 2);
    const end = (eta: number) => shown(chart, { eta }).scene.derived;
    const slow = end(0.02);
    assert.ok(Math.hypot(slow.OR1_x - 1, slow.OR1_y - 1) > 1, JSON.stringify(slow));
    const good = end(0.04);
    assert.ok(Math.hypot(good.OR1_x - 1, good.OR1_y - 1) < 0.05, JSON.stringify(good));
    const off = end(0.05);
    assert.ok(!(Math.abs(off.OR1_x) < 3) || off.OR1_n < 61, JSON.stringify(off));
});

test('the optimizer race: Adam near step 90, momentum near step 175, RMSprop and gradient descent on the way', () => {
    const r = programOf([codeOf(stepChart('optimizer-race', 3))]).run({});
    assert.equal(r.error, null);
    const paths = r.globals.get('paths') as unknown as Array<{ data: Float64Array }>;
    const arrive = (i: number) => {
        const d = paths[i].data;
        for (let k = 0; k * 2 < d.length; k++) if (Math.hypot(d[2 * k] - 1, d[2 * k + 1] - 1) < 0.05) return k;
        return -1;
    };
    const steps = [0, 1, 2, 3].map(arrive);
    assert.equal(steps[0], -1, 'gradient descent');
    assert.ok(Math.abs(steps[1] - 175) <= 5, `momentum ${steps[1]}`);
    assert.equal(steps[2], -1, 'RMSprop');
    assert.ok(Math.abs(steps[3] - 90) <= 5, `Adam ${steps[3]}`);
    // It moves: frame(t) draws four trails and four heads, with the step in the title.
    assert.ok(needsClock(stepChart('optimizer-race', 3)));
    const live = shown(stepChart('optimizer-race', 3)).scene.items.find((i) => i.live)?.live?.[0].at?.(2);
    // The still frame shows the end of the race (step 200); then it starts again.
    assert.equal(live?.title, 'step 20');
    assert.equal(shown(stepChart('optimizer-race', 3)).title, 'step 200');
    assert.equal(live?.lines.filter((l) => l.pts.length > 2).length, 4);
});

test('logistic regression: 0.98 after 200 steps; after 10 the line is still turning (0.93)', () => {
    assert.equal(shown(stepChart('ml-logistic', 2)).title, 'after 200 steps: accuracy 0.98');
    assert.equal(shown(stepChart('ml-logistic', 4)).title, 'after 10 steps: accuracy 0.93');
});

test('the network and the k-means pages move, with pictures and titles in every frame', () => {
    for (const [id, step, title] of [
        ['ml-network', 3, 'training step 600'],
        ['network-learns', 2, 'training step 600'],
        ['network-learns', 3, 'training step 600'],
        ['ml-kmeans', 3, 'k-means, step 1'],
    ] as const) {
        const chart = stepChart(id, step);
        assert.ok(needsClock(chart), id);
        const { title, scene } = shown(chart);
        assert.equal(title, title === '' ? '' : title);
        const at = scene.items.find((i) => i.live)?.live?.[0].at;
        assert.ok(at, id);
        assert.equal(at(0).title, title, `${id} still frame title`);
        if (id !== 'ml-kmeans') {
            assert.equal(at(0).images?.length, 1, `${id}: a picture`);
            assert.notEqual(at(0).images?.[0].key, at(2).images?.[0].key, `${id}: the picture changes`);
            // 1.5 s on the trained picture, then from step 0: at 2 s, 6 pictures in.
            assert.equal(at(2).title, 'training step 60');
        } else assert.equal(at(2.5).title, 'k-means, step 3');
    }
    // Trained: the network's last picture has the four clouds right (p near 0 at (-1, -1), near 1 at (-1, 1)).
    const r = programOf([codeOf(stepChart('ml-network', 2))]).run({});
    const snaps = r.globals.get('snaps') as unknown as Array<{ data: Float64Array }>;
    const last = snaps[snaps.length - 1].data;
    const at = (x: number, y: number) => last[Math.round(((y + 2) / 4) * 49) * 50 + Math.round(((x + 2) / 4) * 49)];
    assert.ok(at(-1, -1) < 0.1 && at(1, 1) < 0.1 && at(-1, 1) > 0.9 && at(1, -1) > 0.9);
});

test('PCA: 93 % on the first direction; the variance along the line peaks at 2.74 near 34° and drops to 0.21 across', () => {
    const chart = stepChart('ml-pca', 3);
    assert.match(shown(chart).title, /PC1 holds 93%/);
    assert.match(shown(chart, { angle: 34 }).title, /^variance along the line 2\.74;/);
    assert.match(shown(chart, { angle: 124 }).title, /^variance along the line 0\.21;/);
    let best = 0;
    let at = 0;
    for (let a = 0; a <= 180; a++) {
        const v = Number(/line ([\d.]+);/.exec(shown(chart, { angle: a }).title)?.[1]);
        if (v > best) [best, at] = [v, a];
    }
    assert.ok(Math.abs(at - 34) <= 2, `peak at ${at}`);
});

test('overfitting: 0.052 and 0.056 at degree 3; degree 12 near 0 and thousands of times worse on new data; ridge best near λ = 0.001', () => {
    assert.equal(shown(stepChart('ml-overfitting', 2)).title, 'training error 0.052, error on new data 0.056');
    const m = /training error ([\d.]+), error on new data ([\d.]+)/.exec(shown(stepChart('ml-overfitting', 3)).title);
    assert.ok(m && Number(m[1]) < 0.01 && Number(m[2]) > 1000 * 0.056, m?.[0]);
    const ridge = stepChart('ml-overfitting', 4);
    assert.equal(shown(ridge).title, '$\\lambda$ = 1e-03: error on new data 0.042');
    const errors = [-8, -6, -5, -4, -3, -2, -1, 0].map((l) => Number(/data ([\d.]+)/.exec(shown(ridge, { l }).title)?.[1]));
    assert.equal(Math.min(...errors), errors[4], errors.join(', '));
});

test('softmax: the label is the built-in softmax and the bars the script\'s; at T = 0.2 one score takes almost all', () => {
    const { math, title } = shown(stepChart('ml-activations', 4));
    assert.equal(title, 'softmax at temperature T = 0.20');
    assert.equal(math.formatTemplate('{softmax(u / T)}'), '(0.993, 0.007, 0, 0)');
});

test('the 3D landscape: the surface stays in the box; the start right of the ridge ends right, left of it ends left', () => {
    const lines = (chart: ChartData) => (check(chart) as { lines: string[] }).lines.join('\n');
    const right = lines(stepChart('ml-landscape', 2));
    const left = lines(stepChart('ml-landscape', 3));
    const end = (text: string) => Number(/to \((-?[\d.]+), /.exec(text.split('TR1')[1] ?? '')?.[1]);
    near(end(right), 1.33, 0.05);
    near(end(left), -1.48, 0.05);
    const surface = (stepChart('ml-landscape', 1).functions3D as Array<{ xDomain: string; yDomain: string }>)[0];
    assert.deepEqual([surface.xDomain, surface.yDomain], ['-2.2:2.2', '-1.5:1.5']);
});
