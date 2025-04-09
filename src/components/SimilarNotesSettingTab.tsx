import { type App, PluginSettingTab, Setting } from "obsidian";
import type MainPlugin from "../main";

export class SimilarNotesSettingTab extends PluginSettingTab {
    constructor(app: App, private plugin: MainPlugin) {
        super(app, plugin);
    }

    display(): void {
        const { containerEl } = this;
        containerEl.empty();

        new Setting(containerEl)
            .setName("Database path")
            .setDesc("Path where the similarity database will be stored")
            .addText((text) => {
                text.setValue(this.plugin.getSettings().dbPath).onChange(
                    async (value) => {
                        await this.plugin.updateSettings({ dbPath: value });
                    }
                );
            });

        new Setting(containerEl)
            .setName("Auto-save interval")
            .setDesc("How often to save changes to disk (in minutes)")
            .addText((text) => {
                text.setValue(
                    this.plugin.getSettings().autoSaveInterval.toString()
                ).onChange(async (value) => {
                    await this.plugin.updateSettings({
                        autoSaveInterval: Number.parseInt(value, 10),
                    });
                });
            });

        new Setting(containerEl).setName("Index").setHeading();

        new Setting(containerEl)
            .setName("Reindex notes")
            .setDesc("Rebuild the similarity index for all notes")
            .addButton((button) => {
                button.setButtonText("Reindex").onClick(async () => {
                    await this.plugin.reindexNotes();
                });
            });
    }
}
