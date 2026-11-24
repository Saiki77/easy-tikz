# Values (6.0, part A)

Complex numbers, vectors, matrices and lists in every formula; sums, products, factorials and binomials; names for values and for functions of several variables (`let`); vectors drawn as arrows; the points of a list. Code: `src/values/`. Tests: `tests/values-engine.test.ts`, `values-text`, `values-scene`, `values-api`, and the `values-*` charts of `tests/latex.test.ts`.

## In every formula field

These work in every field of every line (functions, conditions, equations, coordinates, bounds, labels), plain or LaTeX in `$...$`. Sliders work inside all of them.

| LaTeX | Plain | Meaning |
|---|---|---|
| `\sum_{k=1}^{n} \frac{1}{k^2}` | `sum(1/k^2, k, 1, n)` | sum for k = 1, ..., n (bounds rounded, at most 100000 terms) |
| `\prod_{k=1}^{n} k` | `prod(k, k, 1, n)` | product |
| `n!`, `(2k+1)!` | `n!`, `factorial(n)` | factorial (the gamma function between whole numbers) |
| `\binom{n}{k}` | `binom(n, k)` | binomial coefficient |
| `i`, `-0.8 + 0.156i`, `e^{i\theta}` | the same | complex numbers |
| `\|z\|`, `\arg z`, `\bar z`, `\overline{z}`, `\Re z`, `\Im z` | `abs(z)`, `arg(z)`, `conj(z)`, `re(z)`, `im(z)` | modulus, argument, conjugate, parts |
| `\begin{pmatrix} 2 \\ 1 \end{pmatrix}`, `(2, 1)` | `(2, 1)` | a vector (2D, 3D or longer) |
| `\begin{pmatrix} 1 & 2 \\ 3 & 4 \end{pmatrix}` (also `bmatrix`) | `[[1, 2], [3, 4]]` | a matrix; `vmatrix` is its determinant |
| `\{(k, k^2) : k = 1, \dots, 10\}` | `[(k, k^2) : k = 1..10]` | a list from a range (also `\mid`, `k \in \{1, \dots, n\}`) |
| `\{1, 2, 3\}` | `[1, 2, 3]` | a list |
| `v + w`, `2v`, `v \cdot w`, `\|v\|`, `v \times w` | `v + w`, `2v`, `v * w`, `abs(v)`, `cross(v, w)` | vector sum, scaling, dot product, length, cross product (2D: a number) |
| `Av`, `AB`, `A^{-1}`, `A^T`, `\det A`, `\operatorname{tr} A`, `\|A\|` | `A v`, `A B`, `A^(-1)`, `A^T`, `det(A)`, `tr(A)` | matrix products, inverse, transpose, determinant, trace |
| `\nabla f(p)`, `\nabla f(1, 2)` | `grad(f, p)` | numeric gradient of a let function (central differences) |
| `v_x`, `v_y`, `v_z`, `v_1` | the same | a number of a let vector |

More functions of values: `norm`, `dot`, `cross`, `inv`, `transpose`, `len` (items of a list or numbers of a vector), `unit`, `angle(v, w)`. A real function of a real number stays real (`\sqrt{-4}` has no value); a complex number makes it complex (`\sqrt{-4 + 0i}` is 2i). Functions of lists work item by item (`2S`, `|S|`). `A(1, 2)` is A times the vector (1, 2).

A field of numbers (a function, a bound, a label) takes a formula whose value is a number: a complex value with no imaginary part counts (within rounding, so `e^{i\pi} + 1` is 0). A formula that gives a vector there is an error: "This formula gives a vector of 2 numbers, not a number". Labels print a value as it is: `{v}` is `(2, 1)`, `{c}` is `-0.8 + 0.156i`, `{A}` is `[[1.5, 1], [0.5, 2]]`. Outside `$...$` a placeholder cannot hold LaTeX braces (`{A^(-1)}`, not `{A^{-1}}`).

Problems name the place and the values: "Cannot add a vector of 2 numbers and a number", "Cannot multiply a 2 x 2 matrix by a vector of 3 numbers", "f takes 2 arguments". English and Japanese.

**The export.** pgfplots has no sum: a sum is written out term by term at the sliders' values, each part without a variable as its number (`\sum_{k=0}^{n} \frac{(-1)^k x^{2k+1}}{(2k+1)!}` with n = 3 exports as `((1*(x^1))/1)+(((-1)*(x^3))/6)+...+(((-1)*(x^7))/5040)`), so the curve is exact. A function that uses values is written as real pgfmath: let functions with their arguments, complex numbers as their real and imaginary parts (`|e^{ix} + c|` is a `veclen` of the two parts). What has no pgfmath form (a list, a gradient, a factorial of x) is a problem of that function in the export.

