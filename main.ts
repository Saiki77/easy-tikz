import { App, MarkdownPostProcessorContext, MarkdownRenderChild, Notice, Platform, Plugin, PluginSettingTab, SettingDefinitionItem, SettingGroupItem, TFile, normalizePath, setIcon } from 'obsidian';
import { TikzModal } from './src/modal';
import { SettingsManager } from './src/settings';
import { SVGRenderer } from './src/renderer';
import { MATH_REDRAW_LIMIT } from './src/mathlabel';
import { SVG3DRenderer } from './src/renderer3d';
import { SceneCache, SceneIssue } from './src/scene';
import { MathContext } from './src/mathcontext';
import { normalizeParameters } from './src/migrate';
import { Parameter, RendererConfig } from './src/types';
import { ChartDraft, DEFAULT_PLUGIN_DATA, PluginData, UserTemplate } from './src/templates';
import { PluginHost } from './src/ui/host';
import { issueText, mergeViewErrors } from './src/issues';
import { cloneData, errorText, fitPixelScale } from './src/util';
import { IconButtonHandle, LiveSliderHandle, iconButton, liveSlider, textButton, uniqueId, visuallyHidden } from './src/ui/kit';
import { WhatsNewActions, WhatsNewModal } from './src/ui/whatsNewModal';
import { WHATS_NEW_VERSION, chartScanRank, hasEasyTikzBlock, needsVaultCheck, shouldShowWhatsNew, whatsNewSeen } from './src/whatsnew';
import { AiServer, Http } from './src/ai/server';
import { VaultChartHost } from './src/ai/vaultHost';
import { AI_APPS, agentsSection, mcpUrl, mergeAgentsSection, newToken, shownSnippet } from './src/ai/connect';
import AI_GUIDE from './docs/ai.md';
import { BlockFormat, readBlock } from './src/blockjson';
import { TextProblem } from './src/text/parse';
import { printChartText, writeChartText } from './src/text/print';
import { GLIDE_MS, PopIn, drawnNames, ease, glides, mixCharts, reducedMotion } from './src/motion';

type FenceTag = 'easy-tikz' | 'tikz';
type Align = 'left' | 'center' | 'right';

/** Slider rows shown in a note before "Show N more". */
const STRIP_ROWS = 3;
/** Slider drags: full-quality render this long after the last input (draft frames in between). */
const FULL_RENDER_DELAY_MS = 150;
/** Width slider bounds for charts in notes (px). */
const MIN_NOTE_WIDTH = 200;
const MAX_NOTE_WIDTH = 2000;
/** Charts whose slider state is remembered for the session (oldest dropped first). */
const SESSION_LIMIT = 200;

/**
 * Slider positions changed in a note, kept for the session only: a
 * re-render (an edit nearby in Live Preview, scrolling the block out of
 * view) keeps them, and they never write the file. Keyed by sourceKey().
 */
interface SessionState {
    values: Record<string, number>;
    /** "Show N more" is open. */
    expanded: boolean;
}

const sessionStates = new Map<string, SessionState>();

function sessionGet(key: string): SessionState | undefined {
    const state = sessionStates.get(key);
    if (state) {
        // Re-insert so the Map's insertion order doubles as least-recently-used order.
        sessionStates.delete(key);
        sessionStates.set(key, state);
    }
    return state;
}

function sessionSet(key: string, state: SessionState | null) {
    sessionStates.delete(key);
    if (!state) return;
    sessionStates.set(key, state);
    while (sessionStates.size > SESSION_LIMIT) {
        const oldest = sessionStates.keys().next();
        if (oldest.done) break;
        sessionStates.delete(oldest.value);
    }
}

// ---------------------------------------------------------------- motion

/**
 * How long a chart's last picture waits for its block to come back: Live
 * Preview shows the source while the cursor is in the block and draws the
 * chart again when it leaves.
 */
const MOTION_MEMORY_MS = 10 * 60 * 1000;

/**
 * A chart's last picture, so the block's next drawing can move from it
 * (src/motion.ts). It holds data only: the chart itself is let go when its
 * block leaves the page.
 */
interface ChartMemory {
    /** The chart while it is on the page; null once its block was removed. */
    chart: InlineChart | null;
    /** The chart as text lines (JSON blocks printed as text), to find the same block again. */
    lines: string;
    state: Record<string, unknown>;
    names: Set<string>;
    at: number;
}

/** Most pictures kept per note. */
const MEMORY_PER_NOTE = 40;

/** Per note: the charts drawn lately. */
const chartMemory = new Map<string, ChartMemory[]>();

/** Charts in notes, so a theme change can redraw them (3D shading and mixed label inks use concrete colours). */
const liveCharts = new Set<InlineChart>();

/** Lines two block bodies share, as a share of the longer one (1: the same block). */
function sharedLines(a: string, b: string): number {
    const la = a.split('\n').map((l) => l.trim()).filter((l) => l);
    const lb = new Set(b.split('\n').map((l) => l.trim()).filter((l) => l));
    const n = Math.max(la.length, lb.size);
    return n ? la.filter((l) => lb.has(l)).length / n : 0;
}

/** A picture whose block has left the page. */
const gone = (m: ChartMemory) => !m.chart || !m.chart.onPage();

/** Drop the pictures that are too old, and the oldest beyond MEMORY_PER_NOTE. */
function pruneMemory(sourcePath: string) {
    const now = Date.now();
    const kept = (chartMemory.get(sourcePath) ?? []).filter((m) => !gone(m) || now - m.at < MOTION_MEMORY_MS);
    const away = kept.filter(gone).sort((a, b) => b.at - a.at).slice(MEMORY_PER_NOTE);
    const list = kept.filter((m) => !away.includes(m));
    if (list.length) chartMemory.set(sourcePath, list);
    else chartMemory.delete(sourcePath);
}

/**
 * The picture a chart that just appeared comes from: a chart of the same
 * note that has left the page, most like it. It is used up.
 */
function takePredecessor(sourcePath: string, chart: InlineChart, lines: string): ChartMemory | null {
    pruneMemory(sourcePath);
    const list = chartMemory.get(sourcePath) ?? [];
    let best: ChartMemory | null = null;
    let score = 0.34;
    for (const m of list) {
        if (m.chart === chart || !gone(m)) continue;
        const s = sharedLines(m.lines, lines);
        if (s >= score) {
            best = m;
            score = s;
        }
    }
    if (best) chartMemory.set(sourcePath, list.filter((m) => m !== best));
    return best;
}

/** FNV-1a over the UTF-16 code units, plus the length: a cheap, stable fingerprint. */
function hashText(text: string): string {
    let h = 0x811c9dc5;
    for (let i = 0; i < text.length; i++) {
        h ^= text.charCodeAt(i);
        h = Math.imul(h, 0x01000193);
    }
    return (h >>> 0).toString(36) + '.' + text.length.toString(36);
}

/**
 * Session key of a block: note path + hash of its chart data. The display
 * options are left out, so resizing or re-aligning the chart (which
 * rewrites the block) does not snap the sliders back.
 */
function sourceKey(sourcePath: string, data: Record<string, unknown>): string {
    const chart: Record<string, unknown> = { ...data };
    delete chart.displayWidth;
    delete chart.displayAlign;
    return sourcePath + '\n' + hashText(JSON.stringify(chart));
}

