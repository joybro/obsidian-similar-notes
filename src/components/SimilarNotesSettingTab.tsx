import { type App, PluginSettingTab } from "obsidian";
import { type Root, createRoot } from "react-dom/client";
import type SimilarNotesPlugin from "../SimilarNotesPlugin";
import SimilarNotesSetting from "./SimilarNotesSetting";

export class SimilarNotesSettingTab extends PluginSettingTab {
    private root: Root | null = null;

    constructor(app: App, private plugin: SimilarNotesPlugin) {
        super(app, plugin);
    }

    display(): void {
        const { containerEl } = this;
        containerEl.empty();

        // Create container for React component
        const settingContainer = containerEl.createDiv();
        this.root = createRoot(settingContainer);

        // Render the React component
        this.root.render(
            <SimilarNotesSetting
                onReindex={async () => {
                    await this.plugin.reindexNotes();
                }}
            />
        );
    }

    hide(): void {
        if (this.root) {
            this.root.unmount();
            this.root = null;
        }
    }
}
