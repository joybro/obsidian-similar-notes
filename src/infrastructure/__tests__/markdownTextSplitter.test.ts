import { createHash } from "node:crypto";
import { describe, expect, test } from "vitest";
import { MarkdownTextSplitter } from "../markdownTextSplitter";
import {
    LENGTH_FUNCTIONS,
    markdownDoc,
    splitCases,
    type SplitCase,
} from "./fixtures/markdownCorpus";
import expected from "./fixtures/markdownSplitterExpected.json";

// Chunk boundaries decide what gets embedded, so the splitter must keep giving
// the exact chunks the previous library dependency gave: the expected hashes
// were recorded from @langchain/textsplitters 0.1.0 on the same inputs
// (docs/markdown-splitter-spec.md).
interface ExpectedRow extends SplitCase {
    chunks: number;
    sha256: string;
}

describe("MarkdownTextSplitter matches the recorded library output", () => {
    const rows = expected as ExpectedRow[];

    test("covers every generated case", () => {
        expect(rows.map(({ seed, chunkSize, chunkOverlap, length }) => ({
            seed,
            chunkSize,
            chunkOverlap,
            length,
        }))).toEqual(splitCases());
    });

    test.each(rows)(
        "seed $seed, size $chunkSize, overlap $chunkOverlap, $length",
        async (row) => {
            const splitter = new MarkdownTextSplitter({
                chunkSize: row.chunkSize,
                chunkOverlap: row.chunkOverlap,
                lengthFunction: LENGTH_FUNCTIONS[row.length],
            });
            const chunks = await splitter.splitText(markdownDoc(row.seed));
            expect(chunks.length).toBe(row.chunks);
            expect(
                createHash("sha256").update(JSON.stringify(chunks)).digest("hex")
            ).toBe(row.sha256);
        }
    );
});

describe("MarkdownTextSplitter basics", () => {
    test("splits on level-2 headings before paragraphs and keeps the heading", async () => {
        const splitter = new MarkdownTextSplitter({
            chunkSize: 20,
            chunkOverlap: 0,
        });
        const chunks = await splitter.splitText(
            "intro line\n## First\nbody one\n## Second\nbody two"
        );
        expect(chunks).toEqual([
            "intro line",
            "## First\nbody one",
            "## Second\nbody two",
        ]);
    });

    test("returns no chunks for blank text", async () => {
        const splitter = new MarkdownTextSplitter({
            chunkSize: 20,
            chunkOverlap: 0,
        });
        expect(await splitter.splitText("  \n\n ")).toEqual([]);
    });

    test("rejects an overlap that is not smaller than the chunk size", () => {
        expect(
            () => new MarkdownTextSplitter({ chunkSize: 10, chunkOverlap: 10 })
        ).toThrow("Cannot have chunkOverlap >= chunkSize");
    });
});