/** The fenced block exactly as the note stores it (trailing whitespace of the body dropped). */
function blockText(fenceTag: FenceTag, body: string): string {
    return '```' + fenceTag + '\n' + body.replace(/\s+$/, '') + '\n```';
}

function isDraft(value: unknown): value is ChartDraft {
    if (!value || typeof value !== 'object') return false;
    const draft = value as Partial<ChartDraft>;
    return typeof draft.savedAt === 'number' && Number.isFinite(draft.savedAt) && !!draft.data && typeof draft.data === 'object';
}

/** Node's http module for the AI server, on a computer only: phones and tablets have no Node. */
async function loadHttp(): Promise<Http | null> {
    if (!Platform.isDesktop) return null;
    const http: unknown = await import('http');
    return http as Http;
}

function showBlockError(el: HTMLElement, message: string) {
    el.createDiv({ cls: 'tikz-block-error', text: message });
}

export default class EasyTikzPlugin extends Plugin implements PluginHost {
    data: PluginData = { ...DEFAULT_PLUGIN_DATA };
    /** The open "What's new" popup, closed when the plugin unloads. */
    private whatsNew: WhatsNewModal | null = null;
    private unloaded = false;

    async onload() {
        const stored = (await this.loadData()) as Partial<PluginData> | null;
        const storedTemplates = stored?.userTemplates;
        const storedDraft = stored?.draft;
        this.data = {
            ...DEFAULT_PLUGIN_DATA,
            ...(stored ?? {}),
            userTemplates: Array.isArray(storedTemplates) ? storedTemplates : [],
            // A damaged draft is dropped instead of offered for restore.
            draft: isDraft(storedDraft) ? storedDraft : null,
        };

        this.addRibbonIcon('square-function', 'Easy TikZ', () => {
            new TikzModal(this.app, this).open();
        });

        // Command palette entry so users who hide the ribbon (or prefer
        // Cmd/Ctrl+P) can still launch the editor. Reported in #2.
        this.addCommand({
            id: 'open-editor',
            name: 'Open editor',
            callback: () => {
                new TikzModal(this.app, this).open();
            },
        });

        // Render `easy-tikz` blocks inline via the same SVG renderers the
        // modal uses for its live preview: no external TeX engine needed.
        this.registerMarkdownCodeBlockProcessor('easy-tikz', (source, el, ctx) => {
            this.renderEasyTikzBlock(source, el, ctx);
        });

        // Optionally also render plain `tikz` blocks the same way. Off by
        // default to coexist with `obsidian-tikzjax` and friends.
        if (this.data.renderTikzBlocks) {
            this.registerMarkdownCodeBlockProcessor('tikz', (source, el, ctx) => {
                this.renderEasyTikzBlock(source, el, ctx, /* fromTikzTag */ true);
            });
        }

        this.addCommand({
            id: 'show-whats-new',
            name: "Show what's new in version 4",
            callback: () => this.showWhatsNew(),
        });

        this.addCommand({
            id: 'copy-ai-guide',
            name: 'Copy the guide for AI chats (ChatGPT, Claude, Gemini)',
            callback: () => void this.copyAiGuide(),
        });

        this.addSettingTab(new EasyTikzSettingTab(this.app, this));

        // Chart colours: the theme's or the export's (styles.css), in the main window and every popout.
        this.applyChartColours(activeDocument);
        this.registerEvent(this.app.workspace.on('window-open', (_w, win) => this.applyChartColours(win.document)));
        this.register(() => {
            for (const doc of this.colourDocs) doc.body.removeClass('etz-export-colours');
        });
        // A theme change: 2D charts follow by themselves; redraw for what holds concrete colours.
        this.registerEvent(
            this.app.workspace.on('css-change', () => {
                for (const chart of liveCharts) {
                    if (chart.onPage()) chart.redraw();
                    else liveCharts.delete(chart);
                }
            })
        );

        this.register(() => {
            this.unloaded = true;
            this.whatsNew?.close();
        });

        // The local AI server, when switched on (Settings > AI access).
        if (this.data.aiServer) this.app.workspace.onLayoutReady(() => void this.startAi());
        this.register(() => void this.stopAi());

        // "What's new" for people who updated (src/whatsnew.ts). Nothing is written during onload.
        const enabled = this.data.showWhatsNew !== false;
        if (shouldShowWhatsNew(stored, WHATS_NEW_VERSION, enabled)) {
            // Stored data without a record of the popup: an update.
            this.app.workspace.onLayoutReady(() => {
                if (!this.unloaded && !this.whatsNew) this.showWhatsNew();
            });
        } else if (needsVaultCheck(stored, WHATS_NEW_VERSION, enabled)) {
            // No stored data: a fresh install, or a 3.x user who never changed a setting. Charts in the vault tell.
            this.app.workspace.onLayoutReady(() => void this.checkEarlierUse(stored));
        } else if (!whatsNewSeen(stored, WHATS_NEW_VERSION)) {
            // Switched off: recorded in memory only; the next save of any kind (a setting, a draft) stores it.
            this.data.whatsNewSeen = WHATS_NEW_VERSION;
        }
    }

    /**
     * No stored data at this load: show the popup if the vault holds an
     * easy-tikz block from before (most 3.x users), otherwise record it as
     * seen (a fresh install). Runs once: the record creates data.json.
     */
    private async checkEarlierUse(stored: unknown) {
        // A data file that exists but could not be read stays on disk as it is: only the popup (if any) writes.
        const unreadable = await this.dataFileExists();
        let used = false;
        try {
            used = await this.vaultHasCharts();
        } catch {
            // Unknown: treated as a fresh install.
        }
        if (this.unloaded || whatsNewSeen(this.data, WHATS_NEW_VERSION)) return;
        if (shouldShowWhatsNew(stored, WHATS_NEW_VERSION, this.data.showWhatsNew !== false, used)) {
            if (!this.whatsNew) this.showWhatsNew();
            return;
        }
        if (unreadable) this.data.whatsNewSeen = WHATS_NEW_VERSION;
        else await this.markWhatsNewSeen();
    }

    /** The vault holds at least one easy-tikz block. Reads notes most likely to hold one first, and stops at the first. */
    private async vaultHasCharts(): Promise<boolean> {
        const { vault, metadataCache } = this.app;
        const ranked: Array<{ file: TFile; rank: number }> = [];
        for (const file of vault.getMarkdownFiles()) {
            const cache = metadataCache.getFileCache(file);
            const rank = chartScanRank(cache ? (cache.sections ?? []).map((s) => s.type) : null);
            if (rank > 0) ranked.push({ file, rank });
        }
        ranked.sort((a, b) => b.rank - a.rank || b.file.stat.mtime - a.file.stat.mtime);
        for (const { file } of ranked) {
            if (this.unloaded) return false;
            let text = '';
            try {
                text = await vault.cachedRead(file);
            } catch {
                continue;
            }
            if (hasEasyTikzBlock(text)) return true;
        }
        return false;
    }

    /** The plugin's data.json exists (loadData returns null for a missing file and for one it cannot read). */
    private async dataFileExists(): Promise<boolean> {
        const dir = this.manifest.dir;
        if (!dir) return false;
        try {
            return await this.app.vault.adapter.exists(normalizePath(`${dir}/data.json`));
        } catch {
            return false;
        }
    }

