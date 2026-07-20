import { App, MarkdownPostProcessorContext, Plugin, PluginSettingTab, SettingDefinitionItem, TFile, setIcon } from 'obsidian';
import { TikzModal } from './src/modal';
import { SettingsManager } from './src/settings';
import { SVGRenderer } from './src/renderer';
import { SVG3DRenderer } from './src/renderer3d';
import { DEFAULT_PLUGIN_DATA, PluginData, UserTemplate } from './src/templates';

export default class EasyTikzPlugin extends Plugin {
    data: PluginData = { ...DEFAULT_PLUGIN_DATA };

    async onload() {
        const stored = (await this.loadData()) as Partial<PluginData> | null;
        const storedTemplates = stored?.userTemplates;
        this.data = {
            ...DEFAULT_PLUGIN_DATA,
            ...(stored ?? {}),
            userTemplates: Array.isArray(storedTemplates) ? storedTemplates : [],
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
        // modal uses for its live preview - no external TeX engine needed.
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

        // Persisted display options (live next to the chart settings inside the JSON).
        const persistedAlign = (data.displayAlign as 'left' | 'center' | 'right') || 'center';
        const persistedWidth = typeof data.displayWidth === 'number' ? data.displayWidth : null;
        this.applyAlign(wrapper, persistedAlign);

        let aspect = 1;
        let containerWidth = el.clientWidth || 700;

        try {
            const manager = SettingsManager.fromJSON(data);
            const config = manager.toRendererConfig();
            aspect = (config.width / config.height) || 1;
            // Size the wrapper explicitly so the renderer has a real
            // parent to fit-contain into. If the user has saved a custom
            // displayWidth use it (clamped to the container width);
            // otherwise default to fit-contain inside the container,
            // capped at config.width.
            containerWidth = el.clientWidth || 700;
            const naturalCap = Math.min(containerWidth, config.width);
            const targetW = Math.max(200, Math.min(containerWidth, persistedWidth ?? naturalCap));
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

        // Hover controls: align buttons on the left, size slider at the bottom.
        const fenceTag: 'easy-tikz' | 'tikz' = fromTikzTag ? 'tikz' : 'easy-tikz';
        this.buildHoverControls(wrapper, data, ctx, fenceTag, source, aspect, containerWidth);

        // Click → open the modal pre-filled with this block's settings.
        // We store the raw source so the modal can locate and replace
        // the block by content match (more robust than line numbers
        // when the user has edited other parts of the file).
        const openEditor = () => {
            const file = this.app.vault.getAbstractFileByPath(ctx.sourcePath);
            const tfile = file instanceof TFile ? file : null;
            const originalBlockText = '```' + fenceTag + '\n' + source.replace(/\s+$/, '') + '\n```';
            new TikzModal(this.app, this, {
                data,
                sourceFile: tfile,
                originalBlockText,
                fenceTag,
            }).open();
        };
        wrapper.addEventListener('click', (e) => {
            // Clicks on overlay controls bubble here too - they call
            // stopPropagation so this only fires for clicks on the chart.
            openEditor();
        });
        wrapper.addEventListener('keydown', (e: KeyboardEvent) => {
            if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                openEditor();
            }
        });
    }

    private applyAlign(wrapper: HTMLElement, align: 'left' | 'center' | 'right') {
        wrapper.removeClass('align-left');
        wrapper.removeClass('align-center');
        wrapper.removeClass('align-right');
        wrapper.addClass('align-' + align);
    }

    /**
     * Add the floating overlay controls - vertical align buttons on the
     * left, horizontal size slider along the bottom. Both fade in on
     * hover via CSS. The slider updates wrapper CSS live during input
     * for smooth dragging, and writes the new `displayWidth` back to
     * the source block on `change` (release) so only one re-render
     * fires per drag. Align clicks save immediately - one click, one
     * re-render.
     */
    private buildHoverControls(
        wrapper: HTMLElement,
        data: Record<string, unknown>,
        ctx: MarkdownPostProcessorContext,
        fenceTag: 'easy-tikz' | 'tikz',
        source: string,
        aspect: number,
        containerWidth: number
    ) {
        const alignBar = wrapper.createDiv({ cls: 'tikz-rendered-controls tikz-rendered-align' });
        const makeAlignBtn = (key: 'left' | 'center' | 'right', icon: string, label: string) => {
            const btn = alignBar.createEl('button', { cls: 'tikz-rendered-btn' });
            btn.setAttr('type', 'button');
            btn.setAttr('aria-label', label);
            btn.setAttr('title', label);
            setIcon(btn, icon);
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                this.applyAlign(wrapper, key);
                void this.persistDisplayPatch(data, ctx, fenceTag, source, { displayAlign: key });
            });
        };
        makeAlignBtn('left', 'align-left', 'Align left');
        makeAlignBtn('center', 'align-center', 'Center');
        makeAlignBtn('right', 'align-right', 'Align right');

