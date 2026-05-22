import { Modal, Setting, SliderComponent, TextComponent, MarkdownView, Notice, App, TFile, setIcon } from 'obsidian';
import { FunctionParameters, Function3DParameters, Tool, ArrowStyle, FillPattern } from './types';
import { SettingsManager } from './settings';
import { SVGRenderer } from './renderer';
import { SVG3DRenderer } from './renderer3d';
import { COLOR_OPTIONS, THICKNESS_OPTIONS, COLOR_MAP } from './colors';
import { BUILT_IN_2D, BUILT_IN_3D, UserTemplate } from './templates';
import { MathHelper } from './math';

// Loose type so we can keep importing the plugin without a circular dep.
interface PluginHost {
    data: {
        userTemplates: UserTemplate[];
        invertDrag3D?: boolean;
        maxSamples3D?: number;
        dragSensitivity2D?: number;
    };
    saveUserTemplates(templates: UserTemplate[]): Promise<void>;
}

/**
 * Optional state passed when the modal is opened by clicking an
 * already-rendered easy-tikz block: pre-fills the SettingsManager and
 * remembers the source location so "Insert into note" can replace the
 * block in place instead of inserting at the cursor.
 */
export interface TikzModalInitialState {
    data: Record<string, unknown>;
    sourceFile?: TFile | null;
    originalBlockText?: string;
    /** Either 'easy-tikz' (default emit) or 'tikz' (when re-rendering an existing tikz-tagged block). */
    fenceTag?: 'easy-tikz' | 'tikz';
}

/**
 * Trim the top and bottom percentile of the values then return min/max.
 * Keeps vertical asymptotes from blowing out auto-fit ranges.
 */
function trimmedRange(values: number[], percentile = 0.01): [number, number] {
    if (!values.length) return [0, 1];
    const sorted = values.slice().sort((a, b) => a - b);
    const drop = Math.floor(sorted.length * percentile);
    const lo = sorted[drop];
    const hi = sorted[sorted.length - 1 - drop];
    return [lo, hi];
}
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

/**
 * Padding the SVG renderers reserve around the plot area. Mirrored here so
 * the modal can map cursor positions back to math coordinates for zoom/pan.
 */
const RENDERER_PADDING = { top: 45, right: 30, bottom: 45, left: 55 };

/** Scroll-wheel zoom factor per notch. > 1 zooms out, < 1 zooms in. */
const WHEEL_ZOOM_FACTOR = 1.15;

const TABS = ['Graph', 'Axis', 'Functions', 'Tools', 'Annotations', 'Grid', 'Code', 'Reference'] as const;
type TabName = (typeof TABS)[number];

