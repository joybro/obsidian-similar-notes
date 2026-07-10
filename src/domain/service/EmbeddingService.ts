import type {
    EmbeddingModelSettings,
    SettingsService,
} from "@/application/SettingsService";
import { AsyncOperationGate } from "@/utils/AsyncOperationGate";
import log from "loglevel";
import { Subject, type Observable, type Subscription } from "rxjs";
import { type EmbeddingProvider, type ModelInfo } from "./EmbeddingProvider";
import {
    GeminiEmbeddingProvider,
    type GeminiConfig,
} from "./GeminiEmbeddingProvider";
import {
    OllamaEmbeddingProvider,
    type OllamaConfig,
} from "./OllamaEmbeddingProvider";
import {
    OpenAIEmbeddingProvider,
    type OpenAIConfig,
} from "./OpenAIEmbeddingProvider";
import {
    TransformersEmbeddingProvider,
    type TransformersConfig,
} from "./TransformersEmbeddingProvider";

export class EmbeddingService {
    private provider: EmbeddingProvider | null = null;
    private currentProviderType: "builtin" | "ollama" | "openai" | "gemini" | null = null;

    constructor(
        private settingsService?: SettingsService,
        private onDisableGPU?: () => Promise<void>
    ) {}

    // Proxy subjects that relay provider's observables
    private modelBusy$ = new Subject<boolean>();
    private downloadProgress$ = new Subject<number>();
    private modelError$ = new Subject<string | null>();

    // Subscriptions to provider's observables
    private modelBusySubscription?: Subscription;
    private downloadProgressSubscription?: Subscription;
    private modelErrorSubscription?: Subscription;
    private localOperationQueue: Promise<void> = Promise.resolve();
    private readonly providerOperations = new AsyncOperationGate();

    /**
     * Switch to a different embedding provider based on settings
     */
    async switchProvider(settings: EmbeddingModelSettings): Promise<void> {
        await this.providerOperations.transition(async () => {
            await this.switchProviderUnlocked(settings);
        });
    }

    private async switchProviderUnlocked(
        settings: EmbeddingModelSettings
    ): Promise<void> {
        const newProviderType = settings.modelProvider;

        // If same provider type and model, check if GPU settings changed for builtin provider
        if (
            this.currentProviderType === newProviderType &&
            this.provider?.isModelLoaded()
        ) {
            const currentModelId = this.provider.getCurrentModelId();
            const targetModelId =
                newProviderType === "builtin"
                    ? settings.modelId
                    : newProviderType === "ollama"
                        ? settings.ollamaModel
                        : newProviderType === "openai"
                            ? settings.openaiModel
                            : settings.geminiModel;

            if (currentModelId === targetModelId) {
                log.info(
                    "Same model selected; reloading so runtime configuration changes take effect"
                );
            }
        }

        // Dispose current provider
        if (this.provider) {
            log.info(
                "Disposing current embedding provider:",
                this.currentProviderType
            );

            this.disposeProvider();
        }

        // Create new provider
        if (newProviderType === "builtin") {
            log.info("Switching to Transformers embedding provider");
            this.provider = new TransformersEmbeddingProvider(
                this.settingsService,
                this.onDisableGPU
            );
            this.setupProviderSubscriptions();
            await this.provider.loadModel(settings.modelId, {
                useGPU: settings.useGPU,
            });
        } else if (newProviderType === "ollama") {
            log.info("Switching to Ollama embedding provider");
            const ollamaConfig: OllamaConfig = {
                url: settings.ollamaUrl || "http://localhost:11434",
                model: settings.ollamaModel || "",
            };
            this.provider = new OllamaEmbeddingProvider(ollamaConfig);
            this.setupProviderSubscriptions();
            await this.provider.loadModel(
                settings.ollamaModel || "",
                ollamaConfig
            );
        } else if (newProviderType === "openai") {
            log.info("Switching to OpenAI embedding provider");
            const openaiConfig: OpenAIConfig = {
                url: settings.openaiUrl || "https://api.openai.com/v1",
                apiKey: settings.openaiApiKey,
                model: settings.openaiModel || "text-embedding-3-small",
                maxTokens: settings.openaiMaxTokens,
                settingsService: this.settingsService,
            };
            this.provider = new OpenAIEmbeddingProvider(openaiConfig);
            this.setupProviderSubscriptions();
            await this.provider.loadModel(
                settings.openaiModel || "text-embedding-3-small",
                openaiConfig
            );
        } else if (newProviderType === "gemini") {
            log.info("Switching to Gemini embedding provider");
            const geminiConfig: GeminiConfig = {
                apiKey: settings.geminiApiKey,
                model: settings.geminiModel || "gemini-embedding-001",
                settingsService: this.settingsService,
            };
            this.provider = new GeminiEmbeddingProvider(geminiConfig);
            this.setupProviderSubscriptions();
            await this.provider.loadModel(
                settings.geminiModel || "gemini-embedding-001",
                geminiConfig
            );
        } else {
            throw new Error(`Unknown provider type: ${newProviderType}`);
        }

        this.currentProviderType = newProviderType;
        log.info("Successfully switched to provider:", newProviderType);
    }

