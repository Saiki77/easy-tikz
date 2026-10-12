import { Annotation, AxisStyle, BoxAspect, CoordinateSystem, Function3DParameters, FunctionParameters, Parameter, RendererConfig, Tool } from './types';
import { MathContext, MathContextInput } from './mathcontext';
import { View } from './geometry';
import { SCHEMA_VERSION, migrateSettings } from './migrate';
import { generateTikz2D, generateTikz3D } from './export';

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
        showLargeGrid: false,
        showSmallGrid: false,
        // Minor tick subdivisions (export: minor tick num).
        gridSize: 5,
        // Major grid density (live preview only; pgfplots picks its own ticks).
        majorTickNum: 8,
        // Axis ranges are expressions (sliders allowed), resolved by resolveView.
        ...RANGE_DEFAULTS,
        axis_style: 'box',
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
        const migrated = migrateSettings(data && typeof data === 'object' ? data : {});
        for (const [key, value] of Object.entries(migrated)) {
            if (value !== undefined) mgr.setValue(key, value);
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
        };
    }

    /**
     * CONTRACT (v4): evaluate xmin..zmax with `ctx.value`, falling back to
     * RANGE_DEFAULTS (the 3.x literals -0.5, 10, -0.5, 5, -5, 5) per bound when
     * a bound is empty / invalid / non-finite, and to the default PAIR when
     * min >= max.
     * Every fallback is reported in `errors` ('xmax: Unknown name b').
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
                errors.push(`${key}: not a finite number`);
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
                errors.push(`${maxKey}: must be greater than ${minKey}`);
                resolved.push(minDefault, maxDefault);
            }
        }
        const [xmin, xmax, ymin, ymax, zmin, zmax] = resolved;
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
    toRendererConfig(ctx?: MathContext): RendererConfig {
        const math = ctx || this.createMathContext();
        const { view } = this.resolveView(math);
        const { width, height } = this.previewCanvas();
        const paper = this.paperSize();
        const coordinateSystem: CoordinateSystem = this.getValue('coordinateSystem') === 'polar' ? 'polar' : 'cartesian';
        const isPolar = coordinateSystem === 'polar';
        const xLabel = isPolar
            ? stringValue(this.getValue('axis_label_x_polar'), '')
            : stringValue(this.getValue('axis_label_x'), '') || 'x';
        const yLabel = isPolar
            ? stringValue(this.getValue('axis_label_y_polar'), '')
            : stringValue(this.getValue('axis_label_y'), '') || 'y';
        const axisStyle = this.getValue<AxisStyle | undefined>('axis_style');
        return {
            width,
            height,
            coordinateSystem,
            xmin: view.xmin,
            xmax: view.xmax,
            ymin: view.ymin,
            ymax: view.ymax,
            title: stringValue(this.getValue('title'), ''),
            xLabel,
            yLabel,
            showAxisLabels: this.getValue('show_axis_label') !== false,
            axisStyle: axisStyle === 'middle' || axisStyle === 'axes' ? axisStyle : 'box',
            gridMajor: this.getValue('showLargeGrid') === true,
            gridMinor: this.getValue('showSmallGrid') === true,
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
            boxAspect: this.getValue<BoxAspect | undefined>('boxAspect') === 'equal' ? 'equal' : 'true',
            functions3D: arrayValue<Function3DParameters>(this.getValue('functions3D')),
            // The paper size lets the preview typeset its text at the PDF's scale.
            paperWidthCm: paper.w,
            paperHeightCm: paper.h,
        };
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
