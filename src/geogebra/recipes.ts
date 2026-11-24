/*
 * 6.0 G: the + Add recipes of GeoGebra lines (Build tab, section GeoGebra):
 * a point, and a triangle with its circumcircle. src/migrate.ts lists them
 * with its own and lends what they need, so this file never imports it.
 * Pure: no DOM, no Obsidian.
 */
import type { GeoGebraTool, Tool } from '../types';
import type { Recipe, RecipeContext } from '../migrate';
import { t } from '../i18n';

/** What migrate.ts lends the recipes. */
export interface GeoGebraKit {
    /** A new tool of a type with its defaults, its id and a free name. */
    tool(type: string, ctx: RecipeContext): Tool;
    /** Every name in the chart. */
    names(ctx: RecipeContext): string[];
}

/** The first of `names` the chart does not use, else null. */
function free(kit: GeoGebraKit, ctx: RecipeContext, names: string[], taken: string[] = []): string | null {
    const used = new Set([...kit.names(ctx), ...taken]);
    return names.find((n) => !used.has(n)) ?? null;
}

/** A GeoGebra line `name = command`. */
function line(kit: GeoGebraKit, ctx: RecipeContext, name: string, command: string): GeoGebraTool {
    const tool = kit.tool('geogebra', ctx);
    if (tool.type !== 'geogebra') throw new Error('geogebra');
    tool.name = name;
    tool.command = command;
    tool.named = true;
    return tool;
}

export function geogebraRecipes(in2D: (ctx: RecipeContext) => boolean, kit: GeoGebraKit): Recipe[] {
    return [
        {
            id: 'geogebra-point',
            section: 'GeoGebra',
            label: t('geogebra.recipe.point'),
            hint: t('geogebra.recipeHint.point'),
            available: in2D,
            build: (ctx) => {
                const name = free(kit, ctx, ['A', 'B', 'C', 'D', 'E', 'F', 'P', 'Q']) ?? kit.tool('geogebra', ctx).name;
                return { kind: 'tool', tool: line(kit, ctx, name, '(1, 2)') };
            },
        },
        {
            id: 'geogebra-triangle',
            section: 'GeoGebra',
            label: t('geogebra.recipe.triangle'),
            hint: t('geogebra.recipeHint.triangle'),
            available: in2D,
            build: (ctx) => {
                const names: string[] = [];
                const pick = (options: string[]) => {
                    const n = free(kit, ctx, options, names) ?? `${options[0]}${names.length + 1}`;
                    names.push(n);
                    return n;
                };
                const [a, b, c] = [pick(['A', 'A_1']), pick(['B', 'B_1']), pick(['C', 'C_1'])];
                const tools: Tool[] = [line(kit, ctx, a, '(1, 1)'), line(kit, ctx, b, '(5, 1)'), line(kit, ctx, c, '(2.5, 4)')];
                tools.push(line(kit, ctx, pick(['poly', 'p']), `Polygon(${a}, ${b}, ${c})`));
                tools.push(line(kit, ctx, pick(['circ', 'k']), `Circle(${a}, ${b}, ${c})`));
                return { kind: 'items', tools, reveal: tools.length - 1 };
            },
        },
    ];
}
