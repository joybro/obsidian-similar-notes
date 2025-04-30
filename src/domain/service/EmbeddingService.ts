import * as Comlink from "comlink";
import log from "loglevel";
import type { TransformersWorker } from "./transformers.worker";
// @ts-ignore
import InlineWorker from "./transformers.worker";

export class EmbeddingService {
    private worker: Comlink.Remote<TransformersWorker> | null = null;
    private modelId: string | null = null;
    private vectorSize: number | null = null;
    private maxTokens: number | null = null;

    public async loadModel(modelId: string): Promise<void> {
        log.info("Loading model", modelId);
        const WorkerWrapper = Comlink.wrap(new InlineWorker());
        // @ts-ignore
        this.worker = await new WorkerWrapper();
        log.info("Worker initialized", this.worker);
        if (!this.worker) {
            throw new Error("Worker not initialized");
        }

        const response = await this.worker.handleLoad(modelId);
        log.info("Model loaded", response);

        this.modelId = modelId;
        this.vectorSize = response.vectorSize;
        this.maxTokens = response.maxTokens;
    }

    public async unloadModel(): Promise<void> {
        if (!this.worker) {
            return;
        }

        await this.worker.handleUnload();

        this.modelId = null;
        this.vectorSize = null;
        this.maxTokens = null;
    }

    public async embedTexts(texts: string[]): Promise<number[][]> {
        if (!this.worker || !this.modelId) {
            throw new Error("Model not loaded");
        }

        return await this.worker.handleEmbedBatch(texts);
    }

    public async countTokens(text: string): Promise<number> {
        if (!this.worker || !this.modelId) {
            throw new Error("Model not loaded");
        }

        return await this.worker.handleCountToken(text);
    }

    public getVectorSize(): number {
        if (!this.vectorSize) {
            throw new Error("Model not loaded");
        }
        return this.vectorSize;
    }

    public getMaxTokens(): number {
        if (!this.maxTokens) {
            throw new Error("Model not loaded");
        }
        return this.maxTokens;
    }

    public dispose(): void {
        if (this.worker) {
            // We don't have this in the test environment
            if (this.worker[Comlink.releaseProxy]) {
                this.worker[Comlink.releaseProxy]();
            }
            this.worker = null;
        }
        this.modelId = null;
        this.vectorSize = null;
        this.maxTokens = null;
    }
}
