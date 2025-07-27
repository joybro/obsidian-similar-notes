import type { Plugin } from "obsidian";
import type { SettingsService } from "../application/SettingsService";
import type { Command } from "./Command";

export class ToggleInDocumentViewCommand implements Command {
    id = "toggle-in-document-view";
    name = "Toggle in-document view";

    constructor(private settingsService: SettingsService) {}

    register(plugin: Plugin): void {
        plugin.addCommand({
            id: this.id,
            name: this.name,
            callback: async () => {
                const currentSettings = this.settingsService.get();
                await this.settingsService.update({
                    showAtBottom: !currentSettings.showAtBottom,
                });
            },
        });
    }
}