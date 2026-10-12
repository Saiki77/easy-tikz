// Concatenate the plugin stylesheets into the single styles.css Obsidian
// loads. src/styles.css comes first (base + modal layout), then every
// src/ui/*.css in alphabetical order. Run directly (npm run build) or
// import buildCss() (esbuild.config.mjs watches the CSS in dev mode).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const self = fileURLToPath(import.meta.url);
const root = path.resolve(path.dirname(self), '..');

export function buildCss() {
    const uiDir = path.join(root, 'src', 'ui');
    const parts = [path.join(root, 'src', 'styles.css')];
    if (fs.existsSync(uiDir)) {
        for (const f of fs.readdirSync(uiDir).filter((f) => f.endsWith('.css')).sort()) {
            parts.push(path.join(uiDir, f));
        }
    }
    const out = parts
        .map((p) => `/* ---- ${path.relative(root, p)} ---- */\n` + fs.readFileSync(p, 'utf8').trimEnd() + '\n')
        .join('\n');
    fs.writeFileSync(path.join(root, 'styles.css'), out);
    console.log(`styles.css: ${parts.length} file(s), ${out.length} bytes`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === self) buildCss();