## Lines

### let

```
let $v = (2, 1)$
let $w = \begin{pmatrix} -1 \\ 2 \end{pmatrix}$
let $A = \begin{pmatrix} 1.5 & 1 \\ 0.5 & 2 \end{pmatrix}$
let A = [[1.5, 1], [0.5, 2]]
let $c = -0.8 + 0.156i$
let $f(x, y) = x^2 + 4y^2$
let $R(\theta) = \begin{pmatrix} \cos\theta & -\sin\theta \\ \sin\theta & \cos\theta \end{pmatrix}$
let $S = \{(k, k^2) : k = 1, \dots, 10\}$
```

A name for a value or for a function of one or more variables, usable by name in every formula of the chart, in any order (`plot $g(x) = f(x, 1)$`, `shade where $f(x, y) \le 4$`, labels `{det(A)}`). A function's body reads only its parameters, sliders and the chart's names (no axis variables of its own). Names: letters, digits and `_`, not a slider, function or axis variable name (`x`, `y`, `z`, `t`, `theta` are taken). A definition that refers to itself, directly or through others, is a problem on each of them. Option: `hidden` (no effect on the picture). Full LaTeX: `\let{v = (2, 1)}`, `\let{f(x, y) = x^2 + 4y^2}`.

**Data model.** A let line is a tool of type `value` (`{ type: 'value', name: 'v', params: '', expression: '(2, 1)' }`; a function has `params: 'x, y'`), like a data set (5.0) a tool that draws nothing. Why a tool and not a list of the chart: the editor's card list, + Add, delete, undo, the scene's dependency graph and cache keys, the line-by-line rewrite of a block and the rename of a tool (it rewrites every reference, `v` and `v_x`) all work for tools already, and other parts' merges touch no new list of the chart. The MathContext takes the definitions as `MathContextInput.values` (settings and the renderers fill it from the tools); their names are values there, not tools. A printed chart writes tools in their order, so a let line written after a plot stays after it (names resolve in any order).

### Vector arrows

```
draw v as an arrow
draw v and w as arrows, labelled
draw v as an arrow from (1, 1)        (also: draw v from (1, 1))
draw v + w tip to tail
draw A v as an arrow in red
draw (1, 3) as an arrow
```

Arrows from the origin, or from a point (a formula, or the name of a points tool, so a dragged point moves them). `tip to tail`: the terms of the sum end to end, dashed and thin, then the sum. A vector is a vector value of the chart's dimension, a complex number (its real and imaginary parts) or, in 3D, a 2D vector (z = 0). Options: a colour, `thin`, `thick` (the default), `dashed`, `labelled` (each arrow with its formula in LaTeX, arrows on the vector names: `$\vec{v}$`, `$\vec{v} + \vec{w}$`, `$A \vec{v}$`), `labelled "text"` (a template, one per arrow with `;`, locals `x`, `y`, `z`, `i`), `tip to tail`, `hidden`. 2D and 3D (3D labels sit at the tips, at the middles tip to tail). Tool type `vector` (`vectors: 'v; w'`, `from`, `tipToTail`, `thickness`, `dashed`, `label`, `valueLabel`), names V1, V2, ... Full LaTeX: `\draw[vector, labelled]{v, w}`, `\draw[vector, from={(1, 1)}]{v}`, `\draw[vector, tip to tail, red]{v + w}`. Export: `\draw[->]` per arrow, as the arrows of segments.

### Points of a list

```
slider n from 3 to 12, starting at 6, in steps of 1
mark the points $\{e^{2\pi i k / n} : k = 0, \dots, n - 1\}$, joined, labelled
mark the points of S
```

