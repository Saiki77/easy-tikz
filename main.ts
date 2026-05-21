import { App, Plugin, PluginSettingTab, Setting } from 'obsidian';
import { TikzModal } from './src/modal';
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

        this.addSettingTab(new EasyTikzSettingTab(this.app, this));
    }

    async saveUserTemplates(templates: UserTemplate[]) {
        this.data.userTemplates = templates;
        await this.saveData(this.data);
    }

    async saveSettings() {
        await this.saveData(this.data);
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
    }
}
