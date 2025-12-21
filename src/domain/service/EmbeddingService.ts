import type { SimilarNotesSettings, SettingsService } from "@/application/SettingsService";
import log from "loglevel";
import { Subject, type Observable, type Subscription } from "rxjs";
import { type EmbeddingProvider, type ModelInfo } from "./EmbeddingProvider";
import {
    OllamaEmbeddingProvider,
    type OllamaConfig,
} from "./OllamaEmbeddingProvider";
import {
    TransformersEmbeddingProvider,
    type TransformersConfig,
} from "./TransformersEmbeddingProvider";

export class EmbeddingService {
    private provider: EmbeddingProvider | null = null;
    private currentProviderType: "builtin" | "ollama" | null = null;

    constructor(private settingsService?: SettingsService) {}

    // Proxy subjects that relay provider's observables
    private modelBusy$ = new Subject<boolean>();
    private downloadProgress$ = new Subject<number>();
    private modelError$ = new Subject<string | null>();

    // Subscriptions to provider's observables
    private modelBusySubscription?: Subscription;
    private downloadProgressSubscription?: Subscription;
    private modelErrorSubscription?: Subscription;

    /**
     * Switch to a different embedding provider based on settings
     */
    async switchProvider(settings: SimilarNotesSettings): Promise<void> {
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
                    : settings.ollamaModel;

            if (currentModelId === targetModelId) {
                // For builtin provider, GPU settings change requires reload
                if (newProviderType === "builtin") {
                    log.info(
                        "Same model but GPU settings may have changed, continuing with provider switch"
                    );
                } else {
                    log.info(
                        "Same provider and model already loaded, skipping switch"
                    );
                    return;
                }
            }
        }

        // Dispose current provider
        if (this.provider) {
            log.info(
                "Disposing current embedding provider:",
                this.currentProviderType
            );

            // Unsubscribe from current provider's observables
            this.modelBusySubscription?.unsubscribe();
            this.downloadProgressSubscription?.unsubscribe();
            this.modelErrorSubscription?.unsubscribe();

            this.provider.dispose();
            this.provider = null;
        }

        // Create new provider
        if (newProviderType === "builtin") {
            log.info("Switching to Transformers embedding provider");
            this.provider = new TransformersEmbeddingProvider(this.settingsService);
            this.setupProviderSubscriptions();
            await this.loadModel(settings.modelId, { useGPU: settings.useGPU });
        } else if (newProviderType === "ollama") {
            log.info("Switching to Ollama embedding provider");
            const ollamaConfig: OllamaConfig = {
                url: settings.ollamaUrl || "http://localhost:11434",
                model: settings.ollamaModel || "",
            };
            this.provider = new OllamaEmbeddingProvider(ollamaConfig);
            this.setupProviderSubscriptions();
            await this.loadModel(settings.ollamaModel || "", ollamaConfig);
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
        config?: TransformersConfig | OllamaConfig
    ): Promise<ModelInfo> {
        if (!this.provider) {
            throw new Error("No embedding provider initialized");
        }

        return await this.provider.loadModel(modelId, config);
    }

    async unloadModel(): Promise<void> {
        if (!this.provider) {
            return;
        }
        await this.provider.unloadModel();
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
        if (!this.provider) {
            throw new Error("No embedding provider initialized");
        }
        return await this.provider.embedText(text);
    }

    async embedTexts(texts: string[]): Promise<number[][]> {
        if (!this.provider) {
            throw new Error("No embedding provider initialized");
        }
        return await this.provider.embedTexts(texts);
    }

    async countTokens(text: string): Promise<number> {
        if (!this.provider) {
            throw new Error("No embedding provider initialized");
        }
        return await this.provider.countTokens(text);
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
        if (!this.provider) {
            throw new Error("No embedding provider initialized");
        }

        const maxTokens = this.provider.getMaxTokens();
        const tokenCount = await this.provider.countTokens(text);

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
            const count = await this.provider.countTokens(truncated);

            if (count <= maxTokens) {
                result = truncated;
                left = mid;
            } else {
                right = mid - 1;
            }
        }

        return result;
    }

    public isModelLoaded(): boolean {
        return this.provider?.isModelLoaded() ?? false;
    }

    public getCurrentModelId(): string | null {
        return this.provider?.getCurrentModelId() ?? null;
    }

    public getCurrentProviderType(): "builtin" | "ollama" | null {
        return this.currentProviderType;
    }

    public dispose(): void {
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
}
