/*
 * The weights of design B of the voting readers (6.2.4), the structure
 * network: data only, set by hand (hover-ml readers, LOG.md). A port of the
 * frozen weightsB.mjs. A query: role, the role whose node gives the scope,
 * the scope, the weights (or alternatives: the best counts).
 */

/** Weights on unit names, and a bias. */
export type WeightsB = Record<string, number>;

/** One role query: the node of role `in` gives the scope; mode one (the best node), all, run, or each (one per base node). */
export interface QueryB {
    role: string;
    in: string;
    scope: string;
    w: WeightsB | WeightsB[];
    mode?: string;
    need?: boolean;
}

/** The role queries of a kind, in order. */
export interface KindB {
    queries: QueryB[];
}

const and = (...names: string[]): WeightsB => Object.fromEntries([...names.map((n): [string, number] => [n, 1]), ['bias', 0.5 - names.length] as [string, number]]);
const anyAnd = (any: string[], also: string[]): WeightsB => Object.fromEntries([...any.map((n): [string, number] => [n, 1]), ...also.map((n): [string, number] => [n, 1]), ['bias', -0.5 - also.length] as [string, number]]);
const but = (w: WeightsB, ...not: string[]): WeightsB => ({ ...w, ...Object.fromEntries(not.map((n): [string, number] => [n, -3])) });
const q = (role: string, inRole: string, scope: string, w: WeightsB | WeightsB[], more: Partial<QueryB> = {}): QueryB => ({ role, in: inRole, scope, w, ...more });
const NEED = { need: true };
const ALL = { mode: 'all' };
const EACH = { mode: 'each' };

/** The units of a node type: [unit, node type, weights on the node's own units and on its children's units by place]. */
export const UP: Array<[string, string, WeightsB]> = [
    ['startsSum', 'side', and('k0.sum')],
    ['nameOnly', 'side', and('len1', 'k0.name')],
    ['upperOnly', 'side', and('len1', 'k0.upper')],
    ['callHead', 'side', and('len2', 'k0.name', 'k1.par')],
    ['lowerName', 'atom', but(and('name'), 'upper', 'hasSup')],
    ['matVec2', 'side', and('len2', 'k0.upper', 'k1.lowerName')],
    ['matVec3', 'side', and('len3p', 'k0.upper', 'k1.cdot', 'k2.lowerName', 'kL.lowerName')],
    ['defStmt', 'stmt', anyAnd(['k0.callHead', 'k0.nameOnly'], ['rel0_eq'])],
    ['defStmtA', 'stmt', anyAnd(['k0.callHead', 'k0.nameOnly'], ['rel0_approx'])],
    ['partEq', 'part', and('k*.hasEq')],
    ['pDef', 'part', { 'k0.rel0_eq': 1, 'k0.rel0_approx': 1, 'k0.rel0_mapsto': 1, bias: -0.5 }],
    ['partIneq', 'part', and('k*.hasIneq')],
    ['condSet', 'grp', and('setb', 'k0.partIneq')],
    ['subName', 'atom', and('name', 'hasSub')],
    ['recHead', 'side', and('len1', 'k0.subName')],
    ['recStmt', 'stmt', and('k0.recHead', 'rel0_eq')],
    ['nameStmt', 'stmt', and('rels0', 'k0.nameOnly')],
];

/** Pooled units: on when the node or any node below it has one of the source units. */
export const POOL: Array<[string, string[]]> = [
    ['anySum', ['sum']],
    ['anyII', ['hasIneq', 'hasIn']],
    ['anyEnv', ['matrixenv']],
];

/**
 * head = body: function, surface, polar, domain. Every statement that defines something (lhs = rhs, v \mapsto rhs)
 * is a function candidate; without one, the first statement is the body.
 */