The points of a list of complex numbers (re, im) or points (vectors); a formula that starts with `\{` or `[`, or `of` and any formula or let name. Options: a colour, `small`, `large`, `thin`, `thick`, `joined` (the closed polygon through them in their order), `labelled` (each point's value: `0.5 + 0.866i`, `(1, 2)`), `labelled "text"` (locals `x`, `y`, `z`, `i`), `hidden`. Publishes `LP1_n`, `LP1_x`, `LP1_y`, `LP1_x2`, ... as points do. 2D and 3D. Tool type `listPoints` (`points`, `joined`, `size`, `thickness`, `label`, `valueLabel`). Full LaTeX: `\mark[list, joined, labelled]{\{e^{2\pi i k / n} : k = 0, \dots, n - 1\}}`, `\mark[list]{S}`.

### Examples

```
show x from -6 to 6 and y from -2.5 to 2.5
slider n from 0 to 12, starting at 3, in steps of 1
plot $T(x) = \sum_{k=0}^{n} \frac{(-1)^k x^{2k+1}}{(2k+1)!}$, thick
plot $\sin(x)$ in gray, dashed
```

```
show x from -3 to 3 and y from -3 to 3
equal scale
let v = (2, 1)
let w = (-1, 1.5)
let A = [[0, -1], [1, 0]]
draw v and w as arrows, labelled
draw v + w tip to tail in red, labelled
draw A v as an arrow in green, labelled
write "det A = {det(A)}" at (1.5, -2)
```

## Editor

Build tab cards: Definition (formula, parameters, its value now; the name on the card's head renames it everywhere), Vector arrows (vectors, from, Tip to tail, Labels, label, line), Points of a list (list, Labels, label, line, Joined). + Add, section Values: Definition (let), Vector arrow (with a definition v when the chart has none), Points of a list (the roots of unity with a slider n, 2D).

## API for parts D and E (`src/values/index.ts`)

```ts
type Value = number | Complex | Vec | Mat | List;     // { kind: 'complex', re, im }, { kind: 'vec', v }, { kind: 'mat', rows, cols, a }, { kind: 'list', items }
type Shape = { k: 'num' } | { k: 'complex' } | { k: 'vec'; n } | { k: 'mat'; r; c } | { k: 'list'; of } | { k: 'any' };

// The chart's definitions: MathContextInput.values = valueDefinitions(tools) (settings.mathContextInput() does it).
compileValue(ctx, src, inputs?: Array<string | { name, shape }>): { run(...inputs: Value[]): Value; shape }   // throws ExprError
letValue(ctx, name): Value
compileRecurrence(ctx, 'z_{n+1} = z_n^2 + c', ['c']): {
    recurrence: { state: 'z', index: 'n', current: 'z_n', formula },
    step(current: Value, ...inputs: Value[]): Value,              // any state: number, complex, vector
    complex: { inputs, run(inp: Float64Array, out: Float64Array) } | null,   // no objects: inp = [zRe, zIm, cRe, cIm], out = [re, im]
}
readRecurrence(src): Recurrence | null
compileComplex(ctx, src, inputs: string[]): ComplexFormula   // the fast form alone (complex arithmetic, exp, log, sqrt, sin, cos, sinh, cosh, |z|, re, im, conj, arg, whole powers by multiplication)
toGlsl(ctx, src, { inputs: { z: { glsl: 'z', complex: true }, x: { glsl: 'p.x', complex: false } }, sliders?: 'uniform' | 'number' })
    -> { code, complex, uniforms: [{ name, uniform: 'u_a', read() }] }   // complex = vec2; put GLSL_COMPLEX (c_mul, c_div, c_exp, c_log, c_pow, c_sqrt, c_sin, ...) before it; GLSL ES 1.00
gradient(ctx, 'f', [1, 2]): number[] | null            // ∇f of a let function at a point; gradientAt(fn, point) for any function
eigen(m: Mat): Array<{ value: number | Complex; vector: number[] | null }>   // 2 x 2 and 3 x 3, real ones largest first, unit vectors (largest entry positive)
det, trace, inverse, transpose, identity, matMul, matVec, matPow, cubicRoots, cross3
add, sub, mul, div, pow, neg, abs, cross, dot, toReal, cmul, cdiv, cexp, clog, csqrt, cpow   // never throw: NaN for what a value does not have
formatValue(v, decimals), valueTex(v), parseValue(src)
```

Inputs of `compileValue` and `compileRecurrence` hide the chart's names of the same name (so `z`, `x`, `c` may be inputs although `z` and `x` are axis variables). A recurrence of complex numbers has `complex` (about 3 times faster than `step`: some 10 ns a step of z^2 + c); one of vectors (`p_{n+1} = p_n - \eta \nabla f(p_n)`) has only `step`. `toGlsl` writes let values as numbers (rebuild the shader when one changes with a slider; sliders themselves are uniforms) and let functions with their arguments. The typed path in `src/expr.ts` is `Env.values` (ValueHooks: `needs`, `compileNumber`, `pgf`); a formula that needs no value compiles exactly as before.
