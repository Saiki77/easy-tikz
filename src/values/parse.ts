/*
 * 6.0 A: the formulas of values, read into a tree. The grammar is the one
 * of src/expr.ts (same tokens, same precedence, implicit multiplication,
 * LaTeX read through latexToPlain) with what values add:
 *
 *   (2, 1)                  a vector (a tuple of two or more items)
 *   [[1.5, 1], [0.5, 2]]    a matrix (rows in brackets)
 *   [1, 2, 3]               a list
 *   [(k, k^2) : k = 1..10]  a list from k = 1 to 10 (\{(k, k^2) : k = 1, \dots, 10\})
 *   n!                      a factorial (also in every other formula)
 *
 * Sums and products stay calls, sum(body, k, lo, hi), as in src/expr.ts.
 * The tree is VNode: the expr.ts Node with these four kinds added, so a
 * Node of any other field is a VNode too. Pure: no DOM, no Obsidian.
 */
import { ArithOp, CmpOp, ExprError, Lru, MemberNode, NameNode, NumNode, Token, tokenize } from '../expr';
import { t as msg } from '../i18n';

export interface VCall {
    t: 'call';
    name: string;
    math: boolean;
    args: VNode[];
    ns: number;
    ne: number;
    s: number;
    e: number;
}

export interface VUnary {
    t: 'unary';
    op: '-' | '+' | '!';
    arg: VNode;
    s: number;
    e: number;
}

export interface VBinary {
    t: 'binary';
    op: ArithOp;
    left: VNode;
    right: VNode;
    implicit?: boolean;
    equation?: boolean;
    cross?: boolean;
    s: number;
    e: number;
}

export interface VCmp {
    t: 'cmp';
    ops: CmpOp[];
    args: VNode[];
    s: number;
    e: number;
}

export interface VLogic {
    t: 'logic';
    op: '&&' | '||';
    left: VNode;
    right: VNode;
    s: number;
    e: number;
}

export interface VTernary {
    t: 'ternary';
    test: VNode;
    then: VNode;
    else: VNode;
    s: number;
    e: number;
}

/** (a, b, ...): a vector. */
export interface VecNode {
    t: 'vec';
    items: VNode[];
    s: number;
    e: number;
}

/** [[a, b], [c, d]]: a matrix, row by row. */
export interface MatNode {
    t: 'mat';
    rows: VNode[][];
    s: number;
    e: number;
}

/** [a, b, c]: a list. */
export interface ListNode {
    t: 'list';
    items: VNode[];
    s: number;
    e: number;
}

/** [body : k = lo..hi]: the list of body for k = lo, lo + 1, ..., hi. */
export interface CompNode {
    t: 'comp';
    body: VNode;
    index: string;
    lo: VNode;
    hi: VNode;
    s: number;
    e: number;
}

export type VNode = NumNode | NameNode | MemberNode | VCall | VUnary | VBinary | VCmp | VLogic | VTernary | VecNode | MatNode | ListNode | CompNode;

const CMP_OPS: Record<string, CmpOp> = {
    '<': '<', '<=': '<=', '>': '>', '>=': '>=', '==': '==', '===': '==', '!=': '!=', '!==': '!=',
};

class ValueParser {
    private i = 0;

    constructor(private toks: Token[]) {}

    private peek(): Token {
        return this.toks[this.i];
    }

    private next(): Token {
        return this.toks[this.i++];
    }

    private isOp(text: string): boolean {
        const t = this.toks[this.i];
        return t.kind === 'op' && t.text === text;
    }

    private eatOp(text: string): boolean {
        if (this.isOp(text)) {
            this.i++;
            return true;
        }
        return false;
    }

    private eatWord(word: string): boolean {
        const t = this.toks[this.i];
        if (t.kind === 'id' && t.text === word) {
            this.i++;
            return true;
        }
        return false;
    }

    fail(t: Token = this.peek()): never {
        if (t.kind === 'end') throw new ExprError(msg('problems.expr.unexpectedEnd'), { pos: t.pos });
        if (t.kind === 'op' && t.text === '=') throw new ExprError(msg('problems.expr.compareWithDoubleEquals'), { pos: t.pos });
        throw new ExprError(msg('problems.expr.unexpected', { token: t.text }), { pos: t.pos });
    }

    private expect(close: string, open: Token): Token {
        const t = this.peek();
        if (t.kind === 'op' && t.text === close) {
            this.i++;
            return t;
        }
        if (t.kind === 'end') throw new ExprError(msg(close === ')' ? 'problems.expr.missingParen' : 'values.problem.missingBracket'), { pos: open.pos });
        return this.fail(t);
    }

