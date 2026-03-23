import { Modal, Setting, MarkdownView, Notice, App } from 'obsidian';
import { FunctionParameters, DynamicFunctionSetting } from './types';
import { SettingsManager, TIKZ_SETTINGS } from './settings';
import { SVGRenderer } from './renderer';
// @ts-ignore — inline import via esbuild plugin
import styles from 'inline:./styles.css';

const COLOR_OPTIONS: Record<string, string> = {
    black: 'Black',
    red: 'Red',
    blue: 'Blue',
    teal: 'Teal',
    orange: 'Orange',
    green: 'Green',
    purple: 'Purple',
};

const THICKNESS_OPTIONS: Record<string, string> = {
    'very thin': 'Very Thin',
    thin: 'Thin',
    thick: 'Thick',
    'very thick': 'Very Thick',
};

const CSS_COLORS: Record<string, string> = {
    black: 'var(--text-muted)',
    red: '#e74c3c',
    blue: '#3498db',
    teal: '#1abc9c',
    orange: '#e67e22',
    green: '#2ecc71',
    purple: '#9b59b6',
};

export class TikzModal extends Modal {
    private settings: SettingsManager;
    private previewContainer: HTMLElement;
    private codeTextArea: HTMLTextAreaElement;
    private previewTimer: number | null = null;
    private tabContents: Map<string, HTMLElement> = new Map();
    private tabButtons: Map<string, HTMLButtonElement> = new Map();

    constructor(app: App) {
        super(app);
        this.settings = new SettingsManager();
    }

    onOpen() {
        // Inject styles
        const styleEl = document.createElement('style');
        styleEl.id = 'tikz-graph-helper-styles';
        styleEl.textContent = styles;
        if (!document.getElementById('tikz-graph-helper-styles')) {
            document.head.appendChild(styleEl);
        }

        const { modalEl } = this;
        modalEl.addClass('tikz-modal');

        const layout = modalEl.createDiv({ cls: 'tikz-layout' });

        // Left panel — settings
        const leftPanel = layout.createDiv({ cls: 'tikz-panel-left' });
        this.buildTabBar(leftPanel);
        this.buildTabs(leftPanel);

        // Right panel — preview + actions
        const rightPanel = layout.createDiv({ cls: 'tikz-panel-right' });
        this.previewContainer = rightPanel.createDiv({ cls: 'tikz-preview-area' });
        this.buildActionBar(rightPanel);

        // Initial preview
        this.updatePreview();
    }

    onClose() {
        if (this.previewTimer) window.clearTimeout(this.previewTimer);
    }

    // --- Tab bar ---

    private buildTabBar(container: HTMLElement) {
        const bar = container.createDiv({ cls: 'tikz-tab-bar' });
        const tabs = ['Graph', 'Axis', 'Functions', 'Grid', 'Code'];

        tabs.forEach((name, i) => {
            const btn = bar.createEl('button', { cls: 'tikz-tab-btn', text: name });
            if (i === 0) btn.addClass('active');
            btn.onclick = () => this.switchTab(name);
            this.tabButtons.set(name, btn);
        });
    }

    private switchTab(name: string) {
        this.tabButtons.forEach((btn, key) => {
            btn.toggleClass('active', key === name);
        });
        this.tabContents.forEach((content, key) => {
            content.style.display = key === name ? 'block' : 'none';
        });
        // Update code textarea when switching to Code tab
        if (name === 'Code') {
            this.updateCodeArea();
        }
    }

    // --- Tab contents ---

    private buildTabs(container: HTMLElement) {
        this.buildGraphTab(container);
        this.buildAxisTab(container);
        this.buildFunctionsTab(container);
        this.buildGridTab(container);
        this.buildCodeTab(container);
    }

    private createTabContent(container: HTMLElement, name: string, visible = false): HTMLElement {
        const content = container.createDiv({ cls: 'tikz-tab-content tikz-settings-section' });
        if (!visible) content.style.display = 'none';
        this.tabContents.set(name, content);
        return content;
    }

