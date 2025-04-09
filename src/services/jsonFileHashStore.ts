import type { Vault } from "obsidian";
import type { FileHashStore } from "./obsidianFileChangeQueue";

export class JsonFileHashStore implements FileHashStore {
    private filepath: string;
    private vault: Vault;

    constructor(filepath: string, vault: Vault) {
        this.filepath = filepath;
        this.vault = vault;
    }

    async load(): Promise<Record<string, string>> {
        const exist = await this.vault.adapter.exists(this.filepath);
        console.log("load file", exist);
        if (!exist) {
            return {};
        }
        const content = await this.vault.adapter.read(this.filepath);
        return JSON.parse(content);
    }

    async save(data: Record<string, string>): Promise<void> {
        await this.vault.adapter.write(this.filepath, JSON.stringify(data));
    }
}