    top(): VNode {
        if (this.peek().kind === 'end') throw new ExprError(msg('problems.expr.enterExpression'), { pos: 0 });
        const node = this.ternary();
        if (this.peek().kind !== 'end') this.fail();
        return node;
    }

    ternary(): VNode {
        const test = this.or();
        if (!this.eatOp('?')) return test;
        const then = this.ternary();
        if (!this.eatOp(':')) {
            const t = this.peek();
            if (t.kind === 'end') throw new ExprError(msg('problems.expr.missingColon'), { pos: t.pos });
            this.fail(t);
        }
        const otherwise = this.ternary();
        return { t: 'ternary', test, then, else: otherwise, s: test.s, e: otherwise.e };
    }

    private or(): VNode {
        let left = this.and();
        while (this.eatOp('||') || this.eatWord('or')) {
            const right = this.and();
            left = { t: 'logic', op: '||', left, right, s: left.s, e: right.e };
        }
        return left;
    }

    private and(): VNode {
        let left = this.cmp();
        while (this.eatOp('&&') || this.eatWord('and')) {
            const right = this.cmp();
            left = { t: 'logic', op: '&&', left, right, s: left.s, e: right.e };
        }
        return left;
    }

    private cmp(): VNode {
        const first = this.add();
        const ops: CmpOp[] = [];
        const args: VNode[] = [first];
        for (;;) {
            const t = this.peek();
            const op = t.kind === 'op' && Object.prototype.hasOwnProperty.call(CMP_OPS, t.text) ? CMP_OPS[t.text] : undefined;
            if (op === undefined) break;
            this.i++;
            ops.push(op);
            args.push(this.add());
        }
        if (!ops.length) return first;
        return { t: 'cmp', ops, args, s: first.s, e: args[args.length - 1].e };
    }

    private add(): VNode {
        let left = this.mul();
        for (;;) {
            const t = this.peek();
            if (t.kind !== 'op' || (t.text !== '+' && t.text !== '-')) return left;
            this.i++;
            const right = this.mul();
            left = { t: 'binary', op: t.text, left, right, s: left.s, e: right.e };
        }
    }

    private mul(): VNode {
        let left = this.unary();
        for (;;) {
            const t = this.peek();
            if (t.kind === 'op' && (t.text === '*' || t.text === '/' || t.text === '%')) {
                this.i++;
                const right = this.unary();
                const node: VBinary = { t: 'binary', op: t.text, left, right, s: left.s, e: right.e };
                if (t.cross) node.cross = true;
                left = node;
            } else if (startsPrimary(t)) {
                const prev = this.toks[this.i - 1];
                if (t.kind === 'num' && t.text[0] === '.' && prev && prev.end === t.pos) {
                    throw new ExprError(msg('problems.expr.unexpectedDot'), { pos: t.pos });
                }
                const right = this.unary();
                left = { t: 'binary', op: '*', left, right, implicit: true, s: left.s, e: right.e };
            } else {
                return left;
            }
        }
    }

    private unary(): VNode {
        const t = this.peek();
        if (t.kind === 'op' && (t.text === '-' || t.text === '+' || t.text === '!')) {
            this.i++;
            const arg = this.unary();
            return { t: 'unary', op: t.text, arg, s: t.pos, e: arg.e };
        }
        return this.pow();
    }

    private pow(): VNode {
        let base = this.primary();
        while (this.isOp('!')) {
            const bang = this.next();
            base = { t: 'call', name: 'factorial', math: false, args: [base], ns: bang.pos, ne: bang.end, s: base.s, e: bang.end };
        }
        if (this.eatOp('^') || this.eatOp('**')) {
            const exponent = this.unary();
            return { t: 'binary', op: '^', left: base, right: exponent, s: base.s, e: exponent.e };
        }
        return base;
    }

    private args(open: Token): VNode[] {
        const args: VNode[] = [];
        if (this.eatOp(')')) return args;
        args.push(this.ternary());
        while (this.eatOp(',')) args.push(this.ternary());
        this.expect(')', open);
        return args;
    }

