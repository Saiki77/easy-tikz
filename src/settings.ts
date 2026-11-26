import { Annotation, AxisStyle, CoordinateSystem, Function3DParameters, FunctionParameters, Parameter, RendererConfig, Tool } from './types';
import { MathContext, MathContextInput } from './mathcontext';
import { View } from './geometry';
import { SCHEMA_VERSION, migrateSettings } from './migrate';
import { generateTikz2D, generateTikz3D } from './export';
import { t } from './i18n';
import { GRID_OPACITY, opacityValue } from './opacity';
import { AxisNumbers, TickAxis, numbersKeys, numbersMode } from './ticks';
import { NoteTable, tableData } from './beyond/table';
// 6.0 A
import { valueDefinitions } from './values/defs';
import { boxAspectOf, boxRatioOf } from './box3d';
import { exportsFrames, framesTikz } from './motion6/frames'; // 6.0 C
// 6.0 B
import { FIT_Y, followY } from './notes6/yfit';
import { pythonAxes, pythonView } from './python/scene'; // 6.0 P
// 6.1 clean look
import { AUTO, ChartLook, lookOf, resolveLook, settleLook } from './look';

/** The six axis range keys. */
export type RangeKey = 'xmin' | 'xmax' | 'ymin' | 'ymax' | 'zmin' | 'zmax';

/**
 * Default axis ranges (the 3.x literals), as the expression strings a chart
 * stores. The one source for new charts, the resolveView fallback, Reset
 * and the range placeholders.
 */
export const RANGE_DEFAULTS: Readonly<Record<RangeKey, string>> = { xmin: '-0.5', xmax: '10', ymin: '-0.5', ymax: '5', zmin: '-5', zmax: '5' };

/** The (min, max) pairs resolveView checks. */
const RANGE_PAIRS: Array<[RangeKey, RangeKey]> = [
    ['xmin', 'xmax'],
    ['ymin', 'ymax'],
    ['zmin', 'zmax'],
];

/** Paper size limits in cm (the export clamps size_x_cm / size_y_cm to these). */
const MIN_PAPER_CM = 1;
const MAX_PAPER_CM = 100;
/** Live preview canvas: the long side is previewSize within these bounds. */
const MIN_PREVIEW_PX = 320;
const MAX_PREVIEW_PX = 1600;
/**
 * Shortest preview side in px. Above the renderer's thumbnail limit
 * (COMPACT_MAX_HEIGHT 120, which drops ticks, labels and legend) and leaves
 * at least 50 px of plot inside its 90 px of padding.
 */
const MIN_PREVIEW_SIDE_PX = 140;

/**
 * Every key a chart stores, with its default: the state of a new chart, and
 * the value of keys missing from older blocks. Arrays are fresh per call.
 */
function defaultValues(): Record<string, unknown> {
    return {
        v: SCHEMA_VERSION,
        dimension: false,
        // Standalone document (true) or just the tikzpicture with a `% Needs:` preamble note.
        documentSetup: true,
        title: '',
        size_x_cm: 10,
        size_y_cm: 10,
        show_axis_label: true,
        axis_label_x: 'x',
        axis_label_y: 'y',
        showAxis: true,
        // 6.1: the major grid on or off, or left open ('auto'): the chart look decides (src/look.ts).
        showLargeGrid: AUTO,
        showSmallGrid: false,
        // Opacity of the major grid lines (minor lines at half), see src/opacity.ts.
        gridOpacity: GRID_OPACITY,
        // The numbers on each axis (src/ticks.ts); a step and values stay when the mode changes.
        numbers_x: 'auto',
        numbers_step_x: '',
        numbers_at_x: '',
        numbers_y: 'auto',
        numbers_step_y: '',
        numbers_at_y: '',
        numbers_z: 'auto',
        numbers_step_z: '',
        numbers_at_z: '',
        // Minor tick subdivisions (export: minor tick num).
        gridSize: 5,
        // Major grid density (live preview only; pgfplots picks its own ticks).
        majorTickNum: 8,
        // Axis ranges are expressions (sliders allowed), resolved by resolveView.
        ...RANGE_DEFAULTS,
        // 6.0 B: y follows what is drawn (a chart whose text gives x and no y), see src/notes6/yfit.ts.
        [FIT_Y]: false,
        // 6.1: 'box', 'middle', 'axes', or left open ('auto'): the chart look decides (src/look.ts).
        axis_style: AUTO,
        // 6.1: the chart's own look ('clean' or 'classic'), else the setting Chart look. Its presence also
        // tells a JSON block of 6.1 from an older complete dump (settleLook).
        look: AUTO,
        // Polar treats function expressions as r(theta).
        coordinateSystem: 'cartesian',
        // Separate axis labels for polar mode so toggling Cartesian <-> Polar
        // doesn't trample the user's cartesian labels.
        axis_label_x_polar: '',
        axis_label_y_polar: '',
        axis_label_z: 'z',
        rotationX: 30,
        rotationZ: 45,
        zoom3D: 1,
        // 3D box aspect: 'true' (data-proportional) or 'equal' (cube).
        boxAspect: 'true',
        // Live preview size in pixels: the long side of the canvas, whose
        // aspect is size_x_cm : size_y_cm (see toRendererConfig).
        previewSize: 760,
        functions: [],
        functions3D: [],
        // Tools (v4 shapes, see types.ts) and free text labels.
        tools: [],
        annotations: [],
        parameters: [],
        variables: 'x, y',
        equalScale: false,
        showSlidersInNote: true,
    };
}

