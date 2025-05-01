import { Note } from "@/domain/model/Note";
import type { NoteRepository } from "@/domain/repository/NoteRepository";
import type { TFile, Vault } from "obsidian";

export class VaultNoteRepository implements NoteRepository {
    constructor(private readonly vault: Vault) {}

    async findByFile(file: TFile): Promise<Note> {
        const content = await this.vault.cachedRead(file);
        const links = this.extractLinks(content);
        return new Note(file.path, file.name, content, links);
    }

    async findByPath(path: string): Promise<Note | null> {
        const file = this.vault.getFileByPath(path);
        if (!file) {
            return null;
        }
        return this.findByFile(file);
    }

    private extractLinks(content: string): string[] {
        // const links = content.match(/\[\[([^\]]+)\]\]/g);
        // return links ? links.map((link) => link.slice(2, -2)) : [];
        return [];
    }
}
