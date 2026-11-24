/*
 * 6.0 P: the + Add recipes of the section Script: a matplotlib-style plot
 * with a slider, the Fourier drawing of a heart, and a script that moves
 * with frame(t). src/migrate.ts lists them with its own and lends the
 * helpers. Pure: no DOM, no Obsidian.
 */
import type { Parameter, Tool } from '../types';
import type { Recipe, RecipeContext, RecipeResult } from '../migrate';
import { t } from '../i18n';
import type { MessageKey } from '../i18n';

export const PLOT_SCRIPT = `import numpy as np
import matplotlib.pyplot as plt

x = np.linspace(-np.pi, np.pi, 200)
for k in range(1, 4):
    plt.plot(x, np.sin(k * x + a) / k, label=f"sin({k}x + a) / {k}")
plt.fill_between(x, 0, np.sin(x + a), alpha=0.2)
plt.legend()`;

export const HEART_SCRIPT = `import numpy as np
t = np.linspace(0, 2*np.pi, 256, endpoint=False)
heart = 16*np.sin(t)**3 + 1j*(13*np.cos(t) - 5*np.cos(2*t) - 2*np.cos(3*t) - np.cos(4*t))
c = np.fft.fft(heart) / len(heart)`;

export const FRAME_SCRIPT = `import numpy as np
import matplotlib.pyplot as plt

x = np.linspace(0, 4 * np.pi, 300)

def frame(t):
    plt.plot(x, np.sin(x - 2 * t), color="C0")
    plt.plot(x, 0.5 * np.sin(2 * x + t), color="C3", linestyle="--")
    plt.scatter([t % (4 * np.pi)], [np.sin(t % (4 * np.pi) - 2 * t)], s=60, c="C0")`;

export function pythonRecipes(in2D: (ctx: RecipeContext) => boolean, tool: (type: string, ctx: RecipeContext) => Tool, names: (ctx: RecipeContext) => string[]): Recipe[] {
    const recipe = (id: string, label: MessageKey, hint: MessageKey, build: (ctx: RecipeContext) => RecipeResult): Recipe => ({
        id,
        section: 'Script',
        label: t(label),
        hint: t(hint),
        available: in2D,
        build,
    });
    const slider = (ctx: RecipeContext, p: Parameter): Parameter[] => (names(ctx).includes(p.name) ? [] : [p]);
    const script = (ctx: RecipeContext, code: string): Tool => Object.assign(tool('python', ctx), { code });
    return [
        recipe('python-plot', 'python.recipe.plot', 'python.recipeHint.plot', (ctx) => ({
            kind: 'items',
            parameters: slider(ctx, { name: 'a', value: 0, min: -3.14, max: 3.14, step: 0.01 }),
            tools: [script(ctx, PLOT_SCRIPT)],
        })),
        recipe('python-fourier', 'python.recipe.fourier', 'python.recipeHint.fourier', (ctx) => {
            const n = slider(ctx, { name: 'n', value: 40, min: 1, max: 120, step: 1 });
            const py = script(ctx, HEART_SCRIPT);
            const circles = Object.assign(tool('fourierCircles', { ...ctx, tools: [...ctx.tools, py] }), { sum: 'c', count: 'n', path: true });
            return { kind: 'items', parameters: n, tools: [py, circles], reveal: 1 };
        }),
        recipe('python-frame', 'python.recipe.frame', 'python.recipeHint.frame', (ctx) => ({ kind: 'tool', tool: script(ctx, FRAME_SCRIPT) })),
    ];
}