    /**
     * Open the "What's new" popup. `actions` lets the editor's Help tab keep
     * the popup's buttons in that editor; by default they open a new editor.
     */
    showWhatsNew(actions?: WhatsNewActions) {
        this.whatsNew?.close();
        const modal = new WhatsNewModal(this.app, {
            actions: actions ?? {
                tryExample: (chart) => {
                    const editor = new TikzModal(this.app, this);
                    editor.open();
                    editor.loadChart(chart);
                },
                openGuides: (guideId) => {
                    const editor = new TikzModal(this.app, this);
                    editor.open();
                    editor.openHelp(guideId);
                },
                openAi: () => {
                    const editor = new TikzModal(this.app, this);
                    editor.open();
                    editor.openAi();
                },
            },
            // Seen as soon as it opens, so a crash or a quick close never shows it twice.
            onShown: () => void this.markWhatsNewSeen(),
            onClosed: () => {
                if (this.whatsNew === modal) this.whatsNew = null;
            },
        });
        this.whatsNew = modal;
        modal.open();
    }

    private async markWhatsNewSeen() {
        if (whatsNewSeen(this.data, WHATS_NEW_VERSION)) return;
        this.data.whatsNewSeen = WHATS_NEW_VERSION;
        try {
            await this.saveSettings();
        } catch {
            // Not saved: the popup may show once more after the next start, nothing worse.
        }
    }

    /** Documents (main window, popouts) that carry the chart colour class. */
    private colourDocs = new Set<Document>();

    applyChartColours(doc?: Document) {
        if (doc) this.colourDocs.add(doc);
        for (const d of this.colourDocs) d.body.toggleClass('etz-export-colours', this.data.chartColours === 'export');
    }

    /** The running AI server, or null. */
    aiServer: AiServer | null = null;
    /** Why the AI server is not running although it is switched on (shown in the settings), or ''. */
    aiStatus = '';

    /** Starts and stops of the AI server run one after another (a fast double click on the switch must not leave one running). */
    private aiChain: Promise<void> = Promise.resolve();

    private aiStep(step: () => Promise<void>): Promise<void> {
        const next = this.aiChain.then(step, step);
        this.aiChain = next.catch(() => undefined);
        return next;
    }

    /** Start (or restart) the local AI server (src/ai/server.ts) with the stored port and token, fixing them first when they are not valid. */
    startAi(): Promise<void> {
        return this.aiStep(async () => {
            await this.closeAi();
            if (!this.data.aiServer || this.unloaded) return;
            let changed = false;
            if (!/^[0-9a-f]{32}$/.test(this.data.aiToken || '')) {
                this.data.aiToken = newToken();
                changed = true;
            }
            if (!Number.isInteger(this.data.aiPort) || this.data.aiPort < 1024 || this.data.aiPort > 65535) {
                this.data.aiPort = DEFAULT_PLUGIN_DATA.aiPort;
                changed = true;
            }
            if (changed) await this.saveSettings();
            const http = await loadHttp();
            if (!http) {
                this.aiStatus = 'AI apps connect to Obsidian on a computer; phones and tablets have no AI server.';
                return;
            }
            const server = new AiServer(new VaultChartHost(this.app, this.manifest.version, () => this.data.blockFormat), { port: this.data.aiPort, token: this.data.aiToken }, http);
            try {
                await server.start();
            } catch (e) {
                this.aiStatus = errorText(e);
                new Notice(`Easy TikZ could not start the AI server: ${this.aiStatus}`);
                return;
            }
            // Switched off or unloaded while it started: it does not stay up.
            if (!this.data.aiServer || this.unloaded) {
                await server.stop();
                return;
            }
            this.aiServer = server;
            this.aiStatus = '';
        });
    }

    stopAi(): Promise<void> {
        return this.aiStep(() => this.closeAi());
    }

    private async closeAi(): Promise<void> {
        const server = this.aiServer;
        this.aiServer = null;
        if (server) await server.stop();
    }

    aiInfo(): { enabled: boolean; running: boolean; port: number; token: string; message: string } {
        return { enabled: this.data.aiServer, running: !!this.aiServer, port: this.data.aiPort, token: this.data.aiToken, message: this.aiStatus };
    }

    async setAiServer(on: boolean): Promise<void> {
        this.data.aiServer = on;
        await this.saveSettings();
        if (on) await this.startAi();
        else await this.stopAi();
    }

    async newAiToken(): Promise<void> {
        this.data.aiToken = newToken();
        await this.saveSettings();
        if (this.data.aiServer) await this.startAi();
    }

    aiGuideText(): string {
        return AI_GUIDE;
    }

    /** The AI guide (docs/ai.md) on the clipboard, for chats that cannot reach the AI server. */
    async copyAiGuide(): Promise<void> {
        try {
            await navigator.clipboard.writeText(AI_GUIDE);
            new Notice('Easy TikZ: the AI guide is on the clipboard. Paste it into your AI chat, then describe the chart you want.');
        } catch (e) {
            new Notice(`Could not copy the guide: ${errorText(e)}`);
        }
    }

    /** Add (or refresh) the Easy TikZ section of AGENTS.md and CLAUDE.md at the vault root, which AI agents read. */
    async writeAgentFiles(): Promise<string[]> {
        const section = agentsSection(this.app.vault.configDir, this.data.aiPort, this.manifest.version);
        const written: string[] = [];
        for (const name of ['AGENTS.md', 'CLAUDE.md']) {
            const file = this.app.vault.getAbstractFileByPath(name);
            if (file instanceof TFile) await this.app.vault.process(file, (old) => mergeAgentsSection(old, section));
            else await this.app.vault.create(name, mergeAgentsSection('', section));
            written.push(name);
        }
        return written;
    }

    async saveUserTemplates(templates: UserTemplate[]) {
        this.data.userTemplates = templates;
        await this.saveData(this.data);
    }

    async saveSettings() {
        await this.saveData(this.data);
    }

    /**
     * Render an `easy-tikz` code block inline. JSON problems (and raw
     * TikZ in a plain `tikz` block) get an error block; everything else
     * becomes an InlineChart: the chart (click to edit), a muted line
     * for render problems and, when the chart has parameters, a strip of
     * live sliders under it.
     */
    private renderEasyTikzBlock(source: string, el: HTMLElement, ctx: MarkdownPostProcessorContext, fromTikzTag = false) {
        const trimmed = source.trim();
        // Plain `tikz` blocks that aren't JSON (real LaTeX) shouldn't
        // crash. Show a helpful note instead.
        if (fromTikzTag && !trimmed.startsWith('{')) {
            showBlockError(
                el,
                'This looks like raw TikZ / pgfplots code rather than an Easy TikZ JSON block. ' +
                    'Install obsidian-tikzjax (or similar) to render it, or recreate the chart via the Easy TikZ modal.'
            );
            return;
        }
        // Untrimmed: problems of a text block name the lines as the note shows them.
        const block = readBlock(fromTikzTag ? trimmed : source);
        if (typeof block === 'string') {
            showBlockError(el, 'Easy TikZ render error: ' + block);
            return;
        }
        const chart = new InlineChart(this, el, ctx.sourcePath, source, block.data, fromTikzTag ? 'tikz' : 'easy-tikz', block.format, block.problems);
        chart.mount();
        // When Obsidian removes the block (re-render, Live Preview, closing the note), the chart lets go of its picture.
        const child = new MarkdownRenderChild(el);
        child.register(() => chart.unload());
        ctx.addChild(child);
    }

