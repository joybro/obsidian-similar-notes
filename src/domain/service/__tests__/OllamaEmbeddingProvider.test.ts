import { describe, expect, test } from "vitest";
import {
    batchTextsByPayload,
    capMaxTokensToContext,
    CONTEXT_SAFETY_FACTOR,
    OllamaEmbeddingProvider,
} from "../OllamaEmbeddingProvider";

// countTokens is a pure estimate (no loaded model / no network), so we can
// construct the provider with a dummy config and call it directly.
function makeProvider() {
    return new OllamaEmbeddingProvider({
        url: "http://localhost:11434",
        model: "test",
    });
}

const utf8Bytes = (s: string) => new TextEncoder().encode(s).length;

// #46-B: the old estimate was chars/3.5, which assumes ~3.5 ASCII chars per
// token. Hangul/CJK take 3 UTF-8 bytes per character and tokenize to ~1-2
// tokens each, so chars/3.5 undercounted them ~5x — chunks blew past the model
// context and Ollama rejected them ("input length exceeds the context").
// The estimate is now byte-based, which is far more script-stable (bytes/token
// varies ~1.3x across scripts vs chars/token's ~4x) and also bounds the ~8KB
// payload limit.
describe("OllamaEmbeddingProvider.countTokens — byte-based estimate (#46-B)", () => {
    test("counts by UTF-8 byte length, not character count", async () => {
        const p = makeProvider();
        // ASCII: 1 byte/char.
        expect(await p.countTokens("hello world")).toBe(
            Math.ceil(utf8Bytes("hello world") / 2)
        );
        // Hangul: 3 bytes/char.
        expect(await p.countTokens("안녕하세요")).toBe(
            Math.ceil(utf8Bytes("안녕하세요") / 2)
        );
    });

    test("counts Hangul/CJK far higher than equal-character-count ASCII", async () => {
        const p = makeProvider();
        const korean = "안녕하세요"; // 5 chars, 15 bytes
        const english = "hello"; // 5 chars, 5 bytes
        expect(await p.countTokens(korean)).toBeGreaterThan(
            await p.countTokens(english)
        );
        // And never undercounts Hangul below ~1 token per character (the
        // undercount that let oversized chunks reach Ollama).
        expect(await p.countTokens(korean)).toBeGreaterThanOrEqual(korean.length);
    });

    test("sums mixed-script content by bytes", async () => {
        const p = makeProvider();
        const mixed = "안녕 hi"; // 6 + 1 + 2 = 9 bytes
        expect(await p.countTokens(mixed)).toBe(Math.ceil(utf8Bytes(mixed) / 2));
    });
});

// #46: even byte-based counting (#46-B) undercounts token-dense content (tables,
// numbers, code, paths), so chunks sized at the model's full context still
// overflowed it. The chunk size is now also capped at a conservative fraction of
// the model's *real* context length (from /api/show), so truncation (the
// truncate:true backstop) rarely has to discard content.
describe("OllamaEmbeddingProvider.capMaxTokensToContext — context-aware chunk cap (#46)", () => {
    test("caps detected maxTokens to a safe fraction of the real context length", () => {
        // all-minilm: detected 512, real context 512 → must drop below context.
        expect(capMaxTokensToContext(512, 512)).toBe(
            Math.floor(512 * CONTEXT_SAFETY_FACTOR)
        );
    });

    test("keeps the detected value when it is already below the context cap", () => {
        // bge-m3: detected 2048 (payload-capped), context 8192 → cap is higher,
        // so the smaller payload-safe value wins (never inflate the chunk).
        expect(capMaxTokensToContext(2048, 8192)).toBe(2048);
    });

    test("falls back to the detected value when context length is unknown", () => {
        expect(capMaxTokensToContext(512, undefined)).toBe(512);
        expect(capMaxTokensToContext(512, 0)).toBe(512);
    });
});

// Fast-follow to #46: chunks are grouped into payload-bounded batches so a
// note's many chunks embed in a few /api/embed requests instead of one request
// per chunk, while each request stays within the transport-safe byte envelope.
describe("OllamaEmbeddingProvider.batchTextsByPayload — payload-bounded batching", () => {
    test("packs consecutive texts until the next would exceed the byte budget", () => {
        // 4-byte texts, budget 10 → 2 per batch (3rd would make 12 > 10).
        const texts = ["aaaa", "bbbb", "cccc", "dddd", "eeee"];
        expect(batchTextsByPayload(texts, 10)).toEqual([
            ["aaaa", "bbbb"],
            ["cccc", "dddd"],
            ["eeee"],
        ]);
    });

    test("puts a single over-budget text in its own batch (truncate handles size server-side)", () => {
        const texts = ["aa", "this-one-is-way-too-long", "bb"];
        expect(batchTextsByPayload(texts, 8)).toEqual([
            ["aa"],
            ["this-one-is-way-too-long"],
            ["bb"],
        ]);
    });

    test("preserves overall order and loses no text", () => {
        const texts = Array.from({ length: 20 }, (_, i) => `t${i}`);
        const batches = batchTextsByPayload(texts, 7);
        expect(batches.flat()).toEqual(texts);
    });

    test("multi-byte text is measured by UTF-8 byte length", () => {
        // "안녕" = 6 bytes, "hi" = 2 bytes; budget 6 → they cannot share a batch.
        expect(batchTextsByPayload(["안녕", "hi"], 6)).toEqual([["안녕"], ["hi"]]);
    });
});
