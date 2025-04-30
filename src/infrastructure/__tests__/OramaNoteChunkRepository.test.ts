import { NoteChunk } from "@/domain/model/NoteChunk";
import type { NoteChunkDTO } from "@/domain/model/NoteChunkDTO";
import { persist, restore } from "@orama/plugin-data-persistence";
import type { Vault } from "obsidian";
import { type Mock, beforeEach, describe, expect, test, vi } from "vitest";
import { OramaNoteChunkRepository } from "../OramaNoteChunkRepository";

vi.mock("@orama/plugin-data-persistence", () => ({
    restore: vi.fn(),
    persist: vi.fn(),
}));

const mockAdapter = {
    exists: vi.fn(),
    read: vi.fn(),
    write: vi.fn(),
    writeBinary: vi.fn(),
};

const mockVault = {
    adapter: mockAdapter,
} as unknown as Vault;

const vectorSize = 10;

// Mock Orama DB instance
const createMockDb = () => ({
    index: {
        indexes: {},
    },
    vectorIndexes: {
        embedding: {
            size: vectorSize,
            vectors: [],
        },
    },
    docs: {
        docs: {},
        count: 0,
    },
    searchableProperties: [],
    searchablePropertiesWithTypes: {},
    frequencies: {},
    tokenOccurrences: {},
    avgFieldLength: {},
    fieldLengths: {},
    sorting: {
        language: "english",
        sortableProperties: [],
        sortablePropertiesWithTypes: {},
        sorts: {},
        enabled: true,
        isSorted: true,
    },
    language: "english",
});

