import type { Note } from "@/domain/model/Note";
import { NoteChunk } from "@/domain/model/NoteChunk";
import type { EmbeddingService } from "@/domain/service/EmbeddingService";
import type { NoteChunkingService } from "@/domain/service/NoteChunkingService";
import { RecursiveCharacterTextSplitter } from "@langchain/textsplitters";

export class LangchainNoteChunkingService implements NoteChunkingService {
    private readonly splitter: RecursiveCharacterTextSplitter;

    constructor(private readonly embeddingService: EmbeddingService) {
        this.splitter = RecursiveCharacterTextSplitter.fromLanguage(
            "markdown",
            {
                chunkSize: this.embeddingService.getMaxTokens(),
                chunkOverlap: 100,
                lengthFunction: (text) =>
                    this.embeddingService.countTokens(text),
            }
        );
    }

    async split(note: Note): Promise<NoteChunk[]> {
        const chunks = await this.splitter.splitText(note.content);
        return chunks.map(
            (chunk, index) =>
                new NoteChunk(
                    note.path,
                    note.title,
                    chunk,
                    index,
                    chunks.length,
                    []
                )
        );
    }
}
