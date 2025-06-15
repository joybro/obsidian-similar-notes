import { Note } from "@/domain/model/Note";
import type { NoteRepository } from "@/domain/repository/NoteRepository";
import type { App, TFile } from "obsidian";

export class VaultNoteRepository implements NoteRepository {
    constructor(private readonly app: App) {}

    async findByFile(
        file: TFile,
        readContentWithoutFrontmatter = false
    ): Promise<Note> {
        const content = readContentWithoutFrontmatter
            ? await this.readContentWithoutFrontmatter(file)
            : await this.app.vault.cachedRead(file);
        const links = this.extractLinks(file);
        return new Note(file.path, file.basename, content, links);
    }

    async findByPath(
        path: string,
        readContentWithoutFrontmatter = false
    ): Promise<Note | null> {
        const file = this.app.vault.getFileByPath(path);
        if (!file) {
            return null;
        }
        return this.findByFile(file, readContentWithoutFrontmatter);
    }

    private extractLinks(file: TFile): string[] {
        const linkRecords = this.app.metadataCache.resolvedLinks[file.path];
        return linkRecords ? Object.keys(linkRecords) : [];
    }

    private async readContentWithoutFrontmatter(file: TFile): Promise<string> {
        const raw = await this.app.vault.cachedRead(file);
        const cache = this.app.metadataCache.getFileCache(file);

        if (!cache?.frontmatterPosition) return raw;

        const { start, end } = cache.frontmatterPosition;
        const lines = raw.split("\n");

        return lines.slice(end.line + 1).join("\n");
    }
}
