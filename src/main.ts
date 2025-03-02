import { Plugin } from "obsidian";
import SimilarNotesPlugin from "./SimilarNotesPlugin";

export default class MainPlugin extends Plugin {
    private similarNotesPlugin: SimilarNotesPlugin;

    async onload() {
        console.log("Loading Similar Notes plugin");

        // Create plugin instance and initialize
        this.similarNotesPlugin = new SimilarNotesPlugin(
            this.app,
            this.manifest
        );
        await this.similarNotesPlugin.onload();
    }

    onunload() {
        console.log("Unloading Similar Notes plugin");

        // Clean up plugin
        if (this.similarNotesPlugin) {
            this.similarNotesPlugin.onunload();
        }
    }
}
