/*
 * The + Add recipes of 6.0 D (Build tab, section Linear algebra): a grid
 * with the basis vectors that a matrix moves in the next step, the
 * eigenvectors of a matrix, the grid and the basis vectors alone, and a
 * complex map z ↦ z² that bends a small grid; in 3D, space moved by a
 * matrix. src/migrate.ts lists them with its own and hands over the
 * helpers they need, so this file never imports it. Pure: no DOM, no Obsidian.
 */
import type { BasisVectorsTool, EigenvectorsTool, PlaneGridTool, Tool, TransformTool, UnitSquareTool, ValueTool } from '../types';
import type { Recipe, RecipeContext } from '../migrate';
import { basisVectorsDefaults, eigenvectorsDefaults, planeGridDefaults, transformDefaults, unitSquareDefaults } from './tools';
import { stepOf } from '../motion6/steps';
import { t } from '../i18n';

/** What migrate.ts lends the recipes. */
export interface LinearKit {
    /** A new tool's id and name (the name free in the chart). */
    identity(type: Tool['type'], ctx: RecipeContext): { id: string; name: string };
    /** Every name in the chart. */
    names(ctx: RecipeContext): string[];
}

const withTools = (ctx: RecipeContext, tools: Tool[]): RecipeContext => ({ ...ctx, tools: [...ctx.tools, ...tools] });

/** The step after every object of the chart (a transform in it plays when the chart is shown). */
function nextStep(ctx: RecipeContext): number {
    let last = 0;
    for (const o of [...ctx.functions, ...ctx.tools]) last = Math.max(last, stepOf(o));
    return last + 1;
}

/** A matrix of the chart (a let value written as a matrix), else null. */
function someMatrix(ctx: RecipeContext): string | null {
    const def = ctx.tools.find((x): x is ValueTool => x.type === 'value' && !x.params.trim() && /pmatrix|bmatrix|^\s*\[\s*\[/.test(x.expression));
    return def ? def.name : null;
}

/** A let matrix A (or the next free name) for a chart that has none. */
function newMatrix(ctx: RecipeContext, kit: LinearKit, dim: 2 | 3): ValueTool {
    const taken = new Set(kit.names(ctx));
    const name = ['A', 'B', 'M'].find((n) => !taken.has(n)) ?? kit.identity('value', ctx).name;
    const expression = dim === 3 ? '\\begin{pmatrix} 1 & 0.5 & 0 \\\\ 0 & 1 & 0 \\\\ 0 & 0.5 & 1.5 \\end{pmatrix}' : '\\begin{pmatrix} 1.5 & 1 \\\\ 0.5 & 2 \\end{pmatrix}';
    return { type: 'value', color: 'black', params: '', expression, ...kit.identity('value', ctx), name };
}

export function linearRecipes(available: (ctx: RecipeContext) => boolean, kit: LinearKit, is3D: boolean): Recipe[] {
    const grid = (ctx: RecipeContext, fields: Partial<PlaneGridTool> = {}): PlaneGridTool => ({ ...planeGridDefaults(), ...kit.identity('planeGrid', ctx), ...fields });
    const basis = (ctx: RecipeContext): BasisVectorsTool => ({ ...basisVectorsDefaults(), ...kit.identity('basisVectors', ctx) });
    const all: Recipe[] = [
        {
            id: 'transform-matrix',
            section: 'Linear algebra',
            label: t(is3D ? 'linear.recipe.transform3d' : 'linear.recipe.transform'),
            hint: t('linear.recipeHint.transform'),
            available,
            build: (ctx) => {
                const own = someMatrix(ctx);
                const def = own ? null : newMatrix(ctx, kit, ctx.is3D ? 3 : 2);
                let c = withTools(ctx, def ? [def] : []);
                const g = grid(c);
                c = withTools(c, [g]);
                const b = basis(c);
                c = withTools(c, [b]);
                const u: UnitSquareTool = { ...unitSquareDefaults(), ...kit.identity('unitSquare', c), valueLabel: true };
                c = withTools(c, [u]);
                const tr: TransformTool = { ...transformDefaults(), ...kit.identity('transform', c), map: own ?? def?.name ?? 'A', step: nextStep(ctx) };
                return { kind: 'items', tools: [...(def ? [def] : []), g, b, u, tr], reveal: def ? 4 : 3 };
            },
        },
        {
            id: 'eigenvectors',
            section: 'Linear algebra',
            label: t('linear.recipe.eigenvectors'),
            hint: t('linear.recipeHint.eigenvectors'),
            available,
            build: (ctx) => {
                const own = someMatrix(ctx);
                const def = own ? null : newMatrix(ctx, kit, ctx.is3D ? 3 : 2);
                const c = withTools(ctx, def ? [def] : []);
                const ev: EigenvectorsTool = { ...eigenvectorsDefaults(), ...kit.identity('eigenvectors', c), matrix: own ?? def?.name ?? 'A', valueLabel: true };
                return def ? { kind: 'items', tools: [def, ev], reveal: 1 } : { kind: 'tool', tool: ev };
            },
        },
        {
            id: 'grid-basis',
            section: 'Linear algebra',
            label: t('linear.recipe.gridBasis'),
            hint: t('linear.recipeHint.gridBasis'),
            available,
            build: (ctx) => {
                const g = grid(ctx);
                const b = basis(withTools(ctx, [g]));
                return { kind: 'items', tools: [g, b], reveal: 0 };
            },
        },
        {
            id: 'complex-map',
            section: 'Linear algebra',
            label: t('linear.recipe.complexMap'),
            hint: t('linear.recipeHint.complexMap'),
            available,
            build: (ctx) => {
                const g = grid(ctx, { from: '-1.5', to: '1.5', spacing: '0.25' });
                const tr: TransformTool = { ...transformDefaults(), ...kit.identity('transform', withTools(ctx, [g])), map: 'z \\mapsto z^2', step: nextStep(ctx) };
                return { kind: 'items', tools: [g, tr], reveal: 1 };
            },
        },
    ];
    return is3D ? all.filter((r) => r.id !== 'complex-map') : all;
}
