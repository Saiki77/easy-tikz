/* eslint-env node */
// Sound design for a film of kit.mjs: synthesised from its event track (<film>-events.json), so every sound
// sits on the frame of what makes it. Nothing is recorded or downloaded; the same events give the same sound.
//
//   node scripts/media/film/sound.mjs film.mp4                 # sound effects: film-sound.mp4
//   node scripts/media/film/sound.mjs film.mp4 --music         # also a soft music bed: film-music.mp4
//   node scripts/media/film/sound.mjs film.mp4 --wav out.wav   # the mix only
//
// The sounds, quiet and short, as a good screen recording sounds:
//   key       a soft key: a little filtered noise and a low thump, a little different each time
//   press     a crisp click of the button; release a softer, lower one
//   camera    a whoosh that follows the move: noise through a band that rises on a zoom in, falls on a zoom out
//   wheel, scroll   the same whoosh, quieter
//   drag      a faint texture that swells and fades with the speed of the hand
//   pop       a soft rising blip when something opens (a card, the editor, a menu): film.mark('pop')
//   music     pads on Cmaj9, G6, Am9, Fmaj9, a bass and a few plucks, in a small stereo room
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';

const run = promisify(execFile);
const SR = 48000;

/** A seeded random source in [0, 1). */
function random(seed) {
    let s = seed >>> 0 || 1;
    return () => (s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296;
}

/** RBJ biquad: 'lowpass', 'highpass' or 'bandpass' (0 dB peak). set() may change it while it runs. */
class Biquad {
    constructor(type, f, q) {
        this.type = type;
        this.x1 = this.x2 = this.y1 = this.y2 = 0;
        this.set(f, q);
    }
    set(f, q) {
        const w = (2 * Math.PI * Math.min(f, SR * 0.45)) / SR;
        const cos = Math.cos(w);
        const alpha = Math.sin(w) / (2 * q);
        let b0;
        let b1;
        let b2;
        if (this.type === 'lowpass') [b0, b1, b2] = [(1 - cos) / 2, 1 - cos, (1 - cos) / 2];
        else if (this.type === 'highpass') [b0, b1, b2] = [(1 + cos) / 2, -(1 + cos), (1 + cos) / 2];
        else [b0, b1, b2] = [alpha, 0, -alpha];
        const a0 = 1 + alpha;
        this.b0 = b0 / a0;
        this.b1 = b1 / a0;
        this.b2 = b2 / a0;
        this.a1 = (-2 * cos) / a0;
        this.a2 = (1 - alpha) / a0;
    }
    run(x) {
        const y = this.b0 * x + this.b1 * this.x1 + this.b2 * this.x2 - this.a1 * this.y1 - this.a2 * this.y2;
        this.x2 = this.x1;
        this.x1 = x;
        this.y2 = this.y1;
        this.y1 = y;
        return y;
    }
}

/** Stereo buffers of `seconds`, and a function that adds a mono sample at a pan (-1 left .. 1 right). */
function buffers(seconds) {
    const n = Math.ceil(seconds * SR);
    const L = new Float32Array(n);
    const R = new Float32Array(n);
    const add = (i, v, pan = 0) => {
        if (i < 0 || i >= n) return;
        const a = (pan + 1) * (Math.PI / 4);
        L[i] += v * Math.cos(a);
        R[i] += v * Math.sin(a);
    };
    return { L, R, n, add };
}

// ------------------------------------------------------------------ the sounds

function key(buf, t, kind, rnd) {
    const start = Math.round(t * SR);
    const big = kind === 'Enter' || kind === 'Space';
    const level = 0.11 * (0.8 + 0.4 * rnd()) * (big ? 1.25 : 1);
    const pan = (rnd() - 0.5) * 0.25;
    const band = new Biquad('bandpass', 2600 + rnd() * 1600, 1.1);
    const thump = big ? 130 + rnd() * 20 : 175 + rnd() * 45;
    const len = Math.round(0.07 * SR);
    for (let i = 0; i < len; i++) {
        const s = i / SR;
        const env = Math.min(1, s / 0.0012) * Math.exp(-s / 0.009);
        const noise = band.run(rnd() * 2 - 1) * 2.2;
        const body = Math.sin(2 * Math.PI * thump * s) * Math.exp(-s / 0.014) * 0.55;
        buf.add(start + i, level * (noise * env + body * Math.min(1, s / 0.002)), pan);
    }
}

function click(buf, t, down, rnd) {
    const start = Math.round(t * SR);
    const level = down ? 0.15 : 0.085;
    const high = new Biquad('highpass', down ? 2400 : 1500, 0.8);
    const tone = down ? 1750 : 1150;
    const len = Math.round(0.03 * SR);
    for (let i = 0; i < len; i++) {
        const s = i / SR;
        const noise = high.run(rnd() * 2 - 1) * Math.exp(-s / 0.0022);
        const ping = Math.sin(2 * Math.PI * tone * s) * Math.exp(-s / (down ? 0.0045 : 0.0035)) * 0.6;
        buf.add(start + i, level * (noise + ping), 0.08);
    }
}

/** Noise through a band that moves from f0 to f1 under a bell envelope; two noise streams for width. */
function whoosh(buf, t, seconds, f0, f1, level, rnd) {
    const start = Math.round(t * SR);
    const len = Math.round(seconds * SR);
    const bandL = new Biquad('bandpass', f0, 0.9);
    const bandR = new Biquad('bandpass', f0, 0.9);
    for (let i = 0; i < len; i++) {
        const u = i / len;
        if (i % 64 === 0) {
            const f = f0 * Math.pow(f1 / f0, u * u * (3 - 2 * u));
            bandL.set(f, 0.9);
            bandR.set(f * 1.04, 0.9);
        }
        const env = Math.pow(Math.sin(Math.PI * u), 2);
        const l = bandL.run(rnd() * 2 - 1) * 2.4 * env * level;
        const r = bandR.run(rnd() * 2 - 1) * 2.4 * env * level;
        const k = start + i;
        if (k >= 0 && k < buf.n) {
            buf.L[k] += l;
            buf.R[k] += r;
        }
    }
}

/** The speed of a minimum-jerk move, 0 at both ends, 1 in the middle. */
const speed = (u) => 16 * u * u * (1 - u) * (1 - u);

function drag(buf, t, seconds, rnd) {
    const start = Math.round(t * SR);
    const len = Math.round(seconds * SR);
    const low = new Biquad('lowpass', 900, 0.7);
    const high = new Biquad('highpass', 180, 0.7);
    for (let i = 0; i < len; i++) {
        const v = high.run(low.run(rnd() * 2 - 1)) * 3 * speed(i / len) * 0.022;
        buf.add(start + i, v, -0.05);
    }
}

function pop(buf, t, rnd) {
    const start = Math.round(t * SR);
    const len = Math.round(0.16 * SR);
    let phase = 0;
    for (let i = 0; i < len; i++) {
        const s = i / SR;
        const f = 520 + 380 * (1 - Math.exp(-s / 0.03)); // a small rise: something opens
        phase += (2 * Math.PI * f) / SR;
        const env = Math.min(1, s / 0.004) * Math.exp(-s / 0.045);
        buf.add(start + i, 0.07 * env * (Math.sin(phase) + 0.18 * Math.sin(2 * phase)), 0.1 * (rnd() - 0.5));
    }
}

// ------------------------------------------------------------------ the music bed

const midi = (n) => 440 * Math.pow(2, (n - 69) / 12);
/** Four chords, two bars each at 76 bpm; voicings from low to high. */
const CHORDS = [
    [48, 55, 59, 62, 64], // Cmaj9
    [43, 50, 59, 62, 64], // G6
    [45, 52, 55, 59, 60], // Am9
    [41, 48, 52, 55, 57], // Fmaj9
];

/** Pads, bass and plucks for `seconds`, dry, with a reverb send each. */
function music(seconds, rnd) {
    const dry = buffers(seconds + 3);
    const send = buffers(seconds + 3);
    const beat = 60 / 76;
    const span = beat * 8;
    const chords = Math.ceil(seconds / span) + 1;
    for (let c = 0; c < chords; c++) {
        const notes = CHORDS[c % CHORDS.length];
        const t0 = c * span;
        // Pad: soft additive voices, two detuned copies, attack 1.4 s, held, released into the next chord.
        for (const [v, n] of notes.entries()) {
            const f = midi(n);
            const amp = 0.045 / (1 + v * 0.15);
            const len = Math.round((span + 1.8) * SR);
            const start = Math.round(t0 * SR);
            const lp = new Biquad('lowpass', 1500, 0.6);
            const pan = (v / (notes.length - 1) - 0.5) * 0.7;
            for (let i = 0; i < len; i++) {
                const s = i / SR;
                const env = Math.min(1, s / 1.4) * (s > span ? Math.max(0, 1 - (s - span) / 1.8) : 1);
                if (env <= 0) continue;
                let x = 0;
                for (const det of [-0.0025, 0.0025]) {
                    const ph = 2 * Math.PI * f * (1 + det) * s;
                    x += Math.sin(ph) + 0.35 * Math.sin(2 * ph) + 0.12 * Math.sin(3 * ph);
                }
                const y = lp.run(x) * amp * env * (1 + 0.08 * Math.sin(2 * Math.PI * 0.2 * s + v));
                dry.add(start + i, y, pan);
                send.add(start + i, y * 0.9, pan);
            }
        }
        // Bass: the root an octave down, round and quiet.
        {
            const f = midi(notes[0] - 12);
            const start = Math.round(t0 * SR);
            const len = Math.round((span + 0.6) * SR);
            for (let i = 0; i < len; i++) {
                const s = i / SR;
                const env = Math.min(1, s / 0.25) * (s > span ? Math.max(0, 1 - (s - span) / 0.6) : 1);
                dry.add(start + i, 0.07 * env * (Math.sin(2 * Math.PI * f * s) + 0.2 * Math.sin(4 * Math.PI * f * s)), 0);
            }
        }
        // Plucks: the chord's upper notes an octave up, on some eighths, as a light figure.
        for (let k = 0; k < 16; k++) {
            if (rnd() < 0.45) continue;
            const n = notes[1 + Math.floor(rnd() * (notes.length - 1))] + 12;
            const f = midi(n);
            const start = Math.round((t0 + (k * beat) / 2) * SR);
            const len = Math.round(1.2 * SR);
            const pan = (rnd() - 0.5) * 0.9;
            const amp = 0.028 * (0.7 + 0.6 * rnd());
            for (let i = 0; i < len; i++) {
                const s = i / SR;
                const env = Math.min(1, s / 0.003) * Math.exp(-s / 0.32);
                const ph = 2 * Math.PI * f * s;
                const y = amp * env * (Math.sin(ph) + 0.25 * Math.sin(3 * ph) * Math.exp(-s / 0.08));
                dry.add(start + i, y, pan);
                send.add(start + i, y * 1.4, pan);
            }
        }
    }
    reverbInto(send, dry, 0.35);
    return dry;
}

/** A small stereo Schroeder room: four damped combs and two allpasses per side, added into `out`. */
function reverbInto(src, out, wet) {
    const side = (input, offset) => {
        const combs = [1557, 1617, 1491, 1422].map((d) => ({ buf: new Float32Array(d + offset), i: 0, low: 0 }));
        const passes = [556, 441].map((d) => ({ buf: new Float32Array(d + offset), i: 0 }));
        const y = new Float32Array(input.length);
        for (let n = 0; n < input.length; n++) {
            let acc = 0;
            for (const c of combs) {
                const v = c.buf[c.i];
                c.low = v * 0.75 + c.low * 0.25; // damping: the room is darker than the sound
                c.buf[c.i] = input[n] * 0.015 + c.low * 0.86;
                c.i = (c.i + 1) % c.buf.length;
                acc += v;
            }
            for (const a of passes) {
                const v = a.buf[a.i];
                const w = acc + v * 0.5;
                a.buf[a.i] = w;
                a.i = (a.i + 1) % a.buf.length;
                acc = v - w * 0.5;
            }
            y[n] = acc;
        }
        return y;
    };
    const l = side(src.L, 0);
    const r = side(src.R, 23);
    for (let n = 0; n < out.n; n++) {
        out.L[n] += l[n] * wet * 8;
        out.R[n] += r[n] * wet * 8;
    }
}

// ------------------------------------------------------------------ mix and file

/** The mix of a film's events: { L, R } at 48 kHz. */
export function mixFor(track, { music: withMusic = false, seed = 5 } = {}) {
    const rnd = random(seed);
    const seconds = track.seconds + 0.5;
    const fx = buffers(seconds);
    for (const e of track.events) {
        if (e.type === 'key') key(fx, e.t, e.key, rnd);
        else if (e.type === 'press') click(fx, e.t, true, rnd);
        else if (e.type === 'release') click(fx, e.t, false, rnd);
        else if (e.type === 'camera' && e.seconds > 0.2) {
            const zoomIn = e.zoom > 1.02;
            const zoomOut = e.zoom < 0.98;
            whoosh(fx, e.t, e.seconds, zoomIn ? 380 : 1500, zoomIn ? 1500 : zoomOut ? 380 : 900, zoomIn || zoomOut ? 0.05 : 0.03, rnd);
        } else if (e.type === 'wheel') whoosh(fx, e.t, e.seconds, e.zoom === 'in' ? 450 : 1300, e.zoom === 'in' ? 1300 : 450, 0.03, rnd);
        else if (e.type === 'scroll') whoosh(fx, e.t, e.seconds, 700, 500, 0.025, rnd);
        else if (e.type === 'drag') drag(fx, e.t, e.seconds, rnd);
        else if (e.type === 'pop') pop(fx, e.t, rnd);
    }
    // Fixed levels, not a normalised peak: the effects peak at -3 dBFS, so a click is clear but never sharp;
    // the bed sits well under them (RMS near -21 dBFS). The film with the bed measures about -18 LUFS.
    const bed = withMusic ? music(seconds, random(seed + 1)) : null;
    let fxPeak = 0;
    for (let i = 0; i < fx.n; i++) fxPeak = Math.max(fxPeak, Math.abs(fx.L[i]), Math.abs(fx.R[i]));
    const gFx = fxPeak > 0 ? 0.7 / fxPeak : 1;
    let gBed = 0;
    if (bed) {
        let sum = 0;
        for (let i = 0; i < fx.n; i++) sum += bed.L[i] * bed.L[i] + bed.R[i] * bed.R[i];
        const rms = Math.sqrt(sum / (2 * fx.n));
        gBed = rms > 0 ? 0.09 / rms : 0;
    }
    const out = buffers(seconds);
    const fadeIn = 1.5 * SR;
    const fadeOut = 2.5 * SR;
    const soft = (v) => (Math.abs(v) < 0.6 ? v : Math.sign(v) * (0.6 + 0.3 * Math.tanh((Math.abs(v) - 0.6) / 0.3)));
    for (let i = 0; i < out.n; i++) {
        let m = 1;
        if (i < fadeIn) m = i / fadeIn;
        if (i > out.n - fadeOut) m = Math.min(m, (out.n - i) / fadeOut);
        out.L[i] = soft(fx.L[i] * gFx + (bed ? bed.L[i] * gBed * m : 0));
        out.R[i] = soft(fx.R[i] * gFx + (bed ? bed.R[i] * gBed * m : 0));
    }
    return out;
}

/** 16-bit PCM WAV of a stereo mix. */
export function writeWav(file, { L, R, n }) {
    const data = Buffer.alloc(n * 4);
    for (let i = 0; i < n; i++) {
        data.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(L[i] * 32767))), i * 4);
        data.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(R[i] * 32767))), i * 4 + 2);
    }
    const head = Buffer.alloc(44);
    head.write('RIFF', 0);
    head.writeUInt32LE(36 + data.length, 4);
    head.write('WAVEfmt ', 8);
    head.writeUInt32LE(16, 16);
    head.writeUInt16LE(1, 20);
    head.writeUInt16LE(2, 22);
    head.writeUInt32LE(SR, 24);
    head.writeUInt32LE(SR * 4, 28);
    head.writeUInt16LE(4, 32);
    head.writeUInt16LE(16, 34);
    head.write('data', 36);
    head.writeUInt32LE(data.length, 40);
    fs.writeFileSync(file, Buffer.concat([head, data]));
}

