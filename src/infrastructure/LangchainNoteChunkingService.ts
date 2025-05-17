import type { Note } from "@/domain/model/Note";
import { NoteChunk } from "@/domain/model/NoteChunk";
import type { EmbeddingService } from "@/domain/service/EmbeddingService";
import type { NoteChunkingService } from "@/domain/service/NoteChunkingService";
import { RecursiveCharacterTextSplitter } from "@langchain/textsplitters";
import log from "loglevel";

export class LangchainNoteChunkingService implements NoteChunkingService {
    private splitter: RecursiveCharacterTextSplitter | null = null;

    constructor(private readonly embeddingService: EmbeddingService) {}

    async init() {
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
        if (!this.splitter) {
            throw new Error("Splitter not initialized");
        }

        const chunks = await this.splitter.splitText(note.content);
        if (log.getLevel() <= log.levels.DEBUG) {
            const tokens = await Promise.all(
                chunks.map((chunk) => this.embeddingService.countTokens(chunk))
            );
            log.debug("chunk tokens", note.path, chunks.length, tokens);
        }
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
