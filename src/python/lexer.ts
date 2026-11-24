/*
 * 6.0 P: the tokens of a chart script (a Python subset): names, numbers
 * (1_000, 0x1f, 1.5e3, 2j), strings ('...', "...", triple quotes, r and f
 * prefixes), operators, and the line structure Python reads from
 * indentation: NEWLINE, INDENT and DEDENT. Lines join inside brackets and
 * after a backslash. Pure: no DOM, no Obsidian.
 */
import { PyError } from './errors';

export type TokKind = 'name' | 'num' | 'str' | 'op' | 'newline' | 'indent' | 'dedent' | 'eof';

export interface Token {
    t: TokKind;
    /** The name, the operator, or the string's text (escapes read). */
    v: string;
    /** 1-based line and column in the script. */
    line: number;
    col: number;
    /** Numbers: the value, and whether it is imaginary (2j) or a whole number. */
    num?: number;
    imag?: boolean;
    int?: boolean;
    /** Strings: an f-string (v is its raw text between the quotes), and where its text starts. */
    f?: boolean;
    textLine?: number;
    textCol?: number;
}

const OPS3 = ['**=', '//=', '>>=', '<<=', '...'];
const OPS2 = ['**', '//', '==', '!=', '<=', '>=', '+=', '-=', '*=', '/=', '%=', '@=', '&=', '|=', '^=', '->', '<<', '>>', ':='];
const OPS1 = '+-*/%@<>=()[]{},:.;&|^~';

const isNameStart = (c: string) => /[A-Za-z_À-￿]/.test(c);
const isNameChar = (c: string) => /[A-Za-z0-9_À-￿]/.test(c);

