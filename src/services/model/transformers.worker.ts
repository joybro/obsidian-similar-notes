import type {
    FeatureExtractionPipeline,
    Pipeline,
    PretrainedOptions,
} from "@huggingface/transformers";

// Types for messages between main thread and worker
export type LoadMessage = {
    type: "load";
    modelId: string;
};

export type CountTokenMessage = {
    type: "count_token";
    text: string;
};

export type UnloadMessage = {
    type: "unload";
};

export type EmbedBatchMessage = {
    type: "embed_batch";
    texts: string[];
};

export type WorkerMessage =
    | LoadMessage
    | UnloadMessage
    | EmbedBatchMessage
    | CountTokenMessage;

export type WorkerResponse = {
    type: "success" | "error";
    data?: unknown;
    error?: string;
};

export type ModelLoadResponse = {
    message: string;
    vectorSize: number;
    maxTokens: number;
};

interface Transformers {
    pipeline(
        type: string,
        modelId: string,
        options: PretrainedOptions
    ): Promise<Pipeline>;
}

// Global variables
let extractor: FeatureExtractionPipeline | null = null;
let vectorSize: number | null = null;
let maxTokens: number | null = null;

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
    vectorSize = 384;
    maxTokens = 512;
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

// Message handler setup for both browser and Node.js environments
const setupMessageHandler = () => {
    const handleMessage = async (message: WorkerMessage) => {
        try {
            switch (message.type) {
                case "load":
                    await handleLoad(message);
                    break;
                case "unload":
                    await handleUnload(message);
                    break;
                case "embed_batch":
                    await handleEmbedBatch(message);
                    break;
                case "count_token":
                    await handleCountToken(message);
                    break;
                default:
                    throw new Error(
                        `Unknown message type: ${
                            (message as { type: string }).type
                        }`
                    );
            }
        } catch (error) {
            const response: WorkerResponse = {
                type: "error",
                error: error instanceof Error ? error.message : String(error),
            };

            postMessage(response);
        }
    };

    if (isTest) {
        // Node.js environment
        try {
            // Using type assertion since we know the module exists in Node.js
            const nodeWorker =
                require("node:worker_threads") as typeof import("node:worker_threads");
            nodeWorker.parentPort?.on("message", handleMessage);
        } catch (e) {
            // Ignore error in browser environment
        }
    } else {
        // Browser environment
        self.onmessage = (event: MessageEvent<WorkerMessage>) =>
            handleMessage(event.data);
    }
};

function postMessage(response: WorkerResponse): void {
    if (isTest) {
        try {
            const nodeWorker =
                require("node:worker_threads") as typeof import("node:worker_threads");
            nodeWorker.parentPort?.postMessage(response);
        } catch (e) {
            // Ignore error in browser environment
            console.error("postMessage error", e);
        }
    } else {
        self.postMessage(response);
    }
}

async function handleLoad(message: LoadMessage): Promise<void> {
    const transformers = await importTransformers();
    extractor = await transformers.pipeline(
        "feature-extraction",
        message.modelId,
        {
            // @ts-ignore
            dtype: "fp32",
            device: "webgpu",
        }
    );

    // Get vector size by running inference on a test input
    const tensor = await extractor("test", {
        pooling: "mean",
        normalize: true,
    });
    const testEmbedding = tensor.tolist();
    vectorSize = testEmbedding[0].length;

    // Get max tokens from the tokenizer
    maxTokens = extractor.tokenizer.model_max_length ?? 512;

    const response: WorkerResponse = {
        type: "success",
        data: {
            message: "Model loaded successfully",
            vectorSize,
            maxTokens,
        } as ModelLoadResponse,
    };

    postMessage(response);
}

async function handleUnload(message: UnloadMessage): Promise<void> {
    extractor = null;

    postMessage({
        type: "success",
        data: "Model unloaded successfully",
    });
}

async function handleEmbedBatch(message: EmbedBatchMessage): Promise<void> {
    if (!extractor) {
        throw new Error("Model not loaded");
    }

    const tensor = await extractor(message.texts, {
        pooling: "mean",
        normalize: true,
    });
    const embeddings = tensor.tolist();

    postMessage({
        type: "success",
        data: embeddings,
    });
}

// Add new handler for count_token
async function handleCountToken(message: CountTokenMessage): Promise<void> {
    if (!extractor) {
        throw new Error("Model not loaded");
    }

    const tokenCount = extractor.tokenizer.encode(message.text).length;

    postMessage({
        type: "success",
        data: tokenCount,
    });
}

// Initialize message handler
setupMessageHandler();
