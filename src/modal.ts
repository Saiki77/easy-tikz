import { Modal, Setting, MarkdownView, Notice, App } from 'obsidian';
import { FunctionParameters, Function3DParameters } from './types';
import { SettingsManager } from './settings';
import { SVGRenderer } from './renderer';
import { SVG3DRenderer } from './renderer3d';
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

    // References for 3D-conditional UI
    private rotationContainer: HTMLElement;
    private zAxisContainer: HTMLElement;
    private axisStyleContainer: HTMLElement;
    private functionsTabContent: HTMLElement;
    private leftPanel: HTMLElement;

    // Slider references for syncing with mouse drag
    private elevationSlider: any;
    private azimuthSlider: any;

    // Mouse drag state
    private isDragging = false;
    private dragStartX = 0;
    private dragStartY = 0;
    private dragStartAzimuth = 0;
    private dragStartElevation = 0;

    constructor(app: App) {
        super(app);
        this.settings = new SettingsManager();
    }

    onOpen() {
        const styleEl = document.createElement('style');
        styleEl.id = 'tikz-graph-helper-styles';
        styleEl.textContent = styles;
        if (!document.getElementById('tikz-graph-helper-styles')) {
            document.head.appendChild(styleEl);
        }

        const { modalEl } = this;
        modalEl.addClass('tikz-modal');

        const layout = modalEl.createDiv({ cls: 'tikz-layout' });

        this.leftPanel = layout.createDiv({ cls: 'tikz-panel-left' });
        this.buildTabBar(this.leftPanel);
        this.buildTabs(this.leftPanel);

        const rightPanel = layout.createDiv({ cls: 'tikz-panel-right' });
        this.previewContainer = rightPanel.createDiv({ cls: 'tikz-preview-area' });
        this.setupMouseDragRotation();
        this.buildActionBar(rightPanel);

        this.updatePreview();
    }

    onClose() {
        if (this.previewTimer) window.clearTimeout(this.previewTimer);
    }

    private is3D(): boolean {
        return this.settings.getValue('dimension') ?? false;
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
        if (name === 'Code') this.updateCodeArea();
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

        // 3D toggle
        new Setting(tab)
            .setName('3D Mode')
            .setDesc('Switch between 2D function plots and 3D surface plots')
            .addToggle((t) =>
                t.setValue(this.settings.getValue('dimension')).onChange((v) => {
                    this.settings.setValue('dimension', v);
                    this.update3DVisibility();
                    this.rebuildFunctionsTab();
                    this.requestPreviewUpdate();
                })
            );

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
                s.setLimits(1, 20, 1).setValue(this.settings.getValue('size_x_cm')).setDynamicTooltip().onChange((v) => {
                    this.settings.setValue('size_x_cm', v);
                    this.requestPreviewUpdate();
                })
            );

        new Setting(tab)
            .setName('Height (cm)')
            .setDesc('Height of the exported TikZ image')
            .addSlider((s) =>
                s.setLimits(1, 20, 1).setValue(this.settings.getValue('size_y_cm')).setDynamicTooltip().onChange((v) => {
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

        // 3D rotation controls (hidden in 2D mode)
        this.rotationContainer = tab.createDiv({ cls: 'tikz-3d-controls' });

        new Setting(this.rotationContainer)
            .setName('Elevation')
            .setDesc('Camera tilt angle (0 = side, 90 = top). Drag preview to rotate.')
            .addSlider((s) => {
                this.elevationSlider = s;
                s.setLimits(0, 90, 1).setValue(this.settings.getValue('rotationX')).setDynamicTooltip().onChange((v) => {
                    this.settings.setValue('rotationX', v);
                    this.requestPreviewUpdate();
                });
            });

        new Setting(this.rotationContainer)
            .setName('Azimuth')
            .setDesc('Camera rotation around vertical axis. Drag preview to rotate.')
            .addSlider((s) => {
                this.azimuthSlider = s;
                s.setLimits(0, 360, 1).setValue(this.settings.getValue('rotationZ')).setDynamicTooltip().onChange((v) => {
                    this.settings.setValue('rotationZ', v);
                    this.requestPreviewUpdate();
                });
            });

        this.update3DVisibility();
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

        // Z-axis label (3D only)
        this.zAxisContainer = tab.createDiv({ cls: 'tikz-3d-controls' });

        new Setting(this.zAxisContainer)
            .setName('Z-Axis Label')
            .addText((text) =>
                text.setValue(this.settings.getValue('axis_label_z')).onChange((v) => {
                    this.settings.setValue('axis_label_z', v);
                    this.requestPreviewUpdate();
                })
            );

        // X-axis range
        const xRange = tab.createDiv({ cls: 'tikz-range-group' });
        const xMinDiv = xRange.createDiv();
        new Setting(xMinDiv).setName('X min').addText((t) =>
            t.setPlaceholder('-0.5').setValue(this.settings.getValue('xmin')).onChange((v) => {
                this.settings.setValue('xmin', v);
                this.requestPreviewUpdate();
            })
        );
        xRange.createSpan({ cls: 'tikz-range-separator', text: 'to' });
        const xMaxDiv = xRange.createDiv();
        new Setting(xMaxDiv).setName('X max').addText((t) =>
            t.setPlaceholder('10').setValue(this.settings.getValue('xmax')).onChange((v) => {
                this.settings.setValue('xmax', v);
                this.requestPreviewUpdate();
            })
        );

        // Y-axis range
        const yRange = tab.createDiv({ cls: 'tikz-range-group' });
        const yMinDiv = yRange.createDiv();
        new Setting(yMinDiv).setName('Y min').addText((t) =>
            t.setPlaceholder('-0.5').setValue(this.settings.getValue('ymin')).onChange((v) => {
                this.settings.setValue('ymin', v);
                this.requestPreviewUpdate();
            })
        );
        yRange.createSpan({ cls: 'tikz-range-separator', text: 'to' });
        const yMaxDiv = yRange.createDiv();
        new Setting(yMaxDiv).setName('Y max').addText((t) =>
            t.setPlaceholder('5').setValue(this.settings.getValue('ymax')).onChange((v) => {
                this.settings.setValue('ymax', v);
                this.requestPreviewUpdate();
            })
        );

        // Z-axis range (3D only) — append to zAxisContainer
        const zRange = this.zAxisContainer.createDiv({ cls: 'tikz-range-group' });
        const zMinDiv = zRange.createDiv();
        new Setting(zMinDiv).setName('Z min').addText((t) =>
            t.setPlaceholder('-5').setValue(this.settings.getValue('zmin')).onChange((v) => {
                this.settings.setValue('zmin', v);
                this.requestPreviewUpdate();
            })
        );
        zRange.createSpan({ cls: 'tikz-range-separator', text: 'to' });
        const zMaxDiv = zRange.createDiv();
        new Setting(zMaxDiv).setName('Z max').addText((t) =>
            t.setPlaceholder('5').setValue(this.settings.getValue('zmax')).onChange((v) => {
                this.settings.setValue('zmax', v);
                this.requestPreviewUpdate();
            })
        );

        // Axis style (2D only)
        this.axisStyleContainer = tab.createDiv();
        new Setting(this.axisStyleContainer)
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

        this.update3DVisibility();
    }

    private buildFunctionsTab(container: HTMLElement) {
        this.functionsTabContent = this.createTabContent(container, 'Functions');
        this.populateFunctionsTab();
    }

    private rebuildFunctionsTab() {
        this.functionsTabContent.empty();
        this.populateFunctionsTab();
    }

    private populateFunctionsTab() {
        const tab = this.functionsTabContent;
        if (this.is3D()) {
            this.build3DFunctionCards(tab);
        } else {
            this.build2DFunctionCards(tab);
        }
    }

    private build2DFunctionCards(tab: HTMLElement) {
        const cardsContainer = tab.createDiv({ cls: 'tikz-func-cards' });
        const rowStates = new Map<string, FunctionParameters>();

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

            const header = card.createDiv({ cls: 'tikz-func-header' });
            header.createSpan({ cls: 'tikz-func-label', text: `Function ${rowStates.size}` });
            new Setting(header).addButton((btn) =>
                btn.setIcon('trash').setTooltip('Remove function').onClick(() => {
                    rowStates.delete(rowId);
                    card.remove();
                    updateFunctionValues();
                })
            );

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
                t.setPlaceholder('-10:10').setValue(state.domain).onChange((v) => {
                    state.domain = v;
                    updateFunctionValues();
                })
            );

            const row2 = card.createDiv({ cls: 'tikz-func-row' });
            const colorDiv = row2.createDiv({ cls: 'tikz-func-field' });
            new Setting(colorDiv).setName('Color').addDropdown((d) =>
                d.addOptions(COLOR_OPTIONS).setValue(state.color).onChange((v) => {
                    state.color = v;
                    card.style.borderLeftColor = CSS_COLORS[v] || 'var(--text-muted)';
                    updateFunctionValues();
                })
            );
            const thickDiv = row2.createDiv({ cls: 'tikz-func-field' });
            new Setting(thickDiv).setName('Thickness').addDropdown((d) =>
                d.addOptions(THICKNESS_OPTIONS).setValue(state.thickness).onChange((v) => {
                    state.thickness = v;
                    updateFunctionValues();
                })
            );

            const row3 = card.createDiv({ cls: 'tikz-func-row tikz-toggle-row' });

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
                        if (key === 'tangent') tangentInput.toggleClass('visible', v);
                        updateFunctionValues();
                    })
                );
            });
        };

        addFunctionCard();

        const addBtnDiv = tab.createDiv({ cls: 'tikz-add-func' });
        new Setting(addBtnDiv).addButton((btn) =>
            btn.setButtonText('+ Add Function').onClick(() => addFunctionCard())
        );
    }

    private build3DFunctionCards(tab: HTMLElement) {
        const cardsContainer = tab.createDiv({ cls: 'tikz-func-cards' });
        const rowStates = new Map<string, Function3DParameters>();

        const updateFunctionValues = () => {
            const functions: Function3DParameters[] = [];
            rowStates.forEach((state) => {
                if (state.expression) {
                    functions.push({ ...state });
                }
            });
            this.settings.setValue('functions3D', functions);
            this.requestPreviewUpdate();
        };

        const addFunctionCard = () => {
            const rowId = `func3d-${Date.now()}`;
            const state: Function3DParameters = {
                expression: '',
                xDomain: '-5:5',
                yDomain: '-5:5',
                color: 'blue',
                wireframe: false,
                opacity: 0.7,
            };
            rowStates.set(rowId, state);

            const card = cardsContainer.createDiv({ cls: 'tikz-func-card' });
            card.style.borderLeftColor = CSS_COLORS[state.color] || 'var(--text-muted)';

            const header = card.createDiv({ cls: 'tikz-func-header' });
            header.createSpan({ cls: 'tikz-func-label', text: `Surface ${rowStates.size}` });
            new Setting(header).addButton((btn) =>
                btn.setIcon('trash').setTooltip('Remove surface').onClick(() => {
                    rowStates.delete(rowId);
                    card.remove();
                    updateFunctionValues();
                })
            );

            // Expression
            const row1 = card.createDiv({ cls: 'tikz-func-row' });
            const exprDiv = row1.createDiv({ cls: 'tikz-func-field wide' });
            new Setting(exprDiv).setName('f(x, y)').addText((t) =>
                t.setPlaceholder('sin(x)*cos(y)').onChange((v) => {
                    state.expression = v;
                    updateFunctionValues();
                })
            );

            // X and Y domains
            const row2 = card.createDiv({ cls: 'tikz-func-row' });
            const xDomDiv = row2.createDiv({ cls: 'tikz-func-field' });
            new Setting(xDomDiv).setName('X domain').addText((t) =>
                t.setPlaceholder('-5:5').setValue(state.xDomain).onChange((v) => {
                    state.xDomain = v;
                    updateFunctionValues();
                })
            );
            const yDomDiv = row2.createDiv({ cls: 'tikz-func-field' });
            new Setting(yDomDiv).setName('Y domain').addText((t) =>
                t.setPlaceholder('-5:5').setValue(state.yDomain).onChange((v) => {
                    state.yDomain = v;
                    updateFunctionValues();
                })
            );

            // Color + wireframe + opacity
            const row3 = card.createDiv({ cls: 'tikz-func-row' });
            const colorDiv = row3.createDiv({ cls: 'tikz-func-field' });
            new Setting(colorDiv).setName('Color').addDropdown((d) =>
                d.addOptions(COLOR_OPTIONS).setValue(state.color).onChange((v) => {
                    state.color = v;
                    card.style.borderLeftColor = CSS_COLORS[v] || 'var(--text-muted)';
                    updateFunctionValues();
                })
            );

            const row4 = card.createDiv({ cls: 'tikz-func-row tikz-toggle-row' });
            const wireChip = row4.createDiv({ cls: 'tikz-toggle-chip' });
            new Setting(wireChip).setName('Wireframe').addToggle((t) =>
                t.setValue(state.wireframe).onChange((v) => {
                    state.wireframe = v;
                    updateFunctionValues();
                })
            );

            const opacityDiv = row4.createDiv({ cls: 'tikz-func-field' });
            new Setting(opacityDiv).setName('Opacity').addSlider((s) =>
                s.setLimits(0.1, 1.0, 0.1).setValue(state.opacity).setDynamicTooltip().onChange((v) => {
                    state.opacity = v;
                    updateFunctionValues();
                })
            );
        };

        addFunctionCard();

        const addBtnDiv = tab.createDiv({ cls: 'tikz-add-func' });
        new Setting(addBtnDiv).addButton((btn) =>
            btn.setButtonText('+ Add Surface').onClick(() => addFunctionCard())
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
                s.setLimits(1, 10, 1).setValue(this.settings.getValue('gridSize')).setDynamicTooltip().onChange((v) => {
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

    // --- 3D visibility ---

    private update3DVisibility() {
        const show3D = this.is3D();
        if (this.rotationContainer) this.rotationContainer.style.display = show3D ? 'block' : 'none';
        if (this.zAxisContainer) this.zAxisContainer.style.display = show3D ? 'block' : 'none';
        if (this.axisStyleContainer) this.axisStyleContainer.style.display = show3D ? 'none' : 'block';
        if (this.previewContainer) this.previewContainer.toggleClass('is-3d', show3D);
    }

    // --- Mouse drag rotation ---

    private setupMouseDragRotation() {
        const el = this.previewContainer;

        el.addEventListener('mousedown', (e: MouseEvent) => {
            if (!this.is3D()) return;
            this.isDragging = true;
            this.dragStartX = e.clientX;
            this.dragStartY = e.clientY;
            this.dragStartAzimuth = this.settings.getValue('rotationZ') ?? 45;
            this.dragStartElevation = this.settings.getValue('rotationX') ?? 30;
            el.style.cursor = 'grabbing';
            e.preventDefault();
        });

        window.addEventListener('mousemove', (e: MouseEvent) => {
            if (!this.isDragging) return;
            const dx = e.clientX - this.dragStartX;
            const dy = e.clientY - this.dragStartY;

            // Horizontal drag → azimuth, vertical drag → elevation
            let newAzimuth = this.dragStartAzimuth + dx * 0.5;
            let newElevation = this.dragStartElevation - dy * 0.3;

            // Wrap azimuth 0–360
            newAzimuth = ((newAzimuth % 360) + 360) % 360;
            // Clamp elevation 0–90
            newElevation = Math.max(0, Math.min(90, newElevation));

            this.settings.setValue('rotationZ', Math.round(newAzimuth));
            this.settings.setValue('rotationX', Math.round(newElevation));

            // Sync sliders
            if (this.azimuthSlider) this.azimuthSlider.setValue(Math.round(newAzimuth));
            if (this.elevationSlider) this.elevationSlider.setValue(Math.round(newElevation));

            this.requestPreviewUpdate();
        });

        window.addEventListener('mouseup', () => {
            if (this.isDragging) {
                this.isDragging = false;
                el.style.cursor = '';
            }
        });
    }

    // --- Action bar ---

    private buildActionBar(container: HTMLElement) {
        const bar = container.createDiv({ cls: 'tikz-action-bar' });

        new Setting(bar)
            .addButton((btn) =>
                btn.setButtonText('Copy TikZ Code').onClick(async () => {
                    const code = this.getCurrentTikzCode();
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
                        const code = this.getCurrentTikzCode();
                        view.editor.replaceSelection('```tikz\n' + code + '\n```\n');
                        this.close();
                    })
            );
    }

    private getCurrentTikzCode(): string {
        return this.is3D() ? this.settings.generate3DTikzCode() : this.settings.generateTikzCode();
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
            let svg: SVGElement;
            if (config.is3D) {
                svg = new SVG3DRenderer(config).render();
            } else {
                svg = new SVGRenderer(config).render();
            }
            this.previewContainer.appendChild(svg);
        } catch (e: any) {
            const errDiv = this.previewContainer.createDiv({ cls: 'tikz-error' });
            errDiv.textContent = e.message || 'Rendering error';
        }

        this.updateCodeArea();
    }

    private updateCodeArea() {
        if (this.codeTextArea) {
            this.codeTextArea.value = this.getCurrentTikzCode();
        }
    }
}
