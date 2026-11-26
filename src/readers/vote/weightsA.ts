/*
 * The weights of design A, the token tagger of the voting readers (6.2.4).
 * Data only, set by hand. A port of the frozen weightsA.mjs (hover-ml
 * readers); its LOG.md has the reasons and the what-if runs.
 * Convention: a role's weights add to +3 when every unit it needs is on; one
 * missing unit takes it to 0 or below; a unit that forbids the role has -6.
 */

/** A unit's weights on the active units of a token, and its bias. */
export type Unit = Record<string, number>;

/** A latch: [name, set units, reset units (or null), the latch that gates the set]. */
export type Latch = [string, string[], string[] | null, string?];

/** The read-out of one kind: its roles, their weights, the switch gate, the pointers. */
export interface KindA {
    roles: string[];
    out: Record<string, Unit>;
    gate: Unit;
    ptr?: Record<string, Unit>;
    /** The cost of a role change (default 0.5). */
    switchCost?: number;
    /** The roles a role may change into (default: any). */
    order?: Record<string, string[]>;
}

const and = (...names: string[]): Unit => Object.fromEntries([...names.map((n): [string, number] => [n, 1]), ['bias', 0.5 - names.length]]);
const anyAnd = (some: string[], also: string[]): Unit => Object.fromEntries([...some.map((n): [string, number] => [n, 1]), ...also.map((n): [string, number] => [n, 1]), ['bias', -0.5 - also.length]]);
const anyOf = (...names: string[]): Unit => Object.fromEntries([...names.map((n): [string, number] => [n, 1]), ['bias', -0.5]]);
const none = (...names: string[]): Unit => Object.fromEntries([...names.map((n): [string, number] => [n, -1]), ['bias', 0.5]]);

/** Layer 1: conjunction units on the input features. A unit is on when its weighted sum is above 0. */
export const CONJ: Array<[string, Unit]> = [
    ['eq0', and('eq', 'd0')],
    ['ea0', anyAnd(['eq', 'approx'], ['d0'])],
    ['rel0', and('rel', 'd0')],
    ['orel0', { rel: 1, d0: 1, eq: -1, approx: -1, mapsto: -1, bias: -1.5 }],
    ['ineq0', and('ineq', 'd0')],
    ['in0', and('in', 'd0')],
    ['to0', and('to', 'd0')],
    ['mapsto0', and('mapsto', 'd0')],
    ['cut0', anyAnd(['wsp', 'log', 'text', 'row'], ['d0'])],
    ['log0', and('log', 'd0')],
    ['tok0', { d0: 1, wsp: -1, log: -1, text: -1, row: -1, bias: -0.5 }],
    ['comma0', anyAnd(['comma', 'semi'], ['d0'])],
    ['colon0', and('colon', 'd0')],
    ['sum0', and('sum', 'd0')],
    ['det0', and('det', 'd0')],
    ['eqBigSub', and('eq', 'bigSub')],
    ['ii0', anyAnd(['ineq', 'in'], ['d0'])],
    ['iiBr', anyAnd(['ineq', 'in'], ['inBr0'])],
    ['prefixOp', { minmax: 1, d0: 1, n_open: -1, bias: -1.5 }],
    ['plain0', { d0: 1, bigScr: -1, minmax: -1, bias: -0.5 }],
    ['defComma', and('comma', 'd0', 'n_name', 'n2_callOpen')],
    ['setOpen0', and('setb', 'open', 'd0')],
    ['setClose0', and('setb', 'close', 'd0')],
    ['ssep', anyAnd(['bar', 'colon', 'semi', 'text'], ['inSet0'])],
    ['setIn', and('in', 'inSet0')],
    ['brOpen0', { open: 1, d0: 1, par: 1, sq: 1, callOpen: -2, bias: -2.5 }],
    ['brClose0', { close: 1, d0: 1, par: 1, sq: 1, callClose: -2, bias: -2.5 }],
    ['brComma', anyAnd(['comma', 'semi'], ['inBr0'])],
    ['matBeg0', anyAnd(['matrixenv', 'vmatrix'], ['beg', 'd0'])],
    ['matEnd0', anyAnd(['matrixenv', 'vmatrix'], ['end', 'd0'])],
    // a bare matrix environment in its own brackets: ( \begin{matrix} ... \end{matrix} )
    ['matBeg1', anyAnd(['matrixenv', 'vmatrix'], ['beg', 'inBr0'])],
    ['matEnd1', anyAnd(['matrixenv', 'vmatrix'], ['end', 'inBr0'])],
    ['afterDet1', and('upper', 'p_det')],
    ['afterDet2', and('upper', 'p_open', 'p2_det')],
    ['epi1', and('name', 'p_opn_epi')],
    ['epi2', and('name', 'p_open', 'p2_opn_epi')],
    ['epi3', and('name', 'n_call', 'inSetAny')],
    ['matHead', and('upper', 'sideStart', 'n_vec')],
    ['vecTail', and('name', 'p_mat', 'sideEnd')],
    ['headSub', and('inSub', 'd0')],
    // a label before a formula: "g: y = 2x + 1" (the colon is the second token)
    ['labelColon', and('colon', 'd0', 'p_name', 'p2_none')],
    // a part that starts as a definition: a name, then a call bracket, an =, a subscript or a prime
    ['defStart', { name: 2, partStart: 2, n_call: 1, n_eq: 1, n_sub: 1, n_prime: 1, n_sup: 1, bias: -4.5 }],
    ['defStartAcc', anyAnd(['acc', 'opn'], ['partStart'])],
];

