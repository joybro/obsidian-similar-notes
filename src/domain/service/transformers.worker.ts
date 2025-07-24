import type {
    FeatureExtractionPipeline,
    Pipeline,
    PretrainedOptions,
    ProgressInfo,
} from "@huggingface/transformers";
import * as comlink from "comlink";
import log from "loglevel";

interface Transformers {
    pipeline(
        type: string,
        modelId: string,
        options: PretrainedOptions
    ): Promise<Pipeline>;
}

// __IS_TEST__ 는 빌드 시 esbuild에 의해 주입됩니다
declare const __IS_TEST__: string;
const isTest = __IS_TEST__ === "true";

const createMockPipeline = () => {
    const mockPipeline = async (text: string | string[]) => {
        let texts: string[];
        if (typeof text === "string") {
            texts = [text];
        } else {
            texts = text;
        }

        const embeddings = texts.map(() => new Array(384).fill(0));
        return {
            tolist: () => embeddings,
        };
    };
    mockPipeline.tokenizer = {
        model: {
            max_position_embeddings: 512,
        },
        encode: (text: string) => new Array(Math.ceil(text.length / 4)).fill(0), // Rough mock implementation
    };

    return {
        pipeline: async () => mockPipeline as unknown as Pipeline,
    };
};

// Dynamic import of transformers library
async function importTransformers(): Promise<Transformers> {
    try {
        // In Node.js environment during testing, return a mock
        if (isTest) {
            return createMockPipeline();
        }

        // Obsidian's plugin runtime environment(renderer process) has process object
        // and it makes transformers.js think it's Node.js environment.
        // So we need to remove it.
        Object.defineProperty(globalThis, "process", {
            get: () => undefined,
            configurable: true,
        });

        // @ts-ignore
        return await import("@huggingface/transformers");
    } catch (error) {
        throw new Error(
            `Failed to load transformers library: ${
                error instanceof Error ? error.message : String(error)
            }`
        );
    }
}

class TransformersWorker {
    extractor: FeatureExtractionPipeline | null = null;
    vectorSize: number | null = null;
    maxTokens: number | null = null;
    private embeddingQueue: Promise<unknown> = Promise.resolve();

    setLogLevel(level: log.LogLevelDesc): void {
        log.setLevel(level);
        log.info(`TransformersWorker log level set to: ${log.getLevel()}`);
    }

    constructor() {
        this.extractor = null;
        this.vectorSize = null;
        this.maxTokens = null;
    }

    private async enqueue<T>(task: () => Promise<T>): Promise<T> {
        // Chain the new task to the current queue
        this.embeddingQueue = this.embeddingQueue
            .then(() => task())
            .catch((e) => {
                console.error(e);
                throw e;
            });

        return this.embeddingQueue as Promise<T>;
    }

    async handleLoad(
        modelId: string,
        progress_callback: (progress: number) => void,
        useGPU: boolean = true
    ): Promise<{ vectorSize: number; maxTokens: number }> {
        log.info(`Loading model: ${modelId}, useGPU: ${useGPU}`);
        const transformers = await importTransformers();
        this.extractor = await transformers.pipeline(
            "feature-extraction",
            modelId,
            {
                // @ts-ignore
                dtype: "fp32",
                device: useGPU ? "webgpu" : "wasm", // Use WebGPU if enabled, otherwise fall back to WASM
                progress_callback: (progress: ProgressInfo) => {
                    if (progress.status === "progress") {
                        if (progress.file.includes("onnx")) {
                            progress_callback(progress.progress);
                        }
                    }
                },
            }
        );

        // Get vector size by running inference on a test input
        const tensor = await this.extractor("test", {
            pooling: "mean",
            normalize: true,
        });
        const testEmbedding = tensor.tolist();
        tensor.dispose();
        this.vectorSize = testEmbedding[0].length;

        // Get max tokens from the tokenizer
        this.maxTokens = this.extractor.tokenizer.model_max_length ?? 512;

        if (this.vectorSize === null || this.maxTokens === null) {
            throw new Error("Failed to initialize model parameters");
        }

        return {
            vectorSize: this.vectorSize,
            maxTokens: this.maxTokens,
        };
    }

    async handleUnload(): Promise<void> {
        if (this.extractor) {
            // @ts-ignore
            if (typeof this.extractor.dispose === "function") {
                await this.extractor.dispose();
            }
        }

        this.extractor = null;
    }

    async handleEmbed(text: string): Promise<number[]> {
        if (!this.extractor) {
            throw new Error("Model not loaded");
        }

        const extractor = this.extractor; // Create a local reference to avoid null check issues
        return this.enqueue(async () => {
            const tensor = await extractor(text, {
                pooling: "mean",
                normalize: true,
            });

            const result = tensor.tolist()[0];
            tensor.dispose();
            return result;
        });
    }

    async handleEmbedBatch(texts: string[]): Promise<number[][]> {
        if (!this.extractor) {
            throw new Error("Model not loaded");
        }

        const extractor = this.extractor; // Create a local reference to avoid null check issues
        return this.enqueue(async () => {
            const tensor = await extractor(texts, {
                pooling: "mean",
                normalize: true,
            });

            const result = tensor.tolist();
            tensor.dispose();
            return result;
        });
    }

    // Add new handler for count_token
    async handleCountToken(text: string): Promise<number> {
        if (!this.extractor) {
            throw new Error("Model not loaded");
        }

        return this.extractor.tokenizer.encode(text).length;
    }
}

export type { TransformersWorker };

comlink.expose(TransformersWorker);
