import type { TFile, Vault } from "obsidian";
import { beforeEach, describe, expect, test, vi } from "vitest";
import {
    type FileChangeQueueState,
    type FileHashStore,
    calculateFileHash,
    cleanupFileChangeQueue,
    createFileChangeQueue,
    enqueueAllFiles,
    getFileChangeCount,
    initializeFileChangeQueue,
    pollFileChanges,
} from "../obsidianFileChageQueue";

// Mock Vault with only the methods we need
type MockVault = Pick<Vault, "getMarkdownFiles" | "read" | "on">;

describe("FileChangeQueue", () => {
    let mockVault: MockVault;
    let mockHashStore: FileHashStore;
    let queueState: FileChangeQueueState;

    const testFile1 = { path: "file1.md", extension: "md" } as TFile;
    const testFile2 = { path: "file2.md", extension: "md" } as TFile;
    const testFile3 = { path: "file3.md", extension: "md" } as TFile;
    const nonMarkdownFile = { path: "image.png", extension: "png" } as TFile;

    beforeEach(() => {
        // Reset mocks
        mockVault = {
            getMarkdownFiles: vi.fn().mockReturnValue([testFile1, testFile2]),
            read: vi.fn().mockImplementation(async (file: TFile) => {
                if (file.path === "file1.md") return "content1";
                if (file.path === "file2.md") return "content2";
                return "";
            }),
            on: vi.fn().mockImplementation((event, callback) => {
                // Return a function that can be called to unregister the event
                return () => {};
            }),
        };

        // Create properly typed mock functions
        const mockLoad = vi.fn().mockResolvedValue({});
        const mockSave = vi.fn().mockResolvedValue(undefined);

        mockHashStore = {
            load: mockLoad,
            save: mockSave,
        };

        // Create a new queue state
        queueState = createFileChangeQueue({
            vault: mockVault as unknown as Vault,
            hashStore: mockHashStore,
            hashFunc: (content: string) => Promise.resolve(content),
        });
    });

    test("should create a new queue state", () => {
        expect(queueState.queue).toHaveLength(0);
        expect(queueState.fileHashes).toEqual({});
        expect(queueState.options.vault).toBe(mockVault);
        expect(queueState.options.hashStore).toBe(mockHashStore);
        expect(queueState.eventRefs).toHaveLength(0);
    });

    test("should initialize queue with new files", async () => {
        // Mock previous hashes (empty, so all files are new)
        (mockHashStore.load as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
            {}
        );

        const newState = await initializeFileChangeQueue(queueState);

        // Should have 2 new files in the queue
        expect(newState.queue).toHaveLength(2);
        expect(newState.queue[0].path).toBe("file1.md");
        expect(newState.queue[0].reason).toBe("new");
        expect(newState.queue[1].path).toBe("file2.md");
        expect(newState.queue[1].reason).toBe("new");

        // Should have saved the new hashes
        expect(mockHashStore.save).toHaveBeenCalled();

        // Should have registered event callbacks
        expect(mockVault.on).toHaveBeenCalledTimes(3);
        expect(mockVault.on).toHaveBeenCalledWith(
            "create",
            expect.any(Function)
        );
        expect(mockVault.on).toHaveBeenCalledWith(
            "modify",
            expect.any(Function)
        );
        expect(mockVault.on).toHaveBeenCalledWith(
            "delete",
            expect.any(Function)
        );
    });

    test("should detect modified files", async () => {
        // Mock previous hashes with different content
        (mockHashStore.load as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
            "file1.md": "oldhash1",
            "file2.md": "oldhash2",
        });

        const newState = await initializeFileChangeQueue(queueState);

        // Should have 2 modified files in the queue
        expect(newState.queue).toHaveLength(2);
        expect(newState.queue[0].path).toBe("file1.md");
        expect(newState.queue[0].reason).toBe("modified");
        expect(newState.queue[1].path).toBe("file2.md");
        expect(newState.queue[1].reason).toBe("modified");
    });

    test("should detect deleted files", async () => {
        // Mock previous hashes with a file that no longer exists
        (mockHashStore.load as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
            "file1.md": "content1",
            "file2.md": "content2",
            "deleted.md": "content3",
        });

        const newState = await initializeFileChangeQueue(queueState);

        // Should have 1 deleted file in the queue
        expect(newState.queue).toHaveLength(1);
        expect(newState.queue[0].path).toBe("deleted.md");
        expect(newState.queue[0].reason).toBe("deleted");
    });

    test("should enqueue all files", async () => {
        const newState = await enqueueAllFiles(queueState);

        // Should have all files in the queue
        expect(newState.queue).toHaveLength(2);
        expect(newState.queue[0].path).toBe("file1.md");
        expect(newState.queue[0].reason).toBe("modified");
        expect(newState.queue[1].path).toBe("file2.md");
        expect(newState.queue[1].reason).toBe("modified");
    });

    test("should poll changes from the queue", () => {
        // Add some changes to the queue
        queueState.queue = [
            { path: "file1.md", reason: "new" },
            { path: "file2.md", reason: "modified" },
            { path: "file3.md", reason: "deleted" },
        ];

        // Poll 2 changes
        const { state, changes } = pollFileChanges(queueState, 2);

        // Should have 2 changes
        expect(changes).toHaveLength(2);
        expect(changes[0].path).toBe("file1.md");
        expect(changes[1].path).toBe("file2.md");

        // Queue should have 1 change left
        expect(state.queue).toHaveLength(1);
        expect(state.queue[0].path).toBe("file3.md");
    });

    test("should get the count of changes in the queue", () => {
        // Add some changes to the queue
        queueState.queue = [
            { path: "file1.md", reason: "new" },
            { path: "file2.md", reason: "modified" },
            { path: "file3.md", reason: "deleted" },
        ];

        const count = getFileChangeCount(queueState);

        // Should have 3 changes
        expect(count).toBe(3);
    });

    describe("file change event callbacks", () => {
        let createCallback: (file: TFile) => Promise<void>;
        let modifyCallback: (file: TFile) => Promise<void>;
        let deleteCallback: (file: TFile) => Promise<void>;

        beforeEach(async () => {
            // Capture the callbacks when they're registered
            (mockVault.on as ReturnType<typeof vi.fn>).mockImplementation(
                (event: string, callback: (file: TFile) => Promise<void>) => {
                    if (event === "create") createCallback = callback;
                    if (event === "modify") modifyCallback = callback;
                    if (event === "delete") deleteCallback = callback;
                    return () => {};
                }
            );

            // Initialize the queue to register the callbacks
            queueState = await initializeFileChangeQueue(queueState);

            // Clear the queue for each test
            queueState.queue = [];
        });

        test("should handle file creation events", async () => {
            // Mock the hash store save function
            const mockSave = vi.fn().mockResolvedValue(undefined);
            queueState.options.hashStore.save = mockSave;

            // Mock the vault read function
            const mockRead = vi.fn().mockResolvedValue("new content");
            (mockVault.read as ReturnType<typeof vi.fn>).mockImplementation(
                mockRead
            );

            // Simulate a file creation event
            await createCallback(testFile3);

            // Should have added the file to the queue
            expect(queueState.queue).toHaveLength(1);
            expect(queueState.queue[0].path).toBe("file3.md");
            expect(queueState.queue[0].reason).toBe("new");

            // Should have updated the file hashes
            expect(queueState.fileHashes["file3.md"]).toBe("new content");

            // Should have saved the updated hashes
            expect(mockSave).toHaveBeenCalledWith(queueState.fileHashes);
        });

        test("should handle file modification events", async () => {
            // Mock the hash store save function
            const mockSave = vi.fn().mockResolvedValue(undefined);
            queueState.options.hashStore.save = mockSave;

            // Mock the vault read function
            const mockRead = vi.fn().mockResolvedValue("modified content");
            (mockVault.read as ReturnType<typeof vi.fn>).mockImplementation(
                mockRead
            );

            // Simulate a file modification event
            await modifyCallback(testFile1);

            // Should have added the file to the queue
            expect(queueState.queue).toHaveLength(1);
            expect(queueState.queue[0].path).toBe("file1.md");
            expect(queueState.queue[0].reason).toBe("modified");

            // Should have updated the file hashes
            expect(queueState.fileHashes["file1.md"]).toBe("modified content");

            // Should have saved the updated hashes
            expect(mockSave).toHaveBeenCalledWith(queueState.fileHashes);
        });

        test("should handle file deletion events", async () => {
            // Mock the hash store save function
            const mockSave = vi.fn().mockResolvedValue(undefined);
            queueState.options.hashStore.save = mockSave;

            // Add the file to the hashes first
            queueState.fileHashes["file1.md"] = "content1";

            // Simulate a file deletion event
            await deleteCallback(testFile1);

            // Should have added the file to the queue
            expect(queueState.queue).toHaveLength(1);
            expect(queueState.queue[0].path).toBe("file1.md");
            expect(queueState.queue[0].reason).toBe("deleted");

            // Should have removed the file from the hashes
            expect(queueState.fileHashes["file1.md"]).toBeUndefined();

            // Should have saved the updated hashes
            expect(mockSave).toHaveBeenCalledWith(queueState.fileHashes);
        });

        test("should ignore non-markdown files", async () => {
            // Simulate events for a non-markdown file
            await createCallback(nonMarkdownFile);
            await modifyCallback(nonMarkdownFile);
            await deleteCallback(nonMarkdownFile);

            // Should not have added anything to the queue
            expect(queueState.queue).toHaveLength(0);
        });

        test("should unregister callbacks on cleanup", async () => {
            // Mock the unregister functions
            const unregisterCreate = vi.fn();
            const unregisterModify = vi.fn();
            const unregisterDelete = vi.fn();

            // Set up the event refs
            queueState.eventRefs = [
                unregisterCreate,
                unregisterModify,
                unregisterDelete,
            ];

            // Clean up the queue
            const newState = cleanupFileChangeQueue(queueState);

            // Should have called all unregister functions
            expect(unregisterCreate).toHaveBeenCalled();
            expect(unregisterModify).toHaveBeenCalled();
            expect(unregisterDelete).toHaveBeenCalled();

            // Should have cleared the event refs
            expect(newState.eventRefs).toHaveLength(0);
        });
    });

    describe("hash function", () => {
        test("should produce consistent SHA-256 hashes", async () => {
            const content = "test content";
            const hash1 = await calculateFileHash(content);
            const hash2 = await calculateFileHash(content);

            // Hashes should be consistent
            expect(hash1).toBe(hash2);

            // Hash should be 64 characters (32 bytes in hex)
            expect(hash1).toHaveLength(64);

            // Different content should produce different hashes
            const differentHash = await calculateFileHash("different content");
            expect(hash1).not.toBe(differentHash);

            // Hash should be hexadecimal
            expect(hash1).toMatch(/^[0-9a-f]{64}$/);
        });
    });
});
