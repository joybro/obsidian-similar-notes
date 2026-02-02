import { GeminiClient } from "@/adapter/gemini";
import { UsageTracker } from "@/adapter/openai";
import type { SettingsService } from "@/application/SettingsService";
import { handleEmbeddingLoadError } from "@/utils/errorHandling";
import log from "loglevel";
import { type Observable, Subject } from "rxjs";
import { type EmbeddingProvider, type ModelInfo } from "./EmbeddingProvider";

export interface GeminiConfig {
    apiKey?: string;
    model: string;
    settingsService?: SettingsService;
}

// Default max tokens for Gemini embedding models
const DEFAULT_MAX_TOKENS = 2048;

export class GeminiEmbeddingProvider implements EmbeddingProvider {
    private geminiClient: GeminiClient;
    private usageTracker: UsageTracker | null = null;
    private modelId: string | null = null;
    private vectorSize: number | null = null;
    private maxTokens: number = DEFAULT_MAX_TOKENS;
    private modelBusy$ = new Subject<boolean>();
    private downloadProgress$ = new Subject<number>();
    private modelError$ = new Subject<string | null>();

    constructor(private config: GeminiConfig) {
        this.geminiClient = new GeminiClient(config.apiKey);
        if (config.settingsService) {
            this.usageTracker = new UsageTracker(config.settingsService);
        }
    }

    async loadModel(modelId: string, config?: GeminiConfig): Promise<ModelInfo> {
        const finalConfig = config || this.config;
        log.info("Loading Gemini model", modelId);

        // Clear any previous error state
        this.modelError$.next(null);

        // Update client if config changed
        if (finalConfig.apiKey !== this.config.apiKey) {
            this.geminiClient.setApiKey(finalConfig.apiKey);
            this.config.apiKey = finalConfig.apiKey;
        }

        try {
            // Test connection and get vector size by generating a test embedding
            const testResult = await this.geminiClient.embedText(modelId, "test");
            this.vectorSize = testResult.embedding.length;

            this.modelId = modelId;
            this.config.model = modelId;

            log.info("Gemini model loaded successfully", {
                modelId,
                vectorSize: this.vectorSize,
                maxTokens: this.maxTokens,
            });

            return {
                vectorSize: this.vectorSize,
                maxTokens: this.maxTokens,
            };
        } catch (error) {
            log.error("Failed to load Gemini model:", error);

            handleEmbeddingLoadError(error, {
                providerName: "Gemini",
                errorSubject: this.modelError$,
            });
        }
    }

    async unloadModel(): Promise<void> {
        this.modelId = null;
        this.vectorSize = null;
        log.info("Gemini model unloaded");
    }

    getModelBusy$(): Observable<boolean> {
        return this.modelBusy$.asObservable();
    }

    getDownloadProgress$(): Observable<number> {
        // Gemini doesn't need to download models, always return 100%
        return this.downloadProgress$.asObservable();
    }

    getModelError$(): Observable<string | null> {
        return this.modelError$.asObservable();
    }

    async embedText(text: string): Promise<number[]> {
        if (!this.modelId) {
            throw new Error("Gemini model not loaded");
        }

        this.modelBusy$.next(true);
        try {
            const result = await this.geminiClient.embedText(this.modelId, text);
            // Clear error state on success
            this.modelError$.next(null);

            // Track usage with estimated tokens (Gemini API doesn't return usage info)
            if (this.usageTracker) {
                const estimatedTokens = await this.countTokens(text);
                await this.usageTracker.trackUsage(estimatedTokens, estimatedTokens);
            }

            return result.embedding;
        } catch (error) {
            log.error("Failed to embed text with Gemini:", error);
            throw error;
        } finally {
            this.modelBusy$.next(false);
        }
    }

    async embedTexts(texts: string[]): Promise<number[][]> {
        if (!this.modelId) {
            throw new Error("Gemini model not loaded");
        }

        this.modelBusy$.next(true);
        try {
            const result = await this.geminiClient.embedTexts(this.modelId, texts);
            // Clear error state on success
            this.modelError$.next(null);

            // Track usage with estimated tokens (Gemini API doesn't return usage info)
            if (this.usageTracker) {
                let totalTokens = 0;
                for (const text of texts) {
                    totalTokens += await this.countTokens(text);
                }
                await this.usageTracker.trackUsage(totalTokens, totalTokens);
            }

            return result.embeddings;
        } catch (error) {
            log.error("Failed to embed texts with Gemini:", error);
            throw error;
        } finally {
            this.modelBusy$.next(false);
        }
    }

    async countTokens(text: string): Promise<number> {
        // Use Gemini's countTokens API for accurate token counting
        // Falls back to estimation if API is unavailable
        return this.geminiClient.countTokens(text);
    }

    getVectorSize(): number {
        if (!this.vectorSize) {
            throw new Error("Gemini model not loaded");
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
            log.error("Error during Gemini provider disposal:", err);
        });
    }

    /**
     * Update Gemini configuration
     */
    updateConfig(config: Partial<GeminiConfig>): void {
        if (config.apiKey !== undefined) {
            this.config.apiKey = config.apiKey;
            this.geminiClient.setApiKey(config.apiKey);
        }
        if (config.model) {
            this.config.model = config.model;
        }
    }

    /**
     * Get current configuration
     */
    getConfig(): GeminiConfig {
        return { ...this.config };
    }
}
