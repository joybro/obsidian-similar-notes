import { beforeEach, describe, expect, it, vi } from "vitest";

const storageMocks = vi.hoisted(() => ({
    init: vi.fn(),
    clear: vi.fn(),
    loadInBatches: vi.fn(async () => undefined),
}));

vi.mock("@/infrastructure/IndexedDBChunkStorage", () => ({
    IndexedDBChunkStorage: class {
        init = storageMocks.init;
        clear = storageMocks.clear;
        loadInBatches = storageMocks.loadInBatches;
    },
}));

import { OramaWorker } from "../OramaDatabase";

describe("OramaWorker namespaces", () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it("preserves the default storage namespace", async () => {
        const worker = new OramaWorker();

        await worker.init(384, "test-vault", true);

        expect(storageMocks.init).toHaveBeenCalledWith(
            "test-vault",
            undefined
        );
    });

    it("forwards a code namespace to storage", async () => {
        const worker = new OramaWorker();

        await worker.init(768, "test-vault", true, "code");

        expect(storageMocks.init).toHaveBeenCalledWith("test-vault", "code");
    });
});
