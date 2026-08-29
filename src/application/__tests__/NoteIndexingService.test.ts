import { describe, expect, test, vi, beforeEach } from "vitest";
import { NoteIndexingService } from "../NoteIndexingService";
import type { NoteChange } from "@/infrastructure/noteChangeQueue";
import { computeIndexableTextHash } from "@/utils/indexableTextHash";

// The user-facing failure Notice is a side-effect, not part of the routing
// contract. Stub it so the test exercises the real propagation path (in real
// Obsidian the Notice shows and does NOT throw — without this stub the unmocked
// Notice would throw and mask whether the embedding error actually propagates).
vi.mock("@/utils/errorHandling", async (importOriginal) => ({
    ...(await importOriginal<typeof import("@/utils/errorHandling")>()),
    showNoteErrorNotice: vi.fn(),
}));

vi.mock("@/utils/indexableTextHash", () => ({
    computeIndexableTextHash: vi.fn(
        async (content: string) => `hash:${content}`
    ),
}));

interface FailureHandler {
    handleChangeFailure: (c: NoteChange, e: unknown) => Promise<void>;
}

interface ChangeProcessor {
    processChange: (c: NoteChange) => Promise<void>;
}

// Mocks for the full single-change processing path. The failure-transition
// tests only touch queue + erroredStore; the routing test additionally drives
// the note → chunk → embed pipeline.
function makeService() {
    const queue = {
        requeue: vi.fn(),
        getIndexableTextHash: vi.fn().mockReturnValue(undefined),
        clearIndexableTextHash: vi.fn().mockResolvedValue(undefined),
        markNoteChangeProcessed: vi.fn().mockResolvedValue(undefined),
    };
    const erroredStore = {
        set: vi.fn().mockResolvedValue(undefined),
        get: vi.fn(),
        delete: vi.fn().mockResolvedValue(undefined),
    };
    const noteRepository = { findByPath: vi.fn() };
    const noteChunkRepository = {
        removeByPath: vi.fn().mockResolvedValue(undefined),
        putMulti: vi.fn().mockResolvedValue(undefined),
        count: vi.fn().mockResolvedValue(0),
        renamePath: vi.fn().mockResolvedValue(false),
    };
    const noteChunkingService = { split: vi.fn() };
    const embeddingService = {
        embedTexts: vi.fn(),
        supportsParallelProcessing: vi.fn().mockReturnValue(false),
    };
    const similarNoteCoordinator = {
        emitNoteBottomViewModelFromPath: vi.fn(),
        refreshCachedNoteMetadataFromPath: vi.fn().mockResolvedValue(true),
    };
    const settingsService = {
        get: vi
            .fn()
            .mockReturnValue({
                includeFrontmatter: false,
                excludeRegexPatterns: [],
            }),
    };
    const app = { workspace: { getActiveFile: vi.fn().mockReturnValue(null) } };
    const service = new NoteIndexingService(
        noteRepository as never,
        noteChunkRepository as never,
        queue as never,
        noteChunkingService as never,
        embeddingService as never,
        similarNoteCoordinator as never,
        settingsService as never,
        app as never,
        erroredStore as never // erroredNoteStore (new last param)
    );
    return {
        service,
        queue,
        erroredStore,
        noteRepository,
        noteChunkRepository,
        noteChunkingService,
        embeddingService,
        similarNoteCoordinator,
        settingsService,
        app,
    };
}

beforeEach(() => {
    vi.mocked(computeIndexableTextHash).mockReset();
    vi.mocked(computeIndexableTextHash).mockImplementation(
        async (content) => `hash:${content}`
    );
});

function makeChunk(content = "hello world") {
    const embeddedChunk = { path: "note.md", content, embedding: [0.25] };
    const chunk = {
        chunkIndex: 0,
        title: "Note",
        content,
        withEmbedding: vi.fn().mockReturnValue(embeddedChunk),
    };

    return { chunk, embeddedChunk };
}

