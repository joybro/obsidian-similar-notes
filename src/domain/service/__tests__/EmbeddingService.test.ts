import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EmbeddingService } from "../EmbeddingService";
import type { SimilarNotesSettings } from "@/application/SettingsService";

// Mock Obsidian
vi.mock("obsidian");

// Mock Comlink.wrap
vi.mock("comlink", async () => {
    const actual = await vi.importActual("comlink");

    return {
        ...actual,
        wrap: vi.fn(() => {
            return class {
                setLogLevel() {
                    return Promise.resolve();
                }
                handleLoad() {
                    return {
                        vectorSize: 384,
                        maxTokens: 512,
                    };
                }
                handleUnload() {
                    return Promise.resolve();
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
    let service: EmbeddingService;

    beforeEach(() => {
        service = new EmbeddingService();
    });

    afterEach(() => {
        service.dispose();
    });

    describe("loadModel", () => {
        it("should load model successfully", async () => {
            // Initialize with builtin provider
            await service.switchProvider({
                modelProvider: "builtin",
                modelId: "test-model",
                useGPU: false,
                ollamaUrl: "",
                ollamaModel: ""
            } as SimilarNotesSettings);
            
            expect(service.getVectorSize()).toBe(384);
            expect(service.getMaxTokens()).toBe(512);
        });
    });

    describe("embedTexts", () => {
        it("should throw error if provider not initialized", async () => {
            await expect(service.embedTexts(["test"])).rejects.toThrow(
                "No embedding provider initialized"
            );
        });

        it("should embed texts successfully", async () => {
            await service.switchProvider({
                modelProvider: "builtin",
                modelId: "test-model",
                useGPU: false,
                ollamaUrl: "",
                ollamaModel: ""
            } as SimilarNotesSettings);
            
            const embeddings = await service.embedTexts(["test1", "test2"]);
            expect(embeddings).toHaveLength(2);
            expect(embeddings[0]).toHaveLength(384);
            expect(embeddings[1]).toHaveLength(384);
        });
    });

    describe("countTokens", () => {
        it("should throw error if provider not initialized", async () => {
            await expect(service.countTokens("test")).rejects.toThrow(
                "No embedding provider initialized"
            );
        });

        it("should count tokens successfully", async () => {
            await service.switchProvider({
                modelProvider: "builtin",
                modelId: "test-model",
                useGPU: false,
                ollamaUrl: "",
                ollamaModel: ""
            } as SimilarNotesSettings);
            
            const tokenCount = await service.countTokens("test text");
            expect(tokenCount).toBe(3); // Math.ceil(9 / 4) = 3
        });
    });

    describe("concurrent requests", () => {
        beforeEach(async () => {
            await service.switchProvider({
                modelProvider: "builtin",
                modelId: "test-model",
                useGPU: false,
                ollamaUrl: "",
                ollamaModel: ""
            } as SimilarNotesSettings);
        });
        
        it("should handle concurrent embedTexts and countTokens requests correctly", async () => {
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
            await service.switchProvider({
                modelProvider: "builtin",
                modelId: "test-model",
                useGPU: false,
                ollamaUrl: "",
                ollamaModel: ""
            } as SimilarNotesSettings);
            
            await service.unloadModel();
            
            // After unloading, the provider is still there but model is not loaded
            // This should throw "Transformers model not loaded"
            await expect(service.embedTexts(["test"])).rejects.toThrow(
                "Transformers model not loaded"
            );
        });
    });

    describe("getVectorSize and getMaxTokens", () => {
        it("should throw error if provider not initialized", () => {
            expect(() => service.getVectorSize()).toThrow("No embedding provider initialized");
            expect(() => service.getMaxTokens()).toThrow("No embedding provider initialized");
        });

        it("should return correct values after model is loaded", async () => {
            await service.switchProvider({
                modelProvider: "builtin",
                modelId: "test-model",
                useGPU: false,
                ollamaUrl: "",
                ollamaModel: ""
            } as SimilarNotesSettings);
            
            expect(service.getVectorSize()).toBe(384);
            expect(service.getMaxTokens()).toBe(512);
        });
    });
});
