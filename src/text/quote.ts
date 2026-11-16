/*
 * Quoted text in chart lines (5.2.1): `"..."` holds JSON escapes (\" \\ \n \t
 * \uXXXX ...), except that a backslash before two or more letters starts a
 * LaTeX command and stays as written: "$\theta$" is $\theta$ (JSON reads \t
 * as a tab), "$\frac{1}{2}$" keeps its \f, "\textbf{A}" its \t. A doubled
 * backslash is one backslash, so text written before ("$\\theta$") reads the
 * same. Other pairs JSON does not know (\, \{ \$ ...) are kept as written
 * instead of failing. Labels and titles draw no line breaks, so a line break
 * right before letters (\nabla, \neq) needs no JSON reading.
 */

const ESCAPES: Readonly<Record<string, string>> = { '"': '"', '\\': '\\', '/': '/', b: '\b', f: '\f', n: '\n', r: '\r', t: '\t' };
const SHORT: Readonly<Record<string, string>> = { '\b': 'b', '\f': 'f', '\n': 'n', '\r': 'r', '\t': 't' };
/** Characters after a backslash that both sides keep as a pair: LaTeX spacing, braces, signs and delimiters. */
const PAIR = /[ !#$%&'()*+,\-.:;<=>?@[\]^_`{|}~]/;

const isLetter = (c: string | undefined): boolean => c !== undefined && /[A-Za-z]/.test(c);

/** The text between the quotes of a quoted string (the quotes left off), unescaped. */
export function unquote(body: string): string {
    let out = '';
    let i = 0;
    while (i < body.length) {
        const c = body[i];
        if (c !== '\\') {
            out += c;
            i++;
            continue;
        }
        const next = body[i + 1];
        if (next === undefined) {
            out += c;
            i++;
        } else if (isLetter(next) && isLetter(body[i + 2])) {
            // \theta, \nabla, \frac, \textbf: the backslash stays, the letters follow as they are.
            out += c;
            i++;
        } else if (next in ESCAPES) {
            out += ESCAPES[next];
            i += 2;
        } else if (next === 'u' && /^[0-9a-fA-F]{4}$/.test(body.slice(i + 2, i + 6))) {
            out += String.fromCharCode(parseInt(body.slice(i + 2, i + 6), 16));
            i += 6;
        } else {
            out += c + next;
            i += 2;
        }
    }
    return out;
}

/** `s` in quotes, so that unquote() reads it back the same: LaTeX commands keep one backslash. */
export function quote(s: string): string {
    let out = '';
    let i = 0;
    while (i < s.length) {
        const c = s[i];
        const code = c.charCodeAt(0);
        if (c === '\\') {
            const next = s[i + 1];
            if (isLetter(next) && isLetter(s[i + 2])) {
                out += c;
                i++;
            } else if (next !== undefined && PAIR.test(next)) {
                out += c + next;
                i += 2;
            } else {
                out += '\\\\';
                i++;
            }
        } else if (c === '"') {
            out += '\\"';
            i++;
        } else if (code < 0x20 || code === 0x7f || code === 0x2028 || code === 0x2029) {
            // A short escape right before a letter would read as a command (\n before abla): there the long form.
            out += SHORT[c] && !isLetter(s[i + 1]) ? `\\${SHORT[c]}` : `\\u${code.toString(16).padStart(4, '0')}`;
            i++;
        } else {
            out += c;
            i++;
        }
    }
    return `"${out}"`;
}
