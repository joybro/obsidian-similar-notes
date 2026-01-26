import log from "loglevel";
import { type Observable, Subject } from "rxjs";
import { OpenAIClient } from "@/adapter/openai";
import { handleEmbeddingLoadError, handleEmbeddingRuntimeError } from "@/utils/errorHandling";
import { type EmbeddingProvider, type ModelInfo } from "./EmbeddingProvider";

export interface OpenAIConfig {
    url: string;
    model: string;
    apiKey?: string;
}

export class OpenAIEmbeddingProvider implements EmbeddingProvider {
    private client: OpenAIClient;
    private modelId: string | null = null;
    private vectorSize: number | null = null;
    private maxTokens: number | null = null;
    private modelBusy$ = new Subject<boolean>();
    private downloadProgress$ = new Subject<number>(); // Not really used for API
    private modelError$ = new Subject<string | null>();

    constructor(private config: OpenAIConfig) {
        this.client = new OpenAIClient(config.url, config.apiKey);
    }

    async loadModel(modelId: string, config?: OpenAIConfig): Promise<ModelInfo> {
        const finalConfig = config || this.config;
        log.info("Loading OpenAI-compatible model", modelId, "from", finalConfig.url);

        this.modelError$.next(null);

        if (finalConfig.url !== this.config.url || finalConfig.apiKey !== this.config.apiKey) {
            this.client.setBaseUrl(finalConfig.url);
            if (finalConfig.apiKey !== undefined) {
                 this.client.setApiKey(finalConfig.apiKey);
            }
            this.config = { ...this.config, ...finalConfig };
        }

        try {
            const isConnected = await this.client.testConnection();
            if (!isConnected) {
                // If models endpoint fails, we might still be able to use embeddings if the URL is correct but models list is hidden
                // So we don't hard fail here, but log a warning.
                log.warn(`Could not connect to /models at ${finalConfig.url}, but will try testing embedding directly.`);
            }

            // Test embedding to get vector size and verify model works
            const testEmbedding = await this.client.generateEmbedding(modelId, "test");
            this.vectorSize = testEmbedding.length;
            
            // Most local servers claim 4096 or 8192, safe default. 
            // We can't easily detect this without metadata which is often missing.
            this.maxTokens = 4096; 

            this.modelId = modelId;
            this.config.model = modelId;

             log.info("OpenAI model loaded successfully", {
                modelId,
                vectorSize: this.vectorSize,
            });

            return {
                vectorSize: this.vectorSize,
                maxTokens: this.maxTokens,
            };

        } catch (error) {
             log.error("Failed to load OpenAI model:", error);
            
            handleEmbeddingLoadError(error, {
                providerName: "OpenAI",
                errorSubject: this.modelError$
            });
            throw error;
        }
    }

    async unloadModel(): Promise<void> {
        this.modelId = null;
        this.vectorSize = null;
        this.maxTokens = null;
        log.info("OpenAI model unloaded");
    }

    getModelBusy$(): Observable<boolean> {
        return this.modelBusy$.asObservable();
    }

    getDownloadProgress$(): Observable<number> {
        return this.downloadProgress$.asObservable();
    }

    getModelError$(): Observable<string | null> {
        return this.modelError$.asObservable();
    }

    async embedText(text: string): Promise<number[]> {
        if (!this.modelId) {
            throw new Error("OpenAI model not loaded");
        }

        this.modelBusy$.next(true);
        try {
            const result = await this.client.generateEmbedding(this.modelId, text);
            this.modelError$.next(null);
            return result;
        } catch (error) {
            log.error("Failed to embed text with OpenAI:", error);
            handleEmbeddingRuntimeError(error, {
                providerName: "OpenAI",
                errorSubject: this.modelError$
            });
            throw error;
        } finally {
            this.modelBusy$.next(false);
        }
    }

    async embedTexts(texts: string[]): Promise<number[][]> {
         if (!this.modelId) {
            throw new Error("OpenAI model not loaded");
        }

        this.modelBusy$.next(true);
        try {
            // OpenAI API supports batching
            const results = await this.client.generateEmbeddings(this.modelId, texts);
            this.modelError$.next(null);
            return results;
        } catch (error) {
             log.error("Failed to embed texts with OpenAI:", error);
             // Fallback to sequential if batch fails? No, usually API supports it.
            handleEmbeddingRuntimeError(error, {
                providerName: "OpenAI",
                errorSubject: this.modelError$
            });
            throw error;
        } finally {
            this.modelBusy$.next(false);
        }
    }

    async countTokens(text: string): Promise<number> {
        // Simple approximation: 1 token ~ 4 chars
        // Ideally we'd use a tokenizer compatible with the model, but since it's generic OpenAI, we don't know the tokenizer.
        // 3.5 is a safe conservative estimate commonly used.
        return Math.ceil(text.length / 3.5);
    }

    getVectorSize(): number {
        if (!this.vectorSize) {
             throw new Error("OpenAI model not loaded");
        }
        return this.vectorSize;
    }

    getMaxTokens(): number {
        if (!this.maxTokens) {
            throw new Error("OpenAI model not loaded");
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
        this.unloadModel();
    }
}
