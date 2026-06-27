import { describe, expect, test, vi } from "vitest";
import { embedInBatches, splitIntoBatches } from "../batching";

describe("splitIntoBatches: bound a single embedding forward pass (builtin-embedding-batch-cap spec)", () => {
    test("returns one batch when the count is below the cap", () => {
        expect(splitIntoBatches([1, 2, 3], 32)).toEqual([[1, 2, 3]]);
    });

    test("returns one batch when the count exactly equals the cap", () => {
        const items = Array.from({ length: 32 }, (_, i) => i);
        expect(splitIntoBatches(items, 32)).toEqual([items]);
    });

    test("splits into consecutive batches, the last one holding the remainder", () => {
        const items = Array.from({ length: 70 }, (_, i) => i);
        const batches = splitIntoBatches(items, 32);

        expect(batches.map((b) => b.length)).toEqual([32, 32, 6]);
        // Order is preserved across the split (flattening rebuilds the input).
        expect(batches.flat()).toEqual(items);
    });

    test("an empty input yields no batches", () => {
        expect(splitIntoBatches([], 32)).toEqual([]);
    });

    test("rejects a non-positive cap (would loop forever / produce empty batches)", () => {
        expect(() => splitIntoBatches([1, 2], 0)).toThrow();
        expect(() => splitIntoBatches([1, 2], -4)).toThrow();
    });

    test("rejects a non-integer cap", () => {
        expect(() => splitIntoBatches([1, 2], 2.5)).toThrow();
    });
});

describe("embedInBatches: embed in bounded, sequential sub-batches preserving order", () => {
    test("concatenates each sub-batch's embeddings in input order", async () => {
        const texts = Array.from({ length: 70 }, (_, i) => `t${i}`);
        // Each text maps to a 1-d embedding equal to its index, so a misordered
        // concat is detectable.
        const embedBatch = async (batch: string[]) =>
            batch.map((t) => [Number(t.slice(1))]);

        const result = await embedInBatches(texts, 32, embedBatch);

        expect(result).toEqual(texts.map((_, i) => [i]));
    });

    test("calls embedBatch once per sub-batch with that sub-batch's slice", async () => {
        const calls: number[][] = [];
        const embedBatch = async (batch: number[]) => {
            calls.push(batch);
            return batch.map(() => [0]);
        };

        await embedInBatches([1, 2, 3, 4, 5], 2, embedBatch);

        expect(calls).toEqual([[1, 2], [3, 4], [5]]);
    });

    test("runs sub-batches sequentially so peak is one sub-batch, not the whole input", async () => {
        let active = 0;
        let maxActive = 0;
        const embedBatch = async (batch: number[]) => {
            active++;
            maxActive = Math.max(maxActive, active);
            await Promise.resolve();
            active--;
            return batch.map(() => [0]);
        };

        await embedInBatches(
            Array.from({ length: 70 }, (_, i) => i),
            32,
            embedBatch
        );

        expect(maxActive).toBe(1);
    });

    test("an empty input returns [] without calling embedBatch", async () => {
        const embedBatch = vi.fn(async (batch: number[]) =>
            batch.map(() => [0])
        );

        expect(await embedInBatches([], 32, embedBatch)).toEqual([]);
        expect(embedBatch).not.toHaveBeenCalled();
    });

    test("propagates a rejection from embedBatch (so a wasm abort still surfaces)", async () => {
        const embedBatch = async () => {
            throw new Error("wasm abort");
        };

        await expect(
            embedInBatches(["a", "b"], 32, embedBatch)
        ).rejects.toThrow("wasm abort");
    });
});
