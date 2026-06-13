import { describe, expect, it, vi } from "vitest";
import { Note } from "@/domain/model/Note";
import { NoteChunk } from "@/domain/model/NoteChunk";
import type { NoteChunkRepository } from "@/domain/repository/NoteChunkRepository";
import type { EmbeddingService } from "@/domain/service/EmbeddingService";
import type { NoteChunkingService } from "@/domain/service/NoteChunkingService";
import { SimilarNoteFinder } from "@/domain/service/SimilarNoteFinder";

function chunk(path: string, content: string): NoteChunk {
    return new NoteChunk(path, path.replace(/\.md$/, ""), content, 0, 1, [1, 0, 0]);
}

describe("SimilarNoteFinder linked-note handling (show-linked-notes-marked spec)", () => {
    it("includes linked notes, flags isLinked, and only excludes the note itself", async () => {
        const activeChunk = chunk("Active.md", "active body");
        let capturedExclude: string[] | undefined;

        const repo: Partial<NoteChunkRepository> = {
            getByPath: vi.fn(async () => [activeChunk]),
            findSimilarChunks: vi.fn(async (_emb, _limit, _min, exclude) => {
                capturedExclude = exclude;
                return [
                    { chunk: chunk("Linked.md", "linked body"), score: 0.9 },
                    { chunk: chunk("Unlinked.md", "unlinked body"), score: 0.7 },
                ];
            }),
        };
        const chunking: Partial<NoteChunkingService> = { split: vi.fn() };
        const embedding: Partial<EmbeddingService> = { embedText: vi.fn() };

        const finder = new SimilarNoteFinder(
            repo as NoteChunkRepository,
            chunking as NoteChunkingService,
            embedding as EmbeddingService
        );

        const note = new Note("Active.md", "Active", "active body", ["Linked.md"]);
        const results = await finder.findSimilarNotes(note, 5);

        // Linked note is no longer filtered out
        const linked = results.find((r) => r.path === "Linked.md");
        const unlinked = results.find((r) => r.path === "Unlinked.md");
        expect(linked).toBeDefined();
        expect(linked?.isLinked).toBe(true);
        expect(unlinked?.isLinked).toBe(false);

        // Only the active note itself is excluded from search
        expect(capturedExclude).toEqual(["Active.md"]);
    });
});
