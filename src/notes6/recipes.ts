/*
 * The + Add recipes of 6.0 B (Build tab, section Calculus): a set on the
 * x-axis where a function is at most 0, and the chord of a function with a
 * slider λ (Jensen's inequality). src/migrate.ts lists them with its own
 * and hands over the helpers they need, so this file never imports it.
 * Pure: no DOM, no Obsidian.
 */
import type { AxisSetTool, ChordTool, FunctionParameters, Parameter, Tool } from '../types';
import type { Recipe, RecipeContext } from '../migrate';
import { t } from '../i18n';

/** What migrate.ts lends the recipes. */
export interface RecipeKit {
    newTool(type: 'axisSet' | 'chord', ctx: RecipeContext): Tool;
    /** A new function (its name free, its colour the next one), for a chart that has none to point at. */
    newFunction(ctx: RecipeContext, expression: string): FunctionParameters;
    /** Names usable as f(x): named, not parametric, with an expression. */
    callable(ctx: RecipeContext): string[];
    /** Every name in the chart. */
    names(ctx: RecipeContext): string[];
}

/** A function of the chart that draws (not hidden), else a new one. */
function someFunction(ctx: RecipeContext, kit: RecipeKit, expression: string): { name: string; fn: FunctionParameters | null } {
    const own = kit.callable(ctx).find((name) => !ctx.functions.find((f) => f.name === name)?.hidden);
    if (own) return { name: own, fn: null };
    const fn = kit.newFunction(ctx, expression);
    return { name: fn.name || 'f', fn };
}

export function notes6Recipes(in2D: (ctx: RecipeContext) => boolean, kit: RecipeKit): Recipe[] {
    return [
        {
            id: 'axis-set',
            section: 'Calculus',
            label: t('notes6.recipe.axisSet'),
            hint: t('notes6.recipeHint.axisSet'),
            available: in2D,
            build: (ctx) => {
                const { name, fn } = someFunction(ctx, kit, 'x^2 - 4');
                const c: RecipeContext = fn ? { ...ctx, functions: [...ctx.functions, fn] } : ctx;
                const tool = { ...(kit.newTool('axisSet', c) as AxisSetTool), condition: `${name}(x) <= 0`, valueLabel: true };
                if (!fn) return { kind: 'tool', tool };
                return { kind: 'items', functions: [fn], tools: [tool] };
            },
        },
        {
            id: 'chord',
            section: 'Calculus',
            label: t('notes6.recipe.chord'),
            hint: t('notes6.recipeHint.chord'),
            available: in2D,
            build: (ctx) => {
                const { name, fn } = someFunction(ctx, kit, 'x^2 / 2 - 1');
                const c: RecipeContext = fn ? { ...ctx, functions: [...ctx.functions, fn] } : ctx;
                // λ on a slider, called lambda when that name is free.
                const lambda: Parameter | null = kit.names(c).includes('lambda') ? null : { name: 'lambda', value: 0.3, min: 0, max: 1, step: 0.01 };
                const tool = { ...(kit.newTool('chord', c) as ChordTool), function: name, from: '-1', to: '2', at: lambda ? 'lambda' : '0.5', valueLabel: true };
                return { kind: 'items', parameters: lambda ? [lambda] : [], functions: fn ? [fn] : [], tools: [tool] };
            },
        },
    ];
}
