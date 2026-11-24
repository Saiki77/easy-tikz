/*
 * The + Add recipes of 6.0 E (Build tab, sections Colour the plane and
 * Iterate): the Mandelbrot set, a Julia set with sliders, Newton basins,
 * domain colouring, a heat map, the orbit of a point, gradient descent, a
 * cobweb, a bifurcation diagram, Newton's method and Fourier circles.
 * src/migrate.ts lists them with its own and lends the helpers they need,
 * so this file never imports it. Pure: no DOM, no Obsidian.
 */
import type { FunctionParameters, Parameter, PointsTool, Tool, ValueTool } from '../types';
import type { Recipe, RecipeContext, RecipeResult } from '../migrate';
import { t } from '../i18n';
import type { MessageKey } from '../i18n';

/** What migrate.ts lends the recipes. */
export interface IterateKit {
    /** A new tool of a type with its defaults, its id and a free name. */
    tool(type: string, ctx: RecipeContext): Tool;
    /** A new function (its name free, its colour the next one), for a chart that has none to point at. */
    newFunction(ctx: RecipeContext, expression: string): FunctionParameters;
    /** Names usable as f(x): named, not parametric, with an expression. */
    callable(ctx: RecipeContext): string[];
    /** Every name in the chart. */
    names(ctx: RecipeContext): string[];
}

/** The chart with the new tools and functions so far (each new one takes a name of its own). */
function withItems(ctx: RecipeContext, tools: Tool[], functions: FunctionParameters[] = []): RecipeContext {
    return { ...ctx, tools: [...ctx.tools, ...tools], functions: [...ctx.functions, ...functions] };
}

/** A slider, unless the chart has a name like it already (then that one is used). */
function slider(kit: IterateKit, ctx: RecipeContext, p: Parameter): Parameter[] {
    return kit.names(ctx).includes(p.name) ? [] : [p];
}

/** A point to drag, called P when that name is free. */
function dragPoint(kit: IterateKit, ctx: RecipeContext, at: string): PointsTool {
    const point = kit.tool('points', ctx) as PointsTool;
    point.dim = 2;
    point.source = 'list';
    point.points = at;
    point.size = 'large';
    if (!kit.names(ctx).includes('P')) point.name = 'P';
    return point;
}

/** A tool of this part with fields set. */
function made(kit: IterateKit, ctx: RecipeContext, type: string, fields: Record<string, unknown>): Tool {
    return { ...kit.tool(type, ctx), ...fields } as Tool;
}

