import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { EmbeddingModelService } from "../embeddingModelService";
import type {
    ModelLoadResponse,
    WorkerMessage,
    WorkerResponse,
} from "../transformers.worker";

type WorkerResponseWithId = WorkerResponse & { requestId: string };

// Mock Worker
class MockWorker implements Worker {
    private listeners: Map<
        string,
        Array<(event: MessageEvent<WorkerResponseWithId>) => void>
    > = new Map();

    onmessage:
        | ((this: Worker, ev: MessageEvent<WorkerResponseWithId>) => void)
        | null = null;
    onmessageerror: ((this: Worker, ev: MessageEvent<unknown>) => void) | null =
        null;
    onerror: ((this: Worker, ev: ErrorEvent) => void) | null = null;

    addEventListener(
        type: string,
        listener: (event: MessageEvent<WorkerResponseWithId>) => void
    ): void {
        if (!this.listeners.has(type)) {
            this.listeners.set(type, []);
        }
        this.listeners.get(type)?.push(listener);
    }

    removeEventListener(
        type: string,
        listener: (event: MessageEvent<WorkerResponseWithId>) => void
    ): void {
        const listeners = this.listeners.get(type);
        if (listeners) {
            const index = listeners.indexOf(listener);
            if (index !== -1) {
                listeners.splice(index, 1);
            }
        }
    }

    dispatchEvent(event: Event): boolean {
        return true;
    }

    postMessage(message: WorkerMessage & { requestId: string }): void {
        // Simulate async behavior
        setTimeout(() => {
            let response: WorkerResponse;

            switch (message.type) {
                case "load":
                    response = {
                        type: "success",
                        data: {
                            message: "Model loaded successfully",
                            vectorSize: 384,
                            maxTokens: 512,
                        } as ModelLoadResponse,
                    };
                    break;
                case "unload":
                    response = {
                        type: "success",
                        data: "Model unloaded successfully",
                    };
                    break;
                case "embed_batch":
                    response = {
                        type: "success",
                        data: message.texts.map(() => new Array(384).fill(0)),
                    };
                    break;
                case "count_token":
                    response = {
                        type: "success",
                        data: Math.ceil(message.text.length / 4),
                    };
                    break;
                default:
                    response = {
                        type: "error",
                        error: "Unknown message type",
                    };
            }

            const event = new MessageEvent("message", {
                data: { ...response, requestId: message.requestId },
            });

            // Call all registered message listeners
            if (this.onmessage) {
                this.onmessage.call(this, event);
            }

            const messageListeners = this.listeners.get("message") || [];
            for (const listener of messageListeners) {
                listener(event);
            }
        }, 0);
    }

    terminate(): void {
        this.listeners.clear();
        this.onmessage = null;
        this.onmessageerror = null;
        this.onerror = null;
    }
}

// Mock window.Worker
(global as unknown as { Worker: typeof Worker }).Worker = MockWorker;

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
            const response = await service.loadModel("test-model");
            expect(response.vectorSize).toBe(384);
            expect(response.maxTokens).toBe(512);
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
