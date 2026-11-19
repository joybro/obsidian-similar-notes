import { showNoteErrorNotice } from "@/utils/errorHandling";
import log from "loglevel";
import type { Note } from "../model/Note";
import { type NoteChunk, isTitleChunk } from "../model/NoteChunk";
import { SimilarNote } from "../model/SimilarNote";
import type { NoteChunkRepository } from "../repository/NoteChunkRepository";
import type { EmbeddingService } from "./EmbeddingService";
import type { NoteChunkingService } from "./NoteChunkingService";

/**
 * Why a search came back the way it did. "ok" covers both "found some" and
 * "searched and found nothing"; the others are searches that never ran, so
 * the panel can say why it is empty instead of "No similar notes found."
 */
export type SimilarNoteSearchStatus =
    | "ok"
    | "empty-content"
    | "ad-hoc-disallowed"
    | "embedding-failed";

export interface SimilarNoteSearchResult {
    notes: SimilarNote[];
    status: SimilarNoteSearchStatus;
}

export class SimilarNoteFinder {
    constructor(
        private readonly noteChunkRepository: NoteChunkRepository,
        private readonly noteChunkingService: NoteChunkingService,
        private readonly modelService: EmbeddingService
    ) {}

    /**
     * @param options.allowAdHocEmbedding When false and the note has no
     * indexed chunks, return no results instead of embedding the note on the
     * fly. Used for excluded notes with a cloud provider, so their text never
     * leaves the device (frontmatter-exclusion spec §2.1).
     */
    async findSimilarNotes(
        note: Note,
        limit = 5,
        options: { allowAdHocEmbedding: boolean } = { allowAdHocEmbedding: true }
    ): Promise<SimilarNote[]> {
        return (await this.findSimilarNotesWithStatus(note, limit, options))
            .notes;
    }

    async findSimilarNotesWithStatus(
        note: Note,
        limit = 5,
        options: { allowAdHocEmbedding: boolean } = { allowAdHocEmbedding: true }
    ): Promise<SimilarNoteSearchResult> {
        if (!note.content) {
            // An excluded note under a cloud provider is never embedded, so
            // writing in it will not bring results; say that rather than
            // "write a few lines".
            if (!options.allowAdHocEmbedding) {
                return { notes: [], status: "ad-hoc-disallowed" };
            }
            return { notes: [], status: "empty-content" };
        }

        log.info(`[SimilarNoteFinder] ===== Finding similar notes for: ${note.path} =====`);

        // Try to get already indexed chunks first
        // Title rows are for text queries only; the panel compares bodies
        // (title-vector spec "Query paths").
        let noteChunks = (
            await this.noteChunkRepository.getByPath(note.path)
        ).filter((chunk) => !isTitleChunk(chunk));

        // If not found in repository, generate new embeddings
        if (!noteChunks || noteChunks.length === 0) {
            if (!options.allowAdHocEmbedding) {
                log.info(`[SimilarNoteFinder] No indexed chunks and ad-hoc embedding disallowed for: ${note.path}`);
                return { notes: [], status: "ad-hoc-disallowed" };
            }
            log.info(`[SimilarNoteFinder] No indexed chunks found, generating new embeddings for: ${note.path}`);
            const splitted = await this.noteChunkingService.split(note);
            if (splitted.length === 0) {
                return { notes: [], status: "empty-content" };
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
                return { notes: [], status: "embedding-failed" };
            }
        } else {
            log.debug(`[SimilarNoteFinder] Using ${noteChunks.length} pre-indexed chunks for: ${note.path}`);
        }

        const linkedPaths = new Set(note.links);

        // Get search results for each embedding and flatten them into a single array
        const searchResultsArrays = await Promise.all(
            noteChunks.map(async ({ content, embedding }) => {
                const results =
                    await this.noteChunkRepository.findSimilarChunks(
                        embedding,
                        15,
                        0,
                        [note.path], // exclude self only; linked notes are now shown (marked)
                        { bodyChunksOnly: true }
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
                    result.sourceChunk,
                    linkedPaths.has(result.chunk.path)
                )
        );

        return { notes: similarNotes.slice(0, limit), status: "ok" };
    }
}
