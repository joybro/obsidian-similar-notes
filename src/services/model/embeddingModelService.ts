import type {
    ModelLoadResponse,
    WorkerMessage,
    WorkerResponse,
} from "./transformers.worker";
// @ts-ignore
import InlineWorker from "./transformers.worker";

export class EmbeddingModelService {
    private worker: Worker | null = null;
    private modelId: string | null = null;
    private vectorSize: number | null = null;
    private maxTokens: number | null = null;

    constructor() {
        if (process.env.NODE_ENV === "test") {
            // for testing
            this.worker = new Worker("");
        } else {
            this.worker = new InlineWorker();
        }

        if (this.worker) {
            this.worker.onerror = (e) => {
                console.error(
                    "[Worker Error]",
                    e.message,
                    "at",
                    `${e.filename}:${e.lineno}:${e.colno}`
                );
            };
        }
    }

    public async loadModel(modelId: string): Promise<ModelLoadResponse> {
        if (!this.worker) {
            throw new Error("Worker not initialized");
        }

        const response = await this.sendMessage({
            type: "load",
            modelId,
        });

        if (response.type === "error") {
            throw new Error(response.error);
        }

        const modelResponse = response.data as ModelLoadResponse;
        this.modelId = modelId;
        this.vectorSize = modelResponse.vectorSize;
        this.maxTokens = modelResponse.maxTokens;

        return modelResponse;
    }

    public async unloadModel(): Promise<void> {
        if (!this.worker) {
            return;
        }

        const response = await this.sendMessage({
            type: "unload",
        });

        if (response.type === "error") {
            throw new Error(response.error);
        }

        this.modelId = null;
        this.vectorSize = null;
        this.maxTokens = null;
    }

    public async embedTexts(texts: string[]): Promise<number[][]> {
        if (!this.worker || !this.modelId) {
            throw new Error("Model not loaded");
        }

        const response = await this.sendMessage({
            type: "embed_batch",
            texts,
        });

        if (response.type === "error") {
            throw new Error(response.error);
        }

        return response.data as number[][];
    }

    public async countTokens(text: string): Promise<number> {
        if (!this.worker || !this.modelId) {
            throw new Error("Model not loaded");
        }

        const response = await this.sendMessage({
            type: "count_token",
            text,
        });

        if (response.type === "error") {
            throw new Error(response.error);
        }

        return response.data as number;
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

    private sendMessage(message: WorkerMessage): Promise<WorkerResponse> {
        return new Promise((resolve, reject) => {
            if (!this.worker) {
                reject(new Error("Worker not initialized"));
                return;
            }

            const handleMessage = (event: MessageEvent<WorkerResponse>) => {
                this.worker?.removeEventListener("message", handleMessage);
                resolve(event.data);
            };

            this.worker.addEventListener("message", handleMessage);
            this.worker.postMessage(message);
        });
    }

    public dispose(): void {
        if (this.worker) {
            this.worker.terminate();
            this.worker = null;
        }
        this.modelId = null;
        this.vectorSize = null;
        this.maxTokens = null;
    }
}
