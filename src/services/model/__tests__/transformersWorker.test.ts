import path from "node:path";
import { Worker } from "node:worker_threads";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

describe("TransformersWorker", () => {
    let worker: Worker;

    beforeEach(async () => {
        // First build the worker
        await new Promise<void>((resolve, reject) => {
            const { build } = require("esbuild");
            build({
                entryPoints: [
                    path.resolve(__dirname, "../transformersWorker.ts"),
                ],
                bundle: true,
                outfile: path.resolve(
                    __dirname,
                    "../transformersWorker.build.js"
                ),
                format: "cjs",
                platform: "node",
                target: "node16",
            })
                .then(() => resolve())
                .catch(reject);
        });

        // Then create the worker with the built file
        worker = new Worker(
            path.resolve(__dirname, "../transformersWorker.build.js")
        );
    });

    afterEach(async () => {
        await worker.terminate();
    });

    it("should load the model successfully and return vector size", async () => {
        await new Promise<void>((resolve) => {
            worker.on("message", (response) => {
                expect(response).toEqual({
                    type: "success",
                    data: {
                        message: "Model loaded successfully",
                        vectorSize: 384, // Mock vector size
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
    }, 10000); // Increase timeout to 10 seconds

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
});
