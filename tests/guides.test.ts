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
} from '../src/guides';
import { BASICS_GUIDES } from '../src/guides/basics';
import { OPTIMISATION_GUIDES } from '../src/guides/optimisation';
import { MORE_GUIDES } from '../src/guides/more';
import { issueText } from '../src/issues';
import { FunctionKind, LABEL_LOCALS, MathContext, ValidateKind } from '../src/mathcontext';
import { SCHEMA_VERSION, migrateSettings } from '../src/migrate';
import { SceneIssue, computeScene2D, computeScene3D, labelMetricsFor } from '../src/scene';
import { SettingsManager } from '../src/settings';
import { Annotation, FunctionParameters, Parameter, RendererConfig, Tool } from '../src/types';
import { marchingGrid } from '../src/util';

/** The guides SPEC4 section 3 lists, per data file. README, docs/guides and the release posts link to them by id. */
const DOCUMENTED: Record<string, string[]> = {
    basics: ['first-chart', 'formulas', 'sliders', 'drag-to-edit', 'tangents-extrema', 'parametric-polar'],
    optimisation: ['regions', 'areas-between', 'tangent-area', 'linear-program', 'integer-program', 'level-curves', 'supply-demand'],
    more: ['points-labels', 'arrows-braces', 'surfaces-3d', 'charts-in-notes', 'export-latex', 'from-3x', 'shortcuts'],
};
const FILES: Record<string, Guide[]> = { basics: BASICS_GUIDES, optimisation: OPTIMISATION_GUIDES, more: MORE_GUIDES };

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
    assert.equal(GUIDES.length, BASICS_GUIDES.length + OPTIMISATION_GUIDES.length + MORE_GUIDES.length);
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
