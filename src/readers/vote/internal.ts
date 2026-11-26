/*
 * The internal parse of the voting readers (6.2.4): what one design (A, B
 * or C) reads in a formula for a card kind, the roles as canonical TeX.
 * adapt.ts turns it into the parses of src/readers/types.ts. A kind uses
 * only some fields; a missing role is null or absent, as the design leaves it.
 */

/** One statement of the function family: name(args) = body = more[0] = ..., and what stood before it. */
export interface FnRead {
    name: string | null;
    args: string[];
    body: string;
    /** The later sides of a chain a = b = c. */
    more?: string[];
    /** What stands before the statement: a comma, a logic sign, a cut (wsp, text, row), or nothing. */
    sep?: string | null;
}

/** The internal parse of a design for a kind. */
export interface Internal {
    // function, surface, polar, domain; region (conditions)
    fns?: FnRead[];
    conditions?: string[];
    // implicit
    equation?: string | null;
    // set, condition
    condition?: string | null;
    variable?: string | null;
    variables?: (string | null)[];
    space?: string | null;
    // interval
    left?: string | null;
    lo?: string | null;
    hi?: string | null;
    right?: string | null;
    // jensen, epigraph
    fn?: string | null;
    weight?: string | null;
    // map, matrix, det
    name?: string | null;
    domain?: string | null;
    codomain?: string | null;
    entries?: string[][] | null;
    factor?: string | null;
    // product, eigen
    matrix?: string | null;
    vector?: string | null;
    // recurrence
    state?: string | null;
    index?: string | null;
    headSub?: string | null;
    step?: string | null;
    // sum
    body?: string | null;
    rhs?: string | null;
}
