/*
 * A small PNG encoder (6.0 E) for the pictures of coloured planes: the
 * export writes them beside the .tex file and the SVG files embed them. No
 * Node modules and no DOM (the plugin runs on phones): rows filtered as PNG
 * filters them, deflated with LZ77 and the fixed Huffman codes (RFC 1951),
 * in a zlib stream (RFC 1950), with the CRCs PNG needs. Base64 for data
 * URLs too (the review scan allows no btoa). Pure.
 */

// ------------------------------------------------------------- checksums

let crcTable: Uint32Array | null = null;

function crc32(bytes: Uint8Array, from = 0, to = bytes.length): number {
    if (!crcTable) {
        crcTable = new Uint32Array(256);
        for (let n = 0; n < 256; n++) {
            let c = n;
            for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
            crcTable[n] = c >>> 0;
        }
    }
    let c = 0xffffffff;
    for (let i = from; i < to; i++) c = crcTable[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
}

function adler32(bytes: Uint8Array): number {
    let a = 1;
    let b = 0;
    for (let i = 0; i < bytes.length; ) {
        const end = Math.min(bytes.length, i + 5552);
        for (; i < end; i++) {
            a += bytes[i];
            b += a;
        }
        a %= 65521;
        b %= 65521;
    }
    return ((b << 16) | a) >>> 0;
}

// --------------------------------------------------------------- deflate

/** Bits, least significant first, as deflate writes them. */
class Bits {
    private buf = new Uint8Array(1 << 16);
    private n = 0;
    private acc = 0;
    private count = 0;

    private byte(b: number): void {
        if (this.n === this.buf.length) {
            const next = new Uint8Array(this.buf.length * 2);
            next.set(this.buf);
            this.buf = next;
        }
        this.buf[this.n++] = b;
    }

    /** `len` bits of `value`, low bit first. */
    put(value: number, len: number): void {
        this.acc |= value << this.count;
        this.count += len;
        while (this.count >= 8) {
            this.byte(this.acc & 0xff);
            this.acc >>>= 8;
            this.count -= 8;
        }
    }

    /** A Huffman code: its bits from the most significant down. */
    code(code: number, len: number): void {
        let rev = 0;
        for (let i = 0; i < len; i++) rev |= ((code >> i) & 1) << (len - 1 - i);
        this.put(rev, len);
    }

    bytes(): Uint8Array {
        if (this.count > 0) this.byte(this.acc & 0xff);
        this.acc = 0;
        this.count = 0;
        return this.buf.subarray(0, this.n);
    }
}

const LENGTH_BASE = [3, 4, 5, 6, 7, 8, 9, 10, 11, 13, 15, 17, 19, 23, 27, 31, 35, 43, 51, 59, 67, 83, 99, 115, 131, 163, 195, 227, 258];
const LENGTH_EXTRA = [0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5, 5, 0];
const DIST_BASE = [1, 2, 3, 4, 5, 7, 9, 13, 17, 25, 33, 49, 65, 97, 129, 193, 257, 385, 513, 769, 1025, 1537, 2049, 3073, 4097, 6145, 8193, 12289, 16385, 24577];
const DIST_EXTRA = [0, 0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 9, 9, 10, 10, 11, 11, 12, 12, 13, 13];

/** A literal or length symbol in the fixed code. */
function literal(out: Bits, sym: number): void {
    if (sym < 144) out.code(0x30 + sym, 8);
    else if (sym < 256) out.code(0x190 + sym - 144, 9);
    else if (sym < 280) out.code(sym - 256, 7);
    else out.code(0xc0 + sym - 280, 8);
}

function lengthOut(out: Bits, len: number): void {
    let k = 28;
    while (LENGTH_BASE[k] > len) k--;
    literal(out, 257 + k);
    if (LENGTH_EXTRA[k]) out.put(len - LENGTH_BASE[k], LENGTH_EXTRA[k]);
}

function distOut(out: Bits, dist: number): void {
    let k = 29;
    while (DIST_BASE[k] > dist) k--;
    out.code(k, 5);
    if (DIST_EXTRA[k]) out.put(dist - DIST_BASE[k], DIST_EXTRA[k]);
}

const WINDOW = 32768;
const HASH = 1 << 15;
const MAX_CHAIN = 48;
const MAX_MATCH = 258;

/** Raw deflate of `data`: one block with the fixed codes, matches from a hash chain. */
export function deflateRaw(data: Uint8Array): Uint8Array {
    const out = new Bits();
    out.put(1, 1); // the last block
    out.put(1, 2); // the fixed codes
    const head = new Int32Array(HASH).fill(-1);
    const prev = new Int32Array(WINDOW);
    const n = data.length;
    const hashAt = (i: number) => ((data[i] << 10) ^ (data[i + 1] << 5) ^ data[i + 2]) & (HASH - 1);
    const insert = (i: number) => {
        if (i + 2 >= n) return;
        const h = hashAt(i);
        prev[i & (WINDOW - 1)] = head[h];
        head[h] = i;
    };
    let i = 0;
    while (i < n) {
        let bestLen = 0;
        let bestDist = 0;
        if (i + 2 < n) {
            let j = head[hashAt(i)];
            let chain = MAX_CHAIN;
            const limit = Math.min(MAX_MATCH, n - i);
            while (j >= 0 && i - j <= WINDOW && chain-- > 0) {
                if (data[j + bestLen] === data[i + bestLen]) {
                    let len = 0;
                    while (len < limit && data[j + len] === data[i + len]) len++;
                    if (len > bestLen) {
                        bestLen = len;
                        bestDist = i - j;
                        if (len === limit) break;
                    }
                }
                const next = prev[j & (WINDOW - 1)];
                if (next >= j) break;
                j = next;
            }
        }
        if (bestLen >= 3) {
            lengthOut(out, bestLen);
            distOut(out, bestDist);
            for (let k = 0; k < bestLen; k++) insert(i + k);
            i += bestLen;
        } else {
            literal(out, data[i]);
            insert(i);
            i++;
        }
    }
    literal(out, 256);
    return out.bytes();
}

/** A zlib stream (RFC 1950) of `data`. */
export function zlib(data: Uint8Array): Uint8Array {
    const raw = deflateRaw(data);
    const out = new Uint8Array(raw.length + 6);
    out[0] = 0x78;
    out[1] = 0x01;
    out.set(raw, 2);
    const a = adler32(data);
    out[raw.length + 2] = a >>> 24;
    out[raw.length + 3] = (a >>> 16) & 0xff;
    out[raw.length + 4] = (a >>> 8) & 0xff;
    out[raw.length + 5] = a & 0xff;
    return out;
}

// ------------------------------------------------------------------- PNG

function paeth(a: number, b: number, c: number): number {
    const p = a + b - c;
    const pa = Math.abs(p - a);
    const pb = Math.abs(p - b);
    const pc = Math.abs(p - c);
    return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
}

/** The rows of an RGBA picture, each with the PNG filter that makes it smallest (by the usual sum of differences). */
function filtered(rgba: Uint8ClampedArray | Uint8Array, w: number, h: number): Uint8Array {
    const stride = w * 4;
    const out = new Uint8Array(h * (stride + 1));
    const row = new Uint8Array(stride);
    for (let y = 0; y < h; y++) {
        const at = y * stride;
        let best = 0;
        let bestScore = Infinity;
        for (let f = 0; f < 5; f++) {
            let score = 0;
            for (let i = 0; i < stride; i++) {
                const x = rgba[at + i];
                const a = i >= 4 ? rgba[at + i - 4] : 0;
                const b = y > 0 ? rgba[at - stride + i] : 0;
                const c = i >= 4 && y > 0 ? rgba[at - stride + i - 4] : 0;
                const v = (x - (f === 0 ? 0 : f === 1 ? a : f === 2 ? b : f === 3 ? (a + b) >> 1 : paeth(a, b, c))) & 0xff;
                score += v < 128 ? v : 256 - v;
                if (score >= bestScore) break;
            }
            if (score < bestScore) {
                bestScore = score;
                best = f;
            }
        }
        out[y * (stride + 1)] = best;
        for (let i = 0; i < stride; i++) {
            const x = rgba[at + i];
            const a = i >= 4 ? rgba[at + i - 4] : 0;
            const b = y > 0 ? rgba[at - stride + i] : 0;
            const c = i >= 4 && y > 0 ? rgba[at - stride + i - 4] : 0;
            row[i] = (x - (best === 0 ? 0 : best === 1 ? a : best === 2 ? b : best === 3 ? (a + b) >> 1 : paeth(a, b, c))) & 0xff;
        }
        out.set(row, y * (stride + 1) + 1);
    }
    return out;
}

function chunk(type: string, body: Uint8Array): Uint8Array {
    const out = new Uint8Array(body.length + 12);
    const len = body.length;
    out[0] = len >>> 24;
    out[1] = (len >>> 16) & 0xff;
    out[2] = (len >>> 8) & 0xff;
    out[3] = len & 0xff;
    for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
    out.set(body, 8);
    const c = crc32(out, 4, 8 + len);
    out[8 + len] = c >>> 24;
    out[9 + len] = (c >>> 16) & 0xff;
    out[10 + len] = (c >>> 8) & 0xff;
    out[11 + len] = c & 0xff;
    return out;
}

/** An RGBA picture (w x h, row 0 at the top) as the bytes of a PNG file. */
export function encodePng(rgba: Uint8ClampedArray | Uint8Array, w: number, h: number): Uint8Array {
    const header = new Uint8Array(13);
    const v = new DataView(header.buffer);
    v.setUint32(0, w);
    v.setUint32(4, h);
    header[8] = 8; // bits per channel
    header[9] = 6; // RGBA
    const parts = [new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', header), chunk('IDAT', zlib(filtered(rgba, w, h))), chunk('IEND', new Uint8Array(0))];
    const out = new Uint8Array(parts.reduce((s, p) => s + p.length, 0));
    let at = 0;
    for (const p of parts) {
        out.set(p, at);
        at += p.length;
    }
    return out;
}

// ---------------------------------------------------------------- base64

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

/** Bytes as base64 (for data: URLs). */
export function base64(bytes: Uint8Array): string {
    const out: string[] = [];
    let i = 0;
    for (; i + 2 < bytes.length; i += 3) {
        const n = (bytes[i] << 16) | (bytes[i + 1] << 8) | bytes[i + 2];
        out.push(B64[n >> 18], B64[(n >> 12) & 63], B64[(n >> 6) & 63], B64[n & 63]);
    }
    const rest = bytes.length - i;
    if (rest === 1) {
        const n = bytes[i] << 16;
        out.push(B64[n >> 18], B64[(n >> 12) & 63], '==');
    } else if (rest === 2) {
        const n = (bytes[i] << 16) | (bytes[i + 1] << 8);
        out.push(B64[n >> 18], B64[(n >> 12) & 63], B64[(n >> 6) & 63], '=');
    }
    return out.join('');
}

/** A short name from the bytes (FNV-1a, 8 hex digits): the same picture, the same file name. */
export function contentHash(bytes: Uint8Array): string {
    let h = 0x811c9dc5;
    for (let i = 0; i < bytes.length; i++) {
        h ^= bytes[i];
        h = Math.imul(h, 0x01000193);
    }
    return (h >>> 0).toString(16).padStart(8, '0');
}
