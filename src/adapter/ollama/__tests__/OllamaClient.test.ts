import { requestUrl, type RequestUrlParam } from "obsidian";
import { describe, expect, test, vi } from "vitest";
import { OllamaClient } from "../OllamaClient";

vi.mock("obsidian", () => ({ requestUrl: vi.fn() }));

// Hermetic: stub Obsidian's requestUrl, never touch a real Ollama server.
// requestUrl resolves with json/text as properties, not methods.
function stubRequestOnce(jsonBody: unknown, status = 200) {
    const mock = vi.mocked(requestUrl);
    mock.mockResolvedValue({
        status,
        headers: {},
        arrayBuffer: new ArrayBuffer(0),
        json: jsonBody,
        text: JSON.stringify(jsonBody),
    } as never);
    return mock;
}

function call(mock: ReturnType<typeof stubRequestOnce>, i = 0): RequestUrlParam {
    return mock.mock.calls[i][0] as RequestUrlParam;
}

// #46: notes whose chunks tokenize past the model context were rejected by
// Ollama with HTTP 500 "input length exceeds the context length", because the
// deprecated /api/embeddings endpoint errors on overflow and ignores truncate.
// The modern /api/embed endpoint with truncate:true truncates over-long input
// instead of erroring, guaranteeing a note can never fail from context overflow.
describe("OllamaClient.generateEmbedding — modern /api/embed endpoint (#46)", () => {
    test("POSTs to /api/embed with input + truncate:true", async () => {
        const mock = stubRequestOnce({ embeddings: [[0.1, 0.2, 0.3]] });
        const client = new OllamaClient("http://localhost:11434");

        await client.generateEmbedding("nomic-embed-text", "hello world");

        expect(mock).toHaveBeenCalledTimes(1);
        const req = call(mock);
        expect(req.url).toBe("http://localhost:11434/api/embed");
        expect(req.method).toBe("POST");
        expect(req.throw).toBe(false);
        const body = JSON.parse(req.body as string);
        expect(body).toEqual({
            model: "nomic-embed-text",
            input: "hello world",
            truncate: true,
        });
    });

    test("returns the single embedding vector from the embeddings array", async () => {
        stubRequestOnce({ embeddings: [[0.1, 0.2, 0.3]] });
        const client = new OllamaClient("http://localhost:11434");

        const result = await client.generateEmbedding("nomic-embed-text", "hi");

        expect(result).toEqual([0.1, 0.2, 0.3]);
    });

    test("throws when the response has no embeddings", async () => {
        stubRequestOnce({ embeddings: [] });
        const client = new OllamaClient("http://localhost:11434");

        await expect(
            client.generateEmbedding("nomic-embed-text", "hi")
        ).rejects.toThrow();
    });
});

// Fast-follow to #46: /api/embed accepts an array input and returns one
// embedding per input, so a note's chunks can be embedded in one request
// instead of one HTTP round-trip per chunk.
describe("OllamaClient.generateEmbeddings — batched /api/embed (#46 fast-follow)", () => {
    test("POSTs the whole input array in a single /api/embed request", async () => {
        const mock = stubRequestOnce({ embeddings: [[1], [2], [3]] });
        const client = new OllamaClient("http://localhost:11434");

        await client.generateEmbeddings("nomic-embed-text", ["a", "b", "c"]);

        expect(mock).toHaveBeenCalledTimes(1);
        const req = call(mock);
        expect(req.url).toBe("http://localhost:11434/api/embed");
        expect(JSON.parse(req.body as string)).toEqual({
            model: "nomic-embed-text",
            input: ["a", "b", "c"],
            truncate: true,
        });
    });

    test("returns one embedding per input, in order", async () => {
        stubRequestOnce({ embeddings: [[1, 1], [2, 2], [3, 3]] });
        const client = new OllamaClient("http://localhost:11434");

        const out = await client.generateEmbeddings("m", ["a", "b", "c"]);

        expect(out).toEqual([[1, 1], [2, 2], [3, 3]]);
    });

    test("throws when the embedding count does not match the input count", async () => {
        // Guards the index→chunk mapping in NoteIndexingService: a short
        // response would silently misalign embeddings with chunks.
        stubRequestOnce({ embeddings: [[1]] });
        const client = new OllamaClient("http://localhost:11434");

        await expect(client.generateEmbeddings("m", ["a", "b"])).rejects.toThrow();
    });
});