/** Tabs that share the same scrollable settings column. Clicking jumps the scroll. */
const SETTINGS_TABS = new Set<TabName>(['Graph', 'Axis', 'Functions', 'Tools', 'Annotations', 'Grid']);

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
    private previewRafId: number | null = null;
    private trailingSvgTimer: number | null = null;
    private svg3dRenderer: SVG3DRenderer | null = null;
    private currentRenderMode: '2d' | '3d' | null = null;
    private tabContents: Map<TabName, HTMLElement> = new Map();
    private tabButtons: Map<TabName, HTMLButtonElement> = new Map();

    private rotationContainer: HTMLElement;
    private zAxisContainer: HTMLElement;
    private axisStyleContainer: HTMLElement;
    private functionsTabContent: HTMLElement;
    private toolsTabContent: HTMLElement;
    private leftPanel: HTMLElement;
    private zoom3DOverlay: HTMLElement | null = null;
    private floatingActionsOverlay: HTMLElement | null = null;
    private xLabelInput: TextComponent | null = null;
    private yLabelInput: TextComponent | null = null;
    private previewResizeObserver: ResizeObserver | null = null;
    private lastObservedPreviewSize: { w: number; h: number } | null = null;

    private elevationSlider: SliderComponent | null = null;
    private azimuthSlider: SliderComponent | null = null;

    private isDragging = false;
    private dragStartX = 0;
    private dragStartY = 0;
    private dragStartAzimuth = 0;
    private dragStartElevation = 0;
    private dragStartXmin = 0;
    private dragStartXmax = 0;
    private dragStartYmin = 0;
    private dragStartYmax = 0;

    private rangeInputs: Map<string, TextComponent> = new Map();

    private draggingAnnotationIdx: number | null = null;
    private annotationCards: Array<{
        rowId: string;
        state: import('./types').Annotation;
        xInput: TextComponent | null;
        yInput: TextComponent | null;
        zInput: TextComponent | null;
    }> = [];
    private annotationUpdateFn: (() => void) | null = null;

    private styleEl: HTMLStyleElement | null = null;
    private onMouseMove: ((e: MouseEvent) => void) | null = null;
    private onMouseUp: (() => void) | null = null;

    private settingsColumn: HTMLElement | null = null;
    private onSettingsScroll: (() => void) | null = null;
    private scrollRafId: number | null = null;
    private suspendObserverUntil = 0;

    private plugin: PluginHost | null = null;
    private sourceFile: TFile | null = null;
    private originalBlockText: string | null = null;
    private fenceTag: 'easy-tikz' | 'tikz' = 'easy-tikz';

    constructor(app: App, plugin?: PluginHost, initialState?: TikzModalInitialState) {
        super(app);
        this.plugin = plugin ?? null;
        if (initialState && initialState.data) {
            this.settings = SettingsManager.fromJSON(initialState.data);
            this.sourceFile = initialState.sourceFile ?? null;
            this.originalBlockText = initialState.originalBlockText ?? null;
            this.fenceTag = initialState.fenceTag ?? 'easy-tikz';
        } else {
            this.settings = new SettingsManager();
        }
    }

    private getUserTemplates(): UserTemplate[] {
        return this.plugin?.data?.userTemplates ?? [];
    }

    private async setUserTemplates(templates: UserTemplate[]): Promise<void> {
        if (this.plugin) await this.plugin.saveUserTemplates(templates);
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
        this.buildZoom3DOverlay();
        this.buildFloatingActions();
        this.setupMouseDragRotation();
        this.setupKeyboardRotation();
        this.buildActionBar(rightPanel);

        this.setupSectionObserver();
        this.setupPreviewResizeObserver();
        // Re-run visibility now that every panel and overlay exists. Earlier
        // calls fired during tab construction before right-panel overlays
        // were attached; this second pass picks them up.
        this.update3DVisibility();
        this.updatePreview();
    }

    onClose() {
        if (this.previewTimer) window.clearTimeout(this.previewTimer);
        this.previewTimer = null;
        if (this.previewRafId !== null) cancelAnimationFrame(this.previewRafId);
        this.previewRafId = null;
        if (this.trailingSvgTimer) window.clearTimeout(this.trailingSvgTimer);
        this.trailingSvgTimer = null;
        if (this.onMouseMove) window.removeEventListener('mousemove', this.onMouseMove);
        if (this.onMouseUp) window.removeEventListener('mouseup', this.onMouseUp);
        this.onMouseMove = null;
        this.onMouseUp = null;
        if (this.previewResizeObserver) {
            this.previewResizeObserver.disconnect();
            this.previewResizeObserver = null;
        }
        this.lastObservedPreviewSize = null;
        this.rangeInputs.clear();
        this.svg3dRenderer = null;
        this.currentRenderMode = null;
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
        // Single scrollable column shared by Graph, Axis, Functions, Annotations, Grid.
        this.settingsColumn = container.createDiv({ cls: 'tikz-settings-column' });

        this.buildGraphTab(this.settingsColumn);
        this.buildAxisTab(this.settingsColumn);
        this.buildFunctionsTab(this.settingsColumn);
        this.buildToolsTab(this.settingsColumn);
        this.buildAnnotationsTab(this.settingsColumn);
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
                    this.rebuildToolsTab();
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

        new Setting(tab)
            .setName('Coordinate system')
            .setDesc('Cartesian uses f(x). Polar uses r(theta) and plots r in radians. Polar mode is 2D only.')
            .addDropdown((d) =>
                d.addOptions({ cartesian: 'Cartesian', polar: 'Polar' })
                    .setValue(this.settings.getValue('coordinateSystem') ?? 'cartesian')
                    .onChange((v) => {
                        this.settings.setValue('coordinateSystem', v);
                        // Axis labels are stored per-coordinate-system; refresh
                        // the inputs so the user sees the right pair after toggling.
                        this.refreshAxisLabelInputs();
                        this.requestPreviewUpdate();
                    })
            );

        new Setting(tab)
            .setName('Preview size')
            .setDesc('Width of the live preview, in pixels. Does not affect the exported TikZ dimensions. Scroll on the preview to zoom and drag to pan.')
            .addSlider((s) =>
                s.setLimits(400, 1400, 20)
                    .setValue(this.settings.getValue('previewSize') ?? 760)
                    .setDynamicTooltip()
                    .onChange((v) => {
                        this.settings.setValue('previewSize', v);
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
                    this.requestPreviewUpdateFast();
                });
            });

        new Setting(this.rotationContainer)
            .setName('Azimuth')
            .setDesc('Camera rotation around the vertical axis. Drag preview or press left/right arrows.')
            .addSlider((s) => {
                this.azimuthSlider = s;
                s.setLimits(0, 360, 1).setValue(this.settings.getValue('rotationZ')).setDynamicTooltip().onChange((v) => {
                    this.settings.setValue('rotationZ', v);
                    this.requestPreviewUpdateFast();
                });
            });

        new Setting(this.rotationContainer)
            .setName('Box aspect')
            .setDesc(
                'Equal: each axis spans the same length on screen — the bounding box is a perfect cube. ' +
                    'True: edge lengths scale with the data ranges (xmax-xmin, ymax-ymin, zmax-zmin), so an axis with a much larger range dominates the box. The exported pgfplots adds `axis equal image` when Equal is selected.'
            )
            .addDropdown((d) =>
                d
                    .addOptions({ equal: 'Equal (cube)', true: 'True (proportional)' })
                    .setValue(this.settings.getValue('boxAspect') ?? 'true')
                    .onChange((v) => {
                        this.settings.setValue('boxAspect', v);
                        this.requestPreviewUpdate();
                    })
            );

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
            .setDesc('In polar mode this edits a separate polar X label so your cartesian label stays intact.')
            .addText((text) => {
                this.xLabelInput = text;
                text.setValue(this.currentXLabelValue()).onChange((v) => {
                    this.settings.setValue(this.currentXLabelKey(), v);
                    this.requestPreviewUpdate();
                });
            });

        new Setting(tab)
            .setName('Y-axis label')
            .setDesc('In polar mode this edits a separate polar Y label so your cartesian label stays intact.')
            .addText((text) => {
                this.yLabelInput = text;
                text.setValue(this.currentYLabelValue()).onChange((v) => {
                    this.settings.setValue(this.currentYLabelKey(), v);
                    this.requestPreviewUpdate();
                });
            });

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

        new Setting(tab)
            .setName('Fit to functions')
            .setDesc('Sample every enabled function and set the axis ranges so the curves fit comfortably inside the plot. Clips outliers so vertical asymptotes do not blow out the range.')
            .addButton((btn) =>
                btn
                    .setButtonText('Auto-fit')
                    .setTooltip('Compute axis ranges from the current functions')
                    .onClick(() => this.autoFitRanges())
            );

        this.axisStyleContainer = tab.createDiv();
        new Setting(this.axisStyleContainer)
            .setName('Axis style')
            .setDesc('Box: full rectangle around the plot. Middle: axes cross at origin. Axes: L-shape (x at bottom, y at left) with no enclosing box.')
            .addDropdown((d) =>
                d
                    .addOptions({ box: 'Box (all around)', middle: 'Middle (crossing)', axes: 'Axes (no box)' })
                    .setValue(this.settings.getValue('axis_style') ?? 'box')
                    .onChange((v) => {
                        this.settings.setValue('axis_style', v);
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
                this.rangeInputs.set(field.key, t);
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
            const rowId = `func-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
            const ordinal = rowStates.size + 1;
            const state: FunctionParameters = {
                expression: '',
                domain: '-10:10',
                showLegend: false,
                fill: false,
                fillOpacity: 0.2,
                fillPattern: 'solid',
                tangent: false,
                dashed: false,
                tangentPoint: '',
                extrema: false,
                color: 'black',
                thickness: 'thin',
                parametric: false,
                expressionY: '',
                name: `f${ordinal}`,
            };
            rowStates.set(rowId, state);

            const card = cardsContainer.createDiv({ cls: 'tikz-func-card' });
            card.style.borderLeftColor = COLOR_MAP[state.color];

            const header = card.createDiv({ cls: 'tikz-func-header' });
            const headerLabel = header.createSpan({ cls: 'tikz-func-label', text: state.name || `Function ${ordinal}` });
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

            // Captures so the Template dropdown can refresh the UI when applied.
            let expressionInput: TextComponent | null = null;
            let domainInput: TextComponent | null = null;
            let colorDropdown: { setValue: (v: string) => unknown } | null = null;

            const templateRow = card.createDiv({ cls: 'tikz-func-row' });
            const templateDiv = templateRow.createDiv({ cls: 'tikz-func-field wide' });
            new Setting(templateDiv)
                .setName('Template')
                .setDesc('Quick start from a built-in curve, or save the current card as your own template.')
                .addDropdown((d) => {
                    const buildOptions = () => {
                        d.selectEl.empty();
                        d.addOption('', 'Choose a template...');
                        const builtIn = d.selectEl.createEl('optgroup');
                        builtIn.setAttribute('label', 'Built-in');
                        for (let i = 0; i < BUILT_IN_2D.length; i++) {
                            const opt = builtIn.createEl('option', { text: BUILT_IN_2D[i].name });
                            opt.value = `builtin:${i}`;
                        }
                        const userTemplates2D = this.getUserTemplates().filter((t) => !t.is3D);
                        if (userTemplates2D.length > 0) {
                            const saved = d.selectEl.createEl('optgroup');
                            saved.setAttribute('label', 'Saved');
                            for (const t of userTemplates2D) {
                                const opt = saved.createEl('option', { text: t.name });
                                opt.value = `user:${t.name}`;
                            }
                        }
                        d.selectEl.value = '';
                    };
                    buildOptions();
                    d.onChange((v) => {
                        if (!v) return;
                        let chosenExpr = '', chosenDomain = '', chosenColor = state.color;
                        if (v.startsWith('builtin:')) {
                            const idx = parseInt(v.slice(8), 10);
                            const tpl = BUILT_IN_2D[idx];
                            if (!tpl) return;
                            chosenExpr = tpl.expression;
                            chosenDomain = tpl.domain;
                            if (tpl.color) chosenColor = tpl.color;
                        } else if (v.startsWith('user:')) {
                            const name = v.slice(5);
                            const tpl = this.getUserTemplates().find((t) => !t.is3D && t.name === name);
                            if (!tpl) return;
                            chosenExpr = tpl.expression;
                            chosenDomain = tpl.domain ?? state.domain;
                            if (tpl.color) chosenColor = tpl.color;
                        }
                        state.expression = chosenExpr;
                        state.domain = chosenDomain;
                        state.color = chosenColor;
                        if (expressionInput) expressionInput.setValue(chosenExpr);
                        if (domainInput) domainInput.setValue(chosenDomain);
                        if (colorDropdown) colorDropdown.setValue(chosenColor);
                        card.style.borderLeftColor = COLOR_MAP[chosenColor] || 'var(--text-muted)';
                        updateFunctionValues();
                        d.selectEl.value = '';
                    });
                });
            const saveDiv = templateRow.createDiv({ cls: 'tikz-func-field' });
            new Setting(saveDiv).addButton((btn) =>
                btn
                    .setButtonText('Save as')
                    .setTooltip('Save the current expression, domain, and color as a personal template')
                    .onClick(async () => {
                        if (!state.expression) {
                            new Notice('Enter an expression before saving as a template.');
                            return;
                        }
                        const name = window.prompt('Template name:', state.expression);
                        if (!name) return;
                        const trimmed = name.trim();
                        if (!trimmed) return;
                        const existing = this.getUserTemplates().filter((t) => !(t.is3D === false && t.name === trimmed));
                        const next: UserTemplate[] = [...existing, {
                            name: trimmed,
                            is3D: false,
                            expression: state.expression,
                            domain: state.domain,
                            color: state.color,
                        }];
                        await this.setUserTemplates(next);
                        new Notice(`Saved template "${trimmed}".`);
                    })
            );

            const row1 = card.createDiv({ cls: 'tikz-func-row' });
            const exprDiv = row1.createDiv({ cls: 'tikz-func-field wide' });
            new Setting(exprDiv)
                .setName('Expression')
                .setDesc('Use x. Supports +, -, *, /, ^, parentheses, and Math.* functions.')
                .addText((t) => {
                    expressionInput = t;
                    t.setPlaceholder('x^2').onChange((v) => {
                        state.expression = v;
                        updateFunctionValues();
                    });
                });
            const domDiv = row1.createDiv({ cls: 'tikz-func-field' });
            new Setting(domDiv).setName('Domain').addText((t) => {
                domainInput = t;
                t.setPlaceholder('-10:10').setValue(state.domain).onChange((v) => {
                    state.domain = v;
                    updateFunctionValues();
                });
            });

            const nameRow = card.createDiv({ cls: 'tikz-func-row' });
            const nameDiv = nameRow.createDiv({ cls: 'tikz-func-field wide' });
            new Setting(nameDiv)
                .setName('Name')
                .setDesc('Used to reference this function from Tools (e.g. area between curves). Defaults to f1, f2, …')
                .addText((t) => {
                    t.setPlaceholder(state.name || `f${ordinal}`).setValue(state.name || '').onChange((v) => {
                        state.name = v;
                        if (headerLabel) headerLabel.textContent = (v && v.trim()) || `Function ${ordinal}`;
                        updateFunctionValues();
                    });
                });

            const row2 = card.createDiv({ cls: 'tikz-func-row' });
            const colorDiv = row2.createDiv({ cls: 'tikz-func-field' });
            new Setting(colorDiv).setName('Color').addDropdown((d) => {
                colorDropdown = d;
                d.addOptions(COLOR_OPTIONS).setValue(state.color).onChange((v) => {
                    state.color = v;
                    card.style.borderLeftColor = COLOR_MAP[v] || 'var(--text-muted)';
                    updateFunctionValues();
                });
            });
            const thickDiv = row2.createDiv({ cls: 'tikz-func-field' });
            new Setting(thickDiv).setName('Thickness').addDropdown((d) =>
                d.addOptions(THICKNESS_OPTIONS).setValue(state.thickness).onChange((v) => {
                    state.thickness = v;
                    updateFunctionValues();
                })
            );

            const row3 = card.createDiv({ cls: 'tikz-func-row tikz-toggle-row' });

            // y(t) field for parametric mode. Hidden by default, revealed by
            // the Parametric toggle below.
            const parametricInput = card.createDiv({ cls: 'tikz-tangent-input' });
            new Setting(parametricInput)
                .setName('y(t)')
                .setDesc('Second component when parametric. The Expression field above becomes x(t). Domain is the t range.')
                .addText((t) =>
                    t.setPlaceholder('sin(t)').onChange((v) => {
                        state.expressionY = v;
                        updateFunctionValues();
                    })
                );

            const tangentInput = card.createDiv({ cls: 'tikz-tangent-input' });
            new Setting(tangentInput)
                .setName('Tangent point (x)')
                .setDesc('A number, or "min" / "max" to snap to the nearest extremum. Append a digit (min2, max1) to pick the n-th.')
                .addText((t) => {
                    t.setPlaceholder('x value, min, or max').onChange((v) => {
                        state.tangentPoint = v;
                        updateFunctionValues();
                    });
                    const tryResolve = () => {
                        const v = t.getValue();
                        const resolved = this.resolveTangentKeyword(v, state.expression, state.domain);
                        if (resolved !== null) {
                            const text = String(parseFloat(resolved.toFixed(3)));
                            state.tangentPoint = text;
                            t.setValue(text);
                            updateFunctionValues();
                        }
                    };
                    t.inputEl.addEventListener('blur', tryResolve);
                    t.inputEl.addEventListener('keydown', (e: KeyboardEvent) => {
                        if (e.key === 'Enter') {
                            tryResolve();
                            e.preventDefault();
                        }
                    });
                });

            const fillOptions = card.createDiv({ cls: 'tikz-tangent-input' });
            new Setting(fillOptions)
                .setName('Fill pattern')
                .addDropdown((d) =>
                    d.addOptions({
                        solid: 'Solid',
                        horizontal: 'Horizontal lines',
                        vertical: 'Vertical lines',
                        crosshatch: 'Crosshatch',
                        dots: 'Dots',
                        'north-east': 'NE diagonal',
                        'north-west': 'NW diagonal',
                    }).setValue(state.fillPattern).onChange((v) => {
                        state.fillPattern = v as FunctionParameters['fillPattern'];
                        updateFunctionValues();
                    })
                );
            new Setting(fillOptions)
                .setName('Fill opacity')
                .addSlider((s) =>
                    s.setLimits(0.05, 1.0, 0.05)
                        .setValue(state.fillOpacity)
                        .setDynamicTooltip()
                        .onChange((v) => {
                            state.fillOpacity = v;
                            updateFunctionValues();
                        })
                );

            type BooleanKey = 'showLegend' | 'fill' | 'tangent' | 'dashed' | 'extrema' | 'parametric';
            const toggles: { name: string; key: BooleanKey }[] = [
                { name: 'Legend', key: 'showLegend' },
                { name: 'Fill', key: 'fill' },
                { name: 'Tangent', key: 'tangent' },
                { name: 'Dashed', key: 'dashed' },
                { name: 'Extrema', key: 'extrema' },
                { name: 'Parametric', key: 'parametric' },
            ];

            toggles.forEach(({ name, key }) => {
                const chip = row3.createDiv({ cls: 'tikz-toggle-chip' });
                new Setting(chip).setName(name).addToggle((t) =>
                    t.setValue(state[key]).onChange((v) => {
                        state[key] = v;
                        if (key === 'tangent') tangentInput.toggleClass('visible', v);
                        if (key === 'fill') fillOptions.toggleClass('visible', v);
                        if (key === 'parametric') parametricInput.toggleClass('visible', v);
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
                samples: 40,
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

            // Captures used by the template dropdown to refresh inputs.
            let expressionInput: TextComponent | null = null;
            let xDomainInput: TextComponent | null = null;
            let yDomainInput: TextComponent | null = null;
            let colorDropdown: { setValue: (v: string) => unknown } | null = null;

            const templateRow = card.createDiv({ cls: 'tikz-func-row' });
            const templateDiv = templateRow.createDiv({ cls: 'tikz-func-field wide' });
            new Setting(templateDiv)
                .setName('Template')
                .setDesc('Quick start from a built-in surface, or save the current card as your own template.')
                .addDropdown((d) => {
                    const buildOptions = () => {
                        d.selectEl.empty();
                        d.addOption('', 'Choose a template...');
                        const builtIn = d.selectEl.createEl('optgroup');
                        builtIn.setAttribute('label', 'Built-in');
                        for (let i = 0; i < BUILT_IN_3D.length; i++) {
                            const opt = builtIn.createEl('option', { text: BUILT_IN_3D[i].name });
                            opt.value = `builtin:${i}`;
                        }
                        const userTemplates3D = this.getUserTemplates().filter((t) => t.is3D);
                        if (userTemplates3D.length > 0) {
                            const saved = d.selectEl.createEl('optgroup');
                            saved.setAttribute('label', 'Saved');
                            for (const t of userTemplates3D) {
                                const opt = saved.createEl('option', { text: t.name });
                                opt.value = `user:${t.name}`;
                            }
                        }
                        d.selectEl.value = '';
                    };
                    buildOptions();
                    d.onChange((v) => {
                        if (!v) return;
                        let chosenExpr = '', chosenXDomain = state.xDomain, chosenYDomain = state.yDomain, chosenColor = state.color;
                        if (v.startsWith('builtin:')) {
                            const idx = parseInt(v.slice(8), 10);
                            const tpl = BUILT_IN_3D[idx];
                            if (!tpl) return;
                            chosenExpr = tpl.expression;
                            chosenXDomain = tpl.xDomain;
                            chosenYDomain = tpl.yDomain;
                            if (tpl.color) chosenColor = tpl.color;
                        } else if (v.startsWith('user:')) {
                            const name = v.slice(5);
                            const tpl = this.getUserTemplates().find((t) => t.is3D && t.name === name);
                            if (!tpl) return;
                            chosenExpr = tpl.expression;
                            chosenXDomain = tpl.xDomain ?? state.xDomain;
                            chosenYDomain = tpl.yDomain ?? state.yDomain;
                            if (tpl.color) chosenColor = tpl.color;
                        }
                        state.expression = chosenExpr;
                        state.xDomain = chosenXDomain;
                        state.yDomain = chosenYDomain;
                        state.color = chosenColor;
                        if (expressionInput) expressionInput.setValue(chosenExpr);
                        if (xDomainInput) xDomainInput.setValue(chosenXDomain);
                        if (yDomainInput) yDomainInput.setValue(chosenYDomain);
                        if (colorDropdown) colorDropdown.setValue(chosenColor);
                        card.style.borderLeftColor = COLOR_MAP[chosenColor] || 'var(--text-muted)';
                        updateFunctionValues();
                        d.selectEl.value = '';
                    });
                });
            const saveDiv = templateRow.createDiv({ cls: 'tikz-func-field' });
            new Setting(saveDiv).addButton((btn) =>
                btn
                    .setButtonText('Save as')
                    .setTooltip('Save the current expression and domains as a personal template')
                    .onClick(async () => {
                        if (!state.expression) {
                            new Notice('Enter an expression before saving as a template.');
                            return;
                        }
                        const name = window.prompt('Template name:', state.expression);
                        if (!name) return;
                        const trimmed = name.trim();
                        if (!trimmed) return;
                        const existing = this.getUserTemplates().filter((t) => !(t.is3D === true && t.name === trimmed));
                        const next: UserTemplate[] = [...existing, {
                            name: trimmed,
                            is3D: true,
                            expression: state.expression,
                            xDomain: state.xDomain,
                            yDomain: state.yDomain,
                            color: state.color,
                        }];
                        await this.setUserTemplates(next);
                        new Notice(`Saved template "${trimmed}".`);
                    })
            );

            const row1 = card.createDiv({ cls: 'tikz-func-row' });
            const exprDiv = row1.createDiv({ cls: 'tikz-func-field wide' });
            new Setting(exprDiv)
                .setName('f(x, y)')
                .setDesc('Use x and y. Supports +, -, *, /, ^, parentheses, and Math.* functions.')
                .addText((t) => {
                    expressionInput = t;
                    t.setPlaceholder('sin(x)*cos(y)').onChange((v) => {
                        state.expression = v;
                        updateFunctionValues();
                    });
                });

            const row2 = card.createDiv({ cls: 'tikz-func-row' });
            const xDomDiv = row2.createDiv({ cls: 'tikz-func-field' });
            new Setting(xDomDiv).setName('X domain').addText((t) => {
                xDomainInput = t;
                t.setPlaceholder('-5:5').setValue(state.xDomain).onChange((v) => {
                    state.xDomain = v;
                    updateFunctionValues();
                });
            });
            const yDomDiv = row2.createDiv({ cls: 'tikz-func-field' });
            new Setting(yDomDiv).setName('Y domain').addText((t) => {
                yDomainInput = t;
                t.setPlaceholder('-5:5').setValue(state.yDomain).onChange((v) => {
                    state.yDomain = v;
                    updateFunctionValues();
                });
            });

            const row3 = card.createDiv({ cls: 'tikz-func-row' });
            const colorDiv = row3.createDiv({ cls: 'tikz-func-field' });
            new Setting(colorDiv).setName('Color').addDropdown((d) => {
                colorDropdown = d;
                d.addOptions(COLOR_OPTIONS).setValue(state.color).onChange((v) => {
                    state.color = v;
                    card.style.borderLeftColor = COLOR_MAP[v] || 'var(--text-muted)';
                    updateFunctionValues();
                });
            });

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

            const row5 = card.createDiv({ cls: 'tikz-func-row' });
            const samplesDiv = row5.createDiv({ cls: 'tikz-func-field wide' });
            // Slider upper bound is configurable via the plugin's settings tab.
            // Defaults to 80; advanced users can raise it to draw smoother
            // surfaces at the cost of preview FPS.
            const maxSamples = Math.max(40, Math.min(400, this.plugin?.data?.maxSamples3D ?? 80));
            new Setting(samplesDiv)
                .setName('Samples')
                .setDesc(`Grid density per axis (8 to ${maxSamples}). Higher = smoother surface but slower preview. Also drives pgfplots \`samples=\` in the exported code.`)
                .addSlider((s) =>
                    s.setLimits(8, maxSamples, 2)
                        .setValue(Math.min(state.samples, maxSamples))
                        .setDynamicTooltip()
                        .onChange((v) => {
                            state.samples = v;
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

    private buildToolsTab(container: HTMLElement) {
        this.toolsTabContent = this.createTabContent(container, 'Tools');
        this.populateToolsTab();
    }

    private rebuildToolsTab() {
        if (!this.toolsTabContent) return;
        this.toolsTabContent.empty();
        this.populateToolsTab();
    }

    private populateToolsTab() {
        const tab = this.toolsTabContent;
        const is3D = this.is3D();
        tab.createEl('p', { cls: 'tikz-section-blurb' }).setText(
            'Composable overlays. Combine functions (area between, intersections), draw reference lines, and add free shapes — each independent of the others, so you can stack them freely. ' +
                'Function-referencing tools use the Name field on each function card (defaults to f1, f2, …).'
        );

        const toolList: Tool[] = ((this.settings.getValue('tools') as Tool[]) || []).map((t) => ({ ...t }));
        const cardsContainer = tab.createDiv({ cls: 'tikz-tool-cards' });

        const save = () => {
            this.settings.setValue('tools', toolList);
            this.requestPreviewUpdate();
        };
        const renderAll = () => {
            cardsContainer.empty();
            toolList.forEach((t, i) => this.renderToolCard(cardsContainer, t, i, toolList, save, renderAll, is3D));
        };
        renderAll();

        const addRow = tab.createDiv({ cls: 'tikz-add-func' });
        new Setting(addRow)
            .setName('Add tool')
            .setDesc(is3D ? 'Pick a 3D tool type.' : 'Pick a tool type.')
            .addDropdown((d) => {
                d.addOption('', '— select type —');
                if (!is3D) {
                    d.addOption('areaBetween', 'Area between two curves');
                    d.addOption('intersection', 'Intersection points');
                    d.addOption('verticalLine', 'Vertical line (x = c)');
                    d.addOption('horizontalLine', 'Horizontal line (y = c)');
                    d.addOption('rectangle', 'Rectangle');
                    d.addOption('circle', 'Circle');
                    d.addOption('segment', 'Line segment');
                    d.addOption('brace', 'Brace with label');
                } else {
                    d.addOption('plane3D', 'Plane (constant x / y / z)');
                    d.addOption('point3D', '3D point marker');
                    d.addOption('segment3D', '3D line segment');
                }
                d.setValue('').onChange((v) => {
                    if (!v) return;
                    const next = this.createDefaultTool(v as Tool['type']);
                    if (!next) return;
                    toolList.push(next);
                    save();
                    renderAll();
                    d.setValue('');
                });
            });
    }

    private createDefaultTool(type: Tool['type']): Tool | null {
        const c = 'blue';
        switch (type) {
            case 'areaBetween':
                return { type, func1Name: 'f1', func2Name: 'f2', domain: '', color: c, fillOpacity: 0.3, fillPattern: 'solid' };
            case 'intersection':
                return { type, func1Name: 'f1', func2Name: 'f2', color: 'red', showLabels: true };
            case 'verticalLine':
                return { type, x: '0', color: c, thickness: 'thin', dashed: true, label: '' };
            case 'horizontalLine':
                return { type, y: '0', color: c, thickness: 'thin', dashed: true, label: '' };
            case 'rectangle':
                return { type, x1: '0', y1: '0', x2: '1', y2: '1', color: c, thickness: 'thin', fill: true, fillOpacity: 0.2, fillPattern: 'solid' };
            case 'circle':
                return { type, cx: '0', cy: '0', r: '1', color: c, thickness: 'thin', fill: false, fillOpacity: 0.2, fillPattern: 'solid' };
            case 'segment':
                return { type, x1: '0', y1: '0', x2: '1', y2: '1', color: c, thickness: 'thin', dashed: false, arrow: 'forward' };
            case 'brace':
                return { type, x1: '0', y1: '0', x2: '1', y2: '0', color: c, label: '' };
            case 'plane3D':
                return { type, axis: 'z', value: '0', color: c, fillOpacity: 0.25 };
            case 'point3D':
                return { type, x: '0', y: '0', z: '0', color: 'red', label: '' };
            case 'segment3D':
                return { type, x1: '0', y1: '0', z1: '0', x2: '1', y2: '1', z2: '1', color: c, thickness: 'thin', dashed: false, arrow: 'forward' };
            default:
                return null;
        }
    }

    private toolLabel(type: Tool['type']): string {
        switch (type) {
            case 'areaBetween': return 'Area between curves';
            case 'intersection': return 'Intersection points';
            case 'verticalLine': return 'Vertical line';
            case 'horizontalLine': return 'Horizontal line';
            case 'rectangle': return 'Rectangle';
            case 'circle': return 'Circle';
            case 'segment': return 'Line segment';
            case 'brace': return 'Brace';
            case 'plane3D': return '3D plane';
            case 'point3D': return '3D point';
            case 'segment3D': return '3D segment';
        }
    }

    private renderToolCard(
        container: HTMLElement,
        tool: Tool,
        idx: number,
        toolList: Tool[],
        save: () => void,
        renderAll: () => void,
        is3D: boolean
    ) {
        const card = container.createDiv({ cls: 'tikz-func-card' });
        const header = card.createDiv({ cls: 'tikz-func-header' });
        header.createSpan({ cls: 'tikz-func-label', text: `${idx + 1}. ${this.toolLabel(tool.type)}` });
        new Setting(header).addButton((btn) =>
            btn.setIcon('trash').setTooltip('Remove tool').onClick(() => {
                toolList.splice(idx, 1);
                save();
                renderAll();
            })
        );

        // Function-name dropdown options pulled fresh from settings each render.
        const fnNames = (): { value: string; label: string }[] => {
            type Named = { expression?: string; name?: string };
            const raw = is3D
                ? (this.settings.getValue('functions3D') as Named[] | undefined)
                : (this.settings.getValue('functions') as Named[] | undefined);
            const list: Named[] = Array.isArray(raw) ? raw : [];
            const out: { value: string; label: string }[] = [];
            list.forEach((f, i) => {
                if (!f || !f.expression) return;
                const name = (f.name && f.name.trim()) || `f${i + 1}`;
                out.push({ value: name, label: name });
            });
            return out;
        };

        const textField = (parent: HTMLElement, label: string, value: string, onChange: (v: string) => void) => {
            const div = parent.createDiv({ cls: 'tikz-func-field' });
            new Setting(div).setName(label).addText((t) => t.setValue(String(value ?? '')).onChange(onChange));
        };
        const colorField = (parent: HTMLElement, value: string, onChange: (v: string) => void) => {
            const div = parent.createDiv({ cls: 'tikz-func-field' });
            new Setting(div).setName('Color').addDropdown((d) => {
                for (const [k, v] of Object.entries(COLOR_OPTIONS)) d.addOption(k, v);
                d.setValue(value).onChange(onChange);
            });
        };
        const thicknessField = (parent: HTMLElement, value: string, onChange: (v: string) => void) => {
            const div = parent.createDiv({ cls: 'tikz-func-field' });
            new Setting(div).setName('Thickness').addDropdown((d) => {
                for (const [k, v] of Object.entries(THICKNESS_OPTIONS)) d.addOption(k, v);
                d.setValue(value).onChange(onChange);
            });
        };
        const toggleField = (parent: HTMLElement, label: string, value: boolean, onChange: (v: boolean) => void) => {
            const div = parent.createDiv({ cls: 'tikz-func-field' });
            new Setting(div).setName(label).addToggle((t) => t.setValue(!!value).onChange(onChange));
        };
        const sliderField = (parent: HTMLElement, label: string, value: number, onChange: (v: number) => void) => {
            const div = parent.createDiv({ cls: 'tikz-func-field' });
            new Setting(div).setName(label).addSlider((s) =>
                s.setLimits(0.05, 1, 0.05).setValue(value).setDynamicTooltip().onChange(onChange)
            );
        };
        const dropdownField = (parent: HTMLElement, label: string, value: string, options: Record<string, string>, onChange: (v: string) => void) => {
            const div = parent.createDiv({ cls: 'tikz-func-field' });
            new Setting(div).setName(label).addDropdown((d) => {
                for (const [k, v] of Object.entries(options)) d.addOption(k, v);
                d.setValue(value).onChange(onChange);
            });
        };
        const fnNameField = (parent: HTMLElement, label: string, value: string, onChange: (v: string) => void) => {
            const div = parent.createDiv({ cls: 'tikz-func-field' });
            const names = fnNames();
            new Setting(div).setName(label).addDropdown((d) => {
                d.addOption('', '— select function —');
                for (const n of names) d.addOption(n.value, n.label);
                d.setValue(value).onChange(onChange);
            });
        };
        const patternField = (parent: HTMLElement, value: FillPattern, onChange: (v: FillPattern) => void) => {
            const div = parent.createDiv({ cls: 'tikz-func-field' });
            new Setting(div).setName('Pattern').addDropdown((d) => {
                d.addOption('solid', 'Solid');
                d.addOption('horizontal', 'Horizontal lines');
                d.addOption('vertical', 'Vertical lines');
                d.addOption('crosshatch', 'Crosshatch');
                d.addOption('dots', 'Dots');
                d.addOption('north-east', 'NE diagonal');
                d.addOption('north-west', 'NW diagonal');
                d.setValue(value).onChange((v) => onChange(v as FillPattern));
            });
        };
        const arrowField = (parent: HTMLElement, value: ArrowStyle, onChange: (v: ArrowStyle) => void) => {
            dropdownField(parent, 'Arrow', value, {
                none: 'None',
                forward: 'Forward (→)',
                backward: 'Backward (←)',
                both: 'Both (↔)',
            }, (v) => onChange(v as ArrowStyle));
        };

        // Type-specific form.
        switch (tool.type) {
            case 'areaBetween': {
                const row1 = card.createDiv({ cls: 'tikz-func-row' });
                fnNameField(row1, 'Function A', tool.func1Name, (v) => { tool.func1Name = v; save(); });
                fnNameField(row1, 'Function B', tool.func2Name, (v) => { tool.func2Name = v; save(); });
                textField(row1, 'Domain (optional)', tool.domain, (v) => { tool.domain = v; save(); });
                const row2 = card.createDiv({ cls: 'tikz-func-row' });
                colorField(row2, tool.color, (v) => { tool.color = v; save(); });
                sliderField(row2, 'Opacity', tool.fillOpacity, (v) => { tool.fillOpacity = v; save(); });
                patternField(row2, tool.fillPattern, (v) => { tool.fillPattern = v; save(); });
                break;
            }
            case 'intersection': {
                const row1 = card.createDiv({ cls: 'tikz-func-row' });
                fnNameField(row1, 'Function A', tool.func1Name, (v) => { tool.func1Name = v; save(); });
                fnNameField(row1, 'Function B', tool.func2Name, (v) => { tool.func2Name = v; save(); });
                const row2 = card.createDiv({ cls: 'tikz-func-row' });
                colorField(row2, tool.color, (v) => { tool.color = v; save(); });
                toggleField(row2, 'Show (x, y) labels', tool.showLabels, (v) => { tool.showLabels = v; save(); });
                break;
            }
            case 'verticalLine': {
                const row1 = card.createDiv({ cls: 'tikz-func-row' });
                textField(row1, 'x =', tool.x, (v) => { tool.x = v; save(); });
                textField(row1, 'Label (optional)', tool.label, (v) => { tool.label = v; save(); });
                const row2 = card.createDiv({ cls: 'tikz-func-row' });
                colorField(row2, tool.color, (v) => { tool.color = v; save(); });
                thicknessField(row2, tool.thickness, (v) => { tool.thickness = v; save(); });
                toggleField(row2, 'Dashed', tool.dashed, (v) => { tool.dashed = v; save(); });
                break;
            }
            case 'horizontalLine': {
                const row1 = card.createDiv({ cls: 'tikz-func-row' });
                textField(row1, 'y =', tool.y, (v) => { tool.y = v; save(); });
                textField(row1, 'Label (optional)', tool.label, (v) => { tool.label = v; save(); });
                const row2 = card.createDiv({ cls: 'tikz-func-row' });
                colorField(row2, tool.color, (v) => { tool.color = v; save(); });
                thicknessField(row2, tool.thickness, (v) => { tool.thickness = v; save(); });
                toggleField(row2, 'Dashed', tool.dashed, (v) => { tool.dashed = v; save(); });
                break;
            }
            case 'rectangle': {
                const row1 = card.createDiv({ cls: 'tikz-func-row' });
                textField(row1, 'x₁', tool.x1, (v) => { tool.x1 = v; save(); });
                textField(row1, 'y₁', tool.y1, (v) => { tool.y1 = v; save(); });
                textField(row1, 'x₂', tool.x2, (v) => { tool.x2 = v; save(); });
                textField(row1, 'y₂', tool.y2, (v) => { tool.y2 = v; save(); });
                const row2 = card.createDiv({ cls: 'tikz-func-row' });
                colorField(row2, tool.color, (v) => { tool.color = v; save(); });
                thicknessField(row2, tool.thickness, (v) => { tool.thickness = v; save(); });
                toggleField(row2, 'Fill', tool.fill, (v) => { tool.fill = v; save(); });
                sliderField(row2, 'Fill opacity', tool.fillOpacity, (v) => { tool.fillOpacity = v; save(); });
                patternField(row2, tool.fillPattern, (v) => { tool.fillPattern = v; save(); });
                break;
            }
            case 'circle': {
                const row1 = card.createDiv({ cls: 'tikz-func-row' });
                textField(row1, 'Center x', tool.cx, (v) => { tool.cx = v; save(); });
                textField(row1, 'Center y', tool.cy, (v) => { tool.cy = v; save(); });
                textField(row1, 'Radius', tool.r, (v) => { tool.r = v; save(); });
                const row2 = card.createDiv({ cls: 'tikz-func-row' });
                colorField(row2, tool.color, (v) => { tool.color = v; save(); });
                thicknessField(row2, tool.thickness, (v) => { tool.thickness = v; save(); });
                toggleField(row2, 'Fill', tool.fill, (v) => { tool.fill = v; save(); });
                sliderField(row2, 'Fill opacity', tool.fillOpacity, (v) => { tool.fillOpacity = v; save(); });
                patternField(row2, tool.fillPattern, (v) => { tool.fillPattern = v; save(); });
                break;
            }
            case 'segment': {
                const row1 = card.createDiv({ cls: 'tikz-func-row' });
                textField(row1, 'x₁', tool.x1, (v) => { tool.x1 = v; save(); });
                textField(row1, 'y₁', tool.y1, (v) => { tool.y1 = v; save(); });
                textField(row1, 'x₂', tool.x2, (v) => { tool.x2 = v; save(); });
                textField(row1, 'y₂', tool.y2, (v) => { tool.y2 = v; save(); });
                const row2 = card.createDiv({ cls: 'tikz-func-row' });
                colorField(row2, tool.color, (v) => { tool.color = v; save(); });
                thicknessField(row2, tool.thickness, (v) => { tool.thickness = v; save(); });
                toggleField(row2, 'Dashed', tool.dashed, (v) => { tool.dashed = v; save(); });
                arrowField(row2, tool.arrow, (v) => { tool.arrow = v; save(); });
                break;
            }
            case 'brace': {
                const row1 = card.createDiv({ cls: 'tikz-func-row' });
                textField(row1, 'x₁', tool.x1, (v) => { tool.x1 = v; save(); });
                textField(row1, 'y₁', tool.y1, (v) => { tool.y1 = v; save(); });
                textField(row1, 'x₂', tool.x2, (v) => { tool.x2 = v; save(); });
                textField(row1, 'y₂', tool.y2, (v) => { tool.y2 = v; save(); });
                const row2 = card.createDiv({ cls: 'tikz-func-row' });
                textField(row2, 'Label', tool.label, (v) => { tool.label = v; save(); });
                colorField(row2, tool.color, (v) => { tool.color = v; save(); });
                break;
            }
            case 'plane3D': {
                const row1 = card.createDiv({ cls: 'tikz-func-row' });
                dropdownField(row1, 'Constant axis', tool.axis, { x: 'x', y: 'y', z: 'z' }, (v) => {
                    tool.axis = v as 'x' | 'y' | 'z';
                    save();
                });
                textField(row1, 'Value', tool.value, (v) => { tool.value = v; save(); });
                const row2 = card.createDiv({ cls: 'tikz-func-row' });
                colorField(row2, tool.color, (v) => { tool.color = v; save(); });
                sliderField(row2, 'Opacity', tool.fillOpacity, (v) => { tool.fillOpacity = v; save(); });
                break;
            }
            case 'point3D': {
                const row1 = card.createDiv({ cls: 'tikz-func-row' });
                textField(row1, 'x', tool.x, (v) => { tool.x = v; save(); });
                textField(row1, 'y', tool.y, (v) => { tool.y = v; save(); });
                textField(row1, 'z', tool.z, (v) => { tool.z = v; save(); });
                const row2 = card.createDiv({ cls: 'tikz-func-row' });
                textField(row2, 'Label', tool.label, (v) => { tool.label = v; save(); });
                colorField(row2, tool.color, (v) => { tool.color = v; save(); });
                break;
            }
            case 'segment3D': {
                const row1 = card.createDiv({ cls: 'tikz-func-row' });
                textField(row1, 'x₁', tool.x1, (v) => { tool.x1 = v; save(); });
                textField(row1, 'y₁', tool.y1, (v) => { tool.y1 = v; save(); });
                textField(row1, 'z₁', tool.z1, (v) => { tool.z1 = v; save(); });
                textField(row1, 'x₂', tool.x2, (v) => { tool.x2 = v; save(); });
                textField(row1, 'y₂', tool.y2, (v) => { tool.y2 = v; save(); });
                textField(row1, 'z₂', tool.z2, (v) => { tool.z2 = v; save(); });
                const row2 = card.createDiv({ cls: 'tikz-func-row' });
                colorField(row2, tool.color, (v) => { tool.color = v; save(); });
                thicknessField(row2, tool.thickness, (v) => { tool.thickness = v; save(); });
                toggleField(row2, 'Dashed', tool.dashed, (v) => { tool.dashed = v; save(); });
                arrowField(row2, tool.arrow, (v) => { tool.arrow = v; save(); });
                break;
            }
        }
    }

    private buildAnnotationsTab(container: HTMLElement) {
        const tab = this.createTabContent(container, 'Annotations');

        tab.createEl('p', {
            cls: 'tikz-section-blurb',
            text: 'Add text labels at any point in the coordinate system. In 2D, drag a label in the preview to move it. Annotations are rendered in the live preview and emitted as \\node commands in the exported TikZ.',
        });

        const cardsContainer = tab.createDiv({ cls: 'tikz-func-cards' });
        const rowStates = new Map<string, import('./types').Annotation>();
        this.annotationCards.length = 0;

        const update = () => {
            const list: import('./types').Annotation[] = [];
            rowStates.forEach((state) => {
                if (state.text) list.push({ ...state });
            });
            this.settings.setValue('annotations', list);
            this.requestPreviewUpdate();
        };
        this.annotationUpdateFn = update;

        const addCard = () => {
            const rowId = `ann-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
            const state: import('./types').Annotation = {
                x: '0',
                y: '0',
                z: this.is3D() ? '0' : undefined,
                text: '',
                color: 'black',
                size: 'normal',
                anchor: 'above',
            };
            rowStates.set(rowId, state);
            const cardEntry: typeof this.annotationCards[number] = { rowId, state, xInput: null, yInput: null, zInput: null };
            this.annotationCards.push(cardEntry);

            const card = cardsContainer.createDiv({ cls: 'tikz-func-card' });
            card.style.borderLeftColor = COLOR_MAP[state.color];

            const header = card.createDiv({ cls: 'tikz-func-header' });
            header.createSpan({ cls: 'tikz-func-label', text: `Label ${rowStates.size}` });
            new Setting(header).addButton((btn) =>
                btn
                    .setIcon('trash')
                    .setTooltip('Remove label')
                    .then((b) => b.buttonEl.setAttr('aria-label', 'Remove label'))
                    .onClick(() => {
                        rowStates.delete(rowId);
                        const idx = this.annotationCards.indexOf(cardEntry);
                        if (idx >= 0) this.annotationCards.splice(idx, 1);
                        card.remove();
                        update();
                    })
            );

            const row1 = card.createDiv({ cls: 'tikz-func-row' });
            const textDiv = row1.createDiv({ cls: 'tikz-func-field wide' });
            new Setting(textDiv).setName('Text').addText((t) =>
                t.setPlaceholder('Local max').onChange((v) => {
                    state.text = v;
                    update();
                })
            );

            const row2 = card.createDiv({ cls: 'tikz-func-row' });
            const xDiv = row2.createDiv({ cls: 'tikz-func-field' });
            new Setting(xDiv).setName('x').addText((t) => {
                cardEntry.xInput = t;
                t.setPlaceholder('0').setValue(state.x).onChange((v) => {
                    state.x = v;
                    update();
                });
            });
            const yDiv = row2.createDiv({ cls: 'tikz-func-field' });
            new Setting(yDiv).setName('y').addText((t) => {
                cardEntry.yInput = t;
                t.setPlaceholder('0').setValue(state.y).onChange((v) => {
                    state.y = v;
                    update();
                });
            });
            const zDiv = row2.createDiv({ cls: 'tikz-func-field' });
            new Setting(zDiv).setName('z').addText((t) => {
                cardEntry.zInput = t;
                t.setPlaceholder('0').setValue(state.z ?? '').onChange((v) => {
                    state.z = v;
                    update();
                });
            });

            const row3 = card.createDiv({ cls: 'tikz-func-row' });
            const colorDiv = row3.createDiv({ cls: 'tikz-func-field' });
            new Setting(colorDiv).setName('Color').addDropdown((d) =>
                d.addOptions(COLOR_OPTIONS).setValue(state.color).onChange((v) => {
                    state.color = v;
                    card.style.borderLeftColor = COLOR_MAP[v] || 'var(--text-muted)';
                    update();
                })
            );
            const sizeDiv = row3.createDiv({ cls: 'tikz-func-field' });
            new Setting(sizeDiv).setName('Size').addDropdown((d) =>
                d.addOptions({ small: 'Small', normal: 'Normal', large: 'Large' })
                    .setValue(state.size)
                    .onChange((v) => {
                        state.size = v as import('./types').AnnotationSize;
                        update();
                    })
            );
            const anchorDiv = row3.createDiv({ cls: 'tikz-func-field' });
            new Setting(anchorDiv).setName('Anchor').addDropdown((d) =>
                d.addOptions({
                    above: 'Above',
                    below: 'Below',
                    left: 'Left',
                    right: 'Right',
                    center: 'Center',
                })
                    .setValue(state.anchor)
                    .onChange((v) => {
                        state.anchor = v as import('./types').AnnotationAnchor;
                        update();
                    })
            );
        };

        const addBtnDiv = tab.createDiv({ cls: 'tikz-add-func' });
        new Setting(addBtnDiv).addButton((btn) =>
            btn.setButtonText('+ Add label').onClick(() => addCard())
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
            { name: 'Fill', desc: 'Shades the region between the curve and the x-axis. When enabled, a Fill pattern dropdown (solid, horizontal/vertical lines, crosshatch, dots, diagonals) and a Fill opacity slider appear.' },
            { name: 'Legend', desc: 'Adds the expression to the legend box in the upper-right of the plot.' },
        ]);

        section('Tools');
        para(
            'The Tools tab adds composable overlays on top of functions. Each tool is independent — stack them freely to build the diagram you want. ' +
                'Function-referencing tools (area between, intersection) look up your functions by the Name field on each function card (defaults to f1, f2, …).'
        );
        list([
            { name: 'Area between two curves', desc: 'Picks two functions by name and shades the region between them. Optional domain override (defaults to the overlap of both function domains). Color, opacity, pattern.' },
            { name: 'Intersection points', desc: 'Bisection root-finder on f - g across the overlap of both function domains. Each crossing gets a dot; optional (x, y) label.' },
            { name: 'Vertical / horizontal reference line', desc: 'Line at x = c or y = c spanning the plot. Color, thickness, dashed, optional label.' },
            { name: 'Rectangle', desc: 'Outline + optional fill between (x₁, y₁) and (x₂, y₂). Patterns supported.' },
            { name: 'Circle', desc: 'Center (cx, cy), radius r. Drawn in axis coordinates so the radius scales with the axes.' },
            { name: 'Line segment', desc: 'Straight line between two points with optional forward / backward / both arrows.' },
            { name: 'Brace with label', desc: 'Curly brace between two points with optional label centered above. Useful for marking intervals.' },
            { name: '3D plane', desc: 'Flat plane at constant x, y, or z. Color + opacity.' },
            { name: '3D point / segment', desc: 'Single point at (x, y, z) with optional label, or a line segment between two 3D points with optional arrows.' },
        ]);
        para(
            'Exported TikZ uses real pgfplots semantics — `\\addplot fill between [of=A and B]` for area-between, ' +
                '`\\draw` for shapes, `\\node` for labels, `decorate / decoration={brace}` for braces. The `fillbetween` and `decorations.pathreplacing` libraries are added to the document setup only when a tool needs them.'
        );

        section('Annotations');
        para('The Annotations tab lets you place text labels at arbitrary points. Each label has x, y (and z in 3D), a color, a size (small/normal/large), and an anchor that controls which side of the point the text sits on. In the exported TikZ each label becomes a \\node command.');

        section('Tangent');
        para('Enable the Tangent toggle to draw the line tangent to the curve at a chosen x value. The Tangent point field appears once the toggle is on. The point must lie inside the domain. A small dot marks the touch point.');

        section('Extrema');
        para('Enable the Extrema toggle to scan the domain for local minima and maxima. Detected points are marked with a dot and labelled "min" or "max". Resolution is 100 samples across the domain, so very sharp features inside a wide domain might be missed.');

        section('Parametric curves');
        para('Enable the Parametric toggle on a 2D function card to plot a parametric curve. The Expression field becomes x(t), a new y(t) field appears, and the Domain field is now the t range (default `0:2*PI`). Both components can use any Math.* function and the constants PI, E. The exported TikZ emits `\\addplot[parametric, ...]`.');
        code(
            'x(t) = sin(3*t)             Lissajous (3:4)    domain 0:2*PI\n' +
            'y(t) = sin(4*t)\n\n' +
            'x(t) = cos(t) * (1 + 0.3*cos(8*t))   epicycloid   domain 0:2*PI\n' +
            'y(t) = sin(t) * (1 + 0.3*cos(8*t))\n\n' +
            'x(t) = t                     classic curve      domain -2:2\n' +
            'y(t) = t^3 - 3*t\n\n' +
            'x(t) = cos(t)                circle             domain 0:2*PI\n' +
            'y(t) = sin(t)'
        );

        section('Polar coordinates');
        para('On the Graph tab, set Coordinate system to "Polar". The Functions tab\'s expression is then interpreted as r(theta) and the domain is the theta range in radians. The preview transforms to Cartesian internally; the exported TikZ uses a parametric `\\addplot ({r*cos(deg(\\t))}, {r*sin(deg(\\t))})` and adds `axis equal` so circles stay circular. You can write the variable as `theta` or `x`; both are accepted.');
        code(
            '1 + cos(theta)            cardioid           domain 0:2*PI\n' +
            'sin(4*theta)              rose curve         domain 0:2*PI\n' +
            'sin(2.5*theta)            5-petal rose       domain 0:4*PI\n' +
            'theta                     Archimedean spiral domain 0:6*PI\n' +
            '2 * sin(3*theta)          3-petal rose       domain 0:2*PI\n' +
            'exp(theta/10)             logarithmic spiral domain 0:6*PI'
        );

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
            { name: 'X domain / Y domain', desc: 'Each axis gets its own range.' },
            { name: 'Color', desc: 'Same palette as 2D. The surface is shaded from the base color toward white based on z value.' },
            { name: 'Wireframe', desc: 'Renders only the grid lines of the surface, no fill. Useful when stacking multiple surfaces.' },
            { name: 'Opacity', desc: 'Slider from 0.1 to 1.0. Affects the filled surface; wireframes use the opacity for stroke transparency.' },
            { name: 'Samples', desc: 'Grid density per axis (8 to 80). Higher = smoother surface, slower preview. Also drives pgfplots `samples=` in the exported code.' },
        ]);

        section('Preview vs exported code');
        para('The live preview is a custom SVG renderer; the exported code is pgfplots that you compile with a real TeX engine. They are necessarily two pipelines. The plugin keeps them as close as possible: the SVG aspect ratio now follows the Width/Height (cm) values on the Graph tab, and the same axis ranges, fill options, samples, and annotations are used by both.');

        section('Exporting the preview');
        list([
            { name: 'Copy TikZ code', desc: 'The default. Copies the pgfplots source to the clipboard.' },
            { name: 'Copy SVG', desc: 'Copies the live SVG with a transparent background. Paste into Inkscape, Figma, or directly into Obsidian as <img src="...">. CSS variables are resolved so the file renders correctly outside the plugin.' },
            { name: 'Copy PNG', desc: 'Rasterises the SVG at 2x resolution and copies a PNG to the clipboard, also with a transparent background. Paste into any image-aware app.' },
            { name: 'Insert into note', desc: 'Inserts an `easy-tikz` JSON code block into the active note; the plugin renders it inline via its own SVG renderer — no external TikZ plugin required. Clicking the rendered chart reopens this modal pre-filled.' },
        ]);

        section('Preview (2D)');
        para('The right-hand preview is a live SVG that always reflects the current settings. In 2D mode you can interact with it directly:');
        list([
            { name: 'Scroll', desc: 'Mouse wheel zooms in or out around the cursor. Zoom updates xmin/xmax/ymin/ymax, so the generated TikZ code reflects what you see.' },
            { name: 'Drag', desc: 'Click and drag inside the preview to pan. Like zoom, this updates the axis ranges and round-trips into the code.' },
            { name: 'Preview size slider', desc: 'On the Graph tab. Sets the live preview width in pixels. The exported TikZ size is controlled by Width and Height (cm) and stays independent.' },
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
        if (this.zoom3DOverlay) this.zoom3DOverlay.style.display = show3D ? 'flex' : 'none';
    }

    /**
     * Watch the preview area for size changes (modal/window resize) and
     * re-render so the 3D fit-contain sizing updates. Guarded against
     * self-trigger from our own style writes by only firing when the
     * dimensions moved by more than 0.5px since the last paint.
     */
    private setupPreviewResizeObserver() {
        if (typeof ResizeObserver === 'undefined') return;
        const observer = new ResizeObserver((entries) => {
            const entry = entries[0];
            if (!entry) return;
            const w = entry.contentRect.width;
            const h = entry.contentRect.height;
            const last = this.lastObservedPreviewSize;
            if (last && Math.abs(last.w - w) < 0.5 && Math.abs(last.h - h) < 0.5) {
                return;
            }
            this.lastObservedPreviewSize = { w, h };
            this.requestPreviewUpdate();
        });
        observer.observe(this.previewContainer);
        this.previewResizeObserver = observer;
    }

    private buildZoom3DOverlay() {
        const overlay = this.previewContainer.createDiv({ cls: 'tikz-3d-zoom-overlay' });
        overlay.setAttr('aria-hidden', 'true');
        // Initial display follows the current 2D/3D state. update3DVisibility
        // also flips this, but buildGraphTab calls update3DVisibility BEFORE
        // this overlay is built (panel-left is constructed before panel-right),
        // so opening the modal in 3D mode would otherwise leave it hidden.
        overlay.style.display = this.is3D() ? 'flex' : 'none';

        const plus = overlay.createEl('button', { cls: 'tikz-3d-zoom-btn', text: '+' });
        plus.setAttr('type', 'button');
        plus.setAttr('aria-label', 'Zoom in');
        plus.setAttr('title', 'Zoom in');
        plus.onclick = (e) => {
            e.stopPropagation();
            this.adjust3DZoom(1.25);
        };

        const minus = overlay.createEl('button', { cls: 'tikz-3d-zoom-btn', text: '−' });
        minus.setAttr('type', 'button');
        minus.setAttr('aria-label', 'Zoom out');
        minus.setAttr('title', 'Zoom out');
        minus.onclick = (e) => {
            e.stopPropagation();
            this.adjust3DZoom(1 / 1.25);
        };

        const reset = overlay.createEl('button', { cls: 'tikz-3d-zoom-btn tikz-3d-zoom-reset', text: '↻' });
        reset.setAttr('type', 'button');
        reset.setAttr('aria-label', 'Reset zoom');
        reset.setAttr('title', 'Reset zoom');
        reset.onclick = (e) => {
            e.stopPropagation();
            this.settings.setValue('zoom3D', 1);
            this.requestPreviewUpdateFast();
        };

        // Mouse-down on the overlay shouldn't trigger the drag-rotate handler.
        overlay.addEventListener('mousedown', (e) => e.stopPropagation());

        this.zoom3DOverlay = overlay;
    }

    private currentXLabelKey(): string {
        return this.settings.getValue('coordinateSystem') === 'polar' ? 'axis_label_x_polar' : 'axis_label_x';
    }

    private currentYLabelKey(): string {
        return this.settings.getValue('coordinateSystem') === 'polar' ? 'axis_label_y_polar' : 'axis_label_y';
    }

    private currentXLabelValue(): string {
        return String(this.settings.getValue(this.currentXLabelKey()) ?? '');
    }

    private currentYLabelValue(): string {
        return String(this.settings.getValue(this.currentYLabelKey()) ?? '');
    }

    private refreshAxisLabelInputs() {
        if (this.xLabelInput) this.xLabelInput.setValue(this.currentXLabelValue());
        if (this.yLabelInput) this.yLabelInput.setValue(this.currentYLabelValue());
    }

    private adjust3DZoom(factor: number) {
        const current = (this.settings.getValue('zoom3D') as number) || 1;
        const next = Math.max(0.3, Math.min(4, current * factor));
        this.settings.setValue('zoom3D', next);
        this.requestPreviewUpdateFast();
    }

    /**
     * Vertical strip of floating action icons on the right edge of the
     * preview area. Surfaces commands that would otherwise be buried in
     * the settings tabs (auto-fit, reset axes, toggle major grid).
     */
    private buildFloatingActions() {
        const overlay = this.previewContainer.createDiv({ cls: 'tikz-floating-actions' });
        overlay.setAttr('aria-hidden', 'false');
        overlay.addEventListener('mousedown', (e) => e.stopPropagation());

        const addAction = (icon: string, label: string, onClick: () => void) => {
            const btn = overlay.createEl('button', { cls: 'tikz-floating-btn' });
            btn.setAttr('type', 'button');
            btn.setAttr('aria-label', label);
            btn.setAttr('title', label);
            setIcon(btn, icon);
            btn.onclick = (e) => {
                e.stopPropagation();
                onClick();
            };
            return btn;
        };

        addAction('maximize-2', 'Fit to functions', () => this.autoFitRanges());
        addAction('rotate-ccw', 'Reset axis ranges', () => this.resetAxisRanges());
        addAction('grid-3x3', 'Toggle major grid', () => this.toggleMajorGrid());

        this.floatingActionsOverlay = overlay;
    }

    private resetAxisRanges() {
        this.settings.setValue('xmin', '-0.5');
        this.settings.setValue('xmax', '10');
        this.settings.setValue('ymin', '-0.5');
        this.settings.setValue('ymax', '5');
        if (this.is3D()) {
            this.settings.setValue('zmin', '-5');
            this.settings.setValue('zmax', '5');
            this.settings.setValue('zoom3D', 1);
        }
        this.refreshRangeInputs();
        this.requestPreviewUpdate();
        new Notice('Axis ranges reset.');
    }

    private toggleMajorGrid() {
        const current = !!this.settings.getValue('showLargeGrid');
        this.settings.setValue('showLargeGrid', !current);
        this.requestPreviewUpdate();
        new Notice(current ? 'Major grid off.' : 'Major grid on.');
    }

    private setupMouseDragRotation() {
        const el = this.previewContainer;

        el.addEventListener('mousedown', (e: MouseEvent) => {
            if (e.button !== 0) return;

            // Annotation drag takes priority. Only supported in 2D for now.
            if (!this.is3D()) {
                const target = e.target as Element | null;
                const annoEl = target?.closest('[data-annotation-idx]') as Element | null;
                if (annoEl) {
                    const idx = parseInt(annoEl.getAttribute('data-annotation-idx') || '-1', 10);
                    if (idx >= 0) {
                        this.draggingAnnotationIdx = idx;
                        el.addClass('tikz-preview-dragging');
                        e.preventDefault();
                        return;
                    }
                }
            }

            this.isDragging = true;
            this.dragStartX = e.clientX;
            this.dragStartY = e.clientY;

            if (this.is3D()) {
                this.dragStartAzimuth = this.settings.getValue('rotationZ') ?? 45;
                this.dragStartElevation = this.settings.getValue('rotationX') ?? 30;
            } else {
                this.dragStartXmin = parseFloat(this.settings.getValue('xmin')) || -0.5;
                this.dragStartXmax = parseFloat(this.settings.getValue('xmax')) || 10;
                this.dragStartYmin = parseFloat(this.settings.getValue('ymin')) || -0.5;
                this.dragStartYmax = parseFloat(this.settings.getValue('ymax')) || 5;
            }

            el.addClass('tikz-preview-dragging');
            e.preventDefault();
        });

        this.onMouseMove = (e: MouseEvent) => {
            if (this.draggingAnnotationIdx !== null) {
                this.applyAnnotationDrag(this.draggingAnnotationIdx, e);
                return;
            }
            if (!this.isDragging) return;
            const dx = e.clientX - this.dragStartX;
            const dy = e.clientY - this.dragStartY;

            if (this.is3D()) {
                let newAzimuth = this.dragStartAzimuth + dx * AZIMUTH_DRAG_RATE;
                // Vertical drag direction follows the plugin setting. Default
                // (invertDrag3D: false): drag down RAISES elevation
                // (trackball-style — you're "pulling the floor up").
                // invertDrag3D: true: drag down LOWERS elevation (direct
                // manipulation — the camera follows your finger).
                const invert = !!this.plugin?.data?.invertDrag3D;
                const elevationDelta = (invert ? dy : -dy) * ELEVATION_DRAG_RATE;
                let newElevation = this.dragStartElevation + elevationDelta;
                newAzimuth = ((newAzimuth % 360) + 360) % 360;
                newElevation = Math.max(0, Math.min(90, newElevation));
                this.applyRotation(Math.round(newAzimuth), Math.round(newElevation));
            } else {
                // 2D drag: pan the visible axis range each frame and let
                // the renderer redraw the chart in place. The chart pans
                // inside its fixed axes (the box doesn't move), the tick
                // labels update with the new range — same idea as the
                // 3D drag which re-renders with new camera rotation
                // each move. The scale math is correct since 3.18.2
                // fixed `getPlotMetricsFromSvg` to read the chart SVG
                // (not an overlay icon).
                const plot = this.getPlotMetricsFromSvg();
                if (!plot) return;
                const sensitivity = this.plugin?.data?.dragSensitivity2D ?? 1.0;
                const dxVb = dx * plot.scale;
                const dyVb = dy * plot.scale;
                const startXrange = this.dragStartXmax - this.dragStartXmin;
                const startYrange = this.dragStartYmax - this.dragStartYmin;
                const dxMath = (-dxVb / plot.plotW) * startXrange * sensitivity;
                const dyMath = (dyVb / plot.plotH) * startYrange * sensitivity;
                this.applyAxisRange(
                    this.dragStartXmin + dxMath,
                    this.dragStartXmax + dxMath,
                    this.dragStartYmin + dyMath,
                    this.dragStartYmax + dyMath
                );
            }
        };

        this.onMouseUp = () => {
            if (this.draggingAnnotationIdx !== null) {
                this.draggingAnnotationIdx = null;
                el.removeClass('tikz-preview-dragging');
            }
            if (this.isDragging) {
                this.isDragging = false;
                el.removeClass('tikz-preview-dragging');
            }
        };

        window.addEventListener('mousemove', this.onMouseMove);
        window.addEventListener('mouseup', this.onMouseUp);

        // Wheel zoom (2D only). Pan/zoom converge on the same set of axis-range settings.
        el.addEventListener(
            'wheel',
            (e: WheelEvent) => {
                if (this.is3D()) return;
                if (e.deltaY === 0) return;
                e.preventDefault();

                const plot = this.getPlotMetricsFromSvg(e.clientX, e.clientY);
                if (!plot) return;
                const { xFracInPlot, yFracInPlot } = plot;
                if (
                    xFracInPlot < -0.05 || xFracInPlot > 1.05 ||
                    yFracInPlot < -0.05 || yFracInPlot > 1.05
                ) {
                    return;
                }

                const xmin = parseFloat(this.settings.getValue('xmin')) || -0.5;
                const xmax = parseFloat(this.settings.getValue('xmax')) || 10;
                const ymin = parseFloat(this.settings.getValue('ymin')) || -0.5;
                const ymax = parseFloat(this.settings.getValue('ymax')) || 5;
                const xRange = xmax - xmin;
                const yRange = ymax - ymin;

                const cursorMx = xmin + xFracInPlot * xRange;
                const cursorMy = ymax - yFracInPlot * yRange;

                const factor = e.deltaY < 0 ? 1 / WHEEL_ZOOM_FACTOR : WHEEL_ZOOM_FACTOR;
                const newXrange = xRange * factor;
                const newYrange = yRange * factor;

                const newXmin = cursorMx - xFracInPlot * newXrange;
                const newXmax = newXmin + newXrange;
                const newYmax = cursorMy + yFracInPlot * newYrange;
                const newYmin = newYmax - newYrange;

                this.applyAxisRange(newXmin, newXmax, newYmin, newYmax);
            },
            { passive: false }
        );
    }

    /**
     * Returns the rendered SVG's plot metrics plus optional cursor coordinates
     * mapped into the SVG viewBox and into 0..1 fractions of the plot area.
     */
    private getPlotMetricsFromSvg(
        clientX?: number,
        clientY?: number
    ): {
        scale: number;
        plotW: number;
        plotH: number;
        xFracInPlot: number;
        yFracInPlot: number;
    } | null {
        const svg = this.getChartSvg();
        if (!svg) return null;
        const rect = svg.getBoundingClientRect();
        if (rect.width === 0 || rect.height === 0) return null;
        const config = this.settings.toRendererConfig();
        const scale = config.width / rect.width;
        const plotW = config.width - RENDERER_PADDING.left - RENDERER_PADDING.right;
        const plotH = config.height - RENDERER_PADDING.top - RENDERER_PADDING.bottom;

        let xFracInPlot = 0;
        let yFracInPlot = 0;
        if (clientX !== undefined && clientY !== undefined) {
            const cursorVbX = (clientX - rect.left) * scale;
            const cursorVbY = (clientY - rect.top) * (config.height / rect.height);
            xFracInPlot = (cursorVbX - RENDERER_PADDING.left) / plotW;
            yFracInPlot = (cursorVbY - RENDERER_PADDING.top) / plotH;
        }

        return { scale, plotW, plotH, xFracInPlot, yFracInPlot };
    }

    /**
     * Update the annotation at `idx` (within the current settings.annotations
     * array) from the cursor position. 2D only: maps the cursor through the
     * inverse of toScreenX/toScreenY and updates both the card state and the
     * x/y text inputs.
     */
    private applyAnnotationDrag(idx: number, e: MouseEvent) {
        const plot = this.getPlotMetricsFromSvg(e.clientX, e.clientY);
        if (!plot) return;
        const xmin = parseFloat(this.settings.getValue('xmin')) || -0.5;
        const xmax = parseFloat(this.settings.getValue('xmax')) || 10;
        const ymin = parseFloat(this.settings.getValue('ymin')) || -0.5;
        const ymax = parseFloat(this.settings.getValue('ymax')) || 5;
        const cursorMx = xmin + plot.xFracInPlot * (xmax - xmin);
        const cursorMy = ymax - plot.yFracInPlot * (ymax - ymin);
        const clampedX = Math.max(xmin, Math.min(xmax, cursorMx));
        const clampedY = Math.max(ymin, Math.min(ymax, cursorMy));

        // Find the matching annotation card (idx-th card with non-empty text).
        const nonEmpty = this.annotationCards.filter((c) => c.state.text);
        const card = nonEmpty[idx];
        if (!card) return;

        const newX = String(parseFloat(clampedX.toFixed(3)));
        const newY = String(parseFloat(clampedY.toFixed(3)));
        card.state.x = newX;
        card.state.y = newY;
        if (card.xInput) card.xInput.setValue(newX);
        if (card.yInput) card.yInput.setValue(newY);

        // Rebuild settings.annotations from the card states (same shape as the
        // tab's `update` callback) and use the fast render path so the drag
        // stays smooth.
        const list: import('./types').Annotation[] = [];
        for (const c of this.annotationCards) {
            if (c.state.text) list.push({ ...c.state });
        }
        this.settings.setValue('annotations', list);
        this.requestPreviewUpdateFast();
    }

    /**
     * If `input` looks like `min`, `max`, `min2`, `max3` etc., return the
     * x value of the matching local extremum (nth by left-to-right order).
     * Returns null for anything else, including unparseable input.
     */
    private resolveTangentKeyword(input: string, expression: string, domain: string): number | null {
        if (!expression || !domain) return null;
        const m = input.trim().toLowerCase().match(/^(min|max)(\d+)?$/);
        if (!m) return null;
        try {
            const extrema = MathHelper.findExtrema(expression, domain);
            const wanted = m[1] === 'min' ? 'minimum' : 'maximum';
            const filtered = extrema.filter((e) => e.type === wanted);
            const idx = m[2] ? Math.max(1, parseInt(m[2], 10)) - 1 : 0;
            const chosen = filtered[idx];
            if (!chosen) return null;
            return chosen.x;
        } catch {
            return null;
        }
    }

    /**
     * Sample every enabled function and set xmin/xmax/ymin/ymax (and zmin/zmax
     * in 3D) so the curves fit. Drops outliers above the 99th percentile so a
     * vertical asymptote does not blow out the range.
     */
    private autoFitRanges() {
        if (this.is3D()) {
            const surfaces: Function3DParameters[] = this.settings.getValue('functions3D') || [];
            const live = surfaces.filter((s) => s.expression);
            if (!live.length) {
                new Notice('Add a surface first.');
                return;
            }
            let xs: number[] = [];
            let ys: number[] = [];
            let zs: number[] = [];
            for (const s of live) {
                try {
                    const [xmin, xmax] = MathHelper.parseDomain(s.xDomain);
                    const [ymin, ymax] = MathHelper.parseDomain(s.yDomain);
                    const samples = Math.max(8, Math.min(40, s.samples ?? 30));
                    const f = MathHelper.compile2D(s.expression);
                    for (let i = 0; i <= samples; i++) {
                        const x = xmin + ((xmax - xmin) * i) / samples;
                        for (let j = 0; j <= samples; j++) {
                            const y = ymin + ((ymax - ymin) * j) / samples;
                            const z = f(x, y);
                            if (isFinite(z)) { xs.push(x); ys.push(y); zs.push(z); }
                        }
                    }
                } catch {
                    // skip surfaces with bad domain/expression
                }
            }
            if (!xs.length) {
                new Notice('Could not evaluate any surface.');
                return;
            }
            const [zLo, zHi] = trimmedRange(zs);
            const xPad = (Math.max(...xs) - Math.min(...xs)) * 0.05 || 0.5;
            const yPad = (Math.max(...ys) - Math.min(...ys)) * 0.05 || 0.5;
            const zPad = (zHi - zLo) * 0.05 || 0.5;
            const newXmin = Math.min(...xs) - xPad;
            const newXmax = Math.max(...xs) + xPad;
            const newYmin = Math.min(...ys) - yPad;
            const newYmax = Math.max(...ys) + yPad;
            const newZmin = zLo - zPad;
            const newZmax = zHi + zPad;
            this.settings.setValue('xmin', this.formatRange(newXmin));
            this.settings.setValue('xmax', this.formatRange(newXmax));
            this.settings.setValue('ymin', this.formatRange(newYmin));
            this.settings.setValue('ymax', this.formatRange(newYmax));
            this.settings.setValue('zmin', this.formatRange(newZmin));
            this.settings.setValue('zmax', this.formatRange(newZmax));
            this.refreshRangeInputs();
            this.requestPreviewUpdate();
            new Notice('Axis ranges fit to surfaces.');
            return;
        }

        const funcs: FunctionParameters[] = this.settings.getValue('functions') || [];
        const live = funcs.filter((f) => f.expression && f.domain);
        if (!live.length) {
            new Notice('Add a function first.');
            return;
        }
        let xs: number[] = [];
        let ys: number[] = [];
        for (const f of live) {
            try {
                const [xmin, xmax] = MathHelper.parseDomain(f.domain);
                const fn = MathHelper.compile1D(f.expression);
                const N = 200;
                for (let i = 0; i <= N; i++) {
                    const x = xmin + ((xmax - xmin) * i) / N;
                    const y = fn(x);
                    if (isFinite(y)) { xs.push(x); ys.push(y); }
                }
            } catch {
                // skip
            }
        }
        if (!xs.length) {
            new Notice('Could not evaluate any function.');
            return;
        }
        const [yLo, yHi] = trimmedRange(ys);
        const xPad = (Math.max(...xs) - Math.min(...xs)) * 0.05 || 0.5;
        const yPad = (yHi - yLo) * 0.05 || 0.5;
        const newXmin = Math.min(...xs) - xPad;
        const newXmax = Math.max(...xs) + xPad;
        const newYmin = yLo - yPad;
        const newYmax = yHi + yPad;
        this.settings.setValue('xmin', this.formatRange(newXmin));
        this.settings.setValue('xmax', this.formatRange(newXmax));
        this.settings.setValue('ymin', this.formatRange(newYmin));
        this.settings.setValue('ymax', this.formatRange(newYmax));
        this.refreshRangeInputs();
        this.requestPreviewUpdate();
        new Notice('Axis ranges fit to functions.');
    }

    private applyAxisRange(xmin: number, xmax: number, ymin: number, ymax: number) {
        if (!isFinite(xmin) || !isFinite(xmax) || !isFinite(ymin) || !isFinite(ymax)) return;
        if (xmin >= xmax || ymin >= ymax) return;
        this.settings.setValue('xmin', this.formatRange(xmin));
        this.settings.setValue('xmax', this.formatRange(xmax));
        this.settings.setValue('ymin', this.formatRange(ymin));
        this.settings.setValue('ymax', this.formatRange(ymax));
        this.refreshRangeInputs();
        // Drag pan and wheel zoom are continuous; render on the next frame
        // instead of the 150 ms debounce.
        this.requestPreviewUpdateFast();
    }

    /**
     * Trim trailing zeros and cap to 5 decimals so storage has sub-pixel
     * pan granularity. parseFloat strips the trailing zeros so the
     * Axis-tab range inputs still look short for integer-ish values
     * (e.g. "-5" rather than "-5.00000"). Five decimals is overkill for
     * typical math ranges but keeps the pan smooth at extreme zoom.
     */
    private formatRange(value: number): string {
        return String(parseFloat(value.toFixed(5)));
    }

    private refreshRangeInputs() {
        for (const key of ['xmin', 'xmax', 'ymin', 'ymax', 'zmin', 'zmax']) {
            const input = this.rangeInputs.get(key);
            if (input) input.setValue(String(this.settings.getValue(key)));
        }
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
        // Camera-only change; render on the next animation frame.
        this.requestPreviewUpdateFast();
    }

    private buildActionBar(container: HTMLElement) {
        const bar = container.createDiv({ cls: 'tikz-action-bar' });

        new Setting(bar)
            .addButton((btn) =>
                btn
                    .setButtonText('Copy SVG')
                    .then((b) => b.buttonEl.setAttr('aria-label', 'Copy the preview as an SVG with transparent background'))
                    .onClick(async () => {
                        await this.copyPreviewAsSvg();
                    })
            )
            .addButton((btn) =>
                btn
                    .setButtonText('Copy PNG')
                    .then((b) => b.buttonEl.setAttr('aria-label', 'Copy the preview as a PNG with transparent background'))
                    .onClick(async () => {
                        await this.copyPreviewAsPng();
                    })
            )
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
                    .setButtonText(this.sourceFile ? 'Save changes' : 'Insert into note')
                    .setCta()
                    .then((b) =>
                        b.buttonEl.setAttr(
                            'aria-label',
                            this.sourceFile
                                ? 'Save the edited chart back into the source note'
                                : 'Insert this chart as an easy-tikz block in the current note'
                        )
                    )
                    .onClick(async () => {
                        await this.emitEasyTikzBlock();
                    })
            );
    }

    /**
     * Emit the current settings as an `easy-tikz` JSON code block. If the
     * modal was opened by clicking an existing rendered chart, replace
     * that block in its source file; otherwise insert a new block at the
     * active editor's cursor.
     */
    private async emitEasyTikzBlock() {
        const json = JSON.stringify(this.settings.serialize(), null, 2);
        const newBlock = '```' + this.fenceTag + '\n' + json + '\n```';

        if (this.sourceFile && this.originalBlockText) {
            try {
                const content = await this.app.vault.read(this.sourceFile);
                if (!content.includes(this.originalBlockText)) {
                    new Notice(
                        'Could not locate the original chart in the source file (it may have been edited). Inserting at the cursor instead.'
                    );
                    this.insertAtCursor(newBlock);
                    return;
                }
                const updated = content.replace(this.originalBlockText, newBlock);
                await this.app.vault.modify(this.sourceFile, updated);
                // Update originalBlockText so subsequent saves still find the block.
                this.originalBlockText = newBlock;
                this.close();
            } catch (e) {
                const msg = e instanceof Error ? e.message : 'unknown error';
                new Notice('Could not save the chart to the file: ' + msg);
            }
            return;
        }

        this.insertAtCursor(newBlock);
    }

    private insertAtCursor(blockText: string) {
        const view = this.app.workspace.getActiveViewOfType(MarkdownView);
        if (!view) {
            new Notice('No active note to insert into.');
            return;
        }
        view.editor.replaceSelection(blockText + '\n');
        this.close();
    }

    /**
     * Clone the live SVG and prepare it for export: resolve every `var(--...)`
     * to its computed value (so the image survives outside Obsidian) and drop
     * the background rect for transparency.
     */
    private prepareSvgForExport(): SVGElement | null {
        // 3D's on-screen view is canvas-only; the off-screen SVG holds the
        // exportable DOM and is refreshed here just before we read it.
        // No-op in 2D (the live SVG is already in the DOM).
        this.ensureSvgFresh();
        const svg = this.getChartSvg();
        if (!svg) return null;
        const clone = svg.cloneNode(true) as SVGElement;
        const computed = getComputedStyle(document.body);

        const resolveVars = (value: string): string =>
            value.replace(/var\((--[^,)]+)(?:,\s*([^)]+))?\)/g, (_match, name, fallback) => {
                const v = computed.getPropertyValue(name).trim();
                return v || (fallback ? String(fallback).trim() : '');
            });

        const nodes: Element[] = [clone, ...Array.from(clone.querySelectorAll('*'))];
        for (const el of nodes) {
            for (const attrName of ['fill', 'stroke']) {
                const v = el.getAttribute(attrName);
                if (v && v.includes('var(')) el.setAttribute(attrName, resolveVars(v));
            }
            const styleAttr = el.getAttribute('style');
            if (styleAttr && styleAttr.includes('var(')) el.setAttribute('style', resolveVars(styleAttr));
        }

        // Drop the background rect (it's the first child, fill="var(--background-primary)").
        const firstRect = clone.querySelector(':scope > rect');
        if (firstRect) firstRect.remove();

        // Make sure the SVG carries proper xmlns so it renders standalone outside the page.
        clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
        clone.setAttribute('xmlns:xlink', 'http://www.w3.org/1999/xlink');

        return clone;
    }

    private async copyPreviewAsSvg() {
        const clone = this.prepareSvgForExport();
        if (!clone) {
            new Notice('No graph to copy yet.');
            return;
        }
        const svgString = '<?xml version="1.0" encoding="UTF-8" standalone="no"?>\n' +
            new XMLSerializer().serializeToString(clone);
        try {
            await navigator.clipboard.writeText(svgString);
            new Notice('SVG copied to clipboard (transparent background).');
        } catch {
            new Notice('Could not copy SVG to the clipboard.');
        }
    }

    private async copyPreviewAsPng() {
        const clone = this.prepareSvgForExport();
        if (!clone) {
            new Notice('No graph to copy yet.');
            return;
        }
        const svgString = new XMLSerializer().serializeToString(clone);
        const blob = new Blob([svgString], { type: 'image/svg+xml;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const width = parseFloat(clone.getAttribute('width') || '760');
        const height = parseFloat(clone.getAttribute('height') || '532');

        try {
            const img = new Image();
            await new Promise<void>((resolve, reject) => {
                img.onload = () => resolve();
                img.onerror = () => reject(new Error('Failed to rasterize SVG'));
                img.src = url;
            });

            // 2x for a sharper result on Hi-DPI displays.
            const scale = 2;
            const canvas = document.createElement('canvas');
            canvas.width = Math.round(width * scale);
            canvas.height = Math.round(height * scale);
            const ctx = canvas.getContext('2d');
            if (!ctx) throw new Error('Canvas 2D context unavailable');
            ctx.scale(scale, scale);
            ctx.drawImage(img, 0, 0, width, height);

            const pngBlob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
            if (!pngBlob) throw new Error('Could not encode PNG');

            // Older lib.dom.d.ts in this toolchain requires Promise<Blob>; the runtime accepts a Blob too.
            await navigator.clipboard.write([new ClipboardItem({ 'image/png': Promise.resolve(pngBlob) })]);
            new Notice('PNG copied to clipboard (transparent background, 2x resolution).');
        } catch (e) {
            const message = e instanceof Error ? e.message : 'PNG copy failed';
            new Notice(message);
        } finally {
            URL.revokeObjectURL(url);
        }
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

    /**
     * Schedule a preview update after the standard debounce. Right for text
     * inputs and settings that should not re-render on every keystroke.
     * 3D path always ends up in the SVG render (queryable, exportable).
     */
    private requestPreviewUpdate() {
        if (this.previewRafId !== null) {
            window.cancelAnimationFrame(this.previewRafId);
            this.previewRafId = null;
        }
        if (this.trailingSvgTimer) {
            window.clearTimeout(this.trailingSvgTimer);
            this.trailingSvgTimer = null;
        }
        if (this.previewTimer) window.clearTimeout(this.previewTimer);
        this.previewTimer = window.setTimeout(() => {
            this.previewTimer = null;
            this.updatePreview('svg');
        }, PREVIEW_DEBOUNCE_MS) as unknown as number;
    }

    /**
     * Schedule a fast canvas render on the next animation frame for
     * continuous interactions (drag, wheel, slider) plus a trailing SVG
     * render once the interaction settles. The canvas keeps the FPS high
     * during drag; the SVG kicks in afterward so Copy SVG / Copy PNG see a
     * fresh, queryable DOM tree.
     */
    private requestPreviewUpdateFast() {
        if (this.previewTimer) {
            window.clearTimeout(this.previewTimer);
            this.previewTimer = null;
        }
        if (this.previewRafId === null) {
            this.previewRafId = window.requestAnimationFrame(() => {
                this.previewRafId = null;
                this.updatePreview('canvas');
            });
        }
        // For 3D the on-screen view is canvas-only, so no trailing SVG
        // render is needed (the SVG is rebuilt on demand for export by
        // `ensureSvgFresh`). For 2D the live SVG is always shown, so the
        // trailing render keeps it queryable.
        if (this.trailingSvgTimer) window.clearTimeout(this.trailingSvgTimer);
        if (!this.is3D()) {
            this.trailingSvgTimer = window.setTimeout(() => {
                this.trailingSvgTimer = null;
                this.updatePreview('svg');
            }, 180) as unknown as number;
        }
    }

    /**
     * Remove only the SVG / 3D root from the preview container, keeping
     * the floating overlays (3D zoom buttons, action icons) in place.
     * `previewContainer.empty()` would wipe them out on every render.
     */
    private clearPreviewContent() {
        const children = Array.from(this.previewContainer.children);
        for (const child of children) {
            const tag = child.tagName.toLowerCase();
            if (tag === 'svg' || child.classList.contains('tikz-3d-root')) {
                this.previewContainer.removeChild(child);
            }
        }
    }

    /**
     * Find the chart's SVG element inside the preview container. We can't
     * use `previewContainer.querySelector('svg')` because Obsidian's
     * `setIcon` injects Lucide SVGs into our floating overlay buttons,
     * and those come earlier in the DOM than the chart — every drag,
     * wheel, and export call was accidentally grabbing the first Fit /
     * Reset / Toggle-grid icon (~18 px), which made `plot.scale`
     * ~40× too large and the whole drag pipeline feel runaway.
     *
     * In 2D the chart SVG is a direct child of `previewContainer`. In 3D
     * the SVG lives inside `.tikz-3d-root` (off-screen, used for export).
     */
    private getChartSvg(): SVGElement | null {
        if (this.is3D()) {
            const root = this.previewContainer.querySelector('.tikz-3d-root');
            return (root?.querySelector(':scope > svg') as SVGElement | null) ?? null;
        }
        for (const child of Array.from(this.previewContainer.children)) {
            if (child.tagName.toLowerCase() === 'svg') {
                return child as unknown as SVGElement;
            }
        }
        return null;
    }

    private updatePreview(mode: 'svg' | 'canvas' = 'svg') {
        if (this.previewTimer) {
            window.clearTimeout(this.previewTimer);
            this.previewTimer = null;
        }
        if (this.previewRafId !== null) {
            window.cancelAnimationFrame(this.previewRafId);
            this.previewRafId = null;
        }
        // Note: we do NOT clear the trailing SVG timer here. If we just
        // rendered to canvas, the trailing SVG render still needs to run.

        try {
            const config = this.settings.toRendererConfig();
            if (config.is3D) {
                if (!this.svg3dRenderer) this.svg3dRenderer = new SVG3DRenderer();
                // Attach the 3D root to the preview container BEFORE
                // rendering, so `applyRootFitContain` inside prepareScene
                // can measure the parent on the very first paint. If we
                // rendered first, the root would still be orphaned and
                // the fit-contain math would fall back to config dims.
                const root = this.svg3dRenderer.getElement();
                if (this.currentRenderMode !== '3d' || root.parentElement !== this.previewContainer) {
                    this.clearPreviewContent();
                    this.previewContainer.appendChild(root);
                    this.currentRenderMode = '3d';
                }
                // 3D is canvas-only on screen. The mode parameter is
                // ignored here; the off-screen SVG is rendered on demand
                // by `ensureSvgFresh` before Copy SVG / Copy PNG.
                this.svg3dRenderer.renderCanvas(config);
            } else {
                this.clearPreviewContent();
                const svg = new SVGRenderer(config).render();
                this.previewContainer.appendChild(svg);
                this.currentRenderMode = '2d';
            }
        } catch (e) {
            const message = e instanceof Error ? e.message : 'Rendering error';
            new Notice(`Render failed: ${message}`);
        }

        this.updateCodeArea();
    }

    /**
     * Render the 3D scene to the off-screen SVG synchronously, so the
     * export path can clone a fresh SVG node. Called before Copy SVG /
     * Copy PNG; no-op when the modal is in 2D mode (the 2D path always
     * has a live SVG already mounted).
     */
    private ensureSvgFresh() {
        if (!this.is3D() || !this.svg3dRenderer) return;
        if (this.trailingSvgTimer) {
            window.clearTimeout(this.trailingSvgTimer);
            this.trailingSvgTimer = null;
        }
        const config = this.settings.toRendererConfig();
        this.svg3dRenderer.renderSvg(config);
    }

    private updateCodeArea() {
        if (!this.codeTextArea) return;
        // Don't trample user edits while they're actively typing in the textarea.
        if (document.activeElement === this.codeTextArea) return;
        this.codeTextArea.value = this.generateTikzCodeFresh();
    }
}
