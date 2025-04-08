import type { App } from "obsidian";
import { TFile } from "obsidian";
import type { FileHashStore } from "./obsidianFileChangeQueue";

export class JsonFileHashStore implements FileHashStore {
    private filepath: string;
    private app: App;

    constructor(filepath: string, app: App) {
        this.filepath = filepath;
        this.app = app;
    }

    async load(): Promise<Record<string, string>> {
        const file = this.app.vault.getAbstractFileByPath(this.filepath);
        if (!(file instanceof TFile)) {
            return {};
        }
        const content = await this.app.vault.read(file);
        return JSON.parse(content);
    }

    async save(data: Record<string, string>): Promise<void> {
        const file = this.app.vault.getAbstractFileByPath(this.filepath);
        if (!(file instanceof TFile)) {
            // Create the file if it doesn't exist
            await this.app.vault.create(this.filepath, JSON.stringify(data));
            return;
        }
        await this.app.vault.modify(file, JSON.stringify(data));
    }
}
