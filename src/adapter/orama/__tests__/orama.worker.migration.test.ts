import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "fake-indexeddb/auto";
import type { DataAdapter } from "obsidian";

// Mock Comlink since it doesn't work well in tests
vi.mock("comlink", () => ({
    expose: vi.fn(),
    proxy: vi.fn((x) => x),
}));

// Import after mocking - use dynamic import in each test instead of top-level await
import { OramaWorker } from "../orama.worker";

describe.sequential("Orama Worker - JSON to IndexedDB Migration", () => {
    let worker: InstanceType<typeof OramaWorker>;
    let mockAdapter: DataAdapter;

    beforeEach(() => {
        // Create mock adapter
        mockAdapter = {
            exists: vi.fn(),
            read: vi.fn(),
            rename: vi.fn(),
            write: vi.fn(),
            writeBinary: vi.fn(),
            remove: vi.fn(),
            mkdir: vi.fn(),
            list: vi.fn(),
            rmdir: vi.fn(),
            stat: vi.fn(),
            getName: vi.fn(),
            getResourcePath: vi.fn(),
            append: vi.fn(),
            process: vi.fn(),
            getBasePath: vi.fn(),
            copy: vi.fn(),
            trashSystem: vi.fn(),
            trashLocal: vi.fn(),
            getUrl: vi.fn(),
        } as unknown as DataAdapter;
    });

    beforeEach(() => {
        worker = new OramaWorker();
    });

    afterEach(() => {
        // Clean up IndexedDB - this is async but we don't wait
        const deleteRequest = indexedDB.deleteDatabase("similar-notes-chunks");
        deleteRequest.onsuccess = () => {
            // Database deleted
        };
    });

    it("should migrate existing JSON database to IndexedDB", async () => {
        const mockOramaJSON = {
            docs: Array.from({ length: 10 }, (_, i) => ({
                path: `test-${i}.md`,
                pathHash: `hash-${i}`,
                title: `Note ${i}`,
                content: `Content ${i}`,
                chunkIndex: 0,
                totalChunks: 1,
                embedding: new Array(384).fill(0.1),
                lastUpdated: Date.now(),
            })),
        };

        (mockAdapter.exists as any).mockResolvedValue(true);
        (mockAdapter.read as any).mockResolvedValue(
            JSON.stringify(mockOramaJSON)
        );
        (mockAdapter.rename as any).mockResolvedValue(undefined);

        await worker.init(mockAdapter, 384, "test.json", true);

        const count = await worker.count();
        expect(count).toBe(10);

        // Verify backup was created
        expect(mockAdapter.rename).toHaveBeenCalledWith(
            "test.json",
            expect.stringContaining(".backup-")
        );
    }, 10000);

    it("should not migrate when JSON does not exist", async () => {
        (mockAdapter.exists as any).mockResolvedValue(false);

        await worker.init(mockAdapter, 384, "test.json", true);

        expect(mockAdapter.read).not.toHaveBeenCalled();
        expect(await worker.count()).toBe(0);
    });

    it("should save to both Orama and IndexedDB", async () => {
        // Initialize without migration
        (mockAdapter.exists as any).mockResolvedValue(false);
        await worker.init(mockAdapter, 384, "test.json", true);

        // Add a chunk
        await worker.put({
            path: "new.md",
            title: "New Note",
            content: "New content",
            chunkIndex: 0,
            totalChunks: 1,
            embedding: new Array(384).fill(0.2),
        });

        // Should be in Orama
        expect(await worker.count()).toBe(1);

        // Reinitialize to verify it was persisted to IndexedDB
        const worker2 = new OramaWorker();
        await worker2.init(mockAdapter, 384, "test.json", true);

        expect(await worker2.count()).toBe(1);
    }, 10000);

    it("should remove from both Orama and IndexedDB", async () => {
        (mockAdapter.exists as any).mockResolvedValue(false);
        await worker.init(mockAdapter, 384, "test.json", true);

        await worker.putMulti([
            {
                path: "test.md",
                title: "Test",
                content: "Content 1",
                chunkIndex: 0,
                totalChunks: 2,
                embedding: new Array(384).fill(0.1),
            },
            {
                path: "test.md",
                title: "Test",
                content: "Content 2",
                chunkIndex: 1,
                totalChunks: 2,
                embedding: new Array(384).fill(0.1),
            },
            {
                path: "other.md",
                title: "Other",
                content: "Content",
                chunkIndex: 0,
                totalChunks: 1,
                embedding: new Array(384).fill(0.1),
            },
        ]);

        expect(await worker.count()).toBe(3);

        const removed = await worker.removeByPath("test.md");
        expect(removed).toBe(true);
        expect(await worker.count()).toBe(1);

        // Reinitialize to verify removal was persisted
        const worker2 = new OramaWorker();
        await worker2.init(mockAdapter, 384, "test.json", true);

        expect(await worker2.count()).toBe(1);
    }, 10000);

    it("persist() should be a no-op", async () => {
        (mockAdapter.exists as any).mockResolvedValue(false);
        await worker.init(mockAdapter, 384, "test.json", true);

        // persist should not throw and should not write anything
        await worker.persist();

        expect(mockAdapter.write).not.toHaveBeenCalled();
        expect(mockAdapter.writeBinary).not.toHaveBeenCalled();
    });
});
