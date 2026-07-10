import type { Vault } from "obsidian";
import { beforeEach, describe, expect, it, vi } from "vitest";

const workerMocks = vi.hoisted(() => {
    const init = vi.fn();

    return {
        init,
        initialize: vi.fn(async () => ({ init })),
    };
});

vi.mock("@/infrastructure/WorkerManager", () => ({
    WorkerManager: class {
        initialize = workerMocks.initialize;
    },
}));

vi.mock("../orama.worker", () => ({
    default: class {},
}));

import { OramaNoteChunkRepository } from "../OramaNoteChunkRepository";

describe("OramaNoteChunkRepository namespaces", () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it("preserves the default worker initialization API", async () => {
        const repository = new OramaNoteChunkRepository({} as Vault);

        await repository.init(384, "test-vault", true);

        expect(workerMocks.init).toHaveBeenCalledWith(
            384,
            "test-vault",
            true,
            undefined
        );
    });

    it("forwards a code namespace to the worker", async () => {
        const repository = new OramaNoteChunkRepository({} as Vault, "code");

        await repository.init(768, "test-vault", false);

        expect(workerMocks.init).toHaveBeenCalledWith(
            768,
            "test-vault",
            false,
            "code"
        );
    });
});
