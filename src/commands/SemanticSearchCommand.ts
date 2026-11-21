import type { App, Plugin } from "obsidian";
import type { SettingsService } from "@/application/SettingsService";
import type { TextSearchService } from "@/domain/service/TextSearchService";
import {
    SemanticSearchModal,
    type SemanticSearchModalOptions,
} from "@/components/SemanticSearchModal";
import type { Command } from "./Command";

export class SemanticSearchCommand implements Command {
    id = "semantic-search";
    name = "Semantic search";

    /** Opens the semantic search modal; shared by the command and the sidebar button. */
    static openModal(
        app: App,
        textSearchService: TextSearchService,
        settingsService: SettingsService,
        options: SemanticSearchModalOptions = {}
    ): void {
        const settings = settingsService.get();
        new SemanticSearchModal(
            app,
            textSearchService,
            settings.noteDisplayMode,
            options
        ).open();
    }

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
                SemanticSearchCommand.openModal(
                    this.app,
                    this.textSearchService,
                    this.settingsService
                );
            },
        });
    }
}
