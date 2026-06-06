import { describe, expect, test, vi, beforeEach } from "vitest";
import { NoteIndexingService } from "../NoteIndexingService";
import type { NoteChange } from "@/services/noteChangeQueue";

interface FailureHandler {
    handleChangeFailure: (c: NoteChange, e: unknown) => Promise<void>;
}

// Minimal mocks — we only exercise the failure-handling transition.
function makeService() {
    const queue = { requeue: vi.fn() };
    const erroredStore = {
        set: vi.fn().mockResolvedValue(undefined),
        get: vi.fn(),
        delete: vi.fn().mockResolvedValue(undefined),
    };
    const service = new NoteIndexingService(
        {} as never, // noteRepository
        {} as never, // noteChunkRepository
        queue as never, // noteChangeQueue
        {} as never, // noteChunkingService
        {} as never, // embeddingService
        {} as never, // similarNoteCoordinator
        {} as never, // settingsService
        {} as never, // app
        erroredStore as never // erroredNoteStore (new last param)
    );
    return { service, queue, erroredStore };
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
