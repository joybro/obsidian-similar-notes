import "fake-indexeddb/auto";
import { describe, expect, test } from "vitest";
import type { NoteChunkDTO } from "@/domain/model/NoteChunkDTO";
import { OramaWorker } from "../OramaDatabase";

// Title rows (chunkIndex -1, title-vector spec) in the real Orama + IndexedDB
// store: the panel's body-only search, the body-only count, and the backfill
// snapshot taken when the index is loaded from storage.

const row = (
    path: string,
    chunkIndex: number,
    embedding: number[]
): NoteChunkDTO => ({
    path,
    title: path.replace(/\.md$/, ""),
    content: `${path} ${chunkIndex}`,
    chunkIndex,
    totalChunks: 1,
    embedding,
});

describe("OramaWorker title rows", () => {
    test("body-only search skips title rows but still fills the limit; count ignores them; load finds notes without a title row", async () => {
        const vaultId = `title-rows-${Math.random()}`;
        const db = new OramaWorker();
        await db.init(2, vaultId, false);
        await db.putMulti([
            row("a.md", 0, [1, 0]),
            row("a.md", -1, [1, 0.01]),
            row("b.md", 0, [0.9, 0.1]),
            row("b.md", -1, [1, 0.02]),
            row("c.md", 0, [0.8, 0.2]),
            row("legacy.md", 0, [0.7, 0.3]),
        ]);

        const all = await db.findSimilarChunks([1, 0], 3, 0, []);
        expect(all.some((r) => r.chunk.chunkIndex < 0)).toBe(true);

        const bodyOnly = await db.findSimilarChunks([1, 0], 3, 0, [], {
            bodyChunksOnly: true,
        });
        expect(bodyOnly.map((r) => r.chunk.path)).toEqual([
            "a.md",
            "b.md",
            "c.md",
        ]);
        expect(bodyOnly.every((r) => r.chunk.chunkIndex >= 0)).toBe(true);

        expect(await db.count()).toBe(4);

        const reloaded = new OramaWorker();
        await reloaded.init(2, vaultId, true);
        expect(reloaded.getPathsWithoutTitleChunk().sort()).toEqual([
            "c.md",
            "legacy.md",
        ]);
    });
});
