/* eslint-env node */
// A film in parts that are kept: each part is filmed into its own segment and filmed again only when its key
// changes, so a change to one part films that part (and a part whose start it changes), not the whole film.
//
// The key of a part: its code (setup and film), its inputs, the shared helpers, the plugin build, the frame,
// and the state it starts from (what the part before it returned). The segments are joined with the streams
// copied (every segment comes from the kit's same encoder settings), the events with their offsets, so
// sound.mjs mixes over the whole film.
//
// A part starts from a state its setup makes off camera (notes written, a note opened, the editor opened)
// and from the camera and the pointer the part before it ended with. When that state looks like the last
// picture before it, the join cannot be seen. End a part where the picture is simple (an opened note, a
// camera at rest, the pointer at rest), so the next part's start does not change with every detail.
//
//   const r = await filmParts(parts, { out, cache, launchOptions, width, height, fps, refilm, shared, plugin, say });
//
//   part = {
//     id: 'build',                                   // the segment's name
//     inputs: { FORMULA },                           // values its code reads from outside (in the key)
//     notes: (start) => ({ 'Note.md': '...' }),      // the vault it starts with
//     pluginData: { ... },                           // the plugin's settings for this part (in the key)
//     setup: async (obs, start) => {},               // off camera, before the first picture
//     film: async (film, obs, start) => ({ camera: film.cameraNow(), pointer: film.pointerNow(), ...state }),
//   }
import { spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { launch } from '../lib/obsidian.mjs';
import { createFilm } from './kit.mjs';

const readJson = (file) => {
    try {
        return JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch {
        return null;
    }
};
const hash = (value) => crypto.createHash('sha1').update(JSON.stringify(value)).digest('hex').slice(0, 16);

/** A hash of the plugin files a launch copies (main.js, styles.css, manifest.json of `dir`), or of `dir` itself. */
export function pluginKey(dir) {
    const h = crypto.createHash('sha1');
    for (const name of ['main.js', 'styles.css', 'manifest.json']) {
        const file = path.join(dir, name);
        if (fs.existsSync(file)) h.update(fs.readFileSync(file));
    }
    return h.digest('hex').slice(0, 16);
}

/**
 * Films the parts that changed, keeps the others, and joins them into `out` (with `<out>-events.json`).
 *   cache          the folder that keeps the segments (<cache>/<id>.mp4, <id>.json)
 *   launchOptions  (part, start) => options for launch() (port, workDir, plugin, notes, ...)
 *   refilm         part ids to film again whatever their key, or 'all'
 *   shared         helper functions the parts call (their code is in every key)
 *   plugin         a string that changes with the plugin build (pluginKey), in every key
 * Returns { seconds, parts: [{ id, filmed, seconds }] }.
 */
export async function filmParts(parts, { out, cache, launchOptions, width, height, fps = 60, refilm = [], shared = [], plugin = '', say = () => {} }) {
    fs.mkdirSync(cache, { recursive: true });
    const sharedCode = shared.map((f) => f.toString());
    let start = {};
    const done = [];
    for (const part of parts) {
        const key = hash({ v: 2, id: part.id, setup: String(part.setup ?? ''), film: String(part.film), notes: String(part.notes ?? ''), pluginData: part.pluginData ?? null, inputs: part.inputs ?? null, sharedCode, plugin, start, width, height, fps });
        const file = path.join(cache, `${part.id}.mp4`);
        const metaFile = path.join(cache, `${part.id}.json`);
        const kept = readJson(metaFile);
        const again = refilm === 'all' || refilm.includes(part.id) || !kept || kept.key !== key || !fs.existsSync(file);
        if (again) {
            say(`part ${part.id}: filming${kept && kept.key !== key ? ' (changed)' : ''}`);
            const obs = await launch({ ...launchOptions(part, start), ...(part.pluginData ? { pluginData: part.pluginData } : {}), notes: part.notes ? part.notes(start) : {} });
            try {
                if (part.setup) await part.setup(obs, start);
                const film = await createFilm(obs, { out: file, fps, width, height, say });
                if (start.camera) film.camera(start.camera, 0);
                if (start.pointer) await obs.mouse.move(start.pointer);
                // A part after another opens on one picture of its start: the last picture before it, again.
                if (start.camera) await film.tick();
                const end = (await part.film(film, obs, start)) ?? {};
                const r = await film.finish();
                const events = readJson(file.replace(/\.mp4$/i, '-events.json'));
                fs.writeFileSync(metaFile, JSON.stringify({ key, frames: r.frames, seconds: r.seconds, end, events: events ? events.events : [] }, null, 1));
                say(`part ${part.id}: ${r.frames} frames, ${r.seconds.toFixed(2)} s`);
            } finally {
                await obs.quit();
            }
        } else say(`part ${part.id}: kept (${kept.seconds.toFixed(2)} s)`);
        const meta = readJson(metaFile);
        done.push({ id: part.id, filmed: again, file, ...meta });
        start = meta.end ?? {};
    }

    // The segments, joined with their streams copied; the events, shifted by the length of what comes before.
    const list = path.join(cache, 'join.txt');
    fs.writeFileSync(list, done.map((d) => `file '${d.file.replace(/'/g, "'\\''")}'`).join('\n') + '\n');
    const joined = spawnSync('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'concat', '-safe', '0', '-i', list, '-c', 'copy', '-movflags', '+faststart', out], { stdio: 'inherit' });
    if (joined.status !== 0) throw new Error(`parts: joining the segments into ${out} failed`);
    const events = [];
    let offset = 0;
    for (const d of done) {
        for (const e of d.events ?? []) events.push({ ...e, t: Math.round((e.t + offset) * 1e4) / 1e4 });
        offset += d.frames / fps;
    }
    fs.writeFileSync(out.replace(/\.mp4$/i, '') + '-events.json', JSON.stringify({ fps, seconds: offset, events }, null, 1));
    return { seconds: offset, parts: done.map((d) => ({ id: d.id, filmed: d.filmed, seconds: d.seconds })) };
}
