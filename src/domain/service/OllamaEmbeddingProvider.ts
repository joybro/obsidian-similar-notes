import log from "loglevel";
import { type Observable, Subject } from "rxjs";
import { OllamaClient } from "@/adapter/ollama";
import { handleEmbeddingLoadError } from "@/utils/errorHandling";
import { type EmbeddingProvider, type ModelInfo } from "./EmbeddingProvider";

export interface OllamaConfig {
    url: string;
    model: string;
}

export class OllamaEmbeddingProvider implements EmbeddingProvider {
    private ollamaClient: OllamaClient;
    private modelId: string | null = null;
    private vectorSize: number | null = null;
    private maxTokens: number | null = null;
    private modelBusy$ = new Subject<boolean>();
    private downloadProgress$ = new Subject<number>();
    private modelError$ = new Subject<string | null>();

    constructor(private config: OllamaConfig) {
        this.ollamaClient = new OllamaClient(config.url);
    }

    async loadModel(modelId: string, config?: OllamaConfig): Promise<ModelInfo> {
        const finalConfig = config || this.config;
        log.info("Loading Ollama model", modelId, "from", finalConfig.url);

        // Clear any previous error state
        this.modelError$.next(null);

        // Update client URL if changed
        if (finalConfig.url !== this.config.url) {
            this.ollamaClient.setBaseUrl(finalConfig.url);
            this.config.url = finalConfig.url;
        }

        // Test connection and model availability
        try {
            const isConnected = await this.ollamaClient.testConnection();
            if (!isConnected) {
                throw new Error(`Cannot connect to Ollama server at ${finalConfig.url}`);
            }

            const isModelAvailable = await this.ollamaClient.testModel(modelId);
            if (!isModelAvailable) {
                throw new Error(`Model ${modelId} is not available on Ollama server`);
            }

            // Get vector size by testing with a small text
            const testEmbedding = await this.ollamaClient.generateEmbedding(modelId, "test");
            this.vectorSize = testEmbedding.length;
            
            // Ollama doesn't have a direct way to get max tokens, use a reasonable default
            // Most embedding models can handle 512-8192 tokens
            this.maxTokens = 8192;

            this.modelId = modelId;
            this.config.model = modelId;

            log.info("Ollama model loaded successfully", {
                modelId,
                vectorSize: this.vectorSize,
                maxTokens: this.maxTokens
            });

            return {
                vectorSize: this.vectorSize,
                maxTokens: this.maxTokens,
            };
        } catch (error) {
            log.error("Failed to load Ollama model:", error);
            
            handleEmbeddingLoadError(error, {
                providerName: "Ollama",
                errorSubject: this.modelError$
            });
        }
    }

    async unloadModel(): Promise<void> {
        // Ollama doesn't need explicit unloading, just clear our state
        this.modelId = null;
        this.vectorSize = null;
        this.maxTokens = null;
        log.info("Ollama model unloaded");
    }

    getModelBusy$(): Observable<boolean> {
        return this.modelBusy$.asObservable();
    }

    getDownloadProgress$(): Observable<number> {
        // Ollama models are already downloaded, so always return 100%
        return this.downloadProgress$.asObservable();
    }

    getModelError$(): Observable<string | null> {
        return this.modelError$.asObservable();
    }

    async embedText(text: string): Promise<number[]> {
        if (!this.modelId) {
            throw new Error("Ollama model not loaded");
        }

        this.modelBusy$.next(true);
        try {
            const result = await this.ollamaClient.generateEmbedding(this.modelId, text);
            return result;
        } catch (error) {
            log.error("Failed to embed text with Ollama:", error);
            throw error;
        } finally {
            this.modelBusy$.next(false);
        }
    }

    async embedTexts(texts: string[]): Promise<number[][]> {
        if (!this.modelId) {
            throw new Error("Ollama model not loaded");
        }

        this.modelBusy$.next(true);
        try {
            // Ollama doesn't have batch embedding, so we'll do them sequentially
            // TODO: Could potentially parallelize this with Promise.all, but might overwhelm the server
            const results: number[][] = [];
            for (const text of texts) {
                const embedding = await this.ollamaClient.generateEmbedding(this.modelId, text);
                results.push(embedding);
            }
            return results;
        } catch (error) {
            log.error("Failed to embed texts with Ollama:", error);
            throw error;
        } finally {
            this.modelBusy$.next(false);
        }
    }

    async countTokens(text: string): Promise<number> {
        // Ollama doesn't provide token counting API
        // Use a rough approximation: ~4 characters per token for English text
        // This is not accurate but provides a reasonable estimate
        return Math.ceil(text.length / 4);
    }

    getVectorSize(): number {
        if (!this.vectorSize) {
            throw new Error("Ollama model not loaded");
        }
        return this.vectorSize;
    }

    getMaxTokens(): number {
        if (!this.maxTokens) {
            throw new Error("Ollama model not loaded");
        }
        return this.maxTokens;
    }

    isModelLoaded(): boolean {
        return this.modelId !== null;
    }

    getCurrentModelId(): string | null {
        return this.modelId;
    }

    dispose(): void {
        this.unloadModel().catch((err) => {
            log.error("Error during Ollama provider disposal:", err);
        });
    }

    /**
     * Update Ollama configuration
     */
    updateConfig(config: Partial<OllamaConfig>): void {
        if (config.url) {
            this.config.url = config.url;
            this.ollamaClient.setBaseUrl(config.url);
        }
        if (config.model) {
            this.config.model = config.model;
        }
    }

    /**
     * Get current configuration
     */
    getConfig(): OllamaConfig {
        return { ...this.config };
    }
}