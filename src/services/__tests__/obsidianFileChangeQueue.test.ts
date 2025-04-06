import type { TFile, Vault } from "obsidian";
import { beforeEach, describe, expect, test, vi } from "vitest";
import {
    type FileChangeQueueState,
    type FileHashStore,
    createFileChangeQueue,
    enqueueAllFiles,
    getFileChangeCount,
    initializeFileChangeQueue,
    pollFileChanges,
} from "../obsidianFileChageQueue";

// Mock Vault with only the methods we need
type MockVault = Pick<Vault, "getMarkdownFiles" | "read">;

describe("FileChangeQueue", () => {
    let mockVault: MockVault;
    let mockHashStore: FileHashStore;
    let queueState: FileChangeQueueState;

    const testFile1 = { path: "file1.md" } as TFile;
    const testFile2 = { path: "file2.md" } as TFile;
    const testFile3 = { path: "file3.md" } as TFile;

    beforeEach(() => {
        // Reset mocks
        mockVault = {
            getMarkdownFiles: vi.fn().mockReturnValue([testFile1, testFile2]),
            read: vi.fn().mockImplementation(async (file: TFile) => {
                if (file.path === "file1.md") return "content1";
                if (file.path === "file2.md") return "content2";
                return "";
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
});
