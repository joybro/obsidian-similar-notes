import log from "loglevel";
import { type Observable, Subject, of } from "rxjs";
import type { SimilarNotesSettings } from "@/application/SettingsService";
import { type EmbeddingProvider, type ModelInfo } from "./EmbeddingProvider";
import { TransformersEmbeddingProvider, type TransformersConfig } from "./TransformersEmbeddingProvider";
import { OllamaEmbeddingProvider, type OllamaConfig } from "./OllamaEmbeddingProvider";

export class EmbeddingService {
    private provider: EmbeddingProvider | null = null;
    private currentProviderType: "builtin" | "ollama" | null = null;
    
    // Default observables for when no provider is initialized
    private defaultModelBusy$ = new Subject<boolean>();
    private defaultDownloadProgress$ = new Subject<number>();

    /**
     * Switch to a different embedding provider based on settings
     */
    async switchProvider(settings: SimilarNotesSettings): Promise<void> {
        const newProviderType = settings.modelProvider;
        
        // If same provider type and model, no need to switch
        if (this.currentProviderType === newProviderType && this.provider?.isModelLoaded()) {
            const currentModelId = this.provider.getCurrentModelId();
            const targetModelId = newProviderType === "builtin" ? settings.modelId : settings.ollamaModel;
            
            if (currentModelId === targetModelId) {
                log.info("Same provider and model already loaded, skipping switch");
                return;
            }
        }

        // Dispose current provider
        if (this.provider) {
            log.info("Disposing current embedding provider:", this.currentProviderType);
            this.provider.dispose();
            this.provider = null;
        }

        // Create new provider
        if (newProviderType === "builtin") {
            log.info("Switching to Transformers embedding provider");
            this.provider = new TransformersEmbeddingProvider();
            await this.loadModel(settings.modelId, { useGPU: settings.useGPU });
        } else if (newProviderType === "ollama") {
            log.info("Switching to Ollama embedding provider");
            const ollamaConfig: OllamaConfig = {
                url: settings.ollamaUrl || "http://localhost:11434",
                model: settings.ollamaModel || "",
            };
            this.provider = new OllamaEmbeddingProvider(ollamaConfig);
            await this.loadModel(settings.ollamaModel || "", ollamaConfig);
        } else {
            throw new Error(`Unknown provider type: ${newProviderType}`);
        }

        this.currentProviderType = newProviderType;
        log.info("Successfully switched to provider:", newProviderType);
    }

    /**
     * Load model with the current provider
     */
    async loadModel(modelId: string, config?: TransformersConfig | OllamaConfig): Promise<ModelInfo> {
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
        if (!this.provider) {
            // Return default observable when no provider is initialized
            return this.defaultModelBusy$.asObservable();
        }
        return this.provider.getModelBusy$();
    }

    getDownloadProgress$(): Observable<number> {
        if (!this.provider) {
            // Return default observable when no provider is initialized
            return this.defaultDownloadProgress$.asObservable();
        }
        return this.provider.getDownloadProgress$();
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