describe("OramaNoteChunkRepository", () => {
    let repository: OramaNoteChunkRepository;
    let testDbPath: string;
    let testChunk1: NoteChunk;
    let testChunk2: NoteChunk;

    // Prepare sample chunks before running tests
    const prepareSampleChunks = () => {
        const sampleChunk1: NoteChunkDTO = {
            path: "/test/path/note1.md",
            title: "Test Note 1",
            embedding: Array(vectorSize).fill(0.1), // OpenAI embedding dimension
            content: "This is a test note content",
            chunkIndex: 0,
            totalChunks: 1,
        };

        const sampleChunk2: NoteChunkDTO = {
            ...sampleChunk1,
            path: "/test/path/note2.md",
            title: "Test Note 2",
            embedding: Array(vectorSize).fill(0.2),
        };

        testChunk1 = NoteChunk.fromDTO(sampleChunk1);
        testChunk2 = NoteChunk.fromDTO(sampleChunk2);
    };

    beforeEach(async () => {
        testDbPath = `test-db-path-${Date.now()}`;
        repository = new OramaNoteChunkRepository(
            mockVault,
            vectorSize,
            testDbPath
        );
        await repository.init();
        vi.clearAllMocks();
        prepareSampleChunks();
    });

    test("should initialize empty repository", () => {
        expect(repository.count()).toBe(0);
    });

    test("should save and retrieve a chunk", async () => {
        await repository.put(testChunk1);
        const results = await repository.findSimilarChunks(
            testChunk1.embedding,
            10
        );
        expect(results).toHaveLength(1);
        expect(results[0][0].toDTO()).toEqual({
            ...testChunk1.toDTO(),
            embedding: null,
        });
        expect(repository.count()).toBe(1);
    });
    test("should save multiple chunks", async () => {
        await repository.putMulti([testChunk1, testChunk2]);
        const results = await repository.findSimilarChunks(
            testChunk1.embedding,
            10
        );
        expect(results).toHaveLength(2);
        expect(
            results.filter(([chunk]) => chunk.path === testChunk1.path)
        ).toHaveLength(1);
        expect(
            results.filter(([chunk]) => chunk.path === testChunk2.path)
        ).toHaveLength(1);
    });

    test("should delete chunks by path", async () => {
        await repository.putMulti([testChunk1, testChunk2]);
        await repository.removeByPath(testChunk1.path);
        const results1 = await repository.findSimilarChunks(
            testChunk1.embedding,
            10
        );
        const results2 = await repository.findSimilarChunks(
            testChunk2.embedding,
            10
        );
        expect(
            results1.filter(([chunk]) => chunk.path === testChunk1.path)
        ).toHaveLength(0);
        expect(
            results2.filter(([chunk]) => chunk.path === testChunk2.path)
        ).toHaveLength(1);
    });

    test("should exclude paths in similar search", async () => {
        await repository.putMulti([testChunk1, testChunk2]);
        const results = await repository.findSimilarChunks(
            testChunk1.embedding,
            10,
            undefined,
            [testChunk1.path]
        );
        expect(results).toHaveLength(1);
        expect(results[0][0].toDTO()).toEqual({
            ...testChunk2.toDTO(),
            embedding: null,
        });
    });

    test("should persist and load data", async () => {
        await repository.put(testChunk1);

        // Mock the file content for loading
        const mockFileContent = JSON.stringify({ some: "data" });
        mockAdapter.exists.mockResolvedValue(true);
        mockAdapter.read.mockResolvedValue(mockFileContent);
        (restore as Mock).mockResolvedValue(createMockDb());
        (persist as Mock).mockResolvedValue(mockFileContent);

        // Create new repository instance and load data
        const newRepository = new OramaNoteChunkRepository(
            mockVault,
            vectorSize,
            testDbPath
        );
        await newRepository.restore();

        // Verify that the mock functions were called
        expect(mockAdapter.exists).toHaveBeenCalledWith(testDbPath);
        expect(mockAdapter.read).toHaveBeenCalledWith(testDbPath);
        expect(restore).toHaveBeenCalledWith("json", mockFileContent);
    });

    describe("change tracking", () => {
        test("should not save when no changes are made", async () => {
            await repository.persist();
            expect(mockAdapter.write).not.toHaveBeenCalled();
            expect(mockAdapter.writeBinary).not.toHaveBeenCalled();
        });

        test("should save when changes are made", async () => {
            const mockFileContent = JSON.stringify({ some: "data" });
            (persist as Mock).mockResolvedValue(mockFileContent);
            mockAdapter.exists.mockResolvedValue(false);

            await repository.put(testChunk1);
            await repository.persist();
            expect(mockAdapter.write).toHaveBeenCalledTimes(1);
        });

        test("should write when file exists", async () => {
            const mockFileContent = JSON.stringify({ some: "data" });
            (persist as Mock).mockResolvedValue(mockFileContent);
            mockAdapter.exists.mockResolvedValue(true);

            await repository.put(testChunk1);
            await repository.persist();
            expect(mockAdapter.write).toHaveBeenCalledTimes(1);
        });

        test("should not save again after saving changes", async () => {
            const mockFileContent = JSON.stringify({ some: "data" });
            (persist as Mock).mockResolvedValue(mockFileContent);

            await repository.put(testChunk1);
            await repository.persist();
            vi.clearAllMocks();
            await repository.persist();
            expect(mockAdapter.write).not.toHaveBeenCalled();
            expect(mockAdapter.writeBinary).not.toHaveBeenCalled();
        });

        test("should track changes for all modification operations", async () => {
            const mockFileContent = JSON.stringify({ some: "data" });
            (persist as Mock).mockResolvedValue(mockFileContent);
            mockAdapter.exists.mockResolvedValue(false);

            // Test save
            await repository.put(testChunk1);
            await repository.persist();
            expect(mockAdapter.write).toHaveBeenCalledTimes(1);
            vi.clearAllMocks();

            // Test saveMulti
            await repository.putMulti([testChunk2]);
            await repository.persist();
            expect(mockAdapter.write).toHaveBeenCalledTimes(1);
            vi.clearAllMocks();

            // Test deleteByPath
            await repository.removeByPath(testChunk1.path);
            await repository.persist();
            expect(mockAdapter.write).toHaveBeenCalledTimes(1);
        });

        test("should reset changes flag after loading", async () => {
            await repository.put(testChunk1);

            // Mock the file content for loading
            mockAdapter.exists.mockResolvedValue(true);
            mockAdapter.read.mockResolvedValue(
                JSON.stringify({ some: "data" })
            );

            await repository.restore();
            vi.clearAllMocks();
            await repository.persist();
            expect(mockAdapter.write).not.toHaveBeenCalled();
            expect(mockAdapter.writeBinary).not.toHaveBeenCalled();
        });
    });
});