    /**
     * Open the editor pre-filled with a block's settings. The raw block
     * text lets the modal locate and replace the block by content match
     * (more robust than line numbers when other parts of the file were
     * edited meanwhile).
     */
    openBlockEditor(sourcePath: string, source: string, data: Record<string, unknown>, fenceTag: FenceTag, format: BlockFormat) {
        const file = this.app.vault.getAbstractFileByPath(sourcePath);
        new TikzModal(this.app, this, {
            // A copy: the editor must never change the object the note's display patches start from.
            data: cloneData(data),
            sourceFile: file instanceof TFile ? file : null,
            originalBlockText: blockText(fenceTag, source),
            fenceTag,
            blockFormat: format,
        }).open();
    }

    /**
     * Merge a display patch (width / alignment) into the block's JSON and
     * write the file. The markdown post-processor then re-renders the
     * block from the new source; slider positions survive (see sourceKey).
     * Returns the new block body, or null (after a Notice) when nothing
     * was saved.
     */
    async persistDisplayPatch(
        sourcePath: string,
        fenceTag: FenceTag,
        source: string,
        patch: Partial<{ displayWidth: number; displayAlign: Align }>
    ): Promise<string | null> {
        const notFound = () => {
            new Notice(
                'Easy TikZ could not find this chart in the note (it may be inside a callout, use a ~~~ fence, or have been edited), ' +
                    'so its width and alignment were not saved.'
            );
            return null;
        };
        const file = this.app.vault.getAbstractFileByPath(sourcePath);
        if (!(file instanceof TFile)) return notFound();
        // Re-parse the source so the patch starts from exactly what the note holds.
        const block = readBlock(source);
        if (typeof block === 'string') return notFound();
        // A text block keeps its lines: only the display line changes or is added.
        const body =
            block.format === 'text'
                ? writeChartText(source.replace(/\s+$/, ''), { ...block.data, ...patch })
                : JSON.stringify({ ...block.data, ...patch }, null, 2);
        const original = blockText(fenceTag, source);
        const updated = blockText(fenceTag, body);
        let found = false;
        try {
            await this.app.vault.process(file, (content) => {
                // Index arithmetic, not String.replace: '$$' or "$'" in a label would be read as a replacement pattern.
                const at = content.indexOf(original);
                found = at >= 0;
                return at < 0 ? content : content.slice(0, at) + updated + content.slice(at + original.length);
            });
        } catch (e) {
            new Notice(`Could not save the chart width or alignment: ${errorText(e)}`);
            return null;
        }
        return found ? body : notFound();
    }
}

/**
 * One rendered block. Owns its SceneCache, so slider drags only recompute
 * the tools that depend on the dragged parameter. Its MathContext comes
 * from SettingsManager.createMathContext, which MathContext.create
 * memoizes by structure: blocks with the same structure (and an editor
 * open on this block) share one instance, so every evaluation must call
 * math.setParams(this.params) first (render() does). Scene caches stay
 * correct because their dependency keys embed parameter values. Layout:
 *
 *   .etz-inline (outer wrapper, width only, alignment)
 *     .etz-inline-stage
 *       .tikz-rendered-chart.etz-inline-box (aspect-sized; click / Enter / Space opens the editor)
 *       .tikz-rendered-controls (align buttons + width slider over the box, on hover)
 *     .etz-inline-issues (muted problem line)
 *     .etz-inline-strip (parameter sliders; keeps its events to itself)
 */
class InlineChart {
    private readonly plugin: EasyTikzPlugin;
    private readonly el: HTMLElement;
    private readonly sourcePath: string;
    /** Block body as the note holds it (updated after a display patch is saved). */
    private source: string;
    private readonly data: Record<string, unknown>;
    private readonly fenceTag: FenceTag;
    private readonly format: BlockFormat;
    /** Problems of a text block, with their line and column; shown before the chart's own. */
    private readonly textProblems: SceneIssue[];
    private readonly key: string;

    private manager!: SettingsManager;
    private math!: MathContext;
    private readonly cache = new SceneCache();
    private renderer3d: SVG3DRenderer | null = null;

    /** Parameters as stored in the block, and as currently shown. */
    private saved: Parameter[] = [];
    private params: Parameter[] = [];
    private sliders: LiveSliderHandle[] = [];
    private resetButton: IconButtonHandle | null = null;
    private expanded = false;

    private wrapper!: HTMLElement;
    /** Positions the overlay controls over the box without nesting them in its role=button. */
    private stage!: HTMLElement;
    private box!: HTMLElement;
    private issuesEl!: HTMLElement;
    /** The drawn chart: an <svg> (2D) or the 3D renderer's root. */
    private chartEl: Element | null = null;
    private width = 0;
    private aspect = 0;
    /** Content box of the chart box in CSS px, measured on full renders (draft frames reuse it). */
    private boxSize = { w: 0, h: 0 };

    private frameRaf: number | null = null;
    private fullTimer: number | null = null;
    /** Redraws in a row that a new `$...$` label asked for (see render2D). */
    private mathRedraws = 0;

    /** Objects new to the picture pop in; null until the first drawing. */
    private popIn: PopIn | null = null;
    private glideRaf: number | null = null;
    /** This chart's entry in chartMemory. */
    private memory: ChartMemory | null = null;

    constructor(
        plugin: EasyTikzPlugin,
        el: HTMLElement,
        sourcePath: string,
        source: string,
        data: Record<string, unknown>,
        fenceTag: FenceTag,
        format: BlockFormat,
        problems: TextProblem[]
    ) {
        this.plugin = plugin;
        this.el = el;
        this.sourcePath = sourcePath;
        this.source = source;
        this.data = data;
        this.fenceTag = fenceTag;
        this.format = format;
        this.textProblems = problems.map((p) => ({ source: `Line ${p.line}, column ${p.column}`, message: p.message, severity: 'error' }));
        this.key = sourceKey(sourcePath, data);
    }

