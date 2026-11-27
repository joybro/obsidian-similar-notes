import type {
    FeatureExtractionPipeline,
    Pipeline,
    PretrainedOptions,
    ProgressInfo,
} from "@huggingface/transformers";
import * as comlink from "comlink";
import log from "loglevel";
import { embedInBatches } from "../../utils/batching";
import { normalizeWasmError } from "../../utils/wasmError";
import { isModelCached } from "./modelCache";

/**
 * Max chunks fed to one on-device forward pass. A single `[N, seqLen]` pass costs
 * ~`N * heads * seqLen^2 * 4 bytes`; in a Node repro against this exact stack,
 * N=128 full-length (512-token) chunks peaked ~4.6GB and N=256 overran the wasm32
 * ~4GB address space and aborted with a bare number. 32 keeps the worst case
 * (32 chunks @ 512 tokens) near ~1.2GB, a comfortable margin below the cliff.
 * See docs/builtin-embedding-batch-cap-spec.md.
 */
const MAX_EMBED_BATCH_SIZE = 32;

interface Transformers {
    pipeline(
        type: string,
        modelId: string,
        options: PretrainedOptions
    ): Promise<Pipeline>;
    // Only the bit we touch. `env.backends.onnx.wasm.numThreads` controls
    // onnxruntime-web's WASM threading; see handleLoad for why we pin it.
    env?: {
        backends?: { onnx?: { wasm?: { numThreads?: number } } };
    };
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

        const embeddings: number[][] = texts.map(() => new Array<number>(384).fill(0));
        return {
            tolist: () => embeddings,
        };
    };
    mockPipeline.tokenizer = {
        model: {
            max_position_embeddings: 512,
        },
        encode: (text: string): number[] => new Array<number>(Math.ceil(text.length / 4)).fill(0), // Rough mock implementation
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
        // `self` is the worker's global scope (there is no `window` in a worker).
        Object.defineProperty(self, "process", {
            get: () => undefined,
            configurable: true,
        });

        // @ts-expect-error - Dynamic import for transformers library
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
        useGPU = true
    ): Promise<{ vectorSize: number; maxTokens: number }> {
        log.info(`Loading model: ${modelId}, useGPU: ${useGPU}`);
        const transformers = await importTransformers();

        // Pin onnxruntime-web's WASM backend to a single thread for deterministic
        // memory behavior. ort-web already auto-selects 1 thread when the context
        // is not cross-origin isolated (which Obsidian's worker is not), so this
        // is mostly explicit-intent + covers any future isolated context.
        // NOTE: single-threading is NOT what fixes the large-note crash — that was
        // a misdiagnosis. The real cause is an oversized forward pass overrunning
        // the wasm32 address space; the fix is sub-batching in handleEmbedBatch
        // (see MAX_EMBED_BATCH_SIZE). A bare-number abort reproduces single-threaded.
        const wasm = transformers.env?.backends?.onnx?.wasm;
        if (wasm) {
            wasm.numThreads = 1;
        }

        // A model already in the cache is read, not downloaded: pass on no
        // progress, so the panel and status bar do not call a slow read a
        // download (panel-empty-states spec, `downloading`).
        const fromCache = await isModelCached(modelId);
        this.extractor = await transformers.pipeline(
            "feature-extraction",
            modelId,
            {
                // @ts-expect-error - dtype is a valid option but not in type definitions
                dtype: "fp32",
                device: useGPU ? "webgpu" : "wasm", // Use WebGPU if enabled, otherwise fall back to WASM
                progress_callback: (progress: ProgressInfo) => {
                    if (progress.status === "progress" && !fromCache) {
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
        const testEmbedding = tensor.tolist() as number[][];
        tensor.dispose();
        this.vectorSize = testEmbedding[0].length;

        // Get max tokens from the tokenizer
        this.maxTokens = (this.extractor.tokenizer.model_max_length as number | undefined) ?? 512;

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
        return this.enqueue(async (): Promise<number[]> => {
            try {
                const tensor = await extractor(text, {
                    pooling: "mean",
                    normalize: true,
                });

                const result = (tensor.tolist() as number[][])[0];
                tensor.dispose();
                return result;
            } catch (error) {
                throw normalizeWasmError(error);
            }
        });
    }

    async handleEmbedBatch(texts: string[]): Promise<number[][]> {
        if (!this.extractor) {
            throw new Error("Model not loaded");
        }

        const extractor = this.extractor; // Create a local reference to avoid null check issues
        return this.enqueue(async () => {
            try {
                // Embed in bounded, sequential sub-batches so one large note
                // (many chunks) can't hand the wasm runtime an oversized forward
                // pass that overruns its address space and aborts.
                return await embedInBatches(
                    texts,
                    MAX_EMBED_BATCH_SIZE,
                    async (batch) => {
                        const tensor = await extractor(batch, {
                            pooling: "mean",
                            normalize: true,
                        });
                        const embeddings = tensor.tolist() as number[][];
                        tensor.dispose();
                        return embeddings;
                    }
                );
            } catch (error) {
                throw normalizeWasmError(error);
            }
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
