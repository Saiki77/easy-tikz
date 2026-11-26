import { test, assert } from './_lib';
import { mathSpans, lineSpans } from '../src/mathspans';
import { formulaAt, formulasIn } from '../src/formula';

const texs = (text: string) => formulasIn(text).map((f) => f.tex);

test('math spans: money signs are no formulas, and the formulas after them keep their own TeX', () => {
    assert.deepEqual(texs('Ein Kaffee kostet 5$ und ein Buch 10$ im Laden. Es gilt $f(x) = x^2$.'), ['f(x) = x^2']);
    assert.deepEqual(texs('It costs $2.50 per hour.\n\nThen $g(x) = 2x$ holds.'), ['g(x) = 2x']);
    assert.deepEqual(texs('5$ and then $a$ and $b$'), ['a', 'b']);
    // As in Obsidian: a money sign before a comma opens a formula, which the next closing $ ends.
    assert.deepEqual(texs('Das kostet 10$, dann gilt $f(x) = x^2$.'), [', dann gilt $f(x) = x^2']);
});

test('math spans: an opening $ before a space and a closing $ after a space are no dollars of a formula', () => {
    assert.deepEqual(texs('Here $ x $ is text, $y$ is math.'), ['y']);
    assert.deepEqual(texs('$x $ and $y$'), ['x $ and $y']);
    assert.deepEqual(texs('$ a$'), []);
});

test('math spans: a closing $ before a digit does not close: $x$5 is no formula', () => {
    assert.deepEqual(texs('$x$5'), []);
    assert.deepEqual(texs('$x$5 and $y$'), ['x$5 and $y']);
    assert.deepEqual(texs('$x$ 5'), ['x']);
});

test('math spans: escaped dollars, and a backslash inside a formula', () => {
    assert.deepEqual(texs('costs \\$5 and $x$'), ['x']);
    assert.deepEqual(texs('\\$a$ and $b$'), ['b']);
    assert.deepEqual(texs('$a \\$ b$ and $c$'), ['a \\$ b', 'c']);
    assert.deepEqual(texs('\\\\$x$'), ['x']);
});

test('math spans: inline code and code blocks are never math', () => {
    assert.deepEqual(texs('A $a$, code `$b$` and $c$'), ['a', 'c']);
    assert.deepEqual(texs('``a ` $b$ ``, then $c$'), ['c']);
    assert.deepEqual(texs('An open ` tick, then $d$'), ['d']);
    assert.deepEqual(texs('Text $a$\n\n```easy-tikz\nplot $f(x) = x^2$\n```\n\n$b$'), ['a', 'b']);
    assert.deepEqual(texs('---\ntitle: $5 and $\n---\nNow $e$.'), ['e']);
});

test('math spans: display math, in a block and inside a line', () => {
    assert.deepEqual(texs('A $a$, code `$b$` and $$\nc = 1\n$$ then $d$'), ['a', 'c = 1', 'd']);
    assert.deepEqual(texs('Before\n\n$$\nx^2\n\n+ 1\n$$\n\nafter $y$'), ['x^2\n\n+ 1', 'y']);
    assert.deepEqual(texs('inline $$x$$ and $ y $'), ['x']);
    const spans = mathSpans('One $$\na\n$$ two');
    assert.equal(spans.length, 1);
    assert.equal(spans[0].display, true);
});

test('math spans: a formula never runs past its paragraph, a heading, a list item or a table cell', () => {
    assert.deepEqual(texs('costs $5\n\nand $x$'), ['x']);
    assert.deepEqual(texs('# Price $5\nthen $y$'), ['y']);
    assert.deepEqual(texs('- item $5\n- then $z$'), ['z']);
    assert.deepEqual(texs('| a | b |\n| --- | --- |\n| $x$ | 5$ |\n| $ y | $w$ |'), ['x', 'w']);
    // Inside a paragraph a formula may run over a line break, as in Obsidian.
    assert.deepEqual(texs('the sum $a +\nb$ here'), ['a +\nb']);
});

test('math spans: in a callout the > signs are no part of the formula, and every place is in the note', () => {
    const text = 'Intro\n\n> [!note] Rule\n> Price 5$ each, then $f(x) = x$\n> $$\n> x^2 + 1\n> $$\n';
    const found = formulasIn(text);
    assert.deepEqual(
        found.map((f) => f.tex),
        ['f(x) = x', 'x^2 + 1']
    );
    assert.equal(text.slice(found[0].start, found[0].end), '$f(x) = x$');
    assert.equal(text.slice(found[1].start, found[1].end), '$$\n> x^2 + 1\n> $$');
});

test('math spans: the formula at the cursor pairs its dollars the same way', () => {
    assert.deepEqual(formulaAt('The function $f(x) = x^2$ and $g$.', 16), { tex: 'f(x) = x^2', from: 13, to: 25 });
    assert.equal(formulaAt('kostet 5$ und 10$ und dann $f(x) = x^2$', 30)?.tex, 'f(x) = x^2');
    assert.equal(formulaAt('kostet 5$ und 10$', 12), null);
    assert.deepEqual(
        lineSpans('$a$ and $b$').map((s) => [s.start, s.end]),
        [
            [0, 3],
            [8, 11],
        ]
    );
});
