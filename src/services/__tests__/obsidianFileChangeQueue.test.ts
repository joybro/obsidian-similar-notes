import type { TFile, Vault } from "obsidian";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import {
    FileChangeQueue,
    type FileHashStore,
} from "../obsidianFileChangeQueue";

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
    let fileChangeQueue: FileChangeQueue;

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

        // Create a new file change queue
        fileChangeQueue = new FileChangeQueue({
            vault: mockVault as unknown as Vault,
            hashStore: mockHashStore,
            hashFunc: (content: string) => Promise.resolve(content),
            hashStoreUpdateInterval: 0,
        });
    });

    test("should create a new file change queue", () => {
        expect(fileChangeQueue.getFileChangeCount()).toBe(0);
    });

    test("should initialize queue with new files", async () => {
        // Mock previous hashes (empty, so all files are new)
        (mockHashStore.load as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
            {}
        );

        await fileChangeQueue.initialize();

        // Should have 2 new files in the queue
        expect(fileChangeQueue.getFileChangeCount()).toBe(2);

        const changes = fileChangeQueue.pollFileChanges(2);
        expect(changes[0].path).toBe("file1.md");
        expect(changes[0].reason).toBe("new");
        expect(changes[0].hash).toBe("content1");
        expect(changes[1].path).toBe("file2.md");
        expect(changes[1].reason).toBe("new");
        expect(changes[1].hash).toBe("content2");

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

        await fileChangeQueue.initialize();

        // Should have 2 modified files in the queue
        expect(fileChangeQueue.getFileChangeCount()).toBe(2);

        const changes = fileChangeQueue.pollFileChanges(2);
        expect(changes[0].path).toBe("file1.md");
        expect(changes[0].reason).toBe("modified");
        expect(changes[0].hash).toBe("content1");
        expect(changes[1].path).toBe("file2.md");
        expect(changes[1].reason).toBe("modified");
        expect(changes[1].hash).toBe("content2");
    });

    test("should detect deleted files", async () => {
        // Mock previous hashes with a file that no longer exists
        (mockHashStore.load as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
            "file1.md": "content1",
            "file2.md": "content2",
            "deleted.md": "content3",
        });

        await fileChangeQueue.initialize();

        // Should have 1 deleted file in the queue
        expect(fileChangeQueue.getFileChangeCount()).toBe(1);

        const changes = fileChangeQueue.pollFileChanges(1);
        expect(changes[0].path).toBe("deleted.md");
        expect(changes[0].reason).toBe("deleted");
    });

    test("should enqueue all files", async () => {
        await fileChangeQueue.enqueueAllFiles();

        // Should have all files in the queue
        expect(fileChangeQueue.getFileChangeCount()).toBe(2);

        const changes = fileChangeQueue.pollFileChanges(2);
        expect(changes[0].path).toBe("file1.md");
        expect(changes[0].reason).toBe("modified");
        expect(changes[1].path).toBe("file2.md");
        expect(changes[1].reason).toBe("modified");
    });

    test("should poll changes from the queue", async () => {
        // Mock previous hashes with a file that no longer exists
        (mockHashStore.load as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
            "file2.md": "old content2",
            "file3.md": "content3",
        });

        await fileChangeQueue.initialize();

        expect(fileChangeQueue.getFileChangeCount()).toBe(3);

        const changes = fileChangeQueue.pollFileChanges(5);

        expect(changes).toHaveLength(3);
        expect(changes[0].path).toBe("file1.md");
        expect(changes[0].reason).toBe("new");
        expect(changes[0].hash).toBe("content1");
        expect(changes[1].path).toBe("file2.md");
        expect(changes[1].reason).toBe("modified");
        expect(changes[1].hash).toBe("content2");
        expect(changes[2].path).toBe("file3.md");
        expect(changes[2].reason).toBe("deleted");
    });

    describe("file change event callbacks", () => {
        let createCallback: (file: TFile) => Promise<void>;
        let modifyCallback: (file: TFile) => Promise<void>;
        let deleteCallback: (file: TFile) => Promise<void>;
        const unregisterCreate = vi.fn();
        const unregisterModify = vi.fn();
        const unregisterDelete = vi.fn();

        beforeEach(async () => {
            // Capture the callbacks when they're registered
            (mockVault.on as ReturnType<typeof vi.fn>).mockImplementation(
                (event: string, callback: (file: TFile) => Promise<void>) => {
                    if (event === "create") {
                        createCallback = callback;
                        return unregisterCreate;
                    }
                    if (event === "modify") {
                        modifyCallback = callback;
                        return unregisterModify;
                    }
                    if (event === "delete") {
                        deleteCallback = callback;
                        return unregisterDelete;
                    }
                    return () => {};
                }
            );

            (
                mockHashStore.load as ReturnType<typeof vi.fn>
            ).mockResolvedValueOnce({
                "file1.md": "content1",
                "file2.md": "content2",
            });

            await fileChangeQueue.initialize();
        });

        test("should handle file creation events", async () => {
            // Mock the vault read function
            (mockVault.read as ReturnType<typeof vi.fn>).mockImplementation(
                (file: TFile) => {
                    if (file.path === "file3.md") return "new content";
                    return "";
                }
            );

            // Simulate a file creation event
            await createCallback(testFile3);

            // Should have added the file to the queue
            expect(fileChangeQueue.getFileChangeCount()).toBe(1);

            const changes = fileChangeQueue.pollFileChanges(1);
            expect(changes[0].path).toBe("file3.md");
            expect(changes[0].reason).toBe("new");
            expect(changes[0].hash).toBe("new content");
        });

        test("should handle file modification events", async () => {
            expect(fileChangeQueue.getFileChangeCount()).toBe(0);

            // Mock the vault read function
            (mockVault.read as ReturnType<typeof vi.fn>).mockImplementation(
                (file: TFile) => {
                    if (file.path === "file1.md") return "modified content";
                    return "";
                }
            );

            // Simulate a file modification event
            await modifyCallback(testFile1);

            // Should have added the file to the queue
            expect(fileChangeQueue.getFileChangeCount()).toBe(1);

            const changes = fileChangeQueue.pollFileChanges(1);
            expect(changes[0].path).toBe("file1.md");
            expect(changes[0].reason).toBe("modified");
            expect(changes[0].hash).toBe("modified content");
        });

        test("should handle multiple modify events for the same file", async () => {
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
            expect(fileChangeQueue.getFileChangeCount()).toBe(1);

            const changes = fileChangeQueue.pollFileChanges(1);
            expect(changes[0].path).toBe("file1.md");
            expect(changes[0].reason).toBe("modified");
            expect(changes[0].hash).toBe("modified content 2");
        });

        test("should handle file deletion events", async () => {
            // Simulate a file deletion event
            await deleteCallback(testFile1);

            // Should have added the file to the queue
            expect(fileChangeQueue.getFileChangeCount()).toBe(1);

            const changes = fileChangeQueue.pollFileChanges(1);
            expect(changes[0].path).toBe("file1.md");
            expect(changes[0].reason).toBe("deleted");
        });

        test("should ignore non-markdown files", async () => {
            // Simulate events for a non-markdown file
            await createCallback(nonMarkdownFile);
            await modifyCallback(nonMarkdownFile);
            await deleteCallback(nonMarkdownFile);

            // Should not have added anything to the queue
            expect(fileChangeQueue.getFileChangeCount()).toBe(0);
        });

        test("should unregister callbacks on cleanup", async () => {
            // Clean up the queue
            fileChangeQueue.cleanup();

            // Should have called all unregister functions
            expect(unregisterCreate).toHaveBeenCalled();
            expect(unregisterModify).toHaveBeenCalled();
            expect(unregisterDelete).toHaveBeenCalled();
        });
    });

    describe("hash function", () => {
        test("should produce consistent SHA-256 hashes", async () => {
            const content = "test content";
            const hash1 = await FileChangeQueue.calculateFileHash(content);
            const hash2 = await FileChangeQueue.calculateFileHash(content);

            // Hashes should be consistent
            expect(hash1).toBe(hash2);

            // Hash should be 64 characters (32 bytes in hex)
            expect(hash1).toHaveLength(64);

            // Different content should produce different hashes
            const differentHash = await FileChangeQueue.calculateFileHash(
                "different content"
            );
            expect(hash1).not.toBe(differentHash);

            // Hash should be hexadecimal
            expect(hash1).toMatch(/^[0-9a-f]{64}$/);
        });
    });

    describe("markFileChangeProcessed", () => {
        test("should update hash store for new files", async () => {
            // Create a file change
            const change = {
                path: "file1.md",
                reason: "new" as const,
                hash: "newhash",
            };

            // Mark the change as processed
            await fileChangeQueue.markFileChangeProcessed(change);

            // Should have saved the updated hashes
            expect(mockHashStore.save).toHaveBeenCalledWith({
                "file1.md": "newhash",
            });
        });

        test("should update hash store for modified files", async () => {
            // Create a file change
            const change = {
                path: "file1.md",
                reason: "modified" as const,
                hash: "modifiedhash",
            };

            // Mark the change as processed
            await fileChangeQueue.markFileChangeProcessed(change);

            // Should have saved the updated hashes
            expect(mockHashStore.save).toHaveBeenCalledWith({
                "file1.md": "modifiedhash",
            });
        });

        test("should not update hash store for deleted files", async () => {
            // Create a file change
            const change = { path: "file1.md", reason: "deleted" as const };

            // Mark the change as processed
            await fileChangeQueue.markFileChangeProcessed(change);

            // Should not have saved the updated hashes
            expect(mockHashStore.save).toHaveBeenCalledWith({});
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
            fileChangeQueue = new FileChangeQueue({
                vault: mockVault as unknown as Vault,
                hashStore: mockHashStore,
                hashFunc: mockHashFunc,
                hashStoreUpdateInterval: 0,
            });
            await fileChangeQueue.initialize();

            let changes = fileChangeQueue.pollFileChanges(5);
            expect(changes).toHaveLength(2);
            expect(changes[0].path).toBe("file1.md");
            expect(changes[0].reason).toBe("modified");
            expect(changes[0].hash).toBe(newContent);

            // cleanup without marking the file as processed
            fileChangeQueue.cleanup();

            // initialize the queue again (= plugin reload)
            fileChangeQueue = new FileChangeQueue({
                vault: mockVault as unknown as Vault,
                hashStore: mockHashStore,
                hashFunc: mockHashFunc,
                hashStoreUpdateInterval: 0,
            });
            await fileChangeQueue.initialize();

            // The file should still be in the queue because it wasn't processed
            changes = fileChangeQueue.pollFileChanges(5);
            expect(changes).toHaveLength(2);
            expect(changes[0].path).toBe("file1.md");
            expect(changes[0].reason).toBe("modified");
            expect(changes[0].hash).toBe(newContent);
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
            fileChangeQueue = new FileChangeQueue({
                vault: mockVault as unknown as Vault,
                hashStore: mockHashStore,
                hashFunc: mockHashFunc,
                hashStoreUpdateInterval: 0,
            });
            await fileChangeQueue.initialize();

            let changes = fileChangeQueue.pollFileChanges(5);
            expect(changes).toHaveLength(0);

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

            changes = fileChangeQueue.pollFileChanges(5);
            expect(changes).toHaveLength(1);
            expect(changes[0].path).toBe("file1.md");
            expect(changes[0].reason).toBe("modified");
            expect(changes[0].hash).toBe(newContent);

            // cleanup without marking the file as processed
            fileChangeQueue.cleanup();

            // initialize the queue again (= plugin reload)
            fileChangeQueue = new FileChangeQueue({
                vault: mockVault as unknown as Vault,
                hashStore: mockHashStore,
                hashFunc: mockHashFunc,
                hashStoreUpdateInterval: 0,
            });
            await fileChangeQueue.initialize();

            // The file should still be in the queue because it wasn't processed
            changes = fileChangeQueue.pollFileChanges(5);
            expect(changes).toHaveLength(1);
            expect(changes[0].path).toBe("file1.md");
            expect(changes[0].reason).toBe("modified");
            expect(changes[0].hash).toBe(newContent);
        });
    });

    describe("hash store update batching", () => {
        let mockSave: ReturnType<typeof vi.fn>;

        beforeEach(() => {
            vi.useFakeTimers();
            mockSave = vi.fn().mockResolvedValue(undefined);
            mockHashStore = {
                load: vi.fn().mockResolvedValue({}),
                save: mockSave,
            };
        });

        afterEach(() => {
            vi.useRealTimers();
        });

        test("should batch updates when interval is positive", async () => {
            const updateInterval = 1000;
            fileChangeQueue = new FileChangeQueue({
                vault: mockVault as unknown as Vault,
                hashStore: mockHashStore,
                hashStoreUpdateInterval: updateInterval,
                hashFunc: mockHashFunc,
            });

            await fileChangeQueue.initialize();
            await fileChangeQueue.markFileChangeProcessed({
                path: "file1.md",
                reason: "modified",
                hash: "hash1",
            });
            await fileChangeQueue.markFileChangeProcessed({
                path: "file2.md",
                reason: "modified",
                hash: "hash2",
            });

            // No immediate save
            expect(mockSave).toHaveBeenCalledTimes(0);

            // Advance timer
            await vi.advanceTimersByTimeAsync(updateInterval);

            // Should have saved once with both changes
            expect(mockSave).toHaveBeenCalledTimes(1);
            expect(mockSave).toHaveBeenCalledWith({
                "file1.md": "hash1",
                "file2.md": "hash2",
            });
        });

        test("should save immediately when interval is 0", async () => {
            fileChangeQueue = new FileChangeQueue({
                vault: mockVault as unknown as Vault,
                hashStore: mockHashStore,
                hashStoreUpdateInterval: 0,
                hashFunc: mockHashFunc,
            });

            await fileChangeQueue.initialize();
            await fileChangeQueue.markFileChangeProcessed({
                path: "file1.md",
                reason: "modified",
                hash: "hash1",
            });

            // Should save immediately
            expect(mockSave).toHaveBeenCalledTimes(1);
            expect(mockSave).toHaveBeenCalledWith({
                "file1.md": "hash1",
                "file2.md": "content2", // non-processed file. It saves all files
            });
        });

        test("should save pending changes on cleanup", async () => {
            const updateInterval = 100000;
            fileChangeQueue = new FileChangeQueue({
                vault: mockVault as unknown as Vault,
                hashStore: mockHashStore,
                hashStoreUpdateInterval: updateInterval,
                hashFunc: mockHashFunc,
            });

            await fileChangeQueue.initialize();
            await fileChangeQueue.markFileChangeProcessed({
                path: "file1.md",
                reason: "modified",
                hash: "hash1",
            });

            // No immediate save
            expect(mockSave).toHaveBeenCalledTimes(0);

            // Cleanup should save pending changes
            fileChangeQueue.cleanup();

            expect(mockSave).toHaveBeenCalledTimes(1);
            expect(mockSave).toHaveBeenCalledWith({
                "file1.md": "hash1",
                "file2.md": "content2", // non-processed file. It saves all files
            });
        });

        test("should handle deleted files in batched updates", async () => {
            const updateInterval = 1000;
            fileChangeQueue = new FileChangeQueue({
                vault: mockVault as unknown as Vault,
                hashStore: mockHashStore,
                hashStoreUpdateInterval: updateInterval,
                hashFunc: mockHashFunc,
            });

            await fileChangeQueue.initialize();
            await fileChangeQueue.markFileChangeProcessed({
                path: "file1.md",
                reason: "modified",
                hash: "hash1",
            });
            await fileChangeQueue.markFileChangeProcessed({
                path: "file1.md",
                reason: "deleted",
            });

            // No immediate save
            expect(mockSave).toHaveBeenCalledTimes(0);

            // Advance timer
            await vi.advanceTimersByTimeAsync(updateInterval);

            // Should have saved once with file1.md deleted
            expect(mockSave).toHaveBeenCalledTimes(1);
            expect(mockSave).toHaveBeenCalledWith({
                "file2.md": "content2", // non-processed file. It saves all files
            });
        });
    });
});
