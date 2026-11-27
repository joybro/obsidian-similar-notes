import { describe, expect, it } from "vitest";
import { SimilarNoteCache, type SimilarNoteCacheEntry } from "../similarNoteResults";

const entry = (mtime: number): SimilarNoteCacheEntry => ({
    mtime,
    notes: [],
    status: "ready" as SimilarNoteCacheEntry["status"],
    partial: false,
});

describe("SimilarNoteCache", () => {
    it("drops the oldest path once more than 20 are held", () => {
        const cache = new SimilarNoteCache();
        for (let i = 0; i < 21; i++) cache.set(`note-${i}.md`, entry(i));

        expect(cache.has("note-0.md")).toBe(false);
        expect(cache.has("note-1.md")).toBe(true);
        expect(cache.has("note-20.md")).toBe(true);
    });

    it("keeps all paths up to the limit", () => {
        const cache = new SimilarNoteCache();
        for (let i = 0; i < 20; i++) cache.set(`note-${i}.md`, entry(i));

        expect(cache.has("note-0.md")).toBe(true);
    });
});
