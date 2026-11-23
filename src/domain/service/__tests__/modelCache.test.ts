import { isModelCached } from "@/domain/service/modelCache";
import { describe, expect, it } from "vitest";

// A CacheStorage holding the given URLs under transformers.js's cache name.
function storage(urls: string[], name = "transformers-cache"): CacheStorage {
    const cache = {
        keys: async () => urls.map((url) => ({ url }) as Request),
    } as unknown as Cache;
    return {
        open: async (key: string) =>
            key === name
                ? cache
                : ({ keys: async () => [] } as unknown as Cache),
    } as unknown as CacheStorage;
}

const base = "https://huggingface.co/sentence-transformers/all-MiniLM-L6-v2/resolve/main";

describe("isModelCached", () => {
    it("is true when the model's ONNX weights are in the cache", async () => {
        const caches = storage([`${base}/config.json`, `${base}/onnx/model.onnx`]);
        expect(await isModelCached("sentence-transformers/all-MiniLM-L6-v2", caches)).toBe(true);
    });

    it("is false when only small files of the model are cached", async () => {
        const caches = storage([`${base}/config.json`, `${base}/tokenizer.json`]);
        expect(await isModelCached("sentence-transformers/all-MiniLM-L6-v2", caches)).toBe(false);
    });

    it("does not count weights of another precision", async () => {
        // The worker loads fp32 (onnx/model.onnx). Another plugin sharing the
        // app's cache may have fetched only the quantized file.
        const caches = storage([`${base}/config.json`, `${base}/onnx/model_quantized.onnx`]);
        expect(await isModelCached("sentence-transformers/all-MiniLM-L6-v2", caches)).toBe(false);
    });

    it("does not count another model's weights", async () => {
        const caches = storage([`${base}/onnx/model.onnx`]);
        expect(await isModelCached("sentence-transformers/all-MiniLM-L12-v2", caches)).toBe(false);
        // A model whose id is a prefix of the cached one is a different model.
        expect(await isModelCached("sentence-transformers/all-MiniLM-L6", caches)).toBe(false);
    });

    it("is false without a cache or when the cache cannot be read", async () => {
        expect(await isModelCached("sentence-transformers/all-MiniLM-L6-v2", undefined)).toBe(false);
        const broken = {
            open: async () => {
                throw new Error("denied");
            },
        } as unknown as CacheStorage;
        expect(await isModelCached("sentence-transformers/all-MiniLM-L6-v2", broken)).toBe(false);
    });
});
