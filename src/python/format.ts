/*
 * 6.0 P: Python's text formatting for chart scripts: format specs
 * (f"{x:.2f}", format(x, '>8'), "{:,}".format(n)), str.format with
 * positional and named fields, and "%.3f" % x. Pure: no DOM, no Obsidian.
 */
import { valueError } from './errors';
import { Kwargs, NDArray, PyComplex, PyDict, PyTuple, PyValue, floatRepr, isNum, repr, str } from './values';

const SPEC = /^(?:(.)?([<>=^]))?([+\- ])?(#)?(0)?(\d+)?([,_])?(?:\.(\d+))?([bcdeEfFgGnosxX%])?$/;

function group(intPart: string, sep: string): string {
    return intPart.replace(/\B(?=(\d{3})+(?!\d))/g, sep);
}

/** A number in a fixed or exponent form as Python writes it (1.5e+03, not 1.5e3). */
function expForm(x: number, digits: number, upper: boolean): string {
    const s = x.toExponential(digits);
    const [m, e] = s.split('e');
    const exp = Number(e);
    const out = `${m}e${exp < 0 ? '-' : '+'}${String(Math.abs(exp)).padStart(2, '0')}`;
    return upper ? out.toUpperCase() : out;
}

function generalForm(x: number, p: number, upper: boolean, alt: boolean): string {
    if (x === 0) return '0';
    const prec = p === 0 ? 1 : p;
    const exp = Math.floor(Math.log10(Math.abs(x)));
    let s: string;
    if (exp < -4 || exp >= prec) {
        s = expForm(x, prec - 1, upper);
        if (!alt) s = s.replace(/\.?0+(?=[eE])/, '');
    } else {
        s = x.toFixed(Math.max(0, prec - 1 - exp));
        if (!alt && s.includes('.')) s = s.replace(/\.?0+$/, '');
    }
    return s;
}

function numberText(x: number, type: string, precision: number | null, alt: boolean, isInt: boolean): string {
    if (Number.isNaN(x)) return type && type === type.toUpperCase() && type !== '%' ? 'NAN' : 'nan';
    if (!Number.isFinite(x)) return (x < 0 ? '-' : '') + (type && type === type.toUpperCase() && type !== '%' ? 'INF' : 'inf');
    switch (type) {
        case 'd':
        case 'n':
            if (!Number.isInteger(x)) throw valueError('python.format.intCode', { code: type });
            return String(x);
        case 'f':
        case 'F':
            return x.toFixed(precision ?? 6);
        case 'e':
        case 'E':
            return expForm(x, precision ?? 6, type === 'E');
        case 'g':
        case 'G':
            return generalForm(x, precision ?? 6, type === 'G', alt);
        case '%':
            return `${(x * 100).toFixed(precision ?? 6)}%`;
        case 'x':
        case 'X':
            return (alt ? '0x' : '') + (type === 'X' ? Math.trunc(x).toString(16).toUpperCase() : Math.trunc(x).toString(16));
        case 'o':
            return (alt ? '0o' : '') + Math.trunc(x).toString(8);
        case 'b':
            return (alt ? '0b' : '') + Math.trunc(x).toString(2);
        case 'c':
            return String.fromCharCode(x);
        default:
            if (precision !== null) return generalForm(x, precision, false, alt);
            return isInt ? String(x) : floatRepr(x);
    }
}

/** format(v, spec). */
export function formatSpec(v: PyValue, spec: string): string {
    if (!spec) return str(v);
    const m = SPEC.exec(spec);
    if (!m) throw valueError('python.format.badSpec', { spec });
    const [, fillChar, alignChar, sign, alt, zero, width, grouping, prec, type = ''] = m;
    const precision = prec !== undefined ? Number(prec) : null;
    let text: string;
    let numeric = false;
    if (v instanceof PyComplex) {
        const re = numberText(v.re, type || 'g', precision, !!alt, false);
        const im = numberText(Math.abs(v.im), type || 'g', precision, !!alt, false);
        text = `${re}${v.im < 0 ? '-' : '+'}${im}j`;
    } else if (isNum(v) || (v instanceof NDArray && v.size === 1)) {
        numeric = true;
        const x = v instanceof NDArray ? v.data[0] : Number(v);
        const isInt = typeof v === 'boolean' || (typeof v === 'number' && Number.isInteger(v) && type === '');
        let body = numberText(Math.abs(x), type, precision, !!alt, isInt);
        if (grouping) {
            const [ip, fp] = body.split('.');
            body = group(ip, grouping) + (fp !== undefined ? '.' + fp : '');
        }
        const neg = x < 0 || Object.is(x, -0);
        const s = neg ? '-' : sign === '+' ? '+' : sign === ' ' ? ' ' : '';
        const w = width ? Number(width) : 0;
        if ((zero || alignChar === '=') && !alignChar && w > s.length + body.length) body = body.padStart(w - s.length, zero ? '0' : (fillChar ?? ' '));
        text = s + body;
    } else {
        text = precision !== null ? str(v).slice(0, precision) : str(v);
    }
    const w = width ? Number(width) : 0;
    if (text.length >= w) return text;
    const fill = fillChar ?? ' ';
    const align = alignChar ?? (numeric ? '>' : '<');
    const pad = w - text.length;
    if (align === '<') return text + fill.repeat(pad);
    if (align === '>' || align === '=') return fill.repeat(pad) + text;
    const left = Math.floor(pad / 2);
    return fill.repeat(left) + text + fill.repeat(pad - left);
}

/** "{} and {name:.2f}".format(...). */
export function strFormat(fmt: string, args: PyValue[], kw: Kwargs | null): string {
    let auto = 0;
    return fmt.replace(/\{\{|\}\}|\{([^{}!:]*)(?:!([rs]))?(?::([^{}]*))?\}/g, (whole, field: string | undefined, conv: string | undefined, spec: string | undefined) => {
        if (whole === '{{') return '{';
        if (whole === '}}') return '}';
        const name = (field ?? '').trim();
        let v: PyValue;
        const head = /^([A-Za-z_]\w*|\d*)((?:\[[^\]]*\]|\.\w+)*)$/.exec(name);
        const base = head ? head[1] : name;
        if (base === '') v = args[auto++] ?? null;
        else if (/^\d+$/.test(base)) v = args[Number(base)] ?? null;
        else v = kw?.get(base) ?? null;
        if (head && head[2]) {
            for (const part of head[2].match(/\[[^\]]*\]|\.\w+/g) ?? []) {
                if (part.startsWith('[')) {
                    const k = part.slice(1, -1);
                    if (Array.isArray(v)) v = v[Number(k)] ?? null;
                    else if (v instanceof PyTuple) v = v.items[Number(k)] ?? null;
                    else if (v instanceof PyDict) v = v.get(/^\d+$/.test(k) ? Number(k) : k) ?? null;
                }
            }
        }
        if (conv === 'r') return formatSpec(repr(v), spec ?? '');
        return formatSpec(v, spec ?? '');
    });
}

