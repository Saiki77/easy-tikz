/*
 * Python in a chart (6.0 P), the language: tokens and indentation, the
 * statements, values, built-ins, scopes and closures, comprehensions,
 * f-strings, errors with their line and column, and the budgets.
 */
import { test, assert, near } from './_lib';
import { Program } from '../src/python/program';
import { repr, str } from '../src/python/values';
import type { PyValue } from '../src/python/values';
import { tokenize } from '../src/python/lexer';

function run(code: string, inputs: Record<string, number> = {}) {
    return new Program([code]).run(inputs);
}

function value(code: string, name = 'r', inputs: Record<string, number> = {}): PyValue {
    const r = run(code, inputs);
    if (r.error) throw new Error(`${r.error.kind} at ${r.error.line}:${r.error.col}: ${r.error.message}`);
    const v = r.globals.get(name);
    if (v === undefined) throw new Error(`no ${name}`);
    return v;
}

const rep = (code: string, name = 'r') => repr(value(code, name));

test('tokens: indentation, numbers, strings', () => {
    const toks = tokenize('if x:\n    y = 1_000 + 0x1f + 2.5e3 + 3j\n    z = "a\\tb" + r"\\n"\nw = 1\n');
    const kinds = toks.map((t) => t.t);
    assert.ok(kinds.includes('indent'));
    assert.ok(kinds.includes('dedent'));
    const nums = toks.filter((t) => t.t === 'num').map((t) => t.num);
    assert.deepEqual(nums, [1000, 31, 2500, 3, 1]);
    assert.equal(toks.find((t) => t.t === 'num' && t.imag)?.v, '3j');
    const strs = toks.filter((t) => t.t === 'str').map((t) => t.v);
    assert.deepEqual(strs, ['a\tb', '\\n']);
});

test('arithmetic follows Python', () => {
    assert.equal(rep('r = 7 // 2, -7 // 2, 7 % 3, -7 % 3, 2 ** 10, 2 ** -1, 7 / 2'), '(3, -4, 1, 2, 1024, 0.5, 3.5)');
    assert.equal(rep('r = (1 + 2j) * (3 - 1j)'), '(5+5j)');
    assert.equal(rep('r = abs(3 + 4j)'), '5');
    assert.equal(rep('r = 1j ** 2'), '(-1+0j)');
    assert.equal(rep("r = 'ab' * 3 + 'c'"), "'abababc'");
    assert.equal(rep('r = [1, 2] + [3] * 2'), '[1, 2, 3, 3]');
    assert.equal(rep('r = 1 < 2 < 3, 3 > 2 > 2, not 0, 1 and 2, 0 or "x"'), "(True, False, True, 2, 'x')");
    assert.equal(rep('r = True + True'), '2');
    assert.equal(rep('r = 10 if 3 > 2 else 20'), '10');
});

test('statements: if, for, while, break, continue, else', () => {
    const code = `
total = 0
for i in range(10):
    if i % 2 == 0:
        continue
    if i > 7:
        break
    total += i
n = 0
while n < 5:
    n += 1
else:
    n = n * 10
r = total, n
`;
    assert.equal(rep(code), '(16, 50)');
});

test('tuple unpacking, starred, swaps, augmented items', () => {
    assert.equal(rep('a, b = 1, 2\na, b = b, a\nr = a, b'), '(2, 1)');
    assert.equal(rep('a, *rest = [1, 2, 3, 4]\nr = a, rest'), '(1, [2, 3, 4])');
    assert.equal(rep('x = [1, 2, 3]\nx[1] += 10\nx[0:1] = [7, 8]\nr = x'), '[7, 8, 12, 3]');
    assert.equal(rep('d = {}\nd["a"] = 1\nd["a"] += 2\nr = d'), "{'a': 3}");
    assert.equal(rep('for i, (a, b) in enumerate([(1, 2), (3, 4)]):\n    last = (i, a + b)\nr = last'), '(1, 7)');
});

test('functions: defaults, keywords, *args, **kwargs, closures, recursion', () => {
    const code = `
def f(a, b=2, *rest, scale=1, **opts):
    return (a + b + sum(rest)) * scale, len(opts)

def counter():
    n = 0
    def inc(k=1):
        nonlocal n
        n += k
        return n
    return inc

c = counter()
c()
c(5)

def fact(n):
    return 1 if n <= 1 else n * fact(n - 1)

g = lambda x, y=10: x * y
r = f(1), f(1, 2, 3, 4, scale=2, z=0), c(), fact(10), g(3), g(3, y=2)
`;
    assert.equal(rep(code), '((3, 0), (20, 1), 7, 3628800, 30, 6)');
});

