import type { Plugin } from "obsidian";
import { Notice as ObsidianNotice } from "obsidian";
import MainPlugin from "../main";
import type { Command } from "./Command";

export class RetryErroredNotesCommand implements Command {
    id = "retry-errored-notes";
    name = "Retry errored notes";

    constructor(private mainPlugin: MainPlugin) {}

    register(plugin: Plugin): void {
        plugin.addCommand({
            id: this.id,
            name: this.name,
            callback: async () => {
                new ObsidianNotice("Retrying errored notes...");
                await this.mainPlugin.retryErroredNotes();
                new ObsidianNotice(
                    "Retry started. Check status bar for progress."
                );
            },
        });
    }
}
