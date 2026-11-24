/*
 * 6.0 P: a recursive descent parser for the Python subset of chart scripts
 * (docs/v6/python.md): statements, expressions with Python's precedence,
 * comprehensions, lambdas, f-strings, slices. Throws PyError (SyntaxError)
 * with the line and column. Pure: no DOM, no Obsidian.
 */
import type { Arg, CompFor, Expr, FPart, Handler, Param, Pos, Stmt } from './ast';
import { PyError } from './errors';
import { Token, tokenize } from './lexer';
import type { MessageKey } from '../i18n';

const AUG = new Set(['+=', '-=', '*=', '/=', '//=', '%=', '**=', '@=', '&=', '|=', '^=', '>>=', '<<=']);
const CMP = new Set(['<', '>', '==', '>=', '<=', '!=']);
/** Statements of Python that chart scripts do not have, with their message. */
const NOT_SUPPORTED: Record<string, MessageKey> = {
    class: 'python.syntax.noClass',
    with: 'python.syntax.noWith',
    yield: 'python.syntax.noYield',
    async: 'python.syntax.noAsync',
    await: 'python.syntax.noAsync',
};

export function parseScript(src: string, lineOffset = 0, colOffset = 0): Stmt[] {
    const p = new Parser(tokenize(src), lineOffset, colOffset);
    return p.module();
}

class Parser {
    private i = 0;

    constructor(
        private readonly toks: Token[],
        private readonly lineOffset: number,
        private readonly colOffset: number
    ) {
        if (lineOffset || colOffset) {
            for (const t of toks) {
                if (t.line === 1) t.col += colOffset;
                t.line += lineOffset;
            }
        }
    }

    private get tok(): Token {
        return this.toks[this.i];
    }

    /** The kind of the token now (a method, so the compiler does not narrow it across steps). */
    private kind(): string {
        return this.toks[this.i].t;
    }

    private peek(k = 1): Token {
        return this.toks[Math.min(this.i + k, this.toks.length - 1)];
    }

    private pos(t: Token = this.tok): Pos {
        return { line: t.line, col: t.col };
    }

    private fail(key: MessageKey = 'python.syntax.invalid', t: Token = this.tok, values: Record<string, string> = {}): never {
        throw new PyError('SyntaxError', key, values, t.line, t.col);
    }

    private isOp(v: string): boolean {
        return this.tok.t === 'op' && this.tok.v === v;
    }

    private isName(v: string): boolean {
        return this.tok.t === 'name' && this.tok.v === v;
    }

    private eatOp(v: string): boolean {
        if (this.isOp(v)) {
            this.i++;
            return true;
        }
        return false;
    }

    private eatName(v: string): boolean {
        if (this.isName(v)) {
            this.i++;
            return true;
        }
        return false;
    }

    private expectOp(v: string): Token {
        if (!this.isOp(v)) this.fail('python.syntax.expected', this.tok, { what: v });
        return this.toks[this.i++];
    }

    private name(): string {
        if (this.tok.t !== 'name' || KEYWORDS.has(this.tok.v)) this.fail('python.syntax.expectedName');
        return this.toks[this.i++].v;
    }

    module(): Stmt[] {
        const out: Stmt[] = [];
        while (this.tok.t !== 'eof') {
            const kind = this.kind();
            if (kind === 'newline') {
                this.i++;
                continue;
            }
            if (kind === 'indent') this.fail('python.syntax.unexpectedIndent');
            out.push(...this.statement());
        }
        return out;
    }

    private block(): Stmt[] {
        this.expectOp(':');
        if (this.tok.t !== 'newline') return this.simple();
        this.i++;
        if (this.kind() !== 'indent') this.fail('python.syntax.expectedIndent');
        this.i++;
        const out: Stmt[] = [];
        while (this.kind() !== 'dedent' && this.kind() !== 'eof') {
            if (this.kind() === 'newline') {
                this.i++;
                continue;
            }
            out.push(...this.statement());
        }
        if (this.kind() === 'dedent') this.i++;
        return out;
    }

