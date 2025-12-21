import log from "loglevel";
import type { NoteChunk } from "../model/NoteChunk";
import { SimilarNote } from "../model/SimilarNote";
import type { NoteChunkRepository } from "../repository/NoteChunkRepository";
import type { EmbeddingService } from "./EmbeddingService";

export interface TextSearchResult {
    similarNotes: SimilarNote[];
    tokenCount: number;
    maxTokens: number;
    isOverLimit: boolean;
}

export class TextSearchService {
    constructor(
        private readonly noteChunkRepository: NoteChunkRepository,
        private readonly embeddingService: EmbeddingService
    ) {}

    /**
     * Check if the input text exceeds the token limit
     */
    async checkTokenLimit(text: string): Promise<{ tokenCount: number; maxTokens: number; isOverLimit: boolean }> {
        const tokenCount = await this.embeddingService.countTokens(text);
        const maxTokens = this.embeddingService.getMaxTokens();
        return {
            tokenCount,
            maxTokens,
            isOverLimit: tokenCount > maxTokens,
        };
    }

    /**
     * Find similar notes based on input text
     */
    async findSimilarNotesFromText(
        text: string,
        limit: number = 10
    ): Promise<TextSearchResult> {
        log.info(`[TextSearchService] Searching for similar notes with text: "${text.substring(0, 50)}..."`);

        // Check token limit
        const { tokenCount, maxTokens, isOverLimit } = await this.checkTokenLimit(text);

        if (isOverLimit) {
            log.warn(`[TextSearchService] Text exceeds token limit: ${tokenCount}/${maxTokens}`);
            return {
                similarNotes: [],
                tokenCount,
                maxTokens,
                isOverLimit: true,
            };
        }

        // Generate embedding for the input text
        const embedding = await this.embeddingService.embedText(text);

        // Find similar chunks (no exclusions for text search)
        const results = await this.noteChunkRepository.findSimilarChunks(
            embedding,
            limit * 3, // Get more results to ensure we have enough after grouping
            0,
            [] // No excluded paths
        );

        // Group by note path and keep the best match per note
        const uniqueResults = this.groupByNotePath(results);

        // Sort by score descending
        uniqueResults.sort((a, b) => b.score - a.score);

        log.info(
            `[TextSearchService] Found ${uniqueResults.length} unique similar notes:`,
            uniqueResults.map((r) => ({
                path: r.chunk.path,
                score: r.score.toFixed(3),
            }))
        );

        // Convert to SimilarNote format
        const similarNotes = uniqueResults
            .slice(0, limit)
            .map(
                (result) =>
                    new SimilarNote(
                        result.chunk.title,
                        result.chunk.path,
                        result.score,
                        result.chunk.content,
                        text // The source is the search query itself
                    )
            );

        return {
            similarNotes,
            tokenCount,
            maxTokens,
            isOverLimit: false,
        };
    }

    /**
     * Group search results by note path, keeping the highest scoring chunk per note
     */
    private groupByNotePath(
        results: { chunk: NoteChunk; score: number }[]
    ): { chunk: NoteChunk; score: number }[] {
        const grouped = results.reduce(
            (acc, result) => {
                if (
                    acc[result.chunk.path] === undefined ||
                    acc[result.chunk.path].score < result.score
                ) {
                    acc[result.chunk.path] = result;
                }
                return acc;
            },
            {} as Record<string, { chunk: NoteChunk; score: number }>
        );

        return Object.values(grouped);
    }
}
