import { WorkerManager } from "@/infrastructure/WorkerManager";
import * as Comlink from "comlink";
import log from "loglevel";
import { Notice } from "obsidian";
import { type Observable, Subject } from "rxjs";
import { type EmbeddingProvider, type ModelInfo } from "./EmbeddingProvider";
import type { TransformersWorker } from "./transformers.worker";
// @ts-ignore
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

    constructor() {
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
        } catch (error) {
            const errorMessage =
                error instanceof Error
                    ? error.message
                    : "Unknown error occurred";
            log.error("Failed to load Transformers model:", errorMessage);

            // Extract simplified error message for user display
            let userFriendlyMessage = errorMessage;
            if (
                errorMessage.includes("webgpu") ||
                errorMessage.includes("WebGPU")
            ) {
                userFriendlyMessage =
                    "GPU acceleration failed - try disabling GPU in settings";
            } else if (errorMessage.includes("Failed to get GPU adapter")) {
                userFriendlyMessage =
                    "GPU not available - disable GPU acceleration in settings";
            } else if (
                errorMessage.includes("network") ||
                errorMessage.includes("fetch")
            ) {
                userFriendlyMessage =
                    "Network error - check your internet connection";
            } else if (errorMessage.length > 100) {
                // Truncate very long error messages
                userFriendlyMessage = errorMessage.substring(0, 100) + "...";
            }

            // Show notice to user
            new Notice(`Failed to load model: ${userFriendlyMessage}`, 8000);

            // Emit error state
            this.modelError$.next(userFriendlyMessage);

            throw error;
        }
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
}