test('globals and scope rules', () => {
    const code = `
x = 1
def read():
    return x
def write():
    global x
    x = 5
def shadow():
    x = 99
    return x
a = read()
shadow()
write()
r = a, x, shadow()
`;
    assert.equal(rep(code), '(1, 5, 99)');
    const unbound = run('x = 1\ndef f():\n    y = x\n    x = 2\n    return y\nf()\n');
    assert.equal(unbound.error?.kind, 'UnboundLocalError');
    assert.equal(unbound.error?.line, 3);
});

test('comprehensions, dicts, sets, slicing', () => {
    assert.equal(rep('r = [x * x for x in range(6) if x % 2]'), '[1, 9, 25]');
    assert.equal(rep('r = [(i, j) for i in range(3) for j in range(i)]'), '[(1, 0), (2, 0), (2, 1)]');
    assert.equal(rep('r = {k: k ** 2 for k in [1, 2, 3]}'), '{1: 1, 2: 4, 3: 9}');
    assert.equal(rep('r = sorted({x % 3 for x in range(10)})'), '[0, 1, 2]');
    assert.equal(rep('s = [0, 1, 2, 3, 4, 5]\nr = s[1:4], s[::2], s[::-1], s[-2:], s[:-1]'), '([1, 2, 3], [0, 2, 4], [5, 4, 3, 2, 1, 0], [4, 5], [0, 1, 2, 3, 4])');
    assert.equal(rep("r = 'hello'[1:3], 'hello'[-1]"), "('el', 'o')");
    assert.equal(rep('r = sum(x for x in range(5))'), '10');
    assert.equal(rep('n = 3\nr = [n * k for k in range(n)]'), '[0, 3, 6]');
});

test('built-ins', () => {
    assert.equal(rep('r = len([1, 2]), list(range(2, 8, 3)), list(zip([1, 2], "ab")), list(map(lambda v: v * 2, [1, 2]))'), "(2, [2, 5], [(1, 'a'), (2, 'b')], [2, 4])");
    assert.equal(rep('r = min(3, 1, 2), max([4, 9, 2]), max(["aa", "b"], key=len), sorted([3, 1, 2], reverse=True)'), "(1, 9, 'aa', [3, 2, 1])");
    assert.equal(rep('r = round(2.5), round(3.5), round(2.675, 2), abs(-3), int("12"), float("1.5"), int(3.9)'), '(2, 4, 2.68, 3, 12, 1.5, 3)');
    assert.equal(rep('r = list(reversed([1, 2, 3])), list(filter(None, [0, 1, 2])), any([0, 1]), all([1, 0])'), '([3, 2, 1], [1, 2], True, False)');
    assert.equal(rep('r = complex(1, 2), divmod(7, 2), isinstance(3, int), isinstance(3.5, (int, float))'), '((1+2j), (3, 1), True, True)');
    assert.equal(rep('r = dict(a=1, b=2), tuple([1, 2])'), "({'a': 1, 'b': 2}, (1, 2))");
});

test('str methods and formatting', () => {
    assert.equal(rep("r = ' a,b '.strip().split(','), '-'.join(['x', 'y']), 'abc'.upper(), 'a{}b{}'.format(1, 2)"), "(['a', 'b'], 'x-y', 'ABC', 'a1b2')");
    assert.equal(rep('x = 3.14159\nn = 42\nr = f"{x:.2f} {n:>5} {n:05d} {x:.3g} {1234567:,} {0.25:.0%}"'), "'3.14    42 00042 3.14 1,234,567 25%'");
    assert.equal(rep('x = 2\nr = f"{x=} {x!r} {[1, 2]}"'), "'x=2 2 [1, 2]'");
    assert.equal(rep("r = '%d of %s, %.3f' % (3, 'x', 1 / 3)"), "'3 of x, 0.333'");
    assert.equal(rep("w = 6\nr = f'{3.14159:{w}.2f}'"), "'  3.14'");
});

test('print goes to the printed lines', () => {
    const r = run('print("hi", 1 + 1)\nprint([1, 2], sep="-")\n');
    assert.equal(r.error, null);
    assert.deepEqual(r.printed.map((p) => p.text), ['hi 2', '[1, 2]']);
});

