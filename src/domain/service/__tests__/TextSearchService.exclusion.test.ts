import { describe, expect, test } from "vitest";
import { TextSearchService } from "@/domain/service/TextSearchService";

// Notes excluded by the current rules must not appear in the semantic search
// box or the link suggester, even before "Apply rules" removes their chunks.

function chunk(path: string, content: string) {
    return {
        path,
        title: path.replace(/\.md$/, ""),
        content,
        chunkIndex: 0,
        embedding: [1],
    };
}

function makeSearch(isExcluded?: (path: string) => boolean) {
    const rows = [
        { chunk: chunk("Private/diary.md", "secret"), score: 0.9 },
        { chunk: chunk("Recipes/kimchi.md", "kimchi"), score: 0.8 },
    ];
    const repo = {
        findSimilarChunks: async () => rows,
        getByPath: async () => [],
    };
    const embeddingService = {
        countTokens: async () => 1,
        getMaxTokens: () => 100,
        truncateToMaxTokens: async (t: string) => t,
        embedText: async () => [1],
    };
    return new TextSearchService(
        repo as never,
        embeddingService as never,
        isExcluded
    );
}

describe("TextSearchService exclusion", () => {
    test("drops notes the current exclusion rules match", async () => {
        const search = makeSearch((p) => p.startsWith("Private/"));
        const { similarNotes } = await search.findSimilarNotesFromText("q");
        expect(similarNotes.map((n) => n.path)).toEqual(["Recipes/kimchi.md"]);
    });

    test("keeps every note when nothing is excluded", async () => {
        const search = makeSearch();
        const { similarNotes } = await search.findSimilarNotesFromText("q");
        expect(similarNotes.map((n) => n.path)).toEqual([
            "Private/diary.md",
            "Recipes/kimchi.md",
        ]);
    });
});