const fnLike = (): KindB => ({
    queries: [
        q('DEFS', 'ROOT', 'stmts', [and('rel0_eq'), and('rel0_approx'), and('rel0_mapsto')], ALL),
        q('BARE', 'ROOT', 'stmts', [but(and('rels0', 'pos0', 'alone'), 'left:DEFS', 'right:DEFS'), but(and('rel0_to', 'pos0', 'alone'), 'left:DEFS', 'right:DEFS')]),
        q('FSTMT', 'ROOT', 'stmts', [and('is:DEFS'), and('is:BARE')], { mode: 'all', need: true }),
        q('HEAD', 'FSTMT', 'kids', [and('pos0', 'relA_eq'), and('pos0', 'relA_approx'), and('pos0', 'relA_mapsto')], EACH),
        q('BODY', 'FSTMT', 'kids', [and('pos1', 'relB_eq'), and('pos1', 'relB_approx'), and('pos1', 'relB_mapsto'), and('only'), and('pos0', 'relA_to')], { mode: 'each', need: true }),
        q('HARGS', 'HEAD', 'kids', but(and('posL', 'par', 'callArg'), 'pos0'), EACH),
        q('CONDP', 'ROOT', 'kids', but(and('part', 'anyII'), 'lead_log', 'pos0', 'pDef'), ALL),
    ],
});