    private statement(): Stmt[] {
        const t = this.tok;
        if (t.t === 'name') {
            const bad = NOT_SUPPORTED[t.v];
            if (bad) this.fail(bad);
            switch (t.v) {
                case 'if':
                    return [this.ifStmt()];
                case 'for':
                    return [this.forStmt()];
                case 'while': {
                    this.i++;
                    const test = this.test();
                    const body = this.block();
                    const orelse = this.eatName('else') ? this.block() : [];
                    return [{ k: 'while', test, body, orelse, ...this.pos(t) }];
                }
                case 'def':
                    return [this.defStmt()];
                case 'try':
                    return [this.tryStmt()];
            }
        }
        if (t.t === 'op' && t.v === '@') this.fail('python.syntax.noDecorator');
        return this.simple();
    }

    private simple(): Stmt[] {
        const out: Stmt[] = [this.smallStmt()];
        while (this.eatOp(';')) {
            if (this.tok.t === 'newline' || this.tok.t === 'eof') break;
            out.push(this.smallStmt());
        }
        if (this.tok.t === 'newline') this.i++;
        else if (this.tok.t !== 'eof' && this.tok.t !== 'dedent') this.fail();
        return out;
    }

    private ifStmt(): Stmt {
        const t = this.toks[this.i++];
        const test = this.test();
        const body = this.block();
        let orelse: Stmt[] = [];
        if (this.isName('elif')) orelse = [this.ifStmt()];
        else if (this.eatName('else')) orelse = this.block();
        return { k: 'if', test, body, orelse, ...this.pos(t) };
    }

    private forStmt(): Stmt {
        const t = this.toks[this.i++];
        const target = this.targetList();
        if (!this.eatName('in')) this.fail('python.syntax.expected', this.tok, { what: 'in' });
        const iter = this.testList();
        const body = this.block();
        const orelse = this.eatName('else') ? this.block() : [];
        return { k: 'for', target, iter, body, orelse, ...this.pos(t) };
    }

    private defStmt(): Stmt {
        const t = this.toks[this.i++];
        const name = this.name();
        this.expectOp('(');
        const params = this.params(')');
        this.expectOp(')');
        if (this.eatOp('->')) this.test();
        const body = this.block();
        return { k: 'def', name, params, body, ...this.pos(t) };
    }

    private tryStmt(): Stmt {
        const t = this.toks[this.i++];
        const body = this.block();
        const handlers: Handler[] = [];
        while (this.eatName('except')) {
            let types: Expr | null = null;
            let name: string | null = null;
            if (!this.isOp(':')) {
                types = this.test();
                if (this.eatName('as')) name = this.name();
            }
            handlers.push({ types, name, body: this.block() });
        }
        const orelse = handlers.length && this.eatName('else') ? this.block() : [];
        const final = this.eatName('finally') ? this.block() : [];
        if (!handlers.length && !final.length) this.fail('python.syntax.expected', this.tok, { what: 'except' });
        return { k: 'try', body, handlers, orelse, final, ...this.pos(t) };
    }

    /** Parameters of a def (until `)`) or a lambda (until `:`). */
    private params(end: string): Param[] {
        const out: Param[] = [];
        let kwonly = false;
        while (!this.isOp(end)) {
            if (this.eatOp('**')) {
                out.push({ name: this.name(), def: null, kind: 'dstar' });
            } else if (this.eatOp('*')) {
                if (this.isOp(',') || this.isOp(end)) kwonly = true;
                else {
                    out.push({ name: this.name(), def: null, kind: 'star' });
                    kwonly = true;
                }
            } else if (this.eatOp('/')) {
                // Positional-only marker: every parameter before it is a normal one here.
            } else {
                const name = this.name();
                if (end === ')' && this.eatOp(':')) this.test();
                const def = this.eatOp('=') ? this.test() : null;
                out.push({ name, def, kind: kwonly ? 'kwonly' : 'normal' });
            }
            if (!this.eatOp(',')) break;
        }
        return out;
    }

