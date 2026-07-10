import type { Note } from "@/domain/model/Note";
import type { NoteChunk } from "@/domain/model/NoteChunk";
import type { CodeChunkingService } from "@/domain/service/CodeChunkingService";
import type { NoteChunkingService } from "@/domain/service/NoteChunkingService";
import type { FencedCodeBlockExtractor } from "./FencedCodeBlockExtractor";

/** Adapts fenced-code extraction to the existing note-indexing pipeline. */
export class FencedCodeNoteChunkingService implements NoteChunkingService {
    constructor(
        private readonly extractor: FencedCodeBlockExtractor,
        private readonly codeChunkingService: CodeChunkingService
    ) {}

    async init(): Promise<void> {
        await this.codeChunkingService.init();
    }

    async split(note: Note): Promise<NoteChunk[]> {
        const { codeBlocks } = this.extractor.extract(note.content ?? "");
        return this.codeChunkingService.split(note, codeBlocks);
    }
}