/** The role queries of every kind, in order. */
export const KINDS: Record<string, KindB> = {
    function: fnLike(),
    surface: fnLike(),
    polar: fnLike(),
    domain: fnLike(),
    implicit: {
        queries: [q('PART', 'ROOT', 'kids', and('part', 'partEq'), NEED), q('STMT', 'PART', 'kids', and('hasEq'), NEED), q('LEFT', 'STMT', 'kids', and('pos0'), NEED), q('RIGHT', 'STMT', 'kids', and('pos1'), NEED)],
    },
    region: {
        queries: [q('CONDS', 'ROOT', 'stmts', and('hasIneq'), { mode: 'all', need: true }), q('LISTVAR', 'ROOT', 'stmts', and('nameStmt', 'prev:CONDS'), ALL)],
    },
    condition: {
        queries: [q('COND', 'ROOT', 'stmts', and('hasIneq'), NEED), q('VARNODE', 'COND', 'desc', { atom: 1, name: 1, const: -2, callee: -2, inScript: -2, is_x: 0.5, bias: -1.5 })],
    },
    interval: {
        queries: [
            q('IV', 'ROOT', 'desc', { grp: 1, items2: 1, par: 1, sq: 1, callArg: -3, transposed: -3, inScript: -3, bias: -2.5 }, NEED),
            q('IVPART', 'IV', 'kids', { bias: 1 }, NEED),
            q('LO', 'IVPART', 'kids', and('pos0'), NEED),
            q('HI', 'IVPART', 'kids', and('pos1'), NEED),
            q('IVS', 'IV', 'parent', { bias: 1 }),
            q('VSIDE', 'IVS', 'siblings', and('prev:IVS', 'relA_in', 'nameOnly')),
        ],
    },
    set: {
        queries: [
            q('SET', 'ROOT', 'desc', [and('grp', 'setb', 'builder'), and('grp', 'setb', 'condSet')], NEED),
            q('INNER', 'SET', 'kids', { bias: 1 }, NEED),
            q('HEADP', 'INNER', 'kids', and('pos0', 'part')),
            q('CONDB', 'INNER', 'kids', and('pos1', 'part')),
            q('CONDW', 'SET', 'kids', and('part')),
            q('HEADSTMT', 'HEADP', 'kids', and('pos0')),
            q('VARSIDE', 'HEADSTMT', 'kids', and('pos0')),
            q('SPACE', 'HEADSTMT', 'kids', and('relB_in')),
        ],
    },
    epigraph: {
        queries: [q('EPI', 'ROOT', 'desc', and('opn_epi')), q('FN1', 'ROOT', 'desc', and('atom', 'name', 'right:EPI')), q('SET', 'ROOT', 'desc', and('grp', 'setb', 'builder')), q('FN2', 'SET', 'desc', and('atom', 'name', 'callee'))],
    },
    jensen: {
        queries: [q('FN', 'ROOT', 'desc', and('atom', 'name', 'callee'), NEED), q('W', 'ROOT', 'desc', and('atom', 'weighty', 'prevS.minus'), NEED)],
    },
    map: {
        queries: [
            q('STMT', 'ROOT', 'stmts', and('hasTo'), NEED),
            q('HSIDE', 'STMT', 'kids', and('pos0', 'relA_to'), NEED),
            q('COD', 'STMT', 'kids', and('pos1', 'relB_to'), NEED),
            q('COLON', 'HSIDE', 'kids', and('k_sep'), NEED),
            q('NAME', 'HSIDE', 'kids', and('before:COLON'), { mode: 'run', need: true }),
            q('DOM', 'HSIDE', 'kids', and('after:COLON'), { mode: 'run', need: true }),
        ],
    },
    matrix: {
        queries: [
            q('ENV', 'ROOT', 'desc', { env: 1, matrixenv: 1, solo: 1, square: 0.5, vmatrix: -3, column: -3, inScript: -3, bias: -2.5 }, NEED),
            q('ES', 'ENV', 'parent', { bias: 1 }),
            q('NSIDE', 'ES', 'siblings', and('before:ES', 'pos0', 'relA_eq', 'upperOnly')),
        ],
    },
    det: {
        queries: [
            q('ENV', 'ROOT', 'desc', [and('env', 'matrixenv', 'prevS.det'), and('env', 'vmatrix')]),
            q('M1', 'ROOT', 'desc', and('atom', 'upper', 'prevS.det')),
            q('DARG', 'ROOT', 'desc', and('grp', 'par', 'prevS.det')),
            q('M2', 'DARG', 'desc', and('atom', 'upper')),
        ],
    },
    product: {
        queries: [q('PSIDE', 'ROOT', 'desc', [and('side', 'matVec2'), and('side', 'matVec3')], NEED), q('M', 'PSIDE', 'kids', and('pos0'), NEED), q('V', 'PSIDE', 'kids', and('posL'), NEED)],
    },
    eigen: {
        queries: [
            q('STMT', 'ROOT', 'stmts', and('hasEq'), NEED),
            q('ESIDE', 'STMT', 'kids', and('pos0'), NEED),
            q('M', 'ESIDE', 'desc', { atom: 1, upper: 1, ident: -3, inScript: -3, bias: -1.5 }, NEED),
            q('V', 'ESIDE', 'kids', and('posL', 'lowerName'), NEED),
        ],
    },
    recurrence: {
        queries: [
            q('STMT', 'ROOT', 'stmts', and('recStmt'), NEED),
            q('HSIDE', 'STMT', 'kids', and('pos0'), NEED),
            q('HATOM', 'HSIDE', 'kids', and('pos0'), NEED),
            q('HSUB', 'HATOM', 'sub', { bias: 1 }, NEED),
            q('INDEX', 'HSUB', 'desc', and('atom', 'k_let', 'lower'), NEED),
            q('STEP', 'STMT', 'kids', and('pos1'), NEED),
        ],
    },
    sum: {
        queries: [
            q('PART', 'ROOT', 'kids', and('part', 'anySum'), NEED),
            q('STMT', 'PART', 'kids', and('anySum'), NEED),
            q('SIDE', 'STMT', 'kids', and('startsSum'), NEED),
            q('VALUE', 'STMT', 'kids', and('next:SIDE')),
            q('BIG', 'SIDE', 'kids', and('sum', 'pos0'), NEED),
            q('BODY', 'SIDE', 'kids', and('after:BIG'), { mode: 'run', need: true }),
            q('LOPART', 'BIG', 'sub', { bias: 1 }, NEED),
            q('LOSTMT', 'LOPART', 'kids', and('hasEq', 'pos0'), NEED),
            q('INDEX', 'LOSTMT', 'kids', and('pos0'), NEED),
            q('LO', 'LOSTMT', 'kids', and('pos1'), NEED),
            q('HI', 'BIG', 'sup', { bias: 1 }, NEED),
        ],
    },
};