    mount() {
        try {
            // fromJSON migrates 3.x blocks; it gets a copy so `data` stays the block's own JSON.
            this.manager = SettingsManager.fromJSON(cloneData(this.data));
            this.math = this.manager.createMathContext();
        } catch (e) {
            showBlockError(this.el, 'Easy TikZ render error: ' + errorText(e));
            return;
        }
        this.saved = normalizeParameters(this.manager.getValue('parameters'));
        const session = sessionGet(this.key);
        this.expanded = !!session && session.expanded;
        this.params = this.saved.map((p) => {
            const v = session ? session.values[p.name] : undefined;
            return typeof v === 'number' && Number.isFinite(v) ? { ...p, value: v } : { ...p };
        });

        const align = this.data.displayAlign;
        this.wrapper = this.el.createDiv({ cls: 'etz-inline' });
        this.applyAlign(align === 'left' || align === 'right' ? align : 'center');
        this.stage = this.wrapper.createDiv({ cls: 'etz-inline-stage' });
        this.box = this.stage.createDiv({ cls: 'tikz-rendered-chart etz-inline-box' });
        this.box.setAttr('role', 'button');
        this.box.setAttr('tabindex', '0');
        // aria-labelledby, not aria-label: Obsidian shows a tooltip for every [aria-label] element.
        const name = visuallyHidden(this.box, 'Easy TikZ chart. Click to edit.');
        name.id = uniqueId('inline-chart');
        this.box.setAttr('aria-labelledby', name.id);
        this.issuesEl = this.wrapper.createDiv({ cls: 'etz-inline-issues tikz-hidden' });

        try {
            this.render('full');
        } catch (e) {
            // Nothing was drawn, so there is no partial chart to keep.
            this.wrapper.remove();
            showBlockError(this.el, 'Easy TikZ render error: ' + errorText(e));
            return;
        }

        this.buildHoverControls();
        this.buildStrip();

        liveCharts.add(this);
        // What is there at first sight never pops in; a block that comes back moves from its last picture.
        this.popIn = new PopIn(drawnNames(this.chartEl));
        if (this.plugin.data.animateCharts !== false) {
            this.remember();
            window.requestAnimationFrame(() => this.moveFromBefore());
        }

        this.box.addEventListener('click', () => this.openEditor());
        this.box.addEventListener('keydown', (e: KeyboardEvent) => {
            // Only the focused box itself opens the editor, never keys meant for a control.
            if (e.target !== this.box) return;
            if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                this.openEditor();
            }
        });
    }

    private openEditor() {
        this.plugin.openBlockEditor(this.sourcePath, this.source, this.data, this.fenceTag, this.format);
    }

    // ------------------------------------------------------------ rendering

    /**
     * Draw the chart with the current slider values. Draft frames use the
     * coarse grid (2D) or the canvas (3D) and leave the problem line alone.
     * Throws only when the very first render fails (mount shows an error
     * block then); later failures keep the last drawing and report through
     * the problem line.
     */
    private render(quality: 'draft' | 'full') {
        if (quality === 'full') this.cancelFrames();
        let issues: SceneIssue[];
        try {
            const math = this.math;
            math.setParams(this.params);
            // Ranges may use parameters, so the config is rebuilt every frame.
            const config = this.manager.toRendererConfig(math);
            config.parameters = this.params;
            this.applySize(config);
            issues = config.is3D ? this.render3D(config, math, quality) : this.render2D(config, math, quality);
            // Hidden tools that nothing reads affect nothing: no problem line for them.
            issues = issues.filter((i) => !i.hiddenSource);
            if (quality === 'full') issues = mergeViewErrors(issues, () => this.manager.resolveView(math).errors, config.is3D).concat(math.parameterIssues());
        } catch (e) {
            if (!this.chartEl) throw e;
            issues = [{ source: 'chart', message: `Preview failed: ${errorText(e)}`, severity: 'error' }];
        }
        this.popIn?.apply(this.chartEl, this.animated());
        if (quality === 'full') {
            this.showIssues(issues);
            if (this.memory) this.remember();
        }
    }

    // --------------------------------------------------------------- motion

    onPage(): boolean {
        return !!this.wrapper && this.wrapper.isConnected;
    }

    /** Draw again as it is (the theme changed). */
    redraw() {
        this.stopGlide();
        this.render('full');
    }

    private animated(): boolean {
        return this.plugin.data.animateCharts !== false && !reducedMotion();
    }

    /** The chart as drawn now: the block's chart with the slider values shown. */
    private state(): Record<string, unknown> {
        return { ...this.manager.serialize(), parameters: this.params.map((p) => ({ ...p })) };
    }

    /** The block as text lines: a text block as written, a JSON block printed (its boilerplate would make any two look alike). */
    private lines(): string {
        if (this.format === 'text') return this.source;
        try {
            return printChartText(this.data);
        } catch {
            return this.source;
        }
    }

    /** Keep this chart's last picture for the block's next drawing. */
    private remember() {
        const entry: ChartMemory = { chart: this, lines: this.memory ? this.memory.lines : this.lines(), state: this.state(), names: drawnNames(this.chartEl), at: Date.now() };
        if (this.memory) Object.assign(this.memory, entry);
        else {
            this.memory = entry;
            const list = chartMemory.get(this.sourcePath) ?? [];
            list.push(entry);
            chartMemory.set(this.sourcePath, list);
        }
    }

    /** The block left the page: stop drawing, and keep only the picture's data for the block's next drawing. */
    unload() {
        this.stopGlide();
        this.cancelFrames();
        liveCharts.delete(this);
        if (this.memory) {
            this.memory.chart = null;
            this.memory.at = Date.now();
        }
        this.renderer3d = null;
        this.chartEl = null;
    }

    /** The block was drawn before and has come back: glide from that picture; what is new pops in. */
    private moveFromBefore() {
        if (!this.onPage() || !this.animated()) return;
        const before = takePredecessor(this.sourcePath, this, this.memory ? this.memory.lines : this.lines());
        if (!before) return;
        this.popIn = new PopIn(before.names);
        const to = this.state();
        if (glides(before.state, to)) this.glide(before.state, to);
        else this.popIn.apply(this.chartEl);
    }

    private glide(from: Record<string, unknown>, to: Record<string, unknown>) {
        this.stopGlide();
        const start = performance.now();
        // Glide frames have their own cache, so the chart's stays as the block draws it.
        const cache = new SceneCache();
        const frame = () => {
            this.glideRaf = null;
            if (!this.onPage()) return;
            const k = (performance.now() - start) / GLIDE_MS;
            if (k >= 1) {
                this.render('full');
                return;
            }
            this.drawState(mixCharts(from, to, ease(k)), cache);
            this.glideRaf = window.requestAnimationFrame(frame);
        };
        frame();
    }

    private stopGlide() {
        if (this.glideRaf !== null) window.cancelAnimationFrame(this.glideRaf);
        this.glideRaf = null;
    }

    /** One frame of a glide: the chart `state` stands for, in draft quality. */
    private drawState(state: Record<string, unknown>, cache: SceneCache) {
        try {
            const manager = SettingsManager.fromJSON(cloneData(state));
            const math = manager.createMathContext({ memo: false });
            const params = normalizeParameters(manager.getValue('parameters'));
            math.setParams(params);
            const config = manager.toRendererConfig(math);
            config.parameters = params;
            this.applySize(config);
            if (config.is3D) this.render3D(config, math, 'draft');
            else this.render2D(config, math, 'draft', cache);
        } catch {
            // A frame that cannot be drawn is skipped; the last one stays.
        }
        this.popIn?.apply(this.chartEl, this.animated());
    }

    private render2D(config: RendererConfig, math: MathContext, quality: 'draft' | 'full', cache: SceneCache = this.cache): SceneIssue[] {
        // Grid cells in on-screen px: measured on full renders only, never per drag frame.
        if ((quality === 'full' || !this.boxSize.w) && this.box.isConnected) {
            this.boxSize = { w: this.box.clientWidth, h: this.box.clientHeight };
        }
        const pixelScale = fitPixelScale(this.boxSize.w, this.boxSize.h, config.width, config.height);
        const renderer = new SVGRenderer(config, { math, cache, quality, pixelScale });
        const svg = renderer.render();
        svg.addClass('etz-inline-svg');
        this.placeChart(svg);
        // A new `$...$` label is measured before MathJax has styled it: draw once more when it has.
        void renderer.mathSettled?.then((redraw) => {
            if (!redraw) this.mathRedraws = 0;
            else if (this.chartEl === svg && svg.isConnected && this.mathRedraws < MATH_REDRAW_LIMIT) {
                this.mathRedraws++;
                this.render('full');
            }
        });
        return renderer.issues;
    }

    /**
     * Notes show the renderer's SVG at rest (crisp, selectable). Slider
     * drafts paint the canvas instead: the SVG path rewrites one <path> per
     * surface quad, which costs several times the JS and a style recalc
     * per frame. The class flips only after a render succeeded, so a
     * failing frame never uncovers a stale picture; a full render follows
     * every drag (release, or the pause timer).
     */
    private render3D(config: RendererConfig, math: MathContext, quality: 'draft' | 'full'): SceneIssue[] {
        if (!this.renderer3d) this.renderer3d = new SVG3DRenderer();
        const root = this.renderer3d.getElement();
        this.placeChart(root);
        if (quality === 'draft') {
            this.renderer3d.renderCanvas(config, { math });
            root.addClass('etz-inline-drafting');
        } else {
            this.renderer3d.renderSvg(config, { math });
            root.removeClass('etz-inline-drafting');
        }
        return this.renderer3d.issues;
    }

    /** Put the chart first in the box (the overlay controls follow it). */
    private placeChart(chart: Element) {
        if (this.chartEl === chart) return;
        if (this.chartEl && this.chartEl.parentElement === this.box) this.chartEl.replaceWith(chart);
        else this.box.prepend(chart);
        this.chartEl = chart;
    }

    /**
     * Box aspect from the configured export size; wrapper width from the
     * block's saved displayWidth, else the chart's own width. CSS caps the
     * wrapper at the note width, so narrow panes shrink the chart.
     */
    private applySize(config: RendererConfig) {
        const aspect = config.width > 0 && config.height > 0 ? config.width / config.height : 1.5;
        if (aspect !== this.aspect) {
            this.aspect = aspect;
            this.box.setCssProps({ '--etz-inline-aspect': String(aspect) });
        }
        if (!this.width) {
            const saved = this.data.displayWidth;
            const natural = typeof saved === 'number' && Number.isFinite(saved) ? saved : config.width;
            this.setWidth(natural);
        }
    }

    private setWidth(width: number) {
        this.width = Math.round(Math.max(MIN_NOTE_WIDTH, Math.min(MAX_NOTE_WIDTH, width)));
        this.wrapper.setCssProps({ '--etz-inline-width': `${this.width}px` });
    }

    /**
     * Muted line under the chart: '2 problems: R1 condition 2: ...' (the
     * full list in the tooltip). Info notes (unbounded optimum, empty
     * region) show without a count when there is no error.
     */
    private showIssues(chartIssues: SceneIssue[]) {
        const issues = this.textProblems.concat(chartIssues);
        const errors = issues.filter((i) => i.severity === 'error');
        const ordered = errors.concat(issues.filter((i) => i.severity !== 'error'));
        this.issuesEl.toggleClass('tikz-hidden', ordered.length === 0);
        this.issuesEl.toggleClass('is-error', errors.length > 0);
        if (!ordered.length) {
            this.issuesEl.empty();
            this.issuesEl.removeAttribute('title');
            return;
        }
        const first = issueText(ordered[0]);
        const count = errors.length === 1 ? '1 problem' : `${errors.length} problems`;
        this.issuesEl.setText(errors.length ? `${count}: ${first}` : first);
        this.issuesEl.setAttr('title', ordered.map((i) => issueText(i)).join('\n'));
    }

    // -------------------------------------------------------------- sliders

    /** Slider drag: draft frame on the next animation frame, full quality after a pause. */
    private requestFrame() {
        if (this.frameRaf === null) {
            this.frameRaf = window.requestAnimationFrame(() => {
                this.frameRaf = null;
                this.render('draft');
            });
        }
        if (this.fullTimer !== null) window.clearTimeout(this.fullTimer);
        this.fullTimer = window.setTimeout(() => {
            this.fullTimer = null;
            this.render('full');
        }, FULL_RENDER_DELAY_MS);
    }

    private cancelFrames() {
        if (this.frameRaf !== null) window.cancelAnimationFrame(this.frameRaf);
        if (this.fullTimer !== null) window.clearTimeout(this.fullTimer);
        this.frameRaf = this.fullTimer = null;
    }

    /**
     * Always-visible slider rows under the chart (when the chart has
     * parameters and 'Show sliders in note' is on): name, live slider,
     * editable value; up to STRIP_ROWS rows, then "Show N more".
     */
    private buildStrip() {
        if (!this.params.length || this.manager.getValue('showSlidersInNote') === false) return;
        const strip = this.wrapper.createDiv({ cls: 'etz-inline-strip etz-tokens' });
        // Keep pointer and key events inside the strip: Live Preview would
        // otherwise move the cursor into the block source mid-drag.
        for (const type of ['pointerdown', 'mousedown', 'click', 'keydown']) {
            strip.addEventListener(type, (e) => e.stopPropagation());
        }
        const name = visuallyHidden(strip, 'Chart sliders');
        name.id = uniqueId('inline-sliders');
        strip.setAttr('role', 'group');
        strip.setAttr('aria-labelledby', name.id);

        const rows = strip.createDiv({ cls: 'etz-inline-rows' });
        const extraRows: HTMLElement[] = [];
        this.sliders = this.params.map((p, i) => {
            const row = rows.createDiv({ cls: 'etz-inline-row' });
            row.createSpan({ cls: 'etz-inline-name', text: p.name, attr: { 'aria-hidden': 'true', title: p.name } });
            if (i >= STRIP_ROWS) extraRows.push(row);
            return liveSlider(row, {
                min: p.min,
                max: p.max,
                step: p.step,
                value: p.value,
                label: p.name,
                readout: 'input',
                onInput: (v) => this.setParam(i, v),
                // Release or a typed value: draw full quality now instead of after the pause.
                onCommit: () => this.render('full'),
            });
        });

        if (extraRows.length) {
            const more = textButton(rows, { text: '', variant: 'link', size: 'sm', cls: 'etz-inline-more' });
            const sync = () => {
                for (const row of extraRows) row.toggleClass('tikz-hidden', !this.expanded);
                more.setText(this.expanded ? 'Show less' : `Show ${extraRows.length} more`);
                more.el.setAttr('aria-expanded', String(this.expanded));
            };
            more.el.addEventListener('click', () => {
                this.expanded = !this.expanded;
                sync();
                this.storeSession();
            });
            sync();
        }

        this.resetButton = iconButton(strip, {
            icon: 'rotate-ccw',
            label: 'Reset sliders to the saved values',
            size: 'sm',
            cls: 'etz-inline-reset',
            onClick: () => this.resetParams(),
        });
        this.updateReset();
    }

    private setParam(index: number, value: number) {
        this.stopGlide();
        this.params[index] = { ...this.params[index], value };
        this.storeSession();
        this.updateReset();
        this.requestFrame();
    }

    private resetParams() {
        const hadFocus = !!this.resetButton && activeDocument.activeElement === this.resetButton.el;
        this.params = this.saved.map((p) => ({ ...p }));
        this.params.forEach((p, i) => this.sliders[i]?.setValue(p.value));
        this.storeSession();
        this.updateReset();
        // The button is disabled now; keep keyboard users in the strip.
        if (hadFocus) this.sliders[0]?.input.focus();
        this.render('full');
    }

    private isModified(): boolean {
        return this.params.some((p, i) => !Object.is(p.value, this.saved[i].value));
    }

    private updateReset() {
        this.resetButton?.setDisabled(!this.isModified());
    }

    private storeSession() {
        const values: Record<string, number> = {};
        this.params.forEach((p, i) => {
            if (!Object.is(p.value, this.saved[i].value)) values[p.name] = p.value;
        });
        const empty = Object.keys(values).length === 0 && !this.expanded;
        sessionSet(this.key, empty ? null : { values, expanded: this.expanded });
    }

    // ------------------------------------------------------- hover controls

    private applyAlign(align: Align) {
        this.wrapper.removeClass('align-left', 'align-center', 'align-right');
        this.wrapper.addClass('align-' + align);
    }

    /**
     * Floating overlay controls on the chart: align buttons on the left,
     * width slider along the bottom; both fade in on hover / focus via
     * CSS. They are siblings of the box, not children, so the box's
     * role=button has no interactive content. The width slider resizes
     * live on input and writes `displayWidth` to the block on release
     * (one file write per drag); align clicks save immediately. Their
     * events stop here, so Live Preview does not move the cursor either.
     */
    private buildHoverControls() {
        let align: Align = this.wrapper.hasClass('align-left') ? 'left' : this.wrapper.hasClass('align-right') ? 'right' : 'center';
        let savedWidth = this.width;
        /** Save the patch; on failure (a Notice says why) the chart goes back to what the note holds. */
        const persist = (patch: Partial<{ displayWidth: number; displayAlign: Align }>) => {
            void this.plugin.persistDisplayPatch(this.sourcePath, this.fenceTag, this.source, patch).then((body) => {
                if (body !== null) {
                    this.source = body;
                    Object.assign(this.data, patch);
                    if (patch.displayAlign) align = patch.displayAlign;
                    if (patch.displayWidth !== undefined) savedWidth = patch.displayWidth;
                    return;
                }
                if (patch.displayAlign) this.applyAlign(align);
                if (patch.displayWidth !== undefined) {
                    this.setWidth(savedWidth);
                    syncRange();
                }
            });
        };
        const stop = (e: Event) => e.stopPropagation();

        const alignBar = this.stage.createDiv({ cls: 'tikz-rendered-controls tikz-rendered-align' });
        const makeAlignBtn = (key: Align, icon: string, label: string) => {
            const btn = alignBar.createEl('button', { cls: 'tikz-rendered-btn', attr: { type: 'button', 'aria-label': label } });
            setIcon(btn, icon);
            btn.addEventListener('click', () => {
                this.applyAlign(key);
                persist({ displayAlign: key });
            });
        };
        makeAlignBtn('left', 'align-left', 'Align left');
        makeAlignBtn('center', 'align-center', 'Center');
        makeAlignBtn('right', 'align-right', 'Align right');

        const sizeBar = this.stage.createDiv({ cls: 'tikz-rendered-controls tikz-rendered-size' });
        const slider = sizeBar.createEl('input', {
            cls: 'tikz-rendered-slider',
            type: 'range',
            attr: { min: String(MIN_NOTE_WIDTH), step: '10', 'aria-label': 'Chart width' },
        });
        // The note width is only known once the block is in the document,
        // so the range is measured again when the slider is about to be used.
        const syncRange = () => {
            const available = this.wrapper.parentElement?.clientWidth || this.el.clientWidth || 0;
            const max = available > 0 ? Math.max(400, Math.min(MAX_NOTE_WIDTH, Math.round(available))) : Math.max(700, this.width);
            slider.max = String(max);
            // A saved width wider than the note is shown at the width the chart really has.
            slider.value = String(Math.min(this.width, max));
        };
        syncRange();
        for (const bar of [alignBar, sizeBar]) {
            for (const type of ['pointerdown', 'mousedown', 'click', 'keydown']) bar.addEventListener(type, stop);
        }
        slider.addEventListener('pointerdown', syncRange);
        slider.addEventListener('focus', syncRange);
        slider.addEventListener('input', () => this.setWidth(parseInt(slider.value, 10)));
        slider.addEventListener('change', () => persist({ displayWidth: this.width }));
    }
}

