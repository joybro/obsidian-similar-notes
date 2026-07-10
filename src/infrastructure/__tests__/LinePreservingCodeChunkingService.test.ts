import type { CodeBlock } from "@/domain/model/CodeBlock";
import { Note } from "@/domain/model/Note";
import { describe, expect, test, vi } from "vitest";
import { LinePreservingCodeChunkingService } from "../LinePreservingCodeChunkingService";

function codeBlock(
    content: string,
    blockIndex = 0,
    language: string | null = "ts"
): CodeBlock {
    return {
        content,
        language,
        info: language ?? "",
        blockIndex,
        startLine: 1,
        endLine: 1,
        fenceCharacter: "`",
        fenceLength: 3,
        closed: true,
    };
}

describe("LinePreservingCodeChunkingService", () => {
    const note = new Note("src/example.md", "Example", "", []);

    test("keeps complete lines together while they fit", async () => {
        const counter = {
            getMaxTokens: () => 11,
            countTokens: vi.fn(async (text: string) => text.length),
        };
        const service = new LinePreservingCodeChunkingService(counter);

        const chunks = await service.split(
            note,
            [codeBlock("alpha\nbeta\ngamma")]
        );

        expect(chunks.map((chunk) => chunk.content)).toEqual([
            "alpha\nbeta\n",
            "gamma",
        ]);
        expect(chunks.map((chunk) => chunk.chunkIndex)).toEqual([0, 1]);
        expect(chunks.every((chunk) => chunk.totalChunks === 2)).toBe(true);
    });

    test("splits within a line only when that line exceeds the model limit", async () => {
        const counter = {
            getMaxTokens: () => 4,
            countTokens: vi.fn(async (text: string) => text.length),
        };
        const service = new LinePreservingCodeChunkingService(counter);

        const chunks = await service.split(note, [codeBlock("abcdefghij")]);

        expect(chunks.map((chunk) => chunk.content)).toEqual([
            "abcd",
            "efgh",
            "ij",
        ]);
        for (const chunk of chunks) {
            expect(await counter.countTokens(chunk.content)).toBeLessThanOrEqual(4);
        }
    });

    test("preserves block and language metadata with global and per-block indexes", async () => {
        const counter = {
            getMaxTokens: () => 6,
            countTokens: vi.fn(async (text: string) => text.length),
        };
        const service = new LinePreservingCodeChunkingService(counter);

        const chunks = await service.split(note, [
            codeBlock("   ", 0),
            codeBlock("one\ntwo\nthree", 1, "python"),
            codeBlock("last", 2, null),
        ]);

        expect(chunks).toHaveLength(4);
        expect(chunks.map((chunk) => chunk.chunkIndex)).toEqual([0, 1, 2, 3]);
        expect(chunks.every((chunk) => chunk.totalChunks === 4)).toBe(true);
        expect(chunks.slice(0, 3).map((chunk) => chunk.blockChunkIndex)).toEqual([
            0, 1, 2,
        ]);
        expect(chunks.slice(0, 3).every((chunk) => chunk.totalBlockChunks === 3)).toBe(true);
        expect(chunks[0]).toEqual(
            expect.objectContaining({
                blockIndex: 1,
                language: "python",
                info: "python",
            })
        );
        expect(chunks[3]).toEqual(
            expect.objectContaining({
                blockIndex: 2,
                language: null,
                blockChunkIndex: 0,
                totalBlockChunks: 1,
            })
        );
    });

    test("rejects invalid model token limits", async () => {
        const service = new LinePreservingCodeChunkingService({
            getMaxTokens: () => 0,
            countTokens: async (text: string) => text.length,
        });

        await expect(service.split(note, [codeBlock("code")])).rejects.toThrow(
            "invalid max token count"
        );
    });
});