    private smallStmt(): Stmt {
        const t = this.tok;
        const at = this.pos(t);
        if (t.t === 'name') {
            const bad = NOT_SUPPORTED[t.v];
            if (bad) this.fail(bad);
            switch (t.v) {
                case 'pass':
                case 'break':
                case 'continue':
                    this.i++;
                    return { k: t.v, ...at };
                case 'return': {
                    this.i++;
                    const e = this.atEnd() ? null : this.testList();
                    return { k: 'return', e, ...at };
                }
                case 'import': {
                    this.i++;
                    const names: Array<{ name: string; as: string | null }> = [];
                    do {
                        let name = this.name();
                        while (this.eatOp('.')) name += '.' + this.name();
                        names.push({ name, as: this.eatName('as') ? this.name() : null });
                    } while (this.eatOp(','));
                    return { k: 'import', names, ...at };
                }
                case 'from': {
                    this.i++;
                    let module = this.name();
                    while (this.eatOp('.')) module += '.' + this.name();
                    if (!this.eatName('import')) this.fail('python.syntax.expected', this.tok, { what: 'import' });
                    const names: Array<{ name: string; as: string | null }> = [];
                    if (this.eatOp('*')) names.push({ name: '*', as: null });
                    else {
                        const paren = this.eatOp('(');
                        do {
                            if (paren && this.isOp(')')) break;
                            const name = this.name();
                            names.push({ name, as: this.eatName('as') ? this.name() : null });
                        } while (this.eatOp(','));
                        if (paren) this.expectOp(')');
                    }
                    return { k: 'from', module, names, ...at };
                }
                case 'global':
                case 'nonlocal': {
                    this.i++;
                    const names = [this.name()];
                    while (this.eatOp(',')) names.push(this.name());
                    return { k: t.v, names, ...at };
                }
                case 'del': {
                    this.i++;
                    const targets = [this.orExpr()];
                    while (this.eatOp(',')) targets.push(this.orExpr());
                    return { k: 'del', targets, ...at };
                }
                case 'assert': {
                    this.i++;
                    const test = this.test();
                    const m = this.eatOp(',') ? this.test() : null;
                    return { k: 'assert', test, msg: m, ...at };
                }
                case 'raise': {
                    this.i++;
                    const e = this.atEnd() ? null : this.test();
                    if (this.eatName('from')) this.test();
                    return { k: 'raise', e, ...at };
                }
            }
        }
        const first = this.testListStar();
        if (this.tok.t === 'op' && AUG.has(this.tok.v)) {
            const op = this.toks[this.i++].v.slice(0, -1);
            this.checkTarget(first, false);
            return { k: 'aug', target: first, op, value: this.testList(), ...at };
        }
        if (this.isOp(':') && first.k !== 'tuple') {
            // An annotation: `x: float = 1.0`.
            this.i++;
            this.test();
            if (!this.eatOp('=')) return { k: 'pass', ...at };
            this.checkTarget(first, false);
            return { k: 'assign', targets: [first], value: this.testListStar(), ...at };
        }
        if (this.isOp('=')) {
            const targets = [first];
            let value = first;
            while (this.eatOp('=')) {
                value = this.testListStar();
                targets.push(value);
            }
            targets.pop();
            for (const tg of targets) this.checkTarget(tg, true);
            return { k: 'assign', targets, value, ...at };
        }
        return { k: 'expr', e: first, ...at };
    }

    private atEnd(): boolean {
        const t = this.tok;
        return t.t === 'newline' || t.t === 'eof' || t.t === 'dedent' || (t.t === 'op' && t.v === ';');
    }

    private checkTarget(e: Expr, many: boolean): void {
        switch (e.k) {
            case 'name':
                if (KEYWORDS.has(e.id)) this.failAt(e);
                return;
            case 'attr':
            case 'sub':
                return;
            case 'tuple':
            case 'list':
                if (!many) this.failAt(e, 'python.syntax.badTarget');
                for (const x of e.elts) this.checkTarget(x.k === 'starred' ? x.e : x, true);
                return;
            default:
                this.failAt(e, 'python.syntax.badTarget');
        }
    }

    private failAt(e: Pos, key: MessageKey = 'python.syntax.invalid'): never {
        throw new PyError('SyntaxError', key, {}, e.line, e.col);
    }

    // ---------------------------------------------------------- expressions

    /** Targets of for and comprehensions: `x`, `i, x`, `(a, b)`. */
    private targetList(): Expr {
        const t = this.tok;
        const first = this.starOr();
        if (!this.isOp(',')) {
            this.checkTarget(first, true);
            return first;
        }
        const elts = [first];
        while (this.eatOp(',')) {
            if (this.isName('in') || this.isOp('=')) break;
            elts.push(this.starOr());
        }
        const e: Expr = { k: 'tuple', elts, ...this.pos(t) };
        this.checkTarget(e, true);
        return e;
    }