class EasyTikzSettingTab extends PluginSettingTab {
    private plugin: EasyTikzPlugin;

    constructor(app: App, plugin: EasyTikzPlugin) {
        super(app, plugin);
        this.plugin = plugin;
    }

    /**
     * Declarative settings (Obsidian 1.13+). The framework renders these
     * and indexes them for the settings search; values flow through
     * `getControlValue` / `setControlValue` below.
     */
    getSettingDefinitions(): SettingDefinitionItem[] {
        return [
            {
                name: 'Write new charts as',
                desc:
                    'Text (default): one line per object, the way the math reads, such as f(x) = x^2 | blue. ' +
                    'JSON: one object with every setting. A chart you edit keeps the format its block has.',
                control: { type: 'dropdown', key: 'blockFormat', options: { text: 'Text', json: 'JSON' }, defaultValue: 'text' },
            },
            {
                name: 'Chart colours',
                desc:
                    'From your theme (default): charts use the colours of your Obsidian theme and follow light and dark mode. ' +
                    'As in the LaTeX export: the fixed colours of the exported figure, so the note and the PDF look the same.',
                control: { type: 'dropdown', key: 'chartColours', options: { theme: 'From your theme', export: 'As in the LaTeX export' }, defaultValue: 'theme' },
            },
            {
                name: 'Animate chart changes',
                desc:
                    'On by default. When a block in a note changes, numbers glide to their new values and new objects pop in. ' +
                    'Charts never move when your system asks for reduced motion.',
                control: { type: 'toggle', key: 'animateCharts', defaultValue: true },
            },
            {
                name: 'Invert vertical drag in 3D',
                desc:
                    'Off (default): drag down tilts the scene up (camera elevation rises), drag up tilts the scene down - the trackball convention. ' +
                    'On: drag down lowers the camera, drag up raises it - direct manipulation.',
                control: { type: 'toggle', key: 'invertDrag3D', defaultValue: false },
            },
            {
                name: 'Max 3D samples per axis',
                desc:
                    'Upper bound of the Samples slider on each 3D surface card (default 80, at most 120). ' +
                    'The exported pgfplots code always uses at most 60 samples per axis, because pdflatex runs out of memory above that. ' +
                    'Re-open the Easy TikZ modal after changing this.',
                control: { type: 'slider', key: 'maxSamples3D', min: 40, max: 120, step: 10, defaultValue: 80 },
            },
            {
                name: '2D pan sensitivity',
                desc:
                    'Default 1.0 - direct manipulation: moving the mouse by N pixels pans the chart by exactly N chart pixels. ' +
                    'Lower values dampen the drag for finer control on dense plots (e.g. 0.5 = half-step pan); higher values overshoot. ' +
                    'The pan rate also scales with the current axis range, so this multiplier stays consistent as you zoom in or out.',
                control: { type: 'slider', key: 'dragSensitivity2D', min: 0.1, max: 2.0, step: 0.05, defaultValue: 1.0 },
            },
            {
                name: 'Also render plain `tikz` blocks',
                desc:
                    'Off by default. When on, the plugin renders blocks tagged plain ```tikz the same way it renders ```easy-tikz blocks. ' +
                    'Useful if you want one tag for everything, but conflicts with `obsidian-tikzjax` and other plugins that claim ```tikz. ' +
                    'Reload Obsidian after changing this for the registration to take effect.',
                control: { type: 'toggle', key: 'renderTikzBlocks', defaultValue: false },
            },
            {
                name: "Show what's new after updates",
                desc:
                    'On by default. After an update that brings something new, a short popup shows what changed, once. ' +
                    'The command "Show what\'s new in version 4" and the Help tab of the editor open it at any time.',
                control: { type: 'toggle', key: 'showWhatsNew', defaultValue: true },
            },
            {
                type: 'group',
                heading: 'AI access',
                items: [
                    // Phones and tablets have no AI server (no Node): only the guide and the agents' section.
                    ...(Platform.isDesktop
                        ? ([
                    {
                        name: 'Let AI apps make charts',
                        desc:
                            'Off by default. Starts a small server on this computer only (127.0.0.1) that AI apps such as Claude Code, Codex, Cursor or VS Code use to read the chart guide, check charts, see them and add them to your notes. ' +
                            'Every request needs the token below, web pages cannot use it, and it only adds Easy TikZ charts to notes or replaces them, never in files with instructions for AI agents. A notice shows each change, with Undo for changed notes.',
                        aliases: ['MCP', 'AI', 'Claude', 'ChatGPT', 'Codex', 'Cursor', 'server', 'port'],
                        control: { type: 'toggle', key: 'aiServer', defaultValue: false },
                    },
                    {
                        name: 'Status',
                        visible: () => this.plugin.data.aiServer,
                        render: (setting) => {
                            const running = this.plugin.aiServer;
                            setting.setDesc(
                                running ? `Running at ${mcpUrl(running.port)} (MCP) and http://127.0.0.1:${running.port}/guide.` : `Not running: ${this.plugin.aiStatus || 'starting...'}`
                            );
                            setting.addButton((b) =>
                                b.setButtonText('Restart').onClick(async () => {
                                    await this.plugin.startAi();
                                    this.update();
                                })
                            );
                        },
                    },
                    {
                        name: 'Port',
                        desc: 'Default 27150. After a change, update the address in your AI apps.',
                        visible: () => this.plugin.data.aiServer,
                        control: {
                            type: 'number',
                            key: 'aiPort',
                            min: 1024,
                            max: 65535,
                            step: 1,
                            defaultValue: 27150,
                            validate: (v) => (Number.isInteger(v) && v >= 1024 && v <= 65535 ? undefined : 'A whole number from 1024 to 65535.'),
                        },
                    },
                    {
                        name: 'Token',
                        visible: () => this.plugin.data.aiServer,
                        render: (setting) => {
                            const token = this.plugin.data.aiToken;
                            setting.setDesc(`${token ? `${token.slice(0, 4)}...${token.slice(-4)}` : '(made when the server starts)'}. Every request must carry it. Make a new one if it got out, then update your apps.`);
                            setting.addButton((b) => b.setButtonText('Copy').onClick(() => void copyText(token, 'Token copied.')));
                            setting.addButton((b) =>
                                b.setButtonText('New token').onClick(async () => {
                                    await this.plugin.newAiToken();
                                    this.update();
                                })
                            );
                        },
                    },
                    {
                        name: 'Connect an AI app',
                        desc: 'Pick your app and copy what it needs, once. The app then reads the guide, checks charts and adds them to your notes by itself.',
                        visible: () => this.plugin.data.aiServer,
                        render: (setting) => {
                            let app = AI_APPS[0];
                            const where = setting.descEl.createDiv({ cls: 'etz-ai-where' });
                            const snippet = setting.descEl.createEl('pre', { cls: 'etz-ai-snippet' });
                            const text = () => app.snippet(mcpUrl(this.plugin.data.aiPort), this.plugin.data.aiToken);
                            const refresh = () => {
                                where.setText(app.where);
                                // The token is masked on screen; Copy copies the real one.
                                snippet.setText(shownSnippet(app, mcpUrl(this.plugin.data.aiPort), this.plugin.data.aiToken));
                            };
                            setting.addDropdown((d) => {
                                for (const a of AI_APPS) d.addOption(a.id, a.name);
                                d.setValue(app.id).onChange((id) => {
                                    app = AI_APPS.find((a) => a.id === id) ?? AI_APPS[0];
                                    refresh();
                                });
                            });
                            setting.addButton((b) => b.setButtonText('Copy').setCta().onClick(() => void copyText(text(), `Copied for ${app.name}.`)));
                            refresh();
                        },
                    },
                          ] as SettingGroupItem[])
                        : []),
                    {
                        name: 'Tell AI agents in this vault',
                        desc: 'Adds a short Easy TikZ section to AGENTS.md and CLAUDE.md at the top of the vault (creating them if needed). Agents such as Claude Code, Codex, Cursor or Copilot read these files and then know how to make charts here, with or without the server.',
                        action: () => {
                            void this.plugin.writeAgentFiles().then(
                                (files) => new Notice(`Easy TikZ: added the chart section to ${files.join(' and ')}.`),
                                (e) => new Notice(`Could not write the agent files: ${errorText(e)}`)
                            );
                        },
                    },
                    {
                        name: 'Copy the guide for AI chats',
                        desc: 'For ChatGPT, Claude, Gemini or any chat that cannot reach this computer: paste the guide into the chat, describe your chart, and paste the block it writes into a note.',
                        action: () => void this.plugin.copyAiGuide(),
                    },
                ],
            },
        ];
    }

