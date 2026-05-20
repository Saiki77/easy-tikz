import { Modal, Setting, SliderComponent, MarkdownView, Notice, App } from 'obsidian';
import { FunctionParameters, Function3DParameters } from './types';
import { SettingsManager } from './settings';
import { SVGRenderer } from './renderer';
import { SVG3DRenderer } from './renderer3d';
import { COLOR_OPTIONS, THICKNESS_OPTIONS, COLOR_MAP } from './colors';
// @ts-ignore: inline import via esbuild plugin
import styles from 'inline:./styles.css';

const STYLE_ELEMENT_ID = 'easy-tikz-styles';

const PREVIEW_DEBOUNCE_MS = 150;

/**
 * Mouse drag rate: 1 pixel of horizontal drag rotates azimuth by 0.5 degrees,
 * 1 pixel of vertical drag tilts elevation by 0.3 degrees. Slightly lower
 * vertical sensitivity keeps elevation changes feeling proportional to the
 * shallower 0..90 range.
 */
const AZIMUTH_DRAG_RATE = 0.5;
const ELEVATION_DRAG_RATE = 0.3;

/** Step size for keyboard rotation when the preview has focus. */
const KEYBOARD_ROTATION_STEP = 5;

const TABS = ['Graph', 'Axis', 'Functions', 'Grid', 'Code', 'Reference'] as const;
type TabName = (typeof TABS)[number];

/** Tabs that share the same scrollable settings column. Clicking jumps the scroll. */
const SETTINGS_TABS = new Set<TabName>(['Graph', 'Axis', 'Functions', 'Grid']);

interface AxisRange {
    key: string;
    label: string;
    placeholder: string;
}

export class TikzModal extends Modal {
    private settings: SettingsManager;
    private previewContainer: HTMLElement;
    private codeTextArea: HTMLTextAreaElement;
    private previewTimer: number | null = null;
    private tabContents: Map<TabName, HTMLElement> = new Map();
    private tabButtons: Map<TabName, HTMLButtonElement> = new Map();

    private rotationContainer: HTMLElement;
    private zAxisContainer: HTMLElement;
    private axisStyleContainer: HTMLElement;
    private functionsTabContent: HTMLElement;
    private leftPanel: HTMLElement;

    private elevationSlider: SliderComponent | null = null;
    private azimuthSlider: SliderComponent | null = null;

    private isDragging = false;
    private dragStartX = 0;
    private dragStartY = 0;
    private dragStartAzimuth = 0;
    private dragStartElevation = 0;

    private styleEl: HTMLStyleElement | null = null;
    private onMouseMove: ((e: MouseEvent) => void) | null = null;
    private onMouseUp: (() => void) | null = null;

    private settingsColumn: HTMLElement | null = null;
    private onSettingsScroll: (() => void) | null = null;
    private scrollRafId: number | null = null;
    private suspendObserverUntil = 0;

    constructor(app: App) {
        super(app);
        this.settings = new SettingsManager();
    }

    onOpen() {
        if (!document.getElementById(STYLE_ELEMENT_ID)) {
            const styleEl = document.createElement('style');
            styleEl.id = STYLE_ELEMENT_ID;
            styleEl.textContent = styles;
            document.head.appendChild(styleEl);
            this.styleEl = styleEl;
        }

        const { modalEl } = this;
        modalEl.addClass('tikz-modal');

        const layout = modalEl.createDiv({ cls: 'tikz-layout' });

        this.leftPanel = layout.createDiv({ cls: 'tikz-panel-left' });
        this.buildTabBar(this.leftPanel);
        this.buildTabs(this.leftPanel);

        const rightPanel = layout.createDiv({ cls: 'tikz-panel-right' });
        this.previewContainer = rightPanel.createDiv({ cls: 'tikz-preview-area' });
        this.previewContainer.setAttr('tabindex', '0');
        this.previewContainer.setAttr('role', 'img');
        this.previewContainer.setAttr('aria-label', 'Graph preview. Use arrow keys in 3D mode to rotate.');
        this.setupMouseDragRotation();
        this.setupKeyboardRotation();
        this.buildActionBar(rightPanel);

        this.setupSectionObserver();
        this.updatePreview();
    }

