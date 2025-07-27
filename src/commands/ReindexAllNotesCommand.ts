import type { Plugin, Notice } from "obsidian";
import { Notice as ObsidianNotice } from "obsidian";
import MainPlugin from "../main";
import type { Command } from "./Command";

export class ReindexAllNotesCommand implements Command {
    id = "reindex-all-notes";
    name = "Reindex all notes";

    constructor(private mainPlugin: MainPlugin) {}

    register(plugin: Plugin): void {
        plugin.addCommand({
            id: this.id,
            name: this.name,
            callback: async () => {
                new ObsidianNotice("Reindexing all notes...");
                await this.mainPlugin.reindexNotes();
                new ObsidianNotice("Reindexing started. Check status bar for progress.");
            },
        });
    }
}