import type { Plugin } from "obsidian";
import MainPlugin from "../main";
import type { Command } from "./Command";

export class ShowSimilarNotesCommand implements Command {
    id = "show-similar-notes";
    name = "Show Similar Notes";

    constructor(private mainPlugin: MainPlugin) {}

    register(plugin: Plugin): void {
        plugin.addCommand({
            id: this.id,
            name: this.name,
            callback: () => {
                this.mainPlugin.activateSimilarNotesView();
            },
        });
    }
}