    onClose() {
        if (this.previewTimer) window.clearTimeout(this.previewTimer);
        if (this.onMouseMove) window.removeEventListener('mousemove', this.onMouseMove);
        if (this.onMouseUp) window.removeEventListener('mouseup', this.onMouseUp);
        this.onMouseMove = null;
        this.onMouseUp = null;
        if (this.styleEl && this.styleEl.parentNode) {
            this.styleEl.parentNode.removeChild(this.styleEl);
        }
        this.styleEl = null;
        if (this.settingsColumn && this.onSettingsScroll) {
            this.settingsColumn.removeEventListener('scroll', this.onSettingsScroll);
        }
        if (this.scrollRafId !== null) {
            cancelAnimationFrame(this.scrollRafId);
            this.scrollRafId = null;
        }
        this.onSettingsScroll = null;
        this.settingsColumn = null;
        this.tabContents.clear();
        this.tabButtons.clear();
    }

    private is3D(): boolean {
        return this.settings.getValue('dimension') ?? false;
    }

    // --- Tab bar ---

    private buildTabBar(container: HTMLElement) {
        const bar = container.createDiv({ cls: 'tikz-tab-bar' });
        bar.setAttr('role', 'tablist');

        TABS.forEach((name, i) => {
            const btn = bar.createEl('button', { cls: 'tikz-tab-btn', text: name });
            btn.setAttr('role', 'tab');
            btn.setAttr('id', `tikz-tab-${name.toLowerCase()}`);
            btn.setAttr('aria-controls', `tikz-tabpanel-${name.toLowerCase()}`);
            btn.setAttr('aria-selected', String(i === 0));
            if (i === 0) btn.addClass('active');
            btn.onclick = () => this.switchTab(name);
            this.tabButtons.set(name, btn);
        });
    }

    private switchTab(name: TabName) {
        this.setActiveTabButton(name);

        const isSettingsTab = SETTINGS_TABS.has(name);

        if (isSettingsTab) {
            if (this.settingsColumn) this.settingsColumn.style.display = '';
            this.tabContents.forEach((content) => {
                content.style.display = 'none';
            });
            const target = this.settingsColumn?.querySelector<HTMLElement>(`[data-section="${name}"]`);
            if (target && this.settingsColumn) {
                // Suspend the observer briefly so the smooth scroll does not
                // race against scroll-position-based active-tab updates.
                this.suspendObserverUntil = Date.now() + 600;
                target.scrollIntoView({ behavior: 'smooth', block: 'start' });
            }
        } else {
            if (this.settingsColumn) this.settingsColumn.style.display = 'none';
            this.tabContents.forEach((content, key) => {
                content.style.display = key === name ? 'flex' : 'none';
            });
            if (name === 'Code') this.updateCodeArea();
        }
    }

    private setActiveTabButton(name: TabName) {
        this.tabButtons.forEach((btn, key) => {
            const isActive = key === name;
            btn.toggleClass('active', isActive);
            btn.setAttr('aria-selected', String(isActive));
        });
    }

    /**
     * Updates the active tab to match whichever section is currently at the
     * "active line" (a fixed offset below the top of the scroll column).
     * Driven by the scroll event and rAF-throttled.
     */
    private setupSectionObserver() {
        if (!this.settingsColumn) return;
        const column = this.settingsColumn;

        // The active section is the last one whose top is at or above this
        // many pixels from the top of the visible column.
        const ACTIVE_LINE_OFFSET_PX = 80;

        const updateActive = () => {
            this.scrollRafId = null;
            if (Date.now() < this.suspendObserverUntil) return;
            const sections = Array.from(column.querySelectorAll<HTMLElement>('[data-section]'));
            if (!sections.length) return;
            const columnTop = column.getBoundingClientRect().top;

            let active: HTMLElement = sections[0];
            for (const section of sections) {
                const top = section.getBoundingClientRect().top - columnTop;
                if (top <= ACTIVE_LINE_OFFSET_PX) {
                    active = section;
                } else {
                    break;
                }
            }

            const name = active.getAttribute('data-section') as TabName | null;
            if (name) this.setActiveTabButton(name);
        };

        this.onSettingsScroll = () => {
            if (this.scrollRafId === null) {
                this.scrollRafId = requestAnimationFrame(updateActive);
            }
        };

        column.addEventListener('scroll', this.onSettingsScroll, { passive: true });
        updateActive();
    }

    // --- Tab contents ---

    private buildTabs(container: HTMLElement) {
        // Single scrollable column shared by Graph, Axis, Functions, Grid.
        this.settingsColumn = container.createDiv({ cls: 'tikz-settings-column' });

        this.buildGraphTab(this.settingsColumn);
        this.buildAxisTab(this.settingsColumn);
        this.buildFunctionsTab(this.settingsColumn);
        this.buildGridTab(this.settingsColumn);

        // Standalone panels for the non-settings tabs.
        this.buildCodeTab(container);
        this.buildReferenceTab(container);
    }

