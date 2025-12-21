import { afterEach, beforeEach, describe, expect, it } from "vitest";
import "fake-indexeddb/auto";
import {
    IndexedDBChunkStorage,
    type NoteChunkInternal,
} from "../IndexedDBChunkStorage";

// Helper function to create mock chunks
function createMockChunk(
    overrides?: Partial<NoteChunkInternal>
): NoteChunkInternal {
    return {
        path: "default.md",
        pathHash: "hash123",
        title: "Default Note",
        content: "Default content",
        chunkIndex: 0,
        totalChunks: 1,
        embedding: new Array(384).fill(0.1),
        lastUpdated: Date.now(),
        ...overrides,
    };
}

function describeInitialization(storage: () => IndexedDBChunkStorage) {
    describe("Initialization", () => {
        it("should initialize database successfully", async () => {
            expect(storage()).toBeDefined();
            const count = await storage().count();
            expect(count).toBe(0);
        });

        it("should throw error when using storage before init", async () => {
            const uninitializedStorage = new IndexedDBChunkStorage();

            await expect(uninitializedStorage.count()).rejects.toThrow(
                "IndexedDB not initialized"
            );
        });
    });
}

function describeBasicCRUD(storage: () => IndexedDBChunkStorage) {
    describe("Basic CRUD Operations", () => {
        it("should store and count a single chunk", async () => {
            const chunk = createMockChunk({
                path: "test.md",
                content: "Test content",
            });

            await storage().put(chunk);

            const count = await storage().count();
            expect(count).toBe(1);
        });

        it("should store multiple chunks in batch", async () => {
            const chunks = Array.from({ length: 100 }, (_, i) =>
                createMockChunk({ path: `test-${i}.md` })
            );

            await storage().putMulti(chunks);

            const count = await storage().count();
            expect(count).toBe(100);
        });

        it("should handle empty putMulti", async () => {
            await storage().putMulti([]);

            const count = await storage().count();
            expect(count).toBe(0);
        });

        it("should remove chunks by path", async () => {
            const chunks = [
                createMockChunk({ path: "test.md", chunkIndex: 0 }),
                createMockChunk({ path: "test.md", chunkIndex: 1 }),
                createMockChunk({ path: "other.md", chunkIndex: 0 }),
            ];

            await storage().putMulti(chunks);
            const removed = await storage().removeByPath("test.md");

            expect(removed).toBe(2);
            expect(await storage().count()).toBe(1);
        });

        it("should return 0 when removing non-existent path", async () => {
            const removed = await storage().removeByPath("non-existent.md");
            expect(removed).toBe(0);
        });

        it("should clear all chunks", async () => {
            const chunks = Array.from({ length: 50 }, (_, i) =>
                createMockChunk({ path: `test-${i}.md` })
            );

            await storage().putMulti(chunks);
            await storage().clear();

            expect(await storage().count()).toBe(0);
        });
    });
}

function describeBatchLoading(storage: () => IndexedDBChunkStorage) {
    describe("Batch Loading", () => {
        it("should load chunks in batches", async () => {
            const totalChunks = 250;
            const chunks = Array.from({ length: totalChunks }, (_, i) =>
                createMockChunk({ path: `test-${i}.md` })
            );

            await storage().putMulti(chunks);

            const loadedBatches: NoteChunkInternal[][] = [];
            await storage().loadInBatches(100, async (batch) => {
                loadedBatches.push([...batch]);
            });

            expect(loadedBatches.length).toBe(3); // 100, 100, 50
            expect(loadedBatches[0].length).toBe(100);
            expect(loadedBatches[1].length).toBe(100);
            expect(loadedBatches[2].length).toBe(50);

            const totalLoaded = loadedBatches.flat().length;
            expect(totalLoaded).toBe(totalChunks);
        });

        it("should handle empty database in batch loading", async () => {
            const batches: NoteChunkInternal[][] = [];
            await storage().loadInBatches(100, async (batch) => {
                batches.push(batch);
            });

            expect(batches.length).toBe(0);
        });

        it("should report progress during batch loading", async () => {
            const chunks = Array.from({ length: 300 }, (_, i) =>
                createMockChunk({ path: `test-${i}.md` })
            );

            await storage().putMulti(chunks);

            const progressReports: Array<{
                processed: number;
                total: number;
            }> = [];

            await storage().loadInBatches(
                100,
                async () => {
                    // Process batch
                },
                (processed, total) => {
                    progressReports.push({ processed, total });
                }
            );

            expect(progressReports.length).toBe(3);
            expect(progressReports[0]).toEqual({ processed: 100, total: 300 });
            expect(progressReports[1]).toEqual({ processed: 200, total: 300 });
            expect(progressReports[2]).toEqual({ processed: 300, total: 300 });
        });

        it("should load all chunks correctly", async () => {
            const originalChunks = Array.from({ length: 150 }, (_, i) =>
                createMockChunk({
                    path: `test-${i}.md`,
                    content: `Content ${i}`,
                })
            );

            await storage().putMulti(originalChunks);

            const loaded: NoteChunkInternal[] = [];
            await storage().loadInBatches(50, async (batch) => {
                loaded.push(...batch);
            });

            expect(loaded.length).toBe(150);

            // Verify content is preserved (order may differ)
            const loadedPaths = loaded.map((c) => c.path).sort();
            const originalPaths = originalChunks.map((c) => c.path).sort();
            expect(loadedPaths).toEqual(originalPaths);
        });
    });
}