describe("NoteIndexingService retry/errored transition (indexing-status spec §3)", () => {
    let change: NoteChange;
    beforeEach(() => {
        change = { path: "note.md", reason: "modified", mtime: 1234 };
    });

    test("first failure (< 3 attempts) re-enqueues with incremented attempts, not errored", async () => {
        const { service, queue, erroredStore } = makeService();
        await (service as unknown as FailureHandler).handleChangeFailure(
            change,
            new Error("boom")
        );
        expect(queue.requeue).toHaveBeenCalledWith({ ...change, attempts: 1 });
        expect(erroredStore.set).not.toHaveBeenCalled();
    });

    test("third failure moves the note to the terminal Errored state and stops re-queuing", async () => {
        const { service, queue, erroredStore } = makeService();
        const thirdAttempt = { ...change, attempts: 2 }; // about to become attempt #3
        await (service as unknown as FailureHandler).handleChangeFailure(
            thirdAttempt,
            new Error("too big")
        );
        expect(erroredStore.set).toHaveBeenCalledWith("note.md", {
            error: "too big",
            attempts: 3,
            mtime: 1234,
        });
        expect(queue.requeue).not.toHaveBeenCalled();
    });
});

describe("NoteIndexingService routes embedding failures through the attempts machinery (spec §5/§6, #45 regression)", () => {
    test("an embedding failure is retried and the note is NOT silently marked indexed", async () => {
        const {
            service,
            queue,
            noteRepository,
            noteChunkingService,
            embeddingService,
        } = makeService();

        noteRepository.findByPath.mockResolvedValue({
            path: "note.md",
            content: "hello world",
        });
        noteChunkingService.split.mockResolvedValue([
            {
                chunkIndex: 0,
                title: "Note",
                content: "hello world",
                withEmbedding: vi.fn(),
            },
        ]);
        // The exact failure shape the user hit: Ollama rejecting an over-long note.
        embeddingService.embedTexts.mockRejectedValue(
            new Error(
                'Failed to generate embedding: Internal Server Error. {"error":"the input length exceeds the context"}'
            )
        );

        const change: NoteChange = {
            path: "note.md",
            reason: "modified",
            mtime: 1234,
        };
        await (service as unknown as ChangeProcessor).processChange(change);

        // The failure must be routed to the retry machinery...
        expect(queue.requeue).toHaveBeenCalledWith({ ...change, attempts: 1 });
        // ...and the note must NOT be marked indexed (the #45 root cause: a
        // swallowed embedding error let a failed note be recorded as done).
        expect(queue.markNoteChangeProcessed).not.toHaveBeenCalled();
    });
});

