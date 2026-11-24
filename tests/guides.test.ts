/*
 * Guides (src/guides): the data the Help tab and docs/guides are made from.
 *
 * Every chart of every guide must load into the editor without a single
 * issue, so the checks here collect what the two renderers would report
 * (they need a DOM; the scene, the math context and the settings do not):
 * axis ranges, sliders, functions and surfaces, the scene of every tool,
 * text labels and the title. The rest guards the contract in
 * src/guides/types.ts: ids, links between guides, step titles, the small
 * markdown subset, and that every "type" row is text its field accepts.
 */
import { test, assert } from './_lib';
import {
    GUIDES,
    GUIDE_CATEGORIES,
    GUIDE_LEVEL_LABELS,
    ChartData,
    Guide,
    guideById,
    guideUrl,
    guidesIn,
    searchGuides,
    searchMatch,
    searchScore,
    searchText,
    searchTokens,
    stepChart,
    // 6.0 F2
    V6_EXAMPLES,
    showcaseExamples,
} from '../src/guides';

import { issueText } from '../src/issues';
import { FunctionKind, LABEL_LOCALS, MathContext, ValidateKind } from '../src/mathcontext';
import { EXAMPLES, SCHEMA_VERSION, migrateSettings } from '../src/migrate';
import { SceneIssue, computeScene2D, computeScene3D, labelMetricsFor } from '../src/scene';
import { SettingsManager } from '../src/settings';
import { Annotation, FunctionParameters, Parameter, RendererConfig, Tool } from '../src/types';
import { marchingGrid } from '../src/util';

import { START_GUIDES } from '../src/guides/start';
import { LANGUAGE_GUIDES } from '../src/guides/language';
import { SHOWCASE_GUIDES } from '../src/guides/showcase';
import { FUNCTIONS_GUIDES } from '../src/guides/functions';
import { CALCULUS_GUIDES } from '../src/guides/calculus';
import { OPTIMISATION_GUIDES } from '../src/guides/optimisation';
import { DATA_GUIDES } from '../src/guides/data';
import { SHAPES_GUIDES } from '../src/guides/shapes';
import { SPACE_GUIDES } from '../src/guides/space';
import { NOTES_GUIDES } from '../src/guides/notes';
import { REFERENCE_GUIDES } from '../src/guides/reference';
// 6.0 F2
import { VALUES_GUIDES } from '../src/guides/values';
import { INTERACT_GUIDES } from '../src/guides/interact';
import { LINEAR_GUIDES } from '../src/guides/linear';
import { DYNAMICS_GUIDES } from '../src/guides/dynamics';
import { GEOGEBRA_GUIDES } from '../src/guides/geogebra'; // 6.0 G

/** The guides SPEC4 section 3 lists, per data file. README, docs/guides and the release posts link to them by id. */
const DOCUMENTED: Record<string, string[]> = {
    start: ['first-chart', 'notes-formulas', 'drag-to-edit'],
    language: ['chart-language', 'formulas'],
    showcase: [
        'tangent-triangle', 'largest-rectangle', 'mean-value', 'taylor-sine', 'gradient-levels', 'crossing-lines', 'sliding-ladder', 'throw-angle',
        // 6.0 F2
        'mandelbrot-orbit', 'matrix-grid', 'lorenz-butterfly', 'pendulum-field', 'domain-colouring', 'fourier-circles',
        // 6.0 showcase: the other prototypes of the plan page
        'complex-two-ways', 'two-valleys', 'julia-newton', 'logistic-map', 'unity-roots',
    ],
    functions: ['sliders', 'parametric-polar', 'animate-play'],
    calculus: ['tangents-extrema', 'secant-tangent', 'area-accumulation', 'riemann-sums', 'slope-fields'],
    optimisation: ['regions', 'areas-between', 'tangent-area', 'linear-program', 'integer-program', 'level-curves', 'supply-demand'],
    data: ['data-regression', 'probability'],
    shapes: ['points-labels', 'arrows-braces', 'computed-values'],
    space: ['surfaces-3d'],
    notes: ['charts-in-notes', 'svg-files', 'export-latex'],
    reference: ['from-3x', 'shortcuts'],
    // 6.0 F2: docs/v6/guides.md lists them
    values: ['values-let', 'sums-series'],
    interact: ['ask-curve', 'sets-convexity', 'formula-cards', 'steps-frames'],
    linear: ['vectors-arrows', 'matrix-plane', 'complex-maps'],
    dynamics: ['fractals', 'orbits-cobwebs', 'vector-fields', 'systems', 'descent-newton'],
    // 6.0 G
    geogebra: ['geogebra-commands'],
};
const FILES: Record<string, Guide[]> = {
    start: START_GUIDES,
    language: LANGUAGE_GUIDES,
    showcase: SHOWCASE_GUIDES,
    functions: FUNCTIONS_GUIDES,
    calculus: CALCULUS_GUIDES,
    optimisation: OPTIMISATION_GUIDES,
    data: DATA_GUIDES,
    shapes: SHAPES_GUIDES,
    space: SPACE_GUIDES,
    notes: NOTES_GUIDES,
    reference: REFERENCE_GUIDES,
    // 6.0 F2
    values: VALUES_GUIDES,
    interact: INTERACT_GUIDES,
    linear: LINEAR_GUIDES,
    dynamics: DYNAMICS_GUIDES,
    geogebra: GEOGEBRA_GUIDES, // 6.0 G
};

const EM_DASH = String.fromCharCode(0x2014);

function clone<T>(value: T): T {
    return JSON.parse(JSON.stringify(value)) as T;
}

function words(text: string): string[] {
    return text.trim().split(/\s+/).filter((w) => w.length > 0);
}

/** Every chart of a guide with a name for messages: the finished chart, then each step that has one. */
function chartsOf(guide: Guide): Array<{ where: string; chart: ChartData }> {
    const out = [{ where: `${guide.id}: finished chart`, chart: guide.chart }];
    guide.steps.forEach((step, i) => {
        if (step.chart) out.push({ where: `${guide.id}: step ${i + 1}`, chart: step.chart });
    });
    return out;
}

// ----------------------------------------------------------- chart issues

function chartOf(chart: ChartData): { settings: SettingsManager; math: MathContext; config: RendererConfig } {
    const settings = SettingsManager.fromJSON(clone(chart));
    // A private context, as the Help tab uses: nothing leaks between charts through the memo.
    const math = settings.createMathContext({ memo: false });
    return { settings, math, config: settings.toRendererConfig(math) };
}

/** Text labels and the title: what both renderers check after the scene has published its computed values. */
function labelIssues(config: RendererConfig, math: MathContext, out: SceneIssue[]): void {
    (config.annotations || []).forEach((a: Annotation, index) => {
        if (!a || a.hidden || !String(a.text ?? '').trim()) return;
        const source = `label:${index}`;
        const check = math.validate(a.text, 'template');
        if (!check.ok) out.push({ source, field: 'text', message: check.message, severity: 'error' });
        const fields: Array<['x' | 'y' | 'z', string | undefined]> = [
            ['x', a.x],
            ['y', a.y],
        ];
        if (config.is3D && a.z !== undefined && String(a.z).trim()) fields.push(['z', a.z]);
        for (const [field, src] of fields) {
            const res = math.tryValue(String(src ?? ''));
            if (!res.ok) out.push({ source, field, message: res.message, severity: 'error' });
        }
    });
    const title = String(config.title ?? '');
    if (title.trim()) {
        const check = math.validate(title, 'template', undefined, LABEL_LOCALS.plain);
        if (!check.ok) out.push({ source: 'chart', field: 'title', message: check.message, severity: 'error' });
    }
}