/** The film with its sound: <film>-sound.mp4, or <film>-music.mp4 with the music bed. Returns the path. */
export async function addSound(film, { music: withMusic = false, out = null, wav = null } = {}) {
    const base = film.replace(/\.mp4$/i, '');
    const track = JSON.parse(fs.readFileSync(`${base}-events.json`, 'utf8'));
    const mix = mixFor(track, { music: withMusic });
    const wavFile = wav || `${base}-${withMusic ? 'music' : 'sound'}.wav`;
    writeWav(wavFile, mix);
    if (wav) return wavFile;
    const target = out || `${base}-${withMusic ? 'music' : 'sound'}.mp4`;
    await run('ffmpeg', ['-v', 'error', '-y', '-i', film, '-i', wavFile, '-map', '0:v', '-map', '1:a', '-c:v', 'copy', '-c:a', 'aac', '-b:a', '192k', '-shortest', '-movflags', '+faststart', target]);
    fs.rmSync(wavFile, { force: true });
    return target;
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname)) {
    const args = process.argv.slice(2);
    const film = args.find((a) => !a.startsWith('--') && a.endsWith('.mp4'));
    const at = (flag) => (args.includes(flag) ? args[args.indexOf(flag) + 1] : null);
    if (!film) {
        console.log('Usage: node scripts/media/film/sound.mjs film.mp4 [--music] [--out film-sound.mp4] [--wav mix.wav]');
        process.exit(2);
    }
    const done = await addSound(path.resolve(film), { music: args.includes('--music'), out: at('--out'), wav: at('--wav') });
    console.log(done);
}
