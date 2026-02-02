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

            // Detect actual max tokens by testing increasing sizes
            // This works around a bug in Ollama v0.12.5+ where requests >2KB crash
            // Once Ollama is fixed, this will automatically use larger chunks
            this.maxTokens = await this.detectMaxTokens(modelId);

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
            // Clear error state on success
            this.modelError$.next(null);
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
            // Process embeddings sequentially
            // Ollama processes requests in a queue internally, so parallel requests
            // don't improve performance and only add network overhead
            const results: number[][] = [];
            for (const text of texts) {
                const embedding = await this.ollamaClient.generateEmbedding(this.modelId, text);
                results.push(embedding);
            }
            // Clear error state on success
            this.modelError$.next(null);
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
        // Use a conservative approximation to ensure we stay under payload limits
        // Based on empirical testing with Ollama's 2KB bug, we need to be very conservative
        // Use 3.5 chars/token to match our detection logic and provide safety margin
        return Math.ceil(text.length / 3.5);
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
     * Detect the maximum tokens supported by the model
     * Tests with increasing sizes to find the actual limit
     * This works around Ollama v0.12.5+ bug where >2KB requests fail
     */
    private async detectMaxTokens(modelId: string): Promise<number> {
        // Test with increasing sizes to find the actual limit
        // Ollama v0.12.5+ has bugs with larger payloads, but this will auto-adapt when fixed
        const testSizes = [512, 768, 1024, 2048, 4096, 8192];
        let maxWorking = 512; // More realistic fallback based on Ollama bug testing
        const maxPayloadSize = 8192; // bytes

        for (const tokens of testSizes) {
            // Generate realistic test text with varied characters
            // This prevents compression benefits from repeated patterns
            const testChars = tokens * 3.5;
            const testText = this.generateRealisticTestText(Math.floor(testChars));

            // Check payload size before sending
            const payloadSize = new Blob([JSON.stringify({
                model: modelId,
                prompt: testText
            })]).size;

            // Skip if payload is too large
            if (payloadSize > maxPayloadSize) {
                log.debug(`[Ollama] Skipping ${tokens} tokens (payload ${payloadSize} bytes exceeds ${maxPayloadSize} bytes limit)`);
                break;
            }

            try {
                await this.ollamaClient.generateEmbedding(modelId, testText);
                maxWorking = tokens;
                log.debug(`[Ollama] Successfully tested ${tokens} tokens (~${testChars} chars, payload ${payloadSize} bytes)`);
            } catch (error) {
                log.info(`[Ollama] Failed at ${tokens} tokens (payload ${payloadSize} bytes), using ${maxWorking} as max`);
                break;
            }
        }

        log.info(`[Ollama] Detected max tokens: ${maxWorking}`);
        return maxWorking;
    }

    /**
     * Generate realistic test text with varied characters
     * Prevents compression from repeated patterns
     */
    private generateRealisticTestText(length: number): string {
        const words = [
            'the', 'quick', 'brown', 'fox', 'jumps', 'over', 'lazy', 'dog',
            'lorem', 'ipsum', 'dolor', 'sit', 'amet', 'consectetur', 'adipiscing',
            'elit', 'sed', 'do', 'eiusmod', 'tempor', 'incididunt', 'ut', 'labore'
        ];

        let text = '';
        let wordIndex = 0;

        while (text.length < length) {
            text += words[wordIndex % words.length] + ' ';
            wordIndex++;
        }

        return text.substring(0, length);
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

    /**
     * Ollama processes requests in a queue internally on the server side
     * Parallel file processing would not improve performance and adds network overhead
     */
    supportsParallelProcessing(): boolean {
        return false;
    }
}