import fs from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { TFile, Vault } from "obsidian";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import type { EmbeddedChunk } from "../embeddedChunkStore";
import { OramaEmbeddedChunkStore } from "../oramaEmbeddedChunkStore";

// Mock Vault with only the methods we need
type MockVault = Pick<
    Vault,
    "create" | "createBinary" | "read" | "getFileByPath"
>;
const mockVault = {
    create: vi.fn(),
    createBinary: vi.fn(),
    read: vi.fn(),
    getFileByPath: vi.fn(),
} as MockVault as Vault;

const vectorSize = 10;

describe("OramaEmbeddedChunkStore", () => {
    let store: OramaEmbeddedChunkStore;
    let testDbPath: string;
    let testChunk1: EmbeddedChunk;
    let testChunk2: EmbeddedChunk;

    // It turned out that orama deletes embeddings of given chunks.
    // So we need to prepare sample chunks before running tests.
    const prepareSampleChunks = () => {
        const sampleChunk1: EmbeddedChunk = {
            id: "test-id-1",
            path: "/test/path/note1.md",
            title: "Test Note 1",
            embedding: Array(vectorSize).fill(0.1), // OpenAI embedding dimension
            lastUpdated: Date.now(),
            content: "This is a test note content",
            chunkIndex: 0,
            totalChunks: 1,
        };

        const sampleChunk2: EmbeddedChunk = {
            ...sampleChunk1,
            id: "test-id-2",
            path: "/test/path/note2.md",
            title: "Test Note 2",
            embedding: Array(vectorSize).fill(0.2),
        };

        testChunk1 = {
            ...sampleChunk1,
            embedding: [...sampleChunk1.embedding],
        };
        testChunk2 = {
            ...sampleChunk2,
            embedding: [...sampleChunk2.embedding],
        };
    };

    beforeEach(async () => {
        testDbPath = path.join(tmpdir(), `test-db-${Date.now()}.json`);
        store = new OramaEmbeddedChunkStore(mockVault, testDbPath, vectorSize);
        await store.init();
        vi.clearAllMocks();
        prepareSampleChunks();
    });

    afterEach(async () => {
        await store.close();
        if (fs.existsSync(testDbPath)) {
            fs.unlinkSync(testDbPath);
        }
    });

    test("should initialize empty store", async () => {
        const chunks = await store.getByPath("*");
        expect(chunks).toHaveLength(0);
    });

    test("should add and retrieve a chunk", async () => {
        await store.add(testChunk1);
        const chunks = await store.getByPath(testChunk1.path);
        expect(chunks).toHaveLength(1);
        expect(chunks[0]).toEqual(testChunk1);
    });

    test("should add multiple chunks", async () => {
        await store.addMulti([testChunk1, testChunk2]);
        const chunks1 = await store.getByPath(testChunk1.path);
        const chunks2 = await store.getByPath(testChunk2.path);
        expect(chunks1).toHaveLength(1);
        expect(chunks2).toHaveLength(1);
        expect(chunks1[0]).toEqual(testChunk1);
        expect(chunks2[0]).toEqual(testChunk2);
    });

    test("should get chunks by path", async () => {
        await store.addMulti([testChunk1, testChunk2]);
        const chunks = await store.getByPath(testChunk1.path);
        expect(chunks).toHaveLength(1);
        expect(chunks[0]).toEqual(testChunk1);
    });

    test("should remove chunk by path", async () => {
        await store.addMulti([testChunk1, testChunk2]);
        await store.removeByPath(testChunk1.path);
        const chunks1 = await store.getByPath(testChunk1.path);
        const chunks2 = await store.getByPath(testChunk2.path);
        expect(chunks1).toHaveLength(0);
        expect(chunks2).toHaveLength(1);
        expect(chunks2[0]).toEqual(testChunk2);
    });

    test("should remove chunk by id", async () => {
        await store.addMulti([testChunk1, testChunk2]);
        await store.removeById(testChunk1.id);
        const chunks1 = await store.getByPath(testChunk1.path);
        const chunks2 = await store.getByPath(testChunk2.path);
        expect(chunks1).toHaveLength(0);
        expect(chunks2).toHaveLength(1);
        expect(chunks2[0]).toEqual(testChunk2);
    });

    test("should search similar chunks", async () => {
        await store.addMulti([testChunk1, testChunk2]);
        const results = await store.searchSimilar(testChunk1.embedding, 10);
        expect(results).toHaveLength(2);
        expect(results[0].chunk).toBeDefined();
        expect(results[0].score).toBeDefined();
        // First result should be testChunk1 (most similar to its own embedding)
        expect(results[0].chunk).toEqual(testChunk1);
    });

    test("should exclude paths in similar search", async () => {
        await store.addMulti([testChunk1, testChunk2]);
        // store.add(testChunk1);
        const results = await store.searchSimilar(
            testChunk1.embedding,
            10,
            undefined,
            [testChunk1.path]
        );
        expect(results).toHaveLength(1);
        expect(results[0].chunk).toEqual(testChunk2);
    });

    test("should persist and load data", async () => {
        await store.add(testChunk1);

        // Mock the file content for loading
        const mockFileContent = JSON.stringify({ some: "data" });
        (mockVault.getFileByPath as ReturnType<typeof vi.fn>).mockReturnValue({
            path: testDbPath,
        } as TFile);
        (mockVault.read as ReturnType<typeof vi.fn>).mockResolvedValue(
            mockFileContent
        );

        await store.save();

        // Create new store instance and load data
        const newStore = new OramaEmbeddedChunkStore(
            mockVault,
            testDbPath,
            vectorSize
        );
        await newStore.load();

        // Verify that the mock functions were called
        expect(mockVault.getFileByPath).toHaveBeenCalledWith(testDbPath);
        expect(mockVault.read).toHaveBeenCalled();

        await newStore.close();
    });

    test("should clear all data", async () => {
        await store.addMulti([testChunk1, testChunk2]);
        await store.clear();
        const chunks = await store.getByPath("*");
        expect(chunks).toHaveLength(0);
    });

    describe("change tracking", () => {
        test("should not save when no changes are made", async () => {
            await store.save();
            expect(mockVault.create).not.toHaveBeenCalled();
            expect(mockVault.createBinary).not.toHaveBeenCalled();
        });

        test("should save when changes are made", async () => {
            await store.add(testChunk1);
            await store.save();
            expect(mockVault.create).toHaveBeenCalledTimes(1);
        });

        test("should not save again after saving changes", async () => {
            await store.add(testChunk1);
            await store.save();
            vi.clearAllMocks();
            await store.save();
            expect(mockVault.create).not.toHaveBeenCalled();
            expect(mockVault.createBinary).not.toHaveBeenCalled();
        });

        test("should track changes for all modification operations", async () => {
            // Test add
            await store.add(testChunk1);
            await store.save();
            expect(mockVault.create).toHaveBeenCalledTimes(1);
            vi.clearAllMocks();

            // Test addMulti
            await store.addMulti([testChunk2]);
            await store.save();
            expect(mockVault.create).toHaveBeenCalledTimes(1);
            vi.clearAllMocks();

            // Test removeByPath
            await store.removeByPath(testChunk1.path);
            await store.save();
            expect(mockVault.create).toHaveBeenCalledTimes(1);
            vi.clearAllMocks();

            // Test removeById
            await store.removeById(testChunk2.id);
            await store.save();
            expect(mockVault.create).toHaveBeenCalledTimes(1);
            vi.clearAllMocks();

            // Test clear
            await store.clear();
            await store.save();
            expect(mockVault.create).toHaveBeenCalledTimes(1);
        });

        test("should reset changes flag after loading", async () => {
            await store.add(testChunk1);

            // Mock the file content for loading
            const mockFileContent = JSON.stringify({ some: "data" });
            (
                mockVault.getFileByPath as ReturnType<typeof vi.fn>
            ).mockReturnValue({
                path: testDbPath,
            } as TFile);
            (mockVault.read as ReturnType<typeof vi.fn>).mockResolvedValue(
                mockFileContent
            );

            await store.load();
            vi.clearAllMocks();
            await store.save();
            expect(mockVault.create).not.toHaveBeenCalled();
            expect(mockVault.createBinary).not.toHaveBeenCalled();
        });
    });
});