/** The tokens of a script; throws PyError (SyntaxError) with line and column. */
export function tokenize(src: string): Token[] {
    const out: Token[] = [];
    const indents: number[] = [0];
    let depth = 0;
    let i = 0;
    let line = 1;
    let lineStart = 0;
    let atLineStart = true;
    const n = src.length;
    const col = () => i - lineStart + 1;
    const fail = (key: 'python.syntax.badChar' | 'python.syntax.unclosedString' | 'python.syntax.badIndent' | 'python.syntax.badNumber', at: number = col(), values: Record<string, string> = {}): never => {
        throw new PyError('SyntaxError', key, values, line, at);
    };

    while (i < n || atLineStart) {
        if (atLineStart) {
            atLineStart = false;
            // Measure the indent; blank lines and comment lines do not count.
            let w = 0;
            let j = i;
            while (j < n && (src[j] === ' ' || src[j] === '\t')) {
                w += src[j] === '\t' ? 8 - (w % 8) : 1;
                j++;
            }
            if (j >= n) {
                i = j;
                break;
            }
            if (src[j] === '\n' || src[j] === '\r' || src[j] === '#') {
                i = j;
                // Skip to the end of the line.
                while (i < n && src[i] !== '\n' && src[i] !== '\r') i++;
                if (i < n) {
                    i += src[i] === '\r' && src[i + 1] === '\n' ? 2 : 1;
                    line++;
                    lineStart = i;
                    atLineStart = true;
                }
                continue;
            }
            i = j;
            if (depth === 0) {
                const top = indents[indents.length - 1];
                if (w > top) {
                    indents.push(w);
                    out.push({ t: 'indent', v: '', line, col: 1 });
                } else if (w < top) {
                    while (indents.length > 1 && w < indents[indents.length - 1]) {
                        indents.pop();
                        out.push({ t: 'dedent', v: '', line, col: 1 });
                    }
                    if (w !== indents[indents.length - 1]) fail('python.syntax.badIndent', 1);
                }
            }
        }
        if (i >= n) break;
        const c = src[i];
        if (c === ' ' || c === '\t' || c === '\f') {
            i++;
            continue;
        }
        if (c === '#') {
            while (i < n && src[i] !== '\n' && src[i] !== '\r') i++;
            continue;
        }
        if (c === '\\' && (src[i + 1] === '\n' || src[i + 1] === '\r')) {
            i += src[i + 1] === '\r' && src[i + 2] === '\n' ? 3 : 2;
            line++;
            lineStart = i;
            continue;
        }
        if (c === '\n' || c === '\r') {
            if (depth === 0 && out.length && out[out.length - 1].t !== 'newline') out.push({ t: 'newline', v: '', line, col: col() });
            i += c === '\r' && src[i + 1] === '\n' ? 2 : 1;
            line++;
            lineStart = i;
            if (depth === 0) atLineStart = true;
            continue;
        }
        const startCol = col();
        // Strings, with their prefixes.
        const pre = /^([rRfFbBuU]{0,2})(['"])/.exec(src.slice(i, i + 3));
        if (pre && (pre[1] === '' || /^(?:r|f|b|u|rf|fr|rb|br)$/i.test(pre[1]))) {
            const prefix = pre[1].toLowerCase();
            const quote = pre[2];
            i += pre[1].length;
            const triple = src.startsWith(quote.repeat(3), i);
            const q = triple ? quote.repeat(3) : quote;
            i += q.length;
            const textLine = line;
            const textCol = col();
            let text = '';
            for (;;) {
                if (i >= n) fail('python.syntax.unclosedString', startCol);
                if (src.startsWith(q, i)) {
                    i += q.length;
                    break;
                }
                const ch = src[i];
                if ((ch === '\n' || ch === '\r') && !triple) fail('python.syntax.unclosedString', startCol);
                if (ch === '\\' && !prefix.includes('r') && !prefix.includes('f')) {
                    const e = src[i + 1];
                    i += 2;
                    switch (e) {
                        case 'n':
                            text += '\n';
                            break;
                        case 't':
                            text += '\t';
                            break;
                        case 'r':
                            text += '\r';
                            break;
                        case '0':
                            text += '\0';
                            break;
                        case '\\':
                            text += '\\';
                            break;
                        case "'":
                            text += "'";
                            break;
                        case '"':
                            text += '"';
                            break;
                        case '\n':
                            line++;
                            lineStart = i;
                            break;
                        case 'u': {
                            const hex = src.slice(i, i + 4);
                            if (/^[0-9a-fA-F]{4}$/.test(hex)) {
                                text += String.fromCharCode(parseInt(hex, 16));
                                i += 4;
                            } else text += '\\u';
                            break;
                        }
                        case 'x': {
                            const hex = src.slice(i, i + 2);
                            if (/^[0-9a-fA-F]{2}$/.test(hex)) {
                                text += String.fromCharCode(parseInt(hex, 16));
                                i += 2;
                            } else text += '\\x';
                            break;
                        }
                        default:
                            text += '\\' + (e ?? '');
                    }
                    continue;
                }
                if (ch === '\\' && prefix.includes('f') && !prefix.includes('r')) {
                    // f-strings keep escapes for their own reader, but a quote after a backslash is no end.
                    text += ch + (src[i + 1] ?? '');
                    i += 2;
                    continue;
                }
                if (ch === '\n' || ch === '\r') {
                    text += '\n';
                    i += ch === '\r' && src[i + 1] === '\n' ? 2 : 1;
                    line++;
                    lineStart = i;
                    continue;
                }
                text += ch;
                i++;
            }
            const tok: Token = { t: 'str', v: text, line: textLine, col: startCol };
            if (prefix.includes('f')) {
                tok.f = true;
                tok.textLine = textLine;
                tok.textCol = textCol;
            }
            out.push(tok);
            continue;
        }
        if (isNameStart(c)) {
            let j = i + 1;
            while (j < n && isNameChar(src[j])) j++;
            out.push({ t: 'name', v: src.slice(i, j), line, col: startCol });
            i = j;
            continue;
        }
        if (/[0-9]/.test(c) || (c === '.' && /[0-9]/.test(src[i + 1] ?? ''))) {
            const m = /^(?:0[xX][0-9a-fA-F_]+|0[oO][0-7_]+|0[bB][01_]+|(?:[0-9][0-9_]*)?\.?[0-9_]*(?:[eE][+-]?[0-9_]+)?)([jJ]?)/.exec(src.slice(i));
            const text = m ? m[0] : '';
            if (!text) fail('python.syntax.badNumber');
            const imag = !!m && m[1] !== '';
            const body = (imag ? text.slice(0, -1) : text).replace(/_/g, '');
            let value: number;
            let isInt = false;
            if (/^0[xX]/.test(body)) {
                value = parseInt(body.slice(2), 16);
                isInt = true;
            } else if (/^0[oO]/.test(body)) {
                value = parseInt(body.slice(2), 8);
                isInt = true;
            } else if (/^0[bB]/.test(body)) {
                value = parseInt(body.slice(2), 2);
                isInt = true;
            } else {
                value = Number(body);
                isInt = /^[0-9]+$/.test(body);
            }
            if (!Number.isFinite(value) && !/[eE]/.test(body)) fail('python.syntax.badNumber');
            i += text.length;
            if (i < n && isNameStart(src[i])) fail('python.syntax.badNumber', startCol);
            out.push({ t: 'num', v: text, line, col: startCol, num: value, imag, int: isInt && !imag });
            continue;
        }
        const three = src.slice(i, i + 3);
        const two = src.slice(i, i + 2);
        let op = '';
        if (OPS3.includes(three)) op = three;
        else if (OPS2.includes(two)) op = two;
        else if (OPS1.includes(c)) op = c;
        if (!op) fail('python.syntax.badChar', startCol, { char: c });
        if (op === '(' || op === '[' || op === '{') depth++;
        else if ((op === ')' || op === ']' || op === '}') && depth > 0) depth--;
        out.push({ t: 'op', v: op, line, col: startCol });
        i += op.length;
    }
    if (out.length && out[out.length - 1].t !== 'newline') out.push({ t: 'newline', v: '', line, col: col() });
    while (indents.length > 1) {
        indents.pop();
        out.push({ t: 'dedent', v: '', line, col: 1 });
    }
    out.push({ t: 'eof', v: '', line, col: col() });
    return out;
}