test('try, except, raise, assert', () => {
    const code = `
def safe(x):
    try:
        return 1 / x
    except ZeroDivisionError as e:
        return str(e)
    finally:
        pass
try:
    raise ValueError("bad thing")
except (TypeError, ValueError) as err:
    caught = str(err)
r = safe(0), safe(4), caught
`;
    assert.equal(rep(code), "('division by zero', 0.25, 'bad thing')");
    const a = run('x = 1\nassert x == 2, "x must be 2"\n');
    assert.equal(a.error?.kind, 'AssertionError');
    assert.equal(a.error?.message, 'x must be 2');
});

test('problems name the line and column', () => {
    const r = run('x = 1\ny = 2\nz = np.sin(x)\n');
    assert.equal(r.error?.kind, 'NameError');
    assert.equal(r.error?.line, 3);
    assert.equal(r.error?.col, 5);
    assert.equal(r.error?.message, "name 'np' is not defined");
    const s = run('x = (1,\ny = 2\n');
    assert.equal(s.error?.kind, 'SyntaxError');
    const t = run('def f(x):\n    return x + "a"\nf(1)\n');
    assert.equal(t.error?.kind, 'TypeError');
    assert.equal(t.error?.line, 2);
    const i = run('import os\n');
    assert.equal(i.error?.kind, 'ImportError');
    assert.match(i.error?.message ?? '', /numpy/);
    const c = run('class A:\n    pass\n');
    assert.equal(c.error?.kind, 'SyntaxError');
    assert.match(c.error?.message ?? '', /class/);
});

test('budgets: steps, recursion, sizes', () => {
    const loop = run('while True:\n    pass\n');
    assert.equal(loop.error?.kind, 'Budget');
    assert.equal(loop.error?.line, 2);
    assert.match(loop.error?.message ?? '', /steps/);
    const rec = run('def f(n):\n    return f(n + 1)\nf(0)\n');
    assert.equal(rec.error?.kind, 'RecursionError');
    assert.equal(rec.error?.line, 2);
    const big = run('x = [0] * 10**9\n');
    assert.equal(big.error?.kind, 'MemoryError');
    // A budget cannot be caught.
    const caught = run('try:\n    while True:\n        pass\nexcept Exception:\n    ok = 1\n');
    assert.equal(caught.error?.kind, 'Budget');
});

test('math, cmath and random modules', () => {
    assert.equal(rep('import math\nr = math.sqrt(16), math.floor(2.7), math.factorial(5), math.gcd(12, 18)'), '(4, 2, 120, 6)');
    near(value('import math\nr = math.sin(math.pi / 6)') as number, 0.5, 1e-12);
    assert.equal(rep('import cmath\nr = cmath.exp(1j * cmath.pi).real'), '-1');
    const a = value('import random\nrandom.seed(1)\nr = [random.random() for _ in range(3)]');
    const b = value('import random\nrandom.seed(1)\nr = [random.random() for _ in range(3)]');
    assert.deepEqual(a, b);
    const c = value('from math import *\nr = sqrt(2) * sqrt(2)');
    near(c as number, 2, 1e-12);
});

test('names the script defines and reads', () => {
    const p = new Program(['import numpy as np\nk = a * 2\ndef f(x, y):\n    return x + y + b\ng = lambda t: t\nfor i in range(3):\n    pass\n']);
    assert.deepEqual(p.reads, ['a', 'b']);
    assert.deepEqual(
        p.defined.map((d) => `${d.name}${d.params ? `(${d.params.join(',')})` : ''}`),
        ['k', 'f(x,y)', 'g(t)', 'i']
    );
    const r = p.run({ a: 3, b: 1 });
    assert.equal(r.error, null);
    assert.equal(r.globals.get('k'), 6);
});

test('several blocks share one scope', () => {
    const p = new Program(['a = 2', 'b = a * 3', 'print(b)']);
    const r = p.run({});
    assert.equal(r.error, null);
    assert.equal(r.globals.get('b'), 6);
    assert.deepEqual(r.printed, [{ block: 2, text: '6' }]);
    const bad = new Program(['a = 2', 'b = c', 'd = 1']).run({});
    assert.equal(bad.error?.block, 1);
    assert.equal(bad.globals.has('d'), false);
});

test('str of values', () => {
    assert.equal(str(value('r = 2.0')), '2');
    assert.equal(str(value('r = 0.1 + 0.2')), '0.30000000000000004');
    assert.equal(str(value('r = 1e-7')), '1e-07');
    assert.equal(str(value('r = None')), 'None');
    assert.equal(str(value('r = (1,)')), '(1,)');
});
