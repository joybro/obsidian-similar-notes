import { Plugin } from "obsidian";
import SimilarNotesPlugin from "./similarNotesPlugin";

export default class MainPlugin extends Plugin {
    private similarNotesPlugin: SimilarNotesPlugin;

    async onload() {
        // Create plugin instance and initialize
        this.similarNotesPlugin = new SimilarNotesPlugin(
            this.app,
            this.manifest
        );
        await this.similarNotesPlugin.onload();
    }

    onunload() {
        // Clean up plugin
        if (this.similarNotesPlugin) {
            this.similarNotesPlugin.onunload();
        }
    }
}
