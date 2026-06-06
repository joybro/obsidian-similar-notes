import { describe, expect, test } from "vitest";
import { OllamaEmbeddingProvider } from "../OllamaEmbeddingProvider";

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
