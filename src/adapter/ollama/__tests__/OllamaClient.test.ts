import { afterEach, describe, expect, test, vi } from "vitest";
import { OllamaClient } from "../OllamaClient";

// Hermetic: stub global fetch, never touch a real Ollama server.
function stubFetchOnce(jsonBody: unknown, ok = true, status = 200) {
    const fetchMock = vi.fn().mockResolvedValue({
        ok,
        status,
        statusText: ok ? "OK" : "Internal Server Error",
        json: async () => jsonBody,
        text: async () => JSON.stringify(jsonBody),
    });
    vi.stubGlobal("fetch", fetchMock);
    return fetchMock;
}

afterEach(() => {
    vi.unstubAllGlobals();
});

// #46: notes whose chunks tokenize past the model context were rejected by
// Ollama with HTTP 500 "input length exceeds the context length", because the
// deprecated /api/embeddings endpoint errors on overflow and ignores truncate.
// The modern /api/embed endpoint with truncate:true truncates over-long input
// instead of erroring, guaranteeing a note can never fail from context overflow.
describe("OllamaClient.generateEmbedding — modern /api/embed endpoint (#46)", () => {
    test("POSTs to /api/embed with input + truncate:true", async () => {
        const fetchMock = stubFetchOnce({ embeddings: [[0.1, 0.2, 0.3]] });
        const client = new OllamaClient("http://localhost:11434");

        await client.generateEmbedding("nomic-embed-text", "hello world");

        expect(fetchMock).toHaveBeenCalledTimes(1);
        const [url, init] = fetchMock.mock.calls[0];
        expect(url).toBe("http://localhost:11434/api/embed");
        const body = JSON.parse((init as RequestInit).body as string);
        expect(body).toEqual({
            model: "nomic-embed-text",
            input: "hello world",
            truncate: true,
        });
    });

    test("returns the single embedding vector from the embeddings array", async () => {
        stubFetchOnce({ embeddings: [[0.1, 0.2, 0.3]] });
        const client = new OllamaClient("http://localhost:11434");

        const result = await client.generateEmbedding("nomic-embed-text", "hi");

        expect(result).toEqual([0.1, 0.2, 0.3]);
    });

    test("throws when the response has no embeddings", async () => {
        stubFetchOnce({ embeddings: [] });
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
        const fetchMock = stubFetchOnce({ embeddings: [[1], [2], [3]] });
        const client = new OllamaClient("http://localhost:11434");

        await client.generateEmbeddings("nomic-embed-text", ["a", "b", "c"]);

        expect(fetchMock).toHaveBeenCalledTimes(1);
        const [url, init] = fetchMock.mock.calls[0];
        expect(url).toBe("http://localhost:11434/api/embed");
        expect(JSON.parse((init as RequestInit).body as string)).toEqual({
            model: "nomic-embed-text",
            input: ["a", "b", "c"],
            truncate: true,
        });
    });

    test("returns one embedding per input, in order", async () => {
        stubFetchOnce({ embeddings: [[1, 1], [2, 2], [3, 3]] });
        const client = new OllamaClient("http://localhost:11434");

        const out = await client.generateEmbeddings("m", ["a", "b", "c"]);

        expect(out).toEqual([[1, 1], [2, 2], [3, 3]]);
    });

    test("throws when the embedding count does not match the input count", async () => {
        // Guards the index→chunk mapping in NoteIndexingService: a short
        // response would silently misalign embeddings with chunks.
        stubFetchOnce({ embeddings: [[1]] });
        const client = new OllamaClient("http://localhost:11434");

        await expect(client.generateEmbeddings("m", ["a", "b"])).rejects.toThrow();
    });
});
