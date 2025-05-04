import { Note } from "@/domain/model/Note";
import type { NoteRepository } from "@/domain/repository/NoteRepository";
import type { App, TFile } from "obsidian";

export class VaultNoteRepository implements NoteRepository {
    constructor(private readonly app: App) {}

    async findByFile(file: TFile): Promise<Note> {
        const content = await this.app.vault.cachedRead(file);
        const links = this.extractLinks(file);
        return new Note(file.path, file.name, content, links);
    }

    async findByPath(path: string): Promise<Note | null> {
        const file = this.app.vault.getFileByPath(path);
        if (!file) {
            return null;
        }
        return this.findByFile(file);
    }

    private extractLinks(file: TFile): string[] {
        const linkRecords = this.app.metadataCache.resolvedLinks[file.path];
        return Object.keys(linkRecords);
    }
}