    private buildGraphTab(container: HTMLElement) {
        const tab = this.createTabContent(container, 'Graph', true);

        new Setting(tab)
            .setName('Title')
            .setDesc('Name displayed above the graph')
            .addText((text) =>
                text
                    .setPlaceholder('My graph')
                    .setValue(this.settings.getValue('title'))
                    .onChange((v) => {
                        this.settings.setValue('title', v);
                        this.requestPreviewUpdate();
                    })
            );

        new Setting(tab)
            .setName('Width (cm)')
            .setDesc('Width of the exported TikZ image')
            .addSlider((s) =>
                s
                    .setLimits(1, 20, 1)
                    .setValue(this.settings.getValue('size_x_cm'))
                    .setDynamicTooltip()
                    .onChange((v) => {
                        this.settings.setValue('size_x_cm', v);
                        this.requestPreviewUpdate();
                    })
            );

        new Setting(tab)
            .setName('Height (cm)')
            .setDesc('Height of the exported TikZ image')
            .addSlider((s) =>
                s
                    .setLimits(1, 20, 1)
                    .setValue(this.settings.getValue('size_y_cm'))
                    .setDynamicTooltip()
                    .onChange((v) => {
                        this.settings.setValue('size_y_cm', v);
                        this.requestPreviewUpdate();
                    })
            );

        new Setting(tab)
            .setName('Use pgfplots')
            .setDesc('Include pgfplots package in TikZ code')
            .addToggle((t) =>
                t.setValue(this.settings.getValue('documentSetup')).onChange((v) => {
                    this.settings.setValue('documentSetup', v);
                    this.requestPreviewUpdate();
                })
            );
    }

    private buildAxisTab(container: HTMLElement) {
        const tab = this.createTabContent(container, 'Axis');

        new Setting(tab)
            .setName('Show axis labels')
            .addToggle((t) =>
                t.setValue(this.settings.getValue('show_axis_label')).onChange((v) => {
                    this.settings.setValue('show_axis_label', v);
                    this.requestPreviewUpdate();
                })
            );

        new Setting(tab)
            .setName('X-Axis Label')
            .addText((text) =>
                text.setValue(this.settings.getValue('axis_label_x')).onChange((v) => {
                    this.settings.setValue('axis_label_x', v);
                    this.requestPreviewUpdate();
                })
            );

        new Setting(tab)
            .setName('Y-Axis Label')
            .addText((text) =>
                text.setValue(this.settings.getValue('axis_label_y')).onChange((v) => {
                    this.settings.setValue('axis_label_y', v);
                    this.requestPreviewUpdate();
                })
            );

        // X-axis range
        const xRange = tab.createDiv({ cls: 'tikz-range-group' });
        const xMinDiv = xRange.createDiv();
        new Setting(xMinDiv).setName('X min').addText((t) =>
            t
                .setPlaceholder('-0.5')
                .setValue(this.settings.getValue('xmin'))
                .onChange((v) => {
                    this.settings.setValue('xmin', v);
                    this.requestPreviewUpdate();
                })
        );
        xRange.createSpan({ cls: 'tikz-range-separator', text: 'to' });
        const xMaxDiv = xRange.createDiv();
        new Setting(xMaxDiv).setName('X max').addText((t) =>
            t
                .setPlaceholder('10')
                .setValue(this.settings.getValue('xmax'))
                .onChange((v) => {
                    this.settings.setValue('xmax', v);
                    this.requestPreviewUpdate();
                })
        );

        // Y-axis range
        const yRange = tab.createDiv({ cls: 'tikz-range-group' });
        const yMinDiv = yRange.createDiv();
        new Setting(yMinDiv).setName('Y min').addText((t) =>
            t
                .setPlaceholder('-0.5')
                .setValue(this.settings.getValue('ymin'))
                .onChange((v) => {
                    this.settings.setValue('ymin', v);
                    this.requestPreviewUpdate();
                })
        );
        yRange.createSpan({ cls: 'tikz-range-separator', text: 'to' });
        const yMaxDiv = yRange.createDiv();
        new Setting(yMaxDiv).setName('Y max').addText((t) =>
            t
                .setPlaceholder('5')
                .setValue(this.settings.getValue('ymax'))
                .onChange((v) => {
                    this.settings.setValue('ymax', v);
                    this.requestPreviewUpdate();
                })
        );

        new Setting(tab)
            .setName('Axis style')
            .setDesc('Box: axes around the plot. Middle: axes cross at origin')
            .addDropdown((d) =>
                d
                    .addOptions({ box: 'Box (all around)', middle: 'Middle (crossing)' })
                    .setValue(this.settings.getValue('axis_allaround') ? 'box' : 'middle')
                    .onChange((v) => {
                        this.settings.setValue('axis_allaround', v === 'box');
                        this.requestPreviewUpdate();
                    })
            );
    }

