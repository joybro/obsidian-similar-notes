import { showNoteErrorNotice } from "@/utils/errorHandling";
import log from "loglevel";
import type { Note } from "../model/Note";
import type { NoteChunk } from "../model/NoteChunk";
import { SimilarNote } from "../model/SimilarNote";
import type { NoteChunkRepository } from "../repository/NoteChunkRepository";
import type { EmbeddingService } from "./EmbeddingService";
import type { NoteChunkingService } from "./NoteChunkingService";

export class SimilarNoteFinder {
    constructor(
        private readonly noteChunkRepository: NoteChunkRepository,
        private readonly noteChunkingService: NoteChunkingService,
        private readonly modelService: EmbeddingService
    ) {}

    async findSimilarNotes(note: Note, limit = 5): Promise<SimilarNote[]> {
        if (!note.content) {
            return [];
        }

        log.info(`[SimilarNoteFinder] ===== Finding similar notes for: ${note.path} =====`);

        // Try to get already indexed chunks first
        let noteChunks = await this.noteChunkRepository.getByPath(note.path);

        // If not found in repository, generate new embeddings
        if (!noteChunks || noteChunks.length === 0) {
            log.info(`[SimilarNoteFinder] No indexed chunks found, generating new embeddings for: ${note.path}`);
            const splitted = await this.noteChunkingService.split(note);
            if (splitted.length === 0) {
                return [];
            }

            try {
                noteChunks = await Promise.all(
                    splitted.map(async (chunk) => {
                        // Include title in first chunk to make it searchable
                        const textToEmbed = chunk.chunkIndex === 0
                            ? `${chunk.title}\n\n${chunk.content}`
                            : chunk.content;
                        return chunk.withEmbedding(
                            await this.modelService.embedText(textToEmbed)
                        );
                    })
                );
            } catch (error) {
                log.error("Failed to generate embeddings for note:", note.path, error);
                showNoteErrorNotice(note.path, error);
                return [];
            }
        } else {
            log.debug(`[SimilarNoteFinder] Using ${noteChunks.length} pre-indexed chunks for: ${note.path}`);
        }

        // Get search results for each embedding and flatten them into a single array
        const searchResultsArrays = await Promise.all(
            noteChunks.map(async ({ content, embedding }) => {
                const results =
                    await this.noteChunkRepository.findSimilarChunks(
                        embedding,
                        15,
                        0,
                        [note.path, ...note.links]
                    );
                return results.map((result) => ({
                    ...result,
                    sourceChunk: content,
                }));
            })
        );

        // Flatten the array of arrays into a single array of SearchResult objects
        const results = searchResultsArrays.flat();

        // Reduce results to unique paths
        const uniqueResults = results.reduce((acc, result) => {
            if (
                acc[result.chunk.path] === undefined ||
                acc[result.chunk.path].score < result.score
            ) {
                acc[result.chunk.path] = result;
            }
            return acc;
        }, {} as Record<string, { chunk: NoteChunk; sourceChunk: string; score: number }>);

        // Convert uniqueResults object to array
        const uniqueResultsArray = Object.values(uniqueResults);

        // Sort by score in descending order
        uniqueResultsArray.sort((a, b) => b.score - a.score);

        log.info(
            `Found ${uniqueResultsArray.length} unique similar notes (sorted by relevance):`,
            uniqueResultsArray.map((r) => ({
                path: r.chunk.path,
                score: r.score.toFixed(3),
            }))
        );

        // Convert to SimilarNote format
        const similarNotes = uniqueResultsArray.map(
            (result) =>
                new SimilarNote(
                    result.chunk.title,
                    result.chunk.path,
                    result.score,
                    result.chunk.content,
                    result.sourceChunk
                )
        );

        return similarNotes.slice(0, limit);
    }
}
