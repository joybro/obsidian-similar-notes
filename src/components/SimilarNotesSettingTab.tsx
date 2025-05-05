import type { SettingsService } from "@/application/SettingsService";
import { PluginSettingTab, Setting } from "obsidian";
import type MainPlugin from "../main";

export class SimilarNotesSettingTab extends PluginSettingTab {
    constructor(
        private plugin: MainPlugin,
        private settingsService: SettingsService
    ) {
        super(plugin.app, plugin);
    }

    display(): void {
        const { containerEl } = this;
        containerEl.empty();

        new Setting(containerEl)
            .setName("Database path")
            .setDesc("Path where the similarity database will be stored")
            .addText((text) => {
                text.setValue(this.settingsService.get().dbPath).onChange(
                    async (value) => {
                        await this.settingsService.update({ dbPath: value });
                    }
                );
            });

        new Setting(containerEl)
            .setName("Auto-save interval")
            .setDesc("How often to save changes to disk (in minutes)")
            .addText((text) => {
                text.setValue(
                    this.settingsService.get().autoSaveInterval.toString()
                ).onChange(async (value) => {
                    await this.settingsService.update({
                        autoSaveInterval: Number.parseInt(value, 10),
                    });
                });
            });

        new Setting(containerEl).setName("Index").setHeading();

        new Setting(containerEl)
            .setName("Include frontmatter in indexing and search")
            .setDesc(
                "If enabled, the frontmatter of each note will be included in the similarity index and search."
            )
            .addToggle((toggle) => {
                toggle
                    .setValue(this.settingsService.get().includeFrontmatter)
                    .onChange(async (value) => {
                        await this.settingsService.update({
                            includeFrontmatter: value,
                        });
                    });
            });

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