/**
 * Everything the editor would list for this chart after loading it (the
 * status chip on the preview), info notes included: an "unbounded" or
 * "empty region" note is still a chip, and a guide step must not show one.
 */
function chartIssues(chart: ChartData): string[] {
    const { settings, math, config } = chartOf(chart);
    const issues: SceneIssue[] = [];
    for (const text of settings.resolveView(math).errors) {
        if (/^z(min|max)/.test(text) && !config.is3D) continue;
        issues.push({ source: 'chart', message: text, severity: 'error' });
    }
    for (const p of math.parameterIssues()) issues.push(p);

    if (config.is3D) {
        const scene = computeScene3D({
            tools: config.tools,
            math,
            view: { xmin: config.xmin, xmax: config.xmax, ymin: config.ymin, ymax: config.ymax, zmin: config.zmin ?? -5, zmax: config.zmax ?? 5 },
        });
        issues.push(...scene.issues);
        (config.functions3D || []).forEach((surface, i) => {
            if (!surface || surface.hidden || !String(surface.expression ?? '').trim()) return;
            const source = surface.name || `Surface ${i + 1}`;
            try {
                math.fn2(surface.expression);
            } catch (e) {
                issues.push({ source, field: 'expression', message: e instanceof Error ? e.message : String(e), severity: 'error' });
            }
            for (const field of ['xDomain', 'yDomain'] as const) {
                const src = surface[field];
                if (!src || !src.trim()) continue;
                try {
                    math.domain(src);
                } catch (e) {
                    issues.push({ source, field, message: e instanceof Error ? e.message : String(e), severity: 'error' });
                }
            }
        });
    } else {
        const functions = config.functions || [];
        for (const info of math.functions()) {
            const f = functions[info.index];
            if (!f || (!String(f.expression ?? '').trim() && !(f.parametric && String(f.expressionY ?? '').trim()))) continue;
            if (info.error) issues.push({ source: info.name, field: 'expression', message: info.error, severity: 'error' });
            else if (info.domainError) issues.push({ source: info.name, field: 'domain', message: info.domainError, severity: 'error' });
        }
        const polar = config.coordinateSystem === 'polar';
        // About the plot the preview draws (760 px canvas less its paddings); the grid only sets the tracing resolution.
        const scene = computeScene2D({
            functions,
            tools: config.tools,
            math,
            view: { xmin: config.xmin, xmax: config.xmax, ymin: config.ymin, ymax: config.ymax },
            grid: marchingGrid(config.width * 0.85, config.height * 0.8, 1, 'full'),
            axisStyle: config.axisStyle,
            polar,
            labelMetrics: labelMetricsFor(config.paperWidthCm ?? 10, config.paperHeightCm ?? 10),
        });
        issues.push(...scene.issues);
    }
    labelIssues(config, math, issues);
    return issues.filter((i) => !i.hiddenSource).map((i) => `${issueText(i)}${i.severity === 'info' ? ' (info)' : ''}`);
}

// ------------------------------------------------------------ "type" rows

type FieldCheck = { kind: ValidateKind; fnKind?: FunctionKind; locals?: readonly string[] } | { number: true } | null;

/** Every template local a label of any tool may use: the chart checks above are the strict ones. */
const ANY_LOCALS = ['i', 'level', 'val', 'x', 'y', 'z'];

/**
 * The validator of the field a "type" row names, from the real UI labels
 * the guides use ('f1, y =', 'R1, condition 2', 'C1, Levels', 'Label 1,
 * Position x', 'Chart > Ranges, x from', 'Sliders, a: maximum', 'Start a
 * chart'). Null when the field cannot be told from the words.
 */
