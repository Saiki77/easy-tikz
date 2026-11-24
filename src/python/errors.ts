/*
 * 6.0 P: the problems of a chart script. A PyError has a Python kind
 * (NameError, TypeError, ...), a message in the reader's language (a key of
 * src/i18n/en/python.ts) and the line and column of the script where it
 * happened, so the chart's problem line can say "Line 4 of the script:
 * name 'np' is not defined". Pure: no DOM, no Obsidian.
 */
import { MessageKey, t as msg } from '../i18n';

export class PyError extends Error {
    /** 1-based; 0 = not known yet (the interpreter fills in the spot it was running). */
    line: number;
    col: number;
    /** The block of the chart the line is in (0-based; several python blocks share one run). */
    block = -1;
    /** A budget ran out: no Python code may catch it. */
    readonly budget: boolean;

    constructor(
        readonly kind: string,
        key: MessageKey | null,
        values: Record<string, string | number> = {},
        line = 0,
        col = 0,
        text?: string
    ) {
        super(key ? msg(key, values) : (text ?? ''));
        this.line = line;
        this.col = col;
        this.budget = kind === 'Budget';
    }
}

/** A problem with a message of its own (raise ValueError('...') in a script). */
export function pyErrorText(kind: string, text: string): PyError {
    return new PyError(kind, null, {}, 0, 0, text);
}

export function typeError(key: MessageKey, values: Record<string, string | number> = {}): PyError {
    return new PyError('TypeError', key, values);
}

export function valueError(key: MessageKey, values: Record<string, string | number> = {}): PyError {
    return new PyError('ValueError', key, values);
}

export function indexError(key: MessageKey, values: Record<string, string | number> = {}): PyError {
    return new PyError('IndexError', key, values);
}