// Obsidian review asks plugins to use requestUrl instead of fetch; requestUrl
// also skips CORS, so a LAN Ollama server works without OLLAMA_ORIGINS.
describe("OllamaClient over requestUrl", () => {
    test("lists models with a GET to /api/tags", async () => {
        const mock = stubRequestOnce({ models: [{ name: "nomic-embed-text:latest", details: { family: "nomic-bert" } }] });
        const client = new OllamaClient("http://192.168.0.5:11434/");

        const models = await client.getModelsWithEmbeddingInfo();

        expect(call(mock)).toMatchObject({ url: "http://192.168.0.5:11434/api/tags", method: "GET", throw: false });
        expect(models).toEqual([{ name: "nomic-embed-text:latest", isEmbeddingModel: true }]);
    });

    test("an error status rejects with the status and the server's message", async () => {
        stubRequestOnce({ error: 'model "nope" not found, try pulling it first' }, 404);
        const client = new OllamaClient();

        await expect(client.generateEmbedding("nope", "hi")).rejects.toThrow(
            /HTTP 404.*model \\"nope\\" not found/
        );
    });

    test("testConnection is false on an error status and on a network failure", async () => {
        stubRequestOnce({}, 500);
        expect(await new OllamaClient().testConnection()).toBe(false);

        vi.mocked(requestUrl).mockRejectedValue(new Error("net::ERR_CONNECTION_REFUSED"));
        expect(await new OllamaClient().testConnection()).toBe(false);
    });

    test("getModelInfo POSTs the model name to /api/show and reads its details", async () => {
        const mock = stubRequestOnce({
            details: { parameter_size: "137M", quantization_level: "F16", family: "nomic-bert" },
            // Shape of Ollama 0.40's real /api/show for nomic-embed-text: the
            // prefix is "nomic-bert" with a hyphen.
            model_info: {
                "general.architecture": "nomic-bert",
                "nomic-bert.context_length": 2048,
                "nomic-bert.embedding_length": 768,
                "nomic-bert.feed_forward_length": 3072,
            },
        });

        const info = await new OllamaClient().getModelInfo("nomic-embed-text");

        expect(call(mock)).toMatchObject({ url: "http://localhost:11434/api/show", method: "POST" });
        expect(JSON.parse(call(mock).body as string)).toEqual({ name: "nomic-embed-text" });
        expect(info).toEqual({
            parameterSize: "137M",
            quantizationLevel: "F16",
            family: "nomic-bert",
            embeddingLength: 768,
            contextLength: 2048,
        });
    });
});

describe("OllamaClient.getModelInfo reads the architecture-prefixed lengths", () => {
    test("bert models (bge-m3, all-minilm)", async () => {
        stubRequestOnce({
            details: { family: "bert" },
            model_info: { "general.architecture": "bert", "bert.context_length": 8192, "bert.embedding_length": 1024 },
        });
        const info = await new OllamaClient().getModelInfo("bge-m3");
        expect(info).toMatchObject({ contextLength: 8192, embeddingLength: 1024 });
    });

    test("without general.architecture, falls back to any *.context_length key", async () => {
        stubRequestOnce({ details: {}, model_info: { "qwen3.context_length": 32768, "qwen3.embedding_length": 1024 } });
        const info = await new OllamaClient().getModelInfo("x");
        expect(info).toMatchObject({ contextLength: 32768, embeddingLength: 1024 });
    });

    test("unknown lengths stay undefined", async () => {
        stubRequestOnce({ details: {}, model_info: { "general.architecture": "nomic-bert" } });
        const info = await new OllamaClient().getModelInfo("x");
        expect(info?.contextLength).toBeUndefined();
        expect(info?.embeddingLength).toBeUndefined();
    });
});