    private starOr(): Expr {
        const t = this.tok;
        if (this.eatOp('*')) return { k: 'starred', e: this.orExpr(), ...this.pos(t) };
        return this.orExpr();
    }

    /** Expressions with commas (a tuple when there is a comma). */
    testList(): Expr {
        const t = this.tok;
        const first = this.test();
        if (!this.isOp(',')) return first;
        const elts = [first];
        while (this.eatOp(',')) {
            if (this.atEnd() || this.isOp('=') || this.isOp(')') || (this.tok.t === 'op' && AUG.has(this.tok.v)) || this.isOp(':')) break;
            elts.push(this.test());
        }
        return { k: 'tuple', elts, ...this.pos(t) };
    }

    /** Like testList, with *starred items (assignments, return values). */
    private testListStar(): Expr {
        const t = this.tok;
        const first = this.starTest();
        if (!this.isOp(',')) return first;
        const elts = [first];
        while (this.eatOp(',')) {
            if (this.atEnd() || this.isOp('=') || (this.tok.t === 'op' && AUG.has(this.tok.v))) break;
            elts.push(this.starTest());
        }
        return { k: 'tuple', elts, ...this.pos(t) };
    }

    private starTest(): Expr {
        const t = this.tok;
        if (this.eatOp('*')) return { k: 'starred', e: this.orExpr(), ...this.pos(t) };
        return this.test();
    }

    test(): Expr {
        const t = this.tok;
        if (this.isName('lambda')) {
            this.i++;
            const params = this.params(':');
            this.expectOp(':');
            return { k: 'lambda', params, body: this.test(), ...this.pos(t) };
        }
        if (t.t === 'name' && this.peek().t === 'op' && this.peek().v === ':=') {
            this.i += 2;
            return { k: 'walrus', id: t.v, e: this.test(), ...this.pos(t) };
        }
        const body = this.orTest();
        if (this.isName('if') ) {
            this.i++;
            const test = this.orTest();
            if (!this.eatName('else')) this.fail('python.syntax.expected', this.tok, { what: 'else' });
            const orelse = this.test();
            return { k: 'ifexp', test, body, orelse, ...this.pos(t) };
        }
        return body;
    }

    /** A test without a conditional expression (comprehension conditions). */
    private testNoCond(): Expr {
        if (this.isName('lambda')) return this.test();
        return this.orTest();
    }

    private orTest(): Expr {
        const t = this.tok;
        const first = this.andTest();
        if (!this.isName('or')) return first;
        const vals = [first];
        while (this.eatName('or')) vals.push(this.andTest());
        return { k: 'bool', op: 'or', vals, ...this.pos(t) };
    }

    private andTest(): Expr {
        const t = this.tok;
        const first = this.notTest();
        if (!this.isName('and')) return first;
        const vals = [first];
        while (this.eatName('and')) vals.push(this.notTest());
        return { k: 'bool', op: 'and', vals, ...this.pos(t) };
    }

    private notTest(): Expr {
        const t = this.tok;
        if (this.eatName('not')) return { k: 'unary', op: 'not', e: this.notTest(), ...this.pos(t) };
        return this.comparison();
    }

    private comparison(): Expr {
        const t = this.tok;
        const l = this.orExpr();
        const ops: string[] = [];
        const rs: Expr[] = [];
        for (;;) {
            const c = this.tok;
            let op = '';
            if (c.t === 'op' && CMP.has(c.v)) {
                op = c.v;
                this.i++;
            } else if (c.t === 'name' && c.v === 'in') {
                op = 'in';
                this.i++;
            } else if (c.t === 'name' && c.v === 'not' && this.peek().t === 'name' && this.peek().v === 'in') {
                op = 'not in';
                this.i += 2;
            } else if (c.t === 'name' && c.v === 'is') {
                this.i++;
                op = this.eatName('not') ? 'is not' : 'is';
            } else break;
            ops.push(op);
            rs.push(this.orExpr());
        }
        if (!ops.length) return l;
        return { k: 'cmp', l, ops, rs, ...this.pos(t) };
    }

