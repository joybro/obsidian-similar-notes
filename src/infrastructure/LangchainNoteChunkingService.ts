import type { Note } from "@/domain/model/Note";
import { NoteChunk } from "@/domain/model/NoteChunk";
import type { EmbeddingService } from "@/domain/service/EmbeddingService";
import type { NoteChunkingService } from "@/domain/service/NoteChunkingService";
import { RecursiveCharacterTextSplitter } from "@langchain/textsplitters";
import log from "loglevel";

// Chunk size targeted for semantic-search granularity. getMaxTokens() is an
// embedding-input *ceiling* (model context / transport safety), not a good chunk
// size: large-context models (e.g. bge-m3, 8K context -> maxTokens 2048) would
// produce ~4KB chunks that blend a dozen-plus subtopics, diluting any single
// topic so it never surfaces as a chunk match on long multi-topic notes.
// We cap the chunk size at this fixed target and keep getMaxTokens() only as the
// upper bound, so small-context models (all-minilm at 256) keep their smaller
// size. See docs/semantic-chunk-size-spec.md and docs/adr/0002-*.
export const SEMANTIC_CHUNK_TOKENS = 512;

export class LangchainNoteChunkingService implements NoteChunkingService {
    private splitter: RecursiveCharacterTextSplitter | null = null;

    constructor(private readonly embeddingService: EmbeddingService) {}

    async init() {
        this.splitter = RecursiveCharacterTextSplitter.fromLanguage(
            "markdown",
            {
                // min(): never exceed what the model/transport can embed, but
                // never chunk coarser than the semantic target either.
                chunkSize: Math.min(
                    SEMANTIC_CHUNK_TOKENS,
                    this.embeddingService.getMaxTokens()
                ),
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
