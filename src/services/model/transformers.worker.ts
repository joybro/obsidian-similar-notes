import type {
    FeatureExtractionPipeline,
    Pipeline,
    PretrainedOptions,
} from "@huggingface/transformers";
import * as comlink from "comlink";

interface Transformers {
    pipeline(
        type: string,
        modelId: string,
        options: PretrainedOptions
    ): Promise<Pipeline>;
}

const isTest =
    typeof process === "undefined" || process.versions?.electron === undefined;

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

    constructor() {
        console.log("TransformersWorker constructor");
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
        modelId: string
    ): Promise<{ vectorSize: number; maxTokens: number }> {
        const transformers = await importTransformers();
        this.extractor = await transformers.pipeline(
            "feature-extraction",
            modelId,
            {
                // @ts-ignore
                dtype: "fp32",
                device: "webgpu",
            }
        );

        // Get vector size by running inference on a test input
        const tensor = await this.extractor("test", {
            pooling: "mean",
            normalize: true,
        });
        const testEmbedding = tensor.tolist();
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
        this.extractor = null;
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

            return tensor.tolist();
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