    private createTabContent(container: HTMLElement, name: TabName, _visible = false): HTMLElement {
        if (SETTINGS_TABS.has(name)) {
            // Section inside the shared scroll column.
            const section = container.createDiv({ cls: 'tikz-section tikz-settings-section' });
            section.setAttr('data-section', name);
            section.setAttr('id', `tikz-section-${name.toLowerCase()}`);
            section.createEl('h3', { cls: 'tikz-section-heading', text: name });
            return section;
        }

        // Standalone tab panel (Code, Reference) sitting next to the settings column.
        const content = container.createDiv({ cls: 'tikz-tab-content' });
        content.setAttr('role', 'tabpanel');
        content.setAttr('id', `tikz-tabpanel-${name.toLowerCase()}`);
        content.setAttr('aria-labelledby', `tikz-tab-${name.toLowerCase()}`);
        content.style.display = 'none';
        if (name === 'Code') content.addClass('tikz-code-panel');
        if (name === 'Reference') content.addClass('tikz-reference');
        this.tabContents.set(name, content);
        return content;
    }

    private buildGraphTab(container: HTMLElement) {
        const tab = this.createTabContent(container, 'Graph', true);

        new Setting(tab)
            .setName('3D mode')
            .setDesc('Switch between 2D function plots and 3D surface plots.')
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
            .setDesc('Name displayed above the graph.')
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
            .setDesc('Width of the exported TikZ image.')
            .addSlider((s) =>
                s.setLimits(1, 20, 1).setValue(this.settings.getValue('size_x_cm')).setDynamicTooltip().onChange((v) => {
                    this.settings.setValue('size_x_cm', v);
                    this.requestPreviewUpdate();
                })
            );

        new Setting(tab)
            .setName('Height (cm)')
            .setDesc('Height of the exported TikZ image.')
            .addSlider((s) =>
                s.setLimits(1, 20, 1).setValue(this.settings.getValue('size_y_cm')).setDynamicTooltip().onChange((v) => {
                    this.settings.setValue('size_y_cm', v);
                    this.requestPreviewUpdate();
                })
            );

        new Setting(tab)
            .setName('Use pgfplots')
            .setDesc('Include the pgfplots package in the TikZ code.')
            .addToggle((t) =>
                t.setValue(this.settings.getValue('documentSetup')).onChange((v) => {
                    this.settings.setValue('documentSetup', v);
                    this.requestPreviewUpdate();
                })
            );

        this.rotationContainer = tab.createDiv({ cls: 'tikz-3d-controls' });

        new Setting(this.rotationContainer)
            .setName('Elevation')
            .setDesc('Tilt: 0 looks at the surface edge-on, 90 looks straight down. Drag preview or press up/down arrows.')
            .addSlider((s) => {
                this.elevationSlider = s;
                s.setLimits(0, 90, 1).setValue(this.settings.getValue('rotationX')).setDynamicTooltip().onChange((v) => {
                    this.settings.setValue('rotationX', v);
                    this.requestPreviewUpdate();
                });
            });

        new Setting(this.rotationContainer)
            .setName('Azimuth')
            .setDesc('Camera rotation around the vertical axis. Drag preview or press left/right arrows.')
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
            .setName('X-axis label')
            .addText((text) =>
                text.setValue(this.settings.getValue('axis_label_x')).onChange((v) => {
                    this.settings.setValue('axis_label_x', v);
                    this.requestPreviewUpdate();
                })
            );

        new Setting(tab)
            .setName('Y-axis label')
            .addText((text) =>
                text.setValue(this.settings.getValue('axis_label_y')).onChange((v) => {
                    this.settings.setValue('axis_label_y', v);
                    this.requestPreviewUpdate();
                })
            );

        this.zAxisContainer = tab.createDiv({ cls: 'tikz-3d-controls' });

        new Setting(this.zAxisContainer)
            .setName('Z-axis label')
            .addText((text) =>
                text.setValue(this.settings.getValue('axis_label_z')).onChange((v) => {
                    this.settings.setValue('axis_label_z', v);
                    this.requestPreviewUpdate();
                })
            );

        this.buildAxisRange(tab, [
            { key: 'xmin', label: 'X min', placeholder: '-0.5' },
            { key: 'xmax', label: 'X max', placeholder: '10' },
        ]);
        this.buildAxisRange(tab, [
            { key: 'ymin', label: 'Y min', placeholder: '-0.5' },
            { key: 'ymax', label: 'Y max', placeholder: '5' },
        ]);
        this.buildAxisRange(this.zAxisContainer, [
            { key: 'zmin', label: 'Z min', placeholder: '-5' },
            { key: 'zmax', label: 'Z max', placeholder: '5' },
        ]);

        this.axisStyleContainer = tab.createDiv();
        new Setting(this.axisStyleContainer)
            .setName('Axis style')
            .setDesc('Box: axes around the plot. Middle: axes cross at origin.')
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

    private buildAxisRange(parent: HTMLElement, fields: AxisRange[]) {
        const range = parent.createDiv({ cls: 'tikz-range-group' });
        fields.forEach((field, i) => {
            const wrapper = range.createDiv();
            new Setting(wrapper).setName(field.label).addText((t) => {
                t.setPlaceholder(field.placeholder)
                    .setValue(this.settings.getValue(field.key))
                    .onChange((v) => {
                        const trimmed = v.trim();
                        if (trimmed === '' || isFinite(Number(trimmed))) {
                            this.settings.setValue(field.key, v);
                            this.requestPreviewUpdate();
                        } else {
                            new Notice(`${field.label} must be a number.`);
                            t.setValue(this.settings.getValue(field.key));
                        }
                    });
            });
            if (i < fields.length - 1) {
                range.createSpan({ cls: 'tikz-range-separator', text: 'to' });
            }
        });
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
            card.style.borderLeftColor = COLOR_MAP[state.color];

            const header = card.createDiv({ cls: 'tikz-func-header' });
            header.createSpan({ cls: 'tikz-func-label', text: `Function ${rowStates.size}` });
            new Setting(header).addButton((btn) =>
                btn
                    .setIcon('trash')
                    .setTooltip('Remove function')
                    .then((b) => b.buttonEl.setAttr('aria-label', 'Remove function'))
                    .onClick(() => {
                        rowStates.delete(rowId);
                        card.remove();
                        updateFunctionValues();
                    })
            );

            const row1 = card.createDiv({ cls: 'tikz-func-row' });
            const exprDiv = row1.createDiv({ cls: 'tikz-func-field wide' });
            new Setting(exprDiv)
                .setName('Expression')
                .setDesc('Use x. Supports +, -, *, /, ^, parentheses, and Math.* functions.')
                .addText((t) =>
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
                    card.style.borderLeftColor = COLOR_MAP[v] || 'var(--text-muted)';
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

            type BooleanKey = 'showLegend' | 'fill' | 'tangent' | 'dashed' | 'extrema';
            const toggles: { name: string; key: BooleanKey }[] = [
                { name: 'Legend', key: 'showLegend' },
                { name: 'Fill', key: 'fill' },
                { name: 'Tangent', key: 'tangent' },
                { name: 'Dashed', key: 'dashed' },
                { name: 'Extrema', key: 'extrema' },
            ];

            toggles.forEach(({ name, key }) => {
                const chip = row3.createDiv({ cls: 'tikz-toggle-chip' });
                new Setting(chip).setName(name).addToggle((t) =>
                    t.setValue(state[key]).onChange((v) => {
                        state[key] = v;
                        if (key === 'tangent') tangentInput.toggleClass('visible', v);
                        updateFunctionValues();
                    })
                );
            });
        };

        addFunctionCard();

        const addBtnDiv = tab.createDiv({ cls: 'tikz-add-func' });
        new Setting(addBtnDiv).addButton((btn) =>
            btn.setButtonText('+ Add function').onClick(() => addFunctionCard())
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
            card.style.borderLeftColor = COLOR_MAP[state.color] || 'var(--text-muted)';

            const header = card.createDiv({ cls: 'tikz-func-header' });
            header.createSpan({ cls: 'tikz-func-label', text: `Surface ${rowStates.size}` });
            new Setting(header).addButton((btn) =>
                btn
                    .setIcon('trash')
                    .setTooltip('Remove surface')
                    .then((b) => b.buttonEl.setAttr('aria-label', 'Remove surface'))
                    .onClick(() => {
                        rowStates.delete(rowId);
                        card.remove();
                        updateFunctionValues();
                    })
            );

            const row1 = card.createDiv({ cls: 'tikz-func-row' });
            const exprDiv = row1.createDiv({ cls: 'tikz-func-field wide' });
            new Setting(exprDiv)
                .setName('f(x, y)')
                .setDesc('Use x and y. Supports +, -, *, /, ^, parentheses, and Math.* functions.')
                .addText((t) =>
                    t.setPlaceholder('sin(x)*cos(y)').onChange((v) => {
                        state.expression = v;
                        updateFunctionValues();
                    })
                );

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

            const row3 = card.createDiv({ cls: 'tikz-func-row' });
            const colorDiv = row3.createDiv({ cls: 'tikz-func-field' });
            new Setting(colorDiv).setName('Color').addDropdown((d) =>
                d.addOptions(COLOR_OPTIONS).setValue(state.color).onChange((v) => {
                    state.color = v;
                    card.style.borderLeftColor = COLOR_MAP[v] || 'var(--text-muted)';
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
            btn.setButtonText('+ Add surface').onClick(() => addFunctionCard())
        );
    }

    private buildGridTab(container: HTMLElement) {
        const tab = this.createTabContent(container, 'Grid');

        new Setting(tab)
            .setName('Show major grid')
            .setDesc('Display major coordinate grid lines.')
            .addToggle((t) =>
                t.setValue(this.settings.getValue('showLargeGrid')).onChange((v) => {
                    this.settings.setValue('showLargeGrid', v);
                    this.requestPreviewUpdate();
                })
            );

        new Setting(tab)
            .setName('Major divisions')
            .setDesc('Approximate number of major grid cells across the X axis. The Y axis follows proportionally.')
            .addSlider((s) =>
                s.setLimits(2, 20, 1).setValue(this.settings.getValue('majorTickNum') ?? 8).setDynamicTooltip().onChange((v) => {
                    this.settings.setValue('majorTickNum', v);
                    this.requestPreviewUpdate();
                })
            );

        new Setting(tab)
            .setName('Show minor grid')
            .setDesc('Display minor coordinate grid lines between the major ones.')
            .addToggle((t) =>
                t.setValue(this.settings.getValue('showSmallGrid')).onChange((v) => {
                    this.settings.setValue('showSmallGrid', v);
                    this.requestPreviewUpdate();
                })
            );

        new Setting(tab)
            .setName('Minor subdivisions')
            .setDesc('Number of minor subdivisions between two major grid lines.')
            .addSlider((s) =>
                s.setLimits(1, 10, 1).setValue(this.settings.getValue('gridSize')).setDynamicTooltip().onChange((v) => {
                    this.settings.setValue('gridSize', v);
                    this.requestPreviewUpdate();
                })
            );
    }

    private buildCodeTab(container: HTMLElement) {
        const tab = this.createTabContent(container, 'Code');
        const textarea = tab.createEl('textarea', { cls: 'tikz-code-textarea' });
        textarea.spellcheck = false;
        textarea.setAttr('aria-label', 'Generated TikZ code. Editable, but changes are overwritten when settings update.');
        this.codeTextArea = textarea;
    }

    private buildReferenceTab(container: HTMLElement) {
        const tab = this.createTabContent(container, 'Reference');

        const section = (title: string) => {
            const h = tab.createEl('h3', { cls: 'tikz-ref-heading', text: title });
            return h;
        };

        const para = (text: string) => {
            tab.createEl('p', { cls: 'tikz-ref-para', text });
        };

        const list = (items: { name: string; desc: string }[]) => {
            const dl = tab.createEl('dl', { cls: 'tikz-ref-list' });
            items.forEach((item) => {
                dl.createEl('dt', { text: item.name });
                dl.createEl('dd', { text: item.desc });
            });
        };

        const code = (text: string) => {
            tab.createEl('pre', { cls: 'tikz-ref-code', text });
        };

        section('Expressions');
        para('Use the variable x in 2D, or x and y in 3D. Expressions are JavaScript with one convenience: ^ is treated as the power operator (rewritten to **).');

        section('Operators');
        list([
            { name: '+  -  *  /', desc: 'Standard arithmetic.' },
            { name: '^', desc: 'Power. Equivalent to ** in JavaScript. x^2 means x squared.' },
            { name: '( )', desc: 'Grouping. Always wrap fractions, e.g. 1/(x+1).' },
        ]);

        section('Trigonometry');
        para('Angles are in radians. Use PI for degrees, e.g. sin(x * PI / 180).');
        list([
            { name: 'sin(x)  cos(x)  tan(x)', desc: 'Sine, cosine, tangent.' },
            { name: 'asin(x)  acos(x)  atan(x)', desc: 'Inverse trig (radians).' },
            { name: 'atan2(y, x)', desc: 'Inverse tangent of y/x with correct quadrant.' },
            { name: 'sinh(x)  cosh(x)  tanh(x)', desc: 'Hyperbolic trig.' },
            { name: 'asinh(x)  acosh(x)  atanh(x)', desc: 'Inverse hyperbolic.' },
        ]);

        section('Exponentials and logs');
        list([
            { name: 'exp(x)', desc: 'e raised to x.' },
            { name: 'log(x)', desc: 'Natural log (base e).' },
            { name: 'log2(x)  log10(x)', desc: 'Logs base 2 and 10.' },
            { name: 'pow(a, b)', desc: 'Same as a^b. Useful when one operand is itself complex.' },
        ]);

        section('Roots and rounding');
        list([
            { name: 'sqrt(x)  cbrt(x)', desc: 'Square root, cube root.' },
            { name: 'abs(x)  sign(x)', desc: 'Absolute value, sign (-1, 0, or 1).' },
            { name: 'floor(x)  ceil(x)  round(x)  trunc(x)', desc: 'Rounding helpers.' },
            { name: 'min(a, b)  max(a, b)  hypot(a, b)', desc: 'Pairwise helpers.' },
        ]);

        section('Constants');
        list([
            { name: 'PI', desc: '3.14159...' },
            { name: 'E', desc: '2.71828...' },
            { name: 'LN2  LN10  LOG2E  LOG10E  SQRT2', desc: 'The usual companions.' },
        ]);

        section('Examples');
        code(
            'x^2                       parabola\n' +
            'x^3 - 3*x                 cubic with two extrema\n' +
            'sin(x)                    sine wave\n' +
            'tanh(x)                   smooth step\n' +
            'sin(x) * exp(-x/5)        damped oscillation\n' +
            '1 / (1 + x^2)             bell curve (Cauchy)\n' +
            'sqrt(1 - x^2)             upper half-circle (domain -1:1)\n' +
            'sin(x*PI/180)             sine of an angle in degrees'
        );

        section('Domain');
        para('A domain is min:max, e.g. -10:10 or 0:6.28. Min must be strictly less than max. Each function card has its own domain so different curves can span different ranges.');

        section('Function options');
        para('Each card on the Functions tab exposes the same set of styling and analysis toggles.');
        list([
            { name: 'Color', desc: 'Black, Red, Blue, Teal, Orange, Green, Purple. Black resolves to the theme text color so the curve is visible in both light and dark themes.' },
            { name: 'Thickness', desc: 'Very thin, Thin, Thick, Very thick. Affects the rendered TikZ output and the live preview equally.' },
            { name: 'Dashed', desc: 'Draws the curve as a dashed line rather than a solid stroke.' },
            { name: 'Fill', desc: 'Shades the region between the curve and the x-axis with a low-opacity tint of the curve color.' },
            { name: 'Legend', desc: 'Adds the expression to the legend box in the upper-right of the plot.' },
        ]);

        section('Tangent');
        para('Enable the Tangent toggle to draw the line tangent to the curve at a chosen x value. The Tangent point field appears once the toggle is on. The point must lie inside the domain. A small dot marks the touch point.');

        section('Extrema');
        para('Enable the Extrema toggle to scan the domain for local minima and maxima. Detected points are marked with a dot and labelled "min" or "max". Resolution is 100 samples across the domain, so very sharp features inside a wide domain might be missed.');

        section('3D surfaces');
        para('Switch the modal to 3D mode on the Graph tab. The Functions tab then accepts two-variable expressions.');
        code(
            'sin(x) * cos(y)\n' +
            'x^2 + y^2                 paraboloid\n' +
            'sin(sqrt(x^2 + y^2))      ripple pattern\n' +
            'exp(-(x^2 + y^2) / 4)     gaussian bump\n' +
            'x*y                       saddle\n' +
            'cos(x) + sin(y)           interference pattern'
        );

        section('3D surface options');
        list([
            { name: 'X domain / Y domain', desc: 'Each axis gets its own range. The surface is sampled on a 40 by 40 grid across these ranges.' },
            { name: 'Color', desc: 'Same palette as 2D. The surface is shaded from the base color toward white based on z value.' },
            { name: 'Wireframe', desc: 'Renders only the grid lines of the surface, no fill. Useful when stacking multiple surfaces.' },
            { name: 'Opacity', desc: 'Slider from 0.1 to 1.0. Affects the filled surface; wireframes use the opacity for stroke transparency.' },
        ]);

        section('Camera (3D)');
        para('The Graph tab has Elevation and Azimuth sliders. You can also drag the preview to rotate, or click into the preview and use the arrow keys (5 degree steps).');
        list([
            { name: 'Elevation', desc: '0 is edge-on (looking along the y-axis), 90 is straight down.' },
            { name: 'Azimuth', desc: 'Rotation of the camera around the vertical axis (0 to 360).' },
        ]);

        section('Grid');
        para('Major grid lines and minor subdivisions can be toggled independently. The Major divisions slider sets how many cells span the X axis (Y follows proportionally). Minor subdivisions chooses how many minor lines sit between two major ones.');

        section('Recipes');
        para('Quick starts for common plots. Copy the expression, the suggested domain, and the suggested ranges.');
        code(
            'Parabola               x^2                       domain -3:3       y -1:9\n' +
            'Cubic                  x^3 - 3*x                 domain -2:2       y -3:3\n' +
            'Sine wave              sin(x)                    domain 0:2*PI     y -1.5:1.5\n' +
            'Damped oscillation     sin(x) * exp(-x/5)        domain 0:20       y -1:1\n' +
            'Gaussian               exp(-x^2)                 domain -3:3       y 0:1.2\n' +
            'Logistic               1 / (1 + exp(-x))         domain -6:6       y 0:1\n' +
            'Hyperbola              1 / x                     domain 0.1:5      y 0:10\n' +
            'Tangent (clipped)      tan(x)                    domain -1.5:1.5   y -10:10\n' +
            'Circle (upper half)    sqrt(1 - x^2)             domain -1:1       y 0:1.2\n' +
            'Ellipse (upper half)   sqrt(1 - (x/2)^2)         domain -2:2       y 0:1.2'
        );

        section('Troubleshooting');
        list([
            { name: '"Render failed" toast.', desc: 'The expression could not be evaluated. Common causes: missing operator (write 2*x not 2x), unbalanced parentheses, undefined name (you typed Tan instead of tan).' },
            { name: 'Curve disappears off the top or bottom.', desc: 'Adjust the Y range on the Axis tab. Values outside the range are clipped.' },
            { name: 'Tangent point error.', desc: 'The x value you entered is not inside the function domain. Check the Domain field on the same card.' },
            { name: '3D surface is empty.', desc: 'The expression returned NaN or Infinity at every sample. Most often log of a negative number, or division by zero across the whole grid.' },
            { name: 'Plot looks jagged.', desc: 'The 2D renderer uses 500 samples; the 3D renderer uses a 40x40 grid. Both are fixed. For smoother output, narrow the domain so the same samples cover a smaller range.' },
        ]);

        section('Tips');
        list([
            {
                name: 'Math.* still works.',
                desc: 'Anything from the JavaScript Math namespace is also accessible explicitly, e.g. Math.tan(x). The bare names above are just shortcuts.',
            },
            {
                name: 'Errors surface as a notice.',
                desc: 'If an expression fails to evaluate, you will see a transient toast at the top of the screen. The Code tab still updates.',
            },
            {
                name: 'Asymptotes are clipped.',
                desc: 'Values whose absolute size exceeds 10x the Y axis range are dropped, so tan(x) near pi/2 will not blow out the chart.',
            },
            {
                name: 'Code tab is editable.',
                desc: 'You can tweak the generated TikZ before copying or inserting. Settings changes overwrite your edits unless the textarea is focused.',
            },
            {
                name: 'Keyboard navigation.',
                desc: 'Click any tab and the active state follows you as you scroll. Tab clicks smooth-scroll to that section.',
            },
        ]);
    }

    private update3DVisibility() {
        const show3D = this.is3D();
        if (this.rotationContainer) this.rotationContainer.style.display = show3D ? 'block' : 'none';
        if (this.zAxisContainer) this.zAxisContainer.style.display = show3D ? 'block' : 'none';
        if (this.axisStyleContainer) this.axisStyleContainer.style.display = show3D ? 'none' : 'block';
        if (this.previewContainer) this.previewContainer.toggleClass('is-3d', show3D);
    }

    private setupMouseDragRotation() {
        const el = this.previewContainer;

        el.addEventListener('mousedown', (e: MouseEvent) => {
            if (!this.is3D()) return;
            this.isDragging = true;
            this.dragStartX = e.clientX;
            this.dragStartY = e.clientY;
            this.dragStartAzimuth = this.settings.getValue('rotationZ') ?? 45;
            this.dragStartElevation = this.settings.getValue('rotationX') ?? 30;
            el.addClass('tikz-preview-dragging');
            e.preventDefault();
        });

        this.onMouseMove = (e: MouseEvent) => {
            if (!this.isDragging) return;
            const dx = e.clientX - this.dragStartX;
            const dy = e.clientY - this.dragStartY;

            let newAzimuth = this.dragStartAzimuth + dx * AZIMUTH_DRAG_RATE;
            let newElevation = this.dragStartElevation - dy * ELEVATION_DRAG_RATE;

            newAzimuth = ((newAzimuth % 360) + 360) % 360;
            newElevation = Math.max(0, Math.min(90, newElevation));

            this.applyRotation(Math.round(newAzimuth), Math.round(newElevation));
        };

        this.onMouseUp = () => {
            if (this.isDragging) {
                this.isDragging = false;
                el.removeClass('tikz-preview-dragging');
            }
        };

        window.addEventListener('mousemove', this.onMouseMove);
        window.addEventListener('mouseup', this.onMouseUp);
    }

    private setupKeyboardRotation() {
        this.previewContainer.addEventListener('keydown', (e: KeyboardEvent) => {
            if (!this.is3D()) return;
            const az = this.settings.getValue('rotationZ') ?? 45;
            const el = this.settings.getValue('rotationX') ?? 30;
            let newAz = az;
            let newEl = el;
            switch (e.key) {
                case 'ArrowLeft':
                    newAz = ((az - KEYBOARD_ROTATION_STEP) % 360 + 360) % 360;
                    break;
                case 'ArrowRight':
                    newAz = (az + KEYBOARD_ROTATION_STEP) % 360;
                    break;
                case 'ArrowUp':
                    newEl = Math.min(90, el + KEYBOARD_ROTATION_STEP);
                    break;
                case 'ArrowDown':
                    newEl = Math.max(0, el - KEYBOARD_ROTATION_STEP);
                    break;
                default:
                    return;
            }
            e.preventDefault();
            this.applyRotation(newAz, newEl);
        });
    }

    private applyRotation(azimuth: number, elevation: number) {
        this.settings.setValue('rotationZ', azimuth);
        this.settings.setValue('rotationX', elevation);
        if (this.azimuthSlider) this.azimuthSlider.setValue(azimuth);
        if (this.elevationSlider) this.elevationSlider.setValue(elevation);
        this.requestPreviewUpdate();
    }

    private buildActionBar(container: HTMLElement) {
        const bar = container.createDiv({ cls: 'tikz-action-bar' });

        new Setting(bar)
            .addButton((btn) =>
                btn
                    .setButtonText('Copy TikZ code')
                    .then((b) => b.buttonEl.setAttr('aria-label', 'Copy generated TikZ code to clipboard'))
                    .onClick(async () => {
                        const code = this.getCurrentTikzCode();
                        try {
                            await navigator.clipboard.writeText(code);
                            const orig = btn.buttonEl.textContent;
                            btn.setButtonText('Copied');
                            setTimeout(() => btn.setButtonText(orig || 'Copy TikZ code'), 2000);
                        } catch {
                            new Notice('Could not access clipboard.');
                        }
                    })
            )
            .addButton((btn) =>
                btn
                    .setButtonText('Insert into note')
                    .setCta()
                    .then((b) => b.buttonEl.setAttr('aria-label', 'Insert generated TikZ code into the current note'))
                    .onClick(() => {
                        const view = this.app.workspace.getActiveViewOfType(MarkdownView);
                        if (!view) {
                            new Notice('No active note to insert into.');
                            return;
                        }
                        const code = this.getCurrentTikzCode();
                        view.editor.replaceSelection('```tikz\n' + code + '\n```\n');
                        this.close();
                    })
            );
    }

    /** Fresh TikZ code generated from the current settings. */
    private generateTikzCodeFresh(): string {
        return this.is3D() ? this.settings.generate3DTikzCode() : this.settings.generateTikzCode();
    }

    /**
     * Returns the code to copy or insert. Uses the textarea value so user
     * tweaks survive, falling back to a fresh render if the textarea is empty.
     */
    private getCurrentTikzCode(): string {
        const edited = this.codeTextArea?.value;
        if (edited && edited.trim().length > 0) return edited;
        return this.generateTikzCodeFresh();
    }

    private requestPreviewUpdate() {
        if (this.previewTimer) window.clearTimeout(this.previewTimer);
        this.previewTimer = window.setTimeout(() => this.updatePreview(), PREVIEW_DEBOUNCE_MS) as unknown as number;
    }

    private updatePreview() {
        this.previewContainer.empty();

        try {
            const config = this.settings.toRendererConfig();
            const svg: SVGElement = config.is3D
                ? new SVG3DRenderer(config).render()
                : new SVGRenderer(config).render();
            this.previewContainer.appendChild(svg);
        } catch (e) {
            const message = e instanceof Error ? e.message : 'Rendering error';
            new Notice(`Render failed: ${message}`);
        }

        this.updateCodeArea();
    }

    private updateCodeArea() {
        if (!this.codeTextArea) return;
        // Don't trample user edits while they're actively typing in the textarea.
        if (document.activeElement === this.codeTextArea) return;
        this.codeTextArea.value = this.generateTikzCodeFresh();
    }
}
