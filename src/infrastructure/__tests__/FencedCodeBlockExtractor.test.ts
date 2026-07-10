import { describe, expect, test } from "vitest";
import { FencedCodeBlockExtractor } from "../FencedCodeBlockExtractor";

describe("FencedCodeBlockExtractor", () => {
    const extractor = new FencedCodeBlockExtractor();

    test("leaves Markdown without fenced blocks unchanged", () => {
        const markdown = "# Heading\r\n\r\nPlain `inline code`.\r\n";

        expect(extractor.extract(markdown)).toEqual({
            prose: markdown,
            codeBlocks: [],
        });
    });

    test("extracts a backtick fence with language and info", () => {
        const markdown = [
            "Before",
            "```ts title=example",
            "const answer = 42;",
            "```",
            "After",
        ].join("\n");

        const result = extractor.extract(markdown);

        expect(result.prose).toBe("Before\n\nAfter");
        expect(result.codeBlocks).toEqual([
            expect.objectContaining({
                content: "const answer = 42;",
                language: "ts",
                info: "ts title=example",
                blockIndex: 0,
                startLine: 2,
                endLine: 4,
                fenceCharacter: "`",
                fenceLength: 3,
                closed: true,
            }),
        ]);
    });

    test("supports tilde fences and a longer closing fence", () => {
        const markdown = [
            "~~~~ python extra",
            "print('hello')",
            "~~~",
            "~~~~~",
        ].join("\n");

        const result = extractor.extract(markdown);

        expect(result.codeBlocks[0]).toEqual(
            expect.objectContaining({
                content: "print('hello')\n~~~",
                language: "python",
                info: "python extra",
                fenceCharacter: "~",
                fenceLength: 4,
                closed: true,
            })
        );
    });

    test("accepts up to three spaces of fence indentation and removes that indentation from code", () => {
        const markdown = [
            "   ```js",
            "   first();",
            " second();",
            "  ````",
        ].join("\n");

        const result = extractor.extract(markdown);

        expect(result.codeBlocks[0].content).toBe("first();\nsecond();");
    });

    test("does not treat a four-space-indented fence as fenced code", () => {
        const markdown = "    ```js\n    const value = 1;";

        expect(extractor.extract(markdown)).toEqual({
            prose: markdown,
            codeBlocks: [],
        });
    });

    test("extracts empty and unclosed blocks", () => {
        const empty = extractor.extract(["Start", "```", "```", "End"].join("\n"));
        const unclosed = extractor.extract(
            ["Before", "~~~rust", "fn main() {}"].join("\n")
        );

        expect(empty.codeBlocks[0].content).toBe("");
        expect(empty.codeBlocks[0].closed).toBe(true);
        expect(empty.prose).toBe("Start\n\nEnd");

        expect(unclosed.codeBlocks[0]).toEqual(
            expect.objectContaining({
                content: "fn main() {}",
                language: "rust",
                startLine: 2,
                endLine: 3,
                closed: false,
            })
        );
        expect(unclosed.prose).toBe("Before\n\n");
    });

    test("rejects backticks in a backtick fence info string", () => {
        const markdown = "```js`invalid";

        expect(extractor.extract(markdown)).toEqual({
            prose: markdown,
            codeBlocks: [],
        });
    });
});
