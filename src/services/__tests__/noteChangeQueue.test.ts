import type { TFile, Vault } from "obsidian";
import { beforeEach, describe, expect, test, vi } from "vitest";
import { NoteChangeQueue } from "../noteChangeQueue";

// Mock Vault with only the methods we need
type MockVault = Pick<Vault, "getMarkdownFiles" | "read" | "on" | "offref">;

describe("FileChangeQueue", () => {
    let mockVault: MockVault;
    let fileChangeQueue: NoteChangeQueue;

    const testFile1 = {
        path: "file1.md",
        extension: "md",
        stat: { mtime: 1000 },
    } as TFile;
    const testFile2 = {
        path: "file2.md",
        extension: "md",
        stat: { mtime: 2000 },
    } as TFile;
    const testFile3 = {
        path: "file3.md",
        extension: "md",
        stat: { mtime: 3000 },
    } as TFile;
    const nonMarkdownFile = {
        path: "image.png",
        extension: "png",
        stat: { mtime: 4000 },
    } as TFile;

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
            offref: vi.fn(),
        };

        // Create a new file change queue
        fileChangeQueue = new NoteChangeQueue({
            vault: mockVault as unknown as Vault,
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
        expect(changes[0].mtime).toBe(1000);
        expect(changes[1].path).toBe("file2.md");
        expect(changes[1].reason).toBe("new");
        expect(changes[1].mtime).toBe(2000);

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
            "file1.md": 999,
            "file2.md": 1999,
        });

        // Should have 2 modified files in the queue
        expect(fileChangeQueue.getFileChangeCount()).toBe(2);

        const changes = fileChangeQueue.pollFileChanges(2);
        expect(changes[0].path).toBe("file1.md");
        expect(changes[0].reason).toBe("modified");
        expect(changes[0].mtime).toBe(1000);
        expect(changes[1].path).toBe("file2.md");
        expect(changes[1].reason).toBe("modified");
        expect(changes[1].mtime).toBe(2000);
    });

    test("should detect deleted files", async () => {
        await fileChangeQueue.initialize({
            "file1.md": 1000,
            "file2.md": 2000,
            "deleted.md": 3000,
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
        expect(changes[0].mtime).toBe(1000);
        expect(changes[1].path).toBe("file2.md");
        expect(changes[1].reason).toBe("modified");
        expect(changes[1].mtime).toBe(2000);
    });

    test("should poll changes from the queue", async () => {
        await fileChangeQueue.initialize({
            "file2.md": 1999,
            "file3.md": 2999,
        });

        expect(fileChangeQueue.getFileChangeCount()).toBe(3);

        const changes = fileChangeQueue.pollFileChanges(5);

        expect(changes).toHaveLength(3);
        expect(changes[0].path).toBe("file1.md");
        expect(changes[0].reason).toBe("new");
        expect(changes[0].mtime).toBe(1000);
        expect(changes[1].path).toBe("file2.md");
        expect(changes[1].reason).toBe("modified");
        expect(changes[1].mtime).toBe(2000);
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

            // Ensure offref is present for this mockVault
            mockVault.offref = vi.fn();

            await fileChangeQueue.initialize({
                "file1.md": 1000,
                "file2.md": 2000,
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
            expect(changes[0].mtime).toBe(3000);
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
            expect(changes[0].mtime).toBe(1000);
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
            expect(changes[0].mtime).toBe(1000);
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

            // Should have called vault.offref for each event ref
            expect(mockVault.offref).toHaveBeenCalledTimes(3);
        });
    });

    describe("markFileChangeProcessed", () => {
        test("should update mtime store for new files", async () => {
            // Create a file change
            const change = {
                path: "file1.md",
                reason: "new" as const,
                mtime: 1234,
            };

            // Mark the change as processed
            await fileChangeQueue.markNoteChangeProcessed(change);

            const metadata = await fileChangeQueue.getMetadata();
            expect(metadata["file1.md"]).toBe(1234);
        });

        test("should update mtime store for modified files", async () => {
            // Create a file change
            const change = {
                path: "file1.md",
                reason: "modified" as const,
                mtime: 2345,
            };

            // Mark the change as processed
            await fileChangeQueue.markNoteChangeProcessed(change);

            const metadata = await fileChangeQueue.getMetadata();
            expect(metadata["file1.md"]).toBe(2345);
        });

        test("should not update mtime store for deleted files", async () => {
            // Create a file change
            const change = { path: "file1.md", reason: "deleted" as const };

            // Mark the change as processed
            await fileChangeQueue.markNoteChangeProcessed(change);

            // Should not have saved the updated mtimes
            const metadata = await fileChangeQueue.getMetadata();
            expect(metadata["file1.md"]).toBeUndefined();
        });
    });

    describe("persistence of unprocessed files", () => {
        const testFile1 = {
            path: "file1.md",
            extension: "md",
            stat: { mtime: 1000 },
        } as TFile;
        const testFile2 = {
            path: "file2.md",
            extension: "md",
            stat: { mtime: 2000 },
        } as TFile;

        beforeEach(async () => {
            // Reset mocks
            mockVault = {
                getMarkdownFiles: vi
                    .fn()
                    .mockReturnValue([testFile1, testFile2]),
                read: vi.fn().mockImplementation(async (file: TFile) => {
                    if (file.path === "file1.md") return "content1";
                    if (file.path === "file2.md") return "content2";
                    return "";
                }),
                on: vi.fn().mockImplementation((event, callback) => {
                    // Return a function that can be called to unregister the event
                    return () => {};
                }),
                offref: vi.fn(),
            };
        });

        test("should not re-queue unprocessed files after polling and re-initialization", async () => {
            fileChangeQueue = new NoteChangeQueue({
                vault: mockVault as unknown as Vault,
            });
            await fileChangeQueue.initialize({
                "file1.md": 1500,
                "file2.md": 2500,
            });

            let changes = fileChangeQueue.pollFileChanges(5);
            expect(changes).toHaveLength(2);

            // cleanup without marking the file as processed
            const metadata = await fileChangeQueue.getMetadata();
            fileChangeQueue.cleanup();

            // initialize the queue again (= plugin reload)
            fileChangeQueue = new NoteChangeQueue({
                vault: mockVault as unknown as Vault,
            });
            await fileChangeQueue.initialize(metadata);

            // the queue should have changes from the previous run
            // because they were not marked as processed
            changes = fileChangeQueue.pollFileChanges(5);
            expect(changes).toHaveLength(2);
        });
    });
});
