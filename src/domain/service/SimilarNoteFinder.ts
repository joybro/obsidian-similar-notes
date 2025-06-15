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

    async findSimilarNotes(note: Note): Promise<SimilarNote[]> {
        if (!note.content) {
            return [];
        }

        const splitted = await this.noteChunkingService.split(note);
        if (splitted.length === 0) {
            return [];
        }

        const noteChunks = await Promise.all(
            splitted.map(async (chunk) =>
                chunk.withEmbedding(
                    await this.modelService.embedText(chunk.content)
                )
            )
        );

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

        log.info("uniqueResultsArray", uniqueResultsArray);

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

        return similarNotes.slice(0, 5);
    }
}
