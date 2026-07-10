import type { SettingsService } from "@/application/SettingsService";
import type { SimilarNoteCoordinator } from "@/application/SimilarNoteCoordinator";
import type { TextSearch } from "@/domain/service/TextSearchService";
import type MainPlugin from "@/main";
import type { App } from "obsidian";
import type { Command } from "./Command";
import { ExportActiveNoteSimilarNotesCommand } from "./ExportActiveNoteSimilarNotesCommand";
import { ReindexAllNotesCommand } from "./ReindexAllNotesCommand";
import { RetryErroredNotesCommand } from "./RetryErroredNotesCommand";
import { SemanticSearchCommand } from "./SemanticSearchCommand";
import { ShowSimilarNotesCommand } from "./ShowSimilarNotesCommand";
import { ToggleInDocumentViewCommand } from "./ToggleInDocumentViewCommand";

interface PluginCommandDependencies {
    plugin: MainPlugin;
    app: App;
    settingsService: SettingsService;
    similarNoteCoordinator: SimilarNoteCoordinator;
    notesTextSearch: TextSearch;
    getCodeTextSearch: () => TextSearch | undefined;
    manifestId: string;
}

export function createPluginCommands({
    plugin,
    app,
    settingsService,
    similarNoteCoordinator,
    notesTextSearch,
    getCodeTextSearch,
    manifestId,
}: PluginCommandDependencies): Command[] {
    return [
        new ShowSimilarNotesCommand(plugin),
        new ToggleInDocumentViewCommand(settingsService),
        new ReindexAllNotesCommand(plugin),
        new RetryErroredNotesCommand(plugin),
        new SemanticSearchCommand(
            app,
            notesTextSearch,
            settingsService,
            getCodeTextSearch
        ),
        new ExportActiveNoteSimilarNotesCommand(
            app,
            similarNoteCoordinator,
            manifestId
        ),
    ];
}
