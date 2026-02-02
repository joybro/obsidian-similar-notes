import type { SettingsService } from "@/application/SettingsService";
import { GPUSettingModal } from "@/components/GPUSettingModal";
import { WorkerManager } from "@/infrastructure/WorkerManager";
import { handleEmbeddingLoadError, isGPUError } from "@/utils/errorHandling";
import * as Comlink from "comlink";
import log from "loglevel";
import { Notice } from "obsidian";
import { type Observable, Subject } from "rxjs";
import { type EmbeddingProvider, type ModelInfo } from "./EmbeddingProvider";
import type { TransformersWorker } from "./transformers.worker";
// @ts-expect-error - Worker import handled by bundler
import InlineWorker from "./transformers.worker";

export interface TransformersConfig {
    useGPU: boolean;
}

export class TransformersEmbeddingProvider implements EmbeddingProvider {
    private workerManager: WorkerManager<TransformersWorker>;
    private modelId: string | null = null;
    private vectorSize: number | null = null;
    private maxTokens: number | null = null;
    private modelBusy$ = new Subject<boolean>();
    private downloadProgress$ = new Subject<number>();
    private modelError$ = new Subject<string | null>();

    constructor(private settingsService?: SettingsService) {
        this.workerManager = new WorkerManager<TransformersWorker>(
            "TransformersWorker"
        );
    }

    async loadModel(
        modelId: string,
        config?: TransformersConfig
    ): Promise<ModelInfo> {
        const useGPU = config?.useGPU ?? true;
        log.info("Loading Transformers model", modelId, "with GPU:", useGPU);

        // Clear any previous error state
        this.modelError$.next(null);

        // Clean up existing worker if any
        await this.unloadModel();

        try {
            return await this.tryLoadModel(modelId, useGPU);
        } catch (error) {
            // If GPU failed and we can retry with CPU
            if (useGPU && isGPUError(error) && this.settingsService) {
                log.info("GPU failed, retrying with CPU...");
                new Notice("GPU failed, retrying with CPU...", 3000);
                
                try {
                    const result = await this.tryLoadModel(modelId, false);
                    
                    // Show modal to ask user about disabling GPU setting
                    this.showGPUSettingModal();
                    
                    return result;
                } catch (cpuError) {
                    log.error("CPU fallback also failed:", cpuError);
                    handleEmbeddingLoadError(cpuError, {
                        providerName: "Transformers",
                        errorSubject: this.modelError$
                    });
                }
            } else {
                log.error("Failed to load Transformers model:", error);
                handleEmbeddingLoadError(error, {
                    providerName: "Transformers",
                    errorSubject: this.modelError$
                });
            }
        }
    }

    private async tryLoadModel(modelId: string, useGPU: boolean): Promise<ModelInfo> {
        const worker = await this.workerManager.initialize(InlineWorker);

        const response = await worker.handleLoad(
            modelId,
            Comlink.proxy((progress: number) => {
                this.downloadProgress$.next(progress);
            }),
            useGPU
        );
        log.info("Transformers model loaded", response);

        this.modelId = modelId;
        this.vectorSize = response.vectorSize;
        this.maxTokens = response.maxTokens;

        return {
            vectorSize: response.vectorSize,
            maxTokens: response.maxTokens,
        };
    }

    private showGPUSettingModal(): void {
        if (!this.settingsService) return;

        // We need the app instance for the modal, but we don't have direct access
        // Let's use a different approach - we'll add this to the global window temporarily
        const modal = new GPUSettingModal(
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            (window as any).app, // Access global app instance
            async () => {
                // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
                await this.settingsService!.update({ useGPU: false });
            }
        );
        modal.open();
    }

    async unloadModel(): Promise<void> {
        if (!this.workerManager.isInitialized()) {
            return;
        }

        try {
            const worker = this.workerManager.getWorker();
            await worker.handleUnload();
        } catch (error) {
            log.error("Error unloading Transformers model:", error);
        }

        this.modelId = null;
        this.vectorSize = null;
        this.maxTokens = null;
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
        this.workerManager.ensureInitialized();
        if (!this.modelId) {
            throw new Error("Transformers model not loaded");
        }

        this.modelBusy$.next(true);
        try {
            const worker = this.workerManager.getWorker();
            const result = await worker.handleEmbed(text);
            return result;
        } finally {
            this.modelBusy$.next(false);
        }
    }

    async embedTexts(texts: string[]): Promise<number[][]> {
        this.workerManager.ensureInitialized();
        if (!this.modelId) {
            throw new Error("Transformers model not loaded");
        }

        this.modelBusy$.next(true);
        try {
            const worker = this.workerManager.getWorker();
            const result = await worker.handleEmbedBatch(texts);
            return result;
        } finally {
            this.modelBusy$.next(false);
        }
    }

    async countTokens(text: string): Promise<number> {
        this.workerManager.ensureInitialized();
        if (!this.modelId) {
            throw new Error("Transformers model not loaded");
        }

        const worker = this.workerManager.getWorker();
        return await worker.handleCountToken(text);
    }

    getVectorSize(): number {
        if (!this.vectorSize) {
            throw new Error("Transformers model not loaded");
        }
        return this.vectorSize;
    }

    getMaxTokens(): number {
        if (!this.maxTokens) {
            throw new Error("Transformers model not loaded");
        }
        return this.maxTokens;
    }

    isModelLoaded(): boolean {
        return this.workerManager.isInitialized() && this.modelId !== null;
    }

    getCurrentModelId(): string | null {
        return this.modelId;
    }

    dispose(): void {
        if (this.workerManager.isInitialized()) {
            const worker = this.workerManager.getWorker();
            worker
                .handleUnload()
                .catch((err: unknown) => {
                    log.error("Error unloading Transformers model:", err);
                })
                .finally(() => {
                    this.workerManager.dispose();
                });
        }
        this.modelId = null;
        this.vectorSize = null;
        this.maxTokens = null;
    }

    setLogLevel(level: log.LogLevelDesc): void {
        this.workerManager.updateLogLevel(level);
    }

    /**
     * Transformers runs in a single Web Worker with sequential queue
     * Parallel file processing would not improve performance
     */
    supportsParallelProcessing(): boolean {
        return false;
    }
}