    private binLevel(ops: string[], next: () => Expr): Expr {
        let l = next();
        while (this.tok.t === 'op' && ops.includes(this.tok.v)) {
            const t = this.toks[this.i++];
            const r = next();
            l = { k: 'bin', op: t.v, l, r, ...this.pos(t) };
        }
        return l;
    }

    orExpr(): Expr {
        return this.binLevel(['|'], () => this.xorExpr());
    }

    private xorExpr(): Expr {
        return this.binLevel(['^'], () => this.andExpr());
    }

    private andExpr(): Expr {
        return this.binLevel(['&'], () => this.shiftExpr());
    }

    private shiftExpr(): Expr {
        return this.binLevel(['<<', '>>'], () => this.arith());
    }

    private arith(): Expr {
        return this.binLevel(['+', '-'], () => this.term());
    }

    private term(): Expr {
        return this.binLevel(['*', '/', '//', '%', '@'], () => this.factor());
    }

    private factor(): Expr {
        const t = this.tok;
        if (t.t === 'op' && (t.v === '-' || t.v === '+' || t.v === '~')) {
            this.i++;
            const e = this.factor();
            // A literal number with its sign is still a literal (-1, -2.5j).
            if (t.v === '-' && e.k === 'num') return { ...e, v: -e.v, line: t.line, col: t.col };
            return { k: 'unary', op: t.v, e, ...this.pos(t) };
        }
        return this.power();
    }

    private power(): Expr {
        const base = this.primary();
        if (this.isOp('**')) {
            const t = this.toks[this.i++];
            const r = this.factor();
            return { k: 'bin', op: '**', l: base, r, ...this.pos(t) };
        }
        return base;
    }

    private primary(): Expr {
        let e = this.atom();
        for (;;) {
            const t = this.tok;
            if (this.eatOp('(')) {
                e = { k: 'call', f: e, args: this.callArgs(), ...this.pos(t) };
                this.expectOp(')');
            } else if (this.eatOp('[')) {
                e = { k: 'sub', e, idx: this.subscript(), ...this.pos(t) };
                this.expectOp(']');
            } else if (this.eatOp('.')) {
                if (this.tok.t !== 'name') this.fail('python.syntax.expectedName');
                const name = this.toks[this.i++].v;
                e = { k: 'attr', e, name, ...this.pos(t) };
            } else return e;
        }
    }

    private callArgs(): Arg[] {
        const out: Arg[] = [];
        while (!this.isOp(')')) {
            const t = this.tok;
            if (this.eatOp('**')) out.push({ e: this.test(), star: 2, kw: null });
            else if (this.eatOp('*')) out.push({ e: this.test(), star: 1, kw: null });
            else if (t.t === 'name' && this.peek().t === 'op' && this.peek().v === '=') {
                this.i += 2;
                out.push({ e: this.test(), star: 0, kw: t.v });
            } else {
                const e = this.test();
                if (this.isName('for')) {
                    out.push({ e: this.comprehension('gen', e, null, t), star: 0, kw: null });
                    break;
                }
                out.push({ e, star: 0, kw: null });
            }
            if (!this.eatOp(',')) break;
        }
        return out;
    }

    private subscript(): Expr {
        const t = this.tok;
        const first = this.sliceItem();
        if (!this.isOp(',')) return first;
        const elts = [first];
        while (this.eatOp(',')) {
            if (this.isOp(']')) break;
            elts.push(this.sliceItem());
        }
        return { k: 'tuple', elts, ...this.pos(t) };
    }

    private sliceItem(): Expr {
        const t = this.tok;
        let lo: Expr | null = null;
        if (!this.isOp(':')) {
            lo = this.test();
            if (!this.isOp(':')) return lo;
        }
        this.expectOp(':');
        const hi = this.isOp(':') || this.isOp(']') || this.isOp(',') ? null : this.test();
        let step: Expr | null = null;
        if (this.eatOp(':')) step = this.isOp(']') || this.isOp(',') ? null : this.test();
        return { k: 'slice', lo, hi, step, ...this.pos(t) };
    }

