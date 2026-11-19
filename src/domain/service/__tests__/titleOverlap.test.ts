import { describe, expect, it, vi } from "vitest";
import { NoteChunk } from "@/domain/model/NoteChunk";
import type { NoteChunkRepository } from "@/domain/repository/NoteChunkRepository";
import type { EmbeddingService } from "@/domain/service/EmbeddingService";
import { TextSearchService } from "@/domain/service/TextSearchService";
import { TITLE_OVERLAP_WEIGHT, titleOverlap } from "@/domain/service/titleOverlap";

describe("titleOverlap (title-vector spec: title overlap bonus)", () => {
    it("is the share of query bigrams found in the title", () => {
        expect(titleOverlap("권한 계약", "3. 권한 계약 v1")).toBe(1);
        // "루프" -> {루프}; title "6. 루프" holds it
        expect(titleOverlap("루프", "6. 루프")).toBe(1);
        expect(titleOverlap("루프", "0. 절대 규칙")).toBe(0);
    });

    it("keeps overlap when a particle is attached to a query word", () => {
        // 계약이 -> {계약, 약이}: one of two bigrams is in the title
        expect(titleOverlap("계약이", "권한 계약")).toBe(0.5);
    });

    it("lowercases, ignores punctuation and one-character words", () => {
        expect(titleOverlap("Title, VECTOR!", "title-vector spec")).toBe(1);
        expect(titleOverlap("a b", "a b c")).toBe(0);
        expect(titleOverlap("", "anything")).toBe(0);
    });
});

function row(path: string, chunkIndex: number, content: string): NoteChunk {
    return new NoteChunk(path, path.replace(/\.md$/, ""), content, chunkIndex, 1, [1, 0]);
}

function serviceWith(hits: { chunk: NoteChunk; score: number }[], rows: NoteChunk[] = []) {
    const repo: Partial<NoteChunkRepository> = {
        findSimilarChunks: vi.fn(async () => hits),
        getByPath: vi.fn(async (p: string) => rows.filter((r) => r.path === p)),
    };
    const embedding: Partial<EmbeddingService> = {
        countTokens: vi.fn(async () => 3),
        getMaxTokens: vi.fn(() => 512),
        embedText: vi.fn(async () => [1, 0]),
    };
    return new TextSearchService(repo as NoteChunkRepository, embedding as EmbeddingService);
}

describe("TextSearchService title overlap bonus", () => {
    it("ranks the title sharing the query's characters above a slightly closer title, showing plain scores", async () => {
        const other = row("0. 절대 규칙.md", -1, "0. 절대 규칙");
        const own = row("6. 루프.md", -1, "6. 루프");
        const service = serviceWith(
            [
                { chunk: other, score: 0.83 },
                { chunk: own, score: 0.77 },
            ],
            [row("0. 절대 규칙.md", 0, "body a"), row("6. 루프.md", 0, "body b")]
        );

        const { similarNotes } = await service.findSimilarNotesFromText("루프");

        expect(similarNotes.map((n) => n.path)).toEqual(["6. 루프.md", "0. 절대 규칙.md"]);
        expect(similarNotes[0].similarity).toBe(0.77);
        expect(similarNotes[1].similarity).toBe(0.83);
    });

    it("does not boost body rows", async () => {
        const body = row("A.md", 0, "루프 루프 루프");
        const title = row("B.md", -1, "B");
        const service = serviceWith([
            { chunk: title, score: 0.8 },
            { chunk: body, score: 0.75 },
        ]);

        const { similarNotes } = await service.findSimilarNotesFromText("루프");

        expect(similarNotes.map((n) => n.path)).toEqual(["B.md", "A.md"]);
    });

    it("uses the documented weight", () => {
        expect(TITLE_OVERLAP_WEIGHT).toBe(0.1);
    });
});