function arrayValue<T>(v: unknown): T[] {
    return Array.isArray(v) ? (v as T[]) : [];
}

function stringValue(v: unknown, fallback: string): string {
    return typeof v === 'string' ? v : fallback;
}

function numberValue(v: unknown, fallback: number): number {
    const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() ? Number(v) : NaN;
    return Number.isFinite(n) ? n : fallback;
}

/**
 * Holds the live setting values for the modal and generates TikZ/pgfplots
 * code from them (src/export.ts). Wraps a `Map<string, unknown>` so both 2D
 * and 3D modes can share storage without a sprawling typed schema. Values
 * are always v4 data: `fromJSON` migrates every block on the way in.
 */
export class SettingsManager {
    private values: Map<string, unknown>;
    /**
     * Optional (5.0): the Markdown table above the chart's block in its note
     * (src/beyond/table.ts), handed to the MathContext for data tools. Never
     * serialized: the block keeps `use the table above`, not the rows.
     * undefined: the chart is not in a note.
     */
    noteTable: NoteTable | null | undefined = undefined;

    constructor() {
        this.values = new Map(Object.entries(defaultValues()));
    }

    /**
     * Look up the value for a setting id. Returns `undefined` if absent.
     * The stored values are plain JSON types; the generic is a caller-side
     * convenience (`getValue<number | undefined>('previewSize')`) - the
     * single cast here is the one place the map's `unknown` is narrowed.
     */
    getValue<T = unknown>(id: string): T {
        return this.values.get(id) as T;
    }

    /** Store a value for a setting id. Callers are responsible for type safety. */
    setValue(id: string, value: unknown) {
        // 6.0 B: a y range written (Chart tab, pan, zoom, fit) ends "y follows what is drawn".
        if ((id === 'ymin' || id === 'ymax') && this.values.get(FIT_Y) === true && this.values.get(id) !== value) this.values.set(FIT_Y, false);
        this.values.set(id, value);
    }

    /**
     * Round-trip all settings as a plain JSON-safe object. Used to persist
     * a chart inside an `easy-tikz` code block and to feed
     * `SettingsManager.fromJSON` when the user clicks a rendered chart to
     * edit it. Always written as the current schema version; the 3.x
     * `documentClose` flag is gone (documentSetup alone decides).
     */
    serialize(): Record<string, unknown> {
        const out: Record<string, unknown> = Object.fromEntries(this.values.entries());
        delete out.documentClose;
        out.v = SCHEMA_VERSION;
        return out;
    }

    /**
     * Rebuild a SettingsManager from a serialized block of any version:
     * `migrateSettings` brings it to v4 (functions named, legacy tools
     * converted, parameters and annotations checked), and keys it does not
     * have keep the constructor's defaults.
     */
    static fromJSON(data: Record<string, unknown>): SettingsManager {
        const mgr = new SettingsManager();
        // 6.1: an older complete dump reads its stored defaults as left open (src/look.ts).
        const migrated = migrateSettings(data && typeof data === 'object' ? settleLook(data) : {});
        for (const [key, value] of Object.entries(migrated)) {
            // 6.0 B: stored as they are (setValue would let a stored y range end fitY, whatever the order of the keys).
            if (value !== undefined) mgr.values.set(key, value);
        }
        return mgr;
    }

