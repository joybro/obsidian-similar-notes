// Types for messages between main thread and worker
type LoadMessage = {
    type: "load";
    modelId: string;
};

type UnloadMessage = {
    type: "unload";
};

type EmbedBatchMessage = {
    type: "embed_batch";
    texts: string[];
};

type WorkerMessage = LoadMessage | UnloadMessage | EmbedBatchMessage;

type WorkerResponse = {
    type: "success" | "error";
    data?: unknown;
    error?: string;
};

// Define types for the transformers library
interface Pipeline {
    (text: string, options: { pooling: string; normalize: boolean }): Promise<
        number[]
    >;
    model: unknown;
}

interface Transformers {
    pipeline(type: string, modelId: string): Promise<Pipeline>;
}

// Global variables
let pipeline: Pipeline | null = null;
let model: unknown | null = null;

// Dynamic import of transformers library
async function importTransformers(): Promise<Transformers> {
    try {
        // In Node.js environment during testing, return a mock
        if (typeof process !== "undefined" && process.versions?.node) {
            const mockPipeline = async (text: string) => new Array(384).fill(0); // Mock embedding size
            mockPipeline.model = {};
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

    postMessage({
        type: "success",
        data: "Model loaded successfully",
    });
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

// Initialize message handler
setupMessageHandler();