/** Layer 2: latches [name, set units, reset units, gate latch]. L runs left to right, R right to left. */
export const LATCH_L: Latch[] = [
    ['eq', ['eq0'], ['cut0', 'defComma']],
    ['eq2', ['eq0'], ['cut0', 'defComma'], 'eq'],
    ['ea', ['ea0'], ['cut0', 'defComma']],
    ['ea2', ['ea0'], ['cut0', 'defComma'], 'ea'],
    ['orel', ['orel0'], ['cut0', 'defComma']],
    ['rel', ['rel0'], ['cut0']],
    ['anyTok', ['tok0'], null],
    ['cutAT', ['cut0'], null, 'anyTok'],
    ['log', ['log0'], null],
    ['sum', ['sum0'], ['cut0']],
    ['bseq', ['eqBigSub'], ['sum0']],
    ['relS', ['rel0'], ['cut0'], 'sum'],
    ['relS2', ['rel0'], ['cut0'], 'relS'],
    ['ii', ['ii0', 'iiBr'], ['cut0']],
    ['ineq', ['ineq0'], ['cut0']],
    ['gIneq', ['ineq0'], null],
    ['ineqCut', ['cut0'], null, 'gIneq'],
    ['gEq', ['eq0'], null],
    ['eqCut', ['cut0'], null, 'gEq'],
    ['to', ['to0'], ['cut0']],
    ['mapsto', ['mapsto0'], ['cut0']],
    ['colon', ['colon0'], ['cut0']],
    ['comma', ['comma0'], ['cut0']],
    ['toComma', ['comma0'], ['cut0'], 'to'],
    ['in', ['in0'], ['cut0']],
    ['pre', ['prefixOp'], ['plain0']],
    ['ssep', ['ssep'], ['setOpen0']],
    ['setIn', ['setIn'], ['setOpen0']],
    ['setDone', ['setClose0'], null],
    ['brComma', ['brComma'], ['brOpen0']],
    ['brDone', ['brClose0'], null],
    ['matDone', ['matEnd0', 'matEnd1'], null],
    ['det', ['det0'], ['cut0']],
    ['cut', ['cut0'], null],
    ['pdef', ['defStart', 'defStartAcc'], ['cut0']],
    ['gdef', ['defStart', 'defStartAcc'], null],
];
export const LATCH_R: Latch[] = [
    ['eq', ['eq0'], ['cut0', 'defComma']],
    ['ea', ['ea0'], ['cut0', 'defComma']],
    ['rel', ['rel0'], ['cut0']],
    ['sum', ['sum0'], ['cut0']],
    ['ii', ['ii0', 'iiBr'], ['cut0']],
    ['ineq', ['ineq0'], ['cut0']],
    ['to', ['to0'], ['cut0']],
    ['mapsto', ['mapsto0'], ['cut0']],
    ['colon', ['colon0'], ['cut0']],
    ['in', ['in0'], ['cut0']],
    ['ssep', ['ssep'], ['setClose0']],
    ['cut', ['cut0'], null],
    ['gdef', ['defStart', 'defStartAcc'], null],
    ['label', ['labelColon'], null],
];

/** Layer 2b: conjunction units on the latches. */
export const CONJ2: Array<[string, Unit]> = [
    ['partII', anyOf('L.ii', 'R.ii', 'ii0', 'iiBr')],
    ['partIneq', anyOf('L.ineq', 'R.ineq', 'ineq0')],
    ['partEq', anyOf('L.eq', 'R.eq', 'eq0')],
    ['noEa', none('L.ea', 'R.ea', 'ea0')],
    ['prefScr', and('bigScr', 'L.pre')],
    ['eqSecond', and('eq0', 'L.eq')],
    // the part of a function: a part that starts as a definition; without one in the formula, the first part
    ['inDefPart', anyOf('L.pdef', 'defStart', 'defStartAcc')],
    ['noDef', none('L.gdef', 'R.gdef', 'defStart', 'defStartAcc')],
    ['firstNoDef', { noDef: 1, 'L.cutAT': -1, bias: -0.5 }],
    ['bodyPart', anyOf('inDefPart', 'firstNoDef')],
    ['headArg', { inCall0: 1, 'R.ea': 1, 'L.ea': -1, bias: -1.5 }],
    ['mapVar', and('name', 'd0', 'R.mapsto')],
    ['setNoSep', { inSetAny: 1, 'L.ssep': -1, 'R.ssep': -1, ssep: -1, bias: -0.5 }],
];