    /**
     * CONTRACT (v4): MathContext for this chart (parameters, functions,
     * polar flag, axis variables, tool names). Memoized by MathContext.create.
     * Optional v4 addition: `opts.memo === false` builds a fresh context
     * outside the memo (used while a drag rewrites function texts).
     */
    createMathContext(opts?: { memo?: boolean }): MathContext {
        return MathContext.create(this.mathContextInput(), opts);
    }

    /**
     * Optional v4 addition: the input createMathContext uses, for private
     * contexts (`new MathContext(settings.mathContextInput())`).
     */
    mathContextInput(): MathContextInput {
        return {
            parameters: this.parameters(),
            functions: arrayValue<FunctionParameters>(this.getValue('functions')),
            polar: this.getValue('coordinateSystem') === 'polar',
            variables: stringValue(this.getValue('variables'), 'x, y'),
            toolNames: this.tools()
                .map((t) => t && t.name)
                .filter((n): n is string => typeof n === 'string' && n.length > 0),
            table: this.noteTable,
            // 6.0 A: let definitions (src/values/).
            values: valueDefinitions(this.tools()),
        };
    }

    /**
     * Optional (5.0): the headers of the columns a data tool reads from the
     * note's table, as the axis names of a chart that has none of its own
     * (its labels are the defaults x and y). The first data tool with source
     * 'table' decides.
     */
    tableAxisNames(): { x: string; y: string } {
        const table = this.noteTable;
        if (!table || this.getValue('dimension') === true) return { x: '', y: '' };
        const tool = this.tools().find((t) => !!t && t.type === 'data' && t.source === 'table' && !t.hidden);
        if (!tool || tool.type !== 'data') return { x: '', y: '' };
        const d = tableData(table, tool.xColumn, tool.yColumn);
        return d.ok ? { x: d.xName, y: d.yName } : { x: '', y: '' };
    }

    /**
     * CONTRACT (v4): evaluate xmin..zmax with `ctx.value`, falling back to
     * RANGE_DEFAULTS (the 3.x literals -0.5, 10, -0.5, 5, -5, 5) per bound when
     * a bound is empty / invalid / non-finite, and to the default PAIR when
     * min >= max.
     * Every fallback is reported in `errors` ('xmax: Unknown name b'): the
     * key and ': ' stay as they are (the problem line and the range fields
     * read them), the text after them is in the reader's language.
     */
    resolveView(ctx: MathContext): { view: View & { zmin: number; zmax: number }; errors: string[] } {
        const errors: string[] = [];
        const bound = (key: string, fallback: number): number => {
            const raw = this.getValue(key);
            const res = ctx.tryValue(typeof raw === 'number' || typeof raw === 'string' ? raw : '');
            if (!res.ok) {
                errors.push(`${key}: ${res.message}`);
                return fallback;
            }
            // '1e999' is a numeric literal that tryValue passes through as Infinity.
            if (!Number.isFinite(res.value)) {
                errors.push(`${key}: ${t('plugin.range.notFinite')}`);
                return fallback;
            }
            return res.value;
        };
        const resolved: number[] = [];
        for (const [minKey, maxKey] of RANGE_PAIRS) {
            const minDefault = Number(RANGE_DEFAULTS[minKey]);
            const maxDefault = Number(RANGE_DEFAULTS[maxKey]);
            const lo = bound(minKey, minDefault);
            const hi = bound(maxKey, maxDefault);
            if (lo < hi) {
                resolved.push(lo, hi);
            } else {
                errors.push(`${maxKey}: ${t('plugin.range.notAboveMin', { min: minKey })}`);
                resolved.push(minDefault, maxDefault);
            }
        }
        const [xmin, xmax, ymin, ymax, zmin, zmax] = resolved;
        // 6.0 P: a chart with python blocks and the default range: the scripts' xlim and ylim, else what they draw.
        if (this.getValue('dimension') !== true && (['xmin', 'xmax', 'ymin', 'ymax'] as const).every((k) => String(this.getValue(k)) === RANGE_DEFAULTS[k]) && this.tools().some((t) => !!t && t.type === 'python')) {
            const box = pythonView(this.tools(), ctx);
            if (box) return { view: { ...box, zmin, zmax }, errors };
        }
        // 6.0 B: y follows what is drawn over the x range.
        if (this.getValue(FIT_Y) === true && this.getValue('dimension') !== true) {
            const y = followY(
                this,
                {
                    functions: arrayValue<FunctionParameters>(this.getValue('functions')),
                    tools: this.tools(),
                    annotations: arrayValue<Annotation>(this.getValue('annotations')),
                    axisStyle: this.resolvedLook().axisStyle, // 6.1
                    polar: this.getValue('coordinateSystem') === 'polar',
                },
                ctx,
                { xmin, xmax, ymin, ymax }
            );
            if (y) return { view: { xmin, xmax, ymin: y[0], ymax: y[1], zmin, zmax }, errors };
        }
        return { view: { xmin, xmax, ymin, ymax, zmin, zmax }, errors };
    }

