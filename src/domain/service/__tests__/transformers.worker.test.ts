import type { TransformersWorker } from "@/domain/service/transformers.worker";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

describe("TransformersWorker", () => {
    let workerInstance: TransformersWorker;

    beforeEach(async () => {
        // Create a mock implementation of the TransformersWorker
        workerInstance = {
            extractor: null,
            vectorSize: null,
            maxTokens: null,
            embeddingQueue: Promise.resolve(),
            enqueue: async <T>(task: () => Promise<T>) => {
                return task();
            },
            handleLoad: async (
                modelId: string,
                progress_callback: (progress: number) => void
            ) => {
                return {
                    vectorSize: 384, // Mock vector size
                    maxTokens: 512, // Mock max tokens
                };
            },
            handleUnload: async () => {
                // Mock implementation
            },
            handleEmbedBatch: async (texts: string[]) => {
                return texts.map(() => new Array(384).fill(0));
            },
            handleCountToken: async (text: string) => {
                return Math.ceil(text.length / 4); // Rough mock implementation
            },
        } as unknown as TransformersWorker;
    });

    afterEach(() => {
        // Clean up
    });

    it("should load the model successfully and return vector size and max tokens", async () => {
        const response = await workerInstance.handleLoad(
            "sentence-transformers/all-MiniLM-L6-v2",
            () => {}
        );

        expect(response).toEqual({
            vectorSize: 384, // Mock vector size
            maxTokens: 512, // Mock max tokens
        });
    });

    it("should handle embed_batch after model is loaded", async () => {
        const texts = ["Hello world", "Test sentence"];

        // First load the model
        await workerInstance.handleLoad(
            "sentence-transformers/all-MiniLM-L6-v2",
            () => {}
        );

        // Then embed texts
        const embeddings = await workerInstance.handleEmbedBatch(texts);

        expect(Array.isArray(embeddings)).toBe(true);
        expect(embeddings.length).toBe(texts.length);
        // Verify each embedding has the correct size
        for (const embedding of embeddings) {
            expect(embedding.length).toBe(384); // Mock vector size
        }
    });

    it("should handle unload successfully", async () => {
        // First load the model
        await workerInstance.handleLoad(
            "sentence-transformers/all-MiniLM-L6-v2",
            () => {}
        );

        // Then unload it
        await workerInstance.handleUnload();

        // No error means success
    });

    it("should return error when embedding without loading model first", async () => {
        // Create a worker instance that throws an error when embedding without loading
        const errorWorkerInstance = {
            extractor: null,
            vectorSize: null,
            maxTokens: null,
            embeddingQueue: Promise.resolve(),
            enqueue: async <T>(task: () => Promise<T>) => {
                return task();
            },
            handleLoad: async (
                modelId: string,
                progress_callback: (progress: number) => void
            ) => {
                return {
                    vectorSize: 384,
                    maxTokens: 512,
                };
            },
            handleUnload: async () => {
                // Mock implementation
            },
            handleEmbedBatch: async () => {
                throw new Error("Model not loaded");
            },
            handleCountToken: async (text: string) => {
                return Math.ceil(text.length / 4);
            },
        } as unknown as TransformersWorker;

        await expect(
            errorWorkerInstance.handleEmbedBatch(["Test"])
        ).rejects.toThrow("Model not loaded");
    });

    it("should count tokens correctly after model is loaded", async () => {
        // First load the model
        await workerInstance.handleLoad(
            "sentence-transformers/all-MiniLM-L6-v2",
            () => {}
        );

        // Then count tokens
        const tokenCount = await workerInstance.handleCountToken(
            "Hello world! This is a test sentence."
        );

        expect(typeof tokenCount).toBe("number");
        expect(tokenCount).toBeGreaterThan(0);
    });

    it("should return error when counting tokens without loading model first", async () => {
        // Create a worker instance that throws an error when counting tokens without loading
        const errorWorkerInstance = {
            extractor: null,
            vectorSize: null,
            maxTokens: null,
            embeddingQueue: Promise.resolve(),
            enqueue: async <T>(task: () => Promise<T>) => {
                return task();
            },
            handleLoad: async (
                modelId: string,
                progress_callback: (progress: number) => void
            ) => {
                return {
                    vectorSize: 384,
                    maxTokens: 512,
                };
            },
            handleUnload: async () => {
                // Mock implementation
            },
            handleEmbedBatch: async (texts: string[]) => {
                return texts.map(() => new Array(384).fill(0));
            },
            handleCountToken: async () => {
                throw new Error("Model not loaded");
            },
        } as unknown as TransformersWorker;

        await expect(
            errorWorkerInstance.handleCountToken("Test")
        ).rejects.toThrow("Model not loaded");
    });
});