/**
 * Read-out helpers. need(a, b): +3 when all of a, b are on, -3 or less when one is off. oneOf(a, b): +3 when one of
 * them is on (the units exclude each other). no(...): -12 for each unit that forbids the role.
 */
const need = (...names: string[]): Unit => Object.fromEntries([...names.map((n): [string, number] => [n, 6]), ['bias', 3 - 6 * names.length]]);
const oneOf = (...names: string[]): Unit => Object.fromEntries([...names.map((n): [string, number] => [n, 6]), ['bias', -3]]);
const no = (...names: string[]): Unit => Object.fromEntries(names.map((n): [string, number] => [n, -12]));
const FIRST_PART = no('L.cutAT', 'cut0');
const NO_LABEL = no('R.label', 'labelColon');
const NO_PREFIX = no('prefixOp', 'prefScr');

/** head = body: function, surface, polar, domain. */
const fnLike = (): KindA => ({
    roles: ['O', 'NAME', 'VAR', 'BODY', 'MORE', 'COND'],
    out: {
        // the name: before the first = of a function's part, outside the call bracket
        NAME: { ...need('R.ea', 'bodyPart'), ...no('L.ea', 'ea0', 'callOpen', 'callClose', 'inCall0', 'cut0', 'R.mapsto'), ...NO_LABEL, ...NO_PREFIX },
        // the variables: inside the call bracket of the head, or before \mapsto
        VAR: { headArg: 6, mapVar: 6, bodyPart: 6, bias: -9, ...no('comma', 'callOpen', 'callClose', 'L.mapsto', 'cut0'), ...NO_LABEL },
        // the body: after the first = (or \mapsto) up to the next relation; or the whole part without =
        BODY: { 'L.ea': 6, noEa: 6, 'L.mapsto': 6, bodyPart: 6, bias: -9, ...no('L.ea2', 'ea0', 'orel0', 'L.orel', 'L.to', 'defComma', 'R.mapsto', 'mapsto0', 'cut0'), ...NO_LABEL, ...NO_PREFIX },
        // the later sides of a chain a = b = c
        MORE: { ...need('L.ea2', 'bodyPart'), ...no('ea0', 'orel0', 'L.orel', 'L.to', 'defComma', 'cut0') },
        // the conditions: a later part with an inequality or a membership, not after a logic sign
        COND: { ...need('L.cutAT', 'partII'), ...no('L.log', 'cut0', 'bodyPart') },
    },
    gate: { d0: 1, inCall0: 1 },
});