export function iterateRecipes(in2D: (ctx: RecipeContext) => boolean, kit: IterateKit): Recipe[] {
    const recipe = (id: string, section: string, key: string, build: (ctx: RecipeContext) => RecipeResult): Recipe => ({
        id,
        section,
        label: t(`iterate.recipe.${key}` as MessageKey),
        hint: t(`iterate.recipeHint.${key}` as MessageKey),
        available: in2D,
        build,
    });
    const plane = (ctx: RecipeContext, fields: Record<string, unknown>, parameters: Parameter[] = []): RecipeResult => ({
        kind: 'items',
        parameters,
        tools: [made(kit, ctx, 'colourPlane', fields)],
    });
    return [
        // ---- Colour the plane
        recipe('mandelbrot', 'Colour the plane', 'mandelbrot', (ctx) => plane(ctx, { formula: 'z_{n+1} = z_n^2 + c', start: '0', given: 'c = x + i y', steps: '200' })),
        recipe('julia', 'Colour the plane', 'julia', (ctx) => {
            const params = [...slider(kit, ctx, { name: 'a', value: -0.8, min: -1, max: 1, step: 0.01 }), ...slider(kit, ctx, { name: 'b', value: 0.156, min: -1, max: 1, step: 0.001 })];
            return plane(ctx, { formula: 'z_{n+1} = z_n^2 + c', start: 'x + i y', given: 'c = a + b i', steps: '300' }, params);
        }),
        recipe('newton-basins', 'Colour the plane', 'newtonBasins', (ctx) => plane(ctx, { formula: 'z_{n+1} = z_n - \\frac{z_n^3 - 1}{3z_n^2}', start: 'x + i y', steps: '40' })),
        recipe('domain-colouring', 'Colour the plane', 'domain', (ctx) => plane(ctx, { formula: 'f(z) = \\frac{z^2 - 1}{z^2 + 1}' })),
        recipe('heat-map', 'Colour the plane', 'heat', (ctx) => plane(ctx, { formula: 'f(x, y) = \\sin x \\cos y', colormap: 'viridis' })),
        // ---- Iterate
        recipe('orbit', 'Iterate', 'orbit', (ctx) => {
            const point = dragPoint(kit, ctx, '(-0.12, 0.75)');
            const orbit = made(kit, withItems(ctx, [point]), 'orbit', { recurrence: 'z_{n+1} = z_n^2 + c', start: '0', given: `c = ${point.name}`, steps: '40' });
            return { kind: 'items', tools: [point, orbit], reveal: 1 };
        }),
        recipe('gradient-descent', 'Iterate', 'gradientDescent', (ctx) => {
            const eta = slider(kit, ctx, { name: 'eta', value: 0.1, min: 0, max: 0.5, step: 0.01 });
            const names = kit.names(ctx);
            const fName = ['f', 'g', 'h', 'L'].find((n) => !names.includes(n)) ?? 'f';
            const def = { ...kit.tool('value', ctx), name: fName, params: 'x, y', expression: 'x^2 + 4y^2' } as ValueTool;
            const point = dragPoint(kit, withItems(ctx, [def]), '(2.5, 1.5)');
            const c = withItems(ctx, [def, point]);
            const heat = made(kit, c, 'colourPlane', { formula: `${fName}(x, y)`, colormap: 'viridis', opacity: 0.5 });
            const orbit = made(kit, withItems(c, [heat]), 'orbit', { recurrence: `p_{n+1} = p_n - \\eta \\nabla ${fName}(p_n)`, start: point.name, steps: '25' });
            return { kind: 'items', parameters: eta, tools: [def, heat, point, orbit], reveal: 3 };
        }),
        recipe('cobweb', 'Iterate', 'cobweb', (ctx) => {
            const r = slider(kit, ctx, { name: 'r', value: 3.7, min: 2.5, max: 4, step: 0.01 });
            return { kind: 'items', parameters: r, tools: [made(kit, ctx, 'cobweb', { recurrence: 'x_{n+1} = r x_n (1 - x_n)', start: '0.2', steps: '80' })] };
        }),
        recipe('bifurcation', 'Iterate', 'bifurcation', (ctx) => ({
            kind: 'tool',
            tool: made(kit, ctx, 'bifurcation', { recurrence: 'x_{n+1} = r x_n (1 - x_n)', parameter: 'r', from: '2.5', to: '4' }),
        })),
        recipe('newton-method', 'Iterate', 'newton', (ctx) => {
            const own = kit.callable(ctx).find((name) => !ctx.functions.find((f) => f.name === name)?.hidden);
            const fn = own ? null : kit.newFunction(ctx, 'x^2 - 2');
            const name = own ?? fn?.name ?? 'f';
            const tool = made(kit, withItems(ctx, [], fn ? [fn] : []), 'newton', { function: name, start: '2.5', steps: '5', valueLabel: true });
            return fn ? { kind: 'items', functions: [fn], tools: [tool] } : { kind: 'tool', tool };
        }),
        recipe('fourier-circles', 'Iterate', 'fourier', (ctx) => {
            const n = slider(kit, ctx, { name: 'n', value: 5, min: 1, max: 20, step: 1 });
            return { kind: 'items', parameters: n, tools: [made(kit, ctx, 'fourierCircles', { sum: '\\sum_{k=1}^{n} \\frac{4}{\\pi (2k - 1)} e^{i(2k - 1)t}', wave: true })] };
        }),
    ];
}
