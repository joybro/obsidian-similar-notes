import type { Note } from "@/domain/model/Note";
import type { TFile } from "obsidian";

export interface NoteRepository {
    findByFile(file: TFile): Promise<Note>;

    findByPath(path: string): Promise<Note | null>;
}