    private comprehension(kind: 'list' | 'set' | 'dict' | 'gen', elt: Expr, val: Expr | null, t: Token): Expr {
        const gens: CompFor[] = [];
        while (this.eatName('for')) {
            const target = this.targetList();
            if (!this.eatName('in')) this.fail('python.syntax.expected', this.tok, { what: 'in' });
            const iter = this.orTest();
            const ifs: Expr[] = [];
            while (this.eatName('if')) ifs.push(this.testNoCond());
            gens.push({ target, iter, ifs });
        }
        return { k: 'comp', kind, elt, val, gens, ...this.pos(t) };
    }

    private atom(): Expr {
        const t = this.tok;
        const at = this.pos(t);
        switch (t.t) {
            case 'num':
                this.i++;
                return { k: 'num', v: t.num ?? NaN, imag: !!t.imag, int: !!t.int, ...at };
            case 'str': {
                const parts: FPart[] = [];
                let plain = true;
                let text = '';
                while (this.tok.t === 'str') {
                    const s = this.toks[this.i++];
                    if (s.f) {
                        plain = false;
                        parts.push(...this.fstring(s));
                    } else {
                        parts.push(s.v);
                        text += s.v;
                    }
                }
                if (plain) return { k: 'str', v: text, ...at };
                return { k: 'fstr', parts, ...at };
            }
            case 'name': {
                const bad = NOT_SUPPORTED[t.v];
                if (bad) this.fail(bad);
                this.i++;
                if (t.v === 'True') return { k: 'const', v: true, ...at };
                if (t.v === 'False') return { k: 'const', v: false, ...at };
                if (t.v === 'None') return { k: 'const', v: null, ...at };
                if (KEYWORDS.has(t.v)) this.fail('python.syntax.invalid', t);
                return { k: 'name', id: t.v, ...at };
            }
            case 'op':
                break;
            case 'newline':
            case 'eof':
                this.fail('python.syntax.unexpectedEnd');
                break;
            default:
                this.fail();
        }
        if (this.eatOp('...')) return { k: 'ellipsis', ...at };
        if (this.eatOp('(')) {
            if (this.eatOp(')')) return { k: 'tuple', elts: [], ...at };
            const first = this.starTest();
            if (this.isName('for')) {
                const e = this.comprehension('gen', first, null, t);
                this.expectOp(')');
                return e;
            }
            if (!this.isOp(',')) {
                this.expectOp(')');
                return first;
            }
            const elts = [first];
            while (this.eatOp(',')) {
                if (this.isOp(')')) break;
                elts.push(this.starTest());
            }
            this.expectOp(')');
            return { k: 'tuple', elts, ...at };
        }
        if (this.eatOp('[')) {
            if (this.eatOp(']')) return { k: 'list', elts: [], ...at };
            const first = this.starTest();
            if (this.isName('for')) {
                const e = this.comprehension('list', first, null, t);
                this.expectOp(']');
                return e;
            }
            const elts = [first];
            while (this.eatOp(',')) {
                if (this.isOp(']')) break;
                elts.push(this.starTest());
            }
            this.expectOp(']');
            return { k: 'list', elts, ...at };
        }
        if (this.eatOp('{')) {
            if (this.eatOp('}')) return { k: 'dict', keys: [], vals: [], ...at };
            if (this.eatOp('**')) {
                const keys: Array<Expr | null> = [null];
                const vals = [this.orExpr()];
                this.dictRest(keys, vals);
                return { k: 'dict', keys, vals, ...at };
            }
            const first = this.starTest();
            if (this.eatOp(':')) {
                const v = this.test();
                if (this.isName('for')) {
                    const e = this.comprehension('dict', first, v, t);
                    this.expectOp('}');
                    return e;
                }
                const keys: Array<Expr | null> = [first];
                const vals = [v];
                this.dictRest(keys, vals);
                return { k: 'dict', keys, vals, ...at };
            }
            if (this.isName('for')) {
                const e = this.comprehension('set', first, null, t);
                this.expectOp('}');
                return e;
            }
            const elts = [first];
            while (this.eatOp(',')) {
                if (this.isOp('}')) break;
                elts.push(this.starTest());
            }
            this.expectOp('}');
            return { k: 'set', elts, ...at };
        }
        return this.fail();
    }

    private dictRest(keys: Array<Expr | null>, vals: Expr[]): void {
        while (this.eatOp(',')) {
            if (this.isOp('}')) break;
            if (this.eatOp('**')) {
                keys.push(null);
                vals.push(this.orExpr());
                continue;
            }
            keys.push(this.test());
            this.expectOp(':');
            vals.push(this.test());
        }
        this.expectOp('}');
    }

