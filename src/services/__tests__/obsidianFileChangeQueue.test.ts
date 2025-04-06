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
    markFileChangeProcessed,
    pollFileChanges,
} from "../obsidianFileChageQueue";

// Mock Vault with only the methods we need
type MockVault = Pick<Vault, "getMarkdownFiles" | "read" | "on">;

class MockHashStore implements FileHashStore {
    private store: Record<string, string> = {};

    load = () => Promise.resolve(this.store);
    save = (newStore: Record<string, string>) => {
        this.store = {
            ...this.store,
            ...newStore,
        };
        return Promise.resolve();
    };
}

const mockHashFunc = (content: string) => Promise.resolve(content);

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
        expect(newState.queue[0].hash).toBe("content1");
        expect(newState.queue[1].path).toBe("file2.md");
        expect(newState.queue[1].reason).toBe("new");
        expect(newState.queue[1].hash).toBe("content2");

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
        expect(newState.queue[0].hash).toBe("content1");
        expect(newState.queue[1].path).toBe("file2.md");
        expect(newState.queue[1].reason).toBe("modified");
        expect(newState.queue[1].hash).toBe("content2");
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
            { path: "file1.md", reason: "new", hash: "hash1" },
            { path: "file2.md", reason: "modified", hash: "hash2" },
            { path: "file3.md", reason: "deleted" },
        ];

        // Poll 2 changes
        const { state, changes } = pollFileChanges(queueState, 2);

        // Should have 2 changes
        expect(changes).toHaveLength(2);
        expect(changes[0].path).toBe("file1.md");
        expect(changes[0].hash).toBe("hash1");
        expect(changes[1].path).toBe("file2.md");
        expect(changes[1].hash).toBe("hash2");

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
            expect(queueState.queue[0].hash).toBe("new content");
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
            expect(queueState.queue[0].hash).toBe("modified content");
        });

        test("should handle multiple modify events for the same file", async () => {
            // Mock the hash store save function
            const mockSave = vi.fn().mockResolvedValue(undefined);
            queueState.options.hashStore.save = mockSave;

            // Mock the vault read function 1
            (mockVault.read as ReturnType<typeof vi.fn>).mockImplementation(
                (file: TFile) => {
                    if (file.path === "file1.md") return "modified content 1";
                    return "";
                }
            );

            // Simulate a file modification event
            await modifyCallback(testFile1);

            // Mock the vault read function 2
            (mockVault.read as ReturnType<typeof vi.fn>).mockImplementation(
                (file: TFile) => {
                    if (file.path === "file1.md") return "modified content 2";
                    return "";
                }
            );

            // Simulate a file modification event
            await modifyCallback(testFile1);

            // Should have added the file to the queue
            expect(queueState.queue).toHaveLength(1);
            expect(queueState.queue[0].path).toBe("file1.md");
            expect(queueState.queue[0].reason).toBe("modified");
            expect(queueState.queue[0].hash).toBe("modified content 2");
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

    describe("markFileChangeProcessed", () => {
        test("should update hash store for new files", async () => {
            // Mock the hash store save function
            const mockSave = vi.fn().mockResolvedValue(undefined);
            queueState.options.hashStore.save = mockSave;

            // Create a file change
            const change = {
                path: "file1.md",
                reason: "new" as const,
                hash: "newhash",
            };

            // Mark the change as processed
            const newState = await markFileChangeProcessed(queueState, change);

            // Should have updated the file hashes
            expect(newState.fileHashes["file1.md"]).toBe("newhash");

            // Should have saved the updated hashes
            expect(mockSave).toHaveBeenCalledWith(newState.fileHashes);
        });

        test("should update hash store for modified files", async () => {
            // Mock the hash store save function
            const mockSave = vi.fn().mockResolvedValue(undefined);
            queueState.options.hashStore.save = mockSave;

            // Create a file change
            const change = {
                path: "file1.md",
                reason: "modified" as const,
                hash: "modifiedhash",
            };

            // Mark the change as processed
            const newState = await markFileChangeProcessed(queueState, change);

            // Should have updated the file hashes
            expect(newState.fileHashes["file1.md"]).toBe("modifiedhash");

            // Should have saved the updated hashes
            expect(mockSave).toHaveBeenCalledWith(newState.fileHashes);
        });

        test("should not update hash store for deleted files", async () => {
            // Mock the hash store save function
            const mockSave = vi.fn().mockResolvedValue(undefined);
            queueState.options.hashStore.save = mockSave;

            // Create a file change
            const change = { path: "file1.md", reason: "deleted" as const };

            // Mark the change as processed
            const newState = await markFileChangeProcessed(queueState, change);

            // Should not have saved the updated hashes
            expect(mockSave).not.toHaveBeenCalled();
        });

        test("should handle changes without hash", async () => {
            // Mock the hash store save function
            const mockSave = vi.fn().mockResolvedValue(undefined);
            queueState.options.hashStore.save = mockSave;

            // Create a file change without hash
            const change = { path: "file1.md", reason: "new" as const };

            // Mark the change as processed
            const newState = await markFileChangeProcessed(queueState, change);

            // Should not have saved the updated hashes
            expect(mockSave).not.toHaveBeenCalled();
        });
    });

    describe("persistence of unprocessed files", () => {
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
        });

        test("should keep unprocessed files in queue after polling", async () => {
            // Mock the hash store load function to return the current hashes
            const mockHashStore = new MockHashStore();
            mockHashStore.save({
                "file1.md": "content1",
                "file2.md": "content2",
            });

            const newContent = "new content";

            // Mock the vault read function for the new file
            const mockRead = vi.fn().mockResolvedValue(newContent);
            (mockVault.read as ReturnType<typeof vi.fn>).mockImplementation(
                mockRead
            );

            // initialize the queue
            queueState = createFileChangeQueue({
                vault: mockVault as unknown as Vault,
                hashStore: mockHashStore,
                hashFunc: mockHashFunc,
            });
            queueState = await initializeFileChangeQueue(queueState);

            let result = pollFileChanges(queueState, 5);
            expect(result.changes).toHaveLength(2);
            expect(result.changes[0].path).toBe("file1.md");
            expect(result.changes[0].reason).toBe("modified");
            expect(result.changes[0].hash).toBe(newContent);

            queueState = result.state;

            // cleanup without marking the file as processed
            cleanupFileChangeQueue(queueState);

            // initialize the queue again (= plugin reload)
            queueState = createFileChangeQueue({
                vault: mockVault as unknown as Vault,
                hashStore: mockHashStore,
                hashFunc: mockHashFunc,
            });
            queueState = await initializeFileChangeQueue(queueState);

            // The file should still be in the queue because it wasn't processed
            result = pollFileChanges(queueState, 5);
            expect(result.changes).toHaveLength(2);
            expect(result.changes[0].path).toBe("file1.md");
            expect(result.changes[0].reason).toBe("modified");
            expect(result.changes[0].hash).toBe(newContent);
        });

        test("should keep unprocessed files in queue after modify callback", async () => {
            // Mock the hash store load function to return the current hashes
            const mockHashStore = new MockHashStore();
            mockHashStore.save({
                "file1.md": "content1",
                "file2.md": "content2",
            });

            const newContent = "new content";

            // Mock the vault read function for the new file
            let mockRead: (file: TFile) => string = (file: TFile) => {
                if (file.path === "file1.md") return "content1";
                if (file.path === "file2.md") return "content2";
                return "";
            };
            (mockVault.read as ReturnType<typeof vi.fn>).mockImplementation(
                mockRead
            );

            // initialize the queue
            queueState = createFileChangeQueue({
                vault: mockVault as unknown as Vault,
                hashStore: mockHashStore,
                hashFunc: mockHashFunc,
            });
            queueState = await initializeFileChangeQueue(queueState);

            let result = pollFileChanges(queueState, 5);
            expect(result.changes).toHaveLength(0);

            // emit modify event
            mockRead = (file: TFile) => {
                if (file.path === "file1.md") return newContent;
                if (file.path === "file2.md") return "content2";
                return "";
            };
            (mockVault.read as ReturnType<typeof vi.fn>).mockImplementation(
                mockRead
            );
            await modifyCallback(testFile1);

            result = pollFileChanges(queueState, 5);
            expect(result.changes).toHaveLength(1);
            expect(result.changes[0].path).toBe("file1.md");
            expect(result.changes[0].reason).toBe("modified");
            expect(result.changes[0].hash).toBe(newContent);

            queueState = result.state;

            // cleanup without marking the file as processed
            cleanupFileChangeQueue(queueState);

            // initialize the queue again (= plugin reload)
            queueState = createFileChangeQueue({
                vault: mockVault as unknown as Vault,
                hashStore: mockHashStore,
                hashFunc: mockHashFunc,
            });
            queueState = await initializeFileChangeQueue(queueState);

            // The file should still be in the queue because it wasn't processed
            result = pollFileChanges(queueState, 5);
            expect(result.changes).toHaveLength(1);
            expect(result.changes[0].path).toBe("file1.md");
            expect(result.changes[0].reason).toBe("modified");
            expect(result.changes[0].hash).toBe(newContent);
        });
    });
});
