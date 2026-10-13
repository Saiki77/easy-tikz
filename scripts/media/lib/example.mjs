/* eslint-env node */
// A runnable tour of the media toolkit: copy from here when you write a
// capture script. It starts the isolated Obsidian, takes four pictures of
// the Linear program example and films a four second test clip.
//
//   node scripts/media/lib/example.mjs                      # output in <tmp>/easy-tikz-media/example
//   node scripts/media/lib/example.mjs --out /some/folder --port 9341
import os from 'node:os';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { PORTS, chartBlock, importTs, launch } from './obsidian.mjs';
import { createRecorder } from './record.mjs';

const { values } = parseArgs({ options: { out: { type: 'string' }, port: { type: 'string' }, work: { type: 'string' } } });
const out = path.resolve(values.out || path.join(os.tmpdir(), 'easy-tikz-media', 'example'));
const port = Number(values.port || process.env.ETZ_MEDIA_PORT || PORTS.smoke);

// Chart data comes from the plugin's own sources, bundled on the fly.
const { EXAMPLES } = await importTs('src/migrate.ts');
const lp = EXAMPLES.find((e) => e.id === 'lp').data;

const obs = await launch({ port, workDir: values.work, width: 1440, height: 900, theme: 'light' });
try {
    // 1. The editor on the Linear program example, light and dark.
    await obs.openEditor({ chart: lp });
    await obs.screenshot(path.join(out, 'editor-light.png'), { clip: 'editor', padding: 24 });
    await obs.setTheme('dark');
    await obs.screenshot(path.join(out, 'editor-dark.png'), { clip: 'editor', padding: 24 });
    await obs.setTheme('light');

    // 2. Only the chart picture.
    await obs.screenshot(path.join(out, 'preview.png'), { clip: 'preview' });

    // 3. A four second clip: drag the objective line (slider c follows), then drag the slider back.
    //    The vertical padding leaves a band under the editor for the caption bar, so it covers no button.
    const rec = await createRecorder(obs, { dir: path.join(out, 'frames'), clip: 'editor', padding: [24, 60], caption: { margin: 8 } });
    await rec.caption('Drag the objective line: slider c follows');
    await rec.hold(0.4);
    await rec.drag([[1.5, 2], [2.1, 2.4]], { seconds: 1.0, approach: 0.5 });
    await rec.caption('Or drag the slider');
    await rec.slider('c', 9, { seconds: 0.8, approach: 0.4 });
    await rec.hold(0.2);
    const video = await rec.encode({ out: path.join(out, 'test') });
    await rec.close();
    await obs.closeEditor();

    // 4. The same chart in a note, with its slider strip.
    await obs.setWindowSize(1100, 1000);
    await obs.writeNote('Linear program', `Maximise $2x + 3y$ over the shaded region.\n\n${chartBlock({ ...lp, displayWidth: 560 })}\n\nDrag the slider to move the objective line.\n`);
    await obs.openNote('Linear program');
    await obs.setSlider('c', 6, { scope: 'note' });
    await obs.screenshot(path.join(out, 'note-sliders.png'), { clip: 'note' });

    console.log(`Wrote to ${out}:`);
    console.log('  editor-light.png, editor-dark.png, preview.png, note-sliders.png');
    console.log(`  test.mp4 (${(video.bytes.mp4 / 1024).toFixed(0)} KB), test.gif (${(video.bytes.gif / 1024).toFixed(0)} KB), test-sheet.png, test-poster.png: ${video.frames} frames, ${video.seconds.toFixed(1)} s`);
    if (obs.errors.length) {
        console.log(`Console errors (${obs.errors.length}):`);
        for (const e of obs.errors) console.log(`  ${e.type}: ${e.text}`);
        process.exitCode = 1;
    }
} finally {
    await obs.quit();
}