    /** CONTRACT (v4): true when the export is a full standalone document (documentSetup !== false). */
    isStandalone(): boolean {
        return this.getValue('documentSetup') !== false;
    }

    /**
     * CONTRACT (v4): `ctx` defaults to createMathContext(). pgfplots code for
     * the chart; a 3D chart gets generate3DTikzCode's output.
     */
    generateTikzCode(ctx?: MathContext): string {
        const math = ctx || this.createMathContext();
        // 6.0 C: `frames` exports every step side by side (src/motion6/frames.ts), each step with the sliders as they are.
        const data = this.serialize();
        if (exportsFrames(data)) {
            return framesTikz(data, (step) => {
                const settings = SettingsManager.fromJSON(step);
                settings.noteTable = this.noteTable;
                const own = settings.createMathContext({ memo: false });
                // The sliders where they are now in `math`.
                const env = math.envFor('value');
                const values: Record<string, number> = {};
                for (const p of this.parameters()) {
                    const slot = env.scalar(p.name);
                    if (slot && slot.kind === 'param') values[p.name] = slot.read();
                }
                own.setParamValues(values);
                return settings.generateTikzCode(own);
            });
        }
        return this.getValue('dimension') === true ? generateTikz3D(this, math) : generateTikz2D(this, math);
    }

    /** Paper size of the exported picture in cm (size_x_cm / size_y_cm, clamped to 1..100). */
    paperSize(): { w: number; h: number } {
        const cm = (key: string) => Math.max(MIN_PAPER_CM, Math.min(MAX_PAPER_CM, numberValue(this.getValue(key), 10)));
        return { w: cm('size_x_cm'), h: cm('size_y_cm') };
    }

    /**
     * Preview canvas in px: the paper's true aspect (the export writes the
     * same width / height in cm), previewSize on the long side, and no side
     * below MIN_PREVIEW_SIDE_PX so very wide or tall charts keep their ticks
     * and labels.
     */
    previewCanvas(): { width: number; height: number } {
        const size = numberValue(this.getValue('previewSize'), 760) || 760;
        const long = Math.max(MIN_PREVIEW_PX, Math.min(MAX_PREVIEW_PX, Math.round(size)));
        const { w, h } = this.paperSize();
        const width = w >= h ? long : Math.round((long * w) / h);
        const height = w >= h ? Math.round((long * h) / w) : long;
        return { width: Math.max(MIN_PREVIEW_SIDE_PX, width), height: Math.max(MIN_PREVIEW_SIDE_PX, height) };
    }

    /** CONTRACT (v4): `ctx` defaults to createMathContext(); view via resolveView. */
    /** The numbers of one axis as the chart stores them (src/ticks.ts). */
    axisNumbers(axis: TickAxis): AxisNumbers {
        const keys = numbersKeys(axis);
        return {
            mode: numbersMode(this.getValue(keys.mode)),
            step: stringValue(this.getValue(keys.step), ''),
            at: stringValue(this.getValue(keys.at), ''),
        };
    }