    /**
     * Setup subscriptions to relay provider's observables
     */
    private setupProviderSubscriptions(): void {
        if (!this.provider) return;

        // Subscribe to model busy observable
        this.modelBusySubscription = this.provider
            .getModelBusy$()
            .subscribe((busy) => this.modelBusy$.next(busy));

        // Subscribe to download progress observable
        this.downloadProgressSubscription = this.provider
            .getDownloadProgress$()
            .subscribe((progress) => {
                this.downloadProgress$.next(progress);
            });

        // Subscribe to model error observable
        this.modelErrorSubscription = this.provider
            .getModelError$()
            .subscribe((error: string | null) => {
                this.modelError$.next(error);
            });
    }

    /**
     * Load model with the current provider
     */
    async loadModel(
        modelId: string,
        config?: TransformersConfig | OllamaConfig | OpenAIConfig | GeminiConfig
    ): Promise<ModelInfo> {
        return await this.providerOperations.transition(async () => {
            if (!this.provider) {
                throw new Error("No embedding provider initialized");
            }
            return await this.provider.loadModel(modelId, config);
        });
    }

    async unloadModel(): Promise<void> {
        await this.providerOperations.transition(async () => {
            await this.provider?.unloadModel();
        });
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
        return await this.runProviderOperation((provider) =>
            provider.embedText(text)
        );
    }

    async embedTexts(texts: string[]): Promise<number[][]> {
        return await this.runProviderOperation((provider) =>
            provider.embedTexts(texts)
        );
    }

    async countTokens(text: string): Promise<number> {
        return await this.runProviderOperation((provider) =>
            provider.countTokens(text)
        );
    }

    private async runProviderOperation<T>(
        operation: (provider: EmbeddingProvider) => Promise<T>
    ): Promise<T> {
        return await this.providerOperations.run(async () => {
            const provider = this.provider;
            if (!provider) {
                throw new Error("No embedding provider initialized");
            }

            if (provider.supportsParallelProcessing()) {
                return await operation(provider);
            }

            const result = this.localOperationQueue.then(
                () => operation(provider),
                () => operation(provider)
            );
            this.localOperationQueue = result.then(
                () => undefined,
                () => undefined
            );
            return await result;
        });
    }

    async waitUntilIdle(): Promise<void> {
        await this.providerOperations.waitUntilIdle();
        await this.localOperationQueue;
    }

    public getVectorSize(): number {
        if (!this.provider) {
            throw new Error("No embedding provider initialized");
        }
        return this.provider.getVectorSize();
    }

    public getMaxTokens(): number {
        if (!this.provider) {
            throw new Error("No embedding provider initialized");
        }
        return this.provider.getMaxTokens();
    }

    /**
     * Truncate text to fit within the maximum token limit
     * Uses binary search for efficiency
     */
    async truncateToMaxTokens(text: string): Promise<string> {
        return await this.runProviderOperation(async (provider) => {
            const maxTokens = provider.getMaxTokens();
            const tokenCount = await provider.countTokens(text);

            if (tokenCount <= maxTokens) {
                return text;
            }

            // Binary search to find the right truncation point
            let left = 0;
            let right = text.length;
            let result = "";

            while (left < right) {
                const mid = Math.floor((left + right + 1) / 2);
                const truncated = text.substring(0, mid);
                const count = await provider.countTokens(truncated);

                if (count <= maxTokens) {
                    result = truncated;
                    left = mid;
                } else {
                    right = mid - 1;
                }
            }

            return result;
        });
    }

    public isModelLoaded(): boolean {
        return this.provider?.isModelLoaded() ?? false;
    }

    public getCurrentModelId(): string | null {
        return this.provider?.getCurrentModelId() ?? null;
    }

    public getCurrentProviderType(): "builtin" | "ollama" | "openai" | "gemini" | null {
        return this.currentProviderType;
    }

    public dispose(): void {
        this.disposeProvider();
    }

    async disposeWhenIdle(): Promise<void> {
        await this.providerOperations.transition(async () => {
            this.disposeProvider();
        });
    }

    private disposeProvider(): void {
        // Clean up subscriptions
        this.modelBusySubscription?.unsubscribe();
        this.downloadProgressSubscription?.unsubscribe();
        this.modelErrorSubscription?.unsubscribe();

        if (this.provider) {
            this.provider.dispose();
            this.provider = null;
        }
        this.currentProviderType = null;
    }

    public setLogLevel(level: log.LogLevelDesc): void {
        // Only TransformersEmbeddingProvider supports log level setting
        if (this.provider instanceof TransformersEmbeddingProvider) {
            this.provider.setLogLevel(level);
        }
    }

    /**
     * Check if the current provider supports parallel file processing
     * Cloud providers (OpenAI, Gemini) return true for better throughput
     * Local providers (Transformers, Ollama) return false to avoid resource contention
     */
    public supportsParallelProcessing(): boolean {
        return this.provider?.supportsParallelProcessing() ?? false;
    }

    /**
     * Check if the current provider supports usage tracking
     * Cloud providers (OpenAI, Gemini) return true for cost estimation
     * Local providers (Transformers, Ollama) return false
     */
    public supportsUsageTracking(): boolean {
        return this.provider?.supportsUsageTracking() ?? false;
    }
}
