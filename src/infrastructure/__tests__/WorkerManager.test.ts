import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock Comlink so initialize() can resolve without a real worker round-trip.
// `wrap` returns a constructor whose instance resolves to a fake remote proxy
// carrying the releaseProxy symbol method.
const { releaseProxySymbol } = vi.hoisted(() => ({
    releaseProxySymbol: Symbol("releaseProxy"),
}));

vi.mock("comlink", () => ({
    releaseProxy: releaseProxySymbol,
    wrap: vi.fn((_rawWorker: unknown) => {
        // Return a fake "WorkerWrapper" constructor.
        return function WorkerWrapper() {
            return Promise.resolve({
                [releaseProxySymbol]: vi.fn(),
            });
        };
    }),
}));

import { WorkerManager } from "../WorkerManager";

// Minimal fake Worker that records terminate() calls.
function createFakeWorkerClass() {
    const terminate = vi.fn();
    class FakeWorker {
        terminate = terminate;
        postMessage = vi.fn();
        addEventListener = vi.fn();
        removeEventListener = vi.fn();
    }
    return { FakeWorker, terminate };
}

describe("WorkerManager worker lifecycle (issue #8 — built-in model memory leak)", () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it("terminates the underlying worker thread on dispose()", async () => {
        const { FakeWorker, terminate } = createFakeWorkerClass();
        const manager = new WorkerManager("TestWorker");

        await manager.initialize(FakeWorker as unknown as new () => Worker);
        expect(terminate).not.toHaveBeenCalled();

        await manager.dispose();

        // The raw worker thread (which holds the ML model) must be terminated,
        // otherwise repeated plugin reloads accumulate live workers in memory.
        expect(terminate).toHaveBeenCalledTimes(1);
    });

    it("terminates the previous worker when re-initialized", async () => {
        const { FakeWorker, terminate } = createFakeWorkerClass();
        const manager = new WorkerManager("TestWorker");

        await manager.initialize(FakeWorker as unknown as new () => Worker);
        await manager.initialize(FakeWorker as unknown as new () => Worker);

        // Re-initializing disposes the prior worker, which must terminate it.
        expect(terminate).toHaveBeenCalledTimes(1);

        await manager.dispose();
        expect(terminate).toHaveBeenCalledTimes(2);
    });
});