describe("NoteIndexingService indexable-text hashing (#51)", () => {
    test("skips embedding and refreshes only cached active-note metadata when the hash matches", async () => {
        const {
            service,
            queue,
            noteRepository,
            noteChunkRepository,
            noteChunkingService,
            embeddingService,
            similarNoteCoordinator,
            app,
        } = makeService();
        const change: NoteChange = {
            path: "note.md",
            reason: "modified",
            mtime: 1234,
        };

        noteRepository.findByPath.mockResolvedValue({
            path: "note.md",
            content: "hello world",
        });
        queue.getIndexableTextHash.mockReturnValue("hash:hello world");
        app.workspace.getActiveFile.mockReturnValue({ path: "note.md" });

        await (service as unknown as ChangeProcessor).processChange(change);

        expect(computeIndexableTextHash).toHaveBeenCalledWith("hello world");
        expect(noteChunkingService.split).not.toHaveBeenCalled();
        expect(embeddingService.embedTexts).not.toHaveBeenCalled();
        expect(noteChunkRepository.removeByPath).not.toHaveBeenCalled();
        expect(noteChunkRepository.putMulti).not.toHaveBeenCalled();
        expect(
            similarNoteCoordinator.emitNoteBottomViewModelFromPath
        ).not.toHaveBeenCalled();
        expect(
            similarNoteCoordinator.refreshCachedNoteMetadataFromPath
        ).toHaveBeenCalledWith("note.md", 1234);
        expect(queue.markNoteChangeProcessed).toHaveBeenCalledWith(
            change,
            "hash:hello world"
        );
    });

    test.each([
        ["changed", "old-hash"],
        ["legacy hash missing", undefined],
    ])("embeds when the stored hash is %s", async (_label, storedHash) => {
        const {
            service,
            queue,
            noteRepository,
            noteChunkRepository,
            noteChunkingService,
            embeddingService,
        } = makeService();
        const change: NoteChange = {
            path: "note.md",
            reason: "modified",
            mtime: 1234,
        };
        const { chunk, embeddedChunk } = makeChunk();

        noteRepository.findByPath.mockResolvedValue({
            path: "note.md",
            content: "hello world",
        });
        queue.getIndexableTextHash.mockReturnValue(storedHash);
        noteChunkingService.split.mockResolvedValue([chunk]);
        embeddingService.embedTexts.mockResolvedValue([[0.25]]);

        await (service as unknown as ChangeProcessor).processChange(change);

        expect(noteChunkingService.split).toHaveBeenCalledWith({
            path: "note.md",
            content: "hello world",
        });
        expect(embeddingService.embedTexts).toHaveBeenCalledWith([
            "Note\n\nhello world",
        ]);
        expect(noteChunkRepository.removeByPath).toHaveBeenCalledWith(
            "note.md"
        );
        expect(noteChunkRepository.putMulti).toHaveBeenCalledWith([
            embeddedChunk,
        ]);
        expect(queue.markNoteChangeProcessed).toHaveBeenCalledWith(
            change,
            "hash:hello world"
        );
    });

    test("backfills a legacy hash so the next unchanged write skips embedding", async () => {
        const {
            service,
            queue,
            noteRepository,
            noteChunkingService,
            embeddingService,
        } = makeService();
        const { chunk } = makeChunk();
        let storedHash: string | undefined;

        noteRepository.findByPath.mockResolvedValue({
            path: "note.md",
            content: "hello world",
        });
        queue.getIndexableTextHash.mockImplementation(() => storedHash);
        queue.markNoteChangeProcessed.mockImplementation(
            async (_change, indexableTextHash) => {
                storedHash = indexableTextHash;
            }
        );
        noteChunkingService.split.mockResolvedValue([chunk]);
        embeddingService.embedTexts.mockResolvedValue([[0.25]]);

        await (service as unknown as ChangeProcessor).processChange({
            path: "note.md",
            reason: "modified",
            mtime: 1234,
        });
        await (service as unknown as ChangeProcessor).processChange({
            path: "note.md",
            reason: "modified",
            mtime: 1235,
        });

        expect(embeddingService.embedTexts).toHaveBeenCalledTimes(1);
        expect(noteChunkingService.split).toHaveBeenCalledTimes(1);
        expect(queue.markNoteChangeProcessed).toHaveBeenCalledTimes(2);
        expect(storedHash).toBe("hash:hello world");
    });

    test("hashes regex-filtered content and skips a regex-only change", async () => {
        const {
            service,
            queue,
            noteRepository,
            noteChunkRepository,
            noteChunkingService,
            embeddingService,
            settingsService,
        } = makeService();
        const change: NoteChange = {
            path: "note.md",
            reason: "modified",
            mtime: 1234,
        };

        settingsService.get.mockReturnValue({
            includeFrontmatter: false,
            excludeRegexPatterns: ["^secret:.*$"],
        });
        noteRepository.findByPath.mockResolvedValue({
            path: "note.md",
            content: "keep\nsecret: changed",
        });
        queue.getIndexableTextHash.mockReturnValue("hash:keep\n");

        await (service as unknown as ChangeProcessor).processChange(change);

        expect(computeIndexableTextHash).toHaveBeenCalledWith("keep\n");
        expect(noteChunkingService.split).not.toHaveBeenCalled();
        expect(embeddingService.embedTexts).not.toHaveBeenCalled();
        expect(noteChunkRepository.removeByPath).not.toHaveBeenCalled();
        expect(queue.markNoteChangeProcessed).toHaveBeenCalledWith(
            change,
            "hash:keep\n"
        );
    });

    test.each([
        {
            includeFrontmatter: false,
            currentContent: "body",
            storedHash: "hash:body",
            readWithoutFrontmatter: true,
            shouldEmbed: false,
        },
        {
            includeFrontmatter: true,
            currentContent: "---\ntitle: New\n---\nbody",
            storedHash: "hash:---\ntitle: Old\n---\nbody",
            readWithoutFrontmatter: false,
            shouldEmbed: true,
        },
    ])(
        "handles a frontmatter-only write when includeFrontmatter=$includeFrontmatter",
        async ({
            includeFrontmatter,
            currentContent,
            storedHash,
            readWithoutFrontmatter,
            shouldEmbed,
        }) => {
            const {
                service,
                queue,
                noteRepository,
                noteChunkingService,
                embeddingService,
                settingsService,
            } = makeService();
            const change: NoteChange = {
                path: "note.md",
                reason: "modified",
                mtime: 1234,
            };
            const { chunk } = makeChunk(currentContent);

            settingsService.get.mockReturnValue({
                includeFrontmatter,
                excludeRegexPatterns: [],
            });
            noteRepository.findByPath.mockResolvedValue({
                path: "note.md",
                content: currentContent,
            });
            queue.getIndexableTextHash.mockReturnValue(storedHash);
            noteChunkingService.split.mockResolvedValue([chunk]);
            embeddingService.embedTexts.mockResolvedValue([[0.25]]);

            await (service as unknown as ChangeProcessor).processChange(change);

            expect(noteRepository.findByPath).toHaveBeenCalledWith(
                "note.md",
                readWithoutFrontmatter
            );
            expect(computeIndexableTextHash).toHaveBeenCalledWith(
                currentContent
            );
            expect(embeddingService.embedTexts).toHaveBeenCalledTimes(
                shouldEmbed ? 1 : 0
            );
            expect(queue.markNoteChangeProcessed).toHaveBeenCalledWith(
                change,
                `hash:${currentContent}`
            );
        }
    );

    test("removes stale chunks without embedding when filtered content is empty", async () => {
        const {
            service,
            queue,
            noteRepository,
            noteChunkRepository,
            noteChunkingService,
            embeddingService,
            similarNoteCoordinator,
            settingsService,
            app,
        } = makeService();
        const change: NoteChange = {
            path: "note.md",
            reason: "modified",
            mtime: 1234,
        };

        settingsService.get.mockReturnValue({
            includeFrontmatter: false,
            excludeRegexPatterns: [".+"],
        });
        noteRepository.findByPath.mockResolvedValue({
            path: "note.md",
            content: "remove all of this",
        });
        queue.getIndexableTextHash.mockReturnValue("old-hash");
        app.workspace.getActiveFile.mockReturnValue({ path: "note.md" });

        await (service as unknown as ChangeProcessor).processChange(change);

        expect(computeIndexableTextHash).toHaveBeenCalledWith("");
        expect(noteChunkingService.split).not.toHaveBeenCalled();
        expect(embeddingService.embedTexts).not.toHaveBeenCalled();
        expect(noteChunkRepository.removeByPath).toHaveBeenCalledWith(
            "note.md"
        );
        expect(
            similarNoteCoordinator.emitNoteBottomViewModelFromPath
        ).toHaveBeenCalledWith("note.md");
        expect(queue.markNoteChangeProcessed).toHaveBeenCalledWith(
            change,
            "hash:"
        );
    });

    test("removes stale chunks without embedding when the splitter returns no chunks", async () => {
        const {
            service,
            queue,
            noteRepository,
            noteChunkRepository,
            noteChunkingService,
            embeddingService,
            similarNoteCoordinator,
            app,
        } = makeService();
        const change: NoteChange = {
            path: "note.md",
            reason: "modified",
            mtime: 1234,
        };

        noteRepository.findByPath.mockResolvedValue({
            path: "note.md",
            content: "non-empty",
        });
        queue.getIndexableTextHash.mockReturnValue("old-hash");
        noteChunkingService.split.mockResolvedValue([]);
        app.workspace.getActiveFile.mockReturnValue({ path: "note.md" });

        await (service as unknown as ChangeProcessor).processChange(change);

        expect(embeddingService.embedTexts).not.toHaveBeenCalled();
        expect(noteChunkRepository.removeByPath).toHaveBeenCalledWith(
            "note.md"
        );
        expect(
            similarNoteCoordinator.emitNoteBottomViewModelFromPath
        ).toHaveBeenCalledWith("note.md");
        expect(queue.markNoteChangeProcessed).toHaveBeenCalledWith(
            change,
            "hash:non-empty"
        );
    });

    test("forceReindex bypasses a matching hash", async () => {
        const {
            service,
            queue,
            noteRepository,
            noteChunkRepository,
            noteChunkingService,
            embeddingService,
        } = makeService();
        const change: NoteChange = {
            path: "note.md",
            reason: "modified",
            mtime: 1234,
            forceReindex: true,
        };
        const { chunk } = makeChunk();

        noteRepository.findByPath.mockResolvedValue({
            path: "note.md",
            content: "hello world",
        });
        queue.getIndexableTextHash.mockReturnValue("hash:hello world");
        noteChunkingService.split.mockResolvedValue([chunk]);
        embeddingService.embedTexts.mockResolvedValue([[0.25]]);

        await (service as unknown as ChangeProcessor).processChange(change);

        expect(embeddingService.embedTexts).toHaveBeenCalledOnce();
        expect(noteChunkRepository.putMulti).toHaveBeenCalledOnce();
        expect(queue.markNoteChangeProcessed).toHaveBeenCalledWith(
            change,
            "hash:hello world"
        );
    });

    test("a hash failure is retried and never marked processed", async () => {
        const { service, queue, noteRepository, noteChunkingService } =
            makeService();
        const change: NoteChange = {
            path: "note.md",
            reason: "modified",
            mtime: 1234,
        };

        noteRepository.findByPath.mockResolvedValue({
            path: "note.md",
            content: "hello world",
        });
        vi.mocked(computeIndexableTextHash).mockRejectedValue(
            new Error("hash failed")
        );

        await (service as unknown as ChangeProcessor).processChange(change);

        expect(noteChunkingService.split).not.toHaveBeenCalled();
        expect(queue.requeue).toHaveBeenCalledWith({ ...change, attempts: 1 });
        expect(queue.markNoteChangeProcessed).not.toHaveBeenCalled();
    });

    test("clears the stored hash before mutating chunks so a failed write cannot leave a matching hash with no chunks", async () => {
        const {
            service,
            queue,
            noteRepository,
            noteChunkRepository,
            noteChunkingService,
            embeddingService,
        } = makeService();
        const change: NoteChange = {
            path: "note.md",
            reason: "modified",
            mtime: 1234,
        };
        const { chunk } = makeChunk();
        const callOrder: string[] = [];

        noteRepository.findByPath.mockResolvedValue({
            path: "note.md",
            content: "hello world",
        });
        queue.getIndexableTextHash.mockReturnValue("old-hash");
        noteChunkingService.split.mockResolvedValue([chunk]);
        embeddingService.embedTexts.mockResolvedValue([[0.25]]);
        queue.clearIndexableTextHash.mockImplementation(async () => {
            callOrder.push("clearHash");
        });
        noteChunkRepository.removeByPath.mockImplementation(async () => {
            callOrder.push("removeByPath");
        });
        noteChunkRepository.putMulti.mockImplementation(async () => {
            callOrder.push("putMulti");
            throw new Error("write failed");
        });

        await (service as unknown as ChangeProcessor).processChange(change);

        // The hash must be gone BEFORE any chunk mutation: if putMulti fails
        // and the user later reverts to previously-indexed content, a
        // surviving hash would match and skip re-embedding a note whose
        // chunks were already removed (permanently absent from search).
        expect(callOrder).toEqual(["clearHash", "removeByPath", "putMulti"]);
        expect(queue.markNoteChangeProcessed).not.toHaveBeenCalled();
    });

    test("skipping via a matching hash does not clear the stored hash", async () => {
        const { service, queue, noteRepository } = makeService();

        noteRepository.findByPath.mockResolvedValue({
            path: "note.md",
            content: "hello world",
        });
        queue.getIndexableTextHash.mockReturnValue("hash:hello world");

        await (service as unknown as ChangeProcessor).processChange({
            path: "note.md",
            reason: "modified",
            mtime: 1234,
        });

        expect(queue.clearIndexableTextHash).not.toHaveBeenCalled();
    });

    test("a note that vanished before processing is not marked processed (no ghost entry, hash preserved)", async () => {
        const { service, queue, noteRepository, erroredStore } = makeService();
        const change: NoteChange = {
            path: "note.md",
            reason: "modified",
            mtime: 1234,
        };

        // The file was deleted between queueing and processing.
        noteRepository.findByPath.mockResolvedValue(null);

        await (service as unknown as ChangeProcessor).processChange(change);

        // Marking would setMetadata(path, mtime, undefined): erase the stored
        // hash and keep a ghost "indexed" entry for a file that no longer
        // exists. The delete change owns the metadata cleanup.
        expect(queue.markNoteChangeProcessed).not.toHaveBeenCalled();
        expect(queue.requeue).not.toHaveBeenCalled();
        expect(erroredStore.set).not.toHaveBeenCalled();
    });

    test("a chunk repository failure is retried and never marked processed", async () => {
        const {
            service,
            queue,
            noteRepository,
            noteChunkRepository,
            noteChunkingService,
            embeddingService,
        } = makeService();
        const change: NoteChange = {
            path: "note.md",
            reason: "modified",
            mtime: 1234,
        };
        const { chunk } = makeChunk();

        noteRepository.findByPath.mockResolvedValue({
            path: "note.md",
            content: "hello world",
        });
        noteChunkingService.split.mockResolvedValue([chunk]);
        embeddingService.embedTexts.mockResolvedValue([[0.25]]);
        noteChunkRepository.putMulti.mockRejectedValue(
            new Error("repository failed")
        );

        await (service as unknown as ChangeProcessor).processChange(change);

        expect(queue.requeue).toHaveBeenCalledWith({ ...change, attempts: 1 });
        expect(queue.markNoteChangeProcessed).not.toHaveBeenCalled();
    });

    test("persists a fresh hash when rename fallback must embed", async () => {
        const {
            service,
            queue,
            noteRepository,
            noteChunkRepository,
            noteChunkingService,
            embeddingService,
        } = makeService();
        const change: NoteChange = {
            path: "new.md",
            oldPath: "old.md",
            reason: "renamed",
            mtime: 1234,
        };
        const { chunk } = makeChunk("renamed content");

        noteRepository.findByPath.mockResolvedValue({
            path: "new.md",
            content: "renamed content",
        });
        noteChunkRepository.renamePath.mockResolvedValue(false);
        noteChunkingService.split.mockResolvedValue([chunk]);
        embeddingService.embedTexts.mockResolvedValue([[0.25]]);

        await (service as unknown as ChangeProcessor).processChange(change);

        expect(queue.markNoteChangeProcessed).toHaveBeenCalledWith(
            change,
            "hash:renamed content"
        );
    });

    test("leaves hash carrying to the queue after a pure rename", async () => {
        const { service, queue, noteChunkRepository } = makeService();
        const change: NoteChange = {
            path: "new.md",
            oldPath: "old.md",
            reason: "renamed",
            mtime: 1234,
        };

        noteChunkRepository.renamePath.mockResolvedValue(true);

        await (service as unknown as ChangeProcessor).processChange(change);

        expect(computeIndexableTextHash).not.toHaveBeenCalled();
        expect(queue.getIndexableTextHash).not.toHaveBeenCalled();
        expect(queue.markNoteChangeProcessed).toHaveBeenCalledWith(
            change,
            undefined
        );
    });
});