    toRendererConfig(ctx?: MathContext): RendererConfig {
        const math = ctx || this.createMathContext();
        const { view } = this.resolveView(math);
        const { width, height } = this.previewCanvas();
        const paper = this.paperSize();
        const coordinateSystem: CoordinateSystem = this.getValue('coordinateSystem') === 'polar' ? 'polar' : 'cartesian';
        const isPolar = coordinateSystem === 'polar';
        let xLabel = isPolar
            ? stringValue(this.getValue('axis_label_x_polar'), '')
            : stringValue(this.getValue('axis_label_x'), '') || 'x';
        let yLabel = isPolar
            ? stringValue(this.getValue('axis_label_y_polar'), '')
            : stringValue(this.getValue('axis_label_y'), '') || 'y';
        // Data from the note's table: its headers name axes the chart leaves at x and y.
        if (!isPolar && this.noteTable) {
            const names = this.tableAxisNames();
            if (xLabel === 'x' && names.x) xLabel = names.x;
            if (yLabel === 'y' && names.y) yLabel = names.y;
        }
        // 6.0 P: a script's plt.title, xlabel and ylabel name what the chart leaves empty (or at x and y).
        let title = stringValue(this.getValue('title'), '');
        if (!isPolar && this.getValue('dimension') !== true && this.tools().some((t) => !!t && t.type === 'python')) {
            const axes = pythonAxes(this.tools(), math, this.getValue('stillTime')); // 6.0 ML: or what frame(t) sets
            if (axes && !title && axes.title) title = axes.title;
            if (axes && xLabel === 'x' && axes.xlabel) xLabel = axes.xlabel;
            if (axes && yLabel === 'y' && axes.ylabel) yLabel = axes.ylabel;
        }
        // 6.1: the clean look writes no axis letters x and y, only names the chart gives its axes.
        const look = this.resolvedLook();
        if (look.look === 'clean') {
            if (xLabel.trim() === 'x') xLabel = '';
            if (yLabel.trim() === 'y') yLabel = '';
        }
        return {
            width,
            height,
            coordinateSystem,
            xmin: view.xmin,
            xmax: view.xmax,
            ymin: view.ymin,
            ymax: view.ymax,
            title, // 6.0 P: or the script's
            xLabel,
            yLabel,
            showAxisLabels: this.getValue('show_axis_label') !== false,
            axisStyle: look.axisStyle, // 6.1: or the look's, when the chart leaves it open
            gridMajor: look.gridMajor,
            look: look.look, // 6.1
            gridMinor: this.getValue('showSmallGrid') === true,
            gridOpacity: opacityValue(this.getValue('gridOpacity'), GRID_OPACITY),
            numbers: { x: this.axisNumbers('x'), y: this.axisNumbers('y'), z: this.axisNumbers('z') },
            minorTickNum: numberValue(this.getValue('gridSize'), 5),
            majorTickNum: numberValue(this.getValue('majorTickNum'), 8),
            functions: arrayValue<FunctionParameters>(this.getValue('functions')),
            annotations: arrayValue<Annotation>(this.getValue('annotations')),
            tools: this.tools(),
            parameters: this.parameters(),
            variables: stringValue(this.getValue('variables'), 'x, y') || 'x, y',
            equalScale: this.getValue('equalScale') === true,
            is3D: this.getValue('dimension') === true,
            zmin: view.zmin,
            zmax: view.zmax,
            zLabel: stringValue(this.getValue('axis_label_z'), '') || 'z',
            rotationX: numberValue(this.getValue('rotationX'), 30),
            rotationZ: numberValue(this.getValue('rotationZ'), 45),
            zoom3D: numberValue(this.getValue('zoom3D'), 1),
            boxAspect: boxAspectOf(this.getValue('boxAspect')),
            boxRatio: boxRatioOf(this.getValue('boxRatio')) ?? undefined,
            functions3D: arrayValue<Function3DParameters>(this.getValue('functions3D')),
            // The paper size lets the preview typeset its text at the PDF's scale.
            paperWidthCm: paper.w,
            paperHeightCm: paper.h,
        };
    }

    /**
     * 6.1: the look this chart is drawn in (its own `look`, else the setting
     * Chart look), with the axis style and major grid it gets: what the
     * chart sets, else the look's (src/look.ts).
     */
    resolvedLook(): { look: ChartLook; axisStyle: AxisStyle; gridMajor: boolean } {
        return resolveLook(lookOf(this.getValue('look')), {
            axisStyle: this.getValue('axis_style'),
            grid: this.getValue('showLargeGrid'),
            polar: this.getValue('coordinateSystem') === 'polar',
            is3D: this.getValue('dimension') === true,
        });
    }

    /** CONTRACT (v4): `ctx` defaults to createMathContext(). */
    generate3DTikzCode(ctx?: MathContext): string {
        return generateTikz3D(this, ctx || this.createMathContext());
    }

    /** Tools of the chart (already migrated to v4 shapes by fromJSON). */
    private tools(): Tool[] {
        return arrayValue<Tool>(this.getValue('tools')).filter((t): t is Tool => !!t && typeof t === 'object');
    }

    private parameters(): Parameter[] {
        return arrayValue<Parameter>(this.getValue('parameters')).filter((p): p is Parameter => !!p && typeof p === 'object');
    }
}