        const sliderBar = wrapper.createDiv({ cls: 'tikz-rendered-controls tikz-rendered-size' });
        const slider = sliderBar.createEl('input', {
            cls: 'tikz-rendered-slider',
        });
        slider.type = 'range';
        slider.min = '200';
        slider.max = String(Math.max(400, Math.min(2000, Math.round(containerWidth))));
        slider.step = '10';
        const initialW = parseFloat(wrapper.style.width) || 700;
        slider.value = String(Math.round(initialW));
        slider.setAttr('aria-label', 'Chart width');
        slider.setAttr('title', 'Width - drag to resize, releases save to the note');

        const stop = (e: Event) => e.stopPropagation();
        sliderBar.addEventListener('click', stop);
        sliderBar.addEventListener('mousedown', stop);
        slider.addEventListener('click', stop);
        slider.addEventListener('mousedown', stop);

        slider.addEventListener('input', () => {
            const w = parseInt(slider.value, 10);
            wrapper.style.width = w + 'px';
            wrapper.style.height = w / aspect + 'px';
        });
        slider.addEventListener('change', () => {
            const w = parseInt(slider.value, 10);
            void this.persistDisplayPatch(data, ctx, fenceTag, source, { displayWidth: w });
        });
    }

    /**
     * Merge a partial display patch into the block's JSON and write
     * the file. The markdown post-processor will re-fire on the next
     * vault tick with the new source - the chart, align class, and
     * slider position all rebuild from the persisted JSON.
     */
    private async persistDisplayPatch(
        data: Record<string, unknown>,
        ctx: MarkdownPostProcessorContext,
        fenceTag: 'easy-tikz' | 'tikz',
        source: string,
        patch: Partial<{ displayWidth: number; displayAlign: 'left' | 'center' | 'right' }>
    ) {
        const file = this.app.vault.getAbstractFileByPath(ctx.sourcePath);
        if (!(file instanceof TFile)) return;
        const merged = { ...data, ...patch };
        const trimmedSource = source.replace(/\s+$/, '');
        const original = '```' + fenceTag + '\n' + trimmedSource + '\n```';
        const updated = '```' + fenceTag + '\n' + JSON.stringify(merged, null, 2) + '\n```';
        try {
            const content = await this.app.vault.read(file);
            if (!content.includes(original)) return;
            await this.app.vault.modify(file, content.replace(original, updated));
        } catch {
            // Vault read/write race - silently ignore; user can retry.
        }
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
                name: 'Invert vertical drag in 3D',
                desc:
                    'Off (default): drag down tilts the scene up (camera elevation rises), drag up tilts the scene down - the trackball convention. ' +
                    'On: drag down lowers the camera, drag up raises it - direct manipulation.',
                control: { type: 'toggle', key: 'invertDrag3D', defaultValue: false },
            },
            {
                name: 'Max 3D samples per axis',
                desc:
                    'Upper bound of the Samples slider on each 3D surface card. Default 80. ' +
                    'Higher values draw smoother surfaces but each axis step squares the work, so the preview will slow noticeably above ~200. Re-open the Easy TikZ modal after changing this.',
                control: { type: 'slider', key: 'maxSamples3D', min: 40, max: 400, step: 10, defaultValue: 80 },
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
            case 'maxSamples3D':
                this.plugin.data.maxSamples3D = Number(value);
                break;
            case 'dragSensitivity2D':
                this.plugin.data.dragSensitivity2D = Number(value);
                break;
            default:
                return;
        }
        await this.plugin.saveSettings();
    }
}
