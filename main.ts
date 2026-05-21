import { App, MarkdownPostProcessorContext, Plugin, PluginSettingTab, Setting, TFile } from 'obsidian';
import { TikzModal } from './src/modal';
import { SettingsManager } from './src/settings';
import { SVGRenderer } from './src/renderer';
import { SVG3DRenderer } from './src/renderer3d';
import { DEFAULT_PLUGIN_DATA, PluginData, UserTemplate } from './src/templates';

export default class EasyTikzPlugin extends Plugin {
    data: PluginData = { ...DEFAULT_PLUGIN_DATA };

    async onload() {
        const stored = (await this.loadData()) as Partial<PluginData> | null;
        this.data = {
            ...DEFAULT_PLUGIN_DATA,
            ...(stored ?? {}),
            userTemplates: Array.isArray(stored?.userTemplates) ? stored!.userTemplates : [],
        };

        this.addRibbonIcon('square-function', 'Easy TikZ', () => {
            new TikzModal(this.app, this).open();
        });

        // Render `easy-tikz` blocks inline via the same SVG renderers the
        // modal uses for its live preview — no external TeX engine needed.
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

        this.addSettingTab(new EasyTikzSettingTab(this.app, this));
    }

    async saveUserTemplates(templates: UserTemplate[]) {
        this.data.userTemplates = templates;
        await this.saveData(this.data);
    }

    async saveSettings() {
        await this.saveData(this.data);
    }

    /**
     * Render an `easy-tikz` code block inline. Parses the JSON body,
     * feeds it into `SettingsManager.fromJSON`, and appends the SVG
     * (2D) or canvas-rendered SVG (3D) into the markdown container.
     * Wraps the chart in `.tikz-rendered-chart` so clicking it opens
     * the modal pre-filled with the same settings.
     */
    private renderEasyTikzBlock(
        source: string,
        el: HTMLElement,
        ctx: MarkdownPostProcessorContext,
        fromTikzTag = false
    ) {
        let data: Record<string, unknown>;
        try {
            const trimmed = source.trim();
            // Plain `tikz` blocks that aren't JSON (real LaTeX) shouldn't
            // crash. Show a helpful note instead.
            if (fromTikzTag && !trimmed.startsWith('{')) {
                const note = el.createDiv({ cls: 'tikz-block-error' });
                note.setText(
                    'This looks like raw TikZ / pgfplots code rather than an Easy TikZ JSON block. ' +
                        'Install obsidian-tikzjax (or similar) to render it, or recreate the chart via the Easy TikZ modal.'
                );
                return;
            }
            data = JSON.parse(trimmed) as Record<string, unknown>;
        } catch (e) {
            const err = el.createDiv({ cls: 'tikz-block-error' });
            err.setText('Easy TikZ render error: ' + (e instanceof Error ? e.message : 'invalid JSON'));
            return;
        }

        const wrapper = el.createDiv({ cls: 'tikz-rendered-chart' });
        wrapper.setAttr('role', 'button');
        wrapper.setAttr('tabindex', '0');
        wrapper.setAttr('aria-label', 'Easy TikZ chart. Click to edit.');

        try {
            const manager = SettingsManager.fromJSON(data);
            const config = manager.toRendererConfig();
            // Size the wrapper explicitly so the renderer has a real
            // parent to fit-contain into. The markdown container's
            // clientWidth is reliable; we cap at config.width so very
            // wide notes don't blow up tiny plots.
            const containerWidth = (el.clientWidth || 700);
            const targetW = Math.max(200, Math.min(containerWidth, config.width));
            const aspect = config.width / config.height || 1;
            const targetH = Math.max(150, targetW / aspect);
            wrapper.style.width = targetW + 'px';
            wrapper.style.height = targetH + 'px';

            if (config.is3D) {
                const renderer3d = new SVG3DRenderer();
                wrapper.appendChild(renderer3d.getElement());
                // renderSvg must run AFTER attachment so applyRootFitContain
                // can measure the wrapper we just sized. The hidden canvas
                // and the now-visible SVG (overridden by .tikz-rendered-chart
                // CSS) share the same scene the renderer paints into.
                renderer3d.renderSvg(config);
            } else {
                const svg = new SVGRenderer(config).render();
                wrapper.appendChild(svg);
            }
        } catch (e) {
            wrapper.remove();
            const err = el.createDiv({ cls: 'tikz-block-error' });
            err.setText('Easy TikZ render error: ' + (e instanceof Error ? e.message : 'render failed'));
            return;
        }

        // Click → open the modal pre-filled with this block's settings.
        // We store the raw source so the modal can locate and replace
        // the block by content match (more robust than line numbers
        // when the user has edited other parts of the file).
        const openEditor = () => {
            const file = this.app.vault.getAbstractFileByPath(ctx.sourcePath);
            const tfile = file instanceof TFile ? file : null;
            const fenceTag = fromTikzTag ? 'tikz' : 'easy-tikz';
            const originalBlockText = '```' + fenceTag + '\n' + source.replace(/\s+$/, '') + '\n```';
            new TikzModal(this.app, this, {
                data,
                sourceFile: tfile,
                originalBlockText,
                fenceTag,
            }).open();
        };
        wrapper.addEventListener('click', openEditor);
        wrapper.addEventListener('keydown', (e: KeyboardEvent) => {
            if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                openEditor();
            }
        });
    }
}

class EasyTikzSettingTab extends PluginSettingTab {
    private plugin: EasyTikzPlugin;

    constructor(app: App, plugin: EasyTikzPlugin) {
        super(app, plugin);
        this.plugin = plugin;
    }

    display(): void {
        const { containerEl } = this;
        containerEl.empty();

        new Setting(containerEl)
            .setName('Invert vertical drag in 3D')
            .setDesc(
                'Off (default): drag down tilts the scene up (camera elevation rises), drag up tilts the scene down — the trackball convention. ' +
                    'On: drag down lowers the camera, drag up raises it — direct manipulation.'
            )
            .addToggle((t) =>
                t.setValue(this.plugin.data.invertDrag3D).onChange(async (v) => {
                    this.plugin.data.invertDrag3D = v;
                    await this.plugin.saveSettings();
                })
            );

        new Setting(containerEl)
            .setName('Max 3D samples per axis')
            .setDesc(
                'Upper bound of the Samples slider on each 3D surface card. Default 80. ' +
                    'Higher values draw smoother surfaces but each axis step squares the work, so the preview will slow noticeably above ~200. Re-open the Easy TikZ modal after changing this.'
            )
            .addSlider((s) =>
                s
                    .setLimits(40, 400, 10)
                    .setValue(this.plugin.data.maxSamples3D ?? 80)
                    .setDynamicTooltip()
                    .onChange(async (v) => {
                        this.plugin.data.maxSamples3D = v;
                        await this.plugin.saveSettings();
                    })
            );

        new Setting(containerEl)
            .setName('Also render plain `tikz` blocks')
            .setDesc(
                'Off by default. When on, the plugin renders blocks tagged plain ```tikz the same way it renders ```easy-tikz blocks. ' +
                    'Useful if you want one tag for everything, but conflicts with `obsidian-tikzjax` and other plugins that claim ```tikz. ' +
                    'Reload Obsidian after changing this for the registration to take effect.'
            )
            .addToggle((t) =>
                t.setValue(this.plugin.data.renderTikzBlocks).onChange(async (v) => {
                    this.plugin.data.renderTikzBlocks = v;
                    await this.plugin.saveSettings();
                })
            );
    }
}
