/* eslint-env node */
// A copy of a film for an upload with a size limit, such as the README video on GitHub (10 MB per video on the
// Free plan): the same frames in H.264, two passes at the rate that fits, AAC 128 kbit/s, faststart. With --card, a
// still comes first for 1 s and fades into the film in 0.5 s: a player shows the first frame before play, so the
// card is the poster. The sound moves with the film.
//
//   node scripts/media/film/upload.mjs film.mp4 --card still.png [--out film-upload.mp4] [--max 9.4]
//
// GitHub plays a README video only when it was uploaded on the website: see "README video" in README.md.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

const probe = (file, entries) => execFileSync('ffprobe', ['-v', 'error', ...entries, '-of', 'json', file], { encoding: 'utf8' });

/**
 * Writes the copy and returns { out, bytes, seconds, videoKbps }.
 *   card   a still (any size: scaled to the film) shown first for `hold` seconds, then a fade of `fade` seconds
 *   maxMB  the size to stay under, in MB (10^6 bytes); the default leaves room under GitHub's 10 MB
 */
export function uploadCopy(film, { out = film.replace(/\.mp4$/i, '-upload.mp4'), card = null, maxMB = 9.4, hold = 1.0, fade = 0.5, audioKbps = 128 } = {}) {
    const info = JSON.parse(probe(film, ['-show_entries', 'format=duration:stream=codec_type,width,height,r_frame_rate']));
    const video = info.streams.find((s) => s.codec_type === 'video');
    const hasAudio = info.streams.some((s) => s.codec_type === 'audio');
    const [num, den] = video.r_frame_rate.split('/').map(Number);
    const fps = num / (den || 1);
    const seconds = Number(info.format.duration) + (card ? hold : 0);
    const inputs = card ? ['-loop', '1', '-framerate', String(fps), '-t', String(hold + fade), '-i', card, '-i', film] : ['-i', film];
    const same = `format=yuv420p,fps=${fps},settb=AVTB,setpts=PTS-STARTPTS`;
    const picture = card
        ? `[0:v]scale=${video.width}:${video.height}:flags=lanczos,${same}[c];[1:v]${same}[f];[c][f]xfade=transition=fade:duration=${fade}:offset=${hold},format=yuv420p[v]`
        : `[0:v]${same}[v]`;
    const ms = Math.round(hold * 1000);
    const sound = hasAudio ? (card ? `;[1:a]adelay=${ms}|${ms}[a]` : ';[0:a]anull[a]') : '';
    const log = path.join(os.tmpdir(), `etz-upload-${process.pid}`);
    // The rate that fits, with 6 % for the overshoot of the rate control (about 4 % on a screen film).
    let videoKbps = Math.floor(((maxMB * 8000) / seconds - (hasAudio ? audioKbps + 4 : 0)) / 1.06);
    for (let attempt = 0; attempt < 3; attempt++) {
        const x264 = ['-c:v', 'libx264', '-preset', 'slow', '-profile:v', 'high', '-b:v', `${videoKbps}k`, '-maxrate', '4000k', '-bufsize', '8000k', '-pix_fmt', 'yuv420p', '-passlogfile', log];
        execFileSync('ffmpeg', ['-v', 'error', '-y', ...inputs, '-filter_complex', picture, '-map', '[v]', ...x264, '-pass', '1', '-an', '-f', 'null', os.devNull], { stdio: 'inherit' });
        const audio = hasAudio ? ['-map', '[a]', '-c:a', 'aac', '-b:a', `${audioKbps}k`] : [];
        execFileSync('ffmpeg', ['-v', 'error', '-y', ...inputs, '-filter_complex', picture + sound, '-map', '[v]', ...audio, ...x264, '-pass', '2', '-movflags', '+faststart', out], { stdio: 'inherit' });
        const bytes = fs.statSync(out).size;
        if (bytes <= maxMB * 1e6) {
            for (const f of fs.readdirSync(os.tmpdir())) if (f.startsWith(path.basename(log))) fs.rmSync(path.join(os.tmpdir(), f), { force: true });
            return { out, bytes, seconds, videoKbps };
        }
        videoKbps = Math.floor((videoKbps * (maxMB * 1e6)) / bytes / 1.02);
    }
    throw new Error(`upload.mjs: ${out} stays above ${maxMB} MB`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    const { values, positionals } = parseArgs({
        allowPositionals: true,
        options: { out: { type: 'string' }, card: { type: 'string' }, max: { type: 'string', default: '9.4' }, help: { type: 'boolean', short: 'h' } },
    });
    if (values.help || !positionals[0]) {
        console.log('Usage: node scripts/media/film/upload.mjs film.mp4 [--card still.png] [--out film-upload.mp4] [--max 9.4]');
        process.exit(values.help ? 0 : 1);
    }
    const film = path.resolve(positionals[0]);
    const r = uploadCopy(film, { out: values.out ? path.resolve(values.out) : undefined, card: values.card ? path.resolve(values.card) : null, maxMB: Number(values.max) });
    console.log(`${r.out}: ${(r.bytes / 1e6).toFixed(2)} MB, ${r.seconds.toFixed(2)} s, video ${r.videoKbps} kbit/s`);
}
