import { describe, expect, test, vi, beforeEach } from "vitest";
import { NoteIndexingService } from "../NoteIndexingService";
import type { NoteChange } from "@/services/noteChangeQueue";

// The user-facing failure Notice is a side-effect, not part of the routing
// contract. Stub it so the test exercises the real propagation path (in real
// Obsidian the Notice shows and does NOT throw — without this stub the unmocked
// Notice would throw and mask whether the embedding error actually propagates).
vi.mock("@/utils/errorHandling", async (importOriginal) => ({
    ...(await importOriginal<typeof import("@/utils/errorHandling")>()),
    showNoteErrorNotice: vi.fn(),
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
    };
    const noteChunkingService = { split: vi.fn() };
    const embeddingService = {
        embedTexts: vi.fn(),
        supportsParallelProcessing: vi.fn().mockReturnValue(false),
    };
    const similarNoteCoordinator = {
        emitNoteBottomViewModelFromPath: vi.fn(),
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
        noteChunkingService,
        embeddingService,
    };
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
