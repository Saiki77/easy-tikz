/*
 * 6.0 P: the syntax tree of a chart script. Every node keeps its line and
 * column for problems. Pure: no DOM, no Obsidian.
 */

export interface Pos {
    line: number;
    col: number;
}

export type Expr =
    | ({ k: 'num'; v: number; imag: boolean; int: boolean } & Pos)
    | ({ k: 'str'; v: string } & Pos)
    | ({ k: 'fstr'; parts: FPart[] } & Pos)
    | ({ k: 'name'; id: string } & Pos)
    | ({ k: 'const'; v: true | false | null } & Pos)
    | ({ k: 'list' | 'tuple' | 'set'; elts: Expr[] } & Pos)
    | ({ k: 'dict'; keys: Array<Expr | null>; vals: Expr[] } & Pos)
    | ({ k: 'comp'; kind: 'list' | 'set' | 'dict' | 'gen'; elt: Expr; val: Expr | null; gens: CompFor[] } & Pos)
    | ({ k: 'bin'; op: string; l: Expr; r: Expr } & Pos)
    | ({ k: 'unary'; op: string; e: Expr } & Pos)
    | ({ k: 'bool'; op: 'and' | 'or'; vals: Expr[] } & Pos)
    | ({ k: 'cmp'; l: Expr; ops: string[]; rs: Expr[] } & Pos)
    | ({ k: 'ifexp'; test: Expr; body: Expr; orelse: Expr } & Pos)
    | ({ k: 'lambda'; params: Param[]; body: Expr } & Pos)
    | ({ k: 'call'; f: Expr; args: Arg[] } & Pos)
    | ({ k: 'attr'; e: Expr; name: string } & Pos)
    | ({ k: 'sub'; e: Expr; idx: Expr } & Pos)
    | ({ k: 'slice'; lo: Expr | null; hi: Expr | null; step: Expr | null } & Pos)
    | ({ k: 'starred'; e: Expr } & Pos)
    | ({ k: 'walrus'; id: string; e: Expr } & Pos)
    | ({ k: 'ellipsis' } & Pos);

/** A piece of an f-string: text, or a formula with its conversion (!r) and format spec. */
export type FPart = string | { e: Expr; conv: string; spec: FPart[] | null; debug: string | null };

export interface CompFor {
    target: Expr;
    iter: Expr;
    ifs: Expr[];
}

export interface Arg {
    e: Expr;
    /** `*args` (1) or `**kwargs` (2). */
    star: 0 | 1 | 2;
    kw: string | null;
}

export interface Param {
    name: string;
    def: Expr | null;
    /** normal, *args, **kwargs, keyword only (after *). */
    kind: 'normal' | 'star' | 'dstar' | 'kwonly';
}

export interface Handler {
    types: Expr | null;
    name: string | null;
    body: Stmt[];
}

export type Stmt =
    | ({ k: 'expr'; e: Expr } & Pos)
    | ({ k: 'assign'; targets: Expr[]; value: Expr } & Pos)
    | ({ k: 'aug'; target: Expr; op: string; value: Expr } & Pos)
    | ({ k: 'if'; test: Expr; body: Stmt[]; orelse: Stmt[] } & Pos)
    | ({ k: 'for'; target: Expr; iter: Expr; body: Stmt[]; orelse: Stmt[] } & Pos)
    | ({ k: 'while'; test: Expr; body: Stmt[]; orelse: Stmt[] } & Pos)
    | ({ k: 'break' | 'continue' | 'pass' } & Pos)
    | ({ k: 'def'; name: string; params: Param[]; body: Stmt[] } & Pos)
    | ({ k: 'return'; e: Expr | null } & Pos)
    | ({ k: 'import'; names: Array<{ name: string; as: string | null }> } & Pos)
    | ({ k: 'from'; module: string; names: Array<{ name: string; as: string | null }> } & Pos)
    | ({ k: 'global' | 'nonlocal'; names: string[] } & Pos)
    | ({ k: 'del'; targets: Expr[] } & Pos)
    | ({ k: 'assert'; test: Expr; msg: Expr | null } & Pos)
    | ({ k: 'raise'; e: Expr | null } & Pos)
    | ({ k: 'try'; body: Stmt[]; handlers: Handler[]; orelse: Stmt[]; final: Stmt[] } & Pos);
