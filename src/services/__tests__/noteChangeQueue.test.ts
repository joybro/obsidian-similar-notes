import type { TFile, Vault } from "obsidian";
import { beforeEach, describe, expect, test, vi } from "vitest";
import { NoteChangeQueue } from "../noteChangeQueue";

// Mock Vault with only the methods we need
type MockVault = Pick<Vault, "getMarkdownFiles" | "read" | "on">;

const mockHashFunc = (content: string) => Promise.resolve(content);

describe("FileChangeQueue", () => {
    let mockVault: MockVault;
    let fileChangeQueue: NoteChangeQueue;

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

        // Create a new file change queue
        fileChangeQueue = new NoteChangeQueue({
            vault: mockVault as unknown as Vault,
            hashFunc: (content: string) => Promise.resolve(content),
        });
    });

    test("should create a new file change queue", () => {
        expect(fileChangeQueue.getFileChangeCount()).toBe(0);
    });

    test("should initialize queue with new files", async () => {
        await fileChangeQueue.initialize({});

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
        await fileChangeQueue.initialize({
            "file1.md": "oldhash1",
            "file2.md": "oldhash2",
        });

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
        await fileChangeQueue.initialize({
            "file1.md": "content1",
            "file2.md": "content2",
            "deleted.md": "content3",
        });

        // Should have 1 deleted file in the queue
        expect(fileChangeQueue.getFileChangeCount()).toBe(1);

        const changes = fileChangeQueue.pollFileChanges(1);
        expect(changes[0].path).toBe("deleted.md");
        expect(changes[0].reason).toBe("deleted");
    });

    test("should enqueue all files", async () => {
        await fileChangeQueue.initialize({});
        await fileChangeQueue.enqueueAllNotes();

        // Should have all files in the queue
        expect(fileChangeQueue.getFileChangeCount()).toBe(2);

        const changes = fileChangeQueue.pollFileChanges(2);
        expect(changes[0].path).toBe("file1.md");
        expect(changes[0].reason).toBe("modified");
        expect(changes[1].path).toBe("file2.md");
        expect(changes[1].reason).toBe("modified");
    });

    test("should poll changes from the queue", async () => {
        await fileChangeQueue.initialize({
            "file2.md": "old content2",
            "file3.md": "content3",
        });

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

            await fileChangeQueue.initialize({
                "file1.md": "content1",
                "file2.md": "content2",
            });
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
            const hash1 = await NoteChangeQueue.calculateNoteHash(content);
            const hash2 = await NoteChangeQueue.calculateNoteHash(content);

            // Hashes should be consistent
            expect(hash1).toBe(hash2);

            // Hash should be 64 characters (32 bytes in hex)
            expect(hash1).toHaveLength(64);

            // Different content should produce different hashes
            const differentHash = await NoteChangeQueue.calculateNoteHash(
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
            await fileChangeQueue.markNoteChangeProcessed(change);

            const metadata = await fileChangeQueue.getMetadata();
            expect(metadata["file1.md"]).toBe("newhash");
        });

        test("should update hash store for modified files", async () => {
            // Create a file change
            const change = {
                path: "file1.md",
                reason: "modified" as const,
                hash: "modifiedhash",
            };

            // Mark the change as processed
            await fileChangeQueue.markNoteChangeProcessed(change);

            const metadata = await fileChangeQueue.getMetadata();
            expect(metadata["file1.md"]).toBe("modifiedhash");
        });

        test("should not update hash store for deleted files", async () => {
            // Create a file change
            const change = { path: "file1.md", reason: "deleted" as const };

            // Mark the change as processed
            await fileChangeQueue.markNoteChangeProcessed(change);

            // Should not have saved the updated hashes
            const metadata = await fileChangeQueue.getMetadata();
            expect(metadata["file1.md"]).toBeUndefined();
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
            const newContent = "new content";

            // Mock the vault read function for the new file
            const mockRead = vi.fn().mockResolvedValue(newContent);
            (mockVault.read as ReturnType<typeof vi.fn>).mockImplementation(
                mockRead
            );

            // initialize the queue
            fileChangeQueue = new NoteChangeQueue({
                vault: mockVault as unknown as Vault,
                hashFunc: mockHashFunc,
            });
            await fileChangeQueue.initialize({
                "file1.md": "content1",
                "file2.md": "content2",
            });

            let changes = fileChangeQueue.pollFileChanges(5);
            expect(changes).toHaveLength(2);
            expect(changes[0].path).toBe("file1.md");
            expect(changes[0].reason).toBe("modified");
            expect(changes[0].hash).toBe(newContent);

            // cleanup without marking the file as processed
            const metadata = await fileChangeQueue.getMetadata();
            fileChangeQueue.cleanup();

            // initialize the queue again (= plugin reload)
            fileChangeQueue = new NoteChangeQueue({
                vault: mockVault as unknown as Vault,
                hashFunc: mockHashFunc,
            });
            await fileChangeQueue.initialize(metadata);

            // The file should still be in the queue because it wasn't processed
            changes = fileChangeQueue.pollFileChanges(5);
            expect(changes).toHaveLength(2);
            expect(changes[0].path).toBe("file1.md");
            expect(changes[0].reason).toBe("modified");
            expect(changes[0].hash).toBe(newContent);
        });

        test("should keep unprocessed files in queue after modify callback", async () => {
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
            fileChangeQueue = new NoteChangeQueue({
                vault: mockVault as unknown as Vault,
                hashFunc: mockHashFunc,
            });
            await fileChangeQueue.initialize({
                "file1.md": "content1",
                "file2.md": "content2",
            });

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
            fileChangeQueue = new NoteChangeQueue({
                vault: mockVault as unknown as Vault,
                hashFunc: mockHashFunc,
            });
            await fileChangeQueue.initialize({
                "file1.md": "content1",
                "file2.md": "content2",
            });

            // The file should still be in the queue because it wasn't processed
            changes = fileChangeQueue.pollFileChanges(5);
            expect(changes).toHaveLength(1);
            expect(changes[0].path).toBe("file1.md");
            expect(changes[0].reason).toBe("modified");
            expect(changes[0].hash).toBe(newContent);
        });
    });
});
