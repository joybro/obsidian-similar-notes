import type { App, Plugin } from "obsidian";
import type { SettingsService } from "@/application/SettingsService";
import type { TextSearchService } from "@/domain/service/TextSearchService";
import { SemanticSearchModal } from "@/components/SemanticSearchModal";
import type { Command } from "./Command";

export class SemanticSearchCommand implements Command {
    id = "semantic-search";
    name = "Semantic search";

    constructor(
        private app: App,
        private textSearchService: TextSearchService,
        private settingsService: SettingsService
    ) {}

    register(plugin: Plugin): void {
        plugin.addCommand({
            id: this.id,
            name: this.name,
            hotkeys: [
                {
                    modifiers: ["Mod", "Shift"],
                    key: "o",
                },
            ],
            callback: () => {
                const settings = this.settingsService.get();
                const modal = new SemanticSearchModal(
                    this.app,
                    this.textSearchService,
                    settings.noteDisplayMode
                );
                modal.open();
            },
        });
    }
}
