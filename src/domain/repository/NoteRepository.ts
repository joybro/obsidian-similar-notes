import type { Note } from "@/domain/model/Note";
import type { TFile } from "obsidian";

export interface NoteRepository {
    findByFile(
        file: TFile,
        readContentWithoutFrontmatter?: boolean
    ): Promise<Note>;

    findByPath(
        path: string,
        readContentWithoutFrontmatter?: boolean
    ): Promise<Note | null>;

    /**
     * Resolved outgoing link targets for a note. Served from the metadata
     * cache — no file content read.
     */
    getLinkedPaths(path: string): Promise<string[]>;
}
