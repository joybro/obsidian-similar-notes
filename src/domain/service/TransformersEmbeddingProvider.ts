import * as Comlink from "comlink";
import log from "loglevel";
import { type Observable, Subject } from "rxjs";
import type { TransformersWorker } from "./transformers.worker";
import { type EmbeddingProvider, type ModelInfo } from "./EmbeddingProvider";
import { WorkerManager } from "@/infrastructure/WorkerManager";
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

    constructor() {
        this.workerManager = new WorkerManager<TransformersWorker>("TransformersWorker");
    }

    async loadModel(modelId: string, config?: TransformersConfig): Promise<ModelInfo> {
        const useGPU = config?.useGPU ?? true;
        log.info("Loading Transformers model", modelId, "with GPU:", useGPU);
        
        // Clean up existing worker if any
        await this.unloadModel();
        
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