/* eslint-env node */
// Check a film for uneven motion, the micro stutter of a capture that is not frame-exact.
//
// ffmpeg gives the mean difference of every frame to the next (tblend + signalstats, YAVG). In each run of
// continuous motion (every frame changes, for half a second or more) a frame that changes 2.2x more, or 0.4x
// less, than the mean of its two neighbours is uneven. A drag whose chart follows only every second frame shows
// as a run of them; a single one at a click or at the start of a camera move is an event, not judder. A camera
// move over text varies on its own as lines pass, so look at the frames named before calling them judder.
//
//   node scripts/media/film/check.mjs film.mp4                # the motion runs and the uneven frames
//   node scripts/media/film/check.mjs film.mp4 --sheet s.png  # also a contact sheet, one picture per 2 s
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

const run = promisify(execFile);

/** Frame rate and length of a video, from ffprobe. */
async function probe(file) {
    const { stdout } = await run('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=r_frame_rate:format=duration', '-of', 'json', file]);
    const info = JSON.parse(stdout);
    const [num, den] = String(info.streams?.[0]?.r_frame_rate || '60/1').split('/').map(Number);
    return { fps: den ? num / den : num, duration: Number(info.format?.duration || 0) };
}

/** The mean difference of each frame to the next (index i: frames i and i + 1). */
async function differences(file) {
    const tmp = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'etz-film-check-')), 'yavg.txt');
    await run('ffmpeg', ['-v', 'error', '-i', file, '-vf', `format=gray,tblend=all_mode=difference,signalstats,metadata=print:key=lavfi.signalstats.YAVG:file=${tmp}`, '-f', 'null', '-'], { maxBuffer: 1 << 26 });
    const values = [];
    // Values may be written with an exponent (3.8e-05): read the whole number.
    for (const m of fs.readFileSync(tmp, 'utf8').matchAll(/YAVG=([-\d.eE+]+)/g)) values.push(Number(m[1]));
    fs.rmSync(path.dirname(tmp), { recursive: true, force: true });
    return values;
}

/** Runs of continuous motion and the uneven frames inside them, in seconds. */
export function unevenFrames(values, fps, { moving = 0.08, minRun = 0.5 } = {}) {
    const runs = [];
    let start = null;
    for (let i = 0; i <= values.length; i++) {
        const v = i < values.length ? values[i] : 0;
        if (v > moving && start === null) start = i;
        if (v <= moving && start !== null) {
            if (i - start >= minRun * fps) runs.push([start, i]);
            start = null;
        }
    }
    const uneven = [];
    for (const [a, b] of runs) {
        for (let k = a + 2; k < b - 2; k++) {
            const around = (values[k - 1] + values[k + 1]) / 2;
            if (around > 0.15 && (values[k] > 2.2 * around || values[k] < 0.4 * around)) uneven.push((k + 1) / fps);
        }
    }
    return { runs: runs.map(([a, b]) => [a / fps, b / fps]), uneven };
}

/** Check a film; with `sheet`, also write a contact sheet. Returns the numbers and a short text. */
export async function checkFilm(file, { sheet = null } = {}) {
    const { fps, duration } = await probe(file);
    const values = await differences(file);
    const { runs, uneven } = unevenFrames(values, fps);
    if (sheet) {
        const rows = Math.max(1, Math.ceil(duration / 2 / 6));
        await run('ffmpeg', ['-v', 'error', '-y', '-i', file, '-vf', `fps=1/2,scale=440:-1,tile=6x${rows}:padding=6:color=white`, '-frames:v', '1', sheet]);
    }
    const r1 = (s) => Math.round(s * 100) / 100;
    const text = [
        `${path.basename(file)}: ${r1(duration)} s at ${r1(fps)} fps, ${runs.length} runs of motion`,
        `uneven frames: ${uneven.length}${uneven.length ? ` at ${uneven.slice(0, 30).map(r1).join(', ')} s` : ''}`,
        sheet ? `contact sheet: ${sheet}` : '',
    ]
        .filter(Boolean)
        .join('\n');
    return { fps, duration, runs, uneven, text };
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname)) {
    const args = process.argv.slice(2);
    const file = args.find((a) => !a.startsWith('--'));
    const at = args.indexOf('--sheet');
    if (!file) {
        console.log('Usage: node scripts/media/film/check.mjs film.mp4 [--sheet sheet.png]');
        process.exit(2);
    }
    const report = await checkFilm(path.resolve(file), { sheet: at >= 0 ? path.resolve(args[at + 1]) : null });
    console.log(report.text);
}
