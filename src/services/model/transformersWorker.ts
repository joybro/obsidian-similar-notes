// Types for messages between main thread and worker
type LoadMessage = {
    type: "load";
    modelId: string;
};

type CountTokenMessage = {
    type: "count_token";
    text: string;
};

type UnloadMessage = {
    type: "unload";
};

type EmbedBatchMessage = {
    type: "embed_batch";
    texts: string[];
};

type WorkerMessage =
    | LoadMessage
    | UnloadMessage
    | EmbedBatchMessage
    | CountTokenMessage;

type WorkerResponse = {
    type: "success" | "error";
    data?: unknown;
    error?: string;
};

type ModelLoadResponse = {
    message: string;
    vectorSize: number;
    maxTokens: number;
};

// Define types for the transformers library
interface Pipeline {
    (text: string, options: { pooling: string; normalize: boolean }): Promise<
        number[]
    >;
    model: unknown;
    tokenizer: {
        model: {
            max_position_embeddings?: number;
        };
        encode(text: string): { input_ids: number[] };
    };
}

interface Transformers {
    pipeline(type: string, modelId: string): Promise<Pipeline>;
}

// Global variables
let pipeline: Pipeline | null = null;
let model: unknown | null = null;
let vectorSize: number | null = null;
let maxTokens: number | null = null;

// Dynamic import of transformers library
async function importTransformers(): Promise<Transformers> {
    try {
        // In Node.js environment during testing, return a mock
        if (typeof process !== "undefined" && process.versions?.node) {
            const mockPipeline = async (text: string) => new Array(384).fill(0);
            mockPipeline.model = {};
            mockPipeline.tokenizer = {
                model: {
                    max_position_embeddings: 512,
                },
                encode: (text: string) => ({
                    input_ids: new Array(Math.ceil(text.length / 4)).fill(0), // Rough mock implementation
                }),
            };
            vectorSize = 384;
            maxTokens = 512;
            return {
                pipeline: async () => mockPipeline as Pipeline,
            };
        }

        // In browser environment, load the actual library
        const transformers = (await import(
            // @ts-expect-error - CDN import will be available at runtime
            "https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.3.3"
        )) as Transformers;
        return transformers;
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

    if (typeof process !== "undefined" && process.versions?.node) {
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
    if (typeof process !== "undefined" && process.versions?.node) {
        try {
            const nodeWorker =
                require("node:worker_threads") as typeof import("node:worker_threads");
            nodeWorker.parentPort?.postMessage(response);
        } catch (e) {
            // Ignore error in browser environment
        }
    } else {
        self.postMessage(response);
    }
}

async function handleLoad(message: LoadMessage): Promise<void> {
    const transformers = await importTransformers();
    pipeline = await transformers.pipeline(
        "feature-extraction",
        message.modelId
    );
    model = pipeline.model;

    // Get vector size by running inference on a test input
    const testEmbedding = await pipeline("test", {
        pooling: "mean",
        normalize: true,
    });
    vectorSize = testEmbedding.length;

    // Get max tokens from the tokenizer
    maxTokens = pipeline.tokenizer.model.max_position_embeddings ?? 512;

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
    if (model) {
        // Clean up model resources
        model = null;
        pipeline = null;
    }

    postMessage({
        type: "success",
        data: "Model unloaded successfully",
    });
}

async function handleEmbedBatch(message: EmbedBatchMessage): Promise<void> {
    if (!pipeline) {
        throw new Error("Model not loaded");
    }

    const embeddings = await Promise.all(
        message.texts.map(async (text) => {
            // Ensure pipeline is still available (not unloaded during async operation)
            if (!pipeline) throw new Error("Model was unloaded");
            return pipeline(text, { pooling: "mean", normalize: true });
        })
    );

    postMessage({
        type: "success",
        data: embeddings,
    });
}

// Add new handler for count_token
async function handleCountToken(message: CountTokenMessage): Promise<void> {
    if (!pipeline) {
        throw new Error("Model not loaded");
    }

    const tokenCount = pipeline.tokenizer.encode(message.text).input_ids.length;

    postMessage({
        type: "success",
        data: tokenCount,
    });
}

// Initialize message handler
setupMessageHandler();
