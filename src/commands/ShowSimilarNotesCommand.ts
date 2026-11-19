import type { Plugin } from "obsidian";
import MainPlugin from "../main";
import type { Command } from "./Command";
import { logRejection } from "@/utils/logRejection";

export class ShowSimilarNotesCommand implements Command {
    id = "show-similar-notes";
    name = "Show in sidebar";

    constructor(private mainPlugin: MainPlugin) {}

    register(plugin: Plugin): void {
        plugin.addCommand({
            id: this.id,
            name: this.name,
            callback: () => {
                logRejection(this.mainPlugin.activateSimilarNotesView(), "open Similar Notes view");
            },
        });
    }
}