describe("frontmatter exclusion at processing time (frontmatter-exclusion spec §2)", () => {
    // Simulate a warm metadataCache for a file carrying the exclusion tag.
    function armExclusion(
        mocks: ReturnType<typeof makeService>,
        excludedPaths: string[]
    ) {
        mocks.settingsService.get.mockReturnValue({
            includeFrontmatter: false,
            excludeRegexPatterns: [],
            excludeFrontmatterRules: ["tags: noindex"],
        });
        const appMock = mocks.app as unknown as {
            vault: { getFileByPath: ReturnType<typeof vi.fn> };
            metadataCache: { getFileCache: ReturnType<typeof vi.fn> };
        };
        appMock.vault = {
            getFileByPath: vi.fn((path: string) => ({ path })),
        };
        appMock.metadataCache = {
            getFileCache: vi.fn((file: { path: string }) =>
                excludedPaths.includes(file.path)
                    ? { frontmatter: { tags: ["noindex"] } }
                    : null
            ),
        };
    }

    test("a modified note that is frontmatter-excluded is removed from the index instead of embedded", async () => {
        const mocks = makeService();
        const { service, queue, noteChunkRepository, embeddingService, noteRepository } =
            mocks;
        armExclusion(mocks, ["note.md"]);

        const change: NoteChange = {
            path: "note.md",
            reason: "modified",
            mtime: 1000,
        };
        await (service as unknown as ChangeProcessor).processChange(change);

        expect(noteChunkRepository.removeByPath).toHaveBeenCalledWith("note.md");
        expect(embeddingService.embedTexts).not.toHaveBeenCalled();
        expect(noteRepository.findByPath).not.toHaveBeenCalled();
        // Metadata is dropped like a deletion, so the note leaves the mtime store.
        expect(queue.markNoteChangeProcessed).toHaveBeenCalledWith({
            path: "note.md",
            reason: "deleted",
        });
    });

    test("a renamed note that is frontmatter-excluded drops chunks and metadata for BOTH paths", async () => {
        const mocks = makeService();
        const { service, queue, noteChunkRepository } = mocks;
        armExclusion(mocks, ["new.md"]);

        const change: NoteChange = {
            path: "new.md",
            oldPath: "old.md",
            reason: "renamed",
            mtime: 1000,
        };
        await (service as unknown as ChangeProcessor).processChange(change);

        expect(noteChunkRepository.removeByPath).toHaveBeenCalledWith("new.md");
        expect(noteChunkRepository.removeByPath).toHaveBeenCalledWith("old.md");
        expect(queue.markNoteChangeProcessed).toHaveBeenCalledWith({
            path: "old.md",
            reason: "deleted",
        });
        expect(queue.markNoteChangeProcessed).toHaveBeenCalledWith({
            path: "new.md",
            reason: "deleted",
        });
    });

    test("a note without matching frontmatter still goes through normal processing", async () => {
        const mocks = makeService();
        const { service, noteRepository } = mocks;
        armExclusion(mocks, []); // rules configured, but this file has no frontmatter
        noteRepository.findByPath.mockResolvedValue(null);

        const change: NoteChange = {
            path: "note.md",
            reason: "modified",
            mtime: 1000,
        };
        await (service as unknown as ChangeProcessor).processChange(change);

        expect(noteRepository.findByPath).toHaveBeenCalled();
    });

    test("a prior errored entry is cleared when the note is now excluded", async () => {
        const mocks = makeService();
        const { service, erroredStore } = mocks;
        armExclusion(mocks, ["note.md"]);
        erroredStore.get.mockReturnValue({ error: "boom" });

        const change: NoteChange = {
            path: "note.md",
            reason: "modified",
            mtime: 1000,
        };
        await (service as unknown as ChangeProcessor).processChange(change);

        expect(erroredStore.delete).toHaveBeenCalledWith("note.md");
    });
});
