import { describe, expect, test } from "vitest";
import { Note } from "@/domain/model/Note";
import type { EmbeddingService } from "@/domain/service/EmbeddingService";
import {
    LangchainNoteChunkingService,
    SEMANTIC_CHUNK_TOKENS,
} from "../LangchainNoteChunkingService";

// A fake embedding service exposing only what the chunker uses. countTokens is
// 1-token-per-char so chunk "token" sizes equal character counts, making the
// chunkSize cap directly assertable. getMaxTokens is the configurable ceiling.
function fakeEmbeddingService(maxTokens: number): EmbeddingService {
    return {
        getMaxTokens: () => maxTokens,
        countTokens: async (text: string) => text.length,
    } as unknown as EmbeddingService;
}

// Many short paragraphs separated by blank lines so the markdown splitter has
// clean break points and packs chunks up to (but not past) the chunkSize.
function longNote(paragraphs = 40): Note {
    const filler =
        "lorem ipsum dolor sit amet consectetur adipiscing elit sed do";
    const content = Array.from(
        { length: paragraphs },
        (_, i) => `Paragraph ${i}. ${filler} ${filler}`
    ).join("\n\n");
    return new Note("long.md", "Long Note", content, []);
}

async function chunkTokenSizes(
    service: LangchainNoteChunkingService,
    note: Note
): Promise<number[]> {
    const chunks = await service.split(note);
    return chunks.map((c) => c.content.length); // countTokens == length here
}

describe("LangchainNoteChunkingService: semantic chunk-size cap (semantic-chunk-size-spec)", () => {
    test("caps chunk size at SEMANTIC_CHUNK_TOKENS when the model ceiling is larger", async () => {
        // bge-m3-like: getMaxTokens 2048. Old behavior chunked at 2048, diluting
        // long multi-topic notes. New behavior must cap at the semantic target.
        const service = new LangchainNoteChunkingService(
            fakeEmbeddingService(2048)
        );
        await service.init();

        const sizes = await chunkTokenSizes(service, longNote());

        expect(Math.max(...sizes)).toBeLessThanOrEqual(SEMANTIC_CHUNK_TOKENS);
        // And materially below the model ceiling — the bug was one giant chunk.
        expect(Math.max(...sizes)).toBeLessThan(2048);
        expect(sizes.length).toBeGreaterThan(1);
    });

    test("model ceiling still binds when it is smaller than the semantic target", async () => {
        // all-minilm-like: getMaxTokens 256 < 512. min() keeps the smaller size.
        const service = new LangchainNoteChunkingService(
            fakeEmbeddingService(256)
        );
        await service.init();

        const sizes = await chunkTokenSizes(service, longNote());

        expect(Math.max(...sizes)).toBeLessThanOrEqual(256);
    });

    test("a smaller ceiling produces strictly finer chunks (more, smaller pieces)", async () => {
        const note = longNote();

        const big = new LangchainNoteChunkingService(
            fakeEmbeddingService(2048)
        );
        await big.init();
        const small = new LangchainNoteChunkingService(
            fakeEmbeddingService(256)
        );
        await small.init();

        const bigSizes = await chunkTokenSizes(big, note);
        const smallSizes = await chunkTokenSizes(small, note);

        // 256-ceiling chunks are finer than 512-capped chunks for the same note.
        expect(smallSizes.length).toBeGreaterThan(bigSizes.length);
    });

    test("a short note stays a single chunk (cap does not over-split)", async () => {
        const service = new LangchainNoteChunkingService(
            fakeEmbeddingService(2048)
        );
        await service.init();

        const chunks = await service.split(
            new Note("short.md", "Short", "Just a short note.", [])
        );

        expect(chunks).toHaveLength(1);
        expect(chunks[0].totalChunks).toBe(1);
    });
});