    getControlValue(key: string): unknown {
        return this.plugin.data[key as keyof PluginData];
    }

    async setControlValue(key: string, value: unknown): Promise<void> {
        switch (key) {
            case 'invertDrag3D':
                this.plugin.data.invertDrag3D = Boolean(value);
                break;
            case 'renderTikzBlocks':
                this.plugin.data.renderTikzBlocks = Boolean(value);
                break;
            case 'showWhatsNew':
                this.plugin.data.showWhatsNew = Boolean(value);
                break;
            case 'blockFormat':
                this.plugin.data.blockFormat = value === 'json' ? 'json' : 'text';
                break;
            case 'animateCharts':
                this.plugin.data.animateCharts = Boolean(value);
                break;
            case 'chartColours':
                this.plugin.data.chartColours = value === 'export' ? 'export' : 'theme';
                this.plugin.applyChartColours();
                break;
            case 'maxSamples3D':
                this.plugin.data.maxSamples3D = Number(value);
                break;
            case 'dragSensitivity2D':
                this.plugin.data.dragSensitivity2D = Number(value);
                break;
            case 'aiServer':
                await this.plugin.setAiServer(Boolean(value));
                this.update();
                return;
            case 'aiPort': {
                const port = Number(value);
                if (!Number.isInteger(port) || port < 1024 || port > 65535) return;
                this.plugin.data.aiPort = port;
                await this.plugin.saveSettings();
                if (this.plugin.data.aiServer) await this.plugin.startAi();
                this.update();
                return;
            }
            default:
                return;
        }
        await this.plugin.saveSettings();
    }
}

/** Put text on the clipboard and say so. */
async function copyText(text: string, done: string): Promise<void> {
    try {
        await navigator.clipboard.writeText(text);
        new Notice(done);
    } catch (e) {
        new Notice(`Could not copy: ${errorText(e)}`);
    }
}
