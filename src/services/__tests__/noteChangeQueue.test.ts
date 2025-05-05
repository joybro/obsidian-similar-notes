import type { MTimeStore } from "@/infrastructure/MTimeStore";
import type { TFile, Vault } from "obsidian";
import { beforeEach, describe, expect, test, vi } from "vitest";
import { NoteChangeQueue } from "../noteChangeQueue";

// Mock Vault with only the methods we need
type MockVault = Pick<Vault, "getMarkdownFiles" | "read" | "on" | "offref">;

describe("FileChangeQueue", () => {
    let mockVault: MockVault;
    let mockMTimeStore: MTimeStore;
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
        mockMTimeStore = {
            getMTime: vi.fn().mockReturnValue(undefined),
            setMTime: vi.fn(),
            deleteMTime: vi.fn(),
            getAllPaths: vi.fn().mockReturnValue([]),
        } as unknown as MTimeStore;
        // Create a new file change queue
        fileChangeQueue = new NoteChangeQueue(
            mockVault as unknown as Vault,
            mockMTimeStore
        );
    });

    test("should create a new file change queue", () => {
        expect(fileChangeQueue.getFileChangeCount()).toBe(0);
    });

    test("should initialize queue with new files", async () => {
        await fileChangeQueue.initialize();

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
        // Set up previous mtimes
        mockMTimeStore.getMTime = vi.fn((path: string) => {
            if (path === "file1.md") return 999;
            if (path === "file2.md") return 1999;
            return -1;
        });
        await fileChangeQueue.initialize();

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
        // Set up previous mtimes
        mockMTimeStore.getAllPaths = vi.fn(() => [
            "file1.md",
            "file2.md",
            "deleted.md",
        ]);
        mockMTimeStore.getMTime = vi.fn((path: string) => {
            if (path === "file1.md") return 1000;
            if (path === "file2.md") return 2000;
            if (path === "deleted.md") return 3000;
            return -1;
        });
        await fileChangeQueue.initialize();

        // Should have 1 deleted file in the queue
        expect(fileChangeQueue.getFileChangeCount()).toBe(1);

        const changes = fileChangeQueue.pollFileChanges(1);
        expect(changes[0].path).toBe("deleted.md");
        expect(changes[0].reason).toBe("deleted");
    });

    test("should enqueue all files", async () => {
        await fileChangeQueue.initialize();
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
        // Set up previous mtimes
        mockMTimeStore.getAllPaths = vi.fn(() => ["file2.md", "file3.md"]);
        mockMTimeStore.getMTime = vi.fn((path: string) => {
            if (path === "file2.md") return 1999;
            if (path === "file3.md") return 2999;
            return undefined;
        }) as unknown as (path: string) => number;
        await fileChangeQueue.initialize();

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
            mockMTimeStore.getAllPaths = vi.fn(() => ["file1.md", "file2.md"]);
            mockMTimeStore.getMTime = vi.fn((path: string) => {
                if (path === "file1.md") return 1000;
                if (path === "file2.md") return 2000;
                return -1;
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
            expect(mockMTimeStore.setMTime).toHaveBeenCalledWith(
                "file1.md",
                1234
            );
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
            expect(mockMTimeStore.setMTime).toHaveBeenCalledWith(
                "file1.md",
                2345
            );
        });

        test("should not update mtime store for deleted files", async () => {
            // Create a file change
            const change = { path: "file1.md", reason: "deleted" as const };
            // Mark the change as processed
            await fileChangeQueue.markNoteChangeProcessed(change);
            expect(mockMTimeStore.deleteMTime).toHaveBeenCalledWith("file1.md");
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
            mockMTimeStore = {
                getMTime: vi.fn(),
                setMTime: vi.fn(),
                deleteMTime: vi.fn(),
                getAllPaths: vi.fn(),
            } as unknown as MTimeStore;
        });

        test("should not re-queue unprocessed files after polling and re-initialization", async () => {
            // Set up previous mtimes
            mockMTimeStore.getAllPaths = vi.fn(() => ["file1.md", "file2.md"]);
            mockMTimeStore.getMTime = vi.fn((path: string) => {
                if (path === "file1.md") return 1500;
                if (path === "file2.md") return 2500;
                return -1;
            });
            fileChangeQueue = new NoteChangeQueue(
                mockVault as unknown as Vault,
                mockMTimeStore
            );
            await fileChangeQueue.initialize();
            let changes = fileChangeQueue.pollFileChanges(5);
            expect(changes).toHaveLength(2);
            // cleanup without marking the file as processed
            fileChangeQueue.cleanup();
            // initialize the queue again (= plugin reload)
            fileChangeQueue = new NoteChangeQueue(
                mockVault as unknown as Vault,
                mockMTimeStore
            );
            await fileChangeQueue.initialize();
            // the queue should have changes from the previous run
            // because they were not marked as processed
            changes = fileChangeQueue.pollFileChanges(5);
            expect(changes).toHaveLength(2);
        });
    });
});
