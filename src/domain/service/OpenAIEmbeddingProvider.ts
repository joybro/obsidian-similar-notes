import log from "loglevel";
import { type Observable, Subject } from "rxjs";
import { OpenAIClient } from "@/adapter/openai";
import { handleEmbeddingLoadError, handleEmbeddingRuntimeError } from "@/utils/errorHandling";
import { type EmbeddingProvider, type ModelInfo } from "./EmbeddingProvider";

export interface OpenAIConfig {
    url: string;
    apiKey?: string;
    model: string;
}

// Default max tokens for OpenAI text-embedding-3 models
const DEFAULT_MAX_TOKENS = 8191;

export class OpenAIEmbeddingProvider implements EmbeddingProvider {
    private openaiClient: OpenAIClient;
    private modelId: string | null = null;
    private vectorSize: number | null = null;
    private maxTokens: number = DEFAULT_MAX_TOKENS;
    private modelBusy$ = new Subject<boolean>();
    private downloadProgress$ = new Subject<number>();
    private modelError$ = new Subject<string | null>();

    constructor(private config: OpenAIConfig) {
        this.openaiClient = new OpenAIClient(config.url, config.apiKey);
    }

    async loadModel(modelId: string, config?: OpenAIConfig): Promise<ModelInfo> {
        const finalConfig = config || this.config;
        log.info("Loading OpenAI model", modelId, "from", finalConfig.url);

        // Clear any previous error state
        this.modelError$.next(null);

        // Update client if config changed
        if (finalConfig.url !== this.config.url) {
            this.openaiClient.setBaseUrl(finalConfig.url);
            this.config.url = finalConfig.url;
        }
        if (finalConfig.apiKey !== this.config.apiKey) {
            this.openaiClient.setApiKey(finalConfig.apiKey);
            this.config.apiKey = finalConfig.apiKey;
        }

        try {
            // Test connection and get vector size by generating a test embedding
            const testResult = await this.openaiClient.embedText(modelId, "test");
            this.vectorSize = testResult.embedding.length;

            this.modelId = modelId;
            this.config.model = modelId;

            log.info("OpenAI model loaded successfully", {
                modelId,
                vectorSize: this.vectorSize,
                maxTokens: this.maxTokens,
            });

            return {
                vectorSize: this.vectorSize,
                maxTokens: this.maxTokens,
            };
        } catch (error) {
            log.error("Failed to load OpenAI model:", error);

            handleEmbeddingLoadError(error, {
                providerName: "OpenAI",
                errorSubject: this.modelError$,
            });
        }
    }

    async unloadModel(): Promise<void> {
        this.modelId = null;
        this.vectorSize = null;
        log.info("OpenAI model unloaded");
    }

    getModelBusy$(): Observable<boolean> {
        return this.modelBusy$.asObservable();
    }

    getDownloadProgress$(): Observable<number> {
        // OpenAI doesn't need to download models, always return 100%
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
            const result = await this.openaiClient.embedText(this.modelId, text);
            // Clear error state on success
            this.modelError$.next(null);
            return result.embedding;
        } catch (error) {
            log.error("Failed to embed text with OpenAI:", error);

            handleEmbeddingRuntimeError(error, {
                providerName: "OpenAI",
                errorSubject: this.modelError$,
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
            const result = await this.openaiClient.embedTexts(this.modelId, texts);
            // Clear error state on success
            this.modelError$.next(null);
            return result.embeddings;
        } catch (error) {
            log.error("Failed to embed texts with OpenAI:", error);

            handleEmbeddingRuntimeError(error, {
                providerName: "OpenAI",
                errorSubject: this.modelError$,
            });

            throw error;
        } finally {
            this.modelBusy$.next(false);
        }
    }

    async countTokens(text: string): Promise<number> {
        // OpenAI uses ~4 characters per token on average
        // This is a rough approximation without using tiktoken
        return Math.ceil(text.length / 4);
    }

    getVectorSize(): number {
        if (!this.vectorSize) {
            throw new Error("OpenAI model not loaded");
        }
        return this.vectorSize;
    }

    getMaxTokens(): number {
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
            log.error("Error during OpenAI provider disposal:", err);
        });
    }

    /**
     * Update OpenAI configuration
     */
    updateConfig(config: Partial<OpenAIConfig>): void {
        if (config.url) {
            this.config.url = config.url;
            this.openaiClient.setBaseUrl(config.url);
        }
        if (config.apiKey !== undefined) {
            this.config.apiKey = config.apiKey;
            this.openaiClient.setApiKey(config.apiKey);
        }
        if (config.model) {
            this.config.model = config.model;
        }
    }

    /**
     * Get current configuration
     */
    getConfig(): OpenAIConfig {
        return { ...this.config };
    }
}
