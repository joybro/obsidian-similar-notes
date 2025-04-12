import path from "node:path";
import { Worker } from "node:worker_threads";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

describe("TransformersWorker", () => {
    let worker: Worker;

    beforeEach(async () => {
        // Create the worker directly with the source file
        worker = new Worker(
            path.resolve(__dirname, "../../../../public/transformers.worker.js")
        );
        worker.on("error", (error) => {
            console.error("Worker error:", error);
        });
    });

    afterEach(async () => {
        if (worker) {
            await worker.terminate();
        }
    });

    it("should load the model successfully and return vector size and max tokens", async () => {
        await new Promise<void>((resolve) => {
            worker.on("message", (response) => {
                expect(response).toEqual({
                    type: "success",
                    data: {
                        message: "Model loaded successfully",
                        vectorSize: 384, // Mock vector size
                        maxTokens: 512, // Mock max tokens
                    },
                });
                resolve();
            });

            worker.postMessage({
                type: "load",
                modelId: "sentence-transformers/all-MiniLM-L6-v2",
            });
        });
    });

    it("should handle embed_batch after model is loaded", async () => {
        const texts = ["Hello world", "Test sentence"];
        let loadComplete = false;

        await new Promise<void>((resolve) => {
            worker.on("message", (response) => {
                if (!loadComplete) {
                    loadComplete = true;
                    expect(response.data).toEqual({
                        message: "Model loaded successfully",
                        vectorSize: 384, // Mock vector size
                        maxTokens: 512, // Mock max tokens
                    });
                    worker.postMessage({
                        type: "embed_batch",
                        texts,
                    });
                } else {
                    expect(response.type).toBe("success");
                    expect(Array.isArray(response.data)).toBe(true);
                    expect(response.data.length).toBe(texts.length);
                    // Verify each embedding has the correct size
                    for (const embedding of response.data as number[][]) {
                        expect(embedding.length).toBe(384); // Mock vector size
                    }
                    resolve();
                }
            });

            worker.postMessage({
                type: "load",
                modelId: "sentence-transformers/all-MiniLM-L6-v2",
            });
        });
    });

    it("should handle unload successfully", async () => {
        await new Promise<void>((resolve) => {
            worker.on("message", (response) => {
                expect(response).toEqual({
                    type: "success",
                    data: "Model unloaded successfully",
                });
                resolve();
            });

            worker.postMessage({ type: "unload" });
        });
    });

    it("should return error when embedding without loading model first", async () => {
        await new Promise<void>((resolve) => {
            worker.on("message", (response) => {
                expect(response).toEqual({
                    type: "error",
                    error: "Model not loaded",
                });
                resolve();
            });

            worker.postMessage({
                type: "embed_batch",
                texts: ["Test"],
            });
        });
    });

    it("should count tokens correctly after model is loaded", async () => {
        // First load the model
        await new Promise<void>((resolve) => {
            let firstResponse = true;

            worker.on("message", (response) => {
                if (firstResponse) {
                    expect(response.data).toEqual({
                        message: "Model loaded successfully",
                        vectorSize: 384,
                        maxTokens: 512,
                    });
                    firstResponse = false;

                    // Send token count request after model is loaded
                    worker.postMessage({
                        type: "count_token",
                        text: "Hello world! This is a test sentence.",
                    });
                } else {
                    // Check token count response
                    expect(response.type).toBe("success");
                    expect(typeof response.data).toBe("number");
                    expect(response.data).toBeGreaterThan(0);
                    resolve();
                }
            });

            worker.postMessage({
                type: "load",
                modelId: "sentence-transformers/all-MiniLM-L6-v2",
            });
        });
    });

    it("should return error when counting tokens without loading model first", async () => {
        await new Promise<void>((resolve) => {
            worker.on("message", (response) => {
                expect(response).toEqual({
                    type: "error",
                    error: "Model not loaded",
                });
                resolve();
            });

            worker.postMessage({
                type: "count_token",
                text: "Test",
            });
        });
    });
});