function describeMetadataStore(storage: () => IndexedDBChunkStorage) {
    describe("Metadata Store", () => {
        it("should default migration flag to false", async () => {
            expect(await storage().getMigrationFlag()).toBe(false);
        });

        it("should store and retrieve migration flag", async () => {
            await storage().setMigrationFlag(true);
            expect(await storage().getMigrationFlag()).toBe(true);

            await storage().setMigrationFlag(false);
            expect(await storage().getMigrationFlag()).toBe(false);
        });
    });
}

function describeLargeDataset(storage: () => IndexedDBChunkStorage) {
    describe("Large Dataset Handling", () => {
        it("should handle 1000 chunks without issues", async () => {
            const chunks = Array.from({ length: 1000 }, (_, i) =>
                createMockChunk({ path: `test-${i}.md` })
            );

            await storage().putMulti(chunks);

            expect(await storage().count()).toBe(1000);

            const loaded: NoteChunkInternal[] = [];
            await storage().loadInBatches(100, async (batch) => {
                loaded.push(...batch);
            });

            expect(loaded.length).toBe(1000);
        });

        it("should handle large embedding vectors (768 dimensions)", async () => {
            const chunk = createMockChunk({
                path: "test.md",
                embedding: new Array(768).fill(0.5),
            });

            await storage().put(chunk);

            const loaded: NoteChunkInternal[] = [];
            await storage().loadInBatches(1, async (batch) => {
                loaded.push(...batch);
            });

            expect(loaded[0].embedding.length).toBe(768);
            expect(loaded[0].embedding[0]).toBe(0.5);
        });
    });
}

function describeErrorHandling(storage: () => IndexedDBChunkStorage) {
    describe("Error Handling", () => {
        it("should handle database close gracefully", async () => {
            await storage().close();

            // Operations after close should fail
            await expect(storage().count()).rejects.toThrow();
        });

        it("should handle concurrent writes", async () => {
            const chunks1 = Array.from({ length: 50 }, (_, i) =>
                createMockChunk({ path: `test-a-${i}.md` })
            );
            const chunks2 = Array.from({ length: 50 }, (_, i) =>
                createMockChunk({ path: `test-b-${i}.md` })
            );

            await Promise.all([
                storage().putMulti(chunks1),
                storage().putMulti(chunks2),
            ]);

            expect(await storage().count()).toBe(100);
        });
    });
}

function describePathIndex(storage: () => IndexedDBChunkStorage) {
    describe("Path Index", () => {
        it("should efficiently query by path using index", async () => {
            const chunks = [
                ...Array.from({ length: 5 }, (_, i) =>
                    createMockChunk({ path: "note-a.md", chunkIndex: i })
                ),
                ...Array.from({ length: 3 }, (_, i) =>
                    createMockChunk({ path: "note-b.md", chunkIndex: i })
                ),
                ...Array.from({ length: 10 }, (_, i) =>
                    createMockChunk({ path: "note-c.md", chunkIndex: i })
                ),
            ];

            await storage().putMulti(chunks);

            const removedA = await storage().removeByPath("note-a.md");
            expect(removedA).toBe(5);
            expect(await storage().count()).toBe(13);

            const removedC = await storage().removeByPath("note-c.md");
            expect(removedC).toBe(10);
            expect(await storage().count()).toBe(3);
        });
    });
}

describe("IndexedDBChunkStorage", () => {
    let storage: IndexedDBChunkStorage;

    beforeEach(async () => {
        storage = new IndexedDBChunkStorage();
        await storage.init("test-vault-id");
    });

    afterEach(async () => {
        await storage.close();
        // Clean up IndexedDB
        indexedDB.deleteDatabase("test-vault-id-similar-notes");
    });

    const getStorage = () => storage;

    describeInitialization(getStorage);
    describeBasicCRUD(getStorage);
    describeBatchLoading(getStorage);
    describeMetadataStore(getStorage);
    describeLargeDataset(getStorage);
    describeErrorHandling(getStorage);
    describePathIndex(getStorage);
});