    private buildFunctionsTab(container: HTMLElement) {
        const tab = this.createTabContent(container, 'Functions');
        const cardsContainer = tab.createDiv({ cls: 'tikz-func-cards' });
        const rowStates = new Map<
            string,
            FunctionParameters & { tangentPoint: string }
        >();

        const updateFunctionValues = () => {
            const functions: FunctionParameters[] = [];
            rowStates.forEach((state) => {
                if (state.expression && state.domain) {
                    functions.push({ ...state });
                }
            });
            this.settings.setValue('functions', functions);
            this.requestPreviewUpdate();
        };

        const addFunctionCard = () => {
            const rowId = `func-${Date.now()}`;
            const state: FunctionParameters = {
                expression: '',
                domain: '-10:10',
                showLegend: false,
                fill: false,
                tangent: false,
                dashed: false,
                tangentPoint: '',
                extrema: false,
                color: 'black',
                thickness: 'thin',
            };
            rowStates.set(rowId, state);

            const card = cardsContainer.createDiv({ cls: 'tikz-func-card' });
            card.style.borderLeftColor = CSS_COLORS[state.color];

            // Delete button
            const deleteBtn = card.createDiv({ cls: 'tikz-func-delete' });
            new Setting(deleteBtn).addButton((btn) =>
                btn
                    .setIcon('trash')
                    .setTooltip('Remove function')
                    .onClick(() => {
                        rowStates.delete(rowId);
                        card.remove();
                        updateFunctionValues();
                    })
            );

            // Row 1: Expression + Domain
            const row1 = card.createDiv({ cls: 'tikz-func-row' });
            const exprDiv = row1.createDiv({ cls: 'tikz-func-field wide' });
            new Setting(exprDiv).setName('Expression').addText((t) =>
                t.setPlaceholder('x^2').onChange((v) => {
                    state.expression = v;
                    updateFunctionValues();
                })
            );
            const domDiv = row1.createDiv({ cls: 'tikz-func-field' });
            new Setting(domDiv).setName('Domain').addText((t) =>
                t
                    .setPlaceholder('-10:10')
                    .setValue(state.domain)
                    .onChange((v) => {
                        state.domain = v;
                        updateFunctionValues();
                    })
            );

            // Row 2: Color + Thickness
            const row2 = card.createDiv({ cls: 'tikz-func-row' });
            const colorDiv = row2.createDiv({ cls: 'tikz-func-field' });
            new Setting(colorDiv).setName('Color').addDropdown((d) =>
                d
                    .addOptions(COLOR_OPTIONS)
                    .setValue(state.color)
                    .onChange((v) => {
                        state.color = v;
                        card.style.borderLeftColor = CSS_COLORS[v] || 'var(--text-muted)';
                        updateFunctionValues();
                    })
            );
            const thickDiv = row2.createDiv({ cls: 'tikz-func-field' });
            new Setting(thickDiv).setName('Thickness').addDropdown((d) =>
                d
                    .addOptions(THICKNESS_OPTIONS)
                    .setValue(state.thickness)
                    .onChange((v) => {
                        state.thickness = v;
                        updateFunctionValues();
                    })
            );

            // Row 3: Toggle chips
            const row3 = card.createDiv({ cls: 'tikz-func-row tikz-toggle-row' });

            // Tangent input (hidden by default)
            const tangentInput = card.createDiv({ cls: 'tikz-tangent-input' });
            new Setting(tangentInput).setName('Tangent point (x)').addText((t) =>
                t.setPlaceholder('x value').onChange((v) => {
                    state.tangentPoint = v;
                    updateFunctionValues();
                })
            );

            const toggles: { name: string; key: keyof FunctionParameters }[] = [
                { name: 'Legend', key: 'showLegend' },
                { name: 'Fill', key: 'fill' },
                { name: 'Tangent', key: 'tangent' },
                { name: 'Dashed', key: 'dashed' },
                { name: 'Extrema', key: 'extrema' },
            ];

            toggles.forEach(({ name, key }) => {
                const chip = row3.createDiv({ cls: 'tikz-toggle-chip' });
                new Setting(chip).setName(name).addToggle((t) =>
                    t.setValue(state[key] as boolean).onChange((v) => {
                        (state as any)[key] = v;
                        if (key === 'tangent') {
                            tangentInput.toggleClass('visible', v);
                        }
                        updateFunctionValues();
                    })
                );
            });
        };

        // Add initial card
        addFunctionCard();

        // Add function button
        const addBtnDiv = tab.createDiv({ cls: 'tikz-add-func' });
        new Setting(addBtnDiv).addButton((btn) =>
            btn.setButtonText('+ Add Function').onClick(() => addFunctionCard())
        );
    }

