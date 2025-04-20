import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EmbeddingModelService } from "../embeddingModelService";

// Mock Comlink.wrap
vi.mock("comlink", async () => {
    const actual = await vi.importActual("comlink");

    return {
        ...actual,
        wrap: vi.fn(() => {
            return class {
                handleLoad() {
                    return {
                        vectorSize: 384,
                        maxTokens: 512,
                    };
                }
                handleUnload() {
                    return undefined;
                }
                handleEmbedBatch(texts: string[]) {
                    return Promise.resolve(
                        texts.map(() => new Array(384).fill(0))
                    );
                }
                handleCountToken(text: string) {
                    return Promise.resolve(Math.ceil(text.length / 4));
                }
            };
        }),
    };
});

// Mock InlineWorker import
vi.mock("../transformers.worker", async () => {
    return {
        default: class {},
        TransformersWorker: class {},
    };
});

describe("EmbeddingModelService", () => {
    let service: EmbeddingModelService;

    beforeEach(() => {
        service = new EmbeddingModelService();
    });

    afterEach(() => {
        service.dispose();
    });

    describe("loadModel", () => {
        it("should load model successfully", async () => {
            await service.loadModel("test-model");
            expect(service.getVectorSize()).toBe(384);
            expect(service.getMaxTokens()).toBe(512);
        });
    });

    describe("embedTexts", () => {
        it("should throw error if model not loaded", async () => {
            await expect(service.embedTexts(["test"])).rejects.toThrow(
                "Model not loaded"
            );
        });

        it("should embed texts successfully", async () => {
            await service.loadModel("test-model");
            const embeddings = await service.embedTexts(["test1", "test2"]);
            expect(embeddings).toHaveLength(2);
            expect(embeddings[0]).toHaveLength(384);
            expect(embeddings[1]).toHaveLength(384);
        });
    });

    describe("countTokens", () => {
        it("should throw error if model not loaded", async () => {
            await expect(service.countTokens("test")).rejects.toThrow(
                "Model not loaded"
            );
        });

        it("should count tokens successfully", async () => {
            await service.loadModel("test-model");
            const tokenCount = await service.countTokens("test text");
            expect(tokenCount).toBe(3); // Math.ceil(9 / 4) = 3
        });
    });

    describe("concurrent requests", () => {
        it("should handle concurrent embedTexts and countTokens requests correctly", async () => {
            await service.loadModel("test-model");

            const [embeddings, tokenCount] = await Promise.all([
                service.embedTexts(["test1", "test2"]),
                service.countTokens("test text"),
            ]);

            expect(embeddings).toHaveLength(2);
            expect(embeddings[0]).toHaveLength(384);
            expect(embeddings[1]).toHaveLength(384);
            expect(tokenCount).toBe(3);
        });

        it("should maintain request order and response matching", async () => {
            await service.loadModel("test-model");

            const results = await Promise.all([
                service.countTokens("short"),
                service.countTokens("medium length text"),
                service.countTokens("very long text for testing"),
            ]);

            expect(results[0]).toBe(2); // Math.ceil(5 / 4) = 2
            expect(results[1]).toBe(5); // Math.ceil(18 / 4) = 5
            expect(results[2]).toBe(7); // Math.ceil(27 / 4) = 7
        });
    });

    describe("unloadModel", () => {
        it("should unload model successfully", async () => {
            await service.loadModel("test-model");
            await service.unloadModel();
            await expect(service.embedTexts(["test"])).rejects.toThrow(
                "Model not loaded"
            );
        });
    });

    describe("getVectorSize and getMaxTokens", () => {
        it("should throw error if model not loaded", () => {
            expect(() => service.getVectorSize()).toThrow("Model not loaded");
            expect(() => service.getMaxTokens()).toThrow("Model not loaded");
        });

        it("should return correct values after model is loaded", async () => {
            await service.loadModel("test-model");
            expect(service.getVectorSize()).toBe(384);
            expect(service.getMaxTokens()).toBe(512);
        });
    });
});