/** "%d of %s, %.2f" % (a, b, c). */
export function percentFormat(fmt: string, values: PyValue): string {
    const items = values instanceof PyTuple ? values.items : [values];
    const dict = values instanceof PyDict ? values : null;
    let k = 0;
    return fmt.replace(/%(?:\(([^)]*)\))?([-+ 0#]*)(\d+)?(?:\.(\d+))?([sdifeEgGxXor%])/g, (_w, key: string | undefined, flags: string, width: string | undefined, prec: string | undefined, code: string) => {
        if (code === '%') return '%';
        const v = key !== undefined && dict ? (dict.get(key) ?? null) : (items[k++] ?? null);
        let body: string;
        if (code === 's') body = str(v);
        else if (code === 'r') body = repr(v);
        else {
            const x = isNum(v) ? Number(v) : NaN;
            const c = code === 'i' ? 'd' : code;
            body = numberText(Math.abs(x), c === 'd' ? 'd' : c, prec !== undefined ? Number(prec) : c === 'd' || c === 'x' || c === 'X' || c === 'o' ? null : 6, flags.includes('#'), true);
            if (c === 'd') body = String(Math.trunc(Math.abs(x)));
            const s = x < 0 ? '-' : flags.includes('+') ? '+' : flags.includes(' ') ? ' ' : '';
            const w = width ? Number(width) : 0;
            if (flags.includes('0') && !flags.includes('-') && w > s.length + body.length) body = body.padStart(w - s.length, '0');
            body = s + body;
        }
        const w = width ? Number(width) : 0;
        if (body.length < w) body = flags.includes('-') ? body.padEnd(w) : body.padStart(w);
        return body;
    });
}