function fieldCheck(where: string, chart: ChartData | null): FieldCheck {
    const is3D = !!chart && chart.dimension === true;
    const polar = !!chart && chart.coordinateSystem === 'polar';
    const comma = where.indexOf(',');
    const source = (comma < 0 ? where : where.slice(0, comma)).trim().toLowerCase();
    const field = (comma < 0 ? '' : where.slice(comma + 1)).trim().toLowerCase();
    const startField: FieldCheck = is3D ? { kind: 'fn2' } : { kind: 'fn1', fnKind: polar ? 'polar' : 'cartesian' };

    if (comma < 0) return /start a chart|formula/.test(source) ? startField : null;
    if (/^sliders?\b/.test(source)) return /\b(min|max|minimum|maximum|step|value)\b/.test(field) ? { number: true } : null;
    if (/^chart\b/.test(source)) {
        if (/title/.test(field)) return { kind: 'template', locals: LABEL_LOCALS.plain };
        if (/\b(from|to|min|max)\b/.test(field)) return { kind: 'value' };
        return null;
    }
    if (/label/.test(field) || /^(text|legend)\b/.test(field)) return /position/.test(field) ? { kind: 'value' } : { kind: 'template', locals: ANY_LOCALS };
    if (/^position\b/.test(field)) return { kind: 'value' };
    if (/condition|^row \d/.test(field)) return { kind: 'condition' };
    if (/equation/.test(field)) return { kind: 'equation' };
    if (/levels?/.test(field)) return { kind: 'levels' };
    if (/objective/.test(field)) return { kind: 'fn2' };
    if (/^points?\b/.test(field)) return { kind: is3D ? 'tuples3' : 'tuples2' };
    if (/^path\b/.test(field)) return { kind: is3D ? 'path3' : 'path2' };
    if (/domain|range/.test(field)) return { kind: 'domain' };
    if (/^at x\b|tangent/.test(field)) return { kind: 'value' };
    if (/value/.test(field)) return { kind: 'value' };
    if (/^x\(t\)|^y\(t\)/.test(field)) return { kind: 'fn1', fnKind: 'parametric' };
    if (/^r\b|^r\(/.test(field)) return { kind: 'fn1', fnKind: 'polar' };
    if (/^z\b/.test(field)) return { kind: 'fn2' };
    if (/^y\b|^f\(|formula|expression/.test(field)) return startField;
    return null;
}

/** Why `text` is not accepted by the field in the context of `chart`, or null when it is. */
function typeProblem(check: NonNullable<FieldCheck>, text: string, chart: ChartData): string | null {
    if ('number' in check) return Number.isFinite(Number(text.trim().replace(',', '.'))) && text.trim() ? null : 'not a number';
    // Tangent points also take the live keywords min, max, min2, ...
    if (check.kind === 'value' && /^(min|max)\d*$/.test(text.trim())) return null;
    const { math } = chartOf(chart);
    const res = math.validate(text, check.kind, check.fnKind, check.locals);
    return res.ok ? null : res.message;
}

// -------------------------------------------------------------------- tests

test('guides: the documented ids exist, each in the file that owns it', () => {
    for (const [file, ids] of Object.entries(DOCUMENTED)) {
        const have = FILES[file].map((g) => g.id);
        for (const id of ids) assert.ok(have.includes(id), `src/guides/${file}.ts has no guide '${id}' (it has: ${have.join(', ') || 'none'})`);
    }
    assert.equal(GUIDES.length, Object.values(FILES).reduce((n, list) => n + list.length, 0));
});

test('guides: ids are unique kebab-case, GUIDES is in category order, guideById finds each', () => {
    const ids = GUIDES.map((g) => g.id);
    assert.equal(new Set(ids).size, ids.length, `duplicate ids in ${ids.join(', ')}`);
    for (const guide of GUIDES) {
        assert.match(guide.id, /^[a-z0-9]+(-[a-z0-9]+)*$/, guide.id);
        assert.equal(guideById(guide.id), guide);
        assert.equal(guideUrl(guide.id), `https://github.com/Saiki77/easy-tikz/blob/main/docs/guides/${guide.id}.md`);
    }
    assert.equal(guideById('no-such-guide'), undefined);
    const ranks = GUIDES.map((g) => GUIDE_CATEGORIES.indexOf(g.category));
    assert.ok(ranks.every((r) => r >= 0), 'every category is one of GUIDE_CATEGORIES');
    assert.deepEqual(ranks, ranks.slice().sort((a, b) => a - b), 'GUIDES is sorted by category');
    assert.equal(GUIDE_CATEGORIES.reduce((n, c) => n + guidesIn(c).length, 0), GUIDES.length);
});

test('guides: every field of the contract is filled in', () => {
    for (const guide of GUIDES) {
        const at = guide.id;
        assert.ok(guide.title.trim() && guide.title === guide.title.trim(), `${at}: title`);
        assert.ok(words(guide.title).length <= 10, `${at}: title has more than 10 words`);
        assert.ok(guide.summary.trim() && !guide.summary.includes('\n'), `${at}: summary is one line`);
        assert.ok(guide.summary.length <= 200, `${at}: summary is one sentence (${guide.summary.length} characters)`);
        assert.ok(guide.level in GUIDE_LEVEL_LABELS, `${at}: level '${guide.level}'`);
        assert.ok(Number.isFinite(guide.minutes) && guide.minutes >= 1 && guide.minutes <= 30, `${at}: minutes ${guide.minutes}`);
        assert.ok(Array.isArray(guide.outcomes) && guide.outcomes.length >= 2 && guide.outcomes.length <= 4, `${at}: 2 to 4 outcomes`);
        for (const outcome of guide.outcomes) assert.ok(outcome.trim() && !outcome.includes('\n'), `${at}: outcome '${outcome}'`);
        assert.ok(Array.isArray(guide.steps) && guide.steps.length >= 3 && guide.steps.length <= 8, `${at}: 3 to 8 steps, has ${guide.steps.length}`);
        assert.ok(guide.chart && typeof guide.chart === 'object', `${at}: finished chart`);
    }
});

test('guides: requires and next name existing guides, never the guide itself', () => {
    for (const guide of GUIDES) {
        for (const [key, list] of [['requires', guide.requires], ['next', guide.next]] as const) {
            if (list === undefined) continue;
            assert.ok(Array.isArray(list), `${guide.id}: ${key} is a list`);
            assert.equal(new Set(list).size, list.length, `${guide.id}: ${key} repeats an id`);
            for (const id of list) {
                assert.ok(guideById(id), `${guide.id}: ${key} names '${id}', which is not a guide`);
                assert.notEqual(id, guide.id, `${guide.id}: ${key} names itself`);
            }
        }
    }
});

test('guides: step titles have at most 8 words; bodies use only backticks and "- " lists', () => {
    for (const guide of GUIDES) {
        guide.steps.forEach((step, i) => {
            const at = `${guide.id} step ${i + 1}`;
            assert.ok(step.title.trim() && step.title === step.title.trim() && !step.title.includes('\n'), `${at}: title`);
            assert.ok(words(step.title).length <= 8, `${at}: title '${step.title}' has more than 8 words`);
            assert.ok(step.body.trim(), `${at}: body is empty`);
            for (const paragraph of step.body.split(/\n[ \t]*\n/)) {
                assert.equal((paragraph.match(/`/g) || []).length % 2, 0, `${at}: unbalanced backticks in '${paragraph.slice(0, 60)}'`);
            }
            for (const line of step.body.split('\n')) {
                assert.ok(!/^\s*#{1,6}\s/.test(line), `${at}: markdown heading '${line}'`);
                assert.ok(!/^\s*(\*|\+|\d+\.)\s/.test(line), `${at}: list line '${line}' must start with '- '`);
                assert.ok(!/\]\(/.test(line.replace(/`[^`]*`/g, '')), `${at}: markdown link in '${line}'`);
            }
            if (step.tip !== undefined) {
                assert.ok(step.tip.trim() && !step.tip.includes('\n'), `${at}: tip is one line`);
                assert.equal((step.tip.match(/`/g) || []).length % 2, 0, `${at}: unbalanced backticks in the tip`);
            }
            for (const row of step.type || []) {
                assert.ok(row.where.trim() && row.text.trim(), `${at}: a type row needs where and text`);
                assert.ok(!row.text.includes('\n'), `${at}: type text '${row.text}' is one line`);
            }
        });
    }
});

test('guides: no em dash anywhere', () => {
    for (const guide of GUIDES) {
        const at = JSON.stringify(guide).indexOf(EM_DASH);
        assert.equal(at, -1, `${guide.id}: em dash near '${JSON.stringify(guide).slice(Math.max(0, at - 40), at + 20)}'`);
    }
});

test('guides: charts are v4 data that migrateSettings keeps as written', () => {
    for (const guide of GUIDES) {
        for (const { where, chart } of chartsOf(guide)) {
            // Without v: 4 a block is read as 3.x: functions with an empty domain would be hidden.
            assert.ok(Number(chart.v) >= SCHEMA_VERSION, `${where}: chart needs v: ${SCHEMA_VERSION}`);
            const migrated = migrateSettings(clone(chart));
            for (const key of ['functions', 'functions3D', 'tools', 'annotations', 'parameters'] as const) {
                const before = (Array.isArray(chart[key]) ? chart[key] : []) as unknown[];
                const after = migrated[key] as unknown[];
                assert.equal(after.length, before.length, `${where}: ${key} lost or gained entries on load`);
            }
            const names = (list: unknown) => (list as Array<{ name?: string }>).map((item) => item.name);
            assert.deepEqual(names(migrated.functions), names(chart.functions ?? []), `${where}: function names changed on load`);
            assert.deepEqual(names(migrated.tools), names(chart.tools ?? []), `${where}: tool names changed on load`);
            const kinds = (list: unknown) => (list as Tool[]).map((t) => t.type);
            assert.deepEqual(kinds(migrated.tools), kinds(chart.tools ?? []), `${where}: tool types changed on load`);
            const tools = migrated.tools as Tool[];
            assert.equal(new Set(tools.map((t) => t.id)).size, tools.length, `${where}: tool ids repeat`);
            assert.equal(new Set(tools.map((t) => t.name)).size, tools.length, `${where}: tool names repeat`);
            assert.deepEqual(migrated.parameters, chart.parameters ?? [], `${where}: sliders changed on load`);
            for (const f of migrated.functions as FunctionParameters[]) assert.ok(f.hidden === undefined || typeof f.hidden === 'boolean', where);
            for (const p of migrated.parameters as Parameter[]) {
                assert.ok(p.min <= p.value && p.value <= p.max, `${where}: slider ${p.name} = ${p.value} is outside ${p.min}..${p.max}`);
            }
        }
    }
});

test('guides: every chart loads with zero issues', () => {
    let checked = 0;
    const problems: string[] = [];
    for (const guide of GUIDES) {
        for (const { where, chart } of chartsOf(guide)) {
            checked++;
            let issues: string[];
            try {
                issues = chartIssues(chart);
            } catch (e) {
                issues = [`could not be computed: ${e instanceof Error ? e.message : String(e)}`];
            }
            for (const issue of issues) problems.push(`${where}: ${issue}`);
        }
    }
    assert.deepEqual(problems, [], `charts with issues:\n${problems.join('\n')}`);
    assert.ok(checked >= GUIDES.length);
});

test('guides: the finished chart draws something, and a step chart comes before any "Open this step"', () => {
    for (const guide of GUIDES) {
        const { config } = chartOf(guide.chart);
        const drawn =
            (config.functions || []).some((f) => String(f.expression ?? '').trim()) ||
            (config.functions3D || []).some((s) => String(s.expression ?? '').trim()) ||
            (config.tools || []).length > 0 ||
            (config.annotations || []).some((a) => String(a.text ?? '').trim());
        assert.ok(drawn, `${guide.id}: the finished chart is empty`);
        assert.equal(config.is3D, guide.chart.dimension === true, guide.id);
        // stepChart: a step's own chart, else the nearest earlier one.
        let last: ChartData | null = null;
        guide.steps.forEach((step, i) => {
            if (step.chart) last = step.chart;
            assert.equal(stepChart(guide, i), last, `${guide.id} step ${i + 1}`);
        });
        assert.equal(stepChart(guide, -1), null);
    }
});

test('guides: every "type" row is text its field accepts', () => {
    let checked = 0;
    let skipped = 0;
    const problems: string[] = [];
    for (const guide of GUIDES) {
        guide.steps.forEach((step, i) => {
            if (!step.type || !step.type.length) return;
            // The chart after this step first; a row may also prepare a later step (a name whose slider comes next).
            const contexts: ChartData[] = [];
            const own = stepChart(guide, i);
            if (own) contexts.push(own);
            for (let k = i + 1; k < guide.steps.length; k++) {
                const later = guide.steps[k].chart;
                if (later) contexts.push(later);
            }
            contexts.push(guide.chart);
            for (const row of step.type) {
                const check = fieldCheck(row.where, contexts[0]);
                if (!check) {
                    skipped++;
                    continue;
                }
                checked++;
                let message: string | null = null;
                for (const chart of contexts) {
                    message = typeProblem(check, row.text, chart);
                    if (message === null) break;
                }
                if (message !== null) problems.push(`${guide.id} step ${i + 1}, '${row.where}': '${row.text}' is not accepted: ${message}`);
            }
        });
    }
    assert.deepEqual(problems, [], problems.join('\n'));
    // Most rows name a field the check knows; a wording nobody maps would silently skip everything.
    if (checked + skipped > 0) assert.ok(checked >= skipped, `only ${checked} of ${checked + skipped} type rows could be checked`);
});

test('fieldCheck: the field names the guides use map to their validators', () => {
    const kind = (where: string, chart: ChartData | null = null) => {
        const c = fieldCheck(where, chart);
        return !c ? null : 'number' in c ? 'number' : c.kind === 'fn1' ? `fn1:${c.fnKind}` : c.kind;
    };
    assert.equal(kind('Start a chart'), 'fn1:cartesian');
    assert.equal(kind('Start a chart', { dimension: true }), 'fn2');
    assert.equal(kind('Start a chart', { coordinateSystem: 'polar' }), 'fn1:polar');
    assert.equal(kind('f1, y ='), 'fn1:cartesian');
    assert.equal(kind('f1, x(t) ='), 'fn1:parametric');
    assert.equal(kind('f1, y(t) ='), 'fn1:parametric');
    assert.equal(kind('f1, r ='), 'fn1:polar');
    assert.equal(kind('f1, Domain'), 'domain');
    assert.equal(kind('f1, t range'), 'domain');
    assert.equal(kind('f1, At x'), 'value');
    assert.equal(kind('R1, condition 2'), 'condition');
    assert.equal(kind('R1, Label'), 'template');
    assert.equal(kind('R1, Label box of row 3'), 'template');
    assert.equal(kind('C1, Equation'), 'equation');
    assert.equal(kind('C1, Levels'), 'levels');
    assert.equal(kind('P1, Objective'), 'fn2');
    assert.equal(kind('P1, Points'), 'tuples2');
    assert.equal(kind('P1, Points', { dimension: true }), 'tuples3');
    assert.equal(kind('P1, Label text'), 'template');
    assert.equal(kind('S1, Path'), 'path2');
    assert.equal(kind('PL1, Plane value'), 'value');
    assert.equal(kind('Label 1, Text'), 'template');
    assert.equal(kind('Label 1, Position x'), 'value');
    assert.equal(kind('Chart > Ranges, x from'), 'value');
    assert.equal(kind('Chart > Axes, Title'), 'template');
    assert.equal(kind('Sliders, a: maximum'), 'number');
    assert.equal(kind('Sliders, k: Step'), 'number');
    assert.equal(kind('Somewhere else'), null);
});

test('chartIssues: reports what the editor would, and nothing for a clean chart', () => {
    const base = { v: 4, xmin: '0', xmax: '5', ymin: '0', ymax: '5' };
    assert.deepEqual(chartIssues({ ...base, functions: [{ name: 'f1', expression: 'x^2' }] }), []);
    const unknown = chartIssues({ ...base, functions: [{ name: 'f1', expression: 'k x^2' }] });
    assert.equal(unknown.length, 1);
    assert.match(unknown[0], /^f1: .*k/);
    assert.equal(chartIssues({ ...base, xmax: 'b' }).length, 1, 'a range with an unknown name');
    const label = chartIssues({ ...base, annotations: [{ x: '1', y: 'q', text: 'value {nope}', color: 'black', size: 'normal', anchor: 'center' }] });
    assert.equal(label.length, 2, label.join(' | '));
    const empty = chartIssues({
        ...base,
        tools: [{ type: 'region', id: 't0', name: 'R1', color: 'blue', conditions: ['x >= 4', 'x <= 1'], conditionLabels: ['', ''], fill: true, fillOpacity: 0.25, fillPattern: 'solid', outline: 'none', thickness: 'thin', constraintLines: false, label: '' }],
    });
    assert.ok(empty.some((line) => line.endsWith('(info)')), `an empty region is an info note: ${empty.join(' | ')}`);
    assert.equal(chartIssues({ ...base, dimension: true, zmin: '0', zmax: '4', functions3D: [{ name: 'f1', expression: 'x^2 + q', xDomain: '', yDomain: '', color: 'blue', wireframe: false, opacity: 0.8, samples: 20 }] }).length, 1);
});

test('guides: every chart exports a complete picture with finite numbers', () => {
    const problems: string[] = [];
    let checked = 0;
    for (const guide of GUIDES) {
        for (const { where, chart } of chartsOf(guide)) {
            const { settings, math } = chartOf(chart);
            let code = '';
            try {
                code = settings.generateTikzCode(math);
            } catch (e) {
                problems.push(`${where}: the export threw ${e instanceof Error ? e.message : String(e)}`);
                continue;
            }
            checked++;
            if (!code.includes('\\begin{tikzpicture}') || !code.includes('\\end{tikzpicture}')) problems.push(`${where}: no complete tikzpicture`);
            const bad = /\b(NaN|Infinity|undefined)\b/.exec(code);
            if (bad) problems.push(`${where}: the code contains ${bad[0]} near '${code.slice(Math.max(0, bad.index - 40), bad.index + 20)}'`);
        }
    }
    assert.deepEqual(problems, [], problems.join('\n'));
    assert.ok(checked >= GUIDES.length);
});

// ------------------------------------------- what the dynamic guides promise

/** The chart of step `n` (1-based) of a guide, with slider values replaced by `values`. */
function stepOf(id: string, n: number, values: Record<string, number> = {}): ChartData {
    const guide = guideById(id);
    if (!guide) throw new Error(`no guide '${id}'`);
    const chart = clone(n === 0 ? guide.chart : stepChart(guide, n - 1));
    if (!chart) throw new Error(`${id} has no chart at step ${n}`);
    for (const p of (chart.parameters ?? []) as Parameter[]) if (p.name in values) p.value = values[p.name];
    return chart;
}

/** What a 2D chart shows once its scene has published its values: the title, every text and marker, the derived names. */
function shown(chart: ChartData): { title: string; texts: string[]; markers: Array<[number, number]>; derived: Record<string, number> } {
    const { math, config } = chartOf(chart);
    const scene = computeScene2D({
        functions: config.functions || [],
        tools: config.tools,
        math,
        view: { xmin: config.xmin, xmax: config.xmax, ymin: config.ymin, ymax: config.ymax },
        grid: marchingGrid(config.width * 0.85, config.height * 0.8, 1, 'full'),
        axisStyle: config.axisStyle,
        polar: false,
        labelMetrics: labelMetricsFor(config.paperWidthCm ?? 10, config.paperHeightCm ?? 10),
    });
    return {
        title: math.formatTemplate(String(config.title ?? '')),
        texts: scene.items.flatMap((item) => item.texts.map((t) => t.text)),
        markers: scene.items.flatMap((item) => item.markers.map((m): [number, number] => [m.x, m.y])),
        derived: scene.derived,
    };
}

function hasMarker(markers: Array<[number, number]>, x: number, y: number, what: string): void {
    assert.ok(markers.some(([mx, my]) => Math.abs(mx - x) < 1e-6 && Math.abs(my - y) < 1e-6), `${what}: no marker at (${x}, ${y}) in ${JSON.stringify(markers)}`);
}

test('animate-play: the points sit on the circle and the curve, and the title prints the angle', () => {
    for (const a of [0.01, 1, 2, 3.14, 4, 6.28]) {
        const s = shown(stepOf('animate-play', 5, { a }));
        hasMarker(s.markers, Math.cos(a) - 1.5, Math.sin(a), `a = ${a}, point on the circle`);
        hasMarker(s.markers, a, Math.sin(a), `a = ${a}, end of the curve`);
        // On the unit circle around (-1.5, 0).
        const r = Math.hypot(s.derived.P_x + 1.5, s.derived.P_y);
        assert.ok(Math.abs(r - 1) < 1e-9, `a = ${a}: radius ${r}`);
    }
    assert.equal(shown(stepOf('animate-play', 5)).title, '$a = 4$, $\\sin(a) = -0.76$');
    // The arc on the circle and the sine both end at a: the circle unrolls as the slider moves.
    const functions = stepOf('animate-play', 0).functions as FunctionParameters[];
    assert.deepEqual(functions.map((f) => [f.name, f.parametric === true, f.domain]), [['c', true, '0:a'], ['f', false, '0:a']]);
    // The slider is one turn from its first step on and stays above 0, where the domain 0:a would be empty.
    for (const step of [2, 5]) {
        const a = (stepOf('animate-play', step).parameters as Parameter[])[0];
        assert.deepEqual([a.name, a.min, a.max, a.step], ['a', 0.01, 6.28, 0.01], `step ${step}`);
        assert.ok(a.min > 0 && Math.abs(a.max - 2 * Math.PI) < 0.01);
    }
});

test('secant-tangent: the titles print the slopes the steps name, and the gap is h/10', () => {
    const titles: Array<[number, Record<string, number>, string]> = [
        [4, {}, 'secant slope 0.9, tangent slope 0.6'],
        [5, {}, 'secant slope 0.7, tangent slope 0.6'],
        [5, { h: 0.5 }, 'secant slope 0.65, tangent slope 0.6'],
        [5, { h: 0.01 }, 'secant slope 0.601, tangent slope 0.6'],
        [5, { a: 5 }, 'secant slope 1.1, tangent slope 1'],
    ];
    for (const [step, values, title] of titles) assert.equal(shown(stepOf('secant-tangent', step, values)).title, title, `step ${step}, ${JSON.stringify(values)}`);
    const two = shown(stepOf('secant-tangent', 2));
    hasMarker(two.markers, 3, 0.9, 'A');
    hasMarker(two.markers, 6, 3.6, 'B');
    assert.deepEqual(two.texts, ['A', 'B']);
    // Secant slope (2a + h)/10 for every a and h; the secant g passes through A and B.
    for (const a of [0, 1.5, 3, 6]) {
        for (const h of [0.01, 0.5, 1, 3]) {
            const { math } = chartOf(stepOf('secant-tangent', 0, { a, h }));
            const slope = math.value('(f(a + h) - f(a))/h');
            assert.ok(Math.abs(slope - (2 * a + h) / 10) < 1e-9, `a = ${a}, h = ${h}: slope ${slope}`);
            const g = math.functionInfo('g');
            if (!g) throw new Error('no g');
            assert.ok(Math.abs(g.fn(a) - (a * a) / 10) < 1e-9 && Math.abs(g.fn(a + h) - ((a + h) * (a + h)) / 10) < 1e-9, `a = ${a}, h = ${h}: the secant misses A or B`);
        }
    }
    // At h = 0 the quotient is 0/0: the title prints a question mark, as the tip says.
    assert.match(shown(stepOf('secant-tangent', 0, { a: 5, h: 0 })).title, /^secant slope \?, tangent slope 1$/);
});

test('area-accumulation: the region and the point print the same area, and it tends to 4', () => {
    const at3 = shown(stepOf('area-accumulation', 4));
    assert.ok(at3.texts.includes('A = 3.11') && at3.texts.includes('F(b) = 3.11'), at3.texts.join(' | '));
    const at6 = shown(stepOf('area-accumulation', 0, { b: 6 }));
    assert.ok(at6.texts.includes('A = 3.8') && at6.texts.includes('F(b) = 3.8'), at6.texts.join(' | '));
    for (const b of [0.1, 1, 3, 6, 10]) {
        const s = shown(stepOf('area-accumulation', 0, { b }));
        const area = 4 - 4 * Math.exp(-b / 2);
        hasMarker(s.markers, b, area, `b = ${b}`);
        // A numeric integral of f from 0 to b agrees with the area function F the guide plots.
        const { math } = chartOf(stepOf('area-accumulation', 0, { b }));
        const f = math.functionInfo('f');
        if (!f) throw new Error('no f');
        const n = 2000;
        let sum = 0;
        for (let i = 0; i < n; i++) sum += f.fn(((i + 0.5) * b) / n);
        assert.ok(Math.abs((sum * b) / n - area) < 1e-5, `b = ${b}: integral ${(sum * b) / n}, F(b) = ${area}`);
        assert.ok(Math.abs(math.value('F(b) - F(0)') - area) < 1e-9, `b = ${b}: F(b) - F(0)`);
        assert.ok(area < 4);
    }
});

test('computed-values: count, midpoint and area follow c, and a missing crossing prints a question mark', () => {
    // Step 1: the crossings P at c = 0, with their coordinates.
    assert.deepEqual(shown(stepOf('computed-values', 1)).texts, ['(2, 1)', '(8, 4)']);
    // Step 2 and its tip: the title counts them; the touching line at c = -2.25 gives 1, a line below gives 0.
    assert.equal(shown(stepOf('computed-values', 2)).title, 'crossing points: 2');
    assert.equal(shown(stepOf('computed-values', 2, { c: -2.25 })).title, 'crossing points: 1');
    assert.equal(shown(stepOf('computed-values', 2, { c: -3 })).title, 'crossing points: 0');
    // Step 3: M halfway between (2, 1) and (8, 4).
    hasMarker(shown(stepOf('computed-values', 3)).markers, 5, 2.5, 'M');
    // Step 4: the area its body names, (8 - 2)^3/24.
    assert.ok(shown(stepOf('computed-values', 4)).texts.includes('A = 9'));
    // Step 5, the finished chart: the title adds the midpoint; another c, another area.
    const five = shown(stepOf('computed-values', 5));
    assert.equal(five.title, 'crossing points: 2, midpoint x = 5');
    assert.ok(five.texts.includes('A = 9'), five.texts.join(' | '));
    assert.deepEqual(stepOf('computed-values', 0), stepOf('computed-values', 5));
    const lower = shown(stepOf('computed-values', 0, { c: -0.5 })).texts;
    assert.ok(lower.includes('A = 6.17'), lower.join(' | '));
    // Over the whole play range where the line cuts the parabola, M stays above x = 5 and the label's area is the integral.
    for (let k = -20; k <= 5; k++) {
        const c = k / 10;
        const chart = stepOf('computed-values', 0, { c });
        const s = shown(chart);
        assert.equal(s.derived.P_n, 2, `c = ${c}`);
        assert.ok(Math.abs(s.derived.M_x - 5) < 1e-6, `c = ${c}: midpoint x ${s.derived.M_x}`);
        const d = 2 * Math.sqrt(9 + 4 * c);
        const [x1, x2] = [s.derived.P_x, s.derived.P_x2];
        assert.ok(Math.abs(x2 - x1 - d) < 1e-6, `c = ${c}: chord ${x2 - x1}, expected ${d}`);
        const { math } = chartOf(chart);
        const f = math.functionInfo('f');
        const g = math.functionInfo('g');
        if (!f || !g) throw new Error('no f or g');
        const n = 2000;
        let sum = 0;
        for (let i = 0; i < n; i++) {
            const x = x1 + ((i + 0.5) * (x2 - x1)) / n;
            sum += g.fn(x) - f.fn(x);
        }
        const area = (sum * (x2 - x1)) / n;
        assert.ok(Math.abs(area - (x2 - x1) ** 3 / 24) < 1e-5, `c = ${c}: integral ${area}, label ${(x2 - x1) ** 3 / 24}`);
    }
    // The tip of step 5: from the touching line at c = -2.25 down, the midpoint prints `?`.
    for (const c of [-2.25, -2.3, -2.8, -3]) {
        assert.match(shown(stepOf('computed-values', 0, { c })).title, /^crossing points: [01], midpoint x = \?$/, `c = ${c}`);
    }
    // A miss at c = -2.5: nothing that needs the crossings is drawn.
    const miss = shown(stepOf('computed-values', 0, { c: -2.5 }));
    assert.equal(miss.title, 'crossing points: 0, midpoint x = ?');
    assert.deepEqual(miss.markers, []);
    assert.deepEqual(miss.texts, []);
    // Every chip the status line shows then is an info note: nothing is an error.
    const notes = chartIssues(stepOf('computed-values', 0, { c: -2.5 }));
    assert.ok(notes.length > 0 && notes.every((line) => line.endsWith('(info)')), notes.join(' | '));
    // The slider of every step plays over the range the steps describe, from c = 0.
    for (let n = 1; n <= 5; n++) {
        const c = (stepOf('computed-values', n).parameters as Parameter[])[0];
        assert.deepEqual([c.name, c.min, c.max, c.value], ['c', -3, 0.5, 0], `step ${n}`);
    }
});

test('search: every word must occur, titles first, spelling variants fold', () => {
    assert.deepEqual(searchTokens('  Linear   PROGRAM '), ['linear', 'program']);
    assert.equal(searchText('Optimization Colour'), 'optimisation color');
    assert.equal(searchScore(['a'], [['b', 5]]), 0);
    assert.equal(searchScore(['region', 'slider'], [['Regions', 10], ['a slider', 2]]), 12);
    assert.equal(searchScore([], [['anything', 5]]), 0);
    // A word start counts in full, a match inside a word less, and a short query must start a word.
    assert.equal(searchMatch('linear program', 'pro'), 1);
    assert.equal(searchMatch('the value p1_val', 'val'), 1);
    assert.equal(searchMatch('linear program', 'gram'), 0.3);
    assert.equal(searchMatch('relaxation', 'ax'), 0);
    assert.equal(searchMatch('write ax as a x', 'ax'), 1);
    assert.equal(searchScore(['gram'], [['Program', 10]]), 3);
    assert.equal(searchScore(['ax'], [['Relaxation', 10], ['ax is one name', 5]]), 5);

    const guide = (id: string, title: string, summary: string, steps: Array<[string, string]>): Guide => ({
        id,
        title,
        summary,
        category: 'Getting started',
        level: 'start',
        minutes: 1,
        outcomes: ['one', 'two'],
        chart: { v: 4 },
        steps: steps.map(([stepTitle, body]) => ({ title: stepTitle, body })),
    });
    const list = [
        guide('a', 'Sliders', 'Numbers you can drag.', [['Add one', 'Click Add slider.'], ['Play it', 'Press play.']]),
        guide('b', 'Regions', 'Shade inequalities.', [['Add a region', 'Use a slider in a condition.'], ['Label it', 'Type a label.']]),
        guide('c', 'Optimisation', 'Find the optimum.', [['Start', 'Open the example.'], ['Sweep', 'Drag the objective slider.']]),
    ];
    assert.deepEqual(searchGuides('', list), []);
    assert.deepEqual(searchGuides('nothing-like-this', list), []);
    const sliders = searchGuides('slider', list);
    assert.deepEqual(sliders.map((h) => h.guide.id), ['a', 'b', 'c'], 'title match first, then display order');
    assert.equal(sliders[0].step, null, 'found in the title: no step to point at');
    assert.equal(sliders[1].step, 0);
    assert.equal(sliders[2].step, 1);
    assert.deepEqual(searchGuides('optimization', list).map((h) => h.guide.id), ['c']);
    assert.deepEqual(searchGuides('regions label', list).map((h) => [h.guide.id, h.step]), [['b', 1]], 'the step with the word the title lacks');

    // The trap "ax" finds the guide that explains it, not "relaxation".
    assert.equal(searchGuides('ax')[0].guide.id, 'formulas');
    assert.ok(!searchGuides('ax').some((h) => h.guide.id === 'integer-program' && h.score >= 5), 'relaxation is no match for ax');

    // With the real guides: each one is found by its own title, first.
    for (const g of GUIDES) {
        const hits = searchGuides(g.title);
        assert.ok(hits.length > 0 && hits[0].score >= hits[hits.length - 1].score, g.id);
        assert.ok(hits.some((h) => h.guide === g), `${g.id}: not found by its own title`);
    }
});

test('guides: one step per screen (5.1): 3 to 6 steps, each with its own chart, short texts', () => {
    const count = (text: string | undefined) => words(text ?? '').length;
    const long: string[] = [];
    for (const guide of GUIDES) {
        if (guide.steps.length < 3 || guide.steps.length > 6) long.push(`${guide.id}: ${guide.steps.length} steps`);
        guide.steps.forEach((step, i) => {
            if (!step.chart) long.push(`${guide.id} step ${i + 1}: no chart of its own`);
            if (count(step.body) > 40) long.push(`${guide.id} step ${i + 1}: body of ${count(step.body)} words`);
            if (count(step.tip) > 25) long.push(`${guide.id} step ${i + 1}: tip of ${count(step.tip)} words`);
        });
        const total = guide.steps.reduce((n, s) => n + count(s.title) + count(s.body) + count(s.tip), 0);
        if (total > 230) long.push(`${guide.id}: ${total} words`);
    }
    assert.deepEqual(long, []);
});

// ------------------------------------------------ 6.0 F2: the examples of version 6

test('6.0 examples: ids unique among all examples and guides, texts filled in, every chart loads with zero issues and exports', () => {
    const ids = [...EXAMPLES.map((e) => e.id), ...V6_EXAMPLES.map((e) => e.id), ...showcaseExamples().map((e) => e.id), ...GUIDES.map((g) => g.id)];
    assert.equal(new Set(ids).size, ids.length, `an id repeats in ${ids.join(', ')}`);
    assert.ok(V6_EXAMPLES.length >= 10, `${V6_EXAMPLES.length} examples`);
    const problems: string[] = [];
    for (const ex of V6_EXAMPLES) {
        assert.match(ex.id, /^[a-z0-9]+(-[a-z0-9]+)*$/, ex.id);
        assert.ok(ex.title.trim() && words(ex.title).length <= 8, `${ex.id}: title '${ex.title}'`);
        assert.ok(ex.description.trim() && !ex.description.includes('\n') && ex.description.length <= 160, `${ex.id}: description`);
        assert.equal(JSON.stringify(ex).indexOf(EM_DASH), -1, `${ex.id}: em dash`);
        assert.equal(ex.is3D, ex.data.dimension === true, `${ex.id}: is3D`);
        assert.ok(Number(ex.data.v) >= SCHEMA_VERSION, `${ex.id}: chart needs v: ${SCHEMA_VERSION}`);
        let issues: string[];
        try {
            issues = chartIssues(ex.data);
        } catch (e) {
            issues = [`could not be computed: ${e instanceof Error ? e.message : String(e)}`];
        }
        for (const issue of issues) problems.push(`${ex.id}: ${issue}`);
        const { settings, math } = chartOf(ex.data);
        const code = settings.generateTikzCode(math);
        if (!code.includes('\\begin{tikzpicture}') || !code.includes('\\end{tikzpicture}')) problems.push(`${ex.id}: no complete tikzpicture`);
        const bad = /\b(NaN|Infinity|undefined)\b/.exec(code);
        if (bad) problems.push(`${ex.id}: the code contains ${bad[0]}`);
    }
    assert.deepEqual(problems, [], problems.join('\n'));
});

test('6.0 examples: with the Showcase charts, one for every main new line of version 6', () => {
    const kinds = new Set<string>();
    for (const data of [...V6_EXAMPLES.map((e) => e.data), ...guidesIn('Showcase').map((g) => g.chart)]) {
        for (const tool of (data.tools ?? []) as Tool[]) kinds.add(tool.type);
    }
    const lines = ['value', 'vector', 'listPoints', 'axisSet', 'chord', 'vectorField', 'restPoints', 'trajectory'];
    lines.push('planeGrid', 'basisVectors', 'transform', 'eigenvectors', 'unitSquare', 'orbit', 'cobweb', 'bifurcation', 'newton', 'colourPlane', 'fourierCircles');
    for (const kind of lines) assert.ok(kinds.has(kind), `no example draws a ${kind}`);
});

test('6.0 guides: the numbers the steps name are the ones the charts compute', () => {
    // matrix-plane: the area 1 before the move, det A = 2.5 after it, eigenvalues 2.5 and 1.
    assert.ok(shown(stepOf('matrix-plane', 2)).texts.includes('area $= 1$'), shown(stepOf('matrix-plane', 2)).texts.join(' | '));
    const moved = shown(stepOf('matrix-plane', 4)).texts;
    for (const text of ['$\\det A = 2.5$', '$\\lambda_1 = 2.5$', '$\\lambda_2 = 1$']) assert.ok(moved.includes(text), `${text} in ${moved.join(' | ')}`);
    // sets-convexity: [-2, 2]; the chord above the convex g, below the cubic at 0.7.
    assert.ok(shown(stepOf('sets-convexity', 1)).texts.some((t) => t.endsWith('= [-2, 2]$')));
    assert.ok(shown(stepOf('sets-convexity', 3)).derived.CH1_val > 0);
    const cubic = shown(stepOf('sets-convexity', 4));
    assert.ok(cubic.derived.CH1_val < 0 && cubic.title === 'gap -2.34', cubic.title);
    // ask-curve: g and h cross at (-3, 5) and (2, 0), the bounds of the shaded area.
    assert.deepEqual(shown(stepOf('ask-curve', 3)).texts.filter((t) => t.startsWith('(')), ['(-3, 5)', '(2, 0)']);
    // descent-newton: the orbit ends at the minimum for eta = 0.2 and runs away past 0.25; Newton reaches the root of 2.
    assert.ok(Math.hypot(shown(stepOf('descent-newton', 3)).derived.OR1_x, shown(stepOf('descent-newton', 3)).derived.OR1_y) < 0.05);
    assert.ok(Math.abs(shown(stepOf('descent-newton', 4)).derived.OR1_y) > 10);
    assert.ok(Math.abs(shown(stepOf('descent-newton', 5)).derived.NM1_x - Math.SQRT2) < 1e-6);
    // vector-fields: two stable spirals and a saddle.
    assert.deepEqual(shown(stepOf('vector-fields', 3)).texts.slice().sort(), ['saddle', 'stable spiral', 'stable spiral']);
    // matrix-grid: det A = 2 - k, below 0 at the last step.
    assert.ok(shown(stepOf('matrix-grid', 4)).texts.includes('$\\det A = -1$'), shown(stepOf('matrix-grid', 4)).texts.join(' | '));
});

// ------------------------------------------------ 6.0 showcase: the pages of the plan page's prototypes

/** The Showcase pages of version 6, in the order the Showcase shows them. */
const V6_SHOWCASE = [
    'lorenz-butterfly', 'complex-two-ways', 'fourier-circles', 'two-valleys', 'mandelbrot-orbit', 'pendulum-field',
    'julia-newton', 'matrix-grid', 'logistic-map', 'domain-colouring', 'unity-roots',
];

test('6.0 showcase: the pages of version 6 come first in the Showcase, and early in the gallery', () => {
    assert.deepEqual(guidesIn('Showcase').slice(0, V6_SHOWCASE.length).map((g) => g.id), V6_SHOWCASE);
    // The gallery of the Help (src/ui/helpPanel.ts): every category but Getting started and Reference, in
    // GUIDE_CATEGORIES order, the tour left out. Its "All" view then shows a page of version 6 in the first row.
    const gallery = GUIDE_CATEGORIES.filter((c) => c !== 'Getting started' && c !== 'Reference')
        .flatMap((c) => guidesIn(c))
        .filter((g) => g.id !== 'chart-language');
    const first = gallery.slice(0, 4).map((g) => g.id);
    assert.ok(first.includes(V6_SHOWCASE[0]) && first.includes(V6_SHOWCASE[1]), first.join(', '));
});

test('6.0 showcase: the moving parts move (traced, turning, steps)', () => {
    const tools = (chart: ChartData) => (chart.tools ?? []) as Array<Tool & { traced?: boolean }>;
    const lorenz = guideById('lorenz-butterfly');
    assert.ok(lorenz);
    for (const { where, chart } of chartsOf(lorenz)) {
        assert.equal(chart.turning, true, `${where}: turning`);
        for (const t of tools(chart).filter((t) => t.type === 'trajectory')) assert.equal(t.traced, true, `${where}: traced`);
    }
    for (const id of ['two-valleys', 'unity-roots']) {
        const g = guideById(id);
        assert.ok(g);
        assert.ok(tools(g.chart).some((t) => t.type === 'orbit' && t.traced === true), `${id}: a traced orbit`);
    }
    // Complex functions: each grid step moves in a `then` step, each colour step colours by f(z).
    const complex = guideById('complex-two-ways');
    assert.ok(complex);
    complex.steps.forEach((step, i) => {
        const kinds = tools(step.chart as ChartData).map((t) => t.type);
        assert.ok(i % 2 === 0 ? kinds.includes('transform') && Number((tools(step.chart as ChartData).find((t) => t.type === 'transform') as { step?: number }).step) === 1 : kinds.includes('colourPlane'), `complex-two-ways step ${i + 1}: ${kinds.join(', ')}`);
    });
    // Fourier circles: a square wave, then a sawtooth.
    const fourier = guideById('fourier-circles');
    assert.ok(fourier);
    const sums = fourier.steps.map((s) => String((tools(s.chart as ChartData)[0] as unknown as { sum?: string }).sum ?? ''));
    assert.ok(sums.slice(0, 3).every((sum) => sum.includes('2k - 1')) && /\(-1\)\^\{k\+1\}/.test(sums[3]), sums.join(' | '));
});

test('6.0 showcase: the numbers the new pages name are the ones the charts compute', () => {
    // two-valleys: the bowl settles at 0 for eta = 0.2 and runs away at 0.27; the ridge at x = 0.15 splits the valleys.
    const end = (chart: ChartData) => shown(chart).derived;
    assert.ok(Math.hypot(end(stepOf('two-valleys', 2)).OR1_x, end(stepOf('two-valleys', 2)).OR1_y) < 0.05);
    assert.ok(Math.abs(end(stepOf('two-valleys', 3)).OR1_y) > 10);
    assert.ok(end(stepOf('two-valleys', 4)).OR1_x > 1, 'right of the ridge: the shallow valley on the right');
    assert.ok(end(stepOf('two-valleys', 5)).OR1_x < -1, 'left of the ridge: the deep valley on the left');
    // Near the ridge the path leaves it slowly, but on its own side: right of 0.15 to the right, left of it to the left.
    assert.ok(end(stepOf('two-valleys', 5, { a: 0.16 })).OR1_x > 0.3 && end(stepOf('two-valleys', 5, { a: 0.14 })).OR1_x < 0, 'the ridge at 0.15');
    // julia-newton: the titles print the c the steps name, inside the Mandelbrot set at step 1, outside at step 3; P reaches the root 1.
    const escapes = (re: number, im: number): boolean => {
        let x = 0;
        let y = 0;
        for (let k = 0; k < 1000; k++) {
            [x, y] = [x * x - y * y + re, 2 * x * y + im];
            if (x * x + y * y > 4) return true;
        }
        return false;
    };
    assert.equal(shown(stepOf('julia-newton', 1)).title, 'c = -0.12 + 0.75i');
    assert.equal(escapes(-0.12, 0.75), false);
    assert.equal(shown(stepOf('julia-newton', 2)).title, 'c = -0.8 + 0.156i');
    assert.equal(shown(stepOf('julia-newton', 3)).title, 'c = 0.45 + 0.45i');
    assert.equal(escapes(0.45, 0.45), true);
    const newton = end(stepOf('julia-newton', 5));
    assert.ok(Math.hypot(newton.OR1_x - 1, newton.OR1_y) < 1e-6, `P ends at (${newton.OR1_x}, ${newton.OR1_y})`);
    // logistic-map: at r = 3.2 the cobweb swaps between (r + 1 ± √((r - 3)(r + 1))) / 2r.
    const r = 3.2;
    const two = [1, -1].map((s) => (r + 1 + s * Math.sqrt((r - 3) * (r + 1))) / (2 * r));
    const web = end(stepOf('logistic-map', 3)).CW1_x;
    assert.ok(two.some((v) => Math.abs(v - web) < 1e-6), `${web} is not one of ${two.join(', ')}`);
    // unity-roots: n steps of z -> ωz from 1 come back to 1.
    for (const n of [2, 5, 7, 10]) {
        const back = end(stepOf('unity-roots', 3, { n }));
        assert.equal(back.OR1_n, n + 1, `n = ${n}`);
        assert.ok(Math.hypot(back.OR1_x - 1, back.OR1_y) < 1e-9, `n = ${n}: ends at (${back.OR1_x}, ${back.OR1_y})`);
    }
});