    private buildGridTab(container: HTMLElement) {
        const tab = this.createTabContent(container, 'Grid');

        new Setting(tab)
            .setName('Show major grid')
            .setDesc('Display major coordinate grid lines')
            .addToggle((t) =>
                t.setValue(this.settings.getValue('showLargeGrid')).onChange((v) => {
                    this.settings.setValue('showLargeGrid', v);
                    this.requestPreviewUpdate();
                })
            );

        new Setting(tab)
            .setName('Show minor grid')
            .setDesc('Display minor coordinate grid lines')
            .addToggle((t) =>
                t.setValue(this.settings.getValue('showSmallGrid')).onChange((v) => {
                    this.settings.setValue('showSmallGrid', v);
                    this.requestPreviewUpdate();
                })
            );

        new Setting(tab)
            .setName('Grid subdivisions')
            .setDesc('Number of minor subdivisions between major grid lines')
            .addSlider((s) =>
                s
                    .setLimits(1, 10, 1)
                    .setValue(this.settings.getValue('gridSize'))
                    .setDynamicTooltip()
                    .onChange((v) => {
                        this.settings.setValue('gridSize', v);
                        this.requestPreviewUpdate();
                    })
            );
    }

    private buildCodeTab(container: HTMLElement) {
        const tab = this.createTabContent(container, 'Code');

        const textarea = document.createElement('textarea');
        textarea.className = 'tikz-code-textarea';
        textarea.readOnly = true;
        textarea.spellcheck = false;
        tab.appendChild(textarea);
        this.codeTextArea = textarea;
    }

    // --- Action bar ---

    private buildActionBar(container: HTMLElement) {
        const bar = container.createDiv({ cls: 'tikz-action-bar' });

        new Setting(bar)
            .addButton((btn) =>
                btn.setButtonText('Copy TikZ Code').onClick(async () => {
                    const code = this.settings.generateTikzCode();
                    await navigator.clipboard.writeText(code);
                    const orig = btn.buttonEl.textContent;
                    btn.setButtonText('Copied!');
                    setTimeout(() => btn.setButtonText(orig || 'Copy TikZ Code'), 2000);
                })
            )
            .addButton((btn) =>
                btn
                    .setButtonText('Insert into Note')
                    .setCta()
                    .onClick(() => {
                        const view = this.app.workspace.getActiveViewOfType(MarkdownView);
                        if (!view) {
                            new Notice('No active note to insert into');
                            return;
                        }
                        const code = this.settings.generateTikzCode();
                        const editor = view.editor;
                        editor.replaceSelection('```tikz\n' + code + '\n```\n');
                        this.close();
                    })
            );
    }

    // --- Preview ---

    private requestPreviewUpdate() {
        if (this.previewTimer) window.clearTimeout(this.previewTimer);
        this.previewTimer = window.setTimeout(() => this.updatePreview(), 150) as unknown as number;
    }

    private updatePreview() {
        this.previewContainer.empty();

        try {
            const config = this.settings.toRendererConfig();
            const renderer = new SVGRenderer(config);
            const svg = renderer.render();
            this.previewContainer.appendChild(svg);
        } catch (e: any) {
            const errDiv = this.previewContainer.createDiv({ cls: 'tikz-error' });
            errDiv.textContent = e.message || 'Rendering error';
        }

        this.updateCodeArea();
    }

    private updateCodeArea() {
        if (this.codeTextArea) {
            this.codeTextArea.value = this.settings.generateTikzCode();
        }
    }
}
