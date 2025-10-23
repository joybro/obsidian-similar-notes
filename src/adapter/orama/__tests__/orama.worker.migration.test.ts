import { beforeEach, describe, expect, it, vi } from "vitest";
import "fake-indexeddb/auto";
import type { DataAdapter } from "obsidian";

// Mock Comlink since it doesn't work well in tests
vi.mock("comlink", () => ({
    expose: vi.fn(),
    proxy: vi.fn((x) => x),
}));

// Import after mocking
const { OramaWorker } = require("../orama.worker");

/**
 * Migration test for JSON to IndexedDB
 *
 * Note: We only test the core migration functionality here due to
 * fake-indexeddb limitations with async cleanup and shared global state.
 * Other scenarios (dual storage, removal, etc.) are covered by:
 * - IndexedDBChunkStorage unit tests (19 tests, all passing)
 * - Manual testing in actual Obsidian environment
 */
describe("Orama Worker - JSON to IndexedDB Migration", () => {
    let worker: InstanceType<typeof OramaWorker>;
    let mockAdapter: DataAdapter;

    beforeEach(() => {
        worker = new OramaWorker();

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
});
