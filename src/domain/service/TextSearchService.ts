import log from "loglevel";
import { type NoteChunk, isTitleChunk } from "../model/NoteChunk";
import { SimilarNote } from "../model/SimilarNote";
import type { NoteChunkRepository } from "../repository/NoteChunkRepository";
import type { EmbeddingService } from "./EmbeddingService";
import { TITLE_OVERLAP_WEIGHT, titleOverlap } from "./titleOverlap";

export interface TextSearchResult {
    similarNotes: SimilarNote[];
    tokenCount: number;
    maxTokens: number;
    isOverLimit: boolean;
}

type RankedHit = { chunk: NoteChunk; score: number; rank: number };

export class TextSearchService {
    constructor(
        private readonly noteChunkRepository: NoteChunkRepository,
        private readonly embeddingService: EmbeddingService,
        // Current exclusion rules (path patterns and frontmatter). Checked at
        // search time so a newly excluded note stops appearing before
        // "Apply rules" removes its chunks from the index.
        private readonly isExcluded: (path: string) => boolean = () => false
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
     * If text exceeds token limit, it will be truncated to fit
     */
    async findSimilarNotesFromText(
        text: string,
        limit = 10
    ): Promise<TextSearchResult> {
        log.info(`[TextSearchService] Searching for similar notes with text: "${text.substring(0, 50)}..."`);

        // Check token limit
        const { tokenCount, maxTokens, isOverLimit } = await this.checkTokenLimit(text);

        // Truncate text if over limit
        let searchText = text;
        if (isOverLimit) {
            log.warn(`[TextSearchService] Text exceeds token limit: ${tokenCount}/${maxTokens}, truncating...`);
            searchText = await this.embeddingService.truncateToMaxTokens(text);
        }

        // Generate embedding for the (possibly truncated) text
        const embedding = await this.embeddingService.embedText(searchText);

        // Find similar chunks; exclusions are applied after grouping
        const results = await this.noteChunkRepository.findSimilarChunks(
            embedding,
            limit * 3, // Get more results to ensure we have enough after grouping
            0,
            [] // No excluded paths
        );

        // Title rows rank by similarity plus the title overlap bonus; the
        // shown score stays the plain similarity (title-vector spec).
        const ranked = results.map((result) => ({
            ...result,
            rank: isTitleChunk(result.chunk)
                ? result.score + TITLE_OVERLAP_WEIGHT * titleOverlap(searchText, result.chunk.content)
                : result.score,
        }));

        // Group by note path and keep the best match per note, dropping
        // notes the current exclusion rules match
        const uniqueResults = this.groupByNotePath(ranked).filter(
            (result) => !this.isExcluded(result.chunk.path)
        );

        // Sort by ranking key descending
        uniqueResults.sort((a, b) => b.rank - a.rank);

        log.info(
            `[TextSearchService] Found ${uniqueResults.length} unique similar notes:`,
            uniqueResults.map((r) => ({
                path: r.chunk.path,
                score: r.score.toFixed(3),
            }))
        );

        // Convert to SimilarNote format. Title rows take part in the search
        // (a note scores max(body, title)), but a title-only preview says
        // nothing, so a title hit previews the note's first body chunk.
        const similarNotes = await Promise.all(
            uniqueResults.slice(0, limit).map(
                async (result) =>
                    new SimilarNote(
                        result.chunk.title,
                        result.chunk.path,
                        result.score,
                        await this.previewOf(result.chunk),
                        text // The source is the search query itself
                    )
            )
        );

        return {
            similarNotes,
            tokenCount,
            maxTokens,
            isOverLimit,
        };
    }

    private async previewOf(chunk: NoteChunk): Promise<string> {
        if (!isTitleChunk(chunk)) {
            return chunk.content;
        }
        const body = (await this.noteChunkRepository.getByPath(chunk.path))
            .filter((row) => !isTitleChunk(row))
            .sort((a, b) => a.chunkIndex - b.chunkIndex);
        return body[0]?.content ?? chunk.content;
    }

    /**
     * Group search results by note path, keeping the highest ranked chunk per note
     */
    private groupByNotePath(results: RankedHit[]): RankedHit[] {
        const grouped = results.reduce(
            (acc, result) => {
                if (
                    acc[result.chunk.path] === undefined ||
                    acc[result.chunk.path].rank < result.rank
                ) {
                    acc[result.chunk.path] = result;
                }
                return acc;
            },
            {} as Record<string, RankedHit>
        );

        return Object.values(grouped);
    }
}