    /** The parts of an f-string: its text with escapes read, and its {formula!conv:spec} fields. */
    private fstring(s: Token): FPart[] {
        return readFString(s.v, s.textLine ?? s.line, s.textCol ?? s.col);
    }
}

const KEYWORDS = new Set([
    'False', 'None', 'True', 'and', 'as', 'assert', 'async', 'await', 'break', 'class', 'continue', 'def', 'del', 'elif', 'else', 'except',
    'finally', 'for', 'from', 'global', 'if', 'import', 'in', 'is', 'lambda', 'nonlocal', 'not', 'or', 'pass', 'raise', 'return', 'try',
    'while', 'with', 'yield',
]);

/** Python's keywords (a script cannot name anything after them). */
export function isKeyword(name: string): boolean {
    return KEYWORDS.has(name);
}

function unescape(s: string): string {
    return s.replace(/\\(u[0-9a-fA-F]{4}|x[0-9a-fA-F]{2}|.)/g, (_, e: string) => {
        if (e.length > 1) return String.fromCharCode(parseInt(e.slice(1), 16));
        switch (e) {
            case 'n':
                return '\n';
            case 't':
                return '\t';
            case 'r':
                return '\r';
            case '0':
                return '\0';
            case '\\':
            case "'":
            case '"':
                return e;
            default:
                return '\\' + e;
        }
    });
}

function readFString(raw: string, line: number, col: number): FPart[] {
    const out: FPart[] = [];
    let text = '';
    let i = 0;
    const n = raw.length;
    const fail = (at: number): never => {
        throw new PyError('SyntaxError', 'python.syntax.badFString', {}, line, col + at);
    };
    while (i < n) {
        const c = raw[i];
        if (c === '{' && raw[i + 1] === '{') {
            text += '{';
            i += 2;
            continue;
        }
        if (c === '}' && raw[i + 1] === '}') {
            text += '}';
            i += 2;
            continue;
        }
        if (c === '}') fail(i);
        if (c !== '{') {
            text += c;
            i++;
            continue;
        }
        if (text) out.push(unescape(text));
        text = '';
        // The formula: up to a top-level !, : or } (= before them asks for the debug form).
        const start = i + 1;
        let j = start;
        let depth = 0;
        let quote = '';
        for (; j < n; j++) {
            const ch = raw[j];
            if (quote) {
                if (ch === quote) quote = '';
                continue;
            }
            if (ch === "'" || ch === '"') quote = ch;
            else if (ch === '(' || ch === '[' || ch === '{') depth++;
            else if (ch === ')' || ch === ']' || ch === '}') {
                if (depth === 0) break;
                depth--;
            } else if (depth === 0 && (ch === ':' || (ch === '!' && raw[j + 1] !== '='))) break;
        }
        if (j >= n) fail(i);
        let body = raw.slice(start, j);
        let debug: string | null = null;
        const eq = /=\s*$/.exec(body);
        if (eq && !/[=!<>]=\s*$/.test(body)) {
            debug = body;
            body = body.slice(0, eq.index);
        }
        if (!body.trim()) fail(i);
        const stmts = parseScript(body, line - 1, col + start - 1);
        const first = stmts[0];
        if (stmts.length !== 1 || first.k !== 'expr') fail(i);
        const e = first.k === 'expr' ? first.e : null;
        if (!e) return fail(i);
        let conv = '';
        if (raw[j] === '!') {
            conv = raw[j + 1] ?? '';
            j += 2;
        }
        let spec: FPart[] | null = null;
        if (raw[j] === ':') {
            // The spec runs to the matching }, and may hold {fields} itself.
            let k = j + 1;
            let d = 0;
            for (; k < n; k++) {
                if (raw[k] === '{') d++;
                else if (raw[k] === '}') {
                    if (d === 0) break;
                    d--;
                }
            }
            if (k >= n) fail(j);
            spec = readFString(raw.slice(j + 1, k), line, col + j + 1);
            j = k;
        }
        if (raw[j] !== '}') fail(j);
        out.push({ e, conv, spec, debug });
        i = j + 1;
    }
    if (text) out.push(unescape(text));
    return out;
}
