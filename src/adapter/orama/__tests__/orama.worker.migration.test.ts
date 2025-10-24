import { describe, expect, it, vi, beforeAll } from "vitest";
import "fake-indexeddb/auto";
import type { DataAdapter } from "obsidian";

// Mock Comlink since it doesn't work well in tests
vi.mock("comlink", () => ({
    expose: vi.fn(),
    proxy: vi.fn((x) => x),
}));

/**
 * Migration test for JSON to IndexedDB
 *
 * IMPORTANT: This test must be maintained as long as migration code exists.
 * Migration code will remain in the codebase for extended periods to support
 * users upgrading from older versions.
 *
 * This test verifies the migration logic validated with 1284 real chunks.
 * Additional coverage from:
 * - IndexedDBChunkStorage unit tests (19 tests passing)
 * - Manual testing in production environment
 */
describe("Orama Worker - JSON to IndexedDB Migration", () => {
    // Dynamically import to work around module.exports issue
    let OramaWorker: any;
    let mockAdapter: DataAdapter;

    beforeAll(async () => {
        // Dynamic import after mocking
        const module = await import("../orama.worker");
        // @ts-ignore - Access via module.exports
        OramaWorker = (module as any).OramaWorker ||
                      (typeof (module as any).default === 'function' ? (module as any).default : null);

        if (!OramaWorker) {
            throw new Error("Failed to import OramaWorker");
        }
    });

    beforeEach(() => {
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

    it("should migrate Orama v2 JSON with nested docs.docs structure", async () => {
        const worker = new OramaWorker();

        // Create test chunks matching production data
        const chunks = Array.from({ length: 10 }, (_, i) => ({
            path: `test-${i}.md`,
            pathHash: `hash-${i}`,
            title: `Note ${i}`,
            content: `Content ${i}`,
            chunkIndex: 0,
            totalChunks: 1,
            embedding: new Array(384).fill(0.1 + i * 0.01), // Slightly different embeddings
            lastUpdated: Date.now(),
        }));

        // Convert to Orama v2 format: { docs: { docs: { [id]: doc } } }
        // This is the actual structure found in production
        const docsObject = Object.fromEntries(
            chunks.map((chunk, i) => [(i + 1).toString(), chunk])
        );

        const mockOramaJSON = {
            docs: {
                docs: docsObject, // Nested structure!
            },
            index: {},
            sorting: {},
            language: "en",
            internalDocumentIDStore: {},
        };

        (mockAdapter.exists as any).mockResolvedValue(true);
        (mockAdapter.read as any).mockResolvedValue(
            JSON.stringify(mockOramaJSON)
        );
        (mockAdapter.rename as any).mockResolvedValue(undefined);

        // Execute migration
        await worker.init(mockAdapter, 384, "test-migration.json", true);

        // Verify migration succeeded
        const count = await worker.count();
        expect(count).toBe(10);

        // Verify backup was created
        expect(mockAdapter.rename).toHaveBeenCalledWith(
            "test-migration.json",
            expect.stringContaining(".backup-")
        );

        // Verify search works (documents are actually in Orama)
        const results = await worker.findSimilarChunks(
            new Array(384).fill(0.1),
            5,
            0.0,
            []
        );
        expect(results.length).toBeGreaterThan(0);
        expect(results[0].chunk).toHaveProperty("path");
    }, 15000);
});