/** Layer 3: per kind the roles, their read-out weights, the switch gate and the pointers. */
export const KINDS: Record<string, KindA> = {
    function: fnLike(),
    surface: fnLike(),
    polar: fnLike(),
    domain: fnLike(),
    implicit: {
        roles: ['O', 'EQN'],
        // the equation: the first part with an =, up to its second =
        out: { EQN: { ...need('partEq'), ...no('L.eqCut', 'L.eq2', 'eqSecond', 'cut0'), ...NO_LABEL } },
        gate: { d0: 1 },
    },
    region: {
        roles: ['O', 'COND'],
        // every part with an inequality
        out: { COND: { ...need('partIneq'), ...no('cut0', 'L.log') } },
        gate: { d0: 1 },
    },
    condition: {
        roles: ['O', 'COND'],
        // the first part with an inequality
        out: { COND: { ...need('partIneq'), ...no('L.ineqCut', 'cut0') } },
        gate: { d0: 1 },
        // the variable: a name of that part, no constant, no subscript, no function; x before others, the first one
        ptr: { VAR: { name: 2, partIneq: 1, 'L.ineqCut': -6, const: -3, inSub: -3, n_call: -3, is_x: 0.5, bias: -2.5 } },
    },
    interval: {
        roles: ['O', 'LB', 'LO', 'HI', 'RB'],
        out: {
            LB: { ...need('brOpen0'), ...no('L.brDone') },
            LO: { ...need('inBr0'), ...no('L.brComma', 'brComma', 'L.brDone') },
            HI: { ...need('inBr0', 'L.brComma'), ...no('L.brDone') },
            RB: { ...need('brClose0'), ...no('L.brDone') },
        },
        gate: { d0: 1, inBr0: 1 },
        ptr: { VAR: { name: 1, d0: 1, 'R.in': 2, 'L.rel': -5, 'L.cutAT': -5, bias: -3 } },
    },
    set: {
        roles: ['O', 'VAR', 'SPACE', 'COND'],
        out: {
            VAR: { ...need('inSetAny', 'name', 'R.ssep'), ...no('L.ssep', 'L.setIn', 'L.setDone', 'inSub') },
            SPACE: { ...need('inSetAny', 'L.setIn', 'R.ssep'), ...no('L.ssep', 'ssep', 'L.setDone') },
            COND: { inSetAny: 6, 'L.ssep': 6, setNoSep: 6, bias: -9, ...no('L.setDone') },
        },
        gate: { d0: 1, inSetAny: 1 },
        ptr: { NAME: { name: 1, first: 1, d0: 1, bias: -2.5 } },
    },
    epigraph: { roles: ['O'], out: {}, gate: {}, ptr: { FN: { epi1: 3, epi2: 3, epi3: 1, bias: -0.5 } } },
    jensen: {
        roles: ['O'],
        out: {},
        gate: {},
        ptr: { FN: { name: 1, n_call: 1, first: 1, bias: -2.5 }, W: { weighty: 1, p_minus: 1, p2_one: 1, bias: -2.5 } },
    },
    map: {
        roles: ['O', 'NAME', 'DOM', 'COD'],
        out: {
            NAME: { ...need('R.colon'), ...no('L.colon', 'colon0'), ...FIRST_PART },
            DOM: { ...need('L.colon', 'R.to'), ...no('L.to', 'to0'), ...FIRST_PART },
            COD: { ...need('L.to'), ...no('L.toComma', 'comma0', 'to0'), ...FIRST_PART },
        },
        gate: { d0: 1 },
    },
    matrix: {
        roles: ['O', 'ENV'],
        // every written matrix of the formula; the first square one is taken
        out: { ENV: { ...oneOf('matBeg0', 'matEnd0', 'matBeg1', 'matEnd1'), ...no('vmatrix') } },
        gate: { d0: 1, matBeg1: 1, matEnd1: 1, close: 0 },
        // the name: a capital letter alone before the first =
        ptr: { NAME: { upper: 1, first: 1, n_eq: 1, bias: -2.5 } },
    },
    det: {
        roles: ['O', 'ENV'],
        // a written matrix after \det, or a vmatrix
        out: { ENV: { matBeg0: 3, matEnd0: 3, matBeg1: 3, matEnd1: 3, 'L.det': 3, vmatrix: 3, bias: -3, ...no('L.matDone') } },
        gate: { d0: 1, matBeg1: 1, matEnd1: 1 },
        ptr: { M: { afterDet1: 1, afterDet2: 1, bias: -0.5 } },
    },
    product: {
        roles: ['O'],
        out: {},
        gate: {},
        ptr: { M: { matHead: 1, bias: -0.5 }, V: { vecTail: 1, bias: -0.5 } },
    },
    eigen: {
        roles: ['O'],
        out: {},
        gate: {},
        ptr: { M: { upper: 1, ident: -2, 'L.rel': -2, inSub: -2, inSup: -2, bias: -0.5 }, V: { name: 1, 'R.eq': 1, 'L.rel': -3, upper: -3, inSub: -3, n_eq: 0.2, lambda: -3, bias: -1.5 } },
    },
    recurrence: {
        roles: ['O', 'STEP'],
        out: { STEP: { ...need('L.eq'), ...no('L.eq2', 'eq0', 'L.comma', 'comma0'), ...FIRST_PART } },
        gate: { d0: 1 },
        ptr: { STATE: { name: 1, n_sub: 1, d0: 1, 'L.rel': -3, 'L.cutAT': -3, bias: -2.5 }, INDEX: { inSub: 1, lower: 1, 'R.eq': 1, 'L.rel': -3, 'L.cutAT': -3, bias: -2.5 } },
    },
    sum: {
        roles: ['O', 'INDEX', 'LO', 'HI', 'BODY', 'VALUE'],
        out: {
            INDEX: { ...need('bigSub', 'L.sum'), ...no('L.bseq', 'rel', 'L.relS') },
            LO: { ...need('bigSub', 'L.sum', 'L.bseq'), ...no('rel', 'L.relS') },
            HI: { ...need('bigSup', 'L.sum'), ...no('L.relS') },
            BODY: { ...need('L.sum'), ...no('bigScr', 'L.relS', 'rel0', 'cut0') },
            VALUE: { ...need('L.relS'), ...no('L.relS2', 'rel0', 'cut0') },
        },
        gate: { bias: 1 },
    },
};
