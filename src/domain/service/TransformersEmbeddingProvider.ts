import * as Comlink from "comlink";
import log from "loglevel";
import { type Observable, Subject } from "rxjs";
import type { TransformersWorker } from "./transformers.worker";
import { type EmbeddingProvider, type ModelInfo } from "./EmbeddingProvider";
// @ts-ignore
import InlineWorker from "./transformers.worker";

export interface TransformersConfig {
    useGPU: boolean;
}

export class TransformersEmbeddingProvider implements EmbeddingProvider {
    private worker: Comlink.Remote<TransformersWorker> | null = null;
    private modelId: string | null = null;
    private vectorSize: number | null = null;
    private maxTokens: number | null = null;
    private modelBusy$ = new Subject<boolean>();
    private downloadProgress$ = new Subject<number>();

    async loadModel(modelId: string, config?: TransformersConfig): Promise<ModelInfo> {
        const useGPU = config?.useGPU ?? true;
        log.info("Loading Transformers model", modelId, "with GPU:", useGPU);
        
        // Clean up existing worker if any
        await this.unloadModel();
        
        const WorkerWrapper = Comlink.wrap(new InlineWorker());
        // @ts-ignore
        this.worker = await new WorkerWrapper();
        log.info("TransformersWorker initialized", this.worker);
        
        if (!this.worker) {
            throw new Error("TransformersWorker not initialized");
        }

        await this.worker.setLogLevel(log.getLevel());

        const response = await this.worker.handleLoad(
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

    async unloadModel(): Promise<void> {
        if (!this.worker) {
            return;
        }

        try {
            await this.worker.handleUnload();
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

    async embedText(text: string): Promise<number[]> {
        if (!this.worker || !this.modelId) {
            throw new Error("Transformers model not loaded");
        }

        this.modelBusy$.next(true);
        try {
            const result = await this.worker.handleEmbed(text);
            return result;
        } finally {
            this.modelBusy$.next(false);
        }
    }

    async embedTexts(texts: string[]): Promise<number[][]> {
        if (!this.worker || !this.modelId) {
            throw new Error("Transformers model not loaded");
        }

        this.modelBusy$.next(true);
        try {
            const result = await this.worker.handleEmbedBatch(texts);
            return result;
        } finally {
            this.modelBusy$.next(false);
        }
    }

    async countTokens(text: string): Promise<number> {
        if (!this.worker || !this.modelId) {
            throw new Error("Transformers model not loaded");
        }

        return await this.worker.handleCountToken(text);
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
        return this.worker !== null && this.modelId !== null;
    }

    getCurrentModelId(): string | null {
        return this.modelId;
    }

    dispose(): void {
        if (this.worker) {
            this.worker
                .handleUnload()
                .catch((err) => {
                    log.error("Error unloading Transformers model:", err);
                })
                .finally(() => {
                    if (this.worker && this.worker[Comlink.releaseProxy]) {
                        this.worker[Comlink.releaseProxy]();
                    }

                    this.worker = null;
                });
        }
        this.modelId = null;
        this.vectorSize = null;
        this.maxTokens = null;
    }

    setLogLevel(level: log.LogLevelDesc): void {
        if (this.worker) {
            this.worker
                .setLogLevel(level)
                .catch((err) =>
                    log.error(
                        "Failed to set log level on TransformersWorker",
                        err
                    )
                );
        }
    }
}