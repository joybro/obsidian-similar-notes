import type { Note } from "@/domain/model/Note";
import type { NoteChunk } from "@/domain/model/NoteChunk";

export interface NoteChunkingService {
    init(): Promise<void>;

    split(note: Note): Promise<NoteChunk[]>;
}