    private primary(): VNode {
        const t = this.next();
        if (t.kind === 'num') return { t: 'num', value: t.value, raw: t.text, s: t.pos, e: t.end };
        if (t.kind === 'op' && t.text === '(') {
            const first = this.ternary();
            if (this.isOp(',')) {
                const items = [first];
                while (this.eatOp(',')) items.push(this.ternary());
                const close = this.expect(')', t);
                return { t: 'vec', items, s: t.pos, e: close.end };
            }
            const close = this.expect(')', t);
            return { ...first, s: t.pos, e: close.end };
        }
        if (t.kind === 'op' && t.text === '[') return this.bracket(t);
        if (t.kind === 'id') {
            if (t.text === 'and' || t.text === 'or') this.fail(t);
            if (t.text === 'Math' && this.isOp('.')) {
                this.i++;
                const member = this.next();
                if (member.kind !== 'id') throw new ExprError(msg('problems.expr.nameAfterMath'), { pos: member.pos });
                if (this.isOp('(')) {
                    const open = this.next();
                    const args = this.args(open);
                    return { t: 'call', name: member.text, math: true, args, ns: t.pos, ne: member.end, s: t.pos, e: this.toks[this.i - 1].end };
                }
                return { t: 'member', name: member.text, s: t.pos, e: member.end };
            }
            if (this.isOp('(')) {
                const open = this.next();
                const args = this.args(open);
                return { t: 'call', name: t.text, math: false, args, ns: t.pos, ne: t.end, s: t.pos, e: this.toks[this.i - 1].end };
            }
            return { t: 'name', name: t.text, s: t.pos, e: t.end };
        }
        return this.fail(t);
    }

    /** After `[`: a list, a matrix (rows in brackets) or a list from a range. */
    private bracket(open: Token): VNode {
        if (this.isOp(']')) {
            const close = this.next();
            return { t: 'list', items: [], s: open.pos, e: close.end };
        }
        const first = this.ternary();
        if (this.eatOp(':')) {
            const name = this.next();
            if (name.kind !== 'id') throw new ExprError(msg('values.problem.rangeTakes'), { pos: name.pos });
            if (!this.eatOp('=')) throw new ExprError(msg('values.problem.rangeTakes'), { pos: this.peek().pos });
            const lo = this.ternary();
            if (!this.eatOp('..')) throw new ExprError(msg('values.problem.rangeTakes'), { pos: this.peek().pos });
            const hi = this.ternary();
            const close = this.expect(']', open);
            return { t: 'comp', body: first, index: name.text, lo, hi, s: open.pos, e: close.end };
        }
        const items = [first];
        while (this.eatOp(',')) items.push(this.ternary());
        const close = this.expect(']', open);
        if (items.every((it) => it.t === 'list' && it.items.length > 0)) {
            const rows = items.map((it) => (it.t === 'list' ? it.items : []));
            // 6.0 G: rows of different lengths are a list of lists, as GeoGebra reads {{1}, {2, 3}}.
            if (rows.some((r) => r.length !== rows[0].length)) return { t: 'list', items, s: open.pos, e: close.end };
            return { t: 'mat', rows, s: open.pos, e: close.end };
        }
        return { t: 'list', items, s: open.pos, e: close.end };
    }
}

function startsPrimary(t: Token): boolean {
    if (t.kind === 'num') return true;
    if (t.kind === 'id') return t.text !== 'and' && t.text !== 'or';
    return t.kind === 'op' && t.text === '(';
}

const CACHE = new Lru<string, VNode>(512);

/** Read a value formula (plain or LaTeX). Throws ExprError with the position (in the plain text, as src/expr.ts does). */
export function parseValue(src: string): VNode {
    const hit = CACHE.get(src);
    if (hit) return hit;
    const node = new ValueParser(tokenize(src)).top();
    CACHE.set(src, node);
    return node;
}

/** A vector, matrix, list or range: a node only values have. */
export function isValueNode(n: VNode): n is VecNode | MatNode | ListNode | CompNode {
    return n.t === 'vec' || n.t === 'mat' || n.t === 'list' || n.t === 'comp';
}

/** Every child of a node, in order. */
export function children(n: VNode): VNode[] {
    switch (n.t) {
        case 'num':
        case 'name':
        case 'member':
            return [];
        case 'call':
            return n.args;
        case 'unary':
            return [n.arg];
        case 'binary':
        case 'logic':
            return [n.left, n.right];
        case 'cmp':
            return n.args;
        case 'ternary':
            return [n.test, n.then, n.else];
        case 'vec':
        case 'list':
            return n.items;
        case 'mat':
            return n.rows.flat();
        case 'comp':
            return [n.body, n.lo, n.hi];
    }
}
