import type { App } from "obsidian";

export class FilepathChunkIndexStore {
    constructor(
        private readonly app: App,
        private readonly storagePath: string
    ) {}

    private index: Map<string, string[]> = new Map();

    async load(): Promise<void> {
        const content = await this.app.vault.adapter.read(this.storagePath);
        this.index = new Map(JSON.parse(content));
    }

    async save(): Promise<void> {
        await this.app.vault.adapter.write(
            this.storagePath,
            JSON.stringify(Array.from(this.index.entries()))
        );
    }

    addMapping(filepath: string, chunkId: string): void {
        const list = this.index.get(filepath) || [];
        list.push(chunkId);
        this.index.set(filepath, list);
    }

    getChunkIds(filepath: string): string[] {
        return this.index.get(filepath) || [];
    }

    remove(filepath: string): void {
        this.index.delete(filepath);
    }
}
