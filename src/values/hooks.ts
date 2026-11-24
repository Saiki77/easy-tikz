/*
 * 6.0 A: the typed path as src/expr.ts sees it (its ValueHooks): which
 * formulas need values, and how they compile and export. MathContext puts
 * these hooks on every Env it makes. Pure: no DOM, no Obsidian.
 */
import { Compiled, Env, ExprError, Node, ValueHooks } from '../expr';
import { t as msg } from '../i18n';
import { Cell, Definitions, ValueCompiler, needsValues, numberLike, shapeText, variableLocals } from './compile';
import { toReal } from './ops';
import { valuePgf } from './pgf';

/** The hooks for the let definitions `defs` (null: none, values still work: i, vectors, sums of them). */
export function valueHooks(defs: Definitions | null): ValueHooks {
    return {
        needs: (ast: Node, env: Env, src: string) => {
            try {
                return needsValues(ast, env, defs, src);
            } catch {
                return false;
            }
        },
        compileNumber: (ast: Node, env: Env, src: string): Compiled => {
            const cells: Cell[] = env.vars.map(() => ({ v: NaN }));
            const part = new ValueCompiler({ env, defs, locals: variableLocals(env, cells), src }).node(ast);
            if (!numberLike(part.shape)) throw new ExprError(msg('values.problem.notANumber', { what: shapeText(part.shape) }), { pos: ast.s });
            const f = part.f;
            if (!cells.length) return () => toReal(f());
            const c0 = cells[0];
            const c1 = cells.length > 1 ? cells[1] : null;
            return (a: number, b: number) => {
                c0.v = a;
                if (c1) c1.v = b;
                return toReal(f());
            };
        },
        pgf: (ast: Node, env: Env, outVars: string[], fmt: (n: number) => string) => valuePgf(ast, env, defs, outVars, fmt),
    };
